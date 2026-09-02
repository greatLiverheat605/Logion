"use client";

import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { AppIcon } from "@/components/app-shell/app-icon";
import {
  InspectorSection,
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
  WorkbenchTooltip,
} from "@/components/product/headless-ui";
import {
  ProductOperationalStateNotice,
  ProductWorkbenchStateNotice,
  type ProductOperationalState,
  type ProductWorkbenchState,
} from "@/components/product/product-workbench-state";
import { ProductEmptyState, ProductTag } from "@/components/product/product-ui";

import { KnowledgeGraphView } from "./knowledge-graph-view";
import type {
  AuditReviewPayload,
  DependencyPayload,
  ErrorPatternPayload,
  LocalView,
  MasteryLevel,
  MasteryPayload,
  QuizAttemptPayload,
  QuizItemPayload,
  ReviewFindingPayload,
  SchedulePayload,
  Space,
  TopicPayload,
  Workspace,
} from "./review-center";
import type { KnowledgeGraphNode } from "./review-workbench-model";

import styles from "./review-workbench.module.css";

const MASTERY_OPTIONS: readonly { label: string; value: MasteryLevel }[] = [
  { label: "尚未接触", value: "unknown" },
  { label: "已经接触", value: "exposed" },
  { label: "正在练习", value: "practicing" },
  { label: "基本熟悉", value: "familiar" },
  { label: "能够熟练应用", value: "proficient" },
  { label: "已经掌握", value: "mastered" },
];

const MASTERY_LABEL: Readonly<Record<MasteryLevel, string>> =
  Object.fromEntries(
    MASTERY_OPTIONS.map((option) => [option.value, option.label]),
  ) as Record<MasteryLevel, string>;

const CAUSE_OPTIONS = [
  ["concept_confusion", "概念混淆"],
  ["recall_gap", "记忆缺口"],
  ["application_gap", "应用不足"],
  ["misread", "审题偏差"],
  ["careless", "疏忽"],
  ["unknown", "暂不确定"],
] as const;

const FINDING_CATEGORY_LABEL: Readonly<Record<string, string>> = {
  progress: "进展",
  blocker: "阻塞",
  adjustment: "调整",
  error_pattern: "错因",
};

type ReviewTopic = LocalView<TopicPayload>;
type ReviewQuiz = LocalView<QuizItemPayload>;
type ReviewSchedule = LocalView<SchedulePayload>;
type ReviewAttempt = LocalView<QuizAttemptPayload>;
type ReviewPattern = LocalView<ErrorPatternPayload>;
type ReviewAudit = LocalView<AuditReviewPayload>;
type ReviewFinding = LocalView<ReviewFindingPayload>;

type FormAction = (
  event: FormEvent<HTMLFormElement>,
) => void | Promise<boolean | void>;

export interface ReviewWorkbenchProps {
  context: {
    canEditGraph: boolean;
    conflicts: number;
    contextPhase: "error" | "loading" | "ready";
    dataPhase: "error" | "idle" | "loading" | "ready";
    deviceId: string;
    reviewState: ProductWorkbenchState;
    selectedSpace?: Space;
    selectedWorkspace?: Workspace;
    spaceId: string;
    spaces: Space[];
    status: string;
    unlocked: boolean;
    workspaceId: string;
    workspaces: Workspace[];
  };
  data: {
    confirmedMastery: number;
    dependencies: LocalView<DependencyPayload>[];
    dueReviews: number;
    errorPatterns: ReviewPattern[];
    futureReviewLoad: { label: string; value: number }[];
    knowledgeGraph: KnowledgeGraphNode[];
    mastery: LocalView<MasteryPayload>[];
    masteryByTopicId: ReadonlyMap<string, string>;
    masteryRate: number;
    openPatterns: number;
    quizAttempts: ReviewAttempt[];
    quizItems: ReviewQuiz[];
    reviewFindings: ReviewFinding[];
    reviews: ReviewAudit[];
    schedules: ReviewSchedule[];
    topics: ReviewTopic[];
  };
  actions: {
    addReviewFinding: (
      event: FormEvent<HTMLFormElement>,
      review: ReviewAudit,
    ) => void | Promise<void>;
    completeAuditReview: (review: ReviewAudit) => void | Promise<void>;
    confirmMastery: (
      event: FormEvent<HTMLFormElement>,
      topic: ReviewTopic,
    ) => void | Promise<void>;
    createAuditReview: FormAction;
    createDependency: FormAction;
    createQuizItem: FormAction;
    createTopic: FormAction;
    loadContext: () => void | Promise<void>;
    resolveErrorPattern: (pattern: ReviewPattern) => void | Promise<void>;
    resolveFinding: (finding: ReviewFinding) => void | Promise<void>;
    submitQuizAttempt: (
      event: FormEvent<HTMLFormElement>,
      quiz: ReviewQuiz,
    ) => void | Promise<boolean | void>;
    synchronize: () => void | Promise<void>;
    unlock: FormAction;
    setSpaceId: (value: string) => void;
    setWorkspaceId: (value: string) => void;
  };
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "未安排";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatStatus(value: string): string {
  const labels: Record<string, string> = {
    clean: "已同步",
    pending: "待同步",
    conflict: "冲突",
    blocked: "已阻塞",
    due: "到期",
    in_progress: "进行中",
    scheduled: "已安排",
    completed: "已完成",
    skipped: "已跳过",
    open: "开放",
    resolved: "已解决",
    draft: "草稿",
  };
  return labels[value] ?? value;
}

function isDue(schedule: ReviewSchedule): boolean {
  return (
    schedule.payload.status === "due" ||
    new Date(schedule.payload.next_review_at).getTime() <= Date.now()
  );
}

function MetaList({ children }: Readonly<{ children: ReactNode }>) {
  return <dl className={styles.metaList}>{children}</dl>;
}

function EmptyPane({
  description,
  icon = "archive",
  title,
}: Readonly<{
  description: string;
  icon?: "archive" | "lock" | "refresh";
  title: string;
}>) {
  return (
    <section className={styles.emptyPane}>
      <span aria-hidden="true">
        <AppIcon name={icon} size={20} />
      </span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </section>
  );
}

function StatusLine({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <p aria-live="polite" className={styles.statusLine} role="status">
      <span aria-hidden="true" />
      {children}
    </p>
  );
}

function ReviewMaster({
  data,
  onNewTopic,
  onSelect,
  selectedId,
}: Readonly<{
  data: ReviewWorkbenchProps["data"];
  onNewTopic: () => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
}>) {
  const dueTopicIds = new Set(
    data.schedules.filter(isDue).map((schedule) => schedule.payload.topic_id),
  );

  function moveSelection(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (
      !selectedId ||
      !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
    ) {
      return;
    }
    event.preventDefault();
    const rows = Array.from(
      event.currentTarget
        .closest('[data-testid="review-due-queue"]')
        ?.querySelectorAll<HTMLButtonElement>("[data-review-topic]") ?? [],
    );
    const current = rows.findIndex(
      (row) => row.dataset.reviewTopic === selectedId,
    );
    if (current < 0 || rows.length === 0) return;
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? rows.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + rows.length) %
            rows.length;
    rows[index]?.focus();
    const next = rows[index]?.dataset.reviewTopic;
    if (next) onSelect(next);
  }

