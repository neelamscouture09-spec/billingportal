import { defineConfig } from "vitest/config";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: projectRoot,
  resolve: {
    alias: { "@": path.resolve(projectRoot, "client", "src") },
  },
  test: {
    environment: "node",
    include: ["client/src/**/*.test.ts", "client/src/**/*.spec.ts"],
  },
});
