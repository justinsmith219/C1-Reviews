"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SECRET_MASK = void 0;
exports.cronToHours = cronToHours;
exports.hoursToCron = hoursToCron;
exports.timeToCron = timeToCron;
exports.cronToTime = cronToTime;
exports.registerScheduleChangeHandler = registerScheduleChangeHandler;
exports.loadAtBoot = loadAtBoot;
exports.getMasked = getMasked;
exports.update = update;
const config_1 = require("../config");
const storage_1 = require("./storage");
const audit_1 = require("./audit");
const logger_1 = require("../logger");
const slack_1 = require("./slack");
const email_1 = require("./email");
const graph_1 = require("./graph");
const conductor1_1 = require("./conductor1");
// Runtime configuration stored in data/runtime-config.json.
// Values here override the .env at boot-time and whenever an admin saves the form.
// Secrets are masked on read; a sentinel of "__UNCHANGED__" on write means "keep".
const KEY = "runtime-config";
exports.SECRET_MASK = "__UNCHANGED__";
const SECRET_PATHS = [
    "conductor1.clientSecret",
    "conductor1.apiToken",
    "entra.clientSecret",
    "slack.botToken",
    "smtp.pass",
    "ad.password",
];
function maskValue(v) {
    if (!v)
        return "";
    if (v.length <= 4)
        return "••••";
    return `••••${v.slice(-4)}`;
}
function cloneLiveAsRuntime() {
    // intentionally placed before timeToCron/cronToTime helpers — only references config fields.
    return {
        conductor1: {
            baseUrl: config_1.config.conductor1.baseUrl,
            clientId: config_1.config.conductor1.clientId,
            clientSecret: config_1.config.conductor1.clientSecret,
            apiToken: config_1.config.conductor1.apiToken,
        },
        entra: {
            tenantId: config_1.config.entra.tenantId,
            clientId: config_1.config.entra.clientId,
            clientSecret: config_1.config.entra.clientSecret,
        },
        adminEmails: [...config_1.config.admins],
        slack: { botToken: config_1.config.slack.botToken },
        smtp: {
            host: config_1.config.smtp.host,
            port: config_1.config.smtp.port,
            secure: config_1.config.smtp.secure,
            user: config_1.config.smtp.user,
            pass: config_1.config.smtp.pass,
            from: config_1.config.smtp.from,
            allowInvalidCerts: config_1.config.smtp.allowInvalidCerts,
        },
        orgTop: { ...config_1.config.orgTop },
        digest: {
            timeOfDay: cronToTime(config_1.config.digest.cron),
            skipWeekends: config_1.config.digest.skipWeekends,
        },
        schedule: {
            scorecardsTime: cronToTime(config_1.config.cron.scorecards),
            refreshIntervalHours: cronToHours(config_1.config.cron.refreshCampaigns),
            prewarmIntervalHours: cronToHours(config_1.config.cron.prewarmCampaignDetails ?? "0 */4 * * *"),
        },
        notifications: {
            autoSendEnabled: config_1.config.notifications.autoSendEnabled,
            adminNotificationsEnabled: config_1.config.notifications.adminNotificationsEnabled,
            dryRun: config_1.config.notifications.dryRun,
            adminDryRun: config_1.config.notifications.adminDryRun,
            testRecipient: config_1.config.notifications.testRecipient,
        },
        helpdeskNotification: { ...config_1.config.helpdeskNotification },
        completionAlert: { ...config_1.config.completionAlert },
        ad: {
            enabled: config_1.config.ad.enabled,
            domain: config_1.config.ad.domain,
            username: config_1.config.ad.username,
            password: config_1.config.ad.password,
        },
        crons: {
            refreshCampaigns: config_1.config.cron.refreshCampaigns,
            scorecards: config_1.config.cron.scorecards,
            prewarmDetails: config_1.config.cron.prewarmCampaignDetails ?? "0 */4 * * *",
            prewarmOrgTree: config_1.config.cron.prewarmOrgTree,
            digest: config_1.config.digest.cron,
            noonDisableCheck: config_1.config.cron.noonDisableCheck ?? "0 12 * * *",
        },
    };
}
// "0 */N * * *" or "0 * * * *" -> N (1 if cron is "0 * * * *").
function cronToHours(cron) {
    const parts = (cron ?? "").trim().split(/\s+/);
    if (parts.length < 2)
        return 1;
    if (parts[1] === "*")
        return 1;
    const m = /^\*\/(\d+)$/.exec(parts[1]);
    if (m)
        return Math.max(1, parseInt(m[1], 10));
    return 1;
}
// N -> "0 */N * * *"; N=1 -> "0 * * * *".
function hoursToCron(hours) {
    const h = Math.max(1, Math.min(24, Math.floor(hours)));
    return h === 1 ? "0 * * * *" : `0 */${h} * * *`;
}
// Convert "HH:MM" -> "M H * * *" (cron expression). Empty/invalid -> default 02:00.
function timeToCron(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? "").trim());
    if (!m)
        return "0 2 * * *";
    const h = Math.max(0, Math.min(23, parseInt(m[1], 10)));
    const mm = Math.max(0, Math.min(59, parseInt(m[2], 10)));
    return `${mm} ${h} * * *`;
}
// Convert "M H * * *" -> "HH:MM" (best-effort; complex crons fall back to 02:00).
function cronToTime(cron) {
    const parts = (cron ?? "").trim().split(/\s+/);
    if (parts.length < 2)
        return "02:00";
    const m = parseInt(parts[0], 10);
    const h = parseInt(parts[1], 10);
    if (Number.isNaN(m) || Number.isNaN(h))
        return "02:00";
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function applyToLiveConfig(rc) {
    config_1.config.conductor1.baseUrl = rc.conductor1.baseUrl.replace(/\/$/, "");
    config_1.config.conductor1.clientId = rc.conductor1.clientId;
    config_1.config.conductor1.clientSecret = rc.conductor1.clientSecret;
    config_1.config.conductor1.apiToken = rc.conductor1.apiToken;
    config_1.config.entra.tenantId = rc.entra.tenantId;
    config_1.config.entra.clientId = rc.entra.clientId;
    config_1.config.entra.clientSecret = rc.entra.clientSecret;
    config_1.config.admins.splice(0, config_1.config.admins.length, ...rc.adminEmails.map((e) => e.toLowerCase().trim()).filter(Boolean));
    config_1.config.slack.botToken = rc.slack.botToken;
    config_1.config.smtp.host = rc.smtp.host;
    config_1.config.smtp.port = rc.smtp.port;
    config_1.config.smtp.secure = rc.smtp.secure;
    config_1.config.smtp.user = rc.smtp.user;
    config_1.config.smtp.pass = rc.smtp.pass;
    config_1.config.smtp.from = rc.smtp.from;
    config_1.config.smtp.allowInvalidCerts = !!rc.smtp.allowInvalidCerts;
    if (rc.orgTop) {
        config_1.config.orgTop.ceoEmail = rc.orgTop.ceoEmail.toLowerCase();
        config_1.config.orgTop.excludeCeoFromEscalation = !!rc.orgTop.excludeCeoFromEscalation;
    }
    if (rc.digest) {
        // Always force America/New_York; the UI no longer exposes timezone.
        config_1.config.digest.tz = "America/New_York";
        config_1.config.digest.skipWeekends = !!rc.digest.skipWeekends;
        if (rc.digest.timeOfDay) {
            const base = timeToCron(rc.digest.timeOfDay);
            // Append weekday filter if skipping weekends ("M H * * 1-5").
            config_1.config.digest.cron = rc.digest.skipWeekends
                ? base.replace(/\*\s*$/, "1-5")
                : base;
        }
    }
    if (rc.schedule?.scorecardsTime) {
        config_1.config.cron.scorecards = timeToCron(rc.schedule.scorecardsTime);
    }
    if (typeof rc.schedule?.refreshIntervalHours === "number") {
        config_1.config.cron.refreshCampaigns = hoursToCron(rc.schedule.refreshIntervalHours);
    }
    if (typeof rc.schedule?.prewarmIntervalHours === "number") {
        config_1.config.cron.prewarmCampaignDetails = hoursToCron(rc.schedule.prewarmIntervalHours);
    }
    if (rc.notifications) {
        config_1.config.notifications.autoSendEnabled = !!rc.notifications.autoSendEnabled;
        config_1.config.notifications.adminNotificationsEnabled = !!rc.notifications.adminNotificationsEnabled;
        config_1.config.notifications.testRecipient = (rc.notifications.testRecipient ?? "").trim();
        if (typeof rc.notifications.dryRun === "boolean") {
            config_1.config.notifications.dryRun = rc.notifications.dryRun;
        }
        if (typeof rc.notifications.adminDryRun === "boolean") {
            config_1.config.notifications.adminDryRun = rc.notifications.adminDryRun;
        }
    }
    if (rc.helpdeskNotification) {
        config_1.config.helpdeskNotification.enabled = !!rc.helpdeskNotification.enabled;
        config_1.config.helpdeskNotification.slackChannel = (rc.helpdeskNotification.slackChannel ?? "").trim();
    }
    if (rc.completionAlert) {
        config_1.config.completionAlert.enabled = !!rc.completionAlert.enabled;
        if (rc.completionAlert.channel)
            config_1.config.completionAlert.channel = rc.completionAlert.channel;
        config_1.config.completionAlert.recipient = (rc.completionAlert.recipient ?? "").trim();
    }
    if (rc.ad) {
        config_1.config.ad.enabled = !!rc.ad.enabled;
        config_1.config.ad.domain = (rc.ad.domain ?? "").trim();
        config_1.config.ad.username = (rc.ad.username ?? "").trim();
        config_1.config.ad.password = rc.ad.password ?? "";
    }
    if (rc.crons) {
        if (rc.crons.refreshCampaigns)
            config_1.config.cron.refreshCampaigns = rc.crons.refreshCampaigns;
        if (rc.crons.scorecards)
            config_1.config.cron.scorecards = rc.crons.scorecards;
        if (rc.crons.prewarmDetails)
            config_1.config.cron.prewarmCampaignDetails = rc.crons.prewarmDetails;
        if (rc.crons.prewarmOrgTree)
            config_1.config.cron.prewarmOrgTree = rc.crons.prewarmOrgTree;
        if (rc.crons.digest)
            config_1.config.digest.cron = rc.crons.digest;
        if (rc.crons.noonDisableCheck)
            config_1.config.cron.noonDisableCheck = rc.crons.noonDisableCheck;
    }
}
function invalidateClients() {
    (0, slack_1.resetSlackClient)();
    (0, email_1.resetEmailTransporter)();
    (0, graph_1.resetGraphClient)();
    (0, conductor1_1.resetConductorTokenCache)();
}
const scheduleChangeHandlers = [];
function registerScheduleChangeHandler(fn) {
    scheduleChangeHandlers.push(fn);
}
function fireScheduleChange() {
    for (const fn of scheduleChangeHandlers) {
        try {
            fn();
        }
        catch { }
    }
}
async function loadAtBoot() {
    try {
        const stored = await (0, storage_1.readJson)(KEY, null);
        if (stored) {
            applyToLiveConfig(stored);
            logger_1.logger.info("runtime_config_loaded");
        }
    }
    catch (err) {
        logger_1.logger.warn("runtime_config_boot_load_failed", { err: err?.message });
    }
}
function getPath(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, val) {
    const parts = path.split(".");
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = val;
}
async function getMasked() {
    const rc = cloneLiveAsRuntime();
    for (const p of SECRET_PATHS) {
        const v = getPath(rc, p);
        if (typeof v === "string")
            setPath(rc, p, maskValue(v));
    }
    return rc;
}
// For the UI's write path. Secret fields that the client sends back unchanged
// arrive as their masked value; we detect this and keep the existing secret.
function mergeSecrets(incoming, current) {
    const merged = JSON.parse(JSON.stringify(incoming));
    for (const p of SECRET_PATHS) {
        const inVal = getPath(merged, p);
        const existing = getPath(current, p);
        if (typeof inVal !== "string")
            continue;
        if (inVal === exports.SECRET_MASK || inVal.startsWith("••••") || inVal === "") {
            // Empty string when the admin explicitly clears the field — treat as keep.
            // If you want to clear a secret, pass a single space (" ") and we'll set it empty.
            setPath(merged, p, existing);
        }
        else if (inVal.trim() === "") {
            setPath(merged, p, "");
        }
    }
    return merged;
}
async function update(partial, actor) {
    const current = cloneLiveAsRuntime();
    const incomingFull = {
        conductor1: { ...current.conductor1, ...(partial.conductor1 ?? {}) },
        entra: { ...current.entra, ...(partial.entra ?? {}) },
        adminEmails: partial.adminEmails ?? current.adminEmails,
        slack: { ...current.slack, ...(partial.slack ?? {}) },
        smtp: { ...current.smtp, ...(partial.smtp ?? {}) },
        orgTop: { ...current.orgTop, ...(partial.orgTop ?? {}) },
        digest: { ...current.digest, ...(partial.digest ?? {}) },
        schedule: { ...current.schedule, ...(partial.schedule ?? {}) },
        notifications: { ...current.notifications, ...(partial.notifications ?? {}) },
        helpdeskNotification: { ...current.helpdeskNotification, ...(partial.helpdeskNotification ?? {}) },
        completionAlert: { ...current.completionAlert, ...(partial.completionAlert ?? {}) },
        ad: { ...current.ad, ...(partial.ad ?? {}) },
        crons: { ...current.crons, ...(partial.crons ?? {}) },
    };
    const merged = mergeSecrets(incomingFull, current);
    await (0, storage_1.writeJson)(KEY, merged);
    const scheduleChanged = !!partial.schedule || !!partial.digest || !!partial.crons;
    applyToLiveConfig(merged);
    invalidateClients();
    if (scheduleChanged)
        fireScheduleChange();
    await (0, audit_1.audit)({
        actor,
        action: "runtime_config.update",
        details: {
            // Never log secret values.
            fieldsTouched: Object.keys(partial),
            adminCount: merged.adminEmails.length,
        },
    });
    return getMasked();
}
//# sourceMappingURL=runtimeConfig.js.map