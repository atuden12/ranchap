import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './index.js';
import { MIGRATIONS_DIR } from '../paths.js';

interface MigrationFile {
  filename: string;
  fullPath: string;
}

function listMigrations(): MigrationFile[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((filename) => ({ filename, fullPath: path.join(MIGRATIONS_DIR, filename) }));
}

export function applyMigrations(): { applied: string[]; skipped: string[] } {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_history (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const applied: string[] = [];
  const skipped: string[] = [];

  const isApplied = db.prepare('SELECT 1 FROM migration_history WHERE filename = ?');
  const recordApplied = db.prepare('INSERT INTO migration_history (filename) VALUES (?)');

  for (const m of listMigrations()) {
    if (isApplied.get(m.filename)) {
      skipped.push(m.filename);
      continue;
    }
    const sql = fs.readFileSync(m.fullPath, 'utf8');
    const run = db.transaction(() => {
      db.exec(sql);
      recordApplied.run(m.filename);
    });
    run();
    applied.push(m.filename);
  }

  return { applied, skipped };
}
