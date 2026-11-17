import axios from "axios";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { WebClient } from "@slack/web-api";
import nodemailer from "nodemailer";
import { config } from "../config";
import { ConnectionTestResult } from "./runtimeConfig";

async function testConductor1(): Promise<{ ok: boolean; message: string }> {
  try {
    if (config.conductor1.apiToken) {
      const res = await axios.get(
        `${config.conductor1.baseUrl}/api/v1/access_reviews?page_size=1`,
        {
          headers: { Authorization: `Bearer ${config.conductor1.apiToken}` },
          timeout: 10_000,
          validateStatus: () => true,
        }
      );
      if (res.status === 200) return { ok: true, message: "API token accepted" };
      return { ok: false, message: `HTTP ${res.status} — token rejected` };
    }
    if (!config.conductor1.clientId || !config.conductor1.clientSecret) {
      return { ok: false, message: "No credentials configured" };
    }
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.conductor1.clientId,
      client_secret: config.conductor1.clientSecret,
    });
    const res = await axios.post(
      `${config.conductor1.baseUrl}/auth/v1/token`,
      body.toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 10_000,
        validateStatus: () => true,
      }
    );
    if (res.status === 200 && res.data?.access_token) {
      return { ok: true, message: "OAuth client_credentials token issued" };
    }
    return {
      ok: false,
      message: `HTTP ${res.status} — ${res.data?.error ?? "auth failed"}`,
    };
  } catch (err: any) {
    return { ok: false, message: err?.message ?? "error" };
  }
}

async function testEntra(): Promise<{ ok: boolean; message: string }> {
  try {
    if (!config.entra.tenantId || !config.entra.clientId || !config.entra.clientSecret) {
      return { ok: false, message: "Missing tenantId / clientId / clientSecret" };
    }
    const m = new ConfidentialClientApplication({
      auth: {
        clientId: config.entra.clientId,
        clientSecret: config.entra.clientSecret,
        authority: `https://login.microsoftonline.com/${config.entra.tenantId}`,
      },
    });
    const t = await m.acquireTokenByClientCredential({
      scopes: ["https://graph.microsoft.com/.default"],
    });
    if (t?.accessToken) return { ok: true, message: "Graph app-only token issued" };
    return { ok: false, message: "No token returned" };
  } catch (err: any) {
    return { ok: false, message: err?.message ?? "error" };
  }
}

async function testSlack(): Promise<{ ok: boolean; message: string }> {
  try {
    if (!config.slack.botToken) return { ok: false, message: "Bot token not set" };
    const c = new WebClient(config.slack.botToken);
    const r = await c.auth.test();
    return {
      ok: !!r.ok,
      message: r.ok ? `Signed in as ${r.user} (${r.team})` : "auth.test failed",
    };
  } catch (err: any) {
    return { ok: false, message: err?.data?.error ?? err?.message ?? "error" };
  }
}

async function testSmtp(): Promise<{ ok: boolean; message: string }> {
  try {
    if (!config.smtp.host) return { ok: false, message: "SMTP host not set" };
    const t = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      tls: config.smtp.allowInvalidCerts ? { rejectUnauthorized: false } : undefined,
    });
    await t.verify();
    return { ok: true, message: `Connected to ${config.smtp.host}:${config.smtp.port}` };
  } catch (err: any) {
    return { ok: false, message: err?.message ?? "error" };
  }
}

export async function runConnectionTests(): Promise<ConnectionTestResult> {
  const [conductor1, entra, slack, smtp] = await Promise.all([
    testConductor1(),
    testEntra(),
    testSlack(),
    testSmtp(),
  ]);
  return { conductor1, entra, slack, smtp };
}
