"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import { browserApiClient, LogionApiError } from "@/lib/api/client";

import {
  AuthFormShell,
  FormError,
  FormSuccess,
  PasswordField,
} from "./auth-form-shell";
import { createPublicAuthApi } from "./public-auth-api";
import { useFragmentToken } from "./use-fragment-token";

const authApi = createPublicAuthApi(browserApiClient);

export function PasswordRecoveryForm() {
  const token = useFragmentToken();
  const [state, setState] = useState<"idle" | "pending" | "success" | "error">(
    "idle",
  );
  const [requestId, setRequestId] = useState("unavailable");
  const [recoveryMethod, setRecoveryMethod] = useState<
    "none" | "totp" | "recovery_code"
  >("none");

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
      eyebrow="ACCOUNT RECOVERY"
      title={completing ? "设置新密码" : "找回密码"}
      description={
        completing
          ? "启用 TOTP 的账户还需要认证器动态码或恢复码。成功后所有在线会话都会退出。"
          : "所有邮箱都会得到相同响应，避免泄漏账户是否存在。"
      }
    >
      <div data-testid="recover-form">
        {state === "success" ? (
          <FormSuccess>
            <p>
              {completing
                ? "密码已更新，请重新登录。"
                : "如果账户符合条件，恢复邮件会在稍后送达。"}
            </p>
          </FormSuccess>
        ) : completing ? (
          <form className="auth-form" onSubmit={completeRecovery}>
            <PasswordField
              id="recovery-password"
              label="新密码"
              name="new_password"
              autoComplete="new-password"
              hint="至少 12 个字符；完成后现有在线会话会全部退出。"
              minLength={12}
              maxLength={128}
              required
            />
            <fieldset className="auth-choice-group">
              <legend>第二因素</legend>
              <div className="auth-choice-row auth-choice-row-three">
                {(
                  [
                    ["none", "不需要"],
                    ["totp", "动态码"],
                    ["recovery_code", "恢复码"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value}>
                    <input
                      checked={recoveryMethod === value}
                      name="method"
                      type="radio"
                      value={value}
                      onChange={() => setRecoveryMethod(value)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {recoveryMethod !== "none" ? (
              <div className="auth-field">
                <label htmlFor="recovery-code">第二因素验证码</label>
                <input
                  id="recovery-code"
                  name="code"
                  autoComplete="one-time-code"
                  maxLength={32}
                  required
                  onInput={(event) => event.currentTarget.setCustomValidity("")}
                />
              </div>
            ) : null}
            {state === "error" ? <FormError requestId={requestId} /> : null}
            <button
              data-workbench-primary="true"
              type="submit"
              disabled={state === "pending"}
            >
              {state === "pending" ? "正在更新…" : "更新密码并退出所有设备"}
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={requestRecovery}>
            <div className="auth-field">
              <label htmlFor="recovery-email">邮箱</label>
              <input
                id="recovery-email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength={320}
                required
              />
            </div>
            {state === "error" ? <FormError requestId={requestId} /> : null}
            <button
              data-workbench-primary="true"
              type="submit"
              disabled={state === "pending"}
            >
              {state === "pending" ? "正在提交…" : "发送恢复邮件"}
            </button>
          </form>
        )}
      </div>
      <p className="auth-note auth-policy" data-testid="recover-feedback">
        {completing
          ? "恢复 token 仅使用一次，并在 30 分钟后失效。"
          : "所有邮箱都会得到相同响应，避免泄漏账户是否存在。"}
      </p>
      <p className="auth-switch" data-testid="recover-exit">
        想起密码了？ <Link href="/auth/login">返回登录</Link>
      </p>
    </AuthFormShell>
  );
}
