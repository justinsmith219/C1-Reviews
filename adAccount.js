"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enableAdAccount = exports.disableAdAccount = void 0;
exports.setAdAccountEnabled = setAdAccountEnabled;
exports.invalidateAdCache = invalidateAdCache;
exports.getAdAccountEnabled = getAdAccountEnabled;
const child_process_1 = require("child_process");
const config_1 = require("../config");
const logger_1 = require("../logger");
/**
 * Enable or disable an on-premises Active Directory account via PowerShell.
 *
 * Requires:
 *  - config.ad.enabled = true
 *  - config.ad.domain, config.ad.username, config.ad.password set
 *  - The production server must be domain-joined
 *  - The service account must have Write-userAccountControl on target users
 */
async function setAdAccountEnabled(email, enable) {
    if (!config_1.config.ad.enabled) {
        return { ok: true, skipped: true, message: "AD integration is disabled — skipped." };
    }
    const { domain, username, password } = config_1.config.ad;
    if (!domain || !username || !password) {
        return { ok: false, message: "AD credentials not fully configured (domain, username, password required)." };
    }
    const ps = buildPowerShellScript(email, domain, username, password, enable);
    try {
        const result = await runPowerShell(ps);
        if (result.stdout.startsWith("OK:")) {
            logger_1.logger.info(enable ? "ad_account_enabled" : "ad_account_disabled", { email, detail: result.stdout });
            // Bust the cache so the next page load reflects the new state.
            invalidateAdCache(email);
            return { ok: true, message: result.stdout.replace(/^OK:\s*/, "") };
        }
        const detail = result.stdout || result.stderr || "No output from PowerShell.";
        logger_1.logger.warn(enable ? "ad_account_enable_failed" : "ad_account_disable_failed", { email, detail });
        return { ok: false, message: detail };
    }
    catch (e) {
        const msg = e?.message ?? String(e);
        logger_1.logger.error("ad_account_set_error", { email, enable, err: msg });
        return { ok: false, message: msg };
    }
}
// Convenience wrappers kept for backward compatibility.
const disableAdAccount = (email) => setAdAccountEnabled(email, false);
exports.disableAdAccount = disableAdAccount;
const enableAdAccount = (email) => setAdAccountEnabled(email, true);
exports.enableAdAccount = enableAdAccount;
// ── In-memory AD status cache ─────────────────────────────────────────────────
// Avoids spawning a PowerShell process on every page load. TTL: 5 minutes.
// "NOT_FOUND" is cached as the string "not_found" to distinguish it from a
// failed lookup (null) so we can show "Cloud only" in the UI.
const AD_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const adStatusCache = new Map();
function invalidateAdCache(email) {
    if (email)
        adStatusCache.delete(email.toLowerCase());
    else
        adStatusCache.clear();
}
/**
 * Returns the enabled state of an AD account:
 *   true          — account exists and is enabled
 *   false         — account exists and is disabled
 *   "not_found"   — UPN and SAM lookup both returned nothing (cloud-only user)
 *   null          — AD disabled/unconfigured, or lookup failed
 *
 * Results are cached for 5 minutes per email.
 */
async function getAdAccountEnabled(email) {
    if (!config_1.config.ad.enabled)
        return null;
    const { domain, username, password } = config_1.config.ad;
    if (!domain || !username || !password)
        return null;
    const key = email.toLowerCase();
    const cached = adStatusCache.get(key);
    if (cached && cached.expiresAt > Date.now())
        return cached.value;
    const safePass = password.replace(/'/g, "''");
    const qualifiedUser = username.includes("\\") || username.includes("@")
        ? username
        : `${domain}\\${username}`;
    const ps = `
$ErrorActionPreference = 'Stop'
try {
  Import-Module ActiveDirectory -ErrorAction Stop
  $secPass = ConvertTo-SecureString '${safePass}' -AsPlainText -Force
  $cred    = New-Object System.Management.Automation.PSCredential('${qualifiedUser}', $secPass)
  $user = $null
  try { $user = Get-ADUser -Filter { UserPrincipalName -eq '${email}' } -Credential $cred -ErrorAction Stop } catch {}
  if (-not $user) {
    $sam = '${email}'.Split('@')[0]
    try { $user = Get-ADUser -Identity $sam -Credential $cred -ErrorAction Stop } catch {}
  }
  if (-not $user) { Write-Output "NOT_FOUND"; exit 0 }
  Write-Output $(if ($user.Enabled) { "ENABLED" } else { "DISABLED" })
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
  exit 1
}
`.trimStart();
    try {
        const result = await runPowerShell(ps);
        // Use the last non-empty line to guard against any module-load preamble.
        const lastLine = result.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean).pop() ?? "";
        let value = null;
        if (lastLine === "ENABLED")
            value = true;
        else if (lastLine === "DISABLED")
            value = false;
        else if (lastLine === "NOT_FOUND")
            value = "not_found";
        else {
            logger_1.logger.warn("ad_status_unexpected_output", { email, stdout: result.stdout, stderr: result.stderr });
        }
        // Cache all results including not_found — these won't change between loads.
        adStatusCache.set(key, { value, expiresAt: Date.now() + AD_CACHE_TTL_MS });
        return value;
    }
    catch (err) {
        logger_1.logger.warn("ad_status_error", { email, err: err?.message });
        return null; // don't cache errors — allow retry on next load
    }
}
function runPowerShell(script) {
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    return new Promise((resolve, reject) => {
        const child = (0, child_process_1.spawn)("powershell.exe", [
            "-NonInteractive",
            "-NoProfile",
            "-EncodedCommand",
            encoded,
        ], {
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => { stdout += d.toString(); });
        child.stderr.on("data", (d) => { stderr += d.toString(); });
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error("PowerShell timed out after 30s"));
        }, 30_000);
        child.on("close", () => {
            clearTimeout(timer);
            resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        });
        child.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}
function buildPowerShellScript(email, domain, username, password, enable) {
    const safePass = password.replace(/'/g, "''");
    const qualifiedUser = username.includes("\\") || username.includes("@")
        ? username
        : `${domain}\\${username}`;
    const action = enable ? "Enable-ADAccount" : "Disable-ADAccount";
    const already = enable ? "already enabled" : "already disabled";
    const done = enable ? "Enabled" : "Disabled";
    const check = enable ? "-not $user.Enabled" : "$user.Enabled"; // skip if already in target state? No — just do it regardless and report
    return `
$ErrorActionPreference = 'Stop'
try {
  Import-Module ActiveDirectory -ErrorAction Stop
  $secPass = ConvertTo-SecureString '${safePass}' -AsPlainText -Force
  $cred    = New-Object System.Management.Automation.PSCredential('${qualifiedUser}', $secPass)

  $user = $null
  try {
    $user = Get-ADUser -Filter { UserPrincipalName -eq '${email}' } -Credential $cred -ErrorAction Stop
  } catch {}

  if (-not $user) {
    $sam = '${email}'.Split('@')[0]
    try {
      $user = Get-ADUser -Identity $sam -Credential $cred -ErrorAction Stop
    } catch {}
  }

  if (-not $user) {
    Write-Output "ERROR: No AD account found for ${email}"
    exit 1
  }

  ${action} -Identity $user.DistinguishedName -Credential $cred -ErrorAction Stop
  Write-Output "OK: ${done} AD account $($user.SamAccountName) ($($user.UserPrincipalName))"
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
  exit 1
}
`.trimStart();
}
//# sourceMappingURL=adAccount.js.map