import { modelColor } from './ModelPie';

// Renders model-usage percentage rows: "Claude Sonnet 4      58%" with a color swatch
// matching the pie chart. `data` is [{ label, pct, count, model }].
export default function ModelBars({ data, showCount = false }) {
  const rows = data || [];
  if (rows.length === 0) {
    return <div style={{ color: '#8b9cb3', fontSize: 13 }}>No model usage in this range.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((d, i) => (
        <div key={d.model || i} style={{ display: 'flex', alignItems: 'center', fontSize: 14 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background: modelColor(i),
              marginRight: 8,
              flexShrink: 0,
            }}
          />
          <span style={{ flex: 1, color: '#cdd6e3' }}>{d.label}</span>
          {showCount && (
            <span style={{ color: '#8b9cb3', marginRight: 12 }}>{Number(d.count).toLocaleString()}</span>
          )}
          <span style={{ fontWeight: 600, minWidth: 44, textAlign: 'right' }}>{Number(d.pct)}%</span>
        </div>
      ))}
    </div>
  );
}
