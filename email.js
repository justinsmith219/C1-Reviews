"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetEmailTransporter = resetEmailTransporter;
exports.sendEmail = sendEmail;
const nodemailer_1 = __importDefault(require("nodemailer"));
const config_1 = require("../config");
const logger_1 = require("../logger");
let transporter = null;
function resetEmailTransporter() {
    transporter = null;
}
function mailer() {
    if (!transporter) {
        if (!config_1.config.smtp.host)
            throw new Error("SMTP_HOST not configured");
        transporter = nodemailer_1.default.createTransport({
            host: config_1.config.smtp.host,
            port: config_1.config.smtp.port,
            secure: config_1.config.smtp.secure,
            auth: config_1.config.smtp.user
                ? { user: config_1.config.smtp.user, pass: config_1.config.smtp.pass }
                : undefined,
            // Permit cert mismatches when explicitly allowed (e.g. a Proofpoint relay
            // whose wildcard cert doesn't cover the internal hostname we connect to).
            tls: config_1.config.smtp.allowInvalidCerts
                ? { rejectUnauthorized: false }
                : undefined,
            // STARTTLS is the default on port 587; on 25 most relays accept plaintext
            // but will upgrade if offered. Letting nodemailer pick is fine.
        });
    }
    return transporter;
}
async function sendEmail(args) {
    const isDryRun = args.dryRun !== undefined ? args.dryRun : config_1.config.notifications.dryRun;
    if (isDryRun) {
        logger_1.logger.info("email_dry_run", { to: args.to, subject: args.subject });
        return { ok: true, dryRun: true };
    }
    // Test-recipient override applies only to user (non-admin) sends.
    const redirect = args.dryRun !== undefined ? "" : config_1.config.notifications.testRecipient;
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
            from: config_1.config.smtp.from,
            to,
            cc,
            subject,
            html,
            text: args.text ?? html.replace(/<[^>]+>/g, ""),
        });
        return { ok: true };
    }
    catch (err) {
        logger_1.logger.warn("email_send_failed", { to, err: err?.message });
        return { ok: false, error: err?.message ?? "smtp_error" };
    }
}
//# sourceMappingURL=email.js.map