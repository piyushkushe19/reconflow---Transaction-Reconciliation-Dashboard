// RFC4180 quoting + spreadsheet formula-injection guard (prefix risky leading chars with a single quote).
export const cell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (cols, rows) => '\uFEFF' + [cols.map((c) => c.h).join(','), ...rows.map((r) => cols.map((c) => cell(c.f(r))).join(','))].join('\r\n') + '\r\n';
