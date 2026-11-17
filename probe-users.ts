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
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const userId = "2oXbWevRpa3Polf0u42QAWB4leF";

  for (const path of [
    `/users/${userId}`,
    `/user/${userId}`,
    `/directory/users/${userId}`,
    `/identity/users/${userId}`,
  ]) {
    try {
      const r = await axios.get(`${base}${path}`, { headers: h, validateStatus: () => true });
      console.log(`GET ${path} -> ${r.status}`);
      if (r.status === 200) console.log(JSON.stringify(r.data, null, 2).slice(0, 800));
    } catch (e: any) {
      console.log(`GET ${path} err`, e?.message);
    }
  }

  for (const path of ["/search/users", "/users/search", "/user/search", "/directory/users/search"]) {
    try {
      const r = await axios.post(
        `${base}${path}`,
        { userIds: [userId], pageSize: 5 },
        { headers: h, validateStatus: () => true }
      );
      console.log(`POST ${path} -> ${r.status}`);
      if (r.status === 200) console.log(JSON.stringify(r.data, null, 2).slice(0, 1500));
    } catch (e: any) {
      console.log(`POST ${path} err`, e?.message);
    }
  }
}
main().catch((e) => console.error(e));
