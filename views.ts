import { CampaignSnapshot, Reviewer, Review, Campaign } from "../types/domain";
import { getSnapshot } from "./campaignStore";
import { SessionUser } from "../types/domain";
import { visibleEmails, isEmailVisible } from "./visibility";
import { daysUntilDeadline } from "../lib/deadline";

async function loadScoped(user: SessionUser): Promise<{
  snap: CampaignSnapshot | null;
  vis: { all: true } | { all: false; emails: Set<string> };
  reviewerById: Map<string, Reviewer>;
}> {
  const snap = await getSnapshot();
  const vis = await visibleEmails(user);
  const reviewerById = new Map<string, Reviewer>();
  for (const r of snap?.reviewers ?? []) reviewerById.set(r.id, r);
  return { snap, vis, reviewerById };
}

// "Reviewer-centric" visibility: include only reviews whose REVIEWER is in the
// visible set. Used for leaderboard / manager rollup / behind-reviewers — places
// where the question is "who on my team is doing the reviewing."
function reviewVisibleByReviewer(
  review: Review,
  reviewerById: Map<string, Reviewer>,
  vis: { all: true } | { all: false; emails: Set<string> }
): boolean {
  if (vis.all) return true;
  const reviewer = reviewerById.get(review.reviewerId);
  return !!(reviewer && isEmailVisible(vis, reviewer.email));
}

// "Subject-or-reviewer" visibility: include reviews where either side is on my
// team. Used for campaign overview / detail / impacted accounts — places where
// you also care about reviews ABOUT your team members done by outsiders.
function reviewVisibleAnySide(
  review: Review,
  reviewerById: Map<string, Reviewer>,
  vis: { all: true } | { all: false; emails: Set<string> }
): boolean {
  if (vis.all) return true;
  const reviewer = reviewerById.get(review.reviewerId);
  if (reviewer && isEmailVisible(vis, reviewer.email)) return true;
  if (isEmailVisible(vis, review.subjectUserEmail)) return true;
  return false;
}

// ---------- Campaign overview ----------

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

function daysBetween(_fromIso: string, toIso?: string): number | undefined {
  return daysUntilDeadline(toIso) ?? undefined;
}

export async function campaignOverview(user: SessionUser): Promise<{
  fetchedAt: string | null;
  rows: CampaignOverviewRow[];
}> {
  const { snap, vis, reviewerById } = await loadScoped(user);
  if (!snap) return { fetchedAt: null, rows: [] };
  const now = new Date().toISOString();

  const rowsFromCampaign = (c: Campaign, scoped?: { total: number; completed: number }) => {
    const total = scoped?.total ?? c.totalReviews;
    const completed = scoped?.completed ?? c.completedReviews;
    return {
      id: c.id,
      name: c.name,
      type: c.type,
      status: c.status,
      startDate: c.startDate,
      endDate: c.endDate,
      daysRemaining: daysBetween(now, c.endDate),
      reviewerCount: c.reviewerIds.length,
      totalReviews: total,
      completedReviews: completed,
      percentComplete: total === 0 ? 0 : Math.round((completed / total) * 100),
    };
  };

  if (vis.all) {
    return { fetchedAt: snap.fetchedAt, rows: snap.campaigns.map((c) => rowsFromCampaign(c)) };
  }

  // Non-admin: recompute totals against visible reviews only.
  const byCampaign = new Map<string, { total: number; completed: number }>();
  for (const r of snap.reviews) {
    if (!reviewVisibleAnySide(r, reviewerById, vis)) continue;
    const agg = byCampaign.get(r.campaignId) ?? { total: 0, completed: 0 };
    agg.total++;
    if (r.status !== "pending") agg.completed++;
    byCampaign.set(r.campaignId, agg);
  }
  const rows = snap.campaigns
    .filter((c) => byCampaign.has(c.id))
    .map((c) => rowsFromCampaign(c, byCampaign.get(c.id)));
  return { fetchedAt: snap.fetchedAt, rows };
}

// ---------- Campaign detail ----------

export async function campaignDetail(user: SessionUser, campaignId: string) {
  const { snap, vis, reviewerById } = await loadScoped(user);
  if (!snap) return null;
  const campaign = snap.campaigns.find((c) => c.id === campaignId);
  if (!campaign) return null;
  const reviews = snap.reviews
    .filter((r) => r.campaignId === campaignId)
    .filter((r) => reviewVisibleAnySide(r, reviewerById, vis));
  const reviewerIds = new Set(reviews.map((r) => r.reviewerId).filter(Boolean));
  const reviewers = [...reviewerIds].map((id) => reviewerById.get(id)).filter(Boolean) as Reviewer[];
  return { campaign, reviews, reviewers };
}

// ---------- Reviewer leaderboard ----------

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

export async function reviewerLeaderboard(user: SessionUser): Promise<LeaderboardRow[]> {
  const { snap, vis, reviewerById } = await loadScoped(user);
  if (!snap) return [];
  const byReviewer = new Map<string, LeaderboardRow>();
  for (const r of snap.reviews) {
    if (!reviewVisibleByReviewer(r, reviewerById, vis)) continue;
    if (!r.reviewerId) continue;
    const reviewer = reviewerById.get(r.reviewerId);
    if (!reviewer) continue;
    let row = byReviewer.get(r.reviewerId);
    if (!row) {
      row = {
        reviewerId: r.reviewerId,
        email: reviewer.email,
        displayName: reviewer.displayName,
        totalAssigned: 0,
        completed: 0,
        percentComplete: 0,
        pendingAcrossCampaigns: 0,
        campaignIds: [],
      };
      byReviewer.set(r.reviewerId, row);
    }
    row.totalAssigned++;
    if (r.status === "pending") row.pendingAcrossCampaigns++;
    else row.completed++;
    if (!row.campaignIds.includes(r.campaignId)) row.campaignIds.push(r.campaignId);
  }
  for (const row of byReviewer.values()) {
    row.percentComplete = row.totalAssigned
      ? Math.round((row.completed / row.totalAssigned) * 100)
      : 0;
  }
  return [...byReviewer.values()].sort((a, b) => a.percentComplete - b.percentComplete);
}

