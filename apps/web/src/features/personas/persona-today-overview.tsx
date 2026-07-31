"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { AppIcon, type AppIconName } from "@/components/app-shell/app-icon";
import { AppModal } from "@/components/app-shell/app-modal";

import { type BuiltinPersonaId } from "./persona-definitions";
import { usePersona } from "./persona-context";

interface PersonaEntry {
  description: string;
  href: string;
  icon: AppIconName;
  label: string;
}

interface PersonaHomeCopy {
  description: string;
  eyebrow: string;
  title: string;
}

const HOME_COPY: Readonly<Record<BuiltinPersonaId, PersonaHomeCopy>> = {
  exam: {
    eyebrow: "EXAM COMMAND",
    title: "围绕考试、复习和学习记录安排今天",
    description: "优先呈现应试闭环；画像只调整入口，不改变数据和工作区权限。",
  },
  self: {
    eyebrow: "LEARNING PROJECTS",
    title: "围绕目标、项目和长期积累推进今天",
    description: "把自主学习、规划和模板放在手边，保持可执行的个人节奏。",
  },
  research: {
    eyebrow: "RESEARCH MISSION CONTROL",
    title: "围绕材料、证据和研究计划组织今天",
    description: "集中知识管理与复习入口，不把画像误用为团队权限。",
  },
  mentor: {
    eyebrow: "MENTOR & GROUP COMMAND",
    title: "围绕空间、审计和协作治理安排今天",
    description: "突出共享工作入口；实际可执行操作仍由工作区角色授权。",
  },
};

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

const BUILTIN_ENTRY_ORDER: Readonly<
  Record<BuiltinPersonaId, readonly string[]>
> = {
  exam: ["/app/exam", "/app/review", "/app/records"],
  self: ["/app/self-study", "/app/planning", "/app/templates"],
  research: ["/app/self-study", "/app/records", "/app/review"],
  mentor: ["/app/spaces", "/app/audit", "/app/planning"],
};

const SYSTEM_ROUTES = new Set([
  "/app/today",
  "/app/settings",
  "/app/profile",
  "/app/help",
]);

export function PersonaTodayOverview() {
  const { activePersona, allPersonas, isLoading, setActivePersona } =
    usePersona();
  const switchButtonRef = useRef<HTMLButtonElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const entries = useMemo(() => {
    if (!activePersona) return [];
    const preferred = activePersona.isBuiltin
      ? BUILTIN_ENTRY_ORDER[activePersona.id as BuiltinPersonaId]
      : activePersona.routes.filter((route) => !SYSTEM_ROUTES.has(route));
    return preferred
      .map((route) => ROUTE_ENTRIES[route])
      .filter((entry): entry is PersonaEntry => entry !== undefined)
      .slice(0, 3);
  }, [activePersona]);

  if (isLoading || !activePersona) {
    return (
      <section aria-busy="true" className="persona-today-overview">
        <p className="product-muted-note" role="status">
          正在同步你的画像入口……
        </p>
      </section>
    );
  }

  const copy = activePersona.isBuiltin
    ? HOME_COPY[activePersona.id as BuiltinPersonaId]
    : {
        eyebrow: "CUSTOM PERSONA",
        title: `按“${activePersona.name}”画像组织今天`,
        description:
          activePersona.description || "使用你选择的功能入口组织今天的工作。",
      };

  async function choose(personaId: string) {
    setPendingId(personaId);
    setError(false);
    try {
      await setActivePersona(personaId);
      setDialogOpen(false);
    } catch {
      setError(true);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      <section
        aria-labelledby="persona-today-title"
        className="persona-today-overview"
      >
        <header className="persona-today-head">
          <span aria-hidden="true" className="persona-today-mark">
            {activePersona.icon}
          </span>
          <div className="persona-today-copy">
            <p className="product-eyebrow">{copy.eyebrow}</p>
            <h2 id="persona-today-title">{copy.title}</h2>
            <p>{copy.description}</p>
          </div>
          <div className="persona-today-actions">
            <span className="product-tag tone-info">
              当前画像 · {activePersona.name}
            </span>
            <button
              className="secondary-button"
              ref={switchButtonRef}
              type="button"
              onClick={() => setDialogOpen(true)}
            >
              切换画像
            </button>
          </div>
        </header>

        {entries.length ? (
          <nav
            aria-label={`${activePersona.name}画像推荐入口`}
            className="persona-today-entry-grid"
          >
            {entries.map((entry) => (
              <Link
                className="persona-today-entry"
                href={entry.href}
                key={entry.href}
              >
                <span aria-hidden="true" className="persona-today-entry-icon">
                  <AppIcon name={entry.icon} size={18} />
                </span>
                <span>
                  <strong>{entry.label}</strong>
                  <small>{entry.description}</small>
                </span>
              </Link>
            ))}
          </nav>
        ) : (
          <p className="product-muted-note">
            此画像仅保留基础入口；可前往设置添加更多功能。
          </p>
        )}
      </section>

      {dialogOpen ? (
        <AppModal
          eyebrow="PERSONA SWITCHER"
          returnFocusRef={switchButtonRef}
          title="切换今天的画像结构"
          onClose={() => setDialogOpen(false)}
        >
          <p className="persona-switcher-help">
            画像只调整导航与首页入口，不改变任何工作区权限。
          </p>
          <div className="persona-switcher-list">
            {allPersonas.map((persona) => {
              const selected = persona.id === activePersona.id;
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
