// Diagnose why a given email is showing up in someone's "downstream tree" per Entra.
// Walks UP from the target email via the `manager` attribute and prints each step
// until it either reaches the asker or runs out of managers.
//
// Run: npx tsx src/scripts/why-visible.ts <asker-email> <target-email>
import "../config";
import { loadAtBoot } from "../services/runtimeConfig";
import { graphClient } from "../services/graph";

async function main() {
  await loadAtBoot();
  const [asker, target] = process.argv.slice(2);
  if (!asker || !target) {
    console.error("usage: why-visible.ts <asker-email> <target-email>");
    process.exit(1);
  }
  const gc = await graphClient();
  console.log(`Asking: is ${target} a transitive report of ${asker}?\n`);

  let current: any = await gc
    .api(`/users/${encodeURIComponent(target)}`)
    .select("id,mail,userPrincipalName,displayName")
    .get();
  console.log(`0  ${current.displayName} <${current.mail ?? current.userPrincipalName}>`);

  for (let depth = 1; depth <= 30; depth++) {
    let mgr: any = null;
    try {
      mgr = await gc
        .api(`/users/${current.id}/manager`)
        .select("id,mail,userPrincipalName,displayName")
        .get();
    } catch {
      console.log(`${depth}  (no manager attribute set — chain ends)`);
      return;
    }
    const mgrEmail = (mgr.mail ?? mgr.userPrincipalName ?? "").toLowerCase();
    console.log(`${depth}  ↑ ${mgr.displayName} <${mgrEmail}>`);
    if (mgrEmail === asker.toLowerCase()) {
      console.log(`\n>>> Reaches ${asker} at depth ${depth}. That's why visibility includes ${target}.`);
      return;
    }
    current = mgr;
  }
  console.log("\n>>> 30 levels traversed without reaching the asker. Probably not actually in tree.");
}

main().catch((e) => {
  console.error("error:", e?.message ?? e);
  process.exit(1);
});
