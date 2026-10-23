// Deterministic synthetic data generator (mulberry32 PRNG). Same seed => identical output.
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function generate(seed = 42, count = 520) {
  const r = rng(seed), pick = (a) => a[Math.floor(r() * a.length)], base = Date.UTC(2026, 8, 1);
  const merchant = [], bank = []; let mi = 10001, bi = 20001;
  const mk = (i, amt, ts) => ({ transactionId: `MER-${mi++}`, merchantReference: `ORD-${10000 + i}`, merchantId: `MERCHANT-00${1 + (i % 5)}`, amount: amt, currency: 'INR', transactionType: 'PAYMENT', status: 'SUCCESS', transactionDate: new Date(ts).toISOString(), paymentMethod: pick(['UPI', 'CARD', 'NETBANKING', 'WALLET']) });
  const bk = (m, o = {}) => ({ transactionId: `BNK-${bi++}`, bankReference: `BANK-REF-${bi + 9000}`, merchantReference: m.merchantReference, amount: m.amount, currency: m.currency, transactionType: 'CREDIT', status: 'SETTLED', transactionDate: m.transactionDate, ...o });
  for (let i = 1; i <= count; i++) {
    const amt = (Math.round((100 + r() * 9900) * 100) / 100).toFixed(2), ts = base + Math.floor(r() * 30 * 86400000), m = mk(i, amt, ts), x = r();
    merchant.push(m);
    if (x < 0.78) bank.push(bk(m));
    else if (x < 0.82) { /* missing in bank */ }
    else if (x < 0.86) { bank.push(bk(m, { amount: (parseFloat(amt) - 100).toFixed(2) })); }
    else if (x < 0.89) { bank.push(bk(m, { currency: 'USD' })); }
    else if (x < 0.92) { bank.push(bk(m, { merchantReference: `ORD-X${10000 + i}` })); }
    else if (x < 0.95) { bank.push(bk(m, { transactionDate: new Date(ts + 6 * 3600000).toISOString() })); }
    else if (x < 0.97) { merchant.push({ ...m, transactionId: `MER-${mi++}` }); bank.push(bk(m)); }
    else if (x < 0.985) { const b = bk(m); bank.push(b, { ...b, transactionId: `BNK-${bi++}` }); }
    else { bank.push(bk({ ...m, merchantReference: `ORD-ORPHAN-${i}`, amount: (parseFloat(amt) + 7.13).toFixed(2) })); }
  }
  return { merchant, bank };
}
