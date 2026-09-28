"use client";

import { useEffect, useRef, useState } from "react";
import { textLayers } from "./selection";
import type {
  PDFDocumentProxy,
  RenderTask,
  TextLayer as TextLayerType,
} from "pdfjs-dist";

export function PdfPage({
  document: pdf,
  pageNumber,
  zoom,
  thumbnail = false,
  query = "",
  onPage,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  thumbnail?: boolean;
  query?: string;
  onPage?: () => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    text = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0),
    [visible, setVisible] = useState(false),
    [rendered, setRendered] = useState(0),
    [failure, setFailure] = useState(false);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const sizing = new ResizeObserver((entries) =>
      setWidth(Math.round(entries[0]?.contentRect.width ?? 0)),
    );
    const visibility = new IntersectionObserver(
      (entries) => setVisible(Boolean(entries[0]?.isIntersecting)),
      { rootMargin: "800px" },
    );
    sizing.observe(element);
    visibility.observe(element);
    return () => {
      sizing.disconnect();
      visibility.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!visible || !width || !canvas.current || !text.current) return;
    const target = canvas.current,
      layer = text.current;
    let stopped = false,
      rendering: RenderTask | undefined,
      textLayer: TextLayerType | undefined;
    async function render() {
      const page = await pdf.getPage(pageNumber);
      if (stopped) return;
      const viewport = page.getViewport({
        scale: (width / page.getViewport({ scale: 1 }).width) * zoom,
      });
      // Bound backing canvas to 16M pixels, including very large PDF page sizes.
      const ratio = Math.min(
        window.devicePixelRatio || 1,
        2,
        Math.sqrt(16777216 / (viewport.width * viewport.height)),
      );
      target.width = Math.ceil(viewport.width * ratio);
      target.height = Math.ceil(viewport.height * ratio);
      target.style.width = `${viewport.width}px`;
      target.style.height = `${viewport.height}px`;
      const paper = target.parentElement!;
      paper.style.width = `${viewport.width}px`;
      paper.style.height = `${viewport.height}px`;
      layer.replaceChildren();
      layer.style.setProperty("--scale-factor", String(viewport.scale));
      layer.style.setProperty("--total-scale-factor", String(viewport.scale));
      rendering = page.render({
        canvas: target,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      await rendering.promise;
      if (stopped) return;
      if (thumbnail) {
        setRendered((value) => value + 1);
        return;
      }
      const { TextLayer } = await import("pdfjs-dist");
      const content = await page.getTextContent();
      textLayer = new TextLayer({
        textContentSource: content,
        container: layer,
        viewport,
      });
      if (stopped) return;
      await textLayer.render();
      let raw = "",
        index = 0;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const span = textLayer.textDivs[index++];
        if (span) span.dataset.textStart = String(raw.length);
        raw += item.str + (item.hasEOL ? "\n" : "");
      }
      textLayers.set(layer, { raw, page: pageNumber });
      if (!stopped) setRendered((value) => value + 1);
    }
    void render().catch(() => {
      if (!stopped) setFailure(true);
    });
    return () => {
      stopped = true;
      rendering?.cancel();
      textLayer?.cancel();
      textLayers.delete(layer);
      layer.replaceChildren();
      target.width = target.height = 0;
    };
  }, [pdf, pageNumber, width, visible, zoom, thumbnail]);
  useEffect(() => {
    const spans = Array.from(text.current?.querySelectorAll("span") ?? []);
    const parts = spans.map((span) => span.textContent.toLocaleLowerCase());
    const body = parts.join("");
    const needle = query.trim().toLocaleLowerCase();
    const matches: [number, number][] = [];
    if (needle) {
      for (
        let start = body.indexOf(needle);
        start !== -1;
        start = body.indexOf(needle, start + needle.length)
      ) {
        matches.push([start, start + needle.length]);
      }
    }
    let offset = 0;
    for (let i = 0; i < spans.length; i++) {
      const end = offset + parts[i]!.length;
      spans[i]!.classList.toggle(
        "wb-text-match",
        matches.some(([start, stop]) => start < end && stop > offset),
      );
      offset = end;
    }
  }, [query, rendered]);
  return (
    <div
      ref={root}
      className={thumbnail ? "wb-pdf-thumbnail" : "wb-pdf-page"}
      data-pdf-page={thumbnail ? undefined : pageNumber}
      data-rendered={rendered > 0}
    >
      <div className="wb-pdf-paper">
        <canvas
          ref={canvas}
          aria-label={`第 ${pageNumber} 页${thumbnail ? "缩略图" : ""}`}
          role="img"
        />
        <div
          className="textLayer"
          data-reader-text-layer={thumbnail ? undefined : "true"}
          ref={text}
        />
      </div>
      {failure && <p role="alert">第 {pageNumber} 页暂时无法显示。</p>}
      {thumbnail ? (
        <button className="wb-button" onClick={onPage}>
          第 {pageNumber} 页
        </button>
      ) : (
        <span className="wb-pdf-page-number">{pageNumber}</span>
      )}
    </div>
  );
}
