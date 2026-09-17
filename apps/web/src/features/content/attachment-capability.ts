"use client";
import { useEffect, useState } from "react";
import type { components } from "@logion/contracts";
import { browserApiClient } from "@/lib/api/client";

export class AttachmentCapabilityError extends Error {}

export async function readAttachmentCapability(
  workspaceId: string,
  spaceId: string,
): Promise<boolean> {
  const result = await browserApiClient.request<
    components["schemas"]["AttachmentCapability"]
  >(
    `/api/v1/workspaces/${workspaceId}/spaces/${spaceId}/attachments/capability`,
  );
  if (!result || typeof result.ingest_enabled !== "boolean")
    throw new AttachmentCapabilityError("无法确认附件上传能力，请稍后重试。");
  return result.ingest_enabled;
}
export async function checkAttachmentQueuePermission(
  workspaceId: string,
  spaceId: string,
  online: boolean,
  allowOffline = false,
): Promise<void> {
  if (!online) {
    if (!allowOffline)
      throw new AttachmentCapabilityError(
        "离线时无法确认服务端能力，请确认仅在本地暂存附件。",
      );
    return;
  }
  if (!(await readAttachmentCapability(workspaceId, spaceId)))
    throw new AttachmentCapabilityError(
      "服务端未启用附件上传，本次未加入队列。请联系管理员。",
    );
}
export function useAttachmentCapability(
  workspaceId: string,
  spaceId: string,
  online: boolean,
  open: boolean,
) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    state: "enabled" | "disabled" | "error";
  } | null>(null);
  const key = `${workspaceId}:${spaceId}:${online}:${open}:${revision}`;
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setResult(null);
    });
    if (open && online && workspaceId && spaceId) {
      void readAttachmentCapability(workspaceId, spaceId).then(
        (enabled) => {
          if (!cancelled)
            setResult({ key, state: enabled ? "enabled" : "disabled" });
        },
        () => {
          if (!cancelled) setResult({ key, state: "error" });
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [key, workspaceId, spaceId, online, open]);
  const state = !online
    ? "offline"
    : result?.key === key
      ? result.state
      : "loading";
  return { state, retry: () => setRevision((value) => value + 1) };
}
