import { getViewAs, setViewAs, ViewAs } from "../lib/api";
import { SessionUser } from "../lib/api";

// Lets an admin see the app from a non-admin perspective without signing out.
// Stored in localStorage and sent on every API call as X-View-As. The server
// only honors view downgrades — non-admins cannot elevate via this header.
export function ViewAsSwitcher({ me }: { me: SessionUser }) {
  if (!me.roles.includes("admin")) return null;
  const isManager = me.roles.includes("manager");
  const current = getViewAs();
  const opts: { value: ViewAs; label: string }[] = [
    { value: "admin", label: "Admin (full)" },
  ];
  if (isManager) opts.push({ value: "manager", label: "My team (manager)" });
  opts.push({ value: "reviewer", label: "My queue only (reviewer)" });

  return (
    <label className="row-gap viewas">
      <span className="tiny muted">Viewing as</span>
      <select
        value={current}
        onChange={(e) => {
          setViewAs(e.target.value as ViewAs);
          window.location.reload();
        }}
      >
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
