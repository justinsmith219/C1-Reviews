import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, BehindRow, ImpactedRow } from "../lib/api";

export function HotList() {
  const [behind, setBehind] = useState<BehindRow[]>([]);
  const [impacted, setImpacted] = useState<ImpactedRow[]>([]);
  useEffect(() => {
    api.behind().then(setBehind);
    api.impacted().then(setImpacted);
  }, []);
  const worstReviewers = [...behind]
    .sort((a, b) => b.pending - a.pending)
    .slice(0, 10);
  const riskiestSubjects = impacted.slice(0, 10);
  return (
    <div className="hotlist">
      <section className="panel">
        <h2>Top 10 reviewers behind</h2>
        {worstReviewers.length === 0 ? (
          <p className="muted">Nobody behind.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Reviewer</th>
                <th>Pending</th>
                <th>Campaign</th>
                <th>Tier</th>
                <th>Deadline</th>
              </tr>
            </thead>
            <tbody>
              {worstReviewers.map((r) => (
                <tr key={`${r.reviewerId}-${r.campaignId}`}>
                  <td>
                    <Link to={`/profile/${encodeURIComponent(r.reviewerEmail)}`}>{r.reviewerName}</Link>
                  </td>
                  <td><strong>{r.pending}</strong></td>
                  <td><Link to={`/campaigns/${r.campaignId}`}>{r.campaignName}</Link></td>
                  <td>
                    <span className={`pill ${r.daysUntilDeadline != null && r.daysUntilDeadline < 0 ? "danger" : "warn"}`}>
                      {r.tierName ?? "—"}
                    </span>
                  </td>
                  <td>
                    {r.daysUntilDeadline == null
                      ? "—"
                      : r.daysUntilDeadline < 0
                      ? `${Math.abs(r.daysUntilDeadline)}d overdue`
                      : `${r.daysUntilDeadline}d left`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="panel">
        <h2>Top 10 at-risk subjects</h2>
        {riskiestSubjects.length === 0 ? (
          <p className="muted">Nothing at risk.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Entitlements</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {riskiestSubjects.map((r) => (
                <tr key={r.subjectEmail}>
                  <td>
                    <Link to={`/profile/${encodeURIComponent(r.subjectEmail)}`}>{r.subjectName}</Link>
                  </td>
                  <td>{r.entitlements.slice(0, 2).join(", ")}{r.entitlements.length > 2 && ` +${r.entitlements.length - 2}`}</td>
                  <td>
                    <span
                      className={`pill ${
                        r.riskLevel === "high" ? "danger" : r.riskLevel === "medium" ? "warn" : ""
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
    </div>
  );
}
