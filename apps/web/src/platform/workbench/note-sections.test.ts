import { describe, expect, it } from "vitest";
import * as Y from "@logion/offline/yjs";
import { ReadingNoteDocument } from "./note-document";
import { editReadingSection, readingSection } from "./note-sections";

describe("close-reading section edits", () => {
  it("preserves legacy prose, custom headings and boundary text while typing newlines", () => {
    const before = "旧前言😀\n\n## 动机\n原内容\n\n## 我的证据\n不可丢失。\n";
    let next = editReadingSection(before, "motivation", "新内容\n");
    expect(readingSection(next, "motivation").body).toBe("新内容\n");
    next = editReadingSection(next, "motivation", "新内容\n下一段\n\n");
    expect(readingSection(next, "motivation").body).toBe("新内容\n下一段\n\n");
    expect(next.startsWith("旧前言😀\n\n## 动机\n")).toBe(true);
    expect(next.endsWith("## 我的证据\n不可丢失。\n")).toBe(true);
    expect(editReadingSection(before, "critique", "批判内容")).toBe(
      before + "\n## 批判\n批判内容\n\n",
    );
    expect(editReadingSection(before, "critique", "")).toBe(before);
    expect(editReadingSection("## 动机", "motivation", "补充")).toBe(
      "## 动机\n补充\n\n",
    );
  });

  it("does not guess which duplicate section to overwrite", () => {
    const markdown = "## 动机\n第一份\n\n## 动机\n第二份\n";
    expect(readingSection(markdown, "motivation").duplicate).toBe(true);
    expect(() => editReadingSection(markdown, "motivation", "更改")).toThrow(
      "重复章节",
    );
  });

  it("merges distinct sections and keeps typing made while a save is in flight", () => {
    const server = new Y.Doc();
    server
      .getText("markdown")
      .insert(0, "旧前言😀\n\n## 动机\n\n\n## 建模\n\n");
    const snapshot = () => ({
      version: 1,
      yjs_generation: 1,
      yjs_state_base64: btoa(
        String.fromCharCode(...Y.encodeStateAsUpdate(server)),
      ),
    });
    const a = new ReadingNoteDocument(snapshot());
    const b = new ReadingNoteDocument(snapshot());
    a.edit(editReadingSection(a.markdown, "motivation", "第一段"));
    b.edit(editReadingSection(b.markdown, "modeling", "第二标签页的模型"));
    const revision = a.revision;
    const update = a.update();
    a.edit(editReadingSection(a.markdown, "motivation", "第一段\n继续输入😀"));
    const apply = (value: string) =>
      Y.applyUpdate(
        server,
        Uint8Array.from(atob(value), (c) => c.charCodeAt(0)),
      );
    apply(update);
    apply(b.update());
    a.acknowledge(snapshot(), revision);
    expect(a.dirty).toBe(true);
    expect(readingSection(a.markdown, "motivation").body).toBe(
      "第一段\n继续输入😀",
    );
    expect(readingSection(a.markdown, "modeling").body).toBe(
      "第二标签页的模型",
    );
    apply(a.update());
    a.acknowledge(snapshot(), a.revision);
    expect(a.dirty).toBe(false);
    expect(a.markdown).toBe(server.getText("markdown").toString());
    expect(a.markdown.startsWith("旧前言😀\n\n")).toBe(true);
  });
});
