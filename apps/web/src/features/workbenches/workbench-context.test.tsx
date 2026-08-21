/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PersonaProvider,
  usePersona,
} from "@/features/personas/persona-context";
import type { PersonaSetting } from "@/features/personas/persona-setting-service";
import {
  type ApiClient,
  type ApiRequestOptions,
  LogionApiError,
} from "@/lib/api/client";

import { WorkbenchProvider, useWorkbench } from "./workbench-context";
import { WorkbenchService } from "./workbench-service";

afterEach(cleanup);

const customPersona = {
  description: "考试冲刺",
  icon: "🎯",
  id: "custom-123e4567-e89b-42d3-a456-426614174000" as const,
  isBuiltin: false,
  name: "冲刺",
  routes: ["/app/today", "/app/exam", "/app/settings"],
};

function Consumer() {
  const persona = usePersona();
  const workbench = useWorkbench();
  return (
    <div>
      <output data-testid="phase">{workbench.phase}</output>
      <output data-testid="active">
        {workbench.activeWorkbench?.ref ?? "none"}
      </output>
      <output data-testid="persona">
        {persona.activePersona?.id ?? "none"}
      </output>
      <output data-testid="count">{workbench.definitions.length}</output>
      <button
        type="button"
        onClick={() =>
          void workbench.migrateLegacyPersonas().catch(() => undefined)
        }
      >
        migrate
      </button>
      <button
        type="button"
        onClick={() => void workbench.selectWorkbench("fixed.exam")}
      >
        choose exam
      </button>
      <button
        type="button"
        onClick={() => {
          const definition = workbench.definitions[0];
          if (definition) {
            void workbench
              .setWorkbenchLifecycle(definition, "archived")
              .catch(() => undefined);
          }
        }}
      >
        archive first
      </button>
    </div>
  );
}

function renderProviders(api: ApiClient, initial: PersonaSetting) {
  const personaService = {
    load: vi.fn().mockResolvedValue(initial),
    save: vi
      .fn<(setting: PersonaSetting) => Promise<PersonaSetting>>()
      .mockImplementation((setting) => Promise.resolve(setting)),
  };
  render(
    <PersonaProvider service={personaService}>
      <WorkbenchProvider service={new WorkbenchService(api)}>
        <Consumer />
      </WorkbenchProvider>
    </PersonaProvider>,
  );
  return personaService;
}

