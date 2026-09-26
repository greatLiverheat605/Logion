import { describe, expect, it } from "vitest";
import {
  buildSourceLinkViews,
  deriveSourceLinkState,
  excerptRange,
  locateSource,
  recordsSourceHref,
  sha256Hex,
  sourceExcerpt,
  verifiedExcerpt,
  type SourceLinkPayload,
} from "./source-links";

const EXCERPT = "Raft 通过任期选举 leader。";
const TOPIC_TEXT = `来源笔记：Raft 精读\n\n${EXCERPT}`;

async function link(
  overrides: Partial<SourceLinkPayload> = {},
): Promise<SourceLinkPayload> {
  return {
    space_id: "space-1",
    source_kind: "note",
    source_id: "note-1",
    target_kind: "topic",
    target_id: "topic-1",
    excerpt_sha256: await sha256Hex(EXCERPT),
    excerpt_start: 4,
    excerpt_end: 4 + EXCERPT.length,
    source_version: 2,
    ...overrides,
  };
}

describe("source links", () => {
  it("extracts the excerpt stored after the source header", () => {
    expect(sourceExcerpt(TOPIC_TEXT)).toBe(EXCERPT);
    expect(sourceExcerpt("手写的说明")).toBeNull();
    expect(sourceExcerpt("来源笔记：只有标题")).toBeNull();
  });

  it("keeps a range only for a unique occurrence", () => {
    expect(excerptRange(`开头。${EXCERPT}`, EXCERPT)).toEqual({
      start: 3,
      end: 3 + EXCERPT.length,
    });
    expect(excerptRange(`${EXCERPT}${EXCERPT}`, EXCERPT)).toBeNull();
    expect(excerptRange("无关内容", EXCERPT)).toBeNull();
  });

  it("verifies the excerpt against the link digest", async () => {
    const digest = await sha256Hex(EXCERPT);
    expect(await verifiedExcerpt(TOPIC_TEXT, digest)).toBe(EXCERPT);
    expect(
      await verifiedExcerpt(`来源笔记：Raft\n\n改过的摘录`, digest),
    ).toBeNull();
  });

  it("derives the four states", () => {
    const base = {
      noteAvailable: true,
      noteBody: `前言 ${EXCERPT}`,
      noteDeleted: false,
      noteVersion: 3,
      sourceVersion: 2,
      verifiedExcerpt: EXCERPT,
    };
    expect(deriveSourceLinkState(base)).toBe("valid");
    expect(deriveSourceLinkState({ ...base, noteBody: "全部重写" })).toBe(
      "modified",
    );
    expect(deriveSourceLinkState({ ...base, noteDeleted: true })).toBe(
      "deleted",
    );
    expect(
      deriveSourceLinkState({
        ...base,
        noteAvailable: false,
        noteBody: null,
      }),
    ).toBe("unavailable");
  });

  it("falls back to the captured note version without an excerpt", () => {
    const base = {
      noteAvailable: true,
      noteBody: "正文",
      noteDeleted: false,
      verifiedExcerpt: null,
    };
    expect(
      deriveSourceLinkState({ ...base, noteVersion: 2, sourceVersion: 2 }),
    ).toBe("valid");
    expect(
      deriveSourceLinkState({ ...base, noteVersion: 3, sourceVersion: 2 }),
    ).toBe("modified");
    // Captured before the note's first sync.
    expect(
      deriveSourceLinkState({ ...base, noteVersion: 1, sourceVersion: 0 }),
    ).toBe("valid");
  });

  it("locates by excerpt first, then by range, then the top", () => {
    const body = `新增一段。前言 ${EXCERPT}`;
    expect(locateSource(body, EXCERPT, { start: 0, end: 2 })).toEqual({
      start: body.indexOf(EXCERPT),
      end: body.indexOf(EXCERPT) + EXCERPT.length,
    });
    expect(locateSource("短正文内容", null, { start: 1, end: 3 })).toEqual({
      start: 1,
      end: 3,
    });
    expect(locateSource("短", null, { start: 1, end: 30 })).toBeNull();
    expect(locateSource("正文", "不存在", { start: null, end: null })).toBe(
      null,
    );
  });

  it("builds views from local notes and targets", async () => {
    const views = await buildSourceLinkViews({
      links: [
        { id: "link-valid", payload: await link() },
        {
          id: "link-deleted",
          payload: await link({ source_id: "note-gone" }),
        },
        {
          id: "link-unavailable",
          payload: await link({ source_id: "note-elsewhere" }),
        },
        {
          id: "link-quiz",
          payload: await link({
            target_kind: "quiz_item",
            target_id: "quiz-1",
          }),
        },
      ],
      notes: new Map([
        [
          "note-1",
          {
            body: `前言 ${EXCERPT}`,
            deleted: false,
            title: "Raft 精读",
            version: 5,
          },
        ],
        ["note-gone", { body: null, deleted: true, title: null, version: 4 }],
      ]),
      targetText: (kind) => (kind === "topic" ? TOPIC_TEXT : null),
    });
    expect(views.map((view) => [view.id, view.state, view.noteTitle])).toEqual([
      ["link-valid", "valid", "Raft 精读"],
      ["link-deleted", "deleted", null],
      ["link-unavailable", "unavailable", null],
      ["link-quiz", "modified", "Raft 精读"],
    ]);
  });

  it("puts only identifiers in the records link", () => {
    const href = recordsSourceHref({
      linkId: "link-1",
      noteId: "note-1",
      spaceId: "space-1",
      workspaceId: "workspace-1",
    });
    expect(href).toBe(
      "/app/records?workspace=workspace-1&space=space-1&note=note-1&source=link-1",
    );
  });
});
