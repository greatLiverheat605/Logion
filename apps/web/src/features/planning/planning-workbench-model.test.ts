import { describe, expect, it } from "vitest";

import { buildPlanningPhaseSequence } from "./planning-workbench-model";

describe("planning workbench model", () => {
  it("uses position only as an ordered predecessor hint", () => {
    const phases = buildPlanningPhaseSequence([
      {
        acceptance_criteria: ["提交成果"],
        description: "",
        estimated_minutes: 60,
        id: "b",
        position: 2,
        title: "产出",
      },
      {
        acceptance_criteria: ["通过检查"],
        description: "",
        estimated_minutes: 30,
        id: "a",
        position: 0,
        title: "基础",
      },
    ]);

    expect(phases.map((phase) => phase.title)).toEqual(["基础", "产出"]);
    expect(phases[0]?.priorPhaseTitle).toBeNull();
    expect(phases[1]?.priorPhaseTitle).toBe("基础");
  });
});
