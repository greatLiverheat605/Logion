"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { BUILTIN_PERSONAS } from "@/features/personas/persona-definitions";
import { usePersona } from "@/features/personas/persona-context";
import { LogionApiError } from "@/lib/api/client";

import {
  documentFromLegacyPersona,
  FIXED_WORKBENCH_REFS,
  FIXED_WORKBENCHES,
  fixedWorkbenchRef,
  legacyPersonaSourceKey,
  legacySourceKeyFromDocument,
  personaIdForWorkbenchRef,
  projectPersonaToWorkbench,
  workbenchEntryPath,
  type WorkbenchEntryPath,
} from "./workbench-model";
import {
  type WorkbenchDefinition,
  type WorkbenchDefinitionConflictDetails,
  type WorkbenchDocument,
  type WorkbenchExport,
  type WorkbenchPreference,
  type WorkbenchSummary,
  type WorkbenchDeletionImpact,
  WorkbenchPreferenceInvalidError,
  mergeWorkbenchDocuments,
  workbenchDocumentsEqual,
  workbenchService,
  workbenchMigrationIdempotencyKey,
  type WorkbenchService,
} from "./workbench-service";

export interface WorkbenchOption {
  accent: string;
  description: string;
  entryPath: WorkbenchEntryPath;
  icon: string;
  kind: "custom" | "fixed" | "legacy";
  lifecycle: "active" | "archived";
  name: string;
  ref: string;
  templateId: string;
}

type WorkbenchPhase =
  | "loading"
  | "legacy"
  | "migration-required"
  | "ready"
  | "invalid-preference"
  | "error";

interface WorkbenchContextValue {
  activeWorkbench: WorkbenchOption | null;
  definitions: WorkbenchSummary[];
  invalidPreferenceSource: string | null;
  migrateLegacyPersonas: () => Promise<void>;
  options: readonly WorkbenchOption[];
  phase: WorkbenchPhase;
  refresh: () => Promise<void>;
  selectWorkbench: (ref: string) => Promise<WorkbenchEntryPath>;
  createWorkbench: (document: WorkbenchDocument) => Promise<void>;
  loadWorkbench: (id: string) => Promise<WorkbenchDefinition>;
  updateWorkbench: (
    definition: WorkbenchDefinition,
    document: WorkbenchDocument,
  ) => Promise<void>;
  resolveDefinitionConflict: (
    id: string,
    details: WorkbenchDefinitionConflictDetails,
    local: WorkbenchDocument,
  ) => Promise<void>;
  setWorkbenchLifecycle: (
    definition: WorkbenchSummary,
    lifecycle: "active" | "archived",
  ) => Promise<void>;
  getDeletionImpact: (id: string) => Promise<WorkbenchDeletionImpact>;
  deleteWorkbench: (impact: WorkbenchDeletionImpact) => Promise<void>;
  exportWorkbench: (
    definition: WorkbenchSummary,
    includeLinks: boolean,
  ) => Promise<WorkbenchExport>;
  importWorkbench: (raw: string) => Promise<void>;
}

interface WorkbenchProviderProps {
  children: ReactNode;
  service?: WorkbenchService;
}

const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);

function fixedOptions(): WorkbenchOption[] {
  return FIXED_WORKBENCHES.map((definition) => {
    const persona = BUILTIN_PERSONAS.find(
      (candidate) => candidate.id === definition.personaId,
    )!;
    return {
      accent: "neutral",
      description: persona.description,
      entryPath: definition.entryPath,
      icon: persona.icon,
      kind: "fixed",
      lifecycle: "active",
      name: definition.name,
      ref: fixedWorkbenchRef(definition.id),
      templateId: fixedWorkbenchRef(definition.id),
    };
  });
}

function definitionOption(definition: WorkbenchSummary): WorkbenchOption {
  return {
    accent: definition.accent,
    description: definition.description,
    entryPath: workbenchEntryPath(definition.id, definition.templateId),
    icon: definition.icon,
    kind: "custom",
    lifecycle: definition.lifecycle,
    name: definition.name,
    ref: definition.id,
    templateId: definition.templateId,
  };
}

