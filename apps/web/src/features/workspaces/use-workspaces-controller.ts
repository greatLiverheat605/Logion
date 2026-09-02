"use client";

import type { components } from "@logion/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import { browserApiClient, LogionApiError } from "@/lib/api/client";

export type Workspace = components["schemas"]["WorkspaceResponse"];
export type Space = components["schemas"]["SpaceResponse"];
export type Member = components["schemas"]["WorkspaceMemberResponse"];
export type Invitation =
  components["schemas"]["WorkspaceInvitationCreatedResponse"];

export type WorkspaceRole = Workspace["role"];
export type SpaceVisibility = Space["visibility"];

function errorText(error: unknown) {
  if (error instanceof LogionApiError) {
    return `操作未完成（${error.code}，请求编号：${error.requestId}）。`;
  }
  return "操作未完成；既有数据未改变，请稍后重试。";
}

function canManageMembers(role: WorkspaceRole | undefined) {
  return role === "owner" || role === "admin";
}

function canCreateSharedSpace(role: WorkspaceRole | undefined) {
  return role === "owner" || role === "admin" || role === "editor";
}

export interface WorkspaceWorkbenchController {
  capabilities: {
    canCreatePrivateSpace: boolean;
    canCreateSharedSpace: boolean;
    canInvite: boolean;
    canManageMembers: boolean;
    canTransferOwnership: boolean;
  };
  commands: {
    createSpace: (input: {
      name: string;
      visibility: SpaceVisibility;
    }) => Promise<boolean>;
    createWorkspace: (name: string) => Promise<boolean>;
    invite: (input: {
      email: string;
      role: Exclude<WorkspaceRole, "owner">;
    }) => Promise<boolean>;
    leaveWorkspace: () => Promise<boolean>;
    load: () => Promise<void>;
    revokeInvitation: (invitationId: string) => Promise<boolean>;
    selectSpace: (spaceId: string) => void;
    selectWorkspace: (workspaceId: string) => void;
    transferOwnership: (targetMembershipId: string) => Promise<boolean>;
    updateMember: (
      member: Member,
      input: {
        role?: Exclude<WorkspaceRole, "owner">;
        status?: "active" | "suspended" | "revoked";
      },
    ) => Promise<boolean>;
  };
  context: {
    selectedSpace: Space | null;
    selectedWorkspace: Workspace | null;
    spaces: Space[];
    status: string;
    workspaces: Workspace[];
  };
  invitations: Invitation[];
  loading: boolean;
  members: Member[];
}

