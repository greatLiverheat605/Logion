"use client";

import type { components } from "@logion/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { browserApiClient, LogionApiError } from "@/lib/api/client";

type Workspace = components["schemas"]["WorkspaceResponse"];
type Space = components["schemas"]["SpaceResponse"];
type Member = components["schemas"]["WorkspaceMemberResponse"];

function errorText(error: unknown) {
  return error instanceof LogionApiError
    ? `操作未完成（请求编号：${error.requestId}）`
    : "操作未完成，请稍后重试。";
}

export function WorkspaceCenter() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [status, setStatus] = useState("正在读取工作区…");

  const loadWorkspaces = useCallback(async () => {
    try {
      const result = await browserApiClient.request<{
        workspaces: Workspace[];
      }>("/api/v1/workspaces");
      const next = Array.isArray(result.workspaces) ? result.workspaces : [];
      setWorkspaces(next);
      setSelected((current) => current ?? next[0]?.id ?? null);
      setStatus(
        next.length ? "工作区已更新。" : "创建第一个工作区以开始协作。",
      );
    } catch (error) {
      setStatus(errorText(error));
    }
  }, []);

  const loadDetails = useCallback(async (workspaceId: string) => {
    try {
      const [spaceResult, memberResult] = await Promise.all([
        browserApiClient.request<{ spaces: Space[] }>(
          `/api/v1/workspaces/${workspaceId}/spaces`,
        ),
        browserApiClient.request<{ members: Member[] }>(
          `/api/v1/workspaces/${workspaceId}/members`,
        ),
      ]);
      setSpaces(Array.isArray(spaceResult.spaces) ? spaceResult.spaces : []);
      setMembers(
        Array.isArray(memberResult.members) ? memberResult.members : [],
      );
    } catch (error) {
      setSpaces([]);
      setMembers([]);
      setStatus(errorText(error));
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadWorkspaces());
  }, [loadWorkspaces]);
  useEffect(() => {
    if (selected) queueMicrotask(() => void loadDetails(selected));
  }, [loadDetails, selected]);

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await browserApiClient.request("/api/v1/workspaces", {
        method: "POST",
        csrf: true,
        body: JSON.stringify({
          name: String(new FormData(form).get("name") ?? ""),
        }),
      });
      form.reset();
      await loadWorkspaces();
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  async function createSpace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await browserApiClient.request(`/api/v1/workspaces/${selected}/spaces`, {
        method: "POST",
        csrf: true,
        body: JSON.stringify({
          name: String(data.get("name") ?? ""),
          visibility:
            data.get("visibility") === "shared" ? "shared" : "private",
        }),
      });
      form.reset();
      await loadDetails(selected);
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await browserApiClient.request(
        `/api/v1/workspaces/${selected}/invitations`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify({
            email: String(data.get("email") ?? ""),
            role: String(data.get("role") ?? "viewer"),
          }),
        },
      );
      form.reset();
      setStatus("邀请已创建；投递状态由服务端处理。");
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  async function updateMember(member: Member, role: string) {
    if (!selected) return;
    try {
      await browserApiClient.request(
        `/api/v1/workspaces/${selected}/members/${member.id}/update`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify({ expected_version: member.version, role }),
        },
      );
      await loadDetails(selected);
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  return (
    <main id="main-content" className="settings-page">
      <header>
        <p className="eyebrow">LOGION · WORKSPACES</p>
        <h1>工作区与空间</h1>
        <p aria-live="polite">{status}</p>
      </header>
      <section className="settings-card">
        <h2>工作区</h2>
        <form className="inline-form" onSubmit={createWorkspace}>
          <label htmlFor="workspace-name">新工作区名称</label>
          <input id="workspace-name" name="name" maxLength={120} required />
          <button>创建</button>
        </form>
        <label htmlFor="workspace-select">当前工作区</label>
        <select
          id="workspace-select"
          value={selected ?? ""}
          onChange={(event) => setSelected(event.target.value || null)}
        >
          {workspaces.map((workspace) => (
            <option value={workspace.id} key={workspace.id}>
              {workspace.name} · {workspace.role}
            </option>
          ))}
        </select>
      </section>
      {selected ? (
        <>
          <section className="settings-card">
            <h2>空间</h2>
            <form className="inline-form" onSubmit={createSpace}>
              <label htmlFor="space-name">空间名称</label>
              <input id="space-name" name="name" maxLength={120} required />
              <label htmlFor="space-visibility">可见性</label>
              <select id="space-visibility" name="visibility">
                <option value="private">仅自己</option>
                <option value="shared">工作区共享</option>
              </select>
              <button>创建空间</button>
            </form>
            <ul className="item-list">
              {spaces.map((space) => (
                <li key={space.id}>
                  <span>
                    <strong>{space.name}</strong>
                    <small>
                      {space.visibility === "private" ? "私有" : "共享"}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="settings-card">
            <h2>成员与邀请</h2>
            <form className="inline-form" onSubmit={invite}>
              <label htmlFor="invite-email">邮箱</label>
              <input id="invite-email" name="email" type="email" required />
              <label htmlFor="invite-role">角色</label>
              <select id="invite-role" name="role">
                <option value="viewer">查看者</option>
                <option value="reviewer">审查者</option>
                <option value="contributor">贡献者</option>
                <option value="editor">编辑者</option>
                <option value="admin">管理员</option>
              </select>
              <button>发送邀请</button>
            </form>
            <ul className="item-list">
              {members.map((member) => (
                <li key={member.id}>
                  <span>
                    <strong>{member.email}</strong>
                    <small>{member.status}</small>
                  </span>
                  {member.role === "owner" ? (
                    <strong>所有者</strong>
                  ) : (
                    <select
                      aria-label={`修改 ${member.email} 的角色`}
                      value={member.role}
                      onChange={(event) =>
                        void updateMember(member, event.target.value)
                      }
                    >
                      <option value="viewer">viewer</option>
                      <option value="reviewer">reviewer</option>
                      <option value="contributor">contributor</option>
                      <option value="editor">editor</option>
                      <option value="admin">admin</option>
                    </select>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </main>
  );
}
