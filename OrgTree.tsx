import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, OrgNode, OrgViewResult } from "../lib/api";

function countDownstream(node: OrgNode): number {
  let total = node.children.length;
  for (const c of node.children) total += countDownstream(c);
  return total;
}

function collectSpine(node: OrgNode, acc: Set<string>): boolean {
  // Returns true if this node is the user or contains them; populates `acc`
  // with every ancestor email of the user. The user themselves is NOT added,
  // so they default expanded (showing their direct reports) but their reports
  // start collapsed.
  if (node.isSelf) return true;
  let containsUser = false;
  for (const c of node.children) {
    if (collectSpine(c, acc)) containsUser = true;
  }
  if (containsUser) acc.add(node.email);
  return containsUser;
}

function Node({
  node,
  depth = 0,
  spine,
}: {
  node: OrgNode;
  depth?: number;
  spine: Set<string>;
}) {
  // Default open if this node is on the spine to the user OR is the user
  // (so we see their direct reports). Everything below the user starts closed.
  const [open, setOpen] = useState(node.isSelf || spine.has(node.email));
  const pct = node.pending + node.completed === 0
    ? 0
    : Math.round((node.completed / (node.pending + node.completed)) * 100);
  return (
    <div className={`org-node ${node.isBehind ? "behind" : ""} ${node.isSelf ? "self" : ""}`}>
      <div className="org-row" style={{ paddingLeft: depth * 16 }}>
        <button
          className="link-btn"
          onClick={() => setOpen(!open)}
          disabled={node.children.length === 0}
        >
          {node.children.length > 0 ? (open ? "▾" : "▸") : "•"}
        </button>
        <Link to={`/profile/${encodeURIComponent(node.email)}`} className="org-name">
          {node.displayName}
        </Link>
        {node.isSelf && <span className="pill ok">you</span>}
        {node.isCEO && <span className="pill">CEO</span>}
        {node.isAdmin && <span className="pill">admin</span>}
        {!node.accountEnabled && <span className="pill danger">disabled</span>}
        <span className="muted tiny">{node.email}</span>
        <span className="spacer" />
        <span className={`pill ${node.pending > 0 ? "warn" : "ok"}`}>
          {node.pending} pending
        </span>
        <span className="tiny muted">
          {pct}% done · {node.children.length} direct
          {countDownstream(node) !== node.children.length &&
            ` · ${countDownstream(node)} downstream`}
        </span>
      </div>
      {open &&
        node.children.map((c) => (
          <Node key={c.email} node={c} depth={depth + 1} spine={spine} />
        ))}
    </div>
  );
}

export function OrgTree() {
  const [data, setData] = useState<OrgViewResult | null>(null);
  useEffect(() => {
    api.orgTree().then(setData);
  }, []);
  if (!data) return <section className="panel">Loading org tree…</section>;
  if (!data.root) return <section className="panel">No org data.</section>;
  const spine = new Set<string>();
  collectSpine(data.root, spine);
  return (
    <section className="panel">
      <div className="panel-head">
        <h1>Org tree</h1>
        <span className="muted tiny">Rolled-up pending counts at each manager. Click a name for their profile.</span>
      </div>
      <Node node={data.root} spine={spine} />
    </section>
  );
}
