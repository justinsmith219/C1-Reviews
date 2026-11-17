import { CampaignSnapshot } from "../types/domain";
import { readJson, writeJson, appendJsonl, readJsonl } from "./storage";
import { fetchCampaignSnapshot } from "./conductor1";
import { audit } from "./audit";
import { logger } from "../logger";
import { register as registerJob, start as startJob, finish as finishJob } from "./jobs";

registerJob({ id: "campaigns_refresh", name: "Active campaigns refresh", kind: "scheduled" });

const SNAPSHOT_KEY = "campaign-snapshot";
const HISTORY_KEY = "campaign-history"; // jsonl: one compact snapshot summary per refresh

let refreshInFlight: Promise<CampaignSnapshot> | null = null;

export async function getSnapshot(): Promise<CampaignSnapshot | null> {
  return readJson<CampaignSnapshot | null>(SNAPSHOT_KEY, null);
}

export async function refresh(actor = "system"): Promise<CampaignSnapshot> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    startJob("campaigns_refresh", `triggered by ${actor}`);
    try {
      const snap = await fetchCampaignSnapshot();
      await writeJson(SNAPSHOT_KEY, snap);
      await appendJsonl(HISTORY_KEY, {
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
      await audit({
        actor,
        action: "refresh.campaigns",
        details: { campaigns: snap.campaigns.length, reviews: snap.reviews.length },
      });
      finishJob("campaigns_refresh", {
        ok: true,
        message: `${snap.campaigns.length} campaigns, ${snap.reviews.length} reviews`,
        details: { campaigns: snap.campaigns.length, reviews: snap.reviews.length },
      });
      return snap;
    } catch (err: any) {
      logger.error("refresh_failed", { err: err?.message, stack: err?.stack });
      await audit({ actor, action: "refresh.campaigns.failed", details: { err: err?.message } });
      finishJob("campaigns_refresh", { ok: false, message: err?.message });
      throw err;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function getHistory(limit = 200): Promise<any[]> {
  return readJsonl<any>(HISTORY_KEY, limit);
}
