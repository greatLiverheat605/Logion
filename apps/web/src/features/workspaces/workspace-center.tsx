"use client";

import type { components } from "@logion/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  ProductDisclosure,
  ProductEmptyState,
  ProductHero,
  ProductMetric,
  ProductPageHeader,
  ProductPanel,
  ProductTag,
} from "@/components/product/product-ui";
import { InlineFormFeedback } from "@/components/product/inline-form-feedback";
import { browserApiClient } from "@/lib/api/client";

import {
  type WorkspaceAction,
  workspaceActionError,
} from "./workspace-feedback";

type Workspace = components["schemas"]["WorkspaceResponse"];
type Space = components["schemas"]["SpaceResponse"];
type Member = components["schemas"]["WorkspaceMemberResponse"];

type PendingAction = WorkspaceAction | "member" | null;
type FormFeedback = {
  message: string;
  tone: "error" | "loading" | "success";
};

function fieldValue(form: HTMLFormElement, name: string): string {
  return String(new FormData(form).get(name) ?? "").trim();
}

function invalidInputMessage(action: WorkspaceAction): string {
  if (action === "invite") return "请输入有效邮箱，例如 name@example.com。";
  if (action === "space") return "请输入空间名称。";
  return "请输入工作区名称。";
}

export function WorkspaceCenter() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [status, setStatus] = useState("正在读取工作区…");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [workspaceFeedback, setWorkspaceFeedback] =
    useState<FormFeedback | null>(null);
  const [spaceFeedback, setSpaceFeedback] = useState<FormFeedback | null>(null);
  const [inviteFeedback, setInviteFeedback] = useState<FormFeedback | null>(
    null,
  );

  const loadWorkspaces = useCallback(async (): Promise<boolean> => {
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
      return true;
    } catch (error) {
      setStatus(workspaceActionError(error, "workspace"));
      return false;
    }
  }, []);

  const loadDetails = useCallback(
    async (workspaceId: string): Promise<boolean> => {
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
        setStatus("工作区内容已更新。");
        return true;
      } catch (error) {
        setSpaces([]);
        setMembers([]);
        setStatus(workspaceActionError(error, "space"));
        return false;
      }
    },
    [],
  );

  useEffect(() => {
    queueMicrotask(() => void loadWorkspaces());
  }, [loadWorkspaces]);
  useEffect(() => {
    if (selected) queueMicrotask(() => void loadDetails(selected));
  }, [loadDetails, selected]);

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setWorkspaceFeedback(null);
    const name = fieldValue(form, "name");
    if (!name) {
      setWorkspaceFeedback({
        message: invalidInputMessage("workspace"),
        tone: "error",
      });
      return;
    }
    setPendingAction("workspace");
    setWorkspaceFeedback({ message: "正在创建工作区…", tone: "loading" });
    try {
      await browserApiClient.request("/api/v1/workspaces", {
        method: "POST",
        csrf: true,
        body: JSON.stringify({
          name,
        }),
      });
      form.reset();
      const refreshed = await loadWorkspaces();
      setWorkspaceFeedback({
        message: refreshed
          ? "工作区已创建。"
          : "工作区已创建，但列表刷新失败，请稍后重试。",
        tone: refreshed ? "success" : "error",
      });
      if (refreshed) setStatus("工作区已创建。");
    } catch (error) {
      const message = workspaceActionError(error, "workspace");
      setWorkspaceFeedback({ message, tone: "error" });
      setStatus(message);
    } finally {
      setPendingAction(null);
    }
  }

  async function createSpace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    setSpaceFeedback(null);
    const name = fieldValue(form, "name");
    if (!name) {
      setSpaceFeedback({
        message: invalidInputMessage("space"),
        tone: "error",
      });
      return;
    }
    const data = new FormData(form);
    setPendingAction("space");
    setSpaceFeedback({ message: "正在创建空间…", tone: "loading" });
    try {
      await browserApiClient.request(`/api/v1/workspaces/${selected}/spaces`, {
        method: "POST",
        csrf: true,
        body: JSON.stringify({
          name,
          visibility:
            data.get("visibility") === "shared" ? "shared" : "private",
        }),
      });
      form.reset();
      const refreshed = await loadDetails(selected);
      setSpaceFeedback({
        message: refreshed
          ? "空间已创建。"
          : "空间已创建，但列表刷新失败，请稍后重试。",
        tone: refreshed ? "success" : "error",
      });
      if (refreshed) setStatus("空间已创建。");
    } catch (error) {
      const message = workspaceActionError(error, "space");
      setSpaceFeedback({ message, tone: "error" });
      setStatus(message);
    } finally {
      setPendingAction(null);
    }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    setInviteFeedback(null);
    const emailInput = form.elements.namedItem("email");
    if (
      !(emailInput instanceof HTMLInputElement) ||
      !emailInput.validity.valid
    ) {
      setInviteFeedback({
        message: invalidInputMessage("invite"),
        tone: "error",
      });
      return;
    }
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim();
    setPendingAction("invite");
    setInviteFeedback({ message: "正在发送邀请…", tone: "loading" });
    try {
      await browserApiClient.request(
        `/api/v1/workspaces/${selected}/invitations`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify({
            email,
            role: String(data.get("role") ?? "viewer"),
          }),
        },
      );
      form.reset();
      setInviteFeedback({
        message: "邀请已创建，邮件投递状态由服务端处理。",
        tone: "success",
      });
      setStatus("邀请已创建；投递状态由服务端处理。");
    } catch (error) {
      const message = workspaceActionError(error, "invite");
      setInviteFeedback({ message, tone: "error" });
      setStatus(message);
    } finally {
      setPendingAction(null);
    }
  }

  async function updateMember(member: Member, role: string) {
    if (!selected) return;
    setPendingAction("member");
    setStatus("正在更新成员角色…");
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
      setStatus("成员角色已更新。");
    } catch (error) {
      setStatus(workspaceActionError(error, "invite"));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <main id="main-content" className="settings-page">
      <ProductPageHeader
        eyebrow="WORKSPACES · SPACES · MEMBERS"
        title="把个人内容和小组协作边界看清楚"
        description={
          <>
            <p>
              工作区承载成员与治理，Space
              决定实际内容可见性；管理员不自动读取私人 Space。
            </p>
            <p className="product-page-status" aria-live="polite">
              {status}
            </p>
          </>
        }
      />
      <ProductHero
        badge={<ProductTag tone="info">个人与小组协作</ProductTag>}
        title={
          workspaces.find((item) => item.id === selected)?.name ??
          "创建第一个工作区"
        }
        progressLabel="成员容量"
        progressValue={Math.min(100, (members.length / 10) * 100)}
      >
        私有空间只属于自己，共享空间供受邀成员协作；角色和权限继续沿用现有规则。
      </ProductHero>
      <div className="product-metric-grid">
        <ProductMetric
          label="工作区"
          value={workspaces.length}
          detail="可切换上下文"
          tone="info"
        />
        <ProductMetric
          label="空间"
          value={spaces.length}
          detail={`${spaces.filter((item) => item.visibility === "private").length} 个私有`}
        />
        <ProductMetric
          label="成员"
          value={members.length}
          detail="最多 10 人定位"
          tone="good"
        />
        <ProductMetric
          label="共享空间"
          value={spaces.filter((item) => item.visibility === "shared").length}
          detail="多人协作"
        />
      </div>

      <ProductDisclosure
        summary="创建或切换工作区"
        description="工作区承载成员和空间"
      >
        <form
          aria-busy={pendingAction === "workspace"}
          className="inline-form"
          onSubmit={createWorkspace}
          noValidate
        >
          <label htmlFor="workspace-name">新工作区名称</label>
          <input
            aria-describedby={
              workspaceFeedback?.tone === "error"
                ? "workspace-feedback"
                : undefined
            }
            aria-invalid={workspaceFeedback?.tone === "error"}
            id="workspace-name"
            name="name"
            maxLength={120}
            required
          />
          <button disabled={pendingAction !== null} type="submit">
            {pendingAction === "workspace" ? "正在创建…" : "创建"}
          </button>
          {workspaceFeedback ? (
            <InlineFormFeedback
              id="workspace-feedback"
              tone={workspaceFeedback.tone}
            >
              {workspaceFeedback.message}
            </InlineFormFeedback>
          ) : null}
        </form>
        <label htmlFor="workspace-select">当前工作区</label>
        <select
          id="workspace-select"
          value={selected ?? ""}
          onChange={(event) => {
            setSelected(event.target.value || null);
            setWorkspaceFeedback(null);
            setSpaceFeedback(null);
            setInviteFeedback(null);
            setStatus("正在读取工作区内容…");
          }}
        >
          {workspaces.map((workspace) => (
            <option value={workspace.id} key={workspace.id}>
              {workspace.name} · {workspace.role}
            </option>
          ))}
        </select>
      </ProductDisclosure>
      {selected ? (
        <>
          <ProductPanel
            title="空间"
            description="私有空间用于个人资料，共享空间用于受邀协作。"
            aside={<ProductTag>{spaces.length} 个</ProductTag>}
          >
            <form
              aria-busy={pendingAction === "space"}
              className="inline-form"
              onSubmit={createSpace}
              noValidate
            >
              <label htmlFor="space-name">空间名称</label>
              <input
                aria-describedby={
                  spaceFeedback?.tone === "error" ? "space-feedback" : undefined
                }
                aria-invalid={spaceFeedback?.tone === "error"}
                id="space-name"
                name="name"
                maxLength={120}
                required
              />
              <label htmlFor="space-visibility">可见性</label>
              <select id="space-visibility" name="visibility">
                <option value="private">仅自己</option>
                <option value="shared">工作区共享</option>
              </select>
              <button disabled={pendingAction !== null} type="submit">
                {pendingAction === "space" ? "正在创建…" : "创建空间"}
              </button>
              {spaceFeedback ? (
                <InlineFormFeedback
                  id="space-feedback"
                  tone={spaceFeedback.tone}
                >
                  {spaceFeedback.message}
                </InlineFormFeedback>
              ) : null}
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
            {spaces.length === 0 ? (
              <ProductEmptyState
                icon="□"
                title="还没有空间"
                description="创建一个私有空间开始个人学习，或创建共享空间邀请成员。"
              />
            ) : null}
          </ProductPanel>
          <ProductPanel
            title="成员与邀请"
            description="受邀成员按现有角色参与查看、审查、贡献或管理。"
            aside={<ProductTag tone="info">{members.length} / 10</ProductTag>}
          >
            <form
              aria-busy={pendingAction === "invite"}
              className="inline-form"
              onSubmit={invite}
              noValidate
            >
              <label htmlFor="invite-email">邮箱</label>
              <input
                aria-describedby={
                  inviteFeedback?.tone === "error"
                    ? "invite-feedback"
                    : undefined
                }
                aria-invalid={inviteFeedback?.tone === "error"}
                id="invite-email"
                name="email"
                type="email"
                required
              />
              <label htmlFor="invite-role">角色</label>
              <select id="invite-role" name="role">
                <option value="viewer">查看者</option>
                <option value="reviewer">审查者</option>
                <option value="contributor">贡献者</option>
                <option value="editor">编辑者</option>
                <option value="admin">管理员</option>
              </select>
              <button disabled={pendingAction !== null} type="submit">
                {pendingAction === "invite" ? "正在发送…" : "发送邀请"}
              </button>
              {inviteFeedback ? (
                <InlineFormFeedback
                  id="invite-feedback"
                  tone={inviteFeedback.tone}
                >
                  {inviteFeedback.message}
                </InlineFormFeedback>
              ) : null}
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
                      disabled={pendingAction !== null}
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
            {members.length === 0 ? (
              <ProductEmptyState
                icon="＋"
                title="尚无成员记录"
                description="输入受邀邮箱并选择最小必要角色。"
              />
            ) : null}
          </ProductPanel>
        </>
      ) : null}
    </main>
  );
}
