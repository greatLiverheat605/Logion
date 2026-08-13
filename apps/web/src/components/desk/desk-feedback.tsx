"use client";

import { type ReactNode } from "react";

import { DeskButton } from "@/components/desk/desk-primitives";
import { type DeskTone, toneClass } from "@/components/desk/desk-tone";
import { type LogionApiError } from "@/lib/api/client";

/* ---- Inline Error -------------------------------------------------------- */

interface DeskInlineErrorProps {
  message: ReactNode;
  code?: string;
  requestId?: string;
  retryLabel?: string;
  onRetry?: () => void;
  helpHref?: string;
}

/**
 * In-place error surface for a failed command. Surfaces a stable code and
 * request id so the user (and support) can trace the failure. Never leaks the
 * raw server message — the caller decides the human-readable `message`.
 *
 * The help entry is a real link (not a button wrapping an anchor) to avoid
 * invalid nested interactive elements and to keep keyboard/AT semantics clean.
 */
export function DeskInlineError({
  code,
  helpHref,
  message,
  onRetry,
  requestId,
  retryLabel = "重试",
}: Readonly<DeskInlineErrorProps>) {
  return (
    <div aria-live="assertive" className="desk-inline-error" role="alert">
      <span className="desk-inline-error-message">{message}</span>
      {code || requestId ? (
        <span className="desk-inline-error-meta">
          {code ? <span>错误码：{code}</span> : null}
          {code && requestId ? " · " : null}
          {requestId ? <span>请求编号：{requestId}</span> : null}
        </span>
      ) : null}
      {(onRetry || helpHref) && (
        <div className="desk-inline-error-actions">
          {onRetry ? (
            <DeskButton onClick={onRetry} size="sm" tone="secondary">
              {retryLabel}
            </DeskButton>
          ) : null}
          {helpHref ? (
            <a
              className="desk-inline-error-help"
              href={helpHref}
              rel="noreferrer"
              target="_blank"
            >
              查看帮助
            </a>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ---- Skeleton ------------------------------------------------------------ */

interface DeskSkeletonProps {
  width?: string;
  height?: string;
  label: string;
}

export function DeskSkeleton({
  height = "1rem",
  label,
  width = "100%",
}: Readonly<DeskSkeletonProps>) {
  return (
    <span
      aria-hidden="true"
      className="desk-skeleton"
      style={{ display: "block", height, width }}
      data-label={label}
    />
  );
}

/* ---- Progress ------------------------------------------------------------ */

interface DeskProgressProps {
  value: number;
  label: string;
  tone?: DeskTone;
}

export function DeskProgress({
  label,
  tone,
  value,
}: Readonly<DeskProgressProps>) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="desk-progress">
      <div
        aria-label={`${label}：${clamped}%`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(clamped)}
        className="desk-progress-track"
        role="progressbar"
      >
        <span
          className={`desk-progress-fill ${tone ? toneClass(tone) : ""}`.trim()}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

/* ---- Request ID pill ----------------------------------------------------- */

interface DeskRequestIdProps {
  requestId: string;
}

export function DeskRequestId({ requestId }: Readonly<DeskRequestIdProps>) {
  return <code className="desk-request-id">REQ {requestId}</code>;
}

/* ---- Toast --------------------------------------------------------------- */

export type DeskToastTone = "good" | "info" | "warn" | "bad";

interface DeskToastAction {
  label: string;
  onClick: () => void;
}

interface DeskToastProps {
  title: ReactNode;
  tone: DeskToastTone;
  detail?: ReactNode;
  action?: DeskToastAction;
  onClose?: () => void;
}

/**
 * Single toast card. Auto-dismissal and reduced-motion behaviour is owned by
 * the host ({@link CommandFeedbackProvider}); this component is purely
 * presentational so it can be tested in isolation.
 */
export function DeskToast({
  action,
  detail,
  onClose,
  title,
  tone,
}: Readonly<DeskToastProps>) {
  return (
    <div
      className={`desk-toast ${toneClass(tone as DeskTone)}`.trim()}
      role={tone === "bad" ? "alert" : "status"}
    >
      <span className="desk-toast-title">{title}</span>
      {detail ? <span className="desk-toast-detail">{detail}</span> : null}
      {(action || onClose) && (
        <div className="desk-toast-actions">
          {action ? (
            <DeskButton onClick={action.onClick} size="sm" tone="secondary">
              {action.label}
            </DeskButton>
          ) : null}
          {onClose ? (
            <DeskButton
              aria-label="关闭通知"
              className="desk-toast-close"
              onClick={onClose}
              size="sm"
              tone="ghost"
            >
              关闭
            </DeskButton>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ---- Conflict Resolver --------------------------------------------------- */

export interface DeskConflictAction {
  kind: "reload" | "merge" | "keep_copy" | "cancel";
  label: string;
  onClick: () => void;
}

interface DeskConflictResolverProps {
  title?: string;
  detail: ReactNode;
  actions: readonly DeskConflictAction[];
  requestId?: string;
  error?: LogionApiError;
}

/**
 * Surfaces a 409-style conflict without silently overwriting remote state.
 * Shows what diverged (local vs remote), the request id, and the available
 * resolution actions. The caller owns the merge/reload strategy; this
 * component never auto-resolves.
 */
export function DeskConflictResolver({
  actions,
  detail,
  error,
  requestId,
  title = "检测到冲突，未自动覆盖",
}: Readonly<DeskConflictResolverProps>) {
  const id = requestId ?? error?.requestId;
  const code = error?.code;
  return (
    <div aria-live="polite" className="desk-conflict" role="alert">
      <span className="desk-conflict-title">{title}</span>
      <span className="desk-conflict-detail">{detail}</span>
      {code || id ? (
        <span className="desk-inline-error-meta">
          {code ? <span>错误码：{code}</span> : null}
          {code && id ? " · " : null}
          {id ? <span>请求编号：{id}</span> : null}
        </span>
      ) : null}
      <div className="desk-conflict-actions">
        {actions.map((action) => (
          <DeskButton
            key={action.kind}
            onClick={action.onClick}
            size="sm"
            tone={action.kind === "cancel" ? "ghost" : "secondary"}
          >
            {action.label}
          </DeskButton>
        ))}
      </div>
    </div>
  );
}
