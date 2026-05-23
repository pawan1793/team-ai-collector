export default function KpiCard({ label, value, sub, onClick }) {
  return (
    <div className={`card px-3 py-2${onClick ? ' cursor-pointer hover:opacity-80 transition' : ''}`} onClick={onClick}>
      <div className="text-base font-bold" style={{ color: onClick ? 'var(--c-accent)' : 'var(--c-white)' }}>{value}</div>
      <div className="text-[11px]" style={{ color: 'var(--c-text2)' }}>{label}</div>
      {sub && <div className="text-[10px] mt-0.5" style={{ color: 'var(--c-text3)' }}>{sub}</div>}
    </div>
  )
}
