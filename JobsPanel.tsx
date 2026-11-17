import { useEffect, useState } from "react";
import { api, JobInfo } from "../../lib/api";
import { fmtDate } from "../../lib/fmt";

export function JobsPanel() {
  const [rows, setRows] = useState<JobInfo[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string>("");

  async function load() {
    setRows(await api.jobs());
    setUpdatedAt(new Date().toISOString());
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Jobs &amp; syncs</h2>
        <span className="muted tiny">Auto-refreshes every 5s · last {fmtDate(updatedAt)}</span>
      </div>
      <p className="muted tiny">
        Scheduled jobs run on cron triggers; on-demand jobs are user-initiated. Status
        reflects the most recent run; durations are wall-clock.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Kind</th>
            <th>Status</th>
            <th>Schedule</th>
            <th>Last run</th>
            <th>Duration</th>
            <th>Last success</th>
            <th>Last failure</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={9} className="muted">No jobs registered yet.</td>
            </tr>
          ) : (
            rows.map((j) => (
              <tr key={j.id}>
                <td>{j.name}</td>
                <td><span className="pill">{j.kind}</span></td>
                <td>
                  <span
                    className={`pill ${
                      j.status === "running"
                        ? "warn"
                        : j.status === "failed"
                        ? "danger"
                        : j.status === "success"
                        ? "ok"
                        : ""
                    }`}
                  >
                    {j.status}
                  </span>
                </td>
                <td className="tiny muted">
                  {j.schedule ? `${j.schedule} (${j.timezone ?? "-"})` : "—"}
                </td>
                <td>{j.startedAt ? fmtDate(j.startedAt) : "—"}</td>
                <td>{j.durationMs != null ? formatDuration(j.durationMs) : (j.status === "running" ? "running…" : "—")}</td>
                <td>{j.lastSuccessAt ? fmtDate(j.lastSuccessAt) : "—"}</td>
                <td>{j.lastFailureAt ? fmtDate(j.lastFailureAt) : "—"}</td>
                <td className="tiny">{j.message ?? ""}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.round((ms % 3_600_000) / 60_000)}m`;
}
