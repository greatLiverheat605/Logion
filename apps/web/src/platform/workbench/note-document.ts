import * as Y from "@logion/offline/yjs";
import type { components } from "@logion/contracts";

export type ReadingNote = components["schemas"]["ReadingNote"];
const decode = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
function encode(value: Uint8Array) {
  let binary = "";
  for (let i = 0; i < value.length; i += 0x8000)
    binary += String.fromCharCode(...value.subarray(i, i + 0x8000));
  return btoa(binary);
}

type DocumentState = Pick<
  ReadingNote,
  "version" | "yjs_generation" | "yjs_state_base64"
>;

export class ReadingNoteDocument<T extends DocumentState = ReadingNote> {
  readonly doc = new Y.Doc();
  server: T;
  revision = 0;
  savedRevision = 0;
  private acknowledged: Uint8Array;
  constructor(note: T) {
    this.server = note;
    Y.applyUpdate(this.doc, decode(note.yjs_state_base64));
    this.acknowledged = Y.encodeStateVector(this.doc);
  }
  get markdown() {
    return this.doc.getText("markdown").toString();
  }
  get dirty() {
    return this.revision !== this.savedRevision;
  }
  edit(next: string) {
    const before = Array.from(this.markdown),
      after = Array.from(next);
    let start = 0,
      end = 0;
    while (
      start < before.length &&
      start < after.length &&
      before[start] === after[start]
    )
      start++;
    while (
      end < before.length - start &&
      end < after.length - start &&
      before[before.length - 1 - end] === after[after.length - 1 - end]
    )
      end++;
    const offset = before.slice(0, start).join("").length;
    const removed = before.slice(start, before.length - end).join("").length;
    const inserted = after.slice(start, after.length - end).join("");
    if (!removed && !inserted) return;
    this.doc.transact(() => {
      const text = this.doc.getText("markdown");
      if (removed) text.delete(offset, removed);
      if (inserted) text.insert(offset, inserted);
    });
    this.revision++;
  }
  update() {
    return encode(Y.encodeStateAsUpdate(this.doc, this.acknowledged));
  }
  acknowledge(note: T, revision: number) {
    if (note.yjs_generation !== this.server.yjs_generation)
      throw new Error("Note generation changed");
    const server = new Y.Doc();
    Y.applyUpdate(server, decode(note.yjs_state_base64));
    this.acknowledged = Y.encodeStateVector(server);
    server.destroy();
    Y.applyUpdate(this.doc, decode(note.yjs_state_base64));
    this.server = note;
    this.savedRevision = revision;
  }
}
