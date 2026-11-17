"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
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
    const all = [];
    let pageToken;
    do {
        const r = await axios_1.default.get(`${base}/access_reviews`, {
            params: { page_size: 100, page_token: pageToken },
            headers: { Authorization: `Bearer ${token}` },
        });
        all.push(...(r.data.list ?? []));
        pageToken = r.data.nextPageToken || undefined;
    } while (pageToken);
    console.log("total campaigns:", all.length);
    const stateCounts = new Map();
    for (const r of all) {
        const s = r.accessReview?.state ?? "NONE";
        stateCounts.set(s, (stateCounts.get(s) ?? 0) + 1);
    }
    console.log("state breakdown:");
    for (const [k, v] of stateCounts)
        console.log(` ${k}: ${v}`);
    console.log("\n=== ALL campaigns in OPEN or PENDING state ===");
    for (const r of all) {
        const s = r.accessReview?.state;
        if (s === "ACCESS_REVIEW_STATE_OPEN" || s === "ACCESS_REVIEW_STATE_PENDING") {
            console.log(" -", s, "|", r.accessReview?.displayName, "| id:", r.accessReview?.id, "| startedAt:", r.accessReview?.startedAt, "| completionDate:", r.accessReview?.completionDate);
        }
    }
    const match = all.find((r) => /quarterly uar apr 2026/i.test(r.accessReview?.displayName ?? ""));
    console.log("\n=== matching 'Quarterly UAR Apr 2026' ===");
    if (match) {
        console.log(JSON.stringify(match.accessReview, null, 2));
    }
    else {
        console.log("not found. candidates with 'uar' or '2026' in name:");
        for (const r of all) {
            const n = r.accessReview?.displayName ?? "";
            if (/uar|2026|quarterly/i.test(n)) {
                console.log(" -", n, "| state:", r.accessReview?.state, "| id:", r.accessReview?.id);
            }
        }
    }
}
main().catch((e) => {
    console.error("failed", e?.response?.data ?? e?.message);
    process.exit(1);
});
//# sourceMappingURL=find-campaign.js.map