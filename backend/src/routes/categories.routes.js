import { Router } from 'express';
import fs from 'node:fs';
import { db, STORAGE_ROOT } from '../db.js';
import { requireAuth } from '../auth.js';
import { canManageCategories, canPrint, canUpload, canView } from '../access.js';

const router = Router();

function rowToCategory(c, ac = {}) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM images WHERE category_id = ?').get(c.id).n;
  return {
    id: c.id,
    name: c.category_name,
    owner: ac.ownerName ?? c.owner_name,
    imageCount: count,
    canManage: ac.canManage ?? canManageCategories(ac.user),
    canUpload: ac.canUpload ?? false,
    canPrint: ac.canPrint ?? false,
  };
}

/** Categories the logged-in user is allowed to SEE. */
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT c.*, u.full_name AS owner_name
     FROM categories c JOIN users u ON u.id = c.owner_user_id
     ORDER BY c.id`
  ).all();
  const categories = [];
  for (const c of rows) {
    if (!canView(db, req.user, c)) continue;
    categories.push({
      id: c.id,
      name: c.category_name,
      owner: c.owner_name,
      imageCount: db.prepare('SELECT COUNT(*) AS n FROM images WHERE category_id = ?').get(c.id).n,
      canManage: canManageCategories(req.user),
      canUpload: canUpload(db, req.user, c),
      canPrint: canPrint(db, req.user, c),
    });
  }
  res.json({ categories });
});

/** Create a numbered category folder (admin/manager only). */
router.post('/', requireAuth, (req, res) => {
  if (!canManageCategories(req.user)) return res.status(403).json({ error: 'Only admins and managers can create categories' });
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Category name is required' });

  const info = db.prepare(
    'INSERT INTO categories (category_name, storage_path, owner_user_id) VALUES (?, ?, ?)'
  ).run(name, '', req.user.id);
  const id = info.lastInsertRowid;

  const storagePath = `categories/${id}`;
  fs.mkdirSync(`${STORAGE_ROOT}/${storagePath}`, { recursive: true });
  db.prepare('UPDATE categories SET storage_path = ? WHERE id = ?').run(storagePath, id);

  const c = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  res.status(201).json({ category: rowToCategory(c, { user: req.user, canManage: true, canUpload: true, canPrint: canPrint(db, req.user, c), ownerName: req.user.full_name }) });
});

/** Share a category with another user by email (admin/manager only) - a simple per-category ACL grant. */
router.post('/:id/assign', requireAuth, (req, res) => {
  if (!canManageCategories(req.user)) return res.status(403).json({ error: 'Only admins and managers can assign users' });
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(req.params.id));
  if (!category) return res.status(404).json({ error: 'Category not found' });

  const email = String(req.body?.email || '').toLowerCase().trim();
  const target = email ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) : null;
  if (!target) return res.status(404).json({ error: `No user with email "${email}"` });

  db.prepare('INSERT OR IGNORE INTO category_acl (category_id, user_id) VALUES (?, ?)').run(category.id, target.id);
  res.json({ ok: true, message: `${target.full_name} can now access category ${category.id}` });
});

export default router;