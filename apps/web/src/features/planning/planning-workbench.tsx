"use client";

import Link from "next/link";
import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";

import { AppIcon } from "@/components/app-shell/app-icon";
import {
  WorkbenchPopover,
  WorkbenchSelect,
  WorkbenchSheet,
  WorkbenchTooltip,
} from "@/components/product/headless-ui";
import { ProductTag } from "@/components/product/product-ui";
import { ProductOperationalStateNotice } from "@/components/product/product-workbench-state";
import {
  InspectorSection,
  WorkbenchContextBar,
  WorkbenchFrame,
  WorkbenchHeader,
  WorkbenchToolbar,
} from "@/components/product/workbench";

import styles from "./planning-workbench.module.css";
import type { PlanningGoalRecord } from "./planning-workbench-model";
import type { PlanningControllerResult } from "./use-planning-controller";

const TASK_STATUS: Readonly<Record<string, string>> = {
  backlog: "待规划",
  blocked: "已阻塞",
  cancelled: "已取消",
  done: "已完成",
  in_progress: "进行中",
  planned: "已计划",
  submitted: "待验收",
  verified: "已验收",
};

function formatDate(value: string | null): string {
  if (!value) return "未设置";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function EmptyPane({
  description,
  icon = "target",
  title,
}: Readonly<{
  description: string;
  icon?: "lock" | "target";
  title: string;
}>) {
  return (
    <div className={styles.emptyPane}>
      <span aria-hidden="true">
        <AppIcon name={icon} size={20} />
      </span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function GoalMaster({
  controller,
}: Readonly<{ controller: PlanningControllerResult }>) {
  const selectedId = controller.viewModel.selectedGoal?.id;
  return (
    <div className={styles.master} data-testid="planning-goals">
      <header className={styles.paneHeader}>
        <div>
          <p className={styles.eyebrow}>GOAL MASTER</p>
          <h2>目标列表</h2>
        </div>
        <span
          className={styles.count}
          aria-label={`${controller.viewModel.visibleGoals.length} 个目标`}
        >
          {controller.viewModel.visibleGoals.length}
        </span>
      </header>
      <div aria-label="当前 Space 的目标" className={styles.goalList}>
        {controller.viewModel.visibleGoals.length ? (
          controller.viewModel.visibleGoals.map((goal) => {
            const active = selectedId === goal.id;
            return (
              <button
                aria-current={active ? "true" : undefined}
                className={styles.goalRow}
                data-selected={active}
                key={goal.id}
                onClick={() => controller.commands.selectGoal(goal.id)}
                type="button"
              >
                <span aria-hidden="true" className={styles.goalIcon}>
                  <AppIcon name="target" size={15} />
                </span>
                <span className={styles.goalCopy}>
                  <strong>{goal.payload.title}</strong>
                  <small>
                    每周{" "}
                    {Math.round((goal.payload.weekly_minutes / 60) * 10) / 10}h
                    · {goal.payload.phases.length} 阶段
                  </small>
                  <span className={styles.goalTags}>
                    <ProductTag
                      tone={goal.syncStatus === "clean" ? "good" : "info"}
                    >
                      {goal.syncStatus === "clean" ? "已同步" : "待同步"}
                    </ProductTag>
                    {!goal.payload.target_date ? (
                      <ProductTag tone="warn">无日期</ProductTag>
                    ) : null}
                  </span>
                </span>
              </button>
            );
          })
        ) : (
          <EmptyPane
            description="创建目标后，这里会形成可选择的真实路线列表。"
            title="当前 Space 还没有目标"
          />
        )}
      </div>
      <footer className={styles.masterFooter}>
        <span>{controller.context.online ? "在线" : "离线"}</span>
        <span>
          {controller.context.unlocked ? "Vault 已解锁" : "Vault 已锁定"}
        </span>
      </footer>
    </div>
  );
}

function GoalSummary({
  goal,
  controller,
}: Readonly<{
  goal: PlanningGoalRecord;
  controller: PlanningControllerResult;
}>) {
  return (
    <section aria-label="目标概览" className={styles.goalSummary}>
      <div className={styles.goalHeading}>
        <div>
          <p className={styles.eyebrow}>SELECTED GOAL</p>
          <h2>{goal.payload.title}</h2>
          <p>{goal.payload.desired_outcome}</p>
        </div>
        <ProductTag
          tone={controller.viewModel.readiness === 100 ? "good" : "warn"}
        >
          {controller.viewModel.readiness === 100
            ? "结构完整"
            : `${controller.viewModel.readiness}% 完整`}
        </ProductTag>
      </div>
      <dl className={styles.goalStats}>
        <div>
          <dt>每周投入</dt>
          <dd>
            {Math.round((goal.payload.weekly_minutes / 60) * 10) / 10} 小时
          </dd>
        </div>
        <div>
          <dt>目标日期</dt>
          <dd>{formatDate(goal.payload.target_date)}</dd>
        </div>
        <div>
          <dt>任务进度</dt>
          <dd>
            {
              controller.viewModel.tasks.filter((task) =>
                ["done", "verified"].includes(task.payload.status),
              ).length
            }
            /{controller.viewModel.tasks.length}
          </dd>
        </div>
      </dl>
      {goal.payload.description ? (
        <p className={styles.goalDescription}>{goal.payload.description}</p>
      ) : null}
    </section>
  );
}

function PhaseRoute({
  controller,
}: Readonly<{ controller: PlanningControllerResult }>) {
  return (
    <section
      aria-label="阶段路线"
      className={styles.workspaceSection}
      data-testid="planning-stages"
    >
      <header className={styles.sectionHeader}>
        <div>
          <h2>阶段与路线顺序</h2>
          <p>position 仅表示路线顺序，不代表强依赖。</p>
        </div>
        <WorkbenchTooltip content="当前 sync-v1 合同不支持在既有目标上追加阶段">
          <span>
            <button
              aria-label="新建阶段，当前能力不可用"
              className={styles.sectionAction}
              disabled
              type="button"
            >
              <AppIcon name="plus" size={14} />
              新建阶段
            </button>
          </span>
        </WorkbenchTooltip>
      </header>
      <ol className={styles.phaseRoute} data-testid="planning-dependencies">
        {controller.viewModel.phaseSequence.map((phase, index) => {
          const phaseTasks = controller.viewModel.tasksByPhase[phase.id] ?? [];
          return (
            <li className={styles.phaseItem} key={phase.id}>
              <div aria-hidden="true" className={styles.phaseMarker}>
                <span>{index + 1}</span>
                {index < controller.viewModel.phaseSequence.length - 1 ? (
                  <i />
                ) : null}
              </div>
              <article className={styles.phaseBody}>
                <header>
                  <div>
                    <strong>{phase.title}</strong>
                    <small>
                      {phase.estimated_minutes} 分钟 · {phaseTasks.length}{" "}
                      个任务
                    </small>
                  </div>
                  <ProductTag
                    tone={
                      phaseTasks.some(
                        (task) => task.payload.status === "in_progress",
                      )
                        ? "info"
                        : "default"
                    }
                  >
                    {phaseTasks.some(
                      (task) => task.payload.status === "in_progress",
                    )
                      ? "进行中"
                      : "已规划"}
                  </ProductTag>
                </header>
                {phase.description ? <p>{phase.description}</p> : null}
                <div className={styles.criteria}>
                  <span>验收标准</span>
                  <ul>
                    {phase.acceptance_criteria.map((criterion) => (
                      <li key={criterion}>{criterion || "待补充"}</li>
                    ))}
                  </ul>
                </div>
                <small className={styles.predecessor}>
                  {phase.priorPhaseTitle
                    ? `前序提示：${phase.priorPhaseTitle}`
                    : "路线起点"}
                </small>
              </article>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function GoalTasks({
  controller,
}: Readonly<{ controller: PlanningControllerResult }>) {
  const phaseTitle = new Map(
    controller.viewModel.phaseSequence.map((phase) => [phase.id, phase.title]),
  );
  return (
    <section
      aria-label="目标关联任务"
      className={styles.workspaceSection}
      data-testid="planning-tasks"
    >
      <header className={styles.sectionHeader}>
        <div>
          <h2>任务</h2>
          <p>任务在 Today 中创建和推进，这里按目标与阶段回显。</p>
        </div>
        <Link className={styles.sectionLink} href="/app/today">
          打开 Today
        </Link>
      </header>
      <div className={styles.taskList}>
        {controller.viewModel.tasks.length ? (
          controller.viewModel.tasks.map((task) => (
            <article className={styles.taskRow} key={task.id}>
              <span aria-hidden="true" className={styles.taskIcon}>
                <AppIcon name="clipboard" size={14} />
              </span>
              <div>
                <strong>{task.payload.title}</strong>
                <small>
                  {task.payload.phase_id
                    ? (phaseTitle.get(task.payload.phase_id) ?? "未知阶段")
                    : "未挂阶段"}
                </small>
              </div>
              <span>
                {TASK_STATUS[task.payload.status] ?? task.payload.status}
              </span>
              <small>{task.payload.estimated_minutes}′</small>
            </article>
          ))
        ) : (
          <p className={styles.listEmpty}>
            这个目标还没有任务；从 Today 创建任务并关联当前目标。
          </p>
        )}
      </div>
    </section>
  );
}

function PlanningMain({
  controller,
}: Readonly<{ controller: PlanningControllerResult }>) {
  const goal = controller.viewModel.selectedGoal;
  return (
    <div className={styles.main}>
      <p aria-live="polite" className={styles.statusLine} role="status">
        <span aria-hidden="true" />
        {controller.context.status}
      </p>
      {controller.context.operationalState ? (
        <ProductOperationalStateNotice
          state={controller.context.operationalState}
        />
      ) : null}
      {!controller.context.unlocked ? (
        <EmptyPane
          description="解锁后才会读取目标、阶段、验收标准与关联任务。"
          icon="lock"
          title="本地规划资料已锁定"
        />
      ) : goal ? (
        <>
          <GoalSummary controller={controller} goal={goal} />
          <PhaseRoute controller={controller} />
          <GoalTasks controller={controller} />
        </>
      ) : (
        <EmptyPane
          description="使用页面右上角的主操作，创建目标与首个可验收阶段。"
          title="从第一个目标开始"
        />
      )}
    </div>
  );
}

function MetaList({ children }: Readonly<{ children: ReactNode }>) {
  return <dl className={styles.metaList}>{children}</dl>;
}

function PlanningInspector({
  controller,
}: Readonly<{ controller: PlanningControllerResult }>) {
  const goal = controller.viewModel.selectedGoal;
  if (!goal) {
    return (
      <div className={styles.inspector} data-testid="planning-inspector">
        <EmptyPane
          description="选择目标后，这里会显示成果、投入、验收与同步上下文。"
          title="目标 Inspector"
        />
      </div>
    );
  }
  return (
    <div className={styles.inspector} data-testid="planning-inspector">
      <InspectorSection title="目标详情">
        <MetaList>
          <div>
            <dt>同步</dt>
            <dd>{goal.syncStatus === "clean" ? "已同步" : "待同步"}</dd>
          </div>
          <div>
            <dt>更新</dt>
            <dd>{formatDate(goal.updatedAt)}</dd>
          </div>
          <div>
            <dt>目标日期</dt>
            <dd>{formatDate(goal.payload.target_date)}</dd>
          </div>
          <div>
            <dt>阶段投入</dt>
            <dd>{controller.viewModel.plannedMinutes} 分钟</dd>
          </div>
        </MetaList>
      </InspectorSection>
      <InspectorSection title="可验收成果">
        <p className={styles.inspectorProse}>{goal.payload.desired_outcome}</p>
      </InspectorSection>
      <InspectorSection
        title={`阶段验收标准 · ${controller.viewModel.phaseSequence.length}`}
      >
        <div className={styles.inspectorCriteria}>
          {controller.viewModel.phaseSequence.map((phase) => (
            <div key={phase.id}>
              <strong>{phase.title}</strong>
              <span>{phase.acceptance_criteria.join("；") || "待补充"}</span>
            </div>
          ))}
        </div>
      </InspectorSection>
      <InspectorSection title="合同边界">
        <p className={styles.inspectorProse}>
          当前版本只回显阶段顺序；追加阶段、强依赖与发布操作需要服务端读写合同支持后才会开放。
        </p>
      </InspectorSection>
    </div>
  );
}

function ContextSelectors({
  controller,
}: Readonly<{ controller: PlanningControllerResult }>) {
  return (
    <>
      <WorkbenchSelect
        disabled={controller.context.workspaces.length === 0}
        label="选择 Workspace"
        onValueChange={controller.commands.setWorkspaceId}
        options={controller.context.workspaces.map((workspace) => ({
          label: workspace.name,
          value: workspace.id,
        }))}
        placeholder="选择 Workspace"
        value={controller.context.workspaceId || undefined}
      />
      <WorkbenchSelect
        disabled={controller.context.spaces.length === 0}
        label="选择 Space"
        onValueChange={controller.commands.setSpaceId}
        options={controller.context.spaces.map((space) => ({
          label: `${space.name} · ${space.visibility === "private" ? "私有" : "共享"}`,
          value: space.id,
        }))}
        placeholder="选择 Space"
        value={controller.context.spaceId || undefined}
      />
    </>
  );
}

function ContextToolbar({
  controller,
}: Readonly<{ controller: PlanningControllerResult }>) {
  return (
    <WorkbenchToolbar label="Planning 上下文操作">
      <div className={styles.desktopContextControls}>
        <ContextSelectors controller={controller} />
        <span className={styles.toolbarSpacer} />
        <WorkbenchTooltip content="同步当前 Workspace">
          <button
            aria-label="同步当前 Workspace"
            className={styles.iconButton}
            disabled={!controller.capabilities.canSync}
            onClick={() => void controller.commands.synchronize()}
            type="button"
          >
            <AppIcon name="refresh" size={16} />
          </button>
        </WorkbenchTooltip>
      </div>
      <div className={styles.mobileContextControls}>
        <WorkbenchPopover
          align="end"
          trigger={
            <button
              aria-label="切换上下文或同步"
              className={styles.iconButton}
              type="button"
            >
              <AppIcon name="more" size={16} />
            </button>
          }
        >
          <div className={styles.contextPopover}>
            <ContextSelectors controller={controller} />
            <button
              className={styles.secondaryButton}
              disabled={!controller.capabilities.canSync}
              onClick={() => void controller.commands.synchronize()}
              type="button"
            >
              <AppIcon name="refresh" size={15} />
              同步当前 Workspace
            </button>
          </div>
        </WorkbenchPopover>
      </div>
    </WorkbenchToolbar>
  );
}

function NewGoalSheet({
  controller,
  onOpenChange,
  open,
}: Readonly<{
  controller: PlanningControllerResult;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}>) {
  const formId = useId();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    const goalId = await controller.commands.createGoal({
      criterion: String(data.get("criterion") ?? ""),
      description: String(data.get("description") ?? ""),
      desiredOutcome: String(data.get("outcome") ?? ""),
      phaseMinutes: Number(data.get("phase_minutes") ?? 0),
      phaseTitle: String(data.get("phase_title") ?? ""),
      targetDate: String(data.get("target_date") ?? ""),
      title: String(data.get("title") ?? ""),
      weeklyMinutes: Number(data.get("weekly_minutes") ?? 0),
    });
    setPending(false);
    if (!goalId) return;
    form.reset();
    onOpenChange(false);
  }

  return (
    <WorkbenchSheet
      description="目标与首个阶段作为完整离线聚合保存；恢复网络后继续 sync-v1。"
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
            {pending ? "正在保存" : "保存目标"}
          </button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      title="新建目标"
      trigger={
        <button
          className={styles.primaryButton}
          data-workbench-primary={
            controller.capabilities.canCreate ? "true" : undefined
          }
          disabled={!controller.capabilities.canCreate}
          id="planning-new-goal"
          type="button"
        >
          <AppIcon name="plus" size={16} />
          新建目标
        </button>
      }
    >
      <form className={styles.sheetForm} id={formId} onSubmit={submit}>
        <label htmlFor={`${formId}-title`}>目标名称</label>
        <input
          autoFocus
          id={`${formId}-title`}
          maxLength={160}
          name="title"
          required
        />
        <label htmlFor={`${formId}-outcome`}>可验收成果</label>
        <textarea
          id={`${formId}-outcome`}
          maxLength={5000}
          name="outcome"
          required
          rows={3}
        />
        <details className={styles.secondaryFields}>
          <summary>背景与时间约束</summary>
          <div>
            <label htmlFor={`${formId}-description`}>背景说明</label>
            <textarea
              id={`${formId}-description`}
              maxLength={10000}
              name="description"
              rows={2}
            />
            <div className={styles.fieldGrid}>
              <label>
                <span>每周投入（分钟）</span>
                <input
                  defaultValue={360}
                  max={10080}
                  min={0}
                  name="weekly_minutes"
                  required
                  type="number"
                />
              </label>
              <label>
                <span>目标日期</span>
                <input name="target_date" type="date" />
              </label>
            </div>
          </div>
        </details>
        <div className={styles.formDivider}>
          <strong>首个阶段</strong>
          <span>只规划下一段可检查的成果。</span>
        </div>
        <label htmlFor={`${formId}-phase`}>阶段名称</label>
        <input
          id={`${formId}-phase`}
          maxLength={160}
          name="phase_title"
          required
        />
        <div className={styles.fieldGrid}>
          <label>
            <span>预计分钟</span>
            <input
              defaultValue={600}
              max={1000000}
              min={0}
              name="phase_minutes"
              required
              type="number"
            />
          </label>
          <label>
            <span>验收标准</span>
            <input maxLength={500} name="criterion" required />
          </label>
        </div>
      </form>
    </WorkbenchSheet>
  );
}

function UnlockSheet({
  controller,
  onOpenChange,
  open,
  restoreFocusRef,
}: Readonly<{
  controller: PlanningControllerResult;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  restoreFocusRef: React.RefObject<HTMLElement | null>;
}>) {
  const formId = useId();
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    const unlocked = await controller.commands.unlock(
      String(data.get("passphrase") ?? ""),
    );
    setPending(false);
    if (!unlocked) return;
    form.reset();
    onOpenChange(false);
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
          <button
            className={styles.primaryButton}
            disabled={pending}
            form={formId}
            type="submit"
          >
            {pending ? "正在解锁" : "解锁资料"}
          </button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      restoreFocusRef={restoreFocusRef}
      title="解锁本地资料"
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

export function PlanningWorkbench({
  controller,
}: Readonly<{ controller: PlanningControllerResult }>) {
  const [newGoalOpen, setNewGoalOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const unlockButtonRef = useRef<HTMLButtonElement>(null);
  const header = (
    <WorkbenchHeader
      actions={
        controller.context.unlocked ? (
          <NewGoalSheet
            controller={controller}
            onOpenChange={setNewGoalOpen}
            open={newGoalOpen}
          />
        ) : (
          <button
            className={styles.primaryButton}
            data-workbench-primary={
              controller.capabilities.canUnlock ? "true" : undefined
            }
            disabled={!controller.capabilities.canUnlock}
            id="planning-unlock"
            onClick={() => setUnlockOpen(true)}
            ref={unlockButtonRef}
            type="button"
          >
            <AppIcon name="unlock" size={16} />
            解锁资料
          </button>
        )
      }
      description="目标 → 阶段顺序与验收标准 → Today 任务；离线保存完整初始聚合。"
      eyebrow="PLANNING · GOALS & ROUTES"
      title="目标与路线"
    />
  );

  return (
    <main className={styles.root} id="main-content">
      <WorkbenchFrame
        context={
          <WorkbenchContextBar context={controller.context.operational} />
        }
        header={header}
        initialPane="master"
        inspector={<PlanningInspector controller={controller} />}
        inspectorLabel="目标 Inspector"
        label="Planning 目标与路线工作台"
        main={<PlanningMain controller={controller} />}
        mainLabel="阶段路线"
        master={<GoalMaster controller={controller} />}
        masterLabel="目标列表"
        toolbar={<ContextToolbar controller={controller} />}
      />
      <UnlockSheet
        controller={controller}
        onOpenChange={setUnlockOpen}
        open={unlockOpen}
        restoreFocusRef={unlockButtonRef}
      />
    </main>
  );
}
