import type { AppIconName } from "@/components/app-shell/app-icon";
import {
  type DeskAreaId,
  DESK_AREAS,
  defaultRouteForArea,
} from "@/features/desk/route-manifest";

import { type PersonaDefinition } from "./persona-definitions";

/**
 * A stable mobile bottom-nav entry. The five entries are always the same five
 * areas regardless of persona — persona only affects which *route* the
 * workbench and knowledge entries point to (via {@link defaultRouteForArea}).
 */
export interface MobileDeskNavItem {
  area: DeskAreaId;
  href: string;
  icon: AppIconName;
  label: string;
}

/**
 * The five stable mobile navigation entries (areas only). The `href` is
 * resolved per-persona at render time by {@link mobileDeskNavigation}.
 */
export const DESK_MOBILE_AREAS: readonly {
  area: DeskAreaId;
  icon: AppIconName;
  label: string;
}[] = DESK_AREAS.map((area) => ({
  area: area.id,
  icon: area.icon,
  label: area.label,
}));

/**
 * Returns the five stable mobile navigation entries with persona-aware default
 * routes. Persona only changes the default entry route for 工作台 and 知识库 —
 * it never changes authorization or hides entries.
 */
export function mobileDeskNavigation(
  persona: PersonaDefinition | null,
): readonly MobileDeskNavItem[] {
  return DESK_MOBILE_AREAS.map((entry) => ({
    ...entry,
    href: defaultRouteForArea(entry.area, persona),
  }));
}

/* ---- Legacy compat (deprecated) ----------------------------------------- */
/* The old persona-driven 4+more mobile layout is replaced by the stable 5-area
 * layout above. These types are kept for any remaining callers but the old
 * `mobileNavigationForPersona` function is removed — AppShell now uses
 * {@link mobileDeskNavigation}. */
