import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { applyMigrations } from './db/migrate.js';
import { seed } from './db/seed.js';
import { getDb } from './db/index.js';
import { resolveDbPath, REPO_ROOT } from './paths.js';
import { sessionMiddleware, requireAuth, AUTH_ENABLED } from './auth.js';
import { statusRouter } from './routes/status.js';
import { flowRouter } from './routes/flow.js';
import { stockRouter } from './routes/stock.js';
import { weightsRouter } from './routes/weights.js';
import { transactionsRouter } from './routes/transactions.js';
import { feedingRouter } from './routes/feeding.js';
import { budgetRouter } from './routes/budget.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';

const PORT = Number(process.env.PORT ?? 4317);
const isProduction = process.env.NODE_ENV === 'production';

function bootstrap(): void {
  console.log(`[api] DB: ${resolveDbPath()}`);
  console.log(`[api] auth: ${AUTH_ENABLED ? 'ENABLED' : 'OPEN (dev mode)'}`);
  const { applied } = applyMigrations();
  if (applied.length > 0) console.log(`[api] applied ${applied.length} migration(s)`);
  const s = seed();
  if (s.propertiesCreated || s.bandsCreated || s.adgRowsCreated || s.feedTypesCreated) {
    console.log(
      `[api] seeded: properties=+${s.propertiesCreated} bands=+${s.bandsCreated} adg_matrix=+${s.adgRowsCreated} feed_types=+${s.feedTypesCreated}`,
    );
  }
}

bootstrap();
getDb();

const app = express();
// Trust one reverse-proxy hop (Fly.io, Cloudflare Tunnel) so secure cookies work.
app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(sessionMiddleware());

// /api/auth/* is the only route group that doesn't need auth.
app.use('/api/auth', authRouter);

// All other /api/* routes are gated.
app.use('/api', requireAuth);
app.use('/api/status', statusRouter);
app.use('/api/flow', flowRouter);
app.use('/api/stock-on-hand', stockRouter);
app.use('/api/forecasted-weights', weightsRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/feeding', feedingRouter);
app.use('/api/budget', budgetRouter);
app.use('/api/admin', adminRouter);

// In production: serve the built web app from the same origin. Any non-/api
// route falls back to index.html so client-side rendering handles routes.
if (isProduction) {
  const webDist = path.join(REPO_ROOT, 'apps', 'web', 'dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist, { maxAge: '1h' }));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
    console.log(`[api] serving web app from ${webDist}`);
  } else {
    console.warn(`[api] web dist not found at ${webDist} — run npm run build first`);
  }
}

app.listen(PORT, () => {
  console.log(`[api] listening on http://0.0.0.0:${PORT}`);
});
