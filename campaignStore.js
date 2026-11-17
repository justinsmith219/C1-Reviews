"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSnapshot = getSnapshot;
exports.refresh = refresh;
exports.getHistory = getHistory;
const storage_1 = require("./storage");
const conductor1_1 = require("./conductor1");
const audit_1 = require("./audit");
const logger_1 = require("../logger");
const jobs_1 = require("./jobs");
(0, jobs_1.register)({ id: "campaigns_refresh", name: "Active campaigns refresh", kind: "scheduled" });
const SNAPSHOT_KEY = "campaign-snapshot";
const HISTORY_KEY = "campaign-history"; // jsonl: one compact snapshot summary per refresh
let refreshInFlight = null;
async function getSnapshot() {
    return (0, storage_1.readJson)(SNAPSHOT_KEY, null);
}
async function refresh(actor = "system") {
    if (refreshInFlight)
        return refreshInFlight;
    refreshInFlight = (async () => {
        (0, jobs_1.start)("campaigns_refresh", `triggered by ${actor}`);
        try {
            const snap = await (0, conductor1_1.fetchCampaignSnapshot)();
            await (0, storage_1.writeJson)(SNAPSHOT_KEY, snap);
            await (0, storage_1.appendJsonl)(HISTORY_KEY, {
                at: snap.fetchedAt,
                campaigns: snap.campaigns.length,
                reviews: snap.reviews.length,
                completed: snap.reviews.filter((r) => r.status !== "pending").length,
                byCampaign: snap.campaigns.map((c) => ({
                    id: c.id,
                    name: c.name,
                    total: c.totalReviews,
                    completed: c.completedReviews,
                    pct: c.percentComplete,
                })),
            });
            await (0, audit_1.audit)({
                actor,
                action: "refresh.campaigns",
                details: { campaigns: snap.campaigns.length, reviews: snap.reviews.length },
            });
            (0, jobs_1.finish)("campaigns_refresh", {
                ok: true,
                message: `${snap.campaigns.length} campaigns, ${snap.reviews.length} reviews`,
                details: { campaigns: snap.campaigns.length, reviews: snap.reviews.length },
            });
            return snap;
        }
        catch (err) {
            logger_1.logger.error("refresh_failed", { err: err?.message, stack: err?.stack });
            await (0, audit_1.audit)({ actor, action: "refresh.campaigns.failed", details: { err: err?.message } });
            (0, jobs_1.finish)("campaigns_refresh", { ok: false, message: err?.message });
            throw err;
        }
        finally {
            refreshInFlight = null;
        }
    })();
    return refreshInFlight;
}
async function getHistory(limit = 200) {
    return (0, storage_1.readJsonl)(HISTORY_KEY, limit);
}
//# sourceMappingURL=campaignStore.js.map