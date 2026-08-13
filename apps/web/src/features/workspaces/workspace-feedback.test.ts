import { describe, expect, it } from "vitest";

import { LogionApiError } from "@/lib/api/client";

import {
  workspaceActionError,
  workspaceInvitationConflictDetail,
} from "./workspace-feedback";

function apiError(
  input: Partial<ConstructorParameters<typeof LogionApiError>[0]>,
) {
  return new LogionApiError({
    code: "UNKNOWN",
    message: "internal detail",
    requestId: "request-123",
    status: 400,
    ...input,
  });
}

describe("workspaceActionError", () => {
  it("turns invitation conflicts into an actionable message", () => {
    expect(
      workspaceActionError(
        apiError({ code: "INVITATION_CONFLICT", status: 409 }),
        "invite",
      ),
    ).toBe("成员或邀请状态已在远端变化。请刷新当前状态后再决定是否重试。");
  });

  it("distinguishes the two safe invitation conflict reasons", () => {
    expect(
      workspaceInvitationConflictDetail(
        apiError({
          code: "INVITATION_CONFLICT",
          message: "The account is already an active Workspace member.",
          status: 409,
        }),
      ),
    ).toContain("已是当前工作区成员");
    expect(
      workspaceInvitationConflictDetail(
        apiError({
          code: "INVITATION_CONFLICT",
          message: "A pending invitation already exists for this account.",
          status: 409,
        }),
      ),
    ).toContain("已有待处理邀请");
  });

  it("does not expose unknown conflict details", () => {
    expect(
      workspaceInvitationConflictDetail(
        apiError({
          code: "INVITATION_CONFLICT",
          message: "sensitive server detail",
          status: 409,
        }),
      ),
    ).not.toContain("sensitive server detail");
  });

  it("tells member role conflicts to refresh without claiming success", () => {
    expect(workspaceActionError(apiError({ status: 409 }), "member")).toBe(
      "成员状态已在远端变化；当前选择未保存，请刷新后重试。",
    );
  });

  it("uses action-specific validation messages", () => {
    const error = apiError({ code: "VALIDATION_ERROR", status: 422 });
    expect(workspaceActionError(error, "workspace")).toBe(
      "请检查工作区名称后重试。",
    );
    expect(workspaceActionError(error, "space")).toBe(
      "请检查空间名称与可见性后重试。",
    );
  });

  it("does not expose server error details", () => {
    expect(
      workspaceActionError(
        apiError({ code: "UNEXPECTED", message: "sensitive server detail" }),
        "space",
      ),
    ).toBe("操作未完成（请求编号：request-123）。");
  });
});
