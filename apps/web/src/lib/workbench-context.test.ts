/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearWorkbenchContexts,
  readWorkbenchContext,
  writeWorkbenchContext,
} from "./workbench-context";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const spaceId = "01900000-0000-7000-8000-000000000002";
const topicId = "01900000-0000-7000-8000-000000000003";

afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("workbench context", () => {
  it("merges and restores opaque IDs and a view name", () => {
    writeWorkbenchContext("review", { spaceId, workspaceId });
    writeWorkbenchContext("review", { selectedId: topicId, view: "reviews" });
    expect(readWorkbenchContext("review")).toEqual({
      selectedId: topicId,
      spaceId,
      view: "reviews",
      workspaceId,
    });
    expect(readWorkbenchContext("exam").workspaceId).toBe("");
  });

  it("drops anything that is not an ID or a short view name", () => {
    window.sessionStorage.setItem(
      "logion:workbench-context:review",
      JSON.stringify({
        workspaceId: "not-an-id",
        spaceId,
        view: "查询词 with text",
        selectedId: 42,
        query: "private search text",
      }),
    );
    const restored = readWorkbenchContext("review");
    expect(restored).toEqual({
      selectedId: "",
      spaceId,
      view: "",
      workspaceId: "",
    });
    writeWorkbenchContext("review", {});
    expect(
      window.sessionStorage.getItem("logion:workbench-context:review"),
    ).not.toContain("private search text");
  });

  it("clears every workbench key and keeps unrelated storage", () => {
    writeWorkbenchContext("review", { workspaceId });
    writeWorkbenchContext("templates", { spaceId });
    window.sessionStorage.setItem("unrelated", "keep");
    clearWorkbenchContexts();
    expect(
      window.sessionStorage.getItem("logion:workbench-context:review"),
    ).toBeNull();
    expect(
      window.sessionStorage.getItem("logion:workbench-context:templates"),
    ).toBeNull();
    expect(window.sessionStorage.getItem("unrelated")).toBe("keep");
  });

  it("degrades to empty context when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() =>
      writeWorkbenchContext("review", { workspaceId }),
    ).not.toThrow();
    expect(readWorkbenchContext("review").workspaceId).toBe("");
  });
});
