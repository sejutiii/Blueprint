import { defineConfig } from "vitest/config";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Unit tests run in plain Node; the real `vscode` module only exists inside VS Code.
    alias: { vscode: path.resolve(__dirname, "tests/mocks/vscode.ts") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
  },
});
