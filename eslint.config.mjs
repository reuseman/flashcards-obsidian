import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import obsidianmd from "eslint-plugin-obsidianmd";
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
  // Obsidian's own guideline rules — the same set the community plugin
  // scorecard runs against a release. Keeping them here means a regression
  // fails `npm run check` instead of surfacing on the public plugin page.
  // Scoped to what actually ships (src/ + the two manifests); tests, scripts
  // and build config are not part of the reviewed artifact.
  {
    files: ["src/**/*.ts", "package.json"],
    extends: [obsidianmd.configs.recommended],
  },
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
  {
    // `createEl` / `createSpan` / `createFragment` are Obsidian globals. The
    // render-preview modules are deliberately environment-agnostic (see the
    // no-restricted-imports block above) so they can be unit-tested under
    // plain jsdom, and they already take the target `Document` explicitly —
    // which is the cross-window safety the rule is really after.
    files: ["src/render-preview/**/*.ts"],
    rules: {
      "obsidianmd/prefer-create-el": "off",
    },
  },
);
