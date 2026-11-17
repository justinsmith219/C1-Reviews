"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCachedUserByEmail = getCachedUserByEmail;
exports.getCachedUserById = getCachedUserById;
exports.setCachedUser = setCachedUser;
exports.getCachedReports = getCachedReports;
exports.setCachedReports = setCachedReports;
exports.clearGraphCache = clearGraphCache;
const storage_1 = require("./storage");
const logger_1 = require("../logger");
// Persistent disk cache for Graph user lookups + direct reports.
// Survives server restarts so we don't re-walk Entra every time.
//
// TTL is conservative (org structure rarely changes intra-day) but the cache
// can be wiped via clearGraphCache() if a manager attribute is updated and you
// need fresh data immediately.
const USERS_KEY = "graph-users-cache";
const REPORTS_KEY = "graph-reports-cache";
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
let users = null;
let reports = null;
async function loadUsers() {
    if (users)
        return users;
    users = await (0, storage_1.readJson)(USERS_KEY, { byEmail: {}, byId: {} });
    return users;
}
async function loadReports() {
    if (reports)
        return reports;
    reports = await (0, storage_1.readJson)(REPORTS_KEY, { byId: {} });
    return reports;
}
let usersDirty = false;
let reportsDirty = false;
let flushTimer = null;
function scheduleFlush() {
    if (flushTimer)
        return;
    flushTimer = setTimeout(async () => {
        flushTimer = null;
        if (usersDirty && users) {
            try {
                await (0, storage_1.writeJson)(USERS_KEY, users);
                usersDirty = false;
            }
            catch (err) {
                logger_1.logger.warn("graph_cache_flush_failed", { err: err?.message });
            }
        }
        if (reportsDirty && reports) {
            try {
                await (0, storage_1.writeJson)(REPORTS_KEY, reports);
                reportsDirty = false;
            }
            catch (err) {
                logger_1.logger.warn("graph_cache_flush_failed", { err: err?.message });
            }
        }
    }, 5_000);
}
async function getCachedUserByEmail(email) {
    const cache = await loadUsers();
    const lower = email.toLowerCase();
    const entry = cache.byEmail[lower];
    if (entry && Date.now() - entry.at < TTL_MS) {
        return { hit: true, user: entry.user };
    }
    return { hit: false, user: null };
}
async function getCachedUserById(id) {
    const cache = await loadUsers();
    const entry = cache.byId[id];
    if (entry && Date.now() - entry.at < TTL_MS) {
        return { hit: true, user: entry.user };
    }
    return { hit: false, user: null };
}
async function setCachedUser(user, lookupKey) {
    const cache = await loadUsers();
    const at = Date.now();
    if (user) {
        cache.byId[user.id] = { user, at };
        cache.byEmail[user.mail.toLowerCase()] = { user, at };
    }
    else {
        cache.byEmail[lookupKey.toLowerCase()] = { user: null, at };
    }
    usersDirty = true;
    scheduleFlush();
}
async function getCachedReports(userId) {
    const cache = await loadReports();
    const entry = cache.byId[userId];
    if (entry && Date.now() - entry.at < TTL_MS) {
        return { hit: true, reports: entry.reports };
    }
    return { hit: false, reports: [] };
}
async function setCachedReports(userId, list) {
    const cache = await loadReports();
    cache.byId[userId] = { reports: list, at: Date.now() };
    reportsDirty = true;
    scheduleFlush();
}
async function clearGraphCache() {
    users = { byEmail: {}, byId: {} };
    reports = { byId: {} };
    await (0, storage_1.writeJson)(USERS_KEY, users);
    await (0, storage_1.writeJson)(REPORTS_KEY, reports);
}
//# sourceMappingURL=graphCache.js.map