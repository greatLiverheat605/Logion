"use client";

import type { components } from "@logion/contracts";
import { useCallback, useEffect, useState } from "react";

import { browserApiClient, LogionApiError } from "@/lib/api/client";
import {
  PublicFlowHeader,
  PublicFlowShell,
  PublicFlowState,
} from "@/features/public-flows/public-flow-shell";

import styles from "@/features/public-flows/public-flow-workbench.module.css";

type Deletion = components["schemas"]["AccountDeletionResponse"];

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "未知"
    : new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function errorText(error: unknown): string {
  if (error instanceof LogionApiError) {
    return `操作未完成（${error.code}，请求编号：${error.requestId}）。`;
  }
  return "无法读取账户删除状态，请重新登录后重试。";
}

export function AccountDeletionRecovery() {
  const [deletion, setDeletion] = useState<Deletion | null>(null);
  const [status, setStatus] = useState("正在读取账户删除状态……");
  const [loading, setLoading] = useState(true);
  const [cancelled, setCancelled] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const value = await browserApiClient.request<Deletion>(
        "/api/v1/account-deletion",
      );
      setDeletion(value);
      setStatus("账户当前只能访问恢复流程；宽限期结束后将按政策执行清理。");
    } catch (error) {
      setDeletion(null);
      setStatus(errorText(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(handle);
  }, [load]);

  async function cancel() {
    if (!deletion || cancelled) return;
    setLoading(true);
    try {
      await browserApiClient.request<Deletion>(
        "/api/v1/account-deletion/cancel",
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify({
            expected_version: deletion.version,
            confirmation: "KEEP MY ACCOUNT",
          }),
        },
      );
      setCancelled(true);
      setStatus("删除已取消，账户已恢复。正在返回工作台……");
      window.location.assign("/app");
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setLoading(false);
    }
  }

  if (cancelled) {
    return (
      <PublicFlowShell>
        <PublicFlowState icon="✓" title="账户已恢复" tone="success">
          <p>
            取消删除成功，账户状态已回到
            active；宽限期内撤销的会话、设备和分享需要重新建立。
          </p>
          <p aria-live="polite" className={styles.muted}>
            {status}
          </p>
        </PublicFlowState>
      </PublicFlowShell>
    );
  }

  return (
    <PublicFlowShell>
      <PublicFlowHeader
        eyebrow="LOGION · ACCOUNT RECOVERY"
        title="账户正等待删除"
        description="这是 pending_deletion 账户唯一可访问的恢复入口。"
      />
      {loading && !deletion ? (
        <PublicFlowState icon="…" title="正在读取删除状态">
          <p aria-live="polite">{status}</p>
        </PublicFlowState>
      ) : !deletion ? (
        <PublicFlowState icon="!" title="无法读取删除状态" tone="error">
          <p aria-live="polite">{status}</p>
          <div className={styles.actions}>
            <button
              className={styles.primaryLink}
              type="button"
              onClick={() => void load()}
            >
              重新读取
            </button>
            <a className={styles.secondaryLink} href="/auth/login">
              返回登录
            </a>
          </div>
        </PublicFlowState>
      ) : (
        <div className={styles.stack}>
          <section className={styles.region} data-testid="deletion-impact">
            <h2>影响范围</h2>
            <dl className={styles.metaList}>
              <div className={styles.metaRow}>
                <dt>删除执行时间</dt>
                <dd>{formatDate(deletion.delete_after)}</dd>
              </div>
              <div className={styles.metaRow}>
                <dt>政策版本</dt>
                <dd>{deletion.policy_version}</dd>
              </div>
              <div className={styles.metaRow}>
                <dt>拥有的 Workspace</dt>
                <dd>
                  {deletion.owned_workspace_ids.length} 个（所有权需提前转移）
                </dd>
              </div>
              <div className={styles.metaRow}>
                <dt>已撤销</dt>
                <dd>
                  会话、Refresh Token、设备、公开分享、日历 Feed、执行中的 AI
                  运行
                </dd>
              </div>
            </dl>
          </section>

          <section className={styles.region} data-testid="deletion-permission">
            <h2>受限恢复权限</h2>
            <p className={styles.muted}>
              当前会话只能读取删除状态并调用取消端点；不会重新打开
              Workspace、Space 或个人内容。
            </p>
            <p className={`${styles.notice} ${styles.noticeWarning}`}>
              取消需要最近认证、CSRF、当前 version，以及固定短语 KEEP MY
              ACCOUNT。服务端会再次检查宽限期和权限。
            </p>
          </section>

          <section
            className={styles.region}
            data-testid="deletion-confirmation"
          >
            <h2>取消删除</h2>
            <div className={styles.field}>
              <label htmlFor="deletion-confirmation-phrase">确认短语</label>
              <input
                autoComplete="off"
                id="deletion-confirmation-phrase"
                pattern="KEEP MY ACCOUNT"
                placeholder="KEEP MY ACCOUNT"
                required
                value={confirmation}
                onChange={(event) => setConfirmation(event.currentTarget.value)}
              />
            </div>
            <div className={styles.actions}>
              <button
                className={styles.primaryLink}
                data-workbench-primary="true"
                disabled={loading || confirmation !== "KEEP MY ACCOUNT"}
                type="button"
                onClick={() => void cancel()}
              >
                {loading ? "正在恢复…" : "保留我的账户"}
              </button>
            </div>
            <p aria-live="polite" className={styles.muted}>
              {status}
            </p>
          </section>

          <section className={styles.region} data-testid="deletion-recovery">
            <h2>恢复路径</h2>
            <p className={styles.muted}>
              取消成功后账户回到
              active。由于原会话、设备和分享已撤销，需要重新登录并按需重新建立。
            </p>
            <div className={styles.linkRow}>
              <a href="/auth/login">重新登录</a>
              <a href="/auth/recover">找回账户</a>
            </div>
          </section>
        </div>
      )}
    </PublicFlowShell>
  );
}
