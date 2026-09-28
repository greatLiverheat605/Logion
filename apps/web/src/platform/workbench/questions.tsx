"use client";

import type { components } from "@logion/contracts";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button, Inspector, Segmented, Sheet } from "./components";
import { errorMessage, workbenchRequest } from "./api";
import { useWorkbench } from "./provider";
import { Ideas } from "./research-ideas";

type Question = components["schemas"]["TreeQuestion"];
type QuestionPage = components["schemas"]["QuestionPage"];
const STATUSES = {
  active: "进行中",
  answered: "已回答",
  parked: "搁置",
} as const;
type Editor = "new" | "edit" | "split" | "merge";

export function Questions() {
  const { context } = useWorkbench();
  const [tab, setTab] = useState("questions");
  if (!context)
    return <div className="wb-empty">请先选择一个可访问的空间。</div>;
  const scope = `/api/v1/workspaces/${context.workspace_id}/spaces/${context.space_id}/research`;
  return (
    <div className="wb-page wb-questions-page">
      <div className="wb-page-heading">
        <div>
          <h1>研究问题</h1>
          <p>从一个问题开始，保留探索的来路。</p>
        </div>
      </div>
      <Segmented
        label="研究内容"
        value={tab}
        onChange={setTab}
        options={[
          { id: "questions", label: "问题树" },
          { id: "ideas", label: "私人想法" },
        ]}
      />
      {tab === "questions" ? (
        <QuestionScope key={scope} path={`${scope}/question-tree`} />
      ) : (
        <Ideas key={scope} path={`${scope}/ideas`} />
      )}
    </div>
  );
}

