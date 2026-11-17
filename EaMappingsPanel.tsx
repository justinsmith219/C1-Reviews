import { useEffect, useState } from "react";
import { api, EaMapping } from "../../lib/api";
import { fmtDate } from "../../lib/fmt";

export function EaMappingsPanel() {
  const [rows, setRows] = useState<EaMapping[]>([]);
  const [ea, setEa] = useState("");
  const [exec, setExec] = useState("");
  const [err, setErr] = useState("");
  async function load() {
    setRows(await api.eaMappings());
  }
  useEffect(() => {
    load();
  }, []);
  async function add() {
    setErr("");
    try {
      await api.addEaMapping(ea, exec);
      setEa("");
      setExec("");
      await load();
    } catch (e: any) {
      setErr(e.message);
    }
  }
  async function remove(eaEmail: string, execEmail: string) {
    await api.removeEaMapping(eaEmail, execEmail);
    await load();
  }
  return (
    <section className="panel">
      <h2>EA → Executive mappings</h2>
      <p className="muted tiny">
        Many-to-many delegation so Executive Assistants can see data on behalf of the executives they support.
      </p>
      <div className="row-gap" style={{ margin: "10px 0" }}>
        <input placeholder="ea@zinnia.com" value={ea} onChange={(e) => setEa(e.target.value)} />
        <input placeholder="exec@zinnia.com" value={exec} onChange={(e) => setExec(e.target.value)} />
        <button onClick={add} disabled={!ea || !exec}>Add</button>
        {err && <span className="pill danger">{err}</span>}
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>EA</th>
            <th>Exec</th>
            <th>Added by</th>
            <th>When</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={`${m.eaEmail}|${m.execEmail}`}>
              <td>{m.eaEmail}</td>
              <td>{m.execEmail}</td>
              <td>{m.createdBy}</td>
              <td>{fmtDate(m.createdAt)}</td>
              <td>
                <button className="secondary" onClick={() => remove(m.eaEmail, m.execEmail)}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
