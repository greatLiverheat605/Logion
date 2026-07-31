/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProductSignalGrid, ProductSignalList } from "./product-ui";

afterEach(cleanup);

describe("product signal primitives", () => {
  it("renders actionable signals as an accessible list", () => {
    render(
      <ProductSignalList
        label="当前信号"
        items={[
          {
            description: "需要人工处理",
            id: "conflict",
            title: "1 项冲突",
            tone: "bad",
          },
          {
            description: "检查下一步",
            id: "blocked",
            title: "2 项受阻",
            tone: "warn",
          },
        ]}
      />,
    );

    const list = screen.getByRole("list", { name: "当前信号" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(
      within(list).getByText("1 项冲突").parentElement?.className,
    ).toContain("bad");
  });

  it("renders metric values without inventing a percentage", () => {
    render(
      <ProductSignalGrid
        label="真实指标"
        items={[
          { id: "tasks", label: "任务", value: 0 },
          { id: "reviews", label: "审查", value: 3 },
        ]}
      />,
    );

    const list = screen.getByRole("list", { name: "真实指标" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("0")).toBeTruthy();
    expect(within(list).queryByText("0%")).toBeNull();
  });
});
