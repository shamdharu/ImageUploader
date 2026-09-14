import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { initDb, db, STORAGE_ROOT } from './db.js';
import { hashPassword } from './auth.js';
import { inspect, sha256, extForFormat, resolveStorage, storageKeyFor, processImage } from './services/imageService.js';

async function sampleBuffer(title, c1, c2) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
    </linearGradient></defs>
    <rect width="1600" height="1067" fill="url(#g)"/>
    <circle cx="1150" cy="380" r="180" fill="rgba(255,255,255,0.15)"/>
    <circle cx="430" cy="720" r="260" fill="rgba(255,255,255,0.10)"/>
    <text x="800" y="540" font-family="Arial, sans-serif" font-size="72" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${title}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

async function ingest(buffer, filename, categoryId, userId, source, jobsCounter) {
  const meta = await inspect(buffer);
  const checksum = sha256(buffer);
  const ext = extForFormat(meta.format);
  const imageId = db.prepare(
    `INSERT INTO images (category_id, uploaded_by, original_filename, storage_key, mime_type,
                         width_px, height_px, file_size_bytes, source, exif_data, checksum_hash, status)
     VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, 'processing')`
  ).run(categoryId, userId, filename, meta.mime, meta.width, meta.height,
        buffer.byteLength, source, JSON.stringify({ orientation: meta.orientation }), checksum).lastInsertRowid;

  const rel = storageKeyFor(categoryId, 'originals', imageId, ext);
  const abs = resolveStorage(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  await fs.promises.writeFile(abs, buffer);
  db.prepare('UPDATE images SET storage_key = ? WHERE id = ?').run(rel, imageId);

  const jobId = crypto.randomUUID();
  db.prepare(
    "INSERT INTO upload_jobs (id, image_id, user_id, status, progress_percent) VALUES (?, ?, ?, 'queued', 0)"
  ).run(jobId, imageId, userId);
  await processImage(imageId); // seed waits so samples are ready immediately
  jobsCounter.completed++;
  return imageId;
}

export async function runSeed({ withSamples = true } = {}) {
  initDb();

  const demoUsers = [
    { name: 'Admin Olivia',    email: 'admin@demo.io',       password: 'admin123',       role: 'admin' },
    { name: 'Manager Marcus',  email: 'manager@demo.io',     password: 'manager123',     role: 'manager' },
    { name: 'Contributor Carla', email: 'contributor@demo.io', password: 'contributor123', role: 'contributor' },
    { name: 'Viewer Victor',   email: 'viewer@demo.io',      password: 'viewer123',      role: 'viewer' },
  ];
  const uid = {};
  for (const u of demoUsers) {
    const { salt, hash } = hashPassword(u.password);
    db.prepare(
      'INSERT OR IGNORE INTO users (full_name, email, password_hash, password_salt, role) VALUES (?, ?, ?, ?, ?)'
    ).run(u.name, u.email, hash, salt, u.role);
    uid[u.role] = db.prepare('SELECT id FROM users WHERE email = ?').get(u.email).id;
  }

  db.prepare(
    'INSERT OR IGNORE INTO categories (id, category_name, storage_path, owner_user_id) VALUES (?, ?, ?, ?)'
  ).run(1001, 'Product Shots', 'categories/1001', uid.admin);
  db.prepare(
    'INSERT OR IGNORE INTO categories (id, category_name, storage_path, owner_user_id) VALUES (?, ?, ?, ?)'
  ).run(1002, 'Event Photos', 'categories/1002', uid.manager);

  for (const id of [1001, 1002]) fs.mkdirSync(`${STORAGE_ROOT}/categories/${id}`, { recursive: true });

  // ACL grants so every demo role can see something (Doc 1 - per-category ACL)
  db.prepare('INSERT OR IGNORE INTO category_acl (category_id, user_id) VALUES (?, ?)').run(1001, uid.manager);      // manager assigned to 1001
  db.prepare('INSERT OR IGNORE INTO category_acl (category_id, user_id) VALUES (?, ?)').run(1001, uid.viewer);      // viewer sees 1001
  db.prepare('INSERT OR IGNORE INTO category_acl (category_id, user_id) VALUES (?, ?)').run(1002, uid.contributor); // contributor works 1002
  db.prepare('INSERT OR IGNORE INTO category_acl (category_id, user_id) VALUES (?, ?)').run(1001, uid.contributor); // contributor also sees 1001

  const jobs = { completed: 0 };
  if (withSamples) {
    const samples = [
      { cat: 1001, user: uid.admin,     file: 'sample-vintage-camera.jpg',  buf: await sampleBuffer('Vintage Camera', '#7a2cff', '#ffb84d') },
      { cat: 1001, user: uid.admin,     file: 'sample-racing-sneaker.jpg',  buf: await sampleBuffer('Racing Sneaker', '#0ea5e9', '#22c55e') },
      { cat: 1001, user: uid.contributor, file: 'sample-contributor-shot.jpg', buf: await sampleBuffer('Contributor Shot', '#eab308', '#f97316') },
      { cat: 1002, user: uid.manager,   file: 'sample-summer-concert.jpg',  buf: await sampleBuffer('Summer Concert', '#ef4444', '#8b5cf6') },
    ];
    for (const s of samples) {
      await ingest(s.buf, s.file, s.cat, s.user, 'file_upload', jobs);
    }
  }

  console.log('Seed complete.');
  console.log(`  Users: ${demoUsers.length} (admin/manager/contributor/viewer @ demo.io - see README for passwords)`);
  console.log(`  Categories: 1001 Product Shots, 1002 Event Photos`);
  console.log(`  Sample images processed: ${jobs.completed}`);
}

// Allows `npm run seed` as well as import from server.js
const isMain = typeof import.meta.main !== 'undefined' ? import.meta.main : process.argv[1] === 'seed';
if (isMain) {
  await runSeed();
}