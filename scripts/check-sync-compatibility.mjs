import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The last server/client before entity deletion; never substitute current code.
const base = "37e2e005d5594da31daade87d67a4ea183283b06";
const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "logion-sync-compat-"));
try {
  const files = execFileSync(
    "git",
    [
      "ls-tree",
      "-r",
      "--name-only",
      base,
      "packages/offline/src",
      "packages/contracts/src",
      "packages/offline/package.json",
      "packages/contracts/package.json",
    ],
    { cwd: root, encoding: "utf8" },
  )
    .trim()
    .split("\n");
  if (!files.includes("packages/offline/src/sync-client.ts"))
    throw new Error("Legacy source unavailable");
  for (const file of files) {
    const target = join(temporary, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      execFileSync("git", ["show", `${base}:${file}`], {
        cwd: root,
        maxBuffer: 8 * 1024 * 1024,
      }),
    );
  }
  for (const name of ["offline", "contracts"]) {
    const relative = `packages/${name}`;
    const manifest = JSON.parse(
      readFileSync(join(temporary, relative, "package.json"), "utf8"),
    );
    for (const dependency of Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    })) {
      const target = join(temporary, relative, "node_modules", dependency);
      mkdirSync(dirname(target), { recursive: true });
      const source =
        dependency === "@logion/contracts"
          ? join(temporary, "packages/contracts")
          : realpathSync(join(root, relative, "node_modules", dependency));
      symlinkSync(source, target, "junction");
    }
  }
  console.log(`Testing real legacy SyncClient and validator at ${base}`);
  if (process.argv[2] === "--responses") {
    const directory = process.argv[3];
    if (!directory) throw new Error("Response directory is required");
    const responses = readdirSync(directory).filter((name) =>
      name.endsWith(".json"),
    );
    if (responses.length === 0) throw new Error("No observed API responses");
    const { default: validate } = await import(
      pathToFileURL(
        join(
          temporary,
          "packages/contracts/src/sync-v1-validator.generated.js",
        ),
      )
    );
    for (const file of responses) {
      if (!validate(JSON.parse(readFileSync(join(directory, file), "utf8"))))
        throw new Error(`Legacy validator rejected API response ${file}`);
    }
    console.log(
      `Legacy validator accepted ${responses.length} observed API responses`,
    );
  }
  const result = spawnSync(
    "pnpm",
    [
      "--filter",
      "@logion/offline",
      "exec",
      "vitest",
      "run",
      "tests/legacy-compatibility.compat.ts",
    ],
    {
      cwd: root,
      env: { ...process.env, LOGION_SYNC_COMPAT_DIR: temporary },
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
