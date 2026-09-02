"use client";

import { useMemo, useState, type FormEvent } from "react";

import { AppIcon } from "@/components/app-shell/app-icon";
import {
  InspectorSection,
  WorkbenchActionBar,
  WorkbenchContextBar,
  WorkbenchFrame,
  WorkbenchHeader,
} from "@/components/product/workbench";
import {
  WorkbenchSelect,
  WorkbenchSheet,
  WorkbenchTabPanel,
  WorkbenchTabs,
  type WorkbenchSelectOption,
} from "@/components/product/headless-ui";
import { ProductEmptyState, ProductTag } from "@/components/product/product-ui";

import {
  useWorkspacesController,
  type Invitation,
  type Member,
  type Space,
  type Workspace,
  type WorkspaceWorkbenchController,
} from "./use-workspaces-controller";
import styles from "./workspace-workbench.module.css";

const ROLE_OPTIONS: readonly WorkbenchSelectOption[] = [
  { label: "查看者", value: "viewer" },
  { label: "审查者", value: "reviewer" },
  { label: "贡献者", value: "contributor" },
  { label: "编辑者", value: "editor" },
  { label: "管理员", value: "admin" },
];

const ROLE_LABELS: Readonly<Record<string, string>> = {
  admin: "管理员",
  contributor: "贡献者",
  editor: "编辑者",
  owner: "所有者",
  reviewer: "审查者",
  viewer: "查看者",
};

function dateLabel(value: string | null | undefined) {
  if (!value) return "尚未加入";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function workspaceContext(workspace: Workspace | null, space?: Space | null) {
  return {
    permission: workspace
      ? {
          label: ROLE_LABELS[workspace.role] ?? workspace.role,
          tone: "good" as const,
        }
      : undefined,
    space: space ? { id: space.id, name: space.name } : undefined,
    sync: { label: "实时 API", tone: "good" as const },
    vault: { label: "服务器上下文", tone: "default" as const },
    workspace: workspace
      ? { id: workspace.id, name: workspace.name }
      : undefined,
  };
}

function MemberRow({
  controller,
  member,
}: Readonly<{ controller: WorkspaceWorkbenchController; member: Member }>) {
  const canEdit =
    controller.capabilities.canManageMembers && member.role !== "owner";
  return (
    <li className={styles.memberRow} data-testid="workspace-member-row">
      <div className={styles.avatar} aria-hidden="true">
        {member.email.slice(0, 1).toUpperCase()}
      </div>
      <div className={styles.rowCopy}>
        <strong>{member.email}</strong>
        <span>
          {member.status === "active" ? "活跃成员" : member.status} · 加入于{" "}
          {dateLabel(member.joined_at)}
        </span>
      </div>
      <ProductTag tone={member.status === "active" ? "good" : "warn"}>
        {member.status === "active" ? "ACTIVE" : member.status.toUpperCase()}
      </ProductTag>
      {member.role === "owner" ? (
        <span className={styles.roleText}>所有者</span>
      ) : canEdit ? (
        <WorkbenchSelect
          label={`修改 ${member.email} 的角色`}
          onValueChange={(role) =>
            void controller.commands.updateMember(member, {
              role: role as Exclude<Member["role"], "owner">,
            })
          }
          options={ROLE_OPTIONS}
          value={member.role}
        />
      ) : (
        <span className={styles.roleText}>
          {ROLE_LABELS[member.role] ?? member.role}
        </span>
      )}
    </li>
  );
}

function InvitationRow({
  invitation,
  onRevoke,
}: Readonly<{
  invitation: Invitation;
  onRevoke: (invitation: Invitation) => void;
}>) {
  return (
    <li className={styles.inviteRow}>
      <div className={styles.rowCopy}>
        <strong>{invitation.email}</strong>
        <span>
          {ROLE_LABELS[invitation.role] ?? invitation.role} · 到期{" "}
          {dateLabel(invitation.expires_at)}
        </span>
      </div>
      <ProductTag tone={invitation.status === "pending" ? "info" : "warn"}>
        {invitation.status === "pending" ? "待接受" : "已撤销"}
      </ProductTag>
      {invitation.status === "pending" ? (
        <button type="button" onClick={() => onRevoke(invitation)}>
          撤销
        </button>
      ) : null}
      {invitation.token ? (
        <code className={styles.token} title="Token 只在创建响应中显示一次">
          {invitation.token}
        </code>
      ) : null}
    </li>
  );
}

function WorkspaceCreationSheet({
  controller,
  onOpenChange,
  open,
}: Readonly<{
  controller: WorkspaceWorkbenchController;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}>) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "");
    if (await controller.commands.createWorkspace(name)) onOpenChange(false);
  }
  return (
    <WorkbenchSheet
      description="新工作区会自动创建一个仅本人可见的 Private Space。"
      onOpenChange={onOpenChange}
      open={open}
      title="创建工作区"
    >
      <form className={styles.sheetForm} onSubmit={submit}>
        <label htmlFor="new-workspace-name">名称</label>
        <input id="new-workspace-name" name="name" maxLength={120} required />
        <footer className={styles.sheetActions}>
          <button type="button" onClick={() => onOpenChange(false)}>
            取消
          </button>
          <button className={styles.primaryButton} type="submit">
            创建工作区
          </button>
        </footer>
      </form>
    </WorkbenchSheet>
  );
}

