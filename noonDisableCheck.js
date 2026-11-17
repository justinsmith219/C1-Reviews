"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runNoonDisableCheck = runNoonDisableCheck;
exports.startNoonDisableCheckJob = startNoonDisableCheckJob;
const node_cron_1 = __importDefault(require("node-cron"));
const config_1 = require("../config");
const logger_1 = require("../logger");
const campaignStore_1 = require("../services/campaignStore");
const runtimeConfig_1 = require("../services/runtimeConfig");
const jobs_1 = require("../services/jobs");
const notifications_1 = require("../services/notifications");
const slack_1 = require("../services/slack");
const email_1 = require("../services/email");
const deadline_1 = require("../lib/deadline");
const graph_1 = require("../services/graph");
const web_api_1 = require("@slack/web-api");
const ZINNIA_DOMAIN = "@zinnia.com";
let task = null;
async function postToSlackChannel(channel, text, dryRun) {
    if (dryRun) {
        logger_1.logger.info("noon_disable_check_dry_run", { channel, len: text.length });
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
        logger_1.logger.warn("noon_disable_check_slack_failed", { channel, err: errMsg });
        return { ok: false, error: errMsg };
    }
}
async function runNoonDisableCheck() {
    const cfg = config_1.config.completionAlert;
    if (!cfg.enabled || !cfg.recipient)
        return;
    if (!config_1.config.notifications.adminNotificationsEnabled)
        return;
    const snap = await (0, campaignStore_1.getSnapshot)();
    if (!snap)
        return;
    // Collect all @zinnia.com accounts with pending reviews in overdue campaigns.
    const accountMap = new Map();
    for (const campaign of snap.campaigns) {
        if (campaign.status !== "open")
            continue;
        if (!campaign.endDate)
            continue;
        const days = (0, deadline_1.daysUntilDeadline)(campaign.endDate);
        if (days === null || days >= 0)
            continue;
        for (const review of snap.reviews) {
            if (review.campaignId !== campaign.id)
                continue;
            if (review.status !== "pending")
                continue;
            const email = (review.subjectUserEmail ?? "").toLowerCase();
            if (!email.endsWith(ZINNIA_DOMAIN))
                continue;
            const existing = accountMap.get(email);
            if (existing) {
                if (!existing.campaigns.includes(campaign.name))
                    existing.campaigns.push(campaign.name);
            }
            else {
                accountMap.set(email, { displayName: review.subjectUserDisplayName ?? email, campaigns: [campaign.name] });
            }
        }
    }
    if (accountMap.size === 0) {
        logger_1.logger.info("noon_disable_check_nothing_to_disable");
        return;
    }
    // Only alert for accounts confirmed still enabled in Azure AD.
    const ready = [];
    for (const [email, info] of accountMap) {
        try {
            const u = await (0, graph_1.getUserByEmail)(email);
            if (!u || u.accountEnabled !== true)
                continue;
        }
        catch {
            // Graph error — skip rather than send a false-positive
            continue;
        }
        ready.push({ email, ...info });
    }
    if (ready.length === 0) {
        logger_1.logger.info("noon_disable_check_all_already_disabled");
        return;
    }
    const dashUrl = `${config_1.config.publicBaseUrl}/C1review/?tab=accounts`;
    const accountLines = ready.map((a) => `• ${a.displayName} (${a.email}) — ${a.campaigns.join(", ")}`).join("\n");
    const slackText = `⚠️ *Daily disable check — ${ready.length} account${ready.length !== 1 ? "s" : ""} ready to disable*\n\n` +
        `The following Zinnia accounts have overdue access reviews and have not yet been disabled:\n\n` +
        `${accountLines}\n\n` +
        `To review and bulk-disable: <${dashUrl}|Open Impacted Accounts in Campaign Manager>`;
    const emailSubject = `Daily disable check — ${ready.length} account${ready.length !== 1 ? "s" : ""} ready to disable`;
    const emailHtml = `<p>⚠️ <strong>Daily disable check</strong></p>` +
        `<p>The following Zinnia accounts have overdue access reviews and have not yet been disabled:</p>` +
        `<ul>${ready.map((a) => `<li><strong>${a.displayName}</strong> — <code>${a.email}</code> (${a.campaigns.join(", ")})</li>`).join("")}</ul>` +
        `<p><a href="${dashUrl}">Open Impacted Accounts in Campaign Manager →</a></p>`;
    const dryRun = config_1.config.notifications.adminDryRun;
    let result = { ok: false };
    if (cfg.channel === "slack-channel") {
        result = await postToSlackChannel(cfg.recipient, slackText, dryRun);
    }
    else if (cfg.channel === "slack-dm") {
        result = await (0, slack_1.sendSlackDM)(cfg.recipient, slackText, undefined, { dryRun });
    }
    else if (cfg.channel === "email") {
        result = await (0, email_1.sendEmail)({ to: cfg.recipient, subject: emailSubject, html: emailHtml, dryRun });
    }
    await (0, notifications_1.recordNotification)({
        channel: cfg.channel,
        kind: "overdue_final",
        recipientEmail: cfg.recipient,
        subject: emailSubject,
        body: slackText,
        success: result.ok,
        error: result.error,
        dryRun: result.dryRun ?? dryRun,
    });
    logger_1.logger.info("noon_disable_check_sent", {
        accountCount: ready.length,
        channel: cfg.channel,
        recipient: cfg.recipient,
        dryRun: result.dryRun ?? dryRun,
    });
}
function schedule() {
    if (task) {
        try {
            task.stop();
        }
        catch { }
        task = null;
    }
    const cronExpr = config_1.config.cron.noonDisableCheck ?? "0 12 * * *";
    logger_1.logger.info("schedule_noon_disable_check", { cron: cronExpr, tz: config_1.config.tz });
    (0, jobs_1.update)("noon_disable_check", { schedule: cronExpr, timezone: config_1.config.tz });
    task = node_cron_1.default.schedule(cronExpr, () => {
        runNoonDisableCheck().catch((err) => logger_1.logger.error("noon_disable_check_failed", { err: err?.message }));
    }, { timezone: config_1.config.tz });
}
function startNoonDisableCheckJob() {
    schedule();
    (0, runtimeConfig_1.registerScheduleChangeHandler)(() => schedule());
}
//# sourceMappingURL=noonDisableCheck.js.map