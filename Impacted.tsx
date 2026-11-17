import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ImpactedRow } from "../lib/api";

export function Impacted() {
  const [rows, setRows] = useState<ImpactedRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.impacted().then((r) => {
      setRows(r);
      setLoading(false);
    });
  }, []);
  return (
    <section className="panel">
      <h1>Impacted accounts</h1>
      <p className="muted">
        Users whose access may be revoked if reviews are not completed in time.
        Sorted by risk (high first).
      </p>
      {loading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">Nothing at risk. Nice.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Entitlements</th>
              <th>Reviewer(s)</th>
              <th>Campaigns</th>
              <th>Days left</th>
              <th>Risk</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
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
                <td>{r.campaignIds.length}</td>
                <td>
                  {r.daysRemaining == null ? (
                    "—"
                  ) : r.daysRemaining < 0 ? (
                    <span className="pill danger">{Math.abs(r.daysRemaining)}d overdue</span>
                  ) : r.daysRemaining <= 3 ? (
                    <span className="pill danger">{r.daysRemaining}d</span>
                  ) : r.daysRemaining <= 7 ? (
                    <span className="pill warn">{r.daysRemaining}d</span>
                  ) : (
                    <span className="pill">{r.daysRemaining}d</span>
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
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
