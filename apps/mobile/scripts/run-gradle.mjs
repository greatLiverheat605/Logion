import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const mobileRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const androidRoot = path.join(mobileRoot, "android");
const wrapper = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
const tasks = process.argv.slice(2);

if (tasks.length === 0) {
  throw new Error("At least one Gradle task is required.");
}

if (!tasks.every((task) => /^[A-Za-z][A-Za-z0-9:]*$/.test(task))) {
  throw new Error("Gradle task names contain unsupported characters.");
}

const result = spawnSync(wrapper, ["--no-daemon", ...tasks], {
  cwd: androidRoot,
  shell: false,
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
