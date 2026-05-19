#!/usr/bin/env node
/**
 * One-shot importer for Stock_Flow_MASTER*.xlsx.
 *
 * Usage:
 *   npm run import -- --file "C:\path\to\Stock_Flow_MASTER_14-1-26.xlsx"
 *
 * Idempotent: re-running won't duplicate rows.
 *   - Transactions are deduped on (txn_number, livestock_class, type, source)
 *   - Animals are deduped on eid
 *   - Mobs / paddocks are deduped on name
 *
 * Treats the importer as throwaway-ish: logs everything it skipped or couldn't parse,
 * so you can eyeball the input file and decide whether the skips matter.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { WorkBook, WorkSheet } from 'xlsx';
import { applyMigrations } from '../db/migrate.js';

// xlsx (SheetJS) exposes its API via the CommonJS namespace; ESM `import *`
// doesn't surface readFile/utils on Node 22+. Use createRequire as the canonical
// workaround (recommended in SheetJS docs for ESM consumers).
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const XLSX = require('xlsx') as typeof import('xlsx');
import { seed } from '../db/seed.js';
import { getDb } from '../db/index.js';
import { resolveDbPath } from '../paths.js';
import { LIVESTOCK_CLASSES, type LivestockClass } from '@ranchapp/shared';

interface ImportSummary {
  transactions: { imported: number; duplicate_skipped: number; parse_errors: number };
  paddocks: { imported: number; existing: number };
  mobs: { imported: number; existing: number };
  animals: { imported: number; existing: number; parse_errors: number };
  weight_observations: { imported: number; duplicate_skipped: number };
  capacity_overrides: { imported: number };
  rainfall: { imported: number };
  opening_balances_imported: number;
  feed_events_imported: number;
  warnings: string[];
  unmatched_sheets: string[];
}

const args = process.argv.slice(2);
const fileFlagIdx = args.indexOf('--file');
const rawFilePath =
  fileFlagIdx >= 0 ? args[fileFlagIdx + 1] : args.find((a) => a.endsWith('.xlsx')) ?? null;

if (!rawFilePath) {
  console.error('Usage: npm run import -- --file "C:\\path\\to\\Stock_Flow_MASTER.xlsx"');
  process.exit(2);
}

/**
 * Relative paths should resolve from where the user invoked npm, not from the
 * workspace folder npm changes into. `INIT_CWD` is the env var npm sets to
 * track the original cwd.
 */
function resolveInputPath(input: string): string {
  if (path.isAbsolute(input)) return input;
  const initCwd = process.env.INIT_CWD;
  const candidates = [
    initCwd ? path.resolve(initCwd, input) : null,
    path.resolve(process.cwd(), input),
    path.resolve(process.cwd(), '..', '..', input), // workspace -> repo root fallback
  ].filter((p): p is string => !!p);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0]!; // give the user a useful error path
}

const filePath = resolveInputPath(rawFilePath);

if (!fs.existsSync(filePath)) {
  console.error(`[import] file not found: ${filePath}`);
  console.error(`[import] (raw arg: ${rawFilePath})`);
  console.error(`[import] (INIT_CWD: ${process.env.INIT_CWD ?? 'unset'})`);
  process.exit(2);
}

console.log(`[import] DB: ${resolveDbPath()}`);
console.log(`[import] reading: ${filePath}`);

applyMigrations();
seed();

const workbook = XLSX.readFile(filePath, { cellDates: true });
console.log(`[import] sheets: ${workbook.SheetNames.join(', ')}`);

const db = getDb();
const summary: ImportSummary = {
  transactions: { imported: 0, duplicate_skipped: 0, parse_errors: 0 },
  paddocks: { imported: 0, existing: 0 },
  mobs: { imported: 0, existing: 0 },
  animals: { imported: 0, existing: 0, parse_errors: 0 },
  weight_observations: { imported: 0, duplicate_skipped: 0 },
  capacity_overrides: { imported: 0 },
  rainfall: { imported: 0 },
  opening_balances_imported: 0,
  feed_events_imported: 0,
  warnings: [],
  unmatched_sheets: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findSheet(workbook: WorkBook, name: string): WorkSheet | null {
  // Exact name match wins over substring — otherwise target "OUT" hits "OUT ACT Dump" first.
  const exact = workbook.SheetNames.find((s) => s.toLowerCase() === name.toLowerCase());
  if (exact) return workbook.Sheets[exact] ?? null;
  const fuzzy = workbook.SheetNames.find((s) =>
    s.toLowerCase().replace(/\s+/g, '').includes(name.toLowerCase().replace(/\s+/g, '')),
  );
  return fuzzy ? workbook.Sheets[fuzzy] ?? null : null;
}

function sheetToRowsAtHeader(
  sheet: WorkSheet,
  headerRowIdx: number,
): Record<string, unknown>[] {
  // sheet_to_json with the `range` option lets us pick a header row that isn't row 0.
  return XLSX.utils.sheet_to_json(sheet, {
    defval: null,
    raw: false,
    range: headerRowIdx,
  });
}

function sheetToRows(sheet: WorkSheet): Record<string, unknown>[] {
  return XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });
}

function sheetToMatrix(sheet: WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false }) as unknown[][];
}

