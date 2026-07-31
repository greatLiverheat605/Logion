import { type ReactNode } from "react";

import { type PersonaDashboardModel } from "./persona-dashboard-model";
import {
  PersonaDashboardHeader,
  PersonaDashboardMetrics,
  PersonaDashboardNavigation,
  PersonaDashboardPrimaryAction,
  PersonaDashboardSteps,
} from "./persona-dashboard-primitives";

const ENTRIES = [
  {
    href: "/app/self-study",
    icon: "book-open",
    label: "自学",
    description: "路线、项目与成果",
  },
  {
    href: "/app/planning",
    icon: "calendar",
    label: "规划",
    description: "目标、阶段与下一步",
  },
  {
    href: "/app/templates",
    icon: "layout-template",
    label: "模板",
    description: "复用已验证工作流",
  },
] as const;

export function SelfDashboard({
  controls,
  model,
  personaName,
  stale,
}: {
  controls: ReactNode;
  model: PersonaDashboardModel;
  personaName: string;
  stale: boolean;
}) {
  return (
    <section
      aria-label="学画像首页"
      className="persona-dashboard persona-dashboard-self"
    >
      <PersonaDashboardHeader
        controls={controls}
        model={model}
        personaName={personaName}
        stale={stale}
      />
      <div className="persona-dashboard-split">
        <PersonaDashboardPrimaryAction action={model.primaryAction} />
        <PersonaDashboardSteps empty={model.empty} steps={model.steps} />
      </div>
      <PersonaDashboardNavigation entries={ENTRIES} label="学画像首要入口" />
      <PersonaDashboardMetrics metrics={model.metrics} />
    </section>
  );
}
