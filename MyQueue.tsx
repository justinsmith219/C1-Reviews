import { useEffect, useState } from "react";
import { api, ReviewRow } from "../lib/api";
import { fmtDateShort } from "../lib/fmt";

export function MyQueue() {
  const [data, setData] = useState<{ pending: ReviewRow[]; completed: ReviewRow[] } | null>(null);
  useEffect(() => {
    api.myQueue().then(setData);
  }, []);
  if (!data) return <section className="panel">Loading…</section>;
  return (
    <section className="panel">
      <h1>My queue</h1>
      <p className="muted">Reviews assigned to you across all open campaigns.</p>

      <h2>Pending ({data.pending.length})</h2>
      {data.pending.length === 0 ? (
        <p className="muted">All caught up.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Subject</th>
              <th>Entitlement</th>
            </tr>
          </thead>
          <tbody>
            {data.pending.map((r) => (
              <tr key={r.id}>
                <td>
                  <a href={`/campaigns/${r.campaignId}`}>{r.campaignName ?? r.campaignId}</a>
                </td>
                <td>{r.subjectUserDisplayName ?? r.subjectUserEmail}</td>
                <td>{r.entitlement ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ marginTop: 30 }}>Recently completed ({data.completed.length})</h2>
      {data.completed.length === 0 ? (
        <p className="muted">None yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Decided</th>
            </tr>
          </thead>
          <tbody>
            {data.completed.slice(0, 50).map((r) => (
              <tr key={r.id}>
                <td>
                  <a href={`/campaigns/${r.campaignId}`}>{r.campaignName ?? r.campaignId}</a>
                </td>
                <td>{r.subjectUserDisplayName ?? r.subjectUserEmail}</td>
                <td>
                  <span className="pill ok">{r.status}</span>
                </td>
                <td>{fmtDateShort(r.decidedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
