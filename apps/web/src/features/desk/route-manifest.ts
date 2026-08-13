import type { AppIconName } from "@/components/app-shell/app-icon";
import {
  type BuiltinPersonaId,
  type PersonaDefinition,
} from "@/features/personas/persona-definitions";
import { INTEGRATION_ENTRY_PERSONAS } from "@/features/integrations/integration-navigation";

/**
 * The five top-level navigation areas of the D2 Adaptive Desk shell.
 *
 * The order is frozen: 今天 → 工作台 → 知识库 → 协作空间 → 系统中心.
 * The sidebar splits them into "主要区域" (first three) and "管理" (last two),
 * but the total entry count is always exactly five.
 */
export type DeskAreaId =
  | "today"
  | "workbench"
  | "knowledge"
  | "collaboration"
  | "system";

export interface DeskArea {
  id: DeskAreaId;
  label: string;
  icon: AppIconName;
  /** Sidebar group label ("主要区域" or "管理"). */
  group: "主要区域" | "管理";
  /** Numeric mark shown in the sidebar (matches D2 prototype). */
  mark: string;
}

/**
 * The frozen, ordered list of five top-level areas. This is the single source
 * of truth for sidebar, mobile nav and command-palette grouping.
 */
export const DESK_AREAS: readonly DeskArea[] = [
  { id: "today", label: "今天", icon: "home", group: "主要区域", mark: "01" },
  {
    id: "workbench",
    label: "工作台",
    icon: "book-open",
    group: "主要区域",
    mark: "02",
  },
  {
    id: "knowledge",
    label: "知识库",
    icon: "files",
    group: "主要区域",
    mark: "03",
  },
  {
    id: "collaboration",
    label: "协作空间",
    icon: "users",
    group: "管理",
    mark: "04",
  },
  {
    id: "system",
    label: "系统中心",
    icon: "shield",
    group: "管理",
    mark: "05",
  },
];

/**
 * A single navigable route in the desk manifest. This is the unified record
 * consumed by the sidebar, command palette and mobile navigation — there is no
 * duplicate route mapping anywhere else.
 */
export interface DeskRouteEntry {
  /** The deep-linkable URL path, e.g. "/app/today". */
  path: string;
  /** The top-level area this route belongs to. */
  area: DeskAreaId;
  /** Human-readable sub-view name shown in the context bar, e.g. "学习". */
  subView: string;
  /** Icon shared across sidebar, command palette and mobile nav. */
  icon: AppIconName;
  /** Command palette display label. */
  commandLabel: string;
  /** Command palette description. */
  commandDescription: string;
  /** Search keywords for the command palette. */
  keywords: readonly string[];
  /**
   * Gate route for command-palette visibility. The command item is only shown
   * when `isRouteVisible(gateRoute)` is true. Preserves the existing persona
   * gate semantics without widening permissions.
   */
  gateRoute: string;
  /** If set, the command item is only visible to these built-in personas. */
  allowedBuiltinPersonas?: readonly BuiltinPersonaId[];
  /** If true, custom personas cannot see this command item. */
  builtinPersonasOnly?: boolean;
}

/**
 * The 21 formal business routes (10_ROUTE_MIGRATION_MAP.md).
 *
 * `/app` (redirect) and `/app/knowledge-prototype` (historical demo entry) are
 * NOT counted among the 21 — see {@link FORMAL_ROUTE_COUNT}.
 */
