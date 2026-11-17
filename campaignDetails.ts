import axios from "axios";
import path from "path";
import fs from "fs/promises";
import { config } from "../config";
import { logger } from "../logger";
import { audit } from "./audit";
import { register as registerJob, start as startJob, finish as finishJob, update as updateJob } from "./jobs";

const ACTIVE_DISK_TTL_MS = 60 * 60 * 1000; // 1h — beyond this, attempt a delta sync
const SHARD_COUNT = 10;
const RESOLUTION_CONCURRENCY = 12;
function diskPath(campaignId: string): string {
  return path.join(config.paths.data, "campaign-tasks", `${campaignId}.json`);
}
function rawPath(campaignId: string): string {
  return path.join(config.paths.data, "campaign-tasks-raw", `${campaignId}.json`);
}

// Slim per-task record kept on disk. Tiny enough to persist for huge campaigns
// while still carrying everything the aggregator reads.
interface SlimTask {
  id: string;
  state?: string;
  type?: any;
  approverIds?: string[];
  stepApproverIds?: string[];
  userId?: string;
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string;
  displayName?: string;
  description?: string;
}
function slimify(rawOrInner: any): SlimTask | null {
  const t = rawOrInner?.task ?? rawOrInner;
  if (!t?.id) return null;
  return {
    id: String(t.id),
    state: t.state,
    type: t.type,
    approverIds: Array.isArray(t.approverIds) ? t.approverIds : undefined,
    stepApproverIds: Array.isArray(t.stepApproverIds) ? t.stepApproverIds : undefined,
    userId: t.userId,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    closedAt: t.closedAt,
    displayName: t.displayName,
    description: t.description,
  };
}

interface RawCacheFile {
  campaignId: string;
  tasks: Record<string, SlimTask>; // keyed by id for O(1) merge
  lastSyncedAt: string;
}

async function loadRaw(campaignId: string): Promise<RawCacheFile | null> {
  try {
    const raw = await fs.readFile(rawPath(campaignId), "utf8");
    const parsed = JSON.parse(raw) as RawCacheFile;
    if (parsed?.tasks && parsed?.lastSyncedAt) return parsed;
    return null;
  } catch {
    return null;
  }
}
async function saveRaw(campaignId: string, data: RawCacheFile): Promise<void> {
  const dir = path.dirname(rawPath(campaignId));
  await fs.mkdir(dir, { recursive: true });
  const tmp = rawPath(campaignId) + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(data), "utf8");
  await fs.rename(tmp, rawPath(campaignId));
}

// Best-effort campaign name lookup for nicer job-panel labels.
async function campaignNameFor(campaignId: string): Promise<string | null> {
  try {
    const { getHistory } = await import("./scorecards");
    const hist = await getHistory();
    const h = hist.campaigns.find((c) => c.id === campaignId);
    if (h) return h.name;
    const { getSnapshot } = await import("./campaignStore");
    const snap = await getSnapshot();
    const c = snap?.campaigns.find((c) => c.id === campaignId);
    return c?.name ?? null;
  } catch {
    return null;
  }
}

// Returns { startDate, endDate } ISO strings (YYYY-MM-DD) for the campaign.
async function campaignDates(campaignId: string): Promise<{ startDate?: string; endDate?: string }> {
  try {
    const { getHistory } = await import("./scorecards");
    const hist = await getHistory();
    const h = hist.campaigns.find((c) => c.id === campaignId);
    if (h) return { startDate: h.openedAt?.slice(0, 10), endDate: (h.closedAt ?? h.deadline)?.slice(0, 10) };
    const { getSnapshot } = await import("./campaignStore");
    const snap = await getSnapshot();
    const c = snap?.campaigns.find((c) => c.id === campaignId);
    if (c) return { startDate: c.startDate?.slice(0, 10), endDate: c.endDate?.slice(0, 10) };
  } catch {}
  return {};
}

// Whether the campaign is closed. Closed campaigns are immutable so we cache
// their aggregated stats forever once successfully fetched.
async function isClosedCampaign(campaignId: string): Promise<boolean> {
  try {
    const { getHistory } = await import("./scorecards");
    const hist = await getHistory();
    if (hist.campaigns.some((c) => c.id === campaignId)) return true;
    const { getSnapshot } = await import("./campaignStore");
    const snap = await getSnapshot();
    const camp = snap?.campaigns.find((c) => c.id === campaignId);
    if (camp && camp.status !== "open") return true;
  } catch {}
  return false;
}

