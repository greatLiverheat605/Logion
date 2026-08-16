"use client";

import type { components } from "@logion/contracts";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { CollaborationSubviewNav } from "@/components/desk/collaboration-subview-nav";
import { DeskConflictResolver } from "@/components/desk/desk-feedback";
import {
  DeskButton,
  DeskField,
  DeskInput,
  DeskSelect,
} from "@/components/desk/desk-primitives";
import { DeskSubviewNav } from "@/components/desk/desk-subview-nav";
import { InlineFormFeedback } from "@/components/product/inline-form-feedback";
import {
  ProductEmptyState,
  ProductPageHeader,
  ProductPanel,
  ProductTag,
} from "@/components/product/product-ui";
import { browserApiClient, LogionApiError } from "@/lib/api/client";

import {
  type WorkspaceAction,
  workspaceActionError,
  workspaceInvitationConflictDetail,
} from "./workspace-feedback";

type Workspace = components["schemas"]["WorkspaceResponse"];
type Space = components["schemas"]["SpaceResponse"];
type Member = components["schemas"]["WorkspaceMemberResponse"];

type PendingAction = WorkspaceAction | null;
type FormFeedback = {
  message: string;
  tone: "error" | "loading" | "success";
};
type WorkspaceCenterView = "collaboration" | "knowledge";

const MEMBER_ROLES = [
  ["viewer", "查看者"],
  ["reviewer", "审查者"],
  ["contributor", "贡献者"],
  ["editor", "编辑者"],
  ["admin", "管理员"],
] as const;

type MemberRole = (typeof MEMBER_ROLES)[number][0];

const MEMBER_ROLE_VALUES = new Set<string>(
  MEMBER_ROLES.map(([value]) => value),
);

function isMemberRole(value: string): value is MemberRole {
  return MEMBER_ROLE_VALUES.has(value);
}

function workspacePath(workspaceId: string): string {
  return `/api/v1/workspaces/${encodeURIComponent(workspaceId)}`;
}

function fieldValue(form: HTMLFormElement, name: string): string {
  return String(new FormData(form).get(name) ?? "").trim();
}

function invalidInputMessage(action: WorkspaceAction): string {
  if (action === "invite") return "请输入有效邮箱，例如 name@example.com。";
  if (action === "space") return "请输入空间名称。";
  if (action === "member") return "请选择有效成员角色。";
  return "请输入工作区名称。";
}

function isInvitationConflict(error: unknown): error is LogionApiError {
  return (
    error instanceof LogionApiError &&
    error.code === "INVITATION_CONFLICT" &&
    error.status === 409
  );
}

function roleLabel(role: string): string {
  if (role === "owner") return "所有者";
  return MEMBER_ROLES.find(([value]) => value === role)?.[1] ?? role;
}

