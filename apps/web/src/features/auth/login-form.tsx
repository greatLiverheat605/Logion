"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import type { components } from "@logion/contracts";

import { browserApiClient, LogionApiError } from "@/lib/api/client";
import { resolveOnboardingAccess } from "@/features/onboarding/onboarding-access";

import { AuthFormShell, FormError, PasswordField } from "./auth-form-shell";
import { detectDeviceName } from "./device-name";
import { createPublicAuthApi, type LoginOutcome } from "./public-auth-api";

const authApi = createPublicAuthApi(browserApiClient);
type PasskeyOptions =
  components["schemas"]["PasskeyAuthenticationOptionsResponse"];
type AuthResponse = components["schemas"]["AuthResponse"];

async function nextRoute(response: AuthResponse): Promise<string> {
  if (response.user.status === "pending_deletion") return "/account/deletion";
  return (await resolveOnboardingAccess()) === "complete"
    ? "/app/today"
    : "/onboarding";
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
  const [clientReady, setClientReady] = useState(false);
  const [deviceName, setDeviceName] = useState("此浏览器");
  const [passkeyAvailable, setPasskeyAvailable] = useState(true);
  const [pending, setPending] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState<AuthResponse | null>(null);
  const [settingsBlocked, setSettingsBlocked] = useState(false);
  const [challenge, setChallenge] = useState<
    Extract<LoginOutcome, { kind: "mfa_required" }>["challenge"] | null
  >(null);
  const [mfaMethod, setMfaMethod] = useState<"totp" | "recovery_code">("totp");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDeviceName(detectDeviceName(window.navigator));
      setPasskeyAvailable(Boolean(window.PublicKeyCredential));
      setClientReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function routeAuthenticated(response: AuthResponse) {
    setAuthenticated(response);
    setSettingsBlocked(false);
    try {
      window.location.assign(await nextRoute(response));
    } catch {
      setSettingsBlocked(true);
    }
  }

  async function retrySettings() {
    if (authenticated === null) return;
    setPending(true);
    await routeAuthenticated(authenticated);
    setPending(false);
  }

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
        setMfaMethod(outcome.challenge.methods[0] ?? "totp");
      } else {
        await routeAuthenticated(outcome.response);
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
      await routeAuthenticated(response);
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
            device_name: deviceName,
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
      await routeAuthenticated(authenticated);
    } catch (error) {
      setRequestId(
        error instanceof LogionApiError ? error.requestId : "unavailable",
      );
    } finally {
      setPending(false);
    }
  }

  if (settingsBlocked) {
    return (
      <AuthFormShell
        identityTestId="login-identity"
        title="无法加载账号设置"
        description="账号已经通过验证，但暂时无法确认入门状态。为避免绕过必选引导，Logion 不会直接进入应用。"
      >
        <div className="auth-form" data-testid="login-credentials">
          <p className="form-message form-error" role="alert">
            无法加载账号设置，请重试。
          </p>
          <button
            data-workbench-primary="true"
            disabled={pending}
            type="button"
            onClick={() => void retrySettings()}
          >
            {pending ? "正在重试…" : "重试"}
          </button>
        </div>
        <nav
          aria-label="账户帮助"
          className="auth-links"
          data-testid="login-recovery"
        >
          <Link href="/auth/login">返回登录</Link>
          <Link href="/auth/recover">找回密码</Link>
        </nav>
      </AuthFormShell>
    );
  }

  return (
    <AuthFormShell
      identityTestId="login-identity"
      title={challenge === null ? "登录" : "验证第二因素"}
      description={
        challenge === null
          ? "使用已验证邮箱和密码登录。认证令牌只保存在受保护 Cookie 中。"
          : "输入认证器动态码或一枚未使用的恢复码。刷新页面会取消本次挑战。"
      }
    >
      {challenge === null ? (
        <form
          className="auth-form"
          data-testid="login-credentials"
          method="post"
          onSubmit={login}
        >
          <div className="auth-field">
            <label htmlFor="login-email">邮箱</label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={320}
              required
            />
          </div>
          <PasswordField
            id="login-password"
            label="密码"
            name="password"
            autoComplete="current-password"
            minLength={1}
            maxLength={128}
            required
          />
          <div className="auth-field">
            <label htmlFor="device-name">设备名称</label>
            <input
              id="device-name"
              name="device_name"
              autoComplete="off"
              value={deviceName}
              minLength={1}
              maxLength={80}
              onChange={(event) => setDeviceName(event.currentTarget.value)}
              required
            />
            <p className="auth-field-hint">用于识别和管理此设备会话。</p>
          </div>
          {requestId !== null ? <FormError requestId={requestId} /> : null}
          <button
            data-workbench-primary="true"
            type="submit"
            disabled={pending || !clientReady}
          >
            {pending ? "正在登录…" : "登录"}
          </button>
          <p className="auth-note">
            登录失败不会透露邮箱是否存在；会话令牌只保存在受保护 Cookie 中。
          </p>
          <div className="auth-divider">或</div>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void loginWithPasskey()}
            disabled={pending || !clientReady || !passkeyAvailable}
            title={
              passkeyAvailable
                ? "使用此设备上的 Passkey 登录"
                : "此浏览器环境不支持 Passkey，请使用密码登录"
            }
          >
            使用 Passkey 登录
          </button>
          {!passkeyAvailable && clientReady ? (
            <p className="auth-field-hint" role="status">
              此浏览器暂不支持 Passkey，密码登录仍可用。
            </p>
          ) : null}
        </form>
      ) : (
        <form
          className="auth-form"
          data-testid="login-credentials"
          method="post"
          onSubmit={verifyMfa}
        >
          <fieldset className="auth-choice-group">
            <legend>验证方式</legend>
            <div className="auth-choice-row">
              {challenge.methods.includes("totp") ? (
                <label>
                  <input
                    checked={mfaMethod === "totp"}
                    name="method"
                    type="radio"
                    value="totp"
                    onChange={() => setMfaMethod("totp")}
                  />
                  <span>认证器动态码</span>
                </label>
              ) : null}
              {challenge.methods.includes("recovery_code") ? (
                <label>
                  <input
                    checked={mfaMethod === "recovery_code"}
                    name="method"
                    type="radio"
                    value="recovery_code"
                    onChange={() => setMfaMethod("recovery_code")}
                  />
                  <span>恢复码</span>
                </label>
              ) : null}
            </div>
          </fieldset>
          <div className="auth-field">
            <label htmlFor="mfa-code">验证码</label>
            <input
              id="mfa-code"
              name="code"
              autoComplete="one-time-code"
              minLength={6}
              maxLength={32}
              required
            />
          </div>
          {requestId !== null ? <FormError requestId={requestId} /> : null}
          <button
            data-workbench-primary="true"
            type="submit"
            disabled={pending || !clientReady}
          >
            {pending ? "正在验证…" : "验证并登录"}
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setChallenge(null);
              setRequestId(null);
            }}
            disabled={pending || !clientReady}
          >
            取消
          </button>
        </form>
      )}
      <nav
        className="auth-links"
        aria-label="账户帮助"
        data-testid="login-recovery"
      >
        <Link href="/auth/register">使用邀请注册</Link>
        <Link href="/auth/recover">找回密码</Link>
      </nav>
    </AuthFormShell>
  );
}
