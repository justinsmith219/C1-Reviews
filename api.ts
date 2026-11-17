export type Role = "admin" | "manager" | "reviewer" | "ea";

export interface SessionUser {
  email: string;
  displayName: string;
  roles: Role[];
  supportsExecs: string[];
  impersonating?: { originalEmail: string; originalDisplayName: string };
}

export type ViewAs = "admin" | "manager" | "reviewer";

// Keys are scoped by the signed-in user's email so that two different users
// on the same machine (same browser origin) never share impersonation or
// view-as state. Call scopeLocalStorage(me.email) once after /auth/me resolves.
let _lsScope = "";
export function scopeLocalStorage(email: string): void {
  _lsScope = email.toLowerCase();
}
function lsKey(base: string): string {
  return _lsScope ? `campaign-manager:${_lsScope}:${base}` : `campaign-manager:${base}`;
}

export function getViewAs(): ViewAs {
  if (typeof window === "undefined") return "admin";
  const v = window.localStorage.getItem(lsKey("viewAs"));
  return v === "manager" || v === "reviewer" ? v : "admin";
}
export function setViewAs(v: ViewAs): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(lsKey("viewAs"), v);
}
export function getImpersonate(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(lsKey("impersonate")) ?? "";
}
export function setImpersonate(email: string): void {
  if (typeof window === "undefined") return;
  if (email) window.localStorage.setItem(lsKey("impersonate"), email.toLowerCase());
  else window.localStorage.removeItem(lsKey("impersonate"));
}
export function clearLocalStorageForUser(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(lsKey("viewAs"));
  window.localStorage.removeItem(lsKey("impersonate"));
}

