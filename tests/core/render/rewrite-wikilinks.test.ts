import {
  rewriteWikilinks,
  type RewriteWikilinksContext,
} from "../../../src/core/render/rewrite-wikilinks.js";

function makeCtx(
  overrides: Partial<RewriteWikilinksContext> = {},
): RewriteWikilinksContext {
  return {
    vaultName: "V",
    sourcePath: "Source.md",
    resolveLink: (target: string) => target,
    ...overrides,
  };
}

describe("rewriteWikilinks", () => {
  describe("basic resolution", () => {
    it("rewrites [[Note]] to a markdown link with obsidian:// URI", () => {
      const out = rewriteWikilinks("See [[Note]] here.", makeCtx());
      expect(out).toBe("See [Note](obsidian://open?vault=V&file=Note) here.");
    });

    it("uses the resolved path verbatim in the file= param for nested targets", () => {
      const ctx = makeCtx({
        resolveLink: (target) => (target === "Sub" ? "Folder/Sub" : null),
      });
      const out = rewriteWikilinks("[[Sub]]", ctx);
      expect(out).toBe("[Sub](obsidian://open?vault=V&file=Folder%2FSub)");
    });

    it("preserves the original link text as the anchor for folder-style targets", () => {
      const ctx = makeCtx({
        resolveLink: (target) =>
          target === "Folder/Sub" ? "Folder/Sub" : null,
      });
      const out = rewriteWikilinks("[[Folder/Sub]]", ctx);
      expect(out).toBe(
        "[Folder/Sub](obsidian://open?vault=V&file=Folder%2FSub)",
      );
    });
  });

  describe("aliases", () => {
    it("uses the alias as anchor text and resolves the target before the pipe", () => {
      const ctx = makeCtx({
        resolveLink: (target) => (target === "Target" ? "Target" : null),
      });
      const out = rewriteWikilinks("[[Target|Display alias]]", ctx);
      expect(out).toBe(
        "[Display alias](obsidian://open?vault=V&file=Target)",
      );
    });
  });

  describe("heading fragments", () => {
    it("URL-encodes a heading fragment after '#'", () => {
      const ctx = makeCtx({
        resolveLink: (target) => (target === "Note" ? "Note" : null),
      });
      const out = rewriteWikilinks("[[Note#A heading]]", ctx);
      expect(out).toBe(
        "[Note#A heading](obsidian://open?vault=V&file=Note#A%20heading)",
      );
    });

    it("URL-encodes block reference fragments preserving the caret", () => {
      const ctx = makeCtx({
        resolveLink: (target) => (target === "Note" ? "Note" : null),
      });
      const out = rewriteWikilinks("[[Note#^q-aaaa]]", ctx);
      expect(out).toBe(
        "[Note#^q-aaaa](obsidian://open?vault=V&file=Note#%5Eq-aaaa)",
      );
    });
  });

  describe("vault name encoding", () => {
    it("URL-encodes vault names containing spaces", () => {
      const ctx = makeCtx({ vaultName: "My Vault" });
      const out = rewriteWikilinks("[[Note]]", ctx);
      expect(out).toBe(
        "[Note](obsidian://open?vault=My%20Vault&file=Note)",
      );
    });
  });

  describe("multiple links on the same line", () => {
    it("rewrites every wikilink on a single line independently", () => {
      const ctx = makeCtx({
        resolveLink: (target) => target,
      });
      const out = rewriteWikilinks("[[A]] and [[B]] and [[C]]", ctx);
      expect(out).toBe(
        "[A](obsidian://open?vault=V&file=A) and " +
          "[B](obsidian://open?vault=V&file=B) and " +
          "[C](obsidian://open?vault=V&file=C)",
      );
    });
  });

  describe("unresolved and degenerate links", () => {
    it("leaves [[Note]] unchanged when resolveLink returns null", () => {
      const ctx = makeCtx({ resolveLink: () => null });
      const out = rewriteWikilinks("See [[Ghost]] here.", ctx);
      expect(out).toBe("See [[Ghost]] here.");
    });

    it("leaves empty [[]] unchanged", () => {
      const out = rewriteWikilinks("Empty [[]] link.", makeCtx());
      expect(out).toBe("Empty [[]] link.");
    });

    it("passes sourcePath through to resolveLink", () => {
      const calls: Array<[string, string]> = [];
      const ctx = makeCtx({
        sourcePath: "Folder/Note.md",
        resolveLink: (target, src) => {
          calls.push([target, src]);
          return target;
        },
      });
      rewriteWikilinks("[[Other]]", ctx);
      expect(calls).toEqual([["Other", "Folder/Note.md"]]);
    });
  });

  describe("exclusions", () => {
    it("does not rewrite wikilinks inside fenced code blocks", () => {
      const input = "Before [[A]]\n```\n[[B]]\n```\nAfter [[C]]";
      const out = rewriteWikilinks(input, makeCtx());
      expect(out).toBe(
        "Before [A](obsidian://open?vault=V&file=A)\n" +
          "```\n[[B]]\n```\n" +
          "After [C](obsidian://open?vault=V&file=C)",
      );
    });

    it("does not rewrite wikilinks inside inline code spans", () => {
      const out = rewriteWikilinks("Use `[[Note]]` syntax.", makeCtx());
      expect(out).toBe("Use `[[Note]]` syntax.");
    });

    it("does not rewrite wikilinks inside HTML comments", () => {
      const out = rewriteWikilinks(
        "Visible [[A]] <!-- hidden [[B]] --> end",
        makeCtx(),
      );
      expect(out).toBe(
        "Visible [A](obsidian://open?vault=V&file=A) <!-- hidden [[B]] --> end",
      );
    });

    it("leaves embed syntax ![[image.png]] as literal text", () => {
      const out = rewriteWikilinks("Image: ![[image.png]]", makeCtx());
      expect(out).toBe("Image: ![[image.png]]");
    });
  });
});
