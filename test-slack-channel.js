"use strict";
// Quick smoke-test: post a message to a Slack channel.
// Usage:  npx tsx src/scripts/test-slack-channel.ts [#channel]
// Default channel: #dept-itops-iam
//
// Reads SLACK_BOT_TOKEN from .env (same as the app).
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const web_api_1 = require("@slack/web-api");
const channel = process.argv[2] ?? "#dept-itops-iam";
const token = process.env.SLACK_BOT_TOKEN ?? "";
if (!token) {
    console.error("ERROR: SLACK_BOT_TOKEN is not set in .env");
    process.exit(1);
}
const ch = channel.startsWith("#") ? channel : `#${channel}`;
(async () => {
    console.log(`Sending test message to ${ch}...`);
    try {
        const client = new web_api_1.WebClient(token);
        await client.chat.postMessage({
            channel: ch,
            text: "✅ *Campaign Manager — Slack channel test*\n" +
                "This is a test message from the Campaign Manager notification system. " +
                "If you see this, the bot is correctly configured and can post to this channel.",
            unfurl_links: false,
        });
        console.log("✅ Message sent successfully.");
    }
    catch (err) {
        const msg = err?.data?.error ?? err?.message ?? String(err);
        console.error(`❌ Failed: ${msg}`);
        if (msg === "not_in_channel" || msg === "channel_not_found") {
            console.error(`   → Invite the bot to ${ch} first:  /invite @<bot-name>`);
        }
        process.exit(1);
    }
})();
//# sourceMappingURL=test-slack-channel.js.map