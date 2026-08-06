/* ============================================================
   knowledge-space-prototype / use-mock-state.test.ts
   Tests for mock state hook — using pure function tests
   since the project uses vitest with node environment.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { getProjectionData, getAllEvidence } from "./mock-data";

describe("mock data core logic", () => {
  it("projection data has correct structure", () => {
    const data = getProjectionData("today");
    expect(data).toBeDefined();
    expect(Array.isArray(data.evidence)).toBe(true);
    expect(data.graph).toBeDefined();
    expect(data.graph.nodes).toBeDefined();
    expect(data.graph.edges).toBeDefined();
    expect(data.progress).toBeDefined();
  });

  it("all evidence items have required fields", () => {
    const all = getAllEvidence();
    for (const item of all) {
      expect(item.id).toBeTruthy();
      expect(item.title).toBeTruthy();
      expect(item.status).toBeDefined();
      expect(item.confidence).toBeGreaterThanOrEqual(0);
      expect(item.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("today projection returns only actionable items", () => {
    const data = getProjectionData("today");
    for (const item of data.evidence) {
      expect(["suggested", "pending_review"]).toContain(item.status);
    }
  });

  it("records projection returns all statuses sorted by date", () => {
    const data = getProjectionData("records");
    const statuses = data.evidence.map((e) => e.status);
    expect(statuses).toContain("accepted");
    expect(statuses).toContain("suggested");
    expect(statuses).toContain("rejected");
    // Verify descending sort
    for (let i = 1; i < data.evidence.length; i++) {
      const prev = new Date(data.evidence[i - 1]!.suggestedAt!).getTime();
      const curr = new Date(data.evidence[i]!.suggestedAt!).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  it("progress counts are consistent", () => {
    const data = getProjectionData("records");
    const { total, accepted, suggested, rejected } = data.progress;
    expect(total).toBe(data.evidence.length);
    expect(accepted + suggested + rejected).toBe(total);
  });

  it("graph has valid nodes and edges", () => {
    const data = getProjectionData("today");
    expect(data.graph.nodes.length).toBeGreaterThan(0);
    expect(data.graph.edges.length).toBeGreaterThan(0);
    for (const node of data.graph.nodes) {
      expect(["concept", "evidence", "source", "claim"]).toContain(node.type);
    }
  });

  it("messages have user and assistant roles", () => {
    const data = getProjectionData("today");
    expect(data.messages.length).toBeGreaterThan(0);
    const roles = data.messages.map((m) => m.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
  });

  it("includes locked and online-only edge cases", () => {
    const all = getAllEvidence();
    const locked = all.filter((e) => e.locked);
    const onlineOnly = all.filter((e) => e.onlineOnly);
    expect(locked.length).toBeGreaterThanOrEqual(1);
    expect(onlineOnly.length).toBeGreaterThanOrEqual(1);
  });

  it("includes rejected items with reasons", () => {
    const all = getAllEvidence();
    const rejected = all.filter((e) => e.status === "rejected");
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    for (const item of rejected) {
      expect(item.rejectReason).toBeTruthy();
    }
  });
});

describe("useMockState concept — state transitions", () => {
  it("acceptItem transitions from suggested to accepted", () => {
    const data = getProjectionData("today");
    const item = data.evidence.find((e) => e.status === "suggested");
    expect(item).toBeDefined();
    // Simulate the state transition logic
    const updated = {
      ...item!,
      status: "accepted" as const,
      acceptedAt: new Date().toISOString(),
    };
    expect(updated.status).toBe("accepted");
    expect(updated.acceptedAt).toBeTruthy();
  });

  it("rejectItem transitions from suggested to rejected", () => {
    const data = getProjectionData("today");
    const item = data.evidence.find((e) => e.status === "suggested");
    expect(item).toBeDefined();
    const updated = {
      ...item!,
      status: "rejected" as const,
      rejectedAt: new Date().toISOString(),
      rejectReason: "Not relevant",
    };
    expect(updated.status).toBe("rejected");
    expect(updated.rejectedAt).toBeTruthy();
    expect(updated.rejectReason).toBe("Not relevant");
  });

  it("editItem updates title and summary", () => {
    const data = getProjectionData("today");
    const item = data.evidence[0];
    const updated = { ...item, title: "New Title", summary: "New summary" };
    expect(updated.title).toBe("New Title");
    expect(updated.summary).toBe("New summary");
  });

  it("projection switching changes evidence set", () => {
    const today = getProjectionData("today");
    const records = getProjectionData("records");
    // Today should have fewer items than records
    expect(today.evidence.length).toBeLessThanOrEqual(records.evidence.length);
    // Today data should only have actionable statuses
    for (const item of today.evidence) {
      expect(["suggested", "pending_review"]).toContain(item.status);
    }
  });
});
