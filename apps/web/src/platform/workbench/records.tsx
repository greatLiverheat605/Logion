"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { components } from "@logion/contracts";
import { useWorkbench } from "./provider";
import { errorMessage, workbenchRequest } from "./api";
import { Button } from "./components";
import { ReadingNoteDocument } from "./note-document";
import type { WorkbenchContext } from "./preferences";
import "./records.css";

type Note = components["schemas"]["OnlineNoteDetail"];
type Notes = components["schemas"]["OnlineNotePage"];
const canLeave = () =>
  window.dispatchEvent(
    new Event("workbench:before-navigate", { cancelable: true }),
  );

export function Records() {
  const { context } = useWorkbench();
  const params = useSearchParams();
  return context ? (
    <RecordsScope
      key={`${context.workspace_id}/${context.space_id}/${params.get("note") ?? ""}/${params.get("source") ?? ""}`}
      context={context}
    />
  ) : (
    <p>请先选择空间。</p>
  );
}

function RecordsScope({ context }: { context: WorkbenchContext }) {
  const params = useSearchParams();
  const path = `/api/v1/workspaces/${context.workspace_id}/spaces/${context.space_id}/research/notes`;
  const client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(params.get("note"));
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const key = ["workbench", "records", path];
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      workbenchRequest<Notes>(path, {
        query: pageParam ? { cursor: pageParam } : {},
      }),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !canLeave()) return;
    setBusy(true);
    setError(null);
    try {
      const note = await workbenchRequest<Note>(path, {
        method: "POST",
        body: JSON.stringify({ id: crypto.randomUUID(), title }),
      });
      setTitle("");
      setSelected(note.id);
      await client.invalidateQueries({ queryKey: key });
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="wb-page wb-records-page">
      <div className="wb-page-heading">
        <div>
          <h1>记录</h1>
          <p>整理笔记，接着写下理解。</p>
        </div>
      </div>
      <div className="wb-records-layout">
        <section aria-label="笔记列表" className="wb-records-list">
          <h2>笔记列表</h2>
          {query.data?.pages[0]?.can_create && (
            <form onSubmit={(e) => void create(e)}>
              <label>
                新笔记标题
                <input
                  value={title}
                  maxLength={200}
                  required
                  disabled={busy}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <Button type="submit" disabled={busy || !title.trim()}>
                新建笔记
              </Button>
            </form>
          )}
          {query.isPending && <p role="status">正在载入笔记…</p>}
          {!!(query.error || error) && (
            <p role="alert">{errorMessage(query.error || error)}</p>
          )}
          {query.error && (
            <Button onClick={() => void query.refetch()}>重新载入列表</Button>
          )}
          {query.data?.pages[0]?.notes.length === 0 && (
            <p className="wb-muted">
              还没有笔记。可以新建，或在阅读器中创建精读笔记。
            </p>
          )}
          <ul>
            {query.data?.pages
              .flatMap((p) => p.notes)
              .map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    aria-pressed={selected === note.id}
                    onClick={() => {
                      if (selected !== note.id && canLeave())
                        setSelected(note.id);
                    }}
                  >
                    <strong>{note.title}</strong>
                    <span>
                      {note.note_kind === "close_reading"
                        ? "精读笔记 · 仅自己可见"
                        : "笔记"}{" "}
                      · {new Date(note.updated_at).toLocaleDateString()}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
          {query.hasNextPage && (
            <Button
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              加载更多笔记
            </Button>
          )}
        </section>
        {selected ? (
          <LoadNote
            key={selected}
            path={`${path}/${selected}`}
            spaceId={context.space_id}
            listPath={path}
            sourceId={params.get("source")}
          />
        ) : (
          <section className="wb-empty" aria-label="笔记编辑器">
            <h2>选一篇笔记</h2>
            <p>已有笔记和精读笔记都在左侧列表中。修改会在线自动保存。</p>
          </section>
        )}
      </div>
    </div>
  );
}

