"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.visibleEmails = visibleEmails;
exports.isEmailVisible = isEmailVisible;
exports.invalidateVisibilityCache = invalidateVisibilityCache;
const graph_1 = require("./graph");
const logger_1 = require("../logger");
// Who can the signed-in user see? Returns either:
//   { all: true }             — admin, sees everything
//   { emails: Set<string> }   — limited set of reviewer/subject emails
// For managers: self + entire downstream tree.
// For EAs: union of what each supported exec can see (self + downstream).
// For reviewers: just themselves.
const cache = new Map();
const TTL = 15 * 60_000;
async function emailsForPerspective(email) {
    const lower = email.toLowerCase();
    const cached = cache.get(lower);
    if (cached && Date.now() - cached.at < TTL)
        return cached.set;
    const set = new Set([lower]);
    const u = await (0, graph_1.getUserByEmail)(lower);
    if (u) {
        try {
            const reports = await (0, graph_1.getDownstreamReports)(u.id);
            for (const r of reports)
                if (r.mail)
                    set.add(r.mail.toLowerCase());
        }
        catch (err) {
            logger_1.logger.warn("downstream_lookup_failed", { email: lower, err: err?.message });
        }
    }
    cache.set(lower, { set, at: Date.now() });
    return set;
}
async function visibleEmails(user) {
    if (user.roles.includes("admin"))
        return { all: true };
    const combined = new Set([user.email]);
    if (user.roles.includes("manager")) {
        const mine = await emailsForPerspective(user.email);
        for (const e of mine)
            combined.add(e);
    }
    if (user.roles.includes("ea") && user.supportsExecs.length > 0) {
        for (const exec of user.supportsExecs) {
            const execSet = await emailsForPerspective(exec);
            for (const e of execSet)
                combined.add(e);
        }
    }
    return { all: false, emails: combined };
}
function isEmailVisible(visibility, email) {
    if (visibility.all)
        return true;
    if (!email)
        return false;
    return visibility.emails.has(email.toLowerCase());
}
function invalidateVisibilityCache(email) {
    if (email)
        cache.delete(email.toLowerCase());
    else
        cache.clear();
}
//# sourceMappingURL=visibility.js.map