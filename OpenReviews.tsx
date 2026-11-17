import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  api,
  BehindRow,
  TierConfig,
  CampaignOverviewRow,
  ImpactedRow,
  LeaderboardRow,
  BatchChange,
  BatchResult,
} from "../lib/api";
import { FilterBar, Filters } from "../components/FilterBar";
import { downloadCsv, toCsv } from "../lib/csv";
import { BulkNotifyModal } from "../components/BulkNotifyModal";
import { useMe } from "../lib/useMe";
import { ProgressBar } from "../components/ProgressBar";

type Tab = "reviewers" | "entitlements" | "accounts";

export function OpenReviews() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab") ?? "";
  // "impacted" was the legacy slug for the entitlements tab — keep working.
  const tab: Tab =
    raw === "accounts"
      ? "accounts"
      : raw === "entitlements" || raw === "impacted"
      ? "entitlements"
      : "reviewers";
  function setTab(next: Tab) {
    if (next === "reviewers") params.delete("tab");
    else params.set("tab", next);
    setParams(params, { replace: true });
  }
  return (
    <>
      <div className="tab-bar" style={{ marginBottom: 16 }}>
        <button
          className={tab === "reviewers" ? "active" : ""}
          onClick={() => setTab("reviewers")}
        >
          Reviewers
        </button>
        <button
          className={tab === "entitlements" ? "active" : ""}
          onClick={() => setTab("entitlements")}
        >
          Impacted entitlements
        </button>
        <button
          className={tab === "accounts" ? "active" : ""}
          onClick={() => setTab("accounts")}
        >
          Impacted accounts
        </button>
      </div>
      {tab === "reviewers" && <ReviewersPanel />}
      {tab === "entitlements" && <ImpactedPanel />}
      {tab === "accounts" && <ImpactedAccountsPanel />}
    </>
  );
}

