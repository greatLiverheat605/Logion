"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { resolveOnboardingAccess } from "@/features/onboarding/onboarding-access";

import { SessionProvider, useSession } from "./session-provider";

type OnboardingGateState = "checking" | "error" | "ready" | "required";

function SessionStateBoundary({
  children,
  requireOnboarding,
}: Readonly<{ children: ReactNode; requireOnboarding: boolean }>) {
  const { refresh, state } = useSession();
  const router = useRouter();
  const [gateState, setGateState] = useState<OnboardingGateState>("checking");
  const [gateAttempt, setGateAttempt] = useState(0);

  useEffect(() => {
    if (!requireOnboarding || state.status !== "authenticated") return;
    let active = true;
    void resolveOnboardingAccess()
      .then((access) => {
        if (!active) return;
        if (access === "required") {
          setGateState("required");
          router.replace("/onboarding");
        } else {
          setGateState("ready");
        }
      })
      .catch(() => {
        if (active) setGateState("error");
      });
    return () => {
      active = false;
    };
  }, [gateAttempt, requireOnboarding, router, state.status]);

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
  if (requireOnboarding && gateState === "error") {
    return (
      <main id="main-content" className="session-state">
        <h1>无法加载账号设置</h1>
        <p role="alert">无法确认入门状态，当前不会进入应用。</p>
        <button
          type="button"
          onClick={() => {
            setGateState("checking");
            setGateAttempt((value) => value + 1);
          }}
        >
          重试
        </button>
      </main>
    );
  }
  if (requireOnboarding && gateState !== "ready") {
    return (
      <main id="main-content" className="session-state" aria-busy="true">
        <p role="status" aria-live="polite">
          {gateState === "required" ? "正在进入入门引导…" : "正在加载账号设置…"}
        </p>
      </main>
    );
  }
  return children;
}

export function SessionBoundary({
  children,
  requireOnboarding = false,
}: Readonly<{ children: ReactNode; requireOnboarding?: boolean }>) {
  return (
    <SessionProvider>
      <SessionStateBoundary requireOnboarding={requireOnboarding}>
        {children}
      </SessionStateBoundary>
    </SessionProvider>
  );
}
