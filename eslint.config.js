import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "data/", "public/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "verify/**/*.ts", "tools/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        console: "readonly",
        document: "readonly",
        window: "readonly",
        requestAnimationFrame: "readonly",
        performance: "readonly",
        fetch: "readonly",
        navigator: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        Buffer: "readonly",
      },
    },
    rules: {
      "no-throw-literal": "error",
      eqeqeq: ["error", "smart"],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
