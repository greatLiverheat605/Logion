export type Theme = "light" | "dark" | "system";
export const CONTENTS = {
  info: "文献信息",
  document: "文献正文",
  translation: "翻译",
  quiz: "自测",
  pdf: "PDF 原文",
  outline: "大纲",
  thumbs: "缩略图",
  note: "精读笔记",
  excerpts: "摘录",
  chat: "AI 对话",
  translate: "翻译对照",
} as const;
export type PaneContent = keyof typeof CONTENTS;
export type PaneIndex = 0 | 1 | 2;
export interface Pane {
  content: PaneContent;
  width: number;
  collapsed: boolean;
}
export interface Layout {
  preset: string;
  panes: [Pane, Pane, Pane];
  toolbars: boolean;
}
export interface WorkbenchContext {
  workspace_id: string;
  space_id: string;
}
export interface Preferences {
  "appearance.theme": Theme;
  "workbench.context": WorkbenchContext | null;
  "workbench.layouts": Layout;
  "reader.selection_menu": boolean;
  "reader.hint_dismissed": boolean;
}
export const PRESETS = [
  {
    id: "reading",
    label: "精读",
    contents: ["info", "document", "translation"],
    widths: [22, 50, 28],
    visible: [true, true, true],
  },
  {
    id: "translation",
    label: "翻译",
    contents: ["info", "document", "translation"],
    widths: [20, 40, 40],
    visible: [false, true, true],
  },
  {
    id: "quiz",
    label: "自测",
    contents: ["info", "document", "quiz"],
    widths: [20, 40, 40],
    visible: [false, true, true],
  },
  {
    id: "focus",
    label: "专注",
    contents: ["info", "document", "translation"],
    widths: [20, 60, 20],
    visible: [false, true, false],
  },
] as const;
export function presetLayout(id: string): Layout {
  const preset = PRESETS.find((item) => item.id === id) ?? PRESETS[0];
  return {
    preset: preset.id,
    toolbars: false,
    panes: preset.contents.map((content, i) => ({
      content,
      width: preset.widths[i],
      collapsed: !preset.visible[i],
    })) as Layout["panes"],
  };
}
export function togglePane(layout: Layout, index: number): Layout {
  if (index !== 0 && index !== 1 && index !== 2) return layout;
  if (
    !layout.panes[index].collapsed &&
    layout.panes.filter((pane) => !pane.collapsed).length === 1
  )
    return layout;
  return {
    ...layout,
    preset: "custom",
    panes: layout.panes.map((pane, i) =>
      i === index ? { ...pane, collapsed: !pane.collapsed } : pane,
    ) as Layout["panes"],
  };
}
export const DEFAULT_PREFERENCES: Preferences = {
  "appearance.theme": "system",
  "workbench.context": null,
  "workbench.layouts": presetLayout("reading"),
  "reader.selection_menu": false,
  "reader.hint_dismissed": false,
};

// Persisted data is untrusted, including settings written by older clients.
export function parsePreference<K extends keyof Preferences>(
  key: K,
  raw: string,
): Preferences[K] {
  try {
    const value = JSON.parse(raw);
    if (
      key === "appearance.theme" &&
      ["light", "dark", "system"].includes(value)
    )
      return value;
    if (
      (key === "reader.selection_menu" || key === "reader.hint_dismissed") &&
      typeof value === "boolean"
    )
      return value as Preferences[K];
    if (
      key === "workbench.context" &&
      value &&
      typeof value.workspace_id === "string" &&
      typeof value.space_id === "string"
    )
      return value;
    if (
      key === "workbench.layouts" &&
      value &&
      typeof value.preset === "string" &&
      typeof value.toolbars === "boolean" &&
      Array.isArray(value.panes) &&
      value.panes.length === 3 &&
      value.panes.every(
        (p: Pane) =>
          p &&
          Object.hasOwn(CONTENTS, p.content) &&
          Number.isFinite(p.width) &&
          p.width >= 10 &&
          p.width <= 80 &&
          typeof p.collapsed === "boolean",
      ) &&
      value.panes.some((p: Pane) => !p.collapsed)
    )
      return value;
  } catch {
    /* Fall back without overwriting the server copy. */
  }
  return DEFAULT_PREFERENCES[key];
}
