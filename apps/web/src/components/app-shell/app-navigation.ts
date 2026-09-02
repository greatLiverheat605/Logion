import { type AppIconName } from "@/components/app-shell/app-icon";
import {
  type BuiltinPersonaId,
  type PersonaDefinition,
} from "@/features/personas/persona-definitions";
import { INTEGRATION_ENTRY_PERSONAS } from "@/features/integrations/integration-navigation";

export interface NavItem {
  href: string;
  icon: AppIconName;
  label: string;
}

export const NAV_GROUPS: readonly Readonly<{
  label: string;
  items: readonly NavItem[];
}>[] = [
  {
    label: "每日",
    items: [{ href: "/app/today", icon: "home", label: "每日工作台" }],
  },
  {
    label: "知识",
    items: [
      { href: "/app/self-study", icon: "book-open", label: "自学" },
      { href: "/app/records", icon: "files", label: "记录" },
      { href: "/app/review", icon: "refresh", label: "复习" },
      { href: "/app/exam", icon: "target", label: "考试" },
    ],
  },
  {
    label: "治理",
    items: [
      { href: "/app/planning", icon: "calendar", label: "规划" },
      { href: "/app/templates", icon: "layout-template", label: "模板" },
      { href: "/app/audit", icon: "clipboard", label: "审计" },
      { href: "/app/spaces", icon: "folder", label: "空间" },
    ],
  },
  {
    label: "系统",
    items: [
      { href: "/app/settings", icon: "shield", label: "设置" },
      { href: "/app/profile", icon: "users", label: "个人" },
      { href: "/app/help", icon: "book-open", label: "帮助" },
    ],
  },
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);
export const DEFAULT_NAV_ITEM: NavItem = {
  href: "/app/today",
  icon: "home",
  label: "今日",
};

export const COMMAND_GROUPS = ["学习", "研究", "系统", "创建"] as const;
export type CommandGroup = (typeof COMMAND_GROUPS)[number];
export type OperationalCommand = "capture" | "focus";

interface CommandItemBase {
  description: string;
  group: CommandGroup;
  icon: AppIconName;
  id: string;
  keywords: readonly string[];
  label: string;
}

export interface CommandRouteItem extends CommandItemBase {
  allowedBuiltinPersonas?: readonly BuiltinPersonaId[];
  builtinPersonasOnly?: boolean;
  gateRoute: string;
  href: string;
  kind: "route";
}

export interface CommandActionItem extends CommandItemBase {
  action: OperationalCommand;
  kind: "action";
}

export type AppCommandItem = CommandRouteItem | CommandActionItem;

