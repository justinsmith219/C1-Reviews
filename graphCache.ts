import { GraphUser } from "./graph";
import { readJson, writeJson } from "./storage";
import { logger } from "../logger";

// Persistent disk cache for Graph user lookups + direct reports.
// Survives server restarts so we don't re-walk Entra every time.
//
// TTL is conservative (org structure rarely changes intra-day) but the cache
// can be wiped via clearGraphCache() if a manager attribute is updated and you
// need fresh data immediately.

const USERS_KEY = "graph-users-cache";
const REPORTS_KEY = "graph-reports-cache";
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface UserCacheFile {
  byEmail: Record<string, { user: GraphUser | null; at: number }>;
  byId: Record<string, { user: GraphUser | null; at: number }>;
}
interface ReportsCacheFile {
  byId: Record<string, { reports: GraphUser[]; at: number }>;
}

let users: UserCacheFile | null = null;
let reports: ReportsCacheFile | null = null;

async function loadUsers(): Promise<UserCacheFile> {
  if (users) return users;
  users = await readJson<UserCacheFile>(USERS_KEY, { byEmail: {}, byId: {} });
  return users;
}
async function loadReports(): Promise<ReportsCacheFile> {
  if (reports) return reports;
  reports = await readJson<ReportsCacheFile>(REPORTS_KEY, { byId: {} });
  return reports;
}

let usersDirty = false;
let reportsDirty = false;
let flushTimer: NodeJS.Timeout | null = null;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    if (usersDirty && users) {
      try {
        await writeJson(USERS_KEY, users);
        usersDirty = false;
      } catch (err: any) {
        logger.warn("graph_cache_flush_failed", { err: err?.message });
      }
    }
    if (reportsDirty && reports) {
      try {
        await writeJson(REPORTS_KEY, reports);
        reportsDirty = false;
      } catch (err: any) {
        logger.warn("graph_cache_flush_failed", { err: err?.message });
      }
    }
  }, 5_000);
}

export async function getCachedUserByEmail(
  email: string
): Promise<{ hit: boolean; user: GraphUser | null }> {
  const cache = await loadUsers();
  const lower = email.toLowerCase();
  const entry = cache.byEmail[lower];
  if (entry && Date.now() - entry.at < TTL_MS) {
    return { hit: true, user: entry.user };
  }
  return { hit: false, user: null };
}

export async function getCachedUserById(
  id: string
): Promise<{ hit: boolean; user: GraphUser | null }> {
  const cache = await loadUsers();
  const entry = cache.byId[id];
  if (entry && Date.now() - entry.at < TTL_MS) {
    return { hit: true, user: entry.user };
  }
  return { hit: false, user: null };
}

export async function setCachedUser(user: GraphUser | null, lookupKey: string): Promise<void> {
  const cache = await loadUsers();
  const at = Date.now();
  if (user) {
    cache.byId[user.id] = { user, at };
    cache.byEmail[user.mail.toLowerCase()] = { user, at };
  } else {
    cache.byEmail[lookupKey.toLowerCase()] = { user: null, at };
  }
  usersDirty = true;
  scheduleFlush();
}

export async function getCachedReports(
  userId: string
): Promise<{ hit: boolean; reports: GraphUser[] }> {
  const cache = await loadReports();
  const entry = cache.byId[userId];
  if (entry && Date.now() - entry.at < TTL_MS) {
    return { hit: true, reports: entry.reports };
  }
  return { hit: false, reports: [] };
}

export async function setCachedReports(userId: string, list: GraphUser[]): Promise<void> {
  const cache = await loadReports();
  cache.byId[userId] = { reports: list, at: Date.now() };
  reportsDirty = true;
  scheduleFlush();
}

export async function clearGraphCache(): Promise<void> {
  users = { byEmail: {}, byId: {} };
  reports = { byId: {} };
  await writeJson(USERS_KEY, users);
  await writeJson(REPORTS_KEY, reports);
}
