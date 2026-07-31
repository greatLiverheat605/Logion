"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { userSettingService } from "@/features/settings/user-setting-service";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    void userSettingService
      .get("onboarding_completed")
      .then((setting) => {
        if (active) {
          router.replace(
            setting?.value === "true" ? "/app/today" : "/onboarding",
          );
        }
      })
      .catch(() => {
        if (active) router.replace("/app/today");
      });
    return () => {
      active = false;
    };
  }, [router]);

  return (
    <main className="session-state" id="main-content" aria-busy="true">
      <p role="status">正在准备你的 Logion 工作台…</p>
    </main>
  );
}
