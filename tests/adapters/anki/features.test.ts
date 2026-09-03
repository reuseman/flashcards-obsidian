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
});
