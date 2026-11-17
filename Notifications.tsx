import { useEffect, useState } from "react";
import { api, NotificationRow } from "../lib/api";
import { fmtDate } from "../lib/fmt";

export function Notifications() {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [filter, setFilter] = useState("");
  const [viewing, setViewing] = useState<NotificationRow | null>(null);
  useEffect(() => {
    api.notifications().then(setRows);
  }, []);
  const filtered = filter
    ? rows.filter(
        (r) =>
          r.recipientEmail.includes(filter) ||
          r.kind.includes(filter) ||
          (r.campaignId ?? "").includes(filter)
      )
    : rows;
  return (
    <section className="panel">
      <div className="panel-head">
        <h1>Notification log</h1>
        <input
          placeholder="Filter by email, kind, campaign…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Sent at</th>
            <th>Channel</th>
            <th>Kind</th>
            <th>Recipient</th>
            <th>Campaign</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtered
            .slice()
            .reverse()
            .map((r) => (
              <tr key={r.id}>
                <td>{fmtDate(r.sentAt)}</td>
                <td>{r.channel}</td>
                <td>{r.kind}</td>
                <td>{r.recipientEmail}</td>
                <td>{r.campaignId ?? "—"}</td>
                <td>
                  {r.dryRun ? (
                    <span className="pill warn" title="Dry-run mode — no message was actually sent.">
                      dry run
                    </span>
                  ) : r.success ? (
                    <span className="pill ok">sent</span>
                  ) : (
                    <span className="pill danger" title={r.error}>
                      failed
                    </span>
                  )}
                </td>
                <td>
                  {r.body || r.subject ? (
                    <button
                      className="link-button"
                      onClick={() => setViewing(r)}
                      title="View the message that was sent"
                    >
                      View
                    </button>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      {viewing && <MessageModal row={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}

function MessageModal({ row, onClose }: { row: NotificationRow; onClose: () => void }) {
  const isHtml = row.channel === "email" && /<\w+/.test(row.body ?? "");
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 760, width: "90%" }}
      >
        <div className="modal-head">
          <h2 style={{ margin: 0 }}>Message sent</h2>
          <button className="secondary" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body">
          <dl className="kv">
            <dt>Sent at</dt>
            <dd>{fmtDate(row.sentAt)}</dd>
            <dt>Channel</dt>
            <dd>{row.channel}</dd>
            <dt>Kind</dt>
            <dd>{row.kind}</dd>
            <dt>Recipient</dt>
            <dd>{row.recipientEmail}</dd>
            {row.campaignId && (
              <>
                <dt>Campaign</dt>
                <dd>{row.campaignId}</dd>
              </>
            )}
            {row.subject && (
              <>
                <dt>Subject</dt>
                <dd>{row.subject}</dd>
              </>
            )}
            <dt>Status</dt>
            <dd>{row.success ? "sent" : `failed: ${row.error ?? "unknown"}`}</dd>
          </dl>
          <hr />
          <h3 style={{ marginTop: 0 }}>Body</h3>
          {row.body ? (
            isHtml ? (
              <iframe
                title="message-body"
                srcDoc={row.body}
                sandbox=""
                style={{
                  width: "100%",
                  minHeight: 400,
                  border: "1px solid var(--border, #ddd)",
                  borderRadius: 4,
                  background: "#fff",
                }}
              />
            ) : (
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  background: "var(--code-bg, #f6f8fa)",
                  padding: 12,
                  borderRadius: 4,
                  maxHeight: 480,
                  overflow: "auto",
                }}
              >
                {row.body}
              </pre>
            )
          ) : (
            <p className="muted">
              No body captured for this entry. Older log rows pre-date the body capture
              feature.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
