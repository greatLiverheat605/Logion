"use client";

import type { components } from "@logion/contracts";
import { ProtectedOfflineRepository, SyncClient } from "@logion/offline";
import { useEffect, useRef, useState } from "react";

import { AppModal } from "@/components/app-shell/app-modal";
import { useSession } from "@/features/auth/session-provider";
import { useVaultSession } from "@/features/offline/vault-session-provider";
import { browserApiClient, LogionApiError } from "@/lib/api/client";
import { feedback, feedbackErrorText } from "@/lib/feedback";

import styles from "./entity-delete-action.module.css";

type EntityType = "learning_goal" | "note" | "task";
type Preview = components["schemas"]["DeletionPreview"];
const names = { learning_goal: "学习目标", note: "笔记", task: "任务" };
const impactNames: Record<string, string> = {
  deleted_learning_goal: "学习目标",
  deleted_task: "任务",
  deleted_note: "笔记",
  deleted_resource: "资料",
  deleted_study_session: "学习会话",
  detached_note: "解除任务关联的笔记",
  detached_resource: "解除任务关联的资料",
};

interface Props {
  entityType: EntityType;
  entityId: string;
  workspaceId: string;
  disabled?: boolean;
  onDeleted: () => void;
  onStatus: (message: string) => void;
}

export function EntityDeleteAction(props: Props) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        className={`${styles.danger} ${styles.trigger}`}
        disabled={props.disabled}
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
      >
        删除{names[props.entityType]}
      </button>
      {open ? (
        <DeleteDialog
          {...props}
          onClose={() => setOpen(false)}
          returnFocusRef={trigger}
        />
      ) : null}
    </>
  );
}

function DeleteDialog({
  onClose,
  returnFocusRef,
  ...props
}: Props & {
  onClose: () => void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const { state: session } = useSession();
  const vaultSession = useVaultSession();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const path = `/api/v1/workspaces/${props.workspaceId}/sync`;
  useEffect(() => {
    const abort = new AbortController();
    browserApiClient
      .request<Preview>(
        `${path}/deletion-preview/${props.entityType}/${props.entityId}`,
        { signal: abort.signal },
      )
      .then(setPreview)
      .catch((failure: unknown) => {
        if (!abort.signal.aborted)
          setError(
            failure instanceof LogionApiError
              ? `无法核对删除范围，请联网后重试。${failure.code}`
              : "无法核对删除范围，请重试。",
          );
      });
    return () => abort.abort();
  }, [path, props.entityId, props.entityType]);

  async function confirm() {
    const db = vaultSession.database.current;
    const vault = vaultSession.vault.current;
    if (busy || !preview?.can_delete) return;
    if (!db || !vault || session.status !== "authenticated") {
      setError("请先登录并解锁本地资料，再重试删除。");
      feedback.error("请先登录并解锁本地资料，再重试删除。");
      return;
    }
    setBusy(true);
    setError("");
    let queued = false;
    let failureText = "删除未完成，请在同步中心检查。";
    try {
      const entity = await db.entities.get([
        props.workspaceId,
        props.entityType,
        props.entityId,
      ]);
      const state = await db.syncState.get(props.workspaceId);
      if (
        !entity ||
        !state ||
        entity.server_version !== preview.server_version
      ) {
        failureText = "本地版本与预检不一致，请先同步后重新确认。";
        throw new Error("stale deletion preview");
      }
      const now = new Date().toISOString();
      const operationId = crypto.randomUUID();
      await new ProtectedOfflineRepository(db, vault).commitMutation({
        ...entity,
        entity_type: props.entityType,
        protocol_version: "sync-v1",
        operation_type: "delete",
        operation_id: operationId,
        device_id: state.device_id,
        base_version: entity.server_version,
        local_revision: entity.local_revision + 1,
        client_occurred_at: now,
        updated_at: now,
        updated_by: session.user.id,
        deleted_at: now,
        payload: {},
      });
      queued = true;
      feedback.success("删除已在本地排队，等待服务器确认。");
      props.onStatus("删除已在本地排队，等待服务器确认。");
      onClose();
      props.onDeleted();
      vaultSession.markChanged();
      const client = new SyncClient(
        db,
        {
          push: (payload) =>
            browserApiClient.request(`${path}/push`, {
              method: "POST",
              csrf: true,
              body: JSON.stringify(payload),
            }),
          pull: (payload) =>
            browserApiClient.request(`${path}/pull`, {
              method: "POST",
              body: JSON.stringify(payload),
            }),
        },
        vault,
      );
      const cycle = await client.synchronize(
        props.workspaceId,
        state.device_id,
      );
      const remaining = await db.outbox.get(operationId);
      if (remaining || cycle.control || cycle.has_more) {
        failureText =
          remaining?.outbox_state === "conflict"
            ? "删除冲突，请在同步中心处理。"
            : `删除尚未完成，请在同步中心处理。${remaining?.last_error_code ?? "等待同步"}`;
        throw new Error("deletion not acknowledged");
      }
      feedback.success("删除已同步。");
      props.onStatus("删除已同步。");
    } catch (failure) {
      const message = feedbackErrorText(failure, failureText);
      if (!queued) setError(message);
      feedback.error(
        queued ? `${message} 本地操作与加密内容已保留。` : message,
      );
      props.onStatus(
        queued ? `${message} 本地操作与加密内容已保留。` : message,
      );
    } finally {
      setBusy(false);
      if (queued) vaultSession.markChanged();
    }
  }

  const evidence = preview?.blockers.evidence_count ?? 0;
  const citations = preview?.blockers.citation_count ?? 0;
  return (
    <AppModal
      eyebrow={`删除${names[props.entityType]}`}
      title="确认删除"
      onClose={() => {
        if (!busy) onClose();
      }}
      returnFocusRef={returnFocusRef}
    >
      <div className={styles.body}>
        <p>
          {props.entityType === "learning_goal"
            ? "将软删除目标及其任务、笔记、资料和学习会话。历史证据与计划版本保留。"
            : props.entityType === "task"
              ? "将软删除任务和学习会话；笔记与资料保留，并解除任务关联。"
              : "将软删除笔记。附件文件不在本次清除范围内。"}
        </p>
        {preview ? (
          <ul>
            {Object.entries(preview.impact)
              .filter(([, count]) => count > 0)
              .map(([kind, count]) => (
                <li key={kind}>
                  {count} 个{impactNames[kind] ?? kind}
                </li>
              ))}
          </ul>
        ) : !error ? (
          <p role="status">正在核对删除范围…</p>
        ) : null}
        {evidence > 0 ? (
          <p role="alert">
            {evidence} 条证据引用此笔记，请先解除引用后再删除。
          </p>
        ) : null}
        {citations > 0 ? (
          <p role="alert">
            {citations} 条知识引用关联此笔记，请先解除引用后再删除。
          </p>
        ) : null}
        {preview && !preview.can_delete && evidence + citations === 0 ? (
          <p role="alert">此对象当前不可删除，请刷新后重试。</p>
        ) : null}
        {error ? (
          <p role="alert">
            {error} <a href="/app/sync">打开同步中心</a>
          </p>
        ) : null}
        <div className={styles.actions}>
          <button
            data-modal-autofocus
            disabled={busy}
            type="button"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className={styles.danger}
            disabled={busy || !preview?.can_delete || Boolean(error)}
            type="button"
            onClick={() => void confirm()}
          >
            {busy ? "正在提交…" : "确认删除"}
          </button>
        </div>
      </div>
    </AppModal>
  );
}
