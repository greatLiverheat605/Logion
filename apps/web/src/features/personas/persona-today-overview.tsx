"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";

import { AppIcon, type AppIconName } from "@/components/app-shell/app-icon";
import { AppModal } from "@/components/app-shell/app-modal";
import { ProductEmptyState, ProductTag } from "@/components/product/product-ui";
import { useOptionalWorkbench } from "@/features/workbenches/workbench-context";

import {
  buildPersonaDashboard,
  type PersonaDashboardSource,
} from "./dashboard/persona-dashboard-model";
import { PersonaDashboardHeader } from "./dashboard/persona-dashboard-primitives";
import { type BuiltinPersonaId } from "./persona-definitions";
import { usePersona } from "./persona-context";

function DashboardChunkLoading() {
  return (
    <section className="persona-dashboard-state" aria-busy="true">
      <ProductEmptyState
        description="正在加载当前画像的首页布局。"
        icon="…"
        title="正在准备画像首页"
      />
    </section>
  );
}

const ExamDashboard = dynamic(
  () =>
    import("./dashboard/exam-dashboard").then((module) => module.ExamDashboard),
  { loading: DashboardChunkLoading },
);
const MentorDashboard = dynamic(
  () =>
    import("./dashboard/mentor-dashboard").then(
      (module) => module.MentorDashboard,
    ),
  { loading: DashboardChunkLoading },
);
const ResearchDashboard = dynamic(
  () =>
    import("./dashboard/research-dashboard").then(
      (module) => module.ResearchDashboard,
    ),
  { loading: DashboardChunkLoading },
);
const SelfDashboard = dynamic(
  () =>
    import("./dashboard/self-dashboard").then((module) => module.SelfDashboard),
  { loading: DashboardChunkLoading },
);

export type PersonaDashboardViewState =
  | "empty"
  | "error"
  | "loading"
  | "locked"
  | "needs-context"
  | "offline-stale"
  | "ready";

interface PersonaEntry {
  description: string;
  href: string;
  icon: AppIconName;
  label: string;
}

const ROUTE_ENTRIES: Readonly<Record<string, PersonaEntry>> = {
  "/app/audit": {
    href: "/app/audit",
    icon: "clipboard",
    label: "审计",
    description: "查看授权范围内的事件与协作记录。",
  },
  "/app/exam": {
    href: "/app/exam",
    icon: "target",
    label: "考试",
    description: "进入科目、大纲、模考和成绩闭环。",
  },
  "/app/planning": {
    href: "/app/planning",
    icon: "calendar",
    label: "规划",
    description: "把长期目标拆成下一步可执行计划。",
  },
  "/app/records": {
    href: "/app/records",
    icon: "files",
    label: "记录",
    description: "沉淀学习材料、结果和过程证据。",
  },
  "/app/review": {
    href: "/app/review",
    icon: "refresh",
    label: "复习",
    description: "处理到期内容并巩固薄弱知识。",
  },
  "/app/self-study": {
    href: "/app/self-study",
    icon: "book-open",
    label: "自学",
    description: "推进学习项目、资料和阶段成果。",
  },
  "/app/spaces": {
    href: "/app/spaces",
    icon: "folder",
    label: "空间",
    description: "管理个人与共享空间的清晰边界。",
  },
  "/app/templates": {
    href: "/app/templates",
    icon: "layout-template",
    label: "模板",
    description: "复用经过验证的计划与记录结构。",
  },
};

const SYSTEM_ROUTES = new Set([
  "/app/today",
  "/app/settings",
  "/app/profile",
  "/app/help",
]);

function DashboardState({
  onRetry,
  state,
}: {
  onRetry: () => void;
  state: Exclude<
    PersonaDashboardViewState,
    "empty" | "offline-stale" | "ready"
  >;
}) {
  const content = {
    error: {
      description: "工作区或本地资料读取失败；网络错误不会伪装成空数据。",
      icon: "!",
      title: "画像首页暂时无法读取",
    },
    loading: {
      description: "正在读取工作区、成员与本机加密数据。",
      icon: "…",
      title: "正在汇总真实首页数据",
    },
    locked: {
      description:
        "画像指标依赖端侧加密实体，解锁前不会显示猜测值或全零仪表盘。",
      icon: "◇",
      title: "先解锁本地资料",
    },
    "needs-context": {
      description: "请先选择工作区与 Space；导师聚合只会读取共享 Space。",
      icon: "+",
      title: "还缺少首页上下文",
    },
  }[state];
  const action =
    state === "error" ? (
      <button type="button" onClick={onRetry}>
        重新读取
      </button>
    ) : state === "loading" ? undefined : (
      <a className="product-action-link" href="#today-vault">
        {state === "locked" ? "解锁本地资料" : "选择工作区与 Space"}
      </a>
    );
  return (
    <section
      aria-busy={state === "loading"}
      className="persona-dashboard-state"
    >
      <ProductEmptyState
        action={action}
        description={content.description}
        icon={content.icon}
        title={content.title}
      />
    </section>
  );
}

