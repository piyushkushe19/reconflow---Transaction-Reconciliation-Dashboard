export const inr = (v) => (v == null || v === '' ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(v)));
export const dt = (s) => (s ? new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
