# Architecture diagrams — prototype comparison

Two parallel prototypes to evaluate which approach keeps diagrams from
going stale over time.

## A — Mermaid + dependency-cruiser (`overview.md` + `.dependency-cruiser.cjs`)

- **What you write**: Mermaid blocks in `overview.md` (rendered by GitHub,
  Obsidian, any Markdown viewer). One config file with layer rules.
- **Drift defense**: `npm run arch:check` fails when source code violates
  the rules the diagram claims. The diagram is *prose*; the rules are the
  *contract*.
- **Inspect deps graphically**: `npm run arch:graph` → `docs/architecture/graph.svg`
  (requires Graphviz `dot` installed locally).
- **Cost**: cheap. ~50 lines of config. Mermaid is already in your toolchain.

## B — Likec4 (`likec4/model.c4`)

- **What you write**: a single `.c4` DSL file describing elements,
  relations, and named views.
- **Render**: `npm run arch:likec4` starts a dev server with an
  interactive browser-based diagram viewer. `npm run arch:likec4:build`
  produces a static site under `likec4/out/`.
- **Drift defense**: **none built-in.** Likec4 is descriptive. It will
  validate the DSL's internal consistency, but it does not check whether
  the real code matches.
- **Cost**: ~140 npm packages added. ~1.8 MB JS for the built static site.
  Worth it only if the interactive multi-view UI is valuable.

## What the prototype already proved

Running `npm run arch:check` against the current `rewrite-v2` branch
surfaced **10 real violations** of the layering both prototypes describe:

1. `src/core/edits/writeback-sync-results.ts` imports `src/adapters/anki/execute-sync-plan.ts`
   — a `core → adapters` leak.
2. `src/application/sync-vault.ts`, `sync-note.ts`, `migration-check.ts`,
   `backfill-v1-vault.ts` import concrete adapter classes directly
   (`obsidian-markdown-repository`, `anki-connect-client`,
   `execute-sync-plan`) instead of ports. No interfaces defined.
3. Circular imports: `plugin.ts ↔ adapters/obsidian/settings-tab.ts`,
   `plugin.ts ↔ adapters/obsidian/commands.ts`.

This is the headline finding of the prototype: **A catches drift, B does not.**
If your goal is "diagrams that don't lie," A is the only one that mechanically
delivers. B gives you nicer pictures and named views for human consumption.

## Recommendation

Keep both during evaluation. After a week:

- If you find yourself opening the Likec4 viewer often → invest in B,
  keep A for enforcement (they're complementary, not exclusive).
- If you don't → drop B (remove `likec4` from devDependencies), keep A.

`arch:check` is **not** wired into `npm run check` yet because the current
code fails it. Fix the 10 violations first, then add `npm run arch:check`
to the `check` script to lock it in.

## Files

- `overview.md` — Prototype A diagrams
- `../../.dependency-cruiser.cjs` — Prototype A rules (enforced)
- `likec4/model.c4` — Prototype B model
- `likec4/out/` — Prototype B built site (gitignored)
