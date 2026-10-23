import { toMinor } from './money.js';

/**
 * Pure, deterministic reconciliation engine.
 * Assumptions (documented in README):
 *  - Duplicate = same side, same reference, amount, currency, type, status, and timestamps within duplicateWindowMs.
 *    Repeats that differ in amount or time are legitimate separate payments, not duplicates.
 *  - Duplicates are removed from matching first; the earliest record stays the "primary".
 *  - Pass 1 matches by merchantReference (one-to-one, best candidate = equal amount, then closest time).
 *  - Pass 2 (fallback) matches leftovers on currency + amount + time tolerance, only when the pairing is
 *    mutually unique. Ambiguous candidates are NOT matched; they surface as MISSING_* with a note.
 *  - matchRate = clean matches / merchant primary records (percent, 2dp).
 */
const SEV = { AMOUNT_MISMATCH: 'HIGH', CURRENCY_MISMATCH: 'HIGH', MISSING_IN_BANK: 'HIGH', MISSING_IN_MERCHANT: 'HIGH',
  DUPLICATE_MERCHANT: 'MEDIUM', DUPLICATE_BANK: 'MEDIUM', REFERENCE_MISMATCH: 'LOW' };
const t = (r) => new Date(r.transactionDate).getTime();
const prep = (r) => ({ ...r, _minor: toMinor(r.amount), _t: t(r) });

function splitDuplicates(rows, windowMs, side) {
  const primaries = [], dups = [], seen = new Map();
  for (const r of [...rows].sort((a, b) => a._t - b._t || a.transactionId.localeCompare(b.transactionId))) {
    const key = [r.merchantReference, r._minor, r.currency, r.transactionType, r.status].join('|');
    const group = seen.get(key) || [];
    const prim = group.find((p) => Math.abs(p._t - r._t) <= windowMs);
    if (prim) dups.push({ dup: r, primary: prim, side }); else { primaries.push(r); group.push(r); seen.set(key, group); }
  }
  return { primaries, dups };
}

export function reconcile(merchantRaw, bankRaw, opts = {}) {
  const tol = (opts.toleranceHours ?? 24) * 3600000;
  const dupWin = opts.duplicateWindowMs ?? 5 * 60000;
  const M = splitDuplicates(merchantRaw.map(prep), dupWin, 'merchant');
  const B = splitDuplicates(bankRaw.map(prep), dupWin, 'bank');
  const matches = [], exceptions = [];
  const addEx = (type, m, b, description, extra = {}) => exceptions.push({
    exceptionType: type, severity: SEV[type], merchantTransactionId: m?.transactionId ?? null, bankTransactionId: b?.transactionId ?? null,
    merchantReference: m?.merchantReference ?? null, bankReference: b?.bankReference ?? null,
    merchantAmountMinor: m?._minor ?? null, bankAmountMinor: b?._minor ?? null,
    differenceMinor: m && b ? Math.abs(m._minor - b._minor) : (m?._minor ?? b?._minor ?? 0),
    currency: (m || b).currency, status: 'OPEN', description, ...extra });

  for (const { dup, primary, side } of [...M.dups, ...B.dups])
    addEx(side === 'merchant' ? 'DUPLICATE_MERCHANT' : 'DUPLICATE_BANK', side === 'merchant' ? dup : null, side === 'bank' ? dup : null,
      `Duplicate of ${primary.transactionId} (same reference, amount, currency within ${dupWin / 60000} min)`);

  const usedB = new Set(), usedM = new Set();
  const pair = (m, b, reason) => {
    usedM.add(m.transactionId); usedB.add(b.transactionId);
    if (m.currency !== b.currency) addEx('CURRENCY_MISMATCH', m, b, `Currency differs: ${m.currency} vs ${b.currency}`);
    else if (m._minor !== b._minor) addEx('AMOUNT_MISMATCH', m, b, 'Merchant and bank transaction amounts do not match');
    else if (reason === 'AMOUNT_TIME_FALLBACK') addEx('REFERENCE_MISMATCH', m, b, `References differ (${m.merchantReference} vs ${b.merchantReference}); matched on amount/currency/time`);
    else matches.push({ merchantTransactionId: m.transactionId, bankTransactionId: b.transactionId, reason, amountMinor: m._minor, currency: m.currency, timeDiffMs: Math.abs(m._t - b._t) });
  };

  // Pass 1: reference match, one-to-one, best candidate first.
  const byRef = new Map();
  for (const b of B.primaries) (byRef.get(b.merchantReference) ?? byRef.set(b.merchantReference, []).get(b.merchantReference)).push(b);
  const cands = [];
  for (const m of M.primaries) for (const b of byRef.get(m.merchantReference) ?? [])
    cands.push({ m, b, score: [m._minor === b._minor && m.currency === b.currency ? 0 : 1, Math.abs(m._t - b._t)] });
  cands.sort((x, y) => x.score[0] - y.score[0] || x.score[1] - y.score[1] || x.m.transactionId.localeCompare(y.m.transactionId));
  for (const { m, b } of cands) if (!usedM.has(m.transactionId) && !usedB.has(b.transactionId)) pair(m, b, 'REFERENCE');

  // Pass 2: fallback on mutually-unique amount+currency+time candidates.
  const remM = M.primaries.filter((m) => !usedM.has(m.transactionId)), remB = B.primaries.filter((b) => !usedB.has(b.transactionId));
  const ok = (m, b) => m.currency === b.currency && m._minor === b._minor && Math.abs(m._t - b._t) <= tol;
  const ambiguous = new Set();
  for (const m of remM) {
    const bs = remB.filter((b) => ok(m, b));
    if (bs.length === 1 && remM.filter((x) => ok(x, bs[0])).length === 1) pair(m, bs[0], 'AMOUNT_TIME_FALLBACK');
    else if (bs.length) { ambiguous.add(m.transactionId); bs.forEach((b) => ambiguous.add(b.transactionId)); }
  }
  for (const m of M.primaries) if (!usedM.has(m.transactionId))
    addEx('MISSING_IN_BANK', m, null, ambiguous.has(m.transactionId) ? 'No bank match; multiple ambiguous candidates left unmatched' : 'No corresponding bank transaction');
  for (const b of B.primaries) if (!usedB.has(b.transactionId))
    addEx('MISSING_IN_MERCHANT', null, b, ambiguous.has(b.transactionId) ? 'No merchant match; multiple ambiguous candidates left unmatched' : 'No corresponding merchant transaction');

  const byType = {}; for (const e of exceptions) byType[e.exceptionType] = (byType[e.exceptionType] || 0) + 1;
  const n = M.primaries.length;
  return { matches, exceptions, summary: { merchantCount: merchantRaw.length, bankCount: bankRaw.length, matchedCount: matches.length,
    exceptionCount: exceptions.length, exceptionsByType: byType, matchRate: n ? Math.round((matches.length / n) * 10000) / 100 : 0,
    totalDiscrepancyMinor: exceptions.filter((e) => e.exceptionType.endsWith('MISMATCH') && e.exceptionType !== 'REFERENCE_MISMATCH').reduce((s, e) => s + e.differenceMinor, 0) } };
}
