"use client";

import {
  READING_SECTIONS,
  readingSection,
  editReadingSection,
  type ReadingSection,
} from "./note-sections";

export function NoteSectionsEditor({
  markdown,
  disabled,
  onChange,
}: {
  markdown: string;
  disabled: boolean;
  onChange: (markdown: string) => void;
}) {
  return (
    <div className="wb-note-sections">
      {(Object.entries(READING_SECTIONS) as [ReadingSection, string][]).map(
        ([key, label], index) => {
          const section = readingSection(markdown, key);
          return (
            <details key={key} open={index === 0}>
              <summary>{label}</summary>
              {section.duplicate ? (
                <p role="status">
                  存在重复的“{label}”标题，请在完整 Markdown 中整理。
                </p>
              ) : (
                <label>
                  {label}内容
                  <textarea
                    className="wb-note-editor"
                    value={section.body}
                    maxLength={500000 - markdown.length + section.body.length}
                    disabled={disabled}
                    onChange={(event) =>
                      onChange(
                        editReadingSection(markdown, key, event.target.value),
                      )
                    }
                  />
                </label>
              )}
            </details>
          );
        },
      )}
      <details>
        <summary>完整 Markdown 与自定义内容</summary>
        <p className="wb-muted">原有正文、自定义章节和重复标题都保留在这里。</p>
        <label>
          精读笔记正文
          <textarea
            className="wb-note-editor"
            value={markdown}
            maxLength={500000}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
      </details>
    </div>
  );
}
