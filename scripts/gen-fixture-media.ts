/**
 * Dev utility: generate deterministic placeholder media for test-vault fixtures.
 *
 * Why: feature fixtures reference images/audio (e.g. `![[diagram.png]]`). Without
 * the referenced files, Obsidian shows broken-image icons when a developer opens
 * `test-vault/` for manual smoke testing. Automated snapshot tests use a
 * synthetic resolver and don't need these files.
 *
 * Run: `npm run fixture-media`
 *
 * Deterministic: output bytes are a pure function of the filename, so re-running
 * is a no-op (and `git status` stays clean).
 *
 * TODO: once `src/core/render/extract-media.ts` lands, swap the inline regex for
 * `extractMedia()` so this script and the renderer agree on what counts as a
 * media ref.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const FEATURES_DIR = join(REPO_ROOT, "test-vault", "features");

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "m4a", "flac", "opus", "3gp"]);

type Kind = "image" | "audio";
type Ref = { target: string; kind: Kind };

function classify(target: string): Kind | null {
	const ext = target.split(".").pop()?.toLowerCase() ?? "";
	if (IMAGE_EXTS.has(ext)) return "image";
	if (AUDIO_EXTS.has(ext)) return "audio";
	return null;
}

/** Walk a directory recursively, returning absolute paths of .md files. */
function walkMarkdown(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walkMarkdown(p));
		else if (entry.isFile() && p.endsWith(".md")) out.push(p);
	}
	return out;
}

/**
 * Extract media refs from markdown source.
 *
 * Supports:
 *   - Obsidian embeds: `![[target|alias]]`
 *   - Standard images: `![alt](target)`
 *
 * The `|alias` and `#section` suffixes are stripped to recover the file target.
 */
function extractRefs(md: string): Ref[] {
	const refs: Ref[] = [];
	const wikilink = /!\[\[([^\]]+)\]\]/g;
	const mdImage = /!\[[^\]]*\]\(([^)\s]+)/g;
	let m: RegExpExecArray | null;
	while ((m = wikilink.exec(md)) !== null) {
		const inner = m[1] ?? "";
		const raw = (inner.split("|")[0] ?? "").split("#")[0]?.trim() ?? "";
		const kind = classify(raw);
		if (kind) refs.push({ target: raw, kind });
	}
	while ((m = mdImage.exec(md)) !== null) {
		const raw = (m[1] ?? "").split("#")[0]?.trim() ?? "";
		const kind = classify(raw);
		if (kind) refs.push({ target: raw, kind });
	}
	return refs;
}

