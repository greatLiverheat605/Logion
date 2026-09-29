"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@logion/contracts";
import { browserApiClient } from "@/lib/api/client";
import { clearWorkbenchContexts } from "@/lib/workbench-context";
import { createPublicAuthApi } from "@/features/auth/public-auth-api";
import {
  createAuthApi,
  createSessionCoordinator,
  createWebLockRefreshCoordinator,
} from "@/features/auth/session";
import { workbenchRequest, errorMessage } from "@/platform/workbench/api";
import { Button, Sheet } from "@/platform/workbench/components";
import "./settings.css";

type Device = components["schemas"]["DeviceResponse"];
type Confirmation = { kind: "others" } | { kind: "device"; device: Device };
const auth = createPublicAuthApi(browserApiClient);
const session = createSessionCoordinator(
  createAuthApi(browserApiClient),
  createWebLockRefreshCoordinator(),
);

export function SecuritySettings() {
  const queries = useQueryClient();
  const trigger = useRef<HTMLElement | null>(null);
  const cancel = useRef<HTMLButtonElement | null>(null);
  const refresh = useRef<HTMLButtonElement | null>(null);
  const devices = useQuery({
    queryKey: ["workbench", "devices"],
    queryFn: ({ signal }) =>
      workbenchRequest<components["schemas"]["DeviceListResponse"]>(
        "/api/v1/auth/devices",
        { signal },
      ),
  });
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const [status, setStatus] = useState("");

  async function leave() {
    await queries.cancelQueries();
    queries.clear();
    clearWorkbenchContexts();
    window.location.assign("/auth/login");
  }
  async function logout() {
    setPending(true);
    setFailure("");
    setStatus("");
    try {
      const verified = await session.refresh();
      if (
        verified.status !== "authenticated" &&
        verified.status !== "anonymous"
      )
        throw new Error("Session verification unavailable");
      if (verified.status === "authenticated") await auth.logout();
      await leave();
    } catch (error) {
      setFailure(`退出未完成。${errorMessage(error)}`);
      setPending(false);
    }
  }
  async function confirm() {
    if (!confirmation || pending) return;
    setPending(true);
    setFailure("");
    setStatus("");
    try {
      if (confirmation.kind === "others") {
        await workbenchRequest("/api/v1/auth/sessions/others", {
          method: "DELETE",
        });
        setStatus("其他会话已退出。当前会话继续保持登录。");
      } else {
        await workbenchRequest(
          `/api/v1/auth/devices/${confirmation.device.id}`,
          { method: "DELETE" },
        );
        if (confirmation.device.current) {
          await leave();
          return;
        }
        setStatus("设备已撤销，该设备的会话已失效。");
      }
      await devices.refetch();
      void queries.invalidateQueries({ queryKey: ["workbench", "audit"] });
      setConfirmation(null);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  function ask(value: Confirmation) {
    trigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setFailure("");
    setStatus("");
    setConfirmation(value);
  }
  return (
    <div className="wb-page wb-config-page">
      <Link href="/settings">返回设置</Link>
      <div className="wb-page-heading">
        <div>
          <h1>设备与会话</h1>
          <p>检查登录设备，及时退出不再使用的会话。</p>
        </div>
      </div>
      <section className="wb-config-section" aria-label="登录设备">
        <header>
          <h2>登录设备</h2>
          <Button
            ref={refresh}
            disabled={pending || devices.isFetching}
            onClick={() => void devices.refetch()}
          >
            刷新设备
          </Button>
        </header>
        <p>
          这里只显示仍有有效会话的设备。超过 30
          天没有有效会话的设备会自动撤销，历史记录仍保留。
        </p>
        {devices.isPending && <p role="status">正在读取设备…</p>}
        {devices.error && <p role="alert">{errorMessage(devices.error)}</p>}
        {devices.data?.devices.length === 0 && (
          <p>暂无有效会话，请刷新确认登录状态。</p>
        )}
        <ul className="wb-config-list">
          {devices.data?.devices.map((device) => (
            <li key={device.id}>
              <div className="wb-config-break">
                <h3>{device.name}</h3>
                <p>
                  {device.current ? "当前设备" : "其他设备"} ·{" "}
                  {device.platform === "web" ? "浏览器" : device.platform}
                </p>
                <p>
                  最近活动：
                  <time dateTime={device.last_seen_at}>
                    {new Date(device.last_seen_at).toLocaleString()}
                  </time>
                </p>
                <p>
                  首次登录：
                  <time dateTime={device.first_seen_at}>
                    {new Date(device.first_seen_at).toLocaleString()}
                  </time>
                </p>
              </div>
              <Button
                disabled={pending || devices.isFetching}
                onClick={() => ask({ kind: "device", device })}
              >
                撤销设备
              </Button>
            </li>
          ))}
        </ul>
      </section>
      <section className="wb-config-section" aria-label="会话操作">
        <h2>会话操作</h2>
        <p>退出其他所有会话需要最近登录验证，也会退出当前设备上的其他会话。</p>
        <div className="wb-config-actions">
          <Button disabled={pending} onClick={() => ask({ kind: "others" })}>
            退出其他所有会话
          </Button>
          <Button disabled={pending} onClick={() => void logout()}>
            退出登录
          </Button>
        </div>
        <p>正常退出保留设备识别，重新登录仍需验证身份。</p>
        {status && <p role="status">{status}</p>}
        {failure && !confirmation && <p role="alert">{failure}</p>}
      </section>
      <Sheet
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          (trigger.current?.isConnected
            ? trigger.current
            : refresh.current
          )?.focus();
        }}
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !pending) {
            setConfirmation(null);
            setFailure("");
          }
        }}
        title={
          confirmation?.kind === "device" ? "撤销这台设备" : "退出其他所有会话"
        }
        description={
          confirmation?.kind === "device"
            ? `撤销“${confirmation.device.name}”后，该设备的全部会话立即失效。${confirmation.device.current ? "你也会退出当前页面。" : "重新使用时需要登录。"}`
            : "其他已登录会话将立即失效；当前会话保留，新登录仍需验证身份。"
        }
      >
        <div className="wb-config-form">
          {failure && <p role="alert">{failure}</p>}
          <div className="wb-config-actions">
            <Button
              ref={cancel}
              disabled={pending}
              onClick={() => setConfirmation(null)}
            >
              取消
            </Button>
            <Button disabled={pending} onClick={() => void confirm()}>
              {pending ? "正在处理…" : "确认操作"}
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
