import { readJson, writeJson } from "./storage";

export interface UserPreferences {
  clockFormat: "12h" | "24h";
  // future: dateFormat, timezone overrides, theme, etc.
}

const KEY = "user-preferences";
const DEFAULTS: UserPreferences = { clockFormat: "12h" };

interface Store {
  byEmail: Record<string, UserPreferences>;
}

export async function getPreferences(email: string): Promise<UserPreferences> {
  const store = await readJson<Store>(KEY, { byEmail: {} });
  const lower = email.toLowerCase();
  return { ...DEFAULTS, ...(store.byEmail[lower] ?? {}) };
}

export async function setPreferences(
  email: string,
  patch: Partial<UserPreferences>
): Promise<UserPreferences> {
  const store = await readJson<Store>(KEY, { byEmail: {} });
  const lower = email.toLowerCase();
  const next: UserPreferences = { ...DEFAULTS, ...(store.byEmail[lower] ?? {}), ...patch };
  store.byEmail[lower] = next;
  await writeJson(KEY, store);
  return next;
}
