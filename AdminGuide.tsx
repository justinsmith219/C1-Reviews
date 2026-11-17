export function AdminGuide() {
  return (
    <div className="panel" style={{ maxWidth: 860 }}>
      <div className="panel-head">
        <h1>Admin guide</h1>
        <span className="muted tiny">Zinnia Access Reviews — Campaign Manager</span>
      </div>

      <GuideSection title="Admin access">
        <p>
          Admin access is granted by adding an email address to <code>ADMIN_EMAILS</code> in the
          server <code>.env</code> file, or via the first-run setup page. Admins see the{" "}
          <strong>Admin</strong> section in the sidebar, the <strong>Replay</strong> link, and all
          bulk action controls throughout the app.
        </p>
        <p>
          Use <strong>View As → Manager / Reviewer</strong> in the top bar to preview what a
          non-admin user sees without losing your own access.
        </p>
      </GuideSection>

      <GuideSection title="Settings & Configuration">
        <p>
          <strong>/admin</strong> → <em>Settings &amp; Config</em> tab. All settings are stored in{" "}
          <code>data/runtime-config.json</code> and take effect immediately without a restart.
        </p>

        <h4>ConductorOne</h4>
        <ul>
          <li><strong>Tenant URL</strong> — your ConductorOne tenant base URL.</li>
          <li><strong>API token</strong> — service account token. Used for all campaign and task fetches.</li>
          <li><strong>Test connection</strong> — verifies the token and returns the number of active campaigns.</li>
        </ul>

        <h4>Microsoft Entra / Graph</h4>
        <ul>
          <li>Client ID, Tenant ID, Client Secret — used for SSO login and Graph API (org hierarchy, account status).</li>
          <li><strong>Test connection</strong> — verifies Graph access and returns your tenant display name.</li>
        </ul>

        <h4>Slack</h4>
        <ul>
          <li><strong>Bot token</strong> — Slack app bot token (<code>xoxb-…</code>). Required for all Slack DMs and channel posts.</li>
          <li><strong>Test connection</strong> — posts a test message to the bot's own DM.</li>
        </ul>

        <h4>SMTP / Email</h4>
        <ul>
          <li>Host, port, username, password, from address. Uses Zinnia's internal SMTP relay.</li>
          <li><strong>Test connection</strong> — sends a test email to the configured from address.</li>
        </ul>

        <h4>On-premises Active Directory</h4>
        <ul>
          <li><strong>Enabled</strong> — toggle to activate on-prem AD account disable/enable actions.</li>
          <li><strong>Domain</strong> — AD domain name (e.g. <code>zinnia.local</code>).</li>
          <li><strong>Username / Password</strong> — service account with Write-userAccountControl on the relevant OUs.</li>
          <li>
            AD status is cached per user for 5 minutes. After a disable/enable action the cache is
            busted immediately.
          </li>
        </ul>

        <h4>Notification controls</h4>
        <table className="table">
          <thead>
            <tr><th>Setting</th><th>Effect</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Auto-send enabled</td>
              <td>Monthly reminders fire automatically on schedule. Turn off to pause all auto sends.</td>
            </tr>
            <tr>
              <td>Dry run (reviewer/manager)</td>
              <td>Reviewer and manager notifications are logged but not actually sent.</td>
            </tr>
            <tr>
              <td>Admin dry run</td>
              <td>IAM channel and helpdesk notifications are logged but not sent.</td>
            </tr>
            <tr>
              <td>Test recipient</td>
              <td>When set, all outbound messages are redirected to this address instead of the real recipient.</td>
            </tr>
          </tbody>
        </table>

        <h4>Completion alert</h4>
        <ul>
          <li>Fires once per campaign when it reaches 100% complete but is still open in ConductorOne.</li>
          <li>Destination: Slack channel, Slack DM, or email.</li>
          <li>Sent IDs are persisted — it will never double-fire for the same campaign.</li>
          <li>Runs automatically after every hourly snapshot refresh, or immediately after a manual refresh.</li>
        </ul>

        <h4>Helpdesk notification</h4>
        <ul>
          <li><strong>Enabled</strong> — when on, a consolidated Slack message is posted to the helpdesk channel whenever accounts are disabled or re-enabled via the batch workflow.</li>
          <li><strong>Channel</strong> — Slack channel name (with or without <code>#</code>).</li>
          <li>Even when disabled, the rendered message body is still logged to the notification log so you can preview it.</li>
        </ul>

        <h4>Schedule</h4>
        <ul>
          <li><strong>Refresh interval</strong> — how often the server pulls from ConductorOne (default: every hour). Accepts hours as an integer or a full cron expression.</li>
          <li><strong>Monthly reminder</strong> — cron expression for when the monthly reviewer reminder fires (default: 1st of each month at 8 AM).</li>
          <li><strong>Timezone</strong> — all cron expressions evaluate in this timezone.</li>
        </ul>
      </GuideSection>

      <GuideSection title="Templates">
        <p>
          <strong>/admin</strong> → <em>Templates</em> tab. All Slack and email notification bodies are
          editable here. Changes take effect on the next send — no restart required.
        </p>
        <p>
          Templates use <code>{"{{token}}"}</code> syntax. The token reference is shown at the bottom
          of the editor under <em>Available tokens</em>.
        </p>
        <p>Templates are grouped into two categories:</p>
        <h4>Reminders</h4>
        <table className="table">
          <thead><tr><th>Section</th><th>Used for</th></tr></thead>
          <tbody>
            <tr><td>Wrapper</td><td>Outer greeting and closing for all reminder emails/Slack messages. Contains <code>{"{{sections}}"}</code> which is replaced with the applicable section blocks.</td></tr>
            <tr><td>Reviewer pending</td><td>Body shown to a reviewer listing their own pending items.</td></tr>
            <tr><td>Direct reports behind</td><td>Section shown to a manager listing their direct reports who are behind.</td></tr>
            <tr><td>Skip-level behind</td><td>Same, for people two levels down.</td></tr>
            <tr><td>Further down behind</td><td>Same, for people three or more levels down.</td></tr>
            <tr><td>Admin digest</td><td>Daily summary sent to the IAM channel: open campaigns, at-risk, pending count, reviewers behind.</td></tr>
          </tbody>
        </table>
        <h4>Account actions</h4>
        <table className="table">
          <thead><tr><th>Section</th><th>Used for</th></tr></thead>
          <tbody>
            <tr><td>Account disabled (IAM / Helpdesk)</td><td>Consolidated message posted to the IAM and helpdesk Slack channels when accounts are disabled in a batch.</td></tr>
            <tr><td>Account re-enabled (IAM / Helpdesk)</td><td>Same, for re-enable actions.</td></tr>
            <tr><td>Reviewer notified — account disabled</td><td>Slack DM and email sent directly to the reviewer whose review is overdue, telling them to complete it and contact Helpdesk.</td></tr>
            <tr><td>Manager notified — account disabled</td><td>FYI Slack DM and email sent to the reviewer's manager.</td></tr>
          </tbody>
        </table>
        <p>
          Templates can be overridden per campaign — edit a template with a campaign selected in the
          dropdown to create a campaign-specific override. The global template is used as a fallback.
        </p>
      </GuideSection>

      <GuideSection title="Batch account disable / re-enable">
        <p>
          Available on <strong>Open reviews → Impacted accounts</strong> tab. Only admins can stage
          and apply account changes. Only <code>@zinnia.com</code> accounts on overdue reviews are
          actionable.
        </p>
        <h4>Workflow</h4>
        <ol>
          <li>
            Click an <span className="pill ok" style={{fontSize:"0.8rem"}}>● active</span> pill in
            the Azure Account or On-prem AD column to stage a disable. The pill turns{" "}
            <span className="pill warn" style={{fontSize:"0.8rem"}}>● disable staged</span>.
          </li>
          <li>Repeat for any other accounts. Click a staged pill again to unstage it.</li>
          <li>
            An orange pill appears fixed at the bottom of the screen showing the staged count.
            Click <strong>Review &amp; Apply</strong>.
          </li>
          <li>
            The review modal lists all staged disables and re-enables with name, email, and system.
            Click <strong>Apply</strong> to execute.
          </li>
          <li>
            After apply, a result banner shows each change individually (name, system, action).
            Any failures are listed with the error — those accounts must be handled manually.
          </li>
        </ol>
        <h4>What happens after apply</h4>
        <ul>
          <li>
            <strong>IAM channel</strong> — one consolidated Slack message listing all disabled /
            re-enabled accounts.
          </li>
          <li>
            <strong>Helpdesk channel</strong> — same message. Re-enable actions <em>edit</em> the
            original disable message with strikethrough rather than posting a new one. If helpdesk
            notifications are disabled, the message is still logged in the notification log.
          </li>
          <li>
            <strong>Reviewer</strong> — individual Slack DM and email instructing them to complete
            the review in ConductorOne and contact Helpdesk (not IAM) to request re-enablement.
          </li>
          <li>
            <strong>Reviewer's manager</strong> — separate FYI Slack DM and email.
          </li>
        </ul>
        <p className="muted tiny">
          All messages use the Account action templates and respect the dry-run and admin dry-run
          flags in Configuration.
        </p>
      </GuideSection>

      <GuideSection title="Tiers">
        <p>
          <strong>/admin</strong> → <em>Tiers</em> tab. Tiers classify reviewers by urgency.
          Each tier has a name, colour, and criteria (e.g. days overdue threshold). Reviewers in
          the Reviewers tab are tagged with their tier badge. Tiers are also used in filter dropdowns
          and bulk-notify targeting.
        </p>
      </GuideSection>

      <GuideSection title="EA Mappings">
        <p>
          <strong>/admin</strong> → <em>EA Mappings</em> tab. Maps Executive Assistant accounts to
          the executives they support. An EA can then use the <strong>View As</strong> switcher
          to see and act on behalf of their executive. Mappings are many-to-many.
        </p>
      </GuideSection>

      <GuideSection title="Suppressions">
        <p>
          <strong>/admin</strong> → <em>Suppressions</em> tab. Suppressed users are excluded from
          all automated reminder notifications (e.g. someone on extended leave). They still appear
          in dashboards and reports. Add a reason and optional expiry date when creating a suppression.
        </p>
      </GuideSection>

      <GuideSection title="Audit log">
        <p>
          <strong>/admin</strong> → <em>Audit</em> tab. Every notification sent, configuration
          change, EA mapping edit, refresh, and manual action is appended to{" "}
          <code>data/audit-log.jsonl</code>. The UI shows the 500 most recent entries, filterable
          by actor, action, and date. The raw file can be tailed on the server for real-time
          monitoring.
        </p>
      </GuideSection>

      <GuideSection title="Operations">
        <p>
          <strong>/admin</strong> → <em>Operations</em> tab.
        </p>
        <ul>
          <li>
            <strong>Refresh now</strong> — triggers an immediate full snapshot pull from
            ConductorOne, then runs completion and overdue alert checks.
          </li>
          <li>
            <strong>Import history</strong> — backfills closed campaigns from ConductorOne into the
            local archive. Safe to run at any time; already-imported campaigns are skipped.
          </li>
          <li>
            <strong>Jobs panel</strong> — shows the status and last-run time of all scheduled jobs
            (campaign refresh, monthly reminder, overdue alert). Green = last run succeeded.
          </li>
        </ul>
        <p>
          To refresh a single campaign without touching others, open the campaign detail page and
          click <strong>Refresh stats</strong>.
        </p>
      </GuideSection>

      <GuideSection title="Notification system">
        <h4>Monthly reminders</h4>
        <p>
          Fire on the 1st of each month (configurable). Sent to all reviewers with pending reviews
          who are not suppressed. The message is assembled from the Wrapper + applicable section
          templates. Managers receive a rollup of their direct and skip-level reports who are behind.
        </p>
        <h4>Bulk notify (ad-hoc)</h4>
        <p>
          On <strong>Open reviews → Reviewers</strong>, select rows with the checkboxes and click{" "}
          <strong>Bulk notify</strong>. Choose a template section and channel, preview the rendered
          message, and send. Useful for targeted nudges before a deadline.
        </p>
        <h4>Completion alert</h4>
        <p>
          Fires once when a campaign reaches 100%. Configure the destination in Settings. Sent IDs
          are persisted — it will never double-fire.
        </p>
        <h4>Overdue alert</h4>
        <p>
          Fires once per campaign when it crosses the configured overdue threshold. Sent to the IAM
          channel listing which reviewers are behind.
        </p>
        <h4>Dry-run mode</h4>
        <p>
          Enable <strong>Admin dry run</strong> or <strong>Dry run (reviewer/manager)</strong> in
          Configuration to log all outbound messages without actually sending them. The notification
          log shows dry-run entries with a badge. Use this to validate templates and recipient
          targeting before going live.
        </p>
      </GuideSection>

      <GuideSection title="Impersonation">
        <p>
          Admins can impersonate any user to see exactly what they see. Use the{" "}
          <strong>Impersonate</strong> control in the top bar. An orange strip appears at the top of
          the page while impersonating. Click <strong>Exit impersonation</strong> to return to your
          own view.
        </p>
        <p className="muted tiny">
          Impersonation is view-only — actions taken while impersonating are attributed to the
          original admin in the audit log.
        </p>
      </GuideSection>

      <GuideSection title="Replay (testing)">
        <p>
          <strong>/replay</strong> lets you re-run a past notification batch against the current
          snapshot to test template changes or verify routing. Replay sends are always dry-run
          regardless of the global dry-run setting.
        </p>
      </GuideSection>

      <GuideSection title="Data files">
        <p>
          All persistent state lives under <code>data/</code> on the server. Do not commit these
          files to version control.
        </p>
        <table className="table">
          <thead><tr><th>File</th><th>Contents</th></tr></thead>
          <tbody>
            <tr><td><code>runtime-config.json</code></td><td>All settings saved from the Configuration page.</td></tr>
            <tr><td><code>campaign-snapshot.json</code></td><td>Latest full snapshot from ConductorOne.</td></tr>
            <tr><td><code>historical-campaigns.json</code></td><td>Closed campaign archive.</td></tr>
            <tr><td><code>campaign-tasks/*.json</code></td><td>Per-campaign task detail cache (active campaigns, delta-synced).</td></tr>
            <tr><td><code>graph-users-cache.json</code></td><td>Entra user cache (6-hour TTL).</td></tr>
            <tr><td><code>audit-log.jsonl</code></td><td>Append-only audit trail.</td></tr>
            <tr><td><code>notifications.jsonl</code></td><td>Sent-notification log.</td></tr>
            <tr><td><code>completion-alerts-sent.json</code></td><td>Campaign IDs that have already received a completion alert.</td></tr>
            <tr><td><code>templates.json</code></td><td>Global and per-campaign template overrides.</td></tr>
          </tbody>
        </table>
        <p>
          Back up by copying the entire <code>data/</code> directory. The application is otherwise
          stateless — losing <code>data/</code> only loses caches and history; it will re-fetch on
          the next refresh.
        </p>
      </GuideSection>

      <GuideSection title="Deployment & updates">
        <p>
          See <strong>DEPLOY.md</strong> in the repository root for full deployment instructions.
          For routine updates:
        </p>
        <ol>
          <li>Build on Mac: <code>npm run build</code></li>
          <li>Copy <code>c1-campaign-manager.zip</code> and <code>deploy.ps1</code> to <code>C:\Temp\</code> on the server.</li>
          <li>Run <code>C:\Temp\deploy.ps1</code> in PowerShell. It stops the service, extracts the zip, runs <code>npm install</code>, starts the service, and does a health check.</li>
        </ol>
        <p>
          The Windows service is named <strong>C1ReviewsCampaignManager</strong>. Use{" "}
          <code>net start / net stop</code> or <code>Services.msc</code> to manage it.
        </p>
      </GuideSection>
    </div>
  );
}

function GuideSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h2 style={{ borderBottom: "2px solid var(--zinnia-border)", paddingBottom: 6, marginBottom: 12 }}>
        {title}
      </h2>
      {children}
    </div>
  );
}
