"use client";

import type { components } from "@logion/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { errorMessage, workbenchRequest } from "./api";
import { Button, Menu, Sheet } from "./components";
import { useWorkbench } from "./provider";

type Goal = components["schemas"]["OnlineGoalView"];
type Phase = components["schemas"]["PhaseRevision"] & {
  removal_allowed: boolean;
};

export function GoalList({
  scope,
  goals,
  pending,
}: {
  scope: string;
  goals: Goal[];
  pending: boolean;
}) {
  const client = useQueryClient();
  const { context, workspaces, spaces } = useWorkbench();
  const role = workspaces.find((w) => w.id === context?.workspace_id)?.role;
  const writable =
    spaces.find((s) => s.id === context?.space_id)?.visibility === "private" ||
    ["owner", "admin", "editor"].includes(role ?? "");
  const capabilities = useQuery({
    queryKey: ["workbench", "planning-capabilities", scope],
    queryFn: () =>
      workbenchRequest<components["schemas"]["PlanningCapabilities"]>(
        `${scope}/goals/capabilities`,
      ),
  });
  const [reloadError, setReloadError] = useState<unknown>(null);
  const [editing, setEditing] = useState<{
    goal: Goal;
    kind: "basic" | "phases";
  } | null>(null);
  const invalidate = () =>
    client.invalidateQueries({ queryKey: ["workbench", "goals", scope] });
  const publish = useMutation({
    mutationFn: (goal: Goal) =>
      workbenchRequest(`${scope}/research/goals/${goal.goal_id}/publish`, {
        method: "POST",
        body: JSON.stringify({
          expected_goal_version: goal.goal_version,
          expected_plan_version: goal.plan_version,
        }),
      }),
    onSuccess: invalidate,
  });
  return (
    <section className="wb-goal-section" aria-label="目标与阶段">
      <h2>目标与阶段</h2>
      {pending && <p role="status">正在载入目标…</p>}
      {!pending && !goals.length && (
        <p className="wb-muted">先建一个目标，再安排阅读和验收阶段。</p>
      )}
      {(capabilities.error || publish.error) && (
        <p role="alert">
          {errorMessage(capabilities.error || publish.error)}{" "}
          <Button
            onClick={() => {
              void capabilities.refetch();
              void invalidate();
              publish.reset();
            }}
          >
            载入最新版本
          </Button>
        </p>
      )}
      <ul className="wb-goal-list">
        {goals.map((goal) => (
          <li key={goal.goal_id}>
            <details>
              <summary>
                <strong>{goal.title}</strong>
                <span className="wb-muted">
                  {
                    {
                      draft: "草稿",
                      active: "进行中",
                      completed: "已完成",
                      archived: "已归档",
                    }[goal.goal_status]
                  }{" "}
                  · 每周 {goal.weekly_minutes} 分钟
                  {goal.target_date ? ` · 截止 ${goal.target_date}` : ""}
                </span>
              </summary>
              <p className="wb-goal-text">{goal.desired_outcome}</p>
              {goal.description && (
                <p className="wb-muted wb-goal-text">{goal.description}</p>
              )}
              <ol className="wb-goal-phases">
                {goal.phases
                  .filter((p) => !p.archived_at)
                  .map((phase) => (
                    <li key={phase.id}>
                      <h3>
                        {phase.title}{" "}
                        <span className="wb-muted">
                          {phase.estimated_minutes} 分钟
                        </span>
                      </h3>
                      {phase.description && <p>{phase.description}</p>}
                      <ul>
                        {phase.acceptance_criteria.map((criterion) => (
                          <li key={criterion}>{criterion}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
              </ol>
              {goal.phases.some((p) => p.archived_at) && (
                <details>
                  <summary>已归档阶段</summary>
                  <ul>
                    {goal.phases
                      .filter((p) => p.archived_at)
                      .map((phase) => (
                        <li key={phase.id}>{phase.title}</li>
                      ))}
                  </ul>
                </details>
              )}
              {writable && (
                <div className="wb-research-actions">
                  {capabilities.data?.phase_revision_enabled && (
                    <>
                      <Button
                        onClick={() => setEditing({ goal, kind: "basic" })}
                      >
                        编辑目标
                      </Button>
                      <Button
                        onClick={() => setEditing({ goal, kind: "phases" })}
                      >
                        编辑阶段
                      </Button>
                    </>
                  )}
                  {goal.goal_status === "draft" && (
                    <Button
                      disabled={publish.isPending}
                      onClick={() => publish.mutate(goal)}
                    >
                      启用计划
                    </Button>
                  )}
                </div>
              )}
              {!capabilities.data?.phase_revision_enabled &&
                capabilities.isSuccess && (
                  <p className="wb-muted">当前服务器未开启目标和阶段修订。</p>
                )}
            </details>
          </li>
        ))}
      </ul>
      <Sheet
        title={editing?.kind === "phases" ? "编辑阶段" : "编辑目标"}
        description="保存会检查版本；其他页面的修改不会被静默覆盖。"
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        {!!reloadError && <p role="alert">{errorMessage(reloadError)}</p>}
        {editing && (
          <div
            key={`${editing.goal.goal_id}/${editing.goal.goal_version}/${editing.kind}`}
          >
            {editing.kind === "basic" ? (
              <GoalEditor
                scope={scope}
                goal={editing.goal}
                onSaved={async () => {
                  await invalidate();
                  setEditing(null);
                }}
              />
            ) : (
              <PhaseEditor
                scope={scope}
                goal={editing.goal}
                onSaved={async () => {
                  await invalidate();
                  setEditing(null);
                }}
              />
            )}
            <Button
              onClick={async () => {
                setReloadError(null);
                try {
                  const page = await client.fetchQuery({
                    queryKey: ["workbench", "goals", scope],
                    staleTime: 0,
                    queryFn: () =>
                      workbenchRequest<components["schemas"]["OnlineGoalPage"]>(
                        `${scope}/research/goals`,
                      ),
                  });
                  const fresh = page.goals.find(
                    (g) => g.goal_id === editing.goal.goal_id,
                  );
                  if (fresh) setEditing({ ...editing, goal: fresh });
                  else setReloadError(new Error("Goal unavailable"));
                } catch (error) {
                  setReloadError(error);
                }
              }}
            >
              放弃当前输入并载入最新版本
            </Button>
          </div>
        )}
      </Sheet>
    </section>
  );
}

export function GoalEditor({
  scope,
  goal,
  onSaved,
}: {
  scope: string;
  goal?: Goal;
  onSaved: () => void | Promise<void>;
}) {
  const [title, setTitle] = useState(goal?.title ?? "");
  const [outcome, setOutcome] = useState(goal?.desired_outcome ?? "");
  const [description, setDescription] = useState(goal?.description ?? "");
  const [minutes, setMinutes] = useState(goal?.weekly_minutes ?? 120);
  const [target, setTarget] = useState(goal?.target_date ?? "");
  const [phase, setPhase] = useState("");
  const [criterion, setCriterion] = useState("");
  // Stable IDs let an uncertain network outcome be reconciled by reloading.
  const [ids] = useState(() => ({
    goal_id: crypto.randomUUID(),
    plan_id: crypto.randomUUID(),
    plan_version_id: crypto.randomUUID(),
    phase_id: crypto.randomUUID(),
  }));
  const save = useMutation({
    mutationFn: () =>
      workbenchRequest(
        `${scope}/research/goals${goal ? `/${goal.goal_id}` : ""}`,
        {
          method: goal ? "PATCH" : "POST",
          body: JSON.stringify({
            title,
            desired_outcome: outcome,
            description,
            weekly_minutes: minutes,
            target_date: target || null,
            ...(goal
              ? { expected_version: goal.goal_version }
              : {
                  goal_id: ids.goal_id,
                  plan_id: ids.plan_id,
                  plan_version_id: ids.plan_version_id,
                  phases: [
                    {
                      id: ids.phase_id,
                      title: phase,
                      position: 0,
                      estimated_minutes: 120,
                      acceptance_criteria: [criterion],
                    },
                  ],
                }),
          }),
        },
      ),
    onSuccess: onSaved,
  });
  return (
    <form
      className="wb-weekly-form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      {save.error && <p role="alert">{errorMessage(save.error)}</p>}
      <fieldset className="wb-goal-fields" disabled={save.isPending}>
        <label>
          目标名称
          <input
            required
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          期望成果
          <textarea
            required
            maxLength={5000}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
          />
        </label>
        <label>
          目标说明
          <textarea
            maxLength={10000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label>
          每周投入（分钟）
          <input
            type="number"
            required
            min={0}
            max={10080}
            value={minutes}
            onChange={(e) => setMinutes(e.target.valueAsNumber)}
          />
        </label>
        <label>
          目标日期（可留空）
          <input
            type="date"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </label>
        {!goal && (
          <>
            <label>
              首个阶段
              <input
                required
                maxLength={160}
                value={phase}
                onChange={(e) => setPhase(e.target.value)}
              />
            </label>
            <label>
              阶段验收标准
              <textarea
                required
                maxLength={500}
                value={criterion}
                onChange={(e) => setCriterion(e.target.value)}
              />
            </label>
          </>
        )}
        <Button type="submit" disabled={save.isPending}>
          保存目标
        </Button>
      </fieldset>
    </form>
  );
}

function PhaseEditor({
  scope,
  goal,
  onSaved,
}: {
  scope: string;
  goal: Goal;
  onSaved: () => void | Promise<void>;
}) {
  const [phases, setPhases] = useState<Phase[]>(() =>
    goal.phases.map((p) => ({
      ...p,
      archived: !!p.archived_at,
      removed: false,
    })),
  );
  const [confirmed, setConfirmed] = useState(false);
  const update = (id: string, value: Partial<Phase>) =>
    setPhases((rows) =>
      rows.map((row) => (row.id === id ? { ...row, ...value } : row)),
    );
  const move = (index: number, direction: number) =>
    setPhases((rows) => {
      const result = [...rows];
      const current = result[index];
      const target = result[index + direction];
      if (!current || !target) return rows;
      result[index] = target;
      result[index + direction] = current;
      return result;
    });
  const save = useMutation({
    mutationFn: () =>
      workbenchRequest(`${scope}/research/goals/${goal.goal_id}/phases`, {
        method: "PUT",
        body: JSON.stringify({
          expected_version: goal.goal_version,
          phases: phases.map((p) => ({
            id: p.id,
            title: p.title,
            description: p.description,
            estimated_minutes: p.estimated_minutes,
            acceptance_criteria: p.acceptance_criteria,
            archived: p.archived,
            removed: p.removed,
          })),
        }),
      }),
    onSuccess: onSaved,
  });
  const removed = phases.some((p) => p.removed);
  return (
    <form
      className="wb-weekly-form"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <p className="wb-muted">
        使用上移、下移调整顺序。已有任务引用的阶段只能归档，归档后可以恢复。
      </p>
      {save.error && <p role="alert">{errorMessage(save.error)}</p>}
      {phases.map((phase, index) => (
        <fieldset
          className="wb-phase-editor"
          key={phase.id}
          disabled={save.isPending}
        >
          <legend>
            阶段 {index + 1}
            {phase.archived ? " · 已归档" : ""}
            {phase.removed ? " · 待移除" : ""}
          </legend>
          {phase.removed ? (
            <>
              <p>{phase.title}</p>
              <Button onClick={() => update(phase.id, { removed: false })}>
                撤销移除
              </Button>
            </>
          ) : (
            <>
              <label>
                阶段名称
                <input
                  required
                  maxLength={160}
                  value={phase.title}
                  onChange={(e) => update(phase.id, { title: e.target.value })}
                />
              </label>
              <label>
                阶段说明
                <textarea
                  maxLength={10000}
                  value={phase.description}
                  onChange={(e) =>
                    update(phase.id, { description: e.target.value })
                  }
                />
              </label>
              <label>
                预计投入（分钟）
                <input
                  type="number"
                  required
                  min={0}
                  max={1000000}
                  value={phase.estimated_minutes}
                  onChange={(e) =>
                    update(phase.id, {
                      estimated_minutes: e.target.valueAsNumber,
                    })
                  }
                />
              </label>
              <label>
                验收标准（每行一条，最多 50 条）
                <textarea
                  required
                  value={phase.acceptance_criteria.join("\n")}
                  onChange={(e) =>
                    update(phase.id, {
                      acceptance_criteria: e.target.value.split("\n"),
                    })
                  }
                />
              </label>
              <div className="wb-research-actions">
                <Button disabled={index === 0} onClick={() => move(index, -1)}>
                  上移
                </Button>
                <Button
                  disabled={index === phases.length - 1}
                  onClick={() => move(index, 1)}
                >
                  下移
                </Button>
                <Button
                  onClick={() =>
                    update(phase.id, { archived: !phase.archived })
                  }
                >
                  {phase.archived ? "恢复阶段" : "归档阶段"}
                </Button>
                <Menu
                  label={`阶段 ${index + 1} 的更多操作`}
                  items={[
                    {
                      label: "移除阶段",
                      disabled: !phase.removal_allowed,
                      action: () => {
                        if (goal.phases.some((p) => p.id === phase.id))
                          update(phase.id, { removed: true });
                        else
                          setPhases((rows) =>
                            rows.filter((p) => p.id !== phase.id),
                          );
                        setConfirmed(false);
                      },
                    },
                  ]}
                />
              </div>
              {!phase.removal_allowed && (
                <p className="wb-muted">已有任务引用，不能移除。</p>
              )}
            </>
          )}
        </fieldset>
      ))}
      <Button
        disabled={save.isPending || phases.length >= 100}
        onClick={() =>
          setPhases((rows) => [
            ...rows,
            {
              id: crypto.randomUUID(),
              title: "",
              description: "",
              estimated_minutes: 30,
              acceptance_criteria: [""],
              archived: false,
              removed: false,
              removal_allowed: true,
            },
          ])
        }
      >
        添加阶段
      </Button>
      {removed && (
        <label className="wb-weekly-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          确认移除标记的阶段；保存后无法恢复。
        </label>
      )}
      <Button
        type="submit"
        disabled={
          save.isPending ||
          (removed && !confirmed) ||
          !phases.some((p) => !p.archived && !p.removed)
        }
      >
        保存阶段
      </Button>
    </form>
  );
}
