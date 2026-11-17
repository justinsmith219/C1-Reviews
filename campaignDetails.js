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
exports.getCampaignDetails = getCampaignDetails;
exports.clearCampaignDetailsCache = clearCampaignDetailsCache;
exports.hasFreshDiskCache = hasFreshDiskCache;
exports.clearCampaignDetailsDisk = clearCampaignDetailsDisk;
const axios_1 = __importDefault(require("axios"));
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const config_1 = require("../config");
const logger_1 = require("../logger");
const audit_1 = require("./audit");
const jobs_1 = require("./jobs");
const ACTIVE_DISK_TTL_MS = 60 * 60 * 1000; // 1h — re-trigger report after this
function diskPath(campaignId) {
    return path_1.default.join(config_1.config.paths.data, "campaign-tasks", `${campaignId}.json`);
}
function rawPath(campaignId) {
    return path_1.default.join(config_1.config.paths.data, "campaign-tasks-raw", `${campaignId}.json`);
}
// Best-effort campaign name lookup for nicer job-panel labels.
async function campaignNameFor(campaignId) {
    try {
        const { getHistory } = await Promise.resolve().then(() => __importStar(require("./scorecards")));
        const hist = await getHistory();
        const h = hist.campaigns.find((c) => c.id === campaignId);
        if (h)
            return h.name;
        const { getSnapshot } = await Promise.resolve().then(() => __importStar(require("./campaignStore")));
        const snap = await getSnapshot();
        const c = snap?.campaigns.find((c) => c.id === campaignId);
        return c?.name ?? null;
    }
    catch {
        return null;
    }
}
// Returns { startDate, endDate } ISO strings (YYYY-MM-DD) for the campaign.
async function campaignDates(campaignId) {
    try {
        const { getHistory } = await Promise.resolve().then(() => __importStar(require("./scorecards")));
        const hist = await getHistory();
        const h = hist.campaigns.find((c) => c.id === campaignId);
        if (h)
            return { startDate: h.openedAt?.slice(0, 10), endDate: (h.closedAt ?? h.deadline)?.slice(0, 10) };
        const { getSnapshot } = await Promise.resolve().then(() => __importStar(require("./campaignStore")));
        const snap = await getSnapshot();
        const c = snap?.campaigns.find((c) => c.id === campaignId);
        if (c)
            return { startDate: c.startDate?.slice(0, 10), endDate: c.endDate?.slice(0, 10) };
    }
    catch { }
    return {};
}
// Whether the campaign is closed. Closed campaigns are immutable so we cache
// their aggregated stats forever once successfully fetched.
async function isClosedCampaign(campaignId) {
    try {
        const { getHistory } = await Promise.resolve().then(() => __importStar(require("./scorecards")));
        const hist = await getHistory();
        if (hist.campaigns.some((c) => c.id === campaignId))
            return true;
        const { getSnapshot } = await Promise.resolve().then(() => __importStar(require("./campaignStore")));
        const snap = await getSnapshot();
        const camp = snap?.campaigns.find((c) => c.id === campaignId);
        if (camp && camp.status !== "open")
            return true;
    }
    catch { }
    return false;
}
async function loadDisk(campaignId) {
    try {
        const raw = await promises_1.default.readFile(diskPath(campaignId), "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed.data?.reviewerTimeline || typeof parsed.data.reviewerTimeline !== "object") {
            logger_1.logger.info("campaign_details_disk_stale_format", { campaignId });
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
}
async function isActiveDiskStale(campaignId, at) {
    if (await isClosedCampaign(campaignId))
        return false;
    return Date.now() - at >= ACTIVE_DISK_TTL_MS;
}
async function saveDisk(campaignId, data) {
    const dir = path_1.default.dirname(diskPath(campaignId));
    await promises_1.default.mkdir(dir, { recursive: true });
    const tmp = diskPath(campaignId) + ".tmp";
    await promises_1.default.writeFile(tmp, JSON.stringify({ at: Date.now(), data }), "utf8");
    await promises_1.default.rename(tmp, diskPath(campaignId));
}
const CACHE_TTL_MS = 15 * 60_000;
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
    tokenCache = { value: r.data.access_token, expiresAt: now + (r.data.expires_in ?? 600) * 1000 };
    return tokenCache.value;
}
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
            if (!transient || attempt === tries) {
                if (err?.response?.data) {
                    logger_1.logger.warn("c1_request_failed", {
                        label,
                        status,
                        body: typeof err.response.data === "object"
                            ? JSON.stringify(err.response.data).slice(0, 500)
                            : String(err.response.data).slice(0, 500),
                    });
                }
                throw err;
            }
            const backoffMs = Math.min(30_000, 1000 * Math.pow(2, attempt - 1));
            logger_1.logger.warn("c1_retry", { label, attempt, code: err?.code, status, backoffMs });
            await new Promise((r) => setTimeout(r, backoffMs));
        }
    }
    throw lastErr;
}
const states = new Map();
async function getCampaignDetails(campaignId, opts = {}) {
    const now = Date.now();
    let cur = states.get(campaignId);
    if (!opts.force && (!cur || cur.kind === "failed")) {
        const fromDisk = await loadDisk(campaignId);
        if (fromDisk) {
            states.set(campaignId, {
                kind: "ready",
                cachedAt: fromDisk.at,
                data: fromDisk.data,
                ms: 0,
            });
            cur = states.get(campaignId);
            logger_1.logger.info("campaign_details_disk_hit", { campaignId, ageMs: now - fromDisk.at });
        }
    }
    if (!opts.force && cur) {
        if (cur.kind === "ready") {
            if (await isActiveDiskStale(campaignId, cur.cachedAt)) {
                kickBackgroundRefresh(campaignId, opts.actor).catch(() => { });
            }
            return { status: "ready", cachedAt: cur.cachedAt, data: cur.data, ms: cur.ms };
        }
        if (cur.kind === "fetching") {
            return {
                status: "fetching",
                startedAt: cur.startedAt,
                pages: cur.pages,
                tasks: cur.tasks,
            };
        }
    }
    const startedAt = await launchFetch(campaignId, opts.actor);
    return { status: "fetching", startedAt, pages: 0, tasks: 0 };
}
async function launchFetch(campaignId, actor) {
    const cur = states.get(campaignId);
    if (cur?.kind === "fetching")
        return cur.startedAt;
    const startedAt = Date.now();
    states.set(campaignId, { kind: "fetching", startedAt, pages: 0, tasks: 0 });
    await beginFetch(campaignId, actor, startedAt, false);
    return startedAt;
}
async function kickBackgroundRefresh(campaignId, actor) {
    if (backgroundRefreshing.has(campaignId))
        return;
    const cur = states.get(campaignId);
    if (cur?.kind === "fetching")
        return;
    backgroundRefreshing.add(campaignId);
    const startedAt = Date.now();
    await beginFetch(campaignId, actor ?? "system:stale-revalidate", startedAt, true);
}
const backgroundRefreshing = new Set();
async function beginFetch(campaignId, actor, startedAt, preserveReady) {
    logger_1.logger.info("campaign_details_fetch_start", { campaignId, via: "report_api", bg: preserveReady });
    const jobId = `campaign_details:${campaignId}`;
    const campaignName = await campaignNameFor(campaignId);
    (0, jobs_1.register)({
        id: jobId,
        name: `Task fetch: ${campaignName ?? campaignId}`,
        kind: "on-demand",
    });
    (0, jobs_1.start)(jobId, `triggered by ${actor ?? "system"}`);
    fetchAndAggregate(campaignId, (pages, tasks) => {
        if (!preserveReady) {
            const s = states.get(campaignId);
            if (s?.kind === "fetching") {
                s.pages = pages;
                s.tasks = tasks;
            }
        }
        (0, jobs_1.update)(jobId, { details: { pages, tasks } });
    })
        .then(async (data) => {
        const ms = Date.now() - startedAt;
        states.set(campaignId, { kind: "ready", cachedAt: Date.now(), data, ms });
        try {
            await saveDisk(campaignId, data);
        }
        catch (err) {
            logger_1.logger.warn("campaign_details_disk_save_failed", { campaignId, err: err?.message });
        }
        await (0, audit_1.audit)({
            actor: actor ?? "system",
            action: "campaign_details.fetch",
            target: campaignId,
            details: { total: data.totalFetched, ms, bg: preserveReady },
        });
        logger_1.logger.info("campaign_details_fetch_done", {
            campaignId,
            tasks: data.totalFetched,
            ms,
        });
        (0, jobs_1.finish)(jobId, {
            ok: true,
            message: `${data.totalFetched.toLocaleString()} tasks`,
            details: { tasks: data.totalFetched, ms },
        });
    })
        .catch((err) => {
        if (!preserveReady) {
            states.set(campaignId, {
                kind: "failed",
                failedAt: Date.now(),
                err: err?.message ?? "fetch failed",
            });
        }
        logger_1.logger.error("campaign_details_fetch_failed", {
            campaignId,
            bg: preserveReady,
            err: err?.message,
        });
        (0, jobs_1.finish)(jobId, { ok: false, message: err?.message ?? "fetch failed" });
    })
        .finally(() => {
        backgroundRefreshing.delete(campaignId);
    });
}
async function fetchAndAggregate(campaignId, onProgress) {
    const base = `${config_1.config.conductor1.baseUrl}/api/v1`;
    const fetchStart = Date.now();
    // Load snapshot once for reviewer identity resolution (name → email lookup).
    const reviewerByEmail = new Map();
    const reviewerByName = new Map();
    try {
        const { getSnapshot } = await Promise.resolve().then(() => __importStar(require("./campaignStore")));
        const snap = await getSnapshot();
        for (const r of snap?.reviewers ?? []) {
            const e = r.email.toLowerCase();
            const entry = { email: e, displayName: r.displayName ?? r.email };
            reviewerByEmail.set(e, entry);
            if (r.displayName)
                reviewerByName.set(r.displayName.toLowerCase(), entry);
        }
    }
    catch { }
    // Resolve a raw "Assigned to" value to a stable key, email, and display name.
    // C1 returns values in "Last, First (email@domain.com)" format.
    function resolveReviewer(raw) {
        const v = raw.trim();
        if (!v)
            return { key: "", email: "", displayName: "" };
        // Extract email from "Display Name (email@domain.com)" format.
        const parenMatch = v.match(/^(.*?)\s*\(([^)]+@[^)]+)\)\s*$/);
        if (parenMatch) {
            const displayName = parenMatch[1].trim();
            const email = parenMatch[2].trim().toLowerCase();
            const fromSnap = reviewerByEmail.get(email);
            return {
                key: email,
                email,
                displayName: fromSnap?.displayName ?? displayName,
            };
        }
        // Plain email with no display name.
        if (v.includes("@") && !v.includes(" ")) {
            const e = v.toLowerCase();
            const fromSnap = reviewerByEmail.get(e);
            return { key: e, email: e, displayName: fromSnap?.displayName ?? v };
        }
        // Display name only — look up in snapshot.
        const fromSnap = reviewerByName.get(v.toLowerCase());
        if (fromSnap)
            return { key: fromSnap.email, email: fromSnap.email, displayName: fromSnap.displayName };
        return { key: v, email: "", displayName: v };
    }
    // Step 1: Trigger report generation.
    onProgress?.(0, 0);
    await withRetry(`report_trigger:${campaignId}`, async () => {
        const token = await getToken();
        return axios_1.default.post(`${base}/access_review/${encodeURIComponent(campaignId)}/report`, {
            format: "ACCESS_REVIEW_REPORT_FORMAT_JSON",
            reportColumnConfig: {
                columns: [
                    "ACCESS_REVIEW_REPORT_COLUMN_TASK",
                    "ACCESS_REVIEW_REPORT_COLUMN_ACCOUNT",
                    "ACCESS_REVIEW_REPORT_COLUMN_USER_NAME",
                    "ACCESS_REVIEW_REPORT_COLUMN_APPLICATION",
                    "ACCESS_REVIEW_REPORT_COLUMN_ENTITLEMENT",
                    "ACCESS_REVIEW_REPORT_COLUMN_ASSIGNED_TO",
                    "ACCESS_REVIEW_REPORT_COLUMN_CERTIFIERS",
                    "ACCESS_REVIEW_REPORT_COLUMN_DECISIONS",
                    "ACCESS_REVIEW_REPORT_COLUMN_RESOLVED_ON",
                ],
            },
        }, {
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            timeout: 30_000,
        });
    });
    logger_1.logger.info("campaign_details_report_triggered", { campaignId });
    // Step 2: Poll until REPORT_STATE_OK (20 min timeout, 4 s intervals).
    const POLL_INTERVAL_MS = 4_000;
    const POLL_TIMEOUT_MS = 20 * 60_000;
    const pollDeadline = Date.now() + POLL_TIMEOUT_MS;
    let downloadUrl = null;
    let pollAttempt = 0;
    while (Date.now() < pollDeadline) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        pollAttempt++;
        onProgress?.(pollAttempt, 0);
        const r = await withRetry(`report_poll:${campaignId}`, async () => {
            const token = await getToken();
            // page_size=1: results are newest-first, so list[0] is always the report we just triggered.
            return axios_1.default.get(`${base}/access_review/${encodeURIComponent(campaignId)}/report?page_size=1`, { headers: { Authorization: `Bearer ${token}` }, timeout: 30_000 });
        });
        const latest = r.data?.list?.[0];
        if (!latest) {
            logger_1.logger.debug("campaign_details_report_not_visible_yet", { campaignId, pollAttempt });
            continue;
        }
        if (latest.state === "REPORT_STATE_OK") {
            // downloadUrl is a relative path (e.g. /file/<token>) — resolve against base host.
            const relPath = latest.downloadUrl ?? latest.download_url ?? "";
            downloadUrl = relPath ? `${config_1.config.conductor1.baseUrl}${relPath}` : null;
            logger_1.logger.info("campaign_details_report_ready", { campaignId, pollAttempt });
            break;
        }
        if (latest.state === "REPORT_STATE_ERROR" || latest.state === "REPORT_STATE_FAILED") {
            throw new Error(`Report generation failed for campaign ${campaignId}: ${latest.state}`);
        }
        logger_1.logger.debug("campaign_details_report_pending", { campaignId, pollAttempt, state: latest.state });
    }
    if (!downloadUrl) {
        throw new Error(`Report generation timed out for campaign ${campaignId} after ${POLL_TIMEOUT_MS / 1000}s`);
    }
    // Step 3: Download report JSON. Signed URL — no Authorization header needed.
    const reportResp = await withRetry(`report_download:${campaignId}`, async () => {
        return axios_1.default.get(downloadUrl, { timeout: 120_000 });
    });
    const rows = reportResp.data?.rows ?? [];
    onProgress?.(pollAttempt + 1, rows.length);
    logger_1.logger.info("campaign_details_report_downloaded", {
        campaignId, rows: rows.length, elapsedMs: Date.now() - fetchStart,
    });
    // Step 4: Aggregate rows.
    const reviewerAgg = new Map();
    const appAgg = new Map();
    const recent = [];
    let totalApproved = 0, totalRevoked = 0, totalSkipped = 0, totalPending = 0, totalCancelled = 0;
    for (const row of rows) {
        const resolvedOn = (row["Resolved On"] ?? "").trim();
        const appName = (row["Application"] ?? "").trim();
        const assignedTo = (row["Assigned to"] ?? row["Assigned To"] ?? "").trim();
        const entitlement = (row["Entitlement"] ?? "").trim();
        const subjectEmail = (row["Subject"] ?? row["Account"] ?? "").trim();
        const decisionRaw = (row["Decisions"] ?? "").trim();
        const taskUrl = (row["Task"] ?? "").trim();
        const taskId = taskUrl ? taskUrl.split("/").pop() ?? "" : "";
        const d = decisionRaw.toUpperCase();
        let kind;
        if (!decisionRaw || d === "PENDING")
            kind = "pending";
        else if (d.includes("CERTIF") || d.includes("APPROV") || d.includes("GRANT"))
            kind = "approved";
        else if (d.includes("REVOK") || d.includes("DENI"))
            kind = "revoked";
        else if (d.includes("CANCEL"))
            kind = "cancelled";
        else if (d.includes("SKIP"))
            kind = "skipped";
        else if (resolvedOn)
            kind = "approved";
        else
            kind = "pending";
        if (kind === "approved")
            totalApproved++;
        else if (kind === "revoked")
            totalRevoked++;
        else if (kind === "skipped")
            totalSkipped++;
        else if (kind === "cancelled")
            totalCancelled++;
        else
            totalPending++;
        const rev = resolveReviewer(assignedTo);
        if (rev.key) {
            const existing = reviewerAgg.get(rev.key) ?? {
                approved: 0, revoked: 0, skipped: 0, pending: 0, cancelled: 0,
                displayName: rev.displayName, email: rev.email,
            };
            existing[kind]++;
            reviewerAgg.set(rev.key, existing);
        }
        if (appName) {
            const existing = appAgg.get(appName) ?? { approved: 0, revoked: 0, skipped: 0, pending: 0, cancelled: 0 };
            existing[kind]++;
            appAgg.set(appName, existing);
        }
        if (resolvedOn && kind !== "pending") {
            const closedMs = new Date(resolvedOn).getTime();
            if (Number.isFinite(closedMs)) {
                recent.push({
                    closedAtIso: resolvedOn,
                    closedMs,
                    reviewerKey: rev.key,
                    reviewerEmail: rev.email,
                    reviewerName: rev.displayName,
                    subjectEmail,
                    appName,
                    entitlement,
                    decision: decisionRaw,
                    taskId,
                });
            }
        }
    }
    recent.sort((a, b) => b.closedMs - a.closedMs);
    // Per-reviewer completion timeline (keyed by email when available, else raw key).
    const reviewerTimeline = {};
    for (const r of recent) {
        const timelineKey = r.reviewerEmail || r.reviewerKey;
        if (!timelineKey)
            continue;
        const list = reviewerTimeline[timelineKey] ?? (reviewerTimeline[timelineKey] = []);
        list.push(r.closedAtIso);
    }
    for (const list of Object.values(reviewerTimeline))
        list.sort();
    // Recent activity (top 50).
    const recentActivity = recent.slice(0, 50).map((r) => {
        const d = r.decision.toUpperCase();
        let outcome = "approved";
        if (d.includes("CANCEL"))
            outcome = "cancelled";
        else if (d.includes("REVOK") || d.includes("DENI"))
            outcome = "revoked";
        else if (d.includes("SKIP"))
            outcome = "skipped";
        return {
            taskId: r.taskId,
            closedAt: r.closedAtIso,
            reviewerEmail: r.reviewerEmail || undefined,
            reviewerName: r.reviewerName || undefined,
            subjectUserId: r.subjectEmail || undefined,
            outcome,
            appName: r.appName || undefined,
            entitlement: r.entitlement || undefined,
        };
    });
    // Trend reconstruction.
    const totalCount = rows.length;
    const completedByDay = new Map();
    for (const r of recent) {
        const day = new Date(r.closedMs).toISOString().slice(0, 10);
        completedByDay.set(day, (completedByDay.get(day) ?? 0) + 1);
    }
    const reviewerMeta = new Map();
    for (const [key, agg] of reviewerAgg) {
        const timelineKey = agg.email || key;
        const dates = (reviewerTimeline[timelineKey] ?? []).map((ts) => ts.slice(0, 10));
        dates.sort();
        reviewerMeta.set(key, {
            email: agg.email || key,
            displayName: agg.displayName,
            decisionDates: dates,
            allDone: agg.pending === 0,
            lastDecisionDate: dates.length > 0 ? dates[dates.length - 1] : undefined,
        });
    }
    const { startDate, endDate } = await campaignDates(campaignId);
    const todayIso = new Date().toISOString().slice(0, 10);
    const rangeStart = startDate ?? ([...completedByDay.keys()].sort()[0] ?? todayIso);
    const rangeEnd = endDate && endDate < todayIso ? endDate : todayIso;
    function addDays(iso, n) {
        const d = new Date(iso + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().slice(0, 10);
    }
    const allDays = [];
    for (let d = rangeStart; d <= rangeEnd; d = addDays(d, 1))
        allDays.push(d);
    const days = allDays.length > 0 ? allDays : [...completedByDay.keys()].sort();
    let cumulativeCompleted = 0;
    const trendByDay = days.map((day) => {
        const c = completedByDay.get(day) ?? 0;
        cumulativeCompleted += c;
        const completedNames = [];
        const inProgressNames = [];
        const notStartedNames = [];
        for (const meta of reviewerMeta.values()) {
            const decisionsThisDay = meta.decisionDates.filter((d) => d <= day).length;
            const doneByThisDay = meta.allDone && !!meta.lastDecisionDate && meta.lastDecisionDate <= day;
            const person = { email: meta.email, displayName: meta.displayName };
            if (doneByThisDay)
                completedNames.push(person);
            else if (decisionsThisDay > 0)
                inProgressNames.push(person);
            else
                notStartedNames.push(person);
        }
        completedNames.sort((a, b) => a.displayName.localeCompare(b.displayName));
        inProgressNames.sort((a, b) => a.displayName.localeCompare(b.displayName));
        notStartedNames.sort((a, b) => a.displayName.localeCompare(b.displayName));
        return {
            date: day,
            completedThisDay: c,
            open: Math.max(0, totalCount - cumulativeCompleted),
            reviewersCompleted: completedNames.length,
            reviewersInProgress: inProgressNames.length,
            reviewersNotStarted: notStartedNames.length,
            completedNames,
            inProgressNames,
            notStartedNames,
        };
    });
    // byReviewer rows.
    const byReviewer = [...reviewerAgg].map(([key, agg]) => {
        const decided = agg.approved + agg.revoked + agg.skipped;
        return {
            reviewerId: key,
            email: agg.email,
            displayName: agg.displayName,
            approved: agg.approved,
            revoked: agg.revoked,
            skipped: agg.skipped,
            pending: agg.pending,
            totalAssigned: agg.approved + agg.revoked + agg.skipped + agg.pending + agg.cancelled,
            approvalRate: decided ? Math.round((agg.approved / decided) * 100) : 0,
        };
    });
    byReviewer.sort((a, b) => b.totalAssigned - a.totalAssigned);
    // byApp rows.
    const byApp = [...appAgg].map(([name, agg]) => {
        const decided = agg.approved + agg.revoked + agg.skipped;
        const total = agg.approved + agg.revoked + agg.skipped + agg.pending + agg.cancelled;
        return {
            appId: name,
            appName: name,
            approved: agg.approved,
            revoked: agg.revoked,
            skipped: agg.skipped,
            pending: agg.pending,
            total,
            approvalRate: decided ? Math.round((agg.approved / decided) * 100) : 0,
            percentComplete: total ? Math.round(((total - agg.pending) / total) * 100) : 0,
        };
    });
    byApp.sort((a, b) => b.total - a.total);
    const reviewersWithOpenTasks = byReviewer.filter((r) => r.pending > 0).length;
    const reviewersWithoutOpenTasks = byReviewer.length - reviewersWithOpenTasks;
    const completed = totalApproved + totalRevoked + totalSkipped + totalCancelled;
    return {
        campaignId,
        fetchedAt: new Date().toISOString(),
        totalFetched: totalCount,
        truncated: false,
        cap: 0,
        tiles: {
            total: totalCount,
            completed,
            pending: totalPending,
            approved: totalApproved,
            revoked: totalRevoked,
            skipped: totalSkipped,
            cancelled: totalCancelled,
            percentComplete: totalCount ? Math.round((completed / totalCount) * 100) : 0,
        },
        byReviewer,
        byApp,
        reviewerTimeline,
        recentActivity,
        trendByDay,
        reviewersWithOpenTasks,
        reviewersWithoutOpenTasks,
        avgReviewTimeDays: null, // report API does not expose task createdAt
    };
}
function clearCampaignDetailsCache() {
    states.clear();
}
async function hasFreshDiskCache(campaignId) {
    return (await loadDisk(campaignId)) !== null;
}
async function clearCampaignDetailsDisk() {
    states.clear();
    let aggregated = 0;
    let raw = 0;
    for (const [dirName, counter] of [
        ["campaign-tasks", "aggregated"],
        ["campaign-tasks-raw", "raw"],
    ]) {
        try {
            const dir = path_1.default.join(config_1.config.paths.data, dirName);
            const files = await promises_1.default.readdir(dir).catch(() => []);
            const targets = files.filter((f) => f.endsWith(".json"));
            await Promise.all(targets.map((f) => promises_1.default.unlink(path_1.default.join(dir, f)).catch(() => { })));
            if (counter === "aggregated")
                aggregated = targets.length;
            else
                raw = targets.length;
        }
        catch { }
    }
    return { aggregated, raw };
}
//# sourceMappingURL=campaignDetails.js.map