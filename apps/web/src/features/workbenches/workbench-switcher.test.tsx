/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const options = [
  {
    description: "学习项目",
    entryPath: "/app/self-study",
    icon: "📚",
    kind: "fixed",
    lifecycle: "active",
    name: "学习",
    ref: "fixed.learning",
    templateId: "fixed.learning",
  },
  {
    description: "研究证据",
    entryPath: "/app/research",
    icon: "🔬",
    kind: "fixed",
    lifecycle: "active",
    name: "研究",
    ref: "fixed.research",
    templateId: "fixed.research",
  },
  {
    description: "考试覆盖",
    entryPath: "/app/exam",
    icon: "📝",
    kind: "fixed",
    lifecycle: "active",
    name: "考试",
    ref: "fixed.exam",
    templateId: "fixed.exam",
  },
  {
    description: "导师审阅",
    entryPath: "/app/collaboration",
    icon: "🧭",
    kind: "fixed",
    lifecycle: "active",
    name: "导师",
    ref: "fixed.mentor",
    templateId: "fixed.mentor",
  },
  {
    description: "兼容入口",
    entryPath: "/app/research",
    icon: "C",
    kind: "legacy",
    lifecycle: "active",
    name: "兼容工作台",
    ref: "custom-existing",
    templateId: "blank",
  },
] as const;

const mocks = vi.hoisted(() => ({
  closeInspector: vi.fn(),
  push: vi.fn(),
  selectWorkbench: vi.fn(),
  workbench: {} as Record<string, unknown>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/features/desk/command-feedback-context", () => ({
  useInspector: () => ({ closeInspector: mocks.closeInspector }),
}));

vi.mock("./workbench-context", () => ({
  useWorkbench: () => mocks.workbench,
}));

import { WorkbenchSwitcher } from "./workbench-switcher";

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
  mocks.selectWorkbench.mockReset().mockImplementation((ref: string) => {
    const option = options.find((item) => item.ref === ref);
    return option
      ? Promise.resolve(option.entryPath)
      : Promise.reject(new Error("missing"));
  });
  Object.assign(mocks.workbench, {
    activeWorkbench: options[0],
    options,
    phase: "ready",
    selectWorkbench: mocks.selectWorkbench,
  });
  useMobileViewport(false);
});

afterEach(cleanup);

describe("WorkbenchSwitcher", () => {
  it.each([
    ["学习", "fixed.learning", "/app/self-study"],
    ["研究", "fixed.research", "/app/research"],
    ["考试", "fixed.exam", "/app/exam"],
    ["导师", "fixed.mentor", "/app/collaboration"],
    ["兼容工作台", "custom-existing", "/app/research"],
  ])(
    "switches %s through the active Workbench contract",
    async (name, ref, path) => {
      render(<WorkbenchSwitcher />);

      fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));

      await waitFor(() =>
        expect(mocks.selectWorkbench).toHaveBeenCalledWith(ref),
      );
      expect(mocks.closeInspector).toHaveBeenCalledTimes(1);
      expect(mocks.push).toHaveBeenCalledWith(path);
    },
  );

  it("fails closed to Today when preference persistence fails", async () => {
    mocks.selectWorkbench.mockRejectedValueOnce(new Error("save failed"));
    render(<WorkbenchSwitcher />);

    fireEvent.click(screen.getByRole("button", { name: /研究/ }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "工作台切换失败，已返回 Today。",
    );
    expect(mocks.push).toHaveBeenCalledWith("/app/today");
  });

  it("does not navigate an archived Workbench", () => {
    Object.assign(mocks.workbench, {
      options: [{ ...options[4], lifecycle: "archived" }],
      activeWorkbench: options[0],
    });
    render(<WorkbenchSwitcher />);

    const option = screen.getByRole("button", { name: /兼容工作台.*已归档/ });
    expect((option as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(option);
    expect(mocks.selectWorkbench).not.toHaveBeenCalled();
  });

  it.each([
    ["loading", null, "工作台加载中"],
    ["error", null, "当前工作台不可用"],
  ])("falls back to Today for %s state", (phase, activeWorkbench, copy) => {
    Object.assign(mocks.workbench, { activeWorkbench, phase });
    render(<WorkbenchSwitcher />);

    expect(screen.getByText(copy)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "返回 Today" }).getAttribute("href"),
    ).toBe("/app/today");
  });

  it("uses native button-group semantics with visible selected state", () => {
    render(<WorkbenchSwitcher />);

    expect(screen.getByRole("group", { name: "选择工作台" })).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /学习.*当前/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: /研究.*打开/ })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it.each([390, 320])(
    "uses the modal Sheet contract at %ipx",
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
