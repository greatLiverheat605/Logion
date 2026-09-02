/** @vitest-environment jsdom */

import { createElement, StrictMode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { consumeFragmentToken, useFragmentToken } from "./use-fragment-token";

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

  it("consumes a valid token only once during Strict Mode effect replay", async () => {
    const token = "a".repeat(32);
    window.history.replaceState(null, "", `/auth/verify#token=${token}`);
    const { result } = renderHook(() => useFragmentToken(), {
      wrapper: ({ children }) => createElement(StrictMode, null, children),
    });

    await waitFor(() => expect(result.current).toBe(token));
    expect(window.location.hash).toBe("");
  });
});
