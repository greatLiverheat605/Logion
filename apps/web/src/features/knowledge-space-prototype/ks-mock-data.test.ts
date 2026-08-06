/* ============================================================
   knowledge-space-prototype / ks-mock-data.test.ts
   Tests for Variant C mock data helpers and projection functions.
   ============================================================ */

import { describe, it, expect } from "vitest";
import {
  KS_DATA,
  getNodeById,
  getEdgesForNode,
  getNeighborIds,
  getTasksForNode,
  getTraceStepsForNode,
  getNodeColor,
  getConfirmColor,
  getConfirmLabel,
  getEdgeStyle,
  getTodayProjection,
  getReviewProjection,
  getRecordsProjection,
  getProjection,
} from "./ks-mock-data";

describe("getNodeById", () => {
  it("returns the correct node", () => {
    const node = getNodeById("topic-1");
    expect(node).toBeDefined();
    expect(node?.label).toBe("间隔重复");
    expect(node?.type).toBe("topic");
  });

  it("returns undefined for unknown id", () => {
    expect(getNodeById("nonexistent")).toBeUndefined();
  });
});

describe("getEdgesForNode", () => {
  it("returns edges connected to the node", () => {
    const edges = getEdgesForNode("topic-1");
    expect(edges.length).toBeGreaterThan(0);
    for (const edge of edges) {
      expect(edge.source === "topic-1" || edge.target === "topic-1").toBe(true);
    }
  });

  it("returns empty array for isolated node", () => {
    const edges = getEdgesForNode("nonexistent");
    expect(edges).toEqual([]);
  });
});

describe("getNeighborIds", () => {
  it("returns all neighbor node ids", () => {
    const neighbors = getNeighborIds("topic-1");
    expect(neighbors.length).toBeGreaterThan(0);
    expect(neighbors).toContain("topic-2");
  });

  it("returns empty array for nonexistent node", () => {
    expect(getNeighborIds("nonexistent")).toEqual([]);
  });
});

describe("getTasksForNode", () => {
  it("returns tasks for action-1", () => {
    const tasks = getTasksForNode("action-1");
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.some((t) => t.status === "open")).toBe(true);
    expect(tasks.some((t) => t.status === "done")).toBe(true);
  });

  it("returns empty for node without tasks", () => {
    const tasks = getTasksForNode("claim-1");
    expect(tasks).toEqual([]);
  });
});

describe("getTraceStepsForNode", () => {
  it("returns trace steps for ev-1", () => {
    const steps = getTraceStepsForNode("ev-1");
    expect(steps.length).toBe(1);
    expect(steps[0]?.phase).toBe("source");
  });

  it("returns empty for node without trace steps", () => {
    const steps = getTraceStepsForNode("nonexistent");
    expect(steps).toEqual([]);
  });
});

describe("getNodeColor", () => {
  it("returns correct color for each node type", () => {
    expect(getNodeColor(KS_DATA.nodes[0]!)).toBe("var(--primary)"); // topic
    expect(getNodeColor(KS_DATA.nodes[5]!)).toBe("var(--text-success)"); // evidence
  });
});

describe("getConfirmColor", () => {
  it("returns correct CSS variable for each state", () => {
    expect(getConfirmColor("confirmed")).toBe("var(--text-success)");
    expect(getConfirmColor("pending")).toBe("var(--text-warning)");
    expect(getConfirmColor("contested")).toBe("var(--text-danger)");
  });
});

describe("getConfirmLabel", () => {
  it("returns Chinese label for each state", () => {
    expect(getConfirmLabel("confirmed")).toBe("已确认");
    expect(getConfirmLabel("pending")).toBe("待验证");
    expect(getConfirmLabel("contested")).toBe("有争议");
  });
});

describe("getEdgeStyle", () => {
  it("returns correct style for each edge type", () => {
    expect(getEdgeStyle("supports")).toEqual({ dashed: false });
    expect(getEdgeStyle("contradicts")).toEqual({
      dashed: true,
      dasharray: "6 3",
    });
    expect(getEdgeStyle("leads_to")).toEqual({
      dashed: true,
      dasharray: "4 3",
    });
    expect(getEdgeStyle("derives_from")).toEqual({ dashed: false });
    expect(getEdgeStyle("evidence_for")).toEqual({ dashed: false });
  });
});

describe("KS_DATA structure", () => {
  it("has nodes, edges, tasks, messages, and traceSteps", () => {
    expect(KS_DATA.nodes.length).toBeGreaterThan(0);
    expect(KS_DATA.edges.length).toBeGreaterThan(0);
    expect(KS_DATA.tasks.length).toBeGreaterThan(0);
    expect(KS_DATA.messages.length).toBeGreaterThan(0);
    expect(KS_DATA.traceSteps.length).toBeGreaterThan(0);
  });

  it("all edge source/target reference valid node ids", () => {
    const nodeIds = new Set(KS_DATA.nodes.map((n) => n.id));
    for (const edge of KS_DATA.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });

  it("all tasks reference valid node ids", () => {
    const nodeIds = new Set(KS_DATA.nodes.map((n) => n.id));
    for (const task of KS_DATA.tasks) {
      expect(nodeIds.has(task.nodeId)).toBe(true);
    }
  });

  it("all trace steps reference valid node ids", () => {
    const nodeIds = new Set(KS_DATA.nodes.map((n) => n.id));
    for (const step of KS_DATA.traceSteps) {
      expect(nodeIds.has(step.nodeId)).toBe(true);
    }
  });
});

describe("Today projection", () => {
  it("returns nodes needing attention", () => {
    const items = getTodayProjection();
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(["pending", "contested"]).toContain(item.confirmState);
    }
  });

  it("is sorted by mastery ascending", () => {
    const items = getTodayProjection();
    for (let i = 1; i < items.length; i++) {
      expect(items[i]!.mastery).toBeGreaterThanOrEqual(items[i - 1]!.mastery);
    }
  });
});

describe("Review projection", () => {
  it("returns only non-confirmed nodes", () => {
    const items = getReviewProjection();
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.confirmState).not.toBe("confirmed");
    }
  });

  it("sorted contested before pending", () => {
    const items = getReviewProjection();
    const contestedIdx = items.findIndex((i) => i.confirmState === "contested");
    const pendingIdx = items.findIndex((i) => i.confirmState === "pending");
    if (contestedIdx >= 0 && pendingIdx >= 0) {
      expect(contestedIdx).toBeLessThan(pendingIdx);
    }
  });
});

describe("Records projection", () => {
  it("returns all nodes sorted by mastery descending", () => {
    const items = getRecordsProjection();
    expect(items.length).toBe(KS_DATA.nodes.length);
    for (let i = 1; i < items.length; i++) {
      expect(items[i]!.mastery).toBeLessThanOrEqual(items[i - 1]!.mastery);
    }
  });
});

describe("getProjection", () => {
  it("today returns today projection", () => {
    const items = getProjection("today");
    expect(items).toEqual(getTodayProjection());
  });

  it("review returns review projection", () => {
    const items = getProjection("review");
    expect(items).toEqual(getReviewProjection());
  });

  it("records returns records projection", () => {
    const items = getProjection("records");
    expect(items).toEqual(getRecordsProjection());
  });
});
