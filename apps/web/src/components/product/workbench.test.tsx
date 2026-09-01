/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  InspectorSection,
  WorkbenchActionBar,
  WorkbenchContextBar,
  WorkbenchFrame,
  WorkbenchHeader,
} from "./workbench";

afterEach(cleanup);

describe("workbench primitives", () => {
  it("renders a named continuous work surface with stable regions", () => {
    render(
      <WorkbenchFrame
        context={
          <WorkbenchContextBar
            items={[
              { key: "workspace", label: "Workspace", value: "个人学习" },
              { key: "space", label: "Space", value: "私有空间" },
            ]}
          />
        }
        header={<WorkbenchHeader eyebrow="Today" title="今日执行" />}
        inspector={
          <InspectorSection title="上下文">验收与依赖</InspectorSection>
        }
        label="今日工作台"
        main={<p>下一行动</p>}
        master={<p>今日队列</p>}
      />,
    );

    expect(screen.getByRole("region", { name: "今日工作台" })).toBeTruthy();
    expect(screen.getByTestId("workbench-frame")).toBeTruthy();
    expect(
      screen.getByRole("complementary", { name: "对象列表" }),
    ).toBeTruthy();
    expect(screen.getByTestId("workbench-master")).toBeTruthy();
    expect(screen.getByRole("region", { name: "工作区" })).toBeTruthy();
    expect(screen.getByTestId("workbench-main")).toBeTruthy();
    expect(
      screen.getByRole("complementary", { name: "详情检查器" }),
    ).toBeTruthy();
    expect(screen.getByTestId("workbench-inspector")).toBeTruthy();
    expect(screen.getByTestId("workbench-master").tabIndex).toBe(0);
    expect(screen.getByTestId("workbench-main").tabIndex).toBe(0);
    expect(screen.getByTestId("workbench-inspector").tabIndex).toBe(0);
    expect(screen.getByText("个人学习")).toBeTruthy();
    expect(screen.getByLabelText("当前工作台上下文").tabIndex).toBe(0);
  });

  it("changes the compact pane without removing the desktop regions", () => {
    render(
      <WorkbenchFrame
        header={<WorkbenchHeader title="记录" />}
        inspector={<p>属性</p>}
        label="记录工作台"
        main={<p>编辑器</p>}
        master={<p>记录列表</p>}
      />,
    );

    const master = screen.getByRole("button", { name: "对象列表" });
    const main = screen.getByRole("button", { name: "工作区" });
    expect(main.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(master);
    expect(master.getAttribute("aria-pressed")).toBe("true");
    expect(main.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("编辑器")).toBeTruthy();
  });

  it("maps only known operational context in a stable order", () => {
    render(
      <WorkbenchContextBar
        context={{
          permission: { label: "可编辑", tone: "good" },
          space: { id: "space-1", name: "研究资料" },
          sync: { label: "2 项待同步", tone: "warn" },
          vault: { label: "已解锁", tone: "good" },
          workspace: { id: "workspace-1", name: "个人学习" },
        }}
      />,
    );

    expect(screen.getByText("个人学习")).toBeTruthy();
    expect(screen.getByText("研究资料")).toBeTruthy();
    expect(screen.queryByText("Persona")).toBeNull();
    expect(screen.getByText("2 项待同步").parentElement?.className).toContain(
      "tone-warn",
    );
  });

  it("provides one structural primary action slot", () => {
    const { container } = render(
      <WorkbenchActionBar
        label="记录操作"
        primary={<button type="button">新建记录</button>}
        secondary={
          <>
            <button type="button">导入</button>
            <button type="button">更多</button>
          </>
        }
      />,
    );

    expect(screen.getByRole("group", { name: "记录操作" })).toBeTruthy();
    expect(
      container.querySelectorAll('[data-workbench-primary="true"]'),
    ).toHaveLength(1);
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });
});
