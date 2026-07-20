"use client";

import type { components } from "@logion/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { browserApiClient, LogionApiError } from "@/lib/api/client";

type Device = components["schemas"]["DeviceResponse"];
type Passkey = components["schemas"]["PasskeyCredentialResponse"];
type TotpStatus = components["schemas"]["TotpStatusResponse"];
type Enrollment = components["schemas"]["TotpEnrollmentResponse"];
type RegistrationOptions =
  components["schemas"]["PasskeyRegistrationOptionsResponse"];
type CredentialDescriptor =
  components["schemas"]["WebAuthnCredentialDescriptor"];

function base64url(value: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(value)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function decode(value: string): ArrayBuffer {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const bytes = Uint8Array.from(atob(normalized), (character) =>
    character.charCodeAt(0),
  );
  return bytes.buffer;
}

function message(error: unknown): string {
  return error instanceof LogionApiError
    ? `操作未完成（请求编号：${error.requestId}）`
    : "操作未完成，请稍后重试。";
}

export function SecurityCenter() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [totp, setTotp] = useState<TotpStatus | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [status, setStatus] = useState("正在读取安全设置…");

  const load = useCallback(async () => {
    try {
      const [deviceResult, passkeyResult, totpResult] = await Promise.all([
        browserApiClient.request<{ devices: Device[] }>("/api/v1/auth/devices"),
        browserApiClient.request<{ credentials: Passkey[] }>(
          "/api/v1/auth/passkeys",
        ),
        browserApiClient.request<TotpStatus>("/api/v1/auth/totp"),
      ]);
      setDevices(
        Array.isArray(deviceResult.devices) ? deviceResult.devices : [],
      );
      setPasskeys(
        Array.isArray(passkeyResult.credentials)
          ? passkeyResult.credentials
          : [],
      );
      setTotp(totpResult);
      setStatus("安全设置已更新。");
    } catch (error) {
      setStatus(message(error));
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function revokeDevice(id: string) {
    if (!window.confirm("撤销后该设备上的全部会话会立即失效。继续吗？")) return;
    try {
      await browserApiClient.request(`/api/v1/auth/devices/${id}`, {
        method: "DELETE",
        csrf: true,
      });
      await load();
    } catch (error) {
      setStatus(message(error));
    }
  }

  async function registerPasskey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.PublicKeyCredential) {
      setStatus("此浏览器不支持 Passkey。");
      return;
    }
    const name = String(new FormData(event.currentTarget).get("name") ?? "");
    try {
      const options = await browserApiClient.request<RegistrationOptions>(
        "/api/v1/auth/passkeys/register/options",
        { method: "POST", csrf: true },
      );
      const publicKey = options.public_key;
      const credential = (await navigator.credentials.create({
        publicKey: {
          ...publicKey,
          challenge: decode(publicKey.challenge),
          user: { ...publicKey.user, id: decode(publicKey.user.id) },
          excludeCredentials: publicKey.excludeCredentials.map(
            (item: CredentialDescriptor) => ({
              id: decode(item.id),
              transports: (item.transports ?? undefined) as
                | AuthenticatorTransport[]
                | undefined,
              type: "public-key" as const,
            }),
          ),
        },
      })) as PublicKeyCredential | null;
      if (credential === null) throw new Error("Passkey cancelled");
      const response = credential.response as AuthenticatorAttestationResponse;
      await browserApiClient.request("/api/v1/auth/passkeys/register/verify", {
        method: "POST",
        csrf: true,
        body: JSON.stringify({
          challenge_id: options.challenge_id,
          name,
          credential: {
            id: credential.id,
            rawId: base64url(credential.rawId),
            type: "public-key",
            authenticatorAttachment: credential.authenticatorAttachment,
            clientExtensionResults: credential.getClientExtensionResults(),
            response: {
              attestationObject: base64url(response.attestationObject),
              clientDataJSON: base64url(response.clientDataJSON),
              transports: response.getTransports(),
            },
          },
        }),
      });
      event.currentTarget.reset();
      await load();
    } catch (error) {
      setStatus(message(error));
    }
  }

  async function revokePasskey(id: string) {
    if (!window.confirm("确认撤销这个 Passkey？")) return;
    try {
      await browserApiClient.request(`/api/v1/auth/passkeys/${id}`, {
        method: "DELETE",
        csrf: true,
      });
      await load();
    } catch (error) {
      setStatus(message(error));
    }
  }

  async function startTotp() {
    try {
      setEnrollment(
        await browserApiClient.request<Enrollment>(
          "/api/v1/auth/totp/enrollment",
          { method: "POST", csrf: true },
        ),
      );
    } catch (error) {
      setStatus(message(error));
    }
  }

  async function verifyTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    try {
      const result = await browserApiClient.request<{
        recovery_codes: string[];
      }>("/api/v1/auth/totp/enrollment/verify", {
        method: "POST",
        csrf: true,
        body: JSON.stringify({ code }),
      });
      setRecoveryCodes(result.recovery_codes);
      setEnrollment(null);
      await load();
    } catch (error) {
      setStatus(message(error));
    }
  }

  async function regenerateCodes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    if (!window.confirm("生成新恢复码后，旧恢复码会全部失效。继续吗？")) return;
    try {
      const result = await browserApiClient.request<{
        recovery_codes: string[];
      }>("/api/v1/auth/totp/recovery-codes/regenerate", {
        method: "POST",
        csrf: true,
        body: JSON.stringify({ code }),
      });
      setRecoveryCodes(result.recovery_codes);
      event.currentTarget.reset();
      await load();
    } catch (error) {
      setStatus(message(error));
    }
  }

  async function disableTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    if (!window.confirm("关闭 TOTP 会同时废止剩余恢复码。继续吗？")) return;
    try {
      await browserApiClient.request("/api/v1/auth/totp", {
        method: "DELETE",
        csrf: true,
        body: JSON.stringify({ code }),
      });
      setRecoveryCodes([]);
      event.currentTarget.reset();
      await load();
    } catch (error) {
      setStatus(message(error));
    }
  }

  return (
    <main id="main-content" className="settings-page">
      <header>
        <p className="eyebrow">LOGION · SECURITY</p>
        <h1>账户安全</h1>
        <p aria-live="polite">{status}</p>
      </header>
      <section className="settings-card">
        <h2>设备与会话</h2>
        <ul className="item-list">
          {devices.map((device) => (
            <li key={device.id}>
              <span>
                <strong>{device.name}</strong>
                <small>
                  {device.platform} · {device.current ? "当前设备" : "其他设备"}
                </small>
              </span>
              <button
                onClick={() => void revokeDevice(device.id)}
                disabled={device.revoked_at !== null}
              >
                {device.revoked_at ? "已撤销" : "撤销"}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="settings-card">
        <h2>Passkey</h2>
        <form className="inline-form" onSubmit={registerPasskey}>
          <label htmlFor="passkey-name">名称</label>
          <input id="passkey-name" name="name" maxLength={80} required />
          <button>添加 Passkey</button>
        </form>
        <ul className="item-list">
          {passkeys.map((key) => (
            <li key={key.id}>
              <span>
                <strong>{key.name}</strong>
                <small>{key.credential_device_type}</small>
              </span>
              <button
                onClick={() => void revokePasskey(key.id)}
                disabled={key.revoked_at !== null}
              >
                撤销
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="settings-card">
        <h2>认证器与恢复码</h2>
        {totp?.enabled ? (
          <>
            <p>已启用，剩余恢复码：{totp.recovery_codes_remaining}</p>
            <form className="inline-form" onSubmit={regenerateCodes}>
              <label htmlFor="regenerate-code">当前动态码</label>
              <input
                id="regenerate-code"
                name="code"
                autoComplete="one-time-code"
                required
              />
              <button>重新生成恢复码</button>
            </form>
            <form className="inline-form danger-zone" onSubmit={disableTotp}>
              <label htmlFor="disable-code">当前动态码</label>
              <input
                id="disable-code"
                name="code"
                autoComplete="one-time-code"
                required
              />
              <button>关闭 TOTP</button>
            </form>
          </>
        ) : (
          <button onClick={() => void startTotp()}>启用 TOTP</button>
        )}
        {enrollment ? (
          <div className="secret-panel">
            <p>在认证器中导入以下密钥（仅本次显示）：</p>
            <code>{enrollment.secret}</code>
            <form className="inline-form" onSubmit={verifyTotp}>
              <label htmlFor="totp-code">6 位动态码</label>
              <input
                id="totp-code"
                name="code"
                inputMode="numeric"
                minLength={6}
                maxLength={8}
                required
              />
              <button>验证并启用</button>
            </form>
          </div>
        ) : null}
        {recoveryCodes.length > 0 ? (
          <div className="recovery-panel" role="status">
            <h3>立即保存恢复码</h3>
            <p>离开后不再显示。每个恢复码只能使用一次。</p>
            <ul>
              {recoveryCodes.map((code) => (
                <li key={code}>
                  <code>{code}</code>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </main>
  );
}
