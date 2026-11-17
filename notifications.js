"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordNotification = recordNotification;
exports.listNotifications = listNotifications;
const crypto_1 = __importDefault(require("crypto"));
const storage_1 = require("./storage");
const audit_1 = require("./audit");
const KEY = "notifications";
async function recordNotification(rec) {
    const full = {
        id: crypto_1.default.randomUUID(),
        sentAt: new Date().toISOString(),
        ...rec,
    };
    await (0, storage_1.appendJsonl)(KEY, full);
    await (0, audit_1.audit)({
        actor: "system",
        action: full.dryRun ? "notify.dryrun" : full.success ? "notify.sent" : "notify.failed",
        target: full.recipientEmail,
        details: {
            channel: full.channel,
            kind: full.kind,
            campaignId: full.campaignId,
            error: full.error,
            dryRun: full.dryRun,
        },
    });
    return full;
}
async function listNotifications(limit = 500) {
    return (0, storage_1.readJsonl)(KEY, limit);
}
//# sourceMappingURL=notifications.js.map