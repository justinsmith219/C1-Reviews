import crypto from "crypto";
import { NotificationRecord } from "../types/domain";
import { appendJsonl, readJsonl } from "./storage";
import { audit } from "./audit";

const KEY = "notifications";

export async function recordNotification(
  rec: Omit<NotificationRecord, "id" | "sentAt">
): Promise<NotificationRecord> {
  const full: NotificationRecord = {
    id: crypto.randomUUID(),
    sentAt: new Date().toISOString(),
    ...rec,
  };
  await appendJsonl(KEY, full);
  await audit({
    actor: "system",
    action: full.dryRun ? "notify.dryrun" : full.success ? "notify.sent" : "notify.failed",
    target: full.recipientEmail,
    details: {
      channel: full.channel,
      kind: full.kind,
      campaignId: full.campaignId,
      error: full.error,
      dryRun: full.dryRun,
    },
  });
  return full;
}

export async function listNotifications(limit = 500): Promise<NotificationRecord[]> {
  return readJsonl<NotificationRecord>(KEY, limit);
}
