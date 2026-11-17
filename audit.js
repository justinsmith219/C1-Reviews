"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.audit = audit;
exports.getAuditLog = getAuditLog;
const storage_1 = require("./storage");
const logger_1 = require("../logger");
async function audit(event) {
    const record = { at: new Date().toISOString(), ...event };
    try {
        await (0, storage_1.appendJsonl)("audit-log", record);
    }
    catch (err) {
        logger_1.logger.error("audit_write_failed", { err: String(err), event: record });
    }
}
async function getAuditLog(limit = 500) {
    return (0, storage_1.readJsonl)("audit-log", limit);
}
//# sourceMappingURL=audit.js.map