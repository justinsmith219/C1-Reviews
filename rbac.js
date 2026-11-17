"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = void 0;
exports.requireRole = requireRole;
exports.user = user;
const auth_1 = require("../services/auth");
const VIEW_AS_HEADER = "x-view-as";
const IMPERSONATE_HEADER = "x-impersonate";
// Cache impersonated SessionUsers briefly so each request doesn't re-walk Graph.
const impersonateCache = new Map();
const IMPERSONATE_CACHE_MS = 5 * 60_000;
async function impersonatedUser(email) {
    const lower = email.toLowerCase();
    const hit = impersonateCache.get(lower);
    if (hit && Date.now() - hit.at < IMPERSONATE_CACHE_MS)
        return hit.user;
    try {
        const u = await (0, auth_1.buildSessionUser)({
            username: lower,
            name: lower,
            homeAccountId: "imp-" + lower,
            localAccountId: "imp-" + lower,
        });
        // Strip admin role — impersonation is about seeing the other person's view.
        u.roles = u.roles.filter((r) => r !== "admin");
        impersonateCache.set(lower, { at: Date.now(), user: u });
        return u;
    }
    catch {
        return null;
    }
}
// Apply the X-View-As header to narrow effective roles.
// Admins can choose to view as a non-admin (manager / reviewer) for their session
// to see the dashboard from a non-admin's perspective. Non-admins can never
// elevate via this header.
function applyViewAs(user, req) {
    const viewAs = (req.header(VIEW_AS_HEADER) ?? "").toLowerCase().trim();
    if (!viewAs || viewAs === "admin")
        return user;
    if (!user.roles.includes("admin"))
        return user; // can't change view if not admin
    if (viewAs === "manager") {
        // Manager view: keep manager+reviewer+ea, drop admin.
        return { ...user, roles: user.roles.filter((r) => r !== "admin") };
    }
    if (viewAs === "reviewer") {
        return { ...user, roles: ["reviewer"] };
    }
    return user;
}
const requireAuth = async (req, res, next) => {
    const session = (0, auth_1.getSessionUser)(req);
    if (!session)
        return res.status(401).json({ error: "not_authenticated" });
    const impEmail = (req.header(IMPERSONATE_HEADER) ?? "").toLowerCase().trim();
    if (impEmail && session.roles.includes("admin")) {
        const imp = await impersonatedUser(impEmail);
        if (imp) {
            req.user = imp;
            req.impersonator = session;
            return next();
        }
    }
    req.user = applyViewAs(session, req);
    next();
};
exports.requireAuth = requireAuth;
function requireRole(...roles) {
    return async (req, res, next) => {
        const session = (0, auth_1.getSessionUser)(req);
        if (!session)
            return res.status(401).json({ error: "not_authenticated" });
        // Impersonation NEVER elevates: the role check uses the impersonated user's
        // roles only. So requireRole("admin") fails when impersonating a non-admin
        // (correct — impersonator shouldn't perform admin actions in that mode).
        const impEmail = (req.header(IMPERSONATE_HEADER) ?? "").toLowerCase().trim();
        let effective;
        if (impEmail && session.roles.includes("admin")) {
            const imp = await impersonatedUser(impEmail);
            effective = imp ?? applyViewAs(session, req);
        }
        else {
            effective = applyViewAs(session, req);
        }
        if (!roles.some((r) => (0, auth_1.hasRole)(effective, r))) {
            return res.status(403).json({ error: "forbidden", required: roles });
        }
        req.user = effective;
        next();
    };
}
function user(req) {
    return req.user;
}
//# sourceMappingURL=rbac.js.map