import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { parseLtspiceAsc } from "../../../packages/core/src/formats/ltspice/parser";
import { isParsedQuantity } from "../../../packages/core/src/model/properties";

// Source: https://github.com/cushychicken/ltspice-guitar-pedals (real LTspice
// pedal schematics, Windows-1252 encoded). These fixtures are why the parser
// accepts Uint8Array and falls back to Windows-1252 decoding for the µ sign.
const PEDALS_DIR = new URL(
	"../../fixtures/asc/ltspice-guitar-pedals/",
	import.meta.url,
);

const EXPECTED_PEDALS = [
	"boss-ge7-equalizer.asc",
	"colorsound-phase-x.asc",
	"dan-armstrong-green-ringer.asc",
	"dunlop-crybaby-wah.asc",
	"lovetone-big-cheese.asc",
	"mxr-dyna-comp.asc",
	"proco-rat-distortion.asc",
	"schaller-tremolo.asc",
	"ts808_tube_screamer.asc",
] as const;

// LM13700 is an OTA — no `kind: 'ota'` exists in the catalog yet, so the
// dyna-comp's central IC stays unsupported until that catalog gap is closed.
const KNOWN_UNSUPPORTED_LTSPICE_SYMBOLS: ReadonlySet<string> = new Set([
	"lm13700_ns",
]);

async function loadPedalBytes(name: string): Promise<Uint8Array> {
	const buf = await readFile(new URL(name, PEDALS_DIR));
	return new Uint8Array(buf);
}

describe("LTspice guitar-pedal fixtures (cushychicken corpus)", () => {
	test("vendors every expected .asc fixture", async () => {
		const actual = (await readdir(PEDALS_DIR))
			.filter((name) => name.endsWith(".asc"))
			.sort();
		expect(actual).toEqual([...EXPECTED_PEDALS].sort());
	});

	for (const name of EXPECTED_PEDALS) {
		test(`${name} parses via byte path with no unexpected unknown-symbol warnings`, async () => {
			const doc = parseLtspiceAsc(await loadPedalBytes(name));

			expect(doc.components.length).toBeGreaterThan(0);
			expect(doc.wires.length).toBeGreaterThan(0);

			// Every unknown-symbol warning must be on the allowlist.
			for (const w of doc.warnings) {
				if (w.code !== "unknown-ltspice-symbol") continue;
				const c = doc.components.find((c) => c.id === w.componentId);
				const sourceType = c?.sourceTypeName?.replace(/^ltspice:/, "") ?? "";
				expect(
					KNOWN_UNSUPPORTED_LTSPICE_SYMBOLS.has(sourceType),
					`${name}: unexpected unsupported symbol ${sourceType}`,
				).toBe(true);
			}
		});
	}

	test("µF capacitor values decode and parse as 1e-4 F (= 100 µF)", async () => {
		// proco-rat-distortion.asc was transcoded from cushychicken's Windows-1252
		// source (lone 0xB5 micro byte) to UTF-8. The synthetic-bytes test in
		// parser.test.ts covers the Windows-1252 fallback path itself.
		const doc = parseLtspiceAsc(
			await loadPedalBytes("proco-rat-distortion.asc"),
		);
		const c4 = doc.components.find((c) => c.id === "C4");
		expect(c4?.kind).toBe("capacitor");
		const value = c4?.properties.C;
		expect(isParsedQuantity(value) ? value.value : null).toBeCloseTo(1e-4);
	});

	test("Opamps/<Model> symbols become opamp kind with model captured from path", async () => {
		// proco-rat-distortion.asc has SYMBOL Opamps\LM308 ...
		const doc = parseLtspiceAsc(
			await loadPedalBytes("proco-rat-distortion.asc"),
		);
		const u1 = doc.components.find((c) => c.id === "U1");
		expect(u1?.kind).toBe("opamp");
		expect(u1?.properties.model).toBe("LM308");
	});
});
