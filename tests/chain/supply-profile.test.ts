// Supply profiles in @vessel-dsp/chain, applied through RuntimeNode.
//
// Every expected value below is computed by hand in the comment preceding its
// assertion. Deterministic: silence or fixed sines in, no randomness anywhere.
import { describe, expect, test } from "bun:test";
import { compile, emptyRegistry } from "@vessel-dsp/compiler";
import type { Program } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import {
	customSupplyProfile,
	profileFromMeasurement,
	RuntimeNode,
	SignalChain,
	SUPPLY_PROFILES,
	type SupplyProfile,
} from "@vessel-dsp/chain";

const RATE = 48000;

// ---------------------------------------------------------------------------
// YAML builders (declared-node style, as in tests/compiler/supply-stamps.test.ts)
// ---------------------------------------------------------------------------

type TerminalSpec = {
	readonly name: string;
	readonly node: number;
	readonly x: number;
	readonly y: number;
	readonly role?: string;
};

function componentBlock(
	id: string,
	kind: string,
	ox: number,
	oy: number,
	terminals: readonly TerminalSpec[],
	properties: string,
	sourceTypeName?: string,
	extra?: string,
): string {
	let out = `  - id: ${id}\n    kind: ${kind}\n    name: ${id}\n`;
	if (sourceTypeName !== undefined) {
		out += `    sourceTypeName: ${sourceTypeName}\n`;
	}
	out += `    origin:\n      x: ${ox}\n      y: ${oy}\n    rotation: 0\n    flipped: false\n    terminals:\n`;
	for (const terminal of terminals) {
		out += `      - name: ${terminal.name}\n`;
		if (terminal.role !== undefined) {
			out += `        role: ${terminal.role}\n`;
		}
		out += `        node: ${terminal.node}\n        position:\n          x: ${terminal.x}\n          y: ${terminal.y}\n`;
	}
	if (extra !== undefined) {
		out += extra;
	}
	out += properties;
	return out;
}

const NO_PROPS = `    properties: {}\n`;
const props = (body: string): string =>
	`    properties:\n${body
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => `      ${line}`)
		.join("\n")}\n`;

function docHead(name: string, filename: string): string {
	return `schema: circuit-interchange/v3
metadata:
  name: "${name}"
  description: "supply profile test document."
  partNumber: ""
source:
  format: vdsp
  filename: ${filename}
components:
`;
}

function docFoot(power: string): string {
	return `wires: []
directives: []
diagnostics: []
rawAttributes: {}
${power}`;
}

function signalComponents(): string {
	return (
		componentBlock(
			"JIN",
			"jack",
			-200,
			0,
			[{ name: "tip", node: 1, x: -200, y: 0 }],
			NO_PROPS,
			"Circuit.Input",
		) +
		componentBlock(
			"JOUT",
			"jack",
			200,
			0,
			[{ name: "tip", node: 2, x: 200, y: 0 }],
			NO_PROPS,
			"Circuit.Output",
		) +
		componentBlock(
			"RSIG",
			"resistor",
			0,
			0,
			[
				{ name: "a", node: 1, x: -190, y: 0 },
				{ name: "b", node: 2, x: 190, y: 0 },
			],
			props('Resistance: "10k"'),
			"Circuit.Resistor",
		) +
		componentBlock(
			"GND1",
			"ground",
			0,
			-100,
			[{ name: "gnd", node: 0, x: 0, y: -100 }],
			NO_PROPS,
			"Circuit.Ground",
		)
	);
}

// Rail 9 V on node 3 with a 9k load returning to the INPUT jack (node 1).
// The load returns to the input jack, not to ground, so the supply sits in
// the executed signal region: on silence the input source holds an ideal 0 V
// and the rail is the exact divider E*9000/(9000+R). A load to ground would
// leave the supply in a block pruned from program.order. Power: NO
// sourceKind, so inference from the rail's lowered kind must yield
// external-dc. Hand-derived nodes: 0 ground, 1 in, 2 out, 3 VPLUS_RAIL +
// RLOAD.a.
function resistiveRailYaml(withPower = true): string {
	return (
		docHead("resistive rail supply", "resistive_rail.vdsp") +
		componentBlock(
			"JIN",
			"jack",
			-200,
			0,
			[{ name: "tip", node: 1, x: -200, y: 0 }],
			NO_PROPS,
			"Circuit.Input",
		) +
		componentBlock(
			"JOUT",
			"jack",
			200,
			0,
			[{ name: "tip", node: 2, x: 200, y: 0 }],
			NO_PROPS,
			"Circuit.Output",
		) +
		componentBlock(
			"GND1",
			"ground",
			0,
			-100,
			[{ name: "gnd", node: 0, x: 0, y: -100 }],
			NO_PROPS,
			"Circuit.Ground",
		) +
		componentBlock(
			"VPLUS_RAIL",
			"rail",
			0,
			100,
			[{ name: "terminal", node: 3, x: 0, y: 100, role: "positive" }],
			props('Voltage:\n  raw: "9 V"\n  value: 9\n  unit: V'),
			"Circuit.Rail",
		) +
		componentBlock(
			"RLOAD",
			"resistor",
			0,
			0,
			[
				{ name: "a", node: 3, x: 0, y: 90 },
				{ name: "b", node: 1, x: 0, y: -90 },
			],
			props('Resistance: "9k"'),
			"Circuit.Resistor",
		) +
		componentBlock(
			"R1",
			"resistor",
			0,
			0,
			[
				{ name: "a", node: 1, x: -190, y: 0 },
				{ name: "b", node: 2, x: 190, y: 0 },
			],
			props('Resistance: "10k"'),
			"Circuit.Resistor",
		) +
		docFoot(
			withPower
				? `power:
  schema: circuit-power/v1
  coverage: declared-rails
  domains:
    - id: main
      sourceComponentIds:
        - VPLUS_RAIL
      groundPolarity: negative-ground
      rails:
        - railComponentId: VPLUS_RAIL
          role: main-supply
          derivation: direct
`
				: "",
		)
	);
}

