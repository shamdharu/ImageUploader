import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const DB_PATH = path.join(DATA_DIR, 'app.db');
export const STORAGE_ROOT = path.join(DATA_DIR, 'storage');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(STORAGE_ROOT, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',           -- admin | manager | contributor | viewer
  status TEXT NOT NULL DEFAULT 'active',        -- active | suspended | pending
  storage_quota_mb INTEGER NOT NULL DEFAULT 250,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,         -- this IS the category "number"
  category_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  owner_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS category_acl (
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (category_id, user_id)
);

CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  original_filename TEXT,
  storage_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width_px INTEGER,
  height_px INTEGER,
  file_size_bytes INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'file_upload',   -- mobile_camera | webcam | file_upload
  exif_data TEXT,
  checksum_hash TEXT NOT NULL,                  -- SHA-256, duplicate detection
  status TEXT NOT NULL DEFAULT 'processing',    -- processing | ready | failed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS image_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  variant_type TEXT NOT NULL,                   -- thumbnail | web | hd | print | original
  width_px INTEGER,
  height_px INTEGER,
  storage_key TEXT NOT NULL,
  UNIQUE (image_id, variant_type)
);

CREATE TABLE IF NOT EXISTS upload_jobs (
  id TEXT PRIMARY KEY,                          -- uuid returned to client immediately
  image_id INTEGER REFERENCES images(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'queued',        -- queued | processing | completed | failed
  progress_percent INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  image_id INTEGER REFERENCES images(id),
  action TEXT NOT NULL,                         -- view | upload | download | print
  resolution_requested TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_images_category ON images(category_id);
CREATE INDEX IF NOT EXISTS idx_images_checksum ON images(checksum_hash);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at);
`;

export function initDb() {
  db.exec(SCHEMA);
}

export function countUsers() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}