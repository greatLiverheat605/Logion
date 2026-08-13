/* ============================================================
   features/memory/review-knowledge-space.test.tsx
   Tests for the real-data knowledge-space adapter used by ReviewCenter.
   ============================================================ */

/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildReviewKnowledgeSpaceData,
  ReviewKnowledgeSpaceGraph,
  ReviewKnowledgeSpaceInspector,
} from "./review-knowledge-space";

const topics = [
  {
    id: "topic-a",
    title: "间隔重复",
    description: " spaced repetition ",
    confirmedLevel: "mastered",
    suggestedLevel: "mastered",
    nextReviewAt: null,
    due: false,
  },
  {
    id: "topic-b",
    title: "主动回忆",
    description: "active recall",
    confirmedLevel: null,
    suggestedLevel: "familiar",
    nextReviewAt: null,
    due: true,
  },
  {
    id: "topic-c",
    title: "认知负荷",
    description: "cognitive load",
    confirmedLevel: null,
    suggestedLevel: "unknown",
    nextReviewAt: "2026-08-10T10:00:00Z",
    due: false,
  },
];

const dependencies = [
  { prerequisiteId: "topic-a", dependentId: "topic-b" },
  { prerequisiteId: "topic-a", dependentId: "topic-a" }, // self-reference
  { prerequisiteId: "topic-missing", dependentId: "topic-b" }, // missing node
];

afterEach(cleanup);

describe("buildReviewKnowledgeSpaceData", () => {
  it("maps topics to graph nodes with confirm states", () => {
    const data = buildReviewKnowledgeSpaceData(topics, dependencies);
    expect(data.nodes.length).toBe(3);
    const a = data.nodes.find((node) => node.id === "topic-a");
    expect(a?.confirmState).toBe("confirmed");
    expect(a?.mastery).toBeGreaterThan(0.9);
    const b = data.nodes.find((node) => node.id === "topic-b");
    expect(b?.confirmState).toBe("pending");
    const c = data.nodes.find((node) => node.id === "topic-c");
    expect(c?.confirmState).toBe("contested");
    expect(data.nodes.every((node) => node.x === undefined)).toBe(true);
    expect(data.nodes.every((node) => node.y === undefined)).toBe(true);
  });

  it("marks due topics and scheduled reviews", () => {
    const data = buildReviewKnowledgeSpaceData(topics, dependencies);
    const b = data.nodes.find((node) => node.id === "topic-b");
    expect(b?.tags).toContain("今日到期");
    const c = data.nodes.find((node) => node.id === "topic-c");
    expect(c?.tags).toContain("已安排复习");
  });

  it("filters invalid dependencies", () => {
    const data = buildReviewKnowledgeSpaceData(topics, dependencies);
    expect(data.edges.length).toBe(1);
    expect(data.edges[0]?.source).toBe("topic-a");
    expect(data.edges[0]?.target).toBe("topic-b");
    expect(data.edges[0]?.type).toBe("prerequisite");
    expect(data.edges[0]?.label).toBe("先修");
  });

  it("produces an empty graph when no topics", () => {
    const data = buildReviewKnowledgeSpaceData([], []);
    expect(data.nodes).toEqual([]);
    expect(data.edges).toEqual([]);
  });
});

