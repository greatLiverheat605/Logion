"use client";

import { useEffect, useState } from "react";

import {
  WorkbenchTabPanel,
  WorkbenchTabs,
} from "@/components/product/headless-ui";

import { ProviderCenter } from "./provider-center";
import { AIRunCenter } from "./run-center";

type AIView = "runs" | "settings";

function viewFromHash(hash: string): AIView {
  return hash.includes("ai-provider-center")
    ? "settings"
    : "runs";
}

function hashForView(view: AIView): string {
  return view === "settings" ? "#ai-provider-center" : "#ai-run-center";
}

export function AIWorkbenchPage() {
  const [view, setView] = useState<AIView>("runs");

  useEffect(() => {
    const syncHash = () => setView(viewFromHash(window.location.hash));
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  const selectView = (next: string) => {
    const nextView: AIView = next === "settings" ? "settings" : "runs";
    setView(nextView);
    const nextHash = hashForView(nextView);
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", `${window.location.pathname}${nextHash}`);
    }
  };

  return (
    <main id="main-content" className="app-route-stack">
      <nav className="system-workbench-nav" aria-label="AI 路由中心分区" data-testid="ai-mode">
        <strong>AI 路由中心</strong>
        <WorkbenchTabs
          label="AI 工作区视图"
          onValueChange={selectView}
          tabs={[
            { label: "Draft", value: "runs" },
            { label: "Provider", value: "settings" },
          ]}
          value={view}
        >
          <WorkbenchTabPanel value="runs">
            <span className="sr-only">Draft 工作区已选中</span>
          </WorkbenchTabPanel>
          <WorkbenchTabPanel value="settings">
            <span className="sr-only">Provider 工作区已选中</span>
          </WorkbenchTabPanel>
        </WorkbenchTabs>
      </nav>
      {view === "runs" ? <AIRunCenter /> : <ProviderCenter />}
    </main>
  );
}
