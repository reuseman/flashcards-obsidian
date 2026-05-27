/**
 * Deterministic generator for pinned benchmark fixtures.
 *
 * Run: `node --experimental-strip-types tests/perf/_fixtures/generate.ts`
 *
 * The output files are immutable benchmark inputs — committed to the repo so
 * that mean ± stddev is comparable across runs. Changing this generator
 * changes the metric identity; re-baseline whenever the outputs change.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function buildInline(): string {
  const lines: string[] = ["# 50 inline cards", ""];
  for (let i = 1; i <= 50; i++) {
    const id = String(i).padStart(3, "0");
    lines.push(`Q-${id} What is fact number ${id}?::A-${id} Answer body for ${id}.`);
    lines.push("");
  }
  return lines.join("\n");
}

function buildCloze(): string {
  const prose = [
    "The mitochondrion is the {{c1::powerhouse}} of the cell.",
    "Water boils at {{c1::100}} degrees Celsius at sea level.",
    "{{c1::Photosynthesis}} converts light into chemical energy.",
    "The capital of France is {{c1::Paris}}.",
    "DNA stands for {{c1::deoxyribonucleic acid}}.",
    "The speed of light is approximately {{c1::299,792 km/s}}.",
    "{{c1::Newton}} formulated the laws of motion.",
    "The chemical symbol for gold is {{c1::Au}}.",
    "{{c1::Einstein}} published the theory of relativity in 1905.",
    "Mount Everest is {{c1::8,849}} metres tall.",
    "The largest ocean on Earth is the {{c1::Pacific}}.",
    "Humans have {{c1::46}} chromosomes.",
    "The currency of Japan is the {{c1::yen}}.",
    "{{c1::Mercury}} is the closest planet to the Sun.",
    "The Pythagorean theorem states a² + b² = {{c1::c²}}.",
    "{{c1::Shakespeare}} wrote Hamlet.",
    "Pi is approximately {{c1::3.14159}}.",
    "The element with atomic number 1 is {{c1::hydrogen}}.",
    "The freezing point of water is {{c1::0}} degrees Celsius.",
    "{{c1::Marie Curie}} discovered radium and polonium.",
  ];
  const lines: string[] = ["# 20 cloze cards", ""];
  for (const line of prose) {
    lines.push(line);
    lines.push("");
  }
  return lines.join("\n");
}

function buildMedia(): string {
  const lines: string[] = ["# Mixed media note", ""];
  lines.push("## Wikilink images");
  for (let i = 1; i <= 5; i++) {
    lines.push(`Lorem ipsum dolor sit amet ![[image-${i}.png]] consectetur adipiscing.`);
  }
  lines.push("");
  lines.push("## Markdown images");
  for (let i = 1; i <= 5; i++) {
    lines.push(`Sed do eiusmod tempor ![alt ${i}](images/md-image-${i}.jpg) incididunt ut.`);
  }
  lines.push("");
  lines.push("## Audio refs");
  for (let i = 1; i <= 3; i++) {
    lines.push(`Ut enim ad minim veniam ![[audio-${i}.mp3]] quis nostrud.`);
  }
  lines.push("");
  return lines.join("\n");
}

function writeFixture(name: string, content: string | Buffer): void {
  const p = resolve(here, name);
  writeFileSync(p, content);
  console.log(`wrote ${p} (${typeof content === "string" ? Buffer.byteLength(content) : content.length} bytes)`);
}

writeFixture("50-inline-cards.md", buildInline());
writeFixture("20-cloze-cards.md", buildCloze());
writeFixture("media-mixed.md", buildMedia());
writeFixture("1mb-binary.bin", Buffer.alloc(1048576, "X"));
