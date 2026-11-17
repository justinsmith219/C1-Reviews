import { useEffect, useState } from "react";
import { api, ManagerRollupRow } from "../lib/api";

export function Managers() {
  const [rows, setRows] = useState<ManagerRollupRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.managers().then((r) => {
      setRows(r);
      setLoading(false);
    });
  }, []);
  return (
    <section className="panel">
      <h1>Manager rollup</h1>
      <p className="muted">
        Direct reports vs. full downstream tree. Use this to see which managers
        still have outstanding reviews from anyone on their team.
      </p>
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Manager / team lead</th>
              <th>Direct — completed</th>
              <th>Direct — pending</th>
              <th>Downstream — completed</th>
              <th>Downstream — pending</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.managerEmail}>
                <td>{r.managerEmail}</td>
                <td>{r.directReportsCompleted}</td>
                <td>
                  <span className={r.directReportsIncomplete > 0 ? "pill warn" : "pill"}>
                    {r.directReportsIncomplete}
                  </span>
                </td>
                <td>{r.downstreamCompleted}</td>
                <td>
                  <span className={r.downstreamIncomplete > 0 ? "pill warn" : "pill"}>
                    {r.downstreamIncomplete}
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
