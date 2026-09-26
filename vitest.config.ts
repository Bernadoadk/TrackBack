import { defineConfig } from "vitest/config";

// Unit tests for the pure business modules (no React Router plugin needed).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
