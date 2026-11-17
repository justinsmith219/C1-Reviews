import { useState } from "react";

export function Setup({ redirectUri }: { redirectUri: string }) {
  const [tenantId, setTenantId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [adminEmails, setAdminEmails] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setSaving(true);
    try {
      const admins = adminEmails
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
      const res = await fetch(`${BASE}/auth/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, clientId, clientSecret, adminEmails: admins }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      window.location.href = `${BASE}/auth/login`;
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="setup-wrap">
      <form className="panel setup-card" onSubmit={submit}>
        <h1>First-run setup</h1>
        <p className="muted">
          Configure Entra ID (Azure AD) SSO to get started. This page is only
          available until the first admin signs in. After that, edit credentials
          at <strong>Admin → Configuration</strong>.
        </p>

        <h2>Microsoft Entra ID app registration</h2>
        <p className="muted tiny">
          In the Azure portal, create an app registration with:
          <br />• Redirect URI (Web): <code>{redirectUri}</code>
          <br />• API permissions (delegated): openid, profile, email, User.Read
          <br />• API permissions (application): User.Read.All (admin-consent for org-tree lookups)
          <br />• Generate a client secret and paste it below.
        </p>

        <label>
          <span className="tiny muted">Tenant ID</span>
          <input
            required
            placeholder="00000000-0000-0000-0000-000000000000"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
          />
        </label>
        <label>
          <span className="tiny muted">Application (client) ID</span>
          <input
            required
            placeholder="00000000-0000-0000-0000-000000000000"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
        </label>
        <label>
          <span className="tiny muted">Client secret</span>
          <input
            required
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
          />
        </label>

        <h2>Initial admins</h2>
        <label>
          <span className="tiny muted">
            Comma- or newline-separated email addresses. These users get full access.
          </span>
          <textarea
            rows={3}
            required
            value={adminEmails}
            onChange={(e) => setAdminEmails(e.target.value)}
          />
        </label>

        <div className="row-gap" style={{ marginTop: 16 }}>
          <button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save and continue to sign-in"}
          </button>
          {err && <span className="pill danger">{err}</span>}
        </div>
      </form>
    </div>
  );
}
