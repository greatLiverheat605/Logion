import { useSyncExternalStore } from "react";
import { PRESETS } from "./preferences";
import { WORKBENCH_ROUTES } from "./routes";

const subscribeToPlatform = () => () => {};
export function useModifierKey() {
  return useSyncExternalStore(
    subscribeToPlatform,
    () => (/Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "⌘" : "Ctrl"),
    () => "Ctrl",
  );
}

export interface Shortcut {
  code: string;
  mod?: boolean;
  alt?: boolean;
  shift?: boolean;
}
export interface Command {
  id: string;
  label: string;
  group: string;
  shortcut?: Shortcut;
  hint?: string;
  action: () => void;
}
export function validateCommands(commands: readonly Command[]): void {
  const ids = new Set<string>(),
    shortcuts = new Set<string>();
  for (const command of commands) {
    if (ids.has(command.id)) throw new Error("Duplicate command ID");
    ids.add(command.id);
    const s = command.shortcut;
    if (!s) continue;
    // An allowlist avoids taking browser or OS navigation shortcuts.
    const allowed = s.mod
      ? !s.alt && !s.shift && ["KeyK", "Backslash"].includes(s.code)
      : s.alt
        ? /^Digit[1-4]$/.test(s.code) && (s.shift || s.code !== "Digit4")
        : s.code === "Slash" && s.shift;
    if (!allowed) throw new Error("Reserved or unsupported shortcut");
    const key = JSON.stringify([s.code, !!s.mod, !!s.alt, !!s.shift]);
    if (shortcuts.has(key)) throw new Error("Shortcut conflict");
    shortcuts.add(key);
  }
}
export function matchesShortcut(
  event: KeyboardEvent,
  shortcut: Shortcut,
): boolean {
  return (
    !event.isComposing &&
    !event.repeat &&
    event.code === shortcut.code &&
    (event.ctrlKey || event.metaKey) === !!shortcut.mod &&
    !(event.ctrlKey && event.metaKey) &&
    event.altKey === !!shortcut.alt &&
    event.shiftKey === !!shortcut.shift
  );
}
export function isEditing(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest(
      "input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=dialog]",
    )
  );
}
export function createCommands(
  actions: {
    navigate: (path: string) => void;
    theme: (value: "light" | "dark" | "system") => void;
    preset: (id: string) => void;
    pane: (index: number) => void;
    palette: () => void;
    toolbars: () => void;
    help: () => void;
  },
  { toolbarsVisible = false, modifier = "Ctrl" } = {},
): Command[] {
  const commands: Command[] = [
    {
      id: "palette",
      label: "打开指令面板",
      group: "工具",
      shortcut: { mod: true, code: "KeyK" },
      hint: `${modifier}+K`,
      action: actions.palette,
    },
    {
      id: "toolbars",
      label: toolbarsVisible ? "隐藏全部工具栏" : "显示全部工具栏",
      group: "工具",
      shortcut: { mod: true, code: "Backslash" },
      hint: `${modifier}+\\`,
      action: actions.toolbars,
    },
    {
      id: "help",
      label: "快捷键帮助",
      group: "工具",
      shortcut: { code: "Slash", shift: true },
      hint: "?",
      action: actions.help,
    },
    ...WORKBENCH_ROUTES.map((route) => ({
      id: `go:${route.path}`,
      label: `前往${route.label}`,
      group: "跳转",
      action: () => actions.navigate(route.path),
    })),
    ...(["light", "dark", "system"] as const).map((theme) => ({
      id: `theme:${theme}`,
      label: { light: "日间外观", dark: "夜间外观", system: "跟随系统外观" }[
        theme
      ],
      group: "外观",
      action: () => actions.theme(theme),
    })),
    ...PRESETS.map((preset, i) => ({
      id: `preset:${preset.id}`,
      label: `${preset.label}布局`,
      group: "布局",
      shortcut: { alt: true, shift: true, code: `Digit${i + 1}` },
      hint: `Alt Shift ${i + 1}`,
      action: () => actions.preset(preset.id),
    })),
    ...["左", "中", "右"].map((label, i) => ({
      id: `pane:${i}`,
      label: `折叠或展开${label}栏`,
      group: "布局",
      shortcut: { alt: true, code: `Digit${i + 1}` },
      hint: `Alt ${i + 1}`,
      action: () => actions.pane(i),
    })),
  ];
  validateCommands(commands);
  return commands;
}
