import type { components } from "@logion/contracts";

import { LogionApiError } from "@/lib/api/client";

import { workspaceActionError } from "./workspace-feedback";

export type Space = components["schemas"]["SpaceResponse"];
export type Member = components["schemas"]["WorkspaceMemberResponse"];

export type WorkspaceCenterView = "collaboration" | "knowledge";

export type SpaceReadState =
  | { phase: "idle" }
  | { phase: "loading"; workspaceId: string }
  | { phase: "ready"; workspaceId: string; spaces: Space[] }
  | { phase: "error"; workspaceId: string; message: string };

export type MemberReadState =
  | { phase: "idle" }
  | { phase: "loading"; workspaceId: string }
  | { phase: "skipped"; workspaceId: string }
  | { phase: "ready"; workspaceId: string; members: Member[] }
  | { phase: "denied"; workspaceId: string }
  | { phase: "error"; workspaceId: string; message: string };

export type DetailRequestOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; error: unknown };

export type SpaceRequestOutcome = DetailRequestOutcome<{ spaces: Space[] }>;
export type MemberRequestOutcome = DetailRequestOutcome<{ members: Member[] }>;

export type DetailLoadResult = {
  applied: boolean;
  spacesLoaded: boolean;
  membersLoaded: boolean | null;
};

export const MEMBER_READ_DENIED_NOTICE =
  "当前账号没有查看成员列表的权限，成员信息不会在此显示。";
export const MEMBER_READ_SKIPPED_NOTICE =
  "当前视图不读取成员信息；成员与邀请请在协作视图处理。";
const MEMBER_READ_DENIED_STATUS =
  "工作区内容已更新；当前账号没有查看成员列表的权限。";

export function shouldReadMembers(view: WorkspaceCenterView): boolean {
  return view === "collaboration";
}

export function isMemberReadDenied(error: unknown): boolean {
  return error instanceof LogionApiError && error.status === 403;
}

export function spaceReadStateFrom(
  workspaceId: string,
  outcome: SpaceRequestOutcome,
): SpaceReadState {
  if (outcome.ok) {
    return {
      phase: "ready",
      workspaceId,
      spaces: Array.isArray(outcome.data.spaces) ? outcome.data.spaces : [],
    };
  }
  return {
    phase: "error",
    workspaceId,
    message: workspaceActionError(outcome.error, "space"),
  };
}

export function memberReadStateFrom(
  view: WorkspaceCenterView,
  workspaceId: string,
  outcome: MemberRequestOutcome | null,
): MemberReadState {
  if (!shouldReadMembers(view) || outcome === null) {
    return { phase: "skipped", workspaceId };
  }
  if (outcome.ok) {
    return {
      phase: "ready",
      workspaceId,
      members: Array.isArray(outcome.data.members) ? outcome.data.members : [],
    };
  }
  if (isMemberReadDenied(outcome.error)) {
    return { phase: "denied", workspaceId };
  }
  return {
    phase: "error",
    workspaceId,
    message: workspaceActionError(outcome.error, "member"),
  };
}

export function spaceReadForSelected(
  state: SpaceReadState,
  selected: string | null,
): SpaceReadState {
  if (state.phase === "idle" || state.workspaceId === selected) {
    return state;
  }
  return { phase: "idle" };
}

export function memberReadForSelected(
  state: MemberReadState,
  selected: string | null,
): MemberReadState {
  if (state.phase === "idle" || state.workspaceId === selected) {
    return state;
  }
  return { phase: "idle" };
}

export function isMemberReadUsable(
  view: WorkspaceCenterView,
  state: MemberReadState,
  selected: string | null,
): boolean {
  return (
    view === "collaboration" &&
    state.phase === "ready" &&
    state.workspaceId === selected
  );
}

export function detailStatusMessage(
  spaceRead: SpaceReadState,
  memberRead: MemberReadState,
): string {
  if (spaceRead.phase === "error") return spaceRead.message;
  if (memberRead.phase === "denied") return MEMBER_READ_DENIED_STATUS;
  if (memberRead.phase === "error") {
    return `工作区内容已更新；${memberRead.message}`;
  }
  return "工作区内容已更新。";
}
