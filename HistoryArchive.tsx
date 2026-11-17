import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, HistoricalCampaignRow } from "../lib/api";
import { fmtDateShort, fmtDate } from "../lib/fmt";
import { ProgressBar } from "../components/ProgressBar";
import { downloadCsv, toCsv } from "../lib/csv";

type SortKey =
  | "closedAt"
  | "name"
  | "totalReviews"
  | "completedReviews"
  | "onTimePct"
  | "completedPct";

export function HistoryArchive() {
  const [rows, setRows] = useState<HistoricalCampaignRow[]>([]);
  const [lastImportedAt, setLastImportedAt] = useState<string | undefined>();
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortKey>("closedAt");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.historyCampaigns().then((d) => {
      setRows(d.campaigns);
      setLastImportedAt(d.lastImportedAt);
      setLoading(false);
    });
  }, []);

  const enriched = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        completedPct: r.totalReviews ? Math.round((r.completedReviews / r.totalReviews) * 100) : 0,
        onTimePct: r.totalReviews ? Math.round((r.onTimeReviews / r.totalReviews) * 100) : 0,
      })),
    [rows]
  );

  const filtered = useMemo(() => {
    const f = filter.toLowerCase().trim();
    let out = !f
      ? enriched
      : enriched.filter((r) => {
          if (r.name.toLowerCase().includes(f)) return true;
          if (r.id.toLowerCase().includes(f)) return true;
          if ((r.type ?? "").toLowerCase().includes(f)) return true;
          if ((r.openedAt ?? "").includes(f)) return true;
          if ((r.closedAt ?? "").includes(f)) return true;
          if ((r.deadline ?? "").includes(f)) return true;
          if (r.reviewerCompletion.some((rv) => rv.email.toLowerCase().includes(f))) return true;
          return false;
        });
    out = [...out].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "closedAt") return (b.closedAt ?? "").localeCompare(a.closedAt ?? "");
      const k = sort as Exclude<SortKey, "name" | "closedAt">;
      return (b as any)[k] - (a as any)[k];
    });
    return out;
  }, [enriched, filter, sort]);

  function exportCsv() {
    downloadCsv(
      "campaign-archive.csv",
      toCsv(
        filtered.map((r) => ({
          name: r.name,
          openedAt: r.openedAt ?? "",
          closedAt: r.closedAt ?? "",
          deadline: r.deadline ?? "",
          totalReviews: r.totalReviews,
          completedReviews: r.completedReviews,
          onTimeReviews: r.onTimeReviews,
          completedPct: r.completedPct,
          onTimePct: r.onTimePct,
        })),
        [
          "name",
          "openedAt",
          "closedAt",
          "deadline",
          "totalReviews",
          "completedReviews",
          "onTimeReviews",
          "completedPct",
          "onTimePct",
        ]
      )
    );
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h1>Campaign archive</h1>
        <div className="row-gap">
          <input
            placeholder="Filter by name, id, type, date, reviewer…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ minWidth: 280 }}
          />
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="closedAt">Sort: most recent</option>
            <option value="name">Sort: name</option>
            <option value="totalReviews">Sort: largest</option>
            <option value="completedPct">Sort: % completed</option>
            <option value="onTimePct">Sort: on-time %</option>
          </select>
          <button className="secondary" onClick={exportCsv} disabled={filtered.length === 0}>
            Export CSV
          </button>
        </div>
      </div>
      <p className="muted tiny">
        Closed campaigns imported from ConductorOne. Last import:{" "}
        {lastImportedAt ? fmtDate(lastImportedAt) : "never"}. Showing {filtered.length} of {rows.length}.
      </p>
      {loading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">
          No historical campaigns yet. Admins can import them from{" "}
          <strong>Admin → Operations → Import history</strong>.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Opened</th>
              <th>Closed</th>
              <th>Deadline</th>
              <th>Total reviews</th>
              <th>Completed</th>
              <th>On-time</th>
              <th style={{ width: 180 }}>% complete</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link to={`/history/${r.id}`}>{r.name}</Link>
                </td>
                <td>{fmtDateShort(r.openedAt)}</td>
                <td>{fmtDateShort(r.closedAt)}</td>
                <td>{fmtDateShort(r.deadline)}</td>
                <td>{r.totalReviews.toLocaleString()}</td>
                <td>{r.completedReviews.toLocaleString()}</td>
                <td>
                  <span
                    className={`pill ${
                      r.onTimePct >= 90 ? "ok" : r.onTimePct >= 60 ? "warn" : "danger"
                    }`}
                  >
                    {r.onTimePct}%
                  </span>
                </td>
                <td>
                  <ProgressBar value={r.completedReviews} max={r.totalReviews || 1} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
