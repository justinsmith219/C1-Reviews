import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, SearchResult } from "../lib/api";

export function GlobalSearch() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchResult | null>(null);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const timer = useRef<number | undefined>();

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    if (!q.trim()) {
      setRes(null);
      return;
    }
    timer.current = window.setTimeout(() => {
      api.search(q).then(setRes);
    }, 200);
  }, [q]);

  function go(path: string) {
    setOpen(false);
    setQ("");
    nav(path);
  }

  const total =
    (res?.people.length ?? 0) +
    (res?.campaigns.length ?? 0) +
    (res?.historicalCampaigns?.length ?? 0) +
    (res?.entitlements.length ?? 0);

  return (
    <div className="global-search" onBlur={() => setTimeout(() => setOpen(false), 200)}>
      <input
        placeholder="Search people, managers, campaigns (active or archived), entitlements…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && res && (
        <div className="search-dropdown">
          {res.people.length > 0 && (
            <div>
              <div className="tiny muted search-head">People</div>
              {res.people.map((p) => (
                <div
                  key={p.email}
                  className="search-row"
                  onMouseDown={() => go(`/profile/${encodeURIComponent(p.email)}`)}
                >
                  {p.displayName}
                  <span className="muted tiny"> {p.email}</span>
                  {p.roles.length > 0 && (
                    <span style={{ marginLeft: 6 }}>
                      {p.roles.map((r) => (
                        <span key={r} className="pill" style={{ marginRight: 4 }}>
                          {r}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {res.campaigns.length > 0 && (
            <div>
              <div className="tiny muted search-head">Campaigns (active)</div>
              {res.campaigns.map((c) => (
                <div
                  key={c.id}
                  className="search-row"
                  onMouseDown={() => go(`/campaigns/${c.id}`)}
                >
                  {c.name}
                </div>
              ))}
            </div>
          )}
          {res.historicalCampaigns && res.historicalCampaigns.length > 0 && (
            <div>
              <div className="tiny muted search-head">Campaigns (archive)</div>
              {res.historicalCampaigns.map((c) => (
                <div
                  key={c.id}
                  className="search-row"
                  onMouseDown={() => go(`/history/${c.id}`)}
                >
                  {c.name}
                </div>
              ))}
            </div>
          )}
          {res.entitlements.length > 0 && (
            <div>
              <div className="tiny muted search-head">Entitlements</div>
              {res.entitlements.map((e) => (
                <div key={e} className="search-row">
                  {e}
                </div>
              ))}
            </div>
          )}
          {total === 0 && <div className="muted tiny search-row">No matches.</div>}
        </div>
      )}
    </div>
  );
}