// Positive-ground germanium style: battery positive grounded (node 0), rail
// at -9 V off the negative terminal (node 3). RLOAD returns to the input
// jack so the supply stays executed. Power: positive-ground, NO sourceKind,
// sources [BATT1]. Hand-derived: the battery and the -9 V rail collapse to
// one dc-source stamp (positive row 0, negative row 3, volts 9); the rail
// node voltage is -9.
function positiveGroundYaml(): string {
	return (
		docHead("positive ground supply", "positive_ground.vdsp") +
		componentBlock(
			"JIN",
			"jack",
			-200,
			0,
			[{ name: "tip", node: 1, x: -200, y: 0 }],
			NO_PROPS,
			"Circuit.Input",
		) +
		componentBlock(
			"JOUT",
			"jack",
			200,
			0,
			[{ name: "tip", node: 2, x: 200, y: 0 }],
			NO_PROPS,
			"Circuit.Output",
		) +
		componentBlock(
			"GND1",
			"ground",
			0,
			-100,
			[{ name: "gnd", node: 0, x: 0, y: -100 }],
			NO_PROPS,
			"Circuit.Ground",
		) +
		componentBlock(
			"BATT1",
			"battery",
			0,
			0,
			[
				{ name: "negative", node: 3, x: 0, y: 60, role: "negative" },
				{ name: "positive", node: 0, x: 0, y: -100, role: "positive" },
			],
			props('Voltage: "9V"'),
			"Circuit.Battery",
		) +
		componentBlock(
			"RAIL_NEG",
			"rail",
			0,
			70,
			[{ name: "terminal", node: 3, x: 0, y: 70, role: "negative" }],
			props('Voltage: "-9V"'),
			"Circuit.Rail",
		) +
		componentBlock(
			"RLOAD",
			"resistor",
			0,
			-20,
			[
				{ name: "a", node: 3, x: 0, y: 50 },
				{ name: "b", node: 1, x: 0, y: -90 },
			],
			props('Resistance: "9k"'),
			"Circuit.Resistor",
		) +
		componentBlock(
			"R1",
			"resistor",
			0,
			0,
			[
				{ name: "a", node: 1, x: -190, y: 0 },
				{ name: "b", node: 2, x: 190, y: 0 },
			],
			props('Resistance: "10k"'),
			"Circuit.Resistor",
		) +
		docFoot(`power:
  schema: circuit-power/v1
  coverage: declared-rails
  domains:
    - id: fuzz-battery
      sourceComponentIds:
        - BATT1
      groundPolarity: positive-ground
      rails:
        - railComponentId: RAIL_NEG
          role: main-supply
          derivation: direct
          nominalVoltage:
            raw: "-9V"
            value: -9
            unit: V
`)
	);
}

