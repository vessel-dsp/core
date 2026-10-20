// Typed LED colour: a `kind: led` device's stated `Color` keys the closed-vocabulary
// colour-default law through the existing diode lookup. Synthetic fixtures and a
// synthetic registry only: no pedal identity, no corpus membership, no packet spelling.
import { describe, expect, test } from "bun:test";
import { compile } from "../src/compile";
import { pedalPartCatalog } from "../src/part-catalog";
import { readNetlist } from "../src/netlist";
import { attachDeviceLaws } from "../src/device-laws";
import { diodeClipper, derive } from "../src/fixtures";
import type { PartRegistry } from "../src/registry";
import type { DeviceLaw } from "../src/types";

const synthRegistry: PartRegistry = {
	entries: [
		{
			partIds: ["white"],
			declaredTypes: [],
			terminalRoleGroups: [],
			model: {
				kind: "law",
				law: {
					kind: "diode",
					saturationCurrent: 4.056687e-26,
					emissionCoefficient: 1.98811,
					thermalVoltage: 0.025852,
					breakdownVolts: 0,
					seriesResistance: 22.5033,
					isLed: true,
				},
			},
		},
		{
			partIds: ["SYNTH-RED"],
			declaredTypes: [],
			terminalRoleGroups: [],
			model: {
				kind: "law",
				law: {
					kind: "diode",
					saturationCurrent: 1.1110898624e-14,
					emissionCoefficient: 2.7587062,
					thermalVoltage: 0.025852,
					breakdownVolts: 0,
					seriesResistance: 2,
					isLed: true,
				},
			},
		},
	],
};

/** One-diode doc: D1 becomes the LED under test, D2 is dropped. */
function ledDoc(extra: string, kind = "led"): string {
	let doc = derive(
		diodeClipper,
		`      Description: "Clipping diode."\n  - id: D2`,
		`${extra}      Description: "Clipping diode."\n  - id: D2`,
	);
	doc = derive(doc, `  - id: D1\n    kind: diode`, `  - id: D1\n    kind: ${kind}`);
	const cut = doc.indexOf("  - id: D2");
	if (cut < 0) throw new Error("D2 block not found");
	return `${doc.slice(0, cut)}wires: []\n`;
}

function stampOf(source: string, registry: PartRegistry): DeviceLaw {
	const netlist = readNetlist(source, {});
	const lawed = attachDeviceLaws(netlist, registry);
	const resolution = lawed.resolutions.find((r) => r.device === "D1");
	if (!resolution || resolution.outcome !== "law") {
		throw new Error(`D1: no law (outcome ${resolution?.outcome})`);
	}
	return resolution.law;
}

