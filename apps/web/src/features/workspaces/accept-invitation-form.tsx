"use client";

import type { components } from "@logion/contracts";
import Link from "next/link";
import { useRef, useState } from "react";

import { browserApiClient, LogionApiError } from "@/lib/api/client";
import { useFragmentToken } from "@/features/auth/use-fragment-token";
import {
  PublicFlowHeader,
  PublicFlowLink,
  PublicFlowShell,
  PublicFlowState,
} from "@/features/public-flows/public-flow-shell";

import styles from "@/features/public-flows/public-flow-workbench.module.css";

import { invitationLoginHref } from "./invitation-link";

type Workspace = components["schemas"]["WorkspaceResponse"];

export function AcceptInvitationForm() {
  const token = useFragmentToken();
  const busy = useRef(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<Workspace | null>(null);

  async function accept() {
    if (!token || busy.current) return;
    busy.current = true;
    setFailure(null);
    setPending(true);
    setRequestId(null);
    try {
      const workspace = await browserApiClient.request<Workspace>(
        "/api/v1/invitations/accept",
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify({ token }),
        },
      );
      setAccepted(workspace);
    } catch (error) {
      setFailure(
        error instanceof LogionApiError &&
          (error.status === 401 || error.code === "WEB_CSRF_MISSING")
          ? "请先登录受邀邮箱对应的账户，再返回此页面确认接受。"
          : error instanceof LogionApiError &&
              error.code === "INVITATION_INVALID"
            ? "邀请无效、已过期、已使用或已撤销。请确认受邀邮箱，或向管理员索取新链接。"
            : error instanceof LogionApiError && error.status === 403
              ? "当前账户无法接受此邀请，请确认使用受邀的已验证邮箱登录。"
              : "邀请未被接受，请检查账户及工作区状态后重试。已有成员可直接打开工作区。",
      );
      setRequestId(
        error instanceof LogionApiError ? error.requestId : "unavailable",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  if (accepted) {
    return (
      <PublicFlowShell>
        <PublicFlowState icon="✓" title="已加入工作区" tone="success">
          <p>成员身份与角色已由服务器确认，审计事件已记录。</p>
          <dl className={styles.metaList}>
            <div className={styles.metaRow}>
              <dt>Workspace</dt>
              <dd>{accepted.name}</dd>
            </div>
            <div className={styles.metaRow}>
              <dt>角色</dt>
              <dd>{accepted.role}</dd>
            </div>
          </dl>
          <div className={styles.actions}>
            <PublicFlowLink href="/app/workspaces" primary>
              打开工作区
            </PublicFlowLink>
          </div>
        </PublicFlowState>
      </PublicFlowShell>
    );
  }

  if (!token) {
    return (
      <PublicFlowShell>
        <PublicFlowHeader
          eyebrow="WORKSPACE INVITATION"
          title="接受工作区邀请"
          description="邀请令牌只从地址片段读取，并会在读取后从地址栏移除。"
        />
        <PublicFlowState icon="!" title="缺少或无效的邀请链接" tone="warning">
          <p>
            请打开管理员提供的完整邀请链接。链接过期或被撤销时，不会显示任何工作区信息。
          </p>
          <div className={styles.actions}>
            <PublicFlowLink href="/auth/login" primary>
              返回登录
            </PublicFlowLink>
          </div>
        </PublicFlowState>
      </PublicFlowShell>
    );
  }

  return (
    <PublicFlowShell>
      <PublicFlowHeader
        eyebrow="WORKSPACE INVITATION"
        title="接受工作区邀请"
        description="确认邀请后，服务器会验证账户、令牌状态、Workspace 和角色权限。"
      />
      <div className={styles.stack}>
        <section className={styles.region} data-testid="invite-summary">
          <h2>邀请摘要</h2>
          <dl className={styles.metaList}>
            <div className={styles.metaRow}>
              <dt>链接状态</dt>
              <dd>
                <span className={styles.badge}>令牌格式已验证</span>
              </dd>
            </div>
            <div className={styles.metaRow}>
              <dt>目标 Workspace</dt>
              <dd>接受时由服务器确认</dd>
            </div>
            <div className={styles.metaRow}>
              <dt>邀请邮箱</dt>
              <dd>接受时与当前已验证邮箱匹配</dd>
            </div>
          </dl>
        </section>

        <section className={styles.region} data-testid="invite-role">
          <h2>成员权限</h2>
          <p className={styles.muted}>
            角色不会由链接参数决定。接受动作会在服务端检查邀请是否仍为
            pending、账户是否已验证，以及 Workspace 是否仍可加入。
          </p>
          <p className={`${styles.notice} ${styles.noticeWarning}`}>
            个人内容仍保留在你的私有 Space；加入 Workspace
            不会扩大现有对象的可见范围。
          </p>
        </section>

        <section className={styles.region} data-testid="invite-action">
          <h2>完成加入</h2>
          {requestId ? (
            <div
              className={`${styles.notice} ${styles.noticeWarning}`}
              role="alert"
            >
              <p>{failure}</p>
              <p className={styles.subtleCode}>请求编号：{requestId}</p>
            </div>
          ) : null}
          <div className={styles.actions}>
            <button
              className={styles.primaryLink}
              data-workbench-primary="true"
              disabled={pending}
              type="button"
              onClick={() => void accept()}
            >
              {pending ? "正在加入…" : "接受邀请"}
            </button>
          </div>
        </section>

        <nav
          aria-label="邀请恢复"
          className={styles.linkRow}
          data-testid="invite-recovery"
        >
          <span>未验证邮箱？</span>
          <Link href={invitationLoginHref(token)} prefetch={false}>
            先登录并完成验证
          </Link>
          <Link href="/auth/register">创建新账户</Link>
          <span>注册、入门设置完成或刷新后，请重新打开原邀请链接。</span>
        </nav>
      </div>
    </PublicFlowShell>
  );
}
