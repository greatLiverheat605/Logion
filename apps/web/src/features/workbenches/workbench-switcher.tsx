"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";

import { AppModal } from "@/components/app-shell/app-modal";
import { useInspector } from "@/features/desk/command-feedback-context";
import { createMediaQueryStore } from "@/features/desk/media-query-store";
import { usePersona } from "@/features/personas/persona-context";

import { projectPersonaToWorkbench } from "./workbench-model";

const TODAY_PATH = "/app/today";
const mobileSwitcherStore = createMediaQueryStore("(max-width: 45rem)");

export function WorkbenchSwitcher() {
  const router = useRouter();
  const { closeInspector } = useInspector();
  const { activePersona, allPersonas, isLoading, setActivePersona } =
    usePersona();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const isMobile = useSyncExternalStore(
    mobileSwitcherStore.subscribe,
    mobileSwitcherStore.getSnapshot,
    mobileSwitcherStore.getServerSnapshot,
  );
  const entries = useMemo(
    () =>
      allPersonas.map((persona) => ({
        persona,
        projection: projectPersonaToWorkbench(persona),
      })),
    [allPersonas],
  );

  async function switchWorkbench(personaId: string, entryPath: string) {
    setPendingId(personaId);
    setError(false);
    closeInspector();
    try {
      await setActivePersona(personaId);
      setMobileOpen(false);
      router.push(entryPath);
    } catch {
      setError(true);
      setMobileOpen(false);
      router.push(TODAY_PATH);
    } finally {
      setPendingId(null);
    }
  }

  if (isLoading || activePersona === null) {
    return (
      <section aria-label="工作台切换" className="workbench-switcher-shell">
        <div className="workbench-switcher-fallback">
          <span>{isLoading ? "工作台加载中" : "当前工作台不可用"}</span>
          <Link href={TODAY_PATH}>返回 Today</Link>
        </div>
      </section>
    );
  }

  const options = entries.map(({ persona, projection }) => {
    const selected = persona.id === activePersona.id;
    const entryPath = projection?.entryPath ?? null;
    return (
      <button
        aria-pressed={selected}
        className="workbench-switcher-option"
        disabled={pendingId !== null || entryPath === null}
        key={persona.id}
        type="button"
        onClick={() => {
          if (entryPath) void switchWorkbench(persona.id, entryPath);
        }}
      >
        <span aria-hidden="true" className="workbench-switcher-icon">
          {projection?.icon ?? persona.icon}
        </span>
        <span className="workbench-switcher-copy">
          <strong>{projection?.name ?? persona.name}</strong>
          <small>
            {entryPath === null
              ? "暂无入口"
              : pendingId === persona.id
                ? "正在切换"
                : selected
                  ? "当前"
                  : projection?.kind === "legacy-persona"
                    ? "兼容"
                    : "打开"}
          </small>
        </span>
      </button>
    );
  });

  return (
    <section aria-label="工作台切换" className="workbench-switcher-shell">
      <div className="workbench-switcher-heading">
        <span>当前工作台</span>
        <strong>
          {projectPersonaToWorkbench(activePersona)?.name ?? activePersona.name}
        </strong>
      </div>
      {isMobile ? (
        <button
          aria-expanded={mobileOpen}
          aria-haspopup="dialog"
          className="workbench-switcher-mobile-trigger"
          ref={mobileTriggerRef}
          type="button"
          onClick={() => setMobileOpen(true)}
        >
          切换工作台
        </button>
      ) : (
        <div
          aria-label="选择工作台"
          className="workbench-switcher-list"
          role="group"
        >
          {options}
        </div>
      )}
      {error ? (
        <p className="workbench-switcher-error" role="alert">
          工作台切换失败，已返回 Today。
        </p>
      ) : null}
      {mobileOpen ? (
        <AppModal
          eyebrow="WORKBENCH"
          returnFocusRef={mobileTriggerRef}
          title="选择工作台"
          onClose={() => setMobileOpen(false)}
        >
          <div className="workbench-switcher-mobile-list">{options}</div>
        </AppModal>
      ) : null}
    </section>
  );
}
