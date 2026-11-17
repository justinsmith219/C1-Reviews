import { useState } from "react";
import { CampaignDetailsStats } from "../lib/api";

type Day = CampaignDetailsStats["trendByDay"][number];
type DrilldownKey = "completedNames" | "inProgressNames" | "notStartedNames";

interface DrilldownState {
  date: string;
  key: DrilldownKey;
  names: Array<{ email: string; displayName: string }>;
}

const COLORS = {
  completed:  "#2E7D32", // green
  inProgress: "#F9A825", // amber
  notStarted: "#C62828", // red
};

const LABELS: Record<DrilldownKey, string> = {
  completedNames:  "Completed",
  inProgressNames: "In progress",
  notStartedNames: "Not started",
};

export function TrendChart({ data }: { data: CampaignDetailsStats["trendByDay"] }) {
  const [drilldown, setDrilldown] = useState<DrilldownState | null>(null);

  if (data.length < 2) {
    return <p className="muted tiny">Not enough completion history to draw a trend yet.</p>;
  }

  // Total reviewers = first day's sum (all not-started + any already started)
  const totalReviewers = Math.max(
    1,
    data[0].reviewersCompleted + data[0].reviewersInProgress + data[0].reviewersNotStarted
  );

  const w = 800;
  const h = 240;
  const padL = 44;
  const padR = 24;
  const padT = 20;
  const padB = 36;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const x = (i: number) => padL + (i / Math.max(1, data.length - 1)) * innerW;
  const y = (v: number) => padT + innerH - (v / totalReviewers) * innerH;

  function polyline(vals: number[]) {
    return vals.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  }

  const yTicks = 4;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) =>
    Math.round((totalReviewers / yTicks) * (yTicks - i))
  );
  const xLabelEvery = Math.max(1, Math.floor(data.length / 6));

  function handleDot(d: Day, key: DrilldownKey) {
    const names = d[key];
    if (names.length === 0) return;
    // Toggle off if same dot clicked again
    if (drilldown?.date === d.date && drilldown?.key === key) {
      setDrilldown(null);
    } else {
      setDrilldown({ date: d.date, key, names });
    }
  }

  return (
    <div>
      {/* Legend */}
      <div style={{ display: "flex", gap: 20, marginBottom: 8, fontSize: 12 }}>
        {(
          [
            ["completedNames",  "Completed",  COLORS.completed],
            ["inProgressNames", "In progress", COLORS.inProgress],
            ["notStartedNames", "Not started", COLORS.notStarted],
          ] as [DrilldownKey, string, string][]
        ).map(([key, label, color]) => (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span
              style={{
                display: "inline-block",
                width: 24,
                height: 3,
                background: color,
                borderRadius: 2,
              }}
            />
            <span style={{ color: "#5F5E5A" }}>{label}</span>
          </div>
        ))}
        <span style={{ color: "#9E9E9E", marginLeft: "auto", fontSize: 11 }}>
          Click any dot to see names
        </span>
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="trend-chart"
        role="img"
        aria-label="Reviewer completion trend"
        style={{ overflow: "visible" }}
      >
        {/* Gridlines + Y labels */}
        {tickVals.map((v, i) => {
          const yy = padT + (innerH * i) / yTicks;
          return (
            <g key={i}>
              <line x1={padL} y1={yy} x2={padL + innerW} y2={yy} stroke="#eef2f7" strokeWidth={1} />
              <text x={padL - 6} y={yy + 4} fontSize="10" textAnchor="end" fill="#9E9E9E">
                {v}
              </text>
            </g>
          );
        })}

        {/* Trend lines */}
        <polyline
          points={polyline(data.map((d) => d.reviewersCompleted))}
          fill="none"
          stroke={COLORS.completed}
          strokeWidth={2}
        />
        <polyline
          points={polyline(data.map((d) => d.reviewersInProgress))}
          fill="none"
          stroke={COLORS.inProgress}
          strokeWidth={2}
          strokeDasharray="5 3"
        />
        <polyline
          points={polyline(data.map((d) => d.reviewersNotStarted))}
          fill="none"
          stroke={COLORS.notStarted}
          strokeWidth={2}
          strokeDasharray="3 3"
        />

        {/* Clickable dots */}
        {data.map((d, i) => (
          <g key={d.date}>
            {(
              [
                ["completedNames",  d.reviewersCompleted,  COLORS.completed],
                ["inProgressNames", d.reviewersInProgress, COLORS.inProgress],
                ["notStartedNames", d.reviewersNotStarted, COLORS.notStarted],
              ] as [DrilldownKey, number, string][]
            ).map(([key, val, color]) => {
              if (val === 0) return null;
              const cx = x(i);
              const cy = y(val);
              const isActive = drilldown?.date === d.date && drilldown?.key === key;
              return (
                <circle
                  key={key}
                  cx={cx}
                  cy={cy}
                  r={isActive ? 6 : 4}
                  fill={isActive ? color : "#fff"}
                  stroke={color}
                  strokeWidth={2}
                  style={{ cursor: "pointer" }}
                  onClick={() => handleDot(d, key)}
                >
                  <title>
                    {d.date} — {LABELS[key]}: {val} reviewer{val !== 1 ? "s" : ""}
                  </title>
                </circle>
              );
            })}
          </g>
        ))}

        {/* X-axis labels */}
        {data.map((d, i) =>
          i % xLabelEvery === 0 || i === data.length - 1 ? (
            <text
              key={d.date}
              x={x(i)}
              y={h - 8}
              fontSize="10"
              textAnchor="middle"
              fill="#9E9E9E"
            >
              {d.date.slice(5)}
            </text>
          ) : null
        )}
      </svg>

      {/* Drilldown panel */}
      {drilldown && (
        <div
          style={{
            marginTop: 12,
            padding: "12px 16px",
            background: "#f7f9fc",
            border: "1px solid #DDDDDD",
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <strong style={{ color: COLORS[drilldown.key.replace("Names", "") as keyof typeof COLORS] }}>
              {LABELS[drilldown.key]} on {drilldown.date}
            </strong>
            <button
              className="secondary"
              style={{ padding: "2px 8px", fontSize: 12 }}
              onClick={() => setDrilldown(null)}
            >
              ✕
            </button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: "4px 16px",
            }}
          >
            {drilldown.names.map((n) => (
              <div key={n.email} style={{ color: "#2C2C2A" }}>
                {n.displayName}
                <span className="muted tiny" style={{ marginLeft: 6 }}>
                  {n.email}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
