import { describe, expect, it } from "vitest";

import { buildSelfStudySummary } from "./self-study-workbench-model";

describe("self study workbench model", () => {
  it("uses projects with at least one linked deliverable as the progress denominator", () => {
    const result = buildSelfStudySummary({
      tracks: [{ id: "track" }],
      projects: [
        { id: "project-a", parentId: "track" },
        { id: "project-b", parentId: "track" },
        { id: "orphan", parentId: "missing" },
      ],
      deliverables: [
        { id: "one", parentId: "project-a" },
        { id: "two", parentId: "project-a" },
        { id: "orphan-deliverable", parentId: "missing" },
      ],
    });

    expect(result.projectCoverage).toBe(50);
    expect(result.deliverableCount).toBe(2);
    expect(result.orphanProjectCount).toBe(1);
  });

  it("returns no percentage when there are no linked projects", () => {
    expect(
      buildSelfStudySummary({ deliverables: [], projects: [], tracks: [] })
        .projectCoverage,
    ).toBeNull();
  });
});
