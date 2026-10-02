import type { components } from "@logion/contracts";

export type SourceText = components["schemas"]["SourceTextResponse"];
export type PdfSelection = {
  source_text_id: string;
  char_start: number;
  char_end: number;
  text: string;
};
// pdf.js emits U+0000 for glyphs without a Unicode mapping (common in math fonts). The
// server rejects control characters, so replace them one-for-one to keep offsets stable.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
export const normalizePdfText = (value: string) =>
  value.replace(/\r\n?/g, "\n").normalize("NFC").replace(CONTROL, "\ufffd");

export const textLayers = new WeakMap<Element, { raw: string; page: number }>();

function endpoint(node: Node, offset: number, end: boolean) {
  if (
    node.nodeType === Node.ELEMENT_NODE &&
    !(node as Element).hasAttribute("data-text-start")
  ) {
    const child = node.childNodes[end ? offset - 1 : offset];
    if (!child) return null;
    node = child;
    while (node.nodeType !== Node.TEXT_NODE && node.childNodes.length)
      node = (end ? node.lastChild : node.firstChild)!;
    offset = end ? (node.textContent?.length ?? 0) : 0;
  }
  const element =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  const span = element?.closest<HTMLElement>("[data-text-start]");
  const layer = span?.closest('[data-reader-text-layer="true"]');
  const info = layer && textLayers.get(layer);
  if (!span || !info) return null;
  const prefixRange = document.createRange();
  prefixRange.setStart(span, 0);
  prefixRange.setEnd(node, offset);
  const rawOffset =
    Number(span.dataset.textStart) + prefixRange.toString().length;
  const before = normalizePdfText(info.raw.slice(0, rawOffset));
  // Never silently split a composed Unicode character at a DOM boundary.
  if (
    before + normalizePdfText(info.raw.slice(rawOffset)) !==
    normalizePdfText(info.raw)
  )
    return null;
  return { page: info.page, offset: Array.from(before).length, layer };
}

export function livePdfRange(): Range | null {
  const selection = window.getSelection();
  if (
    !selection ||
    selection.rangeCount !== 1 ||
    selection.isCollapsed ||
    !selection.toString().trim()
  )
    return null;
  const range = selection.getRangeAt(0);
  const parent = (node: Node) =>
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  if (
    !parent(range.startContainer)?.closest('[data-reader-text-layer="true"]') ||
    !parent(range.endContainer)?.closest('[data-reader-text-layer="true"]')
  )
    return null;
  return range;
}

export function readPdfSelection(
  root: HTMLElement,
  source: SourceText,
): PdfSelection | null {
  const range = livePdfRange();
  if (
    !range ||
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  )
    return null;
  const start = endpoint(range.startContainer, range.startOffset, false);
  const end = endpoint(range.endContainer, range.endOffset, true);
  if (!start || !end) return null;
  const first = source.page_offsets[start.page - 1],
    last = source.page_offsets[end.page - 1];
  if (!first || !last) return null;
  const char_start = first.start! + start.offset,
    char_end = last.start! + end.offset;
  if (char_end <= char_start || char_end - char_start > 20000) return null;
  const text = Array.from(source.text).slice(char_start, char_end).join("");
  if (!text.trim() || new TextEncoder().encode(text).length > 32768)
    return null;
  return { source_text_id: source.id, char_start, char_end, text };
}
