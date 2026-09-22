"use client";

import Link from "next/link";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { DataExport } from "@/features/integrations/integration-capability-model";
import {
  browserApiClient,
  LogionApiError,
  type ApiZipResponse,
} from "@/lib/api/client";

export function ExportDownload({
  item,
  className,
  children = "下载 ZIP",
}: Readonly<{
  item: DataExport;
  className?: string;
  children?: ReactNode;
}>) {
  // A new artifact or workspace gets fresh local state and cancels the old request.
  return (
    <ExportDownloadContent
      key={`${item.workspace_id}:${item.id}`}
      item={item}
      className={className}
    >
      {children}
    </ExportDownloadContent>
  );
}

function ExportDownloadContent({
  item,
  className,
  children,
}: Readonly<{
  item: DataExport;
  className?: string;
  children: ReactNode;
}>) {
  const [now, setNow] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [recentAuth, setRecentAuth] = useState(false);
  const request = useRef<AbortController | null>(null);
  const expiresAt = Date.parse(item.expires_at ?? "");
  const available =
    item.status === "succeeded" &&
    now !== null &&
    Number.isFinite(expiresAt) &&
    now < expiresAt &&
    !unavailable;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      const current = Date.now();
      setNow(current);
      if (Number.isFinite(expiresAt) && expiresAt > current)
        timer = setTimeout(
          update,
          Math.min(expiresAt - current, 2_147_483_647),
        );
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") update();
    };
    update();
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [expiresAt]);
  useLayoutEffect(
    () => () => {
      request.current?.abort();
    },
    [],
  );

  async function download() {
    if (request.current || !available) return;
    if (Date.now() >= expiresAt) {
      setNow(Date.now());
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setMessage(null);
    setRecentAuth(false);
    try {
      const result = await browserApiClient.request<ApiZipResponse>(
        `/api/v1/workspaces/${item.workspace_id}/data-exports/${item.id}/download`,
        { responseType: "zip", signal: controller.signal, timeoutMs: 60_000 },
      );
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename ?? `logion-export-${item.id}.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      // Let the browser consume the Blob URL before releasing it.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("ZIP 下载已开始；请妥善保管并核对 SHA-256。");
    } catch (error) {
      if (controller.signal.aborted) return;
      if (
        error instanceof LogionApiError &&
        error.code === "EXPORT_NOT_FOUND"
      ) {
        setUnavailable(true);
        setMessage("导出已不可用，可能已过期；请重新读取或创建导出。");
      } else if (
        error instanceof LogionApiError &&
        error.code === "AUTH_RECENT_LOGIN_REQUIRED"
      ) {
        setRecentAuth(true);
        setMessage("下载需要近期认证，请重新登录后重试。");
      } else {
        setMessage(
          error instanceof LogionApiError && error.status === 401
            ? "会话需要恢复，请完成登录恢复后重试下载。"
            : "下载未完成，请稍后重试。",
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setPending(false);
      }
    }
  }

  return (
    <div>
      <button
        className={className}
        type="button"
        disabled={!available || pending}
        onClick={() => void download()}
      >
        {pending ? "正在下载…" : children}
      </button>
      {item.status === "succeeded" &&
      now !== null &&
      !available &&
      !unavailable ? (
        <p role="status">
          {Number.isFinite(expiresAt)
            ? "已过期，请重新创建导出。"
            : "无法确认有效期，请重新读取导出。"}
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {recentAuth ? (
        <Link
          href={`/auth/login?next=${encodeURIComponent(typeof window === "undefined" ? "/app/data" : window.location.pathname)}`}
        >
          重新登录
        </Link>
      ) : null}
    </div>
  );
}
