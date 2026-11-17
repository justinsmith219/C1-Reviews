"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.campaignOverview = campaignOverview;
exports.campaignDetail = campaignDetail;
exports.reviewerLeaderboard = reviewerLeaderboard;
exports.managerRollup = managerRollup;
exports.impactedAccounts = impactedAccounts;
exports.myQueue = myQueue;
const campaignStore_1 = require("./campaignStore");
const visibility_1 = require("./visibility");
const deadline_1 = require("../lib/deadline");
async function loadScoped(user) {
    const snap = await (0, campaignStore_1.getSnapshot)();
    const vis = await (0, visibility_1.visibleEmails)(user);
    const reviewerById = new Map();
    for (const r of snap?.reviewers ?? [])
        reviewerById.set(r.id, r);
    return { snap, vis, reviewerById };
}
// "Reviewer-centric" visibility: include only reviews whose REVIEWER is in the
// visible set. Used for leaderboard / manager rollup / behind-reviewers — places
// where the question is "who on my team is doing the reviewing."
function reviewVisibleByReviewer(review, reviewerById, vis) {
    if (vis.all)
        return true;
    const reviewer = reviewerById.get(review.reviewerId);
    return !!(reviewer && (0, visibility_1.isEmailVisible)(vis, reviewer.email));
}
// "Subject-or-reviewer" visibility: include reviews where either side is on my
// team. Used for campaign overview / detail / impacted accounts — places where
// you also care about reviews ABOUT your team members done by outsiders.
function reviewVisibleAnySide(review, reviewerById, vis) {
    if (vis.all)
        return true;
    const reviewer = reviewerById.get(review.reviewerId);
    if (reviewer && (0, visibility_1.isEmailVisible)(vis, reviewer.email))
        return true;
    if ((0, visibility_1.isEmailVisible)(vis, review.subjectUserEmail))
        return true;
    return false;
}
function daysBetween(_fromIso, toIso) {
    return (0, deadline_1.daysUntilDeadline)(toIso) ?? undefined;
}
async function campaignOverview(user) {
    const { snap, vis, reviewerById } = await loadScoped(user);
    if (!snap)
        return { fetchedAt: null, rows: [] };
    const now = new Date().toISOString();
    const rowsFromCampaign = (c, scoped) => {
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
    const byCampaign = new Map();
    for (const r of snap.reviews) {
        if (!reviewVisibleAnySide(r, reviewerById, vis))
            continue;
        const agg = byCampaign.get(r.campaignId) ?? { total: 0, completed: 0 };
        agg.total++;
        if (r.status !== "pending")
            agg.completed++;
        byCampaign.set(r.campaignId, agg);
    }
    const rows = snap.campaigns
        .filter((c) => byCampaign.has(c.id))
        .map((c) => rowsFromCampaign(c, byCampaign.get(c.id)));
    return { fetchedAt: snap.fetchedAt, rows };
}
// ---------- Campaign detail ----------
async function campaignDetail(user, campaignId) {
    const { snap, vis, reviewerById } = await loadScoped(user);
    if (!snap)
        return null;
    const campaign = snap.campaigns.find((c) => c.id === campaignId);
    if (!campaign)
        return null;
    const reviews = snap.reviews
        .filter((r) => r.campaignId === campaignId)
        .filter((r) => reviewVisibleAnySide(r, reviewerById, vis));
    const reviewerIds = new Set(reviews.map((r) => r.reviewerId).filter(Boolean));
    const reviewers = [...reviewerIds].map((id) => reviewerById.get(id)).filter(Boolean);
    return { campaign, reviews, reviewers };
}
async function reviewerLeaderboard(user) {
    const { snap, vis, reviewerById } = await loadScoped(user);
    if (!snap)
        return [];
    const byReviewer = new Map();
    for (const r of snap.reviews) {
        if (!reviewVisibleByReviewer(r, reviewerById, vis))
            continue;
        if (!r.reviewerId)
            continue;
        const reviewer = reviewerById.get(r.reviewerId);
        if (!reviewer)
            continue;
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
        if (r.status === "pending")
            row.pendingAcrossCampaigns++;
        else
            row.completed++;
        if (!row.campaignIds.includes(r.campaignId))
            row.campaignIds.push(r.campaignId);
    }
    for (const row of byReviewer.values()) {
        row.percentComplete = row.totalAssigned
            ? Math.round((row.completed / row.totalAssigned) * 100)
            : 0;
    }
    return [...byReviewer.values()].sort((a, b) => a.percentComplete - b.percentComplete);
}
// Uses Graph managerEmail on reviewers if populated. For now, we aggregate by
// each reviewer's own email; UI can drill into org tree. This is a v1 approximation.
async function managerRollup(user) {
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
async function impactedAccounts(user) {
    const { snap, vis, reviewerById } = await loadScoped(user);
    if (!snap)
        return [];
    const bySubject = new Map();
    const now = Date.now();
    const campaignEnd = new Map();
    const campaignName = new Map();
    for (const c of snap.campaigns) {
        campaignEnd.set(c.id, c.endDate);
        campaignName.set(c.id, c.name);
    }
    for (const r of snap.reviews) {
        if (r.status !== "pending")
            continue;
        if (!reviewVisibleAnySide(r, reviewerById, vis))
            continue;
        if (!r.subjectUserEmail)
            continue;
        const key = r.subjectUserEmail.toLowerCase();
        if (!key.endsWith("@zinnia.com"))
            continue;
        let row = bySubject.get(key);
        if (!row) {
            row = {
                subjectEmail: key,
                subjectName: r.subjectUserDisplayName ?? key,
                entitlements: [],
                campaignIds: [],
                campaigns: [],
                reviewers: [],
                daysRemaining: null,
                riskLevel: "low",
                accountEnabled: null,
                adAccountEnabled: null,
            };
            bySubject.set(key, row);
        }
        if (r.entitlement && !row.entitlements.includes(r.entitlement))
            row.entitlements.push(r.entitlement);
        if (!row.campaignIds.includes(r.campaignId)) {
            row.campaignIds.push(r.campaignId);
            row.campaigns.push({ id: r.campaignId, name: campaignName.get(r.campaignId) ?? r.campaignId });
        }
        const reviewer = reviewerById.get(r.reviewerId);
        if (reviewer && !row.reviewers.some((x) => x.email === reviewer.email)) {
            row.reviewers.push({ email: reviewer.email, displayName: reviewer.displayName });
        }
        const end = campaignEnd.get(r.campaignId);
        if (end) {
            const daysLeft = (0, deadline_1.daysUntilDeadline)(end);
            if (daysLeft != null) {
                if (row.daysRemaining == null || daysLeft < row.daysRemaining) {
                    row.daysRemaining = daysLeft;
                    row.earliestDeadline = end;
                }
                if (daysLeft < 0 && row.riskLevel !== "high")
                    row.riskLevel = "high";
                else if (daysLeft <= 5 && row.riskLevel === "low")
                    row.riskLevel = "medium";
            }
        }
    }
    // Account status is fetched lazily by the client after the list loads.
    // Doing it here caused 504 timeouts through Azure App Proxy for large campaigns.
    const subjects = [...bySubject.values()];
    return subjects.sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return order[a.riskLevel] - order[b.riskLevel];
    });
}
// ---------- My queue ----------
async function myQueue(user) {
    const snap = await (0, campaignStore_1.getSnapshot)();
    if (!snap)
        return { pending: [], completed: [] };
    const mine = snap.reviewers.find((r) => r.email === user.email);
    if (!mine)
        return { pending: [], completed: [] };
    const campaignNameById = new Map(snap.campaigns.map((c) => [c.id, c.name]));
    const rows = snap.reviews
        .filter((r) => r.reviewerId === mine.id)
        .map((r) => ({ ...r, campaignName: campaignNameById.get(r.campaignId) }));
    return {
        pending: rows.filter((r) => r.status === "pending"),
        completed: rows.filter((r) => r.status !== "pending"),
    };
}
//# sourceMappingURL=views.js.map