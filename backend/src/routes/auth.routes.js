import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, signToken, verifyPassword } from '../auth.js';
import { recordAudit } from '../services/auditService.js';

const router = Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase().trim());
  if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (user.status !== 'active') return res.status(403).json({ error: `Account is ${user.status}` });

  recordAudit({ userId: user.id, action: 'login', resolution: null, ipAddress: req.ip });
  res.json({
    token: signToken(user),
    user: { id: user.id, fullName: user.full_name, email: user.email, role: user.role },
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id, fullName: req.user.full_name, email: req.user.email, role: req.user.role } });
});

export default router;