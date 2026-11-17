import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, CampaignDetail as CD, CampaignDetailsStats, CampaignDetailsResponse } from "../lib/api";
import { fmtDate, fmtDateShort } from "../lib/fmt";
import { ProgressBar } from "../components/ProgressBar";
import { TrendChart } from "../components/TrendChart";
import { useMe } from "../lib/useMe";
import { downloadCsv, toCsv } from "../lib/csv";

export function CampaignDetail() {
  const { id = "" } = useParams();
  const [data, setData] = useState<CD | null>(null);
  const [stats, setStats] = useState<CampaignDetailsStats | null>(null);
  const [progress, setProgress] = useState<CampaignDetailsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsRefreshing, setStatsRefreshing] = useState(false);
  const pollTimer = useRef<number | undefined>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string>("");
  const { me } = useMe();

  async function loadStats(force = false) {
    if (force) setStatsRefreshing(true);
    else setStatsLoading(true);
    try {
      const res = await api.campaignStats(id, force);
      setProgress(res);
      if (res.status === "ready" && res.data) {
        setStats(res.data);
      } else if (res.status === "fetching") {
        // Schedule a poll
        if (pollTimer.current) window.clearTimeout(pollTimer.current);
        pollTimer.current = window.setTimeout(() => loadStats(false), 2000);
      }
    } finally {
      setStatsLoading(false);
      setStatsRefreshing(false);
    }
  }

  useEffect(() => {
    api.campaignDetail(id).then(setData);
    loadStats(false).catch(() => setStatsLoading(false));
    return () => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    };
  }, [id]);

  if (!data) return <section className="panel">Loading…</section>;

  const reviewerById = new Map(data.reviewers.map((r) => [r.id, r]));
  const reviewerStats = new Map<
    string,
    { total: number; completed: number; email: string; displayName: string }
  >();
  for (const r of data.reviews) {
    const reviewer = reviewerById.get(r.reviewerId);
    if (!reviewer) continue;
    const s = reviewerStats.get(r.reviewerId) ?? {
      total: 0,
      completed: 0,
      email: reviewer.email,
      displayName: reviewer.displayName,
    };
    s.total++;
    if (r.status !== "pending") s.completed++;
    reviewerStats.set(r.reviewerId, s);
  }
  const reviewerList = [...reviewerStats.entries()].map(([id, s]) => ({ id, ...s }));

  function toggleAll() {
    if (selected.size === reviewerList.length) setSelected(new Set());
    else setSelected(new Set(reviewerList.filter((r) => r.total > r.completed).map((r) => r.email)));
  }
  function toggle(email: string) {
    const next = new Set(selected);
    next.has(email) ? next.delete(email) : next.add(email);
    setSelected(next);
  }
  async function notify() {
    setStatus("Sending…");
    try {
      const r = await api.notify(data!.campaign.id, [...selected]);
      setStatus(`Sent ${r.sent}, skipped ${r.skipped}${r.errors.length ? ` — ${r.errors[0]}` : ""}`);
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  }

  function exportReviewerStatsCsv() {
    if (!stats) return;
    downloadCsv(
      `${data!.campaign.name}-reviewers.csv`,
      toCsv(stats.byReviewer, [
        "displayName",
        "email",
        "totalAssigned",
        "approved",
        "revoked",
        "skipped",
        "pending",
        "approvalRate",
      ])
    );
  }
  function exportAppCsv() {
    if (!stats) return;
    downloadCsv(
      `${data!.campaign.name}-by-app.csv`,
      toCsv(stats.byApp, [
        "appName",
        "appId",
        "approved",
        "revoked",
        "skipped",
        "pending",
        "total",
        "approvalRate",
        "percentComplete",
      ])
    );
  }

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h1>{data.campaign.name}</h1>
          <div className="row-gap">
            <span className="tag">{data.campaign.type.replace(/_/g, " ")}</span>
            <span className="muted tiny">Status: {data.campaign.status}</span>
            <span className="muted tiny">Deadline: {fmtDateShort(data.campaign.endDate)}</span>
            {me?.roles.includes("admin") && (
              <button
                className="secondary"
                onClick={() => loadStats(true)}
                disabled={statsRefreshing}
              >
                {statsRefreshing ? "Refreshing…" : "Refresh stats"}
              </button>
            )}
          </div>
        </div>
        <div style={{ margin: "12px 0", maxWidth: 400 }}>
          {/* Prefer task-level counts when available — they're fresher than the
              hourly campaign snapshot and won't show stale progress. */}
          {(() => {
            const total = stats ? stats.tiles.total : data.campaign.totalReviews;
            const completed = stats ? stats.tiles.completed : data.campaign.completedReviews;
            const stale = stats && (
              stats.tiles.total !== data.campaign.totalReviews ||
              stats.tiles.completed !== data.campaign.completedReviews
            );
            return (
              <>
                <ProgressBar value={completed} max={total || 1} />
                <span className="muted tiny">
                  {completed}/{total} reviews completed
                  {stale && (
                    <span
                      title="Campaign snapshot is up to 1 hour old — task stats are live"
                      style={{ marginLeft: 8, color: "#F9A825", cursor: "help" }}
                    >
                      ⚠ snapshot may be stale
                    </span>
                  )}
                </span>
              </>
            );
          })()}
        </div>
      </section>

      {!stats && progress && progress.status === "fetching" && (
        <section className="panel">
          <h2>Fetching task-level stats…</h2>
          <p className="muted tiny">
            Pulling every task from ConductorOne. The page polls every 2 seconds —
            you can leave it open and it'll fill in when ready (cached 15 min after).
          </p>
          <p>
            Pages: <strong>{progress.pages ?? 0}</strong> · Tasks fetched:{" "}
            <strong>{(progress.tasks ?? 0).toLocaleString()}</strong>
            {progress.startedAt && (
              <>
                {" "}
                · Elapsed: <strong>{Math.round((Date.now() - progress.startedAt) / 1000)}s</strong>
              </>
            )}
          </p>
        </section>
      )}
      {!stats && progress && progress.status === "failed" && (
        <section className="panel">
          <p className="pill danger">Stats fetch failed: {progress.err}</p>
          <button onClick={() => loadStats(true)}>Retry</button>
        </section>
      )}
      {!stats && !progress && statsLoading && (
        <section className="panel">
          <p className="muted">Loading…</p>
        </section>
      )}

      {stats && (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>Summary</h2>
              <span className="muted tiny">
                Stats fetched {fmtDate(stats.fetchedAt)} · {stats.totalFetched.toLocaleString()} task(s)
              </span>
            </div>
            <div className="tiles">
              <Tile label="% complete" value={`${stats.tiles.percentComplete}%`} ok={stats.tiles.percentComplete >= 90} />
              <Tile label="Completed" value={stats.tiles.completed.toLocaleString()} />
              <Tile label="Pending" value={stats.tiles.pending.toLocaleString()} warn={stats.tiles.pending > 0} />
              <Tile label="Approved" value={stats.tiles.approved.toLocaleString()} ok />
              <Tile label="Denied / Revoked" value={stats.tiles.revoked.toLocaleString()} danger={stats.tiles.revoked > 0} />
              <Tile label="Skipped" value={stats.tiles.skipped.toLocaleString()} />
              <Tile label="Cancelled" value={stats.tiles.cancelled.toLocaleString()} />
              <Tile label="Avg review time" value={stats.avgReviewTimeDays == null ? "—" : `${stats.avgReviewTimeDays}d`} />
            </div>
          </section>

          <section className="panel">
            <h2>Reviewer progress over time</h2>
            <p className="muted tiny" style={{ marginTop: -4, marginBottom: 8 }}>
              Each line tracks how many reviewers are fully done, in progress, or haven't started yet — by day.
            </p>
            <TrendChart data={stats.trendByDay} />
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Reviews by app</h2>
              <button className="secondary" onClick={exportAppCsv} disabled={stats.byApp.length === 0}>
                Export CSV
              </button>
            </div>
            {stats.byApp.length === 0 ? (
              <p className="muted">No app breakdown available.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>App</th>
                    <th>Approved</th>
                    <th>Denied</th>
                    <th>Skipped</th>
                    <th>Pending</th>
                    <th>Approval rate</th>
                    <th style={{ width: 200 }}>% complete</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byApp.slice(0, 50).map((a) => (
                    <tr key={a.appId}>
                      <td>{a.appName}</td>
                      <td>{a.approved}</td>
                      <td>{a.revoked}</td>
                      <td>{a.skipped}</td>
                      <td>
                        <span className={a.pending > 0 ? "pill warn" : "pill"}>{a.pending}</span>
                      </td>
                      <td>{a.approvalRate}%</td>
                      <td>
                        <ProgressBar value={a.total - a.pending} max={a.total} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Reviewer decisions</h2>
              <div className="row-gap">
                <span className="muted tiny">
                  {stats.reviewersWithOpenTasks} with open · {stats.reviewersWithoutOpenTasks} fully done
                </span>
                <button
                  className="secondary"
                  onClick={exportReviewerStatsCsv}
                  disabled={stats.byReviewer.length === 0}
                >
                  Export CSV
                </button>
              </div>
            </div>
            {stats.byReviewer.length === 0 ? (
              <p className="muted">No reviewer activity yet.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Reviewer</th>
                    <th>Approved</th>
                    <th>Denied</th>
                    <th>Skipped</th>
                    <th>Pending</th>
                    <th>Approval rate</th>
                    <th>Total assigned</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byReviewer.slice(0, 100).map((r) => (
                    <tr key={r.reviewerId}>
                      <td>
                        {r.email ? (
                          <Link to={`/profile/${encodeURIComponent(r.email)}`}>{r.displayName}</Link>
                        ) : (
                          r.displayName
                        )}
                        {r.email && <div className="tiny muted">{r.email}</div>}
                      </td>
                      <td>{r.approved}</td>
                      <td>{r.revoked}</td>
                      <td>{r.skipped}</td>
                      <td>
                        <span className={r.pending > 0 ? "pill warn" : "pill"}>{r.pending}</span>
                      </td>
                      <td>{r.approvalRate}%</td>
                      <td>{r.totalAssigned}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel">
            <h2>Recent activity</h2>
            {stats.recentActivity.length === 0 ? (
              <p className="muted">No completed reviews yet.</p>
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
          </section>
        </>
      )}

      <section className="panel">
        <h2>Reviewers in scope ({reviewerList.length})</h2>
        {me?.roles.includes("admin") && (
          <div className="row-gap" style={{ marginBottom: 10 }}>
            <button onClick={toggleAll} className="secondary">
              {selected.size === reviewerList.length ? "Clear" : "Select all incomplete"}
            </button>
            <button onClick={notify} disabled={selected.size === 0}>
              Notify selected ({selected.size})
            </button>
            <span className="muted tiny">{status}</span>
          </div>
        )}
        <table className="table">
          <thead>
            <tr>
              {me?.roles.includes("admin") && <th></th>}
              <th>Reviewer</th>
              <th>Email</th>
              <th style={{ width: 200 }}>Progress</th>
              <th>Pending</th>
            </tr>
          </thead>
          <tbody>
            {reviewerList.map((r) => (
              <tr key={r.id}>
                {me?.roles.includes("admin") && (
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(r.email)}
                      onChange={() => toggle(r.email)}
                    />
                  </td>
                )}
                <td>
                  <Link to={`/profile/${encodeURIComponent(r.email)}`}>{r.displayName}</Link>
                </td>
                <td>{r.email}</td>
                <td>
                  <ProgressBar value={r.completed} max={r.total} />
                </td>
                <td>{r.total - r.completed}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