// ---------- Manager rollup ----------

export interface ManagerRollupRow {
  managerEmail: string;
  directReportsCompleted: number;
  directReportsIncomplete: number;
  downstreamCompleted: number;
  downstreamIncomplete: number;
}

// Uses Graph managerEmail on reviewers if populated. For now, we aggregate by
// each reviewer's own email; UI can drill into org tree. This is a v1 approximation.
export async function managerRollup(user: SessionUser): Promise<ManagerRollupRow[]> {
  const board = await reviewerLeaderboard(user);
  // Without manager mapping on reviewers here, return leaderboard rows keyed by email.
  return board.map((r) => ({
    managerEmail: r.email,
    directReportsCompleted: r.completed,
    directReportsIncomplete: r.pendingAcrossCampaigns,
    downstreamCompleted: r.completed,
    downstreamIncomplete: r.pendingAcrossCampaigns,
  }));
}

// ---------- Impacted accounts ----------

export interface ImpactedRow {
  subjectEmail: string;
  subjectName: string;
  entitlements: string[];
  campaignIds: string[];
  reviewers: Array<{ email: string; displayName: string }>;
  // Min days remaining across the subject's pending campaigns (negative = overdue).
  // Null if none of the campaigns have a deadline.
  daysRemaining: number | null;
  // ISO timestamp of the earliest deadline; surfaced for the timer in the UI.
  earliestDeadline?: string;
  riskLevel: "high" | "medium" | "low";
  // Whether the user's Azure AD account is currently enabled. Null when we
  // couldn't resolve the user in Graph (or no cache hit yet).
  accountEnabled: boolean | null;
  // Whether the user's on-prem AD account is currently enabled.
  // null = AD disabled/unconfigured or lookup failed.
  // "not_found" = UPN not in AD (cloud-only user).
  adAccountEnabled: boolean | "not_found" | null;
}

export async function impactedAccounts(user: SessionUser): Promise<ImpactedRow[]> {
  const { snap, vis, reviewerById } = await loadScoped(user);
  if (!snap) return [];
  const bySubject = new Map<string, ImpactedRow>();
  const now = Date.now();
  const campaignEnd = new Map<string, string | undefined>();
  for (const c of snap.campaigns) campaignEnd.set(c.id, c.endDate);

  for (const r of snap.reviews) {
    if (r.status !== "pending") continue;
    if (!reviewVisibleAnySide(r, reviewerById, vis)) continue;
    if (!r.subjectUserEmail) continue;
    const key = r.subjectUserEmail.toLowerCase();
    if (!key.endsWith("@zinnia.com")) continue;
    let row = bySubject.get(key);
    if (!row) {
      row = {
        subjectEmail: key,
        subjectName: r.subjectUserDisplayName ?? key,
        entitlements: [],
        campaignIds: [],
        reviewers: [],
        daysRemaining: null,
        riskLevel: "low",
        accountEnabled: null,
        adAccountEnabled: null,
      };
      bySubject.set(key, row);
    }
    if (r.entitlement && !row.entitlements.includes(r.entitlement)) row.entitlements.push(r.entitlement);
    if (!row.campaignIds.includes(r.campaignId)) row.campaignIds.push(r.campaignId);
    const reviewer = reviewerById.get(r.reviewerId);
    if (reviewer && !row.reviewers.some((x) => x.email === reviewer.email)) {
      row.reviewers.push({ email: reviewer.email, displayName: reviewer.displayName });
    }

    const end = campaignEnd.get(r.campaignId);
    if (end) {
      const daysLeft = daysUntilDeadline(end);
      if (daysLeft != null) {
        if (row.daysRemaining == null || daysLeft < row.daysRemaining) {
          row.daysRemaining = daysLeft;
          row.earliestDeadline = end;
        }
        if (daysLeft < 0 && row.riskLevel !== "high") row.riskLevel = "high";
        else if (daysLeft <= 5 && row.riskLevel === "low") row.riskLevel = "medium";
      }
    }
  }
  // Account status is fetched lazily by the client after the list loads.
  // Doing it here caused 504 timeouts through Azure App Proxy for large campaigns.
  const subjects = [...bySubject.values()];

  return subjects.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 } as const;
    return order[a.riskLevel] - order[b.riskLevel];
  });
}

// ---------- My queue ----------

export async function myQueue(user: SessionUser) {
  const snap = await getSnapshot();
  if (!snap) return { pending: [], completed: [] };
  const mine = snap.reviewers.find((r) => r.email === user.email);
  if (!mine) return { pending: [], completed: [] };
  const campaignNameById = new Map(snap.campaigns.map((c) => [c.id, c.name]));
  const rows = snap.reviews
    .filter((r) => r.reviewerId === mine.id)
    .map((r) => ({ ...r, campaignName: campaignNameById.get(r.campaignId) }));
  return {
    pending: rows.filter((r) => r.status === "pending"),
    completed: rows.filter((r) => r.status !== "pending"),
  };
}
