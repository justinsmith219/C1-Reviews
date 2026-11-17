import { useEffect, useState } from "react";
import { api, TierConfig } from "../../lib/api";

const AUDIENCE_OPTS = [
  { value: "reviewer", label: "Reviewer" },
  { value: "manager", label: "Direct manager" },
  { value: "skip", label: "Skip-level (2 up)" },
  { value: "skip_plus_one", label: "Skip +1 (3 up)" },
  { value: "chain_to_ceo", label: "Full chain → CEO" },
  { value: "admin", label: "Admins" },
];

export function TiersPanel() {
  const [tc, setTc] = useState<TierConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    api.getTiers().then(setTc);
  }, []);
  if (!tc) return <section className="panel">Loading…</section>;

  function update(idx: number, patch: Partial<TierConfig["tiers"][0]>) {
    if (!tc) return;
    const tiers = [...tc.tiers];
    tiers[idx] = { ...tiers[idx], ...patch };
    setTc({ tiers });
  }
  function toggleAudience(idx: number, aud: string) {
    if (!tc) return;
    const tier = tc.tiers[idx];
    const set = new Set(tier.audiences);
    set.has(aud) ? set.delete(aud) : set.add(aud);
    update(idx, { audiences: [...set] });
  }
  function addTier() {
    if (!tc) return;
    setTc({
      tiers: [
        ...tc.tiers,
        {
          id: `tier_${Date.now()}`,
          name: "New tier",
          daysUntilDeadlineAtMost: 0,
          frequency: "daily",
          audiences: ["reviewer"],
        },
      ],
    });
  }
  function removeTier(idx: number) {
    if (!tc) return;
    setTc({ tiers: tc.tiers.filter((_, i) => i !== idx) });
  }
  async function save() {
    if (!tc) return;
    setSaving(true);
    try {
      const next = await api.saveTiers(tc);
      setTc(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Escalation tiers</h2>
        <div className="row-gap">
          <button className="secondary" onClick={addTier}>Add tier</button>
          <button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          {saved && <span className="pill ok">Saved</span>}
        </div>
      </div>
      <p className="muted tiny">
        Each row is a tier. A tier becomes active when <em>days until deadline</em> is at or below the threshold.
        Use negative numbers for overdue (e.g. <code>-1</code> means the day after the deadline).
        The most severe matching tier wins. Weekly tiers fire only on Mondays. No notifications on weekends.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Days ≤</th>
            <th>Frequency</th>
            <th>Audiences</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {tc.tiers.map((t, i) => (
            <tr key={t.id}>
              <td>
                <input
                  value={t.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="number"
                  value={t.daysUntilDeadlineAtMost}
                  onChange={(e) => update(i, { daysUntilDeadlineAtMost: parseInt(e.target.value, 10) })}
                  style={{ width: 100 }}
                />
              </td>
              <td>
                <select
                  value={t.frequency}
                  onChange={(e) => update(i, { frequency: e.target.value as any })}
                >
                  <option value="weekly">Weekly (Mon)</option>
                  <option value="daily">Daily</option>
                </select>
              </td>
              <td>
                <div className="row-gap" style={{ flexWrap: "wrap" }}>
                  {AUDIENCE_OPTS.map((a) => (
                    <label key={a.value} className="tiny" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input
                        type="checkbox"
                        checked={t.audiences.includes(a.value)}
                        onChange={() => toggleAudience(i, a.value)}
                      />
                      {a.label}
                    </label>
                  ))}
                </div>
              </td>
              <td>
                <button className="secondary" onClick={() => removeTier(i)}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
