"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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

type Resource = components["schemas"]["LibraryResource"];
type Outline = { title: string; page: number | null; depth: number };
const normalize = (value: string) =>
  value.replace(/\r\n?/g, "\n").normalize("NFC");

export function Reader({ id }: { id: string }) {
  const { context } = useWorkbench();
  return context ? (
    <ReaderScope
      key={`${context.workspace_id}/${context.space_id}/${id}`}
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
  const { preferences } = useWorkbench();
  const path = `/api/v1/workspaces/${context.workspace_id}/spaces/${context.space_id}/library/resources/${encodeURIComponent(id)}`;
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
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [outline, setOutline] = useState<Outline[]>([]),
    [failure, setFailure] = useState<unknown>(null),
    [textStatus, setTextStatus] = useState(""),
    [texts, setTexts] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1),
    [page, setPage] = useState(1),
    [query, setQuery] = useState(""),
    [whitePaper, setWhitePaper] = useState(false);
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
      setTextStatus("正在抽取全文…");
      const { getDocument, GlobalWorkerOptions, version } =
        await import("pdfjs-dist");
      const assets = `/pdfjs/${version}/`;
      GlobalWorkerOptions.workerSrc = `${assets}pdf.worker.min.mjs`;
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
        await workbenchRequest(`${path}/text`, {
          method: "POST",
          signal: abort.signal,
          body: JSON.stringify({
            file_sha256: sha256,
            pages,
            extracted_by: `pdfjs@${version}`,
            normalization_version: "utf8-nfc-lf-v1",
          }),
        });
        if (!stopped) setTextStatus("全文已就绪");
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
  }, [path, resourceReady, fileIdentity, attachmentVersion, reload]);

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
    if (kind === "info")
      return detail.data ? (
        <div className="wb-reader-info">
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
      <h1 className="wb-reader-title">{detail.data?.title ?? "论文阅读"}</h1>
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
      <ThreePanes renderContent={contents} />
    </div>
  );
}
