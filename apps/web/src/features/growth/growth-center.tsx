"use client";

import type { components } from "@logion/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { browserApiClient, LogionApiError } from "@/lib/api/client";

type Workspace = components["schemas"]["WorkspaceResponse"];
type Space = components["schemas"]["SpaceResponse"];
type Goal = components["schemas"]["GoalPlanResponse"];
type Template = components["schemas"]["TemplatePackageResponse"];
type Share = components["schemas"]["ShareSnapshotResponse"];

function errorText(error: unknown) {
  if (error instanceof LogionApiError) {
    if (error.code === "TEMPLATE_PRIVATE_SOURCE_BLOCKED")
      return "私有 Space 只能创建私有模板；workspace 模板必须来自共享 Space。";
    if (error.status === 403) return "当前角色或 Space 权限不允许此操作。";
    return `操作未完成（${error.code}，请求编号：${error.requestId}）。`;
  }
  return "操作未完成；已有学习数据不受影响。";
}

export function GrowthCenter() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [spaceId, setSpaceId] = useState("");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [dataWorkspaceId, setDataWorkspaceId] = useState("");
  const [goalsSpaceId, setGoalsSpaceId] = useState("");
  const [newShareToken, setNewShareToken] = useState("");
  const [online, setOnline] = useState(true);
  const [status, setStatus] = useState(
    "模板安装会复制为独立对象；分享默认只读且可撤销。",
  );

  const loadWorkspaces = useCallback(async () => {
    try {
      const result = await browserApiClient.request<{
        workspaces: Workspace[];
      }>("/api/v1/workspaces");
      const next = Array.isArray(result.workspaces) ? result.workspaces : [];
      setWorkspaces(next);
      setWorkspaceId((current) =>
        next.some((item) => item.id === current)
          ? current
          : (next[0]?.id ?? ""),
      );
    } catch (error) {
      setStatus(errorText(error));
    }
  }, []);

  const loadWorkspaceData = useCallback(async (selected: string) => {
    try {
      const [spaceResult, templateResult, shareResult] =
        await Promise.allSettled([
          browserApiClient.request<{ spaces: Space[] }>(
            `/api/v1/workspaces/${selected}/spaces`,
          ),
          browserApiClient.request<{ templates: Template[] }>(
            `/api/v1/workspaces/${selected}/templates`,
          ),
          browserApiClient.request<{ shares: Share[] }>(
            `/api/v1/workspaces/${selected}/shares`,
          ),
        ]);
      if (spaceResult.status === "rejected") throw spaceResult.reason;
      if (templateResult.status === "rejected") throw templateResult.reason;
      const nextSpaces = Array.isArray(spaceResult.value.spaces)
        ? spaceResult.value.spaces
        : [];
      setSpaces(nextSpaces);
      setTemplates(
        Array.isArray(templateResult.value.templates)
          ? templateResult.value.templates
          : [],
      );
      setShares(
        shareResult.status === "fulfilled" &&
          Array.isArray(shareResult.value.shares)
          ? shareResult.value.shares
          : [],
      );
      setDataWorkspaceId(selected);
      setSpaceId((current) =>
        nextSpaces.some((item) => item.id === current)
          ? current
          : (nextSpaces[0]?.id ?? ""),
      );
    } catch (error) {
      setSpaces([]);
      setTemplates([]);
      setShares([]);
      setDataWorkspaceId(selected);
      setStatus(errorText(error));
    }
  }, []);

  const loadGoals = useCallback(async (workspace: string, space: string) => {
    try {
      const result = await browserApiClient.request<{ goals: Goal[] }>(
        `/api/v1/workspaces/${workspace}/spaces/${space}/goals`,
      );
      setGoals(Array.isArray(result.goals) ? result.goals : []);
      setGoalsSpaceId(space);
    } catch (error) {
      setGoals([]);
      setGoalsSpaceId(space);
      setStatus(errorText(error));
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadWorkspaces());
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, [loadWorkspaces]);

  useEffect(() => {
    if (workspaceId && online)
      queueMicrotask(() => void loadWorkspaceData(workspaceId));
  }, [loadWorkspaceData, online, workspaceId]);

  useEffect(() => {
    if (workspaceId && spaceId && online)
      queueMicrotask(() => void loadGoals(workspaceId, spaceId));
  }, [loadGoals, online, spaceId, workspaceId]);

  const visibleSpaces = dataWorkspaceId === workspaceId ? spaces : [];
  const visibleGoals = goalsSpaceId === spaceId ? goals : [];
  const visibleTemplates = dataWorkspaceId === workspaceId ? templates : [];
  const visibleShares = dataWorkspaceId === workspaceId ? shares : [];

  async function createTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !spaceId || !online) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await browserApiClient.request(
        `/api/v1/workspaces/${workspaceId}/templates/from-goal`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify({
            id: crypto.randomUUID(),
            template_key: crypto.randomUUID(),
            previous_template_id: null,
            source_space_id: spaceId,
            source_goal_id: String(data.get("source_goal_id") ?? ""),
            name: String(data.get("name") ?? ""),
            description: String(data.get("description") ?? ""),
            product_min_version: "0.1.0",
            author_name: String(data.get("author_name") ?? ""),
            license: String(data.get("license") ?? ""),
            locale: String(data.get("locale") ?? "zh-CN"),
            target_personas: String(data.get("target_personas") ?? "")
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
            changelog: String(data.get("changelog") ?? ""),
            visibility: String(data.get("visibility") ?? "private"),
          }),
        },
      );
      form.reset();
      await loadWorkspaceData(workspaceId);
      setStatus("模板版本已创建；安装时会生成全新的目标、计划和阶段 ID。");
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  async function installTemplate(template: Template) {
    if (!workspaceId || !spaceId || !online) return;
    if (
      !window.confirm(
        `安装“${template.name}”版本 ${template.version_number}？将创建独立副本，不覆盖已有内容。`,
      )
    )
      return;
    try {
      await browserApiClient.request(
        `/api/v1/workspaces/${workspaceId}/template-installations`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify({
            id: crypto.randomUUID(),
            template_id: template.id,
            target_space_id: spaceId,
          }),
        },
      );
      await loadGoals(workspaceId, spaceId);
      setStatus("模板已安装为独立计划；后续模板版本不会覆盖此副本。");
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  async function createShare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !spaceId || !online) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const result = await browserApiClient.request<{ token: string }>(
        `/api/v1/workspaces/${workspaceId}/shares`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify({
            id: crypto.randomUUID(),
            source_space_id: spaceId,
            source_goal_id: String(data.get("source_goal_id") ?? ""),
            title: String(data.get("title") ?? ""),
            fields: data.getAll("fields").map(String),
            expires_in_days: Number(data.get("expires_in_days") ?? 30),
          }),
        },
      );
      setNewShareToken(result.token);
      form.reset();
      await loadWorkspaceData(workspaceId);
      setStatus("只读分享已创建。请立即保存链接；Token 不会再次显示。");
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  async function revokeShare(share: Share) {
    if (!workspaceId || !online) return;
    try {
      await browserApiClient.request(
        `/api/v1/workspaces/${workspaceId}/shares/${share.id}/revoke`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify({ expected_version: share.version }),
        },
      );
      await loadWorkspaceData(workspaceId);
      setStatus("分享已撤销，原链接立即失效。");
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  return (
    <main id="main-content" className="settings-page">
      <header>
        <p className="eyebrow">LOGION · REUSE & SHARE</p>
        <h1>模板与只读分享</h1>
        <p aria-live="polite">
          {!online ? "当前离线：模板与分享配置暂不可用。" : status}
        </p>
      </header>
      <section className="settings-card">
        <label htmlFor="growth-workspace">工作区</label>
        <select
          id="growth-workspace"
          value={workspaceId}
          onChange={(event) => setWorkspaceId(event.target.value)}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name} · {workspace.role}
            </option>
          ))}
        </select>
        <label htmlFor="growth-space">Space</label>
        <select
          id="growth-space"
          value={spaceId}
          onChange={(event) => setSpaceId(event.target.value)}
        >
          {visibleSpaces.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name} · {space.visibility}
            </option>
          ))}
        </select>
      </section>
      <section className="settings-card">
        <h2>从计划创建模板</h2>
        <form className="planning-form" onSubmit={createTemplate}>
          <label>
            来源目标
            <select name="source_goal_id" required>
              {visibleGoals.map((goal) => (
                <option key={goal.goal_id} value={goal.goal_id}>
                  {goal.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            模板名称
            <input name="name" maxLength={160} required />
          </label>
          <label>
            说明
            <textarea name="description" maxLength={1000} />
          </label>
          <label>
            作者显示名
            <input name="author_name" maxLength={120} required />
          </label>
          <label>
            许可证
            <input
              name="license"
              maxLength={80}
              placeholder="CC-BY-4.0"
              required
            />
          </label>
          <label>
            语言
            <input name="locale" defaultValue="zh-CN" maxLength={35} required />
          </label>
          <label>
            适用人群（逗号分隔）
            <input
              name="target_personas"
              placeholder="self-study,research"
              required
            />
          </label>
          <label>
            变更说明
            <textarea name="changelog" maxLength={2000} />
          </label>
          <label>
            可见性
            <select name="visibility" defaultValue="private">
              <option value="private">仅自己</option>
              <option value="workspace">工作区成员</option>
            </select>
          </label>
          <button disabled={!online || !visibleGoals.length}>
            创建不可变版本
          </button>
        </form>
        <ul className="item-list">
          {visibleTemplates.map((template) => (
            <li key={template.id}>
              <span>
                <strong>
                  {template.name} · v{template.version_number}
                </strong>
                <small>
                  {template.visibility} · {template.license} · 风险链接{" "}
                  {Array.isArray(template.risk_metadata.external_links)
                    ? template.risk_metadata.external_links.length
                    : 0}
                </small>
              </span>
              <button
                type="button"
                disabled={!online || !spaceId || template.status !== "active"}
                onClick={() => void installTemplate(template)}
              >
                安装独立副本
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="settings-card">
        <h2>创建最小只读快照</h2>
        <form className="planning-form" onSubmit={createShare}>
          <label>
            来源目标
            <select name="source_goal_id" required>
              {visibleGoals.map((goal) => (
                <option key={goal.goal_id} value={goal.goal_id}>
                  {goal.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            分享标题
            <input name="title" maxLength={160} required />
          </label>
          <fieldset>
            <legend>公开字段</legend>
            {[
              "title",
              "description",
              "desired_outcome",
              "status",
              "weekly_minutes",
              "target_date",
              "phases",
            ].map((field) => (
              <label key={field}>
                <input name="fields" type="checkbox" value={field} />
                {field}
              </label>
            ))}
          </fieldset>
          <label>
            有效天数
            <input
              name="expires_in_days"
              type="number"
              min={1}
              max={365}
              defaultValue={30}
              required
            />
          </label>
          <button disabled={!online || !visibleGoals.length}>
            创建只读链接
          </button>
        </form>
        {newShareToken ? (
          <p role="status">
            一次性链接：
            <a href={`/shares/${newShareToken}`} rel="noreferrer">
              /shares/{newShareToken}
            </a>
          </p>
        ) : null}
        <ul className="item-list">
          {visibleShares.map((share) => (
            <li key={share.id}>
              <span>
                <strong>{share.title}</strong>
                <small>
                  {share.status} · 到期{" "}
                  {new Date(share.expires_at).toLocaleString()}
                </small>
              </span>
              {share.status === "active" ? (
                <button
                  type="button"
                  disabled={!online}
                  onClick={() => void revokeShare(share)}
                >
                  立即撤销
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
