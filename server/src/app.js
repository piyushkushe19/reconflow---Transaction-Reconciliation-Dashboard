import express from 'express'; import helmet from 'helmet'; import cors from 'cors'; import rateLimit from 'express-rate-limit'; import { z } from 'zod';
import { reconcile } from './services/reconcile.js'; import { fromMinor } from './services/money.js'; import { generate } from './services/seed.js'; import { toCsv } from './csv.js';

const STATUS = ['OPEN', 'INVESTIGATING', 'RESOLVED', 'IGNORED'], TYPES = ['MISSING_IN_BANK', 'MISSING_IN_MERCHANT', 'DUPLICATE_MERCHANT', 'DUPLICATE_BANK', 'AMOUNT_MISMATCH', 'REFERENCE_MISMATCH', 'CURRENCY_MISMATCH'];
const SEV_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3 };
const q = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), search: z.string().max(100).optional(),
  type: z.enum(TYPES).optional(), severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(), status: z.enum(STATUS).optional(), runId: z.string().max(30).optional(),
  from: z.string().datetime().optional(), to: z.string().datetime().optional(), sortBy: z.enum(['createdAt', 'difference', 'severity']).default('createdAt'), order: z.enum(['asc', 'desc']).default('desc') });
const runBody = z.object({ toleranceHours: z.number().min(0).max(720).default(24), from: z.string().datetime().optional(), to: z.string().datetime().optional() }).default({});
const errH = (e) => Object.assign(new Error(e), { status: 400 });
const wrap = (f) => (req, res, next) => f(req, res).catch(next);
const parse = (s, v) => { const r = s.safeParse(v); if (!r.success) throw Object.assign(new Error('Validation failed'), { status: 400, details: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }); return r.data; };
const view = (e) => ({ ...e, merchantAmount: e.merchantAmountMinor == null ? null : fromMinor(e.merchantAmountMinor), bankAmount: e.bankAmountMinor == null ? null : fromMinor(e.bankAmountMinor), difference: fromMinor(e.differenceMinor) });

