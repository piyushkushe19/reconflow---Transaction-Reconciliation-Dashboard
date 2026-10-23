import { describe, it, expect } from 'vitest';
import { reconcile } from '../src/services/reconcile.js';
import { toMinor } from '../src/services/money.js';
import { generate } from '../src/services/seed.js';

const M = (id, ref, amt = '100.00', o = {}) => ({ transactionId: id, merchantReference: ref, amount: amt, currency: 'INR', transactionType: 'PAYMENT', status: 'SUCCESS', transactionDate: '2026-09-01T10:00:00Z', ...o });
const B = (id, ref, amt = '100.00', o = {}) => ({ transactionId: id, bankReference: 'BR-' + id, merchantReference: ref, amount: amt, currency: 'INR', transactionType: 'CREDIT', status: 'SETTLED', transactionDate: '2026-09-01T10:00:00Z', ...o });
const types = (r) => r.exceptions.map((e) => e.exceptionType).sort();

describe('reconcile', () => {
  it('perfect match + match rate', () => { const r = reconcile([M('M1', 'A'), M('M2', 'B')], [B('B1', 'A'), B('B2', 'B')]); expect(r.summary.matchedCount).toBe(2); expect(r.summary.matchRate).toBe(100); expect(r.exceptions).toHaveLength(0); });
  it('missing on each side', () => { const r = reconcile([M('M1', 'A')], [B('B1', 'Z', '555.00')]); expect(types(r)).toEqual(['MISSING_IN_BANK', 'MISSING_IN_MERCHANT']); });
  it('duplicates on both sides, counted once', () => { const r = reconcile([M('M1', 'A'), M('M2', 'A')], [B('B1', 'A'), B('B2', 'A')]); expect(types(r)).toEqual(['DUPLICATE_BANK', 'DUPLICATE_MERCHANT']); expect(r.summary.matchedCount).toBe(1); });
  it('legitimate repeated reference (different amount/time) is not a duplicate', () => {
    const r = reconcile([M('M1', 'A', '100.00'), M('M2', 'A', '250.00', { transactionDate: '2026-09-02T10:00:00Z' })], [B('B1', 'A', '100.00'), B('B2', 'A', '250.00', { transactionDate: '2026-09-02T10:00:00Z' })]);
    expect(r.exceptions).toHaveLength(0); expect(r.summary.matchedCount).toBe(2); });
  it('amount and currency mismatch', () => { expect(types(reconcile([M('M1', 'A')], [B('B1', 'A', '90.00')]))).toEqual(['AMOUNT_MISMATCH']); expect(types(reconcile([M('M1', 'A')], [B('B1', 'A', '100.00', { currency: 'USD' })]))).toEqual(['CURRENCY_MISMATCH']); });
  it('reference mismatch via fallback within tolerance, not outside', () => {
    expect(types(reconcile([M('M1', 'A')], [B('B1', 'X', '100.00', { transactionDate: '2026-09-01T20:00:00Z' })]))).toEqual(['REFERENCE_MISMATCH']);
    expect(types(reconcile([M('M1', 'A')], [B('B1', 'X', '100.00', { transactionDate: '2026-09-03T10:00:00Z' })]))).toEqual(['MISSING_IN_BANK', 'MISSING_IN_MERCHANT']); });
  it('ambiguous fallback candidates are not matched; no one-to-many', () => {
    const r = reconcile([M('M1', 'A')], [B('B1', 'X'), B('B2', 'Y', '100.00', { transactionDate: '2026-09-01T11:00:00Z' })]);
    expect(r.summary.matchedCount).toBe(0); expect(r.exceptions.filter((e) => e.description.includes('ambiguous'))).toHaveLength(3);
    const r2 = reconcile([M('M1', 'A'), M('M2', 'A', '100.00', { transactionDate: '2026-09-01T12:00:00Z' })], [B('B1', 'A')]);
    expect(new Set(r2.matches.map((m) => m.bankTransactionId)).size).toBe(r2.matches.length); });
  it('decimal precision', () => { expect(toMinor('0.10') + toMinor('0.20')).toBe(30); expect(reconcile([M('M1', 'A', '1299.50')], [B('B1', 'A', '1299.5')]).summary.matchedCount).toBe(1); });
  it('repeated runs are identical; seed is deterministic and covers all types', () => {
    const d = generate(42); expect(generate(42)).toEqual(d); expect(d.merchant.length).toBeGreaterThanOrEqual(500); expect(d.bank.length).toBeGreaterThanOrEqual(500);
    const a = reconcile(d.merchant, d.bank), b = reconcile(d.merchant, d.bank); expect(a).toEqual(b);
    expect(Object.keys(a.summary.exceptionsByType).sort()).toEqual(['AMOUNT_MISMATCH', 'CURRENCY_MISMATCH', 'DUPLICATE_BANK', 'DUPLICATE_MERCHANT', 'MISSING_IN_BANK', 'MISSING_IN_MERCHANT', 'REFERENCE_MISMATCH']); });
});
