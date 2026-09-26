/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProductOperationalState } from "@/components/product/product-workbench-state";

import { PlanningWorkbench } from "./planning-workbench";
import type { PlanningControllerResult } from "./use-planning-controller";

afterEach(cleanup);

function controller(
  operationalState: ProductOperationalState | null = null,
): PlanningControllerResult {
  const phase = {
    acceptance_criteria: ["能够讲清一致性模型"],
    description: "建立基础",
    estimated_minutes: 180,
    id: "phase-1",
    position: 0,
    title: "一致性模型",
  };
  const goal = {
    id: "goal-1",
    payload: {
      description: "形成完整知识地图",
      desired_outcome: "提交一份可验收的系统设计说明",
      phases: [phase],
      space_id: "space-1",
      target_date: "2026-11-30",
      title: "系统掌握分布式系统基础",
      weekly_minutes: 420,
    },
    syncStatus: "clean",
    updatedAt: "2026-08-26T12:00:00.000Z",
  };
  return {
    capabilities: {
      canCreate: true,
      canSync: true,
      canUnlock: true,
      canWrite: true,
      phaseRevisionEnabled: true,
    },
    commands: {
      createGoal: vi.fn(),
      revisePhases: vi.fn(),
      loadContext: vi.fn(),
      selectGoal: vi.fn(),
      reportDeletion: vi.fn(),
      setSpaceId: vi.fn(),
      setWorkspaceId: vi.fn(),
      synchronize: vi.fn(),
      recoverSnapshot: vi.fn(),
      unlock: vi.fn(),
    },
    context: {
      online: true,
      operational: {
        permission: { label: "owner", tone: "good" },
        persona: { id: "self", name: "自学" },
        space: { id: "space-1", name: "私有空间" },
        sync: { label: "已同步", tone: "good" },
        vault: { label: "已解锁", tone: "good" },
        workspace: { id: "workspace-1", name: "个人工作区" },
      },
      operationalState,
      spaceId: "space-1",
      spaces: [
        {
          created_at: "2026-08-26T12:00:00.000Z",
          id: "space-1",
          name: "私有空间",
          owner_user_id: "user-1",
          status: "active",
          updated_at: "2026-08-26T12:00:00.000Z",
          version: 1,
          visibility: "private",
          workspace_id: "workspace-1",
        },
      ],
      status: "目标、阶段和关联任务已读取。",
      unlocked: true,
      workspaceId: "workspace-1",
      workspaces: [
        {
          created_at: "2026-08-26T12:00:00.000Z",
          id: "workspace-1",
          membership_status: "active",
          name: "个人工作区",
          role: "owner",
          status: "active",
          updated_at: "2026-08-26T12:00:00.000Z",
          version: 1,
        },
      ],
    },
    viewModel: {
      archivedPhases: [],
      conflictCount: 0,
      missingAcceptanceCriteria: 0,
      phaseSequence: [
        {
          ...phase,
          priorPhaseTitle: null,
        },
      ],
      plannedMinutes: 180,
      readiness: 100,
      selectedGoal: goal,
      tasks: [
        {
          id: "task-1",
          payload: {
            estimated_minutes: 45,
            goal_id: "goal-1",
            phase_id: "phase-1",
            space_id: "space-1",
            status: "planned",
            title: "阅读一致性论文",
          },
          syncStatus: "clean",
          updatedAt: "2026-08-26T12:00:00.000Z",
        },
      ],
      tasksByPhase: {},
      unassignedTasks: [],
      visibleGoals: [goal],
    },
  };
}

describe("Planning workbench", () => {
  it("renders the GLM master, route and inspector with one page primary", () => {
    const html = renderToStaticMarkup(
      <PlanningWorkbench controller={controller()} />,
    );

    expect(html).toContain("GOAL MASTER");
    expect(html).toContain("阶段与路线顺序");
    expect(html).toContain("目标详情");
    expect(html).toContain("阅读一致性论文");
    expect(html).toContain("position 仅表示路线顺序，不代表强依赖");
    expect(html).toContain('data-testid="planning-goals"');
    expect(html).toContain('data-testid="planning-stages"');
    expect(html).toContain('data-testid="planning-dependencies"');
    expect(html).toContain('data-testid="planning-tasks"');
    expect(html).toContain('data-testid="planning-inspector"');
    expect(html.match(/data-workbench-primary="true"/g)).toHaveLength(1);
    expect(html).not.toContain("发布目标");
  });

  it("uses unlock as the only page primary while the vault is locked", () => {
    const lockedController = controller();
    lockedController.context.unlocked = false;
    lockedController.capabilities.canCreate = false;

    const html = renderToStaticMarkup(
      <PlanningWorkbench controller={lockedController} />,
    );

    expect(html).toContain('id="planning-unlock"');
    expect(html).toContain("本地规划资料已锁定");
    expect(html.match(/data-workbench-primary="true"/g)).toHaveLength(1);
    expect(html).not.toContain('id="planning-new-goal"');
  });

  it("keeps route editing visible and disabled until the server enables it", () => {
    const value = controller();
    value.capabilities.phaseRevisionEnabled = false;
    const html = renderToStaticMarkup(<PlanningWorkbench controller={value} />);

    expect(html).toContain("编辑路线，服务端尚未开启");
    expect(html).toContain("disabled");
    expect(html).toContain("强依赖与发布操作需要服务端读写合同支持");
  });

  it("opens the route editor and revises phases in the chosen order", async () => {
    const value = controller();
    value.commands.revisePhases = vi.fn(async () => true);
    render(<PlanningWorkbench controller={value} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑路线" }));
    const sheet = await screen.findByRole("dialog", { name: "编辑路线" });
    fireEvent.click(within(sheet).getByRole("button", { name: "追加阶段" }));
    const names = within(sheet).getAllByLabelText("阶段名称");
    fireEvent.change(names[names.length - 1]!, {
      target: { value: "新增阶段" },
    });
    const criteria = within(sheet).getAllByLabelText("验收标准（每行一条）");
    fireEvent.change(criteria[criteria.length - 1]!, {
      target: { value: "完成检查" },
    });
    fireEvent.click(
      within(sheet).getByRole("button", { name: "上移 新增阶段" }),
    );
    fireEvent.click(within(sheet).getByRole("button", { name: "保存路线" }));
    await waitFor(() => expect(value.commands.revisePhases).toHaveBeenCalled());
    const [, phases] = vi.mocked(value.commands.revisePhases).mock.calls[0]!;
    expect(phases.map((phase) => phase.title).at(-2)).toBe("新增阶段");
    expect(phases.every((phase) => phase.acceptance_criteria.length > 0)).toBe(
      true,
    );
  });
});
