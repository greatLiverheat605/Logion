import type { JsonObject } from "@logion/offline";

// ADR-0033: a link stores only identifiers, offsets and a digest; the excerpt
// text stays inside the encrypted topic or recall-item payload.
export interface SourceLinkPayload extends JsonObject {
  space_id: string;
  source_kind: "note";
  source_id: string;
  target_kind: "topic" | "quiz_item";
  target_id: string;
  excerpt_sha256: string;
  excerpt_start: number | null;
  excerpt_end: number | null;
  source_version: number;
}

export type SourceLinkState = "valid" | "modified" | "deleted" | "unavailable";

export const SOURCE_LINK_STATE_LABEL: Record<SourceLinkState, string> = {
  valid: "来源有效",
  modified: "来源已修改",
  deleted: "来源已删除",
  unavailable: "来源不可用",
};

export interface SourceLinkView {
  id: string;
  noteId: string;
  noteTitle: string | null;
  spaceId: string;
  state: SourceLinkState;
  targetId: string;
  targetKind: "topic" | "quiz_item";
}

const SOURCE_PREFIX = "来源笔记：";

/** The excerpt that noteSelectionPayload() stored after the source header. */
export function sourceExcerpt(text: string): string | null {
  if (!text.startsWith(SOURCE_PREFIX)) return null;
  const separator = text.indexOf("\n\n");
  if (separator < 0) return null;
  const excerpt = text.slice(separator + 2);
  return excerpt ? excerpt : null;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Offsets of a unique occurrence; repeated or missing text keeps no range. */
export function excerptRange(
  body: string,
  excerpt: string,
): { start: number; end: number } | null {
  const start = body.indexOf(excerpt);
  if (start < 0 || body.indexOf(excerpt, start + 1) >= 0) return null;
  return { start, end: start + excerpt.length };
}

export function deriveSourceLinkState(input: {
  noteAvailable: boolean;
  noteBody: string | null;
  noteDeleted: boolean;
  noteVersion: number;
  sourceVersion: number;
  verifiedExcerpt: string | null;
}): SourceLinkState {
  if (input.noteDeleted) return "deleted";
  if (!input.noteAvailable || input.noteBody === null) return "unavailable";
  if (input.verifiedExcerpt !== null)
    return input.noteBody.includes(input.verifiedExcerpt)
      ? "valid"
      : "modified";
  // Pulled recall items carry no excerpt; fall back to the captured version.
  // A note captured before its first sync reaches the server as version 1.
  return input.noteVersion <= Math.max(input.sourceVersion, 1)
    ? "valid"
    : "modified";
}

/**
 * Locate the excerpt in the current note text: the verified excerpt first
 * (Yjs edits shift offsets), then the captured range, otherwise the top.
 */
export function locateSource(
  body: string,
  verifiedExcerpt: string | null,
  range: { start: number | null; end: number | null },
): { start: number; end: number } | null {
  if (verifiedExcerpt) {
    const start = body.indexOf(verifiedExcerpt);
    if (start >= 0) return { start, end: start + verifiedExcerpt.length };
  }
  if (
    range.start !== null &&
    range.end !== null &&
    range.start < range.end &&
    range.end <= body.length
  ) {
    return { start: range.start, end: range.end };
  }
  return null;
}

/** Return the target excerpt only when it still matches the link digest. */
export async function verifiedExcerpt(
  targetText: string,
  digest: string,
): Promise<string | null> {
  const excerpt = sourceExcerpt(targetText);
  if (excerpt === null) return null;
  return (await sha256Hex(excerpt)) === digest ? excerpt : null;
}

export function recordsSourceHref(input: {
  linkId: string;
  noteId: string;
  spaceId: string;
  workspaceId: string;
}): string {
  const query = new URLSearchParams({
    workspace: input.workspaceId,
    space: input.spaceId,
    note: input.noteId,
    source: input.linkId,
  });
  return `/app/records?${query.toString()}`;
}

export interface SourceNoteSnapshot {
  body: string | null;
  deleted: boolean;
  title: string | null;
  version: number;
}

export async function buildSourceLinkViews(input: {
  links: Array<{ id: string; payload: SourceLinkPayload }>;
  notes: ReadonlyMap<string, SourceNoteSnapshot>;
  targetText: (kind: "topic" | "quiz_item", id: string) => string | null;
}): Promise<SourceLinkView[]> {
  return Promise.all(
    input.links.map(async ({ id, payload }) => {
      const note = input.notes.get(payload.source_id);
      const text = input.targetText(payload.target_kind, payload.target_id);
      const excerpt =
        text === null
          ? null
          : await verifiedExcerpt(text, payload.excerpt_sha256);
      return {
        id,
        noteId: payload.source_id,
        noteTitle: note && !note.deleted ? note.title : null,
        spaceId: payload.space_id,
        state: deriveSourceLinkState({
          noteAvailable: note !== undefined,
          noteBody: note?.body ?? null,
          noteDeleted: note?.deleted ?? false,
          noteVersion: note?.version ?? 0,
          sourceVersion: payload.source_version,
          verifiedExcerpt: excerpt,
        }),
        targetId: payload.target_id,
        targetKind: payload.target_kind,
      };
    }),
  );
}
