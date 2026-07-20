"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { SessionProvider, useSession } from "./session-provider";

function SessionStateBoundary({ children }: Readonly<{ children: ReactNode }>) {
  const { refresh, state } = useSession();

  if (state.status === "loading") {
    return (
      <main id="main-content" className="session-state" aria-busy="true">
        <p role="status" aria-live="polite">
          正在安全地验证会话…
        </p>
      </main>
    );
  }
  if (state.status === "anonymous") {
    return (
      <main id="main-content" className="session-state">
        <h1>需要登录</h1>
        <p>当前浏览器没有有效的 Logion 会话。</p>
        <Link className="text-link" href="/">
          返回首页
        </Link>
      </main>
    );
  }
  if (state.status === "error") {
    return (
      <main id="main-content" className="session-state">
        <h1>暂时无法验证会话</h1>
        <p>
          请检查网络后重试。请求编号：<code>{state.error.requestId}</code>
        </p>
        <button type="button" onClick={refresh}>
          重新验证
        </button>
      </main>
    );
  }
  return children;
}

export function SessionBoundary({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <SessionProvider>
      <SessionStateBoundary>{children}</SessionStateBoundary>
    </SessionProvider>
  );
}