function InviteSheet({
  controller,
  onOpenChange,
  open,
}: Readonly<{
  controller: WorkspaceWorkbenchController;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}>) {
  const [role, setRole] = useState<Exclude<Member["role"], "owner">>("viewer");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const created = await controller.commands.invite({
      email: String(data.get("email") ?? ""),
      role,
    });
    if (created) onOpenChange(false);
  }
  return (
    <WorkbenchSheet
      description="邀请会写入 Workspace 审计；创建成功后 Token 只显示一次。"
      onOpenChange={onOpenChange}
      open={open}
      title="邀请新成员"
    >
      <form className={styles.sheetForm} onSubmit={submit}>
        <label htmlFor="invite-member-email">邮箱</label>
        <input id="invite-member-email" name="email" type="email" required />
        <label htmlFor="invite-member-role">最小必要角色</label>
        <WorkbenchSelect
          label="邀请角色"
          onValueChange={(value) =>
            setRole(value as Exclude<Member["role"], "owner">)
          }
          options={ROLE_OPTIONS}
          value={role}
        />
        <input name="role" type="hidden" value={role} />
        <footer className={styles.sheetActions}>
          <button type="button" onClick={() => onOpenChange(false)}>
            取消
          </button>
          <button className={styles.primaryButton} type="submit">
            发送邀请
          </button>
        </footer>
      </form>
    </WorkbenchSheet>
  );
}

function TransferSheet({
  controller,
  onOpenChange,
  open,
}: Readonly<{
  controller: WorkspaceWorkbenchController;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}>) {
  const [target, setTarget] = useState("");
  const candidates = controller.members.filter(
    (member) => member.role !== "owner" && member.status === "active",
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await controller.commands.transferOwnership(target))
      onOpenChange(false);
  }
  return (
    <WorkbenchSheet
      description="转移后你会失去所有者权限；Workspace 成员和内容不会删除。"
      onOpenChange={onOpenChange}
      open={open}
      title="转移 Workspace 所有权"
    >
      <form className={styles.sheetForm} onSubmit={submit}>
        <p className={styles.dangerCopy}>
          影响范围：整个 Workspace 的治理权限。恢复路径：新所有者可再次转移。
        </p>
        <label htmlFor="transfer-target">新的所有者</label>
        <select
          className={styles.nativeSelect}
          id="transfer-target"
          onChange={(event) => setTarget(event.target.value)}
          required
          value={target}
        >
          <option value="">选择活跃成员</option>
          {candidates.map((member) => (
            <option key={member.id} value={member.id}>
              {member.email}
            </option>
          ))}
        </select>
        <footer className={styles.sheetActions}>
          <button type="button" onClick={() => onOpenChange(false)}>
            取消
          </button>
          <button
            className={styles.dangerButton}
            disabled={!target}
            type="submit"
          >
            确认转移
          </button>
        </footer>
      </form>
    </WorkbenchSheet>
  );
}

