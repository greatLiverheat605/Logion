"use client";

import { useState } from "react";

import { clearFormDraftsForUser } from "@/features/offline/form-draft-cleanup";
import { browserApiClient } from "@/lib/api/client";
import { clearWorkbenchContexts } from "@/lib/workbench-context";

import { createPublicAuthApi } from "./public-auth-api";
import {
  createAuthApi,
  createSessionCoordinator,
  createWebLockRefreshCoordinator,
} from "./session";

const authApi = createPublicAuthApi(browserApiClient);
const sessionCoordinator = createSessionCoordinator(
  createAuthApi(browserApiClient),
  createWebLockRefreshCoordinator(),
);

export function LogoutButton() {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function logout() {
    setPending(true);
    setFailed(false);
    try {
      const session = await sessionCoordinator.refresh();
      if (
        session.status !== "authenticated" &&
        session.status !== "anonymous"
      ) {
        throw new Error("Session verification unavailable");
      }
      if (session.status === "authenticated") {
        await clearFormDraftsForUser(session.user.id);
        await authApi.logout();
      }
      clearWorkbenchContexts();
      window.location.assign("/auth/login");
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <>
      <button
        className="logout-button"
        type="button"
        onClick={logout}
        disabled={pending}
      >
        {pending ? "正在退出…" : "退出登录"}
      </button>
      {failed ? <p role="alert">退出未完成，请检查网络后重试。</p> : null}
    </>
  );
}
