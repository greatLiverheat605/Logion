import {
  type BuiltinPersonaId,
  type PersonaDefinition,
  type PersonaId,
} from "@/features/personas/persona-definitions";

export type FixedWorkbenchId = "learning" | "research" | "exam" | "mentor";
export type WorkbenchId = FixedWorkbenchId | `legacy:${string}`;

const WORKBENCH_ENTRY_PATHS = [
  "/app/self-study",
  "/app/research",
  "/app/exam",
  "/app/collaboration",
] as const;

export type WorkbenchEntryPath = (typeof WORKBENCH_ENTRY_PATHS)[number];

export interface FixedWorkbenchDefinition {
  readonly entryPath: WorkbenchEntryPath;
  readonly gateRoute: WorkbenchEntryPath;
  readonly id: FixedWorkbenchId;
  readonly name: string;
  readonly personaId: BuiltinPersonaId;
}

export interface WorkbenchProjection {
  description: string;
  entryPath: WorkbenchEntryPath | null;
  icon: string;
  id: WorkbenchId;
  kind: "fixed" | "legacy-persona";
  name: string;
  sourcePersonaId: PersonaId | null;
  visibleRoutes: readonly string[];
}

export const FIXED_WORKBENCHES = [
  {
    entryPath: "/app/self-study",
    gateRoute: "/app/self-study",
    id: "learning",
    name: "学习",
    personaId: "self",
  },
  {
    entryPath: "/app/research",
    gateRoute: "/app/self-study",
    id: "research",
    name: "研究",
    personaId: "research",
  },
  {
    entryPath: "/app/exam",
    gateRoute: "/app/exam",
    id: "exam",
    name: "考试",
    personaId: "exam",
  },
  {
    entryPath: "/app/collaboration",
    gateRoute: "/app/self-study",
    id: "mentor",
    name: "导师",
    personaId: "mentor",
  },
] as const satisfies readonly FixedWorkbenchDefinition[];

function fixedProjection(
  definition: FixedWorkbenchDefinition,
  persona: PersonaDefinition,
): WorkbenchProjection {
  const visibleRoutes = [...persona.routes];
  return {
    description: persona.description,
    entryPath: visibleRoutes.includes(definition.gateRoute)
      ? definition.entryPath
      : null,
    icon: persona.icon,
    id: definition.id,
    kind: "fixed",
    name: definition.name,
    sourcePersonaId: persona.id,
    visibleRoutes,
  };
}

function isWorkbenchEntryPath(route: string): route is WorkbenchEntryPath {
  return WORKBENCH_ENTRY_PATHS.some((entryPath) => entryPath === route);
}

export function projectPersonaToWorkbench(
  persona: PersonaDefinition | null,
): WorkbenchProjection | null {
  if (!persona || (persona.isBuiltin !== true && persona.isBuiltin !== false)) {
    return null;
  }

  const fixed = FIXED_WORKBENCHES.find((item) => item.personaId === persona.id);
  if (persona.isBuiltin === true) {
    return fixed ? fixedProjection(fixed, persona) : null;
  }
  if (fixed) return null;

  const visibleRoutes = [...persona.routes];
  return {
    description: persona.description,
    entryPath: visibleRoutes.find(isWorkbenchEntryPath) ?? null,
    icon: persona.icon,
    id: `legacy:${persona.id}`,
    kind: "legacy-persona",
    name: persona.name,
    sourcePersonaId: persona.id,
    visibleRoutes,
  };
}
