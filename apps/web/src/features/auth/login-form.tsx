"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import type { components } from "@logion/contracts";

import { browserApiClient, LogionApiError } from "@/lib/api/client";

import { AuthFormShell, FormError } from "./auth-form-shell";
import { createPublicAuthApi, type LoginOutcome } from "./public-auth-api";

const authApi = createPublicAuthApi(browserApiClient);
type PasskeyOptions =
  components["schemas"]["PasskeyAuthenticationOptionsResponse"];
type AuthResponse = components["schemas"]["AuthResponse"];

function nextRoute(response: AuthResponse): string {
  return response.user.status === "pending_deletion"
    ? "/account/deletion"
    : "/app";
}

function decodeBase64url(value: string): ArrayBuffer {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(normalized), (character) =>
    character.charCodeAt(0),
  ).buffer;
}

function encodeBase64url(value: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(value)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function LoginForm() {
  const [pending, setPending] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<
    Extract<LoginOutcome, { kind: "mfa_required" }>["challenge"] | null
  >(null);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setRequestId(null);
    try {
      const outcome = await authApi.login({
        device_name: String(data.get("device_name") ?? ""),
        email: String(data.get("email") ?? ""),
        password: String(data.get("password") ?? ""),
        platform: "web",
      });
      form.reset();
      if (outcome.kind === "mfa_required") {
        setChallenge(outcome.challenge);
      } else {
        window.location.assign(nextRoute(outcome.response));
      }
    } catch (error) {
      setRequestId(
        error instanceof LogionApiError ? error.requestId : "unavailable",
      );
    } finally {
      setPending(false);
    }
  }

  async function verifyMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (challenge === null) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setRequestId(null);
    try {
      const response = await authApi.verifyMfa({
        challenge_token: challenge.challenge_token,
        code: String(data.get("code") ?? ""),
        method:
          data.get("method") === "recovery_code" ? "recovery_code" : "totp",
      });
      form.reset();
      setChallenge(null);
      window.location.assign(nextRoute(response));
    } catch (error) {
      setRequestId(
        error instanceof LogionApiError ? error.requestId : "unavailable",
      );
    } finally {
      setPending(false);
    }
  }

  async function loginWithPasskey() {
    if (!window.PublicKeyCredential) {
      setRequestId("passkey-not-supported");
      return;
    }
    setPending(true);
    setRequestId(null);
    try {
      const options = await browserApiClient.request<PasskeyOptions>(
        "/api/v1/auth/passkeys/login/options",
        { method: "POST" },
      );
      const credential = (await navigator.credentials.get({
        publicKey: {
          ...options.public_key,
          challenge: decodeBase64url(options.public_key.challenge),
          allowCredentials: options.public_key.allowCredentials.map((item) => ({
            id: decodeBase64url(item.id),
            type: "public-key" as const,
            transports: (item.transports ?? undefined) as
              | AuthenticatorTransport[]
              | undefined,
          })),
        },
      })) as PublicKeyCredential | null;
      if (!credential) throw new Error("Passkey cancelled");
      const response = credential.response as AuthenticatorAssertionResponse;
      const authenticated = await browserApiClient.request<AuthResponse>(
        "/api/v1/auth/passkeys/login/verify",
        {
          method: "POST",
          body: JSON.stringify({
            challenge_id: options.challenge_id,
            device_name: "此浏览器",
            platform: "web",
            credential: {
              id: credential.id,
              rawId: encodeBase64url(credential.rawId),
              type: "public-key",
              authenticatorAttachment: credential.authenticatorAttachment,
              clientExtensionResults: credential.getClientExtensionResults(),
              response: {
                authenticatorData: encodeBase64url(response.authenticatorData),
                clientDataJSON: encodeBase64url(response.clientDataJSON),
                signature: encodeBase64url(response.signature),
                userHandle: response.userHandle
                  ? encodeBase64url(response.userHandle)
                  : null,
              },
            },
          }),
        },
      );
      window.location.assign(nextRoute(authenticated));
    } catch (error) {
      setRequestId(
        error instanceof LogionApiError ? error.requestId : "unavailable",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthFormShell
      title={challenge === null ? "登录" : "验证第二因素"}
      description={
        challenge === null
          ? "使用已验证邮箱和密码登录。认证令牌只保存在受保护 Cookie 中。"
          : "输入认证器动态码或一枚未使用的恢复码。刷新页面会取消本次挑战。"
      }
    >
      {challenge === null ? (
        <form className="auth-form" onSubmit={login}>
          <label htmlFor="login-email">邮箱</label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={320}
            required
          />
          <label htmlFor="login-password">密码</label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            minLength={1}
            maxLength={128}
            required
          />
          <label htmlFor="device-name">设备名称</label>
          <input
            id="device-name"
            name="device_name"
            autoComplete="off"
            defaultValue="此浏览器"
            minLength={1}
            maxLength={80}
            required
          />
          {requestId !== null ? <FormError requestId={requestId} /> : null}
          <button type="submit" disabled={pending}>
            {pending ? "正在登录…" : "登录"}
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void loginWithPasskey()}
            disabled={pending}
          >
            使用 Passkey 登录
          </button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={verifyMfa}>
          <label htmlFor="mfa-method">验证方式</label>
          <select
            id="mfa-method"
            name="method"
            defaultValue={challenge.methods[0]}
          >
            {challenge.methods.includes("totp") ? (
              <option value="totp">认证器动态码</option>
            ) : null}
            {challenge.methods.includes("recovery_code") ? (
              <option value="recovery_code">恢复码</option>
            ) : null}
          </select>
          <label htmlFor="mfa-code">验证码</label>
          <input
            id="mfa-code"
            name="code"
            autoComplete="one-time-code"
            minLength={6}
            maxLength={32}
            required
          />
          {requestId !== null ? <FormError requestId={requestId} /> : null}
          <button type="submit" disabled={pending}>
            {pending ? "正在验证…" : "验证并登录"}
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setChallenge(null)}
            disabled={pending}
          >
            取消
          </button>
        </form>
      )}
      <nav className="auth-links" aria-label="账户帮助">
        <Link href="/auth/register">创建账户</Link>
        <Link href="/auth/recover">找回密码</Link>
      </nav>
    </AuthFormShell>
  );
}
