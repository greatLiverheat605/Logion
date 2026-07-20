import { describe, expect, it, vi } from "vitest";

import { consumeFragmentToken } from "./use-fragment-token";

describe("fragment action tokens", () => {
  it("consumes and clears a valid token", () => {
    const clear = vi.fn();
    expect(consumeFragmentToken(`#token=${"a".repeat(32)}`, clear)).toBe(
      "a".repeat(32),
    );
    expect(clear).toHaveBeenCalledOnce();
  });

  it("clears malformed and missing tokens", () => {
    const clear = vi.fn();
    expect(consumeFragmentToken("#token=bad", clear)).toBeNull();
    expect(consumeFragmentToken("#other=value", clear)).toBeNull();
    expect(clear).toHaveBeenCalledTimes(2);
  });
});
