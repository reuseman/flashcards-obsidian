import { spawnSync } from "node:child_process";
import { join } from "node:path";

const SCRIPT = join(__dirname, "../../scripts/check-test-vault-ids.sh");

function checkDiff(diff: string, path = "test-vault/features/example.md") {
  return spawnSync("bash", [SCRIPT, "--check-diff", diff, path], {
    encoding: "utf8",
  });
}

describe("test-vault generated-state guard", () => {
  it.each([
    ["v2 standalone anchor", "+^q-ab12\n"],
    ["v2 inline anchor", "+Question::Answer ^q-ab12\n"],
    ["legacy standalone anchor", "+^1700000000001\n"],
    ["legacy inline anchor", "+Question::Answer ^1700000000001\n"],
    [
      "v2 frontmatter registry entry",
      "+  q-ab12: { nid: 1700000000001, hash: abcdefgh, sync: ijklmnop }\n",
    ],
    [
      "first-phase registry entry without an Anki note ID",
      "+  q-ab12: { hash: abcdefgh }\n",
    ],
  ])("rejects %s", (_label, diff) => {
    const result = checkDiff(diff);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("generated card identity or sync state");
  });

  it("allows authored card syntax and documentation placeholders", () => {
    const result = checkDiff(
      [
        "+Question::Answer",
        "+The {1:heart} pumps blood.",
        "+Describe a generated anchor such as `^q-xxxx`.",
        "+flashcards:",
        "+  example: authored metadata",
      ].join("\n"),
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("allows the deliberate identity baseline in a stateful scenario", () => {
    const result = checkDiff(
      "+  q-aaaa: { nid: 1700000000001, hash: abcdefgh }\n",
      "test-vault/scenarios/v2-clean/already-synced.md",
    );

    expect(result.status).toBe(0);
  });

  it("still rejects a manual-sync fingerprint in a stateful scenario", () => {
    const result = checkDiff(
      "+  q-aaaa: { nid: 1788465159030, hash: mewtyxu3, sync: k87bbzhu }\n",
      "test-vault/scenarios/v2-clean/already-synced.md",
    );

    expect(result.status).toBe(1);
  });
});
