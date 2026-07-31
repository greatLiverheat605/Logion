"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  onboardingSetupService,
  type OnboardingWorkspace,
} from "../onboarding-setup-service";

interface WorkspaceSetupStepProps {
  onNext: (workspaceId: string) => void;
}

export function WorkspaceSetupStep({ onNext }: WorkspaceSetupStepProps) {
  const [workspaces, setWorkspaces] = useState<OnboardingWorkspace[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setWorkspaces(await onboardingSetupService.listWorkspaces());
      setError(null);
    } catch {
      setError("工作区未能加载，请重试。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    if (!name) return;
    setPending(true);
    setError(null);
    try {
      const workspace = await onboardingSetupService.createWorkspace(name);
      setWorkspaces((current) => [...current, workspace]);
      setSelected(workspace.id);
      form.reset();
    } catch {
      setError("工作区未能创建，请重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="workspace-setup-title"
      className="onboarding-step"
    >
      <header>
        <p className="eyebrow">STEP 2 · REQUIRED</p>
        <h1 id="workspace-setup-title">创建或选择工作区</h1>
        <p>工作区承载学习内容和协作边界。请选择已有工作区，或现在新建一个。</p>
      </header>
      <div className="onboarding-form">
        <label htmlFor="onboarding-workspace">
          已有工作区
          <select
            disabled={loading || pending}
            id="onboarding-workspace"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">请选择工作区</option>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
        <p className="onboarding-divider">或创建新工作区</p>
        <form className="onboarding-inline-form" onSubmit={createWorkspace}>
          <label htmlFor="onboarding-workspace-name">
            工作区名称
            <input
              disabled={pending}
              id="onboarding-workspace-name"
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
        {error && workspaces.length === 0 ? (
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
