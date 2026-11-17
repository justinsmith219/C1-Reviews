"use strict";
// Smoke-test for admin notifications (completion alert + overdue alert).
// Sends real messages using the live config from .env / runtime-config.json.
// Does NOT require an actual campaign — fires synthetic payloads directly.
//
// Usage:
//   npx tsx src/scripts/test-admin-notifications.ts
//
// What it does:
//   1. Loads config from .env and data/runtime-config.json
//   2. Checks adminNotificationsEnabled and adminDryRun flags
//   3. Sends a synthetic "campaign 100% complete" alert
//   4. Sends a synthetic "campaign overdue" alert
//   5. Reports what was sent / logged / skipped
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const web_api_1 = require("@slack/web-api");
const nodemailer_1 = __importDefault(require("nodemailer"));
// ── load config ──────────────────────────────────────────────────────────────
const DATA_DIR = path_1.default.resolve(__dirname, "..", "..", "..", "data");
const RC_PATH = path_1.default.join(DATA_DIR, "runtime-config.json");
function loadRc() {
    try {
        return JSON.parse(fs_1.default.readFileSync(RC_PATH, "utf8"));
    }
    catch {
        return {};
    }
}
const rc = loadRc();
const slackToken = rc.slack?.botToken ?? process.env.SLACK_BOT_TOKEN ?? "";
const cfg = rc.completionAlert ?? {};
const notif = rc.notifications ?? {};
const adminEnabled = notif.adminNotificationsEnabled !== false;
const adminDryRun = notif.adminDryRun === true;
const channel = cfg.channel ?? "slack-channel";
const recipient = cfg.recipient ?? "";
// ── helpers ───────────────────────────────────────────────────────────────────
function banner(label) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(` ${label}`);
    console.log("─".repeat(60));
}
async function sendSlackChannel(ch, text) {
    if (!slackToken)
        throw new Error("SLACK_BOT_TOKEN not configured");
    const client = new web_api_1.WebClient(slackToken);
    const target = ch.startsWith("#") ? ch : `#${ch}`;
    await client.chat.postMessage({ channel: target, text, unfurl_links: false });
}
async function sendSlackDM(email, text) {
    if (!slackToken)
        throw new Error("SLACK_BOT_TOKEN not configured");
    const client = new web_api_1.WebClient(slackToken);
    const res = await client.users.lookupByEmail({ email });
    const userId = res.user?.id;
    if (!userId)
        throw new Error(`No Slack user found for ${email}`);
    await client.chat.postMessage({ channel: userId, text, unfurl_links: false });
}
async function sendEmail(to, subject, html) {
    const smtp = rc.smtp ?? {};
    if (!smtp.host)
        throw new Error("SMTP_HOST not configured");
    const transport = nodemailer_1.default.createTransport({
        host: smtp.host,
        port: smtp.port ?? 25,
        secure: smtp.secure ?? false,
        auth: smtp.user ? { user: smtp.user, pass: smtp.pass ?? "" } : undefined,
        tls: smtp.allowInvalidCerts ? { rejectUnauthorized: false } : undefined,
    });
    await transport.sendMail({ from: smtp.from ?? "campaign-manager@zinnia.com", to, subject, html });
}
async function send(text, subject, html) {
    if (!adminEnabled)
        return "disabled";
    if (adminDryRun) {
        console.log("  [dry-run] would send via", channel, "→", recipient);
        console.log("  Message preview:\n", text.split("\n").map(l => "    " + l).join("\n"));
        return "dry-run";
    }
    if (channel === "slack-channel") {
        await sendSlackChannel(recipient, text);
    }
    else if (channel === "slack-dm") {
        await sendSlackDM(recipient, text);
    }
    else if (channel === "email") {
        await sendEmail(recipient, subject, html);
    }
    return "sent";
}
// ── main ──────────────────────────────────────────────────────────────────────
(async () => {
    console.log("\n🔔 Campaign Manager — Admin notification test");
    banner("Configuration");
    console.log("  Delivery channel :", channel);
    console.log("  Recipient        :", recipient || "(not set)");
    console.log("  Admin enabled    :", adminEnabled ? "✅ yes" : "❌ no");
    console.log("  Admin dry-run    :", adminDryRun ? "📋 on (log only)" : "🚀 off (will actually send)");
    if (!recipient) {
        console.error("\n❌ No recipient configured. Set completionAlert.recipient in Configuration.");
        process.exit(1);
    }
    // ── Test 1: completion alert ──────────────────────────────────────────────
    banner("Test 1 — Campaign completion alert");
    const completionText = `✅ *[TEST] Campaign 100% complete — still open*\n` +
        `*Test Campaign (smoke test)* has all 42 reviews completed (deadline: 2026-06-01).\n` +
        `All reviews are done — you may want to close the campaign in ConductorOne.\n\n` +
        `_This is a test message from \`npx tsx src/scripts/test-admin-notifications.ts\`_`;
    const completionHtml = `<p>✅ <strong>[TEST] Campaign 100% complete — still open</strong></p>` +
        `<p><strong>Test Campaign (smoke test)</strong> has all 42 reviews completed (deadline: 2026-06-01).</p>` +
        `<p>All reviews are done — you may want to close the campaign in ConductorOne.</p>` +
        `<p><em>This is a test message from test-admin-notifications.ts</em></p>`;
    try {
        const r = await send(completionText, "[TEST] Campaign 100% complete — smoke test", completionHtml);
        if (r === "sent")
            console.log("  ✅ Sent successfully via", channel);
        else if (r === "dry-run")
            console.log("  📋 Dry-run — logged, not sent");
        else
            console.log("  ⏸  Skipped — admin notifications are disabled");
    }
    catch (err) {
        console.error("  ❌ Failed:", err?.data?.error ?? err?.message ?? String(err));
        if ((err?.data?.error ?? err?.message ?? "").includes("not_in_channel")) {
            console.error("     → Invite the bot to the channel first: /invite @<bot-name>");
        }
    }
    // ── Test 2: overdue alert ─────────────────────────────────────────────────
    banner("Test 2 — Overdue campaign alert");
    const overdueText = `⚠️ *[TEST] Overdue campaign — accounts ready to disable*\n` +
        `*Test Campaign (smoke test)* is *3 days overdue* (deadline: 2026-05-15).\n\n` +
        `The following Zinnia accounts still have pending reviews and can be disabled in Azure AD:\n` +
        `• Test User (testuser@zinnia.com)\n\n` +
        `To disable an account, go to *Impacted Accounts* in the Campaign Manager dashboard.\n\n` +
        `_This is a test message from \`npx tsx src/scripts/test-admin-notifications.ts\`_`;
    const overdueHtml = `<p>⚠️ <strong>[TEST] Overdue campaign — accounts ready to disable</strong></p>` +
        `<p><strong>Test Campaign (smoke test)</strong> is <strong>3 days overdue</strong> (deadline: 2026-05-15).</p>` +
        `<p>The following Zinnia accounts still have pending reviews and can be disabled in Azure AD:</p>` +
        `<ul><li>Test User — <code>testuser@zinnia.com</code></li></ul>` +
        `<p>To disable an account, go to <strong>Impacted Accounts</strong> in the Campaign Manager dashboard.</p>` +
        `<p><em>This is a test message from test-admin-notifications.ts</em></p>`;
    try {
        const r = await send(overdueText, "[TEST] Overdue campaign — smoke test", overdueHtml);
        if (r === "sent")
            console.log("  ✅ Sent successfully via", channel);
        else if (r === "dry-run")
            console.log("  📋 Dry-run — logged, not sent");
        else
            console.log("  ⏸  Skipped — admin notifications are disabled");
    }
    catch (err) {
        console.error("  ❌ Failed:", err?.data?.error ?? err?.message ?? String(err));
    }
    console.log("\n✅ Done.\n");
})();
//# sourceMappingURL=test-admin-notifications.js.map