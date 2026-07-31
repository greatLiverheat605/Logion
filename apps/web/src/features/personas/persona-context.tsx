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

import {
  BUILTIN_PERSONAS,
  DEFAULT_PERSONA,
  type PersonaDefinition,
} from "./persona-definitions";
import {
  personaSettingService,
  type PersonaSetting,
  type PersonaSettingService,
} from "./persona-setting-service";

interface PersonaContextValue {
  activePersona: PersonaDefinition | null;
  customPersonas: PersonaDefinition[];
  allPersonas: readonly PersonaDefinition[];
  setActivePersona: (personaId: string) => Promise<void>;
  createCustomPersona: (
    persona: Omit<PersonaDefinition, "isBuiltin">,
  ) => Promise<void>;
  deleteCustomPersona: (personaId: string) => Promise<void>;
  isRouteVisible: (route: string) => boolean;
  isLoading: boolean;
}

interface PersonaProviderProps {
  children: ReactNode;
  service?: Pick<PersonaSettingService, "load" | "save">;
}

const PersonaContext = createContext<PersonaContextValue | null>(null);

export function PersonaProvider({
  children,
  service = personaSettingService,
}: Readonly<PersonaProviderProps>) {
  const [activePersona, setActivePersonaState] =
    useState<PersonaDefinition | null>(null);
  const [customPersonas, setCustomPersonas] = useState<PersonaDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const allPersonas = useMemo(
    () => [...BUILTIN_PERSONAS, ...customPersonas],
    [customPersonas],
  );

  const applySetting = useCallback((setting: PersonaSetting) => {
    const candidates = [...BUILTIN_PERSONAS, ...setting.customPersonas];
    setCustomPersonas(setting.customPersonas);
    setActivePersonaState(
      candidates.find((persona) => persona.id === setting.activePersonaId) ??
        DEFAULT_PERSONA,
    );
  }, []);

  useEffect(() => {
    let active = true;
    void service
      .load()
      .then((setting) => {
        if (!active) return;
        const custom = setting?.customPersonas ?? [];
        const candidates = [...BUILTIN_PERSONAS, ...custom];
        setCustomPersonas(custom);
        setActivePersonaState(
          candidates.find(
            (persona) => persona.id === setting?.activePersonaId,
          ) ?? DEFAULT_PERSONA,
        );
      })
      .catch(() => {
        if (active) setActivePersonaState(DEFAULT_PERSONA);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [service]);

  const setActivePersona = useCallback(
    async (personaId: string) => {
      if (activePersona?.id === personaId) return;
      const persona = allPersonas.find(
        (candidate) => candidate.id === personaId,
      );
      if (!persona) return;
      const saved = await service.save({
        activePersonaId: persona.id,
        customPersonas,
      });
      applySetting(saved);
    },
    [activePersona?.id, allPersonas, applySetting, customPersonas, service],
  );

  const createCustomPersona = useCallback(
    async (persona: Omit<PersonaDefinition, "isBuiltin">) => {
      const newPersona: PersonaDefinition = { ...persona, isBuiltin: false };
      const updated = [...customPersonas, newPersona];
      const setting: PersonaSetting = {
        activePersonaId: activePersona?.id ?? DEFAULT_PERSONA.id,
        customPersonas: updated,
      };
      applySetting(await service.save(setting));
    },
    [activePersona?.id, applySetting, customPersonas, service],
  );

  const deleteCustomPersona = useCallback(
    async (personaId: string) => {
      const updated = customPersonas.filter(
        (persona) => persona.id !== personaId,
      );
      if (updated.length === customPersonas.length) return;
      const saved = await service.save({
        activePersonaId:
          activePersona?.id === personaId
            ? DEFAULT_PERSONA.id
            : (activePersona?.id ?? DEFAULT_PERSONA.id),
        customPersonas: updated,
      });
      applySetting(saved);
    },
    [activePersona?.id, applySetting, customPersonas, service],
  );

  const isRouteVisible = useCallback(
    (route: string) =>
      activePersona === null || activePersona.routes.includes(route),
    [activePersona],
  );

  const value = useMemo<PersonaContextValue>(
    () => ({
      activePersona,
      customPersonas,
      allPersonas,
      setActivePersona,
      createCustomPersona,
      deleteCustomPersona,
      isRouteVisible,
      isLoading,
    }),
    [
      activePersona,
      allPersonas,
      createCustomPersona,
      customPersonas,
      deleteCustomPersona,
      isLoading,
      isRouteVisible,
      setActivePersona,
    ],
  );

  return (
    <PersonaContext.Provider value={value}>{children}</PersonaContext.Provider>
  );
}

export function usePersona(): PersonaContextValue {
  const context = useContext(PersonaContext);
  if (context === null) {
    throw new Error("usePersona must be used within PersonaProvider");
  }
  return context;
}
