import axios from "axios";
import { config } from "../config";
import { loadAtBoot } from "../services/runtimeConfig";

async function main() {
  await loadAtBoot();
  const tokenRes = await axios.post(`${config.conductor1.baseUrl}/auth/v1/token`,
    new URLSearchParams({ grant_type: "client_credentials", client_id: config.conductor1.clientId, client_secret: config.conductor1.clientSecret }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  const token = tokenRes.data.access_token;
  const r = await axios.post(`${config.conductor1.baseUrl}/api/v1/search/tasks`,
    { accessReviewIds: ["3BlHFKcF7rW0DF65Vo0piDiztNe"], pageSize: 2 },
    { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  const t = r.data.list?.[0]?.task ?? r.data.list?.[0];
  console.log("keys:", Object.keys(t).filter(k => k.toLowerCase().includes("at") || k === "state" || k === "closedAt").join(","));
  console.log("state:", t.state, "closedAt:", t.closedAt, "updatedAt:", t.updatedAt, "createdAt:", t.createdAt);
}
main().catch(e=>console.error(e?.response?.data ?? e?.message));