function pick(row: Record<string, unknown>, candidates: string[]): unknown {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const key = keys.find((k) => k.toLowerCase().replace(/[\s_\-]/g, '') ===
      c.toLowerCase().replace(/[\s_\-]/g, ''));
    if (key) return row[key];
  }
  // partial match fallback
  for (const c of candidates) {
    const norm = c.toLowerCase().replace(/[\s_\-]/g, '');
    const key = keys.find((k) =>
      k.toLowerCase().replace(/[\s_\-]/g, '').includes(norm),
    );
    if (key) return row[key];
  }
  return null;
}

function asString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function asNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function asInt(v: unknown): number | null {
  const n = asNumber(v);
  return n == null ? null : Math.round(n);
}

/** Reject anything outside a plausible cattle-ops year window. Stops malformed
 *  cells (Excel quirks, two-digit year ambiguity, stray numbers parsed as dates)
 *  from polluting the DB with year 0001 or 9629 entries. */
function isPlausibleYear(year: number): boolean {
  return year >= 1990 && year <= 2100;
}

function asIsoDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    const year = v.getFullYear();
    if (!isPlausibleYear(year)) return null;
    return v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  // try DD/MM/YYYY (Australian default in the spreadsheet)
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    const year = yyyy!.length === 2 ? Number(yyyy) + 2000 : Number(yyyy);
    if (isPlausibleYear(year)) {
      const d = new Date(year, Number(mm) - 1, Number(dd));
      if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime()) && isPlausibleYear(parsed.getFullYear())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function normalizeLivestockClass(v: unknown): LivestockClass | null {
  const s = asString(v);
  if (!s) return null;
  const normalized = s.toLowerCase().replace(/[\s\-]+/g, '_');
  if ((LIVESTOCK_CLASSES as readonly string[]).includes(normalized)) {
    return normalized as LivestockClass;
  }
  return null;
}

function getPropertyId(name: string): number {
  const row = db.prepare('SELECT id FROM property WHERE name = ?').get(name) as
    | { id: number }
    | undefined;
  if (!row) throw new Error(`property "${name}" missing — seed should have created it`);
  return row.id;
}

// ---------------------------------------------------------------------------
// Transactions (4 sheets)
// ---------------------------------------------------------------------------

/** Sheet shape — actuals dumps use row 0 headers; forecast (BUDIN/OUT) start at row 1. */
type TxnSheetShape = 'actual-dump' | 'budin' | 'forecast-out';

function importTransactionsSheet(
  sheetName: string,
  type: 'IN' | 'OUT',
  source: 'Actual' | 'Forecast',
  shape: TxnSheetShape = 'actual-dump',
): void {
  const sheet = findSheet(workbook, sheetName);
  if (!sheet) {
    summary.warnings.push(`Transaction sheet not found: "${sheetName}"`);
    return;
  }
  const headerRow = shape === 'actual-dump' ? 0 : 1;
  const rows = sheetToRowsAtHeader(sheet, headerRow);

  // For sheets where one of the meaningful columns has a blank header
  // (BUDIN's column [4] holds cattle class), grab the raw matrix as fallback.
  const matrix = sheetToMatrix(sheet);

  // Plain INSERT — wipe-and-replace at import start means we never see dupes.
  // (Migration 0002 dropped the prior partial unique index which was too narrow.)
  const insert = db.prepare(`
    INSERT INTO transaction_event
      (txn_number, date, type, owner, contract, herd, livestock_class,
       head_count, description, origin_destination, sale_purchase_type, notes, source)
    VALUES (@txn_number, @date, @type, @owner, @contract, @herd, @livestock_class,
            @head_count, @description, @origin_destination, @sale_purchase_type, @notes, @source)
  `);

  const run = db.transaction((rs: typeof rows) => {
    rs.forEach((r, rowIdx) => {
      const date = asIsoDate(
        pick(r, ['date', 'Date', 'Txn Date', 'Transaction Date', 'Truck Date', 'Month']),
      );
      // Header names observed: "#hd" (actual dumps), "No. Head" (BUDIN/Budget dumps)
      const head_count = asInt(
        pick(r, ['#hd', 'No. Head', 'head', 'Head', 'Count', 'Head Count', 'No.', 'Qty', 'NoHead']),
      );
      if (!date || head_count == null) {
        summary.transactions.parse_errors++;
        return;
      }

      // BUDIN-style sheets have an unlabeled column [4] holding the cattle class.
      // Use the raw matrix as a fallback when the header-based pick returns nothing.
      let livestockClassRaw = pick(r, [
        'livestock_class',
        'Livestock Class',
        'Cattle Class',
        'Cattle Category',
        'Class',
        'Category',
      ]);
      if (shape !== 'actual-dump' && livestockClassRaw == null) {
        const matrixRow = matrix[rowIdx + headerRow + 1];
        if (matrixRow) livestockClassRaw = matrixRow[4];
      }

      const params = {
        txn_number: asString(
          pick(r, ['txn_number', 'Transaction #', 'Txn No', 'Txn #', 'Transaction No', 'Number']),
        ),
        date,
        type,
        owner: asString(pick(r, ['owner', 'Owner', 'Sending Station', 'From'])),
        contract: asString(pick(r, ['contract', 'Contract'])),
        herd: asString(pick(r, ['herd', 'Herd', 'Breed', 'Market'])),
        livestock_class: normalizeLivestockClass(livestockClassRaw),
        head_count,
        description: asString(pick(r, ['description', 'Description', 'Desc'])),
        origin_destination: asString(
          pick(r, [
            'origin_destination',
            'Origin',
            'Destination',
            'Origin/Destination',
            'From',
            'To',
            'Receiving Property',
          ]),
        ),
        sale_purchase_type: asString(
          pick(r, ['sale_purchase_type', 'Sale Type', 'Purchase Type', 'Sale/Purchase Type', 'Type']),
        ),
        notes: asString(pick(r, ['notes', 'Notes', 'Comment', 'Comments'])),
        source,
      };

      try {
        insert.run(params);
        summary.transactions.imported++;
      } catch (e) {
        summary.transactions.parse_errors++;
        summary.warnings.push(`[${sheetName}] insert failed: ${(e as Error).message}`);
      }
    });
  });

  run(rows);
  console.log(
    `[import] ${sheetName} (${type}/${source}): ${rows.length} rows scanned, imported so far ${summary.transactions.imported}, dedupe-skipped ${summary.transactions.duplicate_skipped}, parse errors ${summary.transactions.parse_errors}`,
  );
}

