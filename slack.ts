import { WebClient } from "@slack/web-api";
import { config } from "../config";
import { logger } from "../logger";

let client: WebClient | null = null;

function slack(): WebClient {
  if (!client) {
    if (!config.slack.botToken) throw new Error("SLACK_BOT_TOKEN not configured");
    client = new WebClient(config.slack.botToken);
  }
  return client;
}

export function resetSlackClient(): void {
  client = null;
  slackIdByEmail.clear();
}

const slackIdByEmail = new Map<string, string | null>();

export async function resolveSlackUserId(email: string): Promise<string | null> {
  const key = email.toLowerCase();
  if (slackIdByEmail.has(key)) return slackIdByEmail.get(key)!;
  try {
    const res = await slack().users.lookupByEmail({ email: key });
    const id = res.user?.id ?? null;
    slackIdByEmail.set(key, id);
    return id;
  } catch (err: any) {
    logger.warn("slack_lookup_failed", { email: key, err: err?.data?.error ?? err?.message });
    slackIdByEmail.set(key, null);
    return null;
  }
}

export async function sendSlackDM(
  email: string,
  text: string,
  blocks?: any[],
  opts?: { dryRun?: boolean }
): Promise<{ ok: boolean; error?: string; dryRun?: boolean }> {
  const isDryRun = opts?.dryRun !== undefined ? opts.dryRun : config.notifications.dryRun;
  if (isDryRun) {
    logger.info("slack_dry_run", { email, len: text.length });
    return { ok: true, dryRun: true };
  }
  // Test-recipient override applies only to user (non-admin) sends.
  const redirect = opts?.dryRun !== undefined ? "" : config.notifications.testRecipient;
  let actualEmail = email;
  let prefixedText = text;
  if (redirect) {
    actualEmail = redirect;
    prefixedText = `*[TEST → ${email}]*\n${text}`;
    if (Array.isArray(blocks) && blocks.length > 0) {
      blocks = [
        {
          type: "section",
          text: { type: "mrkdwn", text: `*[TEST → ${email}]*` },
        },
        ...blocks,
      ];
    }
  }
  const userId = await resolveSlackUserId(actualEmail);
  if (!userId) return { ok: false, error: "no_slack_user_for_email" };
  try {
    await slack().chat.postMessage({
      channel: userId,
      text: prefixedText,
      blocks,
      unfurl_links: false,
    });
    return { ok: true };
  } catch (err: any) {
    const errMsg = err?.data?.error ?? err?.message ?? "slack_error";
    logger.warn("slack_send_failed", { email, err: errMsg });
    return { ok: false, error: errMsg };
  }
}
