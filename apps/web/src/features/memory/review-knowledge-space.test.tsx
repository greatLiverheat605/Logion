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
  it("renders real topics as graph nodes", () => {
    render(
      <ReviewKnowledgeSpaceGraph
        topics={topics}
        dependencies={dependencies}
        state="ready"
      />,
    );
    expect(screen.getByText("知识空间")).toBeDefined();
    expect(document.querySelectorAll("[data-node-id]").length).toBe(3);
  });

  it("does not use mock data as production defaults", () => {
    render(
      <ReviewKnowledgeSpaceGraph topics={[]} dependencies={[]} state="empty" />,
    );
    expect(screen.queryByText("间隔重复元分析 (2025)")).toBeNull();
    expect(screen.getByText("当前空间暂无节点")).toBeDefined();
  });

  it("shows loading state for real data", () => {
    render(
      <ReviewKnowledgeSpaceGraph
        topics={topics}
        dependencies={dependencies}
        state="loading"
      />,
    );
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
  });
});
