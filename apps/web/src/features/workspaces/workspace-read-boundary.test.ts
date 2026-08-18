import { describe, expect, it } from "vitest";

import { LogionApiError } from "@/lib/api/client";

import {
  detailStatusMessage,
  isMemberReadDenied,
  isMemberReadUsable,
  type Member,
  MEMBER_READ_DENIED_NOTICE,
  memberReadForSelected,
  type MemberReadState,
  memberReadStateFrom,
  shouldReadMembers,
  type Space,
  spaceReadForSelected,
  type SpaceReadState,
  spaceReadStateFrom,
} from "./workspace-read-boundary";

const spaceFixture: Space = {
  created_at: "2026-08-12T00:00:00Z",
  id: "space-a",
  name: "空间 A",
  owner_user_id: null,
  status: "active",
  updated_at: "2026-08-12T00:00:00Z",
  version: 1,
  visibility: "shared",
  workspace_id: "workspace-a",
};

const memberFixture: Member = {
  created_at: "2026-08-12T00:00:00Z",
  email: "member@example.com",
  id: "member-a",
  joined_at: "2026-08-12T00:00:00Z",
  revoked_at: null,
  role: "viewer",
  status: "active",
  updated_at: "2026-08-12T00:00:00Z",
  user_id: "member-a-user",
  version: 1,
};

function apiError(status: number): LogionApiError {
  return new LogionApiError({
    code: "WORKSPACE_REQUEST_FAILED",
    message: "The workspace request failed.",
    requestId: `req-${status}`,
    retryable: status >= 500,
    status,
  });
}

describe("shouldReadMembers", () => {
  it("reads members only for the collaboration view", () => {
    expect(shouldReadMembers("collaboration")).toBe(true);
    expect(shouldReadMembers("knowledge")).toBe(false);
  });
});

describe("isMemberReadDenied", () => {
  it("detects only 403 API errors", () => {
    expect(isMemberReadDenied(apiError(403))).toBe(true);
    expect(isMemberReadDenied(apiError(409))).toBe(false);
    expect(isMemberReadDenied(apiError(503))).toBe(false);
    expect(isMemberReadDenied(new Error("offline"))).toBe(false);
  });
});

describe("spaceReadStateFrom", () => {
  it("normalizes a successful payload for the requesting workspace", () => {
    expect(
      spaceReadStateFrom("workspace-a", {
        ok: true,
        data: { spaces: [spaceFixture] },
      }),
    ).toEqual({
      phase: "ready",
      spaces: [spaceFixture],
      workspaceId: "workspace-a",
    });
  });

  it("tolerates non-array payloads without inventing spaces", () => {
    expect(
      spaceReadStateFrom("workspace-a", {
        ok: true,
        data: { spaces: "corrupt" as unknown as Space[] },
      }),
    ).toEqual({ phase: "ready", spaces: [], workspaceId: "workspace-a" });
  });

  it("maps failures to an error state with a generic message", () => {
    const state = spaceReadStateFrom("workspace-a", {
      ok: false,
      error: apiError(503),
    });
    expect(state.phase).toBe("error");
    expect(state).toEqual({
      phase: "error",
      message: "服务暂时不可用，请稍后重试；现有数据未发生变化。",
      workspaceId: "workspace-a",
    });
  });
});

describe("memberReadStateFrom", () => {
  it("skips members in the knowledge view even if an outcome leaks in", () => {
    expect(
      memberReadStateFrom("knowledge", "workspace-a", {
        ok: true,
        data: { members: [memberFixture] },
      }),
    ).toEqual({ phase: "skipped", workspaceId: "workspace-a" });
    expect(memberReadStateFrom("knowledge", "workspace-a", null)).toEqual({
      phase: "skipped",
      workspaceId: "workspace-a",
    });
  });

  it("marks 403 failures as denied without member data", () => {
    expect(
      memberReadStateFrom("collaboration", "workspace-a", {
        ok: false,
        error: apiError(403),
      }),
    ).toEqual({ phase: "denied", workspaceId: "workspace-a" });
  });

  it("keeps non-403 failures as recoverable errors", () => {
    expect(
      memberReadStateFrom("collaboration", "workspace-a", {
        ok: false,
        error: new Error("offline"),
      }),
    ).toEqual({
      phase: "error",
      message: "操作未完成，请检查网络后重试。",
      workspaceId: "workspace-a",
    });
  });

  it("normalizes non-array member payloads", () => {
    expect(
      memberReadStateFrom("collaboration", "workspace-a", {
        ok: true,
        data: { members: "corrupt" as unknown as Member[] },
      }),
    ).toEqual({ phase: "ready", members: [], workspaceId: "workspace-a" });
  });
});

