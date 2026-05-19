#!/usr/bin/env node
import { applyMigrations } from '../db/migrate.js';
import { seed } from '../db/seed.js';
import { resolveDbPath } from '../paths.js';

const dbPath = resolveDbPath();
console.log(`[migrate] DB: ${dbPath}`);

const { applied, skipped } = applyMigrations();
if (applied.length > 0) {
  console.log(`[migrate] applied (${applied.length}):`);
  for (const f of applied) console.log(`  + ${f}`);
}
if (skipped.length > 0) {
  console.log(`[migrate] skipped (${skipped.length}, already applied):`);
  for (const f of skipped) console.log(`  - ${f}`);
}
if (applied.length === 0 && skipped.length === 0) {
  console.log('[migrate] no migration files found');
}

const seedResult = seed();
console.log(
  `[seed] properties=+${seedResult.propertiesCreated} bands=+${seedResult.bandsCreated} adg_matrix=+${seedResult.adgRowsCreated} feed_types=+${seedResult.feedTypesCreated}`,
);

process.exit(0);
