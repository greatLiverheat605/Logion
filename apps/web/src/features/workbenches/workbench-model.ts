import {
  type BuiltinPersonaId,
  type PersonaDefinition,
  type PersonaId,
} from "@/features/personas/persona-definitions";
import type { WorkbenchDocument } from "./workbench-service";

export type FixedWorkbenchId = "learning" | "research" | "exam" | "mentor";
export type FixedWorkbenchRef = `fixed.${FixedWorkbenchId}`;
export type WorkbenchRef = FixedWorkbenchRef | string;
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

export const FIXED_WORKBENCH_REFS = FIXED_WORKBENCHES.map(
  (definition) => `fixed.${definition.id}` as FixedWorkbenchRef,
);

export const WORKBENCH_MODULES = [
  ["next-action", "下一行动"],
  ["task-queue", "任务队列"],
  ["projects", "项目"],
  ["sources", "来源"],
  ["topics", "主题"],
  ["review", "复习"],
  ["evidence", "证据"],
  ["timeline", "时间线"],
  ["graph-projection", "图谱投影"],
  ["saved-view", "保存视图"],
  ["recent-objects", "最近对象"],
  ["pinned-objects", "固定对象"],
] as const;

type WorkbenchModuleKind = (typeof WORKBENCH_MODULES)[number][0];
type WorkbenchTemplateId = FixedWorkbenchRef | "blank";

const TEMPLATE_MODULES: Readonly<
  Record<WorkbenchTemplateId, readonly WorkbenchModuleKind[]>
> = {
  "fixed.learning": ["next-action", "projects", "task-queue", "review"],
  "fixed.research": ["next-action", "sources", "evidence", "graph-projection"],
  "fixed.exam": ["next-action", "review", "task-queue", "timeline"],
  "fixed.mentor": ["next-action", "task-queue", "evidence", "recent-objects"],
  blank: [],
};

export function fixedWorkbenchRef(id: FixedWorkbenchId): FixedWorkbenchRef {
  return `fixed.${id}`;
}

export function personaIdForWorkbenchRef(
  ref: string,
  templateId?: string,
): BuiltinPersonaId {
  const fixed = ref.startsWith("fixed.") ? ref : templateId;
  switch (fixed) {
    case "fixed.research":
      return "research";
    case "fixed.exam":
      return "exam";
    case "fixed.mentor":
      return "mentor";
    default:
      return "self";
  }
}

export function workbenchEntryPath(
  ref: string,
  templateId?: string,
): WorkbenchEntryPath {
  const personaId = personaIdForWorkbenchRef(ref, templateId);
  return FIXED_WORKBENCHES.find((item) => item.personaId === personaId)!
    .entryPath;
}

export function createWorkbenchDocument(input: {
  accent: WorkbenchDocument["payload"]["accent"];
  description: string;
  icon: WorkbenchDocument["payload"]["icon"];
  moduleKinds?: readonly WorkbenchModuleKind[];
  name: string;
  templateId: WorkbenchTemplateId;
}): WorkbenchDocument {
  const kinds = input.moduleKinds ?? TEMPLATE_MODULES[input.templateId];
  const modules = kinds.map((kind, index) => ({
    id: `module-${index + 1}`,
    kind,
  }));
  return {
    contract: "workbench.definition",
    schemaVersion: 1,
    payload: {
      accent: input.accent,
      description: input.description,
      fieldDefinitions: [],
      filters: [],
      icon: input.icon,
      layout: {
        columns: 2,
        items: modules.map((module, index) => ({
          moduleId: module.id,
          order: Math.floor(index / 2),
          region: index % 2 === 0 ? "main" : "side",
          span: 1,
        })),
      },
      modules,
      name: input.name,
      quickCreate: [],
      templateId: input.templateId,
    },
  };
}

export function documentFromLegacyPersona(
  persona: PersonaDefinition,
): WorkbenchDocument {
  const templateId: WorkbenchTemplateId = persona.routes.includes("/app/exam")
    ? "fixed.exam"
    : persona.routes.includes("/app/research")
      ? "fixed.research"
      : persona.routes.includes("/app/collaboration")
        ? "fixed.mentor"
        : "fixed.learning";
  const document = createWorkbenchDocument({
    accent: "neutral",
    description: persona.description,
    icon:
      templateId === "fixed.exam"
        ? "graduation-cap"
        : templateId === "fixed.research"
          ? "microscope"
          : templateId === "fixed.mentor"
            ? "users"
            : "book-open",
    name: persona.name,
    templateId,
  });
  const source = legacyPersonaSourceKey(persona.id);
  const hash = legacyPersonaSourceHash(persona.id);
  const ids = new Map(
    document.payload.modules.map((module, index) => [
      module.id,
      `legacy-${source}-${hash}-${index + 1}`,
    ]),
  );
  return {
    ...document,
    payload: {
      ...document.payload,
      layout: {
        ...document.payload.layout,
        items: document.payload.layout.items.map((item) => ({
          ...item,
          moduleId: ids.get(item.moduleId)!,
        })),
      },
      modules: document.payload.modules.map((module) => ({
        ...module,
        id: ids.get(module.id)!,
      })),
    },
  };
}

export function legacyPersonaSourceKey(personaId: string): string {
  return personaId.replace(/^custom-/i, "").toLowerCase();
}

function legacyPersonaSourceHash(personaId: string): string {
  let hash = 2166136261;
  for (const character of personaId) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function legacySourceKeyFromDocument(
  document: WorkbenchDocument,
): string | null {
  const prefix = /^legacy-([0-9a-f-]{36})-[0-9a-f]{8}-\d+$/;
  const matches = document.payload.modules.map(
    (module) => module.id.match(prefix)?.[1] ?? null,
  );
  if (!matches[0] || matches.some((match) => match !== matches[0])) return null;
  return matches[0];
}

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