// Vite's import.meta.env.BASE_URL is "/" in dev or "/C1-reviews/" in prod.
// We strip the trailing slash so callers can pass paths like "/api/foo".
const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
export function withBase(p: string): string {
  if (/^https?:\/\//i.test(p)) return p;
  return `${BASE}${p.startsWith("/") ? "" : "/"}${p}`;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-View-As": getViewAs(),
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  const imp = getImpersonate();
  if (imp) headers["X-Impersonate"] = imp;
  const res = await fetch(withBase(path), {
    credentials: "include",
    headers,
    ...init,
  });
  if (res.status === 401) {
    window.location.href = `${BASE}/auth/login?returnTo=${encodeURIComponent(window.location.pathname)}`;
    throw new Error("unauthenticated");
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as any;
  return res.json() as Promise<T>;
}

export const api = {
  me: () => req<SessionUser>("/auth/me"),
  logout: () => req<{ ok: true }>("/auth/logout", { method: "POST" }),
  campaigns: () => req<{ fetchedAt: string | null; rows: CampaignOverviewRow[] }>("/api/campaigns"),
  campaignDetail: (id: string) => req<CampaignDetail>(`/api/campaigns/${id}`),
  campaignStats: (id: string, force = false) =>
    req<CampaignDetailsResponse>(`/api/campaigns/${id}/details${force ? "?force=1" : ""}`),
  leaderboard: () => req<LeaderboardRow[]>("/api/leaderboard"),
  managers: () => req<ManagerRollupRow[]>("/api/managers"),
  impacted: () => req<ImpactedRow[]>("/api/impacted"),
  myQueue: () => req<{ pending: ReviewRow[]; completed: ReviewRow[] }>("/api/my-queue"),
  trend: () => req<TrendRow[]>("/api/trend"),
  notifications: () => req<NotificationRow[]>("/api/notifications"),
  refresh: () => req<{ ok: true; fetchedAt: string; campaigns: number }>("/api/refresh", { method: "POST" }),
  audit: () => req<AuditRow[]>("/api/admin/audit"),
  eaMappings: () => req<EaMapping[]>("/api/admin/ea-mappings"),
  addEaMapping: (eaEmail: string, execEmail: string) =>
    req<EaMapping[]>("/api/admin/ea-mappings", {
      method: "POST",
      body: JSON.stringify({ eaEmail, execEmail }),
    }),
  removeEaMapping: (eaEmail: string, execEmail: string) =>
    req<EaMapping[]>("/api/admin/ea-mappings", {
      method: "DELETE",
      body: JSON.stringify({ eaEmail, execEmail }),
    }),
  getSettings: () => req<AppSettings>("/api/admin/settings"),
  updateSettings: (s: Partial<AppSettings>) =>
    req<AppSettings>("/api/admin/settings", { method: "PUT", body: JSON.stringify(s) }),
  notify: (campaignId: string, reviewerEmails: string[], kind = "manual") =>
    req<{ sent: number; skipped: number; errors: string[] }>("/api/admin/notify", {
      method: "POST",
      body: JSON.stringify({ campaignId, reviewerEmails, kind }),
    }),
  getConfig: () => req<RuntimeConfig>("/api/admin/config"),
  updateConfig: (c: Partial<RuntimeConfig>) =>
    req<RuntimeConfig>("/api/admin/config", { method: "PUT", body: JSON.stringify(c) }),
  testConnections: () =>
    req<ConnectionTestResult>("/api/admin/config/test", { method: "POST" }),
  orgTree: () => req<OrgViewResult>("/api/org-tree"),
  behind: () => req<BehindRow[]>("/api/escalation/behind"),
  search: (q: string) => req<SearchResult>(`/api/search?q=${encodeURIComponent(q)}`),
  profile: (email: string) => req<ProfileResult>(`/api/profile/${encodeURIComponent(email)}`),
  getTiers: () => req<TierConfig>("/api/admin/tiers"),
  saveTiers: (tc: TierConfig) =>
    req<TierConfig>("/api/admin/tiers", { method: "PUT", body: JSON.stringify(tc) }),
  getTemplates: () => req<TemplateStore>("/api/admin/templates"),
  saveTemplate: (doc: TemplateDoc, campaignId?: string) =>
    req<TemplateStore>("/api/admin/templates", {
      method: "PUT",
      body: JSON.stringify({ doc, campaignId }),
    }),
  clearTemplate: (section: string, channel: string, campaignId: string) =>
    req<TemplateStore>("/api/admin/templates", {
      method: "DELETE",
      body: JSON.stringify({ section, channel, campaignId }),
    }),
  previewTemplate: (section: string, channel: string, bodyMarkdown: string, subject?: string) =>
    req<{ rendered: string; subject?: string; sampleContext: { reviewerName: string; campaignName: string } }>(
      "/api/admin/templates/preview",
      { method: "POST", body: JSON.stringify({ section, channel, bodyMarkdown, subject }) }
    ),
  listSuppressions: () => req<Suppression[]>("/api/admin/suppressions"),
  addSuppression: (email: string, untilDate: string, reason?: string) =>
    req<Suppression[]>("/api/admin/suppressions", {
      method: "POST",
      body: JSON.stringify({ email, untilDate, reason }),
    }),
  removeSuppression: (email: string) =>
    req<Suppression[]>("/api/admin/suppressions", {
      method: "DELETE",
      body: JSON.stringify({ email }),
    }),
  importHistory: (fresh = false) =>
    req<{ campaigns: any[]; lastImportedAt?: string }>(
      `/api/admin/history/import${fresh ? "?fresh=1" : ""}`,
      { method: "POST" }
    ),
  historicalCampaigns: () => req<{ campaigns: any[]; lastImportedAt?: string }>("/api/admin/history"),
  scorecards: () => req<ScorecardRow[]>("/api/scorecards"),
  scorecardTree: () => req<{ fetchedAt: string; root: ScorecardNode | null }>("/api/scorecards/tree"),
  historyCampaigns: () =>
    req<{ campaigns: HistoricalCampaignRow[]; lastImportedAt?: string }>("/api/history/campaigns"),
  recomputeScorecards: () => req<ScorecardRow[]>("/api/admin/scorecards/recompute", { method: "POST" }),
  clearGraphCache: () =>
    req<{ ok: true }>("/api/admin/graph-cache/clear", { method: "POST" }),
  clearCampaignCache: () =>
    req<{ ok: true; aggregated: number; raw: number }>("/api/admin/campaign-cache/clear", { method: "POST" }),
  prewarmCampaigns: () =>
    req<{ ok: true }>("/api/admin/campaign-cache/prewarm", { method: "POST" }),
  setAzureEnabled: (email: string, enable: boolean, campaignIds: string[]) =>
    req<{ ok: boolean; enable: boolean; error?: string }>("/api/admin/users/set-azure-enabled", {
      method: "POST",
      body: JSON.stringify({ email, enable, campaignIds }),
    }),
  setAdEnabled: (email: string, enable: boolean, campaignIds: string[]) =>
    req<{ ok: boolean; enable: boolean; message?: string; skipped?: boolean }>("/api/admin/users/set-ad-enabled", {
      method: "POST",
      body: JSON.stringify({ email, enable, campaignIds }),
    }),
  batchSetEnabled: (changes: BatchChange[]) =>
    req<BatchResult>("/api/admin/users/batch-set-enabled", {
      method: "POST",
      body: JSON.stringify({ changes }),
    }),
  accountStatus: (email: string) =>
    req<{ email: string; enabled: boolean | null }>(
      `/api/users/${encodeURIComponent(email)}/account-status`
    ),
  adStatus: (email: string) =>
    req<{ email: string; enabled: boolean | "not_found" | null }>(
      `/api/users/${encodeURIComponent(email)}/ad-status`
    ),
  jobs: () => req<JobInfo[]>("/api/admin/jobs"),
  runDigest: (dryRun = false) =>
    req<DigestRunResult>("/api/admin/digest/run", {
      method: "POST",
      body: JSON.stringify({ dryRun }),
    }),
  replayBootstrap: (campaignId: string) =>
    req<ReplayBootstrap>(`/api/replay/${encodeURIComponent(campaignId)}/bootstrap`),
  replayState: (campaignId: string, asOf: string) =>
    req<ReplaySnapshot | { status: "fetching" | "failed"; pages?: number; tasks?: number; err?: string }>(
      `/api/replay/${encodeURIComponent(campaignId)}/state?asOf=${encodeURIComponent(asOf)}`
    ),
};

export interface ReplayBootstrap {
  status: "fetching" | "ready" | "failed";
  pages?: number;
  tasks?: number;
  err?: string;
  campaign?: {
    id: string;
    name: string;
    openedAt: string | null;
    closedAt: string | null;
    deadline: string | null;
    totalTasks: number;
  };
  earliestEvent?: string;
  latestEvent?: string;
}

export interface ReplaySnapshot {
  asOf: string;
  campaignId: string;
  campaignName: string;
  deadline: string | null;
  daysUntilDeadline: number | null;
  totals: {
    total: number;
    completed: number;
    pending: number;
    approved: number;
    revoked: number;
    skipped: number;
    cancelled: number;
    percentComplete: number;
  };
  reviewers: Array<{
    email: string;
    displayName: string;
    pending: number;
    completed: number;
    tierId?: string;
    tierName?: string;
    audiences: string[];
  }>;
  notifications: Array<{
    recipientEmail: string;
    recipientReason: "reviewer" | "manager" | "skip" | "skip_plus_one" | "chain_to_ceo" | "admin";
    reviewerEmail: string;
    reviewerName: string;
    tierName: string;
    pendingCount: number;
  }>;
}

export interface OrgNode {
  email: string;
  displayName: string;
  accountEnabled: boolean;
  pending: number;
  completed: number;
  children: OrgNode[];
  isCEO: boolean;
  isAdmin: boolean;
  isReviewer: boolean;
  isBehind: boolean;
  isSelf: boolean;
}
export interface OrgViewResult {
  fetchedAt: string;
  root: OrgNode | null;
  flat: OrgNode[];
}
export interface BehindRow {
  reviewerId: string;
  reviewerEmail: string;
  reviewerName: string;
  campaignId: string;
  campaignName: string;
  pending: number;
  daysUntilDeadline: number | null;
  tierId?: string;
  tierName?: string;
  audiences: string[];
}
export interface SearchResult {
  people: Array<{ email: string; displayName: string; roles: string[] }>;
  campaigns: Array<{ id: string; name: string }>;
  historicalCampaigns?: Array<{ id: string; name: string }>;
  entitlements: string[];
}
export interface ProfileResult {
  email: string;
  user: { email: string; displayName: string; accountEnabled: boolean } | null;
  managerChain: Array<{ email: string; displayName: string }>;
  asReviewer: { pending: ReviewRow[]; completed: ReviewRow[] };
  asSubject: ReviewRow[];
  historicalAsReviewer: Array<{
    campaignId: string;
    campaignName: string;
    openedAt?: string;
    closedAt?: string;
    deadline?: string;
    assigned: number;
    completed: number;
    onTime: number;
  }>;
}
export interface TierConfig {
  tiers: Array<{
    id: string;
    name: string;
    daysUntilDeadlineAtMost: number;
    frequency: "weekly" | "daily";
    audiences: string[];
  }>;
}
export interface TemplateDoc {
  section: string;
  channel: "email" | "slack";
  subject?: string;
  bodyMarkdown: string;
}
export interface TemplateStore {
  global: Record<string, TemplateDoc>;
  perCampaign: Record<string, Record<string, TemplateDoc>>;
}
export interface Suppression {
  email: string;
  untilDate: string;
  reason?: string;
  createdBy: string;
  createdAt: string;
}
export interface ScorecardRow {
  managerEmail: string;
  managerName: string;
  campaignsParticipated: number;
  totalAssigned: number;
  totalCompleted: number;
  totalOnTime: number;
  onTimePct: number;
  completedPct: number;
  teamOnTimePct: number;
  teamCompletedPct: number;
}

export interface ScorecardNode {
  email: string;
  displayName: string;
  isCEO: boolean;
  isSelf: boolean;
  hasOwnData: boolean;
  campaignsParticipated: number;
  totalAssigned: number;
  totalCompleted: number;
  totalOnTime: number;
  onTimePct: number;
  completedPct: number;
  teamAssigned: number;
  teamCompleted: number;
  teamOnTime: number;
  teamCompletedPct: number;
  teamOnTimePct: number;
  children: ScorecardNode[];
}
export interface DigestRunResult {
  sent: number;
  skipped: number;
  plans: number;
  suppressed: number;
  errors: string[];
}
export interface HistoricalCampaignRow {
  id: string;
  name: string;
  type: string;
  openedAt?: string;
  closedAt?: string;
  deadline?: string;
  totalReviews: number;
  completedReviews: number;
  onTimeReviews: number;
  reviewerCompletion: Array<{
    email: string;
    assigned: number;
    completed: number;
    onTime: number;
  }>;
}

export interface JobInfo {
  id: string;
  name: string;
  kind: "scheduled" | "on-demand";
  schedule?: string;
  timezone?: string;
  status: "idle" | "running" | "success" | "failed";
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  message?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  details?: Record<string, unknown>;
}

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
  reviewerTimeline?: Record<string, string[]>;
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
  trendByDay: Array<{
    date: string;
    open: number;
    completedThisDay: number;
    reviewersCompleted: number;
    reviewersInProgress: number;
    reviewersNotStarted: number;
    completedNames: Array<{ email: string; displayName: string }>;
    inProgressNames: Array<{ email: string; displayName: string }>;
    notStartedNames: Array<{ email: string; displayName: string }>;
  }>;
  reviewersWithOpenTasks: number;
  reviewersWithoutOpenTasks: number;
  avgReviewTimeDays: number | null;
}

export interface RuntimeConfig {
  conductor1: {
    baseUrl: string;
    clientId: string;
    clientSecret: string;
    apiToken: string;
  };
  entra: {
    tenantId: string;
    clientId: string;
    clientSecret: string;
  };
  adminEmails: string[];
  slack: { botToken: string };
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
    allowInvalidCerts: boolean;
  };
  orgTop: {
    ceoEmail: string;
    excludeCeoFromEscalation: boolean;
  };
  digest: {
    timeOfDay: string;
    skipWeekends: boolean;
  };
  schedule: {
    scorecardsTime: string;
    refreshIntervalHours: number;
    prewarmIntervalHours: number;
  };
  notifications: {
    autoSendEnabled: boolean;
    adminNotificationsEnabled: boolean;
    testRecipient: string;
    dryRun?: boolean;
    adminDryRun?: boolean;
  };
  helpdeskNotification: {
    enabled: boolean;
    slackChannel: string;
  };
  completionAlert: {
    enabled: boolean;
    channel: "slack-channel" | "slack-dm" | "email";
    recipient: string;
  };
  ad: {
    enabled: boolean;
    domain: string;
    username: string;
    password: string;
  };
}

