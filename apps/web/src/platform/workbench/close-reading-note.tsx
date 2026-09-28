"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@logion/contracts";
import { errorMessage, workbenchRequest } from "./api";
import { Button } from "./components";
import { readingAiError } from "./reading-ai";
import { ReadingNoteDocument, type ReadingNote } from "./note-document";
import type { SourceText } from "./selection";
import type { WorkbenchContext } from "./preferences";

const labels: Record<string, string> = {
  motivation: "动机",
  modeling: "建模",
  experiments: "实验",
  conclusions: "结论",
  critique: "批判",
  takeaway: "一句话要点",
  open_questions: "待解决问题",
};
type Runs = components["schemas"]["ReadingNoteRuns"];
type Draft = components["schemas"]["AIOutputDraftResponse"];

// The hook belongs to ReaderScope: hiding or switching a pane keeps unsaved text in memory.
export function useCloseReadingNote(
  path: string,
  context: WorkbenchContext,
  source: SourceText | null,
) {
  const client = useQueryClient();
  const key = ["workbench", "reading-note", path];
  const runsKey = ["workbench", "reading-note-runs", path];
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const note = await workbenchRequest<ReadingNote | null>(`${path}/note`);
      return note ? new ReadingNoteDocument(note) : null;
    },
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const document = query.data;
  const [revision, render] = useReducer((n: number) => n + 1, 0);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [isSaving, setSaving] = useState(false);
  const runs = useQuery({
    queryKey: runsKey,
    enabled: !!document,
    queryFn: () => workbenchRequest<Runs>(`${path}/note/ai-runs`),
    refetchInterval: (q) =>
      q.state.data?.runs.some((item) =>
        ["queued", "running"].includes(item.run.status),
      )
        ? 1000
        : false,
  });
  const flush = useCallback(async () => {
    if (!document || !document.dirty || saving.current) return;
    saving.current = true;
    setSaving(true);
    const sentRevision = document.revision;
    render();
    try {
      const note = await workbenchRequest<ReadingNote>(
        `${path}/note/document`,
        {
          method: "PATCH",
          body: JSON.stringify({
            space_id: context.space_id,
            base_version: document.server.version,
            yjs_generation: document.server.yjs_generation,
            update_base64: document.update(),
          }),
        },
      );
      document.acknowledge(note, sentRevision);
      setError(null);
    } catch (failure) {
      setError(failure);
    } finally {
      saving.current = false;
      setSaving(false);
      render();
    }
  }, [document, path, context.space_id]);
  useEffect(() => {
    if (!document?.dirty || error) return;
    const timer = setTimeout(() => void flush(), 600);
    return () => clearTimeout(timer);
  }, [document, revision, error, flush]);
  useEffect(() => {
    if (!document?.dirty) return;
    const leaving = (event: BeforeUnloadEvent) => event.preventDefault();
    const navigate = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest?.("a[href]");
      if (anchor && !window.confirm("精读笔记尚未保存，仍要离开吗？")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", leaving);
    window.document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", leaving);
      window.document.removeEventListener("click", navigate, true);
    };
  }, [document, revision]);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  async function decide(draft: Draft, decision: "accepted" | "rejected") {
    if (!document || document.dirty || isSaving) return;
    const note = await workbenchRequest<ReadingNote>(
      `${path}/note/drafts/${draft.id}/decision`,
      {
        method: "POST",
        body: JSON.stringify({
          decision,
          expected_note_version: document.server.version,
          expected_draft_version: draft.version,
        }),
      },
    );
    client.setQueryData(key, new ReadingNoteDocument(note));
    await client.invalidateQueries({ queryKey: runsKey });
  }
  const aiBusy = runs.data?.runs.some((item) =>
    ["queued", "running"].includes(item.run.status),
  );
  return (
    <div className="wb-reading-panel wb-close-reading">
      <h2>五角度精读笔记</h2>
      <p className="wb-muted">动机 · 建模 · 实验 · 结论 · 批判</p>
      {(error || query.error) && (
        <p role="alert">{errorMessage(error || query.error)}</p>
      )}
      {(error || query.error) && (
        <Button
          disabled={busy || isSaving}
          onClick={() => {
            if (
              document?.dirty &&
              !window.confirm("载入服务器版本会放弃当前未保存的输入，继续吗？")
            )
              return;
            setError(null);
            void query.refetch();
          }}
        >
          重新加载笔记
        </Button>
      )}
      {query.isPending ? (
        <p role="status">正在加载笔记…</p>
      ) : !document ? (
        <Button
          disabled={busy || !!query.error}
          onClick={() =>
            void perform(async () => {
              const note = await workbenchRequest<ReadingNote>(`${path}/note`, {
                method: "POST",
              });
              client.setQueryData(key, new ReadingNoteDocument(note));
            })
          }
        >
          创建精读笔记
        </Button>
      ) : (
        <>
          <label>
            精读笔记正文
            <textarea
              className="wb-note-editor"
              value={document.markdown}
              maxLength={500000}
              disabled={busy}
              onChange={(event) => {
                document.edit(event.target.value);
                setError(null);
                render();
              }}
            />
          </label>
          <p role="status" className="wb-muted">
            {isSaving ? "正在保存…" : document.dirty ? "尚未保存" : "已保存"}
          </p>
          {document.dirty && (
            <Button disabled={isSaving || busy} onClick={() => void flush()}>
              重试保存
            </Button>
          )}
          <p className="wb-muted">
            AI 只起草缺失的节，接受后才写入笔记。将发送当前笔记和原文。
          </p>
          <Button
            disabled={
              busy ||
              document.dirty ||
              isSaving ||
              aiBusy ||
              !source ||
              !document.server.missing_sections.length
            }
            onClick={() =>
              void perform(async () => {
                if (!source) return;
                await workbenchRequest(
                  `/api/v1/workspaces/${context.workspace_id}/spaces/${context.space_id}/research/ai/runs`,
                  {
                    method: "POST",
                    body: JSON.stringify({
                      id: crypto.randomUUID(),
                      idempotency_key: crypto.randomUUID(),
                      task_type: "close_reading",
                      target: {
                        entity_type: "note",
                        id: document.server.id,
                        version: document.server.version,
                      },
                      context_entities: [
                        {
                          entity_type: "source_text",
                          id: source.id,
                          version: source.version,
                        },
                      ],
                      expected_output_fields: document.server.missing_sections,
                      requested_output_tokens: 1800,
                      send_confirmed: true,
                      retain_input: false,
                    }),
                  },
                );
                await client.invalidateQueries({ queryKey: runsKey });
              })
            }
          >
            发送原文并起草缺失章节
          </Button>
          {!source && <p className="wb-muted">全文就绪后可请求 AI 草稿。</p>}
          {runs.error && <p role="alert">{errorMessage(runs.error)}</p>}
          {runs.data?.runs.map(({ run, draft }) => (
            <section key={run.id} aria-label="精读 AI 草稿">
              {["queued", "running"].includes(run.status) ? (
                <p role="status">AI 正在起草…</p>
              ) : run.status !== "succeeded" ? (
                <p role="alert">{readingAiError(run.error_code)}</p>
              ) : (
                draft && (
                  <>
                    <h3>待确认草稿</h3>
                    {run.target_version !== document.server.version && (
                      <p role="alert">
                        笔记已更新，这份草稿不能直接接受。请丢弃后重新起草。
                      </p>
                    )}
                    {Object.entries(draft.structured_output).map(
                      ([field, text]) => (
                        <div key={field}>
                          <h4>{labels[field] ?? field}</h4>
                          <p className="wb-reading-output">{text}</p>
                        </div>
                      ),
                    )}
                    <div className="wb-reading-actions">
                      <Button
                        disabled={
                          busy ||
                          document.dirty ||
                          run.target_version !== document.server.version
                        }
                        onClick={() =>
                          void perform(() => decide(draft, "accepted"))
                        }
                      >
                        接受并写入笔记
                      </Button>
                      <Button
                        disabled={busy || document.dirty}
                        onClick={() =>
                          void perform(() => decide(draft, "rejected"))
                        }
                      >
                        丢弃草稿
                      </Button>
                    </div>
                  </>
                )
              )}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
