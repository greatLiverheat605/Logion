/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PersonaProvider, usePersona } from "../persona-context";
import type { PersonaSetting } from "../persona-setting-service";

afterEach(cleanup);

const customPersona = {
  id: "custom-123e4567-e89b-42d3-a456-426614174000" as const,
  name: "混合",
  icon: "🎯",
  description: "自学与考试",
  routes: ["/app/today", "/app/exam", "/app/settings"],
  isBuiltin: false,
};

function Consumer() {
  const persona = usePersona();
  return (
    <div>
      <output data-testid="active">
        {persona.activePersona?.id ?? "loading"}
      </output>
      <output data-testid="custom-count">
        {persona.customPersonas.length}
      </output>
      <output data-testid="exam-visible">
        {String(persona.isRouteVisible("/app/exam"))}
      </output>
      <button
        type="button"
        onClick={() => void persona.setActivePersona("exam")}
      >
        choose exam
      </button>
      <button
        type="button"
        onClick={() => void persona.setActivePersona("self")}
      >
        choose self
      </button>
      <button
        type="button"
        onClick={() =>
          void persona.createCustomPersona({
            id: customPersona.id,
            name: customPersona.name,
            icon: customPersona.icon,
            description: customPersona.description,
            routes: customPersona.routes,
          })
        }
      >
        create custom
      </button>
      <button
        type="button"
        onClick={() => void persona.setActivePersona(customPersona.id)}
      >
        choose custom
      </button>
      <button
        type="button"
        onClick={() => void persona.deleteCustomPersona(customPersona.id)}
      >
        delete custom
      </button>
    </div>
  );
}

function renderProvider(initial: PersonaSetting | null) {
  const service = {
    load: vi.fn().mockResolvedValue(initial),
    save: vi
      .fn<(setting: PersonaSetting) => Promise<PersonaSetting>>()
      .mockImplementation((setting) => Promise.resolve(setting)),
  };
  render(
    <PersonaProvider service={service}>
      <Consumer />
    </PersonaProvider>,
  );
  return service;
}

describe("PersonaProvider", () => {
  it("uses the self persona for a first-time user", async () => {
    renderProvider(null);
    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe("self"),
    );
    expect(screen.getByTestId("exam-visible").textContent).toBe("false");
  });

  it("persists and exposes a newly selected persona", async () => {
    const service = renderProvider(null);
    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe("self"),
    );
    fireEvent.click(screen.getByRole("button", { name: "choose exam" }));

    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe("exam"),
    );
    expect(screen.getByTestId("exam-visible").textContent).toBe("true");
    expect(service.save).toHaveBeenCalledWith({
      activePersonaId: "exam",
      customPersonas: [],
    });
    expect(service.load).toHaveBeenCalledTimes(1);
    expect(service.save).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "choose exam" }));
    await waitFor(() => expect(service.save).toHaveBeenCalledTimes(1));
  });

  it("persists the default persona when no setting exists yet", async () => {
    const service = renderProvider(null);
    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe("self"),
    );

    fireEvent.click(screen.getByRole("button", { name: "choose self" }));

    await waitFor(() => expect(service.save).toHaveBeenCalledTimes(1));
    expect(service.save).toHaveBeenCalledWith({
      activePersonaId: "self",
      customPersonas: [],
    });

    fireEvent.click(screen.getByRole("button", { name: "choose self" }));
    await waitFor(() => expect(service.save).toHaveBeenCalledTimes(1));
  });

  it("creates a custom persona and persists the expanded list", async () => {
    const service = renderProvider(null);
    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe("self"),
    );
    fireEvent.click(screen.getByRole("button", { name: "create custom" }));

    await waitFor(() =>
      expect(screen.getByTestId("custom-count").textContent).toBe("1"),
    );
    expect(service.save).toHaveBeenLastCalledWith({
      activePersonaId: "self",
      customPersonas: [customPersona],
    });
  });

  it("falls back to self when deleting the active custom persona", async () => {
    const service = renderProvider({
      activePersonaId: customPersona.id,
      customPersonas: [customPersona],
    });
    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe(customPersona.id),
    );
    fireEvent.click(screen.getByRole("button", { name: "delete custom" }));

    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe("self"),
    );
    expect(screen.getByTestId("custom-count").textContent).toBe("0");
    expect(service.save).toHaveBeenLastCalledWith({
      activePersonaId: "self",
      customPersonas: [],
    });
  });
});