export function createApp(store, { corsOrigin = '*' } = {}) {
  const app = express(); app.use(helmet(), cors({ origin: corsOrigin }), express.json({ limit: '100kb' }));
  app.use('/api', rateLimit({ windowMs: 60000, limit: 600, standardHeaders: true }));
  const runLimiter = rateLimit({ windowMs: 60000, limit: 20 });

  async function filtered(query) {
    const f = parse(q, query); let rows = await store.all('exceptions');
    if (f.runId) rows = rows.filter((e) => e.runId === f.runId); if (f.type) rows = rows.filter((e) => e.exceptionType === f.type);
    if (f.severity) rows = rows.filter((e) => e.severity === f.severity); if (f.status) rows = rows.filter((e) => e.status === f.status);
    if (f.from) rows = rows.filter((e) => e.createdAt >= f.from); if (f.to) rows = rows.filter((e) => e.createdAt <= f.to);
    if (f.search) { const s = f.search.toLowerCase(); rows = rows.filter((e) => [e.exceptionId, e.merchantTransactionId, e.bankTransactionId, e.merchantReference, e.bankReference].some((v) => v && String(v).toLowerCase().includes(s))); }
    const key = { createdAt: (e) => e.createdAt, difference: (e) => e.differenceMinor, severity: (e) => SEV_RANK[e.severity] }[f.sortBy], dir = f.order === 'asc' ? 1 : -1;
    rows.sort((a, b) => (key(a) > key(b) ? dir : key(a) < key(b) ? -dir : a.exceptionId.localeCompare(b.exceptionId)));
    return { f, rows };
  }
  app.get('/api/health', (req, res) => res.json({ ok: true, store: store.kind }));

  app.post('/api/reconciliation/run', runLimiter, wrap(async (req, res) => {
    const b = parse(runBody, req.body); const runs = await store.all('runs'); const n = runs.length + 1, runId = `RUN-${10000 + n}`, startedAt = new Date().toISOString();
    const inR = (r) => (!b.from || r.transactionDate >= b.from) && (!b.to || r.transactionDate <= b.to);
    const [m, k] = [(await store.all('merchant')).filter(inR), (await store.all('bank')).filter(inR)];
    const out = reconcile(m, k, { toleranceHours: b.toleranceHours }); const base = (await store.all('exceptions')).length;
    const ex = out.exceptions.map((e, i) => ({ ...e, exceptionId: `EXC-${10001 + base + i}`, runId, resolutionNote: '', createdAt: startedAt, updatedAt: startedAt }));
    await store.insert('exceptions', ex); await store.insert('matches', out.matches.map((x) => ({ ...x, runId })));
    const run = { runId, status: 'COMPLETED', startedAt, completedAt: new Date().toISOString(), config: { toleranceHours: b.toleranceHours, from: b.from, to: b.to }, ...out.summary };
    await store.insert('runs', [run]); res.status(201).json({ data: run });
  }));
  app.get('/api/reconciliation/runs', wrap(async (req, res) => res.json({ data: (await store.all('runs')).sort((a, b) => b.startedAt.localeCompare(a.startedAt)) })));
  app.get('/api/reconciliation/runs/:runId', wrap(async (req, res) => { const r = (await store.all('runs')).find((x) => x.runId === req.params.runId); if (!r) throw Object.assign(new Error('Run not found'), { status: 404 }); res.json({ data: r }); }));
  app.get('/api/reconciliation/runs/:runId/results', wrap(async (req, res) => { const id = req.params.runId; res.json({ data: { matches: (await store.all('matches')).filter((x) => x.runId === id), exceptions: (await store.all('exceptions')).filter((x) => x.runId === id).map(view) } }); }));

  app.get('/api/exceptions', wrap(async (req, res) => { const { f, rows } = await filtered(req.query); res.json({ data: rows.slice((f.page - 1) * f.pageSize, f.page * f.pageSize).map(view), meta: { page: f.page, pageSize: f.pageSize, total: rows.length, totalPages: Math.ceil(rows.length / f.pageSize) } }); }));
  app.get('/api/exceptions/:id', wrap(async (req, res) => { const e = (await store.all('exceptions')).find((x) => x.exceptionId === req.params.id); if (!e) throw Object.assign(new Error('Exception not found'), { status: 404 }); res.json({ data: view(e), audit: (await store.all('audit')).filter((a) => a.exceptionId === e.exceptionId) }); }));
  const change = async (id, patch, action) => {
    const cur = (await store.all('exceptions')).find((x) => x.exceptionId === id); if (!cur) throw Object.assign(new Error('Exception not found'), { status: 404 });
    const now = new Date().toISOString(); const u = await store.update('exceptions', 'exceptionId', id, { ...patch, updatedAt: now });
    await store.insert('audit', [{ exceptionId: id, action, from: cur.status, to: u.status, note: patch.resolutionNote ?? null, at: now }]); return view(u);
  };
  app.patch('/api/exceptions/:id/status', wrap(async (req, res) => { const b = parse(z.object({ status: z.enum(STATUS), note: z.string().max(1000).optional() }), req.body); res.json({ data: await change(req.params.id, { status: b.status, ...(b.note !== undefined && { resolutionNote: b.note }) }, 'STATUS_CHANGE') }); }));
  app.post('/api/exceptions/:id/notes', wrap(async (req, res) => { const b = parse(z.object({ note: z.string().min(1).max(1000) }), req.body); res.status(201).json({ data: await change(req.params.id, { resolutionNote: b.note }, 'NOTE') }); }));

  const COLS = [['Exception ID', 'exceptionId'], ['Run ID', 'runId'], ['Exception Type', 'exceptionType'], ['Severity', 'severity'], ['Merchant Transaction ID', 'merchantTransactionId'], ['Bank Transaction ID', 'bankTransactionId'], ['Merchant Reference', 'merchantReference'], ['Bank Reference', 'bankReference'], ['Merchant Amount', 'merchantAmount'], ['Bank Amount', 'bankAmount'], ['Difference', 'difference'], ['Currency', 'currency'], ['Status', 'status'], ['Description', 'description'], ['Created At', 'createdAt'], ['Resolution Note', 'resolutionNote']].map(([h, k]) => ({ h, f: (r) => r[k] }));
  const send = async (req, res, fmt, runId) => { const { rows } = await filtered(runId ? { ...req.query, runId } : req.query); const data = rows.map(view), name = `reconflow-exceptions${runId ? '-' + runId : ''}.${fmt}`;
    res.set('Content-Disposition', `attachment; filename="${name}"`); fmt === 'csv' ? res.type('text/csv; charset=utf-8').send(toCsv(COLS, data)) : res.type('application/json').send(JSON.stringify(data, null, 2)); };
  app.get('/api/reports/exceptions.csv', wrap((req, res) => send(req, res, 'csv'))); app.get('/api/reports/exceptions.json', wrap((req, res) => send(req, res, 'json')));
  app.get('/api/reports/reconciliation/:runId.csv', wrap((req, res) => send(req, res, 'csv', req.params.runId))); app.get('/api/reports/reconciliation/:runId.json', wrap((req, res) => send(req, res, 'json', req.params.runId)));

  app.get('/api/dashboard/summary', wrap(async (req, res) => { const runs = (await store.all('runs')).sort((a, b) => b.startedAt.localeCompare(a.startedAt)), ex = await store.all('exceptions'), latest = runs[0];
    const mine = latest ? ex.filter((e) => e.runId === latest.runId) : [], byType = {}; mine.forEach((e) => (byType[e.exceptionType] = (byType[e.exceptionType] || 0) + 1));
    res.json({ data: { latestRun: latest || null, merchantCount: latest?.merchantCount ?? 0, bankCount: latest?.bankCount ?? 0, matchedCount: latest?.matchedCount ?? 0, exceptionCount: mine.length, matchRate: latest?.matchRate ?? 0, totalDiscrepancy: fromMinor(latest?.totalDiscrepancyMinor ?? 0), exceptionsByType: byType, openExceptions: mine.filter((e) => e.status === 'OPEN').length } }); }));
  app.get('/api/settings', wrap(async (req, res) => res.json({ data: (await store.all('settings'))[0] ?? { currency: 'INR', toleranceHours: 24 } })));

  app.get('/api/transactions', wrap(async (req, res) => {
    const f = parse(z.object({ tab: z.enum(['all', 'merchant', 'bank', 'matched', 'unmatched']).default('all'), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), search: z.string().max(100).optional() }), req.query);
    const latest = (await store.all('runs')).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0], ms = latest ? (await store.all('matches')).filter((m) => m.runId === latest.runId) : [];
    const mm = new Map(ms.map((m) => [m.merchantTransactionId, m])), bm = new Map(ms.map((m) => [m.bankTransactionId, m]));
    let rows = [...(await store.all('merchant')).map((r) => ({ ...r, source: 'MERCHANT' })), ...(await store.all('bank')).map((r) => ({ ...r, source: 'BANK' }))].map((r) => { const m = (r.source === 'MERCHANT' ? mm : bm).get(r.transactionId); return { ...r, matched: !!m, counterpartId: m ? (r.source === 'MERCHANT' ? m.bankTransactionId : m.merchantTransactionId) : null, matchReason: m?.reason ?? null }; });
    if (f.tab === 'merchant' || f.tab === 'bank') rows = rows.filter((r) => r.source === f.tab.toUpperCase()); if (f.tab === 'matched') rows = rows.filter((r) => r.matched); if (f.tab === 'unmatched') rows = rows.filter((r) => !r.matched);
    if (f.search) { const t = f.search.toLowerCase(); rows = rows.filter((r) => [r.transactionId, r.merchantReference, r.bankReference].some((v) => v && String(v).toLowerCase().includes(t))); }
    rows.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate)); res.json({ data: rows.slice((f.page - 1) * f.pageSize, f.page * f.pageSize), meta: { page: f.page, pageSize: f.pageSize, total: rows.length, totalPages: Math.ceil(rows.length / f.pageSize), basedOnRun: latest?.runId ?? null } }); }));
  app.patch('/api/settings', wrap(async (req, res) => { const b = parse(z.object({ currency: z.enum(['INR']).default('INR'), toleranceHours: z.number().min(0).max(720) }), req.body); await store.clear('settings'); await store.insert('settings', [b]); res.json({ data: b }); }));
  app.use((req, res) => res.status(404).json({ error: { message: 'Not found' } }));
  app.use((e, req, res, next) => { const s = e.status || 500; res.status(s).json({ error: { message: s === 500 ? 'Internal server error' : e.message, details: e.details } }); }); // no stack traces
  return app;
}
export async function seedStore(store, seed = 42) { for (const c of ['merchant', 'bank', 'runs', 'matches', 'exceptions', 'audit']) await store.clear(c); const d = generate(seed); await store.insert('merchant', d.merchant); await store.insert('bank', d.bank); return { merchant: d.merchant.length, bank: d.bank.length }; }