// Klon-like charge pump: BATT1 + RAIL_MAIN 9 V on node 3 (collapsed to one
// stamp), RAIL_PLUS2 18 V on node 4, RAIL_MINUS -9 V on node 5. Power: NO
// sourceKind, sources [BATT1]; PLUS2/MINUS are doubler/inverter derived.
function chargePumpYaml(): string {
	return (
		docHead("charge pump supply", "charge_pump.vdsp") +
		signalComponents() +
		componentBlock(
			"BATT1",
			"battery",
			0,
			0,
			[
				{ name: "negative", node: 0, x: 0, y: -100, role: "negative" },
				{ name: "positive", node: 3, x: 0, y: 100, role: "positive" },
			],
			props('Voltage: "9V"'),
			"Circuit.Battery",
		) +
		componentBlock(
			"RAIL_MAIN",
			"rail",
			0,
			110,
			[{ name: "terminal", node: 3, x: 0, y: 110, role: "positive" }],
			props('Voltage: "9V"'),
			"Circuit.Rail",
		) +
		componentBlock(
			"RAIL_PLUS2",
			"rail",
			80,
			20,
			[{ name: "t", node: 4, x: 80, y: 20 }],
			props('Voltage: "18V"'),
			"Circuit.Rail",
		) +
		componentBlock(
			"RAIL_MINUS",
			"rail",
			-80,
			20,
			[{ name: "t", node: 5, x: -80, y: 20 }],
			props('Voltage: "-9V"'),
			"Circuit.Rail",
		) +
		componentBlock(
			"RHI",
			"resistor",
			40,
			-20,
			[
				{ name: "a", node: 4, x: 80, y: 10 },
				{ name: "b", node: 0, x: 0, y: -90 },
			],
			props('Resistance: "100k"'),
			"Circuit.Resistor",
		) +
		componentBlock(
			"RLO",
			"resistor",
			-40,
			-20,
			[
				{ name: "a", node: 5, x: -80, y: 10 },
				{ name: "b", node: 0, x: 0, y: -90 },
			],
			props('Resistance: "100k"'),
			"Circuit.Resistor",
		) +
		docFoot(`power:
  schema: circuit-power/v1
  coverage: declared-rails
  domains:
    - id: klon-charge-pump-domain
      sourceComponentIds:
        - BATT1
      ratedVoltage:
        raw: "9V"
        value: 9
        unit: V
      groundPolarity: bipolar
      rails:
        - railComponentId: RAIL_MAIN
          role: main-supply
          derivation: direct
          nominalVoltage:
            raw: "9V"
            value: 9
            unit: V
        - railComponentId: RAIL_PLUS2
          role: charge-pump-output
          derivation: doubler
          converterComponentId: U_CP
          parentRailComponentId: RAIL_MAIN
          nominalVoltage:
            raw: "18V"
            value: 18
            unit: V
        - railComponentId: RAIL_MINUS
          role: negative-supply
          derivation: inverter
          converterComponentId: U_CP
          parentRailComponentId: RAIL_MAIN
          nominalVoltage:
            raw: "-9V"
            value: -9
            unit: V
`)
	);
}

// AC mains inlet: MAINS1 is a voltage-source WITH a typed Frequency, so it
// lowers to an ac-source stamp. Sources [MAINS1], no sourceKind: mains
// evidence, so the rail refuses as mains-ac-source.
function acMainsYaml(): string {
	return (
		docHead("ac mains", "ac_mains.vdsp") +
		signalComponents() +
		componentBlock(
			"MAINS1",
			"voltage-source",
			0,
			100,
			[
				{ name: "hot", node: 30, x: 0, y: 90, role: "positive" },
				{ name: "neutral", node: 0, x: 0, y: -90, role: "negative" },
			],
			props(
				'Voltage:\n  raw: "120 V"\n  value: 120\n  unit: V\nFrequency:\n  raw: "60 Hz"\n  value: 60\n  unit: Hz',
			),
			"Circuit.MainsInlet",
		) +
		componentBlock(
			"RAIL_SEC",
			"port",
			0,
			110,
			[{ name: "t", node: 30, x: 0, y: 110 }],
			NO_PROPS,
		) +
		componentBlock(
			"RLOAD",
			"resistor",
			40,
			0,
			[
				{ name: "a", node: 30, x: 30, y: 90 },
				{ name: "b", node: 0, x: 30, y: -90 },
			],
			props('Resistance: "10k"'),
			"Circuit.Resistor",
		) +
		docFoot(`power:
  schema: circuit-power/v1
  coverage: declared-rails
  domains:
    - id: mains
      sourceComponentIds:
        - MAINS1
      groundPolarity: negative-ground
      rails:
        - railComponentId: RAIL_SEC
          role: main-supply
          derivation: direct
`)
	);
}

