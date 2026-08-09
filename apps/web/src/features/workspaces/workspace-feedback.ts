import { LogionApiError } from "@/lib/api/client";

export type WorkspaceAction = "invite" | "space" | "workspace";

const validationMessages: Readonly<Record<WorkspaceAction, string>> = {
  invite: "请检查邮箱与角色后重试。",
  space: "请检查空间名称与可见性后重试。",
  workspace: "请检查工作区名称后重试。",
};

export function workspaceActionError(
  error: unknown,
  action: WorkspaceAction,
): string {
  if (!(error instanceof LogionApiError)) {
    return "操作未完成，请检查网络后重试。";
  }
  if (error.code === "INVITATION_CONFLICT") {
    return "该邮箱已是当前工作区成员，或已有待处理邀请，无需重复发送。";
  }
  if (error.code === "VALIDATION_ERROR" || error.status === 422) {
    return validationMessages[action];
  }
  if (error.status === 403) {
    return "当前账号没有执行此操作的权限。";
  }
  if (error.status === 429) {
    return "操作过于频繁，请稍后再试。";
  }
  if (error.retryable || error.status >= 500 || error.status === 0) {
    return "服务暂时不可用，请稍后重试；现有数据未发生变化。";
  }
  return `操作未完成（请求编号：${error.requestId}）。`;
}
