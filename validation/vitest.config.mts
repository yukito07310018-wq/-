import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Separate from the app's vitest.config.mts on purpose.
 *
 * `npm test` must stay a fast, deterministic unit-test run. The validation
 * suite is a Monte-Carlo study that takes seconds and produces a report, so it
 * gets its own entry point (`npm run validate`) and never blocks the app's tests.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["validation/**/*.spec.ts"],
    testTimeout: 600_000,
  },
  resolve: { alias: { "@": path.resolve(root, "src") } },
});
