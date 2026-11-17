"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetConductorTokenCache = resetConductorTokenCache;
exports.fetchCampaignSnapshot = fetchCampaignSnapshot;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config");
const logger_1 = require("../logger");
let tokenCache = null;
function resetConductorTokenCache() {
    tokenCache = null;
    userCache.clear();
}
const userCache = new Map();
async function getUserById(id) {
    if (userCache.has(id))
        return userCache.get(id);
    try {
        const client = await api();
        const res = await client.get(`/users/${encodeURIComponent(id)}`);
        const u = res.data?.userView?.user ?? res.data?.user ?? res.data;
        if (!u?.id || !u?.email) {
            userCache.set(id, null);
            return null;
        }
        const reviewer = {
            id: String(u.id),
            email: String(u.email).toLowerCase(),
            displayName: String(u.displayName ?? u.email),
        };
        userCache.set(id, reviewer);
        return reviewer;
    }
    catch (err) {
        logger_1.logger.warn("c1_user_lookup_failed", { id, err: err?.message });
        userCache.set(id, null);
        return null;
    }
}
async function resolveUsersConcurrent(ids, concurrency = 8) {
    const result = new Map();
    const queue = [...new Set(ids.filter(Boolean))];
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (queue.length) {
            const id = queue.shift();
            const u = await getUserById(id);
            if (u)
                result.set(id, u);
        }
    });
    await Promise.all(workers);
    return result;
}
// Entitlement name lookup. ConductorOne stores entitlements per app, so the
// id alone isn't enough — we need (appId, appEntitlementId). Cache the result
// for the lifetime of the process.
const entitlementCache = new Map();
function entitlementCacheKey(appId, appEntitlementId) {
    return `${appId}::${appEntitlementId}`;
}
async function getEntitlementName(appId, appEntitlementId) {
    if (!appId || !appEntitlementId)
        return null;
    const key = entitlementCacheKey(appId, appEntitlementId);
    if (entitlementCache.has(key))
        return entitlementCache.get(key);
    try {
        const client = await api();
        const res = await client.get(`/apps/${encodeURIComponent(appId)}/entitlements/${encodeURIComponent(appEntitlementId)}`);
        const name = res.data?.appEntitlementView?.appEntitlement?.displayName ??
            res.data?.appEntitlement?.displayName ??
            res.data?.displayName ??
            null;
        entitlementCache.set(key, name);
        return name;
    }
    catch (err) {
        logger_1.logger.debug("c1_entitlement_lookup_failed", { appId, appEntitlementId, err: err?.message });
        entitlementCache.set(key, null);
        return null;
    }
}
async function resolveEntitlementsConcurrent(pairs, concurrency = 8) {
    const out = new Map();
    const seen = new Set();
    const queue = pairs.filter((p) => {
        if (!p.appId || !p.appEntitlementId)
            return false;
        const k = entitlementCacheKey(p.appId, p.appEntitlementId);
        if (seen.has(k))
            return false;
        seen.add(k);
        return true;
    });
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (queue.length) {
            const p = queue.shift();
            const name = await getEntitlementName(p.appId, p.appEntitlementId);
            if (name)
                out.set(entitlementCacheKey(p.appId, p.appEntitlementId), name);
        }
    });
    await Promise.all(workers);
    return out;
}
async function getAccessToken() {
    // Static long-lived API token wins if configured.
    if (config_1.config.conductor1.apiToken) {
        return config_1.config.conductor1.apiToken;
    }
    const now = Date.now();
    if (tokenCache && tokenCache.expiresAt - 30_000 > now) {
        return tokenCache.token;
    }
    if (!config_1.config.conductor1.clientId || !config_1.config.conductor1.clientSecret) {
        throw new Error("Conductor1 credentials missing: set C1_API_TOKEN, or C1_CLIENT_ID + C1_CLIENT_SECRET");
    }
    const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config_1.config.conductor1.clientId,
        client_secret: config_1.config.conductor1.clientSecret,
    });
    const url = `${config_1.config.conductor1.baseUrl}/auth/v1/token`;
    const res = await axios_1.default.post(url, body.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 15_000,
    });
    const token = res.data?.access_token;
    const expiresIn = res.data?.expires_in ?? 600;
    if (!token)
        throw new Error("Conductor1 auth: no access_token in response");
    tokenCache = { token, expiresAt: now + expiresIn * 1000 };
    return token;
}
async function api() {
    const token = await getAccessToken();
    return axios_1.default.create({
        baseURL: `${config_1.config.conductor1.baseUrl}/api/v1`,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        timeout: 30_000,
    });
}
// ---------- Raw pagination helpers ----------
async function listAllAccessReviews() {
    const client = await api();
    const out = [];
    let pageToken;
    do {
        const res = await client.get("/access_reviews", {
            params: { page_size: 100, page_token: pageToken },
        });
        const list = (res.data?.list ?? []);
        out.push(...list);
        pageToken = res.data?.nextPageToken || undefined;
    } while (pageToken);
    return out;
}
// Fetch every task in a campaign — no cap. Refresh runs hourly; large campaigns
// may take several minutes per refresh.
const PAGE_SIZE = 100;
async function searchOpenTasksForCampaign(accessReviewId) {
    const client = await api();
    const tasks = [];
    const expanded = [];
    let pageToken;
    do {
        const res = await client.post("/search/tasks", {
            accessReviewIds: [accessReviewId],
            taskStates: ["TASK_STATE_OPEN"],
            pageSize: PAGE_SIZE,
            pageToken,
        });
        tasks.push(...(res.data?.list ?? []));
        expanded.push(...(res.data?.expanded ?? []));
        pageToken = res.data?.nextPageToken || undefined;
    } while (pageToken);
    return { tasks, expanded, truncated: false };
}
// Count closed tasks via paged scan. We only need the count, so we discard the list.
async function countClosedTasksForCampaign(accessReviewId) {
    const client = await api();
    let total = 0;
    let pageToken;
    do {
        const res = await client.post("/search/tasks", {
            accessReviewIds: [accessReviewId],
            taskStates: ["TASK_STATE_CLOSED"],
            pageSize: PAGE_SIZE,
            pageToken,
        });
        total += (res.data?.list ?? []).length;
        pageToken = res.data?.nextPageToken || undefined;
    } while (pageToken);
    return total;
}
// ---------- Normalizers ----------
function mapCampaignType(raw) {
    if (!raw)
        return "other";
    const v = raw.toLowerCase();
    if (v.includes("role"))
        return "role_review";
    if (v.includes("separation") || v.includes("sod"))
        return "separation_of_duties";
    if (v.includes("certif") || v.includes("access"))
        return "access_certification";
    return "other";
}
function mapCampaignStatus(state) {
    const v = (state ?? "").toUpperCase();
    // ConductorOne states: UNSPECIFIED, PENDING, OPEN, CLOSED.
    // PENDING = scheduled but not yet started (don't track). OPEN = currently active. CLOSED = done.
    if (v.includes("CLOSED") || v.includes("COMPLETE"))
        return "closed";
    if (v.includes("ARCHIV"))
        return "archived";
    if (v.includes("PENDING") || v.includes("DRAFT"))
        return "draft";
    if (v.includes("OPEN") || v.includes("PROGRESS"))
        return "open";
    return "draft";
}
function indexExpanded(expanded) {
    const byId = new Map();
    for (const e of expanded) {
        const id = e?.id ?? e?.userId ?? e?.user?.id;
        if (typeof id === "string")
            byId.set(id, e);
    }
    return byId;
}
function normalizeCampaign(raw) {
    // API shape: { accessReview: { id, displayName, state, ... }, ... }
    const r = raw?.accessReview ?? raw;
    const id = r.id ?? r.accessReviewId ?? r.access_review_id;
    const name = r.displayName ?? r.name ?? r.title ?? `Campaign ${id}`;
    const rawType = r.campaignType ?? r.type ?? r.templateType ?? r.kind ?? r.defaultView;
    return {
        id: String(id),
        name: String(name),
        description: r.description,
        type: mapCampaignType(rawType),
        rawType: rawType ? String(rawType) : undefined,
        status: mapCampaignStatus(r.state ?? r.status),
        startDate: r.startedAt ?? r.startDate ?? r.startsAt ?? r.scheduledStartDate ?? r.createdAt,
        endDate: r.completionDate ??
            r.closedAt ??
            r.endDate ??
            r.dueAt ??
            r.deadline ??
            r.endsAt,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        reviewerIds: [],
        totalReviews: 0,
        completedReviews: 0,
        percentComplete: 0,
    };
}
function normalizeTask(raw, campaignId, expanded, entitlementNames) {
    // API shape: { task: { id, state, type: { revoke|certify|grant: {...} }, userId, approverIds, ... }, userPath, ... }
    const t = raw?.task ?? raw;
    const state = (t.state ?? t.status ?? "").toString().toUpperCase();
    const isClosed = state.includes("CLOSED") || !!t.closedAt;
    // Reviewer = first approver. ConductorOne tasks carry the reviewer in
    // approverIds / stepApproverIds. There is no "assignee" field on cert tasks.
    const reviewerId = (Array.isArray(t.approverIds) ? t.approverIds[0] : undefined) ??
        (Array.isArray(t.stepApproverIds) ? t.stepApproverIds[0] : undefined) ??
        t.currentAssigneeUserId ??
        t.assigneeUserId ??
        "";
    // Subject = user whose access is being reviewed. On a task it's task.userId,
    // and it's also mirrored inside task.type.{revoke|certify|grant}.identityUserId.
    const typeObj = t.type ?? {};
    const typeKey = Object.keys(typeObj).find((k) => ["revoke", "grant", "certify", "offboarding", "action"].includes(k));
    const typeDetail = typeKey ? typeObj[typeKey] : undefined;
    const subjectId = t.userId ?? typeDetail?.identityUserId ?? t.subjectUserId ?? t.targetUserId;
    const subjectEx = subjectId ? expanded.get(subjectId) : undefined;
    const outcomeRaw = (typeDetail?.outcome ?? t.outcome ?? "").toString().toUpperCase();
    let status = "pending";
    if (isClosed) {
        if (outcomeRaw.includes("APPROV") || outcomeRaw.includes("CERTIF") || outcomeRaw.includes("GRANT"))
            status = "approved";
        else if (outcomeRaw.includes("REVOK") || outcomeRaw.includes("DENIED"))
            status = "revoked";
        else
            status = "skipped";
    }
    return {
        id: String(t.id ?? t.taskId ?? ""),
        campaignId,
        reviewerId: reviewerId ? String(reviewerId) : "",
        subjectUserId: subjectId ? String(subjectId) : undefined,
        subjectUserEmail: subjectEx?.email ?? subjectEx?.user?.email,
        subjectUserDisplayName: subjectEx?.displayName ??
            subjectEx?.user?.displayName ??
            subjectEx?.email ??
            // Many tenants encode the subject in the task's display name as
            // "Certify access for <email> to <app>" — fall back to that.
            extractEmailFromDisplayName(t.displayName),
        entitlement: (typeDetail?.appId && typeDetail?.appEntitlementId
            ? entitlementNames?.get(entitlementCacheKey(typeDetail.appId, typeDetail.appEntitlementId))
            : undefined) ??
            typeDetail?.appEntitlementName ??
            t.appEntitlement?.displayName ??
            t.entitlement?.displayName ??
            t.entitlementName ??
            extractEntitlementFromDisplayName(t.description),
        status,
        decidedAt: t.closedAt ?? (isClosed ? t.updatedAt : undefined),
    };
}
function extractEmailFromDisplayName(name) {
    if (!name)
        return undefined;
    const m = name.match(/[\w.+-]+@[\w.-]+\.\w+/);
    return m ? m[0] : undefined;
}
function extractEntitlementFromDisplayName(desc) {
    if (!desc)
        return undefined;
    // e.g. "Revoke access to entitlements: BC-SUPPORT Role Member"
    const m = desc.match(/entitlements?:\s*(.+)$/i);
    return m ? m[1].trim() : undefined;
}
function normalizeReviewerFromExpanded(e) {
    const id = e?.id ?? e?.userId ?? e?.user?.id;
    const email = e?.email ?? e?.user?.email;
    if (!id || !email)
        return null;
    const displayName = e?.displayName ?? e?.user?.displayName ?? email;
    return { id: String(id), email: String(email).toLowerCase(), displayName: String(displayName) };
}
// ---------- Public: full refresh ----------
async function fetchCampaignSnapshot() {
    logger_1.logger.info("c1_fetch_start");
    const rawCampaigns = await listAllAccessReviews();
    const open = rawCampaigns.filter((r) => mapCampaignStatus(r?.accessReview?.state ?? r.state ?? r.status) === "open");
    logger_1.logger.info("c1_campaigns_fetched", { total: rawCampaigns.length, open: open.length });
    const campaigns = [];
    const reviews = [];
    const reviewerMap = new Map();
    for (const raw of open) {
        const campaign = normalizeCampaign(raw);
        try {
            const [{ tasks, expanded, truncated }, closedCount] = await Promise.all([
                searchOpenTasksForCampaign(campaign.id),
                countClosedTasksForCampaign(campaign.id),
            ]);
            if (truncated) {
                logger_1.logger.warn("c1_tasks_truncated", {
                    campaignId: campaign.id,
                    fetched: tasks.length,
                });
            }
            const exIdx = indexExpanded(expanded);
            for (const e of expanded) {
                const r = normalizeReviewerFromExpanded(e);
                if (r && !reviewerMap.has(r.id))
                    reviewerMap.set(r.id, r);
            }
            // Resolve entitlement names for this campaign's open tasks.
            const entPairs = [];
            for (const tRaw of tasks) {
                const t = tRaw?.task ?? tRaw;
                const typeObj = t.type ?? {};
                const typeKey = Object.keys(typeObj).find((k) => ["revoke", "grant", "certify", "offboarding", "action"].includes(k));
                const typeDetail = typeKey ? typeObj[typeKey] : undefined;
                if (typeDetail?.appId && typeDetail?.appEntitlementId) {
                    entPairs.push({
                        appId: typeDetail.appId,
                        appEntitlementId: typeDetail.appEntitlementId,
                    });
                }
            }
            const entNames = await resolveEntitlementsConcurrent(entPairs);
            const reviewerIds = new Set();
            for (const t of tasks) {
                const review = normalizeTask(t, campaign.id, exIdx, entNames);
                reviews.push(review);
                if (review.reviewerId)
                    reviewerIds.add(review.reviewerId);
            }
            const openCount = tasks.length;
            campaign.reviewerIds = [...reviewerIds];
            campaign.totalReviews = openCount + closedCount;
            campaign.completedReviews = closedCount;
            campaign.percentComplete =
                campaign.totalReviews === 0
                    ? 0
                    : Math.round((closedCount / campaign.totalReviews) * 100);
        }
        catch (err) {
            logger_1.logger.warn("c1_campaign_fetch_failed", {
                campaignId: campaign.id,
                err: err?.message,
            });
        }
        campaigns.push(campaign);
    }
    // Resolve reviewer + subject user IDs that expanded didn't include.
    const needUserIds = [];
    for (const r of reviews) {
        if (r.reviewerId && !reviewerMap.has(r.reviewerId))
            needUserIds.push(r.reviewerId);
        if (r.subjectUserId && !r.subjectUserEmail)
            needUserIds.push(r.subjectUserId);
    }
    const resolved = await resolveUsersConcurrent(needUserIds);
    for (const [id, u] of resolved) {
        if (!reviewerMap.has(id))
            reviewerMap.set(id, u);
    }
    // Back-fill subject fields on reviews.
    for (const r of reviews) {
        if (r.subjectUserId && !r.subjectUserEmail) {
            const u = resolved.get(r.subjectUserId);
            if (u) {
                r.subjectUserEmail = u.email;
                r.subjectUserDisplayName = u.displayName;
            }
        }
    }
    const snapshot = {
        fetchedAt: new Date().toISOString(),
        campaigns,
        reviewers: [...reviewerMap.values()],
        reviews,
    };
    logger_1.logger.info("c1_fetch_done", {
        campaigns: campaigns.length,
        reviews: reviews.length,
        reviewers: reviewerMap.size,
    });
    return snapshot;
}
//# sourceMappingURL=conductor1.js.map