export function UserGuide() {
  return (
    <div className="panel" style={{ maxWidth: 860 }}>
      <div className="panel-head">
        <h1>User guide</h1>
        <span className="muted tiny">Zinnia Access Reviews — Campaign Manager</span>
      </div>

      <GuideSection title="What is this tool?">
        <p>
          The Campaign Manager is Zinnia's internal dashboard for managing ConductorOne PAM access-review
          campaigns. It gives reviewers, managers, and the IAM team a single place to track who has
          completed their reviews, who is behind, and which accounts are at risk — without logging into
          ConductorOne directly for day-to-day monitoring.
        </p>
        <p>
          Data is pulled from ConductorOne automatically every hour. You can also force an immediate
          refresh from the Overview page.
        </p>
      </GuideSection>

      <GuideSection title="Roles">
        <table className="table">
          <thead>
            <tr><th>Role</th><th>What you can see and do</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Admin</strong></td>
              <td>Full access to all pages, configuration, bulk actions, and the notification system.</td>
            </tr>
            <tr>
              <td><strong>Manager</strong></td>
              <td>
                Your own reviews plus your entire downstream org (direct reports, skip-level, and further).
                Scoped automatically using your Entra <em>manager</em> attribute.
              </td>
            </tr>
            <tr>
              <td><strong>Executive Assistant (EA)</strong></td>
              <td>
                See and act on behalf of the executive(s) you are mapped to. Mappings are managed by an admin.
              </td>
            </tr>
            <tr>
              <td><strong>Reviewer / IC</strong></td>
              <td>My Queue and your own profile. Read-only on all other pages.</td>
            </tr>
          </tbody>
        </table>
      </GuideSection>

      <GuideSection title="Overview dashboard">
        <p>
          The home page (<strong>/</strong>) shows a real-time snapshot of all active campaigns: total
          reviews, completion rates, progress bars, and deadlines. Campaigns are sorted with the most
          at-risk at the top.
        </p>
        <ul>
          <li>Click a campaign name to open its detail page.</li>
          <li>The <strong>Refresh now</strong> button pulls the latest data from ConductorOne immediately.</li>
          <li>The timestamp next to Refresh shows when data was last fetched.</li>
          <li>A campaign shows as <span className="pill danger" style={{fontSize:"0.8rem"}}>at risk</span> when its deadline is within the configured warning window.</li>
        </ul>
      </GuideSection>

      <GuideSection title="Campaign detail page">
        <p>
          Open any campaign from the Overview or from search. The detail page shows:
        </p>
        <ul>
          <li><strong>Summary stats</strong> — total reviews, completed, pending, approval and revocation rates.</li>
          <li><strong>Reviewer breakdown</strong> — each reviewer's completion count and pending count.</li>
          <li><strong>Timeline chart</strong> — daily progress over the life of the campaign.</li>
          <li><strong>Refresh stats</strong> button — forces a fresh pull from ConductorOne for this campaign only (bypasses the 1-hour cache).</li>
        </ul>
      </GuideSection>

      <GuideSection title="Open reviews">
        <p>
          <strong>/open-reviews</strong> has three tabs:
        </p>
        <h4 style={{ marginBottom: 4 }}>Reviewers tab</h4>
        <p>
          Every reviewer who has at least one pending review, with their campaign, pending count, time
          remaining, tier, and completion progress across all open campaigns. Use the filter bar to
          narrow by text, campaign, tier, or overdue threshold.
        </p>
        <ul>
          <li>
            <strong>Export CSV</strong> — downloads all visible rows. Useful for ad-hoc reporting.
          </li>
          <li>
            <strong>Bulk notify</strong> (admin only) — select rows and send a custom Slack or email
            reminder to the selected reviewers.
          </li>
        </ul>

        <h4 style={{ marginBottom: 4 }}>Impacted entitlements tab</h4>
        <p>
          All users whose access is currently under review, grouped by entitlement. Shows associated
          reviewers, campaigns, and risk level. Useful for understanding which systems are most exposed
          if reviews are not completed.
        </p>

        <h4 style={{ marginBottom: 4 }}>Impacted accounts tab</h4>
        <p>
          One row per user whose access is being reviewed. Shows time until overdue, risk level, and
          live Azure and on-premises AD account status. Only <code>@zinnia.com</code> accounts are shown.
        </p>
        <ul>
          <li>
            <strong>Azure Account / On-prem AD columns</strong> — show the live enabled/disabled state.
            <span className="pill ok" style={{fontSize:"0.8rem",marginLeft:4}}>● active</span> or{" "}
            <span className="pill danger" style={{fontSize:"0.8rem",marginLeft:4}}>● disabled</span>.
            "Cloud only" means the user has no on-premises AD account.
          </li>
          <li>
            <strong>Staging account actions (admin only)</strong> — see the Admin Guide for the batch
            disable/re-enable workflow.
          </li>
          <li>
            <strong>↻ Refresh statuses</strong> — re-fetches live Azure account status for all rows.
            AD status is cached for 5 minutes and refreshes automatically.
          </li>
        </ul>
      </GuideSection>

      <GuideSection title="My queue">
        <p>
          <strong>/my-queue</strong> shows all pending reviews assigned to you across every active
          campaign. Click the ConductorOne link to open the review directly.
        </p>
      </GuideSection>

      <GuideSection title="Org tree">
        <p>
          <strong>/org-tree</strong> shows the full manager hierarchy pulled from Entra ID. Expand
          nodes to see direct reports and their completion status. Useful for managers to spot who in
          their chain is behind.
        </p>
      </GuideSection>

      <GuideSection title="Manager rollup">
        <p>
          <strong>/managers</strong> summarises review completion by manager. Each row shows a manager,
          the total reviews assigned to their org, and the percentage complete. Drill into any manager
          to see their individual direct reports.
        </p>
      </GuideSection>

      <GuideSection title="Scorecards">
        <p>
          <strong>/scorecards</strong> ranks reviewers by completion rate and speed across all
          campaigns they have participated in. Useful for recognising top performers and identifying
          chronic laggards.
        </p>
      </GuideSection>

      <GuideSection title="Historical trend">
        <p>
          <strong>/trend</strong> charts the total pending review count over time, one data point per
          hourly refresh. Shows how the org's review load is growing or shrinking.
        </p>
      </GuideSection>

      <GuideSection title="Campaign history">
        <p>
          <strong>/history</strong> lists all closed campaigns. Click any entry to see its final
          stats, reviewer-level breakdown, and timeline — even after it has been closed in
          ConductorOne. Use <strong>Refresh stats</strong> on the history detail page to recompute
          aggregates if needed.
        </p>
      </GuideSection>

      <GuideSection title="Notification log">
        <p>
          <strong>/notifications</strong> shows every Slack DM, email, and channel message sent by
          the system — reminders, digests, account action notifications, and completion alerts.
          Each entry shows the recipient, channel, timestamp, whether it succeeded, and whether it
          was a dry run.
        </p>
        <p>
          Use this page to verify that notifications are being delivered, or to check what a
          dry-run message would have looked like before enabling live sends.
        </p>
      </GuideSection>

      <GuideSection title="Profile pages">
        <p>
          Click any reviewer's name anywhere in the app to open their profile. The profile page shows:
        </p>
        <ul>
          <li>All pending reviews across campaigns.</li>
          <li>Completed reviews in the current cycle.</li>
          <li>Manager chain (Entra-sourced).</li>
          <li>Historical scorecard data.</li>
        </ul>
      </GuideSection>

      <GuideSection title="Search">
        <p>
          The global search bar (top of every page) finds reviewers, campaign names, and entitlements
          across the current snapshot. Results link directly to the relevant profile or campaign.
        </p>
      </GuideSection>

      <GuideSection title="View As (managers and EAs)">
        <p>
          Managers can use the <strong>View As</strong> switcher in the top bar to see the dashboard
          from their own perspective (scoped to their org) or from an admin-level view if they have
          that access. Executive Assistants can switch between the executives they support.
        </p>
      </GuideSection>

      <GuideSection title="Notifications you will receive">
        <table className="table">
          <thead>
            <tr><th>Trigger</th><th>Who receives it</th><th>Channel</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Monthly reminder (1st of each month)</td>
              <td>All reviewers with pending reviews</td>
              <td>Slack DM + email</td>
            </tr>
            <tr>
              <td>Your account is disabled due to overdue review</td>
              <td>Reviewer assigned to the overdue review</td>
              <td>Slack DM + email</td>
            </tr>
            <tr>
              <td>Your direct report's account was disabled</td>
              <td>Reviewer's manager</td>
              <td>Slack DM + email</td>
            </tr>
          </tbody>
        </table>
        <p className="muted tiny" style={{ marginTop: 8 }}>
          If your account is disabled because of an overdue review: complete the review in
          ConductorOne, then contact the <strong>Helpdesk</strong> to request re-enablement.
          Do not contact the IAM team directly.
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
