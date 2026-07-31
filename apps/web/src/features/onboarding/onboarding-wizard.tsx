"use client";

import { useState } from "react";

import { userSettingService } from "@/features/settings/user-setting-service";

import { PersonaSelectionStep } from "./steps/persona-selection-step";

const STEPS = [
  { id: "persona", label: "画像", title: "选择你的学习场景", required: true },
  {
    id: "workspace",
    label: "工作区",
    title: "创建或选择工作区",
    required: true,
  },
  { id: "space", label: "空间", title: "创建或选择空间", required: true },
  {
    id: "passphrase",
    label: "口令",
    title: "设置本机数据口令",
    required: true,
  },
  {
    id: "template",
    label: "模板",
    title: "从模板库挑一个起点",
    required: false,
  },
  { id: "goal", label: "目标", title: "设定今日目标", required: true },
  { id: "complete", label: "开始", title: "开始使用 Logion", required: true },
] as const;

const STEP_DESCRIPTIONS: Readonly<
  Record<(typeof STEPS)[number]["id"], string>
> = {
  persona: "选择与你当前目标最接近的导航方案。",
  workspace: "选择已有工作区，或创建一个新的学习工作区。",
  space: "在当前工作区中选择或创建承载学习内容的空间。",
  passphrase: "设置仅用于本机数据解锁的口令。",
  template: "可以选择一个模板作为起点，也可以暂时跳过。",
  goal: "为今天创建一条明确、可执行的学习目标。",
  complete: "你的基础偏好已经保存，可以进入每日工作台。",
};

export function OnboardingWizard() {
  const [currentStep, setCurrentStep] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const step = STEPS[currentStep] ?? STEPS[0];

  function next() {
    setCurrentStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  async function complete() {
    setPending(true);
    setError(false);
    try {
      await userSettingService.set("onboarding_completed", "true");
      window.location.assign("/app/today");
    } catch {
      setError(true);
      setPending(false);
    }
  }

  return (
    <main className="onboarding-page" id="main-content">
      <section aria-label="入门进度" className="onboarding-progress">
        <p>
          第 {currentStep + 1} 步，共 {STEPS.length} 步
        </p>
        <ol>
          {STEPS.map((item, index) => (
            <li
              aria-current={index === currentStep ? "step" : undefined}
              className={index <= currentStep ? "active" : ""}
              key={item.id}
            >
              <span>{index + 1}</span>
              {item.label}
            </li>
          ))}
        </ol>
      </section>

      {step.id === "persona" ? (
        <PersonaSelectionStep onNext={next} />
      ) : (
        <section
          aria-labelledby={`onboarding-${step.id}`}
          className="onboarding-step"
        >
          <header>
            <p className="eyebrow">
              STEP {currentStep + 1} · {step.required ? "REQUIRED" : "OPTIONAL"}
            </p>
            <h1 id={`onboarding-${step.id}`}>{step.title}</h1>
            <p>{STEP_DESCRIPTIONS[step.id]}</p>
          </header>
          <div className="onboarding-preview" aria-hidden="true">
            <span>{currentStep + 1}</span>
            <p>{step.label}</p>
          </div>
          {error ? (
            <p className="field-error" role="alert">
              入门状态未能保存，请重试。
            </p>
          ) : null}
          <div className="onboarding-actions">
            {!step.required ? (
              <button className="secondary-button" type="button" onClick={next}>
                跳过
              </button>
            ) : null}
            <button
              className="primary-action"
              disabled={pending}
              type="button"
              onClick={() =>
                step.id === "complete" ? void complete() : next()
              }
            >
              {pending
                ? "正在完成…"
                : step.id === "complete"
                  ? "进入 Logion"
                  : "继续"}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
