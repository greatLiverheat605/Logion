import { type ReactNode } from "react";

import { AppIcon, type AppIconName } from "@/components/app-shell/app-icon";

import { ProductEmptyState, ProductTag } from "./product-ui";

export const PRODUCT_OPERATIONAL_STATE_KINDS = [
  "loading",
  "empty",
  "pending",
  "success",
  "offline",
  "locked",
  "permission",
  "conflict",
  "error",
  "capability-disabled",
  "stale",
] as const;

export type ProductOperationalStateKind =
  (typeof PRODUCT_OPERATIONAL_STATE_KINDS)[number];

export type ProductOperationalRecovery =
  | Readonly<{
      disabled?: boolean;
      kind: "button";
      label: string;
      onInvoke: () => void;
    }>
  | Readonly<{
      href: string;
      kind: "link";
      label: string;
    }>;

type ProductOperationalStateFields = Readonly<{
  description?: ReactNode;
  impact?: ReactNode;
  recovery: ProductOperationalRecovery;
  requestId?: string;
  title?: ReactNode;
}>;

export type ProductOperationalState = {
  [Kind in ProductOperationalStateKind]: ProductOperationalStateFields &
    Readonly<{ kind: Kind }>;
}[ProductOperationalStateKind];

type StateTone = "bad" | "good" | "info" | "neutral" | "warn";

const OPERATIONAL_STATE_COPY: Readonly<
  Record<
    ProductOperationalStateKind,
    Readonly<{
      busy?: boolean;
      description: string;
      icon: AppIconName;
      impact: string;
      live: "assertive" | "polite";
      title: string;
      tone: StateTone;
    }>
  >
> = {
  "capability-disabled": {
    description: "当前运行环境没有启用完成此操作所需的系统能力。",
    icon: "shield",
    impact: "依赖该能力的操作暂停，其他本地功能仍可继续使用。",
    live: "polite",
    title: "当前能力不可用",
    tone: "neutral",
  },
  conflict: {
    description: "本地版本与远端 revision 已分叉，系统不会静默覆盖任一版本。",
    icon: "refresh",
    impact: "保存与同步暂停，选择保留版本或编辑合并后才能继续。",
    live: "assertive",
    title: "存在 409 版本冲突",
    tone: "bad",
  },
  empty: {
    description: "当前真实范围内还没有可显示的对象。",
    icon: "archive",
    impact: "列表为空，但工作区、权限和筛选上下文仍然有效。",
    live: "polite",
    title: "当前范围暂无内容",
    tone: "neutral",
  },
  error: {
    description: "请求失败不会被降级显示成空数据。",
    icon: "shield",
    impact: "当前读取或写入未完成；已经确认的数据保持不变。",
    live: "assertive",
    title: "操作未能完成",
    tone: "bad",
  },
  loading: {
    busy: true,
    description: "正在读取真实上下文和对象状态。",
    icon: "refresh",
    impact: "结果返回前不会展示猜测值或过期统计。",
    live: "polite",
    title: "正在准备工作台",
    tone: "info",
  },
  locked: {
    description: "本地加密资料仍处于锁定状态。",
    icon: "lock",
    impact: "受保护对象不会显示或同步，云端权限没有发生变化。",
    live: "polite",
    title: "需要解锁本地资料",
    tone: "warn",
  },
  offline: {
    description: "网络连接不可用，工作台正在使用本机可验证的数据。",
    icon: "archive",
    impact: "远端读取、共享写入与同步暂停；本地变更进入待同步队列。",
    live: "assertive",
    title: "当前处于离线模式",
    tone: "warn",
  },
  pending: {
    busy: true,
    description: "操作已经进入队列，但尚未得到服务端或同步层确认。",
    icon: "timer",
    impact: "对象保持可见，最终状态以确认结果为准。",
    live: "polite",
    title: "操作正在等待确认",
    tone: "info",
  },
  permission: {
    description: "当前成员角色不允许执行这项操作。",
    icon: "shield",
    impact: "对象保持只读；不会尝试绕过 Workspace 或 Space 权限。",
    live: "assertive",
    title: "权限不足",
    tone: "warn",
  },
  stale: {
    description: "本机数据可用，但它可能落后于其他设备的最新 revision。",
    icon: "refresh",
    impact: "继续编辑可能产生冲突，建议先刷新或完成同步。",
    live: "polite",
    title: "当前数据不是最新版本",
    tone: "warn",
  },
  success: {
    description: "操作已获得系统确认。",
    icon: "shield",
    impact: "最新对象状态已经写入当前工作区。",
    live: "polite",
    title: "操作已完成",
    tone: "good",
  },
};

const STATE_TONE_LABEL: Readonly<Record<StateTone, string>> = {
  bad: "需处理",
  good: "已完成",
  info: "进行中",
  neutral: "当前状态",
  warn: "受限",
};

const STATE_TAG_TONE = {
  bad: "bad",
  good: "good",
  info: "info",
  neutral: "default",
  warn: "warn",
} as const;

