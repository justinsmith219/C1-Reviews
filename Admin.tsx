import { useState } from "react";
import { Configuration } from "./Configuration";
import { TiersPanel } from "../components/admin/TiersPanel";
import { TemplatesPanel } from "../components/admin/TemplatesPanel";
import { SuppressionsPanel } from "../components/admin/SuppressionsPanel";
import { EaMappingsPanel } from "../components/admin/EaMappingsPanel";
import { AuditPanel } from "../components/admin/AuditPanel";
import { OpsPanel } from "../components/admin/OpsPanel";
import { JobsPanel } from "../components/admin/JobsPanel";

const TABS = [
  { id: "config", label: "Configuration" },
  { id: "tiers", label: "Escalation tiers" },
  { id: "templates", label: "Templates" },
  { id: "suppressions", label: "Suppressions" },
  { id: "ea", label: "EA delegation" },
  { id: "ops", label: "Operations" },
  { id: "jobs", label: "Jobs" },
  { id: "audit", label: "Audit log" },
] as const;

type TabId = typeof TABS[number]["id"];

export function Admin() {
  const [tab, setTab] = useState<TabId>("config");
  return (
    <div>
      <div className="tab-bar">
        {TABS.map((t) => (
          <button key={t.id} className={t.id === tab ? "active" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "config" && <Configuration />}
      {tab === "tiers" && <TiersPanel />}
      {tab === "templates" && <TemplatesPanel />}
      {tab === "suppressions" && <SuppressionsPanel />}
      {tab === "ea" && <EaMappingsPanel />}
      {tab === "ops" && <OpsPanel />}
      {tab === "jobs" && <JobsPanel />}
      {tab === "audit" && <AuditPanel />}
    </div>
  );
}
