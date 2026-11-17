import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, HistoricalCampaignRow, CampaignDetailsStats } from "../lib/api";
import { fmtDate, fmtDateShort } from "../lib/fmt";
import { ProgressBar } from "../components/ProgressBar";
import { TrendChart } from "../components/TrendChart";
import { downloadCsv, toCsv } from "../lib/csv";

export function HistoryDetail() {
  const { id = "" } = useParams();
  const [row, setRow] = useState<HistoricalCampaignRow | null>(null);
  const [stats, setStats] = useState<CampaignDetailsStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsError, setStatsError] = useState("");

  useEffect(() => {
    api.historyCampaigns().then((d) => {
      setRow(d.campaigns.find((c) => c.id === id) ?? null);
    });
  }, [id]);

  if (!row) return <section className="panel">Loading…</section>;

  async function loadDeepStats(force = false) {
    setLoadingStats(true);
    setStatsError("");
    try {
      const res = await api.campaignStats(id, force);
      if (res.status === "ready" && res.data) {
        setStats(res.data);
      } else if (res.status === "fetching") {
        // Poll until ready
        setStatsError(`Fetching… ${res.tasks ?? 0} tasks fetched, checking again in 2s`);
        setTimeout(() => loadDeepStats(false), 2000);
      } else if (res.status === "failed") {
        setStatsError(res.err ?? "failed");
      }
    } catch (e: any) {
      setStatsError(e?.message ?? "failed to load stats");
    } finally {
      setLoadingStats(false);
    }
  }

  const completedPct = row.totalReviews
    ? Math.round((row.completedReviews / row.totalReviews) * 100)
    : 0;
  const onTimePct = row.totalReviews
    ? Math.round((row.onTimeReviews / row.totalReviews) * 100)
    : 0;

  function exportReviewersCsv() {
    if (!row) return;
    downloadCsv(
      `${row.name}-reviewers.csv`,
      toCsv(row.reviewerCompletion, ["email", "assigned", "completed", "onTime"])
    );
  }

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h1>{row.name}</h1>
          <div className="row-gap">
            <span className="tag">closed</span>
            <span className="muted tiny">
              {fmtDateShort(row.openedAt)} → {fmtDateShort(row.closedAt)}
            </span>
            <span className="muted tiny">Deadline: {fmtDateShort(row.deadline)}</span>
          </div>
        </div>

        <div className="tiles">
          <Tile label="Total reviews" value={row.totalReviews.toLocaleString()} />
          <Tile label="Completed" value={row.completedReviews.toLocaleString()} ok={completedPct >= 90} />
          <Tile label="Completed %" value={`${completedPct}%`} ok={completedPct >= 90} warn={completedPct < 90 && completedPct >= 60} danger={completedPct < 60} />
          <Tile label="On-time" value={row.onTimeReviews.toLocaleString()} />
          <Tile label="On-time %" value={`${onTimePct}%`} ok={onTimePct >= 90} warn={onTimePct < 90 && onTimePct >= 60} danger={onTimePct < 60} />
          <Tile label="Reviewers" value={row.reviewerCompletion.length.toLocaleString()} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Per-reviewer completion (from import)</h2>
          <button className="secondary" onClick={exportReviewersCsv} disabled={row.reviewerCompletion.length === 0}>
            Export CSV
          </button>
        </div>
        {row.reviewerCompletion.length === 0 ? (
          <p className="muted">No reviewer data captured during import.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Reviewer</th>
                <th>Assigned</th>
                <th>Completed</th>
                <th>On-time</th>
                <th style={{ width: 200 }}>% completed</th>
                <th style={{ width: 200 }}>% on-time</th>
              </tr>
            </thead>
            <tbody>
              {row.reviewerCompletion
                .slice()
                .sort((a, b) => b.assigned - a.assigned)
                .map((r) => {
                  const cPct = r.assigned ? Math.round((r.completed / r.assigned) * 100) : 0;
                  const otPct = r.assigned ? Math.round((r.onTime / r.assigned) * 100) : 0;
                  return (
                    <tr key={r.email}>
                      <td>
                        <Link to={`/profile/${encodeURIComponent(r.email)}`}>{r.email}</Link>
                      </td>
                      <td>{r.assigned}</td>
                      <td>{r.completed}</td>
                      <td>{r.onTime}</td>
                      <td>
                        <ProgressBar value={r.completed} max={r.assigned || 1} />
                      </td>
                      <td>
                        <ProgressBar value={r.onTime} max={r.assigned || 1} />
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Deep stats</h2>
          <div className="row-gap">
            {!stats && !loadingStats && (
              <button onClick={() => loadDeepStats(false)}>
                Load full task-level stats
              </button>
            )}
            {stats && (
              <button className="secondary" onClick={() => loadDeepStats(true)} disabled={loadingStats}>
                {loadingStats ? "Refreshing…" : "Refresh"}
              </button>
            )}
            {statsError && <span className="pill danger">{statsError}</span>}
          </div>
        </div>
        {!stats && !loadingStats && (
          <p className="muted tiny">
            On demand: fetch every task in this campaign from ConductorOne to populate
            the activity feed, app breakdown, trend chart, and per-decision counts.
            Cached 15 minutes after first load.
          </p>
        )}
        {loadingStats && <p className="muted">Loading task-level stats… large campaigns can take several minutes.</p>}
        {stats && (
          <>
            <div className="tiles" style={{ marginBottom: 14 }}>
              <Tile label="Approved" value={stats.tiles.approved.toLocaleString()} />
              <Tile label="Denied" value={stats.tiles.revoked.toLocaleString()} danger={stats.tiles.revoked > 0} />
              <Tile label="Skipped" value={stats.tiles.skipped.toLocaleString()} />
              <Tile label="Cancelled" value={stats.tiles.cancelled.toLocaleString()} />
              <Tile label="Avg review time" value={stats.avgReviewTimeDays == null ? "—" : `${stats.avgReviewTimeDays}d`} />
              <Tile label="Tasks fetched" value={stats.totalFetched.toLocaleString()} />
            </div>

            <h3>Open reviews over time</h3>
            <TrendChart data={stats.trendByDay} />

            <h3 style={{ marginTop: 20 }}>Reviews by app</h3>
            {stats.byApp.length === 0 ? (
              <p className="muted">No app breakdown.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>App</th>
                    <th>Approved</th>
                    <th>Denied</th>
                    <th>Skipped</th>
                    <th>Approval rate</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byApp.slice(0, 30).map((a) => (
                    <tr key={a.appId}>
                      <td>{a.appName}</td>
                      <td>{a.approved}</td>
                      <td>{a.revoked}</td>
                      <td>{a.skipped}</td>
                      <td>{a.approvalRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h3 style={{ marginTop: 20 }}>Recent activity (last 50)</h3>
            {stats.recentActivity.length === 0 ? (
              <p className="muted">None.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Reviewer</th>
                    <th>App</th>
                    <th>Entitlement</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentActivity.map((a) => (
                    <tr key={a.taskId}>
                      <td>{fmtDate(a.closedAt)}</td>
                      <td>
                        {a.reviewerEmail ? (
                          <Link to={`/profile/${encodeURIComponent(a.reviewerEmail)}`}>
                            {a.reviewerName ?? a.reviewerEmail}
                          </Link>
                        ) : (
                          a.reviewerName ?? "—"
                        )}
                      </td>
                      <td>{a.appName ?? "—"}</td>
                      <td>{a.entitlement ?? "—"}</td>
                      <td>
                        <span
                          className={`pill ${
                            a.outcome === "approved"
                              ? "ok"
                              : a.outcome === "revoked"
                              ? "danger"
                              : ""
                          }`}
                        >
                          {a.outcome}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>
    </>
  );
}

function Tile({
  label,
  value,
  ok,
  warn,
  danger,
}: {
  label: string;
  value: string | number;
  ok?: boolean;
  warn?: boolean;
  danger?: boolean;
}) {
  return (
    <div className={`tile ${ok ? "tile-ok" : ""} ${warn ? "tile-warn" : ""} ${danger ? "tile-danger" : ""}`}>
      <div className="tile-value">{value}</div>
      <div className="tile-label">{label}</div>
    </div>
  );
}
