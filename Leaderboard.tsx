import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, LeaderboardRow } from "../lib/api";
import { ProgressBar } from "../components/ProgressBar";

export function Leaderboard() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.leaderboard().then((r) => {
      setRows(r);
      setLoading(false);
    });
  }, []);
  return (
    <section className="panel">
      <h1>Reviewer leaderboard</h1>
      <p className="muted">Sorted by completion %, slowest first.</p>
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Reviewer</th>
              <th>Email</th>
              <th>Assigned</th>
              <th>Completed</th>
              <th>Pending</th>
              <th>Progress</th>
              <th>Campaigns</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.reviewerId}>
                <td>
                  <Link to={`/profile/${encodeURIComponent(r.email)}`}>{r.displayName}</Link>
                </td>
                <td>{r.email}</td>
                <td>{r.totalAssigned}</td>
                <td>{r.completed}</td>
                <td>{r.pendingAcrossCampaigns}</td>
                <td style={{ width: 180 }}>
                  <ProgressBar value={r.completed} max={r.totalAssigned || 1} />
                </td>
                <td>{r.campaignIds.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
