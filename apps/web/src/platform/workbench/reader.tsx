"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { components } from "@logion/contracts";
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";
import { useWorkbench } from "./provider";
import { errorMessage, workbenchRequest } from "./api";
import { ThreePanes } from "./panes";
import { ResourceDetails } from "./library";
import { PdfPage } from "./pdf-page";
import { Button } from "./components";
import type { PaneContent, WorkbenchContext } from "./preferences";
import {
  readPdfSelection,
  normalizePdfText as normalize,
  type PdfSelection,
  type SourceText,
} from "./selection";
import { ReadingAiResult } from "./reading-ai";
import { useCloseReadingNote } from "./close-reading-note";
import { useReadingQuiz } from "./reading-quiz";
import { ReadingProgress } from "./reading-progress";
import { NetworkScope } from "./network";

type Resource = components["schemas"]["LibraryResource"];
type Outline = { title: string; page: number | null; depth: number };

export function Reader({ id }: { id: string }) {
  const { context } = useWorkbench();
  const params = useSearchParams();
  return context ? (
    <ReaderScope
      key={`${context.workspace_id}/${context.space_id}/${id}/${params.get("page") ?? ""}/${params.get("quiz") ?? ""}`}
      context={context}
      id={id}
    />
  ) : (
    <p>请先选择空间。</p>
  );
}

