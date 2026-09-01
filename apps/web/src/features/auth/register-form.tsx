"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import { browserApiClient, LogionApiError } from "@/lib/api/client";

import { AuthFormShell, FormError, FormSuccess } from "./auth-form-shell";
import { createPublicAuthApi } from "./public-auth-api";

const authApi = createPublicAuthApi(browserApiClient);

export function RegisterForm() {
  const [state, setState] = useState<"idle" | "pending" | "success" | "error">(
    "idle",
  );
  const [requestId, setRequestId] = useState("unavailable");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "");
    setState("pending");
    setErrorMessage(undefined);
    try {
      await authApi.startRegistration({ email });
      form.reset();
      setState("success");
    } catch (error) {
      if (
        error instanceof LogionApiError &&
        error.code === "AUTH_REGISTRATION_CLOSED"
      ) {
        setErrorMessage("注册已关闭");
      }
      setRequestId(
        error instanceof LogionApiError ? error.requestId : "unavailable",
      );
      setState("error");
    }
  }

  return (
    <AuthFormShell
      eyebrow="REGISTRATION"
      title="创建账户"
      description="输入邮箱后，我们会发送一次性确认链接。无论账户是否存在，页面都会显示相同结果。"
    >
      <p className="auth-policy" data-testid="register-policy">
        <strong>受邀注册</strong> ·
        仅已受邀邮箱可继续，未收到邀请请联系工作区管理员。
      </p>
      {state === "success" ? (
        <div data-testid="register-form">
          <FormSuccess>
            <p>如果该邮箱可以注册，确认邮件会在稍后送达。</p>
          </FormSuccess>
        </div>
      ) : (
        <form
          className="auth-form"
          data-testid="register-form"
          onSubmit={submit}
        >
          <div className="auth-field">
            <label htmlFor="registration-email">邮箱</label>
            <input
              id="registration-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={320}
              required
            />
          </div>
          {state === "error" ? (
            <FormError message={errorMessage} requestId={requestId} />
          ) : null}
          <button
            data-workbench-primary="true"
            type="submit"
            disabled={state === "pending"}
          >
            {state === "pending" ? "正在提交…" : "发送确认邮件"}
          </button>
          <p className="auth-note">
            确认链接只在 URL fragment 中使用，页面不会把 token 发送到第三方。
          </p>
        </form>
      )}
      <p className="auth-switch" data-testid="register-recovery">
        已有账户？ <Link href="/auth/login">登录</Link>
      </p>
    </AuthFormShell>
  );
}
