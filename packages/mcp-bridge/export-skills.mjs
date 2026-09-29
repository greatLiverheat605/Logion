import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const names = [
  "close-reading",
  "comprehension-quiz",
  "explain-translate",
  "literature-links",
  "weekly-review",
];
const source = fileURLToPath(new URL("../skills/", import.meta.url));
export async function exportSkills(destination) {
  const target = resolve(destination);
  const files = await Promise.all(
    names.map(async (name) => ({
      name,
      bytes: await readFile(join(source, name, "SKILL.md")),
    })),
  );
  // Require a new directory: never merge with or overwrite an owner's installed skills.
  await mkdir(target);
  const hashes = {};
  for (const { name, bytes } of files) {
    await mkdir(join(target, name));
    await writeFile(join(target, name, "SKILL.md"), bytes, { flag: "wx" });
    hashes[`${name}/SKILL.md`] = createHash("sha256")
      .update(bytes)
      .digest("hex");
  }
  await writeFile(
    join(target, "logion-skills.sha256.json"),
    JSON.stringify(hashes, null, 2) + "\n",
    { encoding: "utf8", flag: "wx" },
  );
  await writeFile(
    join(target, "INSTALL.md"),
    await readFile(join(source, "README.md")),
    { flag: "wx" },
  );
  return hashes;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 3) {
    process.stderr.write(
      "Usage: node export-skills.mjs <new-output-directory>\n",
    );
    process.exitCode = 1;
  } else {
    try {
      await exportSkills(process.argv[2]);
      process.stdout.write("Exported five shared Logion skills.\n");
    } catch {
      process.stderr.write(
        "Export failed; use a new writable directory whose parent already exists. Existing files were not overwritten.\n",
      );
      process.exitCode = 1;
    }
  }
}
