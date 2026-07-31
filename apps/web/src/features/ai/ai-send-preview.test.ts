import { describe, expect, it } from "vitest";

import {
  describeAISendScope,
  describeCostBudget,
  describeTokenBudget,
} from "./ai-send-preview";

const preview = {
  candidates: [
    {
      estimated_cost_minor: 24,
      estimated_tokens: 1200,
      model_id: "00000000-0000-4000-8000-000000000002",
      position: 0,
      provider_id: "00000000-0000-4000-8000-000000000001",
      selection: "primary" as const,
      currency: "USD",
    },
  ],
  currency: "USD",
  monthly_cost_budget_minor: 500,
  monthly_token_budget: 20_000,
  route_id: "00000000-0000-4000-8000-000000000003",
  task_type: "research.summary",
};

describe("AI send preview", () => {
  it("describes the exact field and target scope without exposing its value", () => {
    expect(
      describeAISendScope({
        fieldName: "source_excerpt",
        targetId: "paper-7",
        targetType: "paper",
        valueLength: 318,
      }),
    ).toBe("source_excerpt · 318 字符 · paper/paper-7");
  });

  it("states estimated usage and configured monthly limits", () => {
    expect(describeTokenBudget(preview)).toBe(
      "本次预计 1200 Token · 月度上限 20000",
    );
    expect(describeCostBudget(preview)).toBe(
      "本次预计 24 USD 最小货币单位 · 月度上限 500",
    );
  });

  it("does not invent a budget when no monthly limit is configured", () => {
    expect(
      describeTokenBudget({ ...preview, monthly_token_budget: null }),
    ).toContain("未设置月度 Token 上限");
    expect(
      describeCostBudget({ ...preview, monthly_cost_budget_minor: null }),
    ).toContain("未设置月度费用上限");
  });
});
