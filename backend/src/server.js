import express from 'express';
import cors from 'cors';
import { initDb, db, countUsers } from './db.js';
import { requireAuth } from './auth.js';
import { resumePendingJobs } from './services/imageService.js';
import { listAudits } from './services/auditService.js';
import authRoutes from './routes/auth.routes.js';
import categoryRoutes from './routes/categories.routes.js';
import imageRoutes from './routes/images.routes.js';
import { runSeed } from './seed.js';

const app = express();
app.use(cors());
app.use(express.json());

initDb();
if (countUsers() === 0) {
  console.log('[seed] Empty database - running seed with demo data...');
  await runSeed({ withSamples: true });
}

app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/images', imageRoutes);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'image-platform-backend', time: new Date().toISOString() });
});

// Upload job status (polled by the UI while variants are generated)
app.get('/api/jobs/:id', requireAuth, (req, res) => {
  const job = db.prepare(
    `SELECT id, image_id, user_id, status,
            progress_percent AS progressPercent,
            error_message AS errorMessage,
            created_at AS createdAt, finished_at AS finishedAt
     FROM upload_jobs WHERE id = ?`
  ).get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Not your job' });
  }
  res.json({ job });
});

// Basic admin view of the audit log (accountability, Doc 1 / Doc 2)
app.get('/api/admin/audit', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  res.json({ entries: listAudits({ limit: 50 }) });
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Image platform API listening on http://localhost:${PORT}`);
  resumePendingJobs();
});