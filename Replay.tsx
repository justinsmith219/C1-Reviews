import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, ReplayBootstrap, ReplaySnapshot, HistoricalCampaignRow } from "../lib/api";
import { fmtDateShort, fmtDate } from "../lib/fmt";
import { ProgressBar } from "../components/ProgressBar";

function toDateInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function Replay() {
  const [archive, setArchive] = useState<HistoricalCampaignRow[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [boot, setBoot] = useState<ReplayBootstrap | null>(null);
  const [asOf, setAsOf] = useState<string>("");
  const [snap, setSnap] = useState<ReplaySnapshot | null>(null);
  const [error, setError] = useState<string>("");
  const [filter, setFilter] = useState("");
  const pollTimer = useRef<number | undefined>();

  // Load archive list once
  useEffect(() => {
    api.historyCampaigns().then((d) => {
      setArchive(d.campaigns.slice().sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? "")));
    });
  }, []);

  // When user picks a campaign, bootstrap the replay.
  useEffect(() => {
    if (!campaignId) {
      setBoot(null);
      setSnap(null);
      return;
    }
    let cancelled = false;
    async function pollBootstrap() {
      try {
        const b = await api.replayBootstrap(campaignId);
        if (cancelled) return;
        setBoot(b);
        if (b.status === "ready") {
          // Default asOf = campaign start, or earliest event.
          const start = b.campaign?.openedAt ?? b.earliestEvent ?? "";
          setAsOf(toDateInput(start) || toDateInput(new Date().toISOString()));
        } else if (b.status === "fetching") {
          if (pollTimer.current) window.clearTimeout(pollTimer.current);
          pollTimer.current = window.setTimeout(pollBootstrap, 2000);
        } else {
          setError(b.err ?? "failed");
        }
      } catch (e: any) {
        setError(e?.message ?? "failed");
      }
    }
    pollBootstrap();
    return () => {
      cancelled = true;
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    };
  }, [campaignId]);

  // When asOf changes, re-fetch snapshot.
  useEffect(() => {
    if (!campaignId || !asOf || boot?.status !== "ready") return;
    let cancelled = false;
    // Send as 12:00 UTC so the ET calendar date matches the date the user picked
    // (UTC midnight would be 8pm ET the previous day).
    api.replayState(campaignId, new Date(asOf + "T12:00:00.000Z").toISOString()).then((res) => {
      if (cancelled) return;
      if ("status" in res && res.status !== undefined) {
        setError(("err" in res && res.err) || `state: ${res.status}`);
      } else {
        setSnap(res as ReplaySnapshot);
        setError("");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [campaignId, asOf, boot?.status]);

  const minDate = boot?.campaign?.openedAt
    ? toDateInput(boot.campaign.openedAt)
    : toDateInput(boot?.earliestEvent);
  const maxDateBase = boot?.campaign?.closedAt ?? boot?.campaign?.deadline ?? boot?.latestEvent;
  const maxDate = maxDateBase
    ? toDateInput(new Date(new Date(maxDateBase).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString())
    : undefined;

  function step(deltaDays: number) {
    if (!asOf) return;
    const d = new Date(asOf + "T00:00:00.000Z");
    d.setUTCDate(d.getUTCDate() + deltaDays);
    const next = d.toISOString().slice(0, 10);
    if (minDate && next < minDate) return;
    if (maxDate && next > maxDate) return;
    setAsOf(next);
  }

  const filteredNotifications = useMemo(() => {
    if (!snap) return [];
    const f = filter.toLowerCase().trim();
    if (!f) return snap.notifications;
    return snap.notifications.filter(
      (n) =>
        n.recipientEmail.includes(f) ||
        n.reviewerEmail.includes(f) ||
        n.reviewerName.toLowerCase().includes(f) ||
        n.recipientReason.includes(f)
    );
  }, [snap, filter]);

  const grouped = useMemo(() => {
    const m = new Map<string, ReplaySnapshot["notifications"]>();
    for (const n of filteredNotifications) {
      const list = m.get(n.recipientEmail) ?? [];
      list.push(n);
      m.set(n.recipientEmail, list);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [filteredNotifications]);

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h1>Campaign replay</h1>
          <span className="muted tiny">
            Step through a closed campaign's timeline and see what the system would do.
            Preview-only — no notifications are ever sent during a replay.
          </span>
        </div>
        <div className="row-gap" style={{ flexWrap: "wrap" }}>
          <label className="tiny muted">
            Campaign
            <select
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              style={{ minWidth: 320 }}
            >
              <option value="">— pick a closed campaign —</option>
              {archive.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.closedAt ? `(${fmtDateShort(c.closedAt)})` : ""}
                </option>
              ))}
            </select>
          </label>
          {boot?.status === "ready" && boot.campaign && (
            <>
              <label className="tiny muted">
                As of
                <input
                  type="date"
                  value={asOf}
                  min={minDate}
                  max={maxDate}
                  onChange={(e) => setAsOf(e.target.value)}
                />
              </label>
              <div className="row-gap">
                <button className="secondary" onClick={() => step(-7)}>‹‹ 1w</button>
                <button className="secondary" onClick={() => step(-1)}>‹ 1d</button>
                <button className="secondary" onClick={() => step(1)}>1d ›</button>
                <button className="secondary" onClick={() => step(7)}>1w ››</button>
              </div>
              <button
                className="secondary"
                onClick={async () => {
                  if (!confirm("Force a full re-fetch of this campaign's tasks from ConductorOne? Replaces the cached data.")) return;
                  setBoot({ status: "fetching", pages: 0, tasks: 0 });
                  setSnap(null);
                  await api.campaignStats(campaignId, true);
                  // Re-bootstrap to pick up the fresh data
                  setCampaignId(campaignId + ""); // trigger effect
                }}
              >
                Force refetch
              </button>
            </>
          )}
        </div>
        {error && <p className="pill danger" style={{ marginTop: 12 }}>{error}</p>}
      </section>

      {boot?.status === "fetching" && (
        <section className="panel">
          <h2>Loading task data…</h2>
          <p className="muted tiny">
            Fetching every task in this campaign from ConductorOne so we can replay its
            timeline. Pages: <strong>{boot.pages ?? 0}</strong> · Tasks:{" "}
            <strong>{(boot.tasks ?? 0).toLocaleString()}</strong>
          </p>
        </section>
      )}

      {snap && boot?.campaign && (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>{snap.campaignName}</h2>
              <span className="muted tiny">
                As of <strong>{fmtDateShort(snap.asOf)}</strong>
                {boot.campaign.openedAt && ` · opened ${fmtDateShort(boot.campaign.openedAt)}`}
                {boot.campaign.closedAt && ` · originally closed ${fmtDateShort(boot.campaign.closedAt)}`}
              </span>
            </div>
            <div className="tiles">
              <Tile label="% complete" value={`${snap.totals.percentComplete}%`} />
              <Tile label="Completed" value={snap.totals.completed.toLocaleString()} />
              <Tile label="Pending" value={snap.totals.pending.toLocaleString()} warn={snap.totals.pending > 0} />
              <Tile
                label="Days until deadline"
                value={
                  snap.daysUntilDeadline == null
                    ? "—"
                    : snap.daysUntilDeadline < 0
                    ? `${Math.abs(snap.daysUntilDeadline)}d overdue`
                    : `${snap.daysUntilDeadline}d`
                }
                danger={snap.daysUntilDeadline != null && snap.daysUntilDeadline < 0}
                warn={snap.daysUntilDeadline != null && snap.daysUntilDeadline >= 0 && snap.daysUntilDeadline <= 3}
              />
              <Tile label="Approved" value={snap.totals.approved.toLocaleString()} />
              <Tile label="Denied" value={snap.totals.revoked.toLocaleString()} danger={snap.totals.revoked > 0} />
            </div>
          </section>

          <section className="panel">
            <h2>Reviewers behind ({snap.reviewers.filter((r) => r.pending > 0).length})</h2>
            {snap.reviewers.filter((r) => r.pending > 0).length === 0 ? (
              <p className="muted">All caught up at this date.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Reviewer</th>
                    <th>Pending</th>
                    <th>Completed</th>
                    <th>Tier</th>
                    <th>Audience on next run</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.reviewers
                    .filter((r) => r.pending > 0)
                    .slice(0, 100)
                    .map((r) => (
                      <tr key={r.email}>
                        <td>
                          <Link to={`/profile/${encodeURIComponent(r.email)}`}>{r.displayName}</Link>
                          <div className="tiny muted">{r.email}</div>
                        </td>
                        <td>
                          <strong>{r.pending}</strong>
                        </td>
                        <td>{r.completed}</td>
                        <td>
                          <span className="pill warn">{r.tierName ?? "—"}</span>
                        </td>
                        <td className="tiny">{r.audiences.join(", ")}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Notifications that would fire on {fmtDateShort(snap.asOf)} ({snap.notifications.length})</h2>
              <input
                placeholder="Filter…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <p className="muted tiny">
              Preview only — nothing is sent. Each row is an outbound notification the
              system would have queued for delivery if the daily digest ran today.
            </p>
            {grouped.length === 0 ? (
              <p className="muted">No notifications would fire at this point.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Recipient</th>
                    <th>Triggered for</th>
                    <th>Reason</th>
                    <th>Tier</th>
                    <th>Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.flatMap(([recipient, items]) =>
                    items.map((n, i) => (
                      <tr key={`${recipient}-${i}`}>
                        <td>
                          {i === 0 ? (
                            <>
                              <Link to={`/profile/${encodeURIComponent(recipient)}`}>{recipient}</Link>
                              <span className="muted tiny"> · {items.length}x</span>
                            </>
                          ) : (
                            <span className="muted tiny">↳</span>
                          )}
                        </td>
                        <td>
                          <Link to={`/profile/${encodeURIComponent(n.reviewerEmail)}`}>{n.reviewerName}</Link>
                        </td>
                        <td>
                          <span className="pill">{n.recipientReason}</span>
                        </td>
                        <td>{n.tierName}</td>
                        <td>{n.pendingCount}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
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
