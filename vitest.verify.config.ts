import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["verify/**/*.verify.test.ts"],
    testTimeout: 300000,
  },
});
