import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ESLint } from "eslint";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import { expect, it } from "vitest";

it.each(["default", "glob", "array"])(
  "keeps Next internal-link checks active with %s root directories",
  async (mode) => {
    const root = mkdtempSync(join(tmpdir(), "logion-eslint-roots-"));
    try {
      for (const [directory, page] of [
        [root, "landing"],
        [join(root, "packages", "first app"), "first"],
        [join(root, "packages", "second"), "second"],
      ]) {
        mkdirSync(join(directory, "pages"), { recursive: true });
        writeFileSync(join(directory, "pages", `${page}.jsx`), "", "utf8");
      }
      const rootDir =
        mode === "glob"
          ? `${root}/packages/{first app,second}`
          : mode === "array"
            ? [`${root}/packages/first*`, `${root}/packages/second`]
            : undefined;
      const lint = new ESLint({
        cwd: root,
        overrideConfigFile: true,
        overrideConfig: [
          ...nextCoreWebVitals,
          { settings: { next: { rootDir } } },
        ],
      });
      const [result] = await lint.lintText(
        'export default function Page() { return <><a href="/landing">Landing</a><a href="/first">First</a><a href="/second">Second</a><a href="https://example.com">External</a></>; }',
        { filePath: "probe.jsx" },
      );
      expect(result.fatalErrorCount).toBe(0);
      const messages = result.messages.filter(
        (message) => message.ruleId === "@next/next/no-html-link-for-pages",
      );
      const expected =
        mode === "default" ? ["/landing/"] : ["/first/", "/second/"];
      expect(messages).toHaveLength(expected.length);
      for (const path of expected) {
        expect(messages.some((message) => message.message.includes(path))).toBe(
          true,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
