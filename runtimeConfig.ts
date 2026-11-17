import { config } from "../config";
import { readJson, writeJson } from "./storage";
import { audit } from "./audit";
import { logger } from "../logger";
import { resetSlackClient } from "./slack";
import { resetEmailTransporter } from "./email";
import { resetGraphClient } from "./graph";
import { resetConductorTokenCache } from "./conductor1";

// Runtime configuration stored in data/runtime-config.json.
// Values here override the .env at boot-time and whenever an admin saves the form.
// Secrets are masked on read; a sentinel of "__UNCHANGED__" on write means "keep".

const KEY = "runtime-config";
export const SECRET_MASK = "__UNCHANGED__";

export interface RuntimeConfig {
  conductor1: {
    baseUrl: string;
    clientId: string;
    clientSecret: string;
    apiToken: string;
  };
  entra: {
    tenantId: string;
    clientId: string;
    clientSecret: string;
  };
  adminEmails: string[];
  slack: {
    botToken: string;
  };
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
    allowInvalidCerts: boolean;
  };
  orgTop: {
    ceoEmail: string;
    excludeCeoFromEscalation: boolean;
  };
  digest: {
    // HH:MM (24h) — when the daily digest fires (always America/New_York).
    timeOfDay: string;
    skipWeekends: boolean;
  };
  schedule: {
    // HH:MM (24h) — when the nightly scorecards recompute fires.
    scorecardsTime: string;
    // Hours between Conductor1 snapshot refreshes (1 = every hour).
    refreshIntervalHours: number;
    // Hours between pre-warm runs of per-campaign task details (0 = disabled).
    prewarmIntervalHours: number;
  };
  notifications: {
    autoSendEnabled: boolean;
    adminNotificationsEnabled: boolean;
    testRecipient: string;
    dryRun: boolean;
    adminDryRun: boolean;
  };
  helpdeskNotification: {
    enabled: boolean;
    slackChannel: string;
  };
  completionAlert: {
    enabled: boolean;
    // How to deliver the alert.
    channel: "slack-channel" | "slack-dm" | "email";
    // Slack channel name (e.g. #access-reviews), email for DM, or email address.
    recipient: string;
  };
  ad: {
    enabled: boolean;
    domain: string;
    username: string;
    password: string;
  };
}

const SECRET_PATHS: string[] = [
  "conductor1.clientSecret",
  "conductor1.apiToken",
  "entra.clientSecret",
  "slack.botToken",
  "smtp.pass",
  "ad.password",
];

function maskValue(v: string): string {
  if (!v) return "";
  if (v.length <= 4) return "••••";
  return `••••${v.slice(-4)}`;
}

function cloneLiveAsRuntime(): RuntimeConfig {
  // intentionally placed before timeToCron/cronToTime helpers — only references config fields.
  return {
    conductor1: {
      baseUrl: config.conductor1.baseUrl,
      clientId: config.conductor1.clientId,
      clientSecret: config.conductor1.clientSecret,
      apiToken: config.conductor1.apiToken,
    },
    entra: {
      tenantId: config.entra.tenantId,
      clientId: config.entra.clientId,
      clientSecret: config.entra.clientSecret,
    },
    adminEmails: [...config.admins],
    slack: { botToken: config.slack.botToken },
    smtp: {
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      user: config.smtp.user,
      pass: config.smtp.pass,
      from: config.smtp.from,
      allowInvalidCerts: config.smtp.allowInvalidCerts,
    },
    orgTop: { ...config.orgTop },
    digest: {
      timeOfDay: cronToTime(config.digest.cron),
      skipWeekends: config.digest.skipWeekends,
    },
    schedule: {
      scorecardsTime: cronToTime(config.cron.scorecards),
      refreshIntervalHours: cronToHours(config.cron.refreshCampaigns),
      prewarmIntervalHours: cronToHours(config.cron.prewarmCampaignDetails ?? "0 */4 * * *"),
    },
    notifications: {
      autoSendEnabled: config.notifications.autoSendEnabled,
      adminNotificationsEnabled: config.notifications.adminNotificationsEnabled,
      dryRun: config.notifications.dryRun,
      adminDryRun: config.notifications.adminDryRun,
      testRecipient: config.notifications.testRecipient,
    },
    helpdeskNotification: { ...config.helpdeskNotification },
    completionAlert: { ...config.completionAlert },
    ad: {
      enabled: config.ad.enabled,
      domain: config.ad.domain,
      username: config.ad.username,
      password: config.ad.password,
    },
  };
}