/** Visible fallback PNG: IHDR + IDAT + IEND, with a filename-derived pattern. */
function makePng(filename: string): Buffer {
	const hash = createHash("sha1").update(filename).digest();
	const r = hash[0] ?? 0;
	const g = hash[1] ?? 0;
	const b = hash[2] ?? 0;

	const W = 640, H = 360;
	// Raw image: per-row filter byte (0) + RGB pixels
	const raw = Buffer.alloc(H * (1 + W * 3));
	for (let y = 0; y < H; y++) {
		const rowStart = y * (1 + W * 3);
		raw[rowStart] = 0; // filter: None
		for (let x = 0; x < W; x++) {
			const px = rowStart + 1 + x * 3;
			const border = x < 24 || x >= W - 24 || y < 24 || y >= H - 24;
			const block = y >= 125 && y < 235 && (
				(x >= 55 && x < 190) ||
				(x >= 252 && x < 387) ||
				(x >= 449 && x < 584)
			);
			const connector = y >= 176 && y < 184 && x >= 190 && x < 449;
			if (border || connector) {
				raw[px] = r;
				raw[px + 1] = g;
				raw[px + 2] = b;
			} else if (block) {
				raw[px] = 90 + (r % 120);
				raw[px + 1] = 90 + (g % 120);
				raw[px + 2] = 90 + (b % 120);
			} else {
				raw[px] = 246;
				raw[px + 1] = 244;
				raw[px + 2] = 238;
			}
		}
	}
	const idatData = deflateSync(raw, { level: 9 });

	const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(W, 0);
	ihdr.writeUInt32BE(H, 4);
	ihdr[8] = 8;     // bit depth
	ihdr[9] = 2;     // colour type: truecolour RGB
	ihdr[10] = 0;    // compression
	ihdr[11] = 0;    // filter
	ihdr[12] = 0;    // interlace

	return Buffer.concat([
		signature,
		chunk("IHDR", ihdr),
		chunk("IDAT", idatData),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

function chunk(type: string, data: Buffer): Buffer {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const typeBuf = Buffer.from(type, "ascii");
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
	return Buffer.concat([len, typeBuf, data, crc]);
}

// CRC-32 (IEEE 802.3) for PNG chunks.
const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();
function crc32(buf: Buffer): number {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) {
		const byte = buf[i] ?? 0;
		c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

/** Audible deterministic PCM tone chosen by fixture filename. */
function makeWav(filename: string): Buffer {
	const sampleRate = 22050;
	const bitsPerSample = 16;
	const channels = 1;
	const durationSeconds = filename === "motif.wav" ? 1.55 : 1.25;
	const sampleCount = Math.floor(sampleRate * durationSeconds);
	const dataLen = sampleCount * (bitsPerSample / 8);
	const byteRate = sampleRate * channels * (bitsPerSample / 8);
	const blockAlign = channels * (bitsPerSample / 8);

	const buf = Buffer.alloc(44 + dataLen);
	buf.write("RIFF", 0);
	buf.writeUInt32LE(36 + dataLen, 4);
	buf.write("WAVE", 8);
	buf.write("fmt ", 12);
	buf.writeUInt32LE(16, 16);             // fmt chunk size
	buf.writeUInt16LE(1, 20);              // PCM
	buf.writeUInt16LE(channels, 22);
	buf.writeUInt32LE(sampleRate, 24);
	buf.writeUInt32LE(byteRate, 28);
	buf.writeUInt16LE(blockAlign, 32);
	buf.writeUInt16LE(bitsPerSample, 34);
	buf.write("data", 36);
	buf.writeUInt32LE(dataLen, 40);

	const fade = (time: number, start: number, end: number): number => {
		const attack = Math.min(1, Math.max(0, (time - start) / 0.012));
		const release = Math.min(1, Math.max(0, (end - time) / 0.04));
		return attack * release;
	};
	const tone = (time: number, start: number, end: number, hz: number): number =>
		time >= start && time < end
			? Math.sin(2 * Math.PI * hz * (time - start)) * fade(time, start, end)
			: 0;

	for (let i = 0; i < sampleCount; i++) {
		const time = i / sampleRate;
		let value: number;
		if (filename === "beep.wav") {
			value = 0.52 * (
				tone(time, 0.12, 0.32, 880) + tone(time, 0.48, 0.68, 880)
			);
		} else if (filename === "chime.wav") {
			const envelope = time >= 0.05 ? Math.exp(-(time - 0.05) * 2.8) : 0;
			value = envelope * (
				0.38 * tone(time, 0.05, 1.2, 660) +
				0.22 * tone(time, 0.05, 1.2, 990) +
				0.12 * tone(time, 0.05, 1.2, 1320)
			);
		} else if (filename === "motif.wav") {
			value = 0.46 * (
				tone(time, 0.05, 0.19, 392) +
				tone(time, 0.28, 0.42, 392) +
				tone(time, 0.51, 0.65, 392) +
				tone(time, 0.74, 1.48, 311.13)
			);
		} else {
			const frequency = 440 + (createHash("sha1").update(filename).digest()[0] ?? 0);
			value = 0.45 * tone(time, 0.08, 1.1, frequency);
		}
		buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + i * 2);
	}
	return buf;
}

function main(): void {
	if (!existsSync(FEATURES_DIR)) {
		console.error(`features dir not found: ${FEATURES_DIR}`);
		process.exit(1);
	}

	const mdFiles = walkMarkdown(FEATURES_DIR).sort();

	// Map destination absolute path -> Ref (first occurrence wins).
	const destinations = new Map<string, Ref>();
	for (const md of mdFiles) {
		const src = readFileSync(md, "utf8");
		const mdDir = dirname(md);
		for (const ref of extractRefs(src)) {
			// Obsidian wikilinks use POSIX-style separators inside the link text.
			const dest = resolve(mdDir, ref.target.split(posix.sep).join("/"));
			if (!destinations.has(dest)) destinations.set(dest, ref);
		}
	}

	let created = 0;
	let updated = 0;
	let skipped = 0;
	let bytes = 0;
	const perKind: Record<Kind, number> = { image: 0, audio: 0 };

	for (const [dest, ref] of destinations) {
		const filename = dest.split("/").pop()!;
		const data = ref.kind === "image" ? makePng(filename) : makeWav(filename);
		if (existsSync(dest)) {
			// Image fixtures may be curated diagrams or screenshots. Preserve them.
			// Audio fixtures are generated test tones and stay reproducible here.
			if (ref.kind === "image" || readFileSync(dest).equals(data)) {
				skipped++;
				continue;
			}
			writeFileSync(dest, data);
			updated++;
			bytes += data.length;
			perKind[ref.kind]++;
			continue;
		}
		mkdirSync(dirname(dest), { recursive: true });
		writeFileSync(dest, data);
		created++;
		bytes += data.length;
		perKind[ref.kind]++;
	}

	console.log(
		`created ${created}, updated ${updated} files (image: ${perKind.image}, audio: ${perKind.audio}, ${bytes} bytes), skipped ${skipped}`
	);
}

main();
