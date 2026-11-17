import { ConfidentialClientApplication } from "@azure/msal-node";
import { Client } from "@microsoft/microsoft-graph-client";
import "cross-fetch/polyfill";
import { config } from "../config";
import { logger } from "../logger";
import {
  getCachedUserByEmail,
  getCachedUserById,
  setCachedUser,
  getCachedReports,
  setCachedReports,
} from "./graphCache";

// MS Graph service. Uses app-only (client credentials) for directory reads:
// user lookup, manager chain, transitive direct reports.

let appClient: Client | null = null;
let appToken: { value: string; expiresAt: number } | null = null;

export function resetGraphClient(): void {
  appClient = null;
  appToken = null;
  userByEmailCache.clear();
}

// Re-export so admins can clear the persistent Graph cache from the UI.
export { clearGraphCache } from "./graphCache";

function appOnlyMsal(): ConfidentialClientApplication {
  return new ConfidentialClientApplication({
    auth: {
      clientId: config.entra.clientId,
      clientSecret: config.entra.clientSecret,
      authority: `https://login.microsoftonline.com/${config.entra.tenantId}`,
    },
  });
}

async function getAppToken(): Promise<string> {
  const now = Date.now();
  if (appToken && appToken.expiresAt - 60_000 > now) return appToken.value;
  const client = appOnlyMsal();
  const res = await client.acquireTokenByClientCredential({
    scopes: ["https://graph.microsoft.com/.default"],
  });
  if (!res?.accessToken) throw new Error("Graph: failed to acquire app token");
  appToken = {
    value: res.accessToken,
    expiresAt: res.expiresOn?.getTime() ?? now + 55 * 60_000,
  };
  return appToken.value;
}

export async function graphClient(): Promise<Client> {
  if (appClient) return appClient;
  appClient = Client.init({
    authProvider: async (done) => {
      try {
        const token = await getAppToken();
        done(null, token);
      } catch (err) {
        done(err as Error, null);
      }
    },
  });
  return appClient;
}

// ---------- User lookups ----------

export interface GraphUser {
  id: string;
  mail: string;
  userPrincipalName: string;
  displayName: string;
  managerId?: string;
  accountEnabled?: boolean;
}

const userByEmailCache = new Map<string, { user: GraphUser | null; at: number }>();
const CACHE_TTL_MS = 10 * 60_000;

function cacheGet(email: string): GraphUser | null | undefined {
  const entry = userByEmailCache.get(email.toLowerCase());
  if (!entry) return undefined;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    userByEmailCache.delete(email.toLowerCase());
    return undefined;
  }
  return entry.user;
}

function cacheSet(email: string, user: GraphUser | null) {
  userByEmailCache.set(email.toLowerCase(), { user, at: Date.now() });
}

export async function getUserByEmail(email: string): Promise<GraphUser | null> {
  const lower = email.toLowerCase();
  const inMem = cacheGet(lower);
  if (inMem !== undefined) return inMem;
  const disk = await getCachedUserByEmail(lower);
  if (disk.hit) {
    cacheSet(lower, disk.user);
    return disk.user;
  }
  const gc = await graphClient();
  try {
    const res = await gc
      .api(`/users/${encodeURIComponent(lower)}`)
      .select("id,mail,userPrincipalName,displayName,accountEnabled")
      .get();
    let managerId: string | undefined;
    try {
      const m = await gc.api(`/users/${res.id}/manager`).select("id").get();
      managerId = m?.id;
    } catch {
      // no manager set
    }
    const user: GraphUser = {
      id: res.id,
      mail: (res.mail ?? res.userPrincipalName ?? lower).toLowerCase(),
      userPrincipalName: res.userPrincipalName,
      displayName: res.displayName ?? lower,
      managerId,
      accountEnabled: res.accountEnabled !== false,
    };
    cacheSet(lower, user);
    await setCachedUser(user, lower);
    return user;
  } catch (err: any) {
    logger.warn("graph_user_lookup_failed", { email: lower, status: err?.statusCode });
    cacheSet(lower, null);
    await setCachedUser(null, lower);
    return null;
  }
}

export async function getManagerChain(email: string): Promise<GraphUser[]> {
  const chain: GraphUser[] = [];
  const gc = await graphClient();
  let current = await getUserByEmail(email);
  const seen = new Set<string>();
  while (current?.managerId && !seen.has(current.managerId)) {
    seen.add(current.managerId);
    try {
      const m = await gc
        .api(`/users/${current.managerId}`)
        .select("id,mail,userPrincipalName,displayName")
        .get();
      let nextManagerId: string | undefined;
      try {
        const mm = await gc.api(`/users/${m.id}/manager`).select("id").get();
        nextManagerId = mm?.id;
      } catch {}
      const mu: GraphUser = {
        id: m.id,
        mail: (m.mail ?? m.userPrincipalName ?? "").toLowerCase(),
        userPrincipalName: m.userPrincipalName,
        displayName: m.displayName ?? m.userPrincipalName,
        managerId: nextManagerId,
      };
      chain.push(mu);
      current = mu;
    } catch {
      break;
    }
  }
  return chain;
}