  return (
    <div className={styles.master} data-testid="review-due-queue">
      <div className={styles.masterHeader}>
        <div>
          <p className={styles.eyebrow}>ACTIVE RECALL</p>
          <h2>到期队列</h2>
        </div>
        <ProductTag tone={data.dueReviews > 0 ? "warn" : "good"}>
          {data.dueReviews}
        </ProductTag>
      </div>
      <button
        className={styles.secondaryButton}
        onClick={onNewTopic}
        type="button"
      >
        <AppIcon name="plus" size={15} />
        新建知识点
      </button>
      <div className={styles.queueSummary}>
        <AppIcon name="timer" size={15} />
        <span>
          {data.dueReviews
            ? `${data.dueReviews} 项需要今天处理`
            : "今天没有逾期项目"}
        </span>
      </div>
      <div
        aria-label="知识点与到期状态"
        className={styles.topicList}
        role="list"
      >
        {data.topics.map((topic) => {
          const id = topic.entity.entity_id;
          const mastery = data.mastery.find(
            (item) => item.payload.topic_id === id,
          )?.payload.confirmed_level;
          const due = dueTopicIds.has(id);
          return (
            <div className={styles.topicListItem} key={id} role="listitem">
              <button
                aria-current={selectedId === id ? "true" : undefined}
                className={styles.topicRow}
                data-review-topic={id}
                data-selected={selectedId === id}
                onClick={() => onSelect(id)}
                onKeyDown={moveSelection}
                type="button"
              >
                <span className={styles.topicIcon} aria-hidden="true">
                  <AppIcon name={due ? "timer" : "book-open"} size={15} />
                </span>
                <span className={styles.topicCopy}>
                  <strong>{topic.payload.title}</strong>
                  <small>
                    {due
                      ? "到期复习"
                      : mastery
                        ? MASTERY_LABEL[mastery]
                        : "尚未确认"}
                  </small>
                </span>
                {due ? (
                  <span className={styles.dueDot} aria-label="到期" />
                ) : null}
              </button>
            </div>
          );
        })}
        {data.topics.length === 0 ? (
          <div className={styles.listEmpty} role="listitem">
            暂无知识点，先建立一个节点。
          </div>
        ) : null}
      </div>
      <div className={styles.masterFooter}>
        <span>先修关系</span>
        <strong>{data.dependencies.length}</strong>
      </div>
      <div className={styles.dependencyList}>
        {data.knowledgeGraph
          .filter((node) => node.prerequisites.length > 0)
          .slice(0, 5)
          .map((node) => (
            <p key={node.id}>
              <AppIcon name="layout-template" size={13} />
              {node.prerequisites.join("、")} → {node.title}
            </p>
          ))}
      </div>
    </div>
  );
}

