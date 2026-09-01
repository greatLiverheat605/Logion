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

export function VerifyEmailForm() {
  const token = useFragmentToken();
  const [state, setState] = useState<"idle" | "pending" | "success" | "error">(
    "idle",
  );
  const [requestId, setRequestId] = useState("unavailable");
  const [fieldError, setFieldError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (token === null) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get("password") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");
    if (password !== confirmation) {
      setFieldError("两次输入的密码不一致。");
      return;
    }
    setFieldError(null);
    setState("pending");
    try {
      await authApi.confirmEmail({ token, password });
      form.reset();
      setState("success");
    } catch (error) {
      setRequestId(
        error instanceof LogionApiError ? error.requestId : "unavailable",
      );
      setState("error");
    }
  }

  return (
    <AuthFormShell
      eyebrow="EMAIL VERIFICATION"
      title="确认邮箱"
      description="设置初始密码后，返回登录页重新登录。确认不会自动创建登录会话。"
    >
      <p className="auth-policy" data-testid="verify-state">
        {token === null
          ? "当前链接缺少有效验证 token，请重新申请确认邮件。"
          : "验证 token 已从地址栏安全读取并移除。"}
      </p>
      <div data-testid="verify-credentials">
        {token === null ? (
          <FormError
            message="验证链接无效或已失效。"
            requestId="missing-or-invalid-link"
          />
        ) : state === "success" ? (
          <FormSuccess>
            <p>邮箱已确认，密码已设置。</p>
          </FormSuccess>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            <PasswordField
              id="new-password"
              label="新密码"
              name="password"
              autoComplete="new-password"
              hint="至少 12 个字符。"
              minLength={12}
              maxLength={128}
              required
            />
            <PasswordField
              aria-describedby={
                fieldError === null ? undefined : "password-match-error"
              }
              aria-invalid={fieldError === null ? undefined : true}
              id="confirm-password"
              label="再次输入密码"
              name="confirmation"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
            />
            {fieldError !== null ? (
              <p id="password-match-error" className="field-error" role="alert">
                {fieldError}
              </p>
            ) : null}
            {state === "error" ? <FormError requestId={requestId} /> : null}
            <button
              data-workbench-primary="true"
              type="submit"
              disabled={state === "pending"}
            >
              {state === "pending" ? "正在确认…" : "确认邮箱并设置密码"}
            </button>
          </form>
        )}
      </div>
      <p className="auth-switch" data-testid="verify-recovery">
        链接有问题？ <Link href="/auth/register">重新申请</Link>
        <Link href="/auth/login">返回登录</Link>
      </p>
    </AuthFormShell>
  );
}
