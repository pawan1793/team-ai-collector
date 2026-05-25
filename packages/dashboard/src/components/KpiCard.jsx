export default function KpiCard({ label, value }) {
  return (
    <div
      style={{
        background: '#1a2332',
        border: '1px solid #2a3544',
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 12, color: '#8b9cb3', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
