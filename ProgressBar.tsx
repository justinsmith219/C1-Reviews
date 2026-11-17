export function ProgressBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  const cls = pct >= 90 ? "ok" : pct >= 50 ? "mid" : "low";
  return (
    <div className="progress">
      <div className={`progress-fill ${cls}`} style={{ width: `${pct}%` }} />
      <span className="progress-label">{pct}%</span>
    </div>
  );
}