function QuestionScope({ path }: { path: string }) {
  const client = useQueryClient();
  const key = ["workbench", "questions", path];
  const [selected, setSelected] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const listing = useInfiniteQuery({
    queryKey: key,
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      workbenchRequest<QuestionPage>(path, {
        query: pageParam ? { cursor: pageParam } : {},
      }),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const questions = listing.data?.pages.flatMap((page) => page.questions) ?? [];
  const current = questions.find((q) => q.id === selected);
  const parent = questions.find((q) => q.id === current?.parent_id);
  return (
    <>
      <div className="wb-research-actions">
        <Button onClick={() => setEditor("new")}>新建问题</Button>
        <Button
          disabled={questions.length < 2}
          onClick={() => setEditor("merge")}
        >
          合并问题
        </Button>
      </div>
      {listing.error && (
        <p role="alert">
          {errorMessage(listing.error)}{" "}
          <Button onClick={() => void listing.refetch()}>重试</Button>
        </p>
      )}
      {listing.isPending && <p role="status">正在载入问题…</p>}
      <div className="wb-library-columns">
        <section className="wb-library-list" aria-label="问题树">
          {questions.length === 0 && listing.isSuccess && (
            <div className="wb-empty">
              <h2>还没有研究问题</h2>
              <p>记下一个值得研究的问题，再逐步拆分。</p>
            </div>
          )}
          <QuestionTree
            questions={questions}
            selected={selected}
            onSelect={setSelected}
          />
          {listing.hasNextPage && (
            <div className="wb-research-more">
              <p>还有问题未载入，当前层级可能不完整。</p>
              <Button
                disabled={listing.isFetchingNextPage}
                onClick={() => void listing.fetchNextPage()}
              >
                载入更多问题
              </Button>
            </div>
          )}
        </section>
        <Inspector title="问题详情">
          {current ? (
            <>
              <span className="wb-research-status">
                {STATUSES[current.status ?? "active"]}
              </span>
              <h3>{current.question}</h3>
              <p className="wb-research-body">
                {current.rationale || "还没有补充研究缘由。"}
              </p>
              {current.parent_id && (
                <p>
                  上级问题：
                  {parent ? (
                    <Button onClick={() => setSelected(parent.id)}>
                      {parent.question}
                    </Button>
                  ) : (
                    "请载入更多问题查看"
                  )}
                </p>
              )}
              <div className="wb-research-actions">
                <Button onClick={() => setEditor("edit")}>编辑问题</Button>
                <Button onClick={() => setEditor("split")}>拆分问题</Button>
                <Link
                  className="wb-button"
                  href={`/graph?question=${encodeURIComponent(current.id)}`}
                >
                  查看知识网
                </Link>
              </div>
            </>
          ) : (
            <p>选择一个问题，查看详情或继续拆分。</p>
          )}
        </Inspector>
      </div>
      <Sheet
        title={
          {
            new: "新建问题",
            edit: "编辑问题",
            split: "拆分问题",
            merge: "合并问题",
          }[editor ?? "new"]
        }
        description={
          editor === "merge"
            ? "新建共同的上级问题，保留所选问题及其全部内容与引用。"
            : editor === "split"
              ? "增加至少两个子问题，原问题及其内容继续保留。"
              : "问题仅自己可见，可以由你选择作为 AI 上下文。"
        }
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
      >
        {editor && (
          <QuestionForm
            key={`${editor}/${current?.id}/${current?.version}`}
            mode={editor}
            item={current}
            questions={questions}
            path={path}
            onSaved={async (id) => {
              await client.invalidateQueries({ queryKey: key });
              setSelected(id);
              setEditor(null);
            }}
          />
        )}
      </Sheet>
    </>
  );
}

function QuestionTree({
  questions,
  selected,
  onSelect,
}: {
  questions: Question[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const ids = new Set(questions.map((q) => q.id));
  const children = new Map<string | null, Question[]>();
  for (const question of questions) {
    const parent =
      question.parent_id && ids.has(question.parent_id)
        ? question.parent_id
        : null;
    children.set(parent, [...(children.get(parent) ?? []), question]);
  }
  function branch(parent: string | null, depth: number) {
    if (depth > 32) return null;
    return (
      <ul className="wb-question-tree">
        {children.get(parent)?.map((item) => (
          <li key={item.id}>
            <div className="wb-question-row">
              {children.has(item.id) && (
                <Button
                  className="wb-question-toggle"
                  aria-label={`${collapsed.has(item.id) ? "展开" : "折叠"} ${item.question}`}
                  aria-expanded={!collapsed.has(item.id)}
                  onClick={() =>
                    setCollapsed((old) => {
                      const next = new Set(old);
                      if (next.has(item.id)) next.delete(item.id);
                      else next.add(item.id);
                      return next;
                    })
                  }
                >
                  {collapsed.has(item.id) ? "+" : "−"}
                </Button>
              )}
              <button
                className="wb-library-row"
                aria-pressed={selected === item.id}
                onClick={() => onSelect(item.id)}
              >
                <strong>{item.question}</strong>
                <span>
                  {STATUSES[item.status ?? "active"]}
                  {depth > 0 ? ` · 第 ${depth + 1} 层` : ""}
                </span>
              </button>
            </div>
            {children.has(item.id) &&
              !collapsed.has(item.id) &&
              branch(item.id, depth + 1)}
          </li>
        ))}
      </ul>
    );
  }
  return branch(null, 0);
}

function QuestionForm({
  mode,
  item,
  questions,
  path,
  onSaved,
}: {
  mode: Editor;
  item?: Question;
  questions: Question[];
  path: string;
  onSaved: (id: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const mutation = useMutation({
    mutationFn: async (form: HTMLFormElement) => {
      const data = new FormData(form);
      const text = (name: string) => String(data.get(name) ?? "").trim();
      const fields = {
        question: text("question"),
        rationale: text("rationale"),
        status: text("status") || "active",
      };
      if (mode === "split" && item) {
        await workbenchRequest<QuestionPage>(`${path}/${item.id}/split`, {
          method: "POST",
          body: JSON.stringify({
            expected_version: item.version,
            children: text("children")
              .split("\n")
              .map((question) => question.trim())
              .filter(Boolean)
              .map((question) => ({ question })),
          }),
        });
        return item.id;
      }
      const result = await workbenchRequest<Question>(
        mode === "merge"
          ? `${path}/merge`
          : mode === "edit" && item
            ? `${path}/${item.id}`
            : path,
        {
          method: mode === "edit" ? "PUT" : "POST",
          body: JSON.stringify(
            mode === "merge"
              ? {
                  ...fields,
                  sources: selected.map((id) => ({
                    id,
                    expected_version: questions.find((q) => q.id === id)!
                      .version,
                  })),
                }
              : {
                  ...fields,
                  parent_id: text("parent") || null,
                  ...(mode === "edit" && item
                    ? { expected_version: item.version }
                    : {}),
                },
          ),
        },
      );
      return result.id;
    },
    onSuccess: onSaved,
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mutation.isPending) mutation.mutate(event.currentTarget);
  }
  return (
    <form className="wb-library-form" onSubmit={submit}>
      {mode === "split" ? (
        <label>
          子问题（每行一个，2–20 个）
          <textarea name="children" required rows={5} maxLength={600000} />
        </label>
      ) : (
        <>
          <label>
            {mode === "merge" ? "共同的上级问题" : "问题"}
            <textarea
              name="question"
              required
              maxLength={30000}
              rows={2}
              defaultValue={mode === "edit" ? item?.question : ""}
            />
          </label>
          <label>
            研究缘由
            <textarea
              name="rationale"
              maxLength={30000}
              rows={3}
              defaultValue={mode === "edit" ? item?.rationale : ""}
            />
          </label>
          <label>
            状态
            <select
              name="status"
              defaultValue={mode === "edit" ? item?.status : "active"}
            >
              {Object.entries(STATUSES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {mode === "merge" ? (
            <fieldset className="wb-question-choices">
              <legend>选择要合并的问题（2–20 个）</legend>
              {questions.map((q) => (
                <label key={q.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(q.id)}
                    disabled={!selected.includes(q.id) && selected.length >= 20}
                    onChange={(e) =>
                      setSelected((old) =>
                        e.target.checked
                          ? [...old, q.id]
                          : old.filter((id) => id !== q.id),
                      )
                    }
                  />
                  {q.question}
                </label>
              ))}
            </fieldset>
          ) : (
            <label>
              上级问题
              <select
                name="parent"
                defaultValue={mode === "edit" ? (item?.parent_id ?? "") : ""}
              >
                <option value="">无（根问题）</option>
                {questions
                  .filter((q) => q.id !== item?.id || mode !== "edit")
                  .map((q) => (
                    <option value={q.id} key={q.id}>
                      {q.question}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </>
      )}
      {mutation.error && <p role="alert">{errorMessage(mutation.error)}</p>}
      <Button
        type="submit"
        disabled={
          mutation.isPending || (mode === "merge" && selected.length < 2)
        }
      >
        {mutation.isPending
          ? "正在保存…"
          : mode === "split"
            ? "确认拆分"
            : mode === "merge"
              ? "确认合并"
              : "保存问题"}
      </Button>
    </form>
  );
}
