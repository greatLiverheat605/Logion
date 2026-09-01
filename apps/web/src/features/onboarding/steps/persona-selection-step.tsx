"use client";

import { useState } from "react";

import { AppIcon, type AppIconName } from "@/components/app-shell/app-icon";
import { BUILTIN_PERSONAS } from "@/features/personas/persona-definitions";
import { usePersona } from "@/features/personas/persona-context";

const PERSONA_ICONS = {
  exam: "target",
  mentor: "users",
  research: "flask",
  self: "book-open",
} as const satisfies Record<string, AppIconName>;

interface PersonaSelectionStepProps {
  initialSelected?: string | null;
  onNext: (personaId: string) => void;
}

export function PersonaSelectionStep({
  initialSelected = null,
  onNext,
}: PersonaSelectionStepProps) {
  const { setActivePersona } = usePersona();
  const [selected, setSelected] = useState<string | null>(initialSelected);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function continueToNextStep() {
    if (!selected) return;
    setPending(true);
    setError(false);
    try {
      await setActivePersona(selected);
      onNext(selected);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="persona-selection-title"
      className="onboarding-step"
      data-testid="onboarding-step"
    >
      <header>
        <p className="eyebrow">STEP 1 · REQUIRED</p>
        <h1 id="persona-selection-title" tabIndex={-1}>
          选择你的学习场景
        </h1>
        <p>
          Logion 将根据你的选择优先显示相关功能。稍后可在设置中修改，
          工作区权限不会受到影响。
        </p>
      </header>
      <div
        aria-label="用户画像"
        className="onboarding-persona-grid"
        role="group"
      >
        {BUILTIN_PERSONAS.map((persona) => (
          <button
            aria-label={`${persona.name}：${persona.description}`}
            aria-pressed={selected === persona.id}
            className={`persona-card${selected === persona.id ? " active" : ""}`}
            disabled={pending}
            key={persona.id}
            type="button"
            onClick={() => setSelected(persona.id)}
          >
            <span aria-hidden="true" className="persona-card-icon">
              <AppIcon
                name={PERSONA_ICONS[persona.id as keyof typeof PERSONA_ICONS]}
                size={18}
              />
            </span>
            <strong>{persona.name}</strong>
            <span>{persona.description}</span>
          </button>
        ))}
      </div>
      {error ? (
        <p className="field-error" role="alert">
          画像未能保存，请重试。
        </p>
      ) : null}
      <div className="onboarding-actions" data-testid="onboarding-recovery">
        <button
          className="secondary-button"
          disabled
          title="当前已是第一步"
          type="button"
        >
          上一步
        </button>
        <span>{selected ? "画像已选择" : "请选择画像"}</span>
        <button
          className="primary-action"
          data-workbench-primary="true"
          disabled={!selected || pending}
          type="button"
          onClick={() => void continueToNextStep()}
        >
          {pending ? "正在保存…" : "继续"}
        </button>
      </div>
    </section>
  );
}
