import { db } from '../db.js';

/** Append-only audit record (Doc 2, 2.8). node:sqlite rejects undefined, so default to null. */
export function recordAudit({ userId, imageId = null, action, resolution = null, ipAddress }) {
  db.prepare(
    `INSERT INTO audit_log (user_id, image_id, action, resolution_requested, ip_address)
     VALUES (?, ?, ?, ?, ?)`
  ).run(userId, imageId, action, resolution, String(ipAddress ?? '').slice(0, 45));
}

export function listAudits({ limit = 20 } = {}) {
  return db.prepare(
    `SELECT a.id, a.action, a.resolution_requested, a.ip_address, a.created_at,
            u.email AS user_email, i.category_id
     FROM audit_log a
     JOIN users u ON u.id = a.user_id
     LEFT JOIN images i ON i.id = a.image_id
     ORDER BY a.id DESC
     LIMIT ?`
  ).all(limit);
}