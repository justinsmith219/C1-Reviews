import { Campaign, Review, Reviewer } from "../types/domain";
import { config } from "../config";

export interface ReminderContext {
  reviewer: Reviewer;
  campaign: Campaign;
  pendingReviews: Review[];
  daysRemaining?: number;
  kind: "reminder" | "manager_escalation" | "skip_level_escalation" | "overdue_final" | "manual" | "campaign_open";
  managerEmails?: string[]; // for escalation emails cc
}

function plural(n: number, s: string): string {
  return `${n} ${s}${n === 1 ? "" : "s"}`;
}

function dueLine(ctx: ReminderContext): string {
  if (ctx.daysRemaining == null) return "Please complete your reviews at your earliest convenience.";
  if (ctx.daysRemaining < 0) return `*Overdue by ${plural(Math.abs(ctx.daysRemaining), "day")}.*`;
  if (ctx.daysRemaining === 0) return "*Due today.*";
  return `Due in ${plural(ctx.daysRemaining, "day")}.`;
}

function headlineByKind(ctx: ReminderContext): string {
  switch (ctx.kind) {
    case "manager_escalation":
      return `Access reviews outstanding on your team — ${ctx.campaign.name}`;
    case "skip_level_escalation":
      return `Final notice: access reviews outstanding in your org — ${ctx.campaign.name}`;
    case "overdue_final":
      return `Access reviews overdue — ${ctx.campaign.name} (access may be revoked)`;
    case "campaign_open":
      return `Access review campaign opened — ${ctx.campaign.name}`;
    case "manual":
      return `Reminder: access reviews pending — ${ctx.campaign.name}`;
    case "reminder":
    default:
      return `Reminder: access reviews pending — ${ctx.campaign.name}`;
  }
}

export function buildSlackMessage(ctx: ReminderContext): {
  text: string;
  blocks: any[];
} {
  const headline = headlineByKind(ctx);
  const countLine = `You have *${plural(ctx.pendingReviews.length, "pending review")}* in *${ctx.campaign.name}*.`;
  const lines: string[] = [countLine, dueLine(ctx), ""];
  const shown = ctx.pendingReviews.slice(0, 10);
  for (const r of shown) {
    const name = r.subjectUserDisplayName ?? r.subjectUserEmail ?? r.subjectUserId ?? "(unknown user)";
    const ent = r.entitlement ? ` — ${r.entitlement}` : "";
    lines.push(`• ${name}${ent}`);
  }
  if (ctx.pendingReviews.length > shown.length) {
    lines.push(`…and ${ctx.pendingReviews.length - shown.length} more.`);
  }
  const c1Url = `${config.conductor1.baseUrl}/access-reviews/${ctx.campaign.id}`;
  const dashUrl = `${config.publicBaseUrl}/campaigns/${ctx.campaign.id}`;
  lines.push("", `<${c1Url}|Open in ConductorOne> · <${dashUrl}|View in dashboard>`);
  const text = `${headline}\n\n${lines.join("\n")}`;
  const blocks = [
    { type: "header", text: { type: "plain_text", text: headline } },
    { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
  ];
  return { text, blocks };
}

export function buildEmail(ctx: ReminderContext): { subject: string; html: string; text: string } {
  const headline = headlineByKind(ctx);
  const c1Url = `${config.conductor1.baseUrl}/access-reviews/${ctx.campaign.id}`;
  const dashUrl = `${config.publicBaseUrl}/campaigns/${ctx.campaign.id}`;
  const rows = ctx.pendingReviews
    .slice(0, 50)
    .map((r) => {
      const name = r.subjectUserDisplayName ?? r.subjectUserEmail ?? r.subjectUserId ?? "(unknown user)";
      const ent = r.entitlement ? `<td>${escapeHtml(r.entitlement)}</td>` : "<td></td>";
      return `<tr><td>${escapeHtml(name)}</td>${ent}</tr>`;
    })
    .join("");
  const extra =
    ctx.pendingReviews.length > 50
      ? `<p>…and ${ctx.pendingReviews.length - 50} more not shown. See full list in ConductorOne.</p>`
      : "";
  const due = ctx.daysRemaining == null
    ? "Please complete your reviews."
    : ctx.daysRemaining < 0
    ? `<strong>Overdue by ${Math.abs(ctx.daysRemaining)} day(s).</strong>`
    : ctx.daysRemaining === 0
    ? "<strong>Due today.</strong>"
    : `Due in ${ctx.daysRemaining} day(s).`;

  const html = `
<div style="font-family: -apple-system, Segoe UI, Arial, sans-serif; font-size: 14px; color: #1a1f2b;">
  <h2 style="margin:0 0 12px 0;">${escapeHtml(headline)}</h2>
  <p>Hi ${escapeHtml(ctx.reviewer.displayName)},</p>
  <p>You have <strong>${ctx.pendingReviews.length} pending review${ctx.pendingReviews.length === 1 ? "" : "s"}</strong>
  in <strong>${escapeHtml(ctx.campaign.name)}</strong>.</p>
  <p>${due}</p>
  <table cellspacing="0" cellpadding="6" style="border-collapse:collapse; border:1px solid #e3e6eb;">
    <thead><tr style="background:#f7f8fa;"><th align="left">User</th><th align="left">Entitlement</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${extra}
  <p style="margin-top:20px;">
    <a href="${c1Url}" style="background:#2c6ef2;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;">Open in ConductorOne</a>
    &nbsp;
    <a href="${dashUrl}" style="color:#2c6ef2;">View in Zinnia dashboard</a>
  </p>
  <p style="color:#6b7280;font-size:12px;margin-top:24px;">
    Sent by Zinnia Access Reviews. Reply to this email if you have questions.
  </p>
</div>`.trim();

  const text = [
    headline,
    `Hi ${ctx.reviewer.displayName},`,
    `You have ${ctx.pendingReviews.length} pending review(s) in ${ctx.campaign.name}.`,
    ctx.daysRemaining == null
      ? ""
      : ctx.daysRemaining < 0
      ? `Overdue by ${Math.abs(ctx.daysRemaining)} day(s).`
      : `Due in ${ctx.daysRemaining} day(s).`,
    "",
    ...ctx.pendingReviews.slice(0, 20).map((r) => {
      const name = r.subjectUserDisplayName ?? r.subjectUserEmail ?? r.subjectUserId ?? "(unknown user)";
      return r.entitlement ? ` - ${name} — ${r.entitlement}` : ` - ${name}`;
    }),
    "",
    `Open in ConductorOne: ${c1Url}`,
    `Dashboard: ${dashUrl}`,
  ].join("\n");

  return { subject: headline, html, text };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]!));
}
