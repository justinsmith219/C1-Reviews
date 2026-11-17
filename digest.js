"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startDigestJob = startDigestJob;
const node_cron_1 = __importDefault(require("node-cron"));
const config_1 = require("../config");
const logger_1 = require("../logger");
const digest_1 = require("../services/digest");
const runtimeConfig_1 = require("../services/runtimeConfig");
const jobs_1 = require("../services/jobs");
let task = null;
function schedule() {
    if (task) {
        try {
            task.stop();
        }
        catch { }
        task = null;
    }
    logger_1.logger.info("schedule_digest", { cron: config_1.config.digest.cron, tz: config_1.config.digest.tz });
    (0, jobs_1.update)("daily_digest", { schedule: config_1.config.digest.cron, timezone: config_1.config.digest.tz });
    task = node_cron_1.default.schedule(config_1.config.digest.cron, () => {
        if (!config_1.config.notifications.autoSendEnabled && !config_1.config.notifications.dryRun) {
            logger_1.logger.info("digest_skipped_auto_send_disabled");
            return;
        }
        (0, digest_1.runDailyDigest)({ actor: "system" }).catch((err) => logger_1.logger.error("digest_failed", { err: err?.message }));
    }, { timezone: config_1.config.digest.tz });
}
function startDigestJob() {
    schedule();
    (0, runtimeConfig_1.registerScheduleChangeHandler)(() => schedule());
}
//# sourceMappingURL=digest.js.map