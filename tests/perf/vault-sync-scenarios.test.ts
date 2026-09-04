import { describe, expect, it } from "vitest";

import {
  buildVaultTemplate,
  prepareVaultSyncScenario,
  type VaultSyncScenario,
} from "./vault-sync-harness.js";

const NOTE_COUNT = 100;
const template = buildVaultTemplate(NOTE_COUNT);

async function run(scenario: VaultSyncScenario) {
  const prepared = await prepareVaultSyncScenario(scenario, template);
  return { changedCardCount: prepared.changedCardCount, metrics: await prepared.run() };
}

describe("synthetic end-to-end vault sync scenarios", () => {
  it("measures a cold scan with one card per note", async () => {
    const { metrics } = await run("cold");

    expect(metrics.result.failedNotes).toBe(0);
    expect(metrics.result.noteCount).toBe(NOTE_COUNT);
    expect(metrics.noteBodyReads).toBe(NOTE_COUNT);
    expect(metrics.parseCalls).toBe(NOTE_COUNT);
    expect(metrics.renderCalls).toBe(NOTE_COUNT);
    expect(metrics.ankiRequests).toBeGreaterThan(0);
    expect(metrics.ankiReadItems).toBe(NOTE_COUNT * 2);
    expect(metrics.ankiWriteActions).toBe(0);
    expect(metrics.peakLoadedMarkdownBytes).toBeLessThanOrEqual(
      metrics.markdownBytesRead,
    );
    expect(metrics.scanIndexBytes).toBeLessThan(NOTE_COUNT * 300);
  });

  it("measures an unchanged warm sync without requiring writes", async () => {
    const { metrics } = await run("warm");

    expect(metrics.result.failedNotes).toBe(0);
    expect(metrics.result.noteCount).toBe(NOTE_COUNT);
    expect(metrics.ankiWriteActions).toBe(0);
    expect(metrics.noteBodyReads).toBe(0);
    expect(metrics.parseCalls).toBe(0);
    expect(metrics.renderCalls).toBe(0);
    expect(metrics.ankiRequests).toBe(2);
    expect(metrics.ankiReadItems).toBe(NOTE_COUNT * 2);
    expect(metrics.noteBodyReads).toBeLessThanOrEqual(NOTE_COUNT);
    expect(metrics.parseCalls).toBe(metrics.result.processedNoteCount);
  });

  it("changes exactly 1% of source cards and repairs Anki", async () => {
    const { changedCardCount, metrics } = await run("source-change");

    expect(changedCardCount).toBe(1);
    expect(metrics.result.failedNotes).toBe(0);
    expect(metrics.result.totalUpdates).toBe(changedCardCount);
    expect(metrics.ankiWriteActions).toBe(changedCardCount);
  });

  it("drifts exactly 1% of Anki cards and restores Obsidian truth", async () => {
    const { changedCardCount, metrics } = await run("anki-drift");

    expect(changedCardCount).toBe(1);
    expect(metrics.result.failedNotes).toBe(0);
    expect(metrics.result.totalUpdates).toBe(changedCardCount);
    expect(metrics.ankiWriteActions).toBe(changedCardCount);
  });
});
