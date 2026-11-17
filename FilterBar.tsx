import { useState } from "react";

export interface Filters {
  text: string;
  campaignId?: string;
  managerEmail?: string;
  status?: "pending" | "completed" | "all";
  tierId?: string;
  minDaysOverdue?: number;
  entitlement?: string;
}

export function FilterBar({
  value,
  onChange,
  campaigns = [],
  tiers = [],
}: {
  value: Filters;
  onChange: (f: Filters) => void;
  campaigns?: Array<{ id: string; name: string }>;
  tiers?: Array<{ id: string; name: string }>;
}) {
  const [local, setLocal] = useState<Filters>(value);
  function update<K extends keyof Filters>(k: K, v: Filters[K]) {
    const next = { ...local, [k]: v };
    setLocal(next);
    onChange(next);
  }
  return (
    <div className="filterbar">
      <input
        placeholder="Filter…"
        value={local.text}
        onChange={(e) => update("text", e.target.value)}
      />
      {campaigns.length > 0 && (
        <select
          value={local.campaignId ?? ""}
          onChange={(e) => update("campaignId", e.target.value || undefined)}
        >
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <select
        value={local.status ?? "all"}
        onChange={(e) => update("status", e.target.value as any)}
      >
        <option value="all">All statuses</option>
        <option value="pending">Pending</option>
        <option value="completed">Completed</option>
      </select>
      {tiers.length > 0 && (
        <select
          value={local.tierId ?? ""}
          onChange={(e) => update("tierId", e.target.value || undefined)}
        >
          <option value="">All tiers</option>
          {tiers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      <input
        type="number"
        placeholder="Min days overdue"
        value={local.minDaysOverdue ?? ""}
        onChange={(e) =>
          update("minDaysOverdue", e.target.value ? parseInt(e.target.value, 10) : undefined)
        }
        style={{ width: 140 }}
      />
      <input
        placeholder="Entitlement contains…"
        value={local.entitlement ?? ""}
        onChange={(e) => update("entitlement", e.target.value || undefined)}
      />
      <button
        className="secondary"
        onClick={() => {
          const cleared: Filters = { text: "", status: "all" };
          setLocal(cleared);
          onChange(cleared);
        }}
      >
        Clear
      </button>
    </div>
  );
}