function ReaderScope({
  context,
  id,
}: {
  context: WorkbenchContext;
  id: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const params = useSearchParams();
  const rawPage = params.get("page") ?? "";
  const requestedPage = /^\d{1,6}$/.test(rawPage)
    ? Math.max(1, Number(rawPage))
    : null;
  const pageLocated = useRef(false);
  const { preferences, save } = useWorkbench();
  const client = useQueryClient();
  const [sourceText, setSourceText] = useState<SourceText | null>(null);
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  const paletteSelection = useRef<PdfSelection | null>(null);
  const [quote, setQuote] = useState<PdfSelection | null>(null);
  const [question, setQuestion] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState("");
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const path = `/api/v1/workspaces/${context.workspace_id}/spaces/${context.space_id}/library/resources/${encodeURIComponent(id)}`;
  const note = useCloseReadingNote(path, context, sourceText);
  const detail = useQuery({
    queryKey: [
      "workbench",
      "library",
      context.workspace_id,
      context.space_id,
      "detail",
      id,
    ],
    queryFn: () => workbenchRequest<Resource>(path),
  });
  const quiz = useReadingQuiz(path, context, detail.data, sourceText);
  async function showPane(content: PaneContent) {
    const layout = preferences["workbench.layouts"];
    await save("workbench.layouts", {
      ...layout,
      preset: "custom",
      panes: layout.panes.map((pane, index) =>
        index === 2 ? { ...pane, content, collapsed: false } : pane,
      ) as typeof layout.panes,
    });
    window.dispatchEvent(new Event("workbench:reader-show-result"));
  }
  const action = useMutation({
    mutationFn: async ({
      kind,
      selected,
      questionText,
    }: {
      kind: string;
      selected: PdfSelection;
      questionText?: string;
    }) => {
      setActionStatus("");
      if (kind === "chat") {
        setQuote(selected);
        setRunId(null);
        await showPane("chat");
        return;
      }
      if (kind === "excerpt" || kind === "concept") {
        await workbenchRequest(
          `${path}/${kind === "excerpt" ? "excerpts" : "concepts"}`,
          {
            method: "POST",
            body: JSON.stringify({
              source_text_id: selected.source_text_id,
              char_start: selected.char_start,
              char_end: selected.char_end,
            }),
          },
        );
        await client.invalidateQueries({
          queryKey: ["workbench", "excerpts", path],
        });
        await showPane("excerpts");
        setActionStatus(
          kind === "concept"
            ? "概念已创建，并已关联原文摘录。"
            : "摘录已保存。",
        );
        return;
      }
      if (!sourceText || sourceText.id !== selected.source_text_id)
        throw new Error("Source changed");
      setRunId(null);
      const result = await workbenchRequest<
        components["schemas"]["AIRunResponse"]
      >(
        `/api/v1/workspaces/${context.workspace_id}/spaces/${context.space_id}/research/ai/runs`,
        {
          method: "POST",
          body: JSON.stringify({
            id: crypto.randomUUID(),
            idempotency_key: crypto.randomUUID(),
            task_type: kind === "translate" ? "translate" : "explain",
            target: {
              entity_type: "source_text",
              id: sourceText.id,
              version: sourceText.version,
              char_start: selected.char_start,
              char_end: selected.char_end,
            },
            context_entities: [],
            expected_output_fields: ["text"],
            requested_output_tokens: 2000,
            send_confirmed: true,
            ...(questionText ? { question: questionText } : {}),
          }),
        },
      );
      setRunId(result.id);
      setQuote(selected);
      await showPane(questionText ? "chat" : "translate");
    },
  });
  const actionRef = useRef(action);
  useEffect(() => {
    actionRef.current = action;
  }, [action]);
  useEffect(() => {
    function capture() {
      paletteSelection.current =
        root.current && sourceText
          ? readPdfSelection(root.current, sourceText)
          : null;
    }
    function update() {
      const selected =
        root.current && sourceText
          ? readPdfSelection(root.current, sourceText)
          : null;
      setSelection(selected);
      const rect = selected
        ? window.getSelection()?.getRangeAt(0).getBoundingClientRect()
        : null;
      setMenuPosition(
        rect
          ? {
              left: Math.max(8, Math.min(rect.left, window.innerWidth - 300)),
              top: Math.min(
                window.innerHeight - 60,
                Math.max(8, rect.bottom + 8),
              ),
            }
          : null,
      );
    }
    function command(event: Event) {
      const kind = (event as CustomEvent<string>).detail;
      if (
        !["translate", "explain", "excerpt", "concept", "chat"].includes(
          kind,
        ) ||
        actionRef.current.isPending
      )
        return;
      const fromPalette = !!document.querySelector('[role="dialog"]');
      const selected = fromPalette
        ? paletteSelection.current
        : root.current && sourceText
          ? readPdfSelection(root.current, sourceText)
          : null;
      paletteSelection.current = null;
      if (!selected) {
        setActionStatus(
          "请先在 PDF 文字层选中一段内容，等待全文就绪后再操作。",
        );
        return;
      }
      actionRef.current.mutate({ kind, selected });
    }
    document.addEventListener("selectionchange", update);
    window.addEventListener("workbench:reader-capture-selection", capture);
    window.addEventListener("workbench:reader-command", command);
    return () => {
      document.removeEventListener("selectionchange", update);
      window.removeEventListener("workbench:reader-capture-selection", capture);
      window.removeEventListener("workbench:reader-command", command);
    };
  }, [sourceText]);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [outline, setOutline] = useState<Outline[]>([]),
    [failure, setFailure] = useState<unknown>(null),
    [textStatus, setTextStatus] = useState(""),
    [texts, setTexts] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1),
    [page, setPage] = useState(requestedPage ?? 1),
    [query, setQuery] = useState(""),
    [whitePaper, setWhitePaper] = useState(false);
  useEffect(() => {
    if (!pdf || requestedPage === null) return;
    const target = Math.min(pdf.numPages, requestedPage);
    root.current
      ?.querySelector(`[data-pdf-page="${target}"]`)
      ?.scrollIntoView({ block: "start" });
  }, [pdf, requestedPage]);
  function locateRenderedPage(value: number) {
    if (
      !pdf ||
      requestedPage === null ||
      pageLocated.current ||
      value !== Math.min(pdf.numPages, requestedPage)
    )
      return;
    pageLocated.current = true;
    root.current
      ?.querySelector(`[data-pdf-page="${value}"]`)
      ?.scrollIntoView({ block: "start" });
  }
  const [reload, setReload] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (findOpen) search.current?.focus();
  }, [findOpen]);
  useEffect(() => {
    function action(event: Event) {
      const command = (event as CustomEvent<string>).detail;
      if (command === "find") {
        setFindOpen(true);
        search.current?.focus();
      }
      if (command === "white") setWhitePaper((value) => !value);
      if (command === "zoomIn") setZoom((value) => Math.min(3, value + 0.1));
      if (command === "zoomOut") setZoom((value) => Math.max(0.5, value - 0.1));
      if ((command === "next" || command === "previous") && pdf) {
        const target = Math.max(
          1,
          Math.min(pdf.numPages, page + (command === "next" ? 1 : -1)),
        );
        setPage(target);
        root.current
          ?.querySelector(`[data-pdf-page="${target}"]`)
          ?.scrollIntoView({ block: "start" });
      }
    }
    window.addEventListener("workbench:reader-command", action);
    return () => window.removeEventListener("workbench:reader-command", action);
  }, [pdf, page]);
  const resourceReady = !!detail.data;
  const fileIdentity = JSON.stringify(detail.data?.file_locator);
  const attachmentVersion = detail.data?.zotero_attachment_version;
  useEffect(() => {
    if (!resourceReady) return;
    let stopped = false,
      loading: PDFDocumentLoadingTask | undefined;
    const abort = new AbortController();
    async function load() {
      setFailure(null);
      setPdf(null);
      setOutline([]);
      setTexts([]);
      setSourceText(null);
      setSelection(null);
      paletteSelection.current = null;
      setTextStatus("正在抽取全文…");
      const { getDocument, GlobalWorkerOptions, version } =
        await import("pdfjs-dist");
      const assets = `/pdfjs/${version}/`;
      GlobalWorkerOptions.workerSrc = `${assets}pdf.worker.min.mjs`;
      await workbenchRequest(`${path}/pdf/prepare`, {
        method: "POST",
        signal: abort.signal,
      });
      const blob = await workbenchRequest<Blob>(`${path}/pdf`, {
        responseType: "pdf",
        signal: abort.signal,
      });
      const data = await blob.arrayBuffer();
      const sha256 = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
        (value) => value.toString(16).padStart(2, "0"),
      ).join("");
      if (stopped) return;
      const options = {
        data: new Uint8Array(data),
        isEvalSupported: false,
        enableXfa: false,
        useWasm: false,
        cMapUrl: `${assets}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${assets}standard_fonts/`,
        wasmUrl: `${assets}wasm/`,
        disableAutoFetch: true,
        disableStream: true,
        maxImageSize: 16777216,
      };
      // pdf.js 6 removed eval-based font generation entirely. Keep the defensive
      // option for compatible releases; never load a scripting manager.
      loading = getDocument(options);
      // Canvas/text only: no scripting manager, annotation actions or embedded file execution.
      const document = await loading.promise;
      if (stopped) return;
      if (document.numPages > 10000)
        throw new Error("PDF 页数超过阅读器限制。");
      setPdf(document);
      setPage(Math.min(document.numPages, requestedPage ?? 1));
      async function flatten(
        items: Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>,
        depth = 0,
      ): Promise<Outline[]> {
        const result: Outline[] = [];
        for (const item of items ?? []) {
          const dest =
            typeof item.dest === "string"
              ? await document.getDestination(item.dest)
              : item.dest;
          const target = dest?.[0];
          const page =
            typeof target === "number"
              ? target + 1
              : target
                ? (await document.getPageIndex(target)) + 1
                : null;
          result.push({ title: item.title, page, depth });
          if (depth < 10)
            result.push(...(await flatten(item.items, depth + 1)));
          if (result.length >= 1000) break;
        }
        return result.slice(0, 1000);
      }
      const chapters = await flatten(await document.getOutline()).catch(
        () => [],
      );
      if (!stopped) setOutline(chapters);
      try {
        const pages: string[] = [];
        let size = 0;
        for (let n = 1; n <= document.numPages; n++) {
          if (stopped) return;
          const content = await (await document.getPage(n)).getTextContent();
          const text = normalize(
            content.items
              .map((item) =>
                "str" in item ? item.str + (item.hasEOL ? "\n" : "") : "",
              )
              .join(""),
          );
          size += new TextEncoder().encode(text).length + 1;
          if (size > 5 * 1024 * 1024)
            throw new Error("全文超过 5 MB，仍可阅读原文。");
          pages.push(text);
        }
        if (stopped) return;
        setTexts(pages);
        const saved = await workbenchRequest<SourceText>(`${path}/text`, {
          method: "POST",
          signal: abort.signal,
          body: JSON.stringify({
            file_sha256: sha256,
            pages,
            extracted_by: `pdfjs@${version}`,
            normalization_version: "utf8-nfc-lf-v1",
          }),
        });
        if (saved.text !== pages.join("\n") + "\n")
          throw new Error(
            "已保存全文与当前文字层不一致，划选操作暂不可用，仍可阅读原文。",
          );
        if (!stopped) {
          setSourceText(saved);
          setTextStatus("全文已就绪");
        }
      } catch (error) {
        if (!stopped)
          setTextStatus(
            error instanceof Error && !("code" in error)
              ? error.message
              : errorMessage(error),
          );
      }
    }
    void load().catch((error) => {
      if (!stopped) setFailure(error);
    });
    return () => {
      stopped = true;
      abort.abort();
      void loading?.destroy();
    };
  }, [
    path,
    resourceReady,
    fileIdentity,
    attachmentVersion,
    reload,
    requestedPage,
  ]);

  function jump(value: number) {
    if (!pdf) return;
    const target = Math.max(1, Math.min(pdf.numPages, value));
    setPage(target);
    root.current
      ?.querySelector(`[data-pdf-page="${target}"]`)
      ?.scrollIntoView({ block: "start" });
  }
  const found = query.trim()
    ? texts.flatMap((text, index) =>
        text.toLocaleLowerCase().includes(query.toLocaleLowerCase())
          ? [index + 1]
          : [],
      )
    : [];
  function contents(kind: PaneContent) {
    if (kind === "note") return note;
    if (kind === "quiz") return quiz;
    if (kind === "graphlocal")
      return (
        <NetworkScope
          scope={`/api/v1/workspaces/${context.workspace_id}/spaces/${context.space_id}`}
          workspaceId={context.workspace_id}
          focusType="resource"
          focusId={id}
          compact
        />
      );
    if (kind === "excerpts") return <ReadingExcerpts path={path} jump={jump} />;
    if (["chat", "translate", "translation"].includes(kind))
      return (
        <div className="wb-reading-panel">
          <h2>{kind === "chat" ? "引用原文提问" : "翻译与解释"}</h2>
          {quote ? (
            <blockquote>{quote.text}</blockquote>
          ) : (
            <p>在 PDF 中选中文字，按 T 翻译、E 解释或 Q 提问。</p>
          )}
          {kind === "chat" && quote && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (question.trim())
                  action.mutate({
                    kind: "explain",
                    selected: quote,
                    questionText: question.trim(),
                  });
              }}
            >
              <label>
                关于这段原文的问题
                <textarea
                  value={question}
                  maxLength={2000}
                  onChange={(event) => setQuestion(event.target.value)}
                />
              </label>
              <Button
                type="submit"
                disabled={action.isPending || !question.trim()}
              >
                发送问题与引用
              </Button>
            </form>
          )}
          {runId && (
            <ReadingAiResult workspaceId={context.workspace_id} runId={runId} />
          )}
        </div>
      );
    if (kind === "info")
      return detail.data ? (
        <div className="wb-reader-info">
          <h2>文献信息</h2>
          <ResourceDetails item={detail.data} />
          <p role="status">{textStatus}</p>
        </div>
      ) : null;
    if (!pdf && ["pdf", "document", "outline", "thumbs"].includes(kind))
      return (
        <p role="status">{failure ? errorMessage(failure) : "正在打开 PDF…"}</p>
      );
    if (!pdf) return null;
    if (kind === "pdf" || kind === "document")
      return (
        <div className="wb-pdf-pages">
          {Array.from({ length: pdf.numPages }, (_, index) => (
            <PdfPage
              key={index}
              document={pdf}
              pageNumber={index + 1}
              zoom={zoom}
              query={query}
              onReady={locateRenderedPage}
            />
          ))}
        </div>
      );
    if (kind === "outline")
      return (
        <nav aria-label="论文大纲">
          <ul className="wb-pdf-outline">
            {(outline.length
              ? outline
              : texts.map((text, index) => ({
                  title:
                    text
                      .split("\n")
                      .find((line) => line.trim())
                      ?.slice(0, 80) || `第 ${index + 1} 页`,
                  page: index + 1,
                  depth: 0,
                }))
            ).map((item, index) => (
              <li
                key={index}
                style={{ paddingInlineStart: `${item.depth * 12}px` }}
              >
                <Button
                  disabled={item.page === null}
                  onClick={() => jump(item.page!)}
                >
                  {item.title}
                </Button>
              </li>
            ))}
          </ul>
        </nav>
      );
    if (kind === "thumbs")
      return (
        <div className="wb-pdf-thumbnails">
          {Array.from({ length: pdf.numPages }, (_, index) => (
            <PdfPage
              key={index}
              document={pdf}
              pageNumber={index + 1}
              zoom={1}
              thumbnail
              onPage={() => jump(index + 1)}
            />
          ))}
        </div>
      );
    return null;
  }
  return (
    <div
      className="wb-reader-document"
      ref={root}
      data-white-paper={whitePaper}
    >
      <header className="wb-reader-heading">
        <h1 className="wb-reader-title">{detail.data?.title ?? "论文阅读"}</h1>
        {detail.data && <ReadingProgress item={detail.data} path={path} />}
      </header>
      {actionStatus && <p role="status">{actionStatus}</p>}
      {action.isPending && <p role="status">正在处理选中内容…</p>}
      {action.error && <p role="alert">{errorMessage(action.error)}</p>}
      {preferences["reader.selection_menu"] && selection && menuPosition && (
        <div
          className="wb-selection-menu"
          role="toolbar"
          aria-label="选中文字操作"
          style={menuPosition}
          onPointerDown={(event) => event.preventDefault()}
        >
          {[
            ["translate", "翻译 T"],
            ["explain", "解释 E"],
            ["excerpt", "摘录 H"],
            ["chat", "提问 Q"],
            ["concept", "概念 C"],
          ].map(([kind, label]) => (
            <Button
              key={kind}
              disabled={action.isPending}
              onClick={() =>
                action.mutate({ kind: kind!, selected: selection })
              }
            >
              {label}
            </Button>
          ))}
        </div>
      )}
      {!!(detail.error || failure) && (
        <div role="alert">
          {errorMessage(detail.error ?? failure)}{" "}
          <Button
            onClick={() => {
              void detail.refetch();
              setReload((value) => value + 1);
            }}
          >
            重新打开
          </Button>
        </div>
      )}
      {(preferences["workbench.layouts"].toolbars || findOpen) && (
        <div className="wb-pdf-controls">
          <label>
            页码
            <input
              aria-label="跳到页码"
              type="number"
              min={1}
              max={pdf?.numPages ?? 1}
              value={page}
              onChange={(event) => jump(Number(event.target.value))}
            />
          </label>
          <Button
            aria-label="缩小原文"
            onClick={() => setZoom((value) => Math.max(0.5, value - 0.1))}
          >
            −
          </Button>
          <span>{Math.round(zoom * 100)}%</span>
          <Button
            aria-label="放大原文"
            onClick={() => setZoom((value) => Math.min(3, value + 0.1))}
          >
            ＋
          </Button>
          <label>
            查找
            <input
              ref={search}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setFindOpen(false);
                  event.currentTarget.blur();
                }
              }}
              aria-label="在原文中查找"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={200}
            />
          </label>
          <Button
            disabled={!found.length}
            onClick={() =>
              jump(found.find((value) => value > page) ?? found[0]!)
            }
          >
            下一页匹配（{found.length} 页）
          </Button>
          <Button
            aria-pressed={whitePaper}
            onClick={() => setWhitePaper((value) => !value)}
          >
            固定白纸
          </Button>
        </div>
      )}
      <ThreePanes
        initialContent={
          params.get("quiz")
            ? "quiz"
            : requestedPage !== null
              ? "pdf"
              : undefined
        }
        renderContent={contents}
      />
    </div>
  );
}

function ReadingExcerpts({
  path,
  jump,
}: {
  path: string;
  jump: (page: number) => void;
}) {
  const query = useQuery({
    queryKey: ["workbench", "excerpts", path],
    queryFn: () =>
      workbenchRequest<{
        excerpts: {
          id: string;
          excerpt_text: string;
          page_start: number | null;
          origin: string;
        }[];
      }>(`${path}/excerpts`),
  });
  return (
    <section className="wb-reading-panel" aria-label="原文摘录">
      <h2>原文摘录</h2>
      {query.error && <p role="alert">{errorMessage(query.error)}</p>}
      {query.isPending && <p role="status">正在读取摘录…</p>}
      {query.data?.excerpts.map((item) => (
        <article key={item.id}>
          <blockquote>{item.excerpt_text}</blockquote>
          <Button onClick={() => jump(item.page_start ?? 1)}>
            第 {item.page_start ?? 1} 页
          </Button>
          {item.origin === "zotero" && (
            <span className="wb-muted">Zotero · 只读</span>
          )}
        </article>
      ))}
      {query.data?.excerpts.length === 0 && <p>选中原文后按 H 保存摘录。</p>}
    </section>
  );
}
