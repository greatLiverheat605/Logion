import { type ReactNode } from "react";

import { ProductEmptyState, ProductTag } from "./product-ui";

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
