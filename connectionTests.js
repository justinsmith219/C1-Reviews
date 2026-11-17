"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runConnectionTests = runConnectionTests;
const axios_1 = __importDefault(require("axios"));
const msal_node_1 = require("@azure/msal-node");
const web_api_1 = require("@slack/web-api");
const nodemailer_1 = __importDefault(require("nodemailer"));
const config_1 = require("../config");
async function testConductor1() {
    try {
        if (config_1.config.conductor1.apiToken) {
            const res = await axios_1.default.get(`${config_1.config.conductor1.baseUrl}/api/v1/access_reviews?page_size=1`, {
                headers: { Authorization: `Bearer ${config_1.config.conductor1.apiToken}` },
                timeout: 10_000,
                validateStatus: () => true,
            });
            if (res.status === 200)
                return { ok: true, message: "API token accepted" };
            return { ok: false, message: `HTTP ${res.status} — token rejected` };
        }
        if (!config_1.config.conductor1.clientId || !config_1.config.conductor1.clientSecret) {
            return { ok: false, message: "No credentials configured" };
        }
        const body = new URLSearchParams({
            grant_type: "client_credentials",
            client_id: config_1.config.conductor1.clientId,
            client_secret: config_1.config.conductor1.clientSecret,
        });
        const res = await axios_1.default.post(`${config_1.config.conductor1.baseUrl}/auth/v1/token`, body.toString(), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            timeout: 10_000,
            validateStatus: () => true,
        });
        if (res.status === 200 && res.data?.access_token) {
            return { ok: true, message: "OAuth client_credentials token issued" };
        }
        return {
            ok: false,
            message: `HTTP ${res.status} — ${res.data?.error ?? "auth failed"}`,
        };
    }
    catch (err) {
        return { ok: false, message: err?.message ?? "error" };
    }
}
async function testEntra() {
    try {
        if (!config_1.config.entra.tenantId || !config_1.config.entra.clientId || !config_1.config.entra.clientSecret) {
            return { ok: false, message: "Missing tenantId / clientId / clientSecret" };
        }
        const m = new msal_node_1.ConfidentialClientApplication({
            auth: {
                clientId: config_1.config.entra.clientId,
                clientSecret: config_1.config.entra.clientSecret,
                authority: `https://login.microsoftonline.com/${config_1.config.entra.tenantId}`,
            },
        });
        const t = await m.acquireTokenByClientCredential({
            scopes: ["https://graph.microsoft.com/.default"],
        });
        if (t?.accessToken)
            return { ok: true, message: "Graph app-only token issued" };
        return { ok: false, message: "No token returned" };
    }
    catch (err) {
        return { ok: false, message: err?.message ?? "error" };
    }
}
async function testSlack() {
    try {
        if (!config_1.config.slack.botToken)
            return { ok: false, message: "Bot token not set" };
        const c = new web_api_1.WebClient(config_1.config.slack.botToken);
        const r = await c.auth.test();
        return {
            ok: !!r.ok,
            message: r.ok ? `Signed in as ${r.user} (${r.team})` : "auth.test failed",
        };
    }
    catch (err) {
        return { ok: false, message: err?.data?.error ?? err?.message ?? "error" };
    }
}
async function testSmtp() {
    try {
        if (!config_1.config.smtp.host)
            return { ok: false, message: "SMTP host not set" };
        const t = nodemailer_1.default.createTransport({
            host: config_1.config.smtp.host,
            port: config_1.config.smtp.port,
            secure: config_1.config.smtp.secure,
            auth: config_1.config.smtp.user ? { user: config_1.config.smtp.user, pass: config_1.config.smtp.pass } : undefined,
            tls: config_1.config.smtp.allowInvalidCerts ? { rejectUnauthorized: false } : undefined,
        });
        await t.verify();
        return { ok: true, message: `Connected to ${config_1.config.smtp.host}:${config_1.config.smtp.port}` };
    }
    catch (err) {
        return { ok: false, message: err?.message ?? "error" };
    }
}
async function runConnectionTests() {
    const [conductor1, entra, slack, smtp] = await Promise.all([
        testConductor1(),
        testEntra(),
        testSlack(),
        testSmtp(),
    ]);
    return { conductor1, entra, slack, smtp };
}
//# sourceMappingURL=connectionTests.js.map