async function loadDisk(campaignId: string): Promise<{ at: number; data: CampaignDetailsStats } | null> {
  try {
    const raw = await fs.readFile(diskPath(campaignId), "utf8");
    const parsed = JSON.parse(raw) as { at: number; data: CampaignDetailsStats };
    // Reject pre-reviewerTimeline cache files so the replay engine works.
    if (!parsed.data?.reviewerTimeline || typeof parsed.data.reviewerTimeline !== "object") {
      logger.info("campaign_details_disk_stale_format", { campaignId });
      return null;
    }
    // Always serve whatever is on disk — the UI shows the cache age, and the
    // prewarm cron handles freshening for active campaigns. If the caller wants
    // a fresh pull they pass force=true.
    return parsed;
  } catch {
    return null;
  }
}

// True when the on-disk cache for an active campaign is older than the TTL.
// Used to decide when to kick off a background delta-refresh on read.
async function isActiveDiskStale(campaignId: string, at: number): Promise<boolean> {
  if (await isClosedCampaign(campaignId)) return false;
  return Date.now() - at >= ACTIVE_DISK_TTL_MS;
}
async function saveDisk(campaignId: string, data: CampaignDetailsStats): Promise<void> {
  const dir = path.dirname(diskPath(campaignId));
  await fs.mkdir(dir, { recursive: true });
  const tmp = diskPath(campaignId) + ".tmp";
  await fs.writeFile(tmp, JSON.stringify({ at: Date.now(), data }), "utf8");
  await fs.rename(tmp, diskPath(campaignId));
}

// Per-campaign deep stats: aggregated tile counts, reviewer decisions, app breakdown,
// activity feed, daily trend buckets reconstructed from task closedAt timestamps.
//
// Cached in-memory for 15 min per campaign because fetching tasks is expensive.

const CACHE_TTL_MS = 15 * 60_000;
// No hard task cap — fetch every task in the campaign. Large campaigns can take many
// minutes; we log progress per page and the result is cached for 15 min.
const PAGE_SIZE = 100;

let tokenCache: { value: string; expiresAt: number } | null = null;
async function getToken(): Promise<string> {
  if (config.conductor1.apiToken) return config.conductor1.apiToken;
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt - 30_000 > now) return tokenCache.value;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.conductor1.clientId,
    client_secret: config.conductor1.clientSecret,
  });
  const r = await axios.post(`${config.conductor1.baseUrl}/auth/v1/token`, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  tokenCache = { value: r.data.access_token, expiresAt: now + (r.data.expires_in ?? 600) * 1000 };
  return tokenCache.value;
}

