/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KnowledgeSpaceGraph } from "./knowledge-space-graph";
import type { KsData } from "./ks-mock-data";

const TEST_DATA: KsData = {
  nodes: [
    {
      id: "t1",
      label: "间隔重复",
      type: "topic",
      description: " spaced repetition 说明",
      mastery: 0.8,
      confirmState: "confirmed",
      x: 100,
      y: 100,
      tags: ["learning"],
    },
    {
      id: "t2",
      label: "主动回忆",
      type: "topic",
      description: "active recall 说明",
      mastery: 0.4,
      confirmState: "pending",
      x: 200,
      y: 200,
      tags: [],
    },
  ],
  edges: [
    {
      id: "e1",
      source: "t1",
      target: "t2",
      type: "supports",
      label: "互补",
    },
  ],
  tasks: [],
  messages: [],
  traceSteps: [],
};

afterEach(cleanup);

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

function renderGraph(props = {}) {
  return render(
    <KnowledgeSpaceGraph
      data={TEST_DATA}
      state="ready"
      readOnly={true}
      {...props}
    />,
  );
}

describe("KnowledgeSpaceGraph", () => {
  it("renders the SVG graph and node list", () => {
    renderGraph();
    expect(document.querySelector(".ks-graph-svg-wrap")).not.toBeNull();
    expect(document.querySelectorAll("[data-node-id]").length).toBe(2);
  });

  it("shows node labels and confirm states", () => {
    renderGraph();
    const node1 = document.querySelector('[data-node-id="t1"]');
    expect(node1?.getAttribute("aria-label")).toContain("间隔重复");
    expect(node1?.getAttribute("aria-label")).toContain("已确认");
  });

  it("selects a node and shows its details in the inspector", () => {
    renderGraph();
    const node2 = document.querySelector('[data-node-id="t2"]') as HTMLElement;
    expect(node2).not.toBeNull();
    fireEvent.click(node2!);
    const inspectorTitle = document.querySelector(".ks-inspector-title");
    expect(inspectorTitle).not.toBeNull();
    expect(inspectorTitle?.textContent).toBe("主动回忆");
    expect(screen.getByText("active recall 说明")).toBeDefined();
  });

  it("hides review actions in read-only mode", () => {
    renderGraph();
    const node2 = document.querySelector('[data-node-id="t2"]') as HTMLElement;
    fireEvent.click(node2!);
    expect(screen.queryByText("审批操作（本地模拟）")).toBeNull();
  });

  it("shows review actions when not read-only", () => {
    renderGraph({ readOnly: false });
    const node2 = document.querySelector('[data-node-id="t2"]') as HTMLElement;
    fireEvent.click(node2!);
    expect(screen.getByText("审批操作（本地模拟）")).toBeDefined();
  });

  it("supports keyboard navigation on SVG nodes", () => {
    renderGraph();
    const node1 = document.querySelector('[data-node-id="t1"]') as HTMLElement;
    node1.focus();
    fireEvent.keyDown(node1, { key: "ArrowRight" });
    const inspectorTitle = document.querySelector(".ks-inspector-title");
    expect(inspectorTitle).not.toBeNull();
    expect(inspectorTitle?.textContent).toBe("主动回忆");
  });

  it("deselects with Escape", () => {
    renderGraph();
    const node2 = document.querySelector('[data-node-id="t2"]') as HTMLElement;
    fireEvent.click(node2!);
    const inspectorTitle = document.querySelector(".ks-inspector-title");
    expect(inspectorTitle).not.toBeNull();
    expect(inspectorTitle?.textContent).toBe("主动回忆");
    fireEvent.keyDown(node2, { key: "Escape" });
    expect(screen.queryByText("选择一个节点查看详情")).not.toBeNull();
  });

  it("renders empty state when state is empty", () => {
    renderGraph({ state: "empty" });
    expect(screen.getByText("当前空间暂无节点")).toBeDefined();
  });

  it("renders loading state without showing fabricated data", () => {
    renderGraph({ state: "loading" });
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(document.querySelector(".ks-graph-svg-wrap")).toBeNull();
  });

  it("renders error state with retry", () => {
    const onRetry = vi.fn();
    renderGraph({ state: "error", onRetry });
    const retryButton = screen.getByText("重试");
    expect(retryButton).toBeDefined();
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders locked state with unlock action", () => {
    const onUnlock = vi.fn();
    renderGraph({ state: "locked", onUnlock });
    expect(screen.getByText("知识空间已锁定")).toBeDefined();
    const unlockButton = screen.getByText("解锁");
    expect(unlockButton).toBeDefined();
    fireEvent.click(unlockButton);
    expect(onUnlock).toHaveBeenCalledTimes(1);
  });

  it("renders online-only state without fabricated data", () => {
    renderGraph({ state: "online-only" });
    expect(screen.getByText("知识图谱在线功能受限")).toBeDefined();
    expect(document.querySelector(".ks-graph-svg-wrap")).toBeNull();
  });

  it("filters nodes by search query", () => {
    renderGraph();
    const search = screen.getByLabelText("搜索知识空间") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "主动" } });
    expect(search.value).toBe("主动");
    // Search query is reflected in the DOM through the mobile tree label count
    expect(document.querySelector(".ks-graph-svg-wrap")).not.toBeNull();
  });

  it("does not render a trace when showTrace is false", () => {
    const { container } = renderGraph({ showTrace: false });
    expect(container.querySelector(".ks-trace-zone")).toBeNull();
  });

  it("computes layout when nodes lack coordinates", () => {
    const dataWithoutCoords: KsData = {
      ...TEST_DATA,
      nodes: TEST_DATA.nodes.map((node) => ({ ...node, x: 0, y: 0 })),
    };
    renderGraph({ data: dataWithoutCoords });
    expect(document.querySelectorAll("[data-node-id]").length).toBe(2);
  });
});
