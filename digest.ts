import { Campaign } from "../types/domain";
import { config } from "../config";

export function buildAdminDigest(args: {
  campaigns: Campaign[];
  atRisk: { campaign: Campaign; pct: number; daysRemaining?: number; overdueReviewers: number }[];
}): { subject: string; html: string; text: string; slackBlocks: any[] } {
  const subject = `Access reviews daily digest — ${args.atRisk.length} campaign(s) at risk`;
  const riskLines = args.atRisk.map((r) => {
    const d = r.daysRemaining == null ? "no deadline" : `${r.daysRemaining}d left`;
    return `• ${r.campaign.name} — ${r.pct}% complete, ${d}, ${r.overdueReviewers} reviewer(s) behind`;
  });
  const text = [
    "Zinnia Access Reviews — daily digest",
    `${args.campaigns.length} open campaign(s). ${args.atRisk.length} at risk.`,
    "",
    ...(riskLines.length ? riskLines : ["No at-risk campaigns."]),
    "",
    `Dashboard: ${config.publicBaseUrl}`,
  ].join("\n");

  const rows = args.atRisk
    .map(
      (r) =>
        `<tr><td>${esc(r.campaign.name)}</td><td>${r.pct}%</td><td>${
          r.daysRemaining == null ? "—" : `${r.daysRemaining}d`
        }</td><td>${r.overdueReviewers}</td></tr>`
    )
    .join("");
  const html = `
<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:14px;">
  <h2>Access reviews — daily digest</h2>
  <p>${args.campaigns.length} open campaign(s). ${args.atRisk.length} at risk.</p>
  <table cellspacing="0" cellpadding="6" style="border-collapse:collapse;border:1px solid #e3e6eb;">
    <thead><tr style="background:#f7f8fa;"><th align="left">Campaign</th><th>%</th><th>Time left</th><th>Behind</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4">No at-risk campaigns.</td></tr>'}</tbody>
  </table>
  <p><a href="${config.publicBaseUrl}">Open dashboard</a></p>
</div>`.trim();

  const slackBlocks = [
    { type: "header", text: { type: "plain_text", text: "Access reviews — daily digest" } },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${args.campaigns.length} open campaign(s). *${args.atRisk.length}* at risk.\n\n${
          riskLines.join("\n") || "_No at-risk campaigns._"
        }`,
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `<${config.publicBaseUrl}|Open dashboard>` },
    },
  ];

  return { subject, html, text, slackBlocks };
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]!));
}
