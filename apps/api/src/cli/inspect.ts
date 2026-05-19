#!/usr/bin/env node
/**
 * Diagnostic: prints the first ~5 non-empty rows of every sheet we care about,
 * so we can fix the importer's header matching against reality.
 *
 * Usage:
 *   npm run inspect -- --file ".\import\Stock Flow MASTER 14-1-26.xlsx"
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { WorkSheet } from 'xlsx';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx') as typeof import('xlsx');

const args = process.argv.slice(2);
const fileFlagIdx = args.indexOf('--file');
const rawFile = fileFlagIdx >= 0 ? args[fileFlagIdx + 1] : null;
if (!rawFile) {
  console.error('Usage: npm run inspect -- --file "<path to xlsx>"');
  process.exit(2);
}

function resolveInputPath(input: string): string {
  if (path.isAbsolute(input)) return input;
  const initCwd = process.env.INIT_CWD;
  for (const c of [
    initCwd ? path.resolve(initCwd, input) : null,
    path.resolve(process.cwd(), input),
    path.resolve(process.cwd(), '..', '..', input),
  ].filter((p): p is string => !!p)) {
    if (fs.existsSync(c)) return c;
  }
  return input;
}

const filePath = resolveInputPath(rawFile);
if (!fs.existsSync(filePath)) {
  console.error(`[inspect] file not found: ${filePath}`);
  process.exit(2);
}

const wb = XLSX.readFile(filePath, { cellDates: true });

const DEFAULT_TARGETS = [
  'IN ACT Dump',
  'OUT ACT Dump',
  'BUDIN',
  'OUT',
  'IN EX purch Budget dump',
  'IN Int Transfer Budget dump',
  'Stock on hand',
  'Forecasted Weights',
  'Flow',
  'Feeding',
];

// --target <name> limits the dump to a single sheet (still uses fuzzy match).
const targetFlagIdx = args.indexOf('--target');
const TARGETS =
  targetFlagIdx >= 0 && args[targetFlagIdx + 1] ? [args[targetFlagIdx + 1]!] : DEFAULT_TARGETS;
const singleTarget = targetFlagIdx >= 0;

function dumpRange(sheet: WorkSheet, name: string, maxRows = singleTarget ? 60 : 8): void {
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: false,
    blankrows: false,
  }) as unknown[][];

  console.log('\n========================================');
  console.log(`SHEET: ${name}`);
  console.log(`Total rows: ${matrix.length}`);
  console.log('========================================');

  const sampled: { idx: number; row: unknown[] }[] = [];
  for (let i = 0; i < matrix.length && sampled.length < maxRows; i++) {
    const row = matrix[i] ?? [];
    const nonEmpty = row.filter((c) => c != null && String(c).trim() !== '').length;
    // Default: rows with ≥2 cells. Single-target mode: any non-empty row.
    if (nonEmpty >= (singleTarget ? 1 : 2)) sampled.push({ idx: i, row });
  }

  for (const { idx, row } of sampled) {
    const cells = row.map((c, ci) => {
      const s = c == null ? '' : String(c);
      const truncated = s.length > 30 ? s.slice(0, 27) + '...' : s;
      return `[${ci}]=${JSON.stringify(truncated)}`;
    });
    console.log(`row${idx}: ${cells.join('  ')}`);
  }
}

console.log(`[inspect] file: ${filePath}`);
console.log(`[inspect] all sheets: ${wb.SheetNames.join(' | ')}`);
// Diagnostic: JSON of the raw sheet names so we can spot invisible chars
// (zero-width spaces, trailing whitespace, etc.) that defeat exact matching.
console.log(`[inspect] sheet names (json): ${JSON.stringify(wb.SheetNames)}`);

for (const target of TARGETS) {
  const exactMatch = wb.SheetNames.find((s) => s.toLowerCase() === target.toLowerCase());
  const fuzzyMatch = wb.SheetNames.find((s) =>
    s.toLowerCase().replace(/\s+/g, '').includes(target.toLowerCase().replace(/\s+/g, '')),
  );
  const matched = exactMatch ?? fuzzyMatch;
  console.log(
    `[inspect] target="${target}" exact=${JSON.stringify(exactMatch)} fuzzy=${JSON.stringify(fuzzyMatch)} → ${JSON.stringify(matched)}`,
  );
  if (!matched) {
    console.log(`[inspect] (no sheet matched "${target}")`);
    continue;
  }
  const sheet = wb.Sheets[matched];
  if (!sheet) continue;
  dumpRange(sheet, matched);
}

// For the Flow sheet specifically, dump rows 20-50 since spec says rows 24-26 are
// capacity and 45-46 are rainfall. Skip when targeting a single non-Flow sheet.
const flowName = singleTarget && TARGETS[0]?.toLowerCase() !== 'flow'
  ? undefined
  : wb.SheetNames.find((s) => s.toLowerCase() === 'flow');
if (flowName) {
  const flow = wb.Sheets[flowName];
  if (flow) {
    const matrix = XLSX.utils.sheet_to_json(flow, {
      header: 1,
      defval: null,
      raw: false,
    }) as unknown[][];
    console.log('\n========================================');
    console.log('FLOW SHEET — rows 0-50 (compact: row label + first 6 columns)');
    console.log('========================================');
    for (let i = 0; i < Math.min(matrix.length, 50); i++) {
      const row = matrix[i] ?? [];
      const slice = row.slice(0, 7).map((c) => {
        const s = c == null ? '' : String(c);
        return s.length > 20 ? s.slice(0, 17) + '...' : s;
      });
      console.log(`row${String(i).padStart(2, '0')}: ${JSON.stringify(slice)}`);
    }
  }
}

process.exit(0);
