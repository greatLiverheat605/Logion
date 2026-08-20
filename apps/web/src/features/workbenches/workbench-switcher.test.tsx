/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BUILTIN_PERSONAS,
  type PersonaDefinition,
} from "@/features/personas/persona-definitions";

const mocks = vi.hoisted(() => ({
  closeInspector: vi.fn(),
  persona: {} as Record<string, unknown>,
  push: vi.fn(),
  setActivePersona: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/features/desk/command-feedback-context", () => ({
  useInspector: () => ({ closeInspector: mocks.closeInspector }),
}));

vi.mock("@/features/personas/persona-context", () => ({
  usePersona: () => mocks.persona,
}));

import { WorkbenchSwitcher } from "./workbench-switcher";

const learningPersona = BUILTIN_PERSONAS.find(
  (persona) => persona.id === "self",
)!;

function legacyPersona(
  routes: string[] = ["/app/today", "/app/research"],
): PersonaDefinition {
  return {
    description: "沿用现有路由的兼容工作台",
    icon: "C",
    id: "custom-existing",
    isBuiltin: false,
    name: "兼容工作台",
    routes,
  };
}

function usePersonaState(
  overrides: Partial<{
    activePersona: PersonaDefinition | null;
    allPersonas: readonly PersonaDefinition[];
    isLoading: boolean;
  }> = {},
) {
  Object.assign(mocks.persona, {
    activePersona: learningPersona,
    allPersonas: [...BUILTIN_PERSONAS, legacyPersona()],
    isLoading: false,
    setActivePersona: mocks.setActivePersona,
    ...overrides,
  });
}

function useMobileViewport(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      addEventListener: vi.fn(),
      matches,
      media: "(max-width: 45rem)",
      removeEventListener: vi.fn(),
    })),
  });
}

beforeEach(() => {
  mocks.closeInspector.mockReset();
  mocks.push.mockReset();
  mocks.setActivePersona.mockReset().mockResolvedValue(undefined);
  useMobileViewport(false);
  usePersonaState();
});

afterEach(cleanup);

describe("WorkbenchSwitcher", () => {
  it.each([
    ["学习", "self", "/app/self-study"],
    ["研究", "research", "/app/research"],
    ["考试", "exam", "/app/exam"],
    ["导师", "mentor", "/app/collaboration"],
    ["兼容工作台", "custom-existing", "/app/research"],
  ])(
    "switches %s through the existing Persona and projected route",
    async (name, id, path) => {
      render(<WorkbenchSwitcher />);

      fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));

      await waitFor(() =>
        expect(mocks.setActivePersona).toHaveBeenCalledWith(id),
      );
      expect(mocks.closeInspector).toHaveBeenCalledTimes(1);
      expect(mocks.push).toHaveBeenCalledWith(path);
    },
  );

  it("fails closed to Today when the existing Persona save fails", async () => {
    mocks.setActivePersona.mockRejectedValueOnce(new Error("save failed"));
    render(<WorkbenchSwitcher />);

    fireEvent.click(screen.getByRole("button", { name: /研究/ }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "工作台切换失败，已返回 Today。",
    );
    expect(mocks.push).toHaveBeenCalledWith("/app/today");
  });

  it("does not navigate a legacy Persona without a projected entry", () => {
    usePersonaState({
      allPersonas: [
        ...BUILTIN_PERSONAS,
        legacyPersona(["/app/today", "/app/settings"]),
      ],
    });
    render(<WorkbenchSwitcher />);

    const option = screen.getByRole("button", {
      name: /兼容工作台.*暂无入口/,
    });
    expect((option as HTMLButtonElement).disabled).toBe(true);
    expect(option.textContent).toContain("暂无入口");
    fireEvent.click(option);
    expect(mocks.setActivePersona).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it.each([
    [true, null, "工作台加载中"],
    [false, null, "当前工作台不可用"],
  ])(
    "falls back to Today for loading/null Persona",
    (isLoading, activePersona, copy) => {
      usePersonaState({ activePersona, isLoading });
      render(<WorkbenchSwitcher />);

      expect(screen.getByText(copy)).toBeTruthy();
      expect(
        screen.getByRole("link", { name: "返回 Today" }).getAttribute("href"),
      ).toBe("/app/today");
    },
  );

  it("uses native button-group semantics with visible selected state", () => {
    render(<WorkbenchSwitcher />);

    expect(screen.getByRole("group", { name: "选择工作台" })).toBeTruthy();
    const learning = screen.getByRole("button", { name: /学习.*当前/ });
    const research = screen.getByRole("button", { name: /研究.*打开/ });
    expect(learning.getAttribute("aria-pressed")).toBe("true");
    expect(research.getAttribute("aria-pressed")).toBe("false");

    research.focus();
    fireEvent.click(research);
    expect(document.activeElement).toBe(research);
    expect(mocks.setActivePersona).toHaveBeenCalledWith("research");
  });

  it.each([390, 320])(
    "uses the existing modal Sheet contract at %ipx",
    async (width) => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: width,
      });
      useMobileViewport(true);
      render(<WorkbenchSwitcher />);

      const trigger = screen.getByRole("button", { name: "切换工作台" });
      fireEvent.click(trigger);
      const dialog = screen.getByRole("dialog", { name: "选择工作台" });
      expect(screen.getByRole("button", { name: /导师.*打开/ })).toBeTruthy();

      fireEvent.keyDown(dialog, { key: "Escape" });
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "选择工作台" })).toBeNull(),
      );
      expect(document.activeElement).toBe(trigger);
    },
  );
});
