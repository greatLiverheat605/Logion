import type { JsonObject } from "@logion/offline";

export interface NoteSelectionInput {
  kind: "topic" | "quiz_item";
  excerpt: string;
  title: string;
  topicId: string;
  answer: string;
}

export function noteSelectionPayload(
  input: NoteSelectionInput,
  spaceId: string,
  noteTitle: string,
): JsonObject {
  const excerpt = input.excerpt.trim();
  const title = input.title.trim();
  if (!excerpt || excerpt.length > 9000 || !title) {
    throw new Error("请选择 1–9000 字的笔记内容，并填写标题或题干。");
  }
  const source = `来源笔记：${noteTitle.slice(0, 200)}\n\n${excerpt}`;
  if (input.kind === "topic") {
    if (title.length > 160) throw new Error("知识点标题不能超过 160 字。");
    return { space_id: spaceId, title, description: source };
  }
  if (
    title.length > 10000 ||
    !input.topicId ||
    !input.answer.trim() ||
    input.answer.length > 10000
  ) {
    throw new Error("请选择知识点，并填写不超过 10000 字的题干和参考答案。");
  }
  return {
    space_id: spaceId,
    topic_id: input.topicId,
    prompt: title,
    answer_key: input.answer.trim(),
    explanation: source,
    evaluation_mode: "self_assessed",
  };
}
