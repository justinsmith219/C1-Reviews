"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetSlackClient = resetSlackClient;
exports.resolveSlackUserId = resolveSlackUserId;
exports.sendSlackDM = sendSlackDM;
const web_api_1 = require("@slack/web-api");
const config_1 = require("../config");
const logger_1 = require("../logger");
let client = null;
function slack() {
    if (!client) {
        if (!config_1.config.slack.botToken)
            throw new Error("SLACK_BOT_TOKEN not configured");
        client = new web_api_1.WebClient(config_1.config.slack.botToken);
    }
    return client;
}
function resetSlackClient() {
    client = null;
    slackIdByEmail.clear();
}
const slackIdByEmail = new Map();
async function resolveSlackUserId(email) {
    const key = email.toLowerCase();
    if (slackIdByEmail.has(key))
        return slackIdByEmail.get(key);
    try {
        const res = await slack().users.lookupByEmail({ email: key });
        const id = res.user?.id ?? null;
        slackIdByEmail.set(key, id);
        return id;
    }
    catch (err) {
        logger_1.logger.warn("slack_lookup_failed", { email: key, err: err?.data?.error ?? err?.message });
        slackIdByEmail.set(key, null);
        return null;
    }
}
async function sendSlackDM(email, text, blocks, opts) {
    const isDryRun = opts?.dryRun !== undefined ? opts.dryRun : config_1.config.notifications.dryRun;
    if (isDryRun) {
        logger_1.logger.info("slack_dry_run", { email, len: text.length });
        return { ok: true, dryRun: true };
    }
    // Test-recipient override applies only to user (non-admin) sends.
    const redirect = opts?.dryRun !== undefined ? "" : config_1.config.notifications.testRecipient;
    let actualEmail = email;
    let prefixedText = text;
    if (redirect) {
        actualEmail = redirect;
        prefixedText = `*[TEST → ${email}]*\n${text}`;
        if (Array.isArray(blocks) && blocks.length > 0) {
            blocks = [
                {
                    type: "section",
                    text: { type: "mrkdwn", text: `*[TEST → ${email}]*` },
                },
                ...blocks,
            ];
        }
    }
    const userId = await resolveSlackUserId(actualEmail);
    if (!userId)
        return { ok: false, error: "no_slack_user_for_email" };
    try {
        await slack().chat.postMessage({
            channel: userId,
            text: prefixedText,
            blocks,
            unfurl_links: false,
        });
        return { ok: true };
    }
    catch (err) {
        const errMsg = err?.data?.error ?? err?.message ?? "slack_error";
        logger_1.logger.warn("slack_send_failed", { email, err: errMsg });
        return { ok: false, error: errMsg };
    }
}
//# sourceMappingURL=slack.js.map