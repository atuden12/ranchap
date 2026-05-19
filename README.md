# RanchApp

Replaces the `Stock_Flow_MASTER` Excel workbook with an interactive, forecast-aware app for the cattle operation. **Local-first** (SQLite on disk), **single-user** (no auth), **forecast-aware** (rainfall-adjusted grazing capacity, per-animal weight projections, market-band classification).

> **Status:** Phase 1 (Flow view) and Phase 2 (Stock on Hand + Forecasted Weights) complete and end-to-end working against the real workbook.

---

## TL;DR — boot it on a fresh machine

```bash
cd "C:\Users\Andrew Uden\Desktop\RanchApp"
npm install
npm run migrate
npm test                                                # all 23 forecasting tests pass
# Drop Stock Flow MASTER xlsx into ./import/ first.
npm run import -- --file ".\import\Stock Flow MASTER 14-1-26.xlsx"
npm run dev                                             # API:4317 + Web:5173
```

Open http://localhost:5173.

---

## Stack

- **Frontend:** Vite + React + TypeScript + Tailwind. shadcn-ready (components.json present); custom components for the grid + drawer. Recharts for sparklines. Dark mode by default.
- **Backend:** Express + better-sqlite3 v12 (Node 24 prebuilds). Express routes per concern. No ORM — hand-written SQL kept portable to Postgres later.
- **Shared:** `packages/shared` holds domain types, the rainfall-adjusted-capacity math, weight-projection helpers, market-band classification. Vitest test suite enforces the load-bearing formulas.
- **Data location:** SQLite DB at `C:\Users\Andrew Uden\Desktop\RanchApp-Data\ranch.db` (outside the repo). Override with `RANCHAPP_DB` env var.

---

## Project layout

```
RanchApp/
├── apps/
│   ├── api/                          Express + better-sqlite3
│   │   └── src/
│   │       ├── cli/                  migrate.ts, seed.ts, import.ts, inspect.ts
│   │       ├── db/                   connection, migration runner, seed
│   │       ├── routes/               status, flow, stock, weights
│   │       ├── paths.ts              resolves DB path & migrations dir
│   │       └── server.ts             entry point
│   └── web/                          Vite + React + TS + Tailwind + shadcn-ready
│       └── src/components/           FlowGrid, CellDrawer, ForecastHelper,
│                                     StockOnHand, ForecastedWeights, BandSettings,
│                                     Sparkline
├── packages/
│   └── shared/                       types + forecasting math (used by API + web)
│       └── src/
│           ├── constants.ts          LIVESTOCK_CLASSES, BREED_TYPES, defaults
│           ├── types.ts              Property, Paddock, Mob, Animal, Transaction, …
│           ├── forecasting.ts        rainfallAdjustedCapacity, projectAnimalWeight,
│                                     predictExit, currentMonthAdjustedPct, …
│           ├── market-bands.ts       classifyByWeight, predictMarketEntry
│           └── forecasting.test.ts   23 tests covering the load-bearing math
├── migrations/                       0001_init, 0002_drop_txn_partial_unique,
│                                     0003_opening_balance
├── import/                           drop xlsx files here (gitignored)
└── README.md
```

---

## Commands reference

| Command | What it does |
|---|---|
| `npm install` | Install workspace dependencies |
| `npm run migrate` | Apply SQL migrations + seed reference data (properties, market bands, ADG matrix) |
| `npm test` | Run forecasting unit tests |
| `npm run import -- --file <path>` | Import a `Stock_Flow_MASTER` workbook (wipe-and-replace) |
| `npm run inspect -- --file <path>` | Diagnostic: dumps headers + first rows of every key sheet |
| `npm run dev` | Run API + web together |
| `npm run dev:api` | API only (port 4317, `tsx watch` auto-restart) |
| `npm run dev:web` | Web only (port 5173, Vite HMR) |
| `npm run build` | Build all workspaces |

---

## Phase 1 — Flow view (complete)

The home screen replaces the `Flow` tab of the spreadsheet. Wide monthly grid Jan-2023 → Jun-2026.

<!-- TODO: drop a screenshot of the Flow grid here, e.g. docs/flow-grid.png -->
![Flow grid](docs/flow-grid.png)

