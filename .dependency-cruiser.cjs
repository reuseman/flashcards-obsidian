/**
 * Enforces the layering documented in docs/architecture/overview.md.
 *
 * Layers (inner → outer):
 *   core         — pure, no I/O, no framework
 *   application  — use cases; orchestrates core; depends on ports only
 *   adapters     — Obsidian, AnkiConnect; concrete I/O
 *
 * Rules:
 *   core MUST NOT depend on application or adapters
 *   application MUST NOT depend on adapters
 *   adapters MAY depend on application and core
 */
module.exports = {
  forbidden: [
    {
      name: "core-no-application",
      severity: "error",
      comment: "core/ must not depend on application/",
      from: { path: "^src/core" },
      to: { path: "^src/application" },
    },
    {
      name: "core-no-adapters",
      severity: "error",
      comment: "core/ must not depend on adapters/",
      from: { path: "^src/core" },
      to: { path: "^src/adapters" },
    },
    {
      name: "application-no-adapters",
      severity: "error",
      comment: "application/ must not depend on adapters/",
      from: { path: "^src/application" },
      to: { path: "^src/adapters" },
    },
    {
      name: "core-no-obsidian",
      severity: "error",
      comment: "core/ must stay framework-free (no obsidian import)",
      from: { path: "^src/core" },
      to: { path: "^obsidian$" },
    },
    {
      name: "application-no-obsidian",
      severity: "error",
      comment: "application/ must stay framework-free (no obsidian import)",
      from: { path: "^src/application" },
      to: { path: "^obsidian$" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      severity: "warn",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)\\.[^/]+\\.(js|cjs|mjs|ts)$",
          "\\.d\\.ts$",
          "(^|/)tsconfig\\.json$",
          "^src/main\\.ts$",
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    exclude: {
      path: ["node_modules", "\\.test\\.ts$", "^test/", "^scripts/"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
