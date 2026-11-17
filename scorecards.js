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
exports.importHistory = importHistory;
exports.getHistory = getHistory;
exports.computeScorecards = computeScorecards;
exports.getScorecards = getScorecards;
exports.getScorecardTree = getScorecardTree;
exports.diagScorecardTree = diagScorecardTree;
const axios_1 = __importDefault(require("axios"));
const jobs_1 = require("./jobs");
(0, jobs_1.register)({ id: "history_import", name: "Historical campaign import", kind: "on-demand" });
(0, jobs_1.register)({ id: "scorecards_recompute", name: "Scorecards recompute", kind: "scheduled" });
const config_1 = require("../config");
const storage_1 = require("./storage");
const logger_1 = require("../logger");
const audit_1 = require("./audit");
const orgTree_1 = require("./orgTree");
const HIST_KEY = "historical-campaigns";
const SCORE_KEY = "scorecards";
async function loadHist() {
    return (0, storage_1.readJson)(HIST_KEY, { campaigns: [] });
}
// Token cache with auto-refresh (OAuth tokens expire in ~10 min).
let tokenCache = null;
async function getToken() {
    if (config_1.config.conductor1.apiToken)
        return config_1.config.conductor1.apiToken;
    const now = Date.now();
    if (tokenCache && tokenCache.expiresAt - 30_000 > now)
        return tokenCache.value;
    const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config_1.config.conductor1.clientId,
        client_secret: config_1.config.conductor1.clientSecret,
    });
    const r = await axios_1.default.post(`${config_1.config.conductor1.baseUrl}/auth/v1/token`, body.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const token = r.data.access_token;
    const expiresIn = r.data.expires_in ?? 600;
    tokenCache = { value: token, expiresAt: now + expiresIn * 1000 };
    return token;
}
async function authHeader() {
    return { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json" };
}
// Retry axios calls on transient failures (network drops, 5xx, 429).
async function withRetry(label, fn, tries = 5) {
    let lastErr;
    for (let attempt = 1; attempt <= tries; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            const status = err?.response?.status;
            const transient = err?.code === "ECONNRESET" ||
                err?.code === "ETIMEDOUT" ||
                err?.code === "ECONNABORTED" ||
                err?.code === "EPIPE" ||
                err?.code === "ENOTFOUND" ||
                err?.code === "EAI_AGAIN" ||
                err?.code === "ENETUNREACH" ||
                err?.code === "ECONNREFUSED" ||
                status === 429 ||
                (typeof status === "number" && status >= 500);
            lastErr = err;
            if (!transient || attempt === tries)
                throw err;
            const backoffMs = Math.min(30_000, 1000 * Math.pow(2, attempt - 1));
            logger_1.logger.warn("c1_retry", { label, attempt, code: err?.code, status, backoffMs });
            await new Promise((r) => setTimeout(r, backoffMs));
        }
    }
    throw lastErr;
}
let importInFlight = null;
// Import all CLOSED campaigns from ConductorOne and compute per-campaign historical records.
// Resumable: each campaign is persisted to disk as it finishes, so a failed run can
// be resumed by calling importHistory again (it skips already-imported campaign ids).
// Pass { fresh: true } to wipe state and start over.
async function importHistory(actor, opts = {}) {
    if (importInFlight) {
        logger_1.logger.info("history_import_already_running");
        return importInFlight;
    }
    importInFlight = doImport(actor, opts).finally(() => {
        importInFlight = null;
    });
    return importInFlight;
}
async function doImport(actor, opts = {}) {
    (0, jobs_1.start)("history_import", `triggered by ${actor}${opts.fresh ? " (fresh)" : ""}`);
    const base = `${config_1.config.conductor1.baseUrl}/api/v1`;
    logger_1.logger.info("history_import_start");
    // Gather all access reviews (closed only).
    const all = [];
    let pageToken;
    do {
        const r = await withRetry("access_reviews", async () => {
            const token = await getToken();
            return axios_1.default.get(`${base}/access_reviews`, {
                params: { page_size: 100, page_token: pageToken },
                headers: { Authorization: `Bearer ${token}` },
                timeout: 45_000,
            });
        });
        all.push(...(r.data.list ?? []));
        pageToken = r.data.nextPageToken || undefined;
    } while (pageToken);
    const closed = all.filter((x) => x.accessReview?.state === "ACCESS_REVIEW_STATE_CLOSED");
    logger_1.logger.info("history_campaigns_filtered", { closed: closed.length });
    // Load any prior state so we can resume.
    const prior = opts.fresh ? { campaigns: [] } : await loadHist();
    const out = [...prior.campaigns];
    const doneIds = new Set(out.map((c) => c.id));
    if (doneIds.size > 0) {
        logger_1.logger.info("history_import_resume", {
            alreadyImported: doneIds.size,
            remaining: closed.length - closed.filter((x) => doneIds.has(x.accessReview.id)).length,
        });
    }
    const userCache = new Map(); // id -> email (lower)
    const startMs = Date.now();
    async function resolveEmail(id) {
        if (userCache.has(id))
            return userCache.get(id);
        try {
            const u = await withRetry(`user:${id}`, async () => {
                const token = await getToken();
                return axios_1.default.get(`${base}/users/${encodeURIComponent(id)}`, {
                    headers: { Authorization: `Bearer ${token}` },
                    timeout: 30_000,
                });
            });
            const email = (u.data?.userView?.user?.email ?? "").toLowerCase();
            userCache.set(id, email);
            return email || undefined;
        }
        catch {
            userCache.set(id, "");
            return undefined;
        }
    }
    let done = doneIds.size;
    let failed = 0;
    let processedThisRun = 0;
    for (const raw of closed) {
        const ar = raw.accessReview;
        const id = ar.id;
        if (doneIds.has(id))
            continue; // already imported in a prior run
        const campaignStartMs = Date.now();
        try {
            const deadline = ar.completionDate ?? ar.closedAt;
            const deadlineMs = deadline ? new Date(deadline).getTime() : null;
            // Fetch every task in this campaign — no cap.
            const tasks = [];
            let tPageToken;
            let pageIdx = 0;
            do {
                const r = await withRetry(`tasks:${id}:page${pageIdx}`, async () => {
                    const token = await getToken();
                    return axios_1.default.post(`${base}/search/tasks`, { accessReviewIds: [id], pageSize: 100, pageToken: tPageToken }, {
                        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                        timeout: 60_000,
                    });
                });
                tasks.push(...(r.data.list ?? []));
                tPageToken = r.data.nextPageToken || undefined;
                pageIdx++;
            } while (tPageToken);
            const reviewerAgg = new Map();
            let completedTotal = 0;
            let onTimeTotal = 0;
            for (const tRaw of tasks) {
                const t = tRaw.task ?? tRaw;
                const reviewerId = (Array.isArray(t.approverIds) ? t.approverIds[0] : undefined) ??
                    (Array.isArray(t.stepApproverIds) ? t.stepApproverIds[0] : undefined);
                if (!reviewerId)
                    continue;
                const state = (t.state ?? "").toString().toUpperCase();
                const isClosed = state.includes("CLOSED") || !!t.closedAt;
                const completedAt = t.closedAt ?? t.updatedAt;
                const completedMs = completedAt ? new Date(completedAt).getTime() : null;
                const wasOnTime = isClosed && deadlineMs != null && completedMs != null && completedMs <= deadlineMs;
                const email = await resolveEmail(reviewerId);
                if (!email)
                    continue;
                const agg = reviewerAgg.get(email) ?? { assigned: 0, completed: 0, onTime: 0 };
                agg.assigned++;
                if (isClosed) {
                    agg.completed++;
                    completedTotal++;
                    if (wasOnTime) {
                        agg.onTime++;
                        onTimeTotal++;
                    }
                }
                reviewerAgg.set(email, agg);
            }
            out.push({
                id: String(id),
                name: String(ar.displayName ?? `Campaign ${id}`),
                type: "access_certification",
                openedAt: ar.startedAt ?? ar.createdAt,
                closedAt: ar.closedAt,
                deadline: ar.completionDate,
                totalReviews: tasks.length,
                completedReviews: completedTotal,
                onTimeReviews: onTimeTotal,
                reviewerCompletion: [...reviewerAgg].map(([email, a]) => ({ email, ...a })),
            });
            doneIds.add(id);
            done++;
            processedThisRun++;
            // Persist after every campaign so a crash doesn't lose progress.
            await (0, storage_1.writeJson)(HIST_KEY, { campaigns: out, lastImportedAt: new Date().toISOString() });
            const elapsedMs = Date.now() - startMs;
            const avgMsPerCampaign = elapsedMs / Math.max(1, processedThisRun);
            const remaining = closed.length - done;
            const remainingMs = remaining * avgMsPerCampaign;
            logger_1.logger.info("history_import_progress", {
                done,
                total: closed.length,
                processedThisRun,
                failed,
                pct: Math.round((done / closed.length) * 100),
                lastCampaign: ar.displayName,
                lastTasks: tasks.length,
                lastMs: Date.now() - campaignStartMs,
                etaMin: Math.round(remainingMs / 60000),
            });
        }
        catch (err) {
            failed++;
            logger_1.logger.warn("history_import_campaign_failed", {
                campaignId: id,
                campaignName: ar.displayName,
                err: err?.message,
            });
            // Don't mark as done — leave it un-imported so a future retry will pick it up.
        }
    }
    const state = { campaigns: out, lastImportedAt: new Date().toISOString() };
    await (0, storage_1.writeJson)(HIST_KEY, state);
    await (0, audit_1.audit)({
        actor,
        action: "history.import",
        details: { campaigns: out.length, processedThisRun, failed },
    });
    // Also compute scorecards now.
    await computeScorecards(state);
    logger_1.logger.info("history_import_done", { campaigns: out.length });
    (0, jobs_1.finish)("history_import", {
        ok: true,
        message: `${out.length} campaigns (${processedThisRun} new this run, ${failed} failed)`,
        details: { campaigns: out.length, processedThisRun, failed },
    });
    return state;
}
async function getHistory() {
    return loadHist();
}
async function computeScorecards(state) {
    (0, jobs_1.start)("scorecards_recompute");
    const hist = state ?? (await loadHist());
    const perPerson = new Map();
    for (const c of hist.campaigns) {
        for (const r of c.reviewerCompletion) {
            const agg = perPerson.get(r.email) ?? { assigned: 0, completed: 0, onTime: 0, campaigns: new Set() };
            agg.assigned += r.assigned;
            agg.completed += r.completed;
            agg.onTime += r.onTime;
            agg.campaigns.add(c.id);
            perPerson.set(r.email, agg);
        }
    }
    // Build an org tree across all the managers we know about so we can also
    // roll up "team on-time" per manager (includes their full downstream).
    const tree = await (0, orgTree_1.buildOrgTreeForEmails)([...perPerson.keys()]);
    const rows = [];
    for (const [email, agg] of perPerson) {
        const user = tree.byEmail[email];
        const down = user ? (0, orgTree_1.downstreamReports)(tree, email) : [];
        let teamAssigned = 0, teamCompleted = 0, teamOnTime = 0;
        for (const d of down) {
            const stats = perPerson.get(d.email);
            if (!stats)
                continue;
            teamAssigned += stats.assigned;
            teamCompleted += stats.completed;
            teamOnTime += stats.onTime;
        }
        rows.push({
            managerEmail: email,
            managerName: user?.displayName ?? email,
            campaignsParticipated: agg.campaigns.size,
            totalAssigned: agg.assigned,
            totalCompleted: agg.completed,
            totalOnTime: agg.onTime,
            onTimePct: agg.assigned ? Math.round((agg.onTime / agg.assigned) * 100) : 0,
            completedPct: agg.assigned ? Math.round((agg.completed / agg.assigned) * 100) : 0,
            teamOnTimePct: teamAssigned ? Math.round((teamOnTime / teamAssigned) * 100) : 0,
            teamCompletedPct: teamAssigned ? Math.round((teamCompleted / teamAssigned) * 100) : 0,
        });
    }
    rows.sort((a, b) => a.onTimePct - b.onTimePct);
    await (0, storage_1.writeJson)(SCORE_KEY, { rows, updatedAt: new Date().toISOString() });
    (0, jobs_1.finish)("scorecards_recompute", { ok: true, message: `${rows.length} rows` });
    return rows;
}
async function getScorecards() {
    const s = await (0, storage_1.readJson)(SCORE_KEY, null);
    return s?.rows ?? [];
}
// Build the scorecards as a tree rooted at the CEO. Each node has the person's
// own scorecard stats plus a team rollup that recursively aggregates everyone
// in the subtree. People with no scorecard rows still appear as nodes (zero stats)
// so the hierarchy is intact.
async function getScorecardTree(viewerEmail) {
    const rows = await getScorecards();
    if (rows.length === 0)
        return { fetchedAt: new Date().toISOString(), root: null };
    // Need an org tree that includes everyone with scorecard data + CEO + viewer.
    const seeds = new Set([
        ...rows.map((r) => r.managerEmail),
        (await Promise.resolve().then(() => __importStar(require("../config")))).config.orgTop.ceoEmail,
        viewerEmail,
    ]);
    // Also seed downstream of CEO so we cover the whole company even if some
    // managers never reviewed.
    const { config } = await Promise.resolve().then(() => __importStar(require("../config")));
    const { getUserByEmail, getDownstreamReports } = await Promise.resolve().then(() => __importStar(require("./graph")));
    try {
        const ceo = await getUserByEmail(config.orgTop.ceoEmail);
        if (ceo) {
            const down = await getDownstreamReports(ceo.id);
            for (const d of down)
                if (d.mail)
                    seeds.add(d.mail.toLowerCase());
        }
    }
    catch {
        // best-effort
    }
    const { buildOrgTreeForEmails } = await Promise.resolve().then(() => __importStar(require("./orgTree")));
    const tree = await buildOrgTreeForEmails([...seeds]);
    const rowsByEmail = new Map(rows.map((r) => [r.managerEmail, r]));
    const ceoEmail = config.orgTop.ceoEmail.toLowerCase();
    const visited = new Set();
    function buildNode(email) {
        if (visited.has(email))
            return null;
        visited.add(email);
        const u = tree.byEmail[email];
        if (!u)
            return null;
        const own = rowsByEmail.get(email);
        const children = u.directReportEmails
            .map(buildNode)
            .filter((c) => c !== null);
        let teamAssigned = own?.totalAssigned ?? 0;
        let teamCompleted = own?.totalCompleted ?? 0;
        let teamOnTime = own?.totalOnTime ?? 0;
        for (const c of children) {
            teamAssigned += c.teamAssigned;
            teamCompleted += c.teamCompleted;
            teamOnTime += c.teamOnTime;
        }
        return {
            email: u.email,
            displayName: u.displayName,
            isCEO: u.email === ceoEmail,
            isSelf: u.email === viewerEmail.toLowerCase(),
            hasOwnData: !!own,
            campaignsParticipated: own?.campaignsParticipated ?? 0,
            totalAssigned: own?.totalAssigned ?? 0,
            totalCompleted: own?.totalCompleted ?? 0,
            totalOnTime: own?.totalOnTime ?? 0,
            onTimePct: own?.onTimePct ?? 0,
            completedPct: own?.completedPct ?? 0,
            teamAssigned,
            teamCompleted,
            teamOnTime,
            teamCompletedPct: teamAssigned ? Math.round((teamCompleted / teamAssigned) * 100) : 0,
            teamOnTimePct: teamAssigned ? Math.round((teamOnTime / teamAssigned) * 100) : 0,
            children: children.sort((a, b) => b.teamAssigned - a.teamAssigned),
        };
    }
    return { fetchedAt: new Date().toISOString(), root: buildNode(ceoEmail) };
}
async function diagScorecardTree(viewerEmail) {
    const rows = await getScorecards();
    const scoreFile = await (0, storage_1.readJson)(SCORE_KEY, null);
    const hist = await loadHist();
    const { config } = await Promise.resolve().then(() => __importStar(require("../config")));
    const ceoEmail = config.orgTop.ceoEmail.toLowerCase();
    const { getUserByEmail, getDownstreamReports } = await Promise.resolve().then(() => __importStar(require("./graph")));
    let ceoFoundInGraph = false;
    let ceoDownstreamCount = 0;
    const seeds = new Set([
        ...rows.map((r) => r.managerEmail),
        ceoEmail,
        viewerEmail.toLowerCase(),
    ]);
    try {
        const ceo = await getUserByEmail(ceoEmail);
        if (ceo) {
            ceoFoundInGraph = true;
            const down = await getDownstreamReports(ceo.id);
            ceoDownstreamCount = down.length;
            for (const d of down)
                if (d.mail)
                    seeds.add(d.mail.toLowerCase());
        }
    }
    catch {
        // best-effort
    }
    const { buildOrgTreeForEmails } = await Promise.resolve().then(() => __importStar(require("./orgTree")));
    const tree = await buildOrgTreeForEmails([...seeds]);
    const treeSize = Object.keys(tree.byEmail).length;
    const ceoInTree = !!tree.byEmail[ceoEmail];
    const viewerInTree = !!tree.byEmail[viewerEmail.toLowerCase()];
    const missing = [];
    for (const r of rows) {
        if (!tree.byEmail[r.managerEmail])
            missing.push(r.managerEmail);
    }
    return {
        rows: rows.length,
        scorecardsUpdatedAt: scoreFile?.updatedAt ?? null,
        historyCampaigns: hist.campaigns.length,
        ceoEmail,
        ceoFoundInGraph,
        ceoDownstreamCount,
        treeSize,
        ceoInTree,
        viewerEmail: viewerEmail.toLowerCase(),
        viewerInTree,
        rowsMissingFromTree: missing.length,
        sampleMissingRows: missing.slice(0, 10),
        rootBuilt: ceoInTree, // tree builder returns null if CEO isn't in the tree
    };
}
//# sourceMappingURL=scorecards.js.map