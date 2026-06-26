import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { parseSchx } from "../../../packages/core/src/formats/schx/parser";
import { serializeSchx } from "../../../packages/core/src/formats/schx/serializer";

const EXAMPLES_DIR = new URL(
	"../../fixtures/schx/livespice-examples/",
	import.meta.url,
);

const EXPECTED_EXAMPLES = [
	"59 Bassman Preamp+Tone Stack.schx",
	"Big Muff Pi.schx",
	"Boss Super Overdrive SD-1.schx",
	"Bridge Rectifier.schx",
	"Common Cathode Triode Amplifier.schx",
	"Common Emitter Transistor Amplifier.schx",
	"Dunlop Cry Baby GCB-95.schx",
	"Fender 5e3.schx",
	"Ibanez Tube Screamer TS-9.schx",
	"MXR Distortion +.schx",
	"MXR Phase 90.schx",
	"Marshall Blues Breaker.schx",
	"Marshall JCM2000 DSL Preamp.schx",
	"Marshall JCM800 2203 Preamp.schx",
	"Marshall JCM800 2203 preamp modded.schx",
	"Op-Amp Model.schx",
	"Orange Rockerverb 50 Preamp.schx",
	"Passive 1stOrder Lowpass RC.schx",
	"Pro Co Rat.schx",
	"Wien Bridge Oscillator.schx",
] as const;

async function loadExample(name: string): Promise<string> {
	return Bun.file(new URL(name, EXAMPLES_DIR)).text();
}

describe("LiveSPICE example fixtures", () => {
	test("vendors every upstream .schx example fixture", async () => {
		const actual = (await readdir(EXAMPLES_DIR))
			.filter((name) => name.endsWith(".schx"))
			.sort();

		expect(actual).toEqual([...EXPECTED_EXAMPLES].sort());
	});

	for (const name of EXPECTED_EXAMPLES) {
		test(`${name} parses without unknown component type warnings`, async () => {
			const doc = parseSchx(await loadExample(name));
			const unknownWarnings = doc.warnings.filter(
				(warning) => warning.code === "unknown-component-type",
			);

			expect(doc.components.length).toBeGreaterThan(0);
			expect(doc.wires.length).toBeGreaterThan(0);
			expect(unknownWarnings).toEqual([]);
		});
	}

	test("Pro Co Rat example covers LM308 op-amp and 2N5458 JFET", async () => {
		const doc = parseSchx(await loadExample("Pro Co Rat.schx"));

		expect(
			doc.components.some(
				(component) =>
					component.kind === "opamp" &&
					component.id === "X1" &&
					component.properties.PartNumber === "LM308",
			),
		).toBe(true);
		expect(
			doc.components.some(
				(component) =>
					component.kind === "jfet" &&
					component.id === "Q1" &&
					component.properties.PartNumber === "2N5458",
			),
		).toBe(true);
	});

	test("round-trips all LiveSPICE examples with stable component and wire counts", async () => {
		for (const name of EXPECTED_EXAMPLES) {
			const first = parseSchx(await loadExample(name));
			const second = parseSchx(serializeSchx(first));

			expect(second.components.length, name).toBe(first.components.length);
			expect(second.wires.length, name).toBe(first.wires.length);
		}
	});
});