export function useWorkspacesController(): WorkspaceWorkbenchController {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [selectedSpaceId, setSelectedSpaceId] = useState("");
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [status, setStatus] = useState("正在读取工作区上下文…");
  const [loading, setLoading] = useState(true);

  const selectedWorkspace = useMemo(
    () => workspaces.find((item) => item.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces],
  );
  const selectedSpace = useMemo(
    () => spaces.find((item) => item.id === selectedSpaceId) ?? null,
    [selectedSpaceId, spaces],
  );

  const loadDetails = useCallback(async (workspaceId: string) => {
    const [spaceResult, memberResult] = await Promise.all([
      browserApiClient.request<{ spaces: Space[] }>(
        `/api/v1/workspaces/${workspaceId}/spaces`,
      ),
      browserApiClient.request<{ members: Member[] }>(
        `/api/v1/workspaces/${workspaceId}/members`,
      ),
    ]);
    const nextSpaces = Array.isArray(spaceResult.spaces)
      ? spaceResult.spaces
      : [];
    setSpaces(nextSpaces);
    setMembers(Array.isArray(memberResult.members) ? memberResult.members : []);
    setSelectedSpaceId((current) =>
      nextSpaces.some((item) => item.id === current)
        ? current
        : (nextSpaces[0]?.id ?? ""),
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await browserApiClient.request<{
        workspaces: Workspace[];
      }>("/api/v1/workspaces");
      const nextWorkspaces = Array.isArray(result.workspaces)
        ? result.workspaces
        : [];
      setWorkspaces(nextWorkspaces);
      const nextWorkspaceId = nextWorkspaces.some(
        (item) => item.id === selectedWorkspaceId,
      )
        ? selectedWorkspaceId
        : (nextWorkspaces[0]?.id ?? "");
      setSelectedWorkspaceId(nextWorkspaceId);
      if (nextWorkspaceId) {
        await loadDetails(nextWorkspaceId);
        setStatus("工作区上下文已更新；成员和 Space 权限持续回显。");
      } else {
        setSpaces([]);
        setMembers([]);
        setStatus("还没有工作区，创建一个开始协作。");
      }
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setLoading(false);
    }
  }, [loadDetails, selectedWorkspaceId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const refreshSelected = useCallback(async () => {
    if (!selectedWorkspaceId) return;
    try {
      await loadDetails(selectedWorkspaceId);
      setStatus("工作区数据已刷新。");
    } catch (error) {
      setStatus(errorText(error));
    }
  }, [loadDetails, selectedWorkspaceId]);

  async function createWorkspace(name: string) {
    const normalized = name.trim();
    if (!normalized) return false;
    try {
      await browserApiClient.request("/api/v1/workspaces", {
        body: JSON.stringify({ name: normalized }),
        csrf: true,
        method: "POST",
      });
      await load();
      setStatus("工作区已创建。");
      return true;
    } catch (error) {
      setStatus(errorText(error));
      return false;
    }
  }

  async function createSpace(input: {
    name: string;
    visibility: SpaceVisibility;
  }) {
    if (!selectedWorkspaceId || !input.name.trim()) return false;
    try {
      await browserApiClient.request(
        `/api/v1/workspaces/${selectedWorkspaceId}/spaces`,
        {
          body: JSON.stringify({
            name: input.name.trim(),
            visibility: input.visibility,
          }),
          csrf: true,
          method: "POST",
        },
      );
      await refreshSelected();
      setStatus("Space 已创建，访问边界已经回显。");
      return true;
    } catch (error) {
      setStatus(errorText(error));
      return false;
    }
  }

  async function invite(input: {
    email: string;
    role: Exclude<WorkspaceRole, "owner">;
  }) {
    if (!selectedWorkspaceId || !input.email.trim()) return false;
    try {
      const result = await browserApiClient.request<Invitation>(
        `/api/v1/workspaces/${selectedWorkspaceId}/invitations`,
        {
          body: JSON.stringify({ email: input.email.trim(), role: input.role }),
          csrf: true,
          method: "POST",
        },
      );
      setInvitations((current) => [result, ...current]);
      setStatus("邀请已创建；出于安全原因，Token 只在本次响应中可见。");
      return true;
    } catch (error) {
      setStatus(errorText(error));
      return false;
    }
  }

  async function revokeInvitation(invitationId: string) {
    const invitation = invitations.find((item) => item.id === invitationId);
    if (!selectedWorkspaceId || !invitation) return false;
    try {
      await browserApiClient.request(
        `/api/v1/workspaces/${selectedWorkspaceId}/invitations/${invitation.id}`,
        { csrf: true, method: "DELETE" },
      );
      setInvitations((current) =>
        current.map((item) =>
          item.id === invitationId ? { ...item, status: "revoked" } : item,
        ),
      );
      setStatus("邀请已撤销；该 Token 立即失效。");
      return true;
    } catch (error) {
      setStatus(errorText(error));
      return false;
    }
  }

  async function updateMember(
    member: Member,
    input: {
      role?: Exclude<WorkspaceRole, "owner">;
      status?: "active" | "suspended" | "revoked";
    },
  ) {
    if (!selectedWorkspaceId) return false;
    try {
      await browserApiClient.request(
        `/api/v1/workspaces/${selectedWorkspaceId}/members/${member.id}/update`,
        {
          body: JSON.stringify({ expected_version: member.version, ...input }),
          csrf: true,
          method: "POST",
        },
      );
      await refreshSelected();
      return true;
    } catch (error) {
      setStatus(errorText(error));
      return false;
    }
  }

  async function transferOwnership(targetMembershipId: string) {
    const owner = members.find((item) => item.role === "owner");
    if (!selectedWorkspace || !owner || !targetMembershipId) return false;
    try {
      await browserApiClient.request(
        `/api/v1/workspaces/${selectedWorkspace.id}/ownership/transfer`,
        {
          body: JSON.stringify({
            expected_current_owner_version: owner.version,
            expected_target_version:
              members.find((item) => item.id === targetMembershipId)?.version ??
              1,
            expected_workspace_version: selectedWorkspace.version,
            previous_owner_role: "admin",
            target_membership_id: targetMembershipId,
          }),
          csrf: true,
          method: "POST",
        },
      );
      await load();
      setStatus("所有权已转移；当前角色和权限已刷新。");
      return true;
    } catch (error) {
      setStatus(errorText(error));
      return false;
    }
  }

  async function leaveWorkspace() {
    const currentMember = members.find((item) => item.role !== "owner");
    if (!selectedWorkspaceId || !currentMember) return false;
    try {
      await browserApiClient.request(
        `/api/v1/workspaces/${selectedWorkspaceId}/members/me/leave`,
        {
          body: JSON.stringify({ expected_version: currentMember.version }),
          csrf: true,
          method: "POST",
        },
      );
      await load();
      setStatus("已离开工作区；服务器数据未被删除。");
      return true;
    } catch (error) {
      setStatus(errorText(error));
      return false;
    }
  }

  function selectWorkspace(workspaceId: string) {
    if (workspaceId === selectedWorkspaceId) return;
    setSelectedWorkspaceId(workspaceId);
    setSelectedSpaceId("");
    setSpaces([]);
    setMembers([]);
    setStatus("正在切换工作区…");
    queueMicrotask(() => {
      void loadDetails(workspaceId).catch((error: unknown) =>
        setStatus(errorText(error)),
      );
    });
  }

  const role = selectedWorkspace?.role;
  return {
    capabilities: {
      canCreatePrivateSpace: Boolean(role),
      canCreateSharedSpace: canCreateSharedSpace(role),
      canInvite: canManageMembers(role),
      canManageMembers: canManageMembers(role),
      canTransferOwnership: role === "owner",
    },
    commands: {
      createSpace,
      createWorkspace,
      invite,
      leaveWorkspace,
      load,
      revokeInvitation,
      selectSpace: setSelectedSpaceId,
      selectWorkspace,
      transferOwnership,
      updateMember,
    },
    context: {
      selectedSpace,
      selectedWorkspace,
      spaces,
      status,
      workspaces,
    },
    invitations,
    loading,
    members,
  };
}
