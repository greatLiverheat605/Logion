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
    href: "/app/exam",
    icon: "target",
    label: "考试",
    description: "科目、大纲、模考与成绩",
  },
  {
    href: "/app/review",
    icon: "refresh",
    label: "复习",
    description: "处理到期回忆与错因",
  },
  {
    href: "/app/records",
    icon: "files",
    label: "记录",
    description: "保存学习材料与过程证据",
  },
] as const;

export function ExamDashboard({
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
      aria-label="考画像首页"
      className="persona-dashboard persona-dashboard-exam"
    >
      <PersonaDashboardHeader
        controls={controls}
        model={model}
        personaName={personaName}
        stale={stale}
      />
      <PersonaDashboardPrimaryAction action={model.primaryAction} />
      <PersonaDashboardMetrics metrics={model.metrics} />
      <PersonaDashboardSteps empty={model.empty} steps={model.steps} />
      <PersonaDashboardNavigation entries={ENTRIES} label="考画像首要入口" />
    </section>
  );
}
