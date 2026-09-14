import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, DATA_DIR } from '../db.js';
import { requireAuth } from '../auth.js';
import { canPrint, canUpload, canView, maxDownloadResolution, canDownloadResolution, serveAccess } from '../access.js';
import { inspect, sha256, ALLOWED_FORMATS, extForFormat, resolveStorage, storageKeyFor, queueImageProcessing } from '../services/imageService.js';
import { recordAudit } from '../services/auditService.js';
import { parseMultipart } from '../services/multipart.js';

const router = Router();
const TMP_DIR = path.join(DATA_DIR, 'tmp');
const EXT_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' };
const getCategory = (id) => db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(id));
const getImage = (id) => db.prepare('SELECT * FROM images WHERE id = ?').get(Number(id));

function variantsOf(imageId) {
  return db
    .prepare('SELECT variant_type, width_px, height_px FROM image_variants WHERE image_id = ? ORDER BY id')
    .all(imageId)
    .map((v) => ({ type: v.variant_type, width: v.width_px, height: v.height_px }));
}

/** Upload: accepts the file, validates, stores the original, kicks off async variant processing. */
router.post('/uploads', requireAuth, async (req, res) => {
  let tmpPath = null;
  const fail = (code, message) => {
    if (tmpPath) fs.promises.rm(tmpPath, { force: true });
    res.status(code).json({ error: message });
  };

  try {
    const { fields, files } = await parseMultipart(req, { tmpDir: TMP_DIR, maxBytes: 60 * 1024 * 1024 });
    const file = files[0];
    if (!file) return fail(400, 'No file received');
    tmpPath = file.tmpPath;

    const category = getCategory(fields.categoryId);
    if (!category) return fail(404, 'Category not found');
    if (!canUpload(db, req.user, category)) return fail(403, 'Your role cannot upload into this category');

    const buffer = await fs.promises.readFile(tmpPath);
    let meta;
    try {
      meta = await inspect(buffer);
    } catch {
      return fail(400, 'The file is not a decodable image');
    }
    if (!meta.mime || !ALLOWED_FORMATS.includes(meta.format)) {
      return fail(400, `Unsupported image type "${meta.format ?? 'unknown'}". Allowed: JPEG, PNG, WebP, HEIC`);
    }

    const checksum = sha256(buffer);
    const duplicate = db.prepare("SELECT id FROM images WHERE checksum_hash = ? AND status = 'ready'").get(checksum);
    if (duplicate) return fail(409, `Duplicate image detected - the exact same file is already image #${duplicate.id}`);

    const used = db.prepare('SELECT COALESCE(SUM(file_size_bytes), 0) AS b FROM images WHERE uploaded_by = ?').get(req.user.id).b;
    if (used + buffer.byteLength > req.user.storage_quota_mb * 1024 * 1024) {
      return fail(413, `Storage quota exceeded (${req.user.storage_quota_mb} MB)`);
    }

    const source = ['mobile_camera', 'webcam', 'file_upload'].includes(fields.source) ? fields.source : 'file_upload';
    const ext = extForFormat(meta.format);
    const originalName = String(fields.originalname || file.filename || '').slice(0, 255);

    const imageId = db.prepare(
      `INSERT INTO images (category_id, uploaded_by, original_filename, storage_key, mime_type,
                           width_px, height_px, file_size_bytes, source, exif_data, checksum_hash, status)
       VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, 'processing')`
    ).run(category.id, req.user.id, originalName, meta.mime, meta.width, meta.height,
          buffer.byteLength, source, JSON.stringify({ orientation: meta.orientation }), checksum).lastInsertRowid;

    const rel = storageKeyFor(category.id, 'originals', imageId, ext);
    db.prepare('UPDATE images SET storage_key = ? WHERE id = ?').run(rel, imageId);
    const destAbs = resolveStorage(rel);
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    await fs.promises.rename(tmpPath, destAbs);
    tmpPath = null; // moved - nothing left to clean up

    const jobId = crypto.randomUUID();
    db.prepare(
      "INSERT INTO upload_jobs (id, image_id, user_id, status, progress_percent) VALUES (?, ?, ?, 'queued', 0)"
    ).run(jobId, imageId, req.user.id);

    recordAudit({ userId: req.user.id, imageId, action: 'upload', resolution: 'original', ipAddress: req.ip });
    queueImageProcessing(imageId); // return immediately; variants build in the background

    res.status(202).json({ jobId, imageId });
  } catch (e) {
    console.error('[upload]', e);
    const oversized = e.status === 413;
    fail(oversized ? 413 : 500, oversized ? 'File exceeds the 60 MB limit' : 'Internal server error');
  }
});

