/* @vitest-environment jsdom */

import type { LocalEntity } from "@logion/offline";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TodayWorkbench } from "./today-workbench";
import type {
  TodayControllerResult,
  TodayGoalPayload,
  TodayLocalView,
  TodayTaskPayload,
} from "./use-today-controller";

afterEach(cleanup);

function entity(id: string, type: string): LocalEntity {
  return {
    created_at: "2026-08-26T00:00:00.000Z",
    entity_id: id,
    entity_type: type,
    server_version: 1,
    sync_status: "clean",
  } as LocalEntity;
}

function controllerFixture() {
  const task: TodayLocalView<TodayTaskPayload> = {
    entity: entity("task-1", "task"),
    payload: {
      blocked_reason: null,
      description: "完成精读并记录可检查的结论。",
      due_at: null,
      estimated_minutes: 45,
      goal_id: "goal-1",
      phase_id: "phase-1",
      planned_at: "2026-08-26T00:00:00.000Z",
      priority: 3,
      space_id: "space-1",
      status: "planned",
      title: "精读 Raft 论文",
    },
  };
  const goal: TodayLocalView<TodayGoalPayload> = {
    entity: entity("goal-1", "learning_goal"),
    payload: {
      phases: [{ id: "phase-1", title: "论文精读" }],
      space_id: "space-1",
      title: "掌握分布式系统",
    },
  };
  const commands = {
    closeVerifiedTask: vi.fn(async () => true),
    createTask: vi.fn(async () => true),
    decideVerification: vi.fn(async () => true),
    finishSession: vi.fn(async () => true),
    loadContext: vi.fn(async () => undefined),
    setSelectedTaskId: vi.fn(),
    setSpaceId: vi.fn(),
    setWorkspaceId: vi.fn(),
    startSession: vi.fn(async () => true),
    submitEvidence: vi.fn(async () => true),
    synchronize: vi.fn(async () => undefined),
    transitionTask: vi.fn(async () => true),
    unlock: vi.fn(async () => true),
  };
  const controller: TodayControllerResult = {
    capabilities: { canSync: true, canUnlock: true, canWrite: true },
    commands,
    context: {
      operational: {
        permission: { label: "owner", tone: "good" },
        space: { id: "space-1", name: "私有空间" },
        sync: { label: "已同步", tone: "good" },
        vault: { label: "已解锁", tone: "good" },
        workspace: { id: "workspace-1", name: "Logion" },
      },
      operationalState: null,
      spaceId: "space-1",
      spaces: [
        { id: "space-1", name: "私有空间" },
      ] as TodayControllerResult["context"]["spaces"],
      status: "本地资料已在应用内解锁。",
      unlocked: true,
      workspaceId: "workspace-1",
      workspaces: [
        { id: "workspace-1", name: "Logion", role: "owner" },
      ] as TodayControllerResult["context"]["workspaces"],
    },
    persona: {
      dashboardModel: {
        description: "只使用真实学习记录。",
        empty: false,
        eyebrow: "LEARNING PROJECTS",
        metrics: [
          {
            detail: "最近 7 天已完成会话",
            label: "本周专注",
            source: "study_session.manual_minutes",
            value: "74m",
          },
          {
            detail: "当前 Space 的成果",
            label: "成果数量",
            source: "deliverable",
            value: 2,
          },
          {
            detail: "由用户明确确认",
            label: "掌握确认",
            source: "mastery.confirmed_level",
            value: 3,
          },
          {
            detail: "等待明确人工决定",
            label: "待验收",
            source: "verification.verdict",
            value: 1,
          },
        ],
        primaryAction: {
          description: "继续推进真实项目。",
          href: "/app/self-study",
          label: "打开学习项目",
          title: "推进下一项里程碑",
        },
        steps: [],
        title: "让目标与成果形成连续进展",
      },
      dashboardSource: {
        members: [],
        membersAvailable: true,
        now: new Date("2026-08-26T00:00:00.000Z"),
        records: [],
        selectedSpaceId: "space-1",
        sessions: [],
        spaces: [{ id: "space-1", visibility: "private" }],
        tasks: [],
      },
      dashboardState: "ready",
    },
    references: { notes: [], resources: [] },
    selection: { taskId: "task-1" },
    viewModel: {
      actionableTasks: [task],
      blockedTaskCount: 0,
      completedMinutes: 0,
      completedTaskCount: 0,
      completionRate: 0,
      conflictCount: 0,
      nextTask: task,
      pendingVerificationCount: 0,
      queue: [task],
      selectedTask: task,
      visibleEvidence: [],
      visibleGoals: [goal],
      visibleSessions: [],
      visibleTasks: [task],
      visibleVerifications: [],
    },
  };
  return { commands, controller };
}

