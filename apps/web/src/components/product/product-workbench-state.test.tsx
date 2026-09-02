// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deriveProductWorkbenchState,
  PRODUCT_OPERATIONAL_STATE_KINDS,
  ProductOperationalStateNotice,
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

  it.each(PRODUCT_OPERATIONAL_STATE_KINDS)(
    "renders %s with impact and an executable recovery",
    (kind) => {
      const recover = vi.fn();
      render(
        <ProductOperationalStateNotice
          state={{
            kind,
            recovery: {
              kind: "button",
              label: `恢复 ${kind}`,
              onInvoke: recover,
            },
          }}
        />,
      );

      const notice = screen.getByRole("region", { name: "工作台操作状态" });
      expect(notice.getAttribute("data-operational-state")).toBe(kind);
      expect(screen.getByText("影响")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: `恢复 ${kind}` }));
      expect(recover).toHaveBeenCalledOnce();
    },
  );

  it("supports a real recovery destination and request id", () => {
    render(
      <ProductOperationalStateNotice
        state={{
          kind: "error",
          recovery: {
            href: "/app/sync",
            kind: "link",
            label: "打开同步诊断",
          },
          requestId: "req-409",
        }}
      />,
    );

    expect(
      screen.getByRole("link", { name: "打开同步诊断" }).getAttribute("href"),
    ).toBe("/app/sync");
    expect(screen.getByText("Request ID: req-409")).toBeTruthy();
  });
});
