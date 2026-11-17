import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, CampaignOverviewRow, HistoricalCampaignRow } from "../lib/api";
import { fmtDateShort, daysClass } from "../lib/fmt";
import { ProgressBar } from "../components/ProgressBar";
import { useMe } from "../lib/useMe";
import { downloadCsv, toCsv } from "../lib/csv";

type Tab = "active" | "completed";

export function Overview() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "completed" ? "completed" : "active";
  function setTab(next: Tab) {
    if (next === "active") params.delete("tab");
    else params.set("tab", next);
    setParams(params, { replace: true });
  }

  return (
    <>
      <div className="tab-bar" style={{ marginBottom: 16 }}>
        <button className={tab === "active" ? "active" : ""} onClick={() => setTab("active")}>
          Active
        </button>
        <button
          className={tab === "completed" ? "active" : ""}
          onClick={() => setTab("completed")}
        >
          Completed (archive)
        </button>
      </div>
      {tab === "active" ? <ActivePanel /> : <CompletedPanel />}
    </>
  );
}

function ActivePanel() {
  const [rows, setRows] = useState<CampaignOverviewRow[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const { me } = useMe();

  async function load() {
    setLoading(true);
    try {
      const r = await api.campaigns();
      setRows(r.rows);
      setFetchedAt(r.fetchedAt);
    } finally {
      setLoading(false);
    }
  }
  async function onRefresh() {
    setRefreshing(true);
    try {
      await api.refresh();
      await load();
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const f = filter.toLowerCase().trim();
    return f ? rows.filter((r) => r.name.toLowerCase().includes(f) || r.id.toLowerCase().includes(f)) : rows;
  }, [rows, filter]);

  return (
    <section className="panel">
      <div className="panel-head">
        <h1>Active campaigns</h1>
        <div className="row-gap">
          <input
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <span className="muted tiny">
            Last refreshed: {fetchedAt ? fmtDateShort(fetchedAt) : "never"}
          </span>
          {me?.roles.includes("admin") && (
            <button onClick={onRefresh} disabled={refreshing}>
              {refreshing ? "Refreshing…" : "Refresh now"}
            </button>
          )}
        </div>
      </div>
      {loading ? (
        <p className="muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">No active campaigns visible to you.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Type</th>
              <th>Reviewers</th>
              <th>Progress</th>
              <th>Deadline</th>
              <th>Time left</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link to={`/campaigns/${r.id}`}>{r.name}</Link>
                </td>
                <td>
                  <span className="tag">{r.type.replace(/_/g, " ")}</span>
                </td>
                <td>{r.reviewerCount}</td>
                <td>
                  <ProgressBar value={r.completedReviews} max={r.totalReviews || 1} />
                  <span className="muted tiny">
                    {r.completedReviews}/{r.totalReviews}
                  </span>
                </td>
                <td>{fmtDateShort(r.endDate)}</td>
                <td>
                  {r.daysRemaining == null ? (
                    "—"
                  ) : (
                    <span className={daysClass(r.daysRemaining)}>
                      {r.daysRemaining < 0
                        ? `${Math.abs(r.daysRemaining)}d overdue`
                        : `${r.daysRemaining}d`}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

type SortKey = "closedAt" | "name" | "totalReviews" | "completedPct" | "onTimePct";

function CompletedPanel() {
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
        <h1>Completed campaigns</h1>
        <div className="row-gap">
          <input
            placeholder="Filter by name, id, type, date, reviewer…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ minWidth: 280 }}
          />
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="closedAt">Most recent</option>
            <option value="name">Name</option>
            <option value="totalReviews">Largest</option>
            <option value="completedPct">% completed</option>
            <option value="onTimePct">On-time %</option>
          </select>
          <button className="secondary" onClick={exportCsv} disabled={filtered.length === 0}>
            Export CSV
          </button>
        </div>
      </div>
      <p className="muted tiny">
        Closed campaigns from ConductorOne. Last import:{" "}
        {lastImportedAt ? fmtDateShort(lastImportedAt) : "never"}. Showing {filtered.length} of {rows.length}.
      </p>
      {loading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">
          No completed campaigns yet. Admins can click <strong>Import history</strong> in the
          Operations panel to backfill from ConductorOne.
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
