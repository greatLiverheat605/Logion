"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import { browserApiClient, LogionApiError } from "@/lib/api/client";

import { AuthFormShell, FormError, FormSuccess } from "./auth-form-shell";
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
      title="确认邮箱"
      description="设置初始密码后，返回登录页重新登录。确认不会自动创建登录会话。"
    >
      {token === null ? (
        <FormError requestId="missing-or-invalid-link" />
      ) : state === "success" ? (
        <FormSuccess>
          <p>邮箱已确认，密码已设置。</p>
          <Link href="/auth/login">前往登录</Link>
        </FormSuccess>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="new-password">新密码</label>
          <input
            id="new-password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
          <label htmlFor="confirm-password">再次输入密码</label>
          <input
            id="confirm-password"
            name="confirmation"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
            aria-describedby={
              fieldError === null ? undefined : "password-match-error"
            }
          />
          {fieldError !== null ? (
            <p id="password-match-error" className="field-error" role="alert">
              {fieldError}
            </p>
          ) : null}
          {state === "error" ? <FormError requestId={requestId} /> : null}
          <button type="submit" disabled={state === "pending"}>
            {state === "pending" ? "正在确认…" : "确认邮箱并设置密码"}
          </button>
        </form>
      )}
    </AuthFormShell>
  );
}