function RevokeSheet({
  controller,
  invitation,
  onOpenChange,
  open,
}: Readonly<{
  controller: WorkspaceWorkbenchController;
  invitation: Invitation | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}>) {
  async function revoke() {
    if (
      invitation &&
      (await controller.commands.revokeInvitation(invitation.id))
    )
      onOpenChange(false);
  }
  return (
    <WorkbenchSheet
      description="撤销后该邀请 Token 立即失效，尚未接受的成员无法加入。"
      onOpenChange={onOpenChange}
      open={open}
      title="撤销邀请"
    >
      <div className={styles.sheetForm}>
        <p className={styles.dangerCopy}>
          影响对象：{invitation?.email ?? "当前邀请"}
          。恢复路径：重新创建一条邀请。
        </p>
        <footer className={styles.sheetActions}>
          <button type="button" onClick={() => onOpenChange(false)}>
            保留邀请
          </button>
          <button
            className={styles.dangerButton}
            type="button"
            onClick={() => void revoke()}
          >
            确认撤销
          </button>
        </footer>
      </div>
    </WorkbenchSheet>
  );
}

function LeaveSheet({
  controller,
  onOpenChange,
  open,
}: Readonly<{
  controller: WorkspaceWorkbenchController;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}>) {
  const [phrase, setPhrase] = useState("");
  async function leave() {
    if (phrase !== "LEAVE WORKSPACE") return;
    if (await controller.commands.leaveWorkspace()) onOpenChange(false);
  }
  return (
    <WorkbenchSheet
      description="离开后你将失去当前 Workspace 的访问权；Workspace 和其他成员不受影响。"
      onOpenChange={onOpenChange}
      open={open}
      title="离开 Workspace"
    >
      <div className={styles.sheetForm}>
        <p className={styles.dangerCopy}>
          影响范围：当前账号的成员资格。恢复路径：由管理员重新邀请你加入。
        </p>
        <label htmlFor="leave-workspace-confirm">
          输入 LEAVE WORKSPACE 确认
        </label>
        <input
          id="leave-workspace-confirm"
          onChange={(event) => setPhrase(event.target.value)}
          value={phrase}
        />
        <footer className={styles.sheetActions}>
          <button type="button" onClick={() => onOpenChange(false)}>
            取消
          </button>
          <button
            className={styles.dangerButton}
            disabled={phrase !== "LEAVE WORKSPACE"}
            type="button"
            onClick={() => void leave()}
          >
            确认离开
          </button>
        </footer>
      </div>
    </WorkbenchSheet>
  );
}

