import { describe, expect, it } from "vitest";

import { mutationTimestamp } from "./mutation-timestamp";

describe("local mutation timestamps", () => {
  const created_at = "2026-09-07T09:15:41.731Z";
  const updated_at = "2026-09-07T09:15:45.123456Z";

  it("uses the current clock for a new entity", () => {
    expect(mutationTimestamp(undefined, created_at)).toBe(created_at);
  });

  it("uses a clock that advances past the existing update", () => {
    const now = "2026-09-07T09:15:46.000Z";
    expect(mutationTimestamp({ created_at, updated_at }, now)).toBe(now);
  });

  it("keeps the creation bound when the observed clock moves backward", () => {
    const now = "2026-09-07T09:15:40.020Z";
    expect(mutationTimestamp({ created_at, updated_at: created_at }, now)).toBe(
      created_at,
    );
  });

  it("keeps the latest update bound without changing its precision", () => {
    expect(mutationTimestamp({ created_at, updated_at }, created_at)).toBe(
      updated_at,
    );
  });

  it("preserves the existing sub-millisecond timestamp on a parsed tie", () => {
    expect(
      mutationTimestamp({ created_at, updated_at }, "2026-09-07T09:15:45.123Z"),
    ).toBe(updated_at);
  });
});