export const DESK_ROUTES: readonly DeskRouteEntry[] = [
  // 今天 (1)
  {
    area: "today",
    commandDescription: "查看真实任务、证据与专注会话",
    commandLabel: "打开今天",
    gateRoute: "/app/today",
    icon: "home",
    keywords: ["今日", "任务", "首页", "行动"],
    path: "/app/today",
    subView: "当前行动与验收",
  },
  // 工作台 (5)
  {
    area: "workbench",
    commandDescription: "推进路线、项目、收件箱和成果",
    commandLabel: "打开学习",
    gateRoute: "/app/self-study",
    icon: "book-open",
    keywords: ["自学", "项目", "成果", "学习"],
    path: "/app/self-study",
    subView: "学习",
  },
  {
    allowedBuiltinPersonas: ["research", "mentor"],
    area: "workbench",
    commandDescription: "处理论文、声明、实验和指标",
    commandLabel: "打开研究",
    gateRoute: "/app/self-study",
    icon: "flask",
    keywords: ["论文", "声明", "实验", "研究"],
    path: "/app/research",
    subView: "研究",
  },
  {
    area: "workbench",
    commandDescription: "管理考试、大纲、模考和成绩",
    commandLabel: "打开考试",
    gateRoute: "/app/exam",
    icon: "target",
    keywords: ["备考", "模考", "大纲", "考试"],
    path: "/app/exam",
    subView: "考试",
  },
  {
    area: "workbench",
    commandDescription: "把目标拆成阶段和下一步",
    commandLabel: "打开计划与阶段",
    gateRoute: "/app/planning",
    icon: "calendar",
    keywords: ["目标", "路线", "计划", "阶段"],
    path: "/app/planning",
    subView: "计划与阶段",
  },
  {
    area: "workbench",
    commandDescription: "选择受控的工作流程模板",
    commandLabel: "打开模板",
    gateRoute: "/app/templates",
    icon: "layout-template",
    keywords: ["模板", "流程", "自定义"],
    path: "/app/templates",
    subView: "模板",
  },
  // 知识库 (3)
  {
    area: "knowledge",
    commandDescription: "管理来源、笔记和资料索引",
    commandLabel: "打开来源与记录",
    gateRoute: "/app/records",
    icon: "files",
    keywords: ["资料", "笔记", "阅读", "来源", "记录"],
    path: "/app/records",
    subView: "来源与记录",
  },
  {
    area: "knowledge",
    commandDescription: "处理到期回忆、掌握确认与错因",
    commandLabel: "打开复习",
    gateRoute: "/app/review",
    icon: "refresh",
    keywords: ["记忆", "复习", "知识图谱"],
    path: "/app/review",
    subView: "复习",
  },
  {
    area: "knowledge",
    commandDescription: "选择或创建知识库（Space）",
    commandLabel: "打开知识库管理",
    gateRoute: "/app/spaces",
    icon: "folder",
    keywords: ["空间", "知识库", "Space", "管理"],
    path: "/app/spaces",
    subView: "知识库管理",
  },
  // 协作空间 (2)
  {
    allowedBuiltinPersonas: ["research", "mentor"],
    area: "collaboration",
    commandDescription: "基于共享对象发起审阅和反馈",
    commandLabel: "打开审阅与反馈",
    gateRoute: "/app/self-study",
    icon: "users",
    keywords: ["协作", "审阅", "反馈", "成员", "邀请"],
    path: "/app/collaboration",
    subView: "审阅与反馈",
  },
  {
    area: "collaboration",
    commandDescription: "管理 Workspace、Space、成员和邀请",
    commandLabel: "打开 Workspace 管理",
    gateRoute: "/app/settings",
    icon: "folder",
    keywords: ["工作区", "空间", "成员", "邀请", "Workspace"],
    path: "/app/workspaces",
    subView: "Workspace 管理",
  },
  // 系统中心 (8)
  {
    area: "system",
    commandDescription: "查看授权范围内的事件和决定",
    commandLabel: "打开审计",
    gateRoute: "/app/audit",
    icon: "clipboard",
    keywords: ["审计", "证据", "事件"],
    path: "/app/audit",
    subView: "审计",
  },
  {
    area: "system",
    commandDescription: "通用偏好、外观与画像设置",
    commandLabel: "打开通用设置",
    gateRoute: "/app/settings",
    icon: "shield",
    keywords: ["设置", "偏好", "通用"],
    path: "/app/settings",
    subView: "通用设置",
  },
  {
    area: "system",
    commandDescription: "账户详情、头像与显示名称",
    commandLabel: "打开账户",
    gateRoute: "/app/profile",
    icon: "users",
    keywords: ["账户", "个人", "头像", "资料"],
    path: "/app/profile",
    subView: "账户",
  },
  {
    area: "system",
    commandDescription: "管理 Passkey、TOTP 和登录设备",
    commandLabel: "打开安全",
    gateRoute: "/app/settings",
    icon: "lock",
    keywords: ["安全", "Passkey", "TOTP", "登录", "设备"],
    path: "/app/security",
    subView: "安全",
  },
  {
    area: "system",
    commandDescription: "检查本地队列、设备和显式冲突",
    commandLabel: "打开数据与同步",
    gateRoute: "/app/settings",
    icon: "refresh",
    keywords: ["同步", "离线", "冲突", "设备", "数据"],
    path: "/app/sync",
    subView: "数据与同步",
  },
  {
    area: "system",
    commandDescription: "导出、导入、迁移和删除均显式确认",
    commandLabel: "打开导入导出",
    gateRoute: "/app/settings",
    icon: "download",
    keywords: ["数据", "导出", "导入", "删除", "迁移"],
    path: "/app/data",
    subView: "导入导出",
  },
  {
    allowedBuiltinPersonas: INTEGRATION_ENTRY_PERSONAS,
    area: "system",
    commandDescription: "管理可审查草稿、模型和任务路由",
    commandLabel: "打开 AI 治理",
    gateRoute: "/app/settings",
    icon: "ai",
    keywords: ["AI", "模型", "Provider", "路由", "治理"],
    path: "/app/ai",
    subView: "AI 治理",
  },
  {
    area: "system",
    commandDescription: "查看受控状态与安全边界说明",
    commandLabel: "打开帮助",
    gateRoute: "/app/help",
    icon: "book-open",
    keywords: ["帮助", "文档", "安全", "边界"],
    path: "/app/help",
    subView: "帮助",
  },
  // 全局搜索 (1) — cross-cutting, not a sixth nav area
  {
    allowedBuiltinPersonas: ["self", "research", "mentor"],
    area: "system",
    commandDescription: "搜索内容并处理真实通知与日历",
    commandLabel: "打开全局搜索",
    gateRoute: "/app/settings",
    icon: "search",
    keywords: ["搜索", "通知", "日历", "命令"],
    path: "/app/search",
    subView: "全局搜索",
  },
  // 互操作 — last system route
  {
    allowedBuiltinPersonas: ["self", "research", "mentor"],
    area: "system",
    builtinPersonasOnly: true,
    commandDescription: "汇总只读日历与开放格式迁移能力",
    commandLabel: "打开互操作",
    gateRoute: "/app/settings",
    icon: "refresh",
    keywords: ["互操作", "集成", "日历", "导入", "导出", "Zotero"],
    path: "/app/integrations",
    subView: "互操作",
  },
];

