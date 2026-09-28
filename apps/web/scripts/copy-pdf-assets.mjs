import { cp, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const source = dirname(require.resolve("pdfjs-dist/package.json"));
const { version } = JSON.parse(
  await readFile(join(source, "package.json"), "utf8"),
);
const target = new URL(`../public/pdfjs/${version}/`, import.meta.url);
await mkdir(target, { recursive: true });
for (const name of ["cmaps", "standard_fonts", "wasm", "LICENSE"]) {
  await cp(join(source, name), new URL(name, target), { recursive: true });
}
await cp(
  join(source, "build/pdf.worker.min.mjs"),
  new URL("pdf.worker.min.mjs", target),
);
