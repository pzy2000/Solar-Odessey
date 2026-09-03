import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    ignores: ["dist/", "node_modules/", "data/"],
  },
  {
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
      },
    },
    rules: {
      "no-throw-literal": "error",
      eqeqeq: ["error", "smart"],
    },
  },
];
