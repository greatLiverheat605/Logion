import { describe, expect, it, vi } from "vitest";
import { createCommands, matchesShortcut, validateCommands } from "./commands";
import {
  createWorkbenchQueryClient,
  errorMessage,
  workbenchRequest,
} from "./api";
import {
  DEFAULT_PREFERENCES,
  parsePreference,
  presetLayout,
  initialMobilePane,
  togglePane,
} from "./preferences";
import { LogionApiError } from "@/lib/api/client";

const actions = () => ({
  navigate: vi.fn(),
  theme: vi.fn(),
  preset: vi.fn(),
  pane: vi.fn(),
  palette: vi.fn(),
  toolbars: vi.fn(),
  help: vi.fn(),
});
describe("workbench command contract", () => {
  it("limits single-letter reading commands to PDF selections and explains AI failures", () => {
    const commands = createCommands({ ...actions(), reader: vi.fn() });
    const selection = commands.filter((command) => command.selectionOnly);
    expect(selection.map((command) => command.shortcut?.code)).toEqual([
      "KeyT",
      "KeyE",
      "KeyH",
      "KeyQ",
      "KeyC",
    ]);
    for (const [code, message] of [
      ["AI_BUDGET_EXCEEDED", "预算不足"],
      ["AI_PRIVATE_CONTENT_BLOCKED", "拦截"],
      ["AI_PROVIDER_UNAVAILABLE", "不可用"],
    ]) {
      expect(
        errorMessage(
          new LogionApiError({
            code: code!,
            message: "Synthetic failure",
            status: 503,
          }),
        ),
      ).toContain(message);
    }
  });
  it("registers navigation, appearance, presets and pane actions in one registry", () => {
    const handlers = actions(),
      commands = createCommands(handlers);
    expect(commands).toHaveLength(22);
    commands.find((command) => command.id === "go:/search")?.action();
    expect(handlers.navigate).toHaveBeenCalledWith("/search");
    commands.find((command) => command.id === "go:/records")?.action();
    expect(handlers.navigate).toHaveBeenCalledWith("/records");
    commands.find((c) => c.id === "go:/library")?.action();
    commands.find((c) => c.id === "theme:dark")?.action();
    commands.find((c) => c.id === "preset:focus")?.action();
    expect(handlers.navigate).toHaveBeenCalledWith("/library");
    expect(handlers.theme).toHaveBeenCalledWith("dark");
    expect(handlers.preset).toHaveBeenCalledWith("focus");
  });
  it("rejects duplicate IDs, conflicting shortcuts and browser-reserved combinations", () => {
    const command = {
      id: "a",
      label: "A",
      group: "test",
      action: vi.fn(),
      shortcut: { mod: true, code: "KeyK" },
    };
    expect(() => validateCommands([command, command])).toThrow("Duplicate");
    expect(() => validateCommands([command, { ...command, id: "b" }])).toThrow(
      "conflict",
    );
    for (const shortcut of [
      { mod: true, shift: true, code: "KeyT" },
      { mod: true, code: "Digit1" },
    ]) {
      expect(() => validateCommands([{ ...command, shortcut }])).toThrow(
        "Reserved",
      );
    }
  });
  it("matches physical Alt+Shift digits on macOS and ignores IME/repeat/modifier conflicts", () => {
    const shortcut = { alt: true, shift: true, code: "Digit1" };
    const event = {
      code: "Digit1",
      altKey: true,
      shiftKey: true,
      ctrlKey: false,
      metaKey: false,
      repeat: false,
      isComposing: false,
    } as KeyboardEvent;
    expect(matchesShortcut(event, shortcut)).toBe(true);
    expect(matchesShortcut({ ...event, isComposing: true }, shortcut)).toBe(
      false,
    );
    expect(matchesShortcut({ ...event, repeat: true }, shortcut)).toBe(false);
    expect(matchesShortcut({ ...event, ctrlKey: true }, shortcut)).toBe(false);
  });
});
it("retains at least one pane and validates persisted layout", () => {
  const legacy = {
    ...presetLayout("reading"),
    panes: [
      { content: "info", width: 22, collapsed: false },
      { content: "document", width: 50, collapsed: false },
      { content: "translation", width: 28, collapsed: false },
    ],
  };
  expect(parsePreference("workbench.layouts", JSON.stringify(legacy))).toEqual(
    legacy,
  );
  expect(presetLayout("reading").panes.map((pane) => pane.content)).toEqual([
    "outline",
    "pdf",
    "note",
  ]);
  const quiz = presetLayout("quiz");
  expect(quiz.panes.map((pane) => pane.content)).toEqual([
    "pdf",
    "quiz",
    "graphlocal",
  ]);
  expect(initialMobilePane(quiz)).toBe(1);
  const savedQuiz = {
    ...quiz,
    panes: [
      { content: "info", width: 20, collapsed: true },
      { content: "pdf", width: 40, collapsed: false },
      { content: "quiz", width: 40, collapsed: false },
    ],
  };
  const restored = parsePreference(
    "workbench.layouts",
    JSON.stringify(savedQuiz),
  );
  expect(restored).toEqual(savedQuiz);
  expect(initialMobilePane(restored)).toBe(2);
  const focus = presetLayout("focus");
  expect(togglePane(focus, 1)).toBe(focus);
  expect(togglePane(focus, 0).panes[0].collapsed).toBe(false);
  const invalid = {
    ...focus,
    panes: focus.panes.map((pane) => ({ ...pane, collapsed: true })),
  };
  expect(parsePreference("workbench.layouts", JSON.stringify(invalid))).toEqual(
    DEFAULT_PREFERENCES["workbench.layouts"],
  );
  expect(parsePreference("appearance.theme", '"dark"')).toBe("dark");
  expect(parsePreference("appearance.theme", '"wrong"')).toBe("system");
});
it("coalesces simultaneous reads of the same resource", async () => {
  const client = createWorkbenchQueryClient();
  let resolve!: (value: string[]) => void;
  const queryFn = vi.fn(
    () =>
      new Promise<string[]>((done) => {
        resolve = done;
      }),
  );
  const first = client.fetchQuery({ queryKey: ["resource", "one"], queryFn });
  const second = client.fetchQuery({ queryKey: ["resource", "one"], queryFn });
  resolve(["one"]);
  expect(await first).toEqual(["one"]);
  expect(await second).toEqual(["one"]);
  expect(queryFn).toHaveBeenCalledTimes(1);
  client.clear();
});
it("refuses offline writes immediately without fetching or queuing", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  try {
    await expect(
      workbenchRequest("/api/v1/users/me/settings", {
        method: "PUT",
        body: "{}",
      }),
    ).rejects.toMatchObject({ code: "WEB_NETWORK_UNAVAILABLE" });
    expect(fetch).not.toHaveBeenCalled();
    expect(
      errorMessage(
        new LogionApiError({
          code: "WEB_NETWORK_UNAVAILABLE",
          message: "",
          status: 0,
        }),
      ),
    ).toContain("需要联网");
    expect(
      createWorkbenchQueryClient().getDefaultOptions().mutations,
    ).toMatchObject({ retry: false, networkMode: "always" });
  } finally {
    vi.unstubAllGlobals();
  }
});

it("registers reader actions only in the reading scope and allows its find shortcut", () => {
  const reader = vi.fn();
  const commands = createCommands({ ...actions(), reader });
  commands.find((command) => command.id === "reader:white")!.action();
  expect(reader).toHaveBeenCalledWith("white");
  expect(
    commands.find((command) => command.id === "reader:find")!.shortcut,
  ).toEqual({ mod: true, code: "KeyF" });
  expect(
    createCommands(actions()).some((command) =>
      command.id.startsWith("reader:"),
    ),
  ).toBe(false);
});
