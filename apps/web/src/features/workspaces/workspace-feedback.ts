import { LogionApiError } from "@/lib/api/client";

export type WorkspaceAction = "invite" | "member" | "space" | "workspace";

const validationMessages: Readonly<Record<WorkspaceAction, string>> = {
  invite: "请检查邮箱与角色后重试。",
  member: "请刷新成员状态后重新选择角色。",
  space: "请检查空间名称与可见性后重试。",
  workspace: "请检查工作区名称后重试。",
};

const ACTIVE_MEMBER_CONFLICT =
  "The account is already an active Workspace member.";
const PENDING_INVITATION_CONFLICT =
  "A pending invitation already exists for this account.";

export function workspaceInvitationConflictDetail(error: unknown): string {
  if (!(error instanceof LogionApiError) || error.status !== 409) {
    return "成员或邀请状态未能确认。请刷新后重试。";
  }
  if (error.message === ACTIVE_MEMBER_CONFLICT) {
    return "该邮箱已是当前工作区成员。请刷新成员列表，直接调整现有成员角色。";
  }
  if (error.message === PENDING_INVITATION_CONFLICT) {
    return "该邮箱已有待处理邀请。请等待对方处理，或调整角色后再确认。";
  }
  return "成员或邀请状态已在远端变化。请刷新当前状态后再决定是否重试。";
}

export function workspaceActionError(
  error: unknown,
  action: WorkspaceAction,
): string {
  if (!(error instanceof LogionApiError)) {
    return "操作未完成，请检查网络后重试。";
  }
  if (error.code === "INVITATION_CONFLICT") {
    return workspaceInvitationConflictDetail(error);
  }
  if (error.status === 409 && action === "member") {
    return "成员状态已在远端变化；当前选择未保存，请刷新后重试。";
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
