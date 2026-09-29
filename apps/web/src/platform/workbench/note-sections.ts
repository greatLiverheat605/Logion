// Keep the heading grammar aligned with reading/note_template.py.
export const READING_SECTIONS = {
  motivation: "动机",
  modeling: "建模",
  experiments: "实验",
  conclusions: "结论",
  critique: "批判",
  takeaway: "一句话要点",
  open_questions: "待解决问题",
} as const;
export type ReadingSection = keyof typeof READING_SECTIONS;

export function readingSection(markdown: string, key: ReadingSection) {
  const headings = [...markdown.matchAll(/^##[ \t]+([^\n]+)\n?/gm)];
  const matches = headings.flatMap((heading, index) =>
    heading[1]!.trim() === READING_SECTIONS[key] ? [index] : [],
  );
  const index = matches[0];
  if (matches.length !== 1 || index === undefined)
    return { duplicate: matches.length > 1, body: "", start: -1, end: -1 };
  const heading = headings[index]!;
  const start = heading.index! + heading[0].length;
  const end = headings[index + 1]?.index ?? markdown.length;
  // Leave boundary newlines in the document rather than in the editable value.
  const body = markdown.slice(start, end).replace(/\n{1,2}$/, "");
  return { duplicate: false, body, start, end: start + body.length };
}

export function editReadingSection(
  markdown: string,
  key: ReadingSection,
  body: string,
): string {
  const section = readingSection(markdown, key);
  if (section.duplicate)
    throw new Error("请先在完整 Markdown 中整理重复章节。");
  if (body === section.body) return markdown;
  if (section.start < 0)
    return `${markdown}${markdown.endsWith("\n\n") || !markdown ? "" : markdown.endsWith("\n") ? "\n" : "\n\n"}## ${READING_SECTIONS[key]}\n${body}\n\n`;
  const before = markdown.slice(0, section.start);
  const after = markdown.slice(section.end);
  return `${before}${before.endsWith("\n") ? "" : "\n"}${body}\n\n${after.replace(/^\n{1,2}/, "")}`;
}
