import { getCampaignDetails, CampaignDetailsResponse } from "./campaignDetails";
import { getHistory } from "./scorecards";
import { getTiers, selectTier } from "./tiers";
import { config } from "../config";
import { buildOrgTreeForEmails, managerChain } from "./orgTree";
import { logger } from "../logger";

// "Replay" simulates how the system would behave for a previously-closed campaign,
// stepping through time. Source of truth: each task's closedAt timestamp pulled
// from ConductorOne via the standard campaign-details fetch (uncapped).

export interface ReplayState {
  status: "fetching" | "ready" | "failed";
  pages?: number;
  tasks?: number;
  err?: string;
  // Present when status === "ready":
  campaign?: {
    id: string;
    name: string;
    openedAt: string | null;
    closedAt: string | null;
    deadline: string | null;
    totalTasks: number;
  };
  // Histogram bounds (so the client can build a slider).
  earliestEvent?: string;
  latestEvent?: string;
}

// Wraps getCampaignDetails. Pass through fetch progress so the client can show
// the same "fetching N pages, M tasks" UX the campaign-detail page uses.
export async function getReplayBootstrap(campaignId: string, actor: string): Promise<ReplayState> {
  const hist = await getHistory();
  const meta = hist.campaigns.find((c) => c.id === campaignId);

  const det: CampaignDetailsResponse = await getCampaignDetails(campaignId, { actor });
  if (det.status === "fetching") {
    return { status: "fetching", pages: det.pages, tasks: det.tasks };
  }
  if (det.status === "failed") {
    return { status: "failed", err: det.err };
  }
  const data = det.data!;
  let earliest = meta?.openedAt ?? "";
  let latest = meta?.closedAt ?? meta?.deadline ?? "";
  for (const a of data.recentActivity) {
    if (!earliest || a.closedAt < earliest) earliest = a.closedAt;
    if (!latest || a.closedAt > latest) latest = a.closedAt;
  }

  return {
    status: "ready",
    campaign: {
      id: campaignId,
      name: meta?.name ?? campaignId,
      openedAt: meta?.openedAt ?? null,
      closedAt: meta?.closedAt ?? null,
      deadline: meta?.deadline ?? null,
      totalTasks: data.totalFetched,
    },
    earliestEvent: earliest || undefined,
    latestEvent: latest || undefined,
  };
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
  // Notifications that would fire on this exact asOf date if the engine ran today.
  // Preview-only; nothing is actually sent.
  notifications: Array<{
    recipientEmail: string;
    recipientReason:
      | "reviewer"
      | "manager"
      | "skip"
      | "skip_plus_one"
      | "chain_to_ceo"
      | "admin";
    reviewerEmail: string;
    reviewerName: string;
    tierName: string;
    pendingCount: number;
  }>;
}

