import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ScorecardNode } from "../lib/api";
import { useMe } from "../lib/useMe";
import { downloadCsv, toCsv } from "../lib/csv";

export function Scorecards() {
  const [root, setRoot] = useState<ScorecardNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [filter, setFilter] = useState("");
  const { me } = useMe();

  async function load() {
    setLoading(true);
    try {
      const r = await api.scorecardTree();
      setRoot(r.root);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function recompute() {
    setRecomputing(true);
    try {
      await api.recomputeScorecards();
      await load();
    } finally {
      setRecomputing(false);
    }
  }

  function exportCsv() {
    if (!root) return;
    const rows: any[] = [];
    function flatten(n: ScorecardNode, depth: number) {
      rows.push({
        depth,
        name: n.displayName,
        email: n.email,
        campaignsParticipated: n.campaignsParticipated,
        totalAssigned: n.totalAssigned,
        totalCompleted: n.totalCompleted,
        totalOnTime: n.totalOnTime,
        completedPct: n.completedPct,
        onTimePct: n.onTimePct,
        teamAssigned: n.teamAssigned,
        teamCompleted: n.teamCompleted,
        teamOnTime: n.teamOnTime,
        teamCompletedPct: n.teamCompletedPct,
        teamOnTimePct: n.teamOnTimePct,
      });
      for (const c of n.children) flatten(c, depth + 1);
    }
    flatten(root, 0);
    downloadCsv(
      "scorecards.csv",
      toCsv(rows, [
        "depth",
        "name",
        "email",
        "campaignsParticipated",
        "totalAssigned",
        "totalCompleted",
        "totalOnTime",
        "completedPct",
        "onTimePct",
        "teamAssigned",
        "teamCompleted",
        "teamOnTime",
        "teamCompletedPct",
        "teamOnTimePct",
      ])
    );
  }

  const spine = new Set<string>();
  if (root) collectSpine(root, spine);

  return (
    <section className="panel">
      <div className="panel-head">
        <h1>Manager scorecards</h1>
        <div className="row-gap">
          <input
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button className="secondary" onClick={exportCsv} disabled={!root}>
            Export CSV
          </button>
          {me?.roles.includes("admin") && (
            <button onClick={recompute} disabled={recomputing}>
              {recomputing ? "Recomputing…" : "Recompute"}
            </button>
          )}
        </div>
      </div>
      <p className="muted tiny">
        Hierarchical view of completion rates from past ConductorOne campaigns.
        Each row shows the manager's own stats and a team rollup that includes
        their entire downstream tree (direct + indirect reports).
      </p>
      {loading ? (
        <p className="muted">Loading…</p>
      ) : !root ? (
        <p className="muted">
          No scorecard data yet. Admins can click <strong>Import history</strong> in
          the Operations panel to backfill from ConductorOne.
        </p>
      ) : (
        <div className="scorecard-tree">
          <div className="scorecard-row scorecard-head">
            <span className="sc-name">Person</span>
            <span className="sc-num">Campaigns</span>
            <span className="sc-num">Assigned</span>
            <span className="sc-num">Done %</span>
            <span className="sc-num">On-time %</span>
            <span className="sc-num">Team assigned</span>
            <span className="sc-num">Team done %</span>
            <span className="sc-num">Team on-time %</span>
          </div>
          <Node node={root} depth={0} spine={spine} filter={filter.toLowerCase().trim()} />
        </div>
      )}
    </section>
  );
}

function collectSpine(node: ScorecardNode, acc: Set<string>): boolean {
  if (node.isSelf) return true;
  let containsSelf = false;
  for (const c of node.children) {
    if (collectSpine(c, acc)) containsSelf = true;
  }
  if (containsSelf) acc.add(node.email);
  return containsSelf;
}

function matchesFilter(node: ScorecardNode, f: string): boolean {
  if (!f) return true;
  if (node.email.toLowerCase().includes(f) || node.displayName.toLowerCase().includes(f))
    return true;
  return node.children.some((c) => matchesFilter(c, f));
}

function pillClass(pct: number): string {
  if (pct >= 90) return "pill ok";
  if (pct >= 60) return "pill warn";
  return "pill danger";
}

function Node({
  node,
  depth,
  spine,
  filter,
}: {
  node: ScorecardNode;
  depth: number;
  spine: Set<string>;
  filter: string;
}) {
  // When a filter is active, expand any branch that contains a match.
  const filterMatches = filter ? matchesFilter(node, filter) : true;
  const [open, setOpen] = useState(node.isSelf || spine.has(node.email) || !!filter);
  if (!filterMatches) return null;

  return (
    <>
      <div
        className={`scorecard-row ${node.isSelf ? "self" : ""}`}
        style={{ paddingLeft: depth * 18 }}
      >
        <span className="sc-name">
          <button
            className="link-btn"
            onClick={() => setOpen(!open)}
            disabled={node.children.length === 0}
          >
            {node.children.length > 0 ? (open ? "▾" : "▸") : "•"}
          </button>
          <Link to={`/profile/${encodeURIComponent(node.email)}`}>{node.displayName}</Link>
          {node.isSelf && <span className="pill ok" style={{ marginLeft: 6 }}>you</span>}
          {node.isCEO && <span className="pill" style={{ marginLeft: 6 }}>CEO</span>}
        </span>
        <span className="sc-num">{node.campaignsParticipated || "—"}</span>
        <span className="sc-num">{node.totalAssigned || "—"}</span>
        <span className="sc-num">
          {node.hasOwnData ? <span className={pillClass(node.completedPct)}>{node.completedPct}%</span> : "—"}
        </span>
        <span className="sc-num">
          {node.hasOwnData ? <span className={pillClass(node.onTimePct)}>{node.onTimePct}%</span> : "—"}
        </span>
        <span className="sc-num">{node.teamAssigned.toLocaleString()}</span>
        <span className="sc-num">
          <span className={pillClass(node.teamCompletedPct)}>{node.teamCompletedPct}%</span>
        </span>
        <span className="sc-num">
          <span className={pillClass(node.teamOnTimePct)}>{node.teamOnTimePct}%</span>
        </span>
      </div>
      {open &&
        node.children.map((c) => (
          <Node key={c.email} node={c} depth={depth + 1} spine={spine} filter={filter} />
        ))}
    </>
  );
}
