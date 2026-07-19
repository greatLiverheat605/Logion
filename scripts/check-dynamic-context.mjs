import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const roots = ["apps", "packages"];
const searchableExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".py",
  ".ts",
  ".tsx",
]);
const forbidden = ["郝老师", "郝永静", "yjhao@mail.usts.edu.cn", "vigils.ai"];
const violations = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".next", "node_modules", "dist"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }
    if (!searchableExtensions.has(extname(entry.name))) continue;
    const content = await readFile(path, "utf8");
    for (const term of forbidden) {
      if (content.includes(term))
        violations.push(`${relative(".", path)}: ${term}`);
    }
  }
}

for (const root of roots) await walk(root);

if (violations.length > 0) {
  console.error("Production paths contain user-specific context:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}
