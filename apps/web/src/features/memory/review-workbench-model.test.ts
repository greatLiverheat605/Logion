import { describe, expect, it } from "vitest";

import {
  buildKnowledgeGraph,
  buildSevenDayReviewLoad,
} from "./review-workbench-model";

describe("review workbench model", () => {
  it("groups overdue work into today and excludes completed schedules", () => {
    const load = buildSevenDayReviewLoad(
      [
        { next_review_at: "2026-07-29T08:00:00Z", status: "due" },
        { next_review_at: "2026-08-02T08:00:00Z", status: "scheduled" },
        { next_review_at: "2026-08-02T08:00:00Z", status: "completed" },
      ],
      new Date("2026-07-31T08:00:00"),
    );

    expect(load[0]?.value).toBe(1);
    expect(load.reduce((total, item) => total + item.value, 0)).toBe(2);
  });

  it("builds graph relations only from existing topic dependencies", () => {
    const graph = buildKnowledgeGraph(
      [
        { description: "", id: "a", title: "基础" },
        { description: "", id: "b", title: "进阶" },
      ],
      [
        { dependent_topic_id: "b", prerequisite_topic_id: "a" },
        { dependent_topic_id: "missing", prerequisite_topic_id: "a" },
      ],
    );

    expect(graph[0]?.dependents).toEqual(["进阶"]);
    expect(graph[1]?.prerequisites).toEqual(["基础"]);
  });
});
