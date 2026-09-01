import { describe, expect, it } from "vitest";

import {
  filterSearchResults,
  groupSearchResults,
  SEARCH_COMMAND_KEYS,
  searchResultRoute,
  shouldApplySearchResponse,
  type SearchDisplayResult,
} from "./use-search-controller";

function result(
  id: string,
  objectType: SearchDisplayResult["object_type"],
  permissionSource: SearchDisplayResult["permission_source"],
): SearchDisplayResult {
  return {
    object_id: id,
    object_type: objectType,
    permission_source: permissionSource,
    snippet: `${id} snippet`,
    space_id: "space-1",
    title: id,
    updated_at: "2026-08-26T00:00:00.000Z",
    workspace_id: "workspace-1",
  };
}

describe("Search controller contract", () => {
  it("keeps every formal search, notification and calendar command reachable", () => {
    expect(SEARCH_COMMAND_KEYS).toEqual([
      "createFeed",
      "loadContext",
      "markRead",
      "resetSearch",
      "revokeFeed",
      "savePreferences",
      "search",
      "selectResult",
      "setWorkspaceId",
      "unlock",
    ]);
  });

  it("filters server permission scopes without inventing object types", () => {
    const results = [
      result("private", "note", "private_owner"),
      result("personal", "task", "personal_record"),
      result("shared", "paper", "shared_space"),
      result("offline", "resource", "offline_cache"),
    ];

    expect(
      filterSearchResults(results, "private").map((item) => item.object_id),
    ).toEqual(["private", "personal"]);
    expect(
      filterSearchResults(results, "shared").map((item) => item.object_id),
    ).toEqual(["shared"]);
    expect(groupSearchResults(results).map((group) => group.type)).toEqual([
      "task",
      "note",
      "resource",
      "paper",
    ]);
  });

  it("rejects stale responses after either query or Workspace changes", () => {
    expect(shouldApplySearchResponse(4, 4, "workspace-1", "workspace-1")).toBe(
      true,
    );
    expect(shouldApplySearchResponse(3, 4, "workspace-1", "workspace-1")).toBe(
      false,
    );
    expect(shouldApplySearchResponse(4, 4, "workspace-1", "workspace-2")).toBe(
      false,
    );
  });

  it("maps formal object types to their existing product routes", () => {
    expect(searchResultRoute("goal")).toBe("/app/planning");
    expect(searchResultRoute("task")).toBe("/app/today");
    expect(searchResultRoute("note")).toBe("/app/records");
    expect(searchResultRoute("resource")).toBe("/app/records");
    expect(searchResultRoute("paper")).toBe("/app/research");
  });
});
