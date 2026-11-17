"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const auth_1 = require("../services/auth");
const audit_1 = require("../services/audit");
const logger_1 = require("../logger");
const config_1 = require("../config");
const runtimeConfig_1 = require("../services/runtimeConfig");
exports.authRouter = (0, express_1.Router)();
function isEntraConfigured() {
    return !!(config_1.config.entra.tenantId && config_1.config.entra.clientId && config_1.config.entra.clientSecret);
}
// Public: returns whether first-run setup is needed. Safe to call without auth.
exports.authRouter.get("/setup-status", (_req, res) => {
    res.json({
        configured: isEntraConfigured(),
        redirectUri: config_1.config.entra.redirectUri,
        adminsCount: config_1.config.admins.length,
    });
});
// Public, but only works when Entra hasn't been configured yet (first run).
// After first use, this endpoint returns 403 and admins must use /admin/config.
exports.authRouter.post("/setup", async (req, res, next) => {
    try {
        if (isEntraConfigured()) {
            return res.status(403).json({ error: "already_configured" });
        }
        const { tenantId, clientId, clientSecret, adminEmails } = req.body ?? {};
        if (!tenantId || !clientId || !clientSecret) {
            return res.status(400).json({ error: "tenantId, clientId, clientSecret required" });
        }
        const admins = Array.isArray(adminEmails) && adminEmails.length > 0
            ? adminEmails
            : config_1.config.admins.length > 0
                ? config_1.config.admins
                : [];
        if (admins.length === 0) {
            return res.status(400).json({ error: "at least one admin email required" });
        }
        await (0, runtimeConfig_1.update)({
            entra: { tenantId, clientId, clientSecret },
            adminEmails: admins,
        }, "first-run-setup");
        await (0, audit_1.audit)({ actor: "first-run-setup", action: "setup.complete", details: { admins: admins.length } });
        res.json({ ok: true });
    }
    catch (err) {
        next(err);
    }
});
exports.authRouter.get("/login", async (req, res, next) => {
    try {
        const state = crypto_1.default.randomBytes(16).toString("hex");
        const { url, codeVerifier } = await (0, auth_1.buildAuthUrl)(state);
        req.session.oauth = {
            state,
            codeVerifier,
            returnTo: typeof req.query.returnTo === "string" ? req.query.returnTo : "/",
        };
        res.redirect(url);
    }
    catch (err) {
        next(err);
    }
});
exports.authRouter.get("/callback", async (req, res, next) => {
    try {
        const { code, state } = req.query;
        const saved = req.session.oauth;
        if (!code || !state || !saved || saved.state !== state) {
            return res.status(400).send("Invalid auth state");
        }
        const tok = await (0, auth_1.exchangeCode)(code, saved.codeVerifier);
        const user = await (0, auth_1.buildSessionUser)(tok.account);
        req.session.user = user;
        req.session.oauth = undefined;
        await (0, audit_1.audit)({ actor: user.email, action: "auth.login", details: { roles: user.roles } });
        // Honour BASE_PATH so users land on the app, not the host root.
        const basePath = config_1.config.basePath || "";
        const target = saved.returnTo && saved.returnTo !== "/" ? saved.returnTo : `${basePath}/`;
        res.redirect(target);
    }
    catch (err) {
        logger_1.logger.error("auth_callback_failed", { err: err?.message });
        next(err);
    }
});
exports.authRouter.post("/logout", async (req, res) => {
    const user = (0, auth_1.getSessionUser)(req);
    if (user)
        await (0, audit_1.audit)({ actor: user.email, action: "auth.logout" });
    req.session.destroy(() => {
        res.json({ ok: true });
    });
});
exports.authRouter.get("/me", async (req, res) => {
    const user = (0, auth_1.getSessionUser)(req);
    if (!user)
        return res.status(401).json({ error: "not_authenticated" });
    const { getPreferences } = await Promise.resolve().then(() => __importStar(require("../services/preferences")));
    const preferences = await getPreferences(user.email);
    // Optional impersonation overlay so the UI can render the impersonated
    // person's view while keeping the original session for "exit" controls.
    const impEmail = (req.header("x-impersonate") ?? "").toLowerCase().trim();
    if (impEmail && user.roles.includes("admin")) {
        try {
            const { buildSessionUser } = await Promise.resolve().then(() => __importStar(require("../services/auth")));
            const imp = await buildSessionUser({
                username: impEmail,
                name: impEmail,
                homeAccountId: "imp-" + impEmail,
                localAccountId: "imp-" + impEmail,
            });
            imp.roles = imp.roles.filter((r) => r !== "admin");
            await (0, audit_1.audit)({
                actor: user.email,
                action: "impersonate.view",
                target: impEmail,
            });
            return res.json({
                ...imp,
                preferences,
                impersonating: { originalEmail: user.email, originalDisplayName: user.displayName },
            });
        }
        catch {
            // fall through to normal me
        }
    }
    res.json({ ...user, preferences });
});
// Dev-only impersonation shortcut when Entra isn't configured yet.
exports.authRouter.post("/dev-login", async (req, res) => {
    if (config_1.config.env === "production")
        return res.status(404).end();
    const email = (req.body?.email ?? "").toString().toLowerCase();
    if (!email)
        return res.status(400).json({ error: "email required" });
    const user = await (0, auth_1.buildSessionUser)({
        username: email,
        name: email,
        homeAccountId: "dev-" + email,
        localAccountId: "dev-" + email,
    });
    req.session.user = user;
    await (0, audit_1.audit)({ actor: email, action: "auth.dev_login" });
    res.json(user);
});
//# sourceMappingURL=auth.js.map