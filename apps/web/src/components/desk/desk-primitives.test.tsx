/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DeskButton,
  DeskField,
  DeskIconButton,
  DeskInput,
  DeskSegmentedControl,
  DeskTabs,
  DeskToggle,
} from "@/components/desk/desk-primitives";

afterEach(cleanup);

describe("DeskButton", () => {
  it("renders children and triggers onClick", () => {
    const onClick = vi.fn();
    render(<DeskButton onClick={onClick}>保存</DeskButton>);
    fireEvent.click(screen.getByText("保存"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("disables and sets aria-busy when loading", () => {
    render(<DeskButton loading>保存</DeskButton>);
    const button = screen
      .getByText("保存")
      .closest("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("does not call onClick when disabled", () => {
    const onClick = vi.fn();
    render(
      <DeskButton disabled onClick={onClick}>
        保存
      </DeskButton>,
    );
    fireEvent.click(screen.getByText("保存"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("applies tone-secondary class", () => {
    render(<DeskButton tone="secondary">取消</DeskButton>);
    expect(
      (screen.getByText("取消").closest("button") as HTMLElement).className,
    ).toContain("tone-secondary");
  });
});

describe("DeskIconButton", () => {
  it("requires an aria-label for assistive tech", () => {
    render(
      <DeskIconButton aria-label="关闭面板">
        <span>X</span>
      </DeskIconButton>,
    );
    expect(screen.getByLabelText("关闭面板")).toBeDefined();
  });
});

describe("DeskField", () => {
  it("renders label and error with role alert", () => {
    render(
      <DeskField
        errorId="err-1"
        errorMessage="名称不能为空"
        htmlFor="i1"
        label="名称"
      >
        <DeskInput id="i1" />
      </DeskField>,
    );
    const errorEl = screen.getByText("名称不能为空");
    expect(errorEl.getAttribute("role")).toBe("alert");
    // Hint is hidden when an error is present.
    expect(screen.queryByText("可选提示")).toBeNull();
  });

  it("renders hint when there is no error", () => {
    render(
      <DeskField hint="最多 32 个字符" htmlFor="i2" label="名称">
        <DeskInput id="i2" />
      </DeskField>,
    );
    expect(screen.getByText("最多 32 个字符")).toBeDefined();
  });
});

describe("DeskInput", () => {
  it("sets aria-invalid when invalid", () => {
    render(<DeskInput aria-label="邮箱" invalid />);
    expect(screen.getByLabelText("邮箱").getAttribute("aria-invalid")).toBe(
      "true",
    );
  });
});

describe("DeskToggle", () => {
  it("calls onChange with the new checked value", () => {
    const onChange = vi.fn();
    render(<DeskToggle checked={false} label="启用" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("启用"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("DeskSegmentedControl", () => {
  it("renders options and calls onChange on click", () => {
    const onChange = vi.fn();
    render(
      <DeskSegmentedControl
        aria-label="视图"
        onChange={onChange}
        options={[
          { label: "列表", value: "list" },
          { label: "图谱", value: "graph" },
        ]}
        value="list"
      />,
    );
    fireEvent.click(screen.getByText("图谱"));
    expect(onChange).toHaveBeenCalledWith("graph");
  });

  it("uses roving tabindex: selected option is tabIndex=0, others -1", () => {
    render(
      <DeskSegmentedControl
        aria-label="视图"
        onChange={() => {}}
        options={[
          { label: "列表", value: "list" },
          { label: "图谱", value: "graph" },
        ]}
        value="list"
      />,
    );
    const listOption = screen.getByText("列表").closest("button")!;
    const graphOption = screen.getByText("图谱").closest("button")!;
    expect(listOption.tabIndex).toBe(0);
    expect(graphOption.tabIndex).toBe(-1);
  });

  it("arrow keys move selection AND DOM focus to the adjacent option", () => {
    const onChange = vi.fn();
    render(
      <DeskSegmentedControl
        aria-label="视图"
        onChange={onChange}
        options={[
          { label: "列表", value: "list" },
          { label: "图谱", value: "graph" },
        ]}
        value="list"
      />,
    );
    const listOption = screen.getByText("列表").closest("button")!;
    listOption.focus();
    expect(document.activeElement).toBe(listOption);
    fireEvent.keyDown(listOption, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("graph");
    // Focus must have moved to the graph option, not just the value.
    const graphOption = screen.getByText("图谱").closest("button")!;
    expect(document.activeElement).toBe(graphOption);
  });

  it("arrow keys wrap from last to first", () => {
    const onChange = vi.fn();
    render(
      <DeskSegmentedControl
        aria-label="视图"
        onChange={onChange}
        options={[
          { label: "列表", value: "list" },
          { label: "图谱", value: "graph" },
        ]}
        value="graph"
      />,
    );
    const graphOption = screen.getByText("图谱").closest("button")!;
    graphOption.focus();
    fireEvent.keyDown(graphOption, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("list");
    const listOption = screen.getByText("列表").closest("button")!;
    expect(document.activeElement).toBe(listOption);
  });
});

describe("DeskTabs", () => {
  it("renders the first tab content by default and switches on click", () => {
    render(
      <DeskTabs
        tabs={[
          { content: "来源内容", id: "sources", label: "来源" },
          { content: "复习内容", id: "review", label: "复习" },
        ]}
      />,
    );
    expect(screen.getByText("来源内容")).toBeDefined();
    fireEvent.click(screen.getByText("复习"));
    expect(screen.getByText("复习内容")).toBeDefined();
    expect(screen.queryByText("来源内容")).toBeNull();
  });

  it("uses roving tabindex: active tab is 0, inactive tabs are -1", () => {
    render(
      <DeskTabs
        tabs={[
          { content: "a", id: "a", label: "A" },
          { content: "b", id: "b", label: "B" },
        ]}
      />,
    );
    const tabA = screen.getByRole("tab", { name: "A" });
    const tabB = screen.getByRole("tab", { name: "B" });
    expect(tabA.tabIndex).toBe(0);
    expect(tabB.tabIndex).toBe(-1);
  });

  it("arrow keys move selection AND DOM focus to the adjacent tab", () => {
    render(
      <DeskTabs
        tabs={[
          { content: "a内容", id: "a", label: "A" },
          { content: "b内容", id: "b", label: "B" },
        ]}
      />,
    );
    const tabA = screen.getByRole("tab", { name: "A" });
    const tabB = screen.getByRole("tab", { name: "B" });
    tabA.focus();
    expect(document.activeElement).toBe(tabA);
    fireEvent.keyDown(tabA, { key: "ArrowRight" });
    // Focus moved to tab B.
    expect(document.activeElement).toBe(tabB);
    // Content switched to B.
    expect(screen.getByText("b内容")).toBeDefined();
  });

  it("exposes aria-controls on tabs and aria-labelledby on the panel", () => {
    render(
      <DeskTabs
        tabs={[
          { content: "a内容", id: "a", label: "A" },
          { content: "b内容", id: "b", label: "B" },
        ]}
      />,
    );
    const tabA = screen.getByRole("tab", { name: "A" });
    const panel = screen.getByRole("tabpanel");
    const controlsId = tabA.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();
    expect(panel.id).toBe(controlsId);
    expect(panel.getAttribute("aria-labelledby")).toBe(tabA.id);
  });

  it("multiple DeskTabs instances do not collide on tab/panel ids", () => {
    const { container } = render(
      <div>
        <DeskTabs
          tabs={[
            { content: "x1", id: "a", label: "XA" },
            { content: "x2", id: "b", label: "XB" },
          ]}
        />
        <DeskTabs
          tabs={[
            { content: "y1", id: "a", label: "YA" },
            { content: "y2", id: "b", label: "YB" },
          ]}
        />
      </div>,
    );
    const tabs = container.querySelectorAll('[role="tab"]');
    const ids = Array.from(tabs).map((t) => t.id);
    // All four tab ids must be unique (no collision between the two instances
    // even though both use the same internal tab ids "a" and "b").
    expect(new Set(ids).size).toBe(ids.length);
  });
});
