"use client";

import { useEffect, useState } from "react";

import { AccessShellHeader } from "@/components/app-shell/access-shell-header";
import { BUILTIN_PERSONAS } from "@/features/personas/persona-definitions";
import { userSettingService } from "@/features/settings/user-setting-service";

import type {
  OnboardingSpace,
  OnboardingWorkspace,
} from "./onboarding-setup-service";
import { PassphraseStep } from "./steps/passphrase-step";
import { PersonaSelectionStep } from "./steps/persona-selection-step";
import { SpaceSetupStep } from "./steps/space-setup-step";
import { TodayGoalStep } from "./steps/today-goal-step";
import { WorkspaceSetupStep } from "./steps/workspace-setup-step";

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
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<OnboardingWorkspace | null>(null);
  const [space, setSpace] = useState<OnboardingSpace | null>(null);
  const [vaultReady, setVaultReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const step = STEPS[currentStep] ?? STEPS[0];
  const persona = BUILTIN_PERSONAS.find((item) => item.id === personaId);

  useEffect(() => {
    document
      .querySelector<HTMLElement>('[data-testid="onboarding-step"] h1')
      ?.focus();
  }, [currentStep]);

  function next() {
    setCurrentStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  function previous() {
    setError(false);
    setCurrentStep((current) => Math.max(0, current - 1));
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
    <main className="onboarding-page public-flow-page" id="main-content">
      <div className="access-shell onboarding-shell">
        <AccessShellHeader minimal />
        <div className="public-flow-stage onboarding-stage">
          <div className="onboarding-panel public-flow-panel">
            <section
              aria-label="入门进度"
              className="onboarding-progress"
              data-testid="onboarding-progress"
            >
              <ol>
                {STEPS.map((item, index) => (
                  <li
                    aria-current={index === currentStep ? "step" : undefined}
                    className={index <= currentStep ? "active" : ""}
                    key={item.id}
                  >
                    <span className="sr-only">
                      第 {index + 1} 步：{item.label}
                    </span>
                  </li>
                ))}
              </ol>
              <p>
                ONBOARDING · 第 {currentStep + 1} / {STEPS.length} 步 ·{" "}
                {step.label}
              </p>
            </section>

            <section
              aria-label="当前入门上下文"
              className="onboarding-context"
              data-testid="onboarding-context"
            >
              <span>
                画像 <strong>{persona?.name ?? "待选择"}</strong>
              </span>
              <span>
                工作区 <strong>{workspace?.name ?? "待选择"}</strong>
              </span>
              <span>
                空间 <strong>{space?.name ?? "待选择"}</strong>
              </span>
              <span>
                Vault <strong>{vaultReady ? "已解锁" : "待设置"}</strong>
              </span>
            </section>

            {step.id === "persona" ? (
              <PersonaSelectionStep
                initialSelected={personaId}
                onNext={(selectedPersonaId) => {
                  setPersonaId(selectedPersonaId);
                  next();
                }}
              />
            ) : step.id === "workspace" ? (
              <WorkspaceSetupStep
                initialSelected={workspace?.id ?? null}
                onBack={previous}
                onSelectionChange={(selectedWorkspace) => {
                  setWorkspace(selectedWorkspace);
                  setSpace((currentSpace) =>
                    selectedWorkspace?.id === workspace?.id
                      ? currentSpace
                      : null,
                  );
                }}
                onNext={(selectedWorkspace) => {
                  if (selectedWorkspace.id !== workspace?.id) {
                    setSpace(null);
                  }
                  setWorkspace(selectedWorkspace);
                  next();
                }}
              />
            ) : step.id === "space" && workspace !== null ? (
              <SpaceSetupStep
                initialSelected={space?.id ?? null}
                onBack={previous}
                onSelectionChange={setSpace}
                workspaceId={workspace.id}
                onNext={(selectedSpace) => {
                  setSpace(selectedSpace);
                  next();
                }}
              />
            ) : step.id === "passphrase" ? (
              <PassphraseStep
                onBack={previous}
                onNext={() => {
                  setVaultReady(true);
                  next();
                }}
              />
            ) : step.id === "goal" && workspace !== null && space !== null ? (
              <TodayGoalStep
                onBack={previous}
                onNext={next}
                spaceId={space.id}
                workspaceId={workspace.id}
              />
            ) : step.id === "space" || step.id === "goal" ? (
              <section
                className="onboarding-step"
                aria-labelledby="onboarding-context-error"
                data-testid="onboarding-step"
              >
                <header>
                  <p className="eyebrow">REQUIRED CONTEXT</p>
                  <h1 id="onboarding-context-error" tabIndex={-1}>
                    需要重新选择工作区
                  </h1>
                  <p>
                    当前引导上下文不完整。请返回工作区步骤重新选择，必选步骤不会被跳过。
                  </p>
                </header>
                <div
                  className="onboarding-actions"
                  data-testid="onboarding-recovery"
                >
                  <button
                    className="primary-action"
                    data-workbench-primary="true"
                    type="button"
                    onClick={() => {
                      setWorkspace(null);
                      setSpace(null);
                      setCurrentStep(1);
                    }}
                  >
                    返回工作区步骤
                  </button>
                </div>
              </section>
            ) : (
              <section
                aria-labelledby={`onboarding-${step.id}`}
                className="onboarding-step"
                data-testid="onboarding-step"
              >
                <header>
                  <p className="eyebrow">
                    STEP {currentStep + 1} ·{" "}
                    {step.required ? "REQUIRED" : "OPTIONAL"}
                  </p>
                  <h1 id={`onboarding-${step.id}`} tabIndex={-1}>
                    {step.title}
                  </h1>
                  <p>{STEP_DESCRIPTIONS[step.id]}</p>
                </header>
                {step.id === "template" ? (
                  <div className="onboarding-preview">
                    <strong>模板保持可发现</strong>
                    <p>模板安装会在模板库中完成，本步骤不会创建占位数据。</p>
                  </div>
                ) : null}
                {error ? (
                  <p className="field-error" role="alert">
                    入门状态未能保存，请重试。
                  </p>
                ) : null}
                <div
                  className="onboarding-actions"
                  data-testid="onboarding-recovery"
                >
                  <button
                    className="secondary-button"
                    disabled={pending || step.id === "complete"}
                    title={
                      step.id === "complete"
                        ? "今日目标已经创建，避免返回后重复提交"
                        : undefined
                    }
                    type="button"
                    onClick={previous}
                  >
                    上一步
                  </button>
                  <span>
                    {step.id === "template" ? "可稍后选择" : "设置已保存"}
                  </span>
                  {step.id === "template" ? (
                    <button
                      className="primary-action"
                      data-workbench-primary="true"
                      type="button"
                      onClick={next}
                    >
                      跳过并继续
                    </button>
                  ) : (
                    <button
                      className="primary-action"
                      data-workbench-primary="true"
                      disabled={pending}
                      type="button"
                      onClick={() => void complete()}
                    >
                      {pending ? "正在完成…" : "进入 Logion"}
                    </button>
                  )}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
