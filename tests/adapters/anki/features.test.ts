import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { renderFeatureFixture } from "../../_utils/render-feature-fixture.js";

const FEATURES_ROOT = join(__dirname, "../../../test-vault/features");

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
});