function LoadNote({
  path,
  spaceId,
  listPath,
  sourceId,
}: {
  path: string;
  spaceId: string;
  listPath: string;
  sourceId: string | null;
}) {
  const [epoch, reload] = useReducer((n: number) => n + 1, 0);
  const source = useQuery({
    queryKey: ["workbench", "note-source", listPath, sourceId],
    enabled: Boolean(sourceId),
    queryFn: () =>
      workbenchRequest<components["schemas"]["OnlineNoteSource"]>(
        `${listPath.replace("/research/notes", "/research/memory/sources")}/${sourceId}`,
      ),
  });
  const query = useQuery({
    queryKey: ["workbench", "record", path, epoch],
    queryFn: () => workbenchRequest<Note>(path),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  return (
    <section aria-label="笔记编辑器" className="wb-record-editor">
      {sourceId && source.error && (
        <p role="alert">来源定位不可用：{errorMessage(source.error)}</p>
      )}
      {query.isPending && <p role="status">正在打开笔记…</p>}
      {query.error && (
        <>
          <p role="alert">{errorMessage(query.error)}</p>
          <Button onClick={() => void query.refetch()}>重新打开笔记</Button>
        </>
      )}
      {query.data && (
        <NoteEditor
          key={epoch}
          initial={query.data}
          source={
            source.data?.note_id === query.data.id ? source.data : undefined
          }
          path={path}
          spaceId={spaceId}
          listPath={listPath}
          reload={reload}
        />
      )}
    </section>
  );
}

function NoteEditor({
  initial,
  source,
  path,
  spaceId,
  listPath,
  reload,
}: {
  initial: Note;
  source?: components["schemas"]["OnlineNoteSource"];
  path: string;
  spaceId: string;
  listPath: string;
  reload: () => void;
}) {
  const [document] = useState(() => new ReadingNoteDocument<Note>(initial));
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (source?.start != null && source.end != null && bodyRef.current) {
      bodyRef.current.focus();
      bodyRef.current.setSelectionRange(source.start, source.end);
    }
  }, [source]);
  const [title, setTitle] = useState(initial.title);
  const [revision, render] = useReducer((n: number) => n + 1, 0);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const saving = useRef<Promise<boolean> | null>(null);
  const client = useQueryClient();
  const invalidate = useCallback(
    () =>
      client.invalidateQueries({
        queryKey: ["workbench", "records", listPath],
      }),
    [client, listPath],
  );
  const flush = useCallback((): Promise<boolean> => {
    if (saving.current) return saving.current;
    if (!document.dirty) return Promise.resolve(true);
    const sentRevision = document.revision;
    const sentTitle = document.server.title;
    setSaving(true);
    saving.current = (async () => {
      try {
        const note = await workbenchRequest<Note>(`${path}/document`, {
          method: "PATCH",
          body: JSON.stringify({
            space_id: spaceId,
            base_version: document.server.version,
            yjs_generation: document.server.yjs_generation,
            update_base64: document.update(),
          }),
        });
        document.acknowledge(note, sentRevision);
        setTitle((current) => (current === sentTitle ? note.title : current));
        setError(null);
        void invalidate();
        return true;
      } catch (failure) {
        setError(failure);
        return false;
      } finally {
        saving.current = null;
        setSaving(false);
        render();
      }
    })();
    return saving.current;
  }, [document, path, spaceId, invalidate]);
  useEffect(() => {
    if (!document.dirty || error || busy) return;
    const timer = setTimeout(() => void flush(), 600);
    return () => clearTimeout(timer);
  }, [document, revision, error, busy, flush]);
  const dirty =
    document.dirty || title !== document.server.title || busy || isSaving;
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => event.preventDefault();
    const confirm = (event: Event) => {
      if (!window.confirm("笔记尚未保存，离开会放弃当前输入，继续吗？")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const link = (event: MouseEvent) => {
      if ((event.target as Element).closest?.("a[href]")) confirm(event);
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener("workbench:before-navigate", confirm);
    window.document.addEventListener("click", link, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("workbench:before-navigate", confirm);
      window.document.removeEventListener("click", link, true);
    };
  }, [dirty]);
  async function rename(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (!(await flush())) return;
      // An in-flight save may have acknowledged an earlier edit; flush the remainder.
      if (!(await flush())) return;
      const note = await workbenchRequest<Note>(path, {
        method: "PATCH",
        body: JSON.stringify({
          expected_version: document.server.version,
          title,
        }),
      });
      document.acknowledge(note, document.revision);
      setTitle(note.title);
      setError(null);
      render();
      void invalidate();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h2>{document.server.title}</h2>
      {source && (
        <p role="status">
          {source.state === "modified"
            ? "来源已修改，请核对原选段。"
            : source.start != null
              ? "已定位原选段。"
              : "已打开来源笔记。"}
        </p>
      )}
      {document.server.note_kind === "close_reading" ? (
        <>
          <p className="wb-muted">精读笔记 · 仅自己可见</p>
          {document.server.source_available ? (
            <Link
              className="wb-button"
              href={`/read/${document.server.resource_id}`}
            >
              在阅读器中编辑精读笔记
            </Link>
          ) : (
            <p role="status">原文已删除或不可访问，笔记保留供查阅。</p>
          )}
          <label>
            精读笔记正文
            <textarea readOnly value={document.markdown} />
          </label>
        </>
      ) : (
        <>
          {!document.server.can_edit && (
            <p className="wb-muted">
              你可以阅读这篇共享笔记，当前角色没有编辑权限。
            </p>
          )}
          <form onSubmit={(e) => void rename(e)}>
            <label>
              笔记标题
              <input
                value={title}
                maxLength={200}
                required
                disabled={busy || !document.server.can_edit}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <Button
              type="submit"
              disabled={
                busy ||
                !document.server.can_edit ||
                !title.trim() ||
                title === document.server.title
              }
            >
              保存标题
            </Button>
          </form>
          <label>
            笔记正文
            <textarea
              ref={bodyRef}
              value={document.markdown}
              maxLength={500000}
              readOnly={!document.server.can_edit}
              disabled={busy}
              onChange={(e) => {
                document.edit(e.target.value);
                render();
              }}
            />
          </label>
          <p role="status" className="wb-muted">
            {isSaving
              ? "正在保存…"
              : document.dirty
                ? "尚未保存"
                : "正文已保存"}
            {title !== document.server.title ? " · 标题尚未保存" : ""}
          </p>
          {!!error && <p role="alert">{errorMessage(error)}</p>}
          {!!error && document.dirty && (
            <Button disabled={isSaving || busy} onClick={() => void flush()}>
              重试保存正文
            </Button>
          )}
          <Button
            disabled={isSaving || busy}
            onClick={() => {
              if (
                !dirty ||
                window.confirm("载入服务器版本会放弃当前未保存的输入，继续吗？")
              )
                reload();
            }}
          >
            载入最新版本
          </Button>
        </>
      )}
    </>
  );
}
