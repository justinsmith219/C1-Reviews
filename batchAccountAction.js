"use strict";
/**
 * batchAccountAction.ts
 *
 * Executes a batch of Azure / on-prem AD account enable/disable actions and
 * fires all associated notifications:
 *   1. IAM admin channel (single consolidated Slack message)
 *   2. Helpdesk channel (single consolidated Slack message; re-enables update
 *      the original disable message via chat.update + strikethrough)
 *   3. Each reviewer — Slack DM + email
 *   4. Each reviewer's manager — separate Slack DM + email
 *
 * Dry-run rules:
 *   adminDryRun  — gates IAM channel + helpdesk messages
 *   dryRun       — gates reviewer + manager messages
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeBatch = executeBatch;
const web_api_1 = require("@slack/web-api");
const config_1 = require("../config");
const logger_1 = require("../logger");
const notifications_1 = require("./notifications");
const slack_1 = require("./slack");
const email_1 = require("./email");
const templates_1 = require("./templates");
const graph_1 = require("./graph");
const campaignStore_1 = require("./campaignStore");
// ── Main entry point ─────────────────────────────────────────────────────────
async function executeBatch(changes, actor) {
    const succeeded = [];
    const failed = [];
    // Execute all changes in parallel.
    const results = await Promise.all(changes.map((c) => executeOne(c)));
    for (let i = 0; i < changes.length; i++) {
        const c = changes[i];
        const r = results[i];
        const item = { email: c.email };
        let anyFail = false;
        if (r.azure !== undefined) {
            if (r.azure.ok) {
                item.azure = r.azure;
            }
            else {
                failed.push({ email: c.email, system: "azure", error: r.azure.error ?? "unknown" });
                anyFail = true;
            }
        }
        if (r.ad !== undefined) {
            if (r.ad.ok) {
                item.ad = r.ad;
            }
            else {
                failed.push({ email: c.email, system: "ad", error: r.ad.message ?? "unknown" });
                anyFail = true;
            }
        }
        // Include in succeeded if at least one system succeeded.
        if (item.azure || item.ad)
            succeeded.push(item);
    }
    // Fire notifications only for succeeded accounts.
    if (succeeded.length > 0) {
        const succeededChanges = changes.filter((c) => succeeded.some((s) => s.email === c.email));
        try {
            await fireNotifications(succeededChanges, actor);
        }
        catch (e) {
            logger_1.logger.error("batch_notify_error", { err: e?.message });
        }
    }
    return { succeeded, failed };
}
// ── Execute a single account change ─────────────────────────────────────────
async function executeOne(c) {
    const out = {};
    await Promise.all([
        c.azure !== undefined
            ? (async () => {
                const { setUserAccountEnabled } = await Promise.resolve().then(() => __importStar(require("./graph")));
                out.azure = await setUserAccountEnabled(c.email, c.azure);
            })()
            : Promise.resolve(),
        c.ad !== undefined
            ? (async () => {
                const { setAdAccountEnabled } = await Promise.resolve().then(() => __importStar(require("./adAccount")));
                out.ad = await setAdAccountEnabled(c.email, c.ad);
            })()
            : Promise.resolve(),
    ]);
    return out;
}
// ── Notification orchestration ───────────────────────────────────────────────
async function fireNotifications(changes, actor) {
    const store = await (0, templates_1.getStore)();
    const snap = await (0, campaignStore_1.getSnapshot)();
    // Resolve campaign names.
    const campaignNameMap = new Map();
    if (snap) {
        for (const c of snap.campaigns)
            campaignNameMap.set(c.id, c.name);
    }
    const disables = changes.filter((c) => c.azure === false || c.ad === false);
    const enables = changes.filter((c) => c.azure === true || c.ad === true);
    // ── IAM channel ────────────────────────────────────────────────────────────
    if (config_1.config.notifications.adminNotificationsEnabled && config_1.config.completionAlert.recipient) {
        if (disables.length > 0) {
            await sendChannelBatch(disables, "disable", actor, "iam", store, campaignNameMap);
        }
        if (enables.length > 0) {
            await sendChannelBatch(enables, "enable", actor, "iam", store, campaignNameMap);
        }
    }
    // ── Helpdesk channel ───────────────────────────────────────────────────────
    // Always log the helpdesk message so it appears in the notification log even
    // when the helpdesk channel is disabled. Pass forceDryRun=true to skip the
    // actual Slack send while still recording the rendered body.
    if (config_1.config.helpdeskNotification.slackChannel) {
        const hdDryRun = !config_1.config.helpdeskNotification.enabled;
        if (disables.length > 0) {
            await sendChannelBatch(disables, "disable", "the IAM team", "helpdesk", store, campaignNameMap, hdDryRun);
        }
        if (enables.length > 0 && !hdDryRun) {
            await updateHelpdeskMessage(enables, store, campaignNameMap);
        }
    }
    // ── Reviewer + manager notifications (disable only) ────────────────────────
    if (disables.length > 0) {
        await sendReviewerNotifications(disables, store, snap, campaignNameMap);
    }
}
// ── Channel batch send ────────────────────────────────────────────────────────
async function sendChannelBatch(changes, action, actor, target, store, campaignNameMap, forceDryRun = false) {
    const section = action === "disable" ? "account_disabled" : "account_enabled";
    const channel = target === "iam" ? config_1.config.completionAlert.recipient : config_1.config.helpdeskNotification.slackChannel;
    const isDryRun = config_1.config.notifications.adminDryRun || forceDryRun;
    const campaignNames = uniqueCampaignNames(changes, campaignNameMap);
    const systemLabel = (c) => {
        const parts = [];
        if (c.azure !== undefined)
            parts.push("Azure");
        if (c.ad !== undefined)
            parts.push("On-prem AD");
        return parts.join(" + ");
    };
    const accountsList = changes
        .map((c) => `• ${c.email} — ${systemLabel(c)}`)
        .join("\n");
    const accountsTable = changes
        .map((c) => `| ${c.email} | ${systemLabel(c)} |`)
        .join("\n");
    const tokens = {
        actor,
        accounts: {
            count: String(changes.length),
            list: accountsList,
            table: `| Account | System |\n|---|---|\n${accountsTable}`,
        },
        campaigns: { list: campaignNames.join(", ") },
    };
    const tmpl = (0, templates_1.resolveTemplate)(store, section, "slack");
    const slackText = (0, templates_1.expandTokens)(tmpl.bodyMarkdown, tokens);
    let slackTs;
    let slackChannelId;
    if (isDryRun) {
        logger_1.logger.info("batch_channel_notify_dry_run", { channel, action, target });
    }
    else if (config_1.config.slack.botToken) {
        try {
            const client = new web_api_1.WebClient(config_1.config.slack.botToken);
            const ch = channel.startsWith("#") ? channel : `#${channel}`;
            const posted = await client.chat.postMessage({
                channel: ch,
                text: slackText,
                unfurl_links: false,
            });
            slackTs = posted.ts;
            // Store the resolved channel ID — required for chat.update later.
            slackChannelId = posted.channel;
            logger_1.logger.info("batch_channel_slack_posted", { target, slackTs, slackChannelId });
        }
        catch (err) {
            logger_1.logger.warn("batch_channel_slack_failed", { channel, err: err?.data?.error ?? err?.message });
        }
    }
    await (0, notifications_1.recordNotification)({
        channel: "slack-channel",
        kind: "account_action",
        recipientEmail: channel,
        subject: `${action === "disable" ? "Disabled" : "Re-enabled"} ${changes.length} account(s)`,
        body: slackText,
        success: !!slackTs || isDryRun,
        dryRun: isDryRun,
        slackTs,
        slackChannel: channel.replace(/^#/, ""),
        slackChannelId,
        batchEmails: changes.map((c) => c.email),
    });
}
// ── Update helpdesk message for re-enabled accounts ──────────────────────────
async function updateHelpdeskMessage(enables, store, campaignNameMap) {
    const isDryRun = config_1.config.notifications.adminDryRun;
    const hdChannel = config_1.config.helpdeskNotification.slackChannel.replace(/^#/, "");
    const allNotifs = await (0, notifications_1.listNotifications)(1000);
    // Newest-first slice (readJsonl returns last N lines, so already newest-last — reverse once here).
    const sortedNotifs = [...allNotifs].reverse();
    const disableNotifs = sortedNotifs.filter((n) => n.kind === "account_action" &&
        n.slackTs &&
        n.slackChannel === hdChannel &&
        n.batchEmails?.length);
    logger_1.logger.info("batch_enable_update_start", {
        enableCount: enables.length,
        hdChannel,
        totalNotifs: allNotifs.length,
        disableNotifCandidates: disableNotifs.length,
        enableEmails: enables.map((e) => e.email),
    });
    // Group enables by the notification record (by ts) that originally contained them.
    const byTs = new Map();
    for (const enable of enables) {
        // disableNotifs is already newest-first — find the most recent disable for this email.
        const match = disableNotifs.find((n) => n.batchEmails?.includes(enable.email));
        if (!match || !match.slackTs || !match.body) {
            logger_1.logger.info("batch_enable_no_prior_disable_ts", { email: enable.email });
            continue;
        }
        // Prefer the stored channel ID; fall back to constructing from the channel name.
        const channelId = match.slackChannelId ?? (hdChannel.startsWith("C") ? hdChannel : `#${hdChannel}`);
        if (!byTs.has(match.slackTs)) {
            byTs.set(match.slackTs, { ts: match.slackTs, channelId, emails: [], body: match.body });
        }
        byTs.get(match.slackTs).emails.push(enable.email);
    }
    if (byTs.size === 0) {
        logger_1.logger.info("batch_enable_update_no_matches", { hdChannel });
        return;
    }
    if (!config_1.config.slack.botToken || isDryRun) {
        if (isDryRun)
            logger_1.logger.info("batch_enable_update_dry_run", { count: byTs.size });
        return;
    }
    const client = new web_api_1.WebClient(config_1.config.slack.botToken);
    for (const { ts, channelId, emails, body } of byTs.values()) {
        let updated = body;
        for (const email of emails) {
            updated = updated.replace(new RegExp(`(• ${escapeRegex(email)}[^\n]*)`, "g"), `~$1~ ✅ re-enabled`);
        }
        try {
            logger_1.logger.info("batch_enable_slack_update_attempt", { channelId, ts, emails });
            await client.chat.update({ channel: channelId, ts, text: updated });
            logger_1.logger.info("batch_enable_slack_update_ok", { channelId, ts });
        }
        catch (err) {
            logger_1.logger.warn("batch_enable_slack_update_failed", {
                channelId,
                ts,
                err: err?.data?.error ?? err?.message,
            });
        }
    }
}
// ── Reviewer + manager notifications ─────────────────────────────────────────
async function sendReviewerNotifications(disables, store, snap, campaignNameMap) {
    if (!snap)
        return;
    const entries = [];
    for (const change of disables) {
        const subjectLower = change.email.toLowerCase();
        for (const campaignId of change.campaignIds) {
            const campaign = snap.campaigns?.find((c) => c.id === campaignId);
            const campaignName = campaignNameMap.get(campaignId) ?? campaignId;
            const deadline = campaign?.endDate ?? "unknown";
            // Find pending reviews where this person is the subject.
            const reviews = (snap.reviews ?? []).filter((r) => r.subjectUserEmail?.toLowerCase() === subjectLower &&
                r.campaignId === campaignId &&
                r.status === "pending");
            const subjectName = snap.reviews?.find((r) => r.subjectUserEmail?.toLowerCase() === subjectLower)
                ?.subjectUserDisplayName ?? change.email;
            for (const review of reviews) {
                const reviewer = snap.reviewers?.find((rv) => rv.id === review.reviewerId);
                if (!reviewer?.email)
                    continue;
                entries.push({
                    reviewerEmail: reviewer.email,
                    accountEmail: change.email,
                    accountName: subjectName,
                    campaignId,
                    campaignName,
                    deadline,
                });
            }
        }
    }
    if (entries.length === 0)
        return;
    // Notify each reviewer (deduplicated per reviewer+account+campaign).
    const seen = new Set();
    const managerMap = new Map(); // managerEmail → entries
    await Promise.all(entries.map(async (entry) => {
        const key = `${entry.reviewerEmail}|${entry.accountEmail}|${entry.campaignId}`;
        if (seen.has(key))
            return;
        seen.add(key);
        const reviewerUser = await (0, graph_1.getUserByEmail)(entry.reviewerEmail).catch(() => null);
        const firstName = firstNameOf(reviewerUser?.displayName ?? entry.reviewerEmail);
        const tokens = {
            reviewer: { firstName, name: reviewerUser?.displayName ?? entry.reviewerEmail },
            account: { email: entry.accountEmail, name: entry.accountName },
            campaign: { name: entry.campaignName, deadline: entry.deadline },
        };
        // Slack DM
        const slackTmpl = (0, templates_1.resolveTemplate)(store, "reviewer_account_disabled", "slack");
        const slackText = (0, templates_1.expandTokens)(slackTmpl.bodyMarkdown, tokens);
        const slackResult = await (0, slack_1.sendSlackDM)(entry.reviewerEmail, slackText, undefined, { dryRun: config_1.config.notifications.dryRun });
        // Email
        const emailTmpl = (0, templates_1.resolveTemplate)(store, "reviewer_account_disabled", "email");
        const emailSubject = (0, templates_1.expandTokens)(emailTmpl.subject ?? "Action required — account disabled", tokens);
        const emailHtml = (0, templates_1.renderMarkdownToHtml)((0, templates_1.expandTokens)(emailTmpl.bodyMarkdown, tokens));
        const emailResult = await (0, email_1.sendEmail)({
            to: entry.reviewerEmail,
            subject: emailSubject,
            html: emailHtml,
            dryRun: config_1.config.notifications.dryRun,
        });
        await (0, notifications_1.recordNotification)({
            channel: "slack-dm",
            kind: "account_action",
            recipientEmail: entry.reviewerEmail,
            campaignId: entry.campaignId,
            subject: emailSubject,
            body: slackText,
            success: slackResult.ok || emailResult.ok,
            dryRun: config_1.config.notifications.dryRun,
        });
        // Queue manager notification.
        if (reviewerUser?.managerId) {
            const managerUser = await resolveManagerById(reviewerUser.managerId);
            if (managerUser?.mail) {
                const existing = managerMap.get(managerUser.mail) ?? [];
                existing.push(entry);
                managerMap.set(managerUser.mail, existing);
            }
        }
    }));
    // Send one notification per manager covering all their relevant entries.
    await Promise.all(Array.from(managerMap.entries()).map(async ([managerEmail, mgEntries]) => {
        const managerUser = await (0, graph_1.getUserByEmail)(managerEmail).catch(() => null);
        const managerFirstName = firstNameOf(managerUser?.displayName ?? managerEmail);
        for (const entry of mgEntries) {
            const reviewerUser = await (0, graph_1.getUserByEmail)(entry.reviewerEmail).catch(() => null);
            const tokens = {
                manager: { firstName: managerFirstName },
                reviewer: { name: reviewerUser?.displayName ?? entry.reviewerEmail },
                account: { email: entry.accountEmail, name: entry.accountName },
                campaign: { name: entry.campaignName, deadline: entry.deadline },
            };
            const slackTmpl = (0, templates_1.resolveTemplate)(store, "manager_account_disabled", "slack");
            const slackText = (0, templates_1.expandTokens)(slackTmpl.bodyMarkdown, tokens);
            const slackResult = await (0, slack_1.sendSlackDM)(managerEmail, slackText, undefined, { dryRun: config_1.config.notifications.dryRun });
            const emailTmpl = (0, templates_1.resolveTemplate)(store, "manager_account_disabled", "email");
            const emailSubject = (0, templates_1.expandTokens)(emailTmpl.subject ?? "FYI — account disabled", tokens);
            const emailHtml = (0, templates_1.renderMarkdownToHtml)((0, templates_1.expandTokens)(emailTmpl.bodyMarkdown, tokens));
            const emailResult = await (0, email_1.sendEmail)({
                to: managerEmail,
                subject: emailSubject,
                html: emailHtml,
                dryRun: config_1.config.notifications.dryRun,
            });
            await (0, notifications_1.recordNotification)({
                channel: "slack-dm",
                kind: "account_action",
                recipientEmail: managerEmail,
                campaignId: entry.campaignId,
                subject: emailSubject,
                body: slackText,
                success: slackResult.ok || emailResult.ok,
                dryRun: config_1.config.notifications.dryRun,
            });
        }
    }));
}
// ── Helpers ───────────────────────────────────────────────────────────────────
function uniqueCampaignNames(changes, nameMap) {
    const names = new Set();
    for (const c of changes) {
        for (const id of c.campaignIds) {
            names.add(nameMap.get(id) ?? id);
        }
    }
    return [...names];
}
function firstNameOf(displayName) {
    return displayName.split(/\s+/)[0] ?? displayName;
}
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
async function resolveManagerById(managerId) {
    try {
        const { graphClient } = await Promise.resolve().then(() => __importStar(require("./graph")));
        // @ts-ignore — internal export
        const gc = await graphClient();
        const res = await gc
            .api(`/users/${managerId}`)
            .select("id,mail,userPrincipalName,displayName")
            .get();
        return {
            mail: (res.mail ?? res.userPrincipalName ?? "").toLowerCase(),
            displayName: res.displayName ?? "",
        };
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=batchAccountAction.js.map