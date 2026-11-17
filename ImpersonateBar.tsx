import { useEffect, useRef, useState } from "react";
import { api, getImpersonate, setImpersonate, SessionUser } from "../lib/api";

export function ImpersonateBar({ me }: { me: SessionUser }) {
  // Always-visible banner when impersonating; otherwise a small picker for admins.
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ email: string; displayName: string }>>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>();

  // Search via existing /api/search "people" results
  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    timer.current = window.setTimeout(async () => {
      const r = await api.search(q);
      setResults(
        r.people
          .map((p) => ({ email: p.email, displayName: p.displayName }))
          .slice(0, 8)
      );
    }, 200);
  }, [q]);

  function start(email: string) {
    setImpersonate(email);
    window.location.reload();
  }
  function exit() {
    setImpersonate("");
    window.location.reload();
  }

  // When impersonating, the full-width strip above the app handles the banner;
  // hide the picker so we don't show two impersonate UIs.
  if (me.impersonating) return null;

  // Only admins see the picker.
  const isRealAdmin = me.roles.includes("admin");
  if (!isRealAdmin) return null;

  return (
    <div className="impersonate-picker" onBlur={() => setTimeout(() => setOpen(false), 200)}>
      <input
        placeholder="Impersonate someone…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && results.length > 0 && (
        <div className="search-dropdown">
          {results.map((r) => (
            <div
              key={r.email}
              className="search-row"
              onMouseDown={() => start(r.email)}
            >
              {r.displayName} <span className="muted tiny">{r.email}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
