import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    ...(process.env.LOGION_SYNC_COMPAT_DIR
      ? { include: ["tests/legacy-compatibility.compat.ts"] }
      : {}),
    coverage: {
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 85,
        functions: 85,
        lines: 85,
        statements: 85,
      },
    },
    environment: "node",
    globals: false,
  },
});