// ---------------------------------------------------------------------------
// Stock on hand → paddocks + mobs
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Budget dump sheets — primary source for Forecast IN transactions (with cost
// data). Replaces BUDIN which is a redundant summary. Each dump produces
// transaction_event rows with price_per_kg, freight, total_cost populated.
// ---------------------------------------------------------------------------

function asMoney(v: unknown): number | null {
  // "$5.20 " / "$275,310.00 " / " FALSE " etc. — strip currency, commas, whitespace.
  if (v == null) return null;
  const s = String(v).trim();
  if (s === '' || s === '-' || /^false$/i.test(s)) return null;
  const cleaned = s.replace(/[$,\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function importExtPurchaseBudget(): void {
  const sheet = findSheet(workbook, 'IN EX purch Budget dump');
  if (!sheet) {
    summary.warnings.push('Sheet "IN EX purch Budget dump" not found');
    return;
  }
  const matrix = sheetToMatrix(sheet);

  const insert = db.prepare(`
    INSERT INTO transaction_event
      (txn_number, date, type, owner, contract, herd, livestock_class,
       head_count, description, origin_destination, sale_purchase_type,
       notes, source, avg_weight_kg, price_per_kg, freight, total_cost)
    VALUES (NULL, ?, 'IN', NULL, NULL, ?, ?, ?, ?, ?, 'External Purchase',
            ?, 'Forecast', ?, ?, ?, ?)
  `);

  // Header is at row 0. Data starts row 1.
  // [0] EXpur tag, [1] Month, [2] Cattle Category, [3] Breed, [4] No. Head,
  // [5] Kg/Head, [6] Total Kg, [7] $/Kg, [8] Freight, [9] Total Costs,
  // [10] P&L?, [11] Notes
  let imported = 0;
  let parseErrors = 0;
  const tx = db.transaction(() => {
    for (let i = 1; i < matrix.length; i++) {
      const row = matrix[i] ?? [];
      const date = asIsoDate(row[1]);
      const head = asInt(row[4]);
      if (!date || head == null || head === 0) {
        if (row[1] || row[4]) parseErrors++; // only count rows that looked intended
        continue;
      }
      const livestock_class = normalizeLivestockClass(row[2]);
      const breed = asString(row[3]); // "Hancock_Commercial", "2GR_F1"
      const avg_weight = asNumber(row[5]);
      const price_per_kg = asMoney(row[7]);
      const freight = asMoney(row[8]);
      const total_cost = asMoney(row[9]);
      const notes = asString(row[11]);

      try {
        insert.run(
          date,
          breed,                        // herd column captures breed/market label
          livestock_class,
          head,
          notes,                        // description
          breed,                        // origin_destination
          notes,                        // notes (also)
          avg_weight,
          price_per_kg,
          freight,
          total_cost,
        );
        imported++;
      } catch (e) {
        parseErrors++;
        summary.warnings.push(`[IN EX purch] insert failed: ${(e as Error).message}`);
      }
    }
  });
  tx();
  console.log(
    `[import] IN EX purch Budget dump (IN/Forecast): imported ${imported}, parse errors ${parseErrors}`,
  );
  summary.transactions.imported += imported;
  summary.transactions.parse_errors += parseErrors;
}

function importIntTransferBudget(): void {
  const sheet = findSheet(workbook, 'IN Int Transfer Budget dump');
  if (!sheet) {
    summary.warnings.push('Sheet "IN Int Transfer Budget dump" not found');
    return;
  }
  const matrix = sheetToMatrix(sheet);

  const insert = db.prepare(`
    INSERT INTO transaction_event
      (txn_number, date, type, owner, contract, herd, livestock_class,
       head_count, description, origin_destination, sale_purchase_type,
       notes, source, avg_weight_kg, price_per_kg, freight, total_cost)
    VALUES (NULL, ?, 'IN', ?, NULL, ?, ?, ?, NULL, ?, 'Internal Transfer',
            NULL, 'Forecast', ?, ?, ?, ?)
  `);

  // Header at row 0. Data starts row 1.
  // [0] Type, [1] Sending Station, [2] Receiving Property, [3] Month,
  // [4] Cattle Class, [5] Breed, [6] No. Head, [7] $/Kg, [8] Kg/Hd,
  // [9] Total Kg, [10] Total $, [11] Freight
  let imported = 0;
  let parseErrors = 0;
  const tx = db.transaction(() => {
    for (let i = 1; i < matrix.length; i++) {
      const row = matrix[i] ?? [];
      const date = asIsoDate(row[3]);
      const head = asInt(row[6]);
      if (!date || head == null || head === 0) {
        if (row[3] || row[6]) parseErrors++;
        continue;
      }
      const sending = asString(row[1]);
      const receiving = asString(row[2]);
      const livestock_class = normalizeLivestockClass(row[4]);
      const breed = asString(row[5]);
      const avg_weight = asNumber(row[8]);
      const price_per_kg = asMoney(row[7]);
      const total_cost = asMoney(row[10]);
      const freight = asMoney(row[11]);

      try {
        insert.run(
          date,
          sending,                      // owner — origin station
          breed,                        // herd
          livestock_class,
          head,
          receiving,                    // origin_destination — receiving station
          avg_weight,
          price_per_kg,
          freight,
          total_cost,
        );
        imported++;
      } catch (e) {
        parseErrors++;
        summary.warnings.push(`[IN Int Transfer] insert failed: ${(e as Error).message}`);
      }
    }
  });
  tx();
  console.log(
    `[import] IN Int Transfer Budget dump (IN/Forecast): imported ${imported}, parse errors ${parseErrors}`,
  );
  summary.transactions.imported += imported;
  summary.transactions.parse_errors += parseErrors;
}

// ---------------------------------------------------------------------------
// Legacy OUT sheet — chronological feedlot-delivery log with fixed columns
// Structure differs significantly from BUDIN; needs its own parser.
//   [0] month abbreviation (Jan-23)
//   [1] feedlot / destination
//   [2] head count
//   [4] A/F marker (we still tag everything as Forecast per spec)
//   [6] description
//   [7] detailed date
// ---------------------------------------------------------------------------

function importOutLegacy(): void {
  const sheet = findSheet(workbook, 'OUT');
  if (!sheet) {
    summary.warnings.push('Sheet "OUT" not found');
    return;
  }
  const matrix = sheetToMatrix(sheet);

  const insert = db.prepare(`
    INSERT INTO transaction_event
      (txn_number, date, type, owner, contract, herd, livestock_class,
       head_count, description, origin_destination, sale_purchase_type, notes, source)
    VALUES (NULL, @date, 'OUT', NULL, NULL, NULL, NULL,
            @head_count, @description, @origin_destination, NULL, NULL, 'Forecast')
  `);

  const MONTH_NAMES: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  // Data begins on row 2 (row 1 is the irregular header).
  const tx = db.transaction(() => {
    for (let i = 2; i < matrix.length; i++) {
      const row = matrix[i] ?? [];
      const head_count = asInt(row[2]);
      if (head_count == null || head_count === 0) continue; // skip blanks silently

      let date = asIsoDate(row[7]);
      if (!date) {
        const monthAbbr = asString(row[0]);
        const m = monthAbbr?.match(/^([A-Za-z]{3})-(\d{2})$/);
        if (m) {
          const monthIdx = MONTH_NAMES[m[1]!.toLowerCase()];
          if (monthIdx !== undefined) {
            const d = new Date(2000 + Number(m[2]), monthIdx, 1);
            date = d.toISOString().slice(0, 10);
          }
        }
      }
      if (!date) {
        summary.transactions.parse_errors++;
        continue;
      }

      const description = asString(row[6]);
      const origin_destination = asString(row[1]);
      try {
        insert.run({ date, head_count, description, origin_destination });
        summary.transactions.imported++;
      } catch (e) {
        summary.transactions.parse_errors++;
        summary.warnings.push(`[OUT] insert failed: ${(e as Error).message}`);
      }
    }
  });

  tx();
  console.log(
    `[import] OUT (OUT/Forecast — legacy): imported total ${summary.transactions.imported}, parse errors ${summary.transactions.parse_errors}`,
  );
}

function importStockOnHand(): void {
  const sheet = findSheet(workbook, 'Stock on hand');
  if (!sheet) {
    summary.warnings.push('Sheet "Stock on hand" not found');
    return;
  }
  const matrix = sheetToMatrix(sheet);

  // Column layout observed in Stock_Flow_MASTER (no usable header — section
  // labels span multiple top rows). Real data rows always have:
  //   [0] = paddock name
  //   [2] = mob/status text
  //   [3] = numeric head count
  const COL = {
    PADDOCK: 0,
    MOB: 2,
    HEAD: 3,
  } as const;

  // The sheet currently only contains Sundown data (row 0 cell 0 says
  // "Property : Sundown"). Warabah not present — flagged in import summary.
  let propertyId: number;
  try {
    propertyId = getPropertyId('Sundown');
  } catch {
    summary.warnings.push('Cannot import Stock on hand: Sundown property missing');
    return;
  }

  const headerCell = String(matrix[0]?.[0] ?? '');
  if (!headerCell.toLowerCase().includes('sundown')) {
    summary.warnings.push(
      `Stock on hand: expected Sundown header in row 0; saw "${headerCell}". Importing under Sundown anyway.`,
    );
  }

  const findPaddock = db.prepare(
    'SELECT id FROM paddock WHERE property_id = ? AND name = ?',
  );
  const insertPaddock = db.prepare(
    'INSERT INTO paddock (property_id, name, normal_capacity_head, current_status) VALUES (?, ?, ?, ?)',
  );
  const findMob = db.prepare('SELECT id FROM mob WHERE name = ?');
  const insertMob = db.prepare(
    'INSERT INTO mob (name, breed_type, market_class, owner, paddock_id) VALUES (?, ?, ?, ?, ?)',
  );

  const tx = db.transaction(() => {
    // Skip the title/header rows; the first paddock row is around index 4 but
    // we scan from 2 to be safe.
    for (let i = 2; i < matrix.length; i++) {
      const row = matrix[i] ?? [];
      const paddockName = asString(row[COL.PADDOCK]);
      const head = asInt(row[COL.HEAD]);
      if (!paddockName || head == null || head <= 0) continue;

      // Skip section banners — they have a paddock-shaped col0 but no head count.
      const mobText = asString(row[COL.MOB]);

      let paddockId: number;
      const existingPaddock = findPaddock.get(propertyId, paddockName) as
        | { id: number }
        | undefined;
      if (existingPaddock) {
        paddockId = existingPaddock.id;
        summary.paddocks.existing++;
      } else {
        const res = insertPaddock.run(propertyId, paddockName, null, null);
        paddockId = Number(res.lastInsertRowid);
        summary.paddocks.imported++;
      }

      if (mobText) {
        // Use raw mob name so Forecasted Weights animals can match it. If the
        // same description appears in multiple paddocks, the first one wins —
        // mob.paddock_id reflects current location.
        const existingMob = findMob.get(mobText) as { id: number } | undefined;
        if (existingMob) {
          summary.mobs.existing++;
        } else {
          const breedMatch = mobText.match(/\b(FB|F1|PB)\b/i);
          const breed = breedMatch ? breedMatch[1]!.toUpperCase() : null;
          const marketMatch = mobText.match(/\b(EUHQB|Non[- ]?EU|EU|Feeder)\b/i);
          const marketClass = marketMatch ? marketMatch[1] : null;
          insertMob.run(mobText, breed, marketClass, null, paddockId);
          summary.mobs.imported++;
        }
      }
    }
  });

  tx();
}

// ---------------------------------------------------------------------------
// Forecasted Weights → animals + weight_observations
// ---------------------------------------------------------------------------

function importForecastedWeights(): void {
  const sheet = findSheet(workbook, 'Forecasted Weights');
  if (!sheet) {
    summary.warnings.push('Sheet "Forecasted Weights" not found');
    return;
  }
  const matrix = sheetToMatrix(sheet);

  // Header row is index 7 (rows 0-6 are scattered annotation/decoration cells).
  // Per spec: column 8 (1-indexed) = date → matrix[7] index 7; column 9 = weight → index 8.
  // Header cells: [0]Visual Id [1]Sex [2]Mob [3]Paddock [4]EID [5]Owner [6]Livestock Class
  //               [7]Date(Weight) [8]Weight(Weight)
  const HEADER_ROW_IDX = 7;
  const rows = sheetToRowsAtHeader(sheet, HEADER_ROW_IDX);

  const findAnimalByEid = db.prepare('SELECT id FROM animal WHERE eid = ?');
  const findMobByName = db.prepare('SELECT id FROM mob WHERE name = ?');
  const insertAnimal = db.prepare(`
    INSERT INTO animal
      (visual_id, eid, sex, mob_id, owner, livestock_class,
       current_weight, last_weight_date, adg, target_exit_weight, exit_market_category)
    VALUES (@visual_id, @eid, @sex, @mob_id, @owner, @livestock_class,
            @current_weight, @last_weight_date, @adg, @target_exit_weight, @exit_market_category)
  `);
  const insertObs = db.prepare(`
    INSERT INTO weight_observation (animal_id, date, weight_kg) VALUES (?, ?, ?)
    ON CONFLICT(animal_id, date) DO NOTHING
  `);

  const tx = db.transaction((rs: typeof rows) => {
    rs.forEach((r, idx) => {
      // Raw matrix row for this data row — data starts at matrix[HEADER_ROW_IDX + 1].
      const rawMatrix = matrix[HEADER_ROW_IDX + 1 + idx] ?? [];

      const eid = asString(pick(r, ['EID', 'eid', 'NLIS', 'RFID']));
      const visual_id = asString(pick(r, ['Visual Id', 'visual', 'Visual ID', 'Tag', 'VID']));

      // Date(Weight) and Weight(Weight) live at columns [7] and [8] respectively.
      let lastWeight = asNumber(
        pick(r, ['Weight(Weight)', 'Weight', 'current weight', 'Last Weight', 'Wgt']),
      );
      let lastDate = asIsoDate(
        pick(r, ['Date(Weight)', 'Date', 'last weigh date', 'Last Weigh Date', 'Weigh Date']),
      );
      if (lastDate == null && rawMatrix.length > 7) lastDate = asIsoDate(rawMatrix[7]);
      if (lastWeight == null && rawMatrix.length > 8) lastWeight = asNumber(rawMatrix[8]);

      if (!eid && !visual_id) {
        summary.animals.parse_errors++;
        return;
      }

      let animalId: number | null = null;
      if (eid) {
        const existing = findAnimalByEid.get(eid) as { id: number } | undefined;
        if (existing) {
          animalId = existing.id;
          summary.animals.existing++;
        }
      }

      if (!animalId) {
        const mobName = asString(pick(r, ['Mob', 'mob']));
        const paddockName = asString(pick(r, ['Paddock']));

        // Find-or-create paddock (Sundown property assumed; only one in Stock on hand).
        let paddockId: number | null = null;
        if (paddockName) {
          const findPaddock = db.prepare('SELECT id FROM paddock WHERE name = ?');
          const existingPad = findPaddock.get(paddockName) as { id: number } | undefined;
          if (existingPad) {
            paddockId = existingPad.id;
          } else {
            const propertyId = getPropertyId('Sundown');
            const res = db
              .prepare('INSERT INTO paddock (property_id, name) VALUES (?, ?)')
              .run(propertyId, paddockName);
            paddockId = Number(res.lastInsertRowid);
            summary.paddocks.imported++;
          }
        }

        // Find-or-create mob by exact raw name. If the animal references a mob
        // we haven't seen in Stock on hand, create it now so the link works.
        let mobId: number | null = null;
        if (mobName) {
          const existingMob = findMobByName.get(mobName) as { id: number } | undefined;
          if (existingMob) {
            mobId = existingMob.id;
          } else {
            const res = db
              .prepare(
                'INSERT INTO mob (name, breed_type, market_class, owner, paddock_id) VALUES (?, NULL, NULL, NULL, ?)',
              )
              .run(mobName, paddockId);
            mobId = Number(res.lastInsertRowid);
            summary.mobs.imported++;
          }
        }

        const sexRaw = asString(pick(r, ['Sex', 'sex']))?.toUpperCase();
        const sex = sexRaw === 'M' || sexRaw === 'F' ? sexRaw : null;

        const params = {
          visual_id,
          eid,
          sex,
          mob_id: mobId,
          owner: asString(pick(r, ['Owner', 'owner'])),
          livestock_class: normalizeLivestockClass(
            pick(r, ['Livestock Class', 'livestock_class', 'Class', 'Category']),
          ),
          current_weight: lastWeight,
          last_weight_date: lastDate,
          adg: asNumber(pick(r, ['ADG', 'adg'])),
          target_exit_weight: asNumber(pick(r, ['Target Exit Weight', 'target', 'Exit Weight'])),
          exit_market_category: asString(pick(r, ['Exit Market', 'exit market', 'Market Category'])),
        };
        try {
          const res = insertAnimal.run(params);
          animalId = Number(res.lastInsertRowid);
          summary.animals.imported++;
        } catch (e) {
          summary.animals.parse_errors++;
          summary.warnings.push(`animal insert failed (eid=${eid}): ${(e as Error).message}`);
          return;
        }
      }

      if (animalId && lastWeight != null && lastDate) {
        const res = insertObs.run(animalId, lastDate, lastWeight);
        if (res.changes > 0) summary.weight_observations.imported++;
        else summary.weight_observations.duplicate_skipped++;
      }
    });
  });

  tx(rows);
}

// ---------------------------------------------------------------------------
// Flow rows 24-26 → capacity_override
// Flow rows 45-46 → monthly_rainfall
// ---------------------------------------------------------------------------

function importFlowMeta(): void {
  const sheet = findSheet(workbook, 'Flow');
  if (!sheet) {
    summary.warnings.push('Sheet "Flow" not found — capacity & rainfall not imported');
    return;
  }
  const matrix = sheetToMatrix(sheet);

  // Find the month-header row — the one with multiple "MMM-YY" cells (Jan-23, Feb-23, ...).
  // Observed at matrix[1].
  let monthHeaderIdx = -1;
  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    const r = matrix[i] ?? [];
    let monthLikeCells = 0;
    for (const c of r) {
      if (c == null) continue;
      const s = String(c);
      if (/^[A-Za-z]{3}-\d{2}$/.test(s) || asIsoDate(c)) monthLikeCells++;
    }
    if (monthLikeCells >= 6) {
      monthHeaderIdx = i;
      break;
    }
  }
  if (monthHeaderIdx < 0) {
    summary.warnings.push(
      'Flow sheet: could not locate a month-header row; capacity/rainfall left empty',
    );
    return;
  }
  const headerCells = matrix[monthHeaderIdx] ?? [];

  // Map column index -> {year, month}. Accepts both ISO dates and "MMM-YY".
  const MONTH_NAMES: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const monthIndex: Array<{ year: number; month: number } | null> = headerCells.map((c) => {
    if (c == null) return null;
    const s = String(c).trim();
    const mmmYy = s.match(/^([A-Za-z]{3})-(\d{2})$/);
    if (mmmYy) {
      const month = MONTH_NAMES[mmmYy[1]!.toLowerCase()];
      const year = 2000 + Number(mmmYy[2]);
      if (month) return { year, month };
    }
    const iso = asIsoDate(c);
    if (iso) {
      const d = new Date(iso);
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    }
    return null;
  });

  // Find rows by label match in column 0. Label fragments are case-insensitive
  // substrings — the spreadsheet has typos ("Actural" not "Actual") we tolerate.
  function findRowByLabel(labelFragment: string): unknown[] | null {
    const needle = labelFragment.toLowerCase();
    for (let i = monthHeaderIdx + 1; i < matrix.length; i++) {
      const row = matrix[i] ?? [];
      const label = String(row[0] ?? '').toLowerCase();
      if (label.includes(needle)) return row;
    }
    return null;
  }

  const sundownCap = findRowByLabel('sundown normal capacity');
  const warabahCap = findRowByLabel('warabah normal capacity');
  const nutrition = findRowByLabel('potential nutrition');
  const histRain = findRowByLabel('historical average');
  const actRain = findRowByLabel('actural') ?? findRowByLabel('actual rain');

  if (!sundownCap) summary.warnings.push('Flow: "Sundown Normal Capacity" row not found');
  if (!warabahCap) summary.warnings.push('Flow: "Warabah Normal Capacity" row not found');
  if (!histRain) summary.warnings.push('Flow: "Historical Average" rainfall row not found');
  if (!actRain) summary.warnings.push('Flow: "Actual rainfall" row not found');

  const sundownId = getPropertyId('Sundown');
  const warabahId = getPropertyId('Warabah');

  const upsertCap = db.prepare(`
    INSERT INTO capacity_override (property_id, year, month, base_capacity, nutrition_increase)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(property_id, year, month) DO UPDATE SET
      base_capacity = excluded.base_capacity,
      nutrition_increase = excluded.nutrition_increase
  `);

  for (let i = 0; i < headerCells.length; i++) {
    const mi = monthIndex[i];
    if (!mi) continue;
    const sCap = sundownCap ? asInt(sundownCap[i]) : null;
    const wCap = warabahCap ? asInt(warabahCap[i]) : null;
    const nut = nutrition ? asInt(nutrition[i]) ?? 0 : 0;
    if (sCap != null) {
      upsertCap.run(sundownId, mi.year, mi.month, sCap, nut);
      summary.capacity_overrides.imported++;
    }
    if (wCap != null) {
      upsertCap.run(warabahId, mi.year, mi.month, wCap, 0);
      summary.capacity_overrides.imported++;
    }
  }

  const upsertRain = db.prepare(`
    INSERT INTO monthly_rainfall (property_id, year, month, mm_actual, mm_historical_avg)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(property_id, year, month) DO UPDATE SET
      mm_actual = excluded.mm_actual,
      mm_historical_avg = excluded.mm_historical_avg
  `);

  // Shared historical baseline per user spec — store same row under both properties.
  for (let i = 0; i < headerCells.length; i++) {
    const mi = monthIndex[i];
    if (!mi) continue;
    const hist = histRain ? asNumber(histRain[i]) : null;
    const act = actRain ? asNumber(actRain[i]) : null;
    if (hist == null && act == null) continue;
    for (const pid of [sundownId, warabahId]) {
      upsertRain.run(pid, mi.year, mi.month, act, hist);
      summary.rainfall.imported++;
    }
  }

  // "On Farm Opening" checkpoints — physical inventory anchors that override
  // the running roll-forward. Imported into opening_balance.
  const openingActual = findRowByLabel('on farm opening actual');
  const openingBudget = findRowByLabel('on farm opening budget');
  if (!openingActual && !openingBudget) {
    summary.warnings.push('Flow: no "On Farm Opening" rows found');
  }
  // Wipe prior opening_balance rows; spreadsheet is source of truth.
  db.prepare('DELETE FROM opening_balance').run();
  const upsertOpening = db.prepare(`
    INSERT INTO opening_balance (year, month, source, head_count)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(year, month, source) DO UPDATE SET head_count = excluded.head_count
  `);
  for (const [row, source] of [
    [openingActual, 'Actual'] as const,
    [openingBudget, 'Budget'] as const,
  ]) {
    if (!row) continue;
    for (let i = 0; i < headerCells.length; i++) {
      const mi = monthIndex[i];
      if (!mi) continue;
      const v = asInt(row[i]);
      if (v == null || v === 0) continue;
      upsertOpening.run(mi.year, mi.month, source, v);
      summary.opening_balances_imported++;
    }
  }
}

// ---------------------------------------------------------------------------
// Feeding sheet → feed_event (plan-style, snapshot dated today)
// Structure observed:
//   Row 4:  "Hay Feeding" | (blank) | "hd" | (blank) | "kg/hd/day" | "total kg" | "Freq"
//   Row 5+: <feed type name OR blank if same as above> | tag/subgroup |
//           head_count | (blank) | kg_per_head_per_day | total_kg | freq
// Multiple feed-type sections may appear stacked. We track the current
// section by the most recent non-blank col[0] header above the data row.
// ---------------------------------------------------------------------------

function importFeeding(): void {
  const sheet = findSheet(workbook, 'Feeding');
  if (!sheet) {
    summary.warnings.push('Sheet "Feeding" not found');
    return;
  }
  const matrix = sheetToMatrix(sheet);

  // Wipe prior imported events (manual UI events have a NULL notes-marker by
  // default; we tag imports so they can be distinguished and re-imported).
  const wiped = db
    .prepare("DELETE FROM feed_event WHERE notes = '[imported from Feeding sheet]'")
    .run();
  if (wiped.changes > 0) {
    console.log(`[import] wiped ${wiped.changes} pre-existing imported feed_event row(s)`);
  }

  const findFeedTypeByName = db.prepare(
    'SELECT id FROM feed_type WHERE LOWER(name) = LOWER(?)',
  );
  const insertFeedType = db.prepare(
    "INSERT INTO feed_type (name, unit) VALUES (?, 'kg')",
  );
  const insertEvent = db.prepare(`
    INSERT INTO feed_event
      (date, feed_type_id, mob_id, paddock_id, cattle_group, head_count,
       kg_per_head_per_day, duration_days, total_kg, cost_per_unit, total_cost, notes)
    VALUES (?, ?, NULL, NULL, ?, ?, ?, 1, ?, NULL, NULL, ?)
  `);

  const today = new Date().toISOString().slice(0, 10);
  let currentSection: string | null = null;
  let currentFeedTypeId: number | null = null;
  let imported = 0;

  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i] ?? [];

    // Section headers: col[0] is text like "Hay Feeding", col[4] = "kg/hd/day" header text.
    const col0 = asString(row[0]);
    const col4 = asString(row[4]);
    if (col0 && col4 && col4.toLowerCase().includes('kg/hd/day')) {
      // This is a header row introducing a new feed-type section.
      // Section name = first word(s) before "Feeding" e.g. "Hay Feeding" → "Hay".
      currentSection = col0.replace(/feeding/i, '').trim() || col0;
      const existing = findFeedTypeByName.get(currentSection) as { id: number } | undefined;
      if (existing) {
        currentFeedTypeId = existing.id;
      } else {
        const r = insertFeedType.run(currentSection);
        currentFeedTypeId = Number(r.lastInsertRowid);
      }
      continue;
    }

    // Data row: col[2] head count + col[4] kg/hd/day. Section must be active.
    if (!currentFeedTypeId) continue;
    const head = asInt(row[2]);
    const kgPerHd = asNumber(row[4]);
    if (head == null || kgPerHd == null) continue;

    const group = [asString(row[0]) ?? currentSection ?? '', asString(row[1]) ?? '']
      .filter(Boolean)
      .join(' / ');
    const totalKg = asNumber(row[5]) ?? head * kgPerHd;

    insertEvent.run(
      today,
      currentFeedTypeId,
      group || null,
      head,
      kgPerHd,
      totalKg,
      '[imported from Feeding sheet]',
    );
    imported++;
  }

  summary.feed_events_imported = imported;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const importTx = db.transaction(() => {
  // Wipe-and-replace strategy: Actual + Forecast txns, plus paddocks/mobs/
  // animals/weight_observations all come exclusively from the spreadsheet.
  // Manual `Predicted` transaction rows from the UI are preserved.
  const wiped = db
    .prepare("DELETE FROM transaction_event WHERE source IN ('Actual', 'Forecast')")
    .run();
  if (wiped.changes > 0) {
    console.log(`[import] wiped ${wiped.changes} pre-existing Actual+Forecast txn row(s)`);
  }
  // Order matters: weight_observation cascades from animal; mob.paddock_id
  // and animal.mob_id are SET NULL on cascade, so cleaner to drop in reverse.
  db.prepare('DELETE FROM weight_observation').run();
  const wAnimals = db.prepare('DELETE FROM animal').run();
  const wMobs = db.prepare('DELETE FROM mob').run();
  const wPaddocks = db.prepare('DELETE FROM paddock').run();
  if (wAnimals.changes + wMobs.changes + wPaddocks.changes > 0) {
    console.log(
      `[import] wiped animals=${wAnimals.changes}, mobs=${wMobs.changes}, paddocks=${wPaddocks.changes}`,
    );
  }

  importTransactionsSheet('IN ACT Dump', 'IN', 'Actual', 'actual-dump');
  importTransactionsSheet('OUT ACT Dump', 'OUT', 'Actual', 'actual-dump');
  // Budget dumps replace BUDIN as the primary source for Forecast IN — they
  // carry the cost data (price_per_kg, freight, total_cost) that BUDIN lacks.
  importExtPurchaseBudget();
  importIntTransferBudget();
  importOutLegacy();
  importStockOnHand();
  importForecastedWeights();
  importFlowMeta();
  importFeeding();
});

try {
  importTx();
} catch (e) {
  console.error(`[import] fatal: ${(e as Error).message}`);
  process.exit(1);
}

// Identify sheets we didn't touch — surface them so the user can decide.
const handled = new Set([
  'IN ACT Dump',
  'OUT ACT Dump',
  'BUDIN',
  'BUDIN formular',
  'IN EX purch Budget dump',
  'IN Int Transfer Budget dump',
  'OUT',
  'Stock on hand',
  'Forecasted Weights',
  'Flow',
  'Feeding',
]);
for (const s of workbook.SheetNames) {
  if (![...handled].some((h) => s.toLowerCase().includes(h.toLowerCase().split(' ')[0]!))) {
    summary.unmatched_sheets.push(s);
  }
}

console.log('');
console.log('===================== IMPORT SUMMARY =====================');
console.log(JSON.stringify(summary, null, 2));
console.log('==========================================================');

if (summary.warnings.length > 0) {
  console.log(`[import] ${summary.warnings.length} warning(s) emitted (see above).`);
}
if (summary.unmatched_sheets.length > 0) {
  console.log(
    `[import] unmatched sheets (not imported): ${summary.unmatched_sheets.join(', ')}`,
  );
}
console.log('[import] done.');
process.exit(0);

// silence unused var lint when --noUnusedLocals is on
void path;
void fs;
