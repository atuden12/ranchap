#!/usr/bin/env node
import { seed } from '../db/seed.js';
import { resolveDbPath } from '../paths.js';

console.log(`[seed] DB: ${resolveDbPath()}`);
const result = seed();
console.log(
  `[seed] properties=+${result.propertiesCreated} bands=+${result.bandsCreated} adg_matrix=+${result.adgRowsCreated}`,
);
process.exit(0);
