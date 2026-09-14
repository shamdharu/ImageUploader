import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { db, STORAGE_ROOT } from '../db.js';

// Resolution presets (Doc 1 section 4) - longest edge in px.
export const VARIANTS = [
  { type: 'thumbnail', longestEdge: 300,  format: 'webp', quality: 75 }, // grid/gallery
  { type: 'web',       longestEdge: 1280, format: 'webp', quality: 82 }, // in-app viewing
  { type: 'hd',        longestEdge: 2048, format: 'jpeg', quality: 88 }, // standard download
  { type: 'print',     longestEdge: 3000, format: 'jpeg', quality: 93 }, // print output
];

export const MIME_BY_FORMAT = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  gif: 'image/gif',
  tiff: 'image/tiff',
};

export const ALLOWED_FORMATS = ['jpeg', 'png', 'webp', 'heic', 'heif'];

export function extForFormat(format) {
  return format === 'jpeg' ? 'jpg' : format;
}

/** Resolve a relative storage key (e.g. categories/1/thumbnail/3.webp) to an absolute path. */
export function resolveStorage(key) {
  return path.join(STORAGE_ROOT, key);
}

export function storageKeyFor(categoryId, variant, imageId, ext) {
  return path.join('categories', String(categoryId), variant, `${imageId}.${ext}`);
}

/** Read basic metadata; throws if the file is not a decodable image. */
export async function inspect(buffer) {
  const meta = await sharp(buffer, { failOn: 'error' }).metadata();
  return {
    format: meta.format,
    mime: MIME_BY_FORMAT[meta.format],
    width: meta.width,
    height: meta.height,
    orientation: meta.orientation,
  };
}

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Build the original + all derived variants for one image (the async worker step). */
export async function processImage(imageId) {
  try {
    const job = db.prepare(
      `UPDATE upload_jobs SET status='processing', started_at = COALESCE(started_at, datetime('now'))
       WHERE image_id = ? AND status = 'queued'`
    ).run(imageId);
    if (job.changes === 0) return; // already handled

    const image = db.prepare('SELECT * FROM images WHERE id = ?').get(imageId);
    if (!image) return;

    const srcAbs = resolveStorage(image.storage_key);
    const buffer = await fs.promises.readFile(srcAbs);
    const oriented = sharp(buffer, { failOn: 'error' }).rotate(); // auto-EXIF correction (Doc 1, 2.1)
    const meta = await oriented.metadata();
    const width = meta.width;
    const height = meta.height;

    const setProgress = db.prepare(
      "UPDATE upload_jobs SET progress_percent = ? WHERE image_id = ? AND status = 'processing'"
    );

    for (let i = 0; i < VARIANTS.length; i++) {
      const v = VARIANTS[i];
      const longest = Math.max(width, height);
      const scale = Math.min(1, v.longestEdge / longest);
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));

      const rel = storageKeyFor(image.category_id, v.type, imageId, extForFormat(v.format));
      const abs = resolveStorage(rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });

      const pipeline = sharp(buffer, { failOn: 'error' }).rotate().resize(w, h);
      if (v.format === 'webp') pipeline.webp({ quality: v.quality });
      else if (v.format === 'jpeg') pipeline.jpeg({ quality: v.quality, mozjpeg: true });
      else if (v.format === 'png') pipeline.png();
      else continue;
      await pipeline.toFile(abs);

      const dims = await sharp(abs).metadata();
      db.prepare(
        `INSERT INTO image_variants (image_id, variant_type, width_px, height_px, storage_key)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(image_id, variant_type) DO UPDATE SET
           width_px = excluded.width_px,
           height_px = excluded.height_px,
           storage_key = excluded.storage_key`
      ).run(imageId, v.type, dims.width, dims.height, rel);

      setProgress.run(Math.round(((i + 1) / VARIANTS.length) * 85) + 10);
    }

    // original variant row (the untouched upload, Doc 1: "store the original untouched")
    db.prepare(
      `INSERT OR IGNORE INTO image_variants (image_id, variant_type, width_px, height_px, storage_key)
       VALUES (?, 'original', ?, ?, ?)`
    ).run(imageId, width, height, image.storage_key);

    db.prepare("UPDATE images SET width_px = ?, height_px = ?, status = 'ready' WHERE id = ?").run(width, height, imageId);
    db.prepare(
      "UPDATE upload_jobs SET status = 'completed', progress_percent = 100, finished_at = datetime('now') WHERE image_id = ?"
    ).run(imageId);
  } catch (err) {
    console.error(`[worker] processing failed for image ${imageId}:`, err.message);
    db.prepare("UPDATE images SET status = 'failed' WHERE id = ?").run(imageId);
    db.prepare(
      "UPDATE upload_jobs SET status = 'failed', error_message = ?, finished_at = datetime('now') WHERE image_id = ?"
    ).run(String(err.message).slice(0, 500), imageId);
  }
}

/** Fire-and-forget scheduling so the HTTP request returns immediately (Doc 3, section 2.1). */
export function queueImageProcessing(imageId) {
  setTimeout(() => processImage(imageId), 100);
}

/** Rerun any jobs left queued/processing after a previous process stopped (crash recovery, basic). */
export function resumePendingJobs() {
  db.prepare("UPDATE upload_jobs SET status = 'queued' WHERE status = 'processing'").run();
  const jobs = db.prepare("SELECT image_id FROM upload_jobs WHERE status = 'queued'").all();
  for (const j of jobs) queueImageProcessing(j.image_id);
  if (jobs.length) console.log(`[worker] resuming ${jobs.length} pending job(s)`);
}