export function WorkspaceCenter({
  view = "collaboration",
}: Readonly<{ view?: WorkspaceCenterView }>) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [status, setStatus] = useState("正在读取工作区…");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const [workspaceFeedback, setWorkspaceFeedback] =
    useState<FormFeedback | null>(null);
  const [spaceFeedback, setSpaceFeedback] = useState<FormFeedback | null>(null);
  const [inviteFeedback, setInviteFeedback] = useState<FormFeedback | null>(
    null,
  );
  const [inviteConflict, setInviteConflict] = useState<LogionApiError | null>(
    null,
  );
  const workspaceRequestRef = useRef<AbortController | null>(null);
  const detailsRequestRef = useRef<AbortController | null>(null);

  const loadWorkspaces = useCallback(async (): Promise<boolean> => {
    workspaceRequestRef.current?.abort();
    const controller = new AbortController();
    workspaceRequestRef.current = controller;
    try {
      const result = await browserApiClient.request<{
        workspaces: Workspace[];
      }>("/api/v1/workspaces", { signal: controller.signal });
      if (
        controller.signal.aborted ||
        workspaceRequestRef.current !== controller
      ) {
        return false;
      }
      const next = Array.isArray(result.workspaces) ? result.workspaces : [];
      setWorkspaces(next);
      if (next.length === 0) {
        setSpaces([]);
        setMembers([]);
      }
      setSelected((current) =>
        current && next.some((workspace) => workspace.id === current)
          ? current
          : (next[0]?.id ?? null),
      );
      setStatus(
        next.length ? "工作区已更新。" : "创建第一个工作区以开始协作。",
      );
      return true;
    } catch (error) {
      if (
        controller.signal.aborted ||
        workspaceRequestRef.current !== controller
      ) {
        return false;
      }
      setStatus(workspaceActionError(error, "workspace"));
      return false;
    } finally {
      if (workspaceRequestRef.current === controller) {
        workspaceRequestRef.current = null;
      }
    }
  }, []);

  const loadDetails = useCallback(
    async (workspaceId: string): Promise<boolean> => {
      detailsRequestRef.current?.abort();
      const controller = new AbortController();
      detailsRequestRef.current = controller;
      const basePath = workspacePath(workspaceId);
      try {
        const [spaceResult, memberResult] = await Promise.all([
          browserApiClient.request<{ spaces: Space[] }>(`${basePath}/spaces`, {
            signal: controller.signal,
          }),
          browserApiClient.request<{ members: Member[] }>(
            `${basePath}/members`,
            { signal: controller.signal },
          ),
        ]);
        if (
          controller.signal.aborted ||
          detailsRequestRef.current !== controller
        ) {
          return false;
        }
        setSpaces(Array.isArray(spaceResult.spaces) ? spaceResult.spaces : []);
        setMembers(
          Array.isArray(memberResult.members) ? memberResult.members : [],
        );
        setStatus("工作区内容已更新。");
        return true;
      } catch (error) {
        if (
          controller.signal.aborted ||
          detailsRequestRef.current !== controller
        ) {
          return false;
        }
        setSpaces([]);
        setMembers([]);
        setStatus(workspaceActionError(error, "space"));
        return false;
      } finally {
        if (detailsRequestRef.current === controller) {
          detailsRequestRef.current = null;
        }
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadWorkspaces();
    });
    return () => {
      active = false;
      workspaceRequestRef.current?.abort();
    };
  }, [loadWorkspaces]);

  useEffect(() => {
    let active = true;
    if (selected) {
      queueMicrotask(() => {
        if (active) void loadDetails(selected);
      });
    } else {
      detailsRequestRef.current?.abort();
    }
    return () => {
      active = false;
      detailsRequestRef.current?.abort();
    };
  }, [loadDetails, selected]);

  const anyPending = pendingAction !== null || pendingMemberId !== null;
  const selectedWorkspace = workspaces.find((item) => item.id === selected);
  const privateSpaceCount = spaces.filter(
    (item) => item.visibility === "private",
  ).length;
  const sharedSpaceCount = spaces.length - privateSpaceCount;

  function selectWorkspace(workspaceId: string) {
    setSelected(workspaceId);
    setWorkspaceFeedback(null);
    setSpaceFeedback(null);
    setInviteFeedback(null);
    setInviteConflict(null);
    setStatus("正在读取工作区内容…");
  }

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (anyPending) return;
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
      const created = await browserApiClient.request<Workspace>(
        "/api/v1/workspaces",
        {
          body: JSON.stringify({ name }),
          csrf: true,
          method: "POST",
        },
      );
      form.reset();
      const refreshed = await loadWorkspaces();
      if (refreshed) setSelected(created.id);
      setWorkspaceFeedback({
        message: refreshed
          ? "工作区已创建并切换。"
          : "工作区已创建，但列表刷新失败，请稍后重试。",
        tone: refreshed ? "success" : "error",
      });
      if (refreshed) setStatus("工作区已创建并切换。");
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
    if (!selected || anyPending) return;
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
      await browserApiClient.request(`${workspacePath(selected)}/spaces`, {
        body: JSON.stringify({
          name,
          visibility:
            data.get("visibility") === "shared" ? "shared" : "private",
        }),
        csrf: true,
        method: "POST",
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
    if (!selected || anyPending) return;
    const form = event.currentTarget;
    setInviteFeedback(null);
    setInviteConflict(null);
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
    const role = String(data.get("role") ?? "");
    if (!isMemberRole(role)) {
      setInviteFeedback({
        message: "请选择有效邀请角色。",
        tone: "error",
      });
      return;
    }
    setPendingAction("invite");
    setInviteFeedback({ message: "正在创建邀请并排队邮件…", tone: "loading" });
    try {
      await browserApiClient.request(`${workspacePath(selected)}/invitations`, {
        body: JSON.stringify({
          email,
          role,
        }),
        csrf: true,
        method: "POST",
      });
      form.reset();
      setInviteFeedback({
        message: "邀请邮件已进入发送队列，通常会在几分钟内送达。",
        tone: "success",
      });
      setStatus("邀请邮件已排队；未收到时请提醒对方检查垃圾邮件。");
    } catch (error) {
      if (isInvitationConflict(error)) {
        setInviteConflict(error);
        setInviteFeedback(null);
        setStatus(workspaceInvitationConflictDetail(error));
      } else {
        const message = workspaceActionError(error, "invite");
        setInviteFeedback({ message, tone: "error" });
        setStatus(message);
      }
    } finally {
      setPendingAction(null);
    }
  }

  async function updateMember(member: Member, role: string) {
    if (!selected || anyPending || role === member.role) return;
    if (!isMemberRole(role)) {
      setStatus(invalidInputMessage("member"));
      return;
    }
    setPendingMemberId(member.id);
    setStatus(`正在更新 ${member.email} 的角色…`);
    try {
      await browserApiClient.request(
        `${workspacePath(selected)}/members/${encodeURIComponent(member.id)}/update`,
        {
          body: JSON.stringify({ expected_version: member.version, role }),
          csrf: true,
          method: "POST",
        },
      );
      const refreshed = await loadDetails(selected);
      setStatus(
        refreshed
          ? `${member.email} 的角色已更新。`
          : "角色已更新，但成员列表刷新失败，请稍后重试。",
      );
    } catch (error) {
      setStatus(workspaceActionError(error, "member"));
    } finally {
      setPendingMemberId(null);
    }
  }

  const subviewNavigation =
    view === "knowledge" ? (
      <DeskSubviewNav
        activePath="/app/spaces"
        ariaLabel="知识库视图"
        items={[
          { href: "/app/records", icon: "files", label: "来源与记录" },
          { href: "/app/review", icon: "refresh", label: "复习与图谱" },
          { href: "/app/spaces", icon: "folder", label: "知识库管理" },
        ]}
      />
    ) : (
      <CollaborationSubviewNav activePath="/app/workspaces" />
    );

  return (
    <main id="main-content" className="settings-page workspace-page">
      <ProductPageHeader
        actions={
          selectedWorkspace ? (
            <ProductTag tone="info">
              {roleLabel(selectedWorkspace.role)}权限
            </ProductTag>
          ) : null
        }
        description={
          <>
            <p>
              {view === "knowledge"
                ? "Space 决定资料边界；私有空间只属于自己，共享空间沿用 Workspace 成员权限。"
                : "Workspace 管理成员与治理，Space 决定资料边界；管理员不会自动读取私人空间。"}
            </p>
            <p className="product-page-status" aria-live="polite">
              {status}
            </p>
          </>
        }
        eyebrow={
          view === "knowledge"
            ? "KNOWLEDGE BASE · SPACE BOUNDARY"
            : "COLLABORATION · WORKSPACE GOVERNANCE"
        }
        title={view === "knowledge" ? "知识库管理" : "空间与成员"}
      />

      {subviewNavigation}

      <div
        aria-label="当前工作区概览"
        className="workspace-summary"
        role="list"
      >
        <div role="listitem">
          <strong>{workspaces.length}</strong>
          <span>工作区</span>
        </div>
        <div role="listitem">
          <strong>{privateSpaceCount}</strong>
          <span>私有空间</span>
        </div>
        <div role="listitem">
          <strong>{sharedSpaceCount}</strong>
          <span>共享空间</span>
        </div>
        <div role="listitem">
          <strong>{members.length} / 10</strong>
          <span>成员容量</span>
        </div>
      </div>

      <div className="workspace-console-grid">
        <ProductPanel
          className="workspace-console-panel"
          description="切换治理上下文并查看其中的私有与共享空间。"
          title="工作区与空间"
        >
          <div
            aria-label="工作区列表"
            className="workspace-context-list"
            role="list"
          >
            {workspaces.map((workspace) => {
              const active = workspace.id === selected;
              return (
                <div key={workspace.id} role="listitem">
                  <button
                    aria-current={active ? "true" : undefined}
                    className={active ? "is-selected" : undefined}
                    disabled={anyPending}
                    onClick={() => selectWorkspace(workspace.id)}
                    type="button"
                  >
                    <span>
                      <strong>{workspace.name}</strong>
                      <small>
                        {roleLabel(workspace.role)} · {workspace.status}
                      </small>
                    </span>
                    <ProductTag tone={active ? "info" : "default"}>
                      {active ? "当前" : "切换"}
                    </ProductTag>
                  </button>
                </div>
              );
            })}
          </div>

          {workspaces.length === 0 ? (
            <ProductEmptyState
              description="创建工作区后，才能建立 Space 或邀请成员。"
              icon="□"
              title="尚无可访问工作区"
            />
          ) : null}

          <details className="workspace-inline-disclosure">
            <summary>新建工作区</summary>
            <form
              aria-busy={pendingAction === "workspace"}
              className="workspace-command-form"
              noValidate
              onSubmit={createWorkspace}
            >
              <DeskField
                errorId="workspace-feedback"
                errorMessage={
                  workspaceFeedback?.tone === "error"
                    ? workspaceFeedback.message
                    : undefined
                }
                htmlFor="workspace-name"
                label="工作区名称"
                required
              >
                <DeskInput
                  aria-describedby={
                    workspaceFeedback?.tone === "error"
                      ? "workspace-feedback"
                      : undefined
                  }
                  id="workspace-name"
                  invalid={workspaceFeedback?.tone === "error"}
                  maxLength={120}
                  name="name"
                  required
                />
              </DeskField>
              <DeskButton
                disabled={anyPending}
                loading={pendingAction === "workspace"}
                type="submit"
              >
                创建工作区
              </DeskButton>
              {workspaceFeedback && workspaceFeedback.tone !== "error" ? (
                <InlineFormFeedback
                  id="workspace-feedback"
                  tone={workspaceFeedback.tone}
                >
                  {workspaceFeedback.message}
                </InlineFormFeedback>
              ) : null}
            </form>
          </details>

          {selected ? (
            <div className="workspace-space-section">
              <header>
                <strong>Space</strong>
                <span>{spaces.length} 个</span>
              </header>
              <ul className="workspace-space-list">
                {spaces.map((space) => (
                  <li key={space.id}>
                    <span>
                      <strong>{space.name}</strong>
                      <small>{space.status}</small>
                    </span>
                    <ProductTag
                      tone={space.visibility === "shared" ? "info" : "default"}
                    >
                      {space.visibility === "private" ? "私有" : "共享"}
                    </ProductTag>
                  </li>
                ))}
              </ul>
              {spaces.length === 0 ? (
                <ProductEmptyState
                  description="创建私有空间开始个人资料管理，或创建共享空间开展小组协作。"
                  icon="□"
                  title="当前工作区还没有空间"
                />
              ) : null}
              <details className="workspace-inline-disclosure">
                <summary>新建 Space</summary>
                <form
                  aria-busy={pendingAction === "space"}
                  className="workspace-command-form"
                  noValidate
                  onSubmit={createSpace}
                >
                  <DeskField
                    errorId="space-feedback"
                    errorMessage={
                      spaceFeedback?.tone === "error"
                        ? spaceFeedback.message
                        : undefined
                    }
                    htmlFor="space-name"
                    label="空间名称"
                    required
                  >
                    <DeskInput
                      aria-describedby={
                        spaceFeedback?.tone === "error"
                          ? "space-feedback"
                          : undefined
                      }
                      id="space-name"
                      invalid={spaceFeedback?.tone === "error"}
                      maxLength={120}
                      name="name"
                      required
                    />
                  </DeskField>
                  <DeskField htmlFor="space-visibility" label="可见性">
                    <DeskSelect id="space-visibility" name="visibility">
                      <option value="private">仅自己</option>
                      <option value="shared">工作区共享</option>
                    </DeskSelect>
                  </DeskField>
                  <DeskButton
                    disabled={anyPending}
                    loading={pendingAction === "space"}
                    type="submit"
                  >
                    创建 Space
                  </DeskButton>
                  {spaceFeedback && spaceFeedback.tone !== "error" ? (
                    <InlineFormFeedback
                      id="space-feedback"
                      tone={spaceFeedback.tone}
                    >
                      {spaceFeedback.message}
                    </InlineFormFeedback>
                  ) : null}
                </form>
              </details>
            </div>
          ) : null}
        </ProductPanel>

        <ProductPanel
          aside={<ProductTag tone="info">{members.length} / 10</ProductTag>}
          className="workspace-console-panel"
          description="邀请保留最小必要角色；角色更新使用服务端版本检查。"
          title="成员与邀请"
        >
          {selected ? (
            <>
              <form
                aria-busy={pendingAction === "invite"}
                className="workspace-command-form workspace-invite-form"
                noValidate
                onSubmit={invite}
              >
                <DeskField
                  errorId="invite-feedback"
                  errorMessage={
                    inviteFeedback?.tone === "error"
                      ? inviteFeedback.message
                      : undefined
                  }
                  htmlFor="invite-email"
                  label="受邀邮箱"
                  required
                >
                  <DeskInput
                    aria-describedby={
                      inviteFeedback?.tone === "error"
                        ? "invite-feedback"
                        : undefined
                    }
                    id="invite-email"
                    invalid={inviteFeedback?.tone === "error"}
                    name="email"
                    required
                    type="email"
                  />
                </DeskField>
                <DeskField htmlFor="invite-role" label="角色">
                  <DeskSelect id="invite-role" name="role">
                    {MEMBER_ROLES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </DeskSelect>
                </DeskField>
                <DeskButton
                  disabled={anyPending}
                  loading={pendingAction === "invite"}
                  type="submit"
                >
                  发送邀请
                </DeskButton>
                {inviteFeedback && inviteFeedback.tone !== "error" ? (
                  <InlineFormFeedback
                    id="invite-feedback"
                    tone={inviteFeedback.tone}
                  >
                    {inviteFeedback.message}
                  </InlineFormFeedback>
                ) : null}
              </form>

              {inviteConflict ? (
                <DeskConflictResolver
                  actions={[
                    {
                      kind: "reload",
                      label: "刷新并比较",
                      onClick: () => {
                        setInviteConflict(null);
                        void loadDetails(selected);
                      },
                    },
                    {
                      kind: "merge",
                      label: "调整角色",
                      onClick: () => {
                        setInviteConflict(null);
                        document
                          .querySelector<HTMLSelectElement>("#invite-role")
                          ?.focus();
                      },
                    },
                    {
                      kind: "cancel",
                      label: "关闭",
                      onClick: () => setInviteConflict(null),
                    },
                  ]}
                  detail={workspaceInvitationConflictDetail(inviteConflict)}
                  error={inviteConflict}
                  title="邀请未重复发送"
                />
              ) : null}

              <ul className="workspace-member-list">
                {members.map((member) => (
                  <li key={member.id}>
                    <span>
                      <strong>{member.email}</strong>
                      <small>
                        {member.status} · 版本 {member.version}
                      </small>
                    </span>
                    {member.role === "owner" ? (
                      <ProductTag tone="good">所有者</ProductTag>
                    ) : (
                      <DeskSelect
                        aria-label={`修改 ${member.email} 的角色`}
                        disabled={anyPending}
                        value={member.role}
                        onChange={(event) =>
                          void updateMember(member, event.currentTarget.value)
                        }
                      >
                        {MEMBER_ROLES.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </DeskSelect>
                    )}
                    {pendingMemberId === member.id ? (
                      <span
                        aria-live="polite"
                        className="workspace-row-pending"
                      >
                        正在保存…
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {members.length === 0 ? (
                <ProductEmptyState
                  description="输入受邀邮箱并选择最小必要角色。"
                  icon="＋"
                  title="尚无成员记录"
                />
              ) : null}
            </>
          ) : (
            <ProductEmptyState
              description="先创建或选择工作区，再管理成员和邀请。"
              icon="◎"
              title="尚未选择工作区"
            />
          )}
        </ProductPanel>
      </div>
    </main>
  );
}
