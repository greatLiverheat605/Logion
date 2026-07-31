import type { AppIconName } from "@/components/app-shell/app-icon";

import {
  ALL_ROUTES,
  type BuiltinPersonaId,
  type PersonaDefinition,
} from "./persona-definitions";

type PersonaRoute = (typeof ALL_ROUTES)[number];

export interface MobilePersonaNavItem {
  href: PersonaRoute;
  icon: AppIconName;
  label: string;
}

interface MobileSlot {
  href: PersonaRoute;
  label: string;
}

const ROUTE_META: Readonly<Record<PersonaRoute, MobilePersonaNavItem>> = {
  "/app/today": { href: "/app/today", icon: "home", label: "今日" },
  "/app/self-study": {
    href: "/app/self-study",
    icon: "book-open",
    label: "自学",
  },
  "/app/records": { href: "/app/records", icon: "files", label: "记录" },
  "/app/review": { href: "/app/review", icon: "refresh", label: "复习" },
  "/app/exam": { href: "/app/exam", icon: "target", label: "考试" },
  "/app/planning": {
    href: "/app/planning",
    icon: "calendar",
    label: "规划",
  },
  "/app/templates": {
    href: "/app/templates",
    icon: "layout-template",
    label: "模板",
  },
  "/app/audit": { href: "/app/audit", icon: "clipboard", label: "审计" },
  "/app/spaces": { href: "/app/spaces", icon: "folder", label: "空间" },
  "/app/settings": {
    href: "/app/settings",
    icon: "shield",
    label: "设置",
  },
  "/app/profile": { href: "/app/profile", icon: "users", label: "个人" },
  "/app/help": { href: "/app/help", icon: "book-open", label: "帮助" },
};

const BUILTIN_MOBILE_SLOTS: Readonly<
  Record<BuiltinPersonaId, readonly MobileSlot[]>
> = {
  exam: [
    { href: "/app/today", label: "今日" },
    { href: "/app/exam", label: "备考" },
    { href: "/app/review", label: "复习" },
    { href: "/app/records", label: "错题" },
  ],
  self: [
    { href: "/app/today", label: "今日" },
    { href: "/app/planning", label: "计划" },
    { href: "/app/self-study", label: "自学" },
    { href: "/app/records", label: "记录" },
  ],
  research: [
    { href: "/app/today", label: "今日" },
    { href: "/app/planning", label: "计划" },
    { href: "/app/self-study", label: "自学" },
    { href: "/app/review", label: "复习" },
  ],
  mentor: [
    { href: "/app/today", label: "今日" },
    { href: "/app/planning", label: "计划" },
    { href: "/app/spaces", label: "空间" },
    { href: "/app/audit", label: "审计" },
  ],
};

function isPersonaRoute(route: string): route is PersonaRoute {
  return Object.hasOwn(ROUTE_META, route);
}

export function mobileNavigationForPersona(persona: PersonaDefinition): {
  overflow: MobilePersonaNavItem[];
  primary: MobilePersonaNavItem[];
} {
  const routes = persona.routes.filter(isPersonaRoute);
  const allowed = new Set(routes);
  const slots = persona.isBuiltin
    ? BUILTIN_MOBILE_SLOTS[persona.id as BuiltinPersonaId]
    : routes.slice(0, 4).map((href) => ({
        href,
        label: ROUTE_META[href].label,
      }));
  const primary = slots
    .filter((slot) => allowed.has(slot.href))
    .map((slot) => ({ ...ROUTE_META[slot.href], label: slot.label }));
  const primaryRoutes = new Set(primary.map((item) => item.href));
  const overflow = routes
    .filter((route) => !primaryRoutes.has(route))
    .map((route) => ROUTE_META[route]);
  return { overflow, primary };
}
