import { useEffect, useState } from "react";
import { api, RuntimeConfig, ConnectionTestResult } from "../lib/api";

type Section = "conductor1" | "entra" | "admins" | "slack" | "smtp" | "orgTop" | "digest" | "schedule" | "notifications" | "completionAlert" | "helpdeskNotification" | "ad";

export function Configuration() {
  const [cfg, setCfg] = useState<RuntimeConfig | null>(null);
  const [dirty, setDirty] = useState<Partial<RuntimeConfig>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tests, setTests] = useState<ConnectionTestResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  const [adminText, setAdminText] = useState("");

  useEffect(() => {
    api.getConfig().then((c) => {
      setCfg(c);
      setAdminText(c.adminEmails.join(", "));
    });
  }, []);

  if (!cfg) return <section className="panel">Loading…</section>;

  function setField<K extends Section>(section: K, field: string, value: any) {
    setCfg((prev) => {
      if (!prev) return prev;
      if (section === "admins") return prev;
      const next = { ...prev, [section]: { ...(prev as any)[section], [field]: value } } as RuntimeConfig;
      setDirty((d) => ({ ...d, [section]: { ...((d as any)[section] ?? {}), [field]: value } }));
      return next;
    });
  }

  async function save() {
    setErr("");
    setSaving(true);
    try {
      const payload: Partial<RuntimeConfig> = { ...dirty };
      if (adminText !== cfg!.adminEmails.join(", ")) {
        payload.adminEmails = adminText
          .split(/[,\n]/)
          .map((s) => s.trim())
          .filter(Boolean);
      }
      const next = await api.updateConfig(payload);
      setCfg(next);
      setAdminText(next.adminEmails.join(", "));
      setDirty({});
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setTests(null);
    try {
      setTests(await api.testConnections());
    } finally {
      setTesting(false);
    }
  }

  const changedCount = Object.keys(dirty).length + (adminText !== cfg.adminEmails.join(", ") ? 1 : 0);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Configuration</h2>
        <div className="row-gap">
          <button className="secondary" onClick={test} disabled={testing}>
            {testing ? "Testing…" : "Test connections"}
          </button>
          <button onClick={save} disabled={saving || changedCount === 0}>
            {saving ? "Saving…" : `Save${changedCount ? ` (${changedCount})` : ""}`}
          </button>
          {saved && <span className="pill ok">Saved</span>}
          {err && <span className="pill danger">{err}</span>}
        </div>
      </div>
      <p className="muted tiny">
        Secrets are masked — leave unchanged to keep current value. Changes apply live
        without restart (except port/session/cron which still require a server restart).
      </p>

      {tests && (
        <div className="panel" style={{ background: "#fafbfc", marginTop: 10 }}>
          <h3 style={{ margin: "0 0 10px 0", fontSize: 14 }}>Connection tests</h3>
          <TestRow label="ConductorOne" result={tests.conductor1} />
          <TestRow label="Entra / Graph" result={tests.entra} />
          <TestRow label="Slack" result={tests.slack} />
          <TestRow label="SMTP relay" result={tests.smtp} />
        </div>
      )}

      <h3 style={{ marginTop: 24 }}>ConductorOne</h3>
      <div className="grid2">
        <Field label="Base URL">
          <input
            value={cfg.conductor1.baseUrl}
            onChange={(e) => setField("conductor1", "baseUrl", e.target.value)}
          />
        </Field>
        <Field label="API token (preferred — takes precedence over client credentials)">
          <input
            type="password"
            value={cfg.conductor1.apiToken}
            onChange={(e) => setField("conductor1", "apiToken", e.target.value)}
          />
        </Field>
        <Field label="Client ID">
          <input
            value={cfg.conductor1.clientId}
            onChange={(e) => setField("conductor1", "clientId", e.target.value)}
          />
        </Field>
        <Field label="Client secret">
          <input
            type="password"
            value={cfg.conductor1.clientSecret}
            onChange={(e) => setField("conductor1", "clientSecret", e.target.value)}
          />
        </Field>
      </div>

      <h3 style={{ marginTop: 24 }}>Entra ID (Azure AD SSO)</h3>
      <div className="grid2">
        <Field label="Tenant ID">
          <input
            value={cfg.entra.tenantId}
            onChange={(e) => setField("entra", "tenantId", e.target.value)}
          />
        </Field>
        <Field label="Application (client) ID">
          <input
            value={cfg.entra.clientId}
            onChange={(e) => setField("entra", "clientId", e.target.value)}
          />
        </Field>
        <Field label="Client secret">
          <input
            type="password"
            value={cfg.entra.clientSecret}
            onChange={(e) => setField("entra", "clientSecret", e.target.value)}
          />
        </Field>
      </div>

      <h3 style={{ marginTop: 24 }}>Administrators</h3>
      <Field label="Admin emails (comma or newline separated). These users see everything and can change configuration.">
        <textarea
          rows={3}
          value={adminText}
          onChange={(e) => setAdminText(e.target.value)}
          style={{ width: "100%", fontFamily: "inherit" }}
        />
      </Field>

      <h3 style={{ marginTop: 24 }}>Slack</h3>
      <Field label="Bot token (xoxb-…). Scopes needed: chat:write, users:read, users:read.email">
        <input
          type="password"
          value={cfg.slack.botToken}
          onChange={(e) => setField("slack", "botToken", e.target.value)}
        />
      </Field>

      <h3 style={{ marginTop: 24 }}>Organization top (CEO)</h3>
      <div className="grid2">
        <Field label="CEO email — escalation stops one level below this person by default">
          <input
            value={cfg.orgTop.ceoEmail}
            onChange={(e) => setField("orgTop", "ceoEmail", e.target.value)}
          />
        </Field>
        <Field label="Exclude CEO from escalation copies">
          <select
            value={cfg.orgTop.excludeCeoFromEscalation ? "true" : "false"}
            onChange={(e) => setField("orgTop", "excludeCeoFromEscalation", e.target.value === "true")}
          >
            <option value="true">Yes (recommended)</option>
            <option value="false">No — include CEO</option>
          </select>
        </Field>
      </div>

      <h3 style={{ marginTop: 24 }}>Reviewer / manager notifications</h3>
      <p className="muted tiny" style={{ marginTop: -6 }}>
        Daily digest and reminders sent to individual reviewers and managers.
      </p>
      <div className="grid2">
        <Field label="Automatic sending">
          <select
            value={cfg.notifications?.autoSendEnabled === false ? "false" : "true"}
            onChange={(e) =>
              setField("notifications", "autoSendEnabled", e.target.value === "true")
            }
          >
            <option value="true">Enabled — sends on schedule</option>
            <option value="false">Disabled — manual only</option>
          </select>
        </Field>
        <Field label="Dry-run — log only, never call Slack/SMTP">
          <select
            value={cfg.notifications?.dryRun === true ? "true" : "false"}
            onChange={(e) =>
              setField("notifications", "dryRun", e.target.value === "true")
            }
          >
            <option value="false">Off — actually send</option>
            <option value="true">On — log only</option>
          </select>
        </Field>
        <Field label="Test recipient — when set, all reviewer/manager sends route here">
          <input
            type="email"
            placeholder="leave blank to send to real recipients"
            value={cfg.notifications?.testRecipient ?? ""}
            onChange={(e) => setField("notifications", "testRecipient", e.target.value)}
          />
        </Field>
      </div>

      <h3 style={{ marginTop: 24 }}>Admin notifications</h3>
      <p className="muted tiny" style={{ marginTop: -6 }}>
        Campaign completion and overdue alerts. Fully independent of reviewer/manager notifications.
      </p>
      <div className="grid2">
        <Field label="Automatic sending">
          <select
            value={cfg.notifications?.adminNotificationsEnabled === false ? "false" : "true"}
            onChange={(e) =>
              setField("notifications", "adminNotificationsEnabled", e.target.value === "true")
            }
          >
            <option value="true">Enabled — sends on schedule</option>
            <option value="false">Disabled</option>
          </select>
        </Field>
        <Field label="Dry-run — log only, never call Slack/SMTP">
          <select
            value={cfg.notifications?.adminDryRun === true ? "true" : "false"}
            onChange={(e) =>
              setField("notifications", "adminDryRun", e.target.value === "true")
            }
          >
            <option value="false">Off — actually send</option>
            <option value="true">On — log only</option>
          </select>
        </Field>
      </div>

      <h3 style={{ marginTop: 24 }}>Schedules</h3>
      <p className="muted tiny" style={{ marginTop: -6 }}>
        All schedules run in <strong>America/New_York (Eastern)</strong>.
      </p>
      <div className="grid2">
        <Field label="Daily digest — time of day">
          <input
            type="time"
            value={cfg.digest?.timeOfDay ?? "09:00"}
            onChange={(e) => setField("digest", "timeOfDay", e.target.value)}
          />
        </Field>
        <Field label="Daily digest — skip weekends">
          <select
            value={cfg.digest?.skipWeekends ? "true" : "false"}
            onChange={(e) => setField("digest", "skipWeekends", e.target.value === "true")}
          >
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </Field>
        <Field label="Nightly scorecard recompute — time of day">
          <input
            type="time"
            value={cfg.schedule?.scorecardsTime ?? "02:00"}
            onChange={(e) => setField("schedule", "scorecardsTime", e.target.value)}
          />
        </Field>
        <Field label="Active campaigns refresh — every N hours">
          <input
            type="number"
            min={1}
            max={24}
            value={cfg.schedule?.refreshIntervalHours ?? 1}
            onChange={(e) =>
              setField("schedule", "refreshIntervalHours", parseInt(e.target.value, 10) || 1)
            }
          />
        </Field>
        <Field label="Pre-warm task-level details — every N hours (0 = disabled)">
          <input
            type="number"
            min={0}
            max={24}
            value={cfg.schedule?.prewarmIntervalHours ?? 4}
            onChange={(e) =>
              setField("schedule", "prewarmIntervalHours", parseInt(e.target.value, 10) || 0)
            }
          />
        </Field>
      </div>

      <h3 style={{ marginTop: 24 }}>Campaign completion alerts</h3>
      <p className="muted tiny" style={{ marginTop: -6 }}>
        Sends a one-time notification when a campaign reaches 100% completion but is still open in
        ConductorOne. Fires automatically after each hourly refresh. Each campaign alerts once — no
        repeats until the campaign is closed and a new one hits 100%.
      </p>
      <div className="grid2">
        <Field label="Enable completion alerts">
          <select
            value={cfg.completionAlert?.enabled ? "true" : "false"}
            onChange={(e) =>
              setField("completionAlert", "enabled", e.target.value === "true")
            }
          >
            <option value="false">Disabled</option>
            <option value="true">Enabled</option>
          </select>
        </Field>
        <Field label="Delivery method">
          <select
            value={cfg.completionAlert?.channel ?? "slack-channel"}
            onChange={(e) => setField("completionAlert", "channel", e.target.value)}
          >
            <option value="slack-channel">Slack channel (e.g. #access-reviews)</option>
            <option value="slack-dm">Slack DM (to a user by email)</option>
            <option value="email">Email</option>
          </select>
        </Field>
        <Field
          label={
            cfg.completionAlert?.channel === "slack-channel"
              ? "Slack channel name (e.g. #access-reviews or access-reviews)"
              : cfg.completionAlert?.channel === "slack-dm"
              ? "Recipient email (looked up in Slack)"
              : "Recipient email address"
          }
        >
          <input
            value={cfg.completionAlert?.recipient ?? ""}
            placeholder={
              cfg.completionAlert?.channel === "slack-channel"
                ? "#access-reviews"
                : "user@zinnia.com"
            }
            onChange={(e) => setField("completionAlert", "recipient", e.target.value)}
          />
        </Field>
      </div>

      <h3 style={{ marginTop: 24 }}>Helpdesk notifications</h3>
      <p className="muted tiny" style={{ marginTop: -6 }}>
        When enabled, a message is posted to the specified Slack channel whenever an account is
        disabled or re-enabled from the Impacted Accounts panel. The message explains the reason
        and instructs the Helpdesk not to re-enable accounts without IAM approval.
      </p>
      <div className="grid2">
        <Field label="Enable helpdesk notifications">
          <select
            value={cfg.helpdeskNotification?.enabled ? "true" : "false"}
            onChange={(e) => setField("helpdeskNotification", "enabled", e.target.value === "true")}
          >
            <option value="false">Disabled</option>
            <option value="true">Enabled</option>
          </select>
        </Field>
        <Field label="Helpdesk Slack channel (e.g. #helpdesk or helpdesk)">
          <input
            value={cfg.helpdeskNotification?.slackChannel ?? ""}
            placeholder="#helpdesk"
            onChange={(e) => setField("helpdeskNotification", "slackChannel", e.target.value)}
          />
        </Field>
      </div>

      <h3 style={{ marginTop: 24 }}>On-premises Active Directory</h3>
      <p className="muted tiny" style={{ marginTop: -6 }}>
        When enabled, the "Disable on-prem AD" button on the Impacted Accounts panel will run{" "}
        <code>Disable-ADAccount</code> via PowerShell using the service account credentials below.
        The production server must be domain-joined and the service account must have{" "}
        <em>Write-userAccountControl</em> on the target OUs. Leave disabled if not applicable.
      </p>
      <div className="grid2">
        <Field label="Enable on-prem AD disable">
          <select
            value={cfg.ad?.enabled ? "true" : "false"}
            onChange={(e) => setField("ad", "enabled", e.target.value === "true")}
          >
            <option value="false">Disabled</option>
            <option value="true">Enabled</option>
          </select>
        </Field>
        <Field label="Domain (NETBIOS or FQDN, e.g. ZINNIA or zinnia.com)">
          <input
            value={cfg.ad?.domain ?? ""}
            placeholder="ZINNIA"
            onChange={(e) => setField("ad", "domain", e.target.value)}
          />
        </Field>
        <Field label="Service account username (DOMAIN\user or user@domain)">
          <input
            value={cfg.ad?.username ?? ""}
            placeholder="ZINNIA\svc-campaignmgr"
            onChange={(e) => setField("ad", "username", e.target.value)}
          />
        </Field>
        <Field label="Service account password">
          <input
            type="password"
            value={cfg.ad?.password ?? ""}
            placeholder="••••••••"
            onChange={(e) => setField("ad", "password", e.target.value)}
          />
        </Field>
      </div>

      <h3 style={{ marginTop: 24 }}>SMTP (internal relay)</h3>
      <div className="grid2">
        <Field label="Host">
          <input value={cfg.smtp.host} onChange={(e) => setField("smtp", "host", e.target.value)} />
        </Field>
        <Field label="Port">
          <input
            type="number"
            value={cfg.smtp.port}
            onChange={(e) => setField("smtp", "port", parseInt(e.target.value, 10) || 25)}
          />
        </Field>
        <Field label="From address">
          <input value={cfg.smtp.from} onChange={(e) => setField("smtp", "from", e.target.value)} />
        </Field>
        <Field label="Use TLS (secure)">
          <select
            value={cfg.smtp.secure ? "true" : "false"}
            onChange={(e) => setField("smtp", "secure", e.target.value === "true")}
          >
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </Field>
        <Field label="Username (blank if no auth)">
          <input value={cfg.smtp.user} onChange={(e) => setField("smtp", "user", e.target.value)} />
        </Field>
        <Field label="Password">
          <input
            type="password"
            value={cfg.smtp.pass}
            onChange={(e) => setField("smtp", "pass", e.target.value)}
          />
        </Field>
        <Field label="Allow invalid TLS cert (hostname/cert mismatch)">
          <select
            value={cfg.smtp.allowInvalidCerts ? "true" : "false"}
            onChange={(e) => setField("smtp", "allowInvalidCerts", e.target.value === "true")}
          >
            <option value="false">No (strict)</option>
            <option value="true">Yes (relay with mismatched cert)</option>
          </select>
        </Field>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="tiny muted">{label}</span>
      {children}
    </label>
  );
}

function TestRow({ label, result }: { label: string; result: { ok: boolean; message: string } }) {
  return (
    <div className="row-gap" style={{ padding: "4px 0" }}>
      <span style={{ minWidth: 140 }}>{label}</span>
      <span className={`pill ${result.ok ? "ok" : "danger"}`}>{result.ok ? "ok" : "fail"}</span>
      <span className="muted tiny">{result.message}</span>
    </div>
  );
}