/** Images in one category the user may view. */
router.get('/', requireAuth, (req, res) => {
  if (!req.query.categoryId) return res.status(400).json({ error: 'categoryId is required' });
  const category = getCategory(req.query.categoryId);
  if (!category) return res.status(404).json({ error: 'Category not found' });
  if (!canView(db, req.user, category)) return res.status(403).json({ error: 'You cannot view this category' });

  const rows = db.prepare(
    `SELECT i.*, u.full_name AS uploader
     FROM images i JOIN users u ON u.id = i.uploaded_by
     WHERE i.category_id = ? ORDER BY i.id DESC`
  ).all(category.id);

  res.json({
    images: rows.map((r) => ({
      id: r.id, categoryId: r.category_id, filename: r.original_filename, mimeType: r.mime_type,
      widthPx: r.width_px, heightPx: r.height_px, fileSizeBytes: r.file_size_bytes,
      source: r.source, status: r.status, createdAt: r.created_at, uploadedBy: r.uploader,
      thumbnailUrl: `/api/images/${r.id}/file?variant=thumbnail`,
      variants: variantsOf(r.id),
    })),
  });
});

/** Single image detail + the acting user's independent permission set. */
router.get('/:id', requireAuth, (req, res) => {
  const image = getImage(req.params.id);
  if (!image) return res.status(404).json({ error: 'Image not found' });
  const category = getCategory(image.category_id);
  if (!canView(db, req.user, category)) return res.status(403).json({ error: 'You cannot view this image' });

  const uploader = db.prepare('SELECT full_name FROM users WHERE id = ?').get(image.uploaded_by);
  res.json({
    image: {
      id: image.id, categoryId: image.category_id, filename: image.original_filename,
      mimeType: image.mime_type, widthPx: image.width_px, heightPx: image.height_px,
      fileSizeBytes: image.file_size_bytes, source: image.source, status: image.status,
      createdAt: image.created_at, uploadedBy: uploader.full_name,
    },
    permissions: {
      canUpload: canUpload(db, req.user, category),
      maxDownload: maxDownloadResolution(db, req.user, category),
      canPrint: canPrint(db, req.user, category),
    },
    variants: variantsOf(image.id),
  });
});

/** Serve one variant file. Permission + audit are decided by the requested variant. */
router.get('/:id/file', requireAuth, (req, res) => {
  const image = getImage(req.params.id);
  if (!image) return res.status(404).json({ error: 'Image not found' });
  const category = getCategory(image.category_id);
  const variant = String(req.query.variant || 'thumbnail').toLowerCase();

  const check = serveAccess(db, req.user, category, variant);
  if (!check.allowed) {
    return res.status(403).json({ error: `Not allowed for "${variant}" (${check.action ?? 'access'})` });
  }

  const vrow = variant === 'original'
    ? { storage_key: image.storage_key }
    : db.prepare('SELECT storage_key FROM image_variants WHERE image_id = ? AND variant_type = ?').get(image.id, variant);
  if (!vrow?.storage_key) return res.status(404).json({ error: `Variant "${variant}" is not available yet` });

  const abs = resolveStorage(vrow.storage_key);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File is missing on disk' });

  const mime = EXT_MIME[path.extname(abs).slice(1).toLowerCase()] || 'application/octet-stream';
  recordAudit({ userId: req.user.id, imageId: image.id, action: check.action, resolution: variant, ipAddress: req.ip });
  res.set('Content-Type', mime);
  res.set('Cache-Control', 'private, max-age=3600');
  res.sendFile(abs);
});

/** Explicit download action - checks download permission independently of view/print. */
router.post('/:id/download', requireAuth, (req, res) => {
  const image = getImage(req.params.id);
  if (!image) return res.status(404).json({ error: 'Image not found' });
  const category = getCategory(image.category_id);
  const variant = String(req.body?.variant || 'web').toLowerCase();

  if (!canDownloadResolution(db, req.user, category, variant)) {
    return res.status(403).json({ error: 'Your role cannot download that resolution' });
  }
  res.json({ url: `/api/images/${image.id}/file?variant=${variant}` });
});

/** Explicit print action - independent of view/download rights. */
router.post('/:id/print', requireAuth, (req, res) => {
  const image = getImage(req.params.id);
  if (!image) return res.status(404).json({ error: 'Image not found' });
  const category = getCategory(image.category_id);

  const check = serveAccess(db, req.user, category, 'print');
  if (!check.allowed) return res.status(403).json({ error: 'Your role cannot print this image' });
  res.json({ url: `/api/images/${image.id}/file?variant=print` });
});

export default router;