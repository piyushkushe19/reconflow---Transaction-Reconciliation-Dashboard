// Decimal-safe conversion: rupees (number|string) -> integer paise. No float arithmetic on money.
export function toMinor(v) {
  const s = String(v).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Invalid amount: ${s}`);
  const neg = s.startsWith('-');
  const [i, f = ''] = s.replace('-', '').split('.');
  const n = parseInt(i, 10) * 100 + parseInt((f + '00').slice(0, 2), 10);
  return neg ? -n : n;
}
export const fromMinor = (m) => (m / 100).toFixed(2);
export const formatINR = (m) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(m / 100);
