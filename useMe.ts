import { useEffect, useState } from "react";
import { SessionUser, getImpersonate, getViewAs, scopeLocalStorage, withBase } from "./api";

export interface SetupStatus {
  configured: boolean;
  redirectUri: string;
  adminsCount: number;
}

export interface BootState {
  loading: boolean;
  me: SessionUser | null;
  setup: SetupStatus | null;
}

export function useMe(): { me: SessionUser | null; loading: boolean } {
  const { me, loading } = useBoot();
  return { me, loading };
}

export function useBoot(): BootState {
  const [state, setState] = useState<BootState>({ loading: true, me: null, setup: null });
  useEffect(() => {
    (async () => {
      try {
        // Do NOT send impersonation on the identity-establishing /me call —
        // localStorage isn't scoped yet so we'd risk sending a stale email
        // left by the previous user on this machine.
        const meRes = await fetch(withBase("/auth/me"), { credentials: "include" });
        if (meRes.ok) {
          const me = (await meRes.json()) as SessionUser;
          // Scope localStorage to this user before anything else reads it,
          // so impersonate/viewAs state is never shared across accounts.
          scopeLocalStorage(me.email);
          setState({ loading: false, me, setup: null });
          return;
        }
        const setupRes = await fetch(withBase("/auth/setup-status"));
        const setup = (await setupRes.json()) as SetupStatus;
        if (!setup.configured) {
          setState({ loading: false, me: null, setup });
          return;
        }
        // Configured but not signed in — redirect to SSO.
        window.location.href =
          withBase("/auth/login") + "?returnTo=" + encodeURIComponent(window.location.pathname);
      } catch (e) {
        setState({ loading: false, me: null, setup: null });
      }
    })();
  }, []);
  return state;
}