describe("typed LED colour", () => {
	test("an in-vocabulary Color keys no PartNumber device to the colour law", () => {
		const law = stampOf(ledDoc('      Color: white\n'), synthRegistry);
		expect(law.kind).toBe("diode");
		if (law.kind !== "diode") throw new Error("unreachable");
		expect(law.saturationCurrent).toBe(4.056687e-26);
		expect(law.emissionCoefficient).toBe(1.98811);
		expect(law.thermalVoltage).toBe(0.025852);
		expect(law.seriesResistance).toBe(22.5033);
		expect(law.isLed).toBe(true);
	});

	test("an out-of-vocabulary Color keeps the class defaults and warns", () => {
		// Note: YAML `"red"` parses to `red` (in vocabulary). Literal quote characters
		// need single-quoted YAML, as the corpus writes them (`'"red"'`).
		// Each pair is [YAML source text, parsed `Color` value the warning quotes].
		for (const [source, parsed] of [
			["amber", "amber"],
			[`'"red"'`, `"red"`],
			["red-green", "red-green"],
			["Red", "Red"],
		] as const) {
			const doc = ledDoc(`      Color: ${source}\n`);
			const law = stampOf(doc, synthRegistry);
			expect(law.kind).toBe("diode");
			if (law.kind !== "diode") throw new Error("unreachable");
			expect(law.saturationCurrent).toBe(1e-12);
			expect(law.thermalVoltage).toBe(0.05);
			expect(law.seriesResistance).toBe(2);
			const compiled = compile(doc, { registry: synthRegistry });
			expect(compiled.status).toBe("ok");
			if (compiled.status !== "ok") return;
			const warnings = compiled.warnings.filter(
				(w) => w.code === "led-colour-unmatched",
			);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]?.device).toBe("D1");
			expect(warnings[0]?.value).toBe(parsed);
			expect(warnings[0]?.detail).toContain(`"${parsed}"`);
		}
	});

	test("a YAML-quoted vocabulary word is in vocabulary and raises no warning", () => {
		// `Color: "red"` parses to `red`: vocabulary member, so no diagnostic. The
		// synthetic registry holds no "RED LED" entry, so no colour law resolves either.
		const compiled = compile(ledDoc('      Color: "red"\n'), { registry: synthRegistry });
		expect(compiled.status).toBe("ok");
		if (compiled.status !== "ok") return;
		expect(
			compiled.warnings.filter((w) => w.code === "led-colour-unmatched"),
		).toHaveLength(0);
	});

	test("an in-vocabulary Color raises no unmatched warning", () => {
		const compiled = compile(ledDoc('      Color: yellow\n'), { registry: synthRegistry });
		expect(compiled.status).toBe("ok");
		if (compiled.status !== "ok") return;
		expect(
			compiled.warnings.filter((w) => w.code === "led-colour-unmatched"),
		).toHaveLength(0);
	});

	test("a PartNumber law wins over Color", () => {
		const law = stampOf(
			ledDoc('      PartNumber: SYNTH-RED\n      Color: white\n'),
			synthRegistry,
		);
		expect(law.kind).toBe("diode");
		if (law.kind !== "diode") throw new Error("unreachable");
		expect(law.saturationCurrent).toBe(1.1110898624e-14);
		const compiled = compile(
			ledDoc('      PartNumber: SYNTH-RED\n      Color: white\n'),
			{ registry: synthRegistry },
		);
		expect(compiled.status).toBe("ok");
		if (compiled.status !== "ok") return;
		expect(
			compiled.warnings.filter((w) => w.code === "led-colour-unmatched"),
		).toHaveLength(0);
	});

	test("a declared parameter wins over the colour law", () => {
		const law = stampOf(
			ledDoc('      Color: white\n      SaturationCurrent: "1e-13"\n'),
			synthRegistry,
		);
		expect(law.kind).toBe("diode");
		if (law.kind !== "diode") throw new Error("unreachable");
		expect(law.saturationCurrent).toBe(1e-13);
		expect(law.emissionCoefficient).toBe(1.98811);
		expect(law.isLed).toBe(true);
	});

	test("Color is not read for kind diode, and never warns there", () => {
		// Amber on a diode: ignored entirely (silicon defaults, no diagnostic).
		const amber = stampOf(ledDoc('      Color: amber\n', "diode"), synthRegistry);
		expect(amber.kind).toBe("diode");
		if (amber.kind !== "diode") throw new Error("unreachable");
		expect(amber.saturationCurrent).toBe(2.52e-9);
		expect(amber.isLed).toBe(false);
		const compiledAmber = compile(ledDoc('      Color: amber\n', "diode"), {
			registry: synthRegistry,
		});
		expect(compiledAmber.status).toBe("ok");
		if (compiledAmber.status !== "ok") return;
		expect(
			compiledAmber.warnings.filter((w) => w.code === "led-colour-unmatched"),
		).toHaveLength(0);
		// A vocabulary Color on a diode with a PartNumber law: the law serves, as before.
		const red = stampOf(
			ledDoc('      PartNumber: SYNTH-RED\n      Color: red\n', "diode"),
			synthRegistry,
		);
		expect(red.kind).toBe("diode");
		if (red.kind !== "diode") throw new Error("unreachable");
		expect(red.saturationCurrent).toBe(1.1110898624e-14);
	});
});
