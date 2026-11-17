import { useEffect, useState } from "react";
import { api, TemplateStore, TemplateDoc } from "../lib/api";

const SECTION_OPTIONS = [
  { value: "reviewer_pending", label: "Reviewer pending (body)" },
  { value: "direct_behind", label: "Direct reports behind" },
  { value: "skip_behind", label: "Skip-level behind" },
  { value: "deeper_behind", label: "Further down behind" },
];

export function BulkNotifyModal({
  selectedByCampaign,
  onClose,
}: {
  selectedByCampaign: Map<string, string[]>;
  onClose: () => void;
}) {
  const [templates, setTemplates] = useState<TemplateStore | null>(null);
  const [section, setSection] = useState("reviewer_pending");
  const [channel, setChannel] = useState<"email" | "slack">("email");
  const [doc, setDoc] = useState<TemplateDoc | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string>("");

  useEffect(() => {
    api.getTemplates().then((t) => {
      setTemplates(t);
      const key = `${section}:${channel}`;
      setDoc(t.global[key]);
    });
  }, []);

  useEffect(() => {
    if (!templates) return;
    const key = `${section}:${channel}`;
    setDoc(templates.global[key]);
  }, [section, channel, templates]);

  async function send() {
    setSending(true);
    setResult("Sending…");
    let sent = 0, skipped = 0;
    const errors: string[] = [];
    for (const [campaignId, emails] of selectedByCampaign) {
      try {
        const r = await api.notify(campaignId, emails, "manual");
        sent += r.sent;
        skipped += r.skipped;
        errors.push(...r.errors);
      } catch (e: any) {
        errors.push(e.message);
      }
    }
    setResult(`Sent ${sent}, skipped ${skipped}${errors.length ? ` — first error: ${errors[0]}` : ""}`);
    setSending(false);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2>Bulk notify</h2>
          <button className="secondary" onClick={onClose}>Close</button>
        </div>
        <p className="muted tiny">
          Pick a template, optionally edit, then send. Recipients = selected reviewers grouped by campaign:
          {[...selectedByCampaign.entries()].map(([c, es]) => ` ${c} (${es.length})`).join(",")}
        </p>
        <div className="row-gap" style={{ marginBottom: 10 }}>
          <label className="tiny muted">Section
            <select value={section} onChange={(e) => setSection(e.target.value)}>
              {SECTION_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
          <label className="tiny muted">Channel
            <select value={channel} onChange={(e) => setChannel(e.target.value as any)}>
              <option value="email">Email</option>
              <option value="slack">Slack</option>
            </select>
          </label>
        </div>
        {doc && (
          <>
            {channel === "email" && (
              <label className="tiny muted">Subject
                <input value={doc.subject ?? ""} onChange={(e) => setDoc({ ...doc, subject: e.target.value })} />
              </label>
            )}
            <label className="tiny muted">Body (Markdown)
              <textarea
                rows={12}
                value={doc.bodyMarkdown}
                onChange={(e) => setDoc({ ...doc, bodyMarkdown: e.target.value })}
                style={{ width: "100%", fontFamily: "monospace" }}
              />
            </label>
          </>
        )}
        <div className="row-gap" style={{ marginTop: 10 }}>
          <button onClick={send} disabled={sending}>{sending ? "Sending…" : "Send"}</button>
          <span className="muted tiny">{result}</span>
        </div>
      </div>
    </div>
  );
}
