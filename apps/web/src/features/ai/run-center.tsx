"use client";

import type { components } from "@logion/contracts";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  ProductDisclosure,
  ProductEmptyState,
  ProductHero,
  ProductMetric,
  ProductPageHeader,
  ProductPanel,
  ProductProgress,
  ProductTag,
} from "@/components/product/product-ui";
import { browserApiClient, LogionApiError } from "@/lib/api/client";

import {
  type AISendScope,
  describeAISendScope,
  describeCostBudget,
  describeTokenBudget,
} from "./ai-send-preview";

type Workspace = components["schemas"]["WorkspaceResponse"];
type Run = components["schemas"]["AIRunResponse"];
type Draft = components["schemas"]["AIOutputDraftResponse"];
type Preview = components["schemas"]["AIRouteResolveResponse"];
type RunCreate = components["schemas"]["AIRunCreate"];
type PendingRun = Readonly<{
  payload: RunCreate;
  preview: Preview;
  scope: AISendScope;
}>;

function errorText(error: unknown) {
  if (error instanceof LogionApiError) {
    if (error.code === "AI_BUDGET_EXCEEDED")
      return "本月 AI Token 使用量已达上限，内容未发送。";
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
  const [pendingRun, setPendingRun] = useState<PendingRun | null>(null);
  const [sendConsent, setSendConsent] = useState(false);
  const runFormRef = useRef<HTMLFormElement>(null);
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
  const pendingDrafts = visibleDrafts.filter(
    (draft) => draft.status === "pending",
  ).length;
  const activeRuns = visibleRuns.filter((run) =>
    ["queued", "running"].includes(run.status),
  ).length;
  const completedRuns = visibleRuns.filter(
    (run) => run.status === "succeeded",
  ).length;
  const reviewedDrafts = visibleDrafts.length - pendingDrafts;

  async function previewRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !canUse || !online) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const inputName = String(data.get("input_name") ?? "");
    const inputValue = String(data.get("input_value") ?? "");
    const outputName = String(data.get("output_name") ?? "");
    if (data.get("source_confirmed") !== "on") {
      setStatus("请先确认发送内容只来自你明确选择并核对的来源。");
      return;
    }
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
      setPendingRun({
        payload: {
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
        },
        preview,
        scope: {
          fieldName: inputName,
          targetId: String(data.get("target_id") ?? ""),
          targetType: String(data.get("target_type") ?? ""),
          valueLength: inputValue.length,
        },
      });
      setSendConsent(false);
      setStatus("预检完成。请核对发送范围、Provider、模型和预算后再确认。");
    } catch (error) {
      setPendingRun(null);
      setSendConsent(false);
      setStatus(errorText(error));
    }
  }

  async function sendPreviewedRun() {
    if (!workspaceId || !pendingRun || !sendConsent || !online) return;
    try {
      await browserApiClient.request(
        `/api/v1/workspaces/${workspaceId}/ai/runs`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify(pendingRun.payload),
        },
      );
      runFormRef.current?.reset();
      setPendingRun(null);
      setSendConsent(false);
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
    <section
      className="settings-page"
      id="ai-run-center"
      aria-labelledby="ai-runs-heading"
    >
      <ProductPageHeader
        eyebrow="AI PROVIDER · GROUNDED DRAFTS"
        title={
          <span id="ai-runs-heading">让 AI 围绕你的资料生成可审查草稿</span>
        }
        description={
          <>
            <p>
              来源、隐私边界、路由和草稿审查在同一页面；AI
              不直接改变任务、掌握或研究结论。
            </p>
            <p className="product-page-status" aria-live="polite">
              {!online ? "当前离线：云 AI 不可用。" : status}
            </p>
          </>
        }
      />
      <ProductHero
        badge={
          <ProductTag tone={online ? "good" : "warn"}>
            {online ? "在线可用" : "当前离线"}
          </ProductTag>
        }
        title={
          pendingDrafts > 0
            ? `${pendingDrafts} 份草稿等待你的决定`
            : "创建一份可追溯、可拒绝的 AI 草稿"
        }
        progressLabel={visibleDrafts.length ? "草稿审查率" : undefined}
        progressValue={
          visibleDrafts.length
            ? (reviewedDrafts / visibleDrafts.length) * 100
            : 0
        }
      >
        每次运行都先预检发送内容；生成结果只进入草稿区，不会自动覆盖正式学习记录。
      </ProductHero>
      <div className="product-metric-grid">
        <ProductMetric
          label="全部运行"
          value={visibleRuns.length}
          detail={`${activeRuns} 项处理中`}
          tone="info"
        />
        <ProductMetric
          label="已完成运行"
          value={completedRuns}
          detail="保留审计状态"
          tone="good"
        />
        <ProductMetric
          label="待审草稿"
          value={pendingDrafts}
          detail="必须人工决定"
          tone={pendingDrafts ? "warn" : "default"}
        />
        <ProductMetric
          label="已审草稿"
          value={reviewedDrafts}
          detail="已批准或拒绝"
        />
      </div>

      <ProductDisclosure
        summary="AI 工作区"
        description="选择运行与草稿所属的现有工作区"
      >
        <label htmlFor="ai-run-workspace">工作区</label>
        <select
          id="ai-run-workspace"
          value={workspaceId}
          onChange={(event) => {
            setWorkspaceId(event.target.value);
            setPendingRun(null);
            setSendConsent(false);
          }}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name} · {workspace.role}
            </option>
          ))}
        </select>
      </ProductDisclosure>

      <ProductDisclosure
        summary="创建结构化草稿"
        description="明确目标、发送字段和预期输出，再执行预检"
      >
        <form
          className="planning-form"
          ref={runFormRef}
          onInput={() => {
            setPendingRun(null);
            setSendConsent(false);
          }}
          onSubmit={previewRun}
        >
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
          <label>
            <input name="source_confirmed" type="checkbox" required />
            我已明确选择并核对上述发送来源与内容范围
          </label>
          <button disabled={!online || !canUse || !workspaceId}>
            预检发送范围与预算
          </button>
        </form>
        {pendingRun ? (
          <ProductPanel
            className="ai-send-confirmation"
            title="发送前最终确认"
            description="以下信息来自刚完成的真实路由预检；修改表单后必须重新预检。"
            aside={<ProductTag tone="warn">尚未发送</ProductTag>}
          >
            <dl className="ai-send-confirmation-grid">
              <div>
                <dt>数据范围</dt>
                <dd>{describeAISendScope(pendingRun.scope)}</dd>
              </div>
              <div>
                <dt>Provider</dt>
                <dd>{pendingRun.preview.candidates[0]?.provider_id}</dd>
              </div>
              <div>
                <dt>模型</dt>
                <dd>{pendingRun.preview.candidates[0]?.model_id}</dd>
              </div>
              <div>
                <dt>Token 预算</dt>
                <dd>{describeTokenBudget(pendingRun.preview)}</dd>
              </div>
              <div>
                <dt>费用预算</dt>
                <dd>{describeCostBudget(pendingRun.preview)}</dd>
              </div>
              <div>
                <dt>结果边界</dt>
                <dd>内容可能离开当前部署区域；结果只进入待审草稿。</dd>
              </div>
            </dl>
            <label className="ai-send-consent">
              <input
                type="checkbox"
                checked={sendConsent}
                onChange={(event) => setSendConsent(event.target.checked)}
              />
              我确认上述数据范围、Provider、模型与预算信息，可以发送
            </label>
            <div className="app-actions">
              <button
                type="button"
                onClick={() => {
                  setPendingRun(null);
                  setSendConsent(false);
                  setStatus("已取消，内容未发送至 Provider。");
                }}
              >
                取消发送
              </button>
              <button
                type="button"
                disabled={!sendConsent || !online}
                onClick={() => void sendPreviewedRun()}
              >
                确认并发送到 Provider
              </button>
            </div>
          </ProductPanel>
        ) : null}
      </ProductDisclosure>

      <ProductPanel
        title="运行队列"
        description="查看任务状态、尝试次数并取消尚未完成的运行。"
        aside={
          <ProductTag tone={activeRuns ? "warn" : "good"}>
            {activeRuns ? `${activeRuns} 项处理中` : "队列空闲"}
          </ProductTag>
        }
      >
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
        {visibleRuns.length === 0 ? (
          <ProductEmptyState
            icon="◇"
            title="还没有 AI 运行"
            description="打开上方创建面板，定义一个结构化草稿任务。"
          />
        ) : null}
      </ProductPanel>

      <ProductPanel
        title="草稿审查台"
        description="检查结构化输出，必要时编辑，再明确批准或拒绝。"
        aside={
          <ProductTag tone={pendingDrafts ? "warn" : "good"}>
            {pendingDrafts} 份待审
          </ProductTag>
        }
      >
        {visibleDrafts.length ? (
          <ProductProgress
            label="审查完成率"
            value={(reviewedDrafts / visibleDrafts.length) * 100}
            tone="good"
          />
        ) : null}
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
        {visibleDrafts.length === 0 ? (
          <ProductEmptyState
            icon="✓"
            title="暂无待审草稿"
            description="AI 输出生成后会进入此处，正式记录不会自动改变。"
          />
        ) : null}
      </ProductPanel>
    </section>
  );
}
