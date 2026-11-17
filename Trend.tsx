import { useEffect, useState } from "react";
import { api, TrendRow } from "../lib/api";
import { fmtDate } from "../lib/fmt";

export function Trend() {
  const [rows, setRows] = useState<TrendRow[]>([]);
  useEffect(() => {
    api.trend().then(setRows);
  }, []);
  return (
    <section className="panel">
      <h1>Historical trend</h1>
      <p className="muted">One entry per refresh. Useful to see progression over a campaign's life.</p>
      <table className="table">
        <thead>
          <tr>
            <th>Refreshed at</th>
            <th>Campaigns</th>
            <th>Total reviews</th>
            <th>Completed</th>
            <th>% complete</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .slice()
            .reverse()
            .map((r, i) => {
              const pct = r.reviews ? Math.round((r.completed / r.reviews) * 100) : 0;
              return (
                <tr key={i}>
                  <td>{fmtDate(r.at)}</td>
                  <td>{r.campaigns}</td>
                  <td>{r.reviews}</td>
                  <td>{r.completed}</td>
                  <td>{pct}%</td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </section>
  );
}
