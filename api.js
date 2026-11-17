"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiRouter = void 0;
const express_1 = require("express");
const rbac_1 = require("../middleware/rbac");
const views_1 = require("../services/views");
const campaignStore_1 = require("../services/campaignStore");
const audit_1 = require("../services/audit");
const eaMappings_1 = require("../services/eaMappings");
const notifications_1 = require("../services/notifications");
const settings_1 = require("../services/settings");
const notifier_1 = require("../services/notifier");
const runtimeConfig_1 = require("../services/runtimeConfig");
const connectionTests_1 = require("../services/connectionTests");
const tiers_1 = require("../services/tiers");
const templates_1 = require("../services/templates");
const suppressions_1 = require("../services/suppressions");
const scorecards_1 = require("../services/scorecards");
const digest_1 = require("../services/digest");
const orgView_1 = require("../services/orgView");
const campaignStore_2 = require("../services/campaignStore");
const escalation_1 = require("../services/escalation");
const orgTree_1 = require("../services/orgTree");
const config_1 = require("../config");
const campaignDetails_1 = require("../services/campaignDetails");
const visibility_1 = require("../services/visibility");
exports.apiRouter = (0, express_1.Router)();
exports.apiRouter.use(rbac_1.requireAuth);
// ---- Views (scoped by role) ----
exports.apiRouter.get("/campaigns", async (req, res, next) => {
    try {
        res.json(await (0, views_1.campaignOverview)((0, rbac_1.user)(req)));
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.get("/campaigns/:id", async (req, res, next) => {
    try {
        const out = await (0, views_1.campaignDetail)((0, rbac_1.user)(req), req.params.id);
        if (!out)
            return res.status(404).json({ error: "not_found" });
        res.json(out);
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.get("/campaigns/:id/details", async (req, res, next) => {
    try {
        const force = req.query.force === "1" || req.query.force === "true";
        const data = await (0, campaignDetails_1.getCampaignDetails)(req.params.id, { force, actor: (0, rbac_1.user)(req).email });
        res.json(data);
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.get("/leaderboard", async (req, res, next) => {
    try {
        res.json(await (0, views_1.reviewerLeaderboard)((0, rbac_1.user)(req)));
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.get("/managers", async (req, res, next) => {
    try {
        res.json(await (0, views_1.managerRollup)((0, rbac_1.user)(req)));
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.get("/impacted", async (req, res, next) => {
    try {
        res.json(await (0, views_1.impactedAccounts)((0, rbac_1.user)(req)));
    }
    catch (e) {
        next(e);
    }
});
// Diagnostic: dump raw review counts from snapshot for a campaign (admin only).
// GET /api/diag/reviews?campaignId=<id>
exports.apiRouter.get("/diag/reviews", (0, rbac_1.requireRole)("admin"), async (req, res, next) => {
    try {
        const snap = await (0, campaignStore_2.getSnapshot)();
        if (!snap)
            return res.json({ error: "no snapshot" });
        const campaignId = req.query.campaignId;
        const reviews = snap.reviews.filter((r) => campaignId ? r.campaignId === campaignId : true);
        const summary = {
            total: reviews.length,
            pending: reviews.filter((r) => r.status === "pending").length,
            withSubjectEmail: reviews.filter((r) => !!r.subjectUserEmail).length,
            zinniaEmail: reviews.filter((r) => (r.subjectUserEmail ?? "").toLowerCase().endsWith("@zinnia.com")).length,
            sample: reviews.slice(0, 3).map((r) => ({
                id: r.id,
                status: r.status,
                reviewerId: r.reviewerId,
                subjectUserId: r.subjectUserId,
                subjectUserEmail: r.subjectUserEmail,
                subjectUserDisplayName: r.subjectUserDisplayName,
                entitlement: r.entitlement,
            })),
        };
        res.json(summary);
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.get("/my-queue", async (req, res, next) => {
    try {
        res.json(await (0, views_1.myQueue)((0, rbac_1.user)(req)));
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.get("/trend", async (_req, res, next) => {
    try {
        res.json(await (0, campaignStore_1.getHistory)(200));
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.get("/notifications", async (req, res, next) => {
    try {
        const u = (0, rbac_1.user)(req);
        const all = await (0, notifications_1.listNotifications)(500);
        const rows = u.roles.includes("admin")
            ? all
            : all.filter((n) => n.recipientEmail === u.email);
        res.json(rows);
    }
    catch (e) {
        next(e);
    }
});
// ---- Admin ----
exports.apiRouter.post("/refresh", (0, rbac_1.requireRole)("admin"), async (req, res, next) => {
    try {
        const snap = await (0, campaignStore_1.refresh)((0, rbac_1.user)(req).email);
        res.json({ ok: true, fetchedAt: snap.fetchedAt, campaigns: snap.campaigns.length });
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.get("/admin/audit", (0, rbac_1.requireRole)("admin"), async (_req, res, next) => {
    try {
        res.json(await (0, audit_1.getAuditLog)(500));
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.get("/admin/ea-mappings", (0, rbac_1.requireRole)("admin"), async (_req, res, next) => {
    try {
        res.json(await (0, eaMappings_1.listMappings)());
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.post("/admin/ea-mappings", (0, rbac_1.requireRole)("admin"), async (req, res, next) => {
    try {
        const { eaEmail, execEmail } = req.body ?? {};
        const list = await (0, eaMappings_1.addMapping)(eaEmail, execEmail, (0, rbac_1.user)(req).email);
        res.json(list);
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.delete("/admin/ea-mappings", (0, rbac_1.requireRole)("admin"), async (req, res, next) => {
    try {
        const { eaEmail, execEmail } = req.body ?? {};
        const list = await (0, eaMappings_1.removeMapping)(eaEmail, execEmail, (0, rbac_1.user)(req).email);
        res.json(list);
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.get("/admin/settings", (0, rbac_1.requireRole)("admin"), async (_req, res, next) => {
    try {
        res.json(await (0, settings_1.getSettings)());
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.put("/admin/settings", (0, rbac_1.requireRole)("admin"), async (req, res, next) => {
    try {
        res.json(await (0, settings_1.updateSettings)(req.body, (0, rbac_1.user)(req).email));
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.get("/admin/config", (0, rbac_1.requireRole)("admin"), async (_req, res, next) => {
    try {
        res.json(await (0, runtimeConfig_1.getMasked)());
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.put("/admin/config", (0, rbac_1.requireRole)("admin"), async (req, res, next) => {
    try {
        res.json(await (0, runtimeConfig_1.update)(req.body ?? {}, (0, rbac_1.user)(req).email));
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.post("/admin/config/test", (0, rbac_1.requireRole)("admin"), async (_req, res, next) => {
    try {
        res.json(await (0, connectionTests_1.runConnectionTests)());
    }
    catch (e) {
        next(e);
    }
});
const diagJobs = new Map();
function makeDiagJobId() { return Math.random().toString(36).slice(2, 10); }
async function runDiagJob(job, campaignId) {
    function record(step, ok, detail) {
        job.steps.push({ step, ok, detail });
        if (!ok) {
            job.passed = false;
            job.status = "done";
        }
    }
    try {
        const axios = (await Promise.resolve().then(() => __importStar(require("axios")))).default;
        const base = `${config_1.config.conductor1.baseUrl}/api/v1`;
        // 1. Token
        let token;
        try {
            if (config_1.config.conductor1.apiToken) {
                token = config_1.config.conductor1.apiToken;
                record("token", true, "static API token");
            }
            else {
                const body = new URLSearchParams({
                    grant_type: "client_credentials",
                    client_id: config_1.config.conductor1.clientId,
                    client_secret: config_1.config.conductor1.clientSecret,
                });
                const r = await axios.post(`${config_1.config.conductor1.baseUrl}/auth/v1/token`, body.toString(), {
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    timeout: 15_000,
                });
                token = r.data.access_token;
                record("token", true, `minted, expires_in=${r.data.expires_in}s`);
            }
        }
        catch (err) {
            record("token", false, `${err?.response?.status ?? ""} ${err?.message}`);
            return;
        }
        if (job.status !== "running")
            return;
        // 2. Trigger
        try {
            await axios.post(`${base}/access_review/${encodeURIComponent(campaignId)}/report`, { format: "ACCESS_REVIEW_REPORT_FORMAT_JSON" }, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, timeout: 20_000 });
            record("trigger", true, "POST accepted");
        }
        catch (err) {
            record("trigger", false, `${err?.response?.status ?? ""} ${err?.message} — ${JSON.stringify(err?.response?.data ?? "").slice(0, 200)}`);
            return;
        }
        if (job.status !== "running")
            return;
        // 3. Poll (10 min max — runs in background, no App Proxy constraint here)
        let downloadUrl = null;
        const deadline = Date.now() + 10 * 60_000;
        let polls = 0;
        while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 4_000));
            polls++;
            const r = await axios.get(`${base}/access_review/${encodeURIComponent(campaignId)}/report?page_size=1`, { headers: { Authorization: `Bearer ${token}` }, timeout: 20_000 });
            const latest = r.data?.list?.[0];
            if (!latest)
                continue;
            if (latest.state === "REPORT_STATE_OK") {
                const rel = latest.downloadUrl ?? latest.download_url ?? "";
                downloadUrl = rel ? `${config_1.config.conductor1.baseUrl}${rel}` : null;
                record("poll", true, `ready after ${polls} polls (~${polls * 4}s)`);
                break;
            }
            if (latest.state === "REPORT_STATE_ERROR" || latest.state === "REPORT_STATE_FAILED") {
                record("poll", false, `C1 reported ${latest.state}`);
                return;
            }
        }
        if (!downloadUrl) {
            record("poll", false, "timed out after 10 min");
            return;
        }
        if (job.status !== "running")
            return;
        // 4. Download
        let rows = [];
        try {
            const resp = await axios.get(downloadUrl, { timeout: 120_000 });
            rows = resp.data?.rows ?? [];
            const cols = resp.data?.columns ?? Object.keys(rows[0] ?? {});
            const decisions = {};
            for (const row of rows) {
                const d = (row["Decisions"] ?? "pending").trim() || "pending";
                decisions[d] = (decisions[d] ?? 0) + 1;
            }
            const decStr = Object.entries(decisions).map(([k, v]) => `${k}: ${v}`).join(", ") || "none";
            record("download", true, `${rows.length.toLocaleString()} rows · columns: ${cols.join(", ")} · decisions: ${decStr}`);
        }
        catch (err) {
            record("download", false, err?.message);
            return;
        }
        if (job.status !== "running")
            return;
        // 5. Reviewer parsing
        {
            const assignedKey = rows[0] && "Assigned to" in rows[0] ? "Assigned to" : "Assigned To";
            const withReviewer = rows.filter(r => (r[assignedKey] ?? "").trim());
            const total = withReviewer.length;
            if (total === 0) {
                record("reviewer_parse", true, "0 rows have a reviewer assigned — no parsing to verify (campaign may be fully unassigned or self-certified)");
            }
            else {
                let parenCount = 0, plainEmailCount = 0, unknownCount = 0;
                const unknownSamples = [];
                for (const row of withReviewer) {
                    const v = (row[assignedKey] ?? "").trim();
                    if (/^(.*?)\s*\(([^)]+@[^)]+)\)\s*$/.test(v))
                        parenCount++;
                    else if (v.includes("@") && !v.includes(" "))
                        plainEmailCount++;
                    else {
                        unknownCount++;
                        if (unknownSamples.length < 3)
                            unknownSamples.push(`"${v}"`);
                    }
                }
                const parenSamples = [];
                for (const row of withReviewer) {
                    if (parenSamples.length >= 3)
                        break;
                    const v = (row[assignedKey] ?? "").trim();
                    const m = v.match(/^(.*?)\s*\(([^)]+@[^)]+)\)\s*$/);
                    if (m)
                        parenSamples.push(`"${m[1].trim()}" → ${m[2].trim()}`);
                }
                const ok = unknownCount === 0;
                const summary = [
                    `${total} assigned rows`,
                    parenCount ? `${parenCount} "Last, First (email)"` : null,
                    plainEmailCount ? `${plainEmailCount} plain email` : null,
                    unknownCount ? `${unknownCount} unparseable` : null,
                ].filter(Boolean).join(" · ");
                const detail = [
                    summary,
                    parenSamples.length ? `samples: ${parenSamples.join("; ")}` : null,
                    unknownCount ? `unknown formats: ${unknownSamples.join("; ")}` : null,
                ].filter(Boolean).join(" · ");
                record("reviewer_parse", ok, detail);
            }
        }
        job.passed = true;
        job.status = "done";
    }
    catch (e) {
        job.steps.push({ step: "internal", ok: false, detail: e?.message ?? "unexpected error" });
        job.passed = false;
        job.status = "error";
    }
}
exports.apiRouter.post("/admin/test/report-api", (0, rbac_1.requireRole)("admin"), (req, res) => {
    const campaignId = (req.body?.campaignId ?? "").trim();
    if (!campaignId) {
        res.status(400).json({ error: "campaignId required" });
        return;
    }
    // Evict oldest jobs once we have 20
    if (diagJobs.size >= 20) {
        const oldest = [...diagJobs.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt)[0];
        if (oldest)
            diagJobs.delete(oldest[0]);
    }
    const job = { id: makeDiagJobId(), status: "running", steps: [], passed: false, startedAt: Date.now() };
    diagJobs.set(job.id, job);
    runDiagJob(job, campaignId); // fire and forget
    res.json({ jobId: job.id });
});
exports.apiRouter.get("/admin/test/report-api/status", (0, rbac_1.requireRole)("admin"), (req, res) => {
    const jobId = (req.query.jobId ?? "");
    const job = diagJobs.get(jobId);
    if (!job) {
        res.status(404).json({ error: "job not found" });
        return;
    }
    res.json({ status: job.status, steps: job.steps, passed: job.passed });
});
exports.apiRouter.post("/admin/notify", (0, rbac_1.requireRole)("admin"), async (req, res, next) => {
    try {
        const { campaignId, reviewerEmails, kind } = req.body ?? {};
        const result = await (0, notifier_1.sendManualNotifications)({
            actor: (0, rbac_1.user)(req).email,
            campaignId,
            reviewerEmails: Array.isArray(reviewerEmails) ? reviewerEmails : [],
            kind: kind ?? "manual",
        });
        res.json(result);
    }
    catch (e) {
        next(e);
    }
});
// -------- v2 endpoints --------
exports.apiRouter.get("/org-tree", async (req, res, next) => {
    try {
        res.json(await (0, orgView_1.buildOrgView)((0, rbac_1.user)(req)));
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.get("/escalation/behind", async (req, res, next) => {
    try {
        const snap = await (0, campaignStore_2.getSnapshot)();
        const tc = await (0, tiers_1.getTiers)();
        if (!snap)
            return res.json([]);
        const vis = await (0, visibility_1.visibleEmails)((0, rbac_1.user)(req));
        const rows = (0, escalation_1.behindReviewers)(snap, tc)
            .filter((r) => vis.all || vis.emails.has(r.reviewer.email))
            .map((r) => ({
            reviewerId: r.reviewer.id,
            reviewerEmail: r.reviewer.email,
            reviewerName: r.reviewer.displayName,
            campaignId: r.campaign.id,
            campaignName: r.campaign.name,
            pending: r.pending.length,
            daysUntilDeadline: r.daysUntilDeadline,
            tierId: r.tier?.id,
            tierName: r.tier?.name,
            audiences: r.tier?.audiences ?? [],
        }));
        res.json(rows);
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.get("/search", async (req, res, next) => {
    try {
        const q = (req.query.q ?? "").toLowerCase().trim();
        const empty = {
            people: [],
            campaigns: [],
            historicalCampaigns: [],
            entitlements: [],
        };
        if (!q)
            return res.json(empty);
        const snap = await (0, campaignStore_2.getSnapshot)();
        const hist = await (0, scorecards_1.getHistory)();
        const mappings = await (0, eaMappings_1.listMappings)();
        // Build a single "people" set with whatever roles each person plays in our data.
        const people = new Map();
        function addPerson(email, displayName, role) {
            if (!email)
                return;
            const key = email.toLowerCase();
            if (!people.has(key)) {
                people.set(key, { email: key, displayName: displayName ?? key, roles: new Set() });
            }
            const p = people.get(key);
            if (displayName && p.displayName === p.email)
                p.displayName = displayName;
            if (role)
                p.roles.add(role);
        }
        // Active reviewers and subjects.
        if (snap) {
            for (const r of snap.reviewers)
                addPerson(r.email, r.displayName, "reviewer");
            for (const r of snap.reviews) {
                addPerson(r.subjectUserEmail, r.subjectUserDisplayName, "subject");
            }
        }
        // Archived reviewers.
        for (const c of hist.campaigns) {
            for (const rv of c.reviewerCompletion)
                addPerson(rv.email, rv.email, "reviewer");
        }
        // Admins + CEO + EAs/execs.
        for (const e of config_1.config.admins)
            addPerson(e, e, "admin");
        addPerson(config_1.config.orgTop.ceoEmail, "George Esposito (CEO)", "ceo");
        for (const m of mappings) {
            addPerson(m.eaEmail, m.eaEmail, "ea");
            addPerson(m.execEmail, m.execEmail, "exec");
        }
        const peopleMatches = [...people.values()]
            .filter((p) => p.email.includes(q) || p.displayName.toLowerCase().includes(q))
            .slice(0, 30)
            .map((p) => ({ ...p, roles: [...p.roles] }));
        // Active and archived campaigns.
        const campaigns = (snap?.campaigns ?? [])
            .filter((c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
            .slice(0, 20)
            .map((c) => ({ id: c.id, name: c.name }));
        const historicalCampaigns = hist.campaigns
            .filter((c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
            .slice(0, 20)
            .map((c) => ({ id: c.id, name: c.name }));
        // Entitlements (from the active snapshot only — historical doesn't store them).
        const entitlements = new Set();
        if (snap) {
            for (const r of snap.reviews) {
                if (r.entitlement && r.entitlement.toLowerCase().includes(q))
                    entitlements.add(r.entitlement);
            }
        }
        res.json({
            people: peopleMatches,
            campaigns,
            historicalCampaigns,
            entitlements: [...entitlements].slice(0, 20),
        });
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.get("/profile/:email", async (req, res, next) => {
    try {
        const email = String(req.params.email).toLowerCase();
        const snap = await (0, campaignStore_2.getSnapshot)();
        if (!snap)
            return res.status(404).json({ error: "no_snapshot" });
        const reviewer = snap.reviewers.find((r) => r.email === email);
        const campaignNameById = new Map(snap.campaigns.map((c) => [c.id, c.name]));
        const enrich = (r) => ({ ...r, campaignName: campaignNameById.get(r.campaignId) });
        const asReviewer = (reviewer ? snap.reviews.filter((r) => r.reviewerId === reviewer.id) : []).map(enrich);
        const asSubject = snap.reviews.filter((r) => r.subjectUserEmail === email).map(enrich);
        const tree = await (0, orgTree_1.buildOrgTreeForEmails)([email, config_1.config.orgTop.ceoEmail]);
        const chain = (0, orgTree_1.managerChain)(tree, email, {
            stopAtEmail: config_1.config.orgTop.ceoEmail,
            includeStop: !config_1.config.orgTop.excludeCeoFromEscalation,
        });
        // Past campaigns (from imported archive) — surface ones where this person
        // appeared as a reviewer. Subject participation isn't tracked at task level
        // by the import, so we don't have it for archived campaigns.
        const hist = await (0, scorecards_1.getHistory)();
        const historicalAsReviewer = hist.campaigns
            .map((c) => {
            const me = c.reviewerCompletion.find((r) => r.email === email);
            if (!me)
                return null;
            return {
                campaignId: c.id,
                campaignName: c.name,
                openedAt: c.openedAt,
                closedAt: c.closedAt,
                deadline: c.deadline,
                assigned: me.assigned,
                completed: me.completed,
                onTime: me.onTime,
            };
        })
            .filter((x) => x !== null)
            .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));
        res.json({
            email,
            user: tree.byEmail[email] ?? null,
            managerChain: chain.map((u) => ({ email: u.email, displayName: u.displayName })),
            asReviewer: {
                pending: asReviewer.filter((r) => r.status === "pending"),
                completed: asReviewer.filter((r) => r.status !== "pending"),
            },
            asSubject,
            historicalAsReviewer,
        });
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.get("/admin/tiers", (0, rbac_1.requireRole)("admin"), async (_req, res, next) => {
    try {
        res.json(await (0, tiers_1.getTiers)());
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.put("/admin/tiers", (0, rbac_1.requireRole)("admin"), async (req, res, next) => {
    try {
        res.json(await (0, tiers_1.saveTiers)(req.body, (0, rbac_1.user)(req).email));
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.get("/admin/templates", (0, rbac_1.requireRole)("admin"), async (_req, res, next) => {
    try {
        res.json(await (0, templates_1.getStore)());
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.put("/admin/templates", (0, rbac_1.requireRole)("admin"), async (req, res, next) => {
    try {
        const { doc, campaignId } = req.body ?? {};
        res.json(await (0, templates_1.saveTemplate)(doc, (0, rbac_1.user)(req).email, campaignId));
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.delete("/admin/templates", (0, rbac_1.requireRole)("admin"), async (req, res, next) => {
    try {
        const { section, channel, campaignId } = req.body ?? {};
        res.json(await (0, templates_1.deletePerCampaignTemplate)(section, channel, campaignId, (0, rbac_1.user)(req).email));
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.post("/admin/templates/preview", (0, rbac_1.requireRole)("admin"), async (req, res, next) => {
    try {
        const { section, channel, bodyMarkdown, subject } = req.body ?? {};
        if (!section || !channel || typeof bodyMarkdown !== "string") {
            return res.status(400).json({ error: "section, channel, and bodyMarkdown are required" });
        }
        // Build sample token data — pull real names from snapshot where available.
        const snap = await (0, campaignStore_2.getSnapshot)();
        const sampleReviewer = snap?.reviewers?.[0];
        const sampleCampaign = snap?.campaigns?.[0];
        const firstName = sampleReviewer?.displayName?.split(" ")[0] ?? "Alice";
        const reviewerEmail = sampleReviewer?.email ?? "alice.johnson@zinnia.com";
        const campaignName = sampleCampaign?.name ?? "Q2 2026 Access Review";
        const campaignUrl = sampleCampaign
            ? `${config_1.config.conductor1.baseUrl}/c1/apps/${sampleCampaign.id}`
            : "https://app.conductorone.com/c1/app-access-review";
        const deadline = sampleCampaign?.endDate
            ? new Date(sampleCampaign.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
            : "Jul 15, 2026";
        const pendingTableHtml = `<table border="1" cellpadding="4" cellspacing="0"><tr><th>Entitlement</th><th>Campaign</th></tr>` +
            `<tr><td>GitHub Org Access</td><td>${campaignName}</td></tr>` +
            `<tr><td>Salesforce Read</td><td>${campaignName}</td></tr></table>`;
        const pendingList = `• GitHub Org Access — ${campaignName}\n• Salesforce Read — ${campaignName}`;
        const reviewerTableHtml = `<table border="1" cellpadding="4" cellspacing="0"><tr><th>Reviewer</th><th>Pending</th></tr>` +
            `<tr><td>Bob Smith</td><td>4</td></tr><tr><td>Carol Jones</td><td>2</td></tr></table>`;
        const reviewerList = `• Bob Smith — 4 pending\n• Carol Jones — 2 pending`;
        const atRiskTableHtml = `<table border="1" cellpadding="4" cellspacing="0"><tr><th>Campaign</th><th>Pending</th><th>Days Left</th></tr>` +
            `<tr><td>${campaignName}</td><td>47</td><td>5</td></tr></table>`;
        const tokens = {
            recipient: { firstName, email: reviewerEmail },
            summary: { totalPending: 7 },
            sections: `<em>(section content rendered here)</em>`,
            section: {
                count: 3,
                pendingTable: channel === "email" ? pendingTableHtml : pendingList,
                pendingList,
                reviewerTable: channel === "email" ? reviewerTableHtml : reviewerList,
                reviewerList,
                deadline,
                daysUntilDeadline: 14,
                campaignUrl,
                campaignName,
                tier: "Standard",
            },
            admin: {
                openCampaigns: snap?.campaigns?.filter((c) => c.status === "open")?.length ?? 3,
                atRisk: 1,
                totalPending: snap?.reviews?.filter((r) => r.status === "pending")?.length ?? 47,
                reviewersBehind: 12,
                suppressed: 2,
                atRiskTable: channel === "email" ? atRiskTableHtml : `• ${campaignName} — 47 pending, 5 days left`,
            },
            actor: (0, rbac_1.user)(req).displayName ?? (0, rbac_1.user)(req).email,
            accounts: {
                count: 2,
                list: "john.doe@zinnia.com\njane.smith@zinnia.com",
                table: channel === "email"
                    ? `<table border="1" cellpadding="4" cellspacing="0"><tr><th>Email</th><th>Name</th></tr><tr><td>john.doe@zinnia.com</td><td>John Doe</td></tr><tr><td>jane.smith@zinnia.com</td><td>Jane Smith</td></tr></table>`
                    : "• john.doe@zinnia.com (John Doe)\n• jane.smith@zinnia.com (Jane Smith)",
            },
            campaigns: { list: campaignName },
            reviewer: { firstName, name: sampleReviewer?.displayName ?? "Alice Johnson" },
            account: { email: "john.doe@zinnia.com", name: "John Doe" },
            campaign: { name: campaignName, deadline },
            manager: { firstName: "Bob" },
        };
        const expandedBody = (0, templates_1.expandTokens)(bodyMarkdown, tokens);
        const expandedSubject = subject ? (0, templates_1.expandTokens)(subject, tokens) : undefined;
        let rendered;
        if (channel === "email") {
            rendered = (0, templates_1.renderMarkdownToHtml)(expandedBody);
        }
        else {
            const blocks = (0, templates_1.renderMarkdownToSlackBlocks)(expandedBody);
            // Return the plain mrkdwn text for display
            rendered = blocks[0]?.text?.text ?? expandedBody;
        }
        res.json({
            rendered,
            subject: expandedSubject,
            sampleContext: { reviewerName: sampleReviewer?.displayName ?? "Alice Johnson", campaignName },
        });
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.get("/admin/suppressions", (0, rbac_1.requireRole)("admin"), async (_req, res, next) => {
    try {
        res.json(await (0, suppressions_1.list)());
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.post("/admin/suppressions", (0, rbac_1.requireRole)("admin"), async (req, res, next) => {
    try {
        const { email, untilDate, reason } = req.body ?? {};
        res.json(await (0, suppressions_1.add)({ email, untilDate, reason, createdBy: (0, rbac_1.user)(req).email }));
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.delete("/admin/suppressions", (0, rbac_1.requireRole)("admin"), async (req, res, next) => {
    try {
        res.json(await (0, suppressions_1.remove)(req.body?.email, (0, rbac_1.user)(req).email));
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.post("/admin/history/import", (0, rbac_1.requireRole)("admin"), async (req, res, next) => {
    try {
        const fresh = req.query.fresh === "1" || req.query.fresh === "true" || req.body?.fresh === true;
        res.json(await (0, scorecards_1.importHistory)((0, rbac_1.user)(req).email, { fresh }));
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.get("/admin/history", (0, rbac_1.requireRole)("admin"), async (_req, res, next) => {
    try {
        res.json(await (0, scorecards_1.getHistory)());
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.get("/scorecards", async (_req, res, next) => {
    try {
        res.json(await (0, scorecards_1.getScorecards)());
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.get("/scorecards/tree", async (req, res, next) => {
    try {
        const { getScorecardTree } = await Promise.resolve().then(() => __importStar(require("../services/scorecards")));
        res.json(await getScorecardTree((0, rbac_1.user)(req).email));
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.get("/history/campaigns", async (_req, res, next) => {
    try {
        res.json(await (0, scorecards_1.getHistory)());
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.post("/admin/scorecards/recompute", (0, rbac_1.requireRole)("admin"), async (_req, res, next) => {
    try {
        res.json(await (0, scorecards_1.computeScorecards)());
    }
    catch (e) {
        next(e);
    }
});
// Diagnostic: reports each step the scorecards tree builder relies on so admins
// can see why /scorecards/tree returned an empty root.
exports.apiRouter.get("/admin/scorecards/diag", (0, rbac_1.requireRole)("admin"), async (req, res, next) => {
    try {
        const { diagScorecardTree } = await Promise.resolve().then(() => __importStar(require("../services/scorecards")));
        res.json(await diagScorecardTree((0, rbac_1.user)(req).email));
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.post("/admin/graph-cache/clear", (0, rbac_1.requireRole)("admin"), async (_req, res, next) => {
    try {
        const { clearGraphCache } = await Promise.resolve().then(() => __importStar(require("../services/graph")));
        await clearGraphCache();
        res.json({ ok: true });
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.post("/admin/campaign-cache/clear", (0, rbac_1.requireRole)("admin"), async (_req, res, next) => {
    try {
        const { clearCampaignDetailsDisk } = await Promise.resolve().then(() => __importStar(require("../services/campaignDetails")));
        const result = await clearCampaignDetailsDisk();
        res.json({ ok: true, ...result });
    }
    catch (e) {
        next(e);
    }
});
// ── Account action notifications ─────────────────────────────────────────────
async function postToSlackChannel(channel, text, dryRun) {
    const { config } = await Promise.resolve().then(() => __importStar(require("../config")));
    const { WebClient } = await Promise.resolve().then(() => __importStar(require("@slack/web-api")));
    const { logger } = await Promise.resolve().then(() => __importStar(require("../logger")));
    if (dryRun) {
        logger.info("account_action_notify_dry_run", { channel });
        return { ok: true, dryRun: true };
    }
    if (!config.slack.botToken)
        return { ok: false, error: "SLACK_BOT_TOKEN not configured" };
    try {
        const client = new WebClient(config.slack.botToken);
        const ch = channel.startsWith("#") ? channel : `#${channel}`;
        await client.chat.postMessage({ channel: ch, text, unfurl_links: false });
        return { ok: true };
    }
    catch (err) {
        return { ok: false, error: err?.data?.error ?? err?.message ?? "slack_error" };
    }
}
async function notifyAccountAction(actor, email, system, enable, ok, campaignIds, detail) {
    try {
        const { config } = await Promise.resolve().then(() => __importStar(require("../config")));
        const { recordNotification } = await Promise.resolve().then(() => __importStar(require("../services/notifications")));
        const { sendSlackDM } = await Promise.resolve().then(() => __importStar(require("../services/slack")));
        const { sendEmail } = await Promise.resolve().then(() => __importStar(require("../services/email")));
        const { logger } = await Promise.resolve().then(() => __importStar(require("../logger")));
        // Resolve campaign names from the current snapshot.
        let campaignNames = [];
        try {
            const { getSnapshot } = await Promise.resolve().then(() => __importStar(require("../services/campaignStore")));
            const snap = await getSnapshot();
            if (snap && campaignIds.length) {
                campaignNames = campaignIds
                    .map((id) => snap.campaigns.find((c) => c.id === id)?.name)
                    .filter((n) => !!n);
            }
        }
        catch { /* best-effort */ }
        const campaignLabel = campaignNames.length
            ? campaignNames.join(", ")
            : campaignIds.join(", ") || "unknown campaign";
        const action = enable ? "re-enabled" : "disabled";
        const status = ok ? (enable ? "✅" : "🔴") : "❌";
        // ── 1. IAM admin channel ──────────────────────────────────────────────────
        if (config.notifications.adminNotificationsEnabled) {
            const cfg = config.completionAlert;
            if (cfg.recipient) {
                const iamText = ok
                    ? `${status} *${system} account ${action}* by ${actor}\nAccount: ${email}\nCampaign: ${campaignLabel}`
                    : `${status} *Failed to ${action} ${system} account* (attempted by ${actor})\nAccount: ${email}\nCampaign: ${campaignLabel}${detail ? `\nError: ${detail}` : ""}`;
                const subject = `${status} ${system} account ${action}: ${email}`;
                let iamResult = { ok: false };
                if (cfg.channel === "slack-channel") {
                    iamResult = await postToSlackChannel(cfg.recipient, iamText, config.notifications.adminDryRun);
                }
                else if (cfg.channel === "slack-dm") {
                    iamResult = await sendSlackDM(cfg.recipient, iamText, undefined, { dryRun: config.notifications.adminDryRun });
                }
                else if (cfg.channel === "email") {
                    iamResult = await sendEmail({ to: cfg.recipient, subject, html: `<p>${iamText.replace(/\n/g, "<br>")}</p>`, dryRun: config.notifications.adminDryRun });
                }
                await recordNotification({
                    channel: cfg.channel,
                    kind: "account_action",
                    recipientEmail: cfg.recipient,
                    subject,
                    body: iamText,
                    success: iamResult.ok,
                    error: iamResult.error,
                    dryRun: iamResult.dryRun ?? config.notifications.adminDryRun,
                });
            }
        }
        // ── 2. Helpdesk Slack channel ─────────────────────────────────────────────
        const hd = config.helpdeskNotification;
        if (hd.enabled && hd.slackChannel) {
            const hdText = enable
                ? `✅ *Account re-enabled — No further action required*\n\n` +
                    `*User:* ${email}\n` +
                    `*System:* ${system}\n` +
                    `*Action:* Account has been re-enabled by the IAM team.\n` +
                    `*Campaign:* ${campaignLabel}\n\n` +
                    `This account has been re-enabled and the user may resume normal access. No action is required from the Helpdesk.`
                : `🔴 *Account disabled — Important: Do not re-enable without IAM approval*\n\n` +
                    `*User:* ${email}\n` +
                    `*System:* ${system}\n` +
                    `*Reason:* This account has been disabled by the IAM team due to an overdue access review. ` +
                    `The account had pending entitlement reviews that were not completed by the campaign deadline.\n` +
                    `*Campaign:* ${campaignLabel}\n\n` +
                    `*Action required for Helpdesk:*\n` +
                    `• If this user contacts the Helpdesk requesting re-enablement, do *NOT* re-enable the account without first consulting the IAM team.\n` +
                    `• Contact the IAM team in the *#dept-itops-iam* Slack channel before taking any action.\n` +
                    `• The IAM team will confirm whether the access review has been completed and authorize re-enablement if appropriate.`;
            const hdResult = await postToSlackChannel(hd.slackChannel, hdText, config.notifications.adminDryRun);
            await recordNotification({
                channel: "slack-channel",
                kind: "account_action",
                recipientEmail: hd.slackChannel,
                subject: enable ? `Account re-enabled: ${email}` : `Account disabled: ${email}`,
                body: hdText,
                success: hdResult.ok,
                error: hdResult.error,
                dryRun: hdResult.dryRun ?? config.notifications.adminDryRun,
            });
            if (!hdResult.ok) {
                logger.warn("helpdesk_notify_failed", { email, error: hdResult.error });
            }
        }
    }
    catch (e) {
        const { logger } = await Promise.resolve().then(() => __importStar(require("../logger")));
        logger.warn("account_action_notify_failed", { err: e?.message });
    }
}
exports.apiRouter.post("/admin/users/set-azure-enabled", (0, rbac_1.requireRole)("admin"), async (req, res, next) => {
    try {
        const { setUserAccountEnabled } = await Promise.resolve().then(() => __importStar(require("../services/graph")));
        const email = String(req.body?.email ?? "").trim();
        const enable = req.body?.enable === true;
        if (!email)
            return res.status(400).json({ error: "email required" });
        if (!email.toLowerCase().endsWith("@zinnia.com"))
            return res.status(400).json({ error: "Only zinnia.com accounts can be toggled." });
        const campaignIds = Array.isArray(req.body?.campaignIds) ? req.body.campaignIds : [];
        const result = await setUserAccountEnabled(email, enable);
        await (0, audit_1.audit)({
            actor: (0, rbac_1.user)(req).email,
            action: result.ok ? (enable ? "user.enabled" : "user.disabled") : (enable ? "user.enable_failed" : "user.disable_failed"),
            target: email,
            details: result.ok ? undefined : { error: result.error },
        });
        void notifyAccountAction((0, rbac_1.user)(req).email, email, "Azure", enable, result.ok, campaignIds, result.error);
        res.json({ ...result, enable });
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.post("/admin/users/set-ad-enabled", (0, rbac_1.requireRole)("admin"), async (req, res, next) => {
    try {
        const { setAdAccountEnabled } = await Promise.resolve().then(() => __importStar(require("../services/adAccount")));
        const email = String(req.body?.email ?? "").trim();
        const enable = req.body?.enable === true;
        if (!email)
            return res.status(400).json({ error: "email required" });
        if (!email.toLowerCase().endsWith("@zinnia.com"))
            return res.status(400).json({ error: "Only zinnia.com accounts can be toggled." });
        const campaignIds = Array.isArray(req.body?.campaignIds) ? req.body.campaignIds : [];
        const result = await setAdAccountEnabled(email, enable);
        await (0, audit_1.audit)({
            actor: (0, rbac_1.user)(req).email,
            action: result.ok
                ? (result.skipped ? "user.set_ad_skipped" : (enable ? "user.ad_enabled" : "user.ad_disabled"))
                : (enable ? "user.ad_enable_failed" : "user.ad_disable_failed"),
            target: email,
            details: { message: result.message },
        });
        if (!result.skipped) {
            void notifyAccountAction((0, rbac_1.user)(req).email, email, "On-prem AD", enable, result.ok, campaignIds, result.message);
        }
        res.json({ ...result, enable });
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.post("/admin/users/batch-set-enabled", (0, rbac_1.requireRole)("admin"), async (req, res, next) => {
    try {
        const { executeBatch } = await Promise.resolve().then(() => __importStar(require("../services/batchAccountAction")));
        const changes = req.body?.changes;
        if (!Array.isArray(changes) || changes.length === 0) {
            return res.status(400).json({ error: "changes array required" });
        }
        // Validate and filter to zinnia.com only.
        const valid = changes.filter((c) => typeof c.email === "string" &&
            c.email.toLowerCase().endsWith("@zinnia.com") &&
            (typeof c.azure === "boolean" || typeof c.ad === "boolean"));
        if (valid.length === 0)
            return res.status(400).json({ error: "no valid changes" });
        const result = await executeBatch(valid, (0, rbac_1.user)(req).email);
        await (0, audit_1.audit)({
            actor: (0, rbac_1.user)(req).email,
            action: "user.batch_account_action",
            details: {
                total: valid.length,
                succeeded: result.succeeded.length,
                failed: result.failed.length,
            },
        });
        res.json(result);
    }
    catch (e) {
        next(e);
    }
});
// Force-fresh Graph lookup of a user's accountEnabled state. Used by the
// Impacted Accounts panel to verify a Disable click actually took effect.
exports.apiRouter.get("/users/:email/account-status", async (req, res, next) => {
    try {
        const email = String(req.params.email ?? "").trim();
        if (!email)
            return res.status(400).json({ error: "email required" });
        const { fetchAccountEnabled } = await Promise.resolve().then(() => __importStar(require("../services/graph")));
        const enabled = await fetchAccountEnabled(email);
        res.json({ email, enabled });
    }
    catch (e) {
        next(e);
    }
});
// On-prem AD status lookup for a single user. Uses the in-memory cache (5-min TTL).
exports.apiRouter.get("/users/:email/ad-status", async (req, res, next) => {
    try {
        const email = String(req.params.email ?? "").trim();
        if (!email)
            return res.status(400).json({ error: "email required" });
        const { getAdAccountEnabled } = await Promise.resolve().then(() => __importStar(require("../services/adAccount")));
        const enabled = await getAdAccountEnabled(email);
        res.json({ email, enabled });
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.post("/admin/campaign-cache/prewarm", (0, rbac_1.requireRole)("admin"), async (_req, res, next) => {
    try {
        // Kick off in the background so the request returns immediately; the user
        // can watch progress in Admin → Jobs.
        const { runPrewarmNow } = await Promise.resolve().then(() => __importStar(require("../jobs/prewarmCampaignDetails")));
        runPrewarmNow().catch(() => { });
        res.json({ ok: true });
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.get("/admin/jobs", (0, rbac_1.requireRole)("admin"), async (_req, res, next) => {
    try {
        const { list } = await Promise.resolve().then(() => __importStar(require("../services/jobs")));
        res.json(list());
    }
    catch (e) {
        next(e);
    }
});
// Map from job registry ID → the RuntimeConfig crons key it drives.
const JOB_CRON_KEY = {
    campaigns_refresh: "refreshCampaigns",
    scorecards_recompute: "scorecards",
    campaign_details_prewarm: "prewarmDetails",
    org_tree_prewarm: "prewarmOrgTree",
    daily_digest: "digest",
    noon_disable_check: "noonDisableCheck",
};
exports.apiRouter.put("/admin/jobs/:jobId/schedule", (0, rbac_1.requireRole)("admin"), async (req, res, next) => {
    try {
        const { jobId } = req.params;
        const cronExpr = (req.body?.cron ?? "").trim();
        if (!cronExpr) {
            res.status(400).json({ error: "cron expression required" });
            return;
        }
        const cronPkg = await Promise.resolve().then(() => __importStar(require("node-cron")));
        if (!cronPkg.validate(cronExpr)) {
            res.status(400).json({ error: `Invalid cron expression: "${cronExpr}"` });
            return;
        }
        const cronKey = JOB_CRON_KEY[jobId];
        if (!cronKey) {
            res.status(400).json({ error: `Job "${jobId}" does not have an editable schedule` });
            return;
        }
        const { update } = await Promise.resolve().then(() => __importStar(require("../services/runtimeConfig")));
        await update({ crons: { [cronKey]: cronExpr } }, (0, rbac_1.user)(req).email);
        const { list } = await Promise.resolve().then(() => __importStar(require("../services/jobs")));
        res.json({ ok: true, jobs: list() });
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.post("/admin/digest/run", (0, rbac_1.requireRole)("admin"), async (req, res, next) => {
    try {
        const dryRun = req.body?.dryRun === true;
        res.json(await (0, digest_1.runDailyDigest)({ dryRun, actor: (0, rbac_1.user)(req).email }));
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.get("/replay/:campaignId/bootstrap", (0, rbac_1.requireRole)("admin"), async (req, res, next) => {
    try {
        const { getReplayBootstrap } = await Promise.resolve().then(() => __importStar(require("../services/replay")));
        res.json(await getReplayBootstrap(String(req.params.campaignId), (0, rbac_1.user)(req).email));
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.get("/replay/:campaignId/state", (0, rbac_1.requireRole)("admin"), async (req, res, next) => {
    try {
        const { getReplaySnapshot } = await Promise.resolve().then(() => __importStar(require("../services/replay")));
        const asOf = req.query.asOf || new Date().toISOString();
        res.json(await getReplaySnapshot(String(req.params.campaignId), asOf, (0, rbac_1.user)(req).email));
    }
    catch (e) {
        next(e);
    }
});
exports.apiRouter.get("/replay/:campaignId/message-preview", (0, rbac_1.requireRole)("admin"), async (req, res, next) => {
    try {
        const { getReplayMessagePreview } = await Promise.resolve().then(() => __importStar(require("../services/replay")));
        const campaignId = String(req.params.campaignId);
        const reviewerEmail = String(req.query.reviewerEmail ?? "");
        const recipientEmail = String(req.query.recipientEmail ?? reviewerEmail);
        const reason = String(req.query.reason ?? "reviewer");
        const daysUntilDeadline = req.query.daysUntilDeadline != null
            ? Number(req.query.daysUntilDeadline)
            : undefined;
        res.json(await getReplayMessagePreview({ campaignId, reviewerEmail, recipientEmail, reason, daysUntilDeadline }));
    }
    catch (e) {
        next(e);
    }
});
//# sourceMappingURL=api.js.map