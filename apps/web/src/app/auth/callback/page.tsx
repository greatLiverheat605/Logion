"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AuthFormShell, FormError } from "@/features/auth/auth-form-shell";
import { resolveOnboardingAccess } from "@/features/onboarding/onboarding-access";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void resolveOnboardingAccess()
      .then((access) => {
        if (active) {
          router.replace(access === "complete" ? "/app/today" : "/onboarding");
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [attempt, router]);

  if (failed) {
    return (
      <AuthFormShell
        description="会话已经返回，但暂时无法确认入门状态。为避免绕过必选引导，Logion 不会直接进入应用。"
        eyebrow="AUTH CALLBACK"
        title="无法完成登录"
      >
        <div className="auth-form" data-testid="callback-status">
          <FormError
            message="无法加载账号设置，请检查网络后重试。"
            requestId="settings-unavailable"
          />
        </div>
        <div className="auth-links" data-testid="callback-recovery">
          <button
            data-workbench-primary="true"
            type="button"
            onClick={() => {
              setFailed(false);
              setAttempt((value) => value + 1);
            }}
          >
            重试
          </button>
          <Link href="/auth/login">返回登录</Link>
        </div>
      </AuthFormShell>
    );
  }

  return (
    <AuthFormShell
      description="正在确认入门状态并选择安全的下一站，请勿关闭当前页面。"
      eyebrow="AUTH CALLBACK"
      title="正在准备工作台"
    >
      <div aria-busy="true" className="auth-form" data-testid="callback-status">
        <p className="auth-note" role="status" aria-live="polite">
          正在验证会话与账号设置…
        </p>
      </div>
      <p className="auth-switch" data-testid="callback-recovery">
        长时间没有响应？ <Link href="/auth/login">返回登录</Link>
      </p>
    </AuthFormShell>
  );
}