function QueuePanel({
  data,
  onQuiz,
  onTab,
  selectedTopic,
}: Readonly<{
  data: ReviewWorkbenchProps["data"];
  onQuiz: (quiz: ReviewQuiz) => void;
  onTab: (value: string) => void;
  selectedTopic: ReviewTopic | null;
}>) {
  const quizzes = selectedTopic
    ? data.quizItems.filter(
        (quiz) => quiz.payload.topic_id === selectedTopic.entity.entity_id,
      )
    : [];
  const schedules = selectedTopic
    ? data.schedules.filter(
        (schedule) =>
          schedule.payload.topic_id === selectedTopic.entity.entity_id,
      )
    : [];

  return (
    <div className={styles.panelStack}>
      <section className={styles.queueHero}>
        <div>
          <p className={styles.eyebrow}>DUE NOW</p>
          <h2>{selectedTopic?.payload.title ?? "选择一个知识点"}</h2>
          <p>
            {selectedTopic?.payload.description ||
              "从左侧到期队列选择对象，开始一次主动回忆。"}
          </p>
        </div>
        <div className={styles.heroMetric}>
          <strong>{data.dueReviews}</strong>
          <span>到期</span>
        </div>
      </section>
      <section className={styles.section}>
        <header className={styles.sectionHeader}>
          <div>
            <h2>主动回忆</h2>
            <p>先回答，再披露判定、参考答案和解析。</p>
          </div>
          <ProductTag tone="info">{quizzes.length} 道题</ProductTag>
        </header>
        <div className={styles.quizList}>
          {quizzes.map((quiz) => {
            const latest = data.quizAttempts.find(
              (attempt) =>
                attempt.payload.quiz_item_id === quiz.entity.entity_id,
            );
            return (
              <article className={styles.quizRow} key={quiz.entity.entity_id}>
                <span className={styles.quizIcon} aria-hidden="true">
                  <AppIcon name="flask" size={16} />
                </span>
                <div className={styles.quizCopy}>
                  <strong>{quiz.payload.prompt}</strong>
                  <small>
                    {quiz.payload.evaluation_mode === "exact_match"
                      ? "服务端精确匹配"
                      : "本人明确判断"}
                    {latest
                      ? ` · 最近${formatStatus(String(latest.payload.is_correct))}`
                      : " · 尚未作答"}
                  </small>
                </div>
                <button
                  className={styles.primaryButton}
                  onClick={() => onQuiz(quiz)}
                  type="button"
                >
                  开始回忆
                </button>
              </article>
            );
          })}
          {quizzes.length === 0 ? (
            <EmptyPane
              description="在知识图谱或新建知识点后，为高频遗忘内容添加一道题。"
              title={
                selectedTopic ? "这个知识点还没有回忆题" : "从到期队列开始"
              }
            />
          ) : null}
        </div>
      </section>
      <section className={styles.loadSection}>
        <header className={styles.sectionHeader}>
          <div>
            <h2>接下来 7 天</h2>
            <p>按真实 next_review_at 汇总，不生成预测值。</p>
          </div>
          <button
            className={styles.textButton}
            onClick={() => onTab("knowledge")}
            type="button"
          >
            查看掌握
          </button>
        </header>
        <div className={styles.loadBars} aria-label="未来七天复习数量">
          {data.futureReviewLoad.map((item) => (
            <div className={styles.loadBar} key={item.label}>
              <span style={{ height: `${Math.max(8, item.value * 14)}px` }} />
              <strong>{item.value}</strong>
              <small>{item.label}</small>
            </div>
          ))}
        </div>
        {schedules.length === 0 ? (
          <p className={styles.muted}>选中对象还没有复习安排。</p>
        ) : null}
      </section>
    </div>
  );
}

