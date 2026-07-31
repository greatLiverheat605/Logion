"use client";

import { useState } from "react";

import { BUILTIN_PERSONAS } from "@/features/personas/persona-definitions";
import { usePersona } from "@/features/personas/persona-context";

interface PersonaSelectionStepProps {
  onNext: () => void;
}

export function PersonaSelectionStep({ onNext }: PersonaSelectionStepProps) {
  const { setActivePersona } = usePersona();
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function continueToNextStep() {
    if (!selected) return;
    setPending(true);
    setError(false);
    try {
      await setActivePersona(selected);
      onNext();
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
    >
      <header>
        <p className="eyebrow">STEP 1 · REQUIRED</p>
        <h1 id="persona-selection-title">选择你的学习场景</h1>
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
              {persona.icon}
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
      <div className="onboarding-actions">
        <button
          className="primary-action"
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
