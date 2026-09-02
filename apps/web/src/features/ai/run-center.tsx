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
  ProductEmptyState,
  ProductProgress,
  ProductTag,
} from "@/components/product/product-ui";
import { AppIcon } from "@/components/app-shell/app-icon";
import {
  InspectorSection,
  WorkbenchActionBar,
  WorkbenchContextBar,
  WorkbenchFrame,
  WorkbenchHeader,
  WorkbenchToolbar,
} from "@/components/product/workbench";
import {
  WorkbenchSelect,
  WorkbenchSheet,
  WorkbenchTabPanel,
  WorkbenchTabs,
  type WorkbenchSelectOption,
} from "@/components/product/headless-ui";
import { isRecentAuthRequired, LogionApiError } from "@/lib/api/client";

import styles from "./ai-governance-workbench.module.css";

import {
  type AISendScope,
  describeAISendScope,
  describeCostBudget,
  describeTokenBudget,
} from "./ai-send-preview";
import { useAIRunController } from "./use-ai-run-controller";

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

function requestSuffix(error: LogionApiError): string {
  return error.requestId === "unavailable"
    ? ""
    : `（请求编号：${error.requestId}）`;
}

function errorText(error: unknown) {
  if (isRecentAuthRequired(error)) {
    return `需要重新认证后继续此操作${requestSuffix(error)}。`;
  }
  if (error instanceof LogionApiError) {
    if (error.code === "AI_BUDGET_EXCEEDED")
      return "本月 AI Token 使用量已达上限，内容未发送。";
    if (error.status === 403)
      return `当前角色无权使用 AI；请联系 Workspace 管理员${requestSuffix(error)}。`;
    return `AI 操作未完成（${error.code}，请求编号：${error.requestId}）。`;
  }
  return "AI 暂时不可用；核心学习功能不受影响。";
}

