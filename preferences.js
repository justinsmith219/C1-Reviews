"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPreferences = getPreferences;
exports.setPreferences = setPreferences;
const storage_1 = require("./storage");
const KEY = "user-preferences";
const DEFAULTS = { clockFormat: "12h" };
async function getPreferences(email) {
    const store = await (0, storage_1.readJson)(KEY, { byEmail: {} });
    const lower = email.toLowerCase();
    return { ...DEFAULTS, ...(store.byEmail[lower] ?? {}) };
}
async function setPreferences(email, patch) {
    const store = await (0, storage_1.readJson)(KEY, { byEmail: {} });
    const lower = email.toLowerCase();
    const next = { ...DEFAULTS, ...(store.byEmail[lower] ?? {}), ...patch };
    store.byEmail[lower] = next;
    await (0, storage_1.writeJson)(KEY, store);
    return next;
}
//# sourceMappingURL=preferences.js.map