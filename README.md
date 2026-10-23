# ReconFlow — Transaction Reconciliation Dashboard

Compares **synthetic** merchant and bank transactions, flags missing entries, duplicates, amount/currency/reference mismatches, and produces downloadable CSV/JSON exception reports. Synthetic data only; not for real financial data.

**Stack:** React 18, Vite, Tailwind, Recharts, React Router, Axios, Lucide · Node.js, Express, Mongoose/MongoDB, Zod, Helmet, express-rate-limit · Vitest, Supertest.

## Setup
Requires Node.js 18+.
```bash
npm run install:all
cp .env.example server/.env
npm run dev:server      # API  → http://localhost:4000
npm run dev:client      # UI   → http://localhost:5173  (proxies /api to :4000)
```
Open the UI, click **Run reconciliation** on the Overview page.

| Command | Purpose |
|---|---|
| `npm test` | Server (Vitest + Supertest) and client tests |
| `npm run build` | Production build of the client (`client/dist`) |
| `npm run seed --prefix server [seed]` | Regenerate demo data; clears runs/exceptions first, so reseeding never creates duplicates |

### Environment (`server/.env`)
| Variable | Meaning |
|---|---|
| `PORT` | API port (default 4000) |
| `MONGODB_URI` | MongoDB connection string. **If empty, an in-memory store is used** (dev fallback; data resets on restart) |
| `CORS_ORIGIN` | Allowed origin (default `*`; set to the client URL in production) |
| `SEED` | Seed for the synthetic generator (default 42) |

### MongoDB
`docker compose up -d mongo`, then set `MONGODB_URI=mongodb://localhost:27017/reconflow` in `server/.env`.

## Design assumptions
- **Money** is converted to integer paise before any comparison or sum; no floating-point arithmetic on amounts. Display uses Indian grouping (₹12,99,500.50). Default currency is INR.
- **Synthetic data:** `generate(seed)` is deterministic (same seed → identical data). Default seed 42 yields 530 merchant and 517 bank records that include every exception type.
- **Duplicate:** same side, same reference, amount, currency, type and status within 5 minutes. Repeated references that differ in amount or time are treated as legitimate separate payments. Duplicates are removed from matching first (earliest is the primary), so one underlying problem is not counted twice.
- **Matching, in order:**
  1. Exact `merchantReference`, strictly one-to-one. Best candidate = equal amount, then closest timestamp.
  2. Fallback on currency + amount + timestamp tolerance (default 24h, configurable) — only when the pairing is unique in both directions.
- **Ambiguity:** if several candidates fit, nothing is matched; the records become `MISSING_*` exceptions whose description says "ambiguous". A bank record is never matched to more than one merchant record.
- **Exceptions:** a reference-matched pair with differing currency → `CURRENCY_MISMATCH`; differing amount → `AMOUNT_MISMATCH`; a fallback pair → `REFERENCE_MISMATCH`; leftovers → `MISSING_IN_BANK` / `MISSING_IN_MERCHANT`; plus `DUPLICATE_MERCHANT` / `DUPLICATE_BANK`.
- **Match rate** = clean matches ÷ merchant records after duplicates removed (2 d.p.). Total discrepancy = sum of absolute differences for amount/currency mismatches.
- **History:** each run stores its own config, summary and exceptions; later runs or new data never alter earlier runs. Changing an exception's status/note never touches source transactions and is written to an audit log.
- **Settings:** the saved tolerance is a *global default* for new runs; each run records the tolerance it actually used.

## API
Base URL `http://localhost:4000/api`. Success: `{ "data": ..., "meta": {...} }`. Error: `{ "error": { "message", "details?" } }` (400 validation, 404 not found, 500 generic, no stack traces).

