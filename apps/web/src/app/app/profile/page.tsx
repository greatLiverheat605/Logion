"use client";

import Link from "next/link";
import { useState } from "react";

import { AppIcon } from "@/components/app-shell/app-icon";
import { ProductTag } from "@/components/product/product-ui";
import {
  InspectorSection,
  WorkbenchActionBar,
  WorkbenchContextBar,
  WorkbenchFrame,
  WorkbenchHeader,
  WorkbenchToolbar,
} from "@/components/product/workbench";
import { useSession } from "@/features/auth/session-provider";

import styles from "./profile-workbench.module.css";

type ProfileSection = "account" | "activity" | "actions";

function dateLabel(value: string | null | undefined): string {
  if (!value) return "尚未提供";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日期不可用";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function initials(email: string | undefined): string {
  return email ? email.slice(0, 1).toUpperCase() : "?";
}

function sessionStatusLabel(
  status: "loading" | "anonymous" | "authenticated" | "error",
) {
  if (status === "authenticated") return "已认证";
  if (status === "loading") return "读取中";
  if (status === "anonymous") return "未登录";
  return "暂不可用";
}

export default function ProfilePage() {
  const { refresh, state } = useSession();
  const [section, setSection] = useState<ProfileSection>("account");
  const user = state.status === "authenticated" ? state.user : null;
  const email = user?.email ?? "当前会话未提供邮箱";
  const verified = Boolean(user?.email_verified_at);
  const stateTone =
    state.status === "authenticated"
      ? "good"
      : state.status === "error"
        ? "warn"
        : "default";
  const stateText =
    state.status === "authenticated"
      ? "账户状态已更新。"
      : state.status === "loading"
        ? "正在读取账户状态…"
        : state.status === "anonymous"
          ? "当前没有可显示的账户。"
          : "账户状态暂时不可用，请重试。";

  return (
    <main
      className={styles.page}
      data-testid="profile-workbench"
      id="main-content"
    >
      <WorkbenchFrame
        context={
          <WorkbenchContextBar
            context={{
              permission: { label: "本人账户", tone: "good" },
              sync: {
                label: state.status === "loading" ? "正在同步" : "会话已同步",
                tone: state.status === "error" ? "warn" : "good",
              },
              vault: { label: "会话安全" },
            }}
          />
        }
        header={
          <WorkbenchHeader
            actions={
              <ProductTag tone={stateTone}>
                {sessionStatusLabel(state.status)}
              </ProductTag>
            }
            description="查看真实账户身份、验证状态与本人活动；Workspace 成员角色和 Space 权限在各自治理页面维护。"
            eyebrow="ACCOUNT WORKSPACE"
            title="个人"
          />
        }
        inspectorLabel="账户检查器"
        label="个人账户工作台"
        mainLabel="账户与活动"
        masterLabel="个人导航"
        master={
          <aside className={styles.masterPane} data-testid="profile-master">
            <div className={styles.paneHeading}>
              <span className={styles.eyebrow}>ACCOUNT INDEX</span>
              <strong>个人导航</strong>
            </div>
            <nav aria-label="个人分区" className={styles.masterNav}>
              <button
                aria-current={section === "account" ? "page" : undefined}
                aria-label="账户摘要"
                className={section === "account" ? styles.activeRow : undefined}
                onClick={() => setSection("account")}
                type="button"
              >
                <AppIcon name="users" size={15} />
                <span>
                  <strong>账户摘要</strong>
                  <small>身份与验证状态</small>
                </span>
              </button>
              <button
                aria-current={section === "activity" ? "page" : undefined}
                aria-label="最近活动"
                className={
                  section === "activity" ? styles.activeRow : undefined
                }
                onClick={() => setSection("activity")}
                type="button"
              >
                <AppIcon name="timer" size={15} />
                <span>
                  <strong>活动记录</strong>
                  <small>会话与账户时间线</small>
                </span>
              </button>
              <button
                aria-current={section === "actions" ? "page" : undefined}
                aria-label="账户入口"
                className={section === "actions" ? styles.activeRow : undefined}
                onClick={() => setSection("actions")}
                type="button"
              >
                <AppIcon name="shield" size={15} />
                <span>
                  <strong>账户入口</strong>
                  <small>安全、设置与数据</small>
                </span>
              </button>
            </nav>
            <p className={styles.masterHint}>
              账户身份来自当前 Session；这里不编辑 Workspace 角色，也不绕过
              Space 权限。
            </p>
          </aside>
        }
        main={
          <div className={styles.mainPane}>
            <WorkbenchActionBar
              secondary={
                <button
                  className={styles.secondaryButton}
                  onClick={refresh}
                  type="button"
                >
                  <AppIcon name="refresh" size={14} />
                  刷新账户状态
                </button>
              }
            />
            <div className={styles.statusBar} aria-live="polite">
              <span className={`product-tag tone-${stateTone}`}>
                {sessionStatusLabel(state.status)}
              </span>
              <span>{stateText}</span>
            </div>
            <section
              className={styles.accountSection}
              data-testid="profile-account"
            >
              <header className={styles.sectionHeader}>
                <div>
                  <span className={styles.eyebrow}>ACCOUNT SUMMARY</span>
                  <h2>账户摘要</h2>
                  <p>系统只显示 Session 已确认的身份字段。</p>
                </div>
                <ProductTag tone={verified ? "good" : "warn"}>
                  {verified ? "邮箱已验证" : "邮箱待验证"}
                </ProductTag>
              </header>
              <div className={styles.identity}>
                <span aria-hidden="true" className={styles.avatar}>
                  {initials(user?.email)}
                </span>
                <div className={styles.identityCopy}>
                  <strong>{email}</strong>
                  <span>账户 ID：{user?.id ?? "不可用"}</span>
                  <span>账户状态：{user?.status ?? "不可用"}</span>
                </div>
              </div>
              <dl className={styles.detailGrid}>
                <div>
                  <dt>邮箱验证</dt>
                  <dd>
                    {verified
                      ? dateLabel(user?.email_verified_at)
                      : "需要完成验证"}
                  </dd>
                </div>
                <div>
                  <dt>账户创建</dt>
                  <dd>{dateLabel(user?.created_at)}</dd>
                </div>
                <div>
                  <dt>Session 到期</dt>
                  <dd>
                    {dateLabel(
                      state.status === "authenticated"
                        ? state.sessionExpiresAt
                        : null,
                    )}
                  </dd>
                </div>
              </dl>
            </section>
            <section
              className={styles.accountSection}
              data-testid="profile-activity"
            >
              <header className={styles.sectionHeader}>
                <div>
                  <span className={styles.eyebrow}>PERSONAL ACTIVITY</span>
                  <h2>最近活动</h2>
                  <p>活动摘要只使用当前账户与 Session 的可验证信息。</p>
                </div>
              </header>
              <ol className={styles.timeline}>
                <li>
                  <span className={styles.timelineMarker}>
                    <AppIcon name="shield" size={14} />
                  </span>
                  <div>
                    <strong>当前登录会话</strong>
                    <small>
                      {state.status === "authenticated"
                        ? `Session 有效至 ${dateLabel(state.sessionExpiresAt)}`
                        : "没有可用的活动会话"}
                    </small>
                  </div>
                  <ProductTag
                    tone={state.status === "authenticated" ? "good" : "warn"}
                  >
                    {state.status === "authenticated" ? "当前" : "需重试"}
                  </ProductTag>
                </li>
                <li>
                  <span className={styles.timelineMarker}>
                    <AppIcon name="users" size={14} />
                  </span>
                  <div>
                    <strong>账户创建</strong>
                    <small>
                      {user ? dateLabel(user.created_at) : "尚未读取账户资料"}
                    </small>
                  </div>
                  <ProductTag>账户事件</ProductTag>
                </li>
                <li>
                  <span className={styles.timelineMarker}>
                    <AppIcon name="files" size={14} />
                  </span>
                  <div>
                    <strong>验证状态</strong>
                    <small>
                      {verified
                        ? `邮箱于 ${dateLabel(user?.email_verified_at)} 验证`
                        : "邮箱仍待验证，帮助页提供恢复路径"}
                    </small>
                  </div>
                  <ProductTag tone={verified ? "good" : "warn"}>
                    {verified ? "已验证" : "待处理"}
                  </ProductTag>
                </li>
              </ol>
            </section>
            <section
              className={styles.accountSection}
              data-testid="profile-actions"
            >
              <header className={styles.sectionHeader}>
                <div>
                  <span className={styles.eyebrow}>ACCOUNT ACTIONS</span>
                  <h2>账户入口</h2>
                  <p>
                    高影响设置在专门工作区中完成，当前页面只负责清晰转达范围。
                  </p>
                </div>
              </header>
              <div className={styles.actionList}>
                <Link
                  aria-label="打开安全中心"
                  className={styles.actionRow}
                  href="/app/security"
                >
                  <span className={styles.actionIcon}>
                    <AppIcon name="shield" size={16} />
                  </span>
                  <span>
                    <strong>打开安全中心</strong>
                    <small>管理 Passkey、TOTP、恢复码和设备会话。</small>
                  </span>
                  <AppIcon name="chevron-down" size={15} />
                </Link>
                <Link
                  aria-label="调整个人设置"
                  className={styles.actionRow}
                  href="/app/settings"
                >
                  <span className={styles.actionIcon}>
                    <AppIcon name="target" size={16} />
                  </span>
                  <span>
                    <strong>调整个人设置</strong>
                    <small>切换学习画像、主题和导航入口。</small>
                  </span>
                  <AppIcon name="chevron-down" size={15} />
                </Link>
                <Link
                  aria-label="管理数据边界"
                  className={styles.actionRow}
                  href="/app/data"
                >
                  <span className={styles.actionIcon}>
                    <AppIcon name="archive" size={16} />
                  </span>
                  <span>
                    <strong>管理数据边界</strong>
                    <small>导出、导入或查看账户数据删除恢复路径。</small>
                  </span>
                  <AppIcon name="chevron-down" size={15} />
                </Link>
              </div>
            </section>
          </div>
        }
        inspector={
          <aside className={styles.inspectorPane}>
            <InspectorSection title="账户状态">
              <dl className={styles.kvList}>
                <div>
                  <dt>身份</dt>
                  <dd>已绑定当前 Session</dd>
                </div>
                <div>
                  <dt>验证</dt>
                  <dd>{verified ? "邮箱已验证" : "邮箱待验证"}</dd>
                </div>
                <div>
                  <dt>权限范围</dt>
                  <dd>本人账户</dd>
                </div>
              </dl>
            </InspectorSection>
            <InspectorSection title="边界说明">
              <p>
                个人页面不会改变 Workspace 成员角色、Space 权限或本机 Vault
                加密边界。
              </p>
              <Link className={styles.inspectorLink} href="/app/help">
                <AppIcon name="search" size={15} />
                需要恢复帮助
              </Link>
            </InspectorSection>
            <InspectorSection title="活动状态">
              <p className={styles.inspectorStatus} aria-live="polite">
                {stateText}
              </p>
            </InspectorSection>
          </aside>
        }
        toolbar={
          <WorkbenchToolbar label="账户工具">
            <span className={styles.toolbarStatus}>
              {state.status === "error"
                ? `请求编号：${state.error.requestId}`
                : "Session / 权限上下文"}
            </span>
          </WorkbenchToolbar>
        }
      />
    </main>
  );
}
