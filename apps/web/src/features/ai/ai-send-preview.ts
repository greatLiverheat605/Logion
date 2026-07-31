import type { components } from "@logion/contracts";

type Preview = components["schemas"]["AIRouteResolveResponse"];

export type AISendScope = Readonly<{
  fieldName: string;
  targetId: string;
  targetType: string;
  valueLength: number;
}>;

export function describeAISendScope(scope: AISendScope) {
  return `${scope.fieldName} · ${scope.valueLength} 字符 · ${scope.targetType}/${scope.targetId}`;
}

export function describeTokenBudget(preview: Preview) {
  const estimated = preview.candidates[0]?.estimated_tokens;
  if (estimated === undefined) return "没有可用路由候选";
  return preview.monthly_token_budget === null
    ? `本次预计 ${estimated} Token · 未设置月度 Token 上限`
    : `本次预计 ${estimated} Token · 月度上限 ${preview.monthly_token_budget}`;
}

export function describeCostBudget(preview: Preview) {
  const estimated = preview.candidates[0]?.estimated_cost_minor;
  if (estimated === undefined) return "无法估算费用";
  const estimatedText = `${estimated} ${preview.currency} 最小货币单位`;
  return preview.monthly_cost_budget_minor === null
    ? `本次预计 ${estimatedText} · 未设置月度费用上限`
    : `本次预计 ${estimatedText} · 月度上限 ${preview.monthly_cost_budget_minor}`;
}
