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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "");
    setState("pending");
    try {
      await authApi.startRegistration({ email });
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
      title="创建账户"
      description="输入邮箱后，我们会发送一次性确认链接。无论账户是否存在，页面都会显示相同结果。"
    >
      {state === "success" ? (
        <FormSuccess>
          <p>如果该邮箱可以注册，确认邮件会在稍后送达。</p>
          <Link href="/auth/login">返回登录</Link>
        </FormSuccess>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="registration-email">邮箱</label>
          <input
            id="registration-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={320}
            required
          />
          {state === "error" ? <FormError requestId={requestId} /> : null}
          <button type="submit" disabled={state === "pending"}>
            {state === "pending" ? "正在提交…" : "发送确认邮件"}
          </button>
        </form>
      )}
      <p className="auth-switch">
        已有账户？ <Link href="/auth/login">登录</Link>
      </p>
    </AuthFormShell>
  );
}
