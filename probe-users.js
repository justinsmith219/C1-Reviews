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
    const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const userId = "2oXbWevRpa3Polf0u42QAWB4leF";
    for (const path of [
        `/users/${userId}`,
        `/user/${userId}`,
        `/directory/users/${userId}`,
        `/identity/users/${userId}`,
    ]) {
        try {
            const r = await axios_1.default.get(`${base}${path}`, { headers: h, validateStatus: () => true });
            console.log(`GET ${path} -> ${r.status}`);
            if (r.status === 200)
                console.log(JSON.stringify(r.data, null, 2).slice(0, 800));
        }
        catch (e) {
            console.log(`GET ${path} err`, e?.message);
        }
    }
    for (const path of ["/search/users", "/users/search", "/user/search", "/directory/users/search"]) {
        try {
            const r = await axios_1.default.post(`${base}${path}`, { userIds: [userId], pageSize: 5 }, { headers: h, validateStatus: () => true });
            console.log(`POST ${path} -> ${r.status}`);
            if (r.status === 200)
                console.log(JSON.stringify(r.data, null, 2).slice(0, 1500));
        }
        catch (e) {
            console.log(`POST ${path} err`, e?.message);
        }
    }
}
main().catch((e) => console.error(e));
//# sourceMappingURL=probe-users.js.map