import { type AppIconName } from "@/components/app-shell/app-icon";
import {
  type BuiltinPersonaId,
  type PersonaDefinition,
} from "@/features/personas/persona-definitions";
import {
  type DeskAreaId,
  DESK_AREAS,
  DESK_NAV_GROUPS,
  DESK_ROUTES,
  defaultRouteForArea,
  type DeskRouteEntry,
} from "@/features/desk/route-manifest";

/* ---- Sidebar navigation (5 areas) ---------------------------------------- */

export interface NavItem {
  /** The default deep-link for this area entry. */
  href: string;
  icon: AppIconName;
  label: string;
  /** The area this nav entry represents (for highlight reverse-lookup). */
  area: DeskAreaId;
}

export interface NavGroup {
  label: string;
  items: readonly NavItem[];
}

/**
 * Sidebar groups derived from the single route manifest. Each group's items
 * are the area default entries (without persona — the sidebar shows stable
 * defaults; persona-based defaults apply to navigation, not to the sidebar
 * label set).
 */
export const NAV_GROUPS: readonly NavGroup[] = DESK_NAV_GROUPS.map((group) => ({
  items: group.areaIds.map((areaId) => {
    const area = DESK_AREAS.find((a) => a.id === areaId)!;
    return {
      area: areaId,
      href: defaultRouteForArea(areaId),
      icon: area.icon,
      label: area.label,
    };
  }),
  label: group.label,
}));

/**
 * Builds persona-aware sidebar groups. The five areas, their order, labels and
 * icons are always the same (driven by {@link DESK_NAV_GROUPS}); only the
 * `href` of each entry is computed via
 * {@link defaultRouteForArea}`(area, persona)` so that e.g. the exam persona's
 * 工作台 entry points to `/app/exam` while other personas point to
 * `/app/self-study`.
 *
 * Persona never hides an area, widens permissions, or changes area highlight
 * (which is driven by `routeArea(pathname)`, not by the sidebar href).
 */
export function navGroupsForPersona(
  persona: PersonaDefinition | null,
): readonly NavGroup[] {
  return DESK_NAV_GROUPS.map((group) => ({
    items: group.areaIds.map((areaId) => {
      const area = DESK_AREAS.find((a) => a.id === areaId)!;
      return {
        area: areaId,
        href: defaultRouteForArea(areaId, persona),
        icon: area.icon,
        label: area.label,
      };
    }),
    label: group.label,
  }));
}

/** Flattened sidebar items (5 total, one per area). */
export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap(
  (group) => group.items,
);

export const DEFAULT_NAV_ITEM: NavItem = NAV_ITEMS[0]!;

/* ---- Command palette ----------------------------------------------------- */

export const COMMAND_GROUPS = [
  "今天",
  "工作台",
  "知识库",
  "协作空间",
  "系统中心",
  "创建",
] as const;
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

/** Maps a desk area to its command-palette group label. */
const AREA_TO_COMMAND_GROUP: Readonly<Record<DeskAreaId, CommandGroup>> = {
  collaboration: "协作空间",
  knowledge: "知识库",
  system: "系统中心",
  today: "今天",
  workbench: "工作台",
};

/**
 * Derives command-palette route items from the single route manifest. This
 * preserves the existing `gateRoute` + `allowedBuiltinPersonas` +
 * `builtinPersonasOnly` visibility semantics exactly — no permission is
 * widened.
 */
function routeItemsFromManifest(): readonly CommandRouteItem[] {
  return DESK_ROUTES.map((entry) => routeEntryToCommandItem(entry));
}

function routeEntryToCommandItem(entry: DeskRouteEntry): CommandRouteItem {
  return {
    allowedBuiltinPersonas: entry.allowedBuiltinPersonas,
    builtinPersonasOnly: entry.builtinPersonasOnly,
    description: entry.commandDescription,
    gateRoute: entry.gateRoute,
    group: AREA_TO_COMMAND_GROUP[entry.area],
    href: entry.path,
    icon: entry.icon,
    id: entry.path.replace(/^\/app\//, "").replace(/-/g, "_"),
    keywords: entry.keywords,
    kind: "route",
    label: entry.commandLabel,
  };
}

const OPERATIONAL_ITEMS: readonly CommandActionItem[] = [
  {
    action: "capture",
    description: "加密保存到学习收件箱或笔记库",
    group: "创建",
    icon: "plus",
    id: "capture",
    keywords: ["捕获", "新建", "笔记", "收件箱"],
    kind: "action",
    label: "快速捕获",
  },
  {
    action: "focus",
    description: "从真实任务开始或继续专注会话",
    group: "创建",
    icon: "timer",
    id: "focus",
    keywords: ["专注", "计时", "会话"],
    kind: "action",
    label: "开始专注会话",
  },
];

/**
 * All command-palette items: 21 manifest routes (including `/app/search`) +
 * 2 operational actions. The command palette covers every formal route.
 */
export const COMMAND_ITEMS: readonly AppCommandItem[] = [
  ...routeItemsFromManifest(),
  ...OPERATIONAL_ITEMS,
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
