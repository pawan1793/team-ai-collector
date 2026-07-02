// Hand-rolled SVG pie chart — avoids adding a chart dependency (the dashboard ships none).
// `data` is [{ label, pct, count, model }]. Percentages are expected to total ~100.
const COLORS = ['#3d7eff', '#36c98f', '#d4a13d', '#b06bff', '#ff6b6b', '#4dd0e1', '#8b9cb3'];

function slicePath(cx, cy, r, startAngle, endAngle) {
  const toXY = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x1, y1] = toXY(startAngle);
  const [x2, y2] = toXY(endAngle);
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}

export function modelColor(index) {
  return COLORS[index % COLORS.length];
}

export default function ModelPie({ data, size = 160 }) {
  const rows = (data || []).filter((d) => Number(d.pct) > 0);
  if (rows.length === 0) {
    return <div style={{ color: '#8b9cb3', fontSize: 13 }}>No model usage in this range.</div>;
  }
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;
  let angle = -Math.PI / 2; // start at 12 o'clock
  const total = rows.reduce((a, d) => a + Number(d.pct), 0) || 1;

  // Single slice (100%) can't be drawn as an arc — render a full circle instead.
  const single = rows.length === 1;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Model usage">
      {single ? (
        <circle cx={cx} cy={cy} r={r} fill={modelColor(0)} />
      ) : (
        rows.map((d, i) => {
          const frac = Number(d.pct) / total;
          const start = angle;
          const end = angle + frac * Math.PI * 2;
          angle = end;
          return <path key={d.model || i} d={slicePath(cx, cy, r, start, end)} fill={modelColor(i)} />;
        })
      )}
    </svg>
  );
}
