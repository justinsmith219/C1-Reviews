import nodemailer, { Transporter } from "nodemailer";
import { config } from "../config";
import { logger } from "../logger";

let transporter: Transporter | null = null;

export function resetEmailTransporter(): void {
  transporter = null;
}

function mailer(): Transporter {
  if (!transporter) {
    if (!config.smtp.host) throw new Error("SMTP_HOST not configured");
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user
        ? { user: config.smtp.user, pass: config.smtp.pass }
        : undefined,
      // Permit cert mismatches when explicitly allowed (e.g. a Proofpoint relay
      // whose wildcard cert doesn't cover the internal hostname we connect to).
      tls: config.smtp.allowInvalidCerts
        ? { rejectUnauthorized: false }
        : undefined,
      // STARTTLS is the default on port 587; on 25 most relays accept plaintext
      // but will upgrade if offered. Letting nodemailer pick is fine.
    });
  }
  return transporter;
}

export async function sendEmail(args: {
  to: string;
  cc?: string[];
  subject: string;
  html: string;
  text?: string;
  dryRun?: boolean;
}): Promise<{ ok: boolean; error?: string; dryRun?: boolean }> {
  const isDryRun = args.dryRun !== undefined ? args.dryRun : config.notifications.dryRun;
  if (isDryRun) {
    logger.info("email_dry_run", { to: args.to, subject: args.subject });
    return { ok: true, dryRun: true };
  }
  // Test-recipient override applies only to user (non-admin) sends.
  const redirect = args.dryRun !== undefined ? "" : config.notifications.testRecipient;
  let to = args.to;
  let cc = args.cc;
  let subject = args.subject;
  let html = args.html;
  if (redirect) {
    const origDetail = `[TEST → ${args.to}${args.cc?.length ? ` cc: ${args.cc.join(", ")}` : ""}]`;
    to = redirect;
    cc = undefined;
    subject = `${origDetail} ${subject}`;
    html = `<div style="background:#fdf3da;border:1px solid #c28400;padding:8px 12px;margin-bottom:12px;border-radius:6px;font-size:12px;color:#8b5800;">Redirected from <strong>${args.to}</strong>${args.cc?.length ? ` (cc: ${args.cc.join(", ")})` : ""} — test-recipient mode is on.</div>${args.html}`;
  }
  try {
    await mailer().sendMail({
      from: config.smtp.from,
      to,
      cc,
      subject,
      html,
      text: args.text ?? html.replace(/<[^>]+>/g, ""),
    });
    return { ok: true };
  } catch (err: any) {
    logger.warn("email_send_failed", { to, err: err?.message });
    return { ok: false, error: err?.message ?? "smtp_error" };
  }
}