function effectiveWorkbenchRef(
  definitions: WorkbenchSummary[],
  preference: WorkbenchPreference,
): string {
  const requested = preference.payload.activeWorkbenchId;
  if (
    requested.startsWith("fixed.") &&
    preference.payload.hiddenFixedWorkbenchIds.some((id) => id === requested)
  ) {
    return "fixed.learning";
  }
  const custom = definitions.find((item) => item.id === requested);
  return custom?.lifecycle === "archived" ? "fixed.learning" : requested;
}

export function WorkbenchProvider({
  children,
  service = workbenchService,
}: Readonly<WorkbenchProviderProps>) {
  const persona = usePersona();
  const {
    activePersona,
    allPersonas,
    customPersonas,
    setActivePersona,
    setCompatibilityPersona,
  } = persona;
  const [phase, setPhase] = useState<WorkbenchPhase>("loading");
  const [definitions, setDefinitions] = useState<WorkbenchSummary[]>([]);
  const [preference, setPreference] = useState<WorkbenchPreference | null>(
    null,
  );
  const [invalidPreferenceSource, setInvalidPreferenceSource] = useState<
    string | null
  >(null);

  const applyState = useCallback(
    (nextDefinitions: WorkbenchSummary[], next: WorkbenchPreference | null) => {
      setDefinitions(nextDefinitions);
      setPreference(next);
      setInvalidPreferenceSource(null);
      setPhase(next ? "ready" : "migration-required");
      if (next) {
        const activeRef = effectiveWorkbenchRef(nextDefinitions, next);
        const definition = nextDefinitions.find(
          (item) => item.id === activeRef,
        );
        setCompatibilityPersona(
          personaIdForWorkbenchRef(activeRef, definition?.templateId),
        );
      }
    },
    [setCompatibilityPersona],
  );

  const applyLoadError = useCallback((error: unknown) => {
    if (error instanceof WorkbenchPreferenceInvalidError) {
      setDefinitions([]);
      setPreference(null);
      setInvalidPreferenceSource(error.source);
      setPhase("invalid-preference");
    } else if (error instanceof LogionApiError && error.status === 404) {
      setPhase("legacy");
    } else {
      setPhase("error");
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const state = await service.load();
      applyState(state.definitions, state.preference);
    } catch (error) {
      applyLoadError(error);
    }
  }, [applyLoadError, applyState, service]);

  useEffect(() => {
    let active = true;
    void service
      .load()
      .then((state) => {
        if (active) applyState(state.definitions, state.preference);
      })
      .catch((error: unknown) => {
        if (active) applyLoadError(error);
      });
    return () => {
      active = false;
    };
  }, [applyLoadError, applyState, service]);

  const options = useMemo(() => {
    if (
      phase === "legacy" ||
      phase === "loading" ||
      phase === "migration-required" ||
      phase === "invalid-preference" ||
      phase === "error"
    ) {
      return allPersonas
        .map((item): WorkbenchOption | null => {
          const projection = projectPersonaToWorkbench(item);
          if (!projection?.entryPath) return null;
          return {
            accent: "neutral",
            description: projection.description,
            entryPath: projection.entryPath,
            icon: projection.icon,
            kind: projection.kind === "fixed" ? "fixed" : "legacy",
            lifecycle: "active",
            name: projection.name,
            ref: item.id,
            templateId:
              projection.kind === "fixed" ? `fixed.${projection.id}` : "blank",
          };
        })
        .filter((item): item is WorkbenchOption => item !== null);
    }
    const customs = definitions.map(definitionOption);
    const all = [...fixedOptions(), ...customs];
    if (!preference) return all;
    const positions = new Map(
      preference.payload.workbenchOrder.map((ref, index) => [ref, index]),
    );
    return all
      .filter(
        (item) =>
          item.kind === "custom" ||
          !preference.payload.hiddenFixedWorkbenchIds.includes(
            item.ref as never,
          ),
      )
      .sort(
        (left, right) =>
          (positions.get(left.ref) ?? Number.MAX_SAFE_INTEGER) -
          (positions.get(right.ref) ?? Number.MAX_SAFE_INTEGER),
      );
  }, [allPersonas, definitions, phase, preference]);

  const activeWorkbench = useMemo(() => {
    const requested = preference
      ? effectiveWorkbenchRef(definitions, preference)
      : undefined;
    if (requested) {
      const found = options.find(
        (item) => item.ref === requested && item.lifecycle === "active",
      );
      if (found) return found;
      return options.find((item) => item.ref === "fixed.learning") ?? null;
    }
    return (
      options.find((item) => item.ref === activePersona?.id) ??
      options[0] ??
      null
    );
  }, [activePersona?.id, definitions, options, preference]);

  const selectWorkbench = useCallback(
    async (ref: string) => {
      const option = options.find(
        (candidate) =>
          candidate.ref === ref && candidate.lifecycle === "active",
      );
      if (!option) throw new Error("The Workbench is unavailable.");
      if (phase !== "ready" || !preference) {
        await setActivePersona(ref);
      } else if (preference.payload.activeWorkbenchId !== ref) {
        const saved = await service.savePreference({
          ...preference.payload,
          activeWorkbenchId: ref,
        });
        setPreference(saved);
        setCompatibilityPersona(
          personaIdForWorkbenchRef(ref, option.templateId),
        );
      }
      return option.entryPath;
    },
    [
      options,
      phase,
      preference,
      service,
      setActivePersona,
      setCompatibilityPersona,
    ],
  );

  const migrateLegacyPersonas = useCallback(async () => {
    const plans = customPersonas.map((legacy) => ({
      document: documentFromLegacyPersona(legacy),
      legacy,
    }));
    if (FIXED_WORKBENCH_REFS.length + plans.length > 24) {
      throw new Error("Too many legacy Personas to migrate safely.");
    }
    const existing = await Promise.all(
      definitions.map((definition) => service.get(definition.id)),
    );
    const customIds = new Map<string, string>();
    const migratedBySource = new Map<string, WorkbenchSummary>();
    const matchedPlans = new Map<
      string,
      { definition: WorkbenchDefinition; document: WorkbenchDocument }
    >();
    const matchedIds = new Set<string>();
    const unmatched = plans.filter(({ document, legacy }) => {
      const match = existing.find(
        (definition) =>
          !matchedIds.has(definition.id) &&
          (workbenchDocumentsEqual(definition.document, document) ||
            legacySourceKeyFromDocument(definition.document) ===
              legacyPersonaSourceKey(legacy.id)),
      );
      if (!match) return true;
      matchedIds.add(match.id);
      customIds.set(legacy.id, match.id);
      migratedBySource.set(legacy.id, match);
      matchedPlans.set(legacy.id, { definition: match, document });
      return false;
    });
    const archivedMatches = [...migratedBySource].filter(
      ([, definition]) => definition.lifecycle === "archived",
    );
    const activeCount = definitions.filter(
      (definition) => definition.lifecycle === "active",
    ).length;
    if (
      activeCount + unmatched.length + archivedMatches.length > 20 ||
      definitions.length + unmatched.length > 50
    ) {
      throw new Error(
        "Not enough Workbench capacity to migrate every Persona.",
      );
    }
    for (const [sourceId, archived] of archivedMatches) {
      const restored = await service.setLifecycle(archived, "active");
      migratedBySource.set(sourceId, restored);
      matchedPlans.set(sourceId, {
        definition: restored,
        document: matchedPlans.get(sourceId)!.document,
      });
    }
    for (const [sourceId, plan] of matchedPlans) {
      if (!workbenchDocumentsEqual(plan.definition.document, plan.document)) {
        const updated = await service.replace(plan.definition, plan.document);
        migratedBySource.set(sourceId, updated);
        matchedPlans.set(sourceId, {
          definition: updated,
          document: plan.document,
        });
      }
    }
    for (const { document, legacy } of unmatched) {
      const created = await service.create(
        document,
        await workbenchMigrationIdempotencyKey(legacy.id, document),
      );
      customIds.set(legacy.id, created.id);
      migratedBySource.set(legacy.id, created);
    }
    const migrated = plans.map(
      ({ legacy }) => migratedBySource.get(legacy.id)!,
    );
    const activeFixed = FIXED_WORKBENCHES.find(
      (item) => item.personaId === activePersona?.id,
    );
    const activeWorkbenchId = activeFixed
      ? fixedWorkbenchRef(activeFixed.id)
      : (customIds.get(activePersona?.id ?? "") ?? "fixed.learning");
    const saved = await service.savePreference({
      activeWorkbenchId,
      defaultSpaceByWorkbench: {},
      defaultViewByWorkbench: {},
      density: "comfortable",
      hiddenFixedWorkbenchIds: [],
      workbenchOrder: [
        ...FIXED_WORKBENCH_REFS,
        ...new Set(migrated.map((item) => item.id)),
      ],
    });
    const merged = new Map(
      [...definitions, ...migrated].map((definition) => [
        definition.id,
        definition,
      ]),
    );
    applyState([...merged.values()], saved);
  }, [activePersona?.id, applyState, customPersonas, definitions, service]);

  const commitDefinition = useCallback((saved: WorkbenchSummary) => {
    setDefinitions((current) => [
      ...current.filter((item) => item.id !== saved.id),
      saved,
    ]);
  }, []);

  const createWorkbench = useCallback(
    async (document: WorkbenchDocument) => {
      const saved = await service.create(document);
      commitDefinition(saved);
      if (preference) {
        setPreference(
          await service.savePreference({
            ...preference.payload,
            activeWorkbenchId: saved.id,
            workbenchOrder: [...preference.payload.workbenchOrder, saved.id],
          }),
        );
        setCompatibilityPersona(
          personaIdForWorkbenchRef(saved.id, saved.templateId),
        );
      }
    },
    [commitDefinition, preference, service, setCompatibilityPersona],
  );

  const loadWorkbench = useCallback((id: string) => service.get(id), [service]);

  const updateWorkbench = useCallback(
    async (definition: WorkbenchDefinition, document: WorkbenchDocument) => {
      commitDefinition(await service.replace(definition, document));
    },
    [commitDefinition, service],
  );

  const resolveDefinitionConflict = useCallback(
    async (
      id: string,
      details: WorkbenchDefinitionConflictDetails,
      local: WorkbenchDocument,
    ) => {
      commitDefinition(
        await service.replaceAgainst(
          id,
          details.remoteRevision,
          details.remote,
          mergeWorkbenchDocuments(details.base, local, details.remote),
        ),
      );
    },
    [commitDefinition, service],
  );

  const setWorkbenchLifecycle = useCallback(
    async (definition: WorkbenchSummary, lifecycle: "active" | "archived") => {
      const saved = await service.setLifecycle(definition, lifecycle);
      commitDefinition(saved);
      if (
        lifecycle === "archived" &&
        preference?.payload.activeWorkbenchId === definition.id
      ) {
        setCompatibilityPersona("self");
        setPreference(
          await service.savePreference({
            ...preference.payload,
            activeWorkbenchId: "fixed.learning",
          }),
        );
      }
    },
    [commitDefinition, preference, service, setCompatibilityPersona],
  );

  const getDeletionImpact = useCallback(
    (id: string) => service.deletionImpact(id),
    [service],
  );

  const deleteWorkbench = useCallback(
    async (impact: WorkbenchDeletionImpact) => {
      await service.delete(impact);
      await refresh();
    },
    [refresh, service],
  );

  const exportWorkbench = useCallback(
    (definition: WorkbenchSummary, includeLinks: boolean) =>
      service.export(definition.id, includeLinks),
    [service],
  );

  const importWorkbench = useCallback(
    async (raw: string) => {
      await service.import(raw);
      await refresh();
    },
    [refresh, service],
  );

  const value = useMemo<WorkbenchContextValue>(
    () => ({
      activeWorkbench,
      createWorkbench,
      definitions,
      deleteWorkbench,
      exportWorkbench,
      getDeletionImpact,
      importWorkbench,
      invalidPreferenceSource,
      migrateLegacyPersonas,
      loadWorkbench,
      options,
      phase,
      refresh,
      resolveDefinitionConflict,
      selectWorkbench,
      setWorkbenchLifecycle,
      updateWorkbench,
    }),
    [
      activeWorkbench,
      createWorkbench,
      definitions,
      deleteWorkbench,
      exportWorkbench,
      getDeletionImpact,
      importWorkbench,
      invalidPreferenceSource,
      migrateLegacyPersonas,
      loadWorkbench,
      options,
      phase,
      refresh,
      resolveDefinitionConflict,
      selectWorkbench,
      setWorkbenchLifecycle,
      updateWorkbench,
    ],
  );

  return (
    <WorkbenchContext.Provider value={value}>
      {children}
    </WorkbenchContext.Provider>
  );
}

export function useWorkbench(): WorkbenchContextValue {
  const context = useContext(WorkbenchContext);
  if (!context) {
    throw new Error("useWorkbench must be used within WorkbenchProvider");
  }
  return context;
}

export function useOptionalWorkbench(): WorkbenchContextValue | null {
  return useContext(WorkbenchContext);
}