export interface ConnectionTestResult {
  conductor1: { ok: boolean; message: string };
  entra: { ok: boolean; message: string };
  slack: { ok: boolean; message: string };
  smtp: { ok: boolean; message: string };
}

export interface CampaignOverviewRow {
  id: string;
  name: string;
  type: string;
  status: string;
  startDate?: string;
  endDate?: string;
  daysRemaining?: number;
  reviewerCount: number;
  totalReviews: number;
  completedReviews: number;
  percentComplete: number;
}
export interface ReviewRow {
  id: string;
  campaignId: string;
  campaignName?: string;
  reviewerId: string;
  subjectUserId?: string;
  subjectUserEmail?: string;
  subjectUserDisplayName?: string;
  entitlement?: string;
  status: "pending" | "approved" | "revoked" | "skipped";
  decidedAt?: string;
}
export interface CampaignDetail {
  campaign: CampaignOverviewRow;
  reviews: ReviewRow[];
  reviewers: { id: string; email: string; displayName: string }[];
}
export interface LeaderboardRow {
  reviewerId: string;
  email: string;
  displayName: string;
  totalAssigned: number;
  completed: number;
  percentComplete: number;
  pendingAcrossCampaigns: number;
  campaignIds: string[];
}
export interface ManagerRollupRow {
  managerEmail: string;
  directReportsCompleted: number;
  directReportsIncomplete: number;
  downstreamCompleted: number;
  downstreamIncomplete: number;
}
export interface BatchChange {
  email: string;
  azure?: boolean;
  ad?: boolean;
  campaignIds: string[];
}

