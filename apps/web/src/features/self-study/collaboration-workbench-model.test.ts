import { describe, expect, it } from "vitest";

import { eligibleCollaborationSpaces } from "./collaboration-workbench-model";

describe("collaboration workbench model", () => {
  it("excludes private spaces from every collaboration choice", () => {
    expect(
      eligibleCollaborationSpaces([
        { id: "private", visibility: "private" as const },
        { id: "shared", visibility: "shared" as const },
      ]),
    ).toEqual([{ id: "shared", visibility: "shared" }]);
  });
});
