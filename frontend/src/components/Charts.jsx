// Dependency-free SVG charts.
const smooth = (pts) => pts.reduce((d, p, i, a) => {
  if (!i) return `M${p[0]},${p[1]}`;
  const p0 = a[i - 2] || a[i - 1], p2 = a[i + 1] || p;
  const c1 = [a[i - 1][0] + (p[0] - p0[0]) / 6, a[i - 1][1] + (p[1] - p0[1]) / 6];
  const c2 = [p[0] - (p2[0] - a[i - 1][0]) / 6, p[1] - (p2[1] - a[i - 1][1]) / 6];
  return `${d}C${c1},${c2},${p}`;
}, '');
export function LineChart({ series, height = 240, labels = [] }) {
  const W = 600, H = height, max = Math.max(...series.flatMap((s) => s.data)) * 1.1;
  const xy = (s) => s.data.map((v, i) => [(i / (s.data.length - 1)) * W, H - 24 - (v / max) * (H - 40)]);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Trend chart">
        {series.map((s, k) => {
          const p = xy(s), d = smooth(p);
          return (<g key={k}>
            {s.area && <path d={`${d}L${W},${H - 24}L0,${H - 24}Z`} fill={s.color} opacity=".12" />}
            <path d={d} fill="none" stroke={s.color} strokeWidth="3.5" strokeDasharray={s.dash ? '7 7' : undefined} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
          </g>);
        })}
        <line x1="0" x2={W} y1={H - 24} y2={H - 24} stroke="#dbe4ea" />
      </svg>
      <div className="chart-labels">{labels.map((l) => <span key={l}>{l}</span>)}</div>
    </div>
  );
}
export function Ring({ value, label, color = '#e0a21b' }) {
  const r = 80, c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 200 200" role="img" aria-label={`${label} ${value}`}>
      <circle cx="100" cy="100" r="92" fill={color} opacity=".12" />
      <circle cx="100" cy="100" r={r} fill="none" stroke="#eef2f5" strokeWidth="16" />
      <circle cx="100" cy="100" r={r} fill="none" stroke={color} strokeWidth="16" strokeLinecap="round" strokeDasharray={`${(value / 100) * c} ${c}`} transform="rotate(-90 100 100)" />
      <text x="100" y="98" textAnchor="middle" className="ring-n">{value}</text>
      <text x="100" y="122" textAnchor="middle" className="ring-l">{label}</text>
    </svg>
  );
}
export const Bar = ({ pct, color }) => <div className="bar"><i style={{ width: `${pct}%`, background: color }} /></div>;
