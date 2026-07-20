"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import { browserApiClient, LogionApiError } from "@/lib/api/client";

import { AuthFormShell, FormError, FormSuccess } from "./auth-form-shell";
import { createPublicAuthApi } from "./public-auth-api";
import { useFragmentToken } from "./use-fragment-token";

const authApi = createPublicAuthApi(browserApiClient);

export function PasswordRecoveryForm() {
  const token = useFragmentToken();
  const [state, setState] = useState<"idle" | "pending" | "success" | "error">(
    "idle",
  );
  const [requestId, setRequestId] = useState("unavailable");

  async function requestRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setState("pending");
    try {
      await authApi.startPasswordRecovery({
        email: String(data.get("email") ?? ""),
      });
      form.reset();
      setState("success");
    } catch (error) {
      setRequestId(
        error instanceof LogionApiError ? error.requestId : "unavailable",
      );
      setState("error");
    }
  }

  async function completeRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (token === null) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const method = String(data.get("method") ?? "none");
    const code = String(data.get("code") ?? "");
    if (
      (method === "totp" || method === "recovery_code") &&
      code.trim() === ""
    ) {
      form
        .querySelector<HTMLInputElement>("#recovery-code")
        ?.setCustomValidity("请输入第二因子验证码。");
      form.reportValidity();
      return;
    }
    setState("pending");
    try {
      await authApi.completePasswordRecovery({
        token,
        new_password: String(data.get("new_password") ?? ""),
        ...(method === "totp" || method === "recovery_code"
          ? { method, code }
          : {}),
      });
      form.reset();
      setState("success");
    } catch (error) {
      setRequestId(
        error instanceof LogionApiError ? error.requestId : "unavailable",
      );
      setState("error");
    }
  }

  const completing = token !== null;
  return (
    <AuthFormShell
      title={completing ? "设置新密码" : "找回密码"}
      description={
        completing
          ? "启用 TOTP 的账户还需要认证器动态码或恢复码。成功后所有在线会话都会退出。"
          : "所有邮箱都会得到相同响应，避免泄漏账户是否存在。"
      }
    >
      {state === "success" ? (
        <FormSuccess>
          <p>
            {completing
              ? "密码已更新，请重新登录。"
              : "如果账户符合条件，恢复邮件会在稍后送达。"}
          </p>
          <Link href="/auth/login">返回登录</Link>
        </FormSuccess>
      ) : completing ? (
        <form className="auth-form" onSubmit={completeRecovery}>
          <label htmlFor="recovery-password">新密码</label>
          <input
            id="recovery-password"
            name="new_password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
          <label htmlFor="recovery-method">
            第二因素（未启用时选择“不需要”）
          </label>
          <select id="recovery-method" name="method" defaultValue="none">
            <option value="none">不需要</option>
            <option value="totp">认证器动态码</option>
            <option value="recovery_code">恢复码</option>
          </select>
          <label htmlFor="recovery-code">第二因素验证码</label>
          <input
            id="recovery-code"
            name="code"
            autoComplete="one-time-code"
            maxLength={32}
            onInput={(event) => event.currentTarget.setCustomValidity("")}
          />
          {state === "error" ? <FormError requestId={requestId} /> : null}
          <button type="submit" disabled={state === "pending"}>
            {state === "pending" ? "正在更新…" : "更新密码并退出所有设备"}
          </button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={requestRecovery}>
          <label htmlFor="recovery-email">邮箱</label>
          <input
            id="recovery-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={320}
            required
          />
          {state === "error" ? <FormError requestId={requestId} /> : null}
          <button type="submit" disabled={state === "pending"}>
            {state === "pending" ? "正在提交…" : "发送恢复邮件"}
          </button>
        </form>
      )}
    </AuthFormShell>
  );
}
