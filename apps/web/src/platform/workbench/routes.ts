export const WORKBENCH_ROUTES = [
  { path: "/today", label: "今天", icon: "sun" },
  { path: "/library", label: "文献库", icon: "book" },
  { path: "/questions", label: "问题", icon: "question" },
  { path: "/graph", label: "知识图谱", icon: "graph" },
  { path: "/review", label: "复习", icon: "review" },
  { path: "/plan", label: "计划", icon: "plan" },
  { path: "/settings", label: "设置", icon: "settings" },
] as const;

export function isWorkbenchPath(path: string): boolean {
  return /^(?:\/(?:today|library|questions|graph|review|plan|settings)(?:\/|$)|\/read(?:\/|$))/.test(
    path,
  );
}