function KnowledgePanel({
  actions,
  data,
  onNewDependency,
  onNewQuiz,
  onSelect,
}: Readonly<{
  actions: ReviewWorkbenchProps["actions"];
  data: ReviewWorkbenchProps["data"];
  onNewDependency: () => void;
  onNewQuiz: () => void;
  onSelect: (id: string) => void;
}>) {
  const [view, setView] = useState<"graph" | "list">("graph");
  return (
    <div className={styles.panelStack} id="knowledge-graph">
      <section className={styles.section}>
        <header className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>KNOWLEDGE SYSTEM</p>
            <h2>掌握与先修关系</h2>
            <p>系统建议只提供线索；掌握度由你明确确认。</p>
          </div>
          <div aria-label="知识视图" className={styles.segmented} role="group">
            <button
              aria-pressed={view === "graph"}
              onClick={() => setView("graph")}
              type="button"
            >
              图谱
            </button>
            <button
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
              type="button"
            >
              列表与掌握确认
            </button>
          </div>
        </header>
        {view === "graph" ? (
          <KnowledgeGraphView
            masteryByTopicId={data.masteryByTopicId}
            nodes={data.knowledgeGraph}
          />
        ) : (
          <div className={styles.masteryList}>
            {data.topics.map((topic) => {
              const current = data.mastery.find(
                (item) => item.payload.topic_id === topic.entity.entity_id,
              );
              return (
                <article
                  className={styles.masteryRow}
                  key={topic.entity.entity_id}
                >
                  <button
                    className={styles.masteryTopic}
                    onClick={() => onSelect(topic.entity.entity_id)}
                    type="button"
                  >
                    <strong>{topic.payload.title}</strong>
                    <small>{topic.payload.description || "暂无说明"}</small>
                  </button>
                  <form
                    className={styles.masteryForm}
                    onSubmit={(event) =>
                      void actions.confirmMastery(event, topic)
                    }
                  >
                    <select
                      aria-label={`${topic.payload.title} 的掌握确认`}
                      defaultValue={
                        current?.payload.confirmed_level ?? "unknown"
                      }
                      key={current?.payload.confirmed_level ?? "unknown"}
                      name="confirmed_level"
                    >
                      {MASTERY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button
                      className={styles.secondaryButton}
                      disabled={!data.topics.length}
                      type="submit"
                    >
                      确认
                    </button>
                  </form>
                </article>
              );
            })}
            {data.topics.length === 0 ? (
              <ProductEmptyState
                title="先建立知识图谱"
                description="从一个核心知识点开始，再补充先修关系。"
              />
            ) : null}
          </div>
        )}
      </section>
      <section className={styles.actionRail}>
        <button
          className={styles.secondaryButton}
          onClick={onNewQuiz}
          type="button"
        >
          <AppIcon name="plus" size={15} /> 新建主动回忆题
        </button>
        <button
          className={styles.textButton}
          onClick={onNewDependency}
          type="button"
        >
          <AppIcon name="layout-template" size={14} /> 添加先修依赖
        </button>
      </section>
    </div>
  );
}

function ErrorsPanel({
  actions,
  data,
}: Readonly<{
  actions: ReviewWorkbenchProps["actions"];
  data: ReviewWorkbenchProps["data"];
}>) {
  return (
    <div className={styles.panelStack}>
      <section className={styles.section} data-testid="review-misconceptions">
        <header className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>MISCONCEPTIONS</p>
            <h2>错因模式</h2>
            <p>重复错答会汇总为模式，关闭前需要明确确认。</p>
          </div>
          <ProductTag tone={data.openPatterns > 0 ? "warn" : "good"}>
            {data.openPatterns} 项开放
          </ProductTag>
        </header>
        <div className={styles.patternList}>
          {data.errorPatterns.map((pattern) => (
            <article
              className={styles.patternRow}
              key={pattern.entity.entity_id}
            >
              <div>
                <strong>{pattern.payload.cause}</strong>
                <small>
                  {pattern.payload.occurrence_count} 次 ·{" "}
                  {formatStatus(pattern.payload.status)}
                </small>
              </div>
              {pattern.payload.status === "open" ? (
                <button
                  className={styles.secondaryButton}
                  disabled={pattern.entity.server_version === 0}
                  onClick={() => void actions.resolveErrorPattern(pattern)}
                  type="button"
                >
                  标记解决
                </button>
              ) : (
                <ProductTag tone="good">已解决</ProductTag>
              )}
            </article>
          ))}
          {data.errorPatterns.length === 0 ? (
            <ProductEmptyState
              title="尚无错因模式"
              description="完成主动回忆后，错答会自动汇总到这里。"
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}

function ReviewsPanel({
  actions,
  data,
  onNewReview,
}: Readonly<{
  actions: ReviewWorkbenchProps["actions"];
  data: ReviewWorkbenchProps["data"];
  onNewReview: () => void;
}>) {
  return (
    <div className={styles.panelStack}>
      <section className={styles.section} data-testid="review-cycle">
        <header className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>CYCLE REVIEW</p>
            <h2>周期审查</h2>
            <p>把进展、阻塞、调整和错因沉淀成下一步。</p>
          </div>
          <button
            className={styles.secondaryButton}
            onClick={onNewReview}
            type="button"
          >
            <AppIcon name="plus" size={15} /> 创建审查
          </button>
        </header>
        <div className={styles.reviewList}>
          {data.reviews.map((review) => {
            const findings = data.reviewFindings.filter(
              (finding) =>
                finding.payload.audit_review_id === review.entity.entity_id,
            );
            return (
              <article
                className={styles.reviewRow}
                key={review.entity.entity_id}
              >
                <header>
                  <div>
                    <strong>
                      {review.payload.cadence === "daily" ? "每日" : "每周"}审查
                      · {review.payload.period_start} -{" "}
                      {review.payload.period_end}
                    </strong>
                    <small>{review.payload.summary || "暂无总结"}</small>
                  </div>
                  <ProductTag
                    tone={
                      review.payload.status === "completed" ? "good" : "warn"
                    }
                  >
                    {formatStatus(review.payload.status)}
                  </ProductTag>
                </header>
                <div className={styles.findingList}>
                  {findings.map((finding) => (
                    <div
                      className={styles.findingRow}
                      key={finding.entity.entity_id}
                    >
                      <ProductTag
                        tone={
                          finding.payload.category === "blocker"
                            ? "bad"
                            : finding.payload.category === "progress"
                              ? "good"
                              : "info"
                        }
                      >
                        {FINDING_CATEGORY_LABEL[finding.payload.category] ??
                          finding.payload.category}
                      </ProductTag>
                      <span>{finding.payload.description}</span>
                      {finding.payload.status === "open" ? (
                        <button
                          className={styles.textButton}
                          onClick={() => void actions.resolveFinding(finding)}
                          type="button"
                        >
                          解决
                        </button>
                      ) : (
                        <small>已解决</small>
                      )}
                    </div>
                  ))}
                </div>
                {review.payload.status === "draft" ? (
                  <form
                    className={styles.findingForm}
                    onSubmit={(event) =>
                      void actions.addReviewFinding(event, review)
                    }
                  >
                    <select
                      aria-label="发现类型"
                      defaultValue="progress"
                      name="category"
                    >
                      <option value="progress">进展</option>
                      <option value="blocker">阻塞</option>
                      <option value="adjustment">调整</option>
                      <option value="error_pattern">错因</option>
                    </select>
                    <input
                      aria-label="发现"
                      maxLength={10000}
                      name="description"
                      placeholder="记录一个发现"
                      required
                    />
                    <input
                      aria-label="下一步"
                      maxLength={20000}
                      name="suggested_action"
                      placeholder="下一步动作（可选）"
                    />
                    <button
                      className={styles.secondaryButton}
                      disabled={!data.topics.length && !data.reviews.length}
                      type="submit"
                    >
                      添加发现
                    </button>
                    <button
                      className={styles.textButton}
                      onClick={() => void actions.completeAuditReview(review)}
                      type="button"
                    >
                      明确完成
                    </button>
                  </form>
                ) : null}
              </article>
            );
          })}
          {data.reviews.length === 0 ? (
            <ProductEmptyState
              title="还没有周期审查"
              description="创建每日或每周审查，记录本周期最重要的进展与阻塞。"
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}

function ReviewInspector({
  data,
  onQuiz,
  selectedTopic,
}: Readonly<{
  data: ReviewWorkbenchProps["data"];
  onQuiz: (quiz: ReviewQuiz) => void;
  selectedTopic: ReviewTopic | null;
}>) {
  if (!selectedTopic) {
    return (
      <div className={styles.inspector} data-testid="review-inspector">
        <EmptyPane
          description="选择一个知识点后，这里显示掌握、错因与同步上下文。"
          title="知识 Inspector"
        />
      </div>
    );
  }
  const topicId = selectedTopic.entity.entity_id;
  const mastery = data.mastery.find(
    (item) => item.payload.topic_id === topicId,
  );
  const schedule = data.schedules.find(
    (item) => item.payload.topic_id === topicId,
  );
  const quizzes = data.quizItems.filter(
    (item) => item.payload.topic_id === topicId,
  );
  const attempts = data.quizAttempts.filter(
    (item) => item.payload.topic_id === topicId,
  );
  const patterns = data.errorPatterns.filter(
    (item) => item.payload.topic_id === topicId,
  );
  const firstQuiz = quizzes[0];
  return (
    <div className={styles.inspector} data-testid="review-inspector">
      <header className={styles.inspectorHeader}>
        <p className={styles.eyebrow}>KNOWLEDGE INSPECTOR</p>
        <h2>{selectedTopic.payload.title}</h2>
        <p>{selectedTopic.payload.description || "暂无说明"}</p>
      </header>
      <InspectorSection title="掌握状态">
        <MetaList>
          <div>
            <dt>我的确认</dt>
            <dd>
              {mastery?.payload.confirmed_level
                ? MASTERY_LABEL[mastery.payload.confirmed_level]
                : "尚未确认"}
            </dd>
          </div>
          <div>
            <dt>系统建议</dt>
            <dd>
              {mastery?.payload.suggested_level
                ? MASTERY_LABEL[mastery.payload.suggested_level]
                : "暂无建议"}
            </dd>
          </div>
          <div>
            <dt>下次复习</dt>
            <dd>{formatDate(schedule?.payload.next_review_at)}</dd>
          </div>
          <div>
            <dt>同步</dt>
            <dd>{formatStatus(selectedTopic.entity.sync_status)}</dd>
          </div>
        </MetaList>
      </InspectorSection>
      <InspectorSection title="关系与记录">
        <MetaList>
          <div>
            <dt>先修</dt>
            <dd>
              {data.knowledgeGraph
                .find((node) => node.id === topicId)
                ?.prerequisites.join("、") || "无"}
            </dd>
          </div>
          <div>
            <dt>回忆题</dt>
            <dd>
              {quizzes.length} 道 · {attempts.length} 次作答
            </dd>
          </div>
          <div>
            <dt>错因</dt>
            <dd>
              {patterns.length
                ? `${patterns.length} 个相关模式`
                : "暂无相关模式"}
            </dd>
          </div>
        </MetaList>
      </InspectorSection>
      <InspectorSection title="继续">
        {firstQuiz ? (
          <button
            className={styles.primaryButton}
            onClick={() => onQuiz(firstQuiz)}
            type="button"
          >
            <AppIcon name="target" size={15} /> 开始主动回忆
          </button>
        ) : (
          <p className={styles.muted}>先在掌握页添加一道回忆题。</p>
        )}
      </InspectorSection>
    </div>
  );
}

function UnlockSheet({
  actions,
  onOpenChange,
  open,
  restoreFocusRef,
}: Readonly<{
  actions: ReviewWorkbenchProps["actions"];
  onOpenChange: (open: boolean) => void;
  open: boolean;
  restoreFocusRef: React.RefObject<HTMLElement | null>;
}>) {
  const formId = useId();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const succeeded = await actions.unlock(event);
    if (succeeded === true) onOpenChange(false);
  }
  return (
    <WorkbenchSheet
      description="口令只用于当前设备的本地加密资料，不会发送到服务器。"
      footer={
        <>
          <button
            className={styles.secondaryButton}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            取消
          </button>
          <button className={styles.primaryButton} form={formId} type="submit">
            解锁资料
          </button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      restoreFocusRef={restoreFocusRef}
      title="解锁本地复习资料"
    >
      <form className={styles.sheetForm} id={formId} onSubmit={submit}>
        <label htmlFor={`${formId}-passphrase`}>本地口令</label>
        <input
          autoComplete="current-password"
          autoFocus
          id={`${formId}-passphrase`}
          minLength={10}
          name="passphrase"
          required
          type="password"
        />
      </form>
    </WorkbenchSheet>
  );
}

function NewTopicSheet({
  actions,
  onOpenChange,
  open,
}: Readonly<{
  actions: ReviewWorkbenchProps["actions"];
  onOpenChange: (open: boolean) => void;
  open: boolean;
}>) {
  const formId = useId();
  return (
    <WorkbenchSheet
      description="知识点保存到当前 Space 的端侧加密资料。"
      footer={
        <>
          <button
            className={styles.secondaryButton}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            取消
          </button>
          <button className={styles.primaryButton} form={formId} type="submit">
            保存知识点
          </button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      title="新建知识点"
    >
      <form
        className={styles.sheetForm}
        id={formId}
        onSubmit={async (event) => {
          const succeeded = await actions.createTopic(event);
          if (succeeded === true) onOpenChange(false);
        }}
      >
        <label htmlFor={`${formId}-title`}>名称</label>
        <input
          autoFocus
          id={`${formId}-title`}
          maxLength={160}
          name="title"
          required
        />
        <label htmlFor={`${formId}-description`}>说明</label>
        <textarea
          id={`${formId}-description`}
          maxLength={10000}
          name="description"
          rows={4}
        />
      </form>
    </WorkbenchSheet>
  );
}

function NewQuizSheet({
  actions,
  onOpenChange,
  open,
  topics,
  topicId,
}: Readonly<{
  actions: ReviewWorkbenchProps["actions"];
  onOpenChange: (open: boolean) => void;
  open: boolean;
  topics: ReviewTopic[];
  topicId: string | undefined;
}>) {
  const formId = useId();
  return (
    <WorkbenchSheet
      description="答案仅在作答提交后向本人披露，不会出现在列表响应中。"
      footer={
        <>
          <button
            className={styles.secondaryButton}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            取消
          </button>
          <button
            className={styles.primaryButton}
            disabled={!topics.length}
            form={formId}
            type="submit"
          >
            加密保存题目
          </button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      title="新建主动回忆题"
    >
      <form
        className={styles.sheetForm}
        id={formId}
        onSubmit={async (event) => {
          const succeeded = await actions.createQuizItem(event);
          if (succeeded === true) onOpenChange(false);
        }}
      >
        <label htmlFor={`${formId}-topic`}>关联知识点</label>
        <select
          defaultValue={topicId ?? topics[0]?.entity.entity_id ?? ""}
          id={`${formId}-topic`}
          name="topic_id"
          required
        >
          {topics.map((topic) => (
            <option key={topic.entity.entity_id} value={topic.entity.entity_id}>
              {topic.payload.title}
            </option>
          ))}
        </select>
        <label htmlFor={`${formId}-prompt`}>题目</label>
        <textarea
          autoFocus
          id={`${formId}-prompt`}
          maxLength={10000}
          name="prompt"
          required
          rows={3}
        />
        <label htmlFor={`${formId}-answer`}>参考答案</label>
        <textarea
          id={`${formId}-answer`}
          maxLength={10000}
          name="answer_key"
          required
          rows={2}
        />
        <label htmlFor={`${formId}-explanation`}>解析（可选）</label>
        <textarea
          id={`${formId}-explanation`}
          maxLength={20000}
          name="explanation"
          rows={2}
        />
        <label htmlFor={`${formId}-mode`}>判定方式</label>
        <select
          defaultValue="exact_match"
          id={`${formId}-mode`}
          name="evaluation_mode"
        >
          <option value="exact_match">服务端精确匹配</option>
          <option value="self_assessed">本人明确判断</option>
        </select>
      </form>
    </WorkbenchSheet>
  );
}

function DependencySheet({
  actions,
  onOpenChange,
  open,
  topics,
}: Readonly<{
  actions: ReviewWorkbenchProps["actions"];
  onOpenChange: (open: boolean) => void;
  open: boolean;
  topics: ReviewTopic[];
}>) {
  const formId = useId();
  return (
    <WorkbenchSheet
      description="先修关系用于复习排序与学习路径建议。"
      footer={
        <>
          <button
            className={styles.secondaryButton}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            取消
          </button>
          <button
            className={styles.primaryButton}
            disabled={topics.length < 2}
            form={formId}
            type="submit"
          >
            保存依赖
          </button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      title="添加先修依赖"
    >
      <form
        className={styles.sheetForm}
        id={formId}
        onSubmit={async (event) => {
          const succeeded = await actions.createDependency(event);
          if (succeeded === true) onOpenChange(false);
        }}
      >
        <label htmlFor={`${formId}-pre`}>先学知识点</label>
        <select id={`${formId}-pre`} name="prerequisite_topic_id" required>
          <option value="">请选择</option>
          {topics.map((topic) => (
            <option key={topic.entity.entity_id} value={topic.entity.entity_id}>
              {topic.payload.title}
            </option>
          ))}
        </select>
        <label htmlFor={`${formId}-dep`}>后学知识点</label>
        <select id={`${formId}-dep`} name="dependent_topic_id" required>
          <option value="">请选择</option>
          {topics.map((topic) => (
            <option key={topic.entity.entity_id} value={topic.entity.entity_id}>
              {topic.payload.title}
            </option>
          ))}
        </select>
      </form>
    </WorkbenchSheet>
  );
}

function AuditReviewSheet({
  actions,
  onOpenChange,
  open,
}: Readonly<{
  actions: ReviewWorkbenchProps["actions"];
  onOpenChange: (open: boolean) => void;
  open: boolean;
}>) {
  const formId = useId();
  return (
    <WorkbenchSheet
      description="创建草稿后，再添加发现并明确完成审查。"
      footer={
        <>
          <button
            className={styles.secondaryButton}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            取消
          </button>
          <button className={styles.primaryButton} form={formId} type="submit">
            保存审查草稿
          </button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      title="创建周期审查"
    >
      <form
        className={styles.sheetForm}
        id={formId}
        onSubmit={async (event) => {
          const succeeded = await actions.createAuditReview(event);
          if (succeeded === true) onOpenChange(false);
        }}
      >
        <label htmlFor={`${formId}-cadence`}>周期</label>
        <select defaultValue="weekly" id={`${formId}-cadence`} name="cadence">
          <option value="daily">每日</option>
          <option value="weekly">每周</option>
        </select>
        <label htmlFor={`${formId}-start`}>开始日期</label>
        <input
          id={`${formId}-start`}
          name="period_start"
          required
          type="date"
        />
        <label htmlFor={`${formId}-end`}>结束日期</label>
        <input id={`${formId}-end`} name="period_end" required type="date" />
        <label htmlFor={`${formId}-summary`}>总结草稿</label>
        <textarea
          id={`${formId}-summary`}
          maxLength={20000}
          name="summary"
          rows={4}
        />
      </form>
    </WorkbenchSheet>
  );
}

function AnswerSheet({
  actions,
  onOpenChange,
  open,
  quiz,
}: Readonly<{
  actions: ReviewWorkbenchProps["actions"];
  onOpenChange: (open: boolean) => void;
  open: boolean;
  quiz: ReviewQuiz | null;
}>) {
  const formId = useId();
  const [phase, setPhase] = useState<"answer" | "review">("answer");
  if (!quiz) return null;
  return (
    <WorkbenchSheet
      description={
        phase === "answer"
          ? "提交前不会展示参考答案或解析。"
          : "确认你的判断后，再保存加密答题记录。"
      }
      footer={
        phase === "answer" ? (
          <>
            <button
              className={styles.secondaryButton}
              onClick={() => onOpenChange(false)}
              type="button"
            >
              取消
            </button>
            <button
              className={styles.primaryButton}
              onClick={(event) => {
                // The footer button is replaced during this click. Prevent the
                // browser from activating the newly rendered submit control.
                event.preventDefault();
                setPhase("review");
              }}
              type="button"
            >
              提交回答
            </button>
          </>
        ) : (
          <>
            <button
              className={styles.secondaryButton}
              onClick={() => setPhase("answer")}
              type="button"
            >
              返回修改
            </button>
            <button
              className={styles.primaryButton}
              form={formId}
              type="submit"
            >
              保存答题记录
            </button>
          </>
        )
      }
      onOpenChange={(next) => {
        if (!next) setPhase("answer");
        onOpenChange(next);
      }}
      open={open}
      title="主动回忆"
    >
      <form
        className={styles.sheetForm}
        id={formId}
        onSubmit={async (event) => {
          event.preventDefault();
          if (phase === "answer") {
            setPhase("review");
            return;
          }
          const succeeded = await actions.submitQuizAttempt(event, quiz);
          if (succeeded === true) {
            // Let the submit click settle before Radix unmounts the Sheet.
            window.setTimeout(() => onOpenChange(false), 0);
          }
        }}
      >
        <div className={styles.promptBox}>
          <strong>{quiz.payload.prompt}</strong>
          <small>
            {quiz.payload.evaluation_mode === "exact_match"
              ? "服务端精确匹配"
              : "本人明确判断"}
          </small>
        </div>
        <label htmlFor={`${formId}-response`}>我的答案</label>
        <textarea
          autoFocus
          id={`${formId}-response`}
          maxLength={20000}
          name="response_text"
          required
          rows={5}
        />
        {phase === "review" ? (
          <>
            <div className={styles.disclosureNotice}>
              <AppIcon name="shield" size={15} />{" "}
              参考答案与解析将在服务端确认后回流；当前不会猜测结果。
            </div>
            <label htmlFor={`${formId}-confidence`}>信心（1-5）</label>
            <input
              defaultValue={3}
              id={`${formId}-confidence`}
              max={5}
              min={1}
              name="confidence"
              required
              type="number"
            />
            <label htmlFor={`${formId}-duration`}>用时（秒）</label>
            <input
              defaultValue={0}
              id={`${formId}-duration`}
              max={86400}
              min={0}
              name="duration_seconds"
              required
              type="number"
            />
            {quiz.payload.evaluation_mode === "self_assessed" ? (
              <>
                <label htmlFor={`${formId}-self`}>我的明确判断</label>
                <select
                  defaultValue="false"
                  id={`${formId}-self`}
                  name="self_assessed_correct"
                >
                  <option value="false">需要复习</option>
                  <option value="true">回答正确</option>
                </select>
              </>
            ) : null}
            <label htmlFor={`${formId}-cause`}>若错误，主要原因</label>
            <select
              defaultValue="unknown"
              id={`${formId}-cause`}
              name="error_cause"
            >
              {CAUSE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </>
        ) : (
          <p className={styles.formHint}>完成回答后再确认信心、用时和错因。</p>
        )}
      </form>
    </WorkbenchSheet>
  );
}

function ContextToolbar({
  actions,
  context,
}: Readonly<{
  actions: ReviewWorkbenchProps["actions"];
  context: ReviewWorkbenchProps["context"];
}>) {
  return (
    <WorkbenchToolbar label="复习上下文操作">
      <WorkbenchSelect
        disabled={!context.workspaces.length}
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
        disabled={!context.spaces.length}
        label="选择 Space"
        onValueChange={actions.setSpaceId}
        options={context.spaces.map((space) => ({
          label: `${space.name} · ${space.visibility === "private" ? "私有" : "共享"}`,
          value: space.id,
        }))}
        placeholder="Space"
        value={context.spaceId || undefined}
      />
      <span className={styles.toolbarSpacer} />
      <WorkbenchTooltip content="同步当前 Workspace">
        <button
          aria-label="同步当前 Workspace"
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

export function ReviewWorkbench({
  context,
  data,
  actions,
}: Readonly<ReviewWorkbenchProps>) {
  const [selectedId, setSelectedId] = useState<string | null>(
    data.topics[0]?.entity.entity_id ?? null,
  );
  const [tab, setTab] = useState("due");
  const [quiz, setQuiz] = useState<ReviewQuiz | null>(null);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [topicOpen, setTopicOpen] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [dependencyOpen, setDependencyOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const unlockButtonRef = useRef<HTMLButtonElement>(null);
  const selectedTopic =
    data.topics.find((topic) => topic.entity.entity_id === selectedId) ?? null;
  const operationalState: ProductOperationalState | null =
    context.conflicts > 0
      ? {
          kind: "conflict",
          description: `${context.conflicts} 项本地修改与远端 revision 存在分叉。`,
          impact: "同步会暂停，确认版本后才能继续。",
          recovery: {
            kind: "button",
            label: "立即同步",
            onInvoke: () => void actions.synchronize(),
          },
        }
      : null;

  const primary = context.unlocked ? (
    <button
      className={styles.primaryButton}
      data-workbench-primary="true"
      disabled={!data.quizItems.length}
      onClick={() => {
        setTab("due");
        if (data.quizItems[0]) setQuiz(data.quizItems[0]);
      }}
      type="button"
    >
      <AppIcon name="target" size={16} /> 开始回忆
    </button>
  ) : (
    <button
      className={styles.primaryButton}
      data-workbench-primary="true"
      disabled={!context.workspaceId || !context.deviceId}
      id="review-unlock"
      onClick={() => setUnlockOpen(true)}
      ref={unlockButtonRef}
      type="button"
    >
      <AppIcon name="unlock" size={16} /> 解锁资料
    </button>
  );

  return (
    <main className={styles.root} id="main-content">
      <WorkbenchFrame
        context={
          <WorkbenchContextBar
            context={{
              permission: {
                label: context.selectedWorkspace?.role ?? "只读",
                tone: context.canEditGraph ? "good" : "warn",
              },
              space: context.selectedSpace
                ? {
                    id: context.selectedSpace.id,
                    name: context.selectedSpace.name,
                  }
                : undefined,
              sync: {
                label: context.conflicts
                  ? `${context.conflicts} 项冲突`
                  : "就绪",
                tone: context.conflicts ? "warn" : "good",
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
            description="复习与掌握 · 到期队列 → 主动回忆 → 掌握确认与错因闭环；所有对象在当前 Space 内完成。"
            eyebrow="REVIEW · ACTIVE RECALL"
            title="把“看过”变成真正能回忆"
          />
        }
        initialPane="master"
        inspector={
          <ReviewInspector
            data={data}
            onQuiz={(next) => {
              setQuiz(next);
            }}
            selectedTopic={selectedTopic}
          />
        }
        inspectorLabel="知识 Inspector"
        label="Review 复习队列工作台"
        main={
          <section className={styles.main}>
            <StatusLine>{context.status}</StatusLine>
            {operationalState ? (
              <ProductOperationalStateNotice state={operationalState} />
            ) : null}
            <ProductWorkbenchStateNotice
              action={
                context.reviewState === "locked" ? (
                  <button
                    className={styles.secondaryButton}
                    onClick={() => setUnlockOpen(true)}
                    type="button"
                  >
                    解锁本地资料
                  </button>
                ) : context.reviewState === "empty" ? (
                  <button
                    className={styles.secondaryButton}
                    onClick={() => setTopicOpen(true)}
                    type="button"
                  >
                    建立第一个知识点
                  </button>
                ) : undefined
              }
              emptyDescription="当前 Space 尚无知识点、回忆题或复习安排；先建立一个知识点。"
              emptyTitle="当前 Space 还没有复习资料"
              onRetry={() => void actions.loadContext()}
              state={context.reviewState}
            />
            <div data-testid="review-tabs">
              <WorkbenchTabs
                label="复习视图"
                onValueChange={setTab}
                tabs={[
                  { label: "到期复习", value: "due", count: data.dueReviews },
                  {
                    label: "掌握与图谱",
                    value: "knowledge",
                    count: data.topics.length,
                  },
                  {
                    label: "错因模式",
                    value: "errors",
                    count: data.openPatterns,
                  },
                  {
                    label: "周期审查",
                    value: "reviews",
                    count: data.reviews.length,
                  },
                ]}
                value={tab}
              >
                <WorkbenchTabPanel forceMount value="due">
                  <div data-testid="review-answer">
                    <QueuePanel
                      data={data}
                      onQuiz={(next) => setQuiz(next)}
                      onTab={setTab}
                      selectedTopic={selectedTopic}
                    />
                  </div>
                </WorkbenchTabPanel>
                <WorkbenchTabPanel forceMount value="knowledge">
                  <KnowledgePanel
                    actions={actions}
                    data={data}
                    onNewDependency={() => setDependencyOpen(true)}
                    onNewQuiz={() => setQuizOpen(true)}
                    onSelect={setSelectedId}
                  />
                </WorkbenchTabPanel>
                <WorkbenchTabPanel forceMount value="errors">
                  <ErrorsPanel actions={actions} data={data} />
                </WorkbenchTabPanel>
                <WorkbenchTabPanel forceMount value="reviews">
                  <ReviewsPanel
                    actions={actions}
                    data={{
                      ...data,
                      reviewFindings: data.reviewFindings.filter(
                        (finding) =>
                          finding.payload.space_id === context.spaceId,
                      ),
                    }}
                    onNewReview={() => setReviewOpen(true)}
                  />
                </WorkbenchTabPanel>
              </WorkbenchTabs>
            </div>
          </section>
        }
        mainLabel="复习工作面"
        master={
          <ReviewMaster
            data={data}
            onNewTopic={() => setTopicOpen(true)}
            onSelect={setSelectedId}
            selectedId={selectedId}
          />
        }
        masterLabel="到期队列"
        toolbar={<ContextToolbar actions={actions} context={context} />}
      />
      <UnlockSheet
        actions={actions}
        onOpenChange={setUnlockOpen}
        open={unlockOpen}
        restoreFocusRef={unlockButtonRef}
      />
      <NewTopicSheet
        actions={actions}
        onOpenChange={setTopicOpen}
        open={topicOpen}
      />
      <NewQuizSheet
        actions={actions}
        onOpenChange={setQuizOpen}
        open={quizOpen}
        topicId={selectedId ?? undefined}
        topics={data.topics}
      />
      <DependencySheet
        actions={actions}
        onOpenChange={setDependencyOpen}
        open={dependencyOpen}
        topics={data.topics}
      />
      <AuditReviewSheet
        actions={actions}
        onOpenChange={setReviewOpen}
        open={reviewOpen}
      />
      <AnswerSheet
        actions={actions}
        onOpenChange={(next) => {
          if (!next) setQuiz(null);
        }}
        open={quiz !== null}
        quiz={quiz}
      />
    </main>
  );
}
