"use client";

import type { components } from "@logion/contracts";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { errorMessage, workbenchRequest } from "./api";
import { Button, Menu, Sheet } from "./components";
import { useWorkbench } from "./provider";
import { readingAiError } from "./reading-ai";
import "./weekly-plan.css";

type Task = components["schemas"]["ReadingTaskView"];
type Review = components["schemas"]["WeeklyReviewView"];
type Plan = components["schemas"]["WeeklyPlanView"];
type Goal = components["schemas"]["GoalPlanResponse"];
type RunResult = components["schemas"]["ResearchRunResult"];
type Triage = components["schemas"]["WeeklyTriage"];
const modes = { close_read: "精读", skim: "略读" };

function dayString(day: Date) {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}
function monday(value = dayString(new Date())) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return dayString(date);
}
function shift(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return dayString(date);
}

export function WeeklyPlan() {
  const { context } = useWorkbench();
  if (!context)
    return <div className="wb-empty">请先选择一个可访问的空间。</div>;
  const scope = `/api/v1/workspaces/${context.workspace_id}/spaces/${context.space_id}`;
  return <PlanScope key={scope} scope={scope} />;
}

function PlanScope({ scope }: { scope: string }) {
  const client = useQueryClient();
  const [week, setWeek] = useState(monday);
  const [editor, setEditor] = useState<Task | "new" | null>(null);
  const [goalEditor, setGoalEditor] = useState(false);
  const path = `${scope}/research/weekly`;
  const key = ["workbench", "weekly", path, week];
  const plan = useQuery({
    queryKey: key,
    queryFn: () =>
      workbenchRequest<Plan>(path, { query: { week_start: week } }),
  });
  const goals = useQuery({
    queryKey: ["workbench", "goals", scope],
    queryFn: () =>
      workbenchRequest<components["schemas"]["GoalPlanListResponse"]>(
        `${scope}/goals`,
      ),
  });
  const action = useMutation({
    mutationFn: async ({
      suffix,
      body,
      method = "POST",
    }: {
      suffix: string;
      body: unknown;
      method?: "POST" | "PUT";
    }) =>
      workbenchRequest(`${path}${suffix}`, {
        method,
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: ["workbench", "weekly", path],
      });
    },
  });
  const closed = !!plan.data?.review?.closed_at;
  const error = plan.error || action.error || goals.error;
  return (
    <div className="wb-page wb-weekly-page">
      <div className="wb-page-heading">
        <div>
          <h1>计划</h1>
          <p>安排本周阅读，为每个未完成项选好下一步。</p>
        </div>
        <div className="wb-research-actions">
          <Button onClick={() => setGoalEditor(true)}>新建目标</Button>
          <Button
            className="wb-primary"
            disabled={closed || !plan.data}
            onClick={() => setEditor("new")}
          >
            添加阅读计划
          </Button>
        </div>
      </div>
      <nav className="wb-week-navigation" aria-label="选择计划周">
        <Button
          disabled={action.isPending}
          onClick={() => setWeek(shift(week, -7))}
        >
          上一周
        </Button>
        <label>
          周起始日期
          <input
            type="date"
            min="1970-01-05"
            max="9998-12-21"
            value={week}
            onChange={(e) => {
              if (e.target.value) setWeek(monday(e.target.value));
            }}
          />
        </label>
        <Button
          disabled={action.isPending}
          onClick={() => setWeek(shift(week, 7))}
        >
          下一周
        </Button>
        <Button onClick={() => setWeek(monday())}>本周</Button>
      </nav>
      {error && (
        <p role="alert">
          {errorMessage(error)}{" "}
          <Button
            onClick={() => {
              action.reset();
              void plan.refetch();
              void goals.refetch();
            }}
          >
            载入最新版本
          </Button>
        </p>
      )}
      {plan.isPending && <p role="status">正在载入周计划…</p>}
      {plan.data && (
        <div className="wb-weekly-columns">
          <section className="wb-weekly-tasks" aria-label="本周阅读计划">
            <h2>
              {week} — {shift(week, 6)}
            </h2>
            <p className="wb-muted">
              {plan.data.tasks.filter((t) => t.status === "done").length} /{" "}
              {plan.data.tasks.length} 项完成 · 仅自己可见
              {closed ? " · 本周已确认" : ""}
            </p>
            {plan.data.tasks.length === 0 && (
              <div className="wb-empty">
                <h3>给阅读留一点时间</h3>
                <p>选择目标，安排一篇文献或一个阅读任务。</p>
              </div>
            )}
            <ul className="wb-weekly-task-list">
              {plan.data.tasks.map((task) => (
                <li key={task.id}>
                  <div>
                    <span className="wb-muted">
                      {task.scheduled_on} · {modes[task.reading_mode]} ·{" "}
                      {task.estimated_minutes} 分钟
                    </span>
                    <h3>{task.title}</h3>
                    <p className="wb-muted">
                      {goals.data?.goals.find((g) => g.goal_id === task.goal_id)
                        ?.title ?? "关联目标"}{" "}
                      ·{" "}
                      {task.status === "done"
                        ? "已完成"
                        : task.status === "cancelled"
                          ? "已取消"
                          : "待完成"}
                    </p>
                  </div>
                  <div className="wb-research-actions">
                    {task.resource_id && (
                      <Link
                        className="wb-button"
                        href={`/read/${task.resource_id}`}
                      >
                        打开文献
                      </Link>
                    )}
                    {!closed && task.status !== "done" && (
                      <>
                        <Button
                          disabled={action.isPending}
                          onClick={() =>
                            action.mutate({
                              suffix: `/tasks/${task.id}/decision`,
                              body: {
                                status: "done",
                                expected_version: task.version,
                              },
                            })
                          }
                        >
                          本人确认完成
                        </Button>
                        <Button
                          onClick={() => {
                            action.reset();
                            setEditor(task);
                          }}
                        >
                          编辑
                        </Button>
                      </>
                    )}
                    {!closed && task.status === "done" && (
                      <Menu
                        label={`${task.title}的更多操作`}
                        items={[
                          {
                            label: "重新安排",
                            disabled: action.isPending,
                            action: () =>
                              action.mutate({
                                suffix: `/tasks/${task.id}/decision`,
                                body: {
                                  status: "planned",
                                  expected_version: task.version,
                                },
                              }),
                          },
                        ]}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <section className="wb-weekly-review" aria-label="周回顾">
            <h2>周回顾</h2>
            {!plan.data.review ? (
              <>
                <p>
                  查看本周统计，逐项决定顺延、降级或放弃。确认后才生成下周计划。
                </p>
                <Button
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({
                      suffix: "/reviews",
                      body: {
                        week_start: week,
                        timezone:
                          Intl.DateTimeFormat().resolvedOptions().timeZone,
                      },
                    })
                  }
                >
                  开始周回顾
                </Button>
              </>
            ) : (
              <ReviewPanel
                key={plan.data.review.id}
                scope={scope}
                path={path}
                review={plan.data.review}
                onChange={() => {
                  void client.invalidateQueries({
                    queryKey: ["workbench", "weekly", path],
                  });
                }}
                onNext={() => setWeek(shift(week, 7))}
              />
            )}
          </section>
        </div>
      )}
      <Sheet
        title={editor === "new" ? "添加阅读计划" : "编辑阅读计划"}
        description="阅读计划仅自己可见；目标沿用当前空间的目标和阶段。"
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
      >
        {editor && (
          <TaskEditor
            key={editor === "new" ? "new" : editor.id}
            scope={scope}
            week={week}
            goals={goals.data?.goals ?? []}
            task={editor === "new" ? null : editor}
            onSaved={() => {
              setEditor(null);
              void client.invalidateQueries({
                queryKey: ["workbench", "weekly", path],
              });
            }}
          />
        )}
      </Sheet>
      <Sheet
        title="新建目标"
        description="明确想达到的结果，以及首个阶段的验收标准。"
        open={goalEditor}
        onOpenChange={setGoalEditor}
      >
        {goalEditor && (
          <GoalEditor
            scope={scope}
            onSaved={() => {
              setGoalEditor(false);
              void client.invalidateQueries({
                queryKey: ["workbench", "goals", scope],
              });
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

function TaskEditor({
  scope,
  week,
  goals,
  task,
  onSaved,
}: {
  scope: string;
  week: string;
  goals: Goal[];
  task: Task | null;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [goal, setGoal] = useState(task?.goal_id ?? "");
  const [source, setSource] = useState(task?.resource_id ?? "");
  const [mode, setMode] = useState(task?.reading_mode ?? "close_read");
  const [scheduled, setScheduled] = useState(task?.scheduled_on ?? week);
  const [minutes, setMinutes] = useState(task?.estimated_minutes ?? 30);
  const sources = useInfiniteQuery({
    queryKey: ["workbench", "weekly-sources", scope],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      workbenchRequest<components["schemas"]["LibraryPage"]>(
        `${scope}/library/resources`,
        { query: pageParam ? { cursor: pageParam } : {} },
      ),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
  const papers = sources.data?.pages.flatMap((p) => p.resources) ?? [];
  const save = useMutation({
    mutationFn: () =>
      workbenchRequest(
        `${scope}/research/weekly/tasks${task ? `/${task.id}` : ""}`,
        {
          method: task ? "PUT" : "POST",
          body: JSON.stringify({
            title,
            goal_id: goal,
            resource_id: source || null,
            scheduled_on: scheduled,
            reading_mode: mode,
            estimated_minutes: minutes,
            ...(task ? { expected_version: task.version } : {}),
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
      {(save.error || sources.error) && (
        <p role="alert">{errorMessage(save.error || sources.error)}</p>
      )}
      <label>
        阅读任务
        <input
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        关联目标
        <select required value={goal} onChange={(e) => setGoal(e.target.value)}>
          <option value="">请选择目标</option>
          {goals.map((g) => (
            <option key={g.goal_id} value={g.goal_id}>
              {g.title}
            </option>
          ))}
        </select>
      </label>
      {goals.length === 0 && <p>请先关闭表单，使用“新建目标”定义一个目标。</p>}
      <label>
        文献（可选）
        <select
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            if (!title)
              setTitle(
                papers.find((p) => p.id === e.target.value)?.title ?? "",
              );
          }}
        >
          <option value="">不指定文献</option>
          {source && !papers.some((p) => p.id === source) && (
            <option value={source}>当前关联文献</option>
          )}
          {papers
            .filter((p) => p.reading_status !== "archived")
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
        </select>
      </label>
      {sources.hasNextPage && (
        <Button
          disabled={sources.isFetchingNextPage}
          onClick={() => void sources.fetchNextPage()}
        >
          载入更多文献
        </Button>
      )}
      <label>
        阅读方式
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as Task["reading_mode"])}
        >
          <option value="close_read">精读</option>
          <option value="skim">略读</option>
        </select>
      </label>
      <label>
        计划日期
        <input
          required
          type="date"
          min="1970-01-05"
          max="9998-12-21"
          value={scheduled}
          onChange={(e) => setScheduled(e.target.value)}
        />
      </label>
      <label>
        预计分钟
        <input
          required
          type="number"
          min={0}
          max={1440}
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value))}
        />
      </label>
      <Button
        type="submit"
        className="wb-primary"
        disabled={save.isPending || !goal}
      >
        {save.isPending ? "正在保存…" : "保存阅读计划"}
      </Button>
    </form>
  );
}

function GoalEditor({
  scope,
  onSaved,
}: {
  scope: string;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [outcome, setOutcome] = useState("");
  const [phase, setPhase] = useState("");
  const [criterion, setCriterion] = useState("");
  const save = useMutation({
    mutationFn: () =>
      workbenchRequest(`${scope}/goals`, {
        method: "POST",
        body: JSON.stringify({
          goal_id: crypto.randomUUID(),
          plan_id: crypto.randomUUID(),
          plan_version_id: crypto.randomUUID(),
          title,
          desired_outcome: outcome,
          weekly_minutes: 120,
          phases: [
            {
              id: crypto.randomUUID(),
              title: phase,
              position: 0,
              estimated_minutes: 120,
              acceptance_criteria: [criterion],
            },
          ],
        }),
      }),
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
      <Button type="submit" disabled={save.isPending}>
        保存目标
      </Button>
    </form>
  );
}

function ReviewPanel({
  scope,
  path,
  review,
  onChange,
  onNext,
}: {
  scope: string;
  path: string;
  review: Review;
  onChange: () => void;
  onNext: () => void;
}) {
  const [triage, setTriage] = useState<Record<string, Triage>>({});
  const [confirmed, setConfirmed] = useState(false);
  const client = useQueryClient();
  const closed = !!review.closed_at;
  const unfinished = review.task_snapshot.filter(
    (task) => task.status !== "done",
  );
  const runsKey = ["workbench", "weekly-ai", path, review.id, review.version];
  const runs = useQuery({
    queryKey: runsKey,
    enabled: !closed,
    queryFn: () =>
      workbenchRequest<RunResult[]>(`${path}/reviews/${review.id}/ai-runs`),
    refetchInterval: (q) =>
      q.state.error
        ? false
        : q.state.data?.some((r) =>
              ["queued", "running"].includes(r.run.status),
            )
          ? 1000
          : false,
  });
  const action = useMutation({
    mutationFn: ({ url, body }: { url: string; body: unknown }) =>
      workbenchRequest(url, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (_data, variables) => {
      if (variables.url.endsWith("/refresh")) setTriage({});
      onChange();
      void client.invalidateQueries({ queryKey: runsKey });
    },
  });
  const aiBusy = runs.data?.some((r) =>
    ["queued", "running"].includes(r.run.status),
  );
  const stats = review.stats;
  return (
    <>
      <p className="wb-muted">
        {closed ? "已确认 · 历史快照" : "统计快照"} · {review.timezone}
      </p>
      <dl className="wb-weekly-stats">
        <div>
          <dt>阅读计划完成</dt>
          <dd>
            {stats.done} / {stats.planned}
          </dd>
        </div>
        <div>
          <dt>精读 / 略读文献</dt>
          <dd>
            {stats.sources_close_read} / {stats.sources_skimmed}
          </dd>
        </div>
        <div>
          <dt>测验作答 / 批改</dt>
          <dd>
            {stats.quiz_attempts} / {stats.quiz_graded}
          </dd>
        </div>
        <div>
          <dt>测验平均分</dt>
          <dd>
            {stats.quiz_graded
              ? Math.round(stats.quiz_score_total / stats.quiz_graded)
              : "—"}
          </dd>
        </div>
        <div>
          <dt>连线确认 / 建议 / 拒绝</dt>
          <dd>
            {stats.links_confirmed} / {stats.links_suggested} /{" "}
            {stats.links_rejected}
          </dd>
        </div>
        <div>
          <dt>未解决问题</dt>
          <dd>{stats.open_questions}</dd>
        </div>
        <div>
          <dt>待复习 / 已复习</dt>
          <dd>
            {stats.reviews_due} / {stats.reviews_completed}
          </dd>
        </div>
      </dl>
      <p className="wb-muted">
        按当前记录统计。连线统计排除想法；待复习统计截至本周末。
      </p>
      {(action.error || runs.error) && (
        <p role="alert">{errorMessage(action.error || runs.error)}</p>
      )}
      {review.ai_comment && (
        <div className="wb-weekly-comment">
          <h3>已接受的 AI 点评</h3>
          <p>{review.ai_comment}</p>
        </div>
      )}
      {!closed && (
        <>
          <Button
            disabled={action.isPending}
            onClick={() =>
              action.mutate({
                url: `${path}/reviews/${review.id}/refresh`,
                body: { expected_version: review.version },
              })
            }
          >
            刷新统计与任务快照
          </Button>
          <p className="wb-muted">
            刷新会重新生成快照，并清除本次未提交的处理选择和已接受的点评。
          </p>
          <h3>未完成项 · {unfinished.length}</h3>
          {unfinished.map((task) => (
            <fieldset className="wb-weekly-triage" key={task.id}>
              <legend>{task.title}</legend>
              <p className="wb-muted">
                {modes[task.reading_mode]} · {task.scheduled_on}
              </p>
              <label>
                处理方式
                <select
                  required
                  value={triage[task.id]?.action ?? ""}
                  onChange={(e) =>
                    setTriage((current) => ({
                      ...current,
                      [task.id]: {
                        task_id: task.id,
                        reason: current[task.id]?.reason ?? "",
                        action: e.target.value as Triage["action"],
                      },
                    }))
                  }
                >
                  <option value="" disabled>
                    请选择
                  </option>
                  <option value="carry">顺延到下周</option>
                  {task.reading_mode === "close_read" && (
                    <option value="downgrade">降级为略读，安排到下周</option>
                  )}
                  <option value="drop">放弃本项</option>
                </select>
              </label>
              <label>
                原因（可选，仅自己可见）
                <textarea
                  maxLength={500}
                  value={triage[task.id]?.reason ?? ""}
                  disabled={!triage[task.id]}
                  onChange={(e) =>
                    setTriage((current) => ({
                      ...current,
                      [task.id]: {
                        ...current[task.id]!,
                        reason: e.target.value,
                      },
                    }))
                  }
                />
              </label>
            </fieldset>
          ))}
          <div className="wb-weekly-comment">
            <h3>AI 点评（可选）</h3>
            <p>仅发送上方的统计数字。任务标题、原因、正文和想法不会发送。</p>
            <label className="wb-weekly-confirm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              允许发送统计数字
            </label>
            <Button
              disabled={!confirmed || action.isPending || aiBusy}
              onClick={() =>
                action.mutate({
                  url: `${scope}/research/ai/runs`,
                  body: {
                    id: crypto.randomUUID(),
                    idempotency_key: crypto.randomUUID(),
                    task_type: "weekly_comment",
                    target: {
                      entity_type: "weekly_review",
                      id: review.id,
                      version: review.version,
                    },
                    expected_output_fields: ["comment"],
                    requested_output_tokens: 1000,
                    send_confirmed: true,
                  },
                })
              }
            >
              请求 AI 点评草稿
            </Button>
            {aiBusy && <p role="status">AI 正在处理统计…</p>}
            {runs.data?.map((result) =>
              result.draft ? (
                <section aria-label="AI 周回顾草稿" key={result.run.id}>
                  <p>{result.draft.structured_output.comment}</p>
                  <Button
                    disabled={action.isPending}
                    onClick={() =>
                      action.mutate({
                        url: `${path}/reviews/${review.id}/comment`,
                        body: {
                          expected_version: review.version,
                          expected_draft_version: result.draft!.version,
                          draft_id: result.draft!.id,
                        },
                      })
                    }
                  >
                    接受点评
                  </Button>
                </section>
              ) : !["queued", "running"].includes(result.run.status) ? (
                <p role="alert" key={result.run.id}>
                  {readingAiError(result.run.error_code)}
                </p>
              ) : null,
            )}
          </div>
          <p>
            确认后，本周计划保留且不再编辑；顺延和降级项安排到下周同一星期。
          </p>
          <Button
            className="wb-primary"
            disabled={
              action.isPending || unfinished.some((task) => !triage[task.id])
            }
            onClick={() =>
              action.mutate({
                url: `${path}/reviews/${review.id}/close`,
                body: {
                  expected_version: review.version,
                  triage: unfinished.map((task) => triage[task.id]),
                },
              })
            }
          >
            确认周回顾并生成下周计划
          </Button>
        </>
      )}
      {closed && (
        <>
          <p role="status">本周回顾已确认，下周计划已生成。</p>
          <ul>
            {review.triage.map((item) => (
              <li key={item.task_id}>
                {review.task_snapshot.find((t) => t.id === item.task_id)?.title}{" "}
                ·{" "}
                {
                  {
                    carry: "已顺延",
                    downgrade: "已降级为略读",
                    drop: "已放弃",
                  }[item.action]
                }
                {item.reason ? ` · ${item.reason}` : ""}
              </li>
            ))}
          </ul>
          <Button onClick={onNext}>查看下周计划</Button>
        </>
      )}
    </>
  );
}
