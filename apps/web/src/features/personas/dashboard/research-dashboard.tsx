import { type ReactNode } from "react";

import { type PersonaDashboardModel } from "./persona-dashboard-model";
import {
  PersonaDashboardHeader,
  PersonaDashboardMetrics,
  PersonaDashboardNavigation,
  PersonaDashboardPrimaryAction,
  PersonaDashboardSteps,
} from "./persona-dashboard-primitives";

const PRIMARY_ENTRIES = [
  {
    href: "/app/self-study",
    icon: "book-open",
    label: "自学 / 研究",
    description: "研究资料与项目上下文",
  },
  {
    href: "/app/records",
    icon: "files",
    label: "记录",
    description: "论文、笔记与证据材料",
  },
  {
    href: "/app/review",
    icon: "refresh",
    label: "复习",
    description: "巩固知识与处理错因",
  },
] as const;
const SECONDARY_ENTRIES = [
  {
    href: "/app/research",
    icon: "flask",
    label: "研究",
    description: "问题、论文、声明与运行",
  },
  {
    href: "/app/ai",
    icon: "ai",
    label: "AI",
    description: "审查草稿与模型路由",
  },
  {
    href: "/app/collaboration",
    icon: "users",
    label: "协作",
    description: "共享审阅与反馈",
  },
] as const;

export function ResearchDashboard({
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
      aria-label="研画像首页"
      className="persona-dashboard persona-dashboard-research"
    >
      <PersonaDashboardHeader
        controls={controls}
        model={model}
        personaName={personaName}
        stale={stale}
      />
      <PersonaDashboardMetrics metrics={model.metrics} />
      <div className="persona-dashboard-split">
        <PersonaDashboardPrimaryAction action={model.primaryAction} />
        <PersonaDashboardSteps empty={model.empty} steps={model.steps} />
      </div>
      <PersonaDashboardNavigation
        entries={PRIMARY_ENTRIES}
        label="研画像首要入口"
      />
      <PersonaDashboardNavigation
        entries={SECONDARY_ENTRIES}
        label="研画像二级入口"
      />
    </section>
  );
}