// "0 */N * * *" or "0 * * * *" -> N (1 if cron is "0 * * * *").
export function cronToHours(cron: string): number {
  const parts = (cron ?? "").trim().split(/\s+/);
  if (parts.length < 2) return 1;
  if (parts[1] === "*") return 1;
  const m = /^\*\/(\d+)$/.exec(parts[1]);
  if (m) return Math.max(1, parseInt(m[1], 10));
  return 1;
}
// N -> "0 */N * * *"; N=1 -> "0 * * * *".
export function hoursToCron(hours: number): string {
  const h = Math.max(1, Math.min(24, Math.floor(hours)));
  return h === 1 ? "0 * * * *" : `0 */${h} * * *`;
}

// Convert "HH:MM" -> "M H * * *" (cron expression). Empty/invalid -> default 02:00.
export function timeToCron(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? "").trim());
  if (!m) return "0 2 * * *";
  const h = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  const mm = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  return `${mm} ${h} * * *`;
}
// Convert "M H * * *" -> "HH:MM" (best-effort; complex crons fall back to 02:00).
export function cronToTime(cron: string): string {
  const parts = (cron ?? "").trim().split(/\s+/);
  if (parts.length < 2) return "02:00";
  const m = parseInt(parts[0], 10);
  const h = parseInt(parts[1], 10);
  if (Number.isNaN(m) || Number.isNaN(h)) return "02:00";
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function applyToLiveConfig(rc: RuntimeConfig): void {
  config.conductor1.baseUrl = rc.conductor1.baseUrl.replace(/\/$/, "");
  config.conductor1.clientId = rc.conductor1.clientId;
  config.conductor1.clientSecret = rc.conductor1.clientSecret;
  config.conductor1.apiToken = rc.conductor1.apiToken;

  config.entra.tenantId = rc.entra.tenantId;
  config.entra.clientId = rc.entra.clientId;
  config.entra.clientSecret = rc.entra.clientSecret;

  config.admins.splice(
    0,
    config.admins.length,
    ...rc.adminEmails.map((e) => e.toLowerCase().trim()).filter(Boolean)
  );

  config.slack.botToken = rc.slack.botToken;

  config.smtp.host = rc.smtp.host;
  config.smtp.port = rc.smtp.port;
  config.smtp.secure = rc.smtp.secure;
  config.smtp.user = rc.smtp.user;
  config.smtp.pass = rc.smtp.pass;
  config.smtp.from = rc.smtp.from;
  config.smtp.allowInvalidCerts = !!rc.smtp.allowInvalidCerts;

  if (rc.orgTop) {
    config.orgTop.ceoEmail = rc.orgTop.ceoEmail.toLowerCase();
    config.orgTop.excludeCeoFromEscalation = !!rc.orgTop.excludeCeoFromEscalation;
  }
  if (rc.digest) {
    // Always force America/New_York; the UI no longer exposes timezone.
    config.digest.tz = "America/New_York";
    config.digest.skipWeekends = !!rc.digest.skipWeekends;
    if (rc.digest.timeOfDay) {
      const base = timeToCron(rc.digest.timeOfDay);
      // Append weekday filter if skipping weekends ("M H * * 1-5").
      config.digest.cron = rc.digest.skipWeekends
        ? base.replace(/\*\s*$/, "1-5")
        : base;
    }
  }
  if (rc.schedule?.scorecardsTime) {
    config.cron.scorecards = timeToCron(rc.schedule.scorecardsTime);
  }
  if (typeof rc.schedule?.refreshIntervalHours === "number") {
    config.cron.refreshCampaigns = hoursToCron(rc.schedule.refreshIntervalHours);
  }
  if (typeof rc.schedule?.prewarmIntervalHours === "number") {
    config.cron.prewarmCampaignDetails = hoursToCron(rc.schedule.prewarmIntervalHours);
  }
  if (rc.notifications) {
    config.notifications.autoSendEnabled = !!rc.notifications.autoSendEnabled;
    config.notifications.adminNotificationsEnabled = !!rc.notifications.adminNotificationsEnabled;
    config.notifications.testRecipient = (rc.notifications.testRecipient ?? "").trim();
    if (typeof rc.notifications.dryRun === "boolean") {
      config.notifications.dryRun = rc.notifications.dryRun;
    }
    if (typeof rc.notifications.adminDryRun === "boolean") {
      config.notifications.adminDryRun = rc.notifications.adminDryRun;
    }
  }
  if (rc.helpdeskNotification) {
    config.helpdeskNotification.enabled = !!rc.helpdeskNotification.enabled;
    config.helpdeskNotification.slackChannel = (rc.helpdeskNotification.slackChannel ?? "").trim();
  }
  if (rc.completionAlert) {
    config.completionAlert.enabled = !!rc.completionAlert.enabled;
    if (rc.completionAlert.channel) config.completionAlert.channel = rc.completionAlert.channel;
    config.completionAlert.recipient = (rc.completionAlert.recipient ?? "").trim();
  }
  if (rc.ad) {
    config.ad.enabled = !!rc.ad.enabled;
    config.ad.domain = (rc.ad.domain ?? "").trim();
    config.ad.username = (rc.ad.username ?? "").trim();
    config.ad.password = rc.ad.password ?? "";
  }
}

function invalidateClients(): void {
  resetSlackClient();
  resetEmailTransporter();
  resetGraphClient();
  resetConductorTokenCache();
}

const scheduleChangeHandlers: Array<() => void> = [];
export function registerScheduleChangeHandler(fn: () => void): void {
  scheduleChangeHandlers.push(fn);
}
function fireScheduleChange(): void {
  for (const fn of scheduleChangeHandlers) {
    try {
      fn();
    } catch {}
  }
}

export async function loadAtBoot(): Promise<void> {
  try {
    const stored = await readJson<RuntimeConfig | null>(KEY, null);
    if (stored) {
      applyToLiveConfig(stored);
      logger.info("runtime_config_loaded");
    }
  } catch (err: any) {
    logger.warn("runtime_config_boot_load_failed", { err: err?.message });
  }
}

function getPath(obj: any, path: string): any {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj: any, path: string, val: any): void {
  const parts = path.split(".");
  let cur: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = val;
}

export async function getMasked(): Promise<RuntimeConfig> {
  const rc = cloneLiveAsRuntime();
  for (const p of SECRET_PATHS) {
    const v = getPath(rc, p);
    if (typeof v === "string") setPath(rc, p, maskValue(v));
  }
  return rc;
}

// For the UI's write path. Secret fields that the client sends back unchanged
// arrive as their masked value; we detect this and keep the existing secret.
function mergeSecrets(incoming: RuntimeConfig, current: RuntimeConfig): RuntimeConfig {
  const merged = JSON.parse(JSON.stringify(incoming)) as RuntimeConfig;
  for (const p of SECRET_PATHS) {
    const inVal = getPath(merged, p);
    const existing = getPath(current, p);
    if (typeof inVal !== "string") continue;
    if (inVal === SECRET_MASK || inVal.startsWith("••••") || inVal === "") {
      // Empty string when the admin explicitly clears the field — treat as keep.
      // If you want to clear a secret, pass a single space (" ") and we'll set it empty.
      setPath(merged, p, existing);
    } else if (inVal.trim() === "") {
      setPath(merged, p, "");
    }
  }
  return merged;
}

export async function update(
  partial: Partial<RuntimeConfig>,
  actor: string
): Promise<RuntimeConfig> {
  const current = cloneLiveAsRuntime();
  const incomingFull: RuntimeConfig = {
    conductor1: { ...current.conductor1, ...(partial.conductor1 ?? {}) },
    entra: { ...current.entra, ...(partial.entra ?? {}) },
    adminEmails: partial.adminEmails ?? current.adminEmails,
    slack: { ...current.slack, ...(partial.slack ?? {}) },
    smtp: { ...current.smtp, ...(partial.smtp ?? {}) },
    orgTop: { ...current.orgTop, ...(partial.orgTop ?? {}) },
    digest: { ...current.digest, ...(partial.digest ?? {}) },
    schedule: { ...current.schedule, ...(partial.schedule ?? {}) },
    notifications: { ...current.notifications, ...(partial.notifications ?? {}) },
    helpdeskNotification: { ...current.helpdeskNotification, ...(partial.helpdeskNotification ?? {}) },
    completionAlert: { ...current.completionAlert, ...(partial.completionAlert ?? {}) },
    ad: { ...current.ad, ...(partial.ad ?? {}) },
  };
  const merged = mergeSecrets(incomingFull, current);

  await writeJson(KEY, merged);
  const scheduleChanged =
    !!partial.schedule || !!partial.digest;
  applyToLiveConfig(merged);
  invalidateClients();
  if (scheduleChanged) fireScheduleChange();

  await audit({
    actor,
    action: "runtime_config.update",
    details: {
      // Never log secret values.
      fieldsTouched: Object.keys(partial),
      adminCount: merged.adminEmails.length,
    },
  });
  return getMasked();
}

export interface ConnectionTestResult {
  conductor1: { ok: boolean; message: string };
  entra: { ok: boolean; message: string };
  slack: { ok: boolean; message: string };
  smtp: { ok: boolean; message: string };
}
