import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { resolveDbPath } from '../paths.js';
import { runImport } from '../importer.js';

export const adminRouter = Router();

const upload = multer({
  dest: path.join(os.tmpdir(), 'ranchapp-uploads'),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB
  },
  fileFilter: (_req, file, cb) => {
    if (/\.(xlsx|xlsm)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('only .xlsx / .xlsm files accepted'));
  },
});

/**
 * POST /api/admin/import-xlsx
 * Multipart form with field `file`. Runs the importer against the uploaded file
 * (subprocess) and returns the parsed summary. Cleans up the temp file after.
 */
adminRouter.post('/import-xlsx', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'no file uploaded — expected field "file"' });
    return;
  }
  try {
    const result = await runImport(file.path);
    if (!result.ok) {
      res.status(500).json({
        error: 'importer exited with non-zero status',
        exit_code: result.exit_code,
        stderr: result.stderr.slice(-2000),
        stdout: result.stdout.slice(-2000),
      });
      return;
    }
    res.json({
      ok: true,
      summary: result.summary,
      stdout_tail: result.stdout.slice(-2000),
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  } finally {
    fs.unlink(file.path, () => {
      /* best-effort cleanup */
    });
  }
});

/**
 * GET /api/admin/backup
 * Streams a copy of the current SQLite DB file as an attachment.
 *
 * Uses VACUUM INTO so the backup is a clean, transaction-consistent snapshot
 * rather than copying the file mid-write.
 */
adminRouter.get('/backup', (_req, res) => {
  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    res.status(404).json({ error: 'db not found' });
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const filename = `ranch-${today}.db`;
  const tmp = path.join(os.tmpdir(), `${filename}.${Date.now()}`);
  try {
    // VACUUM INTO requires an open connection; reuse the same singleton.
    import('../db/index.js').then(({ getDb }) => {
      try {
        getDb().prepare(`VACUUM INTO ?`).run(tmp);
        res.download(tmp, filename, (err) => {
          fs.unlink(tmp, () => {});
          if (err) {
            /* response already sent or aborted */
          }
        });
      } catch (e) {
        fs.unlink(tmp, () => {});
        res.status(500).json({ error: (e as Error).message });
      }
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/**
 * GET /api/admin/health
 * Public-ish (auth-gated, but minimal info) — returns DB path and last-touched time.
 */
adminRouter.get('/health', (_req, res) => {
  const dbPath = resolveDbPath();
  let dbExists = false;
  let dbMtime: string | null = null;
  let dbBytes: number | null = null;
  try {
    const stat = fs.statSync(dbPath);
    dbExists = true;
    dbMtime = stat.mtime.toISOString();
    dbBytes = stat.size;
  } catch {
    /* missing */
  }
  res.json({
    db_path: dbPath,
    db_exists: dbExists,
    db_mtime: dbMtime,
    db_bytes: dbBytes,
    node_env: process.env.NODE_ENV ?? 'development',
  });
});
