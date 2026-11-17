"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearGraphCache = void 0;
exports.resetGraphClient = resetGraphClient;
exports.graphClient = graphClient;
exports.getUserByEmail = getUserByEmail;
exports.getManagerChain = getManagerChain;
exports.getUserById = getUserById;
exports.setUserAccountEnabled = setUserAccountEnabled;
exports.fetchAccountEnabled = fetchAccountEnabled;
exports.isUserOutOfOffice = isUserOutOfOffice;
exports.getDirectReports = getDirectReports;
exports.getDownstreamReports = getDownstreamReports;
const msal_node_1 = require("@azure/msal-node");
const microsoft_graph_client_1 = require("@microsoft/microsoft-graph-client");
require("cross-fetch/polyfill");
const config_1 = require("../config");
const logger_1 = require("../logger");
const graphCache_1 = require("./graphCache");
// MS Graph service. Uses app-only (client credentials) for directory reads:
// user lookup, manager chain, transitive direct reports.
let appClient = null;
let appToken = null;
function resetGraphClient() {
    appClient = null;
    appToken = null;
    userByEmailCache.clear();
}
// Re-export so admins can clear the persistent Graph cache from the UI.
var graphCache_2 = require("./graphCache");
Object.defineProperty(exports, "clearGraphCache", { enumerable: true, get: function () { return graphCache_2.clearGraphCache; } });
function appOnlyMsal() {
    return new msal_node_1.ConfidentialClientApplication({
        auth: {
            clientId: config_1.config.entra.clientId,
            clientSecret: config_1.config.entra.clientSecret,
            authority: `https://login.microsoftonline.com/${config_1.config.entra.tenantId}`,
        },
    });
}
async function getAppToken() {
    const now = Date.now();
    if (appToken && appToken.expiresAt - 60_000 > now)
        return appToken.value;
    const client = appOnlyMsal();
    const res = await client.acquireTokenByClientCredential({
        scopes: ["https://graph.microsoft.com/.default"],
    });
    if (!res?.accessToken)
        throw new Error("Graph: failed to acquire app token");
    appToken = {
        value: res.accessToken,
        expiresAt: res.expiresOn?.getTime() ?? now + 55 * 60_000,
    };
    return appToken.value;
}
async function graphClient() {
    if (appClient)
        return appClient;
    appClient = microsoft_graph_client_1.Client.init({
        authProvider: async (done) => {
            try {
                const token = await getAppToken();
                done(null, token);
            }
            catch (err) {
                done(err, null);
            }
        },
    });
    return appClient;
}
const userByEmailCache = new Map();
const CACHE_TTL_MS = 10 * 60_000;
function cacheGet(email) {
    const entry = userByEmailCache.get(email.toLowerCase());
    if (!entry)
        return undefined;
    if (Date.now() - entry.at > CACHE_TTL_MS) {
        userByEmailCache.delete(email.toLowerCase());
        return undefined;
    }
    return entry.user;
}
function cacheSet(email, user) {
    userByEmailCache.set(email.toLowerCase(), { user, at: Date.now() });
}
async function getUserByEmail(email) {
    const lower = email.toLowerCase();
    const inMem = cacheGet(lower);
    if (inMem !== undefined)
        return inMem;
    const disk = await (0, graphCache_1.getCachedUserByEmail)(lower);
    if (disk.hit) {
        cacheSet(lower, disk.user);
        return disk.user;
    }
    const gc = await graphClient();
    try {
        const res = await gc
            .api(`/users/${encodeURIComponent(lower)}`)
            .select("id,mail,userPrincipalName,displayName,accountEnabled")
            .get();
        let managerId;
        try {
            const m = await gc.api(`/users/${res.id}/manager`).select("id").get();
            managerId = m?.id;
        }
        catch {
            // no manager set
        }
        const user = {
            id: res.id,
            mail: (res.mail ?? res.userPrincipalName ?? lower).toLowerCase(),
            userPrincipalName: res.userPrincipalName,
            displayName: res.displayName ?? lower,
            managerId,
            accountEnabled: res.accountEnabled !== false,
        };
        cacheSet(lower, user);
        await (0, graphCache_1.setCachedUser)(user, lower);
        return user;
    }
    catch (err) {
        logger_1.logger.warn("graph_user_lookup_failed", { email: lower, status: err?.statusCode });
        cacheSet(lower, null);
        await (0, graphCache_1.setCachedUser)(null, lower);
        return null;
    }
}
async function getManagerChain(email) {
    const chain = [];
    const gc = await graphClient();
    let current = await getUserByEmail(email);
    const seen = new Set();
    while (current?.managerId && !seen.has(current.managerId)) {
        seen.add(current.managerId);
        try {
            const m = await gc
                .api(`/users/${current.managerId}`)
                .select("id,mail,userPrincipalName,displayName")
                .get();
            let nextManagerId;
            try {
                const mm = await gc.api(`/users/${m.id}/manager`).select("id").get();
                nextManagerId = mm?.id;
            }
            catch { }
            const mu = {
                id: m.id,
                mail: (m.mail ?? m.userPrincipalName ?? "").toLowerCase(),
                userPrincipalName: m.userPrincipalName,
                displayName: m.displayName ?? m.userPrincipalName,
                managerId: nextManagerId,
            };
            chain.push(mu);
            current = mu;
        }
        catch {
            break;
        }
    }
    return chain;
}
async function getUserById(graphUserId) {
    const disk = await (0, graphCache_1.getCachedUserById)(graphUserId);
    if (disk.hit)
        return disk.user;
    const gc = await graphClient();
    try {
        const res = await gc
            .api(`/users/${graphUserId}`)
            .select("id,mail,userPrincipalName,displayName,accountEnabled")
            .get();
        let managerId;
        try {
            const m = await gc.api(`/users/${res.id}/manager`).select("id").get();
            managerId = m?.id;
        }
        catch { }
        const user = {
            id: res.id,
            mail: (res.mail ?? res.userPrincipalName ?? "").toLowerCase(),
            userPrincipalName: res.userPrincipalName,
            displayName: res.displayName ?? res.userPrincipalName,
            managerId,
            accountEnabled: res.accountEnabled !== false,
        };
        await (0, graphCache_1.setCachedUser)(user, user.mail);
        return user;
    }
    catch {
        await (0, graphCache_1.setCachedUser)(null, graphUserId);
        return null;
    }
}
// Disable (or re-enable) an Azure AD user account. Requires the app
// registration to have Microsoft Graph application permission "User.ReadWrite.All"
// with admin consent — without it, Graph returns 403.
async function setUserAccountEnabled(email, enabled) {
    const lower = email.toLowerCase();
    try {
        const u = await getUserByEmail(lower);
        if (!u)
            return { ok: false, error: "user_not_found" };
        const gc = await graphClient();
        await gc.api(`/users/${u.id}`).patch({ accountEnabled: enabled });
        return { ok: true };
    }
    catch (err) {
        const status = err?.statusCode ?? err?.code;
        const msg = err?.body ? String(err.body).slice(0, 300) : err?.message ?? "graph_error";
        logger_1.logger.warn("graph_set_account_enabled_failed", { email: lower, enabled, status, msg });
        return { ok: false, error: `${status ?? "error"}: ${msg}` };
    }
}
// Force-fresh single-user lookup that bypasses both in-memory and disk caches.
// Used by the UI to verify a disable actually took effect (Graph PATCH is
// async-ish — the change usually propagates in <1s but caches stale faster).
async function fetchAccountEnabled(email) {
    const lower = email.toLowerCase();
    try {
        const gc = await graphClient();
        const res = await gc
            .api(`/users/${encodeURIComponent(lower)}`)
            .select("id,mail,userPrincipalName,displayName,accountEnabled")
            .get();
        // Treat null/undefined as indeterminate (Graph propagating) — return null
        // so the UI doesn't falsely show "enabled" mid-propagation.
        const enabled = res.accountEnabled === true
            ? true
            : res.accountEnabled === false
                ? false
                : null;
        // Update both caches so subsequent /impacted reads see the new state.
        const fresh = {
            id: res.id,
            mail: (res.mail ?? res.userPrincipalName ?? lower).toLowerCase(),
            userPrincipalName: res.userPrincipalName,
            displayName: res.displayName ?? lower,
            accountEnabled: enabled ?? undefined,
        };
        cacheSet(lower, fresh);
        await (0, graphCache_1.setCachedUser)(fresh, lower);
        return enabled;
    }
    catch (err) {
        logger_1.logger.warn("graph_fetch_account_enabled_failed", { email: lower, status: err?.statusCode });
        return null;
    }
}
// Returns true if the user currently has an auto-reply (OOF) enabled.
async function isUserOutOfOffice(email) {
    const gc = await graphClient();
    try {
        const res = await gc
            .api(`/users/${encodeURIComponent(email.toLowerCase())}/mailboxSettings/automaticRepliesSetting`)
            .get();
        const status = (res?.status ?? "").toString().toLowerCase();
        return status === "alwaysenabled" || status === "scheduled";
    }
    catch (err) {
        logger_1.logger.debug("oof_check_failed", { email, err: err?.message });
        return false;
    }
}
// Get the immediate direct reports of a user (cached).
async function getDirectReports(userId) {
    const disk = await (0, graphCache_1.getCachedReports)(userId);
    if (disk.hit)
        return disk.reports;
    const gc = await graphClient();
    const out = [];
    let pageUrl = `/users/${userId}/directReports?$select=id,mail,userPrincipalName,displayName,accountEnabled`;
    while (pageUrl) {
        try {
            const res = await gc.api(pageUrl).get();
            for (const r of res.value ?? []) {
                const mu = {
                    id: r.id,
                    mail: (r.mail ?? r.userPrincipalName ?? "").toLowerCase(),
                    userPrincipalName: r.userPrincipalName,
                    displayName: r.displayName ?? r.userPrincipalName,
                    accountEnabled: r.accountEnabled !== false,
                };
                out.push(mu);
            }
            pageUrl = res["@odata.nextLink"] ?? null;
        }
        catch (err) {
            logger_1.logger.warn("graph_direct_reports_failed", { userId, err: err?.message });
            break;
        }
    }
    await (0, graphCache_1.setCachedReports)(userId, out);
    return out;
}
// Transitive direct reports (entire org tree below a user). Uses cached direct
// reports per node, so subsequent calls touching the same subtree are fast.
async function getDownstreamReports(userId) {
    const out = [];
    const seen = new Set([userId]);
    const queue = [userId];
    while (queue.length) {
        const id = queue.shift();
        const direct = await getDirectReports(id);
        for (const r of direct) {
            if (!seen.has(r.id)) {
                seen.add(r.id);
                out.push(r);
                queue.push(r.id);
            }
        }
    }
    return out;
}
//# sourceMappingURL=graph.js.map