export const COMMAND_ITEMS: readonly AppCommandItem[] = [
  {
    description: "查看真实任务、证据与专注会话",
    gateRoute: "/app/today",
    group: "学习",
    href: "/app/today",
    icon: "home",
    id: "today",
    keywords: ["今日", "任务", "首页"],
    kind: "route",
    label: "打开每日工作台",
  },
  {
    description: "把目标拆成阶段和下一步",
    gateRoute: "/app/planning",
    group: "学习",
    href: "/app/planning",
    icon: "calendar",
    id: "planning",
    keywords: ["目标", "路线", "计划"],
    kind: "route",
    label: "打开路线与计划",
  },
  {
    description: "处理到期回忆、掌握确认与错因",
    gateRoute: "/app/review",
    group: "学习",
    href: "/app/review",
    icon: "refresh",
    id: "review",
    keywords: ["记忆", "复习", "知识图谱"],
    kind: "route",
    label: "开始记忆与复习",
  },
  {
    description: "管理考试、大纲、模考和成绩",
    gateRoute: "/app/exam",
    group: "学习",
    href: "/app/exam",
    icon: "target",
    id: "exam",
    keywords: ["备考", "模考", "大纲"],
    kind: "route",
    label: "进入备考驾驶舱",
  },
  {
    description: "整理 Markdown 笔记和资料索引",
    gateRoute: "/app/records",
    group: "学习",
    href: "/app/records",
    icon: "files",
    id: "records",
    keywords: ["资料", "笔记", "阅读"],
    kind: "route",
    label: "打开资料与笔记",
  },
  {
    description: "推进路线、项目、收件箱和成果",
    gateRoute: "/app/self-study",
    group: "学习",
    href: "/app/self-study",
    icon: "book-open",
    id: "self-study",
    keywords: ["自学", "项目", "成果"],
    kind: "route",
    label: "打开自主学习工作台",
  },
  {
    allowedBuiltinPersonas: ["research", "mentor"],
    description: "处理论文、声明、实验和指标",
    gateRoute: "/app/self-study",
    group: "研究",
    href: "/app/research",
    icon: "flask",
    id: "research",
    keywords: ["论文", "声明", "实验", "研究"],
    kind: "route",
    label: "打开研究工作台",
  },
  {
    allowedBuiltinPersonas: ["research", "mentor"],
    description: "基于共享对象发起审阅和反馈",
    gateRoute: "/app/self-study",
    group: "研究",
    href: "/app/collaboration",
    icon: "users",
    id: "collaboration",
    keywords: ["协作", "审阅", "反馈"],
    kind: "route",
    label: "打开审查与协作",
  },
  {
    description: "查看授权范围内的事件和决定",
    gateRoute: "/app/audit",
    group: "研究",
    href: "/app/audit",
    icon: "clipboard",
    id: "audit",
    keywords: ["审计", "证据", "事件"],
    kind: "route",
    label: "打开证据与审计",
  },
  {
    allowedBuiltinPersonas: INTEGRATION_ENTRY_PERSONAS,
    description: "管理可审查草稿、模型和任务路由",
    gateRoute: "/app/settings",
    group: "系统",
    href: "/app/ai",
    icon: "ai",
    id: "ai",
    keywords: ["AI", "模型", "Provider", "路由"],
    kind: "route",
    label: "打开 AI 路由中心",
  },
  {
    description: "检查本地队列、设备和显式冲突",
    gateRoute: "/app/settings",
    group: "系统",
    href: "/app/sync",
    icon: "refresh",
    id: "sync",
    keywords: ["同步", "离线", "冲突", "设备"],
    kind: "route",
    label: "打开同步与设备",
  },
  {
    description: "管理 Passkey、TOTP 和登录设备",
    gateRoute: "/app/settings",
    group: "系统",
    href: "/app/security",
    icon: "shield",
    id: "security",
    keywords: ["安全", "Passkey", "TOTP", "登录"],
    kind: "route",
    label: "打开安全中心",
  },
  {
    description: "导出、导入、迁移和删除均显式确认",
    gateRoute: "/app/settings",
    group: "系统",
    href: "/app/data",
    icon: "download",
    id: "data",
    keywords: ["数据", "导出", "导入", "删除"],
    kind: "route",
    label: "打开数据主权中心",
  },
  {
    allowedBuiltinPersonas: ["self", "research", "mentor"],
    builtinPersonasOnly: true,
    description: "汇总只读日历与开放格式迁移能力",
    gateRoute: "/app/settings",
    group: "系统",
    href: "/app/integrations",
    icon: "refresh",
    id: "integrations",
    keywords: ["互操作", "集成", "日历", "导入", "导出"],
    kind: "route",
    label: "打开互操作中心",
  },
  {
    description: "搜索内容并处理真实通知与日历",
    gateRoute: "/app/settings",
    group: "系统",
    href: "/app/search",
    icon: "search",
    id: "search",
    keywords: ["搜索", "通知", "日历"],
    kind: "route",
    label: "打开搜索与通知",
  },
  {
    description: "管理 Workspace、Space、成员和邀请",
    gateRoute: "/app/settings",
    group: "系统",
    href: "/app/workspaces",
    icon: "folder",
    id: "workspaces",
    keywords: ["工作区", "空间", "成员", "邀请"],
    kind: "route",
    label: "打开工作区管理",
  },
  {
    description: "加密保存到学习收件箱或笔记库",
    action: "capture",
    group: "创建",
    icon: "plus",
    id: "capture",
    keywords: ["捕获", "新建", "笔记", "收件箱"],
    kind: "action",
    label: "快速捕获",
  },
  {
    description: "从真实任务开始或继续专注会话",
    action: "focus",
    group: "创建",
    icon: "timer",
    id: "focus",
    keywords: ["专注", "计时", "会话"],
    kind: "action",
    label: "开始专注会话",
  },
];

export function isCommandItemVisible(
  item: AppCommandItem,
  persona: PersonaDefinition | null,
  isRouteVisible: (route: string) => boolean,
): boolean {
  if (item.kind === "action") return true;
  if (!isRouteVisible(item.gateRoute)) return false;
  if (item.builtinPersonasOnly && !persona?.isBuiltin) return false;
  if (
    persona?.isBuiltin &&
    item.allowedBuiltinPersonas &&
    !item.allowedBuiltinPersonas.includes(persona.id as BuiltinPersonaId)
  ) {
    return false;
  }
  return true;
}

export function commandItemMatches(item: AppCommandItem, query: string) {
  const needle = query.trim().toLocaleLowerCase("zh-CN");
  if (!needle) return true;
  return [item.label, item.description, ...item.keywords]
    .join(" ")
    .toLocaleLowerCase("zh-CN")
    .includes(needle);
}
