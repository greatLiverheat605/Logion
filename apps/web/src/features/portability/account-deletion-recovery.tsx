"use client";

import type { components } from "@logion/contracts";
import { useCallback, useEffect, useState } from "react";

import { browserApiClient, LogionApiError } from "@/lib/api/client";

type Deletion = components["schemas"]["AccountDeletionResponse"];

function errorText(error: unknown): string {
  if (error instanceof LogionApiError)
    return `操作未完成（${error.code}，请求编号：${error.requestId}）。`;
  return "无法读取账户删除状态，请重新登录。";
}

export function AccountDeletionRecovery() {
  const [deletion, setDeletion] = useState<Deletion | null>(null);
  const [status, setStatus] = useState("正在读取账户删除状态……");

  const load = useCallback(async () => {
    try {
      const value = await browserApiClient.request<Deletion>(
        "/api/v1/account-deletion",
      );
      setDeletion(value);
      setStatus(
        "账户当前只能访问此恢复页面。若不取消，宽限期结束后将执行清理。",
      );
    } catch (error) {
      setStatus(errorText(error));
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function cancel() {
    if (!deletion) return;
    try {
      await browserApiClient.request("/api/v1/account-deletion/cancel", {
        method: "POST",
        csrf: true,
        body: JSON.stringify({
          expected_version: deletion.version,
          confirmation: "KEEP MY ACCOUNT",
        }),
      });
      window.location.assign("/app");
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  return (
    <main id="main-content" className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">LOGION · ACCOUNT RECOVERY</p>
        <h1>账户正等待删除</h1>
        <p aria-live="polite">{status}</p>
        {deletion ? (
          <dl>
            <dt>删除时间</dt>
            <dd>{new Date(deletion.delete_after).toLocaleString()}</dd>
            <dt>政策版本</dt>
            <dd>{deletion.policy_version}</dd>
          </dl>
        ) : null}
        <button
          type="button"
          disabled={!deletion}
          onClick={() => void cancel()}
        >
          保留我的账户
        </button>
      </section>
    </main>
  );
}
