"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildOrgTreeForEmails = buildOrgTreeForEmails;
exports.managerChain = managerChain;
exports.downstreamReports = downstreamReports;
const graph_1 = require("./graph");
const logger_1 = require("../logger");
// Build an org tree by walking upward from a set of seed emails (all reviewers in
// the current snapshot) to the CEO, collecting every intermediate user. Recomputed
// per digest run — the user asked for no caching.
async function buildOrgTreeForEmails(seedEmails) {
    const started = Date.now();
    const byId = new Map();
    const byEmail = new Map();
    const idToEmail = new Map();
    async function fetchAndStore(email, id) {
        const u = email ? await (0, graph_1.getUserByEmail)(email) : id ? await (0, graph_1.getUserById)(id) : null;
        if (!u?.mail)
            return null;
        const emailLower = u.mail.toLowerCase();
        if (byEmail.has(emailLower))
            return byEmail.get(emailLower);
        const record = {
            azureId: u.id,
            email: emailLower,
            displayName: u.displayName,
            accountEnabled: u.accountEnabled !== false,
            managerEmail: undefined,
            directReportEmails: [],
        };
        byId.set(u.id, record);
        byEmail.set(emailLower, record);
        idToEmail.set(u.id, emailLower);
        // Resolve manager email
        if (u.managerId) {
            const m = await (0, graph_1.getUserById)(u.managerId);
            if (m?.mail) {
                record.managerEmail = m.mail.toLowerCase();
            }
        }
        return record;
    }
    // Walk upward from each seed via managerEmail.
    const queue = [...new Set(seedEmails.map((e) => e.toLowerCase()).filter(Boolean))];
    const visitedEmails = new Set();
    while (queue.length) {
        const email = queue.shift();
        if (visitedEmails.has(email))
            continue;
        visitedEmails.add(email);
        const record = await fetchAndStore(email);
        if (record?.managerEmail && !visitedEmails.has(record.managerEmail)) {
            queue.push(record.managerEmail);
        }
    }
    // Populate directReportEmails from the manager map we collected.
    for (const u of byEmail.values()) {
        if (u.managerEmail) {
            const mgr = byEmail.get(u.managerEmail);
            if (mgr && !mgr.directReportEmails.includes(u.email)) {
                mgr.directReportEmails.push(u.email);
            }
        }
    }
    const out = {
        fetchedAt: new Date().toISOString(),
        byEmail: Object.fromEntries([...byEmail].map(([k, v]) => [k, v])),
    };
    logger_1.logger.info("org_tree_built", { size: byEmail.size, ms: Date.now() - started });
    return out;
}
// Walk upward from an email, skipping gaps (unknown managers) and stopping per rules.
function managerChain(tree, startEmail, options = {}) {
    const chain = [];
    let cur = tree.byEmail[startEmail.toLowerCase()];
    const seen = new Set();
    while (cur?.managerEmail) {
        if (seen.has(cur.managerEmail))
            break;
        seen.add(cur.managerEmail);
        const mgr = tree.byEmail[cur.managerEmail];
        if (!mgr) {
            // Gap in the chain: try to keep walking by swapping the missing email
            // with nothing. We stop here because we don't know who's above.
            break;
        }
        if (options.stopAtEmail && cur.managerEmail === options.stopAtEmail.toLowerCase()) {
            if (options.includeStop)
                chain.push(mgr);
            break;
        }
        chain.push(mgr);
        cur = mgr;
    }
    return chain;
}
// Transitive downstream reports from a given email using the tree.
function downstreamReports(tree, rootEmail) {
    const out = [];
    const seen = new Set();
    const queue = [rootEmail.toLowerCase()];
    while (queue.length) {
        const email = queue.shift();
        if (seen.has(email))
            continue;
        seen.add(email);
        const u = tree.byEmail[email];
        if (!u)
            continue;
        if (email !== rootEmail.toLowerCase())
            out.push(u);
        for (const child of u.directReportEmails)
            queue.push(child);
    }
    return out;
}
//# sourceMappingURL=orgTree.js.map