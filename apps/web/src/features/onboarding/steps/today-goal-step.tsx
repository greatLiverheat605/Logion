"use client";

import { type FormEvent, useState } from "react";

import {
  localDateValue,
  onboardingSetupService,
} from "../onboarding-setup-service";

interface TodayGoalStepProps {
  onBack: () => void;
  onNext: () => void;
  spaceId: string;
  workspaceId: string;
}

export function TodayGoalStep({
  onBack,
  onNext,
  spaceId,
  workspaceId,
}: TodayGoalStepProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function createGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setError(false);
    try {
      await onboardingSetupService.createTodayGoal(workspaceId, spaceId, {
        desiredOutcome: String(data.get("desired_outcome") ?? "").trim(),
        targetDate: localDateValue(),
        title: String(data.get("title") ?? "").trim(),
        weeklyMinutes: Number(data.get("weekly_minutes") ?? 60),
      });
      form.reset();
      onNext();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="today-goal-title"
      className="onboarding-step"
      data-testid="onboarding-step"
    >
      <header>
        <p className="eyebrow">STEP 6 · REQUIRED</p>
        <h1 id="today-goal-title" tabIndex={-1}>
          设定今日目标
        </h1>
        <p>创建一条今天就能开始、结果可验收的学习目标。</p>
      </header>
      <form className="onboarding-form" onSubmit={createGoal}>
        <label htmlFor="onboarding-goal-name">
          目标名称
          <input
            disabled={pending}
            id="onboarding-goal-name"
            maxLength={160}
            name="title"
            placeholder="例如：完成第一章知识框架"
            required
          />
        </label>
        <label htmlFor="onboarding-goal-outcome">
          今天如何判断已完成？
          <textarea
            disabled={pending}
            id="onboarding-goal-outcome"
            maxLength={500}
            name="desired_outcome"
            placeholder="例如：输出一页结构化笔记并完成 10 道练习"
            required
            rows={3}
          />
        </label>
        <label htmlFor="onboarding-goal-minutes">
          每周计划投入（分钟）
          <input
            defaultValue={60}
            disabled={pending}
            id="onboarding-goal-minutes"
            max={10080}
            min={1}
            name="weekly_minutes"
            required
            type="number"
          />
        </label>
        {error ? (
          <p className="field-error" role="alert">
            今日目标未能创建，请重试。
          </p>
        ) : null}
        <div className="onboarding-actions" data-testid="onboarding-recovery">
          <button
            className="secondary-button"
            disabled={pending}
            type="button"
            onClick={onBack}
          >
            上一步
          </button>
          <span>写入当前空间</span>
          <button
            className="primary-action"
            data-workbench-primary="true"
            disabled={pending}
            type="submit"
          >
            {pending ? "正在创建目标…" : "创建目标并继续"}
          </button>
        </div>
      </form>
    </section>
  );
}
