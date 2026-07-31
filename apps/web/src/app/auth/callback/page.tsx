"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
      <main className="session-state" id="main-content">
        <h1>无法加载账号设置</h1>
        <p role="alert">无法确认入门状态，当前不会进入应用。</p>
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            setAttempt((value) => value + 1);
          }}
        >
          重试
        </button>
      </main>
    );
  }

  return (
    <main className="session-state" id="main-content" aria-busy="true">
      <p role="status">正在准备你的 Logion 工作台…</p>
    </main>
  );
}
