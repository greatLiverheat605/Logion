/** @vitest-environment jsdom */

import { createElement, StrictMode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { consumeFragmentToken, useFragmentToken } from "./use-fragment-token";

describe("fragment action tokens", () => {
  it.each(["", "token="])("consumes and clears a valid #%s token", (prefix) => {
    const clear = vi.fn();
    expect(consumeFragmentToken(`#${prefix}${"a".repeat(32)}`, clear)).toBe(
      "a".repeat(32),
    );
    expect(clear).toHaveBeenCalledOnce();
  });

  it("clears malformed and missing tokens", () => {
    const clear = vi.fn();
    const hashes = [
      "",
      "#",
      "#bad",
      "#token=",
      "#token=bad",
      "#other=value",
      `#${"a".repeat(31)}`,
      `#${"a".repeat(257)}`,
      `#${"a".repeat(32)}&other=value`,
      `#${"a".repeat(32)}%2F`,
    ];
    for (const hash of hashes) {
      expect(consumeFragmentToken(hash, clear)).toBeNull();
    }
    expect(clear).toHaveBeenCalledTimes(hashes.length);
  });

  it.each([
    ["/auth/verify", ""],
    ["/auth/recover", ""],
    ["/auth/verify", "token="],
    ["/auth/recover", "token="],
    ["/workspaces/accept-invitation", "token="],
  ])(
    "consumes %s#%s once during Strict Mode effect replay",
    async (path, prefix) => {
      const token = "a".repeat(32);
      window.history.replaceState(null, "", `${path}#${prefix}${token}`);
      const { result } = renderHook(() => useFragmentToken(), {
        wrapper: ({ children }) => createElement(StrictMode, null, children),
      });

      await waitFor(() => expect(result.current).toBe(token));
      expect(window.location.hash).toBe("");
    },
  );
});
