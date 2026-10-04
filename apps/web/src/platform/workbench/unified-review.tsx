"use client";

import { DraftNotice, useFormDraft } from "./form-draft";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { components } from "@logion/contracts";
import { useWorkbench } from "./provider";
import { errorMessage, workbenchRequest } from "./api";
import { Button, Menu, Sheet } from "./components";
import { ReadingReview } from "./reading-review";
import { MASTERY_LABELS } from "./reading-quiz";
import type { WorkbenchContext } from "./preferences";
import "./unified-review.css";

type Schema = components["schemas"];
type Topic = Schema["TopicResponse"];
type Recall = Schema["OnlineRecallItem"];
type Detail = Schema["OnlineTopicDetail"];
type Attempt = Schema["QuizAttemptResponse"];
type Cause = NonNullable<Schema["QuizAttemptCreateRequest"]["error_cause"]>;
const causes: Record<Cause, string> = {
  recall_gap: "未能回忆",
  concept_confusion: "概念混淆",
  misread: "读题偏差",
  careless: "疏忽",
  application_gap: "应用不足",
  unknown: "尚不清楚",
};
const memoryKey = (path: string) => ["workbench", "memory", path];
function usePage<T extends { next_cursor: string | null }>(
  base: string,
  suffix: string,
  query: Record<string, string> = {},
) {
  return useInfiniteQuery({
    queryKey: [...memoryKey(base), suffix, query],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      workbenchRequest<T>(base + suffix, {
        query: { ...query, ...(pageParam ? { cursor: pageParam } : {}) },
      }),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
}
function Failure({ error }: { error: unknown }) {
  return error ? <p role="alert">{errorMessage(error)}</p> : null;
}

export function UnifiedReview() {
  const { context } = useWorkbench();
  const params = useSearchParams();
  return context ? (
    <ReviewScope
      key={`${context.workspace_id}/${context.space_id}/${params.get("topic") ?? ""}`}
      context={context}
    />
  ) : (
    <p>请先选择空间。</p>
  );
}
function ReviewScope({ context }: { context: WorkbenchContext }) {
  const params = useSearchParams();
  const [selected, select] = useState<string | null>(params.get("topic"));
  const [creating, create] = useState(false);
  const [due, setDue] = useState(false);
  const base = `/api/v1/workspaces/${context.workspace_id}/spaces/${context.space_id}/research/memory`;
  const topics = usePage<Schema["OnlineTopicPage"]>(base, "/topics", {
    due_only: String(due),
  });
  const client = useQueryClient();
  const changed = () => client.invalidateQueries({ queryKey: memoryKey(base) });
  return (
    <div className="wb-page wb-unified-review">
      <div className="wb-page-heading">
        <div>
          <h1>复习</h1>
          <p>回忆、作答，再由你确认掌握程度。</p>
        </div>
      </div>
      <section aria-label="知识点与回忆题">
        <div className="wb-review-heading">
          <h2>知识点与回忆题</h2>
          {topics.data?.pages[0]?.can_edit && (
            <Button onClick={() => create(true)}>新建知识点</Button>
          )}
        </div>
        <label className="wb-review-filter">
          <input
            type="checkbox"
            checked={due}
            onChange={(e) => setDue(e.target.checked)}
          />
          筛选到期知识点
        </label>
        <Failure error={topics.error} />
        {topics.isError && (
          <Button onClick={() => void topics.refetch()}>重新加载知识点</Button>
        )}
        {topics.isPending && <p role="status">正在加载知识点…</p>}
        <div className="wb-memory-layout">
          <div>
            <ul className="wb-topic-list">
              {topics.data?.pages
                .flatMap((p) => p.topics)
                .map((topic) => (
                  <li key={topic.id}>
                    <Button
                      aria-pressed={selected === topic.id}
                      onClick={() => {
                        if (
                          window.dispatchEvent(
                            new Event("workbench:before-navigate", {
                              cancelable: true,
                            }),
                          )
                        )
                          select(topic.id);
                      }}
                    >
                      <strong>{topic.title}</strong>
                      <span>
                        {topic.mastery?.confirmed_level
                          ? MASTERY_LABELS[topic.mastery.confirmed_level]
                          : "尚未确认掌握"}
                        {topic.review_schedule
                          ? ` · ${new Date(topic.review_schedule.next_review_at).toLocaleDateString()}`
                          : ""}
                      </span>
                    </Button>
                  </li>
                ))}
            </ul>
            {topics.data?.pages[0]?.topics.length === 0 && (
              <p className="wb-muted">
                {due
                  ? "暂无到期知识点。"
                  : "还没有知识点。已有知识点会在这里显示。"}
              </p>
            )}
            {topics.hasNextPage && (
              <Button
                disabled={topics.isFetchingNextPage}
                onClick={() => void topics.fetchNextPage()}
              >
                更多知识点
              </Button>
            )}
          </div>
          {selected ? (
            <TopicDetail
              key={selected}
              id={selected}
              base={base}
              changed={changed}
              onDeleted={() => select(null)}
            />
          ) : (
            <p className="wb-empty">选择知识点，开始回忆或作答。</p>
          )}
        </div>
      </section>
      <ReadingReview embedded />
      {creating && (
        <TopicForm
          base={base}
          onClose={() => create(false)}
          onSaved={(id) => {
            create(false);
            select(id);
            void changed();
          }}
        />
      )}
    </div>
  );
}

function TopicDetail({
  id,
  base,
  changed,
  onDeleted,
}: {
  id: string;
  base: string;
  changed: () => Promise<unknown>;
  onDeleted: () => void;
}) {
  const detail = useQuery({
    queryKey: [...memoryKey(base), "topic", id],
    queryFn: () => workbenchRequest<Detail>(`${base}/topics/${id}`),
  });
  const quizzes = usePage<Schema["OnlineRecallPage"]>(
    base,
    `/topics/${id}/quizzes`,
  );
  const history = usePage<Schema["OnlineAttemptPage"]>(
    base,
    `/topics/${id}/attempts`,
  );
  const [editing, edit] = useState(false);
  const [creatingQuiz, createQuiz] = useState(false);
  const [retiring, retire] = useState(false);
  const topic = detail.data?.topic;
  return (
    <section className="wb-topic-detail" aria-label="知识点详情">
      <Failure error={detail.error || quizzes.error || history.error} />
      {detail.isError && (
        <Button onClick={() => void detail.refetch()}>重新载入知识点</Button>
      )}
      {detail.isPending && <p role="status">正在打开知识点…</p>}
      {topic && (
        <>
          <div className="wb-review-heading">
            <h2>{topic.title}</h2>
            {detail.data?.can_edit && (
              <Menu
                label="知识点更多"
                items={[
                  { label: "编辑知识点", action: () => edit(true) },
                  { label: "删除知识点", action: () => retire(true) },
                ]}
              />
            )}
          </div>
          <Button disabled={detail.isFetching} onClick={() => void changed()}>
            载入最新版本
          </Button>
          <p className="wb-preserve-lines">
            {topic.description || "尚未填写说明。"}
          </p>
          <Sources base={base} kind="topic" id={id} />
          <Mastery base={base} topic={topic} changed={changed} />
          <div className="wb-review-heading">
            <h3>回忆题</h3>
            {detail.data?.can_edit && (
              <Button onClick={() => createQuiz(true)}>新建回忆题</Button>
            )}
          </div>
          {quizzes.isPending && <p role="status">正在加载回忆题…</p>}
          {quizzes.isError && (
            <Button onClick={() => void quizzes.refetch()}>
              重新加载回忆题
            </Button>
          )}
          {quizzes.data?.pages[0]?.quiz_items.length === 0 && (
            <p className="wb-muted">
              暂无回忆题，可以先回忆知识点再确认掌握程度。
            </p>
          )}
          {quizzes.data?.pages
            .flatMap((p) => p.quiz_items)
            .map((quiz) => (
              <RecallCard
                key={quiz.id}
                base={base}
                quiz={quiz}
                detail={detail.data!}
                changed={changed}
              />
            ))}
          {quizzes.hasNextPage && (
            <Button
              disabled={quizzes.isFetchingNextPage}
              onClick={() => void quizzes.fetchNextPage()}
            >
              更多回忆题
            </Button>
          )}
          <details className="wb-review-history">
            <summary>我的作答历史</summary>
            {history.isPending && <p role="status">正在加载作答…</p>}
            {history.isError && (
              <Button onClick={() => void history.refetch()}>
                重新加载作答
              </Button>
            )}
            {history.data?.pages[0]?.attempts.length === 0 && (
              <p>尚无作答记录。</p>
            )}
            {history.data?.pages
              .flatMap((p) => p.attempts)
              .map((a) => (
                <div key={a.id}>
                  <p>
                    {new Date(a.attempted_at).toLocaleString()} ·{" "}
                    {a.is_correct ? "正确" : "需再练习"}
                  </p>
                  <p className="wb-preserve-lines">{a.response_text}</p>
                  <p>参考答案：{a.answer_key}</p>
                  {a.error_cause && <p>错因：{causes[a.error_cause]}</p>}
                </div>
              ))}
            {history.hasNextPage && (
              <Button
                disabled={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                更多作答
              </Button>
            )}
          </details>
          <Dependencies
            base={base}
            topic={topic}
            writable={detail.data!.can_edit}
            changed={changed}
          />
          {editing && (
            <TopicForm
              base={base}
              topic={topic}
              onClose={() => edit(false)}
              onSaved={() => {
                edit(false);
                void changed();
              }}
            />
          )}
          {creatingQuiz && (
            <QuizForm
              base={base}
              topicId={id}
              onClose={() => createQuiz(false)}
              onSaved={() => {
                createQuiz(false);
                void changed();
              }}
            />
          )}
          {retiring && (
            <Retire
              base={base}
              kind="topic"
              id={id}
              onClose={() => retire(false)}
              onDeleted={() => {
                retire(false);
                onDeleted();
                void changed();
              }}
            />
          )}
        </>
      )}
    </section>
  );
}

function Mastery({
  base,
  topic,
  changed,
}: {
  base: string;
  topic: Topic;
  changed: () => Promise<unknown>;
}) {
  const [level, setLevel] = useState<
    Schema["MasteryConfirmRequest"]["confirmed_level"]
  >(topic.mastery?.confirmed_level ?? "unknown");
  const [ids] = useState(() => ({
    mastery: crypto.randomUUID(),
    schedule: crypto.randomUUID(),
  }));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [done, setDone] = useState(false);
  async function confirm() {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await workbenchRequest(`${base}/topics/${topic.id}/mastery`, {
        method: "PUT",
        body: JSON.stringify({
          mastery_id: topic.mastery?.id ?? ids.mastery,
          schedule_id: topic.review_schedule?.id ?? ids.schedule,
          expected_version: topic.mastery?.version ?? 0,
          confirmed_level: level,
        }),
      });
      await changed();
      setDone(true);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="wb-mastery-confirm">
      <p className="wb-muted">作答结果是证据，掌握程度由你确认。</p>
      <label>
        掌握程度
        <select
          value={level}
          disabled={busy}
          onChange={(e) => {
            setLevel(e.target.value as typeof level);
            setDone(false);
          }}
        >
          {Object.entries(MASTERY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <Button disabled={busy} onClick={() => void confirm()}>
        确认掌握并安排复习
      </Button>
      {topic.review_schedule && (
        <p>
          下次复习：
          {new Date(topic.review_schedule.next_review_at).toLocaleDateString()}
        </p>
      )}
      {done && <p role="status">掌握程度已确认，复习时间已更新。</p>}
      <Failure error={error} />
    </div>
  );
}

function RecallCard({
  base,
  quiz,
  detail,
  changed,
}: {
  base: string;
  quiz: Recall;
  detail: Detail;
  changed: () => Promise<unknown>;
}) {
  const [editing, edit] = useState(false),
    [retiring, retire] = useState(false);
  const [text, setText] = useState(""),
    [confidence, setConfidence] = useState(3);
  const [correct, setCorrect] = useState(""),
    [cause, setCause] = useState<Cause>("unknown");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [result, setResult] = useState<Attempt | null>(null);
  const [identity, setIdentity] = useState(() => ({
    id: crypto.randomUUID(),
    error_pattern_id: crypto.randomUUID(),
    schedule_id: crypto.randomUUID(),
    started: Date.now(),
  }));
  useUnsaved(Boolean(text) && !result);
  const draft = useFormDraft({
    scope: base,
    kind: "memory_answer",
    target: quiz.id,
    fields: { response_text: text },
    restore: (fields) => setText(fields.response_text ?? ""),
  });
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await draft.submit((headers) =>
        workbenchRequest<Attempt>(`${base}/quizzes/${quiz.id}/attempts`, {
          headers,
          method: "POST",
          body: JSON.stringify({
            id: identity.id,
            error_pattern_id:
              detail.error_patterns.find((p) => p.cause === cause)?.id ??
              identity.error_pattern_id,
            schedule_id:
              detail.topic.review_schedule?.id ?? identity.schedule_id,
            response_text: text,
            confidence,
            duration_seconds: Math.min(
              86400,
              Math.floor((Date.now() - identity.started) / 1000),
            ),
            self_assessed_correct:
              quiz.evaluation_mode === "self_assessed"
                ? correct === "yes"
                : null,
            error_cause:
              quiz.evaluation_mode === "self_assessed" && correct === "yes"
                ? null
                : cause,
          }),
        }),
      );
      setResult(response);
      await changed();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="wb-recall-card">
      <div className="wb-review-heading">
        <h4>{quiz.prompt}</h4>
        {detail.can_edit && (
          <Menu
            label="回忆题更多"
            items={[
              { label: "编辑回忆题", action: () => edit(true) },
              { label: "停用回忆题", action: () => retire(true) },
            ]}
          />
        )}
      </div>
      <Sources
        base={base}
        kind="quiz_item"
        id={quiz.id}
        fallbackTopic={quiz.topic_id}
      />
      <p className="wb-muted">
        {quiz.evaluation_mode === "exact_match" ? "服务器核对答案" : "本人自评"}
      </p>
      {result ? (
        <div role="status">
          <strong>
            {result.is_correct ? "本次回答正确" : "本次需要再练习"}
          </strong>
          <p>参考答案：{result.answer_key}</p>
          <p>{result.explanation}</p>
          {result.error_cause && <p>错因：{causes[result.error_cause]}</p>}
          <p>作答已保存，仍需本人确认掌握程度。</p>
          <Button
            onClick={() => {
              setResult(null);
              setText("");
              setCorrect("");
              setIdentity({
                id: crypto.randomUUID(),
                error_pattern_id: crypto.randomUUID(),
                schedule_id: crypto.randomUUID(),
                started: Date.now(),
              });
            }}
          >
            再次作答
          </Button>
        </div>
      ) : (
        <form onSubmit={(e) => void submit(e)}>
          <DraftNotice draft={draft} />
          <label>
            我的回答
            <textarea
              required
              maxLength={20000}
              value={text}
              disabled={busy}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="wb-review-fields">
            <label>
              信心
              <select
                value={confidence}
                disabled={busy}
                onChange={(e) => setConfidence(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} / 5
                  </option>
                ))}
              </select>
            </label>
            {quiz.evaluation_mode === "self_assessed" && (
              <label>
                本人判断
                <select
                  required
                  value={correct}
                  disabled={busy}
                  onChange={(e) => setCorrect(e.target.value)}
                >
                  <option value="">请选择</option>
                  <option value="yes">正确</option>
                  <option value="no">需要再练习</option>
                </select>
              </label>
            )}
            {(quiz.evaluation_mode === "exact_match" || correct !== "yes") && (
              <label>
                若有错误，主要原因
                <select
                  value={cause}
                  disabled={busy}
                  onChange={(e) => setCause(e.target.value as Cause)}
                >
                  {Object.entries(causes).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <Button type="submit" disabled={busy || !text.trim()}>
            提交回答
          </Button>
          <Failure error={draft.state.status === "error" ? null : error} />
        </form>
      )}
      {editing && (
        <QuizForm
          base={base}
          topicId={quiz.topic_id}
          quiz={quiz}
          onClose={() => edit(false)}
          onSaved={() => {
            edit(false);
            void changed();
          }}
        />
      )}
      {retiring && (
        <Retire
          base={base}
          kind="quiz_item"
          id={quiz.id}
          onClose={() => retire(false)}
          onDeleted={() => {
            retire(false);
            void changed();
          }}
        />
      )}
    </article>
  );
}

function Sources({
  base,
  kind,
  id,
  fallbackTopic,
}: {
  base: string;
  kind: "topic" | "quiz_item";
  id: string;
  fallbackTopic?: string;
}) {
  const sources = usePage<Schema["OnlineSourcePage"]>(base, "/sources", {
    target_kind: kind,
    target_id: id,
  });
  const labels = {
    valid: "来源有效",
    modified: "来源已修改",
    deleted: "来源已删除",
    unavailable: "来源不可用",
  };
  return (
    <div className="wb-memory-sources">
      <Failure error={sources.error} />
      {sources.isError && (
        <Button onClick={() => void sources.refetch()}>重新加载来源</Button>
      )}
      {sources.data?.pages[0]?.sources.length === 0 &&
        (fallbackTopic ? (
          <Sources base={base} kind="topic" id={fallbackTopic} />
        ) : (
          <p className="wb-muted">没有关联的原文或笔记来源。</p>
        ))}
      {sources.data?.pages
        .flatMap((p) => p.sources)
        .map((source) => (
          <p key={source.id}>
            {labels[source.state]}
            {source.state === "valid" || source.state === "modified" ? (
              <>
                {" "}
                ·{" "}
                <Link
                  href={`/records?note=${source.note_id}&source=${source.id}`}
                >
                  打开原文：{source.note_title}
                </Link>
              </>
            ) : null}
          </p>
        ))}
      {sources.hasNextPage && (
        <Button
          disabled={sources.isFetchingNextPage}
          onClick={() => void sources.fetchNextPage()}
        >
          更多来源
        </Button>
      )}
    </div>
  );
}

function TopicForm({
  base,
  topic,
  onClose,
  onSaved,
}: {
  base: string;
  topic?: Topic;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [expectedVersion] = useState(topic?.version);
  const [id] = useState(() => topic?.id ?? crypto.randomUUID());
  const [title, setTitle] = useState(topic?.title ?? ""),
    [description, setDescription] = useState(topic?.description ?? "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const draft = useFormDraft({
    scope: base,
    kind: topic ? "topic_edit" : "topic_create",
    target: topic?.id,
    fields: { description },
    restore: (fields) => setDescription(fields.description ?? ""),
  });
  function close() {
    if (
      !busy &&
      ((title === (topic?.title ?? "") &&
        description === (topic?.description ?? "")) ||
        window.confirm("放弃尚未保存的知识点修改？"))
    )
      onClose();
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await draft.submit((headers) =>
        workbenchRequest(base + (topic ? `/topics/${id}` : "/topics"), {
          headers,
          method: topic ? "PATCH" : "POST",
          body: JSON.stringify({
            id,
            title,
            description,
            ...(topic ? { expected_version: expectedVersion } : {}),
          }),
        }),
      );
      onSaved(id);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open
      title={topic ? "编辑知识点" : "新建知识点"}
      description="写下概念与说明，掌握程度由你在复习时确认。"
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <form className="wb-memory-form" onSubmit={(e) => void submit(e)}>
        <DraftNotice draft={draft} />
        <label>
          知识点标题
          <input
            required
            maxLength={160}
            disabled={busy}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          知识点说明
          <textarea
            maxLength={10000}
            disabled={busy}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <Failure error={error} />
        <Button type="submit" disabled={busy || !title.trim()}>
          保存知识点
        </Button>
      </form>
    </Sheet>
  );
}

function QuizForm({
  base,
  topicId,
  quiz,
  onClose,
  onSaved,
}: {
  base: string;
  topicId: string;
  quiz?: Recall;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [expectedVersion] = useState(quiz?.version);
  const [id] = useState(() => quiz?.id ?? crypto.randomUUID());
  const [prompt, setPrompt] = useState(quiz?.prompt ?? ""),
    [answer, setAnswer] = useState(""),
    [explanation, setExplanation] = useState("");
  const [mode, setMode] = useState(quiz?.evaluation_mode ?? "self_assessed");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const draft = useFormDraft({
    scope: base,
    kind: quiz ? "quiz_edit" : "quiz_create",
    target: quiz?.id ?? topicId,
    fields: { prompt, answer, explanation },
    restore: (fields) => {
      setPrompt(fields.prompt ?? "");
      setAnswer(fields.answer ?? "");
      setExplanation(fields.explanation ?? "");
    },
  });
  function close() {
    if (
      !busy &&
      ((prompt === (quiz?.prompt ?? "") &&
        !answer &&
        !explanation &&
        mode === (quiz?.evaluation_mode ?? "self_assessed")) ||
        window.confirm("放弃尚未保存的回忆题修改？"))
    )
      onClose();
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await draft.submit((headers) =>
        workbenchRequest(base + (quiz ? `/quizzes/${id}` : "/quizzes"), {
          headers,
          method: quiz ? "PATCH" : "POST",
          body: JSON.stringify({
            id,
            topic_id: topicId,
            prompt,
            answer_key: quiz && !answer ? null : answer,
            explanation: quiz && !explanation ? null : explanation,
            evaluation_mode: mode,
            ...(quiz ? { expected_version: expectedVersion } : {}),
          }),
        }),
      );
      onSaved();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open
      title={quiz ? "编辑回忆题" : "新建回忆题"}
      description="已有作答后，判定方式保持不变。"
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <form className="wb-memory-form" onSubmit={(e) => void submit(e)}>
        <DraftNotice draft={draft} />
        <label>
          题目
          <textarea
            required
            maxLength={10000}
            disabled={busy}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </label>
        <label>
          {quiz ? "新参考答案（留空保留）" : "参考答案"}
          <textarea
            required={!quiz}
            maxLength={10000}
            disabled={busy}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
        </label>
        <label>
          {quiz ? "新解析（留空保留）" : "解析"}
          <textarea
            maxLength={20000}
            disabled={busy}
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
          />
        </label>
        <label>
          判定方式
          <select
            disabled={busy || quiz?.has_attempts}
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="self_assessed">本人自评</option>
            <option value="exact_match">服务器核对答案</option>
          </select>
        </label>
        <Failure error={error} />
        <Button
          type="submit"
          disabled={busy || !prompt.trim() || (!quiz && !answer.trim())}
        >
          保存回忆题
        </Button>
      </form>
    </Sheet>
  );
}

function Retire({
  base,
  kind,
  id,
  onClose,
  onDeleted,
}: {
  base: string;
  kind: "topic" | "quiz_item" | "topic_dependency";
  id: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const preview = useQuery({
    queryKey: [...memoryKey(base), "deletion", kind, id],
    queryFn: () =>
      workbenchRequest<Schema["DeletionPreview"]>(
        `${base}/entities/${kind}/${id}/deletion`,
      ),
    staleTime: 0,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const name =
    kind === "quiz_item"
      ? "停用回忆题"
      : kind === "topic"
        ? "删除知识点"
        : "删除先修关系";
  const blockers: Record<string, string> = {
    dependency_count: "先修关系",
    mastery_count: "掌握记录",
    review_schedule_count: "复习日程",
    quiz_item_count: "回忆题",
    quiz_attempt_count: "作答历史",
    error_pattern_count: "错因记录",
    citation_count: "引用",
  };
  async function confirm() {
    if (!preview.data?.can_delete) return;
    setBusy(true);
    setError(null);
    try {
      await workbenchRequest(`${base}/entities/${kind}/${id}`, {
        method: "DELETE",
        body: JSON.stringify({ expected_version: preview.data.server_version }),
      });
      onDeleted();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open
      title={name}
      description={
        kind === "quiz_item"
          ? "停用后不再接受新的作答；作答历史、错因和掌握记录保留，来源链接一并停用。"
          : "只做软删除；存在学习记录或引用的知识点不能删除。"
      }
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      {preview.isPending && <p role="status">正在核对影响范围…</p>}
      <Failure error={preview.error || error} />
      {preview.data && !preview.data.can_delete && (
        <p role="alert">
          仍有引用，无法删除：
          {Object.entries(preview.data.blockers)
            .filter(([, count]) => count > 0)
            .map(([key, count]) => `${blockers[key] ?? key} ${count}`)
            .join("、")}
        </p>
      )}
      {preview.isError && (
        <Button onClick={() => void preview.refetch()}>重新核对范围</Button>
      )}
      <Button
        disabled={busy || !preview.data?.can_delete}
        onClick={() => void confirm()}
      >
        确认{name}
      </Button>
      <Button disabled={busy} onClick={onClose}>
        取消
      </Button>
    </Sheet>
  );
}

function Dependencies({
  base,
  topic,
  writable,
  changed,
}: {
  base: string;
  topic: Topic;
  writable: boolean;
  changed: () => Promise<unknown>;
}) {
  const dependencies = usePage<Schema["OnlineDependencyPage"]>(
    base,
    `/topics/${topic.id}/dependencies`,
  );
  const [adding, setAdding] = useState(false),
    [deleting, setDeleting] = useState<string | null>(null);
  return (
    <details className="wb-review-history">
      <summary>先修关系</summary>
      <Failure error={dependencies.error} />
      {dependencies.isError && (
        <Button onClick={() => void dependencies.refetch()}>
          重新加载关系
        </Button>
      )}
      {dependencies.data?.pages[0]?.dependencies.length === 0 && (
        <p className="wb-muted">暂无先修关系。</p>
      )}
      {dependencies.data?.pages
        .flatMap((p) => p.dependencies)
        .map((d) => (
          <div className="wb-review-heading" key={d.id}>
            <DependencyLink
              base={base}
              id={
                d.prerequisite_topic_id === topic.id
                  ? d.dependent_topic_id
                  : d.prerequisite_topic_id
              }
              label={
                d.prerequisite_topic_id === topic.id
                  ? "后续知识点"
                  : "先修知识点"
              }
            />
            {writable && (
              <Menu
                label="先修关系更多"
                items={[
                  { label: "删除先修关系", action: () => setDeleting(d.id) },
                ]}
              />
            )}
          </div>
        ))}
      {dependencies.hasNextPage && (
        <Button
          disabled={dependencies.isFetchingNextPage}
          onClick={() => void dependencies.fetchNextPage()}
        >
          更多先修关系
        </Button>
      )}
      {writable && (
        <Button onClick={() => setAdding(true)}>添加先修关系</Button>
      )}
      {adding && (
        <DependencyForm
          base={base}
          topic={topic}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            void changed();
          }}
        />
      )}
      {deleting && (
        <Retire
          base={base}
          kind="topic_dependency"
          id={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            void changed();
          }}
        />
      )}
    </details>
  );
}
function DependencyLink({
  base,
  id,
  label,
}: {
  base: string;
  id: string;
  label: string;
}) {
  const topic = useQuery({
    queryKey: [...memoryKey(base), "topic", id],
    queryFn: () => workbenchRequest<Detail>(`${base}/topics/${id}`),
  });
  return (
    <p>
      {label}：
      {topic.data ? (
        <Link href={`/review?topic=${id}`}>{topic.data.topic.title}</Link>
      ) : topic.isError ? (
        "不可访问"
      ) : (
        "正在加载…"
      )}
    </p>
  );
}
function DependencyForm({
  base,
  topic,
  onClose,
  onSaved,
}: {
  base: string;
  topic: Topic;
  onClose: () => void;
  onSaved: () => void;
}) {
  const topics = usePage<Schema["OnlineTopicPage"]>(base, "/topics");
  const [prerequisite, setPrerequisite] = useState("");
  const [id] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await workbenchRequest(`${base}/dependencies`, {
        method: "POST",
        body: JSON.stringify({
          id,
          prerequisite_topic_id: prerequisite,
          dependent_topic_id: topic.id,
        }),
      });
      onSaved();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open
      title="添加先修关系"
      description={`选择学习《${topic.title}》之前需要掌握的知识点。`}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <form className="wb-memory-form" onSubmit={(e) => void submit(e)}>
        <label>
          先修知识点
          <select
            required
            disabled={busy}
            value={prerequisite}
            onChange={(e) => setPrerequisite(e.target.value)}
          >
            <option value="">请选择</option>
            {topics.data?.pages
              .flatMap((p) => p.topics)
              .filter((t) => t.id !== topic.id)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
          </select>
        </label>
        {topics.hasNextPage && (
          <Button
            disabled={topics.isFetchingNextPage}
            onClick={() => void topics.fetchNextPage()}
          >
            加载更多可选知识点
          </Button>
        )}
        <Failure error={topics.error || error} />
        <Button type="submit" disabled={busy || !prerequisite}>
          保存先修关系
        </Button>
      </form>
    </Sheet>
  );
}

function useUnsaved(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => event.preventDefault();
    const confirm = (event: Event) => {
      if (
        !event.defaultPrevented &&
        !window.confirm("当前回答尚未提交，离开会放弃输入，继续吗？")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const link = (event: MouseEvent) => {
      if ((event.target as Element).closest?.("a[href]")) confirm(event);
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener("workbench:before-navigate", confirm);
    document.addEventListener("click", link, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("workbench:before-navigate", confirm);
      document.removeEventListener("click", link, true);
    };
  }, [dirty]);
}
