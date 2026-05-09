import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      enabled: false,
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "html"],
    },
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
});
