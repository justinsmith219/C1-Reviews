import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmtDate } from "../../lib/fmt";

export function OpsPanel() {
  const [status, setStatus] = useState("");
  const [importing, setImporting] = useState(false);
  const [lastImport, setLastImport] = useState<string | null>(null);
  const [dryRunResult, setDryRunResult] = useState<string>("");

  useEffect(() => {
    api.historicalCampaigns().then((r) => {
      setLastImport(r.lastImportedAt ?? null);
    }).catch(() => {});
  }, []);

  async function refresh() {
    setStatus("Refreshing snapshot from ConductorOne…");
    try {
      const r = await api.refresh();
      setStatus(`Snapshot refreshed: ${r.campaigns} campaigns at ${fmtDate(r.fetchedAt)}`);
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  }
  async function runImport(fresh = false) {
    if (fresh && !confirm("Force a FULL re-sync? This wipes existing archive data and re-fetches everything. May take hours.")) return;
    setImporting(true);
    setStatus(
      fresh
        ? "Force re-syncing all historical campaigns — this can take hours…"
        : "Importing historical campaigns (resumes from last checkpoint)…"
    );
    try {
      const r = await api.importHistory(fresh);
      setStatus(`Imported ${r.campaigns.length} historical campaigns.`);
      setLastImport(r.lastImportedAt ?? null);
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    } finally {
      setImporting(false);
    }
  }
  async function recompute() {
    setStatus("Recomputing scorecards…");
    const r = await api.recomputeScorecards();
    setStatus(`Scorecards recomputed: ${r.length} rows.`);
  }
  async function dryRun() {
    setDryRunResult("Running dry-run digest…");
    const r = await api.runDigest(true);
    setDryRunResult(
      `Would have built ${r.plans} recipient plans (no emails sent).`
    );
  }
  async function runNow() {
    if (!confirm("Send the daily digest right now to everyone who is currently behind?")) return;
    setStatus("Running digest — this can take a couple of minutes…");
    const r = await api.runDigest(false);
    setStatus(
      `Digest done: ${r.sent} sent, ${r.skipped} skipped, ${r.suppressed} suppressed${
        r.errors.length ? ` — first error: ${r.errors[0]}` : ""
      }`
    );
  }

  return (
    <section className="panel">
      <h2>Operations</h2>
      <p className="muted tiny">
        Ad-hoc controls for admins. None of these break scheduled jobs.
      </p>
      <div className="grid2">
        <div className="panel" style={{ background: "#fafbfc" }}>
          <h3 style={{ margin: 0 }}>Campaigns snapshot</h3>
          <p className="muted tiny">Pull the latest open-campaign data from ConductorOne right now.</p>
          <button onClick={refresh}>Refresh now</button>
        </div>
        <div className="panel" style={{ background: "#fafbfc" }}>
          <h3 style={{ margin: 0 }}>Historical import</h3>
          <p className="muted tiny">
            One-shot pull of all closed campaigns for manager scorecards. Last:{" "}
            {lastImport ? fmtDate(lastImport) : "never"}
          </p>
          <div className="row-gap">
            <button onClick={() => runImport(false)} disabled={importing}>
              {importing ? "Importing…" : "Import / resume"}
            </button>
            <button
              className="secondary"
              onClick={() => runImport(true)}
              disabled={importing}
              title="Discards prior import and re-fetches every closed campaign from scratch"
            >
              Force full re-sync
            </button>
            <button className="secondary" onClick={recompute}>Recompute scorecards</button>
          </div>
        </div>
        <div className="panel" style={{ background: "#fafbfc" }}>
          <h3 style={{ margin: 0 }}>Digest</h3>
          <p className="muted tiny">Dry-run shows who would be notified without actually sending.</p>
          <div className="row-gap">
            <button className="secondary" onClick={dryRun}>Dry run</button>
            <button onClick={runNow}>Run digest now</button>
          </div>
        </div>
        <div className="panel" style={{ background: "#fafbfc" }}>
          <h3 style={{ margin: 0 }}>Graph cache</h3>
          <p className="muted tiny">
            Org-tree, manager-chain and direct-reports lookups are cached on disk
            for 6 hours. Clear if someone moved teams in Entra and you want fresh data.
          </p>
          <button
            className="secondary"
            onClick={async () => {
              await api.clearGraphCache();
              setStatus("Graph cache cleared.");
            }}
          >
            Clear Graph cache
          </button>
        </div>
        <div className="panel" style={{ background: "#fafbfc" }}>
          <h3 style={{ margin: 0 }}>Campaign data cache</h3>
          <p className="muted tiny">
            Closed campaigns are cached forever. Active campaigns delta-sync on a 1h
            TTL. Clear here if you suspect data drift; next campaign open re-fetches.
          </p>
          <div className="row-gap">
            <button
              className="secondary"
              onClick={async () => {
                if (!confirm("Clear cached campaign task data for ALL campaigns? Next open of each will re-fetch from ConductorOne.")) return;
                const r = await api.clearCampaignCache();
                setStatus(`Campaign cache cleared: ${r.aggregated} aggregated + ${r.raw} raw files removed.`);
              }}
            >
              Clear all campaign caches
            </button>
            <button
              onClick={async () => {
                await api.prewarmCampaigns();
                setStatus("Pre-warm started — watch Admin → Jobs for progress.");
              }}
            >
              Pre-warm all active now
            </button>
          </div>
          <div className="tiny muted" style={{ marginTop: 8 }}>{dryRunResult}</div>
        </div>
      </div>
      <div className="tiny muted" style={{ marginTop: 16 }}>{status}</div>
    </section>
  );
}