function ReviewersPanel() {
  const [rows, setRows] = useState<BehindRow[]>([]);
  const [tiers, setTiers] = useState<TierConfig | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignOverviewRow[]>([]);
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [filters, setFilters] = useState<Filters>({ text: "", status: "all" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notifyOpen, setNotifyOpen] = useState(false);
  const { me } = useMe();

  async function load() {
    const [behind, board, camps] = await Promise.all([
      api.behind(),
      api.leaderboard(),
      api.campaigns(),
    ]);
    setRows(behind);
    setBoard(board);
    setCampaigns(camps.rows);
    try {
      setTiers(await api.getTiers());
    } catch {
      // non-admin
    }
  }
  useEffect(() => {
    load();
  }, []);

  // Index leaderboard by reviewer email so per-row enrichment is O(1).
  const leaderboardByEmail = useMemo(() => {
    const m = new Map<string, LeaderboardRow>();
    for (const r of board) m.set(r.email, r);
    return m;
  }, [board]);

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
      ) {
        return false;
      }
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
    const enriched = filtered.map((r) => {
      const lb = leaderboardByEmail.get(r.reviewerEmail);
      return {
        reviewerName: r.reviewerName,
        reviewerEmail: r.reviewerEmail,
        campaignName: r.campaignName,
        pending: r.pending,
        daysUntilDeadline: r.daysUntilDeadline,
        tierName: r.tierName ?? "",
        audiences: r.audiences.join(", "),
        totalAssigned: lb?.totalAssigned ?? "",
        totalCompleted: lb?.completed ?? "",
        percentComplete: lb?.percentComplete ?? "",
        pendingAcrossCampaigns: lb?.pendingAcrossCampaigns ?? "",
        campaignsActive: lb?.campaignIds.length ?? "",
      };
    });
    downloadCsv(
      "open-reviewers.csv",
      toCsv(enriched, [
        "reviewerName",
        "reviewerEmail",
        "campaignName",
        "pending",
        "daysUntilDeadline",
        "tierName",
        "audiences",
        "totalAssigned",
        "totalCompleted",
        "percentComplete",
        "pendingAcrossCampaigns",
        "campaignsActive",
      ])
    );
  }

  const selectedRows = filtered.filter((r) =>
    selected.has(`${r.reviewerEmail}|${r.campaignId}`)
  );
  const selectedByCampaign = new Map<string, string[]>();
  for (const r of selectedRows) {
    const list = selectedByCampaign.get(r.campaignId) ?? [];
    list.push(r.reviewerEmail);
    selectedByCampaign.set(r.campaignId, list);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h1>Reviewers with open reviews</h1>
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
            <th>Pending<br/><span className="tiny muted">(this campaign)</span></th>
            <th>Time left</th>
            <th>Tier</th>
            <th>Audience next run</th>
            <th>Assigned<br/><span className="tiny muted">(all open)</span></th>
            <th>Completed<br/><span className="tiny muted">(all open)</span></th>
            <th style={{ width: 140 }}>Progress<br/><span className="tiny muted">(all open)</span></th>
            <th>Open campaigns</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => {
            const key = `${r.reviewerEmail}|${r.campaignId}`;
            const lb = leaderboardByEmail.get(r.reviewerEmail);
            return (
              <tr
                key={key}
                className={r.daysUntilDeadline != null && r.daysUntilDeadline < 0 ? "row-danger" : ""}
              >
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
                <td>
                  <strong>{r.pending}</strong>
                </td>
                <td>
                  {r.daysUntilDeadline == null ? (
                    "—"
                  ) : r.daysUntilDeadline < 0 ? (
                    <span className="pill danger">{Math.abs(r.daysUntilDeadline)}d overdue</span>
                  ) : (
                    `${r.daysUntilDeadline}d`
                  )}
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
                <td>{lb?.totalAssigned ?? "—"}</td>
                <td>{lb?.completed ?? "—"}</td>
                <td>
                  {lb ? <ProgressBar value={lb.completed} max={lb.totalAssigned || 1} /> : "—"}
                </td>
                <td>{lb?.campaignIds.length ?? "—"}</td>
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

function ImpactedPanel() {
  const [rows, setRows] = useState<ImpactedRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [campaignId, setCampaignId] = useState<string>("");
  const [text, setText] = useState("");

  useEffect(() => {
    Promise.all([api.impacted(), api.campaigns()])
      .then(([r, c]) => {
        setRows(r);
        setCampaigns(c.rows);
      })
      .finally(() => setLoading(false));
  }, []);

  // Build campaign id → name from the overview snapshot for nicer labels.
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of campaigns) m.set(c.id, c.name);
    return m;
  }, [campaigns]);

  const filtered = useMemo(() => {
    const t = text.toLowerCase().trim();
    return rows.filter((r) => {
      if (campaignId && !r.campaignIds.includes(campaignId)) return false;
      if (!t) return true;
      if (r.subjectName.toLowerCase().includes(t)) return true;
      if (r.subjectEmail.toLowerCase().includes(t)) return true;
      if (r.entitlements.some((e) => e.toLowerCase().includes(t))) return true;
      if (r.reviewers.some((rv) => rv.email.toLowerCase().includes(t) || rv.displayName.toLowerCase().includes(t)))
        return true;
      return false;
    });
  }, [rows, campaignId, text]);

  return (
    <section className="panel">
      <div className="panel-head">
        <h1>Impacted accounts</h1>
        <div className="row-gap">
          <input
            placeholder="Filter user, email, entitlement, reviewer…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            style={{ minWidth: 280 }}
          />
          <select
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            style={{ minWidth: 240 }}
          >
            <option value="">All campaigns</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="muted tiny">
        Users whose access may be revoked if reviews are not completed in time. Sorted
        by risk (high first). Showing {filtered.length} of {rows.length}.
      </p>
      {loading ? (
        <p className="muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">Nothing matches your filter.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Entitlements</th>
              <th>Reviewer(s)</th>
              <th>Campaigns</th>
              <th>Risk</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.subjectEmail}>
                <td>{r.subjectName}</td>
                <td>{r.subjectEmail}</td>
                <td>
                  {r.entitlements.slice(0, 3).join(", ")}
                  {r.entitlements.length > 3 && ` +${r.entitlements.length - 3} more`}
                </td>
                <td>
                  {r.reviewers.length === 0 ? (
                    <span className="muted">—</span>
                  ) : (
                    r.reviewers.map((rv, i) => (
                      <span key={rv.email}>
                        {i > 0 && ", "}
                        <Link to={`/profile/${encodeURIComponent(rv.email)}`}>
                          {rv.displayName}
                        </Link>
                      </span>
                    ))
                  )}
                </td>
                <td title={r.campaignIds.map((id) => nameById.get(id) ?? id).join(", ")}>
                  {r.campaignIds.length}
                </td>
                <td>
                  <span
                    className={`pill ${
                      r.riskLevel === "high"
                        ? "danger"
                        : r.riskLevel === "medium"
                        ? "warn"
                        : ""
                    }`}
                  >
                    {r.riskLevel}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// Staged change: which systems are being toggled and to what state.
type StagedChange = { azure?: boolean; ad?: boolean };

function ImpactedAccountsPanel() {
  const [rows, setRows] = useState<ImpactedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");

  // Batch staging — cleared on reload (Map not persisted).
  const [staged, setStaged] = useState<Map<string, StagedChange>>(new Map());
  const [showReview, setShowReview] = useState(false);
  const [applying, setApplying] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  // Snapshot of staged before apply so we can describe what changed in the result banner.
  const [stagedSnapshot, setStagedSnapshot] = useState<Map<string, StagedChange> | null>(null);

  // Per-email Azure status override (post-apply).
  const [statusOverride, setStatusOverride] = useState<Record<string, boolean | null>>({});
  const [refreshingAll, setRefreshingAll] = useState(false);

  // Per-email AD status override (post-apply).
  const [adStatusOverride, setAdStatusOverride] = useState<Record<string, boolean | "not_found" | null>>({});

  const { me } = useMe();

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.impacted();
      setRows(data);
      // Kick off status hydration in the background after the list renders.
      if (data.length > 0) refreshStatusesForEmails(data.map((r) => r.subjectEmail));
    } catch (err: any) {
      setLoadError(err?.message ?? "Failed to load impacted accounts");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  // Dedupe to one row per user (a person could appear in multiple entitlement rows
  // already; impacted() collapses by subject, so this is a passthrough — but we
  // sort by overdue first so the worst cases bubble to the top).
  const filtered = useMemo(() => {
    const t = text.toLowerCase().trim();
    const list = !t
      ? rows
      : rows.filter(
          (r) =>
            r.subjectName.toLowerCase().includes(t) ||
            r.subjectEmail.toLowerCase().includes(t)
        );
    return [...list].sort((a, b) => {
      const ad = a.daysRemaining ?? 9999;
      const bd = b.daysRemaining ?? 9999;
      return ad - bd; // most-overdue (smallest, often negative) first
    });
  }, [rows, text]);

  /** Stage (or unstage) a single account toggle. Does not apply immediately. */
  function stageToggle(email: string, system: "azure" | "ad", liveState: boolean) {
    setBatchResult(null);
    setStaged((prev) => {
      const next = new Map(prev);
      const existing = next.get(email) ?? {};
      if (system in existing) {
        // Already staged for this system — unstage it.
        const remaining: StagedChange = { ...existing };
        delete remaining[system];
        if (Object.keys(remaining).length === 0) next.delete(email);
        else next.set(email, remaining);
      } else {
        next.set(email, { ...existing, [system]: !liveState });
      }
      return next;
    });
  }

  async function applyBatch() {
    const changes: BatchChange[] = [];
    for (const [email, sc] of staged) {
      const row = rows.find((r) => r.subjectEmail === email);
      const change: BatchChange = { email, campaignIds: row?.campaignIds ?? [] };
      if (sc.azure !== undefined) change.azure = sc.azure;
      if (sc.ad !== undefined) change.ad = sc.ad;
      changes.push(change);
    }
    if (changes.length === 0) return;
    setStagedSnapshot(new Map(staged));
    setApplying(true);
    try {
      const result = await api.batchSetEnabled(changes);
      setBatchResult(result);
      setShowReview(false);
      // Collect what succeeded so we can update status overrides and clear staged.
      const azureUpdates: Record<string, boolean> = {};
      const adUpdates: Record<string, boolean> = {};
      const succeededAzure = new Set<string>();
      const succeededAd = new Set<string>();
      for (const s of result.succeeded) {
        const sc = staged.get(s.email);
        if (s.azure?.ok && sc?.azure !== undefined) {
          azureUpdates[s.email] = sc.azure;
          succeededAzure.add(s.email);
        }
        if (s.ad?.ok && sc?.ad !== undefined) {
          adUpdates[s.email] = sc.ad;
          succeededAd.add(s.email);
        }
      }
      if (Object.keys(azureUpdates).length > 0)
        setStatusOverride((prev) => ({ ...prev, ...azureUpdates }));
      if (Object.keys(adUpdates).length > 0)
        setAdStatusOverride((prev) => ({ ...prev, ...adUpdates }));
      setStaged((prev) => {
        const next = new Map(prev);
        for (const email of new Set([...succeededAzure, ...succeededAd])) {
          const existing = next.get(email);
          if (!existing) continue;
          const remaining: StagedChange = { ...existing };
          if (succeededAzure.has(email)) delete remaining.azure;
          if (succeededAd.has(email)) delete remaining.ad;
          if (Object.keys(remaining).length === 0) next.delete(email);
          else next.set(email, remaining);
        }
        return next;
      });
    } catch (e: any) {
      alert(`Batch apply failed: ${e?.message ?? "unknown error"}`);
    } finally {
      setApplying(false);
    }
  }

  async function refreshStatusesForEmails(emails: string[]) {
    if (emails.length === 0) return;
    setRefreshingAll(true);
    try {
      const CONCURRENCY = 6;
      let i = 0;
      await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
          while (true) {
            const idx = i++;
            if (idx >= emails.length) return;
            const email = emails[idx];
            await Promise.all([
              api.accountStatus(email)
                .then((s) => setStatusOverride((prev) => ({ ...prev, [email]: s.enabled })))
                .catch(() => {}),
              api.adStatus(email)
                .then((s) => setAdStatusOverride((prev) => ({ ...prev, [email]: s.enabled })))
                .catch(() => {}),
            ]);
          }
        })
      );
    } finally {
      setRefreshingAll(false);
    }
  }

  async function refreshStatuses() {
    if (refreshingAll || rows.length === 0) return;
    refreshStatusesForEmails(rows.map((r) => r.subjectEmail));
  }

  const isAdmin = !!me?.roles.includes("admin");

  return (
    <section className="panel">
      <div className="panel-head">
        <h1>Impacted accounts</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            placeholder="Filter by name or email…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            style={{ minWidth: 280 }}
          />
          <button
            className="secondary"
            onClick={refreshStatuses}
            disabled={refreshingAll || loading || rows.length === 0}
            title="Re-fetch live Azure account status for all rows"
          >
            {refreshingAll ? "Refreshing…" : "↻ Refresh statuses"}
          </button>
        </div>
      </div>
      <p className="muted tiny">
        Each row is a single user whose access is currently being reviewed. The timer
        counts down to the earliest deadline across that user's pending reviews.
        When overdue, an admin can stage account disables or re-enables, then apply
        them all at once.
      </p>

      {/* Staged-changes bar — fixed bottom so it never hides behind the nav */}
      {staged.size > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9999,
            background: "#E8630A",
            color: "#ffffff",
            padding: "12px 24px",
            borderRadius: 32,
            boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            whiteSpace: "nowrap",
            fontSize: "0.95rem",
            fontWeight: 600,
          }}
        >
          <strong>
            {[...staged.values()].reduce(
              (n, sc) => n + (sc.azure !== undefined ? 1 : 0) + (sc.ad !== undefined ? 1 : 0),
              0
            )}{" "}
            change(s) staged
          </strong>
          <button
            onClick={() => setShowReview(true)}
            disabled={applying}
            style={{
              background: "#fff",
              color: "#E8630A",
              border: "none",
              borderRadius: 4,
              padding: "4px 14px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Review &amp; Apply
          </button>
          <button
            onClick={() => {
              setStaged(new Map());
              setBatchResult(null);
            }}
            style={{
              background: "transparent",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.6)",
              borderRadius: 4,
              padding: "4px 12px",
              cursor: "pointer",
            }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Batch result banner */}
      {batchResult && (() => {
        // Build a flat list of individual changes from the snapshot.
        const appliedLines: Array<{ name: string; email: string; system: string; action: string }> = [];
        for (const s of batchResult.succeeded) {
          const row = rows.find((r) => r.subjectEmail === s.email);
          const name = row?.subjectName ?? s.email;
          const sc = stagedSnapshot?.get(s.email);
          if (s.azure?.ok && sc?.azure !== undefined) {
            appliedLines.push({ name, email: s.email, system: "Azure", action: sc.azure ? "re-enabled" : "disabled" });
          }
          if (s.ad?.ok && sc?.ad !== undefined) {
            appliedLines.push({ name, email: s.email, system: "On-prem AD", action: sc.ad ? "re-enabled" : "disabled" });
          }
        }
        const hasSuccess = appliedLines.length > 0;
        const hasFail = batchResult.failed.length > 0;
        return (
          <div style={{
            background: hasFail ? "#F9A825" : "#2E7D32",
            color: "#fff",
            borderRadius: 6,
            padding: "12px 16px",
            marginBottom: 12,
          }}>
            {hasSuccess && (
              <>
                <p style={{ margin: "0 0 6px", fontWeight: 600 }}>
                  ✓ {appliedLines.length} change(s) applied:
                </p>
                <ul style={{ margin: "0 0 8px 16px", padding: 0 }}>
                  {appliedLines.map((l, i) => (
                    <li key={i} style={{ fontSize: "0.875rem" }}>
                      <strong>{l.name}</strong>{" "}
                      <span style={{ opacity: 0.85 }}>({l.email})</span>{" "}
                      — {l.system} <strong>{l.action}</strong>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {hasFail && (
              <>
                <p style={{ margin: "0 0 6px", fontWeight: 600 }}>
                  ⚠ {batchResult.failed.length} change(s) failed — handle manually:
                </p>
                <ul style={{ margin: "0 0 8px 16px", padding: 0 }}>
                  {batchResult.failed.map((f, i) => (
                    <li key={i} style={{ fontSize: "0.875rem" }}>
                      <strong>{f.email}</strong> ({f.system}): {f.error}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <button
              className="secondary"
              onClick={() => { setBatchResult(null); setStagedSnapshot(null); }}
              style={{ marginTop: 4, fontSize: "0.8rem" }}
            >
              Dismiss
            </button>
          </div>
        );
      })()}

      {loadError && (
        <p className="muted" style={{ color: "var(--status-red)" }}>Error: {loadError}</p>
      )}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">Nothing matches.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Reviews open</th>
              <th>Time until overdue</th>
              <th>Risk</th>
              <th>Azure account</th>
              <th>On-prem AD</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const overdue = r.daysRemaining != null && r.daysRemaining < 0;
              return (
                <tr
                  key={r.subjectEmail}
                  className={overdue ? "row-danger" : ""}
                >
                  <td>
                    <Link to={`/profile/${encodeURIComponent(r.subjectEmail)}`}>
                      {r.subjectName}
                    </Link>
                  </td>
                  <td>{r.subjectEmail}</td>
                  <td>{r.entitlements.length}</td>
                  <td>
                    {r.daysRemaining == null ? (
                      <span className="muted">—</span>
                    ) : overdue ? (
                      <span className="pill danger">
                        {Math.abs(r.daysRemaining)}d overdue
                      </span>
                    ) : r.daysRemaining === 0 ? (
                      <span className="pill warn">due today</span>
                    ) : (
                      <span
                        className={`pill ${r.daysRemaining <= 3 ? "warn" : ""}`}
                      >
                        {r.daysRemaining}d left
                      </span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`pill ${
                        r.riskLevel === "high"
                          ? "danger"
                          : r.riskLevel === "medium"
                          ? "warn"
                          : ""
                      }`}
                    >
                      {r.riskLevel}
                    </span>
                  </td>
                  <td>
                    {overdue ? (() => {
                      const isZinnia = r.subjectEmail.toLowerCase().endsWith("@zinnia.com");
                      if (!isZinnia) return null;
                      const live = r.subjectEmail in statusOverride ? statusOverride[r.subjectEmail] : r.accountEnabled;
                      if (live === null || live === undefined) return <span className="muted">—</span>;
                      const sc = staged.get(r.subjectEmail);
                      const isStaged = sc?.azure !== undefined;
                      const stagedTarget = sc?.azure;
                      const canToggle = isAdmin && !applying;
                      const failedChange = batchResult?.failed.find(
                        (f) => f.email === r.subjectEmail && f.system === "azure"
                      );
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                          <span
                            className={`pill ${isStaged ? "warn" : live ? "ok" : "danger"}`}
                            style={canToggle ? { cursor: "pointer", userSelect: "none" } : undefined}
                            title={
                              canToggle
                                ? isStaged
                                  ? `Staged: ${stagedTarget ? "re-enable" : "disable"} — click to unstage`
                                  : live
                                  ? "Click to stage disable"
                                  : "Click to stage re-enable"
                                : undefined
                            }
                            onClick={canToggle ? () => stageToggle(r.subjectEmail, "azure", live!) : undefined}
                          >
                            {isStaged
                              ? stagedTarget
                                ? "● enable staged"
                                : "● disable staged"
                              : live
                              ? "● active"
                              : "● disabled"}
                          </span>
                          {failedChange && (
                            <span className="pill danger" title={failedChange.error} style={{ fontSize: "0.7rem" }}>
                              failed
                            </span>
                          )}
                        </div>
                      );
                    })() : null}
                  </td>
                  <td>
                    {overdue ? (() => {
                      const isZinnia = r.subjectEmail.toLowerCase().endsWith("@zinnia.com");
                      if (!isZinnia) return null;
                      const adLive =
                        r.subjectEmail in adStatusOverride
                          ? adStatusOverride[r.subjectEmail]
                          : r.adAccountEnabled;
                      // Cloud-only user — no AD account to manage.
                      if (adLive === "not_found") {
                        return <span className="muted tiny">Cloud only</span>;
                      }
                      if (adLive === null || adLive === undefined) return <span className="muted">—</span>;
                      const sc = staged.get(r.subjectEmail);
                      const isStaged = sc?.ad !== undefined;
                      const stagedTarget = sc?.ad;
                      const canToggle = isAdmin && !applying;
                      const failedChange = batchResult?.failed.find(
                        (f) => f.email === r.subjectEmail && f.system === "ad"
                      );
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                          <span
                            className={`pill ${isStaged ? "warn" : adLive ? "ok" : "danger"}`}
                            style={canToggle ? { cursor: "pointer", userSelect: "none" } : undefined}
                            title={
                              canToggle
                                ? isStaged
                                  ? `Staged: ${stagedTarget ? "re-enable" : "disable"} — click to unstage`
                                  : adLive
                                  ? "Click to stage disable"
                                  : "Click to stage re-enable"
                                : undefined
                            }
                            onClick={canToggle ? () => stageToggle(r.subjectEmail, "ad", adLive!) : undefined}
                          >
                            {isStaged
                              ? stagedTarget
                                ? "● enable staged"
                                : "● disable staged"
                              : adLive
                              ? "● active"
                              : "● disabled"}
                          </span>
                          {failedChange && (
                            <span className="pill danger" title={failedChange.error} style={{ fontSize: "0.7rem" }}>
                              failed
                            </span>
                          )}
                        </div>
                      );
                    })() : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Review & Apply modal */}
      {showReview && (() => {
        const disables: Array<{ email: string; name: string; system: string }> = [];
        const enables: Array<{ email: string; name: string; system: string }> = [];
        for (const [email, sc] of staged) {
          const row = rows.find((r) => r.subjectEmail === email);
          const name = row?.subjectName ?? email;
          if (sc.azure !== undefined)
            (sc.azure ? enables : disables).push({ email, name, system: "Azure" });
          if (sc.ad !== undefined)
            (sc.ad ? enables : disables).push({ email, name, system: "On-prem AD" });
        }
        const total = disables.length + enables.length;
        return (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.55)",
              zIndex: 200,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                background: "#fff",
                borderRadius: 8,
                padding: 28,
                maxWidth: 540,
                width: "90%",
                maxHeight: "80vh",
                overflow: "auto",
                boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
              }}
            >
              <h2 style={{ marginTop: 0, color: "var(--zinnia-dark)" }}>
                Review staged changes
              </h2>

              {disables.length > 0 && (
                <>
                  <h4 style={{ color: "var(--status-red)", marginBottom: 6 }}>
                    🔴 Accounts to disable ({disables.length})
                  </h4>
                  <ul style={{ marginTop: 0, paddingLeft: 20 }}>
                    {disables.map((d, i) => (
                      <li key={i}>
                        <strong>{d.name}</strong>{" "}
                        <span className="muted tiny">{d.email}</span>{" "}
                        — {d.system}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {enables.length > 0 && (
                <>
                  <h4 style={{ color: "var(--status-green)", marginBottom: 6 }}>
                    ✅ Accounts to re-enable ({enables.length})
                  </h4>
                  <ul style={{ marginTop: 0, paddingLeft: 20 }}>
                    {enables.map((e, i) => (
                      <li key={i}>
                        <strong>{e.name}</strong>{" "}
                        <span className="muted tiny">{e.email}</span>{" "}
                        — {e.system}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <p className="muted tiny" style={{ marginTop: 12 }}>
                Reviewers and their managers will be notified. IAM and Helpdesk
                channels will receive a consolidated summary.
              </p>

              <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
                <button onClick={applyBatch} disabled={applying}>
                  {applying ? "Applying…" : `Apply ${total} change(s)`}
                </button>
                <button
                  className="secondary"
                  onClick={() => setShowReview(false)}
                  disabled={applying}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </section>
  );
}