export function PersonaTodayOverview({
  onRetry,
  source,
  state,
}: {
  onRetry: () => void;
  source: PersonaDashboardSource;
  state: PersonaDashboardViewState;
}) {
  const { activePersona, allPersonas, isLoading, setActivePersona } =
    usePersona();
  const workbench = useOptionalWorkbench();
  const workbenchReady = workbench?.phase === "ready";
  const switchOptions = workbenchReady
    ? workbench.options.map((option) => ({
        description: option.description,
        id: option.ref,
        isBuiltin: option.kind === "fixed",
        name: option.name,
      }))
    : allPersonas.map((persona) => ({
        description: persona.description,
        id: persona.id,
        isBuiltin: persona.isBuiltin,
        name: persona.name,
      }));
  const switchButtonRef = useRef<HTMLButtonElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const customEntries = useMemo(() => {
    if (!activePersona || activePersona.isBuiltin) return [];
    return activePersona.routes
      .filter((route) => !SYSTEM_ROUTES.has(route))
      .map((route) => ROUTE_ENTRIES[route])
      .filter((entry): entry is PersonaEntry => entry !== undefined)
      .slice(0, 3);
  }, [activePersona]);

  async function choose(personaId: string) {
    setPendingId(personaId);
    setError(false);
    try {
      if (workbenchReady) {
        await workbench.selectWorkbench(personaId);
      } else {
        await setActivePersona(personaId);
      }
      setDialogOpen(false);
    } catch {
      setError(true);
    } finally {
      setPendingId(null);
    }
  }

  const controls = (
    <button
      className="secondary-button"
      data-testid="persona-switcher-trigger"
      ref={switchButtonRef}
      type="button"
      onClick={() => setDialogOpen(true)}
    >
      切换画像
    </button>
  );

  let dashboard;
  if (isLoading || !activePersona) {
    dashboard = (
      <section className="persona-dashboard">
        <DashboardState onRetry={onRetry} state="loading" />
      </section>
    );
  } else if (!["empty", "offline-stale", "ready"].includes(state)) {
    const lockedModel = activePersona.isBuiltin
      ? buildPersonaDashboard(activePersona.id as BuiltinPersonaId, source)
      : null;
    dashboard = (
      <section className="persona-dashboard">
        {lockedModel ? (
          <PersonaDashboardHeader
            controls={controls}
            model={lockedModel}
            personaName={activePersona.name}
            stale={false}
          />
        ) : (
          <header className="persona-dashboard-header">
            <div>
              <p className="product-eyebrow">CUSTOM PERSONA</p>
              <h2>按“{activePersona.name}”组织今天</h2>
              <p>{activePersona.description}</p>
            </div>
            <div className="persona-dashboard-controls">
              <ProductTag tone="info">
                当前画像 · {activePersona.name}
              </ProductTag>
              {controls}
            </div>
          </header>
        )}
        <DashboardState
          onRetry={onRetry}
          state={
            state as Exclude<
              PersonaDashboardViewState,
              "empty" | "offline-stale" | "ready"
            >
          }
        />
      </section>
    );
  } else if (!activePersona.isBuiltin) {
    dashboard = (
      <section
        aria-label="自定义画像首页"
        className="persona-dashboard persona-dashboard-custom"
      >
        <header className="persona-dashboard-header">
          <div>
            <p className="product-eyebrow">CUSTOM PERSONA</p>
            <h2>按“{activePersona.name}”组织今天</h2>
            <p>
              {activePersona.description ||
                "使用你选择的真实功能入口组织今天的工作。"}
            </p>
          </div>
          <div className="persona-dashboard-controls">
            <ProductTag tone={state === "offline-stale" ? "warn" : "info"}>
              {state === "offline-stale"
                ? "本机数据待同步"
                : `当前画像 · ${activePersona.name}`}
            </ProductTag>
            {controls}
          </div>
        </header>
        <nav
          aria-label={`${activePersona.name}画像推荐入口`}
          className="persona-dashboard-navigation"
        >
          {customEntries.map((entry) => (
            <Link href={entry.href} key={entry.href}>
              <span aria-hidden="true">
                <AppIcon name={entry.icon} size={18} />
              </span>
              <span>
                <strong>{entry.label}</strong>
                <small>{entry.description}</small>
              </span>
            </Link>
          ))}
        </nav>
      </section>
    );
  } else {
    const personaId = activePersona.id as BuiltinPersonaId;
    const model = buildPersonaDashboard(personaId, source);
    const props = {
      controls,
      model,
      personaName: activePersona.name,
      stale: state === "offline-stale",
    };
    dashboard =
      personaId === "exam" ? (
        <ExamDashboard {...props} />
      ) : personaId === "research" ? (
        <ResearchDashboard {...props} />
      ) : personaId === "mentor" ? (
        <MentorDashboard {...props} />
      ) : (
        <SelfDashboard {...props} />
      );
  }

  return (
    <>
      {dashboard}
      {dialogOpen && activePersona ? (
        <AppModal
          eyebrow="PERSONA SWITCHER"
          returnFocusRef={switchButtonRef}
          title="切换今天的画像结构"
          onClose={() => setDialogOpen(false)}
        >
          <p className="persona-switcher-help">
            画像只调整导航与首页结构，不改变任何工作区权限。
          </p>
          <div className="persona-switcher-list">
            {switchOptions.map((persona) => {
              const selected =
                persona.id ===
                (workbenchReady
                  ? workbench.activeWorkbench?.ref
                  : activePersona.id);
              return (
                <button
                  aria-pressed={selected}
                  className="persona-switcher-choice"
                  disabled={pendingId !== null}
                  key={persona.id}
                  type="button"
                  onClick={() => void choose(persona.id)}
                >
                  <span
                    aria-hidden="true"
                    className="persona-switcher-monogram"
                  >
                    {persona.name.slice(0, 1)}
                  </span>
                  <span>
                    <strong>{persona.name}</strong>
                    <small>{persona.description}</small>
                  </span>
                  <span className="product-tag">
                    {selected ? "当前" : persona.isBuiltin ? "预设" : "自定义"}
                  </span>
                </button>
              );
            })}
          </div>
          {error ? (
            <p className="field-error" role="alert">
              画像未能保存，请关闭后刷新数据再重试。
            </p>
          ) : null}
        </AppModal>
      ) : null}
    </>
  );
}
