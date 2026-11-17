import { Campaign, CampaignSnapshot, EscalationTier, NotificationAudience, OrgTree, Review, Reviewer, TierConfig } from "../types/domain";
import { config } from "../config";
import { selectTier } from "./tiers";
import { managerChain } from "./orgTree";

export interface BehindReviewerRow {
  reviewer: Reviewer;
  campaign: Campaign;
  pending: Review[];
  tier: EscalationTier | null;
  daysUntilDeadline: number | null;
}

import { daysUntilDeadline } from "../lib/deadline";

// Every reviewer x campaign combination where the reviewer has pending tasks.
// Tagged with the current escalation tier.
export function behindReviewers(snap: CampaignSnapshot, tc: TierConfig): BehindReviewerRow[] {
  const rows: BehindReviewerRow[] = [];
  const reviewerById = new Map(snap.reviewers.map((r) => [r.id, r]));
  for (const campaign of snap.campaigns) {
    if (campaign.status !== "open") continue;
    const d = daysUntilDeadline(campaign.endDate);
    const perReviewer = new Map<string, Review[]>();
    for (const r of snap.reviews) {
      if (r.campaignId !== campaign.id || r.status !== "pending" || !r.reviewerId) continue;
      const list = perReviewer.get(r.reviewerId) ?? [];
      list.push(r);
      perReviewer.set(r.reviewerId, list);
    }
    for (const [reviewerId, pending] of perReviewer) {
      const reviewer = reviewerById.get(reviewerId);
      if (!reviewer) continue;
      const tier = d == null ? tc.tiers[0] : selectTier(tc, d);
      rows.push({ reviewer, campaign, pending, tier, daysUntilDeadline: d });
    }
  }
  return rows;
}

// Given a reviewer and the audiences required for their tier, resolve the actual
// email addresses that should receive a notification on this reviewer's behalf.
// Skips gaps, stops at the CEO (excluded per config), and returns audience -> email[].
export function resolveAudiences(
  reviewer: Reviewer,
  tree: OrgTree,
  audiences: NotificationAudience[]
): Partial<Record<NotificationAudience, string[]>> {
  const out: Partial<Record<NotificationAudience, string[]>> = {};
  const ceo = config.orgTop.ceoEmail;
  const excludeCeo = config.orgTop.excludeCeoFromEscalation;

  const self = tree.byEmail[reviewer.email];
  const chain = managerChain(tree, reviewer.email, {
    stopAtEmail: ceo,
    includeStop: !excludeCeo,
  });

  const reviewerDisabled = self ? !self.accountEnabled : false;

  for (const a of audiences) {
    switch (a) {
      case "reviewer":
        out.reviewer = reviewerDisabled ? [] : [reviewer.email];
        break;
      case "manager":
        out.manager = chain[0]?.email ? [chain[0].email] : [];
        break;
      case "skip":
        out.skip = chain[1]?.email ? [chain[1].email] : [];
        break;
      case "skip_plus_one":
        out.skip_plus_one = chain[2]?.email ? [chain[2].email] : [];
        break;
      case "chain_to_ceo":
        out.chain_to_ceo = chain.map((u) => u.email).filter(Boolean);
        break;
      case "admin":
        out.admin = [...config.admins];
        break;
    }
  }
  return out;
}

// Flattened set of all recipient emails for a given tier.
export function recipientsForTier(
  row: BehindReviewerRow,
  tree: OrgTree
): { emails: Set<string>; audiencesByEmail: Map<string, NotificationAudience[]> } {
  const emails = new Set<string>();
  const audiencesByEmail = new Map<string, NotificationAudience[]>();
  if (!row.tier) return { emails, audiencesByEmail };
  const resolved = resolveAudiences(row.reviewer, tree, row.tier.audiences);
  for (const [audience, list] of Object.entries(resolved)) {
    for (const email of list ?? []) {
      emails.add(email);
      const existing = audiencesByEmail.get(email) ?? [];
      if (!existing.includes(audience as NotificationAudience)) existing.push(audience as NotificationAudience);
      audiencesByEmail.set(email, existing);
    }
  }
  return { emails, audiencesByEmail };
}
