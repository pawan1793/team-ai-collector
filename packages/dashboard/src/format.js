// Format a USD amount. `null`/undefined cost (unknown model pricing) renders as '—'.
export function fmtUSD(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n > 0 && n < 0.01) return '<$0.01';
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
