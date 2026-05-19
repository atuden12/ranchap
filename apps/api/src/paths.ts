import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Repo root from `apps/api/src/paths.ts` is three levels up.
 * In dev (tsx) and in `dist/` after build, the relative depth is the same.
 */
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

export const MIGRATIONS_DIR = path.join(REPO_ROOT, 'migrations');

/**
 * Per user spec 2026-05-16: DB lives OUTSIDE the repo at
 *   C:\Users\Andrew Uden\Desktop\RanchApp-Data\ranch.db
 * Overridable via RANCHAPP_DB env var for testing / alternate setups.
 */
export function resolveDbPath(): string {
  const fromEnv = process.env.RANCHAPP_DB;
  if (fromEnv && fromEnv.trim()) return fromEnv;
  // Default: ../../RanchApp-Data/ranch.db relative to repo root (sibling on Desktop).
  const defaultPath = path.resolve(REPO_ROOT, '..', 'RanchApp-Data', 'ranch.db');
  return defaultPath;
}

export function ensureDbDir(dbPath: string): void {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
