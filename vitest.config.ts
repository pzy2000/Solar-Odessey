import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["verify/**/*.test.ts"],
    exclude: ["**/node_modules/**", ...configDefaults.exclude, "verify/**/*.verify.test.ts"],
  },
});
