import { useEffect, useRef, useState } from "react";
import { api, TemplateStore, TemplateDoc } from "../../lib/api";

const SECTIONS = [
  { value: "wrapper",                  label: "Wrapper (greeting + closing)",         group: "Reminders" },
  { value: "reviewer_pending",         label: "Reviewer pending",                     group: "Reminders" },
  { value: "direct_behind",            label: "Direct reports behind",                group: "Reminders" },
  { value: "skip_behind",              label: "Skip-level behind",                    group: "Reminders" },
  { value: "deeper_behind",            label: "Further down behind",                  group: "Reminders" },
  { value: "admin_digest",             label: "Admin digest",                         group: "Reminders" },
  { value: "account_disabled",         label: "Account disabled (IAM / Helpdesk)",    group: "Account actions" },
  { value: "account_enabled",          label: "Account re-enabled (IAM / Helpdesk)",  group: "Account actions" },
  { value: "reviewer_account_disabled", label: "Reviewer notified — account disabled", group: "Account actions" },
  { value: "manager_account_disabled", label: "Manager notified — account disabled",  group: "Account actions" },
];

// Sections whose email template includes a subject line.
const SECTIONS_WITH_SUBJECT = new Set([
  "wrapper",
  "admin_digest",
  "account_disabled",
  "account_enabled",
  "reviewer_account_disabled",
  "manager_account_disabled",
]);

const TOKENS_HELP = `
Common tokens — Reminders:
  {{recipient.firstName}}, {{recipient.email}}
  {{summary.totalPending}}, {{sections}}  (wrapper only)
  {{section.count}}, {{section.pendingTable}}, {{section.pendingList}}
  {{section.reviewerTable}}, {{section.reviewerList}}
  {{section.deadline}}, {{section.daysUntilDeadline}}
  {{section.campaignUrl}}, {{section.campaignName}}, {{section.tier}}
  {{admin.openCampaigns}}, {{admin.atRisk}}, {{admin.totalPending}}
  {{admin.reviewersBehind}}, {{admin.suppressed}}, {{admin.atRiskTable}}

Account action tokens:
  {{actor}}                              (who triggered the action)
  {{accounts.count}}, {{accounts.list}}, {{accounts.table}}
  {{campaigns.list}}
  {{reviewer.firstName}}, {{reviewer.name}}
  {{account.email}}, {{account.name}}
  {{campaign.name}}, {{campaign.deadline}}
  {{manager.firstName}}
`.trim();

interface PreviewResult {
  rendered: string;
  subject?: string;
  sampleContext: { reviewerName: string; campaignName: string };
}

export function TemplatesPanel() {
  const [store, setStore] = useState<TemplateStore | null>(null);
  const [section, setSection] = useState("wrapper");
  const [channel, setChannel] = useState<"email" | "slack">("email");
  const [doc, setDoc] = useState<TemplateDoc | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    api.getTemplates().then((s) => {
      setStore(s);
    });
  }, []);

  useEffect(() => {
    if (!store) return;
    const key = `${section}:${channel}`;
    setDoc(store.global[key] ?? null);
  }, [store, section, channel]);

  async function save() {
    if (!doc) return;
    setSaving(true);
    try {
      const next = await api.saveTemplate(doc);
      setStore(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function openPreview() {
    if (!doc) return;
    setPreviewing(true);
    setPreviewError(null);
    try {
      const result = await api.previewTemplate(section, channel, doc.bodyMarkdown, doc.subject);
      setPreview(result);
      dialogRef.current?.showModal();
    } catch (err: any) {
      setPreviewError(err?.message ?? "Preview failed");
    } finally {
      setPreviewing(false);
    }
  }

  function closePreview() {
    dialogRef.current?.close();
    setPreview(null);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Templates</h2>
        <div className="row-gap">
          <button onClick={openPreview} disabled={!doc || previewing} style={{ background: "#5F5E5A", color: "#fff" }}>
            {previewing ? "Loading…" : "Preview"}
          </button>
          <button onClick={save} disabled={!doc || saving}>{saving ? "Saving…" : "Save"}</button>
          {saved && <span className="pill ok">Saved</span>}
        </div>
      </div>
      <div className="row-gap" style={{ marginBottom: 12 }}>
        <select value={section} onChange={(e) => setSection(e.target.value)}>
          {["Reminders", "Account actions"].map((grp) => (
            <optgroup key={grp} label={grp}>
              {SECTIONS.filter((s) => s.group === grp).map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <select value={channel} onChange={(e) => setChannel(e.target.value as any)}>
          <option value="email">Email</option>
          <option value="slack">Slack</option>
        </select>
      </div>
      {previewError && <p className="error-text" style={{ color: "var(--status-red)", marginBottom: 8 }}>{previewError}</p>}
      {doc && (
        <>
          {channel === "email" && SECTIONS_WITH_SUBJECT.has(section) && (
            <label>
              <span className="tiny muted">Subject</span>
              <input
                value={doc.subject ?? ""}
                onChange={(e) => setDoc({ ...doc, subject: e.target.value })}
              />
            </label>
          )}
          <label>
            <span className="tiny muted">Body (Markdown)</span>
            <textarea
              rows={18}
              value={doc.bodyMarkdown}
              onChange={(e) => setDoc({ ...doc, bodyMarkdown: e.target.value })}
              style={{ width: "100%", fontFamily: "monospace", fontSize: 13 }}
            />
          </label>
          <details>
            <summary className="muted tiny">Available tokens</summary>
            <pre className="muted tiny" style={{ whiteSpace: "pre-wrap" }}>{TOKENS_HELP}</pre>
          </details>
        </>
      )}

      {/* Preview modal */}
      <dialog
        ref={dialogRef}
        style={{ maxWidth: 720, width: "90vw", padding: 0, border: "1px solid var(--zinnia-border)", borderRadius: 8 }}
        onClick={(e) => { if (e.target === dialogRef.current) closePreview(); }}
      >
        {preview && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--zinnia-border)", background: "var(--zinnia-light)" }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                Preview — {SECTIONS.find((s) => s.value === section)?.label} / {channel}
              </span>
              <button onClick={closePreview} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--zinnia-mid)" }}>✕</button>
            </div>
            <div style={{ padding: "8px 16px 4px", background: "var(--zinnia-light)", borderBottom: "1px solid var(--zinnia-border)", fontSize: 12, color: "var(--zinnia-mid)" }}>
              Sample data: reviewer <strong>{preview.sampleContext.reviewerName}</strong>, campaign <strong>{preview.sampleContext.campaignName}</strong>
            </div>
            {preview.subject && (
              <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--zinnia-border)", fontSize: 13 }}>
                <span style={{ color: "var(--zinnia-mid)", fontWeight: 600, marginRight: 8 }}>Subject:</span>
                {preview.subject}
              </div>
            )}
            <div style={{ padding: 16, maxHeight: "60vh", overflowY: "auto" }}>
              {channel === "email" ? (
                <div
                  style={{ fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: 14, lineHeight: 1.6, color: "var(--zinnia-dark)" }}
                  dangerouslySetInnerHTML={{ __html: preview.rendered }}
                />
              ) : (
                <pre style={{ fontFamily: "monospace", fontSize: 13, whiteSpace: "pre-wrap", margin: 0, color: "var(--zinnia-dark)" }}>
                  {preview.rendered}
                </pre>
              )}
            </div>
          </div>
        )}
      </dialog>
    </section>
  );
}