/**
 * The exact count of formal business routes (21). `/app` and
 * `/app/knowledge-prototype` are excluded.
 */
export const FORMAL_ROUTE_COUNT = 21;

/**
 * Routes that are NOT counted among the 21 formal business routes but must
 * still resolve correctly for deep-linking.
 */
export const NON_FORMAL_ROUTES = ["/app", "/app/knowledge-prototype"] as const;

/**
 * Reverse-lookup: given a deep-link path, return the area it belongs to.
 *
 * `/app/search` returns `null` — it is a cross-cutting global surface, not a
 * sixth navigation area. Unknown paths also return `null`.
 */
export function routeArea(path: string): DeskAreaId | null {
  const entry = DESK_ROUTES.find((route) => route.path === path);
  if (!entry) return null;
  // `/app/search` is a global surface; the context bar shows "全局搜索" and no
  // sidebar area is highlighted.
  if (path === "/app/search") return null;
  return entry.area;
}

/**
 * Returns the {@link DeskRouteEntry} for a given path, or null if not found.
 */
export function routeEntry(path: string): DeskRouteEntry | null {
  return DESK_ROUTES.find((route) => route.path === path) ?? null;
}

/**
 * Structured description of what the 44px Context Bar should display for a
 * given deep-link path. This is a pure, independently-testable function —
 * the AppShell only renders the result.
 *
 * Rules:
 *
 * - A formal route with a real area: `{ areaLabel: <area label>, subView:
 *   <sub view> }`. The separator is only rendered when `subView` is non-empty
 *   AND differs from `areaLabel` (so `/app/search` never shows
 *   "全局搜索 / 全局搜索").
 * - `/app/search`: `{ areaLabel: "全局搜索", subView: null }` — the context bar
 *   shows the search surface name once, with no area highlight.
 * - `/app/knowledge-prototype`: `{ areaLabel: "知识库", subView: "历史原型" }` —
 *   the historical demo entry is described as a knowledge-base sub-view, never
 *   as "全局搜索".
 * - `/app` (the redirect landing): `{ areaLabel: null, subView: null }` —
 *   neutral, no description.
 * - Any unknown path: `{ areaLabel: null, subView: null }` — neutral fallback,
 *   never "全局搜索".
 */
