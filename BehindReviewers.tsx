import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, BehindRow, TierConfig, CampaignOverviewRow } from "../lib/api";
import { FilterBar, Filters } from "../components/FilterBar";
import { downloadCsv, toCsv } from "../lib/csv";
import { BulkNotifyModal } from "../components/BulkNotifyModal";
import { useMe } from "../lib/useMe";

export function BehindReviewers() {
  const [rows, setRows] = useState<BehindRow[]>([]);
  const [tiers, setTiers] = useState<TierConfig | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignOverviewRow[]>([]);
  const [filters, setFilters] = useState<Filters>({ text: "", status: "all" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notifyOpen, setNotifyOpen] = useState(false);
  const { me } = useMe();

  async function load() {
    setRows(await api.behind());
    try {
      setTiers(await api.getTiers());
    } catch {
      // non-admin; ignore
    }
    setCampaigns((await api.campaigns()).rows);
  }
  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filters.text) {
        const t = filters.text.toLowerCase();
        if (
          !r.reviewerEmail.toLowerCase().includes(t) &&
          !r.reviewerName.toLowerCase().includes(t) &&
          !r.campaignName.toLowerCase().includes(t)
        ) {
          return false;
        }
      }
      if (filters.campaignId && r.campaignId !== filters.campaignId) return false;
      if (filters.tierId && r.tierId !== filters.tierId) return false;
      if (
        filters.minDaysOverdue != null &&
        (r.daysUntilDeadline == null || -r.daysUntilDeadline < filters.minDaysOverdue)
      )
        return false;
      return true;
    });
  }, [rows, filters]);

  function toggle(key: string) {
    const next = new Set(selected);
    next.has(key) ? next.delete(key) : next.add(key);
    setSelected(next);
  }
  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((r) => `${r.reviewerEmail}|${r.campaignId}`)));
  }
  function exportCsv() {
    const csv = toCsv(filtered, [
      "reviewerName",
      "reviewerEmail",
      "campaignName",
      "pending",
      "daysUntilDeadline",
      "tierName",
      "audiences",
    ]);
    downloadCsv("reviewers-behind.csv", csv);
  }

  const selectedRows = filtered.filter((r) =>
    selected.has(`${r.reviewerEmail}|${r.campaignId}`)
  );
  // Group selected by campaign for the notify modal.
  const selectedByCampaign = new Map<string, string[]>();
  for (const r of selectedRows) {
    const list = selectedByCampaign.get(r.campaignId) ?? [];
    list.push(r.reviewerEmail);
    selectedByCampaign.set(r.campaignId, list);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h1>Reviewers behind</h1>
        <div className="row-gap">
          <button className="secondary" onClick={exportCsv} disabled={filtered.length === 0}>
            Export CSV
          </button>
          {me?.roles.includes("admin") && (
            <button onClick={() => setNotifyOpen(true)} disabled={selected.size === 0}>
              Bulk notify ({selected.size})
            </button>
          )}
        </div>
      </div>
      <FilterBar
        value={filters}
        onChange={setFilters}
        campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
        tiers={tiers?.tiers.map((t) => ({ id: t.id, name: t.name })) ?? []}
      />
      <table className="table">
        <thead>
          <tr>
            {me?.roles.includes("admin") && (
              <th>
                <input
                  type="checkbox"
                  checked={selected.size > 0 && selected.size === filtered.length}
                  onChange={toggleAll}
                />
              </th>
            )}
            <th>Reviewer</th>
            <th>Campaign</th>
            <th>Pending</th>
            <th>Time left</th>
            <th>Tier</th>
            <th>Audience on next run</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => {
            const key = `${r.reviewerEmail}|${r.campaignId}`;
            return (
              <tr key={key} className={r.daysUntilDeadline != null && r.daysUntilDeadline < 0 ? "row-danger" : ""}>
                {me?.roles.includes("admin") && (
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={() => toggle(key)}
                    />
                  </td>
                )}
                <td>
                  <Link to={`/profile/${encodeURIComponent(r.reviewerEmail)}`}>{r.reviewerName}</Link>
                  <div className="tiny muted">{r.reviewerEmail}</div>
                </td>
                <td>
                  <Link to={`/campaigns/${r.campaignId}`}>{r.campaignName}</Link>
                </td>
                <td><strong>{r.pending}</strong></td>
                <td>
                  {r.daysUntilDeadline == null
                    ? "—"
                    : r.daysUntilDeadline < 0
                    ? <span className="pill danger">{Math.abs(r.daysUntilDeadline)}d overdue</span>
                    : `${r.daysUntilDeadline}d`}
                </td>
                <td>
                  <span
                    className={`pill ${
                      r.tierId?.startsWith("tier4")
                        ? "danger"
                        : r.tierId === "tier3" || r.tierId === "tier2"
                        ? "warn"
                        : ""
                    }`}
                  >
                    {r.tierName}
                  </span>
                </td>
                <td className="tiny">{r.audiences.join(", ")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {notifyOpen && (
        <BulkNotifyModal
          selectedByCampaign={selectedByCampaign}
          onClose={() => {
            setNotifyOpen(false);
            setSelected(new Set());
          }}
        />
      )}
    </section>
  );
}
