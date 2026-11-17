import axios, { AxiosInstance } from "axios";
import { config } from "../config";
import { logger } from "../logger";
import {
  Campaign,
  CampaignSnapshot,
  CampaignStatus,
  CampaignType,
  Review,
  Reviewer,
} from "../types/domain";

// ConductorOne API client.
// Auth reference:    https://www.c1.ai/docs/conductorone-api/authenticate.md
// Access reviews:    GET  /api/v1/access_reviews        (page_size, page_token)
// Task search:       POST /api/v1/search/tasks          (accessReviewIds, taskStates, pageSize, pageToken)

interface TokenCache {
  token: string;
  expiresAt: number; // epoch ms
}

let tokenCache: TokenCache | null = null;

export function resetConductorTokenCache(): void {
  tokenCache = null;
  userCache.clear();
}

const userCache = new Map<string, Reviewer | null>();

async function getUserById(id: string): Promise<Reviewer | null> {
  if (userCache.has(id)) return userCache.get(id)!;
  try {
    const client = await api();
    const res = await client.get(`/users/${encodeURIComponent(id)}`);
    const u = res.data?.userView?.user ?? res.data?.user ?? res.data;
    if (!u?.id || !u?.email) {
      userCache.set(id, null);
      return null;
    }
    const reviewer: Reviewer = {
      id: String(u.id),
      email: String(u.email).toLowerCase(),
      displayName: String(u.displayName ?? u.email),
    };
    userCache.set(id, reviewer);
    return reviewer;
  } catch (err: any) {
    logger.warn("c1_user_lookup_failed", { id, err: err?.message });
    userCache.set(id, null);
    return null;
  }
}

async function resolveUsersConcurrent(ids: string[], concurrency = 8): Promise<Map<string, Reviewer>> {
  const result = new Map<string, Reviewer>();
  const queue = [...new Set(ids.filter(Boolean))];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const id = queue.shift()!;
      const u = await getUserById(id);
      if (u) result.set(id, u);
    }
  });
  await Promise.all(workers);
  return result;
}

// Entitlement name lookup. ConductorOne stores entitlements per app, so the
// id alone isn't enough — we need (appId, appEntitlementId). Cache the result
// for the lifetime of the process.
const entitlementCache = new Map<string, string | null>();

function entitlementCacheKey(appId: string, appEntitlementId: string): string {
  return `${appId}::${appEntitlementId}`;
}

async function getEntitlementName(appId: string, appEntitlementId: string): Promise<string | null> {
  if (!appId || !appEntitlementId) return null;
  const key = entitlementCacheKey(appId, appEntitlementId);
  if (entitlementCache.has(key)) return entitlementCache.get(key)!;
  try {
    const client = await api();
    const res = await client.get(
      `/apps/${encodeURIComponent(appId)}/entitlements/${encodeURIComponent(appEntitlementId)}`
    );
    const name =
      res.data?.appEntitlementView?.appEntitlement?.displayName ??
      res.data?.appEntitlement?.displayName ??
      res.data?.displayName ??
      null;
    entitlementCache.set(key, name);
    return name;
  } catch (err: any) {
    logger.debug("c1_entitlement_lookup_failed", { appId, appEntitlementId, err: err?.message });
    entitlementCache.set(key, null);
    return null;
  }
}

async function resolveEntitlementsConcurrent(
  pairs: Array<{ appId: string; appEntitlementId: string }>,
  concurrency = 8
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const seen = new Set<string>();
  const queue = pairs.filter((p) => {
    if (!p.appId || !p.appEntitlementId) return false;
    const k = entitlementCacheKey(p.appId, p.appEntitlementId);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const p = queue.shift()!;
      const name = await getEntitlementName(p.appId, p.appEntitlementId);
      if (name) out.set(entitlementCacheKey(p.appId, p.appEntitlementId), name);
    }
  });
  await Promise.all(workers);
  return out;
}

