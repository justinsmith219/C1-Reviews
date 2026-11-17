"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyReviewer = notifyReviewer;
exports.sendManualNotifications = sendManualNotifications;
exports.runDailyReminders = runDailyReminders;
exports.runAdminDigest = runAdminDigest;
const campaignStore_1 = require("./campaignStore");
const settings_1 = require("./settings");
const slack_1 = require("./slack");
const email_1 = require("./email");
const reminder_1 = require("../templates/reminder");
const notifications_1 = require("./notifications");
const audit_1 = require("./audit");
const logger_1 = require("../logger");
const graph_1 = require("./graph");
const digest_1 = require("../templates/digest");
const config_1 = require("../config");
const deadline_1 = require("../lib/deadline");
function daysRemaining(endDate) {
    return (0, deadline_1.daysUntilDeadline)(endDate) ?? undefined;
}
async function sendBoth(reviewer, ctx, cc) {
    const { text, blocks } = (0, reminder_1.buildSlackMessage)(ctx);
    const slackRes = await (0, slack_1.sendSlackDM)(reviewer.email, text, blocks);
    const slackRec = await (0, notifications_1.recordNotification)({
        channel: "slack",
        kind: ctx.kind,
        recipientEmail: reviewer.email,
        campaignId: ctx.campaign.id,
        success: slackRes.ok,
        error: slackRes.error,
        body: text,
        dryRun: slackRes.dryRun,
    });
    const { subject, html, text: txt } = (0, reminder_1.buildEmail)(ctx);
    const emailRes = await (0, email_1.sendEmail)({ to: reviewer.email, cc, subject, html, text: txt });
    const emailRec = await (0, notifications_1.recordNotification)({
        channel: "email",
        kind: ctx.kind,
        recipientEmail: reviewer.email,
        campaignId: ctx.campaign.id,
        success: emailRes.ok,
        error: emailRes.error,
        subject,
        body: html ?? txt,
        dryRun: emailRes.dryRun,
    });
    return { slack: slackRec, email: emailRec };
}
// Core per-reviewer reminder for a campaign. Handles escalation CCs if requested.
async function notifyReviewer(campaign, reviewer, reviews, kind, options = {}) {
    const pending = reviews.filter((r) => r.campaignId === campaign.id && r.reviewerId === reviewer.id && r.status === "pending");
    if (pending.length === 0) {
        throw new Error("No pending reviews for reviewer/campaign");
    }
    let cc;
    if (options.escalateToManager || options.escalateToSkipLevel) {
        try {
            const chain = await (0, graph_1.getManagerChain)(reviewer.email);
            const ccList = [];
            if (options.escalateToManager && chain[0]?.mail)
                ccList.push(chain[0].mail);
            if (options.escalateToSkipLevel && chain[1]?.mail)
                ccList.push(chain[1].mail);
            if (ccList.length)
                cc = ccList;
        }
        catch (err) {
            logger_1.logger.warn("escalation_chain_failed", { email: reviewer.email, err: err?.message });
        }
    }
    const ctx = {
        reviewer,
        campaign,
        pendingReviews: pending,
        daysRemaining: daysRemaining(campaign.endDate),
        kind,
        managerEmails: cc,
    };
    return sendBoth(reviewer, ctx, cc);
}
// Manual / admin-triggered notification for one campaign + list of reviewer emails.
async function sendManualNotifications(args) {
    const snap = await (0, campaignStore_1.getSnapshot)();
    if (!snap)
        return { sent: 0, skipped: 0, errors: ["no snapshot — refresh first"] };
    const campaign = snap.campaigns.find((c) => c.id === args.campaignId);
    if (!campaign)
        return { sent: 0, skipped: 0, errors: ["campaign not found"] };
    await (0, audit_1.audit)({
        actor: args.actor,
        action: "notify.manual",
        target: args.campaignId,
        details: { count: args.reviewerEmails.length, kind: args.kind },
    });
    const emails = args.reviewerEmails.map((e) => e.toLowerCase());
    const reviewers = snap.reviewers.filter((r) => emails.length > 0 ? emails.includes(r.email) : campaign.reviewerIds.includes(r.id));
    let sent = 0;
    let skipped = 0;
    const errors = [];
    for (const reviewer of reviewers) {
        try {
            const res = await notifyReviewer(campaign, reviewer, snap.reviews, args.kind);
            if (res.slack.success || res.email.success)
                sent++;
            else {
                skipped++;
                if (res.slack.error)
                    errors.push(`${reviewer.email} slack: ${res.slack.error}`);
                if (res.email.error)
                    errors.push(`${reviewer.email} email: ${res.email.error}`);
            }
        }
        catch (err) {
            skipped++;
            errors.push(`${reviewer.email}: ${err?.message}`);
        }
    }
    return { sent, skipped, errors };
}
// Daily reminders per defaults (and overrides).
async function runDailyReminders() {
    const snap = await (0, campaignStore_1.getSnapshot)();
    if (!snap) {
        logger_1.logger.info("reminders_no_snapshot");
        return;
    }
    const settings = await (0, settings_1.getSettings)();
    const now = Date.now();
    for (const campaign of snap.campaigns) {
        if (campaign.status !== "open")
            continue;
        const override = settings.campaignOverrides[campaign.id];
        if (override?.disabled)
            continue;
        const daysLeft = (0, deadline_1.daysUntilDeadline)(campaign.endDate) ?? undefined;
        const mgrThreshold = override?.managerEscalationDaysBeforeDeadline ??
            settings.defaultRules.managerEscalationDaysBeforeDeadline;
        const skipThreshold = override?.skipLevelDaysBeforeDeadline ?? settings.defaultRules.skipLevelDaysBeforeDeadline;
        const minIncompletePct = override?.managerEscalationMinIncompletePct ??
            settings.defaultRules.managerEscalationMinIncompletePct;
        for (const reviewerId of campaign.reviewerIds) {
            const reviewer = snap.reviewers.find((r) => r.id === reviewerId);
            if (!reviewer)
                continue;
            const myReviews = snap.reviews.filter((r) => r.campaignId === campaign.id && r.reviewerId === reviewerId);
            const pending = myReviews.filter((r) => r.status === "pending");
            if (pending.length === 0)
                continue;
            const pct = myReviews.length === 0 ? 0 : Math.round(((myReviews.length - pending.length) / myReviews.length) * 100);
            const escalateToManager = daysLeft != null && daysLeft <= mgrThreshold && pct < minIncompletePct;
            const escalateToSkipLevel = daysLeft != null && daysLeft <= skipThreshold;
            let kind = "reminder";
            if (daysLeft != null && daysLeft < 0)
                kind = "overdue_final";
            else if (escalateToSkipLevel)
                kind = "skip_level_escalation";
            else if (escalateToManager)
                kind = "manager_escalation";
            try {
                await notifyReviewer(campaign, reviewer, snap.reviews, kind, {
                    escalateToManager,
                    escalateToSkipLevel,
                });
            }
            catch (err) {
                logger_1.logger.warn("reminder_failed", { email: reviewer.email, err: err?.message });
            }
        }
    }
}
// Admin 8am digest — Slack + email to all ADMIN_EMAILS.
async function runAdminDigest() {
    const snap = await (0, campaignStore_1.getSnapshot)();
    if (!snap)
        return;
    const open = snap.campaigns.filter((c) => c.status === "open");
    const atRisk = open
        .map((c) => {
        const d = daysRemaining(c.endDate);
        const overdueReviewers = c.reviewerIds.filter((rid) => {
            const reviews = snap.reviews.filter((r) => r.campaignId === c.id && r.reviewerId === rid);
            return reviews.some((r) => r.status === "pending");
        }).length;
        return { campaign: c, pct: c.percentComplete, daysRemaining: d, overdueReviewers };
    })
        .filter((row) => (row.daysRemaining ?? 99) <= 5 || row.pct < 50);
    const digest = (0, digest_1.buildAdminDigest)({ campaigns: open, atRisk });
    for (const adminEmail of config_1.config.admins) {
        const slackRes = await (0, slack_1.sendSlackDM)(adminEmail, digest.text, digest.slackBlocks);
        await (0, notifications_1.recordNotification)({
            channel: "slack",
            kind: "admin_digest",
            recipientEmail: adminEmail,
            success: slackRes.ok,
            error: slackRes.error,
            body: digest.text,
            dryRun: slackRes.dryRun,
        });
        const emailRes = await (0, email_1.sendEmail)({
            to: adminEmail,
            subject: digest.subject,
            html: digest.html,
            text: digest.text,
        });
        await (0, notifications_1.recordNotification)({
            channel: "email",
            kind: "admin_digest",
            recipientEmail: adminEmail,
            success: emailRes.ok,
            error: emailRes.error,
            subject: digest.subject,
            body: digest.html,
            dryRun: emailRes.dryRun,
        });
    }
}
//# sourceMappingURL=notifier.js.map