| Method & path | Description |
|---|---|
| GET `/health` | Liveness and active store |
| POST `/reconciliation/run` | Run body: `{ toleranceHours?, from?, to? }` (ISO datetimes) |
| GET `/reconciliation/runs` · `/runs/:runId` · `/runs/:runId/results` | History, one run, its matches and exceptions |
| GET `/exceptions` | Query: `page, pageSize(≤100), search, type, severity, status, runId, from, to, sortBy(createdAt\|difference\|severity), order` |
| GET `/exceptions/:id` | Exception plus audit trail |
| PATCH `/exceptions/:id/status` | `{ status: OPEN\|INVESTIGATING\|RESOLVED\|IGNORED, note? }` |
| POST `/exceptions/:id/notes` | `{ note }` |
| GET `/transactions` | Query: `tab(all\|merchant\|bank\|matched\|unmatched), search, page, pageSize` (match status from latest run) |
| GET `/reports/exceptions.csv` · `.json` | Accepts the same filters as `/exceptions` |
| GET `/reports/reconciliation/:runId.csv` · `.json` | All exceptions of one run |
| GET `/dashboard/summary` | KPIs for the latest run |
| GET/PATCH `/settings` | `{ currency: "INR", toleranceHours: 0–720 }` |

### Sample requests (real output, seed 42)
```bash
curl -X POST localhost:4000/api/reconciliation/run -H 'content-type: application/json' -d '{"toleranceHours":24}'
```
```json
{"data":{"runId":"RUN-10001","status":"COMPLETED","config":{"toleranceHours":24},"merchantCount":530,"bankCount":517,"matchedCount":441,"exceptionCount":112,"exceptionsByType":{"DUPLICATE_MERCHANT":10,"DUPLICATE_BANK":11,"CURRENCY_MISMATCH":15,"AMOUNT_MISMATCH":25,"REFERENCE_MISMATCH":13,"MISSING_IN_BANK":26,"MISSING_IN_MERCHANT":12},"matchRate":84.81,"totalDiscrepancyMinor":250000}}
```
```bash
curl "localhost:4000/api/exceptions?type=AMOUNT_MISMATCH&pageSize=1"
```
```json
{"data":[{"exceptionId":"EXC-10023","runId":"RUN-10001","exceptionType":"AMOUNT_MISMATCH","severity":"HIGH","merchantTransactionId":"MER-10008","bankTransactionId":"BNK-20007","merchantReference":"ORD-10008","bankReference":"BANK-REF-29008","merchantAmount":"5350.32","bankAmount":"5250.32","difference":"100.00","currency":"INR","status":"OPEN","description":"Merchant and bank transaction amounts do not match","resolutionNote":""}],"meta":{"page":1,"pageSize":1,"total":25,"totalPages":25}}
```
```bash
curl -X PATCH localhost:4000/api/exceptions/EXC-10023/status -H 'content-type: application/json' -d '{"status":"RESOLVED","note":"Bank corrected"}'
curl -OJ "localhost:4000/api/reports/exceptions.csv?type=DUPLICATE_BANK"   # → reconflow-exceptions.csv
curl -OJ localhost:4000/api/reports/reconciliation/RUN-10001.json          # → reconflow-exceptions-RUN-10001.json
curl "localhost:4000/api/exceptions?page=0"   # 400 {"error":{"message":"Validation failed","details":["page: Too small: expected number to be >=1"]}}
```
**CSV exports** are UTF-8 with BOM (open cleanly in Excel), RFC 4180 quoting, and values starting with `= + - @` are prefixed with `'` to prevent formula injection.

## Tests
`npm test` — 17 server tests (engine: matches, missing, duplicates, legitimate repeats, amount/currency/reference mismatches, tolerance, ambiguity, one-to-one, decimal precision, repeat-run determinism, seed coverage; API: validation, errors, filtering, pagination, status/audit, CSV/JSON export, CSV escaping, dashboard totals, transactions, settings) and 1 client test. Tests use their own in-memory store and never touch development data.

## Project layout
```
client/  React app (pages/, ui.jsx, api.js, utils.js)
server/  src/{app.js, server.js, store.js, csv.js, services/{reconcile,seed,money}.js}, scripts/seed.js, tests/
docker-compose.yml  .env.example
```

## Known limitations
- No authentication, authorization, tenant isolation or audit-grade monitoring; required before any real financial data. No regulatory compliance is claimed.
- Mongo adapter uses generic collections and filters in application code (fine for small datasets); dedicated Mongoose models with indexes are future work.
- Runs are synchronous (adequate at this scale).
- Dashboard lacks a transaction-volume-over-time chart; the top-bar search/date range, notification bell and profile are not functional. Only one frontend test.
