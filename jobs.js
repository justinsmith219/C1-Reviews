"use strict";
// Tiny in-process job registry — tracks long-running operations and recent
// scheduled-job outcomes so the admin can see what's running and what last ran.
//
// Two kinds of entries:
//   - "scheduled":     cron-driven jobs (refresh, digest, scorecards). The cron
//                      handlers report their schedule + each run's outcome here.
//   - "on-demand":     async ops kicked off by user actions (history import,
//                      per-campaign task fetch, manual notify). Reported as
//                      they start/finish.
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = register;
exports.start = start;
exports.finish = finish;
exports.track = track;
exports.list = list;
exports.update = update;
const registry = new Map();
function register(info) {
    const existing = registry.get(info.id);
    const next = { ...existing, ...info, status: existing?.status ?? "idle" };
    registry.set(info.id, next);
    return next;
}
function start(id, message, details) {
    const cur = registry.get(id);
    if (!cur)
        return;
    cur.status = "running";
    cur.startedAt = new Date().toISOString();
    cur.finishedAt = undefined;
    cur.durationMs = undefined;
    cur.message = message;
    if (details)
        cur.details = { ...cur.details, ...details };
}
function finish(id, result) {
    const cur = registry.get(id);
    if (!cur)
        return;
    const finishedAt = new Date().toISOString();
    cur.status = result.ok ? "success" : "failed";
    cur.finishedAt = finishedAt;
    cur.durationMs = cur.startedAt ? Date.now() - new Date(cur.startedAt).getTime() : undefined;
    cur.message = result.message ?? cur.message;
    if (result.details)
        cur.details = { ...cur.details, ...result.details };
    if (result.ok)
        cur.lastSuccessAt = finishedAt;
    else
        cur.lastFailureAt = finishedAt;
}
async function track(id, fn, opts = {}) {
    start(id, opts.startMessage, opts.details);
    try {
        const result = await fn();
        finish(id, { ok: true });
        return result;
    }
    catch (err) {
        finish(id, { ok: false, message: err?.message ?? "failed" });
        throw err;
    }
}
function list() {
    return [...registry.values()].sort((a, b) => a.id.localeCompare(b.id));
}
function update(id, patch) {
    const cur = registry.get(id);
    if (!cur)
        return;
    Object.assign(cur, patch);
}
//# sourceMappingURL=jobs.js.map