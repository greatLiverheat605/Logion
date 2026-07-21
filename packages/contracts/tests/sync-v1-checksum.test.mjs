import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalize } from "json-canonicalize";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vectors = JSON.parse(
  await readFile(
    resolve(packageRoot, "fixtures", "sync-v1-checksum-vectors.json"),
    "utf8",
  ),
);

function hash(canonical) {
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

test("sync-v1 checksum vectors freeze canonical chunk and snapshot framing", () => {
  assert.equal(vectors.protocol_version, "sync-v1");
  assert.equal(vectors.canonicalization, "RFC 8785");
  assert.equal(vectors.hash_algorithm, "SHA-256");

  for (const chunk of vectors.chunks) {
    const canonical = canonicalize(chunk.records);
    assert.equal(canonical, chunk.canonical_records);
    assert.equal(hash(canonical), chunk.chunk_checksum);
  }

  assert.deepEqual(
    vectors.snapshot_manifest.chunks,
    vectors.chunks.map(({ chunk_index, chunk_checksum }) => ({
      chunk_index,
      chunk_checksum,
    })),
  );
  const canonicalManifest = canonicalize(vectors.snapshot_manifest);
  assert.equal(canonicalManifest, vectors.canonical_snapshot_manifest);
  assert.equal(hash(canonicalManifest), vectors.snapshot_checksum);
});
