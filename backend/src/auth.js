import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { db, DATA_DIR } from './db.js';

const SECRET_FILE = path.join(DATA_DIR, '.jwt-secret');
let JWT_SECRET;
if (fs.existsSync(SECRET_FILE)) {
  JWT_SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
} else {
  JWT_SECRET = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(SECRET_FILE, JWT_SECRET, 'utf8');
}

/** scrypt password hashing (Node built-in crypto, no bcrypt dependency) */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

export function verifyPassword(password, saltHex, hashHex) {
  const salt = Buffer.from(saltHex, 'hex');
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, full_name: user.full_name },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

/** Express middleware: resolves the JWT (Authorization header, query ?token=, or X-Access-Token) to a fresh DB user. */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : req.query.token || req.headers['x-access-token'];
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: 'Not authenticated' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
  if (!user || user.status !== 'active') return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  next();
}