function OperationalRecovery({
  recovery,
}: Readonly<{ recovery: ProductOperationalRecovery }>) {
  if (recovery.kind === "link") {
    return (
      <a className="product-operational-recovery" href={recovery.href}>
        {recovery.label}
      </a>
    );
  }

  return (
    <button
      className="product-operational-recovery"
      disabled={recovery.disabled}
      type="button"
      onClick={recovery.onInvoke}
    >
      {recovery.label}
    </button>
  );
}

export function ProductOperationalStateNotice({
  state,
}: Readonly<{ state: ProductOperationalState }>) {
  const copy = OPERATIONAL_STATE_COPY[state.kind];

  return (
    <section
      aria-busy={copy.busy}
      aria-label="工作台操作状态"
      aria-live={copy.live}
      className={`product-operational-state tone-${copy.tone}`}
      data-operational-state={state.kind}
    >
      <span aria-hidden="true" className="product-operational-state-icon">
        <AppIcon name={copy.icon} size={18} />
      </span>
      <div className="product-operational-state-copy">
        <header>
          <h3>{state.title ?? copy.title}</h3>
          <ProductTag tone={STATE_TAG_TONE[copy.tone]}>
            {STATE_TONE_LABEL[copy.tone]}
          </ProductTag>
        </header>
        <div className="product-operational-description">
          {state.description ?? copy.description}
        </div>
        <p className="product-operational-impact">
          <strong>影响</strong>
          <span>{state.impact ?? copy.impact}</span>
        </p>
        {state.requestId ? (
          <small className="product-operational-request">
            Request ID: {state.requestId}
          </small>
        ) : null}
      </div>
      <div className="product-operational-state-action">
        <OperationalRecovery recovery={state.recovery} />
      </div>
    </section>
  );
}

export type ProductWorkbenchState =
  | "empty"
  | "error"
  | "loading"
  | "locked"
  | "needs-context"
  | "offline-stale"
  | "ready";

export function deriveProductWorkbenchState({
  contextPhase,
  dataPhase,
  hasContext,
  hasData,
  stale,
  unlocked,
}: {
  contextPhase: "error" | "loading" | "ready";
  dataPhase: "error" | "idle" | "loading" | "ready";
  hasContext: boolean;
  hasData: boolean;
  stale: boolean;
  unlocked: boolean;
}): ProductWorkbenchState {
  if (contextPhase === "error") return "error";
  if (contextPhase === "loading") return "loading";
  if (!hasContext) return "needs-context";
  if (!unlocked) return "locked";
  if (dataPhase === "error") return "error";
  if (dataPhase !== "ready") return "loading";
  if (stale) return "offline-stale";
  return hasData ? "ready" : "empty";
}

const STATE_COPY = {
  empty: {
    description: "上下文已经就绪，但当前范围内还没有记录。",
    icon: "+",
    title: "当前范围暂无数据",
  },
  error: {
    description: "读取失败不会被显示成空数据；请重试或检查当前服务。",
    icon: "!",
    title: "工作台暂时无法读取",
  },
  loading: {
    description: "正在读取工作区上下文与本机加密记录。",
    icon: "…",
    title: "正在准备真实数据",
  },
  locked: {
    description: "解锁前不会展示猜测值或全零统计。",
    icon: "◇",
    title: "先解锁本地资料",
  },
  "needs-context": {
    description: "请选择可访问的工作区与 Space 后继续。",
    icon: "+",
    title: "还缺少工作台上下文",
  },
} as const;

export function ProductWorkbenchStateNotice({
  action,
  emptyDescription,
  emptyTitle,
  onRetry,
  state,
}: {
  action?: ReactNode;
  emptyDescription?: string;
  emptyTitle?: string;
  onRetry?: () => void;
  state: ProductWorkbenchState;
}) {
  if (state === "ready") return null;
  if (state === "offline-stale") {
    return (
      <div className="product-workbench-stale" role="status">
        <div>
          <strong>正在使用本机数据</strong>
          <small>存在尚未同步或待解决的记录，指标可能落后于其他设备。</small>
        </div>
        <ProductTag tone="warn">待同步</ProductTag>
      </div>
    );
  }

  const content =
    state === "empty"
      ? {
          description: emptyDescription ?? STATE_COPY.empty.description,
          icon: STATE_COPY.empty.icon,
          title: emptyTitle ?? STATE_COPY.empty.title,
        }
      : STATE_COPY[state];
  const resolvedAction =
    state === "error" && onRetry ? (
      <button type="button" onClick={onRetry}>
        重新读取
      </button>
    ) : (
      action
    );

  return (
    <section
      aria-busy={state === "loading"}
      aria-label="工作台数据状态"
      className="product-workbench-state"
    >
      <ProductEmptyState
        action={resolvedAction}
        description={content.description}
        icon={content.icon}
        title={content.title}
      />
    </section>
  );
}