export interface BatchResult {
  succeeded: Array<{ email: string; azure?: { ok: boolean }; ad?: { ok: boolean } }>;
  failed: Array<{ email: string; system: "azure" | "ad"; error: string }>;
}

export interface ImpactedRow {
  subjectEmail: string;
  subjectName: string;
  entitlements: string[];
  campaignIds: string[];
  reviewers: Array<{ email: string; displayName: string }>;
  daysRemaining: number | null;
  earliestDeadline?: string;
  riskLevel: "high" | "medium" | "low";
  accountEnabled: boolean | null;
  adAccountEnabled: boolean | "not_found" | null;
}
export interface TrendRow {
  at: string;
  campaigns: number;
  reviews: number;
  completed: number;
  byCampaign: { id: string; name: string; total: number; completed: number; pct: number }[];
}
export interface NotificationRow {
  id: string;
  sentAt: string;
  channel: "slack" | "email";
  kind: string;
  recipientEmail: string;
  campaignId?: string;
  success: boolean;
  error?: string;
  subject?: string;
  body?: string;
  dryRun?: boolean;
}
export interface AuditRow {
  at: string;
  actor: string;
  action: string;
  target?: string;
  details?: Record<string, unknown>;
}
export interface EaMapping {
  eaEmail: string;
  execEmail: string;
  createdAt: string;
  createdBy: string;
}
export interface AppSettings {
  defaultRules: {
    reminderCron: string;
    managerEscalationDaysBeforeDeadline: number;
    managerEscalationMinIncompletePct: number;
    skipLevelDaysBeforeDeadline: number;
  };
  campaignOverrides: Record<
    string,
    Partial<AppSettings["defaultRules"]> & { disabled?: boolean }
  >;
}
