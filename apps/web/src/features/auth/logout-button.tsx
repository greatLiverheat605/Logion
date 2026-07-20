"use client";

import { useState } from "react";

import { browserApiClient } from "@/lib/api/client";

import { createPublicAuthApi } from "./public-auth-api";

const authApi = createPublicAuthApi(browserApiClient);

export function LogoutButton() {
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    try {
      await authApi.logout();
    } finally {
      window.location.assign("/auth/login");
    }
  }

  return (
    <button type="button" onClick={logout} disabled={pending}>
      {pending ? "正在退出…" : "退出登录"}
    </button>
  );
}
