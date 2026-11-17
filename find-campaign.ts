import "../config";
import axios from "axios";
import { config } from "../config";
import { loadAtBoot } from "../services/runtimeConfig";

async function getToken(): Promise<string> {
  if (config.conductor1.apiToken) return config.conductor1.apiToken;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.conductor1.clientId,
    client_secret: config.conductor1.clientSecret,
  });
  const r = await axios.post(`${config.conductor1.baseUrl}/auth/v1/token`, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return r.data.access_token;
}

async function main() {
  await loadAtBoot();
  const token = await getToken();
  const base = `${config.conductor1.baseUrl}/api/v1`;

  const all: any[] = [];
  let pageToken: string | undefined;
  do {
    const r = await axios.get(`${base}/access_reviews`, {
      params: { page_size: 100, page_token: pageToken },
      headers: { Authorization: `Bearer ${token}` },
    });
    all.push(...(r.data.list ?? []));
    pageToken = r.data.nextPageToken || undefined;
  } while (pageToken);

  console.log("total campaigns:", all.length);
  const stateCounts = new Map<string, number>();
  for (const r of all) {
    const s = r.accessReview?.state ?? "NONE";
    stateCounts.set(s, (stateCounts.get(s) ?? 0) + 1);
  }
  console.log("state breakdown:");
  for (const [k, v] of stateCounts) console.log(` ${k}: ${v}`);

  console.log("\n=== ALL campaigns in OPEN or PENDING state ===");
  for (const r of all) {
    const s = r.accessReview?.state;
    if (s === "ACCESS_REVIEW_STATE_OPEN" || s === "ACCESS_REVIEW_STATE_PENDING") {
      console.log(
        " -",
        s,
        "|",
        r.accessReview?.displayName,
        "| id:",
        r.accessReview?.id,
        "| startedAt:",
        r.accessReview?.startedAt,
        "| completionDate:",
        r.accessReview?.completionDate
      );
    }
  }

  const match = all.find((r) => /quarterly uar apr 2026/i.test(r.accessReview?.displayName ?? ""));
  console.log("\n=== matching 'Quarterly UAR Apr 2026' ===");
  if (match) {
    console.log(JSON.stringify(match.accessReview, null, 2));
  } else {
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