// Given an asOf date and pre-fetched campaign tasks, replay state.
export async function getReplaySnapshot(
  campaignId: string,
  asOfIso: string,
  actor: string
): Promise<ReplaySnapshot | { status: "fetching" | "failed"; pages?: number; tasks?: number; err?: string }> {
  const det = await getCampaignDetails(campaignId, { actor });
  if (det.status !== "ready") {
    return { status: det.status, pages: det.pages, tasks: det.tasks, err: det.err };
  }
  const data = det.data!;
  const asOfMs = new Date(asOfIso).getTime();

  // Re-aggregate tiles + per-reviewer stats from the cached recentActivity (top 50)
  // is incomplete. We need ALL tasks. campaignDetails already aggregated them, but
  // we need the closedAt distribution. Rebuild from raw task aggregates by walking
  // recentActivity (top 50) is insufficient. Use byReviewer for reviewer roster
  // and trendByDay for cumulative completion counts.
  const trend = data.trendByDay;
  let cumulativeCompleted = 0;
  for (const day of trend) {
    if (day.date <= asOfIso.slice(0, 10)) cumulativeCompleted += day.completedThisDay;
  }
  const total = data.totalFetched;
  // (cumulativeCompleted gets refined below using per-reviewer timeline.)
  let pending = Math.max(0, total - cumulativeCompleted);

  // Per-reviewer state: use the exact per-reviewer closedAt timeline captured at
  // fetch time. For each reviewer, count how many of their tasks were already
  // closed at or before asOf — that's their "completed at this point". Pending
  // is whatever remains of their totalAssigned.
  const timeline = data.reviewerTimeline ?? {};
  // Recompute the global cumulative count from the per-reviewer timeline so it
  // matches exactly (the trendByDay was day-bucketed; this is to-the-second).
  let cumulativeCompletedExact = 0;
  const reviewerRoster = data.byReviewer.map((r) => {
    const list = timeline[r.email] ?? [];
    let count = 0;
    for (const ts of list) {
      if (ts <= asOfIso) count++;
      else break; // list is sorted ascending
    }
    cumulativeCompletedExact += count;
    return {
      email: r.email,
      displayName: r.displayName,
      pending: Math.max(0, r.totalAssigned - count),
      completed: count,
    };
  });
  // Prefer the exact count if available; fall back to the day-bucketed total.
  if (Object.keys(timeline).length > 0) {
    cumulativeCompleted = cumulativeCompletedExact;
    pending = Math.max(0, total - cumulativeCompleted);
  }
  const completionFraction = total === 0 ? 0 : cumulativeCompleted / total;

  // Tier eval: based on days-until-deadline at asOf.
  const hist = await getHistory();
  const meta = hist.campaigns.find((c) => c.id === campaignId);
  const deadline = meta?.deadline ?? null;
  const { daysUntilDeadline: daysUntilDeadlineFn } = await import("../lib/deadline");
  const daysUntilDeadline = daysUntilDeadlineFn(deadline ?? undefined, new Date(asOfMs));
  const tc = await getTiers();
  const tier = daysUntilDeadline != null ? selectTier(tc, daysUntilDeadline) : tc.tiers[0];

  // Build org tree for behind reviewers + their chains.
  const reviewerEmails = reviewerRoster.filter((r) => r.pending > 0).map((r) => r.email);
  const treeSeeds = [
    ...reviewerEmails,
    ...config.admins,
    config.orgTop.ceoEmail,
  ];
  const orgTree = await buildOrgTreeForEmails(treeSeeds);

  // Predicted notifications.
  const notifications: ReplaySnapshot["notifications"] = [];
  if (tier) {
    for (const r of reviewerRoster) {
      if (r.pending === 0) continue;
      const audiences = tier.audiences;
      // resolve audience emails using current org tree
      const chain = managerChain(orgTree, r.email, {
        stopAtEmail: config.orgTop.ceoEmail,
        includeStop: !config.orgTop.excludeCeoFromEscalation,
      });
      const push = (email: string, reason: ReplaySnapshot["notifications"][number]["recipientReason"]) => {
        notifications.push({
          recipientEmail: email,
          recipientReason: reason,
          reviewerEmail: r.email,
          reviewerName: r.displayName,
          tierName: tier.name,
          pendingCount: r.pending,
        });
      };
      for (const a of audiences) {
        if (a === "reviewer") push(r.email, "reviewer");
        else if (a === "manager" && chain[0]?.email) push(chain[0].email, "manager");
        else if (a === "skip" && chain[1]?.email) push(chain[1].email, "skip");
        else if (a === "skip_plus_one" && chain[2]?.email) push(chain[2].email, "skip_plus_one");
        else if (a === "chain_to_ceo") {
          for (const u of chain) push(u.email, "chain_to_ceo");
        } else if (a === "admin") {
          for (const e of config.admins) push(e, "admin");
        }
      }
    }
  }

  return {
    asOf: asOfIso,
    campaignId,
    campaignName: meta?.name ?? campaignId,
    deadline,
    daysUntilDeadline,
    totals: {
      total,
      completed: cumulativeCompleted,
      pending,
      // We don't have per-state breakdown over time, only overall final counts.
      // Approximate by scaling final outcomes proportionally to completion.
      approved: Math.round(data.tiles.approved * completionFraction),
      revoked: Math.round(data.tiles.revoked * completionFraction),
      skipped: Math.round(data.tiles.skipped * completionFraction),
      cancelled: Math.round(data.tiles.cancelled * completionFraction),
      percentComplete: total === 0 ? 0 : Math.round((cumulativeCompleted / total) * 100),
    },
    reviewers: reviewerRoster
      .map((r) => {
        const audiences: string[] = [];
        if (r.pending > 0 && tier) {
          audiences.push(...tier.audiences);
        }
        return {
          ...r,
          tierId: r.pending > 0 ? tier?.id : undefined,
          tierName: r.pending > 0 ? tier?.name : undefined,
          audiences,
        };
      })
      .sort((a, b) => b.pending - a.pending),
    notifications,
  };
}
