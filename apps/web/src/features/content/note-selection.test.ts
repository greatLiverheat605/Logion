import { describe, expect, it } from "vitest";
import {
  noteSelectionPayload,
  type NoteSelectionInput,
} from "./note-selection";

const input: NoteSelectionInput = {
  kind: "topic",
  excerpt: "  Quorum requires a majority.  ",
  title: " Quorum ",
  topicId: "",
  answer: "",
};

describe("note selection conversion", () => {
  it("keeps the source excerpt in the existing topic description", () => {
    expect(noteSelectionPayload(input, "space-1", "Raft")).toEqual({
      space_id: "space-1",
      title: "Quorum",
      description: "来源笔记：Raft\n\nQuorum requires a majority.",
    });
  });
  it("creates a user-confirmed self-assessed quiz without inventing a source relation", () => {
    expect(
      noteSelectionPayload(
        {
          ...input,
          kind: "quiz_item",
          topicId: "topic-1",
          title: "How many votes?",
          answer: "A majority",
        },
        "space-1",
        "Raft",
      ),
    ).toEqual({
      space_id: "space-1",
      topic_id: "topic-1",
      prompt: "How many votes?",
      answer_key: "A majority",
      explanation: "来源笔记：Raft\n\nQuorum requires a majority.",
      evaluation_mode: "self_assessed",
    });
  });
  it.each([
    { excerpt: " " },
    { excerpt: "x".repeat(9001) },
    { title: "x".repeat(161) },
    { kind: "quiz_item" as const, answer: "", topicId: "topic-1" },
    { kind: "quiz_item" as const, answer: "Answer", topicId: "" },
  ])("rejects incomplete or over-limit content: %s", (changes) => {
    expect(() =>
      noteSelectionPayload({ ...input, ...changes }, "space-1", "Raft"),
    ).toThrow();
  });
});
