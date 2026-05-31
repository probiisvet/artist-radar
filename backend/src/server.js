import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initDb } from './db/database.js';
import artistsRouter from './routes/artists.js';
import toursRouter from './routes/tours.js';
import categoriesRouter from './routes/categories.js';
import diagnosticRouter from './routes/diagnostic.js';
import { startScheduler } from './jobs/scheduler.js';
import { runRefresh } from './jobs/refresh.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 4000);

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.use('/api/artists', artistsRouter);
app.use('/api/tours', toursRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/diagnostic', diagnosticRouter);

// POST /api/refresh — dashboard button. Runs synchronously and returns the
// full summary so the UI can show "refreshed N artists, +X tours…".
app.post('/api/refresh', async (req, res, next) => {
  try {
    // If the body specifies phases, run only those (separate dashboard buttons:
    // refresh artists / discover new / refresh tours). Otherwise run everything.
    const phases = req.body?.phases;
    const summary = await runRefresh(
      phases
        ? { phases }
        : { skipDiscovery: req.body?.skipDiscovery === true },
    );
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// GET /api/refresh — external cron pingers (cron-job.org sends GET by default).
// A full refresh takes minutes — far longer than a cron pinger's ~30s timeout —
// so we kick it off in the background and respond 202 immediately. This avoids
// the "Failed (timeout)" status while the refresh still completes server-side.
app.get('/api/refresh', (req, res) => {
  res.status(202).json({ started: true, at: new Date().toISOString() });
  runRefresh()
    .then((summary) => console.log('[cron-http] refresh complete', summary))
    .catch((err) => console.error('[cron-http] refresh failed:', err));
});

// In production we ship a single web service: Express also serves the
// built React app from frontend/dist. In dev, that folder doesn't exist
// and Vite handles the frontend on its own port, so this block is a no-op.
const distPath = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(distPath)) {
  console.log(`[server] serving frontend from ${distPath}`);
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// JSON error handler – keeps API responses consistent.
app.use((err, _req, res, _next) => {
  console.error('[api error]', err);
  res.status(500).json({ error: err.message ?? 'internal error' });
});

// Init DB first, then start server
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[server] Artist Radar listening on port ${PORT}`);
      startScheduler();
    });
  })
  .catch((err) => {
    console.error('[server] DB init failed:', err);
    process.exit(1);
  });
