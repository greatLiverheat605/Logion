export const WORKBENCH_ROUTES = [
  { path: "/today", label: "今日", icon: "sun" },
  { path: "/library", label: "文献库", icon: "book" },
  { path: "/questions", label: "研究问题", icon: "question" },
  { path: "/graph", label: "知识网", icon: "graph" },
  { path: "/review", label: "复习", icon: "review" },
  { path: "/plan", label: "计划", icon: "plan" },
  { path: "/records", label: "记录", icon: "note" },
  { path: "/search", label: "搜索", icon: "search" },
  { path: "/settings", label: "设置", icon: "settings" },
] as const;

export function isWorkbenchPath(path: string): boolean {
  return /^(?:\/(?:today|library|questions|graph|review|plan|records|search|settings|legacy-data-check)(?:\/|$)|\/read(?:\/|$))/.test(
    path,
  );
}