**Rows (interactive):**

- On Farm Opening Actual + Budget (rolls forward from prior closing unless an explicit checkpoint exists)
- Inflow Actual / Forecast (B) / Predictions (P)
- Exits Actual / Forecast / Predictions
- Total on Farm Closing — Actual + Budget
- Sundown Normal Capacity · Warabah Normal Capacity · Potential Nutrition Increase
- Total Grazing Capacity
- **Rainfall-Adjusted Capacity (rolling 3mo)** — `(sundown + warabah + nutrition) × rolling_pct`, hard-capped at 16,000 head when rolling > 130%
- **Capacity Variance** — green > +500 / amber 0–500 / red < 0 (overstocked)
- Historical Avg Rainfall / Actual Rainfall / % of Average / Rolling 3-Month %

**Interactions:**

- **Click any cell** → drawer slides in showing what's underneath:
  - Transaction cells → table of every underlying transaction for that month
  - Capacity / rainfall cells → editable fields with Save
  - Predictions cells → list of existing predictions + "Add prediction" form
  - Derived cells → the formula
  - Press **Esc** or click outside to close
- **Inline editing** flows through every dependent cell (closing, rainfall-adjusted capacity, variance) within ~100ms
- **Sticky first column** with row labels + sparkline column
- **Sparklines** beside each label showing the last 12 months
- **Current month** highlighted orange

**Forecast Helper** (below the grid):

- Pick a target month
- See projected closing, rainfall-adjusted capacity, rolling 3-month rainfall %
- Headline action: **destock X head** / **on-track** / **capacity for X more head**
- When destock is needed: a ranked table of mobs reaching their first market band by the target month, with cumulative head counts

<!-- TODO: drop a screenshot of the Forecast Helper destock suggestions -->
![Forecast Helper](docs/forecast-helper.png)

---

## Phase 2 — Stock on Hand + Forecasted Weights (complete)

### Stock on Hand tab

Per-mob aggregates computed live from the animal records. Columns: Paddock / Mob, Breed, Class, Head, Avg / Min / Max weight, Last Weigh date, DSLW, ADG, Estimated weight (last + ADG×DSLW), Pred Min/Max, Target exit weight, Days to Exit.

Grouped property → paddock → mob. Filters: text search, breed dropdown, market-class dropdown, "hide mobs with no animals" toggle.

<!-- TODO: screenshot of Stock on Hand -->
![Stock on Hand](docs/stock-on-hand.png)

### Forecasted Weights tab

One row per animal, ~20 future date columns (today, +2wk, +1mo, +2mo, +3mo, then monthly through +18mo). Each cell is the projected weight (`last + ADG × days_from_last_weigh`).

- Cells colored by **market band** they fall into
- The first band-entry cell gets a ring border — that's the predicted exit point
- Per-animal summary columns: Predicted Exit date + Predicted Band
- Filters: paddock, breed, sex, predicted band, text search (EID / Visual / mob)
- Pagination at 100 rows per page; band-distribution chips above the table

<!-- TODO: screenshot of Forecasted Weights -->
![Forecasted Weights](docs/forecasted-weights.png)

### Settings tab — Market Bands

Editable bands (Name, Sex M/F/both, Min kg, Max kg, Priority). Add new bands inline. Edits propagate to the Forecasted Weights view and the Forecast Helper's destock suggestions on next refresh.

<!-- TODO: screenshot of Settings -->
![Market Band Settings](docs/band-settings.png)

---

## Domain model

| Table | Purpose | Source of truth |
|---|---|---|
| `property` | Sundown, Warabah | Seed |
| `paddock` | Within a property; has normal capacity | Stock on hand + Forecasted Weights animal rows |
| `mob` | Group of animals (breed/market class) | Stock on hand + Forecasted Weights animal rows |
| `animal` | Individual head, EID-keyed | Forecasted Weights |
| `weight_observation` | Each weigh event | Forecasted Weights |
| `transaction_event` | IN/OUT, source = Actual/Forecast/Predicted | IN ACT Dump, OUT ACT Dump, BUDIN, OUT (legacy) |
| `monthly_rainfall` | Actual & historical avg per property/month | Flow sheet rows 44–45 (shared baseline) |
| `capacity_override` | Per property/month base capacity + nutrition | Flow sheet rows 23–25 |
| `opening_balance` | "On Farm Opening" physical checkpoints (Actual / Budget) | Flow sheet rows 2–3 |
| `adg_matrix` | 12-month × N-class kg/day matrix, default 0.6 | Seed; editable later |
| `market_band` | Liveweight bands (EUHQB, Feeder Steer EU, …) — editable | Seed + Settings UI |