describe("WorkbenchProvider", () => {
  it("falls back to legacy Persona without writing when the API flag is off", async () => {
    const api: ApiClient = {
      request: vi.fn(() =>
        Promise.reject(
          new LogionApiError({
            code: "RESOURCE_NOT_FOUND",
            message: "not found",
            status: 404,
          }),
        ),
      ) as ApiClient["request"],
    };
    const personaService = renderProviders(api, {
      activePersonaId: "exam",
      customPersonas: [],
    });

    await waitFor(() =>
      expect(screen.getByTestId("phase").textContent).toBe("legacy"),
    );
    expect(screen.getByTestId("active").textContent).toBe("exam");
    expect(personaService.save).not.toHaveBeenCalled();
  });

  it("migrates custom Personas idempotently and preserves the old setting", async () => {
    let preferenceVersion = 0;
    let createdDefinition: Record<string, unknown> | null = null;
    const calls: Array<{ path: string; options?: ApiRequestOptions }> = [];
    const api: ApiClient = {
      request: vi.fn((path: string, options?: ApiRequestOptions) => {
        calls.push({ path, options });
        if (path.endsWith("/settings") && options?.method === "PUT") {
          const write = JSON.parse(String(options.body)).settings[0];
          preferenceVersion += 1;
          return Promise.resolve({
            settings: [
              {
                key: write.key,
                value: write.value,
                version: preferenceVersion,
              },
            ],
          });
        }
        if (path.endsWith("/settings"))
          return Promise.resolve({ settings: [] });
        if (
          path === "/api/v1/users/me/workbenches" &&
          options?.method === "POST"
        ) {
          const document = JSON.parse(String(options.body)).document;
          createdDefinition = {
            accent: document.payload.accent,
            createdAt: "2026-08-20T00:00:00Z",
            description: document.payload.description,
            document,
            icon: document.payload.icon,
            id: "323e4567-e89b-42d3-a456-426614174000",
            lifecycle: "active",
            name: document.payload.name,
            ownerUserId: "423e4567-e89b-42d3-a456-426614174000",
            revision: 1,
            templateId: document.payload.templateId,
            updatedAt: "2026-08-20T00:00:00Z",
          };
          return Promise.resolve(createdDefinition);
        }
        if (
          path ===
          "/api/v1/users/me/workbenches/323e4567-e89b-42d3-a456-426614174000"
        ) {
          return Promise.resolve(createdDefinition);
        }
        return Promise.resolve({ items: [], nextCursor: null });
      }) as ApiClient["request"],
    };
    const personaService = renderProviders(api, {
      activePersonaId: customPersona.id,
      customPersonas: [customPersona],
    });

    await waitFor(() =>
      expect(screen.getByTestId("phase").textContent).toBe(
        "migration-required",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "migrate" }));

    await waitFor(() =>
      expect(screen.getByTestId("phase").textContent).toBe("ready"),
    );
    expect(screen.getByTestId("active").textContent).toBe(
      "323e4567-e89b-42d3-a456-426614174000",
    );
    expect(screen.getByTestId("persona").textContent).toBe("exam");
    expect(screen.getByTestId("count").textContent).toBe("1");
    expect(personaService.save).not.toHaveBeenCalled();
    const firstKey = String(
      new Headers(
        calls.find((call) => call.options?.method === "POST")?.options?.headers,
      ).get("Idempotency-Key"),
    );
    expect(firstKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    fireEvent.click(screen.getByRole("button", { name: "migrate" }));
    await waitFor(() => expect(preferenceVersion).toBe(2));
    expect(
      calls.filter(
        (call) =>
          call.path === "/api/v1/users/me/workbenches" &&
          call.options?.method === "POST",
      ),
    ).toHaveLength(1);
    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("rejects an over-capacity legacy migration before creating definitions", async () => {
    const personas = Array.from({ length: 21 }, (_, index) => ({
      ...customPersona,
      id: `custom-00000000-0000-4000-8000-${String(index).padStart(12, "0")}` as typeof customPersona.id,
      name: `Persona ${index}`,
    }));
    const api: ApiClient = {
      request: vi.fn((path: string) =>
        path.endsWith("/settings")
          ? Promise.resolve({ settings: [] })
          : Promise.resolve({ items: [], nextCursor: null }),
      ) as ApiClient["request"],
    };
    renderProviders(api, {
      activePersonaId: personas[0]!.id,
      customPersonas: personas,
    });

    await waitFor(() =>
      expect(screen.getByTestId("phase").textContent).toBe(
        "migration-required",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "migrate" }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      vi
        .mocked(api.request)
        .mock.calls.some(
          ([path, options]) =>
            path === "/api/v1/users/me/workbenches" &&
            options?.method === "POST",
        ),
    ).toBe(false);
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("uses Workbench preference as the only write path after migration", async () => {
    const original = {
      contract: "workbench.preference",
      schemaVersion: 1,
      revision: 1,
      payload: {
        activeWorkbenchId: "fixed.learning",
        defaultSpaceByWorkbench: {},
        defaultViewByWorkbench: {},
        density: "comfortable",
        hiddenFixedWorkbenchIds: [],
        workbenchOrder: ["fixed.learning", "fixed.exam"],
      },
    };
    const api: ApiClient = {
      request: vi.fn((path: string, options?: ApiRequestOptions) => {
        if (path.endsWith("/settings") && options?.method === "PUT") {
          const write = JSON.parse(String(options.body)).settings[0];
          return Promise.resolve({
            settings: [{ key: write.key, value: write.value, version: 2 }],
          });
        }
        if (path.endsWith("/settings")) {
          return Promise.resolve({
            settings: [
              {
                key: "workbench.preference",
                value: JSON.stringify(original),
                version: 1,
              },
            ],
          });
        }
        return Promise.resolve({ items: [], nextCursor: null });
      }) as ApiClient["request"],
    };
    const personaService = renderProviders(api, {
      activePersonaId: "self",
      customPersonas: [],
    });

    await waitFor(() =>
      expect(screen.getByTestId("phase").textContent).toBe("ready"),
    );
    fireEvent.click(screen.getByRole("button", { name: "choose exam" }));

    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe("fixed.exam"),
    );
    expect(screen.getByTestId("persona").textContent).toBe("exam");
    expect(personaService.save).not.toHaveBeenCalled();
  });

  it("keeps a hidden active fixed Workbench and compatibility Persona aligned", async () => {
    const original = {
      contract: "workbench.preference",
      schemaVersion: 1,
      revision: 1,
      payload: {
        activeWorkbenchId: "fixed.exam",
        defaultSpaceByWorkbench: {},
        defaultViewByWorkbench: {},
        density: "comfortable",
        hiddenFixedWorkbenchIds: ["fixed.exam"],
        workbenchOrder: ["fixed.learning", "fixed.exam"],
      },
    };
    const api: ApiClient = {
      request: vi.fn((path: string) =>
        path.endsWith("/settings")
          ? Promise.resolve({
              settings: [
                {
                  key: "workbench.preference",
                  value: JSON.stringify(original),
                  version: 1,
                },
              ],
            })
          : Promise.resolve({ items: [], nextCursor: null }),
      ) as ApiClient["request"],
    };
    const personaService = renderProviders(api, {
      activePersonaId: "exam",
      customPersonas: [],
    });

    await waitFor(() =>
      expect(screen.getByTestId("phase").textContent).toBe("ready"),
    );
    expect(screen.getByTestId("active").textContent).toBe("fixed.learning");
    expect(screen.getByTestId("persona").textContent).toBe("self");
    expect(personaService.save).not.toHaveBeenCalled();
  });

  it("falls back to learning and the self Persona after archiving the active custom Workbench", async () => {
    const customId = "123e4567-e89b-42d3-a456-426614174000";
    const summary = {
      accent: "cyan",
      createdAt: "2026-08-20T00:00:00Z",
      description: "Research",
      icon: "microscope",
      id: customId,
      lifecycle: "active",
      name: "Custom research",
      ownerUserId: "223e4567-e89b-42d3-a456-426614174000",
      revision: 1,
      templateId: "fixed.research",
      updatedAt: "2026-08-20T00:00:00Z",
    };
    const original = {
      contract: "workbench.preference",
      schemaVersion: 1,
      revision: 1,
      payload: {
        activeWorkbenchId: customId,
        defaultSpaceByWorkbench: {},
        defaultViewByWorkbench: {},
        density: "comfortable",
        hiddenFixedWorkbenchIds: [],
        workbenchOrder: ["fixed.learning", customId],
      },
    };
    let preferenceWrite: Record<string, unknown> | undefined;
    const api: ApiClient = {
      request: vi.fn((path: string, options?: ApiRequestOptions) => {
        if (path.endsWith("/archive")) {
          return Promise.resolve({
            ...summary,
            lifecycle: "archived",
            revision: 2,
          });
        }
        if (path.endsWith("/settings") && options?.method === "PUT") {
          const write = JSON.parse(String(options.body)).settings[0];
          preferenceWrite = JSON.parse(write.value);
          return Promise.resolve({
            settings: [{ key: write.key, value: write.value, version: 2 }],
          });
        }
        if (path.endsWith("/settings")) {
          return Promise.resolve({
            settings: [
              {
                key: "workbench.preference",
                value: JSON.stringify(original),
                version: 1,
              },
            ],
          });
        }
        return Promise.resolve({ items: [summary], nextCursor: null });
      }) as ApiClient["request"],
    };
    const personaService = renderProviders(api, {
      activePersonaId: "self",
      customPersonas: [],
    });

    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe(customId),
    );
    expect(screen.getByTestId("persona").textContent).toBe("research");
    fireEvent.click(screen.getByRole("button", { name: "archive first" }));

    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe("fixed.learning"),
    );
    expect(screen.getByTestId("persona").textContent).toBe("self");
    expect(preferenceWrite?.payload).toMatchObject({
      activeWorkbenchId: "fixed.learning",
    });
    expect(personaService.save).not.toHaveBeenCalled();
  });

  it("keeps the archive fallback aligned when preference persistence fails", async () => {
    const customId = "123e4567-e89b-42d3-a456-426614174000";
    const summary = {
      accent: "cyan",
      createdAt: "2026-08-20T00:00:00Z",
      description: "Research",
      icon: "microscope",
      id: customId,
      lifecycle: "active",
      name: "Custom research",
      ownerUserId: "223e4567-e89b-42d3-a456-426614174000",
      revision: 1,
      templateId: "fixed.research",
      updatedAt: "2026-08-20T00:00:00Z",
    };
    const original = {
      contract: "workbench.preference",
      schemaVersion: 1,
      revision: 1,
      payload: {
        activeWorkbenchId: customId,
        defaultSpaceByWorkbench: {},
        defaultViewByWorkbench: {},
        density: "comfortable",
        hiddenFixedWorkbenchIds: [],
        workbenchOrder: ["fixed.learning", customId],
      },
    };
    const api: ApiClient = {
      request: vi.fn((path: string, options?: ApiRequestOptions) => {
        if (path.endsWith("/archive")) {
          return Promise.resolve({
            ...summary,
            lifecycle: "archived",
            revision: 2,
          });
        }
        if (path.endsWith("/settings") && options?.method === "PUT") {
          return Promise.reject(new Error("preference write failed"));
        }
        if (path.endsWith("/settings")) {
          return Promise.resolve({
            settings: [
              {
                key: "workbench.preference",
                value: JSON.stringify(original),
                version: 1,
              },
            ],
          });
        }
        return Promise.resolve({ items: [summary], nextCursor: null });
      }) as ApiClient["request"],
    };
    renderProviders(api, { activePersonaId: "self", customPersonas: [] });

    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe(customId),
    );
    fireEvent.click(screen.getByRole("button", { name: "archive first" }));

    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe("fixed.learning"),
    );
    expect(screen.getByTestId("persona").textContent).toBe("self");
  });
});
