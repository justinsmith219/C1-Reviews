"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSettings = getSettings;
exports.updateSettings = updateSettings;
const storage_1 = require("./storage");
const audit_1 = require("./audit");
const KEY = "settings";
const DEFAULT = {
    defaultRules: {
        reminderCron: "0 9 * * 1-5",
        managerEscalationDaysBeforeDeadline: 3,
        managerEscalationMinIncompletePct: 50,
        skipLevelDaysBeforeDeadline: 1,
    },
    campaignOverrides: {},
};
async function getSettings() {
    const s = await (0, storage_1.readJson)(KEY, null);
    if (!s) {
        await (0, storage_1.writeJson)(KEY, DEFAULT);
        return DEFAULT;
    }
    return s;
}
async function updateSettings(partial, actor) {
    const current = await getSettings();
    const next = {
        defaultRules: { ...current.defaultRules, ...(partial.defaultRules ?? {}) },
        campaignOverrides: partial.campaignOverrides ?? current.campaignOverrides,
    };
    await (0, storage_1.writeJson)(KEY, next);
    await (0, audit_1.audit)({ actor, action: "settings.update", details: { next } });
    return next;
}
//# sourceMappingURL=settings.js.map