**Idempotency:** the importer wipes-and-replaces `transaction_event` (Actual + Forecast sources only; Predicted UI entries survive), `animal`, `mob`, `paddock`, `weight_observation`, `opening_balance` on every run. Capacity overrides and rainfall are upserted by `(property, year, month)`. Re-imports are safe.

---

## Architectural decisions locked in (2026-05-16)

1. **DB outside repo:** `C:\Users\Andrew Uden\Desktop\RanchApp-Data\ranch.db`. Override with `RANCHAPP_DB`.
2. **Single-user local.** No auth, no remote sync. Add later if needed.
3. **Capacity defaults** confirmed via the first-run UI; importer pre-fills from Flow sheet rows 23–25.
4. **Rainfall historical baseline** shared between Sundown and Warabah.
5. **ADG default** 0.6 kg/day for all classes; editable per month per class via the Settings UI (panel pending).
6. **EUHQB band** is 370–450 kg **liveweight** (no carcase conversion).
7. **`male_weaner` is a real class** in the user's data — added to the enum.
8. **Stock on hand sheet is Sundown-only.** No Warabah split.
9. **OUT (legacy) sheet** is a feedlot delivery log spanning Jan-23 onwards — separate parser from BUDIN; imported as `source='Forecast'` per spec.
10. **Forecast rows are snapshots** — wiped on each import. Actual rows same. Predicted (UI) rows preserved.

---

## Forecasting math (load-bearing, test-covered)

All in `packages/shared/src/forecasting.ts` + `market-bands.ts`. 23 tests pass.

**Rainfall-adjusted capacity:**
```
base       = sundown_capacity + warabah_capacity + nutrition_increase
adjusted   = base × rolling_3mo_pct_of_avg
IF rolling > 1.30 THEN adjusted = 16_000      (hard cap from spreadsheet)
```

**In-progress month rainfall** (today is partway through a month):
```
pct = actual_mm_to_date / (historical_avg × pct_of_month_elapsed)
```

**Weight projection:**
```
projected = last_weight + adg × days_from(last_weigh_date → as_of_date)
```

**Predicted exit:** walk dates forward from today; first date the projected weight enters any market band (filtered by sex, highest-priority on ties) is the predicted exit. Returns `null` past horizon.

---

## Testing

```bash
npm test
```

Verified test cases:
- Drought (rolling 50%) on Sundown 11,200 + Warabah 1,500 → **6,350**
- Average year (rolling 100%) → **12,700**
- Wet year (rolling > 130%) → capped at **16,000**
- Weight projection: 300 kg + 0.6 kg/day × 90 days → 354
- EUHQB classification at 380 kg steer (highest priority wins over Feeder Steer EU)
- In-progress month pct correctly time-scales

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `npm install` fails on `better-sqlite3` | Check Node version. We pin to v12 (Node 22+ and Node 24 prebuilds). If you must use older Node, downgrade `better-sqlite3` to v11. |
| `tsx: not recognized` | `npm install` didn't complete cleanly. Delete `node_modules` + `package-lock.json` and re-install. |
| Grid shows 91,537 months | Wild dates in the data. Run `npm run migrate` + `npm run import` again — the importer rejects years outside [1990, 2100]. |
| Stock on Hand shows 0 head for every mob | Animals not linked to mobs. Run `npm run import` again — the importer auto-creates mobs from Forecasted Weights animal references. |
| `/api/flow/debug` | Surfaces year distribution per table, plus sample rows with implausible dates. Helpful when import looks suspect. |

---

## Deploying to a shared URL (with login)

