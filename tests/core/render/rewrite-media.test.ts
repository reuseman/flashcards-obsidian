import {
  rewriteMedia,
  type MediaRewriteMap,
} from "../../../src/core/render/rewrite-media.js";

function imageMap(orig: string, finalName: string): MediaRewriteMap {
  return { [orig]: { kind: "image", finalName } };
}

function audioMap(orig: string, finalName: string): MediaRewriteMap {
  return { [orig]: { kind: "audio", finalName } };
}

describe("rewriteMedia", () => {
  it("rewrites a plain wikilink image to <img src='...'>", () => {
    expect(rewriteMedia("![[a.png]]", imageMap("a.png", "h1.png"))).toBe(
      "<img src='h1.png'>",
    );
  });

  it("rewrites a wikilink image with width", () => {
    expect(rewriteMedia("![[a.png|200]]", imageMap("a.png", "h1.png"))).toBe(
      "<img src='h1.png' width='200'>",
    );
  });

  it("rewrites a markdown image with alt", () => {
    expect(
      rewriteMedia("![hello](a.png)", imageMap("a.png", "h1.png")),
    ).toBe("<img src='h1.png' alt='hello'>");
  });

  it("rewrites a markdown image with empty alt as no alt", () => {
    expect(rewriteMedia("![](a.png)", imageMap("a.png", "h1.png"))).toBe(
      "<img src='h1.png'>",
    );
  });

  it("rewrites a wikilink image when both width and alt would apply (alt only meaningful from md form)", () => {
    // Width from wikilink + alt impossible together in source forms; verify width-only path.
    expect(rewriteMedia("![[a.png|50]]", imageMap("a.png", "h1.png"))).toBe(
      "<img src='h1.png' width='50'>",
    );
  });

  it("rewrites audio (wikilink) to [sound:...]", () => {
    expect(rewriteMedia("![[a.mp3]]", audioMap("a.mp3", "h1.mp3"))).toBe(
      "[sound:h1.mp3]",
    );
  });

  it("rewrites audio (markdown) to [sound:...]", () => {
    expect(rewriteMedia("![](a.wav)", audioMap("a.wav", "h1.wav"))).toBe(
      "[sound:h1.wav]",
    );
  });

  it("HTML-escapes the five special chars in alt text", () => {
    const md = `![a<b>&"'](a.png)`;
    expect(rewriteMedia(md, imageMap("a.png", "h1.png"))).toBe(
      "<img src='h1.png' alt='a&lt;b&gt;&amp;&quot;&#39;'>",
    );
  });

  it("leaves refs not in the map untouched", () => {
    const md = "![[a.png]] and ![[b.png]]";
    expect(rewriteMedia(md, imageMap("a.png", "h1.png"))).toBe(
      "<img src='h1.png'> and ![[b.png]]",
    );
  });

  it("rewrites multiple refs in one input", () => {
    const md = "x ![[a.png]] y ![](b.wav) z ![[c.png|10]]";
    const map: MediaRewriteMap = {
      "a.png": { kind: "image", finalName: "ha.png" },
      "b.wav": { kind: "audio", finalName: "hb.wav" },
      "c.png": { kind: "image", finalName: "hc.png" },
    };
    expect(rewriteMedia(md, map)).toBe(
      "x <img src='ha.png'> y [sound:hb.wav] z <img src='hc.png' width='10'>",
    );
  });

  it("does not rewrite refs inside fenced code blocks", () => {
    const md = "```\n![[a.png]]\n```\nand ![[a.png]]";
    const out = rewriteMedia(md, imageMap("a.png", "h1.png"));
    expect(out).toBe("```\n![[a.png]]\n```\nand <img src='h1.png'>");
  });

  it("does not rewrite refs inside inline backticks", () => {
    const md = "`![[a.png]]` and ![[a.png]]";
    const out = rewriteMedia(md, imageMap("a.png", "h1.png"));
    expect(out).toBe("`![[a.png]]` and <img src='h1.png'>");
  });

  it("drops |0 width and emits a plain <img>", () => {
    expect(rewriteMedia("![[a.png|0]]", imageMap("a.png", "h1.png"))).toBe(
      "<img src='h1.png'>",
    );
  });

  it("drops non-integer width and emits a plain <img>", () => {
    expect(rewriteMedia("![[a.png|abc]]", imageMap("a.png", "h1.png"))).toBe(
      "<img src='h1.png'>",
    );
  });

  it("decodes URL-escaped markdown filenames for map lookup", () => {
    const md = "![](my%20file.png)";
    const map = imageMap("my file.png", "h1.png");
    expect(rewriteMedia(md, map)).toBe("<img src='h1.png'>");
  });
});