async function getAccessToken(): Promise<string> {
  // Static long-lived API token wins if configured.
  if (config.conductor1.apiToken) {
    return config.conductor1.apiToken;
  }
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt - 30_000 > now) {
    return tokenCache.token;
  }
  if (!config.conductor1.clientId || !config.conductor1.clientSecret) {
    throw new Error(
      "Conductor1 credentials missing: set C1_API_TOKEN, or C1_CLIENT_ID + C1_CLIENT_SECRET"
    );
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.conductor1.clientId,
    client_secret: config.conductor1.clientSecret,
  });
  const url = `${config.conductor1.baseUrl}/auth/v1/token`;
  const res = await axios.post(url, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15_000,
  });
  const token = res.data?.access_token as string;
  const expiresIn = (res.data?.expires_in as number) ?? 600;
  if (!token) throw new Error("Conductor1 auth: no access_token in response");
  tokenCache = { token, expiresAt: now + expiresIn * 1000 };
  return token;
}

async function api(): Promise<AxiosInstance> {
  const token = await getAccessToken();
  return axios.create({
    baseURL: `${config.conductor1.baseUrl}/api/v1`,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    timeout: 30_000,
  });
}

// ---------- Raw pagination helpers ----------

async function listAllAccessReviews(): Promise<any[]> {
  const client = await api();
  const out: any[] = [];
  let pageToken: string | undefined;
  do {
    const res = await client.get("/access_reviews", {
      params: { page_size: 100, page_token: pageToken },
    });
    const list = (res.data?.list ?? []) as any[];
    out.push(...list);
    pageToken = res.data?.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

// Fetch every task in a campaign — no cap. Refresh runs hourly; large campaigns
// may take several minutes per refresh.
const PAGE_SIZE = 100;

async function searchOpenTasksForCampaign(accessReviewId: string): Promise<{
  tasks: any[];
  expanded: any[];
  truncated: boolean;
}> {
  const client = await api();
  const tasks: any[] = [];
  const expanded: any[] = [];
  let pageToken: string | undefined;
  do {
    const res = await client.post("/search/tasks", {
      accessReviewIds: [accessReviewId],
      taskStates: ["TASK_STATE_OPEN"],
      pageSize: PAGE_SIZE,
      pageToken,
    });
    tasks.push(...((res.data?.list ?? []) as any[]));
    expanded.push(...((res.data?.expanded ?? []) as any[]));
    pageToken = res.data?.nextPageToken || undefined;
  } while (pageToken);
  return { tasks, expanded, truncated: false };
}

// Count closed tasks via paged scan. We only need the count, so we discard the list.
async function countClosedTasksForCampaign(accessReviewId: string): Promise<number> {
  const client = await api();
  let total = 0;
  let pageToken: string | undefined;
  do {
    const res = await client.post("/search/tasks", {
      accessReviewIds: [accessReviewId],
      taskStates: ["TASK_STATE_CLOSED"],
      pageSize: PAGE_SIZE,
      pageToken,
    });
    total += ((res.data?.list ?? []) as any[]).length;
    pageToken = res.data?.nextPageToken || undefined;
  } while (pageToken);
  return total;
}

// ---------- Normalizers ----------

function mapCampaignType(raw?: string): CampaignType {
  if (!raw) return "other";
  const v = raw.toLowerCase();
  if (v.includes("role")) return "role_review";
  if (v.includes("separation") || v.includes("sod")) return "separation_of_duties";
  if (v.includes("certif") || v.includes("access")) return "access_certification";
  return "other";
}

function mapCampaignStatus(state?: string): CampaignStatus {
  const v = (state ?? "").toUpperCase();
  // ConductorOne states: UNSPECIFIED, PENDING, OPEN, CLOSED.
  // PENDING = scheduled but not yet started (don't track). OPEN = currently active. CLOSED = done.
  if (v.includes("CLOSED") || v.includes("COMPLETE")) return "closed";
  if (v.includes("ARCHIV")) return "archived";
  if (v.includes("PENDING") || v.includes("DRAFT")) return "draft";
  if (v.includes("OPEN") || v.includes("PROGRESS")) return "open";
  return "draft";
}

function indexExpanded(expanded: any[]): Map<string, any> {
  const byId = new Map<string, any>();
  for (const e of expanded) {
    const id = e?.id ?? e?.userId ?? e?.user?.id;
    if (typeof id === "string") byId.set(id, e);
  }
  return byId;
}

function normalizeCampaign(raw: any): Campaign {
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
    endDate:
      r.completionDate ??
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

function normalizeTask(
  raw: any,
  campaignId: string,
  expanded: Map<string, any>,
  entitlementNames?: Map<string, string>
): Review {
  // API shape: { task: { id, state, type: { revoke|certify|grant: {...} }, userId, approverIds, ... }, userPath, ... }
  const t = raw?.task ?? raw;
  const state = (t.state ?? t.status ?? "").toString().toUpperCase();
  const isClosed = state.includes("CLOSED") || !!t.closedAt;

  // Reviewer = first approver. ConductorOne tasks carry the reviewer in
  // approverIds / stepApproverIds. There is no "assignee" field on cert tasks.
  const reviewerId =
    (Array.isArray(t.approverIds) ? t.approverIds[0] : undefined) ??
    (Array.isArray(t.stepApproverIds) ? t.stepApproverIds[0] : undefined) ??
    t.currentAssigneeUserId ??
    t.assigneeUserId ??
    "";

  // Subject = user whose access is being reviewed. On a task it's task.userId,
  // and it's also mirrored inside task.type.{revoke|certify|grant}.identityUserId.
  const typeObj = t.type ?? {};
  const typeKey = Object.keys(typeObj).find((k) =>
    ["revoke", "grant", "certify", "offboarding", "action"].includes(k)
  );
  const typeDetail = typeKey ? typeObj[typeKey] : undefined;
  const subjectId = t.userId ?? typeDetail?.identityUserId ?? t.subjectUserId ?? t.targetUserId;
  const subjectEx = subjectId ? expanded.get(subjectId) : undefined;

  const outcomeRaw = (typeDetail?.outcome ?? t.outcome ?? "").toString().toUpperCase();
  let status: Review["status"] = "pending";
  if (isClosed) {
    if (outcomeRaw.includes("APPROV") || outcomeRaw.includes("CERTIF") || outcomeRaw.includes("GRANT"))
      status = "approved";
    else if (outcomeRaw.includes("REVOK") || outcomeRaw.includes("DENIED")) status = "revoked";
    else status = "skipped";
  }

  return {
    id: String(t.id ?? t.taskId ?? ""),
    campaignId,
    reviewerId: reviewerId ? String(reviewerId) : "",
    subjectUserId: subjectId ? String(subjectId) : undefined,
    subjectUserEmail: subjectEx?.email ?? subjectEx?.user?.email,
    subjectUserDisplayName:
      subjectEx?.displayName ??
      subjectEx?.user?.displayName ??
      subjectEx?.email ??
      // Many tenants encode the subject in the task's display name as
      // "Certify access for <email> to <app>" — fall back to that.
      extractEmailFromDisplayName(t.displayName),
    entitlement:
      (typeDetail?.appId && typeDetail?.appEntitlementId
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

function extractEmailFromDisplayName(name?: string): string | undefined {
  if (!name) return undefined;
  const m = name.match(/[\w.+-]+@[\w.-]+\.\w+/);
  return m ? m[0] : undefined;
}

function extractEntitlementFromDisplayName(desc?: string): string | undefined {
  if (!desc) return undefined;
  // e.g. "Revoke access to entitlements: BC-SUPPORT Role Member"
  const m = desc.match(/entitlements?:\s*(.+)$/i);
  return m ? m[1].trim() : undefined;
}

function normalizeReviewerFromExpanded(e: any): Reviewer | null {
  const id = e?.id ?? e?.userId ?? e?.user?.id;
  const email = e?.email ?? e?.user?.email;
  if (!id || !email) return null;
  const displayName = e?.displayName ?? e?.user?.displayName ?? email;
  return { id: String(id), email: String(email).toLowerCase(), displayName: String(displayName) };
}

// ---------- Public: full refresh ----------

export async function fetchCampaignSnapshot(): Promise<CampaignSnapshot> {
  logger.info("c1_fetch_start");
  const rawCampaigns = await listAllAccessReviews();

  const open = rawCampaigns.filter(
    (r) => mapCampaignStatus(r?.accessReview?.state ?? r.state ?? r.status) === "open"
  );
  logger.info("c1_campaigns_fetched", { total: rawCampaigns.length, open: open.length });

  const campaigns: Campaign[] = [];
  const reviews: Review[] = [];
  const reviewerMap = new Map<string, Reviewer>();

  for (const raw of open) {
    const campaign = normalizeCampaign(raw);
    try {
      const [{ tasks, expanded, truncated }, closedCount] = await Promise.all([
        searchOpenTasksForCampaign(campaign.id),
        countClosedTasksForCampaign(campaign.id),
      ]);
      if (truncated) {
        logger.warn("c1_tasks_truncated", {
          campaignId: campaign.id,
          fetched: tasks.length,
        });
      }
      const exIdx = indexExpanded(expanded);

      for (const e of expanded) {
        const r = normalizeReviewerFromExpanded(e);
        if (r && !reviewerMap.has(r.id)) reviewerMap.set(r.id, r);
      }

      // Resolve entitlement names for this campaign's open tasks.
      const entPairs: Array<{ appId: string; appEntitlementId: string }> = [];
      for (const tRaw of tasks) {
        const t = tRaw?.task ?? tRaw;
        const typeObj = t.type ?? {};
        const typeKey = Object.keys(typeObj).find((k) =>
          ["revoke", "grant", "certify", "offboarding", "action"].includes(k)
        );
        const typeDetail = typeKey ? typeObj[typeKey] : undefined;
        if (typeDetail?.appId && typeDetail?.appEntitlementId) {
          entPairs.push({
            appId: typeDetail.appId,
            appEntitlementId: typeDetail.appEntitlementId,
          });
        }
      }
      const entNames = await resolveEntitlementsConcurrent(entPairs);

      const reviewerIds = new Set<string>();
      for (const t of tasks) {
        const review = normalizeTask(t, campaign.id, exIdx, entNames);
        reviews.push(review);
        if (review.reviewerId) reviewerIds.add(review.reviewerId);
      }

      const openCount = tasks.length;
      campaign.reviewerIds = [...reviewerIds];
      campaign.totalReviews = openCount + closedCount;
      campaign.completedReviews = closedCount;
      campaign.percentComplete =
        campaign.totalReviews === 0
          ? 0
          : Math.round((closedCount / campaign.totalReviews) * 100);
    } catch (err: any) {
      logger.warn("c1_campaign_fetch_failed", {
        campaignId: campaign.id,
        err: err?.message,
      });
    }
    campaigns.push(campaign);
  }

  // Resolve reviewer + subject user IDs that expanded didn't include.
  const needUserIds: string[] = [];
  for (const r of reviews) {
    if (r.reviewerId && !reviewerMap.has(r.reviewerId)) needUserIds.push(r.reviewerId);
    if (r.subjectUserId && !r.subjectUserEmail) needUserIds.push(r.subjectUserId);
  }
  const resolved = await resolveUsersConcurrent(needUserIds);
  for (const [id, u] of resolved) {
    if (!reviewerMap.has(id)) reviewerMap.set(id, u);
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

  const snapshot: CampaignSnapshot = {
    fetchedAt: new Date().toISOString(),
    campaigns,
    reviewers: [...reviewerMap.values()],
    reviews,
  };
  logger.info("c1_fetch_done", {
    campaigns: campaigns.length,
    reviews: reviews.length,
    reviewers: reviewerMap.size,
  });
  return snapshot;
}
