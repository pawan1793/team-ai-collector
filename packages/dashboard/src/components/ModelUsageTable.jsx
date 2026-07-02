// Per-user × per-model matrix. One row per member (email), one column per model
// (union across all members' model_distribution), cells show "count (pct%)".
// Pivots the `members` array that App.jsx already loads — no extra fetch.
export default function ModelUsageTable({ members }) {
  const rows = members || [];

  // Build the column set: union of models across all members, keyed by the
  // normalized `model`, keeping the display `label` and a running total for sorting.
  const columnMap = new Map();
  for (const m of rows) {
    for (const d of m.model_distribution || []) {
      const existing = columnMap.get(d.model);
      if (existing) {
        existing.total += Number(d.count) || 0;
      } else {
        columnMap.set(d.model, { model: d.model, label: d.label, total: Number(d.count) || 0 });
      }
    }
  }
  const columns = [...columnMap.values()].sort((a, b) => b.total - a.total);

  if (rows.length === 0 || columns.length === 0) {
    return <div style={{ color: '#8b9cb3', fontSize: 13 }}>No model usage in this range.</div>;
  }

  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 18, marginBottom: 12 }}>Model usage by member</h2>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#8b9cb3' }}>
              <th style={{ padding: '8px 12px', borderBottom: '1px solid #2a3544' }}>Email</th>
              {columns.map((c) => (
                <th key={c.model} style={{ padding: '8px 12px', borderBottom: '1px solid #2a3544' }}>
                  {c.label}
                </th>
              ))}
              <th style={{ padding: '8px 12px', borderBottom: '1px solid #2a3544' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const byModel = new Map(
                (m.model_distribution || []).map((d) => [d.model, d])
              );
              const total = (m.model_distribution || []).reduce(
                (sum, d) => sum + (Number(d.count) || 0),
                0
              );
              return (
                <tr key={m.user_id}>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #1e2836', color: '#3d7eff' }}>
                    {m.email}
                  </td>
                  {columns.map((c) => {
                    const d = byModel.get(c.model);
                    return (
                      <td key={c.model} style={{ padding: '10px 12px', borderBottom: '1px solid #1e2836' }}>
                        {d ? `${Number(d.count).toLocaleString()} (${Number(d.pct)}%)` : '—'}
                      </td>
                    );
                  })}
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #1e2836', fontWeight: 600 }}>
                    {total.toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
