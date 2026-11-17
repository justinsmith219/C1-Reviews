"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildOrgView = buildOrgView;
const campaignStore_1 = require("./campaignStore");
const orgTree_1 = require("./orgTree");
const config_1 = require("../config");
const graph_1 = require("./graph");
const logger_1 = require("../logger");
// Build a collapsible org-tree view.
// - Admins: rooted at CEO with the entire company subtree.
// - Everyone else: rooted at CEO showing only the spine of ancestors leading
//   down to the user, plus the user's full subtree below them. Branches
//   that don't contain the user are pruned.
async function buildOrgView(user) {
    const snap = await (0, campaignStore_1.getSnapshot)();
    if (!snap)
        return { fetchedAt: new Date().toISOString(), root: null, flat: [] };
    const seeds = new Set([
        ...snap.reviewers.map((r) => r.email),
        ...config_1.config.admins,
        config_1.config.orgTop.ceoEmail,
        user.email,
    ]);
    // Pull the user's full downstream from Graph (cached) so non-reviewers also
    // appear under them. Admin views additionally seed downstream from CEO so
    // the whole company surfaces; the cache makes subsequent loads fast.
    const isAdmin = user.roles.includes("admin");
    const downstreamRoots = [user.email];
    if (isAdmin)
        downstreamRoots.push(config_1.config.orgTop.ceoEmail);
    for (const rootEmail of downstreamRoots) {
        try {
            const u = await (0, graph_1.getUserByEmail)(rootEmail);
            if (!u)
                continue;
            const down = await (0, graph_1.getDownstreamReports)(u.id);
            for (const d of down)
                if (d.mail)
                    seeds.add(d.mail.toLowerCase());
        }
        catch (err) {
            logger_1.logger.warn("orgview_downstream_seed_failed", { rootEmail, err: err?.message });
        }
    }
    const tree = await (0, orgTree_1.buildOrgTreeForEmails)([...seeds]);
    // Pending/completed by reviewer email.
    const pendingByEmail = new Map();
    const completedByEmail = new Map();
    const reviewerEmailSet = new Set(snap.reviewers.map((r) => r.email));
    for (const r of snap.reviews) {
        const rev = snap.reviewers.find((x) => x.id === r.reviewerId);
        if (!rev)
            continue;
        if (r.status === "pending") {
            pendingByEmail.set(rev.email, (pendingByEmail.get(rev.email) ?? 0) + 1);
        }
        else {
            completedByEmail.set(rev.email, (completedByEmail.get(rev.email) ?? 0) + 1);
        }
    }
    const ceoEmail = config_1.config.orgTop.ceoEmail.toLowerCase();
    const userEmail = user.email.toLowerCase();
    // Build the spine (ancestors of user, including user, up to CEO).
    // Used to keep that exact path visible while pruning siblings above the user.
    const ancestorPath = new Set();
    if (!isAdmin) {
        let cur = tree.byEmail[userEmail];
        while (cur) {
            ancestorPath.add(cur.email);
            if (cur.email === ceoEmail)
                break;
            if (!cur.managerEmail)
                break;
            cur = tree.byEmail[cur.managerEmail];
        }
    }
    function buildNode(email, visited) {
        if (visited.has(email))
            return null;
        visited.add(email);
        const u = tree.byEmail[email];
        if (!u)
            return null;
        // For non-admins, decide which children to include:
        //   - if this node is on the user's ancestor path AND this node is above the user,
        //     only include the child that is on the path
        //   - if this node IS the user, include all descendants
        //   - if this node is descendant of user, include all descendants
        //   - if admin, include everything
        const isUserNode = email === userEmail;
        const aboveUser = !isAdmin && ancestorPath.has(email) && !isUserNode;
        let childEmails = u.directReportEmails;
        if (!isAdmin && aboveUser) {
            childEmails = childEmails.filter((c) => ancestorPath.has(c));
        }
        const children = [];
        for (const childEmail of childEmails) {
            const child = buildNode(childEmail, visited);
            if (child)
                children.push(child);
        }
        let totalPending = pendingByEmail.get(email) ?? 0;
        let totalCompleted = completedByEmail.get(email) ?? 0;
        for (const c of children) {
            totalPending += c.pending;
            totalCompleted += c.completed;
        }
        return {
            email: u.email,
            displayName: u.displayName,
            accountEnabled: u.accountEnabled,
            pending: totalPending,
            completed: totalCompleted,
            children: children.sort((a, b) => b.pending - a.pending),
            isCEO: u.email === ceoEmail,
            isAdmin: config_1.config.admins.includes(u.email),
            isReviewer: reviewerEmailSet.has(u.email),
            isBehind: (pendingByEmail.get(u.email) ?? 0) > 0,
            isSelf: u.email === userEmail,
        };
    }
    // Always render starting at CEO so the spine displays naturally.
    const root = buildNode(ceoEmail, new Set());
    const flat = [];
    function flatten(n) {
        flat.push(n);
        n.children.forEach(flatten);
    }
    if (root)
        flatten(root);
    return { fetchedAt: tree.fetchedAt, root, flat };
}
//# sourceMappingURL=orgView.js.map