describe("Today workbench", () => {
  it("keeps Vault feedback visible while the workbench is locked", () => {
    const { controller } = controllerFixture();
    controller.context.status =
      "本地资料操作未完成（OFFLINE_BOOTSTRAP_CONTEXT_MISMATCH）。";
    controller.context.unlocked = false;
    controller.capabilities.canUnlock = false;

    render(<TodayWorkbench controller={controller} />);

    expect(screen.getByRole("heading", { name: "解锁今日资料" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("本地资料口令"), {
      target: { value: "correct horse battery staple" },
    });
    expect(
      (screen.getByRole("button", { name: "解锁" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByRole("status").textContent).toContain(
      "OFFLINE_BOOTSTRAP_CONTEXT_MISMATCH",
    );
    expect(
      document.querySelectorAll('[data-workbench-primary="true"]'),
    ).toHaveLength(1);
  });

  it("renders Queue, NEXT ACTION and Inspector with one formal primary", () => {
    const { commands, controller } = controllerFixture();
    render(<TodayWorkbench controller={controller} />);

    expect(
      screen.getByRole("complementary", { name: "今日序列" }),
    ).toBeTruthy();
    expect(screen.getByRole("region", { name: "NEXT ACTION" })).toBeTruthy();
    expect(
      screen.getByRole("complementary", { name: "任务 Inspector" }),
    ).toBeTruthy();
    expect(
      document.querySelectorAll('[data-workbench-primary="true"]'),
    ).toHaveLength(1);
    expect(
      screen.getByRole("heading", { name: "证据与人工验收" }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "今日信号" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "执行趋势" })).toBeTruthy();
    expect(screen.queryByLabelText("选择 Workspace")).toBeNull();
    expect(screen.queryByLabelText("选择 Space")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "开始专注" }));
    expect(commands.startSession).toHaveBeenCalledWith("task-1");
  });

  it("creates a task from the secondary Sheet without losing known context", async () => {
    const { commands, controller } = controllerFixture();
    render(<TodayWorkbench controller={controller} />);

    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "任务名称" }), {
      target: { value: "完成一致性模型笔记" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存任务" }));

    await waitFor(() =>
      expect(commands.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          goalId: "goal-1",
          phaseId: null,
          title: "完成一致性模型笔记",
        }),
      ),
    );
    expect(screen.getAllByText("Logion").length).toBeGreaterThan(0);
    expect(screen.getAllByText("私有空间").length).toBeGreaterThan(0);
  });

  it("keeps Queue, NEXT ACTION and Inspector in one continuous DOM flow", () => {
    const { controller } = controllerFixture();
    render(<TodayWorkbench controller={controller} />);

    const grid = document.querySelector(".workbench-grid");
    expect(grid?.children).toHaveLength(3);
    expect(grid?.children[0]?.getAttribute("data-testid")).toBe(
      "workbench-master",
    );
    expect(grid?.children[1]?.getAttribute("data-testid")).toBe(
      "workbench-main",
    );
    expect(grid?.children[2]?.getAttribute("data-testid")).toBe(
      "workbench-inspector",
    );
    expect(screen.getByTestId("today-trend")).toBeTruthy();
  });
});
