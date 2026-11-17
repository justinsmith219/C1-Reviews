"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// One-off: dump the raw first access_review record + first task to see field shapes.
// Run: npx tsx src/scripts/dump-c1.ts
require("../config");
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config");
const runtimeConfig_1 = require("../services/runtimeConfig");
async function getToken() {
    if (config_1.config.conductor1.apiToken)
        return config_1.config.conductor1.apiToken;
    const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config_1.config.conductor1.clientId,
        client_secret: config_1.config.conductor1.clientSecret,
    });
    const r = await axios_1.default.post(`${config_1.config.conductor1.baseUrl}/auth/v1/token`, body.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    return r.data.access_token;
}
async function main() {
    await (0, runtimeConfig_1.loadAtBoot)();
    const token = await getToken();
    const base = `${config_1.config.conductor1.baseUrl}/api/v1`;
    const reviews = await axios_1.default.get(`${base}/access_reviews`, {
        params: { page_size: 50 },
        headers: { Authorization: `Bearer ${token}` },
    });
    const list = reviews.data.list ?? [];
    console.log("total list length:", list.length);
    console.log("states seen:", [...new Set(list.map((r) => r.accessReview?.state))].join(", "));
    const openOnes = list.filter((r) => r.accessReview?.state === "ACCESS_REVIEW_STATE_OPEN");
    console.log("open count:", openOnes.length);
    const first = openOnes[0] ?? list[0];
    const firstId = first?.accessReview?.id;
    console.log("=== chosen review (first open or first) ===");
    console.log("id:", firstId, "state:", first?.accessReview?.state, "name:", first?.accessReview?.displayName);
    if (firstId) {
        console.log("\n=== /search/tasks for first review ===");
        const tasks = await axios_1.default.post(`${base}/search/tasks`, { accessReviewIds: [firstId], pageSize: 2 }, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
        console.log("response keys:", Object.keys(tasks.data));
        const firstTask = tasks.data.list?.[0];
        const t = firstTask?.task ?? firstTask;
        console.log("=== first task top-level keys ===");
        console.log(Object.keys(firstTask ?? {}));
        console.log("=== task inner keys ===");
        console.log(Object.keys(t ?? {}));
        console.log("=== task key fields ===");
        console.log(JSON.stringify({
            id: t?.id,
            displayName: t?.displayName,
            description: t?.description,
            state: t?.state,
            type: t?.type,
            taskType: t?.taskType,
            processing: t?.processing,
            userId: t?.userId,
            subjectUserId: t?.subjectUserId,
            assigneeUserId: t?.assigneeUserId,
            currentAssigneeUserId: t?.currentAssigneeUserId,
            assigneeUserIds: t?.assigneeUserIds,
            approverIds: t?.approverIds,
            stepApproverIds: t?.stepApproverIds,
            accessReviewId: t?.accessReviewId,
            closedAt: t?.closedAt,
            createdAt: t?.createdAt,
            updatedAt: t?.updatedAt,
        }, null, 2));
        console.log("=== type/certify deep ===");
        console.log(JSON.stringify(t?.type, null, 2));
        console.log("=== expanded count ===", (tasks.data.expanded ?? []).length);
        console.log("=== first 2 expanded ===");
        console.log(JSON.stringify((tasks.data.expanded ?? []).slice(0, 2), null, 2));
    }
}
main().catch((e) => {
    console.error("failed", e?.response?.data ?? e?.message);
    process.exit(1);
});
//# sourceMappingURL=dump-c1.js.map