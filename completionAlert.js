"use strict";
// Fires after every campaign snapshot refresh.
// If a campaign is 100% complete but still open (status !== "closed"), and we
// haven't already alerted for this campaign, send a notification to the
// configured recipient (Slack channel, Slack DM, or email).
//
// Alerted campaign IDs are persisted to data/completion-alerts-sent.json so
// we never double-alert after a server restart.
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkCompletionAlerts = checkCompletionAlerts;
const campaignStore_1 = require("../services/campaignStore");
const config_1 = require("../config");
const logger_1 = require("../logger");
const storage_1 = require("../services/storage");
const notifications_1 = require("../services/notifications");
const slack_1 = require("../services/slack");
const email_1 = require("../services/email");
const web_api_1 = require("@slack/web-api");
const SENT_KEY = "completion-alerts-sent";
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
        logger_1.logger.info("completion_alert_dry_run", { channel, len: text.length });
        return { ok: true, dryRun: true };
    }
    if (!config_1.config.slack.botToken)
        return { ok: false, error: "SLACK_BOT_TOKEN not configured" };
    try {
        const client = new web_api_1.WebClient(config_1.config.slack.botToken);
        // Accept "#channel-name" or "channel-name"
        const ch = channel.startsWith("#") ? channel : `#${channel}`;
        await client.chat.postMessage({ channel: ch, text, unfurl_links: false });
        return { ok: true };
    }
    catch (err) {
        const errMsg = err?.data?.error ?? err?.message ?? "slack_error";
        logger_1.logger.warn("completion_alert_slack_channel_failed", { channel, err: errMsg });
        return { ok: false, error: errMsg };
    }
}
async function checkCompletionAlerts() {
    const cfg = config_1.config.completionAlert;
    if (!cfg.enabled || !cfg.recipient)
        return;
    if (!config_1.config.notifications.adminNotificationsEnabled)
        return;
    const snap = await (0, campaignStore_1.getSnapshot)();
    if (!snap)
        return;
    const sentIds = await getSentIds();
    for (const campaign of snap.campaigns) {
        // Only alert for open/active campaigns (not closed, draft, or archived)
        if (campaign.status !== "open")
            continue;
        if (campaign.totalReviews === 0)
            continue;
        if (campaign.completedReviews < campaign.totalReviews)
            continue;
        // Already alerted
        if (sentIds.has(campaign.id))
            continue;
        const text = `✅ *Campaign 100% complete — still open*\n` +
            `*${campaign.name}* has all ${campaign.totalReviews} reviews completed` +
            (campaign.endDate ? ` (deadline: ${campaign.endDate.slice(0, 10)})` : "") +
            `.\nAll reviews are done — you may want to close the campaign in ConductorOne.`;
        let result = { ok: false };
        if (cfg.channel === "slack-channel") {
            result = await sendToSlackChannel(cfg.recipient, text);
        }
        else if (cfg.channel === "slack-dm") {
            result = await (0, slack_1.sendSlackDM)(cfg.recipient, text, undefined, { dryRun: config_1.config.notifications.adminDryRun });
        }
        else if (cfg.channel === "email") {
            const html = `<p>✅ <strong>Campaign 100% complete — still open</strong></p>` +
                `<p><strong>${campaign.name}</strong> has all ${campaign.totalReviews} reviews completed` +
                (campaign.endDate ? ` (deadline: ${campaign.endDate.slice(0, 10)})` : "") +
                `.</p><p>All reviews are done — you may want to close the campaign in ConductorOne.</p>`;
            result = await (0, email_1.sendEmail)({
                to: cfg.recipient,
                subject: `[Campaign 100% complete] ${campaign.name}`,
                html,
                dryRun: config_1.config.notifications.adminDryRun,
            });
        }
        await (0, notifications_1.recordNotification)({
            channel: cfg.channel,
            kind: "completion_alert",
            recipientEmail: cfg.recipient,
            campaignId: campaign.id,
            subject: `Campaign 100% complete: ${campaign.name}`,
            body: text,
            success: result.ok,
            error: result.error,
            dryRun: result.dryRun ?? config_1.config.notifications.adminDryRun,
        });
        // Only mark as sent when the message was actually delivered.
        // Dry-run results must NOT consume the one-shot token — the real alert
        // still needs to fire once dry run is turned off.
        if (result.ok && !result.dryRun) {
            await addSentId(campaign.id);
            logger_1.logger.info("completion_alert_sent", {
                campaignId: campaign.id,
                campaignName: campaign.name,
                channel: cfg.channel,
                recipient: cfg.recipient,
            });
        }
    }
}
//# sourceMappingURL=completionAlert.js.map