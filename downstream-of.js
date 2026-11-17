"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Print what our getDownstreamReports returns for a given email.
require("../config");
const runtimeConfig_1 = require("../services/runtimeConfig");
const graph_1 = require("../services/graph");
async function main() {
    await (0, runtimeConfig_1.loadAtBoot)();
    const email = process.argv[2];
    if (!email) {
        console.error("usage: downstream-of.ts <email>");
        process.exit(1);
    }
    const u = await (0, graph_1.getUserByEmail)(email);
    if (!u) {
        console.error("user not found");
        process.exit(1);
    }
    console.log(`Resolved ${email} -> id ${u.id} (${u.displayName})`);
    const reports = await (0, graph_1.getDownstreamReports)(u.id);
    console.log(`Returned ${reports.length} downstream report(s):`);
    for (const r of reports) {
        console.log(`  - ${r.displayName} <${r.mail ?? r.userPrincipalName}>  id=${r.id}`);
    }
    console.log(`\nLooking specifically for santosh.singh@zinnia.com:`);
    const hit = reports.find((r) => (r.mail ?? "").toLowerCase() === "santosh.singh@zinnia.com");
    console.log(hit ? `FOUND: ${hit.displayName} id=${hit.id}` : "not in result set");
}
main().catch((e) => {
    console.error("error:", e?.message ?? e);
    process.exit(1);
});
//# sourceMappingURL=downstream-of.js.map