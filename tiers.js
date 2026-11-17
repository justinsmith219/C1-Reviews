"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_TIERS = void 0;
exports.getTiers = getTiers;
exports.saveTiers = saveTiers;
exports.selectTier = selectTier;
exports.describeAudience = describeAudience;
exports.shouldFireToday = shouldFireToday;
const storage_1 = require("./storage");
const audit_1 = require("./audit");
const KEY = "tiers";
exports.DEFAULT_TIERS = {
    tiers: [
        {
            id: "tier0",
            name: "Gentle reminder",
            daysUntilDeadlineAtMost: 9999,
            frequency: "weekly",
            audiences: ["reviewer"],
        },
        {
            id: "tier0_daily",
            name: "Gentle reminder (final week)",
            daysUntilDeadlineAtMost: 7,
            frequency: "daily",
            audiences: ["reviewer"],
        },
        {
            id: "tier1",
            name: "Add direct manager",
            daysUntilDeadlineAtMost: 3,
            frequency: "daily",
            audiences: ["reviewer", "manager"],
        },
        {
            id: "tier2",
            name: "Add skip-level",
            daysUntilDeadlineAtMost: 2,
            frequency: "daily",
            audiences: ["reviewer", "manager", "skip"],
        },
        {
            id: "tier3",
            name: "Add skip-plus-one",
            daysUntilDeadlineAtMost: 1,
            frequency: "daily",
            audiences: ["reviewer", "manager", "skip", "skip_plus_one"],
        },
        {
            id: "tier4",
            name: "Overdue — escalate to CEO",
            daysUntilDeadlineAtMost: -1, // triggers the day after the deadline
            frequency: "daily",
            audiences: ["reviewer", "manager", "skip", "skip_plus_one", "chain_to_ceo", "admin"],
        },
    ],
};
async function getTiers() {
    const t = await (0, storage_1.readJson)(KEY, null);
    if (!t) {
        await (0, storage_1.writeJson)(KEY, exports.DEFAULT_TIERS);
        return exports.DEFAULT_TIERS;
    }
    return t;
}
async function saveTiers(tc, actor) {
    // Sort by daysUntilDeadlineAtMost ascending so the most severe (smallest/negative) tier wins.
    const sorted = {
        tiers: [...tc.tiers].sort((a, b) => a.daysUntilDeadlineAtMost - b.daysUntilDeadlineAtMost),
    };
    await (0, storage_1.writeJson)(KEY, sorted);
    await (0, audit_1.audit)({ actor, action: "tiers.save", details: { count: sorted.tiers.length } });
    return sorted;
}
// Pick the active tier for a given daysUntilDeadline value.
// Walk tiers from smallest daysUntilDeadlineAtMost upward and pick the first match.
function selectTier(tc, daysUntilDeadline) {
    const sorted = [...tc.tiers].sort((a, b) => a.daysUntilDeadlineAtMost - b.daysUntilDeadlineAtMost);
    for (const tier of sorted) {
        if (daysUntilDeadline <= tier.daysUntilDeadlineAtMost)
            return tier;
    }
    return sorted[sorted.length - 1] ?? null;
}
// Helper for the UI.
function describeAudience(a) {
    switch (a) {
        case "reviewer":
            return "Reviewer";
        case "manager":
            return "Direct manager";
        case "skip":
            return "Skip-level (2 up)";
        case "skip_plus_one":
            return "Skip +1 (3 up)";
        case "chain_to_ceo":
            return "Full chain → CEO";
        case "admin":
            return "Admins";
    }
}
// Decide if a tier should fire today. Weekly tiers fire on the first configured weekday
// of a work week (Monday); daily tiers fire any weekday.
function shouldFireToday(tier, now = new Date()) {
    const dow = now.getDay(); // 0=Sun..6=Sat
    if (dow === 0 || dow === 6)
        return false; // weekends: never (enforced elsewhere too)
    if (tier.frequency === "daily")
        return true;
    if (tier.frequency === "weekly")
        return dow === 1; // Monday
    return false;
}
//# sourceMappingURL=tiers.js.map