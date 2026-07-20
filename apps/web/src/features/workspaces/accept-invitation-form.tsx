"use client";

import Link from "next/link";
import { useState } from "react";

import { browserApiClient, LogionApiError } from "@/lib/api/client";
import {
  AuthFormShell,
  FormError,
  FormSuccess,
} from "@/features/auth/auth-form-shell";
import { useFragmentToken } from "@/features/auth/use-fragment-token";

export function AcceptInvitationForm() {
  const token = useFragmentToken();
  const [state, setState] = useState<"idle" | "pending" | "success" | "error">(
    "idle",
  );
  const [requestId, setRequestId] = useState("unavailable");

  async function accept() {
    if (!token) return;
    setState("pending");
    try {
      await browserApiClient.request("/api/v1/invitations/accept", {
        method: "POST",
        csrf: true,
        body: JSON.stringify({ token }),
      });
      setState("success");
    } catch (error) {
      setRequestId(
        error instanceof LogionApiError ? error.requestId : "unavailable",
      );
      setState("error");
    }
  }

  return (
    <AuthFormShell
      title="接受工作区邀请"
      description="邀请令牌仅从地址片段读取，并会立即从地址栏移除。"
    >
      {token === null ? (
        <FormError requestId="missing-or-invalid-link" />
      ) : state === "success" ? (
        <FormSuccess>
          <p>已加入工作区。</p>
          <Link href="/app/workspaces">打开工作区</Link>
        </FormSuccess>
      ) : (
        <>
          <button
            className="primary-action"
            onClick={() => void accept()}
            disabled={state === "pending"}
          >
            {state === "pending" ? "正在加入…" : "接受邀请"}
          </button>
          {state === "error" ? <FormError requestId={requestId} /> : null}
        </>
      )}
    </AuthFormShell>
  );
}
