import { extractMedia } from "../../../src/core/render/extract-media.js";

describe("extractMedia", () => {
  it("extracts a plain wikilink image", () => {
    const md = "![[a.png]]";
    const refs = extractMedia(md);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      kind: "image",
      raw: "![[a.png]]",
      filename: "a.png",
      start: 0,
      end: md.length,
    });
    expect(refs[0]!.width).toBeUndefined();
    expect(refs[0]!.alt).toBeUndefined();
  });

  it("extracts a wikilink image with width", () => {
    const md = "![[a.png|200]]";
    const refs = extractMedia(md);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      kind: "image",
      raw: "![[a.png|200]]",
      filename: "a.png",
      width: 200,
      start: 0,
      end: md.length,
    });
  });

  it("extracts a markdown image with empty alt", () => {
    const md = "![](a.png)";
    const refs = extractMedia(md);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      kind: "image",
      raw: "![](a.png)",
      filename: "a.png",
      start: 0,
      end: md.length,
    });
    expect(refs[0]!.alt).toBeUndefined();
  });

  it("extracts a markdown image with non-empty alt", () => {
    const md = "![alt text](a.png)";
    const refs = extractMedia(md);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      kind: "image",
      raw: "![alt text](a.png)",
      filename: "a.png",
      alt: "alt text",
    });
  });

  it("decodes URL-escaped filenames in markdown form", () => {
    const md = "![](my%20file.png)";
    const refs = extractMedia(md);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.filename).toBe("my file.png");
    expect(refs[0]!.raw).toBe("![](my%20file.png)");
  });

  it("passes through wikilink filenames unchanged (no URL decoding)", () => {
    const md = "![[my%20file.png]]";
    const refs = extractMedia(md);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.filename).toBe("my%20file.png");
  });

  it("extracts a wikilink audio ref", () => {
    const md = "![[a.mp3]]";
    const refs = extractMedia(md);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      kind: "audio",
      raw: "![[a.mp3]]",
      filename: "a.mp3",
    });
  });

  it("extracts a markdown audio ref", () => {
    const md = "![](a.wav)";
    const refs = extractMedia(md);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      kind: "audio",
      raw: "![](a.wav)",
      filename: "a.wav",
    });
  });

  it("ignores wikilinks with unknown extensions", () => {
    expect(extractMedia("![[notes.txt]]")).toEqual([]);
  });

  it("ignores markdown images with unknown extensions", () => {
    expect(extractMedia("![](notes.txt)")).toEqual([]);
  });

  it("matches extensions case-insensitively", () => {
    const refs = extractMedia("![[A.PNG]] and ![](B.MP3)");
    expect(refs).toHaveLength(2);
    expect(refs[0]!.kind).toBe("image");
    expect(refs[1]!.kind).toBe("audio");
  });

  it("preserves document order across multiple refs of the same kind", () => {
    const md = "first ![[a.png]] then ![[b.png|50]] last ![](c.png)";
    const refs = extractMedia(md);
    expect(refs.map((r) => r.filename)).toEqual(["a.png", "b.png", "c.png"]);
    for (let i = 1; i < refs.length; i++) {
      expect(refs[i]!.start).toBeGreaterThan(refs[i - 1]!.start);
    }
  });

  it("preserves document order across kinds (mixed images + audio)", () => {
    const md = "![[a.mp3]] then ![[b.png]] then ![](c.wav) then ![](d.png)";
    const refs = extractMedia(md);
    expect(refs.map((r) => ({ kind: r.kind, filename: r.filename }))).toEqual([
      { kind: "audio", filename: "a.mp3" },
      { kind: "image", filename: "b.png" },
      { kind: "audio", filename: "c.wav" },
      { kind: "image", filename: "d.png" },
    ]);
  });

  it("skips refs inside fenced code blocks", () => {
    const md = "before\n```\n![[a.png]]\n```\nafter ![[b.png]]";
    const refs = extractMedia(md);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.filename).toBe("b.png");
  });

  it("skips refs inside inline backticks", () => {
    const md = "see `![[a.png]]` then ![[b.png]]";
    const refs = extractMedia(md);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.filename).toBe("b.png");
  });

  it("source range exactly bounds the raw substring", () => {
    const md = "prefix ![[diagram.png|123]] suffix";
    const refs = extractMedia(md);
    expect(refs).toHaveLength(1);
    const r = refs[0]!;
    expect(md.slice(r.start, r.end)).toBe(r.raw);
    expect(r.raw).toBe("![[diagram.png|123]]");
  });

  it("drops the width when |N is not a positive integer", () => {
    // Spec says: width only if positive integer. Choice: a non-positive-integer
    // pipe segment makes the wikilink not match at all (no filename match w/ pipe junk).
    // Simplest: filename keeps just the part before |, width undefined.
    const refs = extractMedia("![[a.png|abc]]");
    expect(refs).toHaveLength(1);
    expect(refs[0]!.filename).toBe("a.png");
    expect(refs[0]!.width).toBeUndefined();
  });

  it("drops the width when |0", () => {
    const refs = extractMedia("![[a.png|0]]");
    expect(refs).toHaveLength(1);
    expect(refs[0]!.filename).toBe("a.png");
    expect(refs[0]!.width).toBeUndefined();
  });
});
