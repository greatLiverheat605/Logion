"use client";

import type { components } from "@logion/contracts";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button, Inspector, List, Sheet } from "./components";
import { errorMessage, workbenchRequest } from "./api";

type Idea = components["schemas"]["IdeaResponse"];
type IdeaPage = components["schemas"]["IdeaPage"];

export function Ideas({ path }: { path: string }) {
  const client = useQueryClient();
  const key = ["workbench", "ideas", path];
  const [selected, setSelected] = useState<string | null>(null);
  const [editor, setEditor] = useState<Idea | "new" | null>(null);
  const listing = useInfiniteQuery({
    queryKey: key,
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      workbenchRequest<IdeaPage>(path, {
        query: pageParam ? { cursor: pageParam } : {},
      }),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const ideas = listing.data?.pages.flatMap((page) => page.ideas) ?? [];
  const current = ideas.find((idea) => idea.id === selected);
  return (
    <section aria-label="私人想法">
      <div className="wb-research-actions">
        <p className="wb-private-label">仅自己可见，AI 不可读</p>
        <Button onClick={() => setEditor("new")}>新建想法</Button>
      </div>
      {listing.isPending && <p role="status">正在载入想法…</p>}
      {listing.error && (
        <p role="alert">
          {errorMessage(listing.error)}{" "}
          <Button onClick={() => void listing.refetch()}>重试</Button>
        </p>
      )}
      <div className="wb-library-columns">
        <section className="wb-library-list" aria-label="想法列表">
          {!ideas.length && listing.isSuccess && (
            <div className="wb-empty">
              <h2>留住还在酝酿的想法</h2>
              <p>未发表的思考单独保存，AI 和 agent 都无法读取。</p>
            </div>
          )}
          <List label="私人想法列表">
            {ideas.map((idea) => (
              <li key={idea.id}>
                <button
                  className="wb-library-row"
                  aria-pressed={idea.id === selected}
                  onClick={() => setSelected(idea.id)}
                >
                  <strong>{idea.title}</strong>
                  <span>
                    {idea.status === "archived" ? "已归档" : "进行中"}
                  </span>
                </button>
              </li>
            ))}
          </List>
          {listing.hasNextPage && (
            <Button
              disabled={listing.isFetchingNextPage}
              onClick={() => void listing.fetchNextPage()}
            >
              载入更多想法
            </Button>
          )}
        </section>
        <Inspector title="想法详情">
          {current ? (
            <>
              <h3>{current.title}</h3>
              <p className="wb-research-body">
                {current.body || "还没有正文。"}
              </p>
              <Button onClick={() => setEditor(current)}>编辑想法</Button>
            </>
          ) : (
            <p>从列表选择一个想法。</p>
          )}
        </Inspector>
      </div>
      <Sheet
        title={editor === "new" ? "新建想法" : "编辑想法"}
        description="仅自己可见，AI 不可读"
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
      >
        {editor && (
          <IdeaForm
            key={editor === "new" ? "new" : `${editor.id}/${editor.version}`}
            path={path}
            item={editor === "new" ? undefined : editor}
            onSaved={async (idea) => {
              await client.invalidateQueries({ queryKey: key });
              setSelected(idea.id);
              setEditor(null);
            }}
          />
        )}
      </Sheet>
    </section>
  );
}

function IdeaForm({
  path,
  item,
  onSaved,
}: {
  path: string;
  item?: Idea;
  onSaved: (idea: Idea) => Promise<void>;
}) {
  const mutation = useMutation({
    mutationFn: (form: HTMLFormElement) => {
      const data = new FormData(form);
      return workbenchRequest<Idea>(item ? `${path}/${item.id}` : path, {
        method: item ? "PUT" : "POST",
        body: JSON.stringify({
          title: String(data.get("title") ?? "").trim(),
          body: String(data.get("body") ?? ""),
          status: String(data.get("status") ?? "active"),
          ...(item ? { expected_version: item.version } : {}),
        }),
      });
    },
    onSuccess: onSaved,
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mutation.isPending) mutation.mutate(event.currentTarget);
  }
  return (
    <form className="wb-library-form" onSubmit={submit}>
      <label>
        标题
        <input
          name="title"
          required
          maxLength={300}
          defaultValue={item?.title}
        />
      </label>
      <label>
        想法正文
        <textarea
          name="body"
          rows={7}
          maxLength={100000}
          defaultValue={item?.body}
        />
      </label>
      <label>
        状态
        <select name="status" defaultValue={item?.status ?? "active"}>
          <option value="active">进行中</option>
          <option value="archived">已归档</option>
        </select>
      </label>
      {mutation.error && <p role="alert">{errorMessage(mutation.error)}</p>}
      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? "正在保存…" : "保存想法"}
      </Button>
    </form>
  );
}
