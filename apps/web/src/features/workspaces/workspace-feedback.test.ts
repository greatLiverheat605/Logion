import { describe, expect, it } from "vitest";

import { LogionApiError } from "@/lib/api/client";

import { workspaceActionError } from "./workspace-feedback";

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
    ).toBe("该邮箱已是当前工作区成员，或已有待处理邀请，无需重复发送。");
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
