import { useEffect, useState } from "react";
import { api, AuditRow } from "../../lib/api";
import { fmtDate } from "../../lib/fmt";
import { downloadCsv, toCsv } from "../../lib/csv";

export function AuditPanel() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [filter, setFilter] = useState("");
  useEffect(() => {
    api.audit().then(setRows);
  }, []);
  const filtered = filter
    ? rows.filter(
        (r) =>
          r.actor.includes(filter) ||
          r.action.includes(filter) ||
          (r.target ?? "").includes(filter)
      )
    : rows;
  function exportCsv() {
    const csv = toCsv(
      filtered.map((r) => ({ ...r, details: r.details ? JSON.stringify(r.details) : "" })),
      ["at", "actor", "action", "target", "details"]
    );
    downloadCsv("audit.csv", csv);
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Audit log</h2>
        <div className="row-gap">
          <input placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button className="secondary" onClick={exportCsv}>Export CSV</button>
        </div>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>At</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Target</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {filtered
            .slice()
            .reverse()
            .map((r, i) => (
              <tr key={i}>
                <td>{fmtDate(r.at)}</td>
                <td>{r.actor}</td>
                <td>{r.action}</td>
                <td>{r.target ?? "—"}</td>
                <td className="tiny muted">{r.details ? JSON.stringify(r.details) : ""}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </section>
  );
}
