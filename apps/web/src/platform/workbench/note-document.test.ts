import { describe, expect, it } from "vitest";
import * as Y from "@logion/offline/yjs";
import { ReadingNoteDocument, type ReadingNote } from "./note-document";

function snapshot(doc: Y.Doc, version = 1): ReadingNote {
  return {
    id: "note",
    resource_id: "resource",
    note_kind: "close_reading",
    markdown_body: doc.getText("markdown").toString(),
    yjs_state_base64: btoa(String.fromCharCode(...Y.encodeStateAsUpdate(doc))),
    yjs_generation: 1,
    version,
    missing_sections: [],
  };
}
describe("online reading note Yjs", () => {
  it("merges concurrent edits and retains typing made during an in-flight save", () => {
    const server = new Y.Doc();
    server.getText("markdown").insert(0, "😀 evidence\n");
    const first = new ReadingNoteDocument(snapshot(server));
    const second = new ReadingNoteDocument(snapshot(server));
    first.edit("😎 evidence\n");
    second.edit("😀 evidence\nPeer ending\n");
    const sentRevision = first.revision;
    const sentUpdate = first.update();
    first.edit("😎 evidence\nStill typing\n");
    for (const update of [sentUpdate, second.update()])
      Y.applyUpdate(
        server,
        Uint8Array.from(atob(update), (c) => c.charCodeAt(0)),
      );
    first.acknowledge(snapshot(server, 2), sentRevision);
    expect(first.dirty).toBe(true);
    expect(first.markdown).toContain("😎 evidence");
    expect(first.markdown).toContain("Peer ending");
    expect(first.markdown).toContain("Still typing");
    Y.applyUpdate(
      server,
      Uint8Array.from(atob(first.update()), (c) => c.charCodeAt(0)),
    );
    first.acknowledge(snapshot(server, 3), first.revision);
    expect(first.dirty).toBe(false);
    expect(first.markdown).toBe(server.getText("markdown").toString());
    expect(first.markdown).not.toContain("�");
  });
});
