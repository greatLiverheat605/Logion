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
    href: "/app/spaces",
    icon: "folder",
    label: "空间",
    description: "维护私人和共享边界",
  },
  {
    href: "/app/audit",
    icon: "clipboard",
    label: "审计",
    description: "查看授权事件与发现",
  },
  {
    href: "/app/planning",
    icon: "calendar",
    label: "规划",
    description: "组织小组下一步",
  },
] as const;
const SECONDARY_ENTRIES = [
  {
    href: "/app/collaboration",
    icon: "users",
    label: "协作",
    description: "Rubric、审阅与反馈",
  },
  {
    href: "/app/workspaces",
    icon: "folder",
    label: "工作区",
    description: "成员、邀请与角色",
  },
  {
    href: "/app/security",
    icon: "shield",
    label: "安全",
    description: "登录设备与安全设置",
  },
] as const;

export function MentorDashboard({
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
      aria-label="导画像首页"
      className="persona-dashboard persona-dashboard-mentor"
    >
      <PersonaDashboardHeader
        controls={controls}
        model={model}
        personaName={personaName}
        stale={stale}
      />
      <PersonaDashboardMetrics metrics={model.metrics} />
      <PersonaDashboardNavigation
        entries={PRIMARY_ENTRIES}
        label="导画像首要入口"
      />
      <div className="persona-dashboard-split">
        <PersonaDashboardSteps empty={model.empty} steps={model.steps} />
        <PersonaDashboardPrimaryAction action={model.primaryAction} />
      </div>
      <PersonaDashboardNavigation
        entries={SECONDARY_ENTRIES}
        label="导画像二级入口"
      />
    </section>
  );
}