// Biased single-transistor gain stage, DC-coupled output (JOUT on the
// collector node 5, no output cap) so the collector bias is visible as a DC
// mean. BATT1 9 V on node 3, 470k/100k base divider, 4.7k collector to rail,
// 1k emitter to ground, 100n input coupling cap. Power: sources [BATT1], the
// rail IS the battery.
function bjtDcYaml(): string {
	return (
		docHead("bjt dc gain stage", "bjt_dc.vdsp") +
		componentBlock(
			"JIN",
			"jack",
			-200,
			0,
			[{ name: "tip", node: 1, x: -200, y: 0 }],
			NO_PROPS,
			"Circuit.Input",
		) +
		componentBlock(
			"JOUT",
			"jack",
			200,
			0,
			[{ name: "tip", node: 5, x: 200, y: 0 }],
			NO_PROPS,
			"Circuit.Output",
		) +
		componentBlock(
			"GND1",
			"ground",
			0,
			-100,
			[{ name: "gnd", node: 0, x: 0, y: -100 }],
			NO_PROPS,
			"Circuit.Ground",
		) +
		componentBlock(
			"BATT1",
			"battery",
			0,
			0,
			[
				{ name: "negative", node: 0, x: 0, y: -100, role: "negative" },
				{ name: "positive", node: 3, x: 0, y: 100, role: "positive" },
			],
			props('Voltage: "9V"'),
			"Circuit.Battery",
		) +
		componentBlock(
			"RB1",
			"resistor",
			0,
			0,
			[
				{ name: "a", node: 3, x: 0, y: 90 },
				{ name: "b", node: 4, x: 0, y: 50 },
			],
			props('Resistance: "470k"'),
			"Circuit.Resistor",
		) +
		componentBlock(
			"RB2",
			"resistor",
			0,
			0,
			[
				{ name: "a", node: 4, x: 0, y: 40 },
				{ name: "b", node: 0, x: 0, y: -90 },
			],
			props('Resistance: "100k"'),
			"Circuit.Resistor",
		) +
		componentBlock(
			"RC",
			"resistor",
			0,
			0,
			[
				{ name: "a", node: 3, x: 0, y: 80 },
				{ name: "b", node: 5, x: 0, y: 60 },
			],
			props('Resistance: "4.7k"'),
			"Circuit.Resistor",
		) +
		componentBlock(
			"RE",
			"resistor",
			0,
			0,
			[
				{ name: "a", node: 6, x: 0, y: -20 },
				{ name: "b", node: 0, x: 0, y: -80 },
			],
			props('Resistance: "1k"'),
			"Circuit.Resistor",
		) +
		componentBlock(
			"CIN",
			"capacitor",
			0,
			0,
			[
				{ name: "a", node: 1, x: -190, y: 0 },
				{ name: "b", node: 4, x: 0, y: 30 },
			],
			props('Capacitance: "100n"'),
			"Circuit.Capacitor",
		) +
		componentBlock(
			"Q1",
			"bjt",
			10,
			10,
			[
				{ name: "base", node: 4, x: 0, y: 0 },
				{ name: "collector", node: 5, x: 10, y: 10 },
				{ name: "emitter", node: 6, x: 20, y: 20 },
			],
			NO_PROPS,
			"Circuit.Bjt",
		) +
		docFoot(`power:
  schema: circuit-power/v1
  coverage: declared-rails
  domains:
    - id: main
      sourceComponentIds:
        - BATT1
      groundPolarity: negative-ground
      rails:
        - railComponentId: BATT1
          role: main-supply
          derivation: direct
`)
	);
}

function compileOk(source: string): Program {
	const result = compile(source, { registry: emptyRegistry });
	expect(result.status).toBe("ok");
	if (result.status !== "ok") {
		throw new Error("test document failed to compile");
	}
	return result.program;
}

// The RuntimeNode owns its ReferenceRuntime privately; the rail voltage lives
// in that runtime's snapshots. Read it through the back door for the exact
// Thevenin assertions (node label -> solved volts).
function railNodeVolts(node: RuntimeNode, label: number): number {
	const runtime = (node as unknown as { runtime: ReferenceRuntime }).runtime;
	for (const snap of runtime.nodeVoltageSnapshot()) {
		const row = (snap.nodeIds as readonly number[]).indexOf(label);
		if (row !== -1) {
			return snap.voltages[row] ?? NaN;
		}
	}
	return NaN;
}

function liveSupplies(node: RuntimeNode): { volts: number; sourceOhms: number }[] {
	const runtime = (node as unknown as { runtime: ReferenceRuntime }).runtime;
	return runtime.getSupplies().map((info) => ({
		volts: info.volts,
		sourceOhms: info.sourceOhms,
	}));
}

function rms(samples: Float64Array): number {
	let sum = 0;
	for (const sample of samples) {
		sum += sample * sample;
	}
	return Math.sqrt(sum / Math.max(samples.length, 1));
}

function acStats(samples: Float64Array): { mean: number; acRms: number } {
	let mean = 0;
	for (const sample of samples) {
		mean += sample;
	}
	mean /= samples.length;
	let sum = 0;
	for (const sample of samples) {
		sum += (sample - mean) * (sample - mean);
	}
	return { mean, acRms: Math.sqrt(sum / samples.length) };
}

function sine(length: number, peak: number, freqHz = 1000): Float64Array {
	const out = new Float64Array(length);
	for (let i = 0; i < length; i += 1) {
		out[i] = peak * Math.sin((2 * Math.PI * freqHz * i) / RATE);
	}
	return out;
}

// Inline provenance check: a profile is sourced when its source is non-empty
// and is not the literal "unsourced".
function isSourced(profile: Pick<SupplyProfile, "source">): boolean {
	const trimmed = profile.source.trim();
	return trimmed.length > 0 && trimmed !== "unsourced";
}

