"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_TEMPLATES = void 0;
exports.getStore = getStore;
exports.saveTemplate = saveTemplate;
exports.deletePerCampaignTemplate = deletePerCampaignTemplate;
exports.resolveTemplate = resolveTemplate;
exports.expandTokens = expandTokens;
exports.renderMarkdownToHtml = renderMarkdownToHtml;
exports.renderMarkdownToSlackBlocks = renderMarkdownToSlackBlocks;
const marked_1 = require("marked");
const storage_1 = require("./storage");
const audit_1 = require("./audit");
const KEY = "templates";
function k(section, channel) {
    return `${section}:${channel}`;
}
exports.DEFAULT_TEMPLATES = {
    [k("wrapper", "email")]: {
        section: "wrapper",
        channel: "email",
        subject: "Access reviews — action needed ({{summary.totalPending}} pending)",
        bodyMarkdown: "Hi {{recipient.firstName}},\n\n{{sections}}\n\n— Zinnia Access Reviews\n\n_Questions? Reply to this email._",
    },
    [k("wrapper", "slack")]: {
        section: "wrapper",
        channel: "slack",
        bodyMarkdown: "Hi {{recipient.firstName}} — *{{summary.totalPending}} access reviews* still need attention across your org.\n\n{{sections}}",
    },
    [k("reviewer_pending", "email")]: {
        section: "reviewer_pending",
        channel: "email",
        bodyMarkdown: "## Your pending reviews ({{section.count}})\n\n{{section.pendingTable}}\n\nDeadline: **{{section.deadline}}** ({{section.daysUntilDeadline}} days). [Open in ConductorOne]({{section.campaignUrl}})",
    },
    [k("reviewer_pending", "slack")]: {
        section: "reviewer_pending",
        channel: "slack",
        bodyMarkdown: "*Your pending reviews ({{section.count}})*\n{{section.pendingList}}\nDeadline: *{{section.deadline}}* · <{{section.campaignUrl}}|Open in ConductorOne>",
    },
    [k("direct_behind", "email")]: {
        section: "direct_behind",
        channel: "email",
        bodyMarkdown: "## Direct reports behind ({{section.count}})\n\nThe following people on your team have incomplete reviews:\n\n{{section.reviewerTable}}",
    },
    [k("direct_behind", "slack")]: {
        section: "direct_behind",
        channel: "slack",
        bodyMarkdown: "*Direct reports behind ({{section.count}})*\n{{section.reviewerList}}",
    },
    [k("skip_behind", "email")]: {
        section: "skip_behind",
        channel: "email",
        bodyMarkdown: "## Skip-level reports behind ({{section.count}})\n\nPeople 2 levels below you who have incomplete reviews:\n\n{{section.reviewerTable}}",
    },
    [k("skip_behind", "slack")]: {
        section: "skip_behind",
        channel: "slack",
        bodyMarkdown: "*Skip-level reports behind ({{section.count}})*\n{{section.reviewerList}}",
    },
    [k("deeper_behind", "email")]: {
        section: "deeper_behind",
        channel: "email",
        bodyMarkdown: "## Further reports behind ({{section.count}})\n\nPeople 3+ levels below you still outstanding:\n\n{{section.reviewerTable}}",
    },
    [k("deeper_behind", "slack")]: {
        section: "deeper_behind",
        channel: "slack",
        bodyMarkdown: "*Further reports behind ({{section.count}})*\n{{section.reviewerList}}",
    },
    [k("admin_digest", "email")]: {
        section: "admin_digest",
        channel: "email",
        subject: "Access reviews — admin daily digest",
        bodyMarkdown: "## Admin digest\n\n- Open campaigns: **{{admin.openCampaigns}}**\n- At-risk campaigns: **{{admin.atRisk}}**\n- Total pending reviews: **{{admin.totalPending}}**\n- Reviewers behind: **{{admin.reviewersBehind}}**\n- Suppressed (OOF or admin): **{{admin.suppressed}}**\n\n### At-risk campaigns\n\n{{admin.atRiskTable}}",
    },
    [k("admin_digest", "slack")]: {
        section: "admin_digest",
        channel: "slack",
        bodyMarkdown: "*Admin daily digest*\nOpen: *{{admin.openCampaigns}}* · At-risk: *{{admin.atRisk}}* · Pending: *{{admin.totalPending}}* · Behind: *{{admin.reviewersBehind}}*",
    },
    // ── Account action templates ──────────────────────────────────────────────
    [k("account_disabled", "slack")]: {
        section: "account_disabled",
        channel: "slack",
        bodyMarkdown: "🔴 *{{accounts.count}} account(s) disabled — {{actor}}*\n\n{{accounts.list}}\n\n*Campaign(s):* {{campaigns.list}}",
    },
    [k("account_disabled", "email")]: {
        section: "account_disabled",
        channel: "email",
        subject: "Account(s) disabled — {{campaigns.list}}",
        bodyMarkdown: "## {{accounts.count}} account(s) disabled\n\n**Actioned by:** {{actor}}\n**Campaign(s):** {{campaigns.list}}\n\n{{accounts.table}}",
    },
    [k("account_enabled", "slack")]: {
        section: "account_enabled",
        channel: "slack",
        bodyMarkdown: "✅ *{{accounts.count}} account(s) re-enabled — {{actor}}*\n\n{{accounts.list}}\n\n*Campaign(s):* {{campaigns.list}}",
    },
    [k("account_enabled", "email")]: {
        section: "account_enabled",
        channel: "email",
        subject: "Account(s) re-enabled — {{campaigns.list}}",
        bodyMarkdown: "## {{accounts.count}} account(s) re-enabled\n\n**Actioned by:** {{actor}}\n**Campaign(s):** {{campaigns.list}}\n\n{{accounts.table}}",
    },
    [k("reviewer_account_disabled", "slack")]: {
        section: "reviewer_account_disabled",
        channel: "slack",
        bodyMarkdown: "🔴 *Action required — Access review overdue*\n\nHi {{reviewer.firstName}},\n\nThe account *{{account.email}}* has been disabled by the IAM team because the access review assigned to you for campaign *{{campaign.name}}* is overdue (deadline: {{campaign.deadline}}).\n\nTo get this account re-enabled:\n1. Complete your pending access review in ConductorOne\n2. Contact the *Helpdesk* to request re-enablement — do not contact the IAM team directly\n\nThe Helpdesk will verify with the IAM team that the review is complete before re-enabling the account.",
    },
    [k("reviewer_account_disabled", "email")]: {
        section: "reviewer_account_disabled",
        channel: "email",
        subject: "Action required — Account disabled due to overdue access review ({{campaign.name}})",
        bodyMarkdown: "Hi {{reviewer.firstName}},\n\nThe account **{{account.email}}** ({{account.name}}) has been disabled by the IAM team because the access review assigned to you for campaign **{{campaign.name}}** is overdue (deadline: {{campaign.deadline}}).\n\n## What you need to do\n\n1. Complete your pending access review in ConductorOne\n2. Contact the **Helpdesk** to request re-enablement — do not contact the IAM team directly\n\nThe Helpdesk will verify with the IAM team that the review is complete before re-enabling the account.\n\n_This is an automated notification from the Zinnia Campaign Manager._",
    },
    [k("manager_account_disabled", "slack")]: {
        section: "manager_account_disabled",
        channel: "slack",
        bodyMarkdown: "🔴 *FYI — Account disabled due to overdue access review*\n\nHi {{manager.firstName}},\n\nThis is a notification that *{{account.email}}* has been disabled by the IAM team. The access review assigned to *{{reviewer.name}}* for campaign *{{campaign.name}}* is overdue.\n\n{{reviewer.name}} has been notified directly and instructed to complete the review and contact the Helpdesk to request re-enablement.",
    },
    [k("manager_account_disabled", "email")]: {
        section: "manager_account_disabled",
        channel: "email",
        subject: "FYI — Account disabled due to overdue access review ({{campaign.name}})",
        bodyMarkdown: "Hi {{manager.firstName}},\n\nThis is a notification that **{{account.email}}** ({{account.name}}) has been disabled by the IAM team. The access review assigned to **{{reviewer.name}}** for campaign **{{campaign.name}}** is overdue.\n\n**{{reviewer.name}}** has been notified directly and instructed to:\n1. Complete the pending access review in ConductorOne\n2. Contact the Helpdesk to request re-enablement\n\n_This is an automated notification from the Zinnia Campaign Manager._",
    },
};
async function getStore() {
    const s = await (0, storage_1.readJson)(KEY, null);
    if (!s) {
        const seeded = { global: exports.DEFAULT_TEMPLATES, perCampaign: {} };
        await (0, storage_1.writeJson)(KEY, seeded);
        return seeded;
    }
    // Fill any missing defaults (useful when we add sections later).
    for (const key of Object.keys(exports.DEFAULT_TEMPLATES)) {
        if (!s.global[key])
            s.global[key] = exports.DEFAULT_TEMPLATES[key];
    }
    return s;
}
async function saveTemplate(doc, actor, campaignId) {
    const store = await getStore();
    const key = k(doc.section, doc.channel);
    if (campaignId) {
        store.perCampaign[campaignId] = store.perCampaign[campaignId] ?? {};
        store.perCampaign[campaignId][key] = doc;
    }
    else {
        store.global[key] = doc;
    }
    await (0, storage_1.writeJson)(KEY, store);
    await (0, audit_1.audit)({ actor, action: "template.save", target: key, details: { campaignId } });
    return store;
}
async function deletePerCampaignTemplate(section, channel, campaignId, actor) {
    const store = await getStore();
    const map = store.perCampaign[campaignId];
    if (map) {
        delete map[k(section, channel)];
        if (Object.keys(map).length === 0)
            delete store.perCampaign[campaignId];
        await (0, storage_1.writeJson)(KEY, store);
        await (0, audit_1.audit)({ actor, action: "template.clear_override", target: k(section, channel), details: { campaignId } });
    }
    return store;
}
function resolveTemplate(store, section, channel, campaignId) {
    const key = k(section, channel);
    if (campaignId && store.perCampaign[campaignId]?.[key]) {
        return store.perCampaign[campaignId][key];
    }
    return store.global[key] ?? exports.DEFAULT_TEMPLATES[key];
}
function expandTokens(source, tokens) {
    return source.replace(/\{\{\s*([\w.[\]]+)\s*\}\}/g, (_m, path) => {
        const v = pick(tokens, path.split(/[.[\]]+/).filter(Boolean));
        return v == null ? "" : String(v);
    });
}
function pick(obj, path) {
    let cur = obj;
    for (const p of path) {
        if (cur == null)
            return undefined;
        cur = cur[p];
    }
    return cur;
}
function renderMarkdownToHtml(md) {
    const html = marked_1.marked.parse(md, { async: false, gfm: true, breaks: true });
    return html;
}
// Slack doesn't use full Markdown — we convert a subset and return Block Kit.
// The simplest reliable approach: one section block with mrkdwn text (which
// Slack supports for *bold*, _italic_, `code`, and <url|label>).
function renderMarkdownToSlackBlocks(md) {
    // Convert common Markdown constructs Slack doesn't support into Slack mrkdwn.
    let s = md;
    // [label](url) → <url|label>
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");
    // **bold** → *bold*; keep single-asterisk as is
    s = s.replace(/\*\*(.+?)\*\*/g, "*$1*");
    // Headings: # Title, ## Sub → bold + newline
    s = s.replace(/^######\s*(.+)$/gm, "*$1*");
    s = s.replace(/^#####\s*(.+)$/gm, "*$1*");
    s = s.replace(/^####\s*(.+)$/gm, "*$1*");
    s = s.replace(/^###\s*(.+)$/gm, "*$1*");
    s = s.replace(/^##\s*(.+)$/gm, "*$1*");
    s = s.replace(/^#\s*(.+)$/gm, "*$1*");
    return [{ type: "section", text: { type: "mrkdwn", text: s.slice(0, 2900) } }];
}
//# sourceMappingURL=templates.js.map