export function AIRunCenter() {
  const { request } = useAIRunController();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [dataWorkspaceId, setDataWorkspaceId] = useState("");
  const [online, setOnline] = useState(true);
  const [recentAuthRequired, setRecentAuthRequired] = useState(false);
  const [status, setStatus] = useState("AI 只生成草稿，不会自动修改正式记录。");
  const [pendingRun, setPendingRun] = useState<PendingRun | null>(null);
  const [sendConsent, setSendConsent] = useState(false);
  const [masterTab, setMasterTab] = useState("runs");
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const runFormRef = useRef<HTMLFormElement>(null);
  const selectedWorkspace = workspaces.find((item) => item.id === workspaceId);
  const canUse =
    selectedWorkspace !== undefined && selectedWorkspace.role !== "viewer";

  const loadWorkspaces = useCallback(async () => {
    try {
      const result = await request<{
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
      setRecentAuthRequired(isRecentAuthRequired(error));
      setStatus(errorText(error));
    }
  }, [request]);

  const loadData = useCallback(
    async (selected: string) => {
      try {
        const [runResult, draftResult] = await Promise.all([
          request<{ runs: Run[] }>(`/api/v1/workspaces/${selected}/ai/runs`),
          request<{ drafts: Draft[] }>(
            `/api/v1/workspaces/${selected}/ai/drafts`,
          ),
        ]);
        setRuns(Array.isArray(runResult.runs) ? runResult.runs : []);
        setDrafts(Array.isArray(draftResult.drafts) ? draftResult.drafts : []);
        setDataWorkspaceId(selected);
        setRecentAuthRequired(false);
      } catch (error) {
        setRuns([]);
        setDrafts([]);
        setDataWorkspaceId(selected);
        setRecentAuthRequired(isRecentAuthRequired(error));
        setStatus(errorText(error));
      }
    },
    [request],
  );

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
  const reviewedDrafts = visibleDrafts.length - pendingDrafts;
  const selectedDraft =
    visibleDrafts.find((draft) => draft.id === selectedDraftId) ??
    visibleDrafts[0] ??
    null;
  const workspaceOptions: WorkbenchSelectOption[] = workspaces.map(
    (workspace) => ({
      label: `${workspace.name} · ${workspace.role}`,
      value: workspace.id,
    }),
  );

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
      const preview = await request<Preview>(
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
      setRecentAuthRequired(isRecentAuthRequired(error));
      setStatus(errorText(error));
    }
  }

  async function sendPreviewedRun() {
    if (!workspaceId || !pendingRun || !sendConsent || !online) return;
    try {
      await request(`/api/v1/workspaces/${workspaceId}/ai/runs`, {
        method: "POST",
        csrf: true,
        body: JSON.stringify(pendingRun.payload),
      });
      runFormRef.current?.reset();
      setPendingRun(null);
      setSendConsent(false);
      await loadData(workspaceId);
      setStatus("AI 运行已入队；可随时刷新状态或请求取消。");
    } catch (error) {
      setRecentAuthRequired(isRecentAuthRequired(error));
      setStatus(errorText(error));
    }
  }

  async function cancelRun(run: Run) {
    if (!workspaceId || !online) return;
    try {
      await request(
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
      setRecentAuthRequired(isRecentAuthRequired(error));
      setStatus(errorText(error));
    }
  }

  async function decideDraft(event: FormEvent<HTMLFormElement>, draft: Draft) {
    event.preventDefault();
    if (!workspaceId || !online) return;
    const data = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const decision =
      (submitter as HTMLButtonElement | null)?.value ??
      String(data.get("decision") ?? "rejected");
    try {
      const edited = JSON.parse(String(data.get("edited_output") ?? "{}"));
      await request(
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
      setRecentAuthRequired(isRecentAuthRequired(error));
      setStatus(errorText(error));
    }
  }

  return (
    <section
      className={styles.root}
      id="ai-run-center"
      aria-labelledby="ai-runs-heading"
    >
      <WorkbenchFrame
        label="AI 草稿审查工作台"
        header={
          <WorkbenchHeader
            eyebrow="AI · 可审查草稿"
            title={<span id="ai-runs-heading">AI 草稿</span>}
            description="AI 只生成可追溯草稿；发送前核对来源，采纳前保留人工决定。"
          />
        }
        context={
          <WorkbenchContextBar
            context={{
              workspace: selectedWorkspace
                ? { id: selectedWorkspace.id, name: selectedWorkspace.name }
                : undefined,
              permission: selectedWorkspace
                ? {
                    label: canUse ? "可运行" : "只读状态",
                    tone: canUse ? "good" : "warn",
                  }
                : undefined,
              sync: {
                label: online ? "在线" : "离线",
                tone: online ? "good" : "warn",
              },
              vault: { label: "服务端上下文" },
            }}
          />
        }
        toolbar={
          <WorkbenchToolbar label="AI 草稿工具">
            <div className={styles.toolbarLead} aria-live="polite">
              {!online ? "当前离线：云 AI 不可用。" : status}
              {recentAuthRequired ? (
                <a
                  className={styles.reauthAction}
                  href="/auth/login?next=/app/ai"
                >
                  重新认证
                </a>
              ) : null}
            </div>
            <WorkbenchSelect
              label="AI 工作区"
              onValueChange={(value) => {
                setWorkspaceId(value);
                setPendingRun(null);
                setSendConsent(false);
              }}
              options={workspaceOptions}
              placeholder="选择工作区"
              value={workspaceId}
            />
          </WorkbenchToolbar>
        }
        masterLabel="运行与草稿目录"
        master={
          <aside className={styles.masterPane} data-testid="ai-drafts">
            <div className={styles.paneHeading}>
              <span className={styles.eyebrow}>AI QUEUE</span>
              <strong>运行与草稿</strong>
            </div>
            <WorkbenchTabs
              label="AI 队列视图"
              onValueChange={setMasterTab}
              tabs={[
                { label: "运行队列", value: "runs", count: visibleRuns.length },
                { label: "待审草稿", value: "drafts", count: pendingDrafts },
              ]}
              value={masterTab}
            >
              <WorkbenchTabPanel value="runs">
                <ul className={styles.queueList}>
                  {visibleRuns.map((run) => (
                    <li className={styles.queueItem} key={run.id}>
                      <button
                        className={styles.queueRow}
                        type="button"
                        onClick={() => setMasterTab("runs")}
                      >
                        <span className={styles.queueIcon}>
                          <AppIcon name="ai" size={14} />
                        </span>
                        <span>
                          <strong>{run.task_type}</strong>
                          <small>
                            {run.status} · {run.attempt_count} 次尝试 ·{" "}
                            {run.reserved_tokens} Token
                          </small>
                        </span>
                      </button>
                      {run.status === "queued" || run.status === "running" ? (
                        <button
                          className={styles.inlineDanger}
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
                    description="创建一份结构化草稿任务开始运行。"
                  />
                ) : null}
              </WorkbenchTabPanel>
              <WorkbenchTabPanel value="drafts">
                <ul className={styles.queueList}>
                  {visibleDrafts.map((draft) => (
                    <li key={`${draft.id}:${draft.version}`}>
                      <button
                        className={`${styles.queueRow} ${draft.id === selectedDraft?.id ? styles.selectedRow : ""}`}
                        type="button"
                        onClick={() => setSelectedDraftId(draft.id)}
                      >
                        <span className={styles.queueIcon}>
                          <AppIcon name="files" size={14} />
                        </span>
                        <span>
                          <strong>{draft.target_type}</strong>
                          <small>
                            {draft.status} · 目标版本 {draft.target_version}
                          </small>
                        </span>
                        <ProductTag
                          tone={draft.status === "pending" ? "warn" : "good"}
                        >
                          {draft.status === "pending" ? "待审" : "已审"}
                        </ProductTag>
                      </button>
                    </li>
                  ))}
                </ul>
                {visibleDrafts.length === 0 ? (
                  <ProductEmptyState
                    icon="✓"
                    title="暂无待审草稿"
                    description="AI 输出生成后会进入此处，正式记录不会自动改变。"
                  />
                ) : null}
              </WorkbenchTabPanel>
            </WorkbenchTabs>
            <button
              className={`${styles.primaryButton} ${styles.composerTrigger}`}
              data-workbench-primary={
                !pendingRun && !selectedDraft ? "true" : undefined
              }
              type="button"
              disabled={!online || !canUse || !workspaceId}
              onClick={() => setComposerOpen(true)}
            >
              创建结构化草稿
            </button>
          </aside>
        }
        mainLabel="草稿审查"
        main={
          <div className={styles.mainPane} data-testid="ai-review">
            <WorkbenchActionBar
              secondary={
                <button
                  type="button"
                  disabled={!online || !workspaceId}
                  onClick={() => void loadData(workspaceId)}
                >
                  <AppIcon name="refresh" size={14} />
                  刷新状态
                </button>
              }
            />
            <section className={styles.dataSection}>
              <header className={styles.sectionHeader}>
                <div>
                  <span className={styles.eyebrow}>DRAFT REVIEW</span>
                  <h2>
                    {selectedDraft ? "审查选中的草稿" : "选择一份草稿开始审查"}
                  </h2>
                </div>
                {selectedDraft ? (
                  <ProductTag
                    tone={selectedDraft.status === "pending" ? "warn" : "good"}
                  >
                    {selectedDraft.status === "pending"
                      ? "待人工决定"
                      : "已审查"}
                  </ProductTag>
                ) : null}
              </header>
              {pendingRun ? (
                <div
                  className={styles.confirmation}
                  data-testid="ai-send-confirmation"
                >
                  <div className={styles.confirmationHeader}>
                    <strong>发送前最终确认</strong>
                    <ProductTag tone="warn">尚未发送</ProductTag>
                  </div>
                  <p className={styles.muted}>
                    以下信息来自刚完成的真实路由预检；修改表单后必须重新预检。
                  </p>
                  <dl className={styles.confirmationGrid}>
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
                  <label className={styles.consent}>
                    <input
                      type="checkbox"
                      checked={sendConsent}
                      onChange={(event) => setSendConsent(event.target.checked)}
                    />
                    我确认上述数据范围、Provider、模型与预算信息，可以发送
                  </label>
                  <div className={styles.inlineActions}>
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
                      className={styles.primaryButton}
                      data-workbench-primary="true"
                      type="button"
                      disabled={!sendConsent || !online}
                      onClick={() => void sendPreviewedRun()}
                    >
                      确认并发送到 Provider
                    </button>
                  </div>
                </div>
              ) : selectedDraft ? (
                <form
                  className={styles.reviewForm}
                  onSubmit={(event) => void decideDraft(event, selectedDraft)}
                >
                  <p className={styles.muted}>
                    目标类型：<strong>{selectedDraft.target_type}</strong> ·
                    版本 {selectedDraft.target_version} · AI
                    输出为草稿，采纳前不算正式记录。
                  </p>
                  <label>
                    草稿 JSON
                    <textarea
                      name="edited_output"
                      defaultValue={JSON.stringify(
                        selectedDraft.edited_output ??
                          selectedDraft.structured_output,
                        null,
                        2,
                      )}
                      readOnly={selectedDraft.status !== "pending"}
                    />
                  </label>
                  <label>
                    审查说明
                    <input
                      name="decision_note"
                      maxLength={1000}
                      disabled={selectedDraft.status !== "pending"}
                    />
                  </label>
                  <div className={styles.inlineActions}>
                    <button
                      name="decision"
                      value="rejected"
                      disabled={selectedDraft.status !== "pending"}
                    >
                      拒绝草稿
                    </button>
                    <button
                      className={styles.primaryButton}
                      data-workbench-primary={
                        selectedDraft.status === "pending" ? "true" : undefined
                      }
                      name="decision"
                      value="accepted"
                      disabled={selectedDraft.status !== "pending"}
                    >
                      批准草稿
                    </button>
                  </div>
                </form>
              ) : (
                <ProductEmptyState
                  icon="✓"
                  title="暂无待审草稿"
                  description="打开左侧创建面板，定义来源、预算和输出字段。"
                />
              )}
            </section>
            <section className={styles.dataSection} data-testid="ai-runs">
              <header className={styles.sectionHeader}>
                <div>
                  <span className={styles.eyebrow}>RUN HISTORY</span>
                  <h2>运行记录</h2>
                </div>
                <ProductTag tone={activeRuns ? "warn" : "good"}>
                  {activeRuns ? `${activeRuns} 项处理中` : "队列空闲"}
                </ProductTag>
              </header>
              {visibleRuns.length ? (
                <ul className={styles.dataList}>
                  {visibleRuns.map((run) => (
                    <li key={`history-${run.id}`}>
                      <span>
                        <strong>{run.task_type}</strong>
                        <small>
                          {run.status} · {run.reserved_tokens} Token 预留
                        </small>
                      </span>
                      {run.status === "queued" || run.status === "running" ? (
                        <button
                          type="button"
                          disabled={!online}
                          onClick={() => void cancelRun(run)}
                        >
                          取消运行
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.muted}>还没有运行记录。</p>
              )}
              {visibleDrafts.length ? (
                <ProductProgress
                  label="审查完成率"
                  value={(reviewedDrafts / visibleDrafts.length) * 100}
                  tone="good"
                />
              ) : null}
            </section>
          </div>
        }
        inspectorLabel="AI 草稿检查器"
        inspector={
          <div className={styles.inspectorPane} data-testid="ai-source">
            <InspectorSection title="当前 Workspace">
              <dl className={styles.kvList}>
                <div>
                  <dt>名称</dt>
                  <dd>{selectedWorkspace?.name ?? "未选择"}</dd>
                </div>
                <div>
                  <dt>角色</dt>
                  <dd>{selectedWorkspace?.role ?? "-"}</dd>
                </div>
                <div>
                  <dt>运行</dt>
                  <dd>
                    {visibleRuns.length} 项 · {activeRuns} 项处理中
                  </dd>
                </div>
                <div>
                  <dt>待审草稿</dt>
                  <dd>{pendingDrafts} 份</dd>
                </div>
              </dl>
            </InspectorSection>
            <InspectorSection title="发送边界">
              <p className={styles.inspectorCopy}>
                来源字段、目标版本和保留输入选项在发送前预检；内容可能离开当前部署区域，结果只进入待审草稿。
              </p>
            </InspectorSection>
            <InspectorSection title="操作状态">
              <p className={styles.inspectorCopy} aria-live="polite">
                {!online ? "当前离线：云 AI 不可用。" : status}
              </p>
              {selectedWorkspace && !canUse ? (
                <p className={styles.stateWarn} role="status">
                  当前角色无权运行 AI；草稿查看仍可用。
                </p>
              ) : null}
            </InspectorSection>
          </div>
        }
      />
      <WorkbenchSheet
        description="明确目标、发送字段和预期输出，再执行真实路由预检。"
        onOpenChange={setComposerOpen}
        open={composerOpen}
        title="创建结构化草稿"
      >
        <form
          className={styles.sheetForm}
          ref={runFormRef}
          onInput={() => {
            setPendingRun(null);
            setSendConsent(false);
          }}
          onSubmit={(event) => {
            void previewRun(event).then(() => setComposerOpen(false));
          }}
        >
          <div className={styles.formGrid}>
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
              <input name="target_id" required />
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
          </div>
          <label>
            发送内容
            <textarea name="input_value" maxLength={100_000} required />
          </label>
          <label className={styles.checkRow}>
            <input name="retain_input" type="checkbox" />
            运行结束后仍保留加密输入
          </label>
          <label className={styles.checkRow}>
            <input name="source_confirmed" type="checkbox" required />
            我已明确选择并核对上述发送来源与内容范围
          </label>
          <footer className={styles.sheetActions}>
            <button type="button" onClick={() => setComposerOpen(false)}>
              取消
            </button>
            <button
              className={styles.primaryButton}
              disabled={!online || !canUse || !workspaceId}
            >
              预检发送范围与预算
            </button>
          </footer>
        </form>
      </WorkbenchSheet>
    </section>
  );
}
