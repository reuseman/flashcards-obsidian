import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "coverage/**",
      "dist/**",
      "main.js",
      "node_modules/**",
      "test-vault/**",
      // generated likec4 site bundles (see arch:likec4:build); gitignored,
      // but flat config does not honor .gitignore
      "docs/architecture/likec4/out/**",
      // CommonJS tooling config, not part of the typed src/ program
      "*.cjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: 2024,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: [
      "src/render-preview/feature.ts",
      "src/render-preview/registry.ts",
      "src/render-preview/dom-utils.ts",
      "src/render-preview/features/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["obsidian", "obsidian/*"], message: "Pure render-preview modules must not import from obsidian." },
          { group: ["@codemirror/*"], message: "Pure render-preview modules must not import from CodeMirror." },
        ],
      }],
    },
  },
);
