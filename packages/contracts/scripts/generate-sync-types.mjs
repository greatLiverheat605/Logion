import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compileFromFile } from "json-schema-to-typescript";
import { format } from "prettier";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = resolve(packageRoot, "schemas", "sync-v1.schema.json");
const outputPath = resolve(packageRoot, "src", "sync-v1.ts");

const generated = await compileFromFile(schemaPath, {
  additionalProperties: false,
  bannerComment:
    "/* Generated from schemas/sync-v1.schema.json. Do not edit manually. */",
  cwd: resolve(packageRoot, "schemas"),
  enableConstEnums: false,
  unreachableDefinitions: true,
});

await writeFile(
  outputPath,
  await format(generated, { parser: "typescript" }),
  "utf8",
);
