"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// End-to-end test for the ConductorOne report API integration.
// Run: npx tsx src/scripts/test-report-api.ts
//   or: npx tsx src/scripts/test-report-api.ts --campaign <id>
require("../config");
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config");
const runtimeConfig_1 = require("../services/runtimeConfig");
const campaignStore_1 = require("../services/campaignStore");
function ok(msg) { console.log(`  ✓  ${msg}`); }
function fail(msg) { console.error(`  ✗  ${msg}`); }
function step(msg) { console.log(`\n[${msg}]`); }
async function main() {
    await (0, runtimeConfig_1.loadAtBoot)();
    const campaignArgIdx = process.argv.indexOf("--campaign");
    let campaignId = campaignArgIdx !== -1 ? process.argv[campaignArgIdx + 1] : null;
    // ── Token ───────────────────────────────────────────────────────────────────
    step("1. Mint OAuth token");
    let token;
    try {
        if (config_1.config.conductor1.apiToken) {
            token = config_1.config.conductor1.apiToken;
            ok("Using static API token from config");
        }
        else {
            const body = new URLSearchParams({
                grant_type: "client_credentials",
                client_id: config_1.config.conductor1.clientId,
                client_secret: config_1.config.conductor1.clientSecret,
            });
            const r = await axios_1.default.post(`${config_1.config.conductor1.baseUrl}/auth/v1/token`, body.toString(), {
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
            });
            token = r.data.access_token;
            ok(`Token minted (expires_in: ${r.data.expires_in ?? "unknown"}s)`);
        }
    }
    catch (err) {
        fail(`Token mint failed: ${err?.response?.status} ${err?.message}`);
        process.exit(1);
    }
    // ── Pick campaign ───────────────────────────────────────────────────────────
    step("2. Select campaign");
    if (!campaignId) {
        const snap = await (0, campaignStore_1.getSnapshot)();
        const open = (snap?.campaigns ?? []).filter(c => c.status === "open");
        if (!open.length) {
            fail("No open campaigns in snapshot — run a refresh first or pass --campaign <id>");
            process.exit(1);
        }
        // Pick the campaign with the fewest reviews (fastest test)
        const sorted = [...open].sort((a, b) => (a.percentComplete ?? 0) - (b.percentComplete ?? 0));
        campaignId = sorted[0].id;
        ok(`Auto-selected: "${sorted[0].name}" (id: ${campaignId})`);
    }
    else {
        ok(`Using provided campaign id: ${campaignId}`);
    }
    const base = `${config_1.config.conductor1.baseUrl}/api/v1`;
    // ── Trigger report ──────────────────────────────────────────────────────────
    step("3. Trigger report generation (POST)");
    try {
        await axios_1.default.post(`${base}/access_review/${encodeURIComponent(campaignId)}/report`, {
            format: "ACCESS_REVIEW_REPORT_FORMAT_JSON",
            reportColumnConfig: {
                columns: [
                    "ACCESS_REVIEW_REPORT_COLUMN_TASK",
                    "ACCESS_REVIEW_REPORT_COLUMN_ACCOUNT",
                    "ACCESS_REVIEW_REPORT_COLUMN_USER_NAME",
                    "ACCESS_REVIEW_REPORT_COLUMN_APPLICATION",
                    "ACCESS_REVIEW_REPORT_COLUMN_ENTITLEMENT",
                    "ACCESS_REVIEW_REPORT_COLUMN_ASSIGNED_TO",
                    "ACCESS_REVIEW_REPORT_COLUMN_DECISIONS",
                    "ACCESS_REVIEW_REPORT_COLUMN_RESOLVED_ON",
                ],
            },
        }, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, timeout: 30_000 });
        ok("POST accepted (200)");
    }
    catch (err) {
        fail(`POST failed: HTTP ${err?.response?.status} — ${JSON.stringify(err?.response?.data ?? "").slice(0, 300)}`);
        process.exit(1);
    }
    // ── Poll ────────────────────────────────────────────────────────────────────
    step("4. Poll for REPORT_STATE_OK (up to 10 min)");
    const POLL_INTERVAL_MS = 4_000;
    const POLL_TIMEOUT_MS = 10 * 60_000;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let downloadUrl = null;
    let pollCount = 0;
    const pollStart = Date.now();
    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        pollCount++;
        process.stdout.write(`\r  polling… attempt ${pollCount} (${Math.round((Date.now() - pollStart) / 1000)}s elapsed)   `);
        const r = await axios_1.default.get(`${base}/access_review/${encodeURIComponent(campaignId)}/report?page_size=1`, { headers: { Authorization: `Bearer ${token}` }, timeout: 30_000 });
        const latest = r.data?.list?.[0];
        if (!latest)
            continue;
        if (latest.state === "REPORT_STATE_OK") {
            const rel = latest.downloadUrl ?? latest.download_url ?? "";
            downloadUrl = rel ? `${config_1.config.conductor1.baseUrl}${rel}` : null;
            console.log(`\n  ✓  Ready after ${pollCount} polls (~${Math.round((Date.now() - pollStart) / 1000)}s). Report id: ${latest.id}`);
            break;
        }
        if (latest.state === "REPORT_STATE_ERROR" || latest.state === "REPORT_STATE_FAILED") {
            console.log();
            fail(`Report generation failed on C1 side: ${latest.state}`);
            process.exit(1);
        }
    }
    if (!downloadUrl) {
        console.log();
        fail(`Timed out after ${POLL_TIMEOUT_MS / 1000}s`);
        process.exit(1);
    }
    // ── Download ────────────────────────────────────────────────────────────────
    step("5. Download report JSON");
    let rows;
    try {
        const resp = await axios_1.default.get(downloadUrl, { timeout: 120_000 });
        rows = resp.data?.rows ?? [];
        ok(`Downloaded — ${rows.length.toLocaleString()} rows`);
        if (resp.data?.columns?.length)
            ok(`Columns: ${resp.data.columns.join(", ")}`);
    }
    catch (err) {
        fail(`Download failed: ${err?.message}`);
        process.exit(1);
    }
    // ── Inspect rows ─────────────────────────────────────────────────────────────
    step("6. Inspect sample rows");
    if (rows.length === 0) {
        console.log("  (no rows — campaign may have no tasks yet)");
    }
    else {
        for (const row of rows.slice(0, 3)) {
            console.log(`  row: AssignedTo="${row["Assigned to"] ?? row["Assigned To"] ?? "(none)"}"  Decision="${row["Decisions"] ?? ""}"  App="${row["Application"] ?? ""}"  ResolvedOn="${row["Resolved On"] ?? ""}"`);
        }
        const assignedTo = rows[0]["Assigned to"] ?? rows[0]["Assigned To"] ?? "";
        const parenMatch = assignedTo.match(/^(.*?)\s*\(([^)]+@[^)]+)\)\s*$/);
        if (parenMatch) {
            ok(`Reviewer format: "Last, First (email)" — parser extracts correctly`);
            ok(`  example: "${assignedTo}" → email="${parenMatch[2]}" displayName="${parenMatch[1]}"`);
        }
        else if (assignedTo.includes("@") && !assignedTo.includes(" ")) {
            ok(`Reviewer format: plain email — handled correctly`);
        }
        else if (assignedTo) {
            console.log(`  ⚠  Unexpected reviewer format: "${assignedTo}" — may need parser update`);
        }
        const decisions = {};
        for (const row of rows) {
            const d = (row["Decisions"] ?? "pending").trim() || "pending";
            decisions[d] = (decisions[d] ?? 0) + 1;
        }
        ok(`Decision distribution: ${Object.entries(decisions).map(([k, v]) => `${k}=${v}`).join("  ")}`);
        const apps = {};
        for (const row of rows) {
            const a = (row["Application"] ?? "").trim();
            if (a)
                apps[a] = (apps[a] ?? 0) + 1;
        }
        const topApps = Object.entries(apps).sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (topApps.length)
            ok(`Top apps: ${topApps.map(([k, v]) => `${k}(${v})`).join("  ")}`);
    }
    console.log("\n✅  All checks passed.\n");
}
main().catch(err => {
    console.error("\nFatal:", err?.message ?? err);
    process.exit(1);
});
//# sourceMappingURL=test-report-api.js.map