describe("chain supply profiles", () => {
	// a. Table integrity: exactly the five ids; every entry sourced; every
	// numeric value equals the brief.
	test("a: built-in table has exactly the five brief ids with sourced values", () => {
		// Expected ids, in the brief's order.
		const ids = SUPPLY_PROFILES.map((profile) => profile.id);
		expect(ids).toEqual([
			"ideal",
			"alkaline-fresh",
			"zinc-carbon-fresh",
			"alkaline-depleted-specimen",
			"zinc-carbon-used-specimen",
		]);

		const byId = new Map(SUPPLY_PROFILES.map((profile) => [profile.id, profile]));

		// Hand-copied from the brief:
		// ideal null / 0; alkaline-fresh null / 5.405 ((5.99+4.82)/2);
		// zinc-carbon-fresh null / 25.925 ((25.28+26.57)/2);
		// alkaline-depleted-specimen 7.73 / 195.00;
		// zinc-carbon-used-specimen 9.02 / 78.47.
		expect(byId.get("ideal")?.openCircuitVolts).toBeNull();
		expect(byId.get("ideal")?.internalResistanceOhms).toBe(0);
		expect(byId.get("alkaline-fresh")?.openCircuitVolts).toBeNull();
		expect(byId.get("alkaline-fresh")?.internalResistanceOhms).toBe(5.405);
		expect(byId.get("zinc-carbon-fresh")?.openCircuitVolts).toBeNull();
		expect(byId.get("zinc-carbon-fresh")?.internalResistanceOhms).toBe(25.925);
		expect(byId.get("alkaline-depleted-specimen")?.openCircuitVolts).toBe(7.73);
		expect(byId.get("alkaline-depleted-specimen")?.internalResistanceOhms).toBe(195);
		expect(byId.get("zinc-carbon-used-specimen")?.openCircuitVolts).toBe(9.02);
		expect(byId.get("zinc-carbon-used-specimen")?.internalResistanceOhms).toBe(78.47);

		for (const profile of SUPPLY_PROFILES) {
			expect(profile.name.trim().length).toBeGreaterThan(0);
			expect(profile.source.trim().length).toBeGreaterThan(0);
			expect(isSourced(profile)).toBe(true);
		}
		// The depleted specimens say in their names that each is a single
		// specimen, not a type rating.
		expect(
			byId.get("alkaline-depleted-specimen")?.name.toLowerCase(),
		).toContain("specimen");
		expect(
			byId.get("zinc-carbon-used-specimen")?.name.toLowerCase(),
		).toContain("specimen");

		// Lint-style positive control: a hand-built entry with an empty source
		// must fail the sourced check.
		expect(
			isSourced({
				source: "",
			}),
		).toBe(false);
		expect(
			isSourced({
				source: "unsourced",
			}),
		).toBe(false);
		expect(
			isSourced({
				source: (byId.get("ideal") as SupplyProfile).source,
			}),
		).toBe(true);
	});

	// b. profileFromMeasurement: Orman's method with a hand-computed example;
	// invalid inputs throw.
	test("b: profileFromMeasurement follows Orman's method and validates", () => {
		// Hand computation: open 9.00 V, loaded 8.00 V across 560 ohm.
		// Load current I = Vloaded / Rload = 8 / 560 = 0.0142857142857 A.
		// Drop = Vopen - Vloaded = 1.00 V.
		// Rint = Drop / I = 1 / (8/560) = 560 / 8 = 70 ohm exactly.
		const measured = profileFromMeasurement({
			openCircuitVolts: 9,
			loadedVolts: 8,
			loadOhms: 560,
		});
		expect(measured.id).toBe("measured");
		expect(measured.openCircuitVolts).toBe(9);
		expect(measured.internalResistanceOhms).toBeCloseTo(70, 12);
		expect(isSourced(measured)).toBe(true);

		// A second hand computation matching the fresh-alkaline scale: open
		// 9.40 V, loaded 9.22 V across 560 ohm gives
		// I = 9.22/560 = 0.0164642857143 A, drop 0.18 V,
		// R = 0.18 / 0.0164642857143 = 10.932... ohm.
		// 0.18 * 560 / 9.22 = 100.8 / 9.22 = 10.932...; check finite only.
		const second = profileFromMeasurement({
			openCircuitVolts: 9.4,
			loadedVolts: 9.22,
			loadOhms: 560,
		});
		expect(second.internalResistanceOhms).toBeCloseTo(
			(9.4 - 9.22) / (9.22 / 560),
			12,
		);

		expect(() =>
			profileFromMeasurement({ openCircuitVolts: 8, loadedVolts: 9, loadOhms: 560 }),
		).toThrow();
		expect(() =>
			profileFromMeasurement({ openCircuitVolts: 9, loadedVolts: 0, loadOhms: 560 }),
		).toThrow();
		expect(() =>
			profileFromMeasurement({ openCircuitVolts: 9, loadedVolts: 8, loadOhms: 0 }),
		).toThrow();
		expect(() =>
			profileFromMeasurement({ openCircuitVolts: NaN, loadedVolts: 8, loadOhms: 560 }),
		).toThrow();
		expect(() =>
			profileFromMeasurement({ openCircuitVolts: 9, loadedVolts: Infinity, loadOhms: 560 }),
		).toThrow();

		// customSupplyProfile validation.
		const custom = customSupplyProfile({
			openCircuitVolts: 7.5,
			internalResistanceOhms: 10,
			name: "Bench cell",
		});
		expect(custom.id).toBe("custom");
		expect(custom.openCircuitVolts).toBe(7.5);
		expect(custom.internalResistanceOhms).toBe(10);
		expect(isSourced(custom)).toBe(true);
		expect(() =>
			customSupplyProfile({ openCircuitVolts: 9, internalResistanceOhms: -1 }),
		).toThrow();
		expect(() =>
			customSupplyProfile({ openCircuitVolts: NaN, internalResistanceOhms: 1 }),
		).toThrow();
	});

	// c. Resistive Thevenin exactness through RuntimeNode.
	test("c: depleted moves the rail to E*R/(R+r); ideal restores E", () => {
		const source = resistiveRailYaml();
		const program = compileOk(source);
		const depleted = SUPPLY_PROFILES.find(
			(profile) => profile.id === "alkaline-depleted-specimen",
		) as SupplyProfile;
		const ideal = SUPPLY_PROFILES.find(
			(profile) => profile.id === "ideal",
		) as SupplyProfile;

		const node = new RuntimeNode("supply-c", "Supply C", program, { source });
		expect(node.getSupplyResolution()).toBeNull();
		expect(node.getSupplyProfile()).toBeNull();
		node.prepare(RATE);

		node.setSupplyProfile(depleted);
		node.process(new Float64Array(64));
		// Hand computation: E = 7.73 V, Rint = 195.00 ohm, Rload = 9000 ohm.
		// Rail = E * Rload / (Rload + Rint) = 7.73 * 9000 / 9195.
		// 7.73 * 9000 = 69570; 9000 + 195 = 9195;
		// 69570 / 9195 = 7.566068515... V.
		// Measured solver error is about 1.4e-9 V from the 1e-12 S GMIN
		// conductance to ground, so the assertion uses 5e-9, not 1e-9.
		const expectedDepleted = (7.73 * 9000) / 9195;
		expect(Math.abs(railNodeVolts(node, 3) - expectedDepleted)).toBeLessThan(5e-9);
		expect(liveSupplies(node)[0]?.volts).toBe(7.73);
		expect(liveSupplies(node)[0]?.sourceOhms).toBe(195);
		expect(node.getSupplyProfile()?.id).toBe("alkaline-depleted-specimen");
		expect(node.getSupplyResolution()?.supplies).toHaveLength(1);

		node.setSupplyProfile(ideal);
		node.process(new Float64Array(64));
		// Hand computation: ideal keeps the compiled 9 V magnitude with 0 ohm,
		// so rail = 9 * 9000 / 9000 = 9.0 exactly.
		expect(Math.abs(railNodeVolts(node, 3) - 9)).toBeLessThan(1e-9);
		expect(liveSupplies(node)[0]?.volts).toBe(9);
		expect(liveSupplies(node)[0]?.sourceOhms).toBe(0);
	});

	// d. Sign: positive-ground keeps the negative rail.
	test("d: positive-ground null keeps -9 V; 7.73 V gives -7.73 V", () => {
		const source = positiveGroundYaml();
		const program = compileOk(source);
		const ideal = SUPPLY_PROFILES.find(
			(profile) => profile.id === "ideal",
		) as SupplyProfile;

		const node = new RuntimeNode("supply-d", "Supply D", program, { source });
		node.prepare(RATE);

		// Null volts keeps the compiled magnitude; the stamp keeps its own
		// positive EMF sign (V0 - V3 = 9) while the rail node stays negative.
		// With 0 ohm the loaded rail equals the open rail: -9 V exactly.
		node.setSupplyProfile(ideal);
		node.process(new Float64Array(64));
		expect(liveSupplies(node)[0]?.volts).toBe(9);
		expect(Math.abs(railNodeVolts(node, 3) + 9)).toBeLessThan(1e-9);

		// An explicit 7.73 V magnitude with 0 ohm gives stamp +7.73 V and rail
		// -7.73 V exactly. A 0 ohm custom profile is used so the loaded rail
		// equals the open rail; the depleted built-in (195 ohm) would sag to
		// -7.566... V under its 9k load.
		const explicit = customSupplyProfile({
			openCircuitVolts: 7.73,
			internalResistanceOhms: 0,
			name: "Sign probe",
		});
		node.setSupplyProfile(explicit);
		node.process(new Float64Array(64));
		expect(liveSupplies(node)[0]?.volts).toBe(7.73);
		expect(Math.abs(railNodeVolts(node, 3) + 7.73)).toBeLessThan(1e-9);
	});

	// e. Refusal is loud; the good fixture does not throw.
	test("e: missing source, mains, and powerless programs throw with reason codes", () => {
		const goodSource = resistiveRailYaml();
		const goodProgram = compileOk(goodSource);
		const depleted = SUPPLY_PROFILES.find(
			(profile) => profile.id === "alkaline-depleted-specimen",
		) as SupplyProfile;

		// No source given: loud, naming the missing source.
		const noSource = new RuntimeNode("supply-e1", "Supply E1", goodProgram);
		expect(() => noSource.setSupplyProfile(depleted)).toThrow(/no source/i);

		// Mains-fed: the AC inlet evidence refuses as mains-ac-source.
		const mainsSource = acMainsYaml();
		const mainsProgram = compileOk(mainsSource);
		const mainsNode = new RuntimeNode("supply-e2", "Supply E2", mainsProgram, {
			source: mainsSource,
		});
		mainsNode.prepare(RATE);
		expect(() => mainsNode.setSupplyProfile(depleted)).toThrow(/mains-ac-source/);

		// No power section: refuses as no-power-section.
		const bareSource = resistiveRailYaml(false);
		const bareProgram = compileOk(bareSource);
		const bareNode = new RuntimeNode("supply-e3", "Supply E3", bareProgram, {
			source: bareSource,
		});
		bareNode.prepare(RATE);
		expect(() => bareNode.setSupplyProfile(depleted)).toThrow(/no-power-section/);

		// Negative control: the same good shape with its source applies.
		const goodNode = new RuntimeNode("supply-e4", "Supply E4", goodProgram, {
			source: goodSource,
		});
		goodNode.prepare(RATE);
		expect(() => goodNode.setSupplyProfile(depleted)).not.toThrow();
		expect(goodNode.getSupplyResolution()?.supplies).toHaveLength(1);
	});

	// f. A derived rail is untouched.
	test("f: charge-pump derived rails keep compiled volts and ohms", () => {
		const source = chargePumpYaml();
		const program = compileOk(source);
		const depleted = SUPPLY_PROFILES.find(
			(profile) => profile.id === "alkaline-depleted-specimen",
		) as SupplyProfile;

		const node = new RuntimeNode("supply-f", "Supply F", program, { source });
		node.prepare(RATE);
		node.setSupplyProfile(depleted);

		const runtime = (node as unknown as { runtime: ReferenceRuntime }).runtime;
		const infos = runtime.getSupplies();
		expect(infos).toHaveLength(3);
		const byVolts = new Map(infos.map((info) => [info.volts, info]));
		// The external 9 V rail moves to 7.73 V / 195 ohm.
		expect(byVolts.get(7.73)?.sourceOhms).toBe(195);
		// The derived rails keep their compiled values: +18 V and -9 V at the
		// compiled 1 ohm default.
		expect(byVolts.get(18)?.sourceOhms).toBe(1);
		expect(byVolts.get(-9)?.sourceOhms).toBe(1);

		const resolution = node.getSupplyResolution();
		expect(resolution?.supplies).toHaveLength(1);
		expect(resolution?.supplies[0]?.railComponentId).toBe("RAIL_MAIN");
		const reasons = (resolution?.refused ?? []).map((entry) => entry.reason);
		expect(reasons).toContain("derived-rail");
	});

	// g. Mid-stream apply and prepare persistence.
	test("g: profile applies between process calls and survives prepare", () => {
		const source = resistiveRailYaml();
		const program = compileOk(source);
		const depleted = SUPPLY_PROFILES.find(
			(profile) => profile.id === "alkaline-depleted-specimen",
		) as SupplyProfile;
		const ideal = SUPPLY_PROFILES.find(
			(profile) => profile.id === "ideal",
		) as SupplyProfile;

		const node = new RuntimeNode("supply-g", "Supply G", program, { source });
		node.prepare(RATE);
		node.process(new Float64Array(64));
		// Hand computation anchor: as-compiled 1 ohm gives 9*9000/9001 =
		// 8.999000111... V.
		expect(Math.abs(railNodeVolts(node, 3) - (9 * 9000) / 9001)).toBeLessThan(5e-9);

		node.setSupplyProfile(depleted);
		node.process(new Float64Array(64));
		// Hand computation: 7.73*9000/9195 = 7.566068515... V (5e-9 for GMIN).
		expect(Math.abs(railNodeVolts(node, 3) - (7.73 * 9000) / 9195)).toBeLessThan(5e-9);

		node.prepare(RATE);
		node.process(new Float64Array(64));
		expect(Math.abs(railNodeVolts(node, 3) - (7.73 * 9000) / 9195)).toBeLessThan(5e-9);
		expect(node.getSupplyProfile()?.id).toBe("alkaline-depleted-specimen");

		node.reset();
		node.process(new Float64Array(64));
		expect(Math.abs(railNodeVolts(node, 3) - (7.73 * 9000) / 9195)).toBeLessThan(5e-9);

		// Callable before prepare as well: a fresh node applies, then prepare
		// keeps it.
		const early = new RuntimeNode("supply-g2", "Supply G2", program, { source });
		early.setSupplyProfile(ideal);
		early.prepare(RATE);
		early.process(new Float64Array(64));
		expect(Math.abs(railNodeVolts(early, 3) - 9)).toBeLessThan(1e-9);
	});

	// h. Preset round trip through SignalChain.
	test("h: getPreset and loadPreset restore the supply pair", () => {
		const source = resistiveRailYaml();
		const depleted = SUPPLY_PROFILES.find(
			(profile) => profile.id === "alkaline-depleted-specimen",
		) as SupplyProfile;

		const chain = new SignalChain({ sampleRate: RATE });
		const program = compileOk(source);
		const node = new RuntimeNode("supply-h", "Supply H", program, { source });
		chain.addNode(node);
		node.setSupplyProfile(depleted);

		const preset = chain.getPreset("Supply Rig");
		const snapshot = preset.nodes.find((entry) => entry.id === "supply-h");
		expect(snapshot).toBeDefined();
		// Hand computation: the resolved pair is the depleted numbers.
		expect(snapshot?.params["supplyOpenCircuitVolts"]).toBe(7.73);
		expect(snapshot?.params["supplyInternalResistanceOhms"]).toBe(195);

		const restored = new SignalChain({ sampleRate: RATE });
		restored.loadPreset(preset, (snap) => {
			if (snap.kind === "circuit-runtime") {
				const fresh = compileOk(source);
				return new RuntimeNode(snap.id, snap.name, fresh, { source });
			}
			return undefined;
		});
		const restoredNode = restored.getNode("supply-h") as RuntimeNode | undefined;
		expect(restoredNode).toBeDefined();
		// The pair re-applies as a custom profile with the same numbers.
		expect(restoredNode?.getParam("supplyOpenCircuitVolts")).toBe(7.73);
		expect(restoredNode?.getParam("supplyInternalResistanceOhms")).toBe(195);
		expect(restoredNode?.getSupplyProfile()?.internalResistanceOhms).toBe(195);
		restored.prepare(RATE);
		restored.process(new Float64Array(64));
		expect(
			Math.abs(railNodeVolts(restoredNode as RuntimeNode, 3) - (7.73 * 9000) / 9195),
		).toBeLessThan(5e-9);
	});

	// i. Real-physics audio: a biased BJT stage responds to the supply.
	test("i: loud output rms moves with the supply; quiet moves by its DC mean", () => {
		// Fixture: DC-coupled biased common-emitter stage (JOUT on the
		// collector, no output cap) so the collector bias is the output mean.
		// Measured under Bun with 4800-sample 1 kHz sines, two settled blocks,
		// second block measured:
		// ideal: loud mean 6.582736584018359, loud AC 0.9360216671709127,
		//   loud RMS 6.648951608786643; quiet mean 6.588194900061971,
		//   quiet AC 0.015661615360946554, quiet RMS 6.588213515620149.
		// depleted (7.73 V, 195 ohm): loud mean 5.817159128043847,
		//   loud AC 0.954798272841811, loud RMS 5.8949961885318425;
		//   quiet mean 5.827332449276626, quiet AC 0.01606359527244156,
		//   quiet RMS 5.827354589647466.
		// What this says: the loud RMS moves by about 0.75 V (mostly the
		// 0.77 V DC bias shift plus an 18 mV AC gain move); the quiet RMS
		// moves by 0.7609 V while its mean moves by 0.7609 V and its AC
		// moves by only 0.00040 V, so the quiet change is the DC shift. No
		// sign is asserted beyond the absolute differences below.
		const source = bjtDcYaml();
		const program = compileOk(source);
		const ideal = SUPPLY_PROFILES.find(
			(profile) => profile.id === "ideal",
		) as SupplyProfile;
		const depleted = SUPPLY_PROFILES.find(
			(profile) => profile.id === "alkaline-depleted-specimen",
		) as SupplyProfile;

		const loud = sine(4800, 0.3);
		const quiet = sine(4800, 0.005);

		function settledOutput(profile: SupplyProfile, input: Float64Array): Float64Array {
			const stage = new RuntimeNode("supply-i", "Supply I", program, { source });
			stage.prepare(RATE);
			stage.setSupplyProfile(profile);
			stage.process(input);
			return stage.process(input);
		}

		const loudIdeal = settledOutput(ideal, loud);
		const loudDepleted = settledOutput(depleted, loud);
		const quietIdeal = settledOutput(ideal, quiet);
		const quietDepleted = settledOutput(depleted, quiet);

		const loudIdealStats = acStats(loudIdeal);
		const loudDepletedStats = acStats(loudDepleted);
		const quietIdealStats = acStats(quietIdeal);
		const quietDepletedStats = acStats(quietDepleted);

		// Loud moves well beyond solver noise (about 0.75 V total RMS here).
		expect(Math.abs(rms(loudIdeal) - rms(loudDepleted))).toBeGreaterThan(0.1);
		// Quiet total RMS moves (about 0.76 V), its mean moves by the same
		// amount (about 0.76 V), and its AC moves by only 0.00040 V.
		expect(Math.abs(rms(quietIdeal) - rms(quietDepleted))).toBeGreaterThan(0.5);
		expect(
			Math.abs(quietIdealStats.mean - quietDepletedStats.mean),
		).toBeGreaterThan(0.5);
		expect(
			Math.abs(quietIdealStats.acRms - quietDepletedStats.acRms),
		).toBeLessThan(0.002);
		expect(Math.abs(loudIdealStats.acRms - loudDepletedStats.acRms)).toBeGreaterThan(
			0.005,
		);
	});
});
