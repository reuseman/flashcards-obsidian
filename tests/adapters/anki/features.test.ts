import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { renderFeatureFixture } from "../../_utils/render-feature-fixture.js";

const FEATURES_ROOT = join(__dirname, "../../../test-vault/features");
const VAULT_ROOT = join(__dirname, "../../../test-vault");

function listFixtures(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".md")) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

describe("test-vault/features snapshot coverage", () => {
  for (const path of listFixtures(FEATURES_ROOT)) {
    const rel = relative(FEATURES_ROOT, path).replace(/\\/g, "/");
    it(`renders ${rel}`, () => {
      const md = readFileSync(path, "utf8");
      const rendered = renderFeatureFixture(md, { notePath: rel });
      expect(rendered).toMatchSnapshot();
    });
  }

  it("renders the wikilink smoke fixture as clickable links to an existing note", () => {
    const notePath = "features/content/wikilinks.md";
    const markdown = readFileSync(join(VAULT_ROOT, notePath), "utf8");
    const rendered = renderFeatureFixture(markdown, {
      notePath,
      resolveLink: (target) => {
        const targetPath = target.endsWith(".md") ? target : `${target}.md`;
        return existsSync(join(VAULT_ROOT, targetPath)) ? targetPath : null;
      },
    });

    expect(rendered).toHaveLength(4);
    for (const card of rendered) {
      expect(card.fields.Front).toContain(
        '<a href="obsidian://open?vault=Vault&amp;file=note.md',
      );
      expect(card.fields.Front).not.toContain("[[note");
    }
  });

  it.each([
    "features/content/attachment.png",
    "features/content/diagram.png",
    "features/interactions/flag.png",
  ])("keeps the visual image fixture %s large enough to inspect", (path) => {
    const png = readFileSync(join(VAULT_ROOT, path));

    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(320);
    expect(png.readUInt32BE(20)).toBeGreaterThanOrEqual(180);
  });

  it.each([
    "features/content/beep.wav",
    "features/content/chime.wav",
    "features/interactions/motif.wav",
  ])("keeps the audio fixture %s long and loud enough to hear", (path) => {
    const wav = readFileSync(join(VAULT_ROOT, path));

    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.subarray(36, 40).toString("ascii")).toBe("data");

    const sampleRate = wav.readUInt32LE(24);
    const dataLength = wav.readUInt32LE(40);
    expect(dataLength / 2 / sampleRate).toBeGreaterThanOrEqual(1);

    let peak = 0;
    for (let offset = 44; offset + 1 < wav.length; offset += 2) {
      peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)));
    }
    expect(peak).toBeGreaterThanOrEqual(8_000);
  });
});
