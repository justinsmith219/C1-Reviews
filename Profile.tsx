import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ProfileResult } from "../lib/api";
import { fmtDateShort } from "../lib/fmt";

export function Profile() {
  const { email = "" } = useParams();
  const [data, setData] = useState<ProfileResult | null>(null);
  useEffect(() => {
    api.profile(email).then(setData);
  }, [email]);
  if (!data) return <section className="panel">Loading…</section>;
  return (
    <section className="panel">
      <div className="panel-head">
        <h1>{data.user?.displayName ?? data.email}</h1>
        <span className="muted">{data.email}</span>
      </div>
      {data.user && !data.user.accountEnabled && (
        <div className="pill danger" style={{ marginBottom: 12 }}>
          Disabled account — notifications will skip and admins will be alerted
        </div>
      )}
      <div className="grid2">
        <div>
          <h2>Manager chain (up to CEO)</h2>
          {data.managerChain.length === 0 ? (
            <p className="muted">No manager resolved.</p>
          ) : (
            <ol>
              {data.managerChain.map((m) => (
                <li key={m.email}>
                  <Link to={`/profile/${encodeURIComponent(m.email)}`}>{m.displayName}</Link>{" "}
                  <span className="muted tiny">{m.email}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div>
          <h2>Quick stats</h2>
          <ul>
            <li>Pending reviews as reviewer: <strong>{data.asReviewer.pending.length}</strong></li>
            <li>Completed: <strong>{data.asReviewer.completed.length}</strong></li>
            <li>Open review items where this person is the subject: <strong>{data.asSubject.length}</strong></li>
            <li>Past campaigns as reviewer: <strong>{data.historicalAsReviewer.length}</strong></li>
          </ul>
        </div>
      </div>

      <h2>Pending reviews owed</h2>
      {data.asReviewer.pending.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Subject</th>
              <th>Entitlement</th>
              <th>Campaign</th>
            </tr>
          </thead>
          <tbody>
            {data.asReviewer.pending.map((r) => (
              <tr key={r.id}>
                <td>{r.subjectUserDisplayName ?? r.subjectUserEmail}</td>
                <td>{r.entitlement ?? "—"}</td>
                <td><Link to={`/campaigns/${r.campaignId}`}>{r.campaignName ?? r.campaignId}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Past campaigns as reviewer ({data.historicalAsReviewer.length})</h2>
      {data.historicalAsReviewer.length === 0 ? (
        <p className="muted">None in the archive.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Closed</th>
              <th>Deadline</th>
              <th>Assigned</th>
              <th>Completed</th>
              <th>On-time</th>
              <th>On-time %</th>
            </tr>
          </thead>
          <tbody>
            {data.historicalAsReviewer.map((r) => {
              const otPct = r.assigned ? Math.round((r.onTime / r.assigned) * 100) : 0;
              return (
                <tr key={r.campaignId}>
                  <td>
                    <Link to={`/history/${r.campaignId}`}>{r.campaignName}</Link>
                  </td>
                  <td>{fmtDateShort(r.closedAt)}</td>
                  <td>{fmtDateShort(r.deadline)}</td>
                  <td>{r.assigned}</td>
                  <td>{r.completed}</td>
                  <td>{r.onTime}</td>
                  <td>
                    <span
                      className={`pill ${
                        otPct >= 90 ? "ok" : otPct >= 60 ? "warn" : "danger"
                      }`}
                    >
                      {otPct}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h2>Their access currently being reviewed</h2>
      {data.asSubject.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Entitlement</th>
              <th>Reviewer</th>
              <th>Campaign</th>
              <th>Status</th>
              <th>Decided</th>
            </tr>
          </thead>
          <tbody>
            {data.asSubject.map((r) => (
              <tr key={r.id}>
                <td>{r.entitlement ?? "—"}</td>
                <td>{r.reviewerId}</td>
                <td>
                  <Link to={`/campaigns/${r.campaignId}`}>{r.campaignName ?? r.campaignId}</Link>
                </td>
                <td>
                  <span className={`pill ${r.status === "pending" ? "warn" : "ok"}`}>{r.status}</span>
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
