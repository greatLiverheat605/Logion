/* ============================================================
   knowledge-space-prototype / mock-data.test.ts
   Tests for mock data generation and state management.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { getProjectionData, getAllEvidence } from "./mock-data";

describe("getProjectionData", () => {
  it("returns a ProjectionData with evidence, graph, messages, and progress", () => {
    const data = getProjectionData("today");
    expect(data).toBeDefined();
    expect(Array.isArray(data.evidence)).toBe(true);
    expect(data.graph).toBeDefined();
    expect(Array.isArray(data.graph.nodes)).toBe(true);
    expect(Array.isArray(data.graph.edges)).toBe(true);
    expect(Array.isArray(data.messages)).toBe(true);
    expect(data.progress).toBeDefined();
    expect(typeof data.progress.total).toBe("number");
  });

  it("today projection returns only suggested and pending_review items", () => {
    const data = getProjectionData("today");
    for (const item of data.evidence) {
      expect(["suggested", "pending_review"]).toContain(item.status);
    }
  });

  it("review projection returns suggested and pending_review items", () => {
    const data = getProjectionData("review");
    for (const item of data.evidence) {
      expect(["suggested", "pending_review"]).toContain(item.status);
    }
  });

  it("records projection returns all items sorted by suggestedAt descending", () => {
    const data = getProjectionData("records");
    // Should include accepted, suggested, rejected
    const statuses = data.evidence.map((e) => e.status);
    expect(statuses).toContain("accepted");
    expect(statuses).toContain("suggested");
    // Verify sort order
    for (let i = 1; i < data.evidence.length; i++) {
      const a = data.evidence[i - 1];
      const b = data.evidence[i];
      if (!a || !b) break;
      const prev = new Date(a.suggestedAt!).getTime();
      const curr = new Date(b.suggestedAt!).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });
});

describe("getAllEvidence", () => {
  it("returns all evidence items", () => {
    const all = getAllEvidence();
    expect(all.length).toBeGreaterThanOrEqual(10);
  });

  it("each item has required fields", () => {
    const all = getAllEvidence();
    for (const item of all) {
      expect(item.id).toBeTruthy();
      expect(item.title).toBeTruthy();
      expect(item.status).toBeDefined();
      expect(["accepted", "suggested", "rejected", "pending_review"]).toContain(
        item.status,
      );
      expect(typeof item.confidence).toBe("number");
      expect(item.confidence).toBeGreaterThanOrEqual(0);
      expect(item.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe("progress computation", () => {
  it("computes correct progress values", () => {
    const data = getProjectionData("records");
    const { total, accepted, suggested, rejected } = data.progress;
    expect(total).toBe(data.evidence.length);
    expect(accepted + suggested + rejected).toBe(total);
  });
});

describe("graph structure", () => {
  it("has nodes and edges", () => {
    const data = getProjectionData("today");
    expect(data.graph.nodes.length).toBeGreaterThan(0);
    expect(data.graph.edges.length).toBeGreaterThan(0);
  });

  it("each node has required fields", () => {
    const data = getProjectionData("today");
    for (const node of data.graph.nodes) {
      expect(node.id).toBeTruthy();
      expect(node.label).toBeTruthy();
      expect(["concept", "evidence", "source", "claim"]).toContain(node.type);
    }
  });
});

describe("messages", () => {
  it("has messages with user and assistant roles", () => {
    const data = getProjectionData("today");
    expect(data.messages.length).toBeGreaterThan(0);
    const roles = data.messages.map((m) => m.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
  });
});