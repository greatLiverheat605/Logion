"use client";

import { useState } from "react";

import { userSettingService } from "@/features/settings/user-setting-service";

import { PersonaSelectionStep } from "./steps/persona-selection-step";

const STEPS = [
  { id: "persona", label: "画像", title: "选择你的学习场景", required: true },
  { id: "goal", label: "目标", title: "设置首个学习目标", required: true },
  { id: "record", label: "记录", title: "添加第一条学习记录", required: true },
  { id: "review", label: "复习", title: "体验复习功能", required: true },
  { id: "templates", label: "模板", title: "探索模板库", required: true },
  { id: "invite", label: "协作", title: "邀请协作者", required: false },
  { id: "profile", label: "个人", title: "完成个人设置", required: true },
  { id: "complete", label: "开始", title: "开始使用 Logion", required: true },
] as const;

const STEP_DESCRIPTIONS: Readonly<
  Record<(typeof STEPS)[number]["id"], string>
> = {
  persona: "选择与你当前目标最接近的导航方案。",
  goal: "进入每日工作台后，可创建第一个可衡量的学习目标。",
  record: "把资料、笔记或练习结果沉淀为第一条记录。",
  review: "复习中心会根据已有材料组织后续巩固任务。",
  templates: "模板可帮助你快速建立计划、记录和复习结构。",
  invite: "需要团队协作时，可在空间页邀请导师或同伴。",
  profile: "个人页用于补充资料；画像仍可随时在设置中调整。",
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
