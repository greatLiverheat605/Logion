"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@logion/contracts";
import { errorMessage, workbenchRequest } from "./api";
import { Button } from "./components";
import { DraftNotice, useFormDraft } from "./form-draft";
import { readingAiError } from "./reading-ai";
import type { WorkbenchContext } from "./preferences";
import type { SourceText } from "./selection";

type Quiz = components["schemas"]["ReadingQuiz"];
type Attempt = components["schemas"]["ReadingAttempt"];
type Resource = components["schemas"]["LibraryResource"];
type Runs = components["schemas"]["ReadingNoteRuns"];
type Draft = components["schemas"]["AIOutputDraftResponse"];
type Answer = components["schemas"]["ReadingAnswer"];
export const MASTERY_LABELS = {
  unknown: "尚不清楚",
  exposed: "初步接触",
  practicing: "仍需练习",
  familiar: "基本熟悉",
  proficient: "熟练应用",
  mastered: "已掌握",
} as const;

function draftPrompts(draft: Draft): string[] | null {
  try {
    const value: unknown = JSON.parse(draft.structured_output.questions ?? "");
    return Array.isArray(value) &&
      value.length === 5 &&
      value.every((q) => q && typeof q.prompt === "string")
      ? value.map((q) => q.prompt as string)
      : null;
  } catch {
    return null;
  }
}

