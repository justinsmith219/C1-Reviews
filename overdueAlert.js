"use strict";
// Fires after every campaign snapshot refresh.
// For each open campaign that is overdue (past its deadline), sends a
// one-time alert to the completionAlert destination listing which
// @zinnia.com accounts still have pending reviews and are candidates
// for Azure AD account disable.
//
// Accounts that are already confirmed-disabled in Azure AD (accountEnabled===false
// in the Graph cache) are excluded — no point listing them again.
//
// Sent campaign IDs are persisted to data/overdue-alerts-sent.json so
// we never double-alert after a server restart. One alert per campaign —
// if more accounts become overdue later they are included in the original
// single alert (since we only fire once per campaign).
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkOverdueAlerts = checkOverdueAlerts;
const campaignStore_1 = require("../services/campaignStore");
const config_1 = require("../config");
const logger_1 = require("../logger");
const storage_1 = require("../services/storage");
const notifications_1 = require("../services/notifications");
const slack_1 = require("../services/slack");
const email_1 = require("../services/email");
const deadline_1 = require("../lib/deadline");
const graph_1 = require("../services/graph");
const web_api_1 = require("@slack/web-api");
const SENT_KEY = "overdue-alerts-sent";
const ZINNIA_DOMAIN = "@zinnia.com";
async function getSentIds() {
    const arr = await (0, storage_1.readJson)(SENT_KEY, []);
    return new Set(arr);
}
async function addSentId(id) {
    const arr = await (0, storage_1.readJson)(SENT_KEY, []);
    if (!arr.includes(id)) {
        arr.push(id);
        await (0, storage_1.writeJson)(SENT_KEY, arr);
    }
}
async function sendToSlackChannel(channel, text) {
    if (config_1.config.notifications.adminDryRun) {
        logger_1.logger.info("overdue_alert_dry_run", { channel, len: text.length });
        return { ok: true, dryRun: true };
    }
    if (!config_1.config.slack.botToken)
        return { ok: false, error: "SLACK_BOT_TOKEN not configured" };
    try {
        const client = new web_api_1.WebClient(config_1.config.slack.botToken);
        const ch = channel.startsWith("#") ? channel : `#${channel}`;
        await client.chat.postMessage({ channel: ch, text, unfurl_links: false });
        return { ok: true };
    }
    catch (err) {
        const errMsg = err?.data?.error ?? err?.message ?? "slack_error";
        logger_1.logger.warn("overdue_alert_slack_channel_failed", { channel, err: errMsg });
        return { ok: false, error: errMsg };
    }
}
async function checkOverdueAlerts() {
    const cfg = config_1.config.completionAlert;
    if (!cfg.enabled || !cfg.recipient)
        return;
    if (!config_1.config.notifications.adminNotificationsEnabled)
        return;
    const snap = await (0, campaignStore_1.getSnapshot)();
    if (!snap)
        return;
    const sentIds = await getSentIds();
    // Build a quick lookup: reviewerId -> reviewer email
    const reviewerById = new Map(snap.reviewers.map((r) => [r.id, r]));
    // Find overdue open campaigns that haven't been alerted yet
    const overdueCampaigns = [];
    for (const campaign of snap.campaigns) {
        if (campaign.status !== "open")
            continue;
        if (!campaign.endDate)
            continue;
        if (sentIds.has(campaign.id))
            continue;
        const days = (0, deadline_1.daysUntilDeadline)(campaign.endDate);
        if (days === null || days >= 0)
            continue; // not overdue
        // Collect unique @zinnia.com subjects with pending reviews in this campaign
        const accountMap = new Map(); // email -> displayName
        for (const review of snap.reviews) {
            if (review.campaignId !== campaign.id)
                continue;
            if (review.status !== "pending")
                continue;
            const email = (review.subjectUserEmail ?? "").toLowerCase();
            if (!email.endsWith(ZINNIA_DOMAIN))
                continue;
            if (!accountMap.has(email)) {
                accountMap.set(email, review.subjectUserDisplayName ?? email);
            }
        }
        if (accountMap.size === 0)
            continue; // no zinnia.com accounts pending
        // Filter out accounts already confirmed-disabled in Azure AD.
        // Uses the Graph cache (6h TTL) — no live API call, so this is fast.
        // If cache has no entry (null returned) we include the account to be safe.
        const enabledAccounts = [];
        for (const [email, displayName] of accountMap) {
            try {
                const u = await (0, graph_1.getUserByEmail)(email);
                // Only exclude if Graph explicitly says accountEnabled === false.
                if (u && u.accountEnabled === false)
                    continue;
            }
            catch {
                // Graph error — include the account to be safe
            }
            enabledAccounts.push({ email, displayName });
        }
        if (enabledAccounts.length === 0) {
            // All accounts already disabled — nothing actionable to report
            logger_1.logger.info("overdue_alert_all_disabled", { campaignId: campaign.id });
            continue;
        }
        overdueCampaigns.push({
            id: campaign.id,
            name: campaign.name,
            daysOverdue: Math.abs(days),
            endDate: campaign.endDate,
            accounts: enabledAccounts,
        });
    }
    if (overdueCampaigns.length === 0)
        return;
    for (const campaign of overdueCampaigns) {
        const accountLines = campaign.accounts
            .map((a) => `• ${a.displayName} (${a.email})`)
            .join("\n");
        const slackText = `⚠️ *Overdue campaign — accounts ready to disable*\n` +
            `*${campaign.name}* is *${campaign.daysOverdue} day${campaign.daysOverdue !== 1 ? "s" : ""} overdue*` +
            (campaign.endDate ? ` (deadline: ${campaign.endDate.slice(0, 10)})` : "") +
            `.\n\n` +
            `The following Zinnia accounts still have pending reviews and can be disabled in Azure AD:\n` +
            `${accountLines}\n\n` +
            `To disable an account, go to *Impacted Accounts* in the Campaign Manager dashboard.`;
        const emailHtml = `<p>⚠️ <strong>Overdue campaign — accounts ready to disable</strong></p>` +
            `<p><strong>${campaign.name}</strong> is <strong>${campaign.daysOverdue} day${campaign.daysOverdue !== 1 ? "s" : ""} overdue</strong>` +
            (campaign.endDate ? ` (deadline: ${campaign.endDate.slice(0, 10)})` : "") +
            `.</p>` +
            `<p>The following Zinnia accounts still have pending reviews and can be disabled in Azure AD:</p>` +
            `<ul>${campaign.accounts.map((a) => `<li>${a.displayName} — <code>${a.email}</code></li>`).join("")}</ul>` +
            `<p>To disable an account, go to <strong>Impacted Accounts</strong> in the Campaign Manager dashboard.</p>`;
        let result = { ok: false };
        if (cfg.channel === "slack-channel") {
            result = await sendToSlackChannel(cfg.recipient, slackText);
        }
        else if (cfg.channel === "slack-dm") {
            result = await (0, slack_1.sendSlackDM)(cfg.recipient, slackText, undefined, { dryRun: config_1.config.notifications.adminDryRun });
        }
        else if (cfg.channel === "email") {
            result = await (0, email_1.sendEmail)({
                to: cfg.recipient,
                subject: `[Overdue – ${campaign.daysOverdue}d] ${campaign.name} — ${campaign.accounts.length} account${campaign.accounts.length !== 1 ? "s" : ""} ready to disable`,
                html: emailHtml,
                dryRun: config_1.config.notifications.adminDryRun,
            });
        }
        await (0, notifications_1.recordNotification)({
            channel: cfg.channel,
            kind: "overdue_final",
            recipientEmail: cfg.recipient,
            campaignId: campaign.id,
            subject: `Overdue campaign: ${campaign.name} (${campaign.daysOverdue}d overdue, ${campaign.accounts.length} accounts)`,
            body: slackText,
            success: result.ok,
            error: result.error,
            dryRun: result.dryRun ?? config_1.config.notifications.adminDryRun,
        });
        if (result.ok) {
            await addSentId(campaign.id);
            logger_1.logger.info("overdue_alert_sent", {
                campaignId: campaign.id,
                campaignName: campaign.name,
                daysOverdue: campaign.daysOverdue,
                accountCount: campaign.accounts.length,
                channel: cfg.channel,
                recipient: cfg.recipient,
            });
        }
    }
}
//# sourceMappingURL=overdueAlert.js.map