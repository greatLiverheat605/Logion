"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  onboardingSetupService,
  type OnboardingSpace,
} from "../onboarding-setup-service";

interface SpaceSetupStepProps {
  onNext: (spaceId: string) => void;
  workspaceId: string;
}

export function SpaceSetupStep({ onNext, workspaceId }: SpaceSetupStepProps) {
  const [spaces, setSpaces] = useState<OnboardingSpace[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSpaces(await onboardingSetupService.listSpaces(workspaceId));
      setError(null);
    } catch {
      setError("空间未能加载，请重试。");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function createSpace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    if (!name) return;
    setPending(true);
    setError(null);
    try {
      const space = await onboardingSetupService.createSpace(workspaceId, name);
      setSpaces((current) => [...current, space]);
      setSelected(space.id);
      form.reset();
    } catch {
      setError("空间未能创建，请重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="space-setup-title" className="onboarding-step">
      <header>
        <p className="eyebrow">STEP 3 · REQUIRED</p>
        <h1 id="space-setup-title">创建或选择空间</h1>
        <p>空间决定具体内容的可见范围。引导阶段创建的空间默认仅自己可见。</p>
      </header>
      <div className="onboarding-form">
        <label htmlFor="onboarding-space">
          已有空间
          <select
            disabled={loading || pending}
            id="onboarding-space"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">请选择空间</option>
            {spaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name} ·{" "}
                {space.visibility === "private" ? "私有" : "共享"}
              </option>
            ))}
          </select>
        </label>
        <p className="onboarding-divider">或创建新的私有空间</p>
        <form className="onboarding-inline-form" onSubmit={createSpace}>
          <label htmlFor="onboarding-space-name">
            空间名称
            <input
              disabled={pending}
              id="onboarding-space-name"
              maxLength={120}
              name="name"
              required
            />
          </label>
          <button className="secondary-button" disabled={pending} type="submit">
            {pending ? "正在创建…" : "创建并选择"}
          </button>
        </form>
      </div>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="onboarding-actions">
        {error && spaces.length === 0 ? (
          <button
            className="secondary-button"
            type="button"
            onClick={() => void load()}
          >
            重新加载
          </button>
        ) : null}
        <button
          className="primary-action"
          disabled={!selected || loading || pending}
          type="button"
          onClick={() => onNext(selected)}
        >
          继续
        </button>
      </div>
    </section>
  );
}
