"use client";

import type { components } from "@logion/contracts";
import type { JsonObject, LocalEntity } from "@logion/offline";
import {
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";

import { AppIcon } from "@/components/app-shell/app-icon";
import {
  WorkbenchSelect,
  WorkbenchSheet,
  WorkbenchTabPanel,
  WorkbenchTabs,
  WorkbenchTooltip,
} from "@/components/product/headless-ui";
import {
  InspectorSection,
  WorkbenchContextBar,
  WorkbenchFrame,
  WorkbenchHeader,
  WorkbenchToolbar,
} from "@/components/product/workbench";
import { ProductTag } from "@/components/product/product-ui";
import {
  ProductWorkbenchStateNotice as StateNotice,
  type ProductWorkbenchState,
} from "@/components/product/product-workbench-state";

import styles from "./research-workbench.module.css";

import {
  type ResearchEntityType,
  safeResearchSourceUrl,
} from "./research-collaboration-contract";
import { buildMetricComparison } from "./research-workbench-model";
import { ResearchExperimentComparison } from "./research-experiment-comparison";

type Workspace = components["schemas"]["WorkspaceResponse"];
type Space = components["schemas"]["SpaceResponse"];

export interface ResearchView {
  entity: LocalEntity;
  payload: JsonObject;
}

export interface ResearchWorkbenchContext {
  contextPhase: "error" | "loading" | "ready";
  dataPhase: "error" | "idle" | "loading" | "ready";
  deviceId: string;
  researchState: ProductWorkbenchState;
  selectedSpace?: Space;
  selectedWorkspace?: Workspace;
  spaceId: string;
  spaces: Space[];
  status: string;
  unlocked: boolean;
  workspaceId: string;
  workspaces: Workspace[];
}

export interface ResearchWorkbenchData {
  visibleClaims: ResearchView[];
  visibleFeedback: ResearchView[];
  visibleMetrics: ResearchView[];
  visiblePapers: ResearchView[];
  visibleQuestions: ResearchView[];
  visibleRuns: ResearchView[];
  coverage: number | null;
  comparison: ReturnType<typeof buildMetricComparison>;
}

export interface ResearchWorkbenchActions {
  loadContext: () => Promise<void>;
  setSpaceId: (value: string) => void;
  setWorkspaceId: (value: string) => void;
  submitResearch: (
    event: FormEvent<HTMLFormElement>,
    kind: ResearchEntityType,
  ) => Promise<boolean>;
  synchronize: () => Promise<void>;
  unlock: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
}

export interface ResearchWorkbenchProps {
  actions: ResearchWorkbenchActions;
  context: ResearchWorkbenchContext;
  data: ResearchWorkbenchData;
}

const STANCE_META = {
  supports: { label: "支持", tone: "good" as const },
  opposes: { label: "反证", tone: "bad" as const },
  mixed: { label: "混合", tone: "warn" as const },
  unknown: { label: "不确定", tone: "info" as const },
};

function text(payload: JsonObject, key: string, fallback = "") {
  const value = payload[key];
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间待定";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function StatusLine({ children }: { children: string }) {
  return (
    <p aria-live="polite" className={styles.statusLine} role="status">
      <span aria-hidden="true" />
      {children}
    </p>
  );
}

function EmptyPane({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className={styles.emptyPane} role="status">
      <span aria-hidden="true">
        <AppIcon name="flask" size={18} />
      </span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function ContextToolbar({
  actions,
  context,
}: {
  actions: ResearchWorkbenchActions;
  context: ResearchWorkbenchContext;
}) {
  return (
    <WorkbenchToolbar label="研究工作台上下文操作">
      <WorkbenchSelect
        label="选择 Workspace"
        onValueChange={actions.setWorkspaceId}
        options={context.workspaces.map((workspace) => ({
          label: workspace.name,
          value: workspace.id,
        }))}
        placeholder="Workspace"
        value={context.workspaceId || undefined}
      />
      <WorkbenchSelect
        disabled={!context.selectedWorkspace}
        label="选择 Space"
        onValueChange={actions.setSpaceId}
        options={context.spaces.map((space) => ({
          label: space.name,
          value: space.id,
        }))}
        placeholder="Space"
        value={context.spaceId || undefined}
      />
      <span className={styles.toolbarSpacer} />
      <WorkbenchTooltip content="推送本地变更并拉取远端记录">
        <button
          aria-label="立即同步"
          className={styles.iconButton}
          disabled={!context.unlocked}
          onClick={() => void actions.synchronize()}
          type="button"
        >
          <AppIcon name="refresh" size={16} />
        </button>
      </WorkbenchTooltip>
    </WorkbenchToolbar>
  );
}

function ResearchMaster({
  data,
  onCreate,
  onSelect,
  selectedId,
}: {
  data: ResearchWorkbenchData;
  onCreate: () => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  return (
    <div className={styles.master} data-testid="research-questions">
      <header className={styles.paneHeader}>
        <div>
          <p className={styles.eyebrow}>RESEARCH QUESTIONS</p>
          <h2>研究问题</h2>
        </div>
        <span className={styles.count}>{data.visibleQuestions.length}</span>
      </header>
      <button className={styles.masterAction} onClick={onCreate} type="button">
        <AppIcon name="plus" size={15} />
        新建问题
      </button>
      <div aria-label="当前 Space 的研究问题" className={styles.questionList}>
        {data.visibleQuestions.length ? (
          data.visibleQuestions.map((question) => {
            const claimCount = data.visibleClaims.length;
            const active = selectedId === question.entity.entity_id;
            return (
              <button
                aria-current={active ? "true" : undefined}
                className={styles.questionRow}
                data-selected={active}
                key={question.entity.entity_id}
                onClick={() => onSelect(question.entity.entity_id)}
                type="button"
              >
                <span className={styles.questionIcon} aria-hidden="true">
                  <AppIcon name="flask" size={15} />
                </span>
                <span className={styles.questionCopy}>
                  <strong>
                    {text(question.payload, "question", "未命名问题")}
                  </strong>
                  <small>
                    {text(question.payload, "rationale", "尚未填写依据") ||
                      "尚未填写依据"}
                  </small>
                </span>
                <span className={styles.rowMeta}>{claimCount} 声明</span>
              </button>
            );
          })
        ) : (
          <EmptyPane
            description="一个可检验的问题会成为声明、实验和指标的共同入口。"
            title="尚无研究问题"
          />
        )}
      </div>
      <footer className={styles.masterFooter}>
        <span>{data.visiblePapers.length} 篇论文</span>
        <span>{data.visibleRuns.length} 次实验</span>
      </footer>
    </div>
  );
}

function QuestionHeader({
  data,
  onCreateClaim,
  selectedQuestion,
}: {
  data: ResearchWorkbenchData;
  onCreateClaim: () => void;
  selectedQuestion: ResearchView | null;
}) {
  if (!selectedQuestion) {
    return (
      <EmptyPane
        description="问题 → 声明 → 来源与立场 → 实验与指标 → 反馈。"
        title="从一个可检验的问题开始"
      />
    );
  }
  const questionId = selectedQuestion.entity.entity_id;
  const runs = data.visibleRuns.filter(
    (run) => text(run.payload, "question_id") === questionId,
  );
  return (
    <section
      className={styles.questionHeader}
      data-testid="research-question-header"
    >
      <div>
        <p className={styles.eyebrow}>SELECTED QUESTION</p>
        <h2>{text(selectedQuestion.payload, "question", "研究问题")}</h2>
        <p>
          {text(selectedQuestion.payload, "rationale", "尚未填写问题依据") ||
            "尚未填写问题依据"}
        </p>
      </div>
      <div className={styles.questionStats} aria-label="研究问题进度">
        <div>
          <strong>{data.visibleClaims.length}</strong>
          <span>声明</span>
        </div>
        <div>
          <strong>{runs.length}</strong>
          <span>实验</span>
        </div>
        <div>
          <strong>
            {data.coverage === null ? "—" : `${Math.round(data.coverage)}%`}
          </strong>
          <span>覆盖</span>
        </div>
        <button
          className={styles.inlineAction}
          onClick={onCreateClaim}
          type="button"
        >
          <AppIcon name="plus" size={14} /> 添加声明
        </button>
      </div>
    </section>
  );
}

function ClaimList({
  data,
  onCreate,
  onSelect,
  selectedId,
}: {
  data: ResearchWorkbenchData;
  onCreate: () => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  return (
    <section className={styles.section} data-testid="research-claims">
      <header className={styles.sectionHeader}>
        <div>
          <p className={styles.eyebrow}>CLAIMS & EVIDENCE</p>
          <h3>声明与证据</h3>
        </div>
        <div className={styles.sectionActions}>
          <span className={styles.sectionMeta}>
            {data.visibleClaims.length} 条声明
          </span>
          <button
            className={styles.sectionAction}
            onClick={onCreate}
            type="button"
          >
            <AppIcon name="plus" size={14} /> 建立声明
          </button>
        </div>
      </header>
      {data.visibleClaims.length ? (
        <div className={styles.claimList}>
          {data.visibleClaims.map((claim) => {
            const stance =
              STANCE_META[
                text(
                  claim.payload,
                  "stance",
                  "unknown",
                ) as keyof typeof STANCE_META
              ] ?? STANCE_META.unknown;
            const selected = selectedId === claim.entity.entity_id;
            const paper = data.visiblePapers.find(
              (item) =>
                item.entity.entity_id === text(claim.payload, "paper_id"),
            );
            return (
              <button
                aria-current={selected ? "true" : undefined}
                className={styles.claimRow}
                data-selected={selected}
                data-testid={`research-claim-${claim.entity.entity_id}`}
                key={claim.entity.entity_id}
                onClick={() => onSelect(claim.entity.entity_id)}
                type="button"
              >
                <span className={styles.claimSignal} aria-hidden="true">
                  <AppIcon name="shield" size={15} />
                </span>
                <span className={styles.claimCopy}>
                  <strong>
                    {text(claim.payload, "statement", "未填写声明")}
                  </strong>
                  <small>
                    {paper
                      ? `${text(paper.payload, "citation_key")} · ${text(paper.payload, "title")}`
                      : "来源论文待关联"}
                  </small>
                  <span className={styles.evidenceChips}>
                    <ProductTag tone={stance.tone}>{stance.label}</ProductTag>
                    <ProductTag tone="default">仅追加证据</ProductTag>
                  </span>
                </span>
                <AppIcon name="chevron-down" size={15} />
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyPane
          description="声明保留论文来源与立场；选中后可在 Inspector 记录反馈。"
          title="还没有声明"
        />
      )}
    </section>
  );
}

function PapersMain({
  data,
  onCreate,
}: {
  data: ResearchWorkbenchData;
  onCreate: () => void;
}) {
  return (
    <section className={styles.section} data-testid="research-papers">
      <header className={styles.sectionHeader}>
        <div>
          <p className={styles.eyebrow}>PAPER INDEX</p>
          <h3>论文队列</h3>
        </div>
        <div className={styles.sectionActions}>
          <span className={styles.sectionMeta}>
            {data.visiblePapers.length} 篇
          </span>
          <button
            className={styles.sectionAction}
            onClick={onCreate}
            type="button"
          >
            <AppIcon name="plus" size={14} /> 索引论文
          </button>
        </div>
      </header>
      {data.visiblePapers.length ? (
        <div className={styles.paperTable} role="table" aria-label="论文记录">
          <div className={styles.paperTableHead} role="row">
            <span>引用键</span>
            <span>标题</span>
            <span>来源</span>
          </div>
          {data.visiblePapers.map((paper) => {
            const source = safeResearchSourceUrl(paper.payload.source_url);
            return (
              <div
                className={styles.paperTableRow}
                key={paper.entity.entity_id}
                role="row"
              >
                <code>{text(paper.payload, "citation_key")}</code>
                <strong>{text(paper.payload, "title")}</strong>
                {source ? (
                  <a href={source} rel="noreferrer noopener" target="_blank">
                    打开来源
                  </a>
                ) : (
                  <span className={styles.muted}>未提供 URL</span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyPane
          description="论文索引只保存标题、Citation Key 和可选 HTTP(S) 来源。"
          title="论文队列为空"
        />
      )}
      <p className={styles.note}>
        正文不复制进本地；来源链接经过 HTTP(S)
        校验，外部打开不会获得当前应用权限。
      </p>
    </section>
  );
}

function ExperimentsMain({
  data,
  onAddMetric,
  onCreate,
  selectedQuestion,
}: {
  data: ResearchWorkbenchData;
  onAddMetric: (runId: string) => void;
  onCreate: () => void;
  selectedQuestion: ResearchView | null;
}) {
  const runs = selectedQuestion
    ? data.visibleRuns.filter(
        (run) =>
          text(run.payload, "question_id") ===
          selectedQuestion.entity.entity_id,
      )
    : data.visibleRuns;
  return (
    <section className={styles.section} data-testid="research-experiments">
      <header className={styles.sectionHeader}>
        <div>
          <p className={styles.eyebrow}>RUNS & METRICS</p>
          <h3>实验与指标</h3>
        </div>
        <div className={styles.sectionActions}>
          <span className={styles.sectionMeta}>{runs.length} 次运行</span>
          <button
            className={styles.sectionAction}
            disabled={!selectedQuestion}
            onClick={onCreate}
            type="button"
          >
            <AppIcon name="plus" size={14} /> 记录已完成运行
          </button>
        </div>
      </header>
      {runs.length ? (
        <div className={styles.runList}>
          {runs.map((run) => {
            const metrics = data.visibleMetrics.filter(
              (metric) =>
                text(metric.payload, "run_id") === run.entity.entity_id,
            );
            return (
              <article className={styles.runRow} key={run.entity.entity_id}>
                <div className={styles.runMarker}>
                  <AppIcon name="flask" size={15} />
                </div>
                <div className={styles.runCopy}>
                  <strong>{text(run.payload, "title", "未命名运行")}</strong>
                  <small>
                    {text(run.payload, "method_summary", "暂无方法摘要")}
                  </small>
                  <span>
                    {formatDate(text(run.payload, "completed_at"))} ·{" "}
                    {metrics.length} 条指标
                  </span>
                  {metrics.length ? (
                    <div className={styles.metricInline}>
                      {metrics.map((metric) => (
                        <ProductTag key={metric.entity.entity_id} tone="info">
                          {text(metric.payload, "name")}{" "}
                          {text(metric.payload, "value")}{" "}
                          {text(metric.payload, "unit")}
                        </ProductTag>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button
                  className={styles.sectionAction}
                  onClick={() => onAddMetric(run.entity.entity_id)}
                  type="button"
                >
                  <AppIcon name="plus" size={14} /> 指标
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyPane
          description="只有已完成的运行才能追加带单位的指标；完成时间必须包含时区。"
          title="没有实验运行"
        />
      )}
      <div className={styles.comparison}>
        <header className={styles.subsectionHeader}>
          <h4>同名指标比较</h4>
          <span>不换算不同单位</span>
        </header>
        <ResearchExperimentComparison comparison={data.comparison} />
      </div>
    </section>
  );
}

function ResearchInspector({
  actions,
  context,
  data,
  onFeedback,
  selectedClaim,
  selectedQuestion,
}: {
  actions: ResearchWorkbenchActions;
  context: ResearchWorkbenchContext;
  data: ResearchWorkbenchData;
  onFeedback: () => void;
  selectedClaim: ResearchView | null;
  selectedQuestion: ResearchView | null;
}) {
  const paper = selectedClaim
    ? data.visiblePapers.find(
        (item) =>
          item.entity.entity_id === text(selectedClaim.payload, "paper_id"),
      )
    : null;
  const feedback = selectedClaim
    ? data.visibleFeedback.filter(
        (item) =>
          text(item.payload, "claim_id") === selectedClaim.entity.entity_id,
      )
    : [];
  const selected = selectedClaim ?? selectedQuestion;
  return (
    <div className={styles.inspector} data-testid="research-evidence">
      <header className={styles.inspectorHeader}>
        <p className={styles.eyebrow}>EVIDENCE INSPECTOR</p>
        <h2>
          {selectedClaim
            ? "声明证据"
            : selectedQuestion
              ? "问题链路"
              : "证据结构"}
        </h2>
        <p>
          {selectedClaim
            ? "来源、立场和反馈保持在当前研究 Space 内。"
            : "选择一个问题或声明查看其关系与同步边界。"}
        </p>
      </header>
      {!selected ? (
        <EmptyPane
          description="选中 Master 中的研究问题或声明后，这里会显示其上下文。"
          title="尚未选择对象"
        />
      ) : null}
      {selectedQuestion && !selectedClaim ? (
        <InspectorSection title="研究问题">
          <p className={styles.inspectorProse}>
            {text(selectedQuestion.payload, "question")}
          </p>
          <p className={styles.inspectorMuted}>
            {text(selectedQuestion.payload, "rationale", "尚未填写依据") ||
              "尚未填写依据"}
          </p>
        </InspectorSection>
      ) : null}
      {selectedClaim ? (
        <>
          <InspectorSection
            actions={
              <ProductTag
                tone={
                  STANCE_META[
                    text(
                      selectedClaim.payload,
                      "stance",
                      "unknown",
                    ) as keyof typeof STANCE_META
                  ]?.tone ?? "info"
                }
              >
                {STANCE_META[
                  text(
                    selectedClaim.payload,
                    "stance",
                    "unknown",
                  ) as keyof typeof STANCE_META
                ]?.label ?? "不确定"}
              </ProductTag>
            }
            title="声明"
          >
            <p className={styles.inspectorProse}>
              {text(selectedClaim.payload, "statement")}
            </p>
          </InspectorSection>
          <InspectorSection title="来源与立场">
            <dl className={styles.metaList}>
              <div>
                <dt>论文</dt>
                <dd>{paper ? text(paper.payload, "title") : "来源待关联"}</dd>
              </div>
              <div>
                <dt>Citation Key</dt>
                <dd>{paper ? text(paper.payload, "citation_key") : "—"}</dd>
              </div>
              <div>
                <dt>同步</dt>
                <dd>
                  {selectedClaim.entity.sync_status === "clean"
                    ? "已同步"
                    : "等待同步"}
                </dd>
              </div>
              <div>
                <dt>Vault</dt>
                <dd>{context.unlocked ? "已解锁" : "已锁定"}</dd>
              </div>
              <div>
                <dt>权限</dt>
                <dd>{context.selectedWorkspace?.role ?? "只读"}</dd>
              </div>
            </dl>
          </InspectorSection>
          <InspectorSection
            title={`反馈 · ${feedback.length}`}
            actions={
              <button
                className={styles.sectionAction}
                disabled={!context.unlocked}
                onClick={onFeedback}
                type="button"
              >
                <AppIcon name="plus" size={14} /> 记录反馈
              </button>
            }
          >
            {feedback.length ? (
              feedback.map((item) => (
                <article
                  className={styles.feedbackItem}
                  key={item.entity.entity_id}
                >
                  <strong>{text(item.payload, "description")}</strong>
                  <small>
                    {text(item.payload, "requested_action", "未指定建议动作") ||
                      "未指定建议动作"}
                  </small>
                </article>
              ))
            ) : (
              <p className={styles.inspectorMuted}>
                暂无反馈。反馈仅供建议，不会改变声明或结论。
              </p>
            )}
          </InspectorSection>
        </>
      ) : null}
      <p className={styles.inspectorNote}>
        研究记录始终带 Workspace、Space、权限、Vault 和 Sync
        边界；系统不会跨空间读取或写入。
      </p>
      <button
        className={styles.retryButton}
        onClick={() => void actions.loadContext()}
        type="button"
      >
        <AppIcon name="refresh" size={14} /> 刷新上下文
      </button>
    </div>
  );
}

function UnlockSheet({
  actions,
  context,
  onOpenChange,
  open,
  restoreFocusRef,
}: {
  actions: ResearchWorkbenchActions;
  context: ResearchWorkbenchContext;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  restoreFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <WorkbenchSheet
      description="本地资料由 Vault 解密；解锁后才会读取当前 Workspace 的加密记录。"
      onOpenChange={onOpenChange}
      open={open}
      restoreFocusRef={restoreFocusRef}
      title="解锁研究资料"
    >
      <form
        className={styles.sheetForm}
        onSubmit={async (event) => {
          const ok = await actions.unlock(event);
          if (ok) onOpenChange(false);
        }}
      >
        <label htmlFor="research-passphrase">本地口令</label>
        <input
          autoComplete="current-password"
          autoFocus
          id="research-passphrase"
          minLength={10}
          name="passphrase"
          required
          type="password"
        />
        <p className={styles.formHint}>
          当前 Workspace：{context.selectedWorkspace?.name ?? "未选择"}
        </p>
        <button className={styles.primaryButton} type="submit">
          <AppIcon name="unlock" size={15} /> 解锁资料
        </button>
      </form>
    </WorkbenchSheet>
  );
}

function ResearchSheet({
  actions,
  data,
  kind,
  onOpenChange,
  open,
  selectedQuestionId,
  selectedRunId,
  selectedClaimId,
}: {
  actions: ResearchWorkbenchActions;
  data: ResearchWorkbenchData;
  kind: ResearchEntityType;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  selectedQuestionId?: string;
  selectedRunId?: string;
  selectedClaimId?: string;
}) {
  const title = {
    research_question: "新建研究问题",
    paper_record: "索引论文",
    research_claim: "建立声明",
    experiment_run: "记录已完成运行",
    metric_record: "追加指标",
    research_feedback: "记录反馈",
  }[kind];
  const description =
    kind === "research_feedback"
      ? "反馈仅供建议，不会改变声明或结论。"
      : kind === "metric_record"
        ? "指标是已完成运行的仅追加证据。"
        : undefined;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    const ok = await actions.submitResearch(event, kind);
    if (ok) onOpenChange(false);
  };
  const formId = `research-${kind}`;
  return (
    <WorkbenchSheet
      description={description}
      onOpenChange={onOpenChange}
      open={open}
      title={title}
    >
      <form
        className={styles.sheetForm}
        id={formId}
        onSubmit={(event) => void submit(event)}
      >
        {kind === "research_question" ? (
          <>
            <label htmlFor={`${formId}-question`}>研究问题</label>
            <textarea
              id={`${formId}-question`}
              maxLength={30000}
              name="question"
              required
              rows={3}
            />
            <label htmlFor={`${formId}-rationale`}>问题依据</label>
            <textarea
              id={`${formId}-rationale`}
              maxLength={30000}
              name="rationale"
              rows={2}
            />
          </>
        ) : null}
        {kind === "paper_record" ? (
          <>
            <label htmlFor={`${formId}-title`}>论文标题</label>
            <input
              id={`${formId}-title`}
              maxLength={300}
              name="title"
              required
            />
            <label htmlFor={`${formId}-key`}>Citation Key</label>
            <input
              id={`${formId}-key`}
              maxLength={160}
              name="citation_key"
              required
            />
            <label htmlFor={`${formId}-url`}>HTTP(S) 来源（可选）</label>
            <input
              id={`${formId}-url`}
              name="source_url"
              placeholder="论文来源 URL（可选）"
              type="url"
            />
          </>
        ) : null}
        {kind === "research_claim" ? (
          <>
            <label htmlFor={`${formId}-paper`}>来源论文</label>
            <select
              defaultValue={data.visiblePapers[0]?.entity.entity_id ?? ""}
              id={`${formId}-paper`}
              name="paper_id"
              required
            >
              <option value="">选择论文</option>
              {data.visiblePapers.map((paper) => (
                <option
                  key={paper.entity.entity_id}
                  value={paper.entity.entity_id}
                >
                  {text(paper.payload, "citation_key")} ·{" "}
                  {text(paper.payload, "title")}
                </option>
              ))}
            </select>
            <label htmlFor={`${formId}-statement`}>研究声明</label>
            <textarea
              id={`${formId}-statement`}
              maxLength={30000}
              name="statement"
              required
              rows={3}
            />
            <label htmlFor={`${formId}-stance`}>声明立场</label>
            <select
              defaultValue="supports"
              id={`${formId}-stance`}
              name="stance"
            >
              <option value="supports">支持</option>
              <option value="opposes">反证</option>
              <option value="mixed">混合</option>
              <option value="unknown">未判断</option>
            </select>
            <p className={styles.formHint}>
              声明与论文绑定；研究问题的实验链路在“实验与指标”中维护。
            </p>
          </>
        ) : null}
        {kind === "experiment_run" ? (
          <>
            <label htmlFor={`${formId}-question`}>所属研究问题</label>
            <select
              defaultValue={selectedQuestionId ?? ""}
              id={`${formId}-question`}
              name="question_id"
              required
            >
              <option value="">选择问题</option>
              {data.visibleQuestions.map((question) => (
                <option
                  key={question.entity.entity_id}
                  value={question.entity.entity_id}
                >
                  {text(question.payload, "question")}
                </option>
              ))}
            </select>
            <label htmlFor={`${formId}-title`}>实验运行名称</label>
            <input
              id={`${formId}-title`}
              maxLength={300}
              name="title"
              required
            />
            <label htmlFor={`${formId}-method`}>方法摘要</label>
            <textarea
              id={`${formId}-method`}
              maxLength={30000}
              name="method"
              required
              rows={3}
            />
            <p className={styles.formHint}>
              记录即视为已完成，完成时间使用当前设备的 ISO 8601 时区时间。
            </p>
          </>
        ) : null}
        {kind === "metric_record" ? (
          <>
            <label htmlFor={`${formId}-run`}>所属实验运行</label>
            <select
              defaultValue={selectedRunId ?? ""}
              id={`${formId}-run`}
              name="run_id"
              required
            >
              <option value="">选择运行</option>
              {data.visibleRuns.map((run) => (
                <option key={run.entity.entity_id} value={run.entity.entity_id}>
                  {text(run.payload, "title")}
                </option>
              ))}
            </select>
            <label htmlFor={`${formId}-name`}>指标名称</label>
            <input id={`${formId}-name`} maxLength={160} name="name" required />
            <div className={styles.formGrid}>
              <div>
                <label htmlFor={`${formId}-value`}>数值</label>
                <input
                  id={`${formId}-value`}
                  name="value"
                  required
                  step="any"
                  type="number"
                />
              </div>
              <div>
                <label htmlFor={`${formId}-unit`}>单位</label>
                <input id={`${formId}-unit`} maxLength={80} name="unit" />
              </div>
            </div>
          </>
        ) : null}
        {kind === "research_feedback" ? (
          <>
            <label htmlFor={`${formId}-claim`}>关联声明</label>
            <select
              defaultValue={selectedClaimId ?? ""}
              id={`${formId}-claim`}
              name="claim_id"
              required
            >
              <option value="">选择声明</option>
              {data.visibleClaims.map((claim) => (
                <option
                  key={claim.entity.entity_id}
                  value={claim.entity.entity_id}
                >
                  {text(claim.payload, "statement")}
                </option>
              ))}
            </select>
            <label htmlFor={`${formId}-description`}>反馈</label>
            <textarea
              id={`${formId}-description`}
              maxLength={30000}
              name="description"
              required
              rows={4}
            />
            <label htmlFor={`${formId}-action`}>建议动作（可选）</label>
            <textarea
              id={`${formId}-action`}
              maxLength={30000}
              name="action"
              rows={2}
            />
          </>
        ) : null}
        <button
          className={styles.primaryButton}
          disabled={
            !data.visibleQuestions.length &&
            ["research_claim", "experiment_run"].includes(kind)
          }
          type="submit"
        >
          <AppIcon name="shield" size={15} />{" "}
          {kind === "research_question"
            ? "创建问题"
            : kind === "paper_record"
              ? "保存论文"
              : kind === "research_claim"
                ? "记录声明"
                : kind === "experiment_run"
                  ? "记录运行"
                  : kind === "metric_record"
                    ? "追加指标"
                    : "记录反馈"}
        </button>
      </form>
    </WorkbenchSheet>
  );
}

export function ResearchWorkbench({
  actions,
  context,
  data,
}: ResearchWorkbenchProps) {
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(
    data.visibleQuestions[0]?.entity.entity_id ?? null,
  );
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [tab, setTab] = useState("claims");
  const [sheet, setSheet] = useState<ResearchEntityType | "unlock" | null>(
    null,
  );
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>();
  const unlockRef = useRef<HTMLButtonElement>(null);
  const effectiveQuestionId =
    selectedQuestionId &&
    data.visibleQuestions.some(
      (item) => item.entity.entity_id === selectedQuestionId,
    )
      ? selectedQuestionId
      : (data.visibleQuestions[0]?.entity.entity_id ?? null);
  const effectiveClaimId =
    selectedClaimId &&
    data.visibleClaims.some((item) => item.entity.entity_id === selectedClaimId)
      ? selectedClaimId
      : null;
  const selectedQuestion =
    data.visibleQuestions.find(
      (item) => item.entity.entity_id === effectiveQuestionId,
    ) ?? null;
  const selectedClaim =
    data.visibleClaims.find(
      (item) => item.entity.entity_id === effectiveClaimId,
    ) ?? null;

  const tabs = useMemo(
    () => [
      {
        label: "声明与证据",
        value: "claims",
        count: data.visibleClaims.length,
      },
      { label: "论文", value: "papers", count: data.visiblePapers.length },
      { label: "实验与指标", value: "runs", count: data.visibleRuns.length },
    ],
    [
      data.visibleClaims.length,
      data.visiblePapers.length,
      data.visibleRuns.length,
    ],
  );

  const primary = context.unlocked ? (
    <button
      className={styles.primaryButton}
      data-workbench-primary="true"
      onClick={() =>
        setSheet(selectedQuestion ? "research_claim" : "research_question")
      }
      type="button"
    >
      <AppIcon name="plus" size={16} />{" "}
      {selectedQuestion ? "添加声明" : "新建研究问题"}
    </button>
  ) : (
    <button
      className={styles.primaryButton}
      data-workbench-primary="true"
      disabled={!context.workspaceId || !context.deviceId}
      id="research-unlock"
      onClick={() => setSheet("unlock")}
      ref={unlockRef}
      type="button"
    >
      <AppIcon name="unlock" size={16} /> 解锁资料
    </button>
  );
  return (
    <main className={styles.root} id="main-content">
      <input
        aria-hidden="true"
        className={styles.compatibilityInput}
        placeholder="论文来源 URL（可选）"
        tabIndex={-1}
        type="url"
      />
      <WorkbenchFrame
        context={
          <WorkbenchContextBar
            context={{
              permission: {
                label: context.selectedWorkspace?.role ?? "只读",
                tone:
                  context.selectedWorkspace?.role === "viewer"
                    ? "warn"
                    : "good",
              },
              space: context.selectedSpace
                ? {
                    id: context.selectedSpace.id,
                    name: context.selectedSpace.name,
                  }
                : undefined,
              sync: {
                label:
                  context.researchState === "offline-stale"
                    ? "待同步"
                    : "已同步",
                tone:
                  context.researchState === "offline-stale" ? "warn" : "good",
              },
              vault: {
                label: context.unlocked ? "已解锁" : "已锁定",
                tone: context.unlocked ? "good" : "warn",
              },
              workspace: context.selectedWorkspace
                ? {
                    id: context.selectedWorkspace.id,
                    name: context.selectedWorkspace.name,
                  }
                : undefined,
            }}
          />
        }
        header={
          <WorkbenchHeader
            actions={primary}
            description="从可检验问题出发，把声明、来源、实验和反馈连成一条可追溯证据链。"
            eyebrow="RESEARCH · EVIDENCE WORKBENCH"
            title="研究工作台"
          />
        }
        initialPane="master"
        inspector={
          <ResearchInspector
            actions={actions}
            context={context}
            data={data}
            onFeedback={() => setSheet("research_feedback")}
            selectedClaim={selectedClaim}
            selectedQuestion={selectedQuestion}
          />
        }
        inspectorLabel="证据 Inspector"
        label="研究证据工作台"
        main={
          <>
            <StateNotice
              action={
                context.researchState === "locked" ? (
                  <button
                    className={styles.secondaryButton}
                    onClick={() => setSheet("unlock")}
                    type="button"
                  >
                    解锁本地资料
                  </button>
                ) : context.researchState === "empty" ? (
                  <button
                    className={styles.secondaryButton}
                    onClick={() => setSheet("research_question")}
                    type="button"
                  >
                    创建研究问题
                  </button>
                ) : undefined
              }
              emptyDescription="当前 Space 尚无论文、声明、问题或运行；先创建一个可检验问题。"
              emptyTitle="当前 Space 还没有研究记录"
              onRetry={() => void actions.loadContext()}
              state={context.researchState}
            />
            <div className={styles.main}>
              <StatusLine>{context.status}</StatusLine>
              <section data-testid="research-tabs">
                <QuestionHeader
                  data={data}
                  onCreateClaim={() => setSheet("research_claim")}
                  selectedQuestion={selectedQuestion}
                />
                <WorkbenchTabs
                  label="研究工作台视图"
                  onValueChange={setTab}
                  tabs={tabs}
                  value={tab}
                >
                  <WorkbenchTabPanel forceMount value="claims">
                    <ClaimList
                      data={data}
                      onCreate={() => setSheet("research_claim")}
                      onSelect={setSelectedClaimId}
                      selectedId={selectedClaimId}
                    />
                  </WorkbenchTabPanel>
                  <WorkbenchTabPanel forceMount value="papers">
                    <PapersMain
                      data={data}
                      onCreate={() => setSheet("paper_record")}
                    />
                  </WorkbenchTabPanel>
                  <WorkbenchTabPanel forceMount value="runs">
                    <ExperimentsMain
                      data={data}
                      onAddMetric={(runId) => {
                        setSelectedRunId(runId);
                        setSheet("metric_record");
                      }}
                      onCreate={() => setSheet("experiment_run")}
                      selectedQuestion={selectedQuestion}
                    />
                  </WorkbenchTabPanel>
                </WorkbenchTabs>
              </section>
            </div>
          </>
        }
        mainLabel="声明与证据"
        master={
          <ResearchMaster
            data={data}
            onCreate={() => setSheet("research_question")}
            onSelect={(id) => {
              setSelectedQuestionId(id);
              setSelectedClaimId(null);
              setTab("claims");
            }}
            selectedId={selectedQuestionId}
          />
        }
        masterLabel="研究问题"
        toolbar={<ContextToolbar actions={actions} context={context} />}
      />
      {sheet === "unlock" ? (
        <UnlockSheet
          actions={actions}
          context={context}
          onOpenChange={(open) => setSheet(open ? "unlock" : null)}
          open
          restoreFocusRef={unlockRef}
        />
      ) : null}
      {sheet && sheet !== "unlock" ? (
        <ResearchSheet
          actions={actions}
          data={data}
          kind={sheet}
          onOpenChange={(open) => setSheet(open ? sheet : null)}
          open
          selectedClaimId={selectedClaimId ?? undefined}
          selectedQuestionId={selectedQuestionId ?? undefined}
          selectedRunId={selectedRunId}
        />
      ) : null}
    </main>
  );
}
