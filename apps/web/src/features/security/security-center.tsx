"use client";

import type { components } from "@logion/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { ProductEmptyState, ProductTag } from "@/components/product/product-ui";
import { LogionApiError } from "@/lib/api/client";
import { AppIcon } from "@/components/app-shell/app-icon";
import {
  InspectorSection,
  WorkbenchActionBar,
  WorkbenchContextBar,
  WorkbenchFrame,
  WorkbenchHeader,
  WorkbenchToolbar,
} from "@/components/product/workbench";
import { WorkbenchSheet, WorkbenchTabPanel, WorkbenchTabs } from "@/components/product/headless-ui";

import styles from "./security-workbench.module.css";
import { useSecurityController } from "./use-security-controller";

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
  const { request } = useSecurityController();
  const [devices, setDevices] = useState<Device[]>([]);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [totp, setTotp] = useState<TotpStatus | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [status, setStatus] = useState("正在读取安全设置…");
  const [tab, setTab] = useState("checklist");
  const [passkeySheetOpen, setPasskeySheetOpen] = useState(false);
  const [totpSheetOpen, setTotpSheetOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [deviceResult, passkeyResult, totpResult] = await Promise.all([
        request<{ devices: Device[] }>("/api/v1/auth/devices"),
        request<{ credentials: Passkey[] }>(
          "/api/v1/auth/passkeys",
        ),
        request<TotpStatus>("/api/v1/auth/totp"),
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
  }, [request]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function revokeDevice(id: string) {
    if (!window.confirm("撤销后该设备上的全部会话会立即失效。继续吗？")) return;
    try {
      await request(`/api/v1/auth/devices/${id}`, {
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
      const options = await request<RegistrationOptions>(
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
      await request("/api/v1/auth/passkeys/register/verify", {
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
      await request(`/api/v1/auth/passkeys/${id}`, {
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
      setTotpSheetOpen(true);
      setEnrollment(
        await request<Enrollment>(
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
      const result = await request<{
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
      const result = await request<{
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
      await request("/api/v1/auth/totp", {
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
    <main id="main-content" className={styles.root}>
      <WorkbenchFrame
        label="账户安全工作台"
        header={<WorkbenchHeader eyebrow="SECURITY · ACCOUNT PROTECTION" title="账户安全" description="先完成清单中的下一项保护，再管理凭据、恢复码和设备会话。" actions={<ProductTag tone={totp?.enabled ? "good" : "warn"}>{totp?.enabled ? "双因素已启用" : "建议启用双因素"}</ProductTag>} />}
        context={<WorkbenchContextBar context={{ permission: { label: "本人账户", tone: "good" }, sync: { label: "实时安全状态", tone: "good" }, vault: { label: "会话安全" } }} />}
        toolbar={<WorkbenchToolbar label="安全工具"><span className={styles.toolbarStatus} aria-live="polite">{status}</span></WorkbenchToolbar>}
        masterLabel="安全清单"
        master={<aside className={styles.masterPane}><div className={styles.paneHeading}><span className={styles.eyebrow}>SECURITY CHECKLIST</span><strong>保护清单</strong></div><nav className={styles.masterNav} aria-label="安全设置分区"><button className={tab === "checklist" ? styles.activeRow : undefined} type="button" onClick={() => setTab("checklist")}><AppIcon name="shield" size={14} /><span><strong>保护概览</strong><small>{[passkeys.some((item) => item.revoked_at === null), Boolean(totp?.enabled), devices.some((item) => item.current && item.revoked_at === null)].filter(Boolean).length} / 3 项完成</small></span></button><button className={tab === "credentials" ? styles.activeRow : undefined} type="button" onClick={() => setTab("credentials")}><AppIcon name="files" size={14} /><span><strong>登录凭据</strong><small>{passkeys.filter((item) => item.revoked_at === null).length} 个 Passkey</small></span><ProductTag tone={passkeys.some((item) => item.revoked_at === null) ? "good" : "warn"}>{passkeys.some((item) => item.revoked_at === null) ? "已配置" : "待配置"}</ProductTag></button><button className={tab === "devices" ? styles.activeRow : undefined} type="button" onClick={() => setTab("devices")}><AppIcon name="layout-template" size={14} /><span><strong>设备与会话</strong><small>{devices.filter((item) => item.revoked_at === null).length} 个有效设备</small></span></button><button className={tab === "recovery" ? styles.activeRow : undefined} type="button" onClick={() => setTab("recovery")}><AppIcon name="lock" size={14} /><span><strong>认证器与恢复</strong><small>{totp?.enabled ? `${totp.recovery_codes_remaining} 个恢复码` : "TOTP 未启用"}</small></span><ProductTag tone={totp?.enabled ? "good" : "warn"}>{totp?.enabled ? "已启用" : "待处理"}</ProductTag></button></nav><div className={styles.masterHint}>恢复码只在生成后显示一次；撤销设备或凭据会立即影响对应会话。</div></aside>}
        mainLabel="安全设置"
        main={<div className={styles.mainPane}><WorkbenchActionBar secondary={<button className={styles.secondaryButton} type="button" onClick={() => void load()}><AppIcon name="refresh" size={14} />刷新状态</button>} primary={!totp?.enabled ? <button className={styles.primaryButton} type="button" onClick={() => void startTotp()}><AppIcon name="lock" size={14} />启用 TOTP</button> : !passkeys.some((item) => item.revoked_at === null) ? <button className={styles.primaryButton} type="button" onClick={() => setPasskeySheetOpen(true)}><AppIcon name="files" size={14} />添加 Passkey</button> : undefined} /><WorkbenchTabs label="安全设置视图" onValueChange={setTab} tabs={[{ label: "概览", value: "checklist" }, { label: "凭据", value: "credentials", count: passkeys.length }, { label: "设备", value: "devices", count: devices.length }, { label: "恢复", value: "recovery" }]} value={tab}><WorkbenchTabPanel value="checklist"><section className={styles.dataSection} data-testid="security-checklist"><header className={styles.sectionHeader}><div><span className={styles.eyebrow}>NEXT PROTECTION STEP</span><h2>下一项保护</h2></div><ProductTag tone={!totp?.enabled || !passkeys.some((item) => item.revoked_at === null) ? "warn" : "good"}>{!totp?.enabled ? "建议立即完成" : !passkeys.some((item) => item.revoked_at === null) ? "建议补齐" : "基础保护已完成"}</ProductTag></header><ul className={styles.checklist}><li data-complete={devices.some((item) => item.current && item.revoked_at === null)}><span><strong>当前设备会话</strong><small>确认本次登录设备仍由你控制</small></span><ProductTag tone="good">{devices.some((item) => item.current && item.revoked_at === null) ? "已确认" : "读取中"}</ProductTag></li><li data-complete={passkeys.some((item) => item.revoked_at === null)}><span><strong>抗钓鱼登录凭据</strong><small>Passkey 可降低密码和钓鱼风险</small></span><ProductTag tone={passkeys.some((item) => item.revoked_at === null) ? "good" : "warn"}>{passkeys.some((item) => item.revoked_at === null) ? "已配置" : "待添加"}</ProductTag></li><li data-complete={Boolean(totp?.enabled)}><span><strong>第二验证因素</strong><small>TOTP 与一次性恢复码用于账户恢复</small></span><ProductTag tone={totp?.enabled ? "good" : "warn"}>{totp?.enabled ? "已启用" : "待启用"}</ProductTag></li></ul></section></WorkbenchTabPanel><WorkbenchTabPanel value="credentials"><section className={styles.dataSection} data-testid="security-settings"><header className={styles.sectionHeader}><div><span className={styles.eyebrow}>PASSKEYS</span><h2>登录凭据</h2></div><button className={styles.secondaryButton} type="button" onClick={() => setPasskeySheetOpen(true)}><AppIcon name="plus" size={14} />添加 Passkey</button></header><p className={styles.muted}>Passkey 由系统认证器保护；名称只用于识别，不会改变凭据本身。</p>{passkeys.length ? <ul className={styles.dataList}>{passkeys.map((key) => <li key={key.id}><span><strong>{key.name}</strong><small>{key.credential_device_type} · {key.revoked_at ? "已撤销" : "当前有效"}</small></span><button className={styles.dangerButton} type="button" disabled={key.revoked_at !== null} onClick={() => void revokePasskey(key.id)}>{key.revoked_at ? "已撤销" : "撤销"}</button></li>)}</ul> : <ProductEmptyState icon="＋" title="还没有 Passkey" description="添加一个容易识别的名称，随后使用系统认证器完成注册。" />}</section></WorkbenchTabPanel><WorkbenchTabPanel value="devices"><section className={styles.dataSection} data-testid="security-devices"><header className={styles.sectionHeader}><div><span className={styles.eyebrow}>ACTIVE SESSIONS</span><h2>设备与会话</h2></div><ProductTag tone="info">{devices.filter((item) => item.revoked_at === null).length} 个有效</ProductTag></header><p className={styles.muted}>撤销会立即使该设备上的全部会话失效；当前设备不可被误操作隐藏。</p>{devices.length ? <ul className={styles.dataList}>{devices.map((device) => <li key={device.id}><span><strong>{device.name}</strong><small>{device.platform} · {device.current ? "当前设备" : "其他设备"} · {device.revoked_at ? "已撤销" : "有效"}</small></span><button className={styles.dangerButton} type="button" disabled={device.revoked_at !== null} onClick={() => void revokeDevice(device.id)}>{device.revoked_at ? "已撤销" : "撤销"}</button></li>)}</ul> : <ProductEmptyState icon="◇" title="暂无设备记录" description="成功登录的设备会出现在这里。" />}</section></WorkbenchTabPanel><WorkbenchTabPanel value="recovery"><section className={styles.dataSection} data-testid="security-recovery"><header className={styles.sectionHeader}><div><span className={styles.eyebrow}>AUTHENTICATOR & RECOVERY</span><h2>认证器与恢复</h2></div><ProductTag tone={totp?.enabled ? "good" : "warn"}>{totp?.enabled ? "TOTP 已启用" : "TOTP 未启用"}</ProductTag></header>{totp?.enabled ? <><p className={styles.muted}>剩余恢复码：{totp.recovery_codes_remaining}。高风险操作需要当前动态码。</p><button className={styles.secondaryButton} type="button" onClick={() => setTotpSheetOpen(true)}>管理 TOTP 与恢复码</button></> : <p className={styles.muted}>启用 TOTP 后可生成一次性恢复码，并在此管理。</p>}{recoveryCodes.length > 0 ? <div className={styles.recoveryPanel} role="status"><strong>立即保存恢复码</strong><span>离开后不再显示，每个恢复码只能使用一次。</span><ul>{recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ul></div> : null}</section></WorkbenchTabPanel></WorkbenchTabs></div>}
        inspectorLabel="安全检查器"
        inspector={<div className={styles.inspectorPane}><InspectorSection title="保护摘要"><dl className={styles.kvList}><div><dt>有效设备</dt><dd>{devices.filter((item) => item.revoked_at === null).length}</dd></div><div><dt>有效 Passkey</dt><dd>{passkeys.filter((item) => item.revoked_at === null).length}</dd></div><div><dt>TOTP</dt><dd>{totp?.enabled ? "已启用" : "未启用"}</dd></div><div><dt>恢复码</dt><dd>{totp?.recovery_codes_remaining ?? 0} 个</dd></div></dl></InspectorSection><InspectorSection title="风险与恢复"><p className={styles.muted}>撤销设备或 Passkey 会立即影响该凭据对应的会话；TOTP 关闭会同时废止剩余恢复码。</p>{recoveryCodes.length > 0 ? <p className={styles.stateGood}>恢复码已生成，请在离开前离线保存。</p> : null}</InspectorSection><InspectorSection title="当前状态"><p className={styles.muted} aria-live="polite">{status}</p></InspectorSection></div>}
      />
      <WorkbenchSheet description="名称只用于识别；随后会调用系统认证器完成 Passkey 注册。" onOpenChange={setPasskeySheetOpen} open={passkeySheetOpen} title="添加 Passkey"><form className={styles.sheetForm} onSubmit={(event) => { void registerPasskey(event).then(() => setPasskeySheetOpen(false)); }}><label htmlFor="passkey-name">名称</label><input id="passkey-name" name="name" maxLength={80} required /><footer className={styles.sheetActions}><button type="button" onClick={() => setPasskeySheetOpen(false)}>取消</button><button className={styles.primaryButton}>使用认证器注册</button></footer></form></WorkbenchSheet>
      <WorkbenchSheet description={totp?.enabled ? "需要当前动态码才能生成恢复码或关闭 TOTP。" : "仅在完成动态码验证后启用 TOTP。"} onOpenChange={setTotpSheetOpen} open={totpSheetOpen} title="认证器与恢复码">{enrollment ? <div className={styles.secretPanel}><p>在认证器中导入以下密钥（仅本次显示）：</p><code>{enrollment.secret}</code><form className={styles.sheetForm} onSubmit={verifyTotp}><label htmlFor="totp-code">6 位动态码</label><input id="totp-code" name="code" inputMode="numeric" minLength={6} maxLength={8} required /><footer className={styles.sheetActions}><button type="button" onClick={() => setTotpSheetOpen(false)}>取消</button><button className={styles.primaryButton}>验证并启用</button></footer></form></div> : totp?.enabled ? <div className={styles.sheetStack}><p>已启用，剩余恢复码：{totp.recovery_codes_remaining}。</p><form className={styles.sheetForm} onSubmit={regenerateCodes}><label htmlFor="regenerate-code">当前动态码</label><input id="regenerate-code" name="code" autoComplete="one-time-code" required /><button className={styles.secondaryButton}>重新生成恢复码</button></form><form className={styles.sheetForm} onSubmit={disableTotp}><label htmlFor="disable-code">当前动态码</label><input id="disable-code" name="code" autoComplete="one-time-code" required /><button className={styles.dangerButton}>关闭 TOTP</button></form></div> : <ProductEmptyState icon="＋" title="尚未开始 TOTP 设置" description="关闭此 Sheet 后可从唯一主操作重新开始。" />}</WorkbenchSheet>
    </main>
  );
}
