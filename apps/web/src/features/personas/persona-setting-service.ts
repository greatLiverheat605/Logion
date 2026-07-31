import type { components } from "@logion/contracts";

import {
  ALL_ROUTES,
  REQUIRED_PERSONA_ROUTES,
  type PersonaDefinition,
  type PersonaId,
} from "./persona-definitions";
import {
  browserApiClient,
  type ApiClient,
  LogionApiError,
} from "@/lib/api/client";

type UserSettingListResponse = components["schemas"]["UserSettingListResponse"];

export interface PersonaSetting {
  activePersonaId: PersonaId;
  customPersonas: PersonaDefinition[];
}

const KEY = "persona";
const MAX_VALUE_LENGTH = 8192;
const CUSTOM_ID =
  /^custom-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROUTES = new Set<string>(ALL_ROUTES);
const REQUIRED_ROUTES = new Set<string>(REQUIRED_PERSONA_ROUTES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCustomPersona(value: unknown): value is PersonaDefinition {
  if (!isRecord(value)) return false;
  const routes = value.routes;
  return (
    typeof value.id === "string" &&
    CUSTOM_ID.test(value.id) &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    value.name.length <= 40 &&
    typeof value.icon === "string" &&
    value.icon.length > 0 &&
    value.icon.length <= 16 &&
    typeof value.description === "string" &&
    value.description.length <= 160 &&
    Array.isArray(routes) &&
    routes.length > 0 &&
    routes.every((route) => typeof route === "string" && ROUTES.has(route)) &&
    [...REQUIRED_ROUTES].every((route) => routes.includes(route)) &&
    new Set(routes).size === routes.length &&
    value.isBuiltin === false
  );
}

export function parsePersonaSetting(value: string): PersonaSetting {
  const parsed: unknown = JSON.parse(value);
  if (
    !isRecord(parsed) ||
    typeof parsed.activePersonaId !== "string" ||
    !Array.isArray(parsed.customPersonas) ||
    !parsed.customPersonas.every(isCustomPersona)
  ) {
    throw new Error("The stored persona setting is invalid.");
  }
  const customIds = new Set(parsed.customPersonas.map((persona) => persona.id));
  if (customIds.size !== parsed.customPersonas.length) {
    throw new Error("The stored persona setting contains duplicate personas.");
  }
  return {
    activePersonaId: parsed.activePersonaId as PersonaId,
    customPersonas: parsed.customPersonas,
  };
}

export class PersonaSettingService {
  private current: PersonaSetting | null = null;
  private version = 0;

  constructor(private readonly api: ApiClient = browserApiClient) {}

  async load(): Promise<PersonaSetting | null> {
    const response = await this.api.request<UserSettingListResponse>(
      "/api/v1/users/me/settings",
      { query: { key: KEY } },
    );
    const setting = response.settings.find((item) => item.key === KEY);
    if (!setting) {
      this.current = null;
      this.version = 0;
      return null;
    }
    const parsed = parsePersonaSetting(setting.value);
    this.current = parsed;
    this.version = setting.version;
    return parsed;
  }

  async save(setting: PersonaSetting): Promise<PersonaSetting> {
    const base = this.current;
    try {
      await this.write(setting);
      this.current = setting;
      return setting;
    } catch (error) {
      if (!(error instanceof LogionApiError) || error.status !== 409) {
        throw error;
      }
    }

    const latest = await this.load();
    const desiredIds = new Set(
      setting.customPersonas.map((persona) => persona.id),
    );
    const locallyDeletedIds = new Set(
      (base?.customPersonas ?? [])
        .filter((persona) => !desiredIds.has(persona.id))
        .map((persona) => persona.id),
    );
    const mergedById = new Map(
      (latest?.customPersonas ?? [])
        .filter((persona) => !locallyDeletedIds.has(persona.id))
        .map((persona) => [persona.id, persona]),
    );
    for (const persona of setting.customPersonas) {
      mergedById.set(persona.id, persona);
    }
    const merged: PersonaSetting = {
      activePersonaId: setting.activePersonaId,
      customPersonas: [...mergedById.values()],
    };
    await this.write(merged);
    this.current = merged;
    return merged;
  }

  private async write(setting: PersonaSetting): Promise<void> {
    const value = JSON.stringify(setting);
    parsePersonaSetting(value);
    if (value.length > MAX_VALUE_LENGTH) {
      throw new Error("The persona setting exceeds the storage limit.");
    }
    const response = await this.api.request<UserSettingListResponse>(
      "/api/v1/users/me/settings",
      {
        body: JSON.stringify({
          settings: [{ key: KEY, value, version: this.version }],
        }),
        csrf: true,
        method: "PUT",
      },
    );
    const saved = response.settings.find((item) => item.key === KEY);
    if (!saved) throw new Error("The persona setting response is invalid.");
    this.version = saved.version;
  }
}

export const personaSettingService = new PersonaSettingService();
