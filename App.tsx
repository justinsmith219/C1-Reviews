import { NavLink, Route, Routes } from "react-router-dom";
import { useBoot } from "./lib/useMe";
import { api } from "./lib/api";
import { Setup } from "./pages/Setup";
import { Overview } from "./pages/Overview";
import { CampaignDetail } from "./pages/CampaignDetail";
import { Managers } from "./pages/Managers";
import { MyQueue } from "./pages/MyQueue";
import { Trend } from "./pages/Trend";
import { Notifications } from "./pages/Notifications";
import { Admin } from "./pages/Admin";
import { OrgTree } from "./pages/OrgTree";
import { Profile } from "./pages/Profile";
import { Scorecards } from "./pages/Scorecards";
import { OpenReviews } from "./pages/OpenReviews";
import { HistoryArchive } from "./pages/HistoryArchive";
import { HistoryDetail } from "./pages/HistoryDetail";
import { Replay } from "./pages/Replay";
import { UserGuide } from "./pages/UserGuide";
import { AdminGuide } from "./pages/AdminGuide";
import { GlobalSearch } from "./components/GlobalSearch";
import { ViewAsSwitcher } from "./components/ViewAsSwitcher";
import { ImpersonateBar } from "./components/ImpersonateBar";
import { getViewAs } from "./lib/api";

export function App() {
  const { me, loading, setup } = useBoot();
  if (loading) return <div className="center muted">Loading…</div>;
  if (setup && !setup.configured) return <Setup redirectUri={setup.redirectUri} />;
  if (!me) return <div className="center muted">Redirecting to sign-in…</div>;
  // Effective admin = real admin AND not currently viewing as manager/reviewer
  // AND not impersonating someone else.
  const isAdminReal = me.roles.includes("admin");
  const viewAs = getViewAs();
  const impersonating = !!me.impersonating;
  const isAdmin = isAdminReal && viewAs === "admin" && !impersonating;

  async function onLogout() {
    await api.logout();
    const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
    window.location.href = `${BASE}/auth/login`;
  }

  return (
    <>
      {me.impersonating && (
        <div className="impersonate-strip">
          🎭 <strong>Impersonating {me.displayName}</strong>
          <span className="muted">&lt;{me.email}&gt;</span>
          <span className="spacer" />
          <span className="tiny">
            Signed in as {me.impersonating.originalDisplayName} ({me.impersonating.originalEmail})
          </span>
          <button
            onClick={() => {
              window.localStorage.removeItem("campaign-manager:impersonate");
              window.location.reload();
            }}
          >
            Exit impersonation
          </button>
        </div>
      )}
    <div className={`app ${me.impersonating ? "with-imp-strip" : ""}`}>
      <aside className="sidebar">
        <div className="brand">Zinnia Access Reviews</div>
        <nav>
          <div className="nav-section">Dashboards</div>
          <NavLink to="/" end>Overview</NavLink>
          <NavLink to="/open-reviews">Open reviews</NavLink>
          <NavLink to="/org-tree">Org tree</NavLink>
          <NavLink to="/my-queue">My queue</NavLink>

          <div className="nav-section">Reports</div>
          <NavLink to="/managers">Manager rollup</NavLink>
          <NavLink to="/scorecards">Scorecards</NavLink>
          <NavLink to="/trend">Historical trend</NavLink>
          <NavLink to="/notifications">Notification log</NavLink>

          <div className="nav-section">Help</div>
          <NavLink to="/guide/user">User guide</NavLink>
          {isAdmin && <NavLink to="/guide/admin">Admin guide</NavLink>}

          {isAdmin && (
            <>
              <div className="nav-section">Admin</div>
              <NavLink to="/admin">Settings & Config</NavLink>
              <NavLink to="/replay">Replay (test)</NavLink>
            </>
          )}
        </nav>
        <div className="sidebar-user">
          <div className="tiny muted">Signed in as</div>
          <div>{me.displayName}</div>
          <div className="tiny muted">{me.email}</div>
          <div className="tiny muted">
            {me.roles.join(", ")}
            {me.supportsExecs.length > 0 && <> · EA for {me.supportsExecs.length} exec(s)</>}
          </div>
          <button className="secondary" onClick={onLogout} style={{ marginTop: 8, width: "100%" }}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <GlobalSearch />
          <ImpersonateBar me={me} />
          {!impersonating && <ViewAsSwitcher me={me} />}
        </header>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/campaigns/:id" element={<CampaignDetail />} />
          <Route path="/my-queue" element={<MyQueue />} />
          <Route path="/open-reviews" element={<OpenReviews />} />
          {/* Legacy redirects so existing links/bookmarks keep working */}
          <Route path="/behind" element={<OpenReviews />} />
          <Route path="/hot-list" element={<OpenReviews />} />
          <Route path="/leaderboard" element={<OpenReviews />} />
          <Route path="/impacted" element={<OpenReviews />} />
          <Route path="/org-tree" element={<OrgTree />} />
          <Route path="/managers" element={<Managers />} />
          <Route path="/scorecards" element={<Scorecards />} />
          <Route path="/history" element={<HistoryArchive />} />
          <Route path="/history/:id" element={<HistoryDetail />} />
          {/* Legacy: archive page is still reachable but main nav points to overview tabs */}
          <Route path="/trend" element={<Trend />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/profile/:email" element={<Profile />} />
          <Route path="/guide/user" element={<UserGuide />} />
          {isAdmin && <Route path="/guide/admin" element={<AdminGuide />} />}
          {isAdmin && <Route path="/admin/*" element={<Admin />} />}
          {isAdmin && <Route path="/replay" element={<Replay />} />}
        </Routes>
      </main>
    </div>
    </>
  );
}