export async function getUserById(graphUserId: string): Promise<GraphUser | null> {
  const disk = await getCachedUserById(graphUserId);
  if (disk.hit) return disk.user;
  const gc = await graphClient();
  try {
    const res = await gc
      .api(`/users/${graphUserId}`)
      .select("id,mail,userPrincipalName,displayName,accountEnabled")
      .get();
    let managerId: string | undefined;
    try {
      const m = await gc.api(`/users/${res.id}/manager`).select("id").get();
      managerId = m?.id;
    } catch {}
    const user: GraphUser = {
      id: res.id,
      mail: (res.mail ?? res.userPrincipalName ?? "").toLowerCase(),
      userPrincipalName: res.userPrincipalName,
      displayName: res.displayName ?? res.userPrincipalName,
      managerId,
      accountEnabled: res.accountEnabled !== false,
    };
    await setCachedUser(user, user.mail);
    return user;
  } catch {
    await setCachedUser(null, graphUserId);
    return null;
  }
}

// Disable (or re-enable) an Azure AD user account. Requires the app
// registration to have Microsoft Graph application permission "User.ReadWrite.All"
// with admin consent — without it, Graph returns 403.
export async function setUserAccountEnabled(
  email: string,
  enabled: boolean
): Promise<{ ok: boolean; error?: string }> {
  const lower = email.toLowerCase();
  try {
    const u = await getUserByEmail(lower);
    if (!u) return { ok: false, error: "user_not_found" };
    const gc = await graphClient();
    await gc.api(`/users/${u.id}`).patch({ accountEnabled: enabled });
    return { ok: true };
  } catch (err: any) {
    const status = err?.statusCode ?? err?.code;
    const msg = err?.body ? String(err.body).slice(0, 300) : err?.message ?? "graph_error";
    logger.warn("graph_set_account_enabled_failed", { email: lower, enabled, status, msg });
    return { ok: false, error: `${status ?? "error"}: ${msg}` };
  }
}

// Force-fresh single-user lookup that bypasses both in-memory and disk caches.
// Used by the UI to verify a disable actually took effect (Graph PATCH is
// async-ish — the change usually propagates in <1s but caches stale faster).
export async function fetchAccountEnabled(email: string): Promise<boolean | null> {
  const lower = email.toLowerCase();
  try {
    const gc = await graphClient();
    const res = await gc
      .api(`/users/${encodeURIComponent(lower)}`)
      .select("id,mail,userPrincipalName,displayName,accountEnabled")
      .get();
    // Treat null/undefined as indeterminate (Graph propagating) — return null
    // so the UI doesn't falsely show "enabled" mid-propagation.
    const enabled: boolean | null =
      res.accountEnabled === true
        ? true
        : res.accountEnabled === false
        ? false
        : null;
    // Update both caches so subsequent /impacted reads see the new state.
    const fresh: GraphUser = {
      id: res.id,
      mail: (res.mail ?? res.userPrincipalName ?? lower).toLowerCase(),
      userPrincipalName: res.userPrincipalName,
      displayName: res.displayName ?? lower,
      accountEnabled: enabled ?? undefined,
    };
    cacheSet(lower, fresh);
    await setCachedUser(fresh, lower);
    return enabled;
  } catch (err: any) {
    logger.warn("graph_fetch_account_enabled_failed", { email: lower, status: err?.statusCode });
    return null;
  }
}

// Returns true if the user currently has an auto-reply (OOF) enabled.
export async function isUserOutOfOffice(email: string): Promise<boolean> {
  const gc = await graphClient();
  try {
    const res = await gc
      .api(`/users/${encodeURIComponent(email.toLowerCase())}/mailboxSettings/automaticRepliesSetting`)
      .get();
    const status = (res?.status ?? "").toString().toLowerCase();
    return status === "alwaysenabled" || status === "scheduled";
  } catch (err: any) {
    logger.debug("oof_check_failed", { email, err: err?.message });
    return false;
  }
}

// Get the immediate direct reports of a user (cached).
export async function getDirectReports(userId: string): Promise<GraphUser[]> {
  const disk = await getCachedReports(userId);
  if (disk.hit) return disk.reports;
  const gc = await graphClient();
  const out: GraphUser[] = [];
  let pageUrl: string | null = `/users/${userId}/directReports?$select=id,mail,userPrincipalName,displayName,accountEnabled`;
  while (pageUrl) {
    try {
      const res: any = await gc.api(pageUrl).get();
      for (const r of res.value ?? []) {
        const mu: GraphUser = {
          id: r.id,
          mail: (r.mail ?? r.userPrincipalName ?? "").toLowerCase(),
          userPrincipalName: r.userPrincipalName,
          displayName: r.displayName ?? r.userPrincipalName,
          accountEnabled: r.accountEnabled !== false,
        };
        out.push(mu);
      }
      pageUrl = res["@odata.nextLink"] ?? null;
    } catch (err: any) {
      logger.warn("graph_direct_reports_failed", { userId, err: err?.message });
      break;
    }
  }
  await setCachedReports(userId, out);
  return out;
}

// Transitive direct reports (entire org tree below a user). Uses cached direct
// reports per node, so subsequent calls touching the same subtree are fast.
export async function getDownstreamReports(userId: string): Promise<GraphUser[]> {
  const out: GraphUser[] = [];
  const seen = new Set<string>([userId]);
  const queue: string[] = [userId];
  while (queue.length) {
    const id = queue.shift()!;
    const direct = await getDirectReports(id);
    for (const r of direct) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        out.push(r);
        queue.push(r.id);
      }
    }
  }
  return out;
}