describe("spaceReadForSelected", () => {
  it("keeps states that belong to the selected workspace", () => {
    const state: SpaceReadState = {
      phase: "ready",
      spaces: [spaceFixture],
      workspaceId: "workspace-a",
    };
    expect(spaceReadForSelected(state, "workspace-a")).toBe(state);
    expect(spaceReadForSelected({ phase: "idle" }, "workspace-a")).toEqual({
      phase: "idle",
    });
  });

  it("invalidates states from another workspace immediately", () => {
    expect(
      spaceReadForSelected(
        {
          phase: "ready",
          spaces: [spaceFixture],
          workspaceId: "workspace-a",
        },
        "workspace-b",
      ),
    ).toEqual({ phase: "idle" });
    expect(
      spaceReadForSelected(
        { phase: "loading", workspaceId: "workspace-a" },
        null,
      ),
    ).toEqual({ phase: "idle" });
  });
});

describe("memberReadForSelected", () => {
  it("keeps states that belong to the selected workspace", () => {
    const state: MemberReadState = {
      phase: "ready",
      members: [memberFixture],
      workspaceId: "workspace-a",
    };
    expect(memberReadForSelected(state, "workspace-a")).toBe(state);
  });

  it("invalidates states from another workspace immediately", () => {
    expect(
      memberReadForSelected(
        {
          phase: "ready",
          members: [memberFixture],
          workspaceId: "workspace-a",
        },
        "workspace-b",
      ),
    ).toEqual({ phase: "idle" });
    expect(
      memberReadForSelected(
        { phase: "denied", workspaceId: "workspace-a" },
        null,
      ),
    ).toEqual({ phase: "idle" });
  });
});

describe("isMemberReadUsable", () => {
  const readyState: MemberReadState = {
    phase: "ready",
    members: [memberFixture],
    workspaceId: "workspace-a",
  };

  it("requires collaboration, a ready read, and a matching workspace", () => {
    expect(isMemberReadUsable("collaboration", readyState, "workspace-a")).toBe(
      true,
    );
  });

  it("rejects the knowledge view regardless of the read state", () => {
    expect(isMemberReadUsable("knowledge", readyState, "workspace-a")).toBe(
      false,
    );
  });

  it("rejects reads that belong to another workspace", () => {
    expect(isMemberReadUsable("collaboration", readyState, "workspace-b")).toBe(
      false,
    );
    expect(isMemberReadUsable("collaboration", readyState, null)).toBe(false);
  });

  it("rejects non-ready phases", () => {
    expect(
      isMemberReadUsable(
        "collaboration",
        { phase: "denied", workspaceId: "workspace-a" },
        "workspace-a",
      ),
    ).toBe(false);
    expect(isMemberReadUsable("collaboration", { phase: "idle" }, null)).toBe(
      false,
    );
  });
});

describe("detailStatusMessage", () => {
  it("prioritizes the space error over member notices", () => {
    expect(
      detailStatusMessage(
        {
          phase: "error",
          message: "空间读取失败。",
          workspaceId: "workspace-a",
        },
        { phase: "denied", workspaceId: "workspace-a" },
      ),
    ).toBe("空间读取失败。");
  });

  it("summarizes a denied member read without leaking data", () => {
    expect(
      detailStatusMessage(
        { phase: "ready", spaces: [], workspaceId: "workspace-a" },
        { phase: "denied", workspaceId: "workspace-a" },
      ),
    ).toBe("工作区内容已更新；当前账号没有查看成员列表的权限。");
  });

  it("appends member errors to the space success status", () => {
    expect(
      detailStatusMessage(
        { phase: "ready", spaces: [], workspaceId: "workspace-a" },
        {
          phase: "error",
          message: "操作未完成，请检查网络后重试。",
          workspaceId: "workspace-a",
        },
      ),
    ).toBe("工作区内容已更新；操作未完成，请检查网络后重试。");
  });

  it("reports a plain success when both reads settle", () => {
    expect(
      detailStatusMessage(
        { phase: "ready", spaces: [], workspaceId: "workspace-a" },
        { phase: "ready", members: [], workspaceId: "workspace-a" },
      ),
    ).toBe("工作区内容已更新。");
  });
});

describe("MEMBER_READ_DENIED_NOTICE", () => {
  it("does not leak member counts or emails", () => {
    expect(MEMBER_READ_DENIED_NOTICE).not.toMatch(/\d/);
    expect(MEMBER_READ_DENIED_NOTICE).not.toMatch(/@/);
  });
});