async function withRetry<T>(label: string, fn: () => Promise<T>, tries = 5): Promise<T> {
  let lastErr: any;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.response?.status;
      const transient =
        err?.code === "ECONNRESET" ||
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
        // Surface the C1 error body if there is one — invaluable for diagnosing 400s.
        if (err?.response?.data) {
          logger.warn("c1_request_failed", {
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
      logger.warn("c1_retry", { label, attempt, code: err?.code, status, backoffMs });
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}

// User cache (campaignDetails-local) for resolving user ids to display names.
const userCache = new Map<string, { email: string; displayName: string } | null>();

async function resolveUser(id: string): Promise<{ email: string; displayName: string } | null> {
  if (userCache.has(id)) return userCache.get(id)!;
  try {
    const u = await withRetry(`user:${id}`, async () => {
      const token = await getToken();
      return axios.get(`${config.conductor1.baseUrl}/api/v1/users/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 30_000,
      });
    });
    const user = u.data?.userView?.user;
    const v = user
      ? {
          email: (user.email ?? "").toLowerCase(),
          displayName: user.displayName ?? user.email ?? id,
        }
      : null;
    userCache.set(id, v);
    return v;
  } catch {
    userCache.set(id, null);
    return null;
  }
}

// Try to resolve an app's display name by id. Cached.
const appCache = new Map<string, string | null>();
async function resolveAppName(appId: string): Promise<string | null> {
  if (appCache.has(appId)) return appCache.get(appId)!;
  try {
    const r = await withRetry(`app:${appId}`, async () => {
      const token = await getToken();
      return axios.get(`${config.conductor1.baseUrl}/api/v1/apps/${encodeURIComponent(appId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 20_000,
      });
    });
    const name = r.data?.appView?.app?.displayName ?? r.data?.app?.displayName ?? null;
    appCache.set(appId, name);
    return name;
  } catch {
    appCache.set(appId, null);
    return null;
  }
}

export interface CampaignDetailsStats {
  campaignId: string;
  fetchedAt: string;
  totalFetched: number;
  truncated: boolean;
  cap: number;

  tiles: {
    total: number;
    completed: number;
    pending: number;
    approved: number;
    revoked: number;
    skipped: number;
    cancelled: number;
    percentComplete: number;
  };

  byReviewer: Array<{
    reviewerId: string;
    email: string;
    displayName: string;
    approved: number;
    revoked: number;
    skipped: number;
    pending: number;
    totalAssigned: number;
    approvalRate: number;
  }>;

  byApp: Array<{
    appId: string;
    appName: string;
    approved: number;
    revoked: number;
    skipped: number;
    pending: number;
    total: number;
    approvalRate: number;
    percentComplete: number;
  }>;

  // For replay: per-reviewer sorted closedAt timestamps. Empty list means we
  // didn't observe any closures for that reviewer (e.g., they have all-pending).
  reviewerTimeline: Record<string, string[]>;

  // Last N completed tasks with timestamps
  recentActivity: Array<{
    taskId: string;
    closedAt: string;
    reviewerEmail?: string;
    reviewerName?: string;
    subjectUserId?: string;
    outcome: "approved" | "revoked" | "skipped" | "cancelled";
    appName?: string;
    entitlement?: string;
  }>;

  // Open-reviews-over-time + reviewer-state trend.
  trendByDay: Array<{
    date: string;
    open: number;
    completedThisDay: number;
    // Reviewer (manager) state at end of this day:
    reviewersCompleted: number;   // all tasks done by EOD
    reviewersInProgress: number;  // started but still has pending
    reviewersNotStarted: number;  // no decisions yet
    // Name lists for drilldown (click on a dot):
    completedNames: Array<{ email: string; displayName: string }>;
    inProgressNames: Array<{ email: string; displayName: string }>;
    notStartedNames: Array<{ email: string; displayName: string }>;
  }>;

  // Reviewers with at least one pending task; reviewers fully done
  reviewersWithOpenTasks: number;
  reviewersWithoutOpenTasks: number;

  // Average review time (createdAt -> closedAt) for closed tasks, in days
  avgReviewTimeDays: number | null;
}

type FetchState =
  | { kind: "fetching"; startedAt: number; pages: number; tasks: number }
  | { kind: "ready"; cachedAt: number; data: CampaignDetailsStats; ms: number }
  | { kind: "failed"; failedAt: number; err: string };

const states = new Map<string, FetchState>();

export interface CampaignDetailsResponse {
  status: "fetching" | "ready" | "failed";
  startedAt?: number;
  pages?: number;
  tasks?: number;
  cachedAt?: number;
  data?: CampaignDetailsStats;
  ms?: number;
  err?: string;
}

// Non-blocking: returns the cached result if fresh, otherwise kicks off a
// background fetch and returns the current progress. Clients poll this endpoint
// and render once status === "ready". Use force=true to bypass cache and start
// a new fetch.
export async function getCampaignDetails(
  campaignId: string,
  opts: { force?: boolean; actor?: string } = {}
): Promise<CampaignDetailsResponse> {
  const now = Date.now();
  let cur = states.get(campaignId);

  // If we don't have an in-memory cache hit, try disk before kicking off a fetch.
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
      logger.info("campaign_details_disk_hit", { campaignId, ageMs: now - fromDisk.at });
    }
  }

  if (!opts.force && cur) {
    if (cur.kind === "ready") {
      // Always serve the cached payload. If the cache is past the active TTL
      // and no refresh is in flight, kick off a background delta-sync — the
      // user still sees instant data, and the next poll picks up the refresh.
      if (await isActiveDiskStale(campaignId, cur.cachedAt)) {
        kickBackgroundRefresh(campaignId, opts.actor).catch(() => {});
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

// Idempotent: starts a background fetch if one isn't already running. Existing
// "ready" state is preserved so concurrent reads keep getting the cached payload
// until the new fetch lands.
async function launchFetch(campaignId: string, actor?: string): Promise<number> {
  const cur = states.get(campaignId);
  if (cur?.kind === "fetching") return cur.startedAt;

  const startedAt = Date.now();
  // We deliberately overwrite "ready" with "fetching" only when there's no
  // background-refresh case — for that path, callers use kickBackgroundRefresh
  // which keeps "ready" visible until the refresh completes.
  states.set(campaignId, { kind: "fetching", startedAt, pages: 0, tasks: 0 });
  await beginFetch(campaignId, actor, startedAt, /*preserveReady*/ false);
  return startedAt;
}

// Kicks off a refresh in the background without disturbing the cached "ready"
// state — useful for stale-while-revalidate reads of active campaigns.
async function kickBackgroundRefresh(campaignId: string, actor?: string): Promise<void> {
  if (backgroundRefreshing.has(campaignId)) return;
  const cur = states.get(campaignId);
  if (cur?.kind === "fetching") return;
  backgroundRefreshing.add(campaignId);
  const startedAt = Date.now();
  await beginFetch(campaignId, actor ?? "system:stale-revalidate", startedAt, /*preserveReady*/ true);
}

const backgroundRefreshing = new Set<string>();

async function beginFetch(
  campaignId: string,
  actor: string | undefined,
  startedAt: number,
  preserveReady: boolean
): Promise<void> {
  logger.info("campaign_details_fetch_start", { campaignId, shards: SHARD_COUNT, bg: preserveReady });
  const jobId = `campaign_details:${campaignId}`;
  const campaignName = await campaignNameFor(campaignId);
  registerJob({
    id: jobId,
    name: `Task fetch: ${campaignName ?? campaignId}`,
    kind: "on-demand",
  });
  startJob(jobId, `triggered by ${actor ?? "system"}`);

  fetchAndAggregate(campaignId, (pages, tasks) => {
    if (!preserveReady) {
      const s = states.get(campaignId);
      if (s?.kind === "fetching") {
        s.pages = pages;
        s.tasks = tasks;
      }
    }
    updateJob(jobId, { details: { pages, tasks } });
  })
    .then(async (data) => {
      const ms = Date.now() - startedAt;
      states.set(campaignId, { kind: "ready", cachedAt: Date.now(), data, ms });
      try {
        await saveDisk(campaignId, data);
      } catch (err: any) {
        logger.warn("campaign_details_disk_save_failed", { campaignId, err: err?.message });
      }
      await audit({
        actor: actor ?? "system",
        action: "campaign_details.fetch",
        target: campaignId,
        details: { total: data.totalFetched, ms, bg: preserveReady },
      });
      logger.info("campaign_details_fetch_done", {
        campaignId,
        tasks: data.totalFetched,
        ms,
      });
      finishJob(jobId, {
        ok: true,
        message: `${data.totalFetched.toLocaleString()} tasks`,
        details: { tasks: data.totalFetched, ms },
      });
    })
    .catch((err: any) => {
      // For background refreshes, keep the previous ready state so the UI
      // continues to render the last known good cache.
      if (!preserveReady) {
        states.set(campaignId, {
          kind: "failed",
          failedAt: Date.now(),
          err: err?.message ?? "fetch failed",
        });
      }
      logger.error("campaign_details_fetch_failed", {
        campaignId,
        bg: preserveReady,
        err: err?.message,
      });
      finishJob(jobId, { ok: false, message: err?.message ?? "fetch failed" });
    })
    .finally(() => {
      backgroundRefreshing.delete(campaignId);
    });
}

async function fetchAndAggregate(
  campaignId: string,
  onProgress?: (pages: number, tasks: number) => void
): Promise<CampaignDetailsStats> {
  const base = `${config.conductor1.baseUrl}/api/v1`;
  const fetchStart = Date.now();
  let pagesTotal = 0;

  // Step 1: hydrate slim task map from disk (if any).
  let raw = await loadRaw(campaignId);
  let didFullFetch = false;

  if (!raw) {
    raw = { campaignId, tasks: {}, lastSyncedAt: new Date(0).toISOString() };
  }
  const taskMap = raw.tasks; // mutate in place

  // Step 2: choose between delta and full fetch.
  const closed = await isClosedCampaign(campaignId);
  const haveCache = Object.keys(taskMap).length > 0;
  let mode: "delta" | "full" = haveCache ? "delta" : "full";
  // Closed campaigns never need a delta — once cached, they're immutable.
  if (closed && haveCache) {
    logger.info("campaign_details_skip_closed", { campaignId, tasks: Object.keys(taskMap).length });
  } else if (mode === "delta") {
    const since = raw.lastSyncedAt;
    logger.info("campaign_details_delta_sync", { campaignId, since });
    try {
      let updated = 0;
      // Single delta query (sorted by updatedAt; usually small). Falls back to
      // full re-fetch on 400 (e.g. C1 rejecting updatedAfter filter shape).
      let pageToken: string | undefined;
      let pages = 0;
      while (true) {
        const r = await withRetry(`tasks:${campaignId}:delta:page${pages}`, async () => {
          const token = await getToken();
          return axios.post(
            `${base}/search/tasks`,
            {
              accessReviewIds: [campaignId],
              updatedAfter: since,
              pageSize: PAGE_SIZE,
              pageToken,
            },
            {
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              timeout: 60_000,
            }
          );
        });
        const list = (r.data?.list as any[]) ?? [];
        for (const item of list) {
          const slim = slimify(item);
          if (slim) {
            taskMap[slim.id] = slim;
            updated++;
          }
        }
        pageToken = r.data?.nextPageToken || undefined;
        pages++;
        pagesTotal++;
        onProgress?.(pagesTotal, Object.keys(taskMap).length);
        if (!pageToken) break;
      }
      raw.lastSyncedAt = new Date().toISOString();
      logger.info("campaign_details_delta_done", { campaignId, pages, updated, total: Object.keys(taskMap).length });
    } catch (err: any) {
      const status = err?.response?.status;
      logger.warn("campaign_details_delta_failed", { campaignId, status, err: err?.message });
      if (status === 400) {
        // C1 rejected the updatedAfter filter — fall back to full re-fetch.
        mode = "full";
      } else {
        throw err;
      }
    }
  }

  if (mode === "full" && !(closed && haveCache)) {
    didFullFetch = true;
    // Clear out and reseed via parallel sharding.
    for (const k of Object.keys(taskMap)) delete taskMap[k];
    const shardWindows = buildShardWindows(SHARD_COUNT);
    async function fetchShard(idx: number, after: string, before: string) {
      let pageToken: string | undefined;
      let shardPages = 0;
      let shardTasks = 0;
      while (true) {
        const r = await withRetry(`tasks:${campaignId}:shard${idx}:page${shardPages}`, async () => {
          const token = await getToken();
          return axios.post(
            `${base}/search/tasks`,
            {
              accessReviewIds: [campaignId],
              createdAfter: after,
              createdBefore: before,
              pageSize: PAGE_SIZE,
              pageToken,
            },
            {
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              timeout: 60_000,
            }
          );
        });
        const list = (r.data?.list as any[]) ?? [];
        for (const item of list) {
          const slim = slimify(item);
          if (slim) taskMap[slim.id] = slim;
        }
        pageToken = r.data?.nextPageToken || undefined;
        shardPages++;
        shardTasks += list.length;
        pagesTotal++;
        onProgress?.(pagesTotal, Object.keys(taskMap).length);
        if (pagesTotal % 25 === 0) {
          logger.info("campaign_details_fetch_progress", {
            campaignId,
            pages: pagesTotal,
            tasks: Object.keys(taskMap).length,
            elapsedMs: Date.now() - fetchStart,
          });
        }
        if (!pageToken) break;
      }
      logger.debug("campaign_details_shard_done", { campaignId, idx, after, before, shardPages, shardTasks });
    }
    await Promise.all(shardWindows.map((w, i) => fetchShard(i, w.after, w.before)));
    raw.lastSyncedAt = new Date().toISOString();
    logger.info("campaign_details_all_shards_done", {
      campaignId,
      pages: pagesTotal,
      tasks: Object.keys(taskMap).length,
      elapsedMs: Date.now() - fetchStart,
    });
  }

  await saveRaw(campaignId, raw);
  // Aggregator below operates on the values of taskMap — wrap them so the
  // existing `raw?.task ?? raw` unwrap works without changes.
  const tasks = Object.values(taskMap).map((t) => ({ task: t }));
  const truncated = false;

  // Aggregate.
  const reviewerAgg = new Map<
    string,
    { approved: number; revoked: number; skipped: number; pending: number; cancelled: number }
  >();
  const appAgg = new Map<
    string,
    { approved: number; revoked: number; skipped: number; pending: number; cancelled: number }
  >();
  const recent: Array<{ task: any; t: any; closedMs: number }> = [];
  let totalApproved = 0,
    totalRevoked = 0,
    totalSkipped = 0,
    totalPending = 0,
    totalCancelled = 0;
  let sumDurationMs = 0;
  let countDurationMs = 0;

  // Pull a "closed at" timestamp from the most reliable place. ConductorOne
  // returns task closure time on type.{revoke|certify|grant}.outcomeTime —
  // there is no top-level closedAt field. Fall back to updatedAt.
  function taskClosedAtIso(t: any): string | undefined {
    if (t.closedAt) return t.closedAt;
    const typeObj = t.type ?? {};
    for (const k of ["revoke", "grant", "certify", "offboarding", "action"]) {
      const ot = typeObj[k]?.outcomeTime;
      if (ot) return ot;
    }
    return undefined;
  }

  for (const raw of tasks) {
    const t = raw?.task ?? raw;
    const state = (t.state ?? "").toString().toUpperCase();
    const closedAtIso = taskClosedAtIso(t);
    const isClosed = state.includes("CLOSED") || !!closedAtIso;
    const typeObj = t.type ?? {};
    const typeKey = Object.keys(typeObj).find((k) =>
      ["revoke", "grant", "certify", "offboarding", "action"].includes(k)
    );
    const typeDetail = typeKey ? typeObj[typeKey] : undefined;
    const outcome = (typeDetail?.outcome ?? "").toString().toUpperCase();
    const reviewerId =
      (Array.isArray(t.approverIds) ? t.approverIds[0] : undefined) ??
      (Array.isArray(t.stepApproverIds) ? t.stepApproverIds[0] : undefined);
    const appId = typeDetail?.appId ?? "";

    let kind: "approved" | "revoked" | "skipped" | "cancelled" | "pending";
    if (!isClosed) kind = "pending";
    else if (outcome.includes("CANCELLED") || outcome.includes("CANCELED")) kind = "cancelled";
    else if (outcome.includes("APPROV") || outcome.includes("CERTIF") || outcome.includes("GRANT"))
      kind = "approved";
    else if (outcome.includes("REVOK") || outcome.includes("DENIED")) kind = "revoked";
    else kind = "skipped";

    if (kind === "approved") totalApproved++;
    else if (kind === "revoked") totalRevoked++;
    else if (kind === "skipped") totalSkipped++;
    else if (kind === "cancelled") totalCancelled++;
    else totalPending++;

    if (reviewerId) {
      const r = reviewerAgg.get(reviewerId) ?? {
        approved: 0,
        revoked: 0,
        skipped: 0,
        pending: 0,
        cancelled: 0,
      };
      r[kind]++;
      reviewerAgg.set(reviewerId, r);
    }
    if (appId) {
      const a = appAgg.get(appId) ?? {
        approved: 0,
        revoked: 0,
        skipped: 0,
        pending: 0,
        cancelled: 0,
      };
      a[kind]++;
      appAgg.set(appId, a);
    }

    if (isClosed && closedAtIso) {
      const closedMs = new Date(closedAtIso).getTime();
      const createdMs = t.createdAt ? new Date(t.createdAt).getTime() : null;
      if (createdMs && Number.isFinite(closedMs)) {
        sumDurationMs += closedMs - createdMs;
        countDurationMs++;
      }
      if (Number.isFinite(closedMs)) recent.push({ task: raw, t, closedMs });
    }
  }

  // Resolve unique users + apps (concurrent — both kicked off in parallel).
  const reviewerIds = [...reviewerAgg.keys()];
  const appIds = [...appAgg.keys()];
  const reviewerInfos = new Map<string, { email: string; displayName: string } | null>();
  const appNames = new Map<string, string>();
  await Promise.all([
    runConcurrent(reviewerIds, RESOLUTION_CONCURRENCY, async (id) => {
      reviewerInfos.set(id, await resolveUser(id));
    }),
    runConcurrent(appIds, RESOLUTION_CONCURRENCY, async (id) => {
      const name = await resolveAppName(id);
      if (name) appNames.set(id, name);
    }),
  ]);

  // Build the recent activity (top 50 by closedMs desc).
  recent.sort((x, y) => y.closedMs - x.closedMs);
  const recentTop = recent.slice(0, 50);
  const activity = recentTop.map(({ t, closedMs }) => {
    const typeObj = t.type ?? {};
    const typeKey = Object.keys(typeObj).find((k) =>
      ["revoke", "grant", "certify", "offboarding", "action"].includes(k)
    );
    const typeDetail = typeKey ? typeObj[typeKey] : undefined;
    const outcome = (typeDetail?.outcome ?? "").toString().toUpperCase();
    const reviewerId =
      (Array.isArray(t.approverIds) ? t.approverIds[0] : undefined) ??
      (Array.isArray(t.stepApproverIds) ? t.stepApproverIds[0] : undefined);
    const reviewer = reviewerId ? reviewerInfos.get(reviewerId) : null;
    let outKind: "approved" | "revoked" | "skipped" | "cancelled" = "skipped";
    if (outcome.includes("CANCELLED") || outcome.includes("CANCELED")) outKind = "cancelled";
    else if (outcome.includes("APPROV") || outcome.includes("CERTIF") || outcome.includes("GRANT"))
      outKind = "approved";
    else if (outcome.includes("REVOK") || outcome.includes("DENIED")) outKind = "revoked";

    return {
      taskId: String(t.id),
      closedAt: new Date(closedMs).toISOString(),
      reviewerEmail: reviewer?.email,
      reviewerName: reviewer?.displayName,
      subjectUserId: t.userId ?? typeDetail?.identityUserId,
      outcome: outKind,
      appName: appNames.get(typeDetail?.appId ?? ""),
      entitlement: typeDetail?.appEntitlementName,
    };
  });

  // Per-reviewer completion timeline: sorted closedAt timestamps per reviewer email.
  // Used by replay to compute exact per-reviewer state at any asOf date.
  const reviewerTimeline: Record<string, string[]> = {};
  for (const r of recent) {
    const t = r.t;
    const reviewerId =
      (Array.isArray(t.approverIds) ? t.approverIds[0] : undefined) ??
      (Array.isArray(t.stepApproverIds) ? t.stepApproverIds[0] : undefined);
    if (!reviewerId) continue;
    const u = reviewerInfos.get(reviewerId);
    if (!u?.email) continue;
    const list = reviewerTimeline[u.email] ?? (reviewerTimeline[u.email] = []);
    list.push(new Date(r.closedMs).toISOString());
  }
  for (const list of Object.values(reviewerTimeline)) list.sort();

  // Trend reconstruction: bucket all closedAt by day.
  const totalCount = tasks.length;
  const completedByDay = new Map<string, number>();
  for (const r of recent) {
    const day = new Date(r.closedMs).toISOString().slice(0, 10);
    completedByDay.set(day, (completedByDay.get(day) ?? 0) + 1);
  }

  // Per-reviewer: sorted decision dates + whether they are fully done (pending===0).
  // "Fully done" is determined from the current reviewerAgg snapshot.
  interface ReviewerMeta {
    email: string;
    displayName: string;
    decisionDates: string[]; // sorted ISO date strings (YYYY-MM-DD)
    allDone: boolean;        // pending === 0 at fetch time
    lastDecisionDate: string | undefined;
  }
  const reviewerMeta = new Map<string, ReviewerMeta>();
  for (const [id, agg] of reviewerAgg) {
    const info = reviewerInfos.get(id);
    if (!info) continue;
    const dates: string[] = [];
    for (const r of recent) {
      const rid =
        (Array.isArray(r.t.approverIds) ? r.t.approverIds[0] : undefined) ??
        (Array.isArray(r.t.stepApproverIds) ? r.t.stepApproverIds[0] : undefined);
      if (rid === id) dates.push(new Date(r.closedMs).toISOString().slice(0, 10));
    }
    dates.sort();
    reviewerMeta.set(id, {
      email: info.email,
      displayName: info.displayName,
      decisionDates: dates,
      allDone: agg.pending === 0,
      lastDecisionDate: dates.length > 0 ? dates[dates.length - 1] : undefined,
    });
  }

  // Build a full date range from campaign start → min(today, campaign end).
  // This ensures every day of the campaign appears even if no activity happened.
  const { startDate, endDate } = await campaignDates(campaignId);
  const todayIso = new Date().toISOString().slice(0, 10);
  const rangeStart =
    startDate ??
    ([...completedByDay.keys()].sort()[0] ?? todayIso);
  const rangeEnd = endDate && endDate < todayIso ? endDate : todayIso;

  function addDays(iso: string, n: number): string {
    const d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  const allDays: string[] = [];
  for (let d = rangeStart; d <= rangeEnd; d = addDays(d, 1)) {
    allDays.push(d);
  }
  // Safety: if somehow no range, fall back to just the days with activity.
  const days = allDays.length > 0 ? allDays : [...completedByDay.keys()].sort();

  let cumulativeCompleted = 0;
  const trendByDay = days.map((day) => {
    const c = completedByDay.get(day) ?? 0;
    cumulativeCompleted += c;

    // Compute reviewer state at end of this day.
    const completedNames: Array<{ email: string; displayName: string }> = [];
    const inProgressNames: Array<{ email: string; displayName: string }> = [];
    const notStartedNames: Array<{ email: string; displayName: string }> = [];

    for (const meta of reviewerMeta.values()) {
      const decisionsThisDay = meta.decisionDates.filter((d) => d <= day).length;
      const doneByThisDay = meta.allDone && !!meta.lastDecisionDate && meta.lastDecisionDate <= day;
      const person = { email: meta.email, displayName: meta.displayName };
      if (doneByThisDay) {
        completedNames.push(person);
      } else if (decisionsThisDay > 0) {
        inProgressNames.push(person);
      } else {
        notStartedNames.push(person);
      }
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

  // Reviewer rows.
  const byReviewer = [...reviewerAgg].map(([id, agg]) => {
    const u = reviewerInfos.get(id);
    const decided = agg.approved + agg.revoked + agg.skipped;
    return {
      reviewerId: id,
      email: u?.email ?? "",
      displayName: u?.displayName ?? id,
      approved: agg.approved,
      revoked: agg.revoked,
      skipped: agg.skipped,
      pending: agg.pending,
      totalAssigned: agg.approved + agg.revoked + agg.skipped + agg.pending + agg.cancelled,
      approvalRate: decided ? Math.round((agg.approved / decided) * 100) : 0,
    };
  });
  byReviewer.sort((a, b) => b.totalAssigned - a.totalAssigned);

  const byApp = [...appAgg].map(([id, agg]) => {
    const decided = agg.approved + agg.revoked + agg.skipped;
    const total = agg.approved + agg.revoked + agg.skipped + agg.pending + agg.cancelled;
    return {
      appId: id,
      appName: appNames.get(id) ?? id.slice(0, 8) + "…",
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
    truncated,
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
    recentActivity: activity,
    trendByDay,
    reviewersWithOpenTasks,
    reviewersWithoutOpenTasks,
    avgReviewTimeDays:
      countDurationMs === 0
        ? null
        : Math.round((sumDurationMs / countDurationMs) / (24 * 60 * 60 * 1000)),
  };
}

// Returns N shards covering [3 years ago, now). C1 rejects createdBefore >= now,
// so the upper bound is clamped to one minute in the past.
function buildShardWindows(n: number): Array<{ after: string; before: string }> {
  const dayMs = 24 * 60 * 60 * 1000;
  const end = Date.now() - 60_000; // 1 minute ago, safely "less than now"
  const start = end - 3 * 365 * dayMs;
  const stepMs = Math.ceil((end - start) / n);
  const out: Array<{ after: string; before: string }> = [];
  for (let i = 0; i < n; i++) {
    const a = new Date(start + i * stepMs);
    const b = new Date(Math.min(end, start + (i + 1) * stepMs));
    out.push({ after: a.toISOString(), before: b.toISOString() });
  }
  return out;
}

async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item === undefined) return;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export function clearCampaignDetailsCache(): void {
  states.clear();
}

// True when a non-stale, well-formed disk cache exists for the campaign. Used by
// the boot-time pre-warm to skip campaigns that are already covered.
export async function hasFreshDiskCache(campaignId: string): Promise<boolean> {
  return (await loadDisk(campaignId)) !== null;
}

export async function clearCampaignDetailsDisk(): Promise<{ aggregated: number; raw: number }> {
  states.clear();
  let aggregated = 0;
  let raw = 0;
  for (const [dirName, counter] of [
    ["campaign-tasks", "aggregated"],
    ["campaign-tasks-raw", "raw"],
  ] as const) {
    try {
      const dir = path.join(config.paths.data, dirName);
      const files = await fs.readdir(dir).catch(() => [] as string[]);
      const targets = files.filter((f) => f.endsWith(".json"));
      await Promise.all(targets.map((f) => fs.unlink(path.join(dir, f)).catch(() => {})));
      if (counter === "aggregated") aggregated = targets.length;
      else raw = targets.length;
    } catch {}
  }
  return { aggregated, raw };
}