export interface ContextBarDescriptor {
  /** The area label to show, or null for a neutral/unknown surface. */
  areaLabel: string | null;
  /**
   * The sub-view label to show after the separator, or null. When this equals
   * `areaLabel` the caller should omit the separator to avoid duplication.
   */
  subView: string | null;
}

/** Special context-bar descriptions for non-formal routes. */
const SPECIAL_CONTEXT: Readonly<Record<string, ContextBarDescriptor>> = {
  "/app/knowledge-prototype": { areaLabel: "知识库", subView: "历史原型" },
  "/app/search": { areaLabel: "全局搜索", subView: null },
};

const NEUTRAL_DESCRIPTOR: ContextBarDescriptor = {
  areaLabel: null,
  subView: null,
};

export function contextBarDescriptor(path: string): ContextBarDescriptor {
  // Non-formal special routes take precedence.
  const special = SPECIAL_CONTEXT[path];
  if (special) return special;

  const entry = routeEntry(path);
  if (!entry) return NEUTRAL_DESCRIPTOR;

  const areaLabel =
    DESK_AREAS.find((area) => area.id === entry.area)?.label ?? null;

  // `/app/search` is a formal route but is a cross-cutting surface — show
  // "全局搜索" once, without an area highlight or duplicated sub-view.
  if (path === "/app/search") {
    return { areaLabel: "全局搜索", subView: null };
  }

  // For formal routes with a real area, only include the sub-view when it is
  // non-empty AND differs from the area label (avoids "今天 / 今天").
  const subView =
    entry.subView && entry.subView !== areaLabel ? entry.subView : null;

  return { areaLabel, subView };
}

/**
 * Returns the default entry route for a given area, honouring persona-based
 * defaults where applicable. Persona only affects the *default* entry — it
 * never changes authorization or hides error states.
 *
 * - 今天 → `/app/today`
 * - 工作台 → exam persona enters `/app/exam`, others `/app/self-study`
 * - 知识库 → first persona-visible of `/app/records` → `/app/review` → `/app/spaces`
 * - 协作空间 → `/app/workspaces`
 * - 系统中心 → `/app/settings`
 */
export function defaultRouteForArea(
  area: DeskAreaId,
  persona: PersonaDefinition | null = null,
): string {
  switch (area) {
    case "today":
      return "/app/today";
    case "workbench":
      return persona?.isBuiltin && persona.id === "exam"
        ? "/app/exam"
        : "/app/self-study";
    case "knowledge":
      return firstVisibleRoute(
        ["/app/records", "/app/review", "/app/spaces"],
        persona,
      );
    case "collaboration":
      return "/app/workspaces";
    case "system":
      return "/app/settings";
  }
}

function firstVisibleRoute(
  candidates: readonly string[],
  persona: PersonaDefinition | null,
): string {
  if (!persona) return candidates[0]!;
  const allowed = new Set(persona.routes);
  return candidates.find((route) => allowed.has(route)) ?? candidates[0]!;
}

/**
 * The ordered list of sidebar area groups. Each group's `defaultPath` is the
 * area's default entry (without persona — the sidebar uses a stable default;
 * persona-based defaults apply to the *active* area only via the context bar).
 */
export interface DeskNavGroup {
  label: string;
  areaIds: readonly DeskAreaId[];
}

export const DESK_NAV_GROUPS: readonly DeskNavGroup[] = [
  {
    areaIds: DESK_AREAS.filter((area) => area.group === "主要区域").map(
      (area) => area.id,
    ),
    label: "主要区域",
  },
  {
    areaIds: DESK_AREAS.filter((area) => area.group === "管理").map(
      (area) => area.id,
    ),
    label: "管理",
  },
];
