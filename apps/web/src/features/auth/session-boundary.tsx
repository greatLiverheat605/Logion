"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { resolveOnboardingAccess } from "@/features/onboarding/onboarding-access";

import { AuthFormShell } from "./auth-form-shell";
import { SessionProvider, useSession } from "./session-provider";

type OnboardingGateState = "checking" | "error" | "ready" | "required";

function PublicSessionState({
  busy = false,
  children,
  description,
  recovery,
  title,
}: Readonly<{
  busy?: boolean;
  children: ReactNode;
  description: string;
  recovery?: ReactNode;
  title: string;
}>) {
  return (
    <AuthFormShell
      description={description}
      eyebrow="SECURE SESSION"
      title={title}
    >
      <p className="auth-policy" data-testid="onboarding-progress">
        正在保护首次使用流程
      </p>
      <div
        aria-busy={busy || undefined}
        className="auth-form"
        data-testid="onboarding-step"
      >
        {children}
      </div>
      <p className="auth-note auth-policy" data-testid="onboarding-context">
        Workspace、Space 与 Vault 上下文只会在有效会话中加载。
      </p>
      <div className="auth-links" data-testid="onboarding-recovery">
        {recovery}
      </div>
    </AuthFormShell>
  );
}

function SessionStateBoundary({
  children,
  publicFlow,
  requireOnboarding,
}: Readonly<{
  children: ReactNode;
  publicFlow: boolean;
  requireOnboarding: boolean;
}>) {
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
    if (publicFlow) {
      return (
        <PublicSessionState
          busy
          description="正在安全验证当前浏览器会话，完成后继续入门设置。"
          title="正在验证会话"
        >
          <p className="auth-note" role="status" aria-live="polite">
            正在安全地验证会话…
          </p>
        </PublicSessionState>
      );
    }
    return (
      <main id="main-content" className="session-state" aria-busy="true">
        <p role="status" aria-live="polite">
          正在安全地验证会话…
        </p>
      </main>
    );
  }
  if (state.status === "anonymous") {
    if (publicFlow) {
      return (
        <PublicSessionState
          description="当前浏览器没有有效的 Logion 会话，登录后才能继续首次使用设置。"
          recovery={
            <Link
              className="primary-action"
              data-workbench-primary="true"
              href="/auth/login"
            >
              前往登录
            </Link>
          }
          title="需要登录"
        >
          <p className="auth-note" role="alert">
            会话可能已过期，尚未保存的本地输入不会发送到服务器。
          </p>
        </PublicSessionState>
      );
    }
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
    if (publicFlow) {
      return (
        <PublicSessionState
          description="暂时无法确认当前会话，入门流程不会绕过身份验证继续。"
          recovery={
            <button
              data-workbench-primary="true"
              type="button"
              onClick={refresh}
            >
              重新验证
            </button>
          }
          title="暂时无法验证会话"
        >
          <p className="form-message form-error" role="alert">
            请检查网络后重试。请求编号：
            <code>{state.error.requestId}</code>
          </p>
        </PublicSessionState>
      );
    }
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
    if (publicFlow) {
      return (
        <PublicSessionState
          description="无法确认入门状态，当前不会进入应用。"
          recovery={
            <button
              data-workbench-primary="true"
              type="button"
              onClick={() => {
                setGateState("checking");
                setGateAttempt((value) => value + 1);
              }}
            >
              重试
            </button>
          }
          title="无法加载账号设置"
        >
          <p className="form-message form-error" role="alert">
            入门状态读取失败，系统不会静默跳过必选步骤。
          </p>
        </PublicSessionState>
      );
    }
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
    if (publicFlow) {
      return (
        <PublicSessionState
          busy
          description="正在读取入门完成状态并选择安全的下一站。"
          title="正在加载账号设置"
        >
          <p className="auth-note" role="status" aria-live="polite">
            {gateState === "required"
              ? "正在进入入门引导…"
              : "正在加载账号设置…"}
          </p>
        </PublicSessionState>
      );
    }
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
  publicFlow = false,
  requireOnboarding = false,
}: Readonly<{
  children: ReactNode;
  publicFlow?: boolean;
  requireOnboarding?: boolean;
}>) {
  return (
    <SessionProvider>
      <SessionStateBoundary
        publicFlow={publicFlow}
        requireOnboarding={requireOnboarding}
      >
        {children}
      </SessionStateBoundary>
    </SessionProvider>
  );
}
