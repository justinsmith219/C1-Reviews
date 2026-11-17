import { useEffect, useState } from "react";
import { api, Suppression } from "../../lib/api";
import { fmtDateShort } from "../../lib/fmt";

export function SuppressionsPanel() {
  const [rows, setRows] = useState<Suppression[]>([]);
  const [email, setEmail] = useState("");
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  async function load() {
    setRows(await api.listSuppressions());
  }
  useEffect(() => {
    load();
  }, []);
  async function add() {
    await api.addSuppression(email, until, reason);
    setEmail("");
    setUntil("");
    setReason("");
    await load();
  }
  return (
    <section className="panel">
      <h2>Suppressions (PTO / do-not-disturb)</h2>
      <p className="muted tiny">
        While a person is suppressed, the app skips sending to them and
        escalates immediately to the next level. Out-of-office is detected
        automatically via Microsoft Graph in addition to entries you add here.
      </p>
      <div className="row-gap" style={{ margin: "10px 0" }}>
        <input
          placeholder="email@zinnia.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="date"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
        />
        <input
          placeholder="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button onClick={add} disabled={!email || !until}>Add</button>
      </div>
      {rows.length === 0 ? (
        <p className="muted">No active manual suppressions.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Until</th>
              <th>Reason</th>
              <th>Added by</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.email}>
                <td>{r.email}</td>
                <td>{fmtDateShort(r.untilDate)}</td>
                <td>{r.reason ?? ""}</td>
                <td>{r.createdBy}</td>
                <td>
                  <button
                    className="secondary"
                    onClick={async () => {
                      await api.removeSuppression(r.email);
                      await load();
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
