/* ============================================================
   knowledge-space-prototype / knowledge-space-vc.tsx
   Variant C — prototype wrapper for the reusable KnowledgeSpaceGraph.
   Keeps the local mock-only data, scenario switcher, and projection tabs.
   ============================================================ */

"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { AppIcon } from "@/components/app-shell/app-icon";
import {
  KnowledgeSpaceGraph,
  type KnowledgeSpaceGraphState,
  SCENARIOS,
  TYPE_LABELS,
} from "./knowledge-space-graph";
import type { KsProjectionItem, ProjectionTab } from "./ks-mock-data";
import {
  getConfirmColor,
  getConfirmLabel,
  getProjection,
  KS_DATA,
} from "./ks-mock-data";

const PROJECTION_TABS: ReadonlyArray<{
  id: ProjectionTab;
  label: string;
  icon: string;
}> = [
  { id: "today", label: "今日", icon: "calendar" },
  { id: "review", label: "审查", icon: "ai" },
  { id: "records", label: "记录", icon: "archive" },
] as const;

function ProjectionPanel({
  activeTab,
  selectedId,
  onTabChange,
  onSelectNode,
}: {
  activeTab: ProjectionTab;
  selectedId: string | null;
  onTabChange: (tab: ProjectionTab) => void;
  onSelectNode: (id: string) => void;
}) {
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const tabCounts = useMemo(() => {
    const counts: Record<ProjectionTab, number> = {
      today: 0,
      review: 0,
      records: 0,
    };
    for (const tab of PROJECTION_TABS) {
      counts[tab.id] = getProjection(tab.id).length;
    }
    return counts;
  }, []);

  const handleTabKeyDown = useCallback(
    (event: React.KeyboardEvent, index: number) => {
      const tabIds = PROJECTION_TABS.map((tab) => tab.id);
      let nextIndex = index;

      if (event.key === "ArrowRight") {
        event.preventDefault();
        nextIndex = (index + 1) % tabIds.length;
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        nextIndex = (index - 1 + tabIds.length) % tabIds.length;
      } else if (event.key === "Home") {
        event.preventDefault();
        nextIndex = 0;
      } else if (event.key === "End") {
        event.preventDefault();
        nextIndex = tabIds.length - 1;
      } else {
        return;
      }

      const nextId = tabIds[nextIndex];
      if (nextId) {
        onTabChange(nextId);
        requestAnimationFrame(() => {
          tabRefs.current[nextId]?.focus();
        });
      }
    },
    [onTabChange],
  );

  return (
    <div className="ks-projection" role="region" aria-label="知识空间投影视图">
      <div
        className="ks-projection-tabs"
        role="tablist"
        aria-label="投影视图切换"
      >
        {PROJECTION_TABS.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => {
              tabRefs.current[tab.id] = element;
            }}
            type="button"
            role="tab"
            id={`ks-proj-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`ks-proj-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={`ks-projection-tab ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            <AppIcon
              name={tab.icon as "calendar"}
              size={13}
              aria-hidden="true"
            />
            {tab.label}
            <span className="ks-projection-tab-count">{tabCounts[tab.id]}</span>
          </button>
        ))}
      </div>

      {PROJECTION_TABS.map((tab) => {
        const tabItems = getProjection(tab.id);
        const isActive = activeTab === tab.id;
        return (
          <div
            key={tab.id}
            role="tabpanel"
            id={`ks-proj-panel-${tab.id}`}
            aria-labelledby={`ks-proj-tab-${tab.id}`}
            className="ks-projection-list"
            hidden={!isActive || undefined}
          >
            {tabItems.length === 0 ? (
              <p className="ks-projection-empty">暂无数据</p>
            ) : (
              tabItems.map((item: KsProjectionItem) => (
                <button
                  key={item.nodeId}
                  type="button"
                  className={`ks-projection-item ${selectedId === item.nodeId ? "active" : ""}`}
                  onClick={() => onSelectNode(item.nodeId)}
                  aria-label={`${item.label}，${TYPE_LABELS[item.type]}，${getConfirmLabel(item.confirmState)}`}
                >
                  <span
                    className="ks-projection-dot"
                    style={{ background: getConfirmColor(item.confirmState) }}
                    aria-hidden="true"
                  />
                  <span className="ks-projection-item-label">{item.label}</span>
                  <span className="ks-projection-item-type">
                    {TYPE_LABELS[item.type]}
                  </span>
                </button>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

export function KnowledgeSpaceVC() {
  const [scenario, setScenario] = useState<KnowledgeSpaceGraphState>("ready");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [projectionTab, setProjectionTab] = useState<ProjectionTab>("today");

  const handleRetry = useCallback(() => {
    setScenario("loading");
    window.setTimeout(() => setScenario("ready"), 700);
  }, []);

  const handleUnlock = useCallback(() => setScenario("ready"), []);

  const handleProjectionSelect = useCallback((nodeId: string) => {
    setSelectedId(nodeId);
  }, []);

  return (
    <div className="ks-prototype-wrap">
      {/* Prototype scenario switcher — local demo only */}
      <div className="ks-scenario-bar" role="group" aria-label="原型状态演示">
        <span className="ks-scenario-label">原型状态演示</span>
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`ks-scenario-chip ${scenario === s.id ? "active" : ""}`}
            aria-pressed={scenario === s.id}
            onClick={() => setScenario(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <KnowledgeSpaceGraph
        data={KS_DATA}
        state={scenario}
        selectedId={selectedId}
        onNodeSelect={setSelectedId}
        onRetry={handleRetry}
        onUnlock={handleUnlock}
        showTrace={true}
        readOnly={false}
      >
        <div className="ks-projection-zone">
          <ProjectionPanel
            activeTab={projectionTab}
            selectedId={selectedId}
            onTabChange={setProjectionTab}
            onSelectNode={handleProjectionSelect}
          />
        </div>
      </KnowledgeSpaceGraph>
    </div>
  );
}
