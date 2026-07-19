import { readFile } from "node:fs/promises";

const [, , baselinePath, candidatePath] = process.argv;
if (!baselinePath || !candidatePath) {
  console.error("usage: node check-openapi-breaking.mjs BASELINE CANDIDATE");
  process.exit(2);
}

const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const candidate = JSON.parse(await readFile(candidatePath, "utf8"));
const methods = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
]);
const breaks = [];

for (const [path, pathItem] of Object.entries(baseline.paths ?? {})) {
  const nextPathItem = candidate.paths?.[path];
  if (!nextPathItem) {
    breaks.push(`removed path ${path}`);
    continue;
  }
  for (const method of Object.keys(pathItem)) {
    if (methods.has(method) && !nextPathItem[method])
      breaks.push(`removed operation ${method.toUpperCase()} ${path}`);
  }
}

for (const [name, schema] of Object.entries(
  baseline.components?.schemas ?? {},
)) {
  const nextSchema = candidate.components?.schemas?.[name];
  if (!nextSchema) {
    breaks.push(`removed schema ${name}`);
    continue;
  }
  const previousRequired = new Set(schema.required ?? []);
  for (const required of nextSchema.required ?? []) {
    if (!previousRequired.has(required))
      breaks.push(`schema ${name} added required property ${required}`);
  }
  for (const property of Object.keys(schema.properties ?? {})) {
    if (!nextSchema.properties?.[property])
      breaks.push(`schema ${name} removed property ${property}`);
  }
}

if (breaks.length > 0) {
  console.error("Breaking OpenAPI changes detected:");
  for (const item of breaks) console.error(`- ${item}`);
  process.exit(1);
}
