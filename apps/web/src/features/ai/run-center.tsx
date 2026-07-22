"use client";

import type { components } from "@logion/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { browserApiClient, LogionApiError } from "@/lib/api/client";

type Workspace = components["schemas"]["WorkspaceResponse"];
type Run = components["schemas"]["AIRunResponse"];
type Draft = components["schemas"]["AIOutputDraftResponse"];
type Preview = components["schemas"]["AIRouteResolveResponse"];

function errorText(error: unknown) {
  if (error instanceof LogionApiError) {
    if (error.code === "AI_BUDGET_EXCEEDED")
      return "本月 AI 预算不足，未发送内容。";
    if (error.status === 403)
      return "当前角色无权使用 AI，或需要重新验证身份。";
    return `AI 操作未完成（${error.code}，请求编号：${error.requestId}）。`;
  }
  return "AI 暂时不可用；核心学习功能不受影响。";
}

export function AIRunCenter() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [dataWorkspaceId, setDataWorkspaceId] = useState("");
  const [online, setOnline] = useState(true);
  const [status, setStatus] = useState("AI 只生成草稿，不会自动修改正式记录。");
  const selectedWorkspace = workspaces.find((item) => item.id === workspaceId);
  const canUse =
    selectedWorkspace !== undefined && selectedWorkspace.role !== "viewer";

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

  const loadData = useCallback(async (selected: string) => {
    try {
      const [runResult, draftResult] = await Promise.all([
        browserApiClient.request<{ runs: Run[] }>(
          `/api/v1/workspaces/${selected}/ai/runs`,
        ),
        browserApiClient.request<{ drafts: Draft[] }>(
          `/api/v1/workspaces/${selected}/ai/drafts`,
        ),
      ]);
      setRuns(Array.isArray(runResult.runs) ? runResult.runs : []);
      setDrafts(Array.isArray(draftResult.drafts) ? draftResult.drafts : []);
      setDataWorkspaceId(selected);
    } catch (error) {
      setRuns([]);
      setDrafts([]);
      setDataWorkspaceId(selected);
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
    if (workspaceId && canUse && online)
      queueMicrotask(() => void loadData(workspaceId));
  }, [canUse, loadData, online, workspaceId]);

  const visibleRuns = dataWorkspaceId === workspaceId ? runs : [];
  const visibleDrafts = dataWorkspaceId === workspaceId ? drafts : [];

  async function createRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !canUse || !online) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const inputName = String(data.get("input_name") ?? "");
    const inputValue = String(data.get("input_value") ?? "");
    const outputName = String(data.get("output_name") ?? "");
    const requestedOutputTokens = Number(
      data.get("requested_output_tokens") ?? 1,
    );
    const estimatedInputTokens = Math.max(
      1,
      Math.ceil(
        (new TextEncoder().encode(inputName).length +
          new TextEncoder().encode(inputValue).length) /
          3,
      ),
    );
    try {
      const preview = await browserApiClient.request<Preview>(
        `/api/v1/workspaces/${workspaceId}/ai/route-resolution-preview`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify({
            task_type: String(data.get("task_type") ?? ""),
            estimated_input_tokens: estimatedInputTokens,
            requested_output_tokens: requestedOutputTokens,
          }),
        },
      );
      const first = preview.candidates[0];
      if (!first) throw new Error("No route candidate");
      const confirmed = window.confirm(
        `将发送字段“${inputName}”至 Provider ${first.provider_id} / 模型 ${first.model_id}。` +
          `估算 ${first.estimated_tokens} Token、${first.estimated_cost_minor} ${first.currency} 最小单位。` +
          "内容可能离开当前部署区域；AI 只生成待审草稿。确认发送？",
      );
      if (!confirmed) {
        setStatus("已取消，内容未发送至 Provider。");
        return;
      }
      await browserApiClient.request(
        `/api/v1/workspaces/${workspaceId}/ai/runs`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify({
            id: crypto.randomUUID(),
            idempotency_key: crypto.randomUUID(),
            task_type: String(data.get("task_type") ?? ""),
            target_type: String(data.get("target_type") ?? ""),
            target_id: String(data.get("target_id") ?? ""),
            target_version: Number(data.get("target_version") ?? 1),
            input_fields: { [inputName]: inputValue },
            expected_output_fields: [outputName],
            requested_output_tokens: requestedOutputTokens,
            retain_input: data.get("retain_input") === "on",
            send_confirmed: true,
          }),
        },
      );
      form.reset();
      await loadData(workspaceId);
      setStatus("AI 运行已入队；可随时刷新状态或请求取消。");
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  async function cancelRun(run: Run) {
    if (!workspaceId || !online) return;
    try {
      await browserApiClient.request(
        `/api/v1/workspaces/${workspaceId}/ai/runs/${run.id}/cancel`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify({ expected_version: run.version }),
        },
      );
      await loadData(workspaceId);
      setStatus("取消请求已记录；进行中的外部请求会在安全检查点停止。");
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  async function decideDraft(event: FormEvent<HTMLFormElement>, draft: Draft) {
    event.preventDefault();
    if (!workspaceId || !online) return;
    const data = new FormData(event.currentTarget);
    const decision = String(data.get("decision") ?? "rejected");
    try {
      const edited = JSON.parse(String(data.get("edited_output") ?? "{}"));
      await browserApiClient.request(
        `/api/v1/workspaces/${workspaceId}/ai/drafts/${draft.id}/decision`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify({
            expected_version: draft.version,
            decision,
            edited_output: decision === "accepted" ? edited : null,
            decision_note: String(data.get("decision_note") ?? "") || null,
          }),
        },
      );
      await loadData(workspaceId);
      setStatus(
        decision === "accepted"
          ? "草稿已人工批准并保留；本版本不会自动覆盖正式对象。"
          : "草稿已拒绝，正式对象未改变。",
      );
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  return (
    <section className="settings-page" aria-labelledby="ai-runs-heading">
      <header>
        <p className="eyebrow">LOGION · AUDITABLE AI</p>
        <h1 id="ai-runs-heading">AI 运行与草稿</h1>
        <p aria-live="polite">
          {!online ? "当前离线：云 AI 不可用。" : status}
        </p>
      </header>
      <section className="settings-card">
        <label htmlFor="ai-run-workspace">工作区</label>
        <select
          id="ai-run-workspace"
          value={workspaceId}
          onChange={(event) => setWorkspaceId(event.target.value)}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name} · {workspace.role}
            </option>
          ))}
        </select>
      </section>
      <section className="settings-card">
        <h3>创建结构化草稿</h3>
        <form className="planning-form" onSubmit={createRun}>
          <label>
            任务类型
            <input name="task_type" pattern="[a-z][a-z0-9_.-]*" required />
          </label>
          <label>
            目标类型
            <input name="target_type" pattern="[a-z][a-z0-9_.-]*" required />
          </label>
          <label>
            目标 ID
            <input name="target_id" type="text" required />
          </label>
          <label>
            目标版本
            <input
              name="target_version"
              type="number"
              min={1}
              defaultValue={1}
              required
            />
          </label>
          <label>
            发送字段名
            <input
              name="input_name"
              pattern="[A-Za-z][A-Za-z0-9_.-]*"
              required
            />
          </label>
          <label>
            发送内容
            <textarea name="input_value" maxLength={100_000} required />
          </label>
          <label>
            草稿输出字段
            <input
              name="output_name"
              pattern="[A-Za-z][A-Za-z0-9_.-]*"
              required
            />
          </label>
          <label>
            最大输出 Token
            <input
              name="requested_output_tokens"
              type="number"
              min={1}
              max={100_000}
              defaultValue={1000}
              required
            />
          </label>
          <label>
            <input name="retain_input" type="checkbox" />
            运行结束后仍保留加密输入
          </label>
          <button disabled={!online || !canUse || !workspaceId}>
            预检并确认发送
          </button>
        </form>
      </section>
      <section className="settings-card">
        <h3>运行</h3>
        <button
          type="button"
          disabled={!online || !workspaceId}
          onClick={() => void loadData(workspaceId)}
        >
          刷新
        </button>
        <ul className="item-list">
          {visibleRuns.map((run) => (
            <li key={run.id}>
              <span>
                <strong>{run.task_type}</strong>
                <small>
                  {run.status} · {run.attempt_count} 次尝试 ·{" "}
                  {run.reserved_tokens} Token 预留
                </small>
              </span>
              {run.status === "queued" || run.status === "running" ? (
                <button
                  type="button"
                  disabled={!online}
                  onClick={() => void cancelRun(run)}
                >
                  取消
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <section className="settings-card">
        <h3>待审草稿</h3>
        {visibleDrafts.map((draft) => (
          <form
            key={`${draft.id}:${draft.version}`}
            className="planning-form"
            onSubmit={(event) => void decideDraft(event, draft)}
          >
            <p>
              <strong>{draft.target_type}</strong> · {draft.status} · 目标版本{" "}
              {draft.target_version}
            </p>
            <label>
              草稿 JSON
              <textarea
                name="edited_output"
                defaultValue={JSON.stringify(
                  draft.edited_output ?? draft.structured_output,
                  null,
                  2,
                )}
                readOnly={draft.status !== "pending"}
              />
            </label>
            <label>
              审查说明
              <input
                name="decision_note"
                maxLength={1000}
                disabled={draft.status !== "pending"}
              />
            </label>
            <span className="app-actions">
              <button
                name="decision"
                value="accepted"
                disabled={draft.status !== "pending"}
              >
                批准草稿
              </button>
              <button
                name="decision"
                value="rejected"
                disabled={draft.status !== "pending"}
              >
                拒绝草稿
              </button>
            </span>
          </form>
        ))}
      </section>
    </section>
  );
}
