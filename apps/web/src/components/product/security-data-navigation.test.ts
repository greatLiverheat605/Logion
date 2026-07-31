import { describe, expect, it } from "vitest";

import { SECURITY_DATA_ROUTES } from "./security-data-navigation";

describe("security and data sovereignty navigation", () => {
  it("keeps the three existing routes in one explicit entry group", () => {
    expect(SECURITY_DATA_ROUTES.map((route) => route.href)).toEqual([
      "/app/security",
      "/app/data",
      "/app/audit",
    ]);
  });
});
