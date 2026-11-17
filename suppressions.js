"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.list = list;
exports.add = add;
exports.remove = remove;
exports.isSuppressed = isSuppressed;
exports.resetOofCache = resetOofCache;
const storage_1 = require("./storage");
const audit_1 = require("./audit");
const graph_1 = require("./graph");
const KEY = "suppressions";
async function load() {
    return (0, storage_1.readJson)(KEY, { manual: [] });
}
async function list() {
    const s = await load();
    const now = Date.now();
    return s.manual.filter((r) => new Date(r.untilDate).getTime() >= now);
}
async function add(entry) {
    const s = await load();
    const existing = s.manual.findIndex((r) => r.email === entry.email.toLowerCase());
    const rec = {
        ...entry,
        email: entry.email.toLowerCase(),
        createdAt: new Date().toISOString(),
    };
    if (existing >= 0)
        s.manual[existing] = rec;
    else
        s.manual.push(rec);
    await (0, storage_1.writeJson)(KEY, s);
    await (0, audit_1.audit)({ actor: entry.createdBy, action: "suppression.add", target: rec.email, details: { until: rec.untilDate } });
    return list();
}
async function remove(email, actor) {
    const s = await load();
    const before = s.manual.length;
    s.manual = s.manual.filter((r) => r.email !== email.toLowerCase());
    if (s.manual.length !== before) {
        await (0, storage_1.writeJson)(KEY, s);
        await (0, audit_1.audit)({ actor, action: "suppression.remove", target: email.toLowerCase() });
    }
    return list();
}
// Checks both: in the manual suppress list (and not expired) OR OOF via Graph.
// OOF results are cached in-memory for 30 minutes to avoid hammering Graph during a digest run.
const oofCache = new Map();
const OOF_TTL_MS = 30 * 60_000;
async function isSuppressed(email) {
    const lower = email.toLowerCase();
    const active = await list();
    const manual = active.find((r) => r.email === lower);
    if (manual) {
        return { suppressed: true, reason: `admin suppress until ${manual.untilDate}${manual.reason ? ` — ${manual.reason}` : ""}` };
    }
    const cached = oofCache.get(lower);
    if (cached && Date.now() - cached.at < OOF_TTL_MS) {
        return cached.oof ? { suppressed: true, reason: "out of office" } : { suppressed: false };
    }
    const oof = await (0, graph_1.isUserOutOfOffice)(lower);
    oofCache.set(lower, { at: Date.now(), oof });
    return oof ? { suppressed: true, reason: "out of office" } : { suppressed: false };
}
function resetOofCache() {
    oofCache.clear();
}
//# sourceMappingURL=suppressions.js.map