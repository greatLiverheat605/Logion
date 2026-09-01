"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { AppIcon } from "@/components/app-shell/app-icon";
import {
  WorkbenchDropdownMenu,
  WorkbenchSheet,
  WorkbenchTooltip,
  type WorkbenchMenuItem,
} from "@/components/product/headless-ui";
import { ProductOperationalStateNotice } from "@/components/product/product-workbench-state";
import { ProductTag } from "@/components/product/product-ui";
import {
  InspectorSection,
  WorkbenchActionBar,
  WorkbenchContextBar,
  WorkbenchFrame,
  WorkbenchHeader,
} from "@/components/product/workbench";
import { PersonaTodayOverview } from "@/features/personas/persona-today-overview";

import styles from "./today-workbench.module.css";
import type {
  TodayControllerResult,
  TodayEvidenceInput,
  TodayLocalView,
  TodaySessionPayload,
  TodayTaskPayload,
  TodayTaskStatus,
  TodayVerificationInput,
} from "./use-today-controller";

const STATUS_META: Readonly<
  Record<
    TodayTaskStatus,
    { label: string; tone: "bad" | "default" | "good" | "info" | "warn" }
  >
> = {
  backlog: { label: "待安排", tone: "default" },
  blocked: { label: "已阻塞", tone: "warn" },
  cancelled: { label: "已取消", tone: "bad" },
  done: { label: "已关闭", tone: "good" },
  in_progress: { label: "进行中", tone: "info" },
  planned: { label: "已安排", tone: "default" },
  submitted: { label: "待验收", tone: "warn" },
  verified: { label: "已验收", tone: "good" },
};

const PRIORITY_LABEL: Readonly<Record<number, string>> = {
  0: "最低",
  1: "低",
  2: "中",
  3: "高",
  4: "最高",
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "未设置";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(date);
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

interface ExecutionTrendPoint {
  date: Date;
  minutes: number;
}

function calendarKey(date: Date): string {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join("-");
}

function buildExecutionTrend(
  sessions: readonly TodayLocalView<TodaySessionPayload>[],
  now: Date,
): ExecutionTrendPoint[] {
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  const minutesByDay = new Map<string, number>();
  sessions.forEach((session) => {
    if (session.payload.status !== "completed") return;
    const startedAt = new Date(session.payload.started_at);
    if (Number.isNaN(startedAt.valueOf())) return;
    const key = calendarKey(startedAt);
    minutesByDay.set(
      key,
      (minutesByDay.get(key) ?? 0) + (session.payload.manual_minutes ?? 0),
    );
  });
  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (13 - index));
    return { date, minutes: minutesByDay.get(calendarKey(date)) ?? 0 };
  });
}

function useSessionSeconds(startedAt: string | undefined): number {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const start = Date.parse(startedAt);
    const update = () =>
      setElapsedSeconds(
        Number.isNaN(start)
          ? 0
          : Math.max(0, Math.floor((Date.now() - start) / 1000)),
      );
    queueMicrotask(update);
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return startedAt ? elapsedSeconds : 0;
}

function Field({
  children,
  hint,
  id,
  label,
}: Readonly<{
  children: ReactNode;
  hint?: string;
  id: string;
  label: string;
}>) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

function UnlockPane({ controller }: { controller: TodayControllerResult }) {
  const [passphrase, setPassphrase] = useState("");
  const [pending, setPending] = useState(false);
  const inputId = useId();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passphrase) return;
    setPending(true);
    const unlocked = await controller.commands.unlock(passphrase);
    setPending(false);
    if (unlocked) setPassphrase("");
  }

  return (
    <div className={styles.unlockPane} id="today-vault">
      <span aria-hidden="true" className={styles.unlockIcon}>
        <AppIcon name="lock" size={22} />
      </span>
      <div>
        <p className={styles.eyebrow}>LOCAL VAULT</p>
        <h2>解锁今日资料</h2>
        <p>受保护的任务、会话和证据只在本机解锁后显示。</p>
      </div>
      <div className={styles.statusLine} role="status">
        <span aria-hidden="true" />
        {controller.context.status}
      </div>
      <form className={styles.unlockForm} onSubmit={submit}>
        <label className="sr-only" htmlFor={inputId}>
          本地资料口令
        </label>
        <input
          autoComplete="current-password"
          id={inputId}
          onChange={(event) => setPassphrase(event.target.value)}
          placeholder="本地资料口令"
          type="password"
          value={passphrase}
        />
        <div data-workbench-primary="true">
          <button
            className={styles.primaryButton}
            disabled={
              pending || !passphrase || !controller.capabilities.canUnlock
            }
            type="submit"
          >
            <AppIcon name="unlock" size={16} />
            {pending ? "正在解锁" : "解锁"}
          </button>
        </div>
      </form>
    </div>
  );
}

function NewTaskSheet({
  controller,
  onOpenChange,
  open,
}: {
  controller: TodayControllerResult;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const formId = useId();
  const [goalId, setGoalId] = useState("");
  const [phaseId, setPhaseId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [minutes, setMinutes] = useState(45);
  const [priority, setPriority] = useState(2);
  const [pending, setPending] = useState(false);
  const goals = controller.viewModel.visibleGoals;
  const resolvedGoalId = goals.some((item) => item.entity.entity_id === goalId)
    ? goalId
    : (goals[0]?.entity.entity_id ?? "");
  const selectedGoal = goals.find(
    (item) => item.entity.entity_id === resolvedGoalId,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !resolvedGoalId) return;
    setPending(true);
    const saved = await controller.commands.createTask({
      description: description.trim(),
      estimatedMinutes: minutes,
      goalId: resolvedGoalId,
      phaseId: phaseId || null,
      priority,
      title: title.trim(),
    });
    setPending(false);
    if (!saved) return;
    setTitle("");
    setDescription("");
    onOpenChange(false);
  }

  return (
    <WorkbenchSheet
      description="任务必须关联真实目标；低频字段留在此处，不占用执行工作面。"
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
            disabled={pending || !title.trim() || !resolvedGoalId}
            form={formId}
            type="submit"
          >
            {pending ? "正在保存" : "保存任务"}
          </button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      title="新建今日任务"
    >
      {goals.length === 0 ? (
        <div className={styles.sheetEmpty}>
          <p>当前 Space 还没有可关联的目标。</p>
          <Link href="/app/planning">前往规划</Link>
        </div>
      ) : (
        <form className={styles.formStack} id={formId} onSubmit={submit}>
          <Field id={`${formId}-title`} label="任务名称">
            <input
              autoFocus
              id={`${formId}-title`}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              required
              value={title}
            />
          </Field>
          <Field id={`${formId}-goal`} label="关联目标">
            <select
              id={`${formId}-goal`}
              onChange={(event) => {
                setGoalId(event.target.value);
                setPhaseId("");
              }}
              value={resolvedGoalId}
            >
              {goals.map((goal) => (
                <option
                  key={goal.entity.entity_id}
                  value={goal.entity.entity_id}
                >
                  {goal.payload.title}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${formId}-phase`} label="阶段（可选）">
            <select
              id={`${formId}-phase`}
              onChange={(event) => setPhaseId(event.target.value)}
              value={phaseId}
            >
              <option value="">不指定阶段</option>
              {selectedGoal?.payload.phases.map((phase) => (
                <option key={phase.id} value={phase.id}>
                  {phase.title}
                </option>
              ))}
            </select>
          </Field>
          <div className={styles.formGrid}>
            <Field id={`${formId}-minutes`} label="预计分钟">
              <input
                id={`${formId}-minutes`}
                max={480}
                min={5}
                onChange={(event) => setMinutes(Number(event.target.value))}
                step={5}
                type="number"
                value={minutes}
              />
            </Field>
            <Field id={`${formId}-priority`} label="优先级">
              <select
                id={`${formId}-priority`}
                onChange={(event) => setPriority(Number(event.target.value))}
                value={priority}
              >
                {[4, 3, 2, 1, 0].map((value) => (
                  <option key={value} value={value}>
                    {PRIORITY_LABEL[value]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field id={`${formId}-description`} label="说明（可选）">
            <textarea
              id={`${formId}-description`}
              maxLength={10000}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              value={description}
            />
          </Field>
        </form>
      )}
    </WorkbenchSheet>
  );
}

function FinishSessionSheet({
  controller,
  elapsedSeconds,
  onOpenChange,
  open,
}: {
  controller: TodayControllerResult;
  elapsedSeconds: number;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const formId = useId();
  const [manualMinutes, setManualMinutes] = useState(0);
  const [reflection, setReflection] = useState("");
  const [outcome, setOutcome] = useState<"abandoned" | "completed">(
    "completed",
  );
  const [pending, setPending] = useState(false);
  const resolvedMinutes =
    manualMinutes || Math.max(1, Math.round(elapsedSeconds / 60));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const saved = await controller.commands.finishSession({
      manualMinutes: resolvedMinutes,
      outcome,
      reflection: reflection.trim(),
    });
    setPending(false);
    if (saved) onOpenChange(false);
  }

  return (
    <WorkbenchSheet
      description="结束会话只记录实际投入，不会自动完成任务或替代人工验收。"
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
            disabled={pending}
            form={formId}
            type="submit"
          >
            {pending ? "正在保存" : "保存会话"}
          </button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      title="结束专注会话"
    >
      <form className={styles.formStack} id={formId} onSubmit={submit}>
        <div className={styles.formGrid}>
          <Field id={`${formId}-minutes`} label="实际分钟">
            <input
              id={`${formId}-minutes`}
              max={1440}
              min={1}
              onChange={(event) => setManualMinutes(Number(event.target.value))}
              type="number"
              value={resolvedMinutes}
            />
          </Field>
          <Field id={`${formId}-outcome`} label="结束方式">
            <select
              id={`${formId}-outcome`}
              onChange={(event) =>
                setOutcome(event.target.value as "abandoned" | "completed")
              }
              value={outcome}
            >
              <option value="completed">完成本次会话</option>
              <option value="abandoned">放弃本次会话</option>
            </select>
          </Field>
        </div>
        <Field id={`${formId}-reflection`} label="反思与下一步（可选）">
          <textarea
            id={`${formId}-reflection`}
            maxLength={10000}
            onChange={(event) => setReflection(event.target.value)}
            rows={4}
            value={reflection}
          />
        </Field>
      </form>
    </WorkbenchSheet>
  );
}

function EvidenceSheet({
  controller,
  onOpenChange,
  open,
  taskId,
}: {
  controller: TodayControllerResult;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  taskId: string;
}) {
  const formId = useId();
  const [evidenceType, setEvidenceType] =
    useState<TodayEvidenceInput["evidenceType"]>("text");
  const [summary, setSummary] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const saved = await controller.commands.submitEvidence(taskId, {
      evidenceType,
      externalUrl,
      referenceId,
      summary,
    });
    setPending(false);
    if (!saved) return;
    setSummary("");
    setExternalUrl("");
    setReferenceId("");
    onOpenChange(false);
  }

  return (
    <WorkbenchSheet
      description="证据保存在当前 Workspace，并通过 sync-v1 进入人工验收链路。"
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
            disabled={pending}
            form={formId}
            type="submit"
          >
            {pending ? "正在保存" : "保存证据"}
          </button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      title="添加任务证据"
    >
      <form className={styles.formStack} id={formId} onSubmit={submit}>
        <Field id={`${formId}-type`} label="证据类型">
          <select
            id={`${formId}-type`}
            onChange={(event) => {
              setEvidenceType(
                event.target.value as TodayEvidenceInput["evidenceType"],
              );
              setReferenceId("");
            }}
            value={evidenceType}
          >
            <option value="text">文字说明</option>
            <option value="link">HTTP(S) 链接</option>
            <option value="note">已保存笔记</option>
            <option value="resource">已保存资料</option>
          </select>
        </Field>
        <Field id={`${formId}-summary`} label="证据说明">
          <textarea
            autoFocus
            id={`${formId}-summary`}
            maxLength={10000}
            onChange={(event) => setSummary(event.target.value)}
            required
            rows={4}
            value={summary}
          />
        </Field>
        {evidenceType === "link" ? (
          <Field
            id={`${formId}-url`}
            label="HTTP(S) 链接"
            hint="系统只保存链接，不抓取外部内容。"
          >
            <input
              id={`${formId}-url`}
              maxLength={4096}
              onChange={(event) => setExternalUrl(event.target.value)}
              required
              type="url"
              value={externalUrl}
            />
          </Field>
        ) : null}
        {evidenceType === "note" || evidenceType === "resource" ? (
          <Field
            id={`${formId}-reference`}
            label={evidenceType === "note" ? "选择笔记" : "选择资料"}
          >
            <select
              id={`${formId}-reference`}
              onChange={(event) => setReferenceId(event.target.value)}
              required
              value={referenceId}
            >
              <option value="">请选择</option>
              {(evidenceType === "note"
                ? controller.references.notes
                : controller.references.resources
              ).map((item) => (
                <option
                  key={item.entity.entity_id}
                  value={item.entity.entity_id}
                >
                  {item.payload.title}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </form>
    </WorkbenchSheet>
  );
}

function VerificationSheet({
  controller,
  onOpenChange,
  open,
  verificationId,
}: {
  controller: TodayControllerResult;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  verificationId: string;
}) {
  const formId = useId();
  const [verdict, setVerdict] =
    useState<TodayVerificationInput["verdict"]>("passed");
  const [reviewerNotes, setReviewerNotes] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const saved = await controller.commands.decideVerification(verificationId, {
      reviewerNotes,
      verdict,
    });
    setPending(false);
    if (saved) onOpenChange(false);
  }

  return (
    <WorkbenchSheet
      description="这是显式人工决定。系统不会根据计时或 AI 推断验收结论。"
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
            disabled={
              pending || (verdict !== "passed" && !reviewerNotes.trim())
            }
            form={formId}
            type="submit"
          >
            {pending ? "正在记录" : "确认验收"}
          </button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      title="人工验收"
    >
      <form className={styles.formStack} id={formId} onSubmit={submit}>
        <Field id={`${formId}-verdict`} label="验收决定">
          <select
            id={`${formId}-verdict`}
            onChange={(event) =>
              setVerdict(
                event.target.value as TodayVerificationInput["verdict"],
              )
            }
            value={verdict}
          >
            <option value="passed">通过</option>
            <option value="needs_revision">需要修改</option>
            <option value="failed">不通过</option>
          </select>
        </Field>
        <Field id={`${formId}-notes`} label="验收意见">
          <textarea
            autoFocus
            id={`${formId}-notes`}
            maxLength={10000}
            onChange={(event) => setReviewerNotes(event.target.value)}
            required={verdict !== "passed"}
            rows={4}
            value={reviewerNotes}
          />
        </Field>
      </form>
    </WorkbenchSheet>
  );
}

function BlockTaskSheet({
  controller,
  onOpenChange,
  open,
  taskId,
}: {
  controller: TodayControllerResult;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  taskId: string;
}) {
  const formId = useId();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason.trim()) return;
    setPending(true);
    const saved = await controller.commands.transitionTask(
      taskId,
      "blocked",
      reason,
    );
    setPending(false);
    if (saved) onOpenChange(false);
  }

  return (
    <WorkbenchSheet
      description="阻塞原因会随任务保存，便于后续周期审查。"
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
            disabled={pending || !reason.trim()}
            form={formId}
            type="submit"
          >
            确认阻塞
          </button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      title="标记任务阻塞"
    >
      <form id={formId} onSubmit={submit}>
        <Field id={`${formId}-reason`} label="阻塞原因">
          <textarea
            autoFocus
            id={`${formId}-reason`}
            maxLength={10000}
            onChange={(event) => setReason(event.target.value)}
            required
            rows={4}
            value={reason}
          />
        </Field>
      </form>
    </WorkbenchSheet>
  );
}

function TaskRow({
  onSelect,
  selected,
  task,
}: {
  onSelect: () => void;
  selected: boolean;
  task: TodayLocalView<TodayTaskPayload>;
}) {
  const meta = STATUS_META[task.payload.status];
  return (
    <button
      aria-current={selected ? "true" : undefined}
      className={styles.taskRow}
      data-selected={selected}
      onClick={onSelect}
      type="button"
    >
      <span
        className={styles.taskStatusRail}
        data-status={task.payload.status}
      />
      <span className={styles.taskRowCopy}>
        <strong>{task.payload.title}</strong>
        <small>
          {PRIORITY_LABEL[task.payload.priority] ?? task.payload.priority}优先级
          · {task.payload.estimated_minutes} 分钟
        </small>
      </span>
      <ProductTag tone={meta.tone}>{meta.label}</ProductTag>
    </button>
  );
}

function TodayMaster({ controller }: { controller: TodayControllerResult }) {
  const { queue } = controller.viewModel;
  return (
    <div className={styles.master} data-testid="today-queue">
      <header className={styles.paneHeader}>
        <div>
          <p className={styles.eyebrow}>TODAY QUEUE</p>
          <h2>今日序列</h2>
        </div>
        <span className={styles.count}>{queue.length}</span>
      </header>
      <div aria-label="今日任务列表" className={styles.taskList}>
        {queue.map((task) => (
          <TaskRow
            key={task.entity.entity_id}
            onSelect={() =>
              controller.commands.setSelectedTaskId(task.entity.entity_id)
            }
            selected={controller.selection.taskId === task.entity.entity_id}
            task={task}
          />
        ))}
        {queue.length === 0 ? (
          <div className={styles.quietEmpty}>
            <AppIcon name="clipboard" size={20} />
            <strong>今日队列为空</strong>
            <span>从规划中安排任务，或在当前页新建一项。</span>
          </div>
        ) : null}
      </div>
      <footer className={styles.masterFooter}>
        <span>{controller.viewModel.completedTaskCount} 已完成</span>
        <span>{controller.viewModel.blockedTaskCount} 阻塞</span>
        <span>{controller.viewModel.pendingVerificationCount} 待验收</span>
      </footer>
    </div>
  );
}

function TodayInspector({ controller }: { controller: TodayControllerResult }) {
  const task = controller.viewModel.selectedTask;
  if (!task) {
    return (
      <div className={styles.inspectorEmpty} data-testid="today-inspector">
        选择任务后查看完整上下文。
      </div>
    );
  }
  const goal = controller.viewModel.visibleGoals.find(
    (item) => item.entity.entity_id === task.payload.goal_id,
  );
  const phase = goal?.payload.phases.find(
    (item) => item.id === task.payload.phase_id,
  );
  const evidence = controller.viewModel.visibleEvidence.filter(
    (item) => item.payload.task_id === task.entity.entity_id,
  );
  const verifications = controller.viewModel.visibleVerifications.filter(
    (item) => item.payload.task_id === task.entity.entity_id,
  );
  const sessions = controller.viewModel.visibleSessions.filter(
    (item) => item.payload.task_id === task.entity.entity_id,
  );

  return (
    <div className={styles.inspector} data-testid="today-inspector">
      <div className={styles.inspectorTitle}>
        <p className={styles.eyebrow}>TASK CONTEXT</p>
        <h2>{task.payload.title}</h2>
      </div>
      <InspectorSection title="属性">
        <dl className={styles.kvList}>
          <div>
            <dt>目标</dt>
            <dd>{goal?.payload.title ?? "未找到"}</dd>
          </div>
          <div>
            <dt>阶段</dt>
            <dd>{phase?.title ?? "未指定"}</dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd>{STATUS_META[task.payload.status].label}</dd>
          </div>
          <div>
            <dt>优先级</dt>
            <dd>
              {PRIORITY_LABEL[task.payload.priority] ?? task.payload.priority}
            </dd>
          </div>
          <div>
            <dt>预计</dt>
            <dd>{task.payload.estimated_minutes} 分钟</dd>
          </div>
          <div>
            <dt>同步</dt>
            <dd>{task.entity.sync_status}</dd>
          </div>
          <div>
            <dt>计划时间</dt>
            <dd>{formatDate(task.payload.planned_at)}</dd>
          </div>
        </dl>
      </InspectorSection>
      {task.payload.description ? (
        <InspectorSection title="任务说明">
          <p className={styles.prose}>{task.payload.description}</p>
        </InspectorSection>
      ) : null}
      <InspectorSection title={`证据 · ${evidence.length}`}>
        {evidence.length ? (
          evidence.map((item) => (
            <article className={styles.traceItem} key={item.entity.entity_id}>
              <strong>{item.payload.summary || "未填写说明"}</strong>
              <small>
                {item.payload.evidence_type} ·{" "}
                {formatDate(item.entity.created_at)}
              </small>
              {item.payload.external_url ? (
                <a
                  href={item.payload.external_url}
                  rel="noreferrer"
                  target="_blank"
                >
                  打开链接
                </a>
              ) : null}
            </article>
          ))
        ) : (
          <p className={styles.prose}>暂无证据。</p>
        )}
      </InspectorSection>
      <InspectorSection title={`验收 · ${verifications.length}`}>
        {verifications.length ? (
          verifications.map((item) => (
            <article className={styles.traceItem} key={item.entity.entity_id}>
              <strong>{item.payload.verdict}</strong>
              <small>{item.payload.reviewer_notes || "暂无验收意见"}</small>
            </article>
          ))
        ) : (
          <p className={styles.prose}>尚未进入人工验收。</p>
        )}
      </InspectorSection>
      <InspectorSection title={`会话 · ${sessions.length}`}>
        {sessions.length ? (
          sessions.map((item) => (
            <article className={styles.traceItem} key={item.entity.entity_id}>
              <strong>
                {item.payload.status === "active"
                  ? "进行中"
                  : `${item.payload.manual_minutes ?? 0} 分钟`}
              </strong>
              <small>
                {formatDate(item.payload.started_at)} ·{" "}
                {item.payload.outcome ?? "未结束"}
              </small>
            </article>
          ))
        ) : (
          <p className={styles.prose}>暂无会话记录。</p>
        )}
      </InspectorSection>
      <nav aria-label="任务审计入口" className={styles.inspectorLinks}>
        <Link href="/app/audit">审计时间线</Link>
        <Link href="/app/sync">同步详情</Link>
      </nav>
    </div>
  );
}

function TodaySignals({ controller }: { controller: TodayControllerResult }) {
  const fallbackSignals = [
    {
      detail: "已关闭或完成验收的任务",
      label: "今日完成",
      value: controller.viewModel.completedTaskCount,
    },
    {
      detail: "已结束会话的真实累计",
      label: "专注分钟",
      value: controller.viewModel.completedMinutes,
    },
    {
      detail: "按当前 Space 任务计算",
      label: "完成率",
      value: `${Math.round(controller.viewModel.completionRate)}%`,
    },
    {
      detail: "等待明确人工决定",
      label: "待验收",
      value: controller.viewModel.pendingVerificationCount,
    },
  ];
  const metrics =
    controller.persona.dashboardModel?.metrics.slice(0, 4) ?? fallbackSignals;
  const metricsReady = ["offline-stale", "ready"].includes(
    controller.persona.dashboardState,
  );

  return (
    <section className={styles.workspaceSection} data-testid="today-signals">
      <header className={styles.sectionHeader}>
        <div>
          <p className={styles.eyebrow}>TODAY SIGNALS</p>
          <h3>今日信号</h3>
        </div>
        <WorkbenchSheet
          description="画像只改变今天的组织视角，不改变 Workspace 权限。"
          title="Persona 今日信号"
          trigger={
            <button className={styles.sectionAction} type="button">
              <AppIcon name="target" size={14} />
              画像详情
            </button>
          }
        >
          <PersonaTodayOverview
            onRetry={() => void controller.commands.loadContext()}
            source={controller.persona.dashboardSource}
            state={controller.persona.dashboardState}
          />
        </WorkbenchSheet>
      </header>
      {metricsReady ? (
        <div aria-label="今日信号指标" className={styles.signalGrid}>
          {metrics.map((metric) => (
            <div key={metric.label}>
              <strong>{metric.value}</strong>
              <span>{metric.label}</span>
              <small>{metric.detail}</small>
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.signalEmpty}>真实上下文就绪后显示今日信号。</p>
      )}
    </section>
  );
}

function TodayExecutionTrend({
  controller,
}: {
  controller: TodayControllerResult;
}) {
  const points = useMemo(
    () =>
      buildExecutionTrend(
        controller.viewModel.visibleSessions,
        controller.persona.dashboardSource.now,
      ),
    [
      controller.persona.dashboardSource.now,
      controller.viewModel.visibleSessions,
    ],
  );
  const maximum = Math.max(1, ...points.map((point) => point.minutes));
  const total = points.reduce((sum, point) => sum + point.minutes, 0);

  return (
    <section className={styles.workspaceSection} data-testid="today-trend">
      <header className={styles.sectionHeader}>
        <div>
          <p className={styles.eyebrow}>14 DAY ACTIVITY</p>
          <h3>执行趋势</h3>
        </div>
        <span className={styles.sectionMeta}>14 天 · {total} 分钟</span>
      </header>
      <div
        aria-label="最近 14 天专注分钟"
        className={styles.trendChart}
        role="list"
      >
        {points.map((point) => {
          const dateLabel = new Intl.DateTimeFormat("zh-CN", {
            day: "2-digit",
            month: "2-digit",
          }).format(point.date);
          return (
            <div
              aria-label={`${dateLabel}，${point.minutes} 分钟`}
              className={styles.trendColumn}
              key={calendarKey(point.date)}
              role="listitem"
            >
              <span aria-hidden="true" className={styles.trendTrack}>
                {point.minutes ? (
                  <span
                    className={styles.trendFill}
                    style={{
                      height: `${Math.max(8, (point.minutes / maximum) * 100)}%`,
                    }}
                  />
                ) : null}
              </span>
              <small>{String(point.date.getDate()).padStart(2, "0")}</small>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TodayMain({
  controller,
  onBlock,
  onEvidence,
  onFinish,
  onNewTask,
  onVerify,
}: {
  controller: TodayControllerResult;
  onBlock: () => void;
  onEvidence: () => void;
  onFinish: (elapsedSeconds: number) => void;
  onNewTask: () => void;
  onVerify: () => void;
}) {
  const task = controller.viewModel.selectedTask;
  const activeSession = controller.viewModel.activeSession;
  const elapsedSeconds = useSessionSeconds(activeSession?.payload.started_at);
  const pendingVerification = task
    ? controller.viewModel.visibleVerifications.find(
        (item) =>
          item.payload.task_id === task.entity.entity_id &&
          item.payload.verdict === "pending",
      )
    : undefined;
  const passedVerification = task
    ? controller.viewModel.visibleVerifications.find(
        (item) =>
          item.payload.task_id === task.entity.entity_id &&
          item.payload.verdict === "passed",
      )
    : undefined;
  const taskEvidence = task
    ? controller.viewModel.visibleEvidence.filter(
        (item) => item.payload.task_id === task.entity.entity_id,
      )
    : [];
  const taskVerifications = task
    ? controller.viewModel.visibleVerifications.filter(
        (item) => item.payload.task_id === task.entity.entity_id,
      )
    : [];
  const latestVerification = taskVerifications.at(-1);
  const verificationCopy = latestVerification
    ? {
        failed: ["验收未通过", "查看意见后继续补充证据"],
        needs_revision: ["需要修改", "按验收意见修订后重新提交"],
        passed: ["验收已通过", "可在主操作中关闭任务"],
        pending: ["等待人工验收", "证据不会自动变成验收结论"],
      }[latestVerification.payload.verdict]
    : ["尚未进入验收", "完成执行并提交后，由有权限的成员明确决定"];
  const canWrite = controller.capabilities.canWrite;

  let primary: ReactNode = null;
  if (canWrite && activeSession) {
    primary = (
      <button
        className={styles.primaryButton}
        onClick={() => onFinish(elapsedSeconds)}
        type="button"
      >
        <AppIcon name="timer" size={16} />
        结束会话
      </button>
    );
  } else if (canWrite && pendingVerification) {
    primary = (
      <button className={styles.primaryButton} onClick={onVerify} type="button">
        <AppIcon name="shield" size={16} />
        提交验收决定
      </button>
    );
  } else if (
    canWrite &&
    task?.payload.status === "verified" &&
    passedVerification
  ) {
    primary = (
      <button
        className={styles.primaryButton}
        onClick={() =>
          void controller.commands.closeVerifiedTask(
            passedVerification.entity.entity_id,
            task.entity.entity_id,
          )
        }
        type="button"
      >
        <AppIcon name="archive" size={16} />
        关闭已验收任务
      </button>
    );
  } else if (canWrite && task?.payload.status === "backlog") {
    primary = (
      <button
        className={styles.primaryButton}
        onClick={() =>
          void controller.commands.transitionTask(
            task.entity.entity_id,
            "planned",
          )
        }
        type="button"
      >
        <AppIcon name="calendar" size={16} />
        安排到今天
      </button>
    );
  } else if (canWrite && task?.payload.status === "blocked") {
    primary = (
      <button
        className={styles.primaryButton}
        onClick={() =>
          void controller.commands.transitionTask(
            task.entity.entity_id,
            "planned",
          )
        }
        type="button"
      >
        <AppIcon name="refresh" size={16} />
        解除阻塞
      </button>
    );
  } else if (
    canWrite &&
    task &&
    ["planned", "in_progress"].includes(task.payload.status)
  ) {
    primary = (
      <button
        className={styles.primaryButton}
        onClick={() =>
          void controller.commands.startSession(task.entity.entity_id)
        }
        type="button"
      >
        <AppIcon name="timer" size={16} />
        开始专注
      </button>
    );
  } else if (canWrite && task?.payload.status === "submitted") {
    primary = (
      <button
        className={styles.primaryButton}
        onClick={onEvidence}
        type="button"
      >
        <AppIcon name="plus" size={16} />
        补充验收证据
      </button>
    );
  } else if (canWrite && !task) {
    primary = (
      <button
        className={styles.primaryButton}
        onClick={onNewTask}
        type="button"
      >
        <AppIcon name="plus" size={16} />
        新建今日任务
      </button>
    );
  }

  const menuItems: WorkbenchMenuItem[] =
    task && canWrite
      ? [
          ...(["planned", "in_progress"].includes(task.payload.status)
            ? [{ id: "block", label: "标记阻塞", onSelect: onBlock }]
            : []),
          ...(task.payload.status === "in_progress"
            ? [
                {
                  id: "submit",
                  label: "提交待验收",
                  onSelect: () =>
                    void controller.commands.transitionTask(
                      task.entity.entity_id,
                      "submitted",
                    ),
                },
              ]
            : []),
        ]
      : [];

  if (!controller.context.unlocked)
    return <UnlockPane controller={controller} />;

  return (
    <div className={styles.main}>
      {controller.context.operationalState ? (
        <ProductOperationalStateNotice
          state={controller.context.operationalState}
        />
      ) : null}
      <div className={styles.statusLine} role="status">
        <span aria-hidden="true" />
        {controller.context.status}
      </div>
      <section className={styles.nextAction} data-testid="today-next-action">
        <header className={styles.nextHeader}>
          <div>
            <p className={styles.eyebrow}>NEXT ACTION</p>
            <h2>{task?.payload.title ?? "今日没有待推进任务"}</h2>
            {task ? (
              <p>
                {STATUS_META[task.payload.status].label} ·{" "}
                {task.payload.estimated_minutes} 分钟 ·{" "}
                {PRIORITY_LABEL[task.payload.priority] ?? task.payload.priority}
                优先级
              </p>
            ) : (
              <p>当前 Workspace 与 Space 保持不变。</p>
            )}
          </div>
          {activeSession ? (
            <div
              aria-label={`本次专注 ${formatDuration(elapsedSeconds)}`}
              className={styles.timer}
              role="timer"
            >
              <span>FOCUS</span>
              <strong>{formatDuration(elapsedSeconds)}</strong>
            </div>
          ) : null}
        </header>
        {task?.payload.description ? (
          <p className={styles.taskDescription}>{task.payload.description}</p>
        ) : null}
        {task?.payload.blocked_reason ? (
          <div className={styles.blockedReason}>
            <strong>阻塞原因</strong>
            <span>{task.payload.blocked_reason}</span>
          </div>
        ) : null}
        <WorkbenchActionBar
          primary={primary}
          secondary={
            menuItems.length ? (
              <WorkbenchDropdownMenu
                items={menuItems}
                label="任务操作"
                trigger={
                  <button className={styles.secondaryButton} type="button">
                    <AppIcon name="more" size={15} />
                    更多
                  </button>
                }
              />
            ) : undefined
          }
        />
      </section>
      <section
        className={`${styles.workspaceSection} ${styles.evidenceLane}`}
        data-testid="today-evidence"
      >
        <header className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>EVIDENCE & REVIEW</p>
            <h3>证据与人工验收</h3>
          </div>
          {task &&
          canWrite &&
          ["in_progress", "submitted"].includes(task.payload.status) ? (
            <button
              className={styles.sectionAction}
              onClick={onEvidence}
              type="button"
            >
              <AppIcon name="plus" size={14} />
              添加证据
            </button>
          ) : (
            <Link href="/app/audit">查看审计</Link>
          )}
        </header>
        {task ? (
          <div className={styles.evidenceReviewGrid}>
            <div aria-label={`成果证据 ${taskEvidence.length} 条`}>
              <div className={styles.subsectionLabel}>
                <span>成果证据</span>
                <strong>{taskEvidence.length}</strong>
              </div>
              <div className={styles.evidenceList}>
                {taskEvidence.length ? (
                  taskEvidence.map((item) => (
                    <article key={item.entity.entity_id}>
                      <span aria-hidden="true">
                        <AppIcon name="clipboard" size={15} />
                      </span>
                      <div>
                        <strong>{item.payload.summary || "未填写说明"}</strong>
                        <small>
                          {item.payload.evidence_type} ·{" "}
                          {formatDate(item.entity.created_at)}
                        </small>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className={styles.prose}>还没有记录可检查的成果证据。</p>
                )}
              </div>
            </div>
            <div className={styles.verificationStatus}>
              <span aria-hidden="true">
                <AppIcon name="shield" size={16} />
              </span>
              <div>
                <strong>{verificationCopy[0]}</strong>
                <small>{verificationCopy[1]}</small>
                {latestVerification?.payload.reviewer_notes ? (
                  <p>{latestVerification.payload.reviewer_notes}</p>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <p className={styles.prose}>
            选择或新建任务后，这里会显示真实证据与人工验收状态。
          </p>
        )}
      </section>
      <TodaySignals controller={controller} />
      <TodayExecutionTrend controller={controller} />
    </div>
  );
}

export function TodayWorkbench({
  controller,
}: {
  controller: TodayControllerResult;
}) {
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishSeconds, setFinishSeconds] = useState(0);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [verificationOpen, setVerificationOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const selectedTaskId = controller.selection.taskId;
  const pendingVerification = controller.viewModel.visibleVerifications.find(
    (item) =>
      item.payload.task_id === selectedTaskId &&
      item.payload.verdict === "pending",
  );

  const header = (
    <WorkbenchHeader
      actions={
        <div className={styles.headerActions}>
          <WorkbenchTooltip content="推送本地变更并拉取远端 revision">
            <button
              aria-label="立即同步"
              className={styles.iconButton}
              disabled={!controller.capabilities.canSync}
              onClick={() => void controller.commands.synchronize()}
              type="button"
            >
              <AppIcon name="refresh" size={16} />
            </button>
          </WorkbenchTooltip>
          <button
            className={styles.secondaryButton}
            disabled={!controller.capabilities.canWrite}
            onClick={() => setNewTaskOpen(true)}
            type="button"
          >
            <AppIcon name="plus" size={15} />
            新建任务
          </button>
        </div>
      }
      eyebrow="TODAY · EXECUTION"
      description="按序列推进任务：专注、证据、人工验收。系统不会自动完成任务或替代验收。"
      title="今日驾驶舱"
    />
  );

  return (
    <main className={styles.root} data-unlocked={controller.context.unlocked}>
      <WorkbenchFrame
        context={
          <WorkbenchContextBar context={controller.context.operational} />
        }
        header={header}
        inspector={<TodayInspector controller={controller} />}
        inspectorLabel="任务 Inspector"
        label="今日执行工作台"
        main={
          <TodayMain
            controller={controller}
            onBlock={() => setBlockOpen(true)}
            onEvidence={() => setEvidenceOpen(true)}
            onFinish={(elapsedSeconds) => {
              setFinishSeconds(elapsedSeconds);
              setFinishOpen(true);
            }}
            onNewTask={() => setNewTaskOpen(true)}
            onVerify={() => setVerificationOpen(true)}
          />
        }
        mainLabel="NEXT ACTION"
        master={<TodayMaster controller={controller} />}
        masterLabel="今日序列"
      />
      <NewTaskSheet
        controller={controller}
        onOpenChange={setNewTaskOpen}
        open={newTaskOpen}
      />
      <FinishSessionSheet
        controller={controller}
        elapsedSeconds={finishSeconds}
        onOpenChange={setFinishOpen}
        open={finishOpen}
      />
      <EvidenceSheet
        controller={controller}
        onOpenChange={setEvidenceOpen}
        open={evidenceOpen}
        taskId={selectedTaskId}
      />
      <VerificationSheet
        controller={controller}
        onOpenChange={setVerificationOpen}
        open={verificationOpen}
        verificationId={pendingVerification?.entity.entity_id ?? ""}
      />
      <BlockTaskSheet
        controller={controller}
        onOpenChange={setBlockOpen}
        open={blockOpen}
        taskId={selectedTaskId}
      />
    </main>
  );
}