// ReaderScope owns this hook, so changing panes retains an unfinished answer in memory.
export function useReadingQuiz(
  path: string,
  context: WorkbenchContext,
  resource: Resource | undefined,
  source: SourceText | null,
) {
  const client = useQueryClient();
  const params = useSearchParams();
  const [selectedId, selectItem] = useState<string | null>(params.get("quiz"));
  const [answers, setAnswers] = useState<
    Record<string, { id: string; text: string }>
  >({});
  const [revealed, setRevealed] = useState<Record<string, Answer>>({});
  const [level, setLevel] = useState<keyof typeof MASTERY_LABELS>("practicing");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const key = ["workbench", "reading-quiz", path];
  const runsKey = ["workbench", "reading-quiz-runs", path];
  const query = useQuery({
    queryKey: key,
    queryFn: () => workbenchRequest<Quiz>(`${path}/quiz`),
  });
  const runs = useQuery({
    queryKey: runsKey,
    queryFn: () => workbenchRequest<Runs>(`${path}/quiz/ai-runs`),
    refetchInterval: (q) =>
      q.state.error
        ? false
        : q.state.data?.runs.some(({ run }) =>
              ["queued", "running"].includes(run.status),
            )
          ? 1000
          : false,
  });
  const settled = runs.data?.runs
    .filter(
      ({ run }) => run.task_type === "quiz_grade" && run.status === "succeeded",
    )
    .map(({ run }) => run.id)
    .join(",");
  useEffect(() => {
    if (settled)
      void client.invalidateQueries({
        queryKey: ["workbench", "reading-quiz", path],
      });
  }, [settled, client, path]);
  const dirty = Object.values(answers).some((answer) => answer.text.trim());
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty]);
  const item =
    query.data?.items.find((q) => q.id === selectedId) ?? query.data?.items[0];
  const answerDraft = useFormDraft({
    scope: path,
    kind: "reading_answer",
    target: item?.id,
    enabled: !!item,
    fields: { response_text: item ? (answers[item.id]?.text ?? "") : "" },
    restore: (fields) => {
      if (item)
        setAnswers((values) => ({
          ...values,
          [item.id]: {
            id: values[item.id]?.id ?? crypto.randomUUID(),
            text: fields.response_text ?? "",
          },
        }));
    },
  });
  const generating = runs.data?.runs.some(
    ({ run }) =>
      run.task_type === "quiz_generate" &&
      ["queued", "running"].includes(run.status),
  );
  const grading = runs.data?.runs.some(
    ({ run }) =>
      run.task_type === "quiz_grade" &&
      run.target_id === item?.latest_attempt?.id &&
      ["queued", "running"].includes(run.status),
  );
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(failure);
    } finally {
      await Promise.all([
        client.invalidateQueries({ queryKey: key }),
        client.invalidateQueries({ queryKey: runsKey }),
      ]);
      setBusy(false);
    }
  }
  async function generate() {
    if (!resource || !source) return;
    await workbenchRequest(
      `/api/v1/workspaces/${context.workspace_id}/spaces/${context.space_id}/research/ai/runs`,
      {
        method: "POST",
        body: JSON.stringify({
          id: crypto.randomUUID(),
          idempotency_key: crypto.randomUUID(),
          task_type: "quiz_generate",
          target: {
            entity_type: "resource",
            id: resource.id,
            version: resource.version,
          },
          context_entities: [
            {
              entity_type: "source_text",
              id: source.id,
              version: source.version,
            },
          ],
          expected_output_fields: ["questions"],
          send_confirmed: true,
          retain_input: false,
        }),
      },
    );
  }
  async function decide(draft: Draft, decision: "accepted" | "rejected") {
    if (!resource) return;
    await workbenchRequest(`${path}/quiz/drafts/${draft.id}/decision`, {
      method: "POST",
      body: JSON.stringify({
        decision,
        expected_resource_version: resource.version,
        expected_draft_version: draft.version,
      }),
    });
  }
  async function grade(attempt: Attempt) {
    const excerpts = await workbenchRequest<
      components["schemas"]["ExcerptPage"]
    >(`${path}/excerpts`);
    await workbenchRequest(
      `/api/v1/workspaces/${context.workspace_id}/spaces/${context.space_id}/research/ai/runs`,
      {
        method: "POST",
        body: JSON.stringify({
          id: crypto.randomUUID(),
          idempotency_key: crypto.randomUUID(),
          task_type: "quiz_grade",
          target: {
            entity_type: "quiz_attempt",
            id: attempt.id,
            version: attempt.version,
          },
          context_entities: excerpts.excerpts
            .filter((e) => e.status === "active")
            .slice(0, 31)
            .map((e) => ({
              entity_type: "source_excerpt",
              id: e.id,
              version: e.version,
            })),
          expected_output_fields: ["grade"],
          send_confirmed: true,
          retain_input: false,
        }),
      },
    );
  }
  return (
    <div className="wb-reading-panel wb-reading-quiz">
      <h2>理解测验</h2>
      <p className="wb-muted">
        默认 5 题，接受草稿后才能作答。AI 批改仅供参考，掌握程度由你确认。
      </p>
      {(query.error || (error && answerDraft.state.status !== "error")) && (
        <p role="alert">{errorMessage(error || query.error)}</p>
      )}
      <Button
        disabled={busy || generating || !source || !resource}
        onClick={() => void perform(generate)}
      >
        发送原文并起草 5 道题
      </Button>
      {!source && <p className="wb-muted">全文就绪后可请求题目草稿。</p>}
      {runs.error && <p role="alert">{errorMessage(runs.error)}</p>}
      {runs.data?.runs
        .filter(({ run }) => run.task_type === "quiz_generate")
        .map(({ run, draft }) => {
          if (["queued", "running"].includes(run.status))
            return (
              <p key={run.id} role="status">
                AI 正在出题…
              </p>
            );
          if (run.status !== "succeeded")
            return (
              <p key={run.id} role="alert">
                {readingAiError(run.error_code)}
              </p>
            );
          if (!draft) return null;
          const prompts = draftPrompts(draft),
            stale = run.target_version !== resource?.version;
          return (
            <section key={run.id} aria-label="测验题目草稿">
              <h3>待确认题目</h3>
              {prompts ? (
                <ol>
                  {prompts.map((prompt, i) => (
                    <li key={i}>{prompt}</li>
                  ))}
                </ol>
              ) : (
                <p role="alert">题目格式无效，请丢弃并重新生成。</p>
              )}
              {stale && <p role="alert">文献已更新，请丢弃后重新出题。</p>}
              <div className="wb-reading-actions">
                <Button
                  disabled={busy || stale || !prompts}
                  onClick={() => void perform(() => decide(draft, "accepted"))}
                >
                  接受题目
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => void perform(() => decide(draft, "rejected"))}
                >
                  丢弃题目
                </Button>
              </div>
            </section>
          );
        })}
      {query.isPending ? (
        <p role="status">正在加载测验…</p>
      ) : item ? (
        <section aria-label="测验作答">
          <label>
            选择题目
            <select
              value={item.id}
              disabled={busy}
              onChange={(e) => {
                const id = e.target.value;
                void perform(async () => {
                  await answerDraft.controller.flush();
                  selectItem(id);
                });
              }}
            >
              {query.data?.items.map((q, i) => (
                <option key={q.id} value={q.id}>
                  {i + 1}. {q.concept}
                </option>
              ))}
            </select>
          </label>
          <h3>{item.concept}</h3>
          <p className="wb-reading-output">{item.prompt}</p>
          {item.latest_attempt && (
            <div className="wb-quiz-evidence">
              <h4>上次作答</h4>
              <p className="wb-reading-output">
                {item.latest_attempt.response_text}
              </p>
              {item.latest_attempt.ai_grade ? (
                <>
                  <h4>
                    AI 批改证据 · {item.latest_attempt.ai_grade.score} / 100
                  </h4>
                  <p className="wb-reading-output">
                    {item.latest_attempt.ai_grade.reasoning}
                  </p>
                  <p>
                    薄弱概念：
                    {item.latest_attempt.ai_grade.weak_concepts.join("、") ||
                      "未指出"}
                  </p>
                </>
              ) : grading ? (
                <p role="status">AI 正在批改…</p>
              ) : (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void perform(() => grade(item.latest_attempt!))
                  }
                >
                  发送作答并请求 AI 批改
                </Button>
              )}
              {runs.data?.runs
                .filter(
                  ({ run }) =>
                    run.target_id === item.latest_attempt?.id &&
                    run.status === "failed",
                )
                .slice(0, 1)
                .map(({ run }) => (
                  <p key={run.id} role="alert">
                    {readingAiError(run.error_code)}
                  </p>
                ))}
            </div>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                const answer = answers[item.id];
                if (!answer?.text.trim()) return;
                const attempt = await answerDraft.submit((headers) =>
                  workbenchRequest<Attempt>(
                    `${path}/quiz/items/${item.id}/attempts`,
                    {
                      headers,
                      method: "POST",
                      body: JSON.stringify({
                        id: answer.id,
                        expected_item_version: item.version,
                        response_text: answer.text,
                      }),
                    },
                  ),
                );
                setAnswers((values) => ({
                  ...values,
                  [item.id]: { id: crypto.randomUUID(), text: "" },
                }));
                await grade(attempt);
              });
            }}
          >
            <DraftNotice draft={answerDraft} />
            <label>
              我的作答
              <textarea
                maxLength={8000}
                value={answers[item.id]?.text ?? ""}
                disabled={busy}
                onChange={(e) => {
                  const text = e.target.value;
                  setAnswers((values) => ({
                    ...values,
                    [item.id]: {
                      id: values[item.id]?.id ?? crypto.randomUUID(),
                      text,
                    },
                  }));
                }}
              />
            </label>
            <p className="wb-muted">
              提交后会发送题目、参考答案、作答和本文摘录，请 AI 提供批改证据。
            </p>
            <Button
              type="submit"
              disabled={busy || grading || !answers[item.id]?.text.trim()}
            >
              提交作答并请求批改
            </Button>
          </form>
          <Button
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                const answer = await workbenchRequest<Answer>(
                  `${path}/quiz/items/${item.id}/answer`,
                );
                setRevealed((values) => ({ ...values, [item.id]: answer }));
              })
            }
          >
            查看参考答案
          </Button>
          {revealed[item.id] && (
            <section aria-label="参考答案">
              <h4>参考答案</h4>
              <p className="wb-reading-output">
                {revealed[item.id]?.answer_key}
              </p>
              <p className="wb-reading-output">
                {revealed[item.id]?.explanation}
              </p>
            </section>
          )}
          {item.latest_attempt && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void perform(async () => {
                  await workbenchRequest(
                    `${path}/quiz/items/${item.id}/mastery`,
                    {
                      method: "POST",
                      body: JSON.stringify({
                        mastery_id: item.mastery?.id ?? crypto.randomUUID(),
                        schedule_id:
                          item.review_schedule?.id ?? crypto.randomUUID(),
                        expected_version: item.mastery?.version ?? 0,
                        confirmed_level: level,
                      }),
                    },
                  );
                  await client.invalidateQueries({
                    queryKey: ["workbench", "reading-review"],
                  });
                });
              }}
            >
              <h4>本人确认掌握程度</h4>
              <label>
                我的判断
                <select
                  value={level}
                  disabled={busy}
                  onChange={(e) =>
                    setLevel(e.target.value as keyof typeof MASTERY_LABELS)
                  }
                >
                  {Object.entries(MASTERY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" disabled={busy}>
                确认并安排复习
              </Button>
            </form>
          )}
          {item.mastery?.confirmed_level && (
            <p role="status">
              已确认：{MASTERY_LABELS[item.mastery.confirmed_level]}。下次复习：
              {item.review_schedule
                ? new Date(
                    item.review_schedule.next_review_at,
                  ).toLocaleDateString()
                : "待安排"}
              。
            </p>
          )}
        </section>
      ) : (
        <p>接受题目后，这里可以作答。</p>
      )}
    </div>
  );
}
