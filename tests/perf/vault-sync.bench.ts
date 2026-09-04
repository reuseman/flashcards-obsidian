import { bench } from "vitest";

import {
  buildVaultTemplate,
  prepareVaultSyncScenario,
  type PreparedVaultSyncScenario,
  type VaultSyncScenario,
} from "./vault-sync-harness.js";

const CARD_COUNT = 1_000;
const template = buildVaultTemplate(CARD_COUNT);

function scenarioBench(name: string, scenario: VaultSyncScenario): void {
  let prepared: PreparedVaultSyncScenario;
  bench(
    name,
    async () => {
      await prepared.run();
    },
    {
      // The scenario mutates its disposable cache. One measured iteration
      // keeps "cold" cold and "warm" warm; repeat `npm run bench` for samples.
      iterations: 1,
      setup: async () => {
        prepared = await prepareVaultSyncScenario(scenario, template);
      },
      time: 0,
      warmupIterations: 0,
      warmupTime: 0,
    },
  );
}

scenarioBench("vault-sync-cold-1000-cards", "cold");
scenarioBench("vault-sync-warm-unchanged-1000-cards", "warm");
scenarioBench("vault-sync-source-change-1pct-1000-cards", "source-change");
scenarioBench("vault-sync-anki-drift-1pct-1000-cards", "anki-drift");
