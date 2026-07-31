// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  deriveProductWorkbenchState,
  ProductWorkbenchStateNotice,
} from "./product-workbench-state";

afterEach(cleanup);

describe("product workbench state", () => {
  it.each([
    [{ contextPhase: "loading" }, "loading"],
    [{ contextPhase: "error" }, "error"],
    [{ hasContext: false }, "needs-context"],
    [{ unlocked: false }, "locked"],
    [{ dataPhase: "error" }, "error"],
    [{ dataPhase: "loading" }, "loading"],
    [{ stale: true }, "offline-stale"],
    [{ hasData: false }, "empty"],
    [{}, "ready"],
  ] as const)("derives an explicit state", (override, expected) => {
    expect(
      deriveProductWorkbenchState({
        contextPhase: "ready",
        dataPhase: "ready",
        hasContext: true,
        hasData: true,
        stale: false,
        unlocked: true,
        ...override,
      }),
    ).toBe(expected);
  });

  it("labels offline data without presenting it as empty", () => {
    render(<ProductWorkbenchStateNotice state="offline-stale" />);
    expect(screen.getByText("正在使用本机数据")).toBeTruthy();
    expect(screen.queryByText("当前范围暂无数据")).toBeNull();
  });
});
