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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getReplayBootstrap = getReplayBootstrap;
exports.getReplaySnapshot = getReplaySnapshot;
exports.getReplayMessagePreview = getReplayMessagePreview;
const campaignDetails_1 = require("./campaignDetails");
const scorecards_1 = require("./scorecards");
const campaignStore_1 = require("./campaignStore");
const tiers_1 = require("./tiers");
const config_1 = require("../config");
const orgTree_1 = require("./orgTree");
// Wraps getCampaignDetails. Pass through fetch progress so the client can show
// the same "fetching N pages, M tasks" UX the campaign-detail page uses.
async function getReplayBootstrap(campaignId, actor) {
    const hist = await (0, scorecards_1.getHistory)();
    const histMeta = hist.campaigns.find((c) => c.id === campaignId);
    // Fall back to live snapshot for active campaigns not yet in history.
    const snap = histMeta ? null : await (0, campaignStore_1.getSnapshot)();
    const liveCampaign = snap?.campaigns.find((c) => c.id === campaignId);
    const isActive = !histMeta && !!liveCampaign;
    const meta = histMeta
        ? { name: histMeta.name, openedAt: histMeta.openedAt ?? null, closedAt: histMeta.closedAt ?? null, deadline: histMeta.deadline ?? null }
        : liveCampaign
            ? { name: liveCampaign.name, openedAt: liveCampaign.startDate ?? null, closedAt: null, deadline: liveCampaign.endDate ?? null }
            : null;
    const det = await (0, campaignDetails_1.getCampaignDetails)(campaignId, { actor });
    if (det.status === "fetching") {
        return { status: "fetching", pages: det.pages, tasks: det.tasks };
    }
    if (det.status === "failed") {
        return { status: "failed", err: det.err };
    }
    const data = det.data;
    let earliest = meta?.openedAt ?? "";
    // For active campaigns extend the slider to the deadline (or +30 days from today).
    const today = new Date().toISOString().slice(0, 10);
    let latest = meta?.closedAt ?? meta?.deadline ?? "";
    if (isActive) {
        const extendTo = meta?.deadline ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        if (!latest || extendTo > latest)
            latest = extendTo;
    }
    else {
        for (const a of data.recentActivity) {
            if (!earliest || a.closedAt < earliest)
                earliest = a.closedAt;
            if (!latest || a.closedAt > latest)
                latest = a.closedAt;
        }
    }
    if (!earliest)
        earliest = today;
    return {
        status: "ready",
        isActive,
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
// Given an asOf date and pre-fetched campaign tasks, replay state.
async function getReplaySnapshot(campaignId, asOfIso, actor) {
    const det = await (0, campaignDetails_1.getCampaignDetails)(campaignId, { actor });
    if (det.status !== "ready") {
        return { status: det.status, pages: det.pages, tasks: det.tasks, err: det.err };
    }
    const data = det.data;
    const asOfMs = new Date(asOfIso).getTime();
    // Re-aggregate tiles + per-reviewer stats from the cached recentActivity (top 50)
    // is incomplete. We need ALL tasks. campaignDetails already aggregated them, but
    // we need the closedAt distribution. Rebuild from raw task aggregates by walking
    // recentActivity (top 50) is insufficient. Use byReviewer for reviewer roster
    // and trendByDay for cumulative completion counts.
    const trend = data.trendByDay;
    let cumulativeCompleted = 0;
    for (const day of trend) {
        if (day.date <= asOfIso.slice(0, 10))
            cumulativeCompleted += day.completedThisDay;
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
            if (ts <= asOfIso)
                count++;
            else
                break; // list is sorted ascending
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
    // Forward projection: for dates beyond today, extrapolate each reviewer's
    // pending tasks using their observed velocity (completed / days elapsed).
    const nowIso = new Date().toISOString();
    const isProjected = asOfIso > nowIso;
    let velocityPerDay;
    if (isProjected) {
        const hist2 = await (0, scorecards_1.getHistory)();
        const meta2 = hist2.campaigns.find((c) => c.id === campaignId);
        const liveSnap = meta2 ? null : await (0, campaignStore_1.getSnapshot)();
        const liveCamp = liveSnap?.campaigns.find((c) => c.id === campaignId);
        const campaignStart = meta2?.openedAt ?? liveCamp?.startDate ?? nowIso;
        const daysElapsed = Math.max(1, (Date.now() - new Date(campaignStart).getTime()) / 86_400_000);
        const daysAhead = (new Date(asOfIso).getTime() - Date.now()) / 86_400_000;
        const globalVelocity = cumulativeCompleted / daysElapsed;
        velocityPerDay = globalVelocity;
        let projectedTotalCompleted = 0;
        for (const r of reviewerRoster) {
            const totalAssigned = r.completed + r.pending;
            const rvVelocity = r.completed / Math.max(1, daysElapsed);
            const additionalCompleted = Math.round(rvVelocity * daysAhead);
            const projectedCompleted = Math.min(r.completed + additionalCompleted, totalAssigned);
            r.completed = projectedCompleted;
            r.pending = totalAssigned - projectedCompleted;
            projectedTotalCompleted += projectedCompleted;
        }
        cumulativeCompleted = projectedTotalCompleted;
        pending = Math.max(0, total - cumulativeCompleted);
    }
    const completionFraction = total === 0 ? 0 : cumulativeCompleted / total;
    // Tier eval: based on days-until-deadline at asOf.
    const hist = await (0, scorecards_1.getHistory)();
    const meta = hist.campaigns.find((c) => c.id === campaignId);
    const deadline = meta?.deadline ?? null;
    const { daysUntilDeadline: daysUntilDeadlineFn } = await Promise.resolve().then(() => __importStar(require("../lib/deadline")));
    const daysUntilDeadline = daysUntilDeadlineFn(deadline ?? undefined, new Date(asOfMs));
    const tc = await (0, tiers_1.getTiers)();
    const tier = daysUntilDeadline != null ? (0, tiers_1.selectTier)(tc, daysUntilDeadline) : tc.tiers[0];
    // Build org tree for behind reviewers + their chains.
    const reviewerEmails = reviewerRoster.filter((r) => r.pending > 0).map((r) => r.email);
    const treeSeeds = [
        ...reviewerEmails,
        ...config_1.config.admins,
        config_1.config.orgTop.ceoEmail,
    ];
    const orgTree = await (0, orgTree_1.buildOrgTreeForEmails)(treeSeeds);
    // Predicted notifications.
    const notifications = [];
    if (tier) {
        for (const r of reviewerRoster) {
            if (r.pending === 0)
                continue;
            const audiences = tier.audiences;
            // resolve audience emails using current org tree
            const chain = (0, orgTree_1.managerChain)(orgTree, r.email, {
                stopAtEmail: config_1.config.orgTop.ceoEmail,
                includeStop: !config_1.config.orgTop.excludeCeoFromEscalation,
            });
            const push = (email, reason) => {
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
                if (a === "reviewer")
                    push(r.email, "reviewer");
                else if (a === "manager" && chain[0]?.email)
                    push(chain[0].email, "manager");
                else if (a === "skip" && chain[1]?.email)
                    push(chain[1].email, "skip");
                else if (a === "skip_plus_one" && chain[2]?.email)
                    push(chain[2].email, "skip_plus_one");
                else if (a === "chain_to_ceo") {
                    for (const u of chain)
                        push(u.email, "chain_to_ceo");
                }
                else if (a === "admin") {
                    for (const e of config_1.config.admins)
                        push(e, "admin");
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
        isProjected,
        velocityPerDay,
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
            const audiences = [];
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
async function getReplayMessagePreview(args) {
    const { buildSlackMessage, buildEmail } = await Promise.resolve().then(() => __importStar(require("../templates/reminder")));
    const { getSnapshot } = await Promise.resolve().then(() => __importStar(require("./campaignStore")));
    const { getHistory } = await Promise.resolve().then(() => __importStar(require("./scorecards")));
    const snap = await getSnapshot();
    const hist = await getHistory();
    // Resolve campaign — try live snapshot first, then history metadata.
    const liveCampaign = snap?.campaigns.find((c) => c.id === args.campaignId);
    const histCampaign = hist.campaigns.find((c) => c.id === args.campaignId);
    const campaignName = liveCampaign?.name ?? histCampaign?.name ?? args.campaignId;
    const endDate = liveCampaign?.endDate ?? histCampaign?.deadline ?? undefined;
    // Build a minimal Campaign-shaped object for the template.
    const campaignObj = {
        id: args.campaignId,
        name: campaignName,
        type: liveCampaign?.type ?? "USER_ACCESS",
        status: liveCampaign?.status ?? "OPEN",
        startDate: liveCampaign?.startDate,
        endDate,
        reviewerIds: liveCampaign?.reviewerIds ?? [],
        totalReviews: liveCampaign?.totalReviews ?? 0,
        completedReviews: liveCampaign?.completedReviews ?? 0,
    };
    // Find pending reviews for this reviewer from the live snapshot.
    const pendingReviews = (snap?.reviews ?? []).filter((r) => r.campaignId === args.campaignId &&
        r.status === "pending" &&
        snap?.reviewers.find((rv) => rv.id === r.reviewerId)?.email === args.reviewerEmail);
    // Resolve the reviewer object.
    const reviewerObj = snap?.reviewers.find((rv) => rv.email === args.reviewerEmail) ?? {
        id: args.reviewerEmail,
        email: args.reviewerEmail,
        displayName: args.reviewerEmail,
    };
    // Map reason to notification kind.
    const kindMap = {
        reviewer: "reminder",
        manager: "manager_escalation",
        skip: "skip_level_escalation",
        skip_plus_one: "skip_level_escalation",
        chain_to_ceo: "skip_level_escalation",
        admin: "reminder",
    };
    const kind = kindMap[args.reason] ?? "reminder";
    const ctx = {
        reviewer: reviewerObj,
        campaign: campaignObj,
        pendingReviews,
        daysRemaining: args.daysUntilDeadline,
        kind,
    };
    const slack = buildSlackMessage(ctx);
    const email = buildEmail(ctx);
    const isLive = !!liveCampaign;
    const note = pendingReviews.length === 0 && !isLive
        ? "This is a closed campaign — task list is not available; showing message structure only."
        : pendingReviews.length === 0
            ? "No pending tasks found for this reviewer in the current snapshot."
            : `Task list reflects current live state (${pendingReviews.length} pending).`;
    return { email, slack, taskCount: pendingReviews.length, note };
}
//# sourceMappingURL=replay.js.map