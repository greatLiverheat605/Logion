// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ResearchEvidenceRelations } from "./research-experiment-comparison";

describe("ResearchEvidenceRelations", () => {
  it("renders only supplied projected relationships and opens their inspectors", () => {
    const onSelect = vi.fn();
    render(
      <ResearchEvidenceRelations
        onSelect={onSelect}
        relationships={[
          {
            id: "claim-1",
            kind: "research_claim",
            label: "有效声明",
            relation: "来源 → 声明",
            status: "待验证",
          },
          {
            id: "metric-1",
            kind: "metric_record",
            label: "accuracy: 80 %",
            relation: "实验运行 → 指标输出",
            status: "已记录数值",
          },
        ]}
      />,
    );

    expect(screen.getByText("有效声明")).toBeTruthy();
    expect(screen.getByText("accuracy: 80 %")).toBeTruthy();
    expect(screen.queryByText("孤立记录")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "查看来源 → 声明详情" }),
    );
    expect(onSelect).toHaveBeenCalledWith("research_claim", "claim-1");
  });
});
