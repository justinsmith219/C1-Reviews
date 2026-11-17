// Tiny in-process job registry — tracks long-running operations and recent
// scheduled-job outcomes so the admin can see what's running and what last ran.
//
// Two kinds of entries:
//   - "scheduled":     cron-driven jobs (refresh, digest, scorecards). The cron
//                      handlers report their schedule + each run's outcome here.
//   - "on-demand":     async ops kicked off by user actions (history import,
//                      per-campaign task fetch, manual notify). Reported as
//                      they start/finish.

export type JobStatus = "idle" | "running" | "success" | "failed";

export interface JobInfo {
  id: string;
  name: string;
  kind: "scheduled" | "on-demand";
  schedule?: string;
  timezone?: string;
  status: JobStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  message?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  // Free-form extra (e.g. tasks fetched, plans built).
  details?: Record<string, unknown>;
}

const registry = new Map<string, JobInfo>();

export function register(info: Omit<JobInfo, "status">): JobInfo {
  const existing = registry.get(info.id);
  const next: JobInfo = { ...existing, ...info, status: existing?.status ?? "idle" };
  registry.set(info.id, next);
  return next;
}

export function start(id: string, message?: string, details?: Record<string, unknown>): void {
  const cur = registry.get(id);
  if (!cur) return;
  cur.status = "running";
  cur.startedAt = new Date().toISOString();
  cur.finishedAt = undefined;
  cur.durationMs = undefined;
  cur.message = message;
  if (details) cur.details = { ...cur.details, ...details };
}

export function finish(
  id: string,
  result: { ok: boolean; message?: string; details?: Record<string, unknown> }
): void {
  const cur = registry.get(id);
  if (!cur) return;
  const finishedAt = new Date().toISOString();
  cur.status = result.ok ? "success" : "failed";
  cur.finishedAt = finishedAt;
  cur.durationMs = cur.startedAt ? Date.now() - new Date(cur.startedAt).getTime() : undefined;
  cur.message = result.message ?? cur.message;
  if (result.details) cur.details = { ...cur.details, ...result.details };
  if (result.ok) cur.lastSuccessAt = finishedAt;
  else cur.lastFailureAt = finishedAt;
}

export async function track<T>(
  id: string,
  fn: () => Promise<T>,
  opts: { startMessage?: string; details?: Record<string, unknown> } = {}
): Promise<T> {
  start(id, opts.startMessage, opts.details);
  try {
    const result = await fn();
    finish(id, { ok: true });
    return result;
  } catch (err: any) {
    finish(id, { ok: false, message: err?.message ?? "failed" });
    throw err;
  }
}

export function list(): JobInfo[] {
  return [...registry.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function update(id: string, patch: Partial<JobInfo>): void {
  const cur = registry.get(id);
  if (!cur) return;
  Object.assign(cur, patch);
}
