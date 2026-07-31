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
const configuredTerms = (process.env.LOGION_CONTEXT_GUARD_TERMS ?? "")
  .split(",")
  .map((term) => term.trim())
  .filter(Boolean);
const emailPattern = /[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/giu;
const allowedExampleDomains = new Set([
  "example.com",
  "example.net",
  "example.org",
]);
const isExampleDomain = (domain) =>
  [...allowedExampleDomains].some(
    (allowed) => domain === allowed || domain.endsWith(`.${allowed}`),
  );
const userPathPattern =
  /(?:[A-Z]:\\Users\\[^\\]+\\|(?<![A-Z0-9])\/Users\/[^/]+\/|(?<![A-Z0-9])\/home\/[^/]+\/)/iu;
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
    for (const term of configuredTerms) {
      if (content.includes(term)) {
        violations.push(`${relative(".", path)}: configured private context`);
      }
    }
    for (const match of content.matchAll(emailPattern)) {
      if (!isExampleDomain(match[1].toLowerCase())) {
        violations.push(`${relative(".", path)}: hard-coded email address`);
      }
    }
    if (userPathPattern.test(content)) {
      violations.push(`${relative(".", path)}: hard-coded user home path`);
    }
  }
}

for (const root of roots) await walk(root);

if (violations.length > 0) {
  console.error("Production paths contain user-specific context:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}
