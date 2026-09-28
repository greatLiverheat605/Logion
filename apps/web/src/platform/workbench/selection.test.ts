// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import {
  livePdfRange,
  readPdfSelection,
  textLayers,
  type SourceText,
} from "./selection";

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

it("maps UTF-16 DOM positions to normalized Unicode scalars across pages and retains real line breaks", () => {
  document.body.innerHTML =
    '<div id="root"><div data-reader-text-layer="true"><span data-text-start="0">é😀 first</span></div><div data-reader-text-layer="true"><span data-text-start="0">second</span></div></div>';
  const layers = document.querySelectorAll("[data-reader-text-layer]");
  textLayers.set(layers[0]!, { raw: "e\u0301😀 first", page: 1 });
  textLayers.set(layers[1]!, { raw: "second", page: 2 });
  const range = document.createRange();
  range.setStart(layers[0]!.firstChild!.firstChild!, 2);
  range.setEnd(layers[1]!.firstChild!.firstChild!, 3);
  window.getSelection()!.addRange(range);
  const source = {
    id: "source",
    resource_id: "resource",
    file_sha256: "a".repeat(64),
    version: 1,
    extracted_by: "pdfjs@6.3.289",
    normalization_version: "utf8-nfc-lf-v1",
    text: "é😀 first\nsecond\n",
    page_offsets: [
      { start: 0, end: 9 },
      { start: 9, end: 16 },
    ],
  } as SourceText;
  expect(readPdfSelection(document.getElementById("root")!, source)).toEqual({
    source_text_id: "source",
    char_start: 1,
    char_end: 12,
    text: "😀 first\nsec",
  });
  range.setStart(layers[0]!.firstChild!.firstChild!, 1);
  expect(readPdfSelection(document.getElementById("root")!, source)).toBeNull();
});

it("rejects an empty selection and selection that crosses into non-PDF content", () => {
  document.body.innerHTML =
    '<div data-reader-text-layer="true"><span>Paper</span></div><p>Private note</p>';
  expect(livePdfRange()).toBeNull();
  const range = document.createRange();
  range.setStart(document.querySelector("span")!.firstChild!, 0);
  range.setEnd(document.querySelector("p")!.firstChild!, 7);
  window.getSelection()!.addRange(range);
  expect(livePdfRange()).toBeNull();
});