export function WorkspaceGovernanceWorkbench({
  controller,
}: Readonly<{ controller: WorkspaceWorkbenchController }>) {
  const [tab, setTab] = useState("members");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [revokeInvitation, setRevokeInvitation] = useState<Invitation | null>(
    null,
  );

  return (
    <>
      <main className={`${styles.page} app-shell-content`} id="main-content">
        <WorkbenchFrame
          context={
            <WorkbenchContextBar
              context={workspaceContext(controller.context.selectedWorkspace)}
            />
          }
          header={
            <WorkbenchHeader
              description="成员、邀请和所有权变化集中在一个可审计的治理面板里。"
              eyebrow="WORKSPACE GOVERNANCE"
              title="成员治理"
            />
          }
          inspector={
            <div data-testid="workspaces-inspector">
              <InspectorSection title="当前 Workspace">
                {controller.context.selectedWorkspace ? (
                  <dl className={styles.kvList}>
                    <div>
                      <dt>名称</dt>
                      <dd>{controller.context.selectedWorkspace.name}</dd>
                    </div>
                    <div>
                      <dt>你的角色</dt>
                      <dd>
                        {ROLE_LABELS[controller.context.selectedWorkspace.role]}
                      </dd>
                    </div>
                    <div>
                      <dt>版本</dt>
                      <dd>v{controller.context.selectedWorkspace.version}</dd>
                    </div>
                    <div>
                      <dt>成员</dt>
                      <dd>{controller.members.length} 人</dd>
                    </div>
                  </dl>
                ) : (
                  <ProductEmptyState
                    title="尚未选择 Workspace"
                    description="从左侧目录选择一个上下文。"
                  />
                )}
              </InspectorSection>
              <InspectorSection title="操作状态">
                <p className={styles.inspectorStatus} aria-live="polite">
                  {controller.context.status}
                </p>
                <button
                  type="button"
                  onClick={() => void controller.commands.load()}
                >
                  <AppIcon name="refresh" size={14} />
                  刷新上下文
                </button>
              </InspectorSection>
            </div>
          }
          inspectorLabel="Workspace 检查器"
          label="Workspace 成员治理工作台"
          main={
            <div
              data-testid="workspaces-members-main"
              className={styles.mainPane}
            >
              <WorkbenchActionBar
                primary={
                  <button
                    className={styles.primaryButton}
                    disabled={
                      !controller.capabilities.canInvite ||
                      !controller.context.selectedWorkspace
                    }
                    type="button"
                    onClick={() => setInviteOpen(true)}
                    title={
                      controller.capabilities.canInvite
                        ? ""
                        : "需要 Workspace 管理权限"
                    }
                  >
                    <AppIcon name="users" size={15} />
                    邀请新成员
                  </button>
                }
                secondary={
                  <button type="button" onClick={() => setWorkspaceOpen(true)}>
                    <AppIcon name="plus" size={14} />
                    新建 Workspace
                  </button>
                }
              />
              <WorkbenchTabs
                label="Workspace 治理视图"
                onValueChange={setTab}
                tabs={[
                  {
                    label: "成员",
                    value: "members",
                    count: controller.members.length,
                  },
                  {
                    label: "邀请",
                    value: "invites",
                    count: controller.invitations.length,
                  },
                  { label: "工作区信息", value: "info" },
                  { label: "危险操作", value: "danger" },
                ]}
                value={tab}
              >
                <WorkbenchTabPanel value="members">
                  <section className={styles.tabSection}>
                    <header className={styles.sectionHeader}>
                      <div>
                        <span className={styles.kicker}>MEMBERS</span>
                        <h2>成员与角色</h2>
                      </div>
                      <span>{controller.members.length} / 10</span>
                    </header>
                    {controller.loading ? (
                      <p className={styles.inlineState}>正在读取成员…</p>
                    ) : controller.members.length === 0 ? (
                      <ProductEmptyState
                        title="还没有成员"
                        description="邀请第一位成员开始协作。"
                      />
                    ) : (
                      <ul className={styles.memberList}>
                        {controller.members.map((member) => (
                          <MemberRow
                            controller={controller}
                            key={member.id}
                            member={member}
                          />
                        ))}
                      </ul>
                    )}
                  </section>
                </WorkbenchTabPanel>
                <WorkbenchTabPanel value="invites">
                  <section className={styles.tabSection}>
                    <header className={styles.sectionHeader}>
                      <div>
                        <span className={styles.kicker}>INVITATIONS</span>
                        <h2>邀请记录</h2>
                      </div>
                      <span>只显示本次会话创建的邀请</span>
                    </header>
                    {controller.invitations.length ? (
                      <ul className={styles.inviteList}>
                        {controller.invitations.map((item) => (
                          <InvitationRow
                            invitation={item}
                            key={item.id}
                            onRevoke={(next) => {
                              setRevokeInvitation(next);
                              setRevokeOpen(true);
                            }}
                          />
                        ))}
                      </ul>
                    ) : (
                      <ProductEmptyState
                        title="没有待处理邀请"
                        description="服务端当前只提供创建与撤销接口；创建后的 Token 会在本次会话中回显。"
                      />
                    )}
                  </section>
                </WorkbenchTabPanel>
                <WorkbenchTabPanel value="info">
                  <section className={styles.tabSection}>
                    <header className={styles.sectionHeader}>
                      <div>
                        <span className={styles.kicker}>WORKSPACE</span>
                        <h2>基本信息</h2>
                      </div>
                    </header>
                    <dl className={styles.detailGrid}>
                      {controller.context.selectedWorkspace ? (
                        <>
                          <div>
                            <dt>Workspace ID</dt>
                            <dd>
                              <code>
                                {controller.context.selectedWorkspace.id}
                              </code>
                            </dd>
                          </div>
                          <div>
                            <dt>创建时间</dt>
                            <dd>
                              {dateLabel(
                                controller.context.selectedWorkspace.created_at,
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>成员资格</dt>
                            <dd>
                              {
                                controller.context.selectedWorkspace
                                  .membership_status
                              }
                            </dd>
                          </div>
                          <div>
                            <dt>状态</dt>
                            <dd>
                              {controller.context.selectedWorkspace.status}
                            </dd>
                          </div>
                        </>
                      ) : null}
                    </dl>
                  </section>
                </WorkbenchTabPanel>
                <WorkbenchTabPanel value="danger">
                  <section
                    className={`${styles.tabSection} ${styles.dangerZone}`}
                  >
                    <header className={styles.sectionHeader}>
                      <div>
                        <span className={styles.kicker}>DANGER ZONE</span>
                        <h2>高影响操作</h2>
                      </div>
                    </header>
                    <p>危险操作保留在这里，先说明影响范围、权限与恢复路径。</p>
                    <div className={styles.dangerActions}>
                      <button
                        disabled={!controller.capabilities.canTransferOwnership}
                        type="button"
                        onClick={() => setTransferOpen(true)}
                      >
                        转移 Workspace 所有权
                      </button>
                      <button
                        disabled={
                          controller.context.selectedWorkspace?.role === "owner"
                        }
                        type="button"
                        onClick={() => setLeaveOpen(true)}
                      >
                        离开 Workspace
                      </button>
                      <span className={styles.disabledNote}>
                        删除 Workspace：当前正式 API
                        未提供可恢复删除入口，已保留为不可用能力说明。
                      </span>
                    </div>
                  </section>
                </WorkbenchTabPanel>
              </WorkbenchTabs>
            </div>
          }
          mainLabel="成员治理"
          master={
            <div
              data-testid="workspaces-members-master"
              className={styles.masterPane}
            >
              <div className={styles.masterHeading}>
                <div>
                  <span className={styles.kicker}>WORKSPACES</span>
                  <h2>工作区</h2>
                </div>
                <span>{controller.context.workspaces.length}</span>
              </div>
              <WorkbenchSelect
                label="当前 Workspace"
                onValueChange={controller.commands.selectWorkspace}
                options={controller.context.workspaces.map((workspace) => ({
                  label: `${workspace.name} · ${ROLE_LABELS[workspace.role]}`,
                  value: workspace.id,
                }))}
                placeholder="选择 Workspace"
                value={controller.context.selectedWorkspace?.id}
              />
              <ul className={styles.workspaceList}>
                {controller.context.workspaces.map((workspace) => (
                  <li key={workspace.id}>
                    <button
                      className={
                        workspace.id ===
                        controller.context.selectedWorkspace?.id
                          ? styles.selectedRow
                          : undefined
                      }
                      type="button"
                      onClick={() =>
                        controller.commands.selectWorkspace(workspace.id)
                      }
                    >
                      <span className={styles.workspaceIcon}>
                        <AppIcon name="layout-template" size={15} />
                      </span>
                      <span className={styles.rowCopy}>
                        <strong>{workspace.name}</strong>
                        <span>
                          {ROLE_LABELS[workspace.role]} · v{workspace.version}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {!controller.context.workspaces.length && !controller.loading ? (
                <ProductEmptyState
                  title="创建第一个 Workspace"
                  description="成员和 Space 都会围绕 Workspace 组织。"
                  action={
                    <button
                      type="button"
                      onClick={() => setWorkspaceOpen(true)}
                    >
                      创建 Workspace
                    </button>
                  }
                />
              ) : null}
            </div>
          }
          masterLabel="Workspace 目录"
          toolbar={
            <div className={styles.toolbarNote}>
              <AppIcon name="shield" size={14} />
              <span>
                {controller.context.selectedWorkspace
                  ? "当前上下文已绑定；管理员不会自动读取私人 Space。"
                  : "选择 Workspace 继续。"}
              </span>
            </div>
          }
        />
      </main>
      <WorkspaceCreationSheet
        controller={controller}
        onOpenChange={setWorkspaceOpen}
        open={workspaceOpen}
      />
      <InviteSheet
        controller={controller}
        onOpenChange={setInviteOpen}
        open={inviteOpen}
      />
      <TransferSheet
        controller={controller}
        onOpenChange={setTransferOpen}
        open={transferOpen}
      />
      <RevokeSheet
        controller={controller}
        invitation={revokeInvitation}
        onOpenChange={setRevokeOpen}
        open={revokeOpen}
      />
      <LeaveSheet
        controller={controller}
        onOpenChange={setLeaveOpen}
        open={leaveOpen}
      />
    </>
  );
}

function SpaceCreationSheet({
  controller,
  onOpenChange,
  open,
}: Readonly<{
  controller: WorkspaceWorkbenchController;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}>) {
  const [visibility, setVisibility] = useState<Space["visibility"]>("private");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "");
    if (await controller.commands.createSpace({ name, visibility }))
      onOpenChange(false);
  }
  return (
    <WorkbenchSheet
      description="Private 仅本人可见；Shared 仅向 Workspace 成员开放。"
      onOpenChange={onOpenChange}
      open={open}
      title="创建 Space"
    >
      <form className={styles.sheetForm} onSubmit={submit}>
        <label htmlFor="new-space-name">名称</label>
        <input id="new-space-name" name="name" maxLength={120} required />
        <fieldset>
          <legend>可见性</legend>
          <label>
            <input
              checked={visibility === "private"}
              name="visibility"
              onChange={() => setVisibility("private")}
              type="radio"
              value="private"
            />
            Private · 仅本人
          </label>
          <label>
            <input
              checked={visibility === "shared"}
              disabled={!controller.capabilities.canCreateSharedSpace}
              name="visibility"
              onChange={() => setVisibility("shared")}
              type="radio"
              value="shared"
            />
            Shared · Workspace 成员
          </label>
        </fieldset>
        <footer className={styles.sheetActions}>
          <button type="button" onClick={() => onOpenChange(false)}>
            取消
          </button>
          <button
            className={styles.primaryButton}
            disabled={
              visibility === "shared" &&
              !controller.capabilities.canCreateSharedSpace
            }
            type="submit"
          >
            创建 Space
          </button>
        </footer>
      </form>
    </WorkbenchSheet>
  );
}

export function SpacesWorkbench({
  controller,
}: Readonly<{ controller: WorkspaceWorkbenchController }>) {
  const [createOpen, setCreateOpen] = useState(false);
  const selected = controller.context.selectedSpace;
  const shared = selected?.visibility === "shared";
  const visibleMembers = useMemo(
    () => controller.members.filter((member) => member.status === "active"),
    [controller.members],
  );
  return (
    <>
      <main className={`${styles.page} app-shell-content`} id="main-content">
        <WorkbenchFrame
          context={
            <WorkbenchContextBar
              context={workspaceContext(
                controller.context.selectedWorkspace,
                selected,
              )}
            />
          }
          header={
            <WorkbenchHeader
              description="先看清内容归属，再决定哪些对象可以进入团队协作边界。"
              eyebrow="SPACE DIRECTORY"
              title="空间目录"
            />
          }
          inspector={
            <div data-testid="spaces-inspector">
              <InspectorSection title="访问边界">
                <p className={styles.inspectorStatus}>
                  {selected
                    ? shared
                      ? "Shared：Workspace 成员可见。"
                      : "Private：只有空间所有者可见。"
                    : "从左侧选择一个 Space。"}
                </p>
                {selected ? (
                  <dl className={styles.kvList}>
                    <div>
                      <dt>可见性</dt>
                      <dd>{shared ? "Shared" : "Private"}</dd>
                    </div>
                    <div>
                      <dt>版本</dt>
                      <dd>v{selected.version}</dd>
                    </div>
                    <div>
                      <dt>状态</dt>
                      <dd>{selected.status}</dd>
                    </div>
                  </dl>
                ) : null}
              </InspectorSection>
              <InspectorSection title="Workspace 成员">
                <p className={styles.inspectorStatus}>
                  {shared
                    ? `${visibleMembers.length} 位活跃成员可访问`
                    : "Private Space 不继承成员访问。"}
                </p>
                {shared ? (
                  <ul className={styles.compactList}>
                    {visibleMembers.map((member) => (
                      <li key={member.id}>
                        <span className={styles.avatar}>
                          {member.email.slice(0, 1).toUpperCase()}
                        </span>
                        <span>{member.email}</span>
                        <ProductTag>{ROLE_LABELS[member.role]}</ProductTag>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </InspectorSection>
            </div>
          }
          inspectorLabel="Space 访问检查器"
          label="Space 目录工作台"
          main={
            <div data-testid="spaces-access-main" className={styles.mainPane}>
              <WorkbenchActionBar
                primary={
                  <button
                    className={styles.primaryButton}
                    disabled={
                      !controller.context.selectedWorkspace ||
                      !controller.capabilities.canCreatePrivateSpace
                    }
                    type="button"
                    onClick={() => setCreateOpen(true)}
                  >
                    <AppIcon name="plus" size={15} />
                    创建空间
                  </button>
                }
                secondary={
                  <span className={styles.actionHint}>
                    {selected
                      ? `${selected.name} · ${shared ? "Shared" : "Private"}`
                      : "未选择 Space"}
                  </span>
                }
              />
              <section className={styles.tabSection}>
                <header className={styles.sectionHeader}>
                  <div>
                    <span className={styles.kicker}>ACCESS DETAIL</span>
                    <h2>{selected?.name ?? "选择一个 Space"}</h2>
                  </div>
                  {selected ? (
                    <ProductTag tone={shared ? "info" : "good"}>
                      {shared ? "SHARED" : "PRIVATE"}
                    </ProductTag>
                  ) : null}
                </header>
                {selected ? (
                  <>
                    <p className={styles.lede}>
                      {shared
                        ? "这个 Space 对 Workspace 成员开放；内容写入仍遵循成员角色和对象权限。"
                        : "这个 Space 只属于当前所有者，管理员不会自动读取其中内容。"}
                    </p>
                    <dl className={styles.detailGrid}>
                      <div>
                        <dt>Owner</dt>
                        <dd>{selected.owner_user_id ?? "Workspace members"}</dd>
                      </div>
                      <div>
                        <dt>Workspace</dt>
                        <dd>{controller.context.selectedWorkspace?.name}</dd>
                      </div>
                      <div>
                        <dt>最近更新</dt>
                        <dd>{dateLabel(selected.updated_at)}</dd>
                      </div>
                    </dl>
                  </>
                ) : (
                  <ProductEmptyState
                    title="先选择 Space"
                    description="左侧目录会持续回显当前 Workspace 下可访问的空间。"
                  />
                )}
              </section>
              <section className={styles.moveSection}>
                <header>
                  <div>
                    <span className={styles.kicker}>
                      SHARED VISIBILITY · BOUNDARY ACTION
                    </span>
                    <h2>移入共享空间</h2>
                  </div>
                </header>
                <p>
                  共享可见性会让对象对 Workspace
                  成员开放；完成后只能由用户显式移回 Private Space。
                </p>
                <button
                  disabled
                  type="button"
                  title="当前正式 API 未提供对象迁移操作"
                >
                  移入共享空间
                </button>
                <span className={styles.disabledNote}>
                  当前正式 API 尚未提供对象迁移端点，因此入口保留但不可执行。
                </span>
              </section>
            </div>
          }
          mainLabel="访问详情"
          master={
            <div
              data-testid="spaces-directory-master"
              className={styles.masterPane}
            >
              <div className={styles.masterHeading}>
                <div>
                  <span className={styles.kicker}>SPACE DIRECTORY</span>
                  <h2>空间</h2>
                </div>
                <span>{controller.context.spaces.length}</span>
              </div>
              <ul className={styles.workspaceList}>
                {controller.context.spaces.map((space) => (
                  <li key={space.id}>
                    <button
                      className={
                        space.id === selected?.id
                          ? styles.selectedRow
                          : undefined
                      }
                      type="button"
                      onClick={() => controller.commands.selectSpace(space.id)}
                    >
                      <span
                        className={`${styles.workspaceIcon} ${space.visibility === "private" ? styles.privateIcon : styles.sharedIcon}`}
                      >
                        <AppIcon
                          name={
                            space.visibility === "private" ? "lock" : "users"
                          }
                          size={15}
                        />
                      </span>
                      <span className={styles.rowCopy}>
                        <strong>
                          {space.visibility === "private"
                            ? "个人空间"
                            : space.name}
                        </strong>
                        <span>
                          {space.visibility === "private"
                            ? space.name
                            : `${visibleMembers.length} 位成员 · v${space.version}`}
                        </span>
                      </span>
                      <ProductTag
                        tone={space.visibility === "private" ? "good" : "info"}
                      >
                        {space.visibility === "private" ? "PRIVATE" : "SHARED"}
                      </ProductTag>
                    </button>
                  </li>
                ))}
              </ul>
              {!controller.context.spaces.length && !controller.loading ? (
                <ProductEmptyState
                  title="还没有 Space"
                  description="创建一个 Private Space 开始整理资料。"
                />
              ) : null}
            </div>
          }
          masterLabel="Space 目录"
          toolbar={
            <div className={styles.toolbarNote}>
              <AppIcon name="shield" size={14} />
              <span>
                Private Space 置顶且仅本人可见；Shared Space 显示成员访问边界。
              </span>
            </div>
          }
        />
      </main>
      <SpaceCreationSheet
        controller={controller}
        onOpenChange={setCreateOpen}
        open={createOpen}
      />
    </>
  );
}

export function WorkspaceGovernanceRoute() {
  return (
    <WorkspaceGovernanceWorkbench controller={useWorkspacesController()} />
  );
}

export function SpacesRoute() {
  return <SpacesWorkbench controller={useWorkspacesController()} />;
}