describe("ReviewKnowledgeSpaceGraph", () => {
  it("renders server-authorised graph nodes", () => {
    const graphData = buildReviewKnowledgeSpaceData(topics, dependencies);
    render(
      <ReviewKnowledgeSpaceGraph
        graphData={graphData}
        graphMeta={{
          depth: 1,
          limits: { bytes: 1048576, edges: 400, nodes: 150 },
          nextCursor: null,
          truncated: false,
          truncationReasons: [],
        }}
        state="ready"
      />,
    );
    expect(screen.getByText("知识空间")).toBeDefined();
    expect(
      document.querySelector(".ks-page .product-page-head h2"),
    ).not.toBeNull();
    expect(document.querySelectorAll("[data-node-id]").length).toBe(3);
  });

  it("does not use mock data as production defaults", () => {
    render(
      <ReviewKnowledgeSpaceGraph
        graphData={null}
        graphMeta={null}
        state="empty"
      />,
    );
    expect(screen.queryByText("间隔重复元分析 (2025)")).toBeNull();
    expect(screen.getByText("当前空间暂无节点")).toBeDefined();
  });

  it("shows loading state for real data", () => {
    render(
      <ReviewKnowledgeSpaceGraph
        graphData={null}
        graphMeta={null}
        state="loading"
      />,
    );
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
  });

  it("prioritises server-authorised graphData over local topics", () => {
    const apiData = {
      nodes: [
        {
          confirmState: "confirmed" as const,
          description: "API 节点",
          id: "api-node-1",
          label: "API根节点",
          mastery: 0,
          tags: ["根节点"],
          type: "topic" as const,
        },
      ],
      edges: [],
      messages: [],
      tasks: [],
      traceSteps: [],
    };
    const apiMeta = {
      depth: 1,
      limits: { bytes: 1048576, edges: 400, nodes: 150 },
      nextCursor: null,
      truncated: false,
      truncationReasons: [],
    };
    render(
      <ReviewKnowledgeSpaceGraph
        state="ready"
        graphData={apiData}
        graphMeta={apiMeta}
      />,
    );
    // The API node "API根节点" should be rendered (SVG + mobile list = 2),
    // not the local topics. Only 1 unique data-node-id should exist.
    expect(document.querySelectorAll("[data-node-id]").length).toBe(1);
    expect(screen.getAllByText("API根节点").length).toBeGreaterThanOrEqual(1);
    // Local-only topic should NOT appear anywhere.
    expect(screen.queryByText("间隔重复")).toBeNull();
  });

  it("shows truncation reason when graphMeta.truncated is true", () => {
    const apiData = {
      nodes: [
        {
          confirmState: "confirmed" as const,
          description: "x",
          id: "n1",
          label: "节点",
          mastery: 0,
          tags: [],
          type: "topic" as const,
        },
      ],
      edges: [],
      messages: [],
      tasks: [],
      traceSteps: [],
    };
    const apiMeta = {
      depth: 2,
      limits: { bytes: 1048576, edges: 400, nodes: 150 },
      nextCursor: "cursor-x",
      truncated: true,
      truncationReasons: ["node_limit" as const, "edge_limit" as const],
    };
    render(
      <ReviewKnowledgeSpaceGraph
        state="ready"
        graphData={apiData}
        graphMeta={apiMeta}
      />,
    );
    // Truncation reason labels should be visible.
    expect(screen.getByText(/节点数达到服务端上限/)).toBeDefined();
    expect(screen.getByText(/边数达到服务端上限/)).toBeDefined();
    // "More data available" prompt.
    expect(screen.getByText(/还有更多数据可加载/)).toBeDefined();
  });

  it("does not silently fall back when authorised graph data is absent", () => {
    render(
      <ReviewKnowledgeSpaceGraph
        state="error"
        graphData={null}
        graphMeta={null}
      />,
    );
    expect(document.querySelectorAll("[data-node-id]").length).toBe(0);
    expect(screen.queryByText("间隔重复")).toBeNull();
    expect(screen.getByText("知识空间暂时无法读取")).toBeDefined();
  });

  it("shows server-authorised source label when API data is present", () => {
    const apiData = {
      nodes: [
        {
          confirmState: "confirmed" as const,
          description: "x",
          id: "n1",
          label: "节点",
          mastery: 0,
          tags: [],
          type: "topic" as const,
        },
      ],
      edges: [],
      messages: [],
      tasks: [],
      traceSteps: [],
    };
    const apiMeta = {
      depth: 1,
      limits: { bytes: 1048576, edges: 400, nodes: 150 },
      nextCursor: null,
      truncated: false,
      truncationReasons: [],
    };
    render(
      <ReviewKnowledgeSpaceGraph
        state="ready"
        graphData={apiData}
        graphMeta={apiMeta}
      />,
    );
    expect(screen.getByText(/服务端授权/)).toBeDefined();
    expect(screen.getByText(/上限 150 节点/)).toBeDefined();
    expect(screen.getByText(/400 边/)).toBeDefined();
  });

  it("delegates node details to the AppShell inspector", () => {
    const graphData = buildReviewKnowledgeSpaceData(topics, dependencies);
    render(
      <ReviewKnowledgeSpaceGraph
        graphData={graphData}
        graphMeta={null}
        onNodeSelect={() => undefined}
        selectedId={null}
        state="ready"
      />,
    );
    expect(document.querySelector(".ks-inspector-zone")).toBeNull();
    expect(
      document.querySelector(".ks-body--without-inspector"),
    ).not.toBeNull();
  });
});

describe("ReviewKnowledgeSpaceInspector", () => {
  it("shows the selected node, bounded scope and relationships", () => {
    const data = buildReviewKnowledgeSpaceData(topics, dependencies);
    render(
      <ReviewKnowledgeSpaceInspector
        data={data}
        graphMeta={{
          depth: 2,
          limits: { bytes: 1048576, edges: 400, nodes: 150 },
          nextCursor: "next",
          truncated: true,
          truncationReasons: ["node_limit"],
        }}
        nodeId="topic-a"
      />,
    );
    expect(screen.getByText("间隔重复")).toBeDefined();
    expect(screen.getByText(/2 跳授权视图/)).toBeDefined();
    expect(screen.getByText(/节点数达到服务端上限/)).toBeDefined();
    expect(screen.getByText("主动回忆")).toBeDefined();
  });
});
