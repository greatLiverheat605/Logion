import { execFileSync } from "node:child_process";

try {
  execFileSync("git", ["diff", "--exit-code", "--", "packages/contracts"], {
    stdio: "inherit",
  });
  execFileSync(
    "git",
    ["diff", "--exit-code", "--cached", "--", "packages/contracts"],
    {
      stdio: "inherit",
    },
  );
} catch {
  console.error(
    "Generated contracts differ from the committed contract artifacts.",
  );
  process.exit(1);
}
