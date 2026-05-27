# Benchmark fixtures

These files are **pinned, immutable benchmark inputs**. The metric identity of
every `bench()` in `tests/perf/` is the tuple `(bench-name, fixture content)`.
Changing a fixture changes the metric. Re-baseline after any change.

## Files

| File                  | Purpose                                            |
| --------------------- | -------------------------------------------------- |
| `50-inline-cards.md`  | 50 deterministic `Q::A` inline cards               |
| `20-cloze-cards.md`   | 20 `{{c1::...}}` lines with varying prose          |
| `media-mixed.md`      | 5 wikilink images + 5 markdown images + 3 audio    |
| `1mb-binary.bin`      | Exactly 1,048,576 bytes (`Buffer.alloc(_, "X")`)   |

## Regeneration

```sh
node --experimental-strip-types tests/perf/_fixtures/generate.ts
```

The generator is committed for reproducibility, but is rarely re-run. If you
edit it, you change all downstream benchmark numbers — drop your old baseline
and re-anchor.

## Baseline policy

- `.perf-baseline.json` and `.perf-current.json` are **gitignored** — each
  machine / each developer captures its own baseline. After significant local
  changes or on a new machine:

  ```sh
  npm run bench
  npm run bench:baseline
  ```

- Comparisons are only meaningful between runs on the **same hardware** (same
  `cpuModel`, same `platform`). `scripts/bench-compare.ts` enforces this and
  refuses to diff mismatched runs.

- CI integration (future): each runner stores its own baseline.