Two paths — start with **A** for a 5-minute demo, move to **B** when you want it persistently online.

### Authentication

Both paths use the same single-user session-cookie auth. Three env vars:

| Var | What |
|---|---|
| `APP_USERNAME` | Login username (e.g., `admin`) |
| `APP_PASSWORD_HASH` | bcrypt hash of the password. Generate with: `npm run hash-password -- "your password"` |
| `SESSION_SECRET` | Random 32+ char string. Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

When both `APP_USERNAME` and `APP_PASSWORD_HASH` are unset, auth is **disabled** (open access) — that's the local dev default.

### Path A — Cloudflare Tunnel (laptop must be running)

1. **Install cloudflared:**
   ```bash
   winget install Cloudflare.cloudflared
   ```

2. **Generate a password hash and a session secret:**
   ```bash
   npm run hash-password -- "your-test-password"
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

3. **Create `.env` at the repo root:**
   ```
   APP_USERNAME=admin
   APP_PASSWORD_HASH=<hash from step 2>
   SESSION_SECRET=<random hex from step 2>
   NODE_ENV=production
   ```

4. **Build the production bundle and run the unified server:**
   ```bash
   npm run build
   node --env-file=.env apps/api/dist/server.js
   ```

   This serves both `/api/*` and the static web app from `http://localhost:4317`.

5. **Open a tunnel** (in another terminal):
   ```bash
   cloudflared tunnel --url http://localhost:4317
   ```

   It prints a URL like `https://random-words-1234.trycloudflare.com`. Share that + your credentials with your customer. HTTPS is automatic.

### Path B — Fly.io (24/7 hosted, free tier)

1. **Sign up + install:**
   ```bash
   winget install Fly.flyctl
   fly auth signup        # or: fly auth login
   ```

2. **Generate credentials:**
   ```bash
   npm run hash-password -- "your-customer-password"
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

3. **Edit `fly.toml`:**
   - Change `app = "ranchapp"` to a unique name (e.g., `ranchapp-yourname`)
   - Change `primary_region = "iad"` to your closest region (`fly platform regions` for the list)

4. **Claim the app + create the persistent volume:**
   ```bash
   fly launch --no-deploy
   fly volumes create ranchapp_data --region <your-region> --size 1
   ```

5. **Set the secrets:**
   ```bash
   fly secrets set APP_USERNAME=admin APP_PASSWORD_HASH='<bcrypt-hash>' SESSION_SECRET='<random-hex>'
   ```

6. **Deploy:**
   ```bash
   fly deploy
   ```

   First deploy builds the Docker image (~3-5 min). Subsequent deploys are faster.

7. **Visit your app:**
   ```bash
   fly open
   ```

   That opens `https://<your-app>.fly.dev` in your browser. Sign in with the username + password you hashed.

### Uploading the xlsx after deploy

Once your customer is on the hosted URL, you (or they) can import a fresh `Stock_Flow_MASTER` via **Settings → Data Admin → Import xlsx**. The upload goes to a temp file on the server, runs the importer subprocess, and shows the summary inline. The persistent volume keeps the imported DB across deploys + restarts.

### Backing up the database

**Settings → Data Admin → Download backup** streams a consistent SQLite snapshot (`VACUUM INTO`) — safe to run during use. Schedule it manually for now; automated daily backup is on the backlog.

### What's different in production

- `/api/*` and the web app come from the same origin — no CORS
- All `/api/*` requires a valid session cookie (except `/api/auth/*`)
- Cookies are `Secure` + `HttpOnly` + `SameSite=Lax`
- Express trusts one reverse-proxy hop (Fly.io, Cloudflare Tunnel) so `Secure` cookies work behind their TLS terminator
- The SQLite DB lives at `/data/ranch.db` (Docker volume mount)

---

## What's next

- **Phase 3 candidates (sketched separately):** feeding records, budget/cost tracking, per-class ADG matrix editor, manual transaction CRUD
- **Polish backlog:** mobile-friendly Stock on Hand cards, URL-routed views, automated daily backup of `ranch.db`, multi-user logins with roles
- **Stretch:** multi-user with sync (deferred from spec)
