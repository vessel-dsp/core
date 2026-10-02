// Document-to-supply-stamp map: resolveSupplyStamps over typed power evidence.
//
// Fixture basis (tests/fixtures/interchange/): the power-section SHAPES come
// from voltage-divider-power-topology.vdsp (external-dc domain, direct
// main-supply rail + divider bias rail) and
// charge-pump-derived-rails-valid.vdsp (doubler/inverter derived rails with
// converterComponentId references). Neither raw fixture compiles
// ("document declares no connected jack"), so the tests build compilable
// DECLARED-NODE derivatives in the style of big-muff-pi.vdsp: terminals carry
// `node:` keys, there are no wires, the main rail is a component of kind
// `rail` with a typed Voltage, and (unless the test says otherwise) the power
// section declares NO sourceKind, exercising inference from the source
// components' lowered device kinds.
//
// The map takes the source text and the program: declared connectivity is
// only visible in the source (CircuitDocument drops it), and the join runs
// through the compiler's own netlist, so declared ids are the ids both sides
// share. Hand-derived node maps precede each document.

import { describe, expect, test } from "bun:test";
import {
	compile,
	emptyRegistry,
	readNetlist,
	resolveSupplyStamps,
} from "../../packages/compiler/src/index.ts";
import type { Program } from "../../packages/compiler/src/index.ts";
import type {
	RefusedSupply,
	ResolvedSupply,
	SupplyResolution,
} from "../../packages/compiler/src/index.ts";

// --- YAML builders (block style only: the interchange subset parser takes no flow mappings) ---

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
  description: "supply-stamp map test document."
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

// Every document under test carries this audio path: nodes 1 (in), 2 (out),
// 0 (ground).
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

// --- hand-derived topology, big-muff-style document ---
//
// Declared nodes: 0 = ground (GND1, RLOAD.b), 1 = in, 2 = out,
// 3 = VPLUS_RAIL.terminal + RLOAD.a, 98 = RAIL_OPEN.terminal (a rail with no
// Voltage: open law, device but no stamp), 99 = RAIL_AUX.t (port).
// Power: NO sourceKind (inference from VPLUS_RAIL's lowered rail-with-volts
// kind must yield external-dc), no ratedVoltage (nominalVolts must be null).
// Expected: VPLUS_RAIL -> the one 9 V stamp; RAIL_AUX -> rail-not-main-supply;
// RAIL_OPEN -> no-stamp-for-rail.
function muffPower(sourceKind?: string): string {
	const kindLine =
		sourceKind === undefined ? "" : `      sourceKind: ${sourceKind}\n`;
	return `power:
  schema: circuit-power/v1
  coverage: declared-rails
  domains:
    - id: main
      sourceComponentIds:
        - VPLUS_RAIL
      groundPolarity: negative-ground
${kindLine}      rails:
        - railComponentId: VPLUS_RAIL
          role: main-supply
          derivation: direct
        - railComponentId: RAIL_AUX
          role: bias-reference
          derivation: direct
        - railComponentId: RAIL_OPEN
          role: main-supply
          derivation: direct
`;
}

function muffYaml(options?: { readonly power?: boolean; readonly sourceKind?: string }): string {
	const withPower = options?.power ?? true;
	return (
		docHead("muff supply map", "muff_supply.vdsp") +
		signalComponents() +
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
				{ name: "b", node: 0, x: 0, y: -90 },
			],
			props('Resistance: "9k"'),
			"Circuit.Resistor",
		) +
		componentBlock(
			"RAIL_AUX",
			"port",
			140,
			100,
			[{ name: "t", node: 99, x: 140, y: 100 }],
			NO_PROPS,
		) +
		componentBlock(
			"RAIL_OPEN",
			"rail",
			120,
			100,
			[{ name: "terminal", node: 98, x: 120, y: 100, role: "positive" }],
			NO_PROPS,
			"Circuit.Rail",
		) +
		docFoot(withPower ? muffPower(options?.sourceKind) : "")
	);
}

// --- hand-derived topology, klon-like charge-pump document ---
//
// Declared nodes: 0, 1, 2 as above; 3 = BATT1.positive + RAIL_MAIN.terminal
// (both declare 9 V, so lowering collapses the twin to ONE dc-source stamp);
// 4 = RAIL_PLUS2.t + RHI.a (18 V stamp); 5 = RAIL_MINUS.t + RLO.a (-9 V).
// Power: NO sourceKind; sources [BATT1] (battery -> voltage-source law -> dc
// evidence -> external-dc). The derived rails keep converterComponentId
// references to a component that does not exist; the map ignores them.
// Expected: RAIL_MAIN -> the 9 V stamp (nominal 9 from the rail); PLUS2/MINUS
// -> derived-rail; the program keeps all three stamps (9, 18, -9) untouched.
function chargePumpYaml(): string {
	return (
		docHead("charge pump supply map", "charge_pump_supply.vdsp") +
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

// --- hand-derived topology, positive-ground fuzz document ---
//
// Germanium PNP style: the battery's POSITIVE terminal is grounded (node 0)
// and the rail runs at -9 V off the NEGATIVE terminal (node 3). The rail
// component declares -9 V on the same node, so lowering collapses it with the
// battery to one stamp (positive->0 negative->3 volts 9).
// Power: positive-ground, NO sourceKind, sources [BATT1].
// Expected: RAIL_NEG -> that stamp via the NEGATIVE terminal, nominalVolts -9.
function positiveGroundYaml(): string {
	return (
		docHead("positive ground supply map", "positive_ground_supply.vdsp") +
		signalComponents() +
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
				{ name: "b", node: 0, x: 0, y: -90 },
			],
			props('Resistance: "9k"'),
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

// --- battery-as-rail document: the rail IS the battery (node 3, 9 V).
// Sources [BATT1], no sourceKind -> dc evidence -> resolves to the battery.
function batteryRailYaml(): string {
	return (
		docHead("battery rail map", "battery_rail.vdsp") +
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
			"RLOAD",
			"resistor",
			0,
			0,
			[
				{ name: "a", node: 3, x: 0, y: 90 },
				{ name: "b", node: 0, x: 0, y: -90 },
			],
			props('Resistance: "9k"'),
			"Circuit.Resistor",
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

// --- unknown-source document: muff shape, but the domain's only source is L1,
// a `label` the compiler drops (no lowered device). No evidence either way ->
// every rail refused unknown-source-kind before any join is attempted.
function unknownSourceYaml(): string {
	return (
		muffYaml()
			.replace(
				"      sourceComponentIds:\n        - VPLUS_RAIL",
				"      sourceComponentIds:\n        - L1",
			)
			.replace(
				"  - id: RAIL_OPEN",
				`  - id: L1
    kind: label
    name: L1
    origin:
      x: 200
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: t
        node: 98
        position:
          x: 200
          y: 100
    properties: {}
  - id: RAIL_OPEN`,
			)
	);
}

// --- transformer mains document: T1 primary 30/0, secondary 31/0 with load;
// RAIL_SEC is a port on node 31. Sources [T1], no sourceKind -> mains
// inference -> the rail refused as mains-ac-source.
function transformerYaml(): string {
	return (
		docHead("transformer mains map", "transformer_mains.vdsp") +
		signalComponents() +
		componentBlock(
			"T1",
			"transformer",
			0,
			50,
			[
				{ name: "pri_a", node: 30, x: -20, y: 50, role: "winding" },
				{ name: "pri_b", node: 0, x: -20, y: 70, role: "winding" },
				{ name: "sec_a", node: 31, x: 20, y: 50, role: "winding" },
				{ name: "sec_b", node: 0, x: 20, y: 70, role: "winding" },
			],
			props('Ratio:\n  raw: "10:1"\n  value: 10\n  unit: ""'),
			"Circuit.Transformer",
			`    windings:
      - id: pri
        role: primary
        terminals:
          - pri_a
          - pri_b
      - id: sec
        role: secondary
        terminals:
          - sec_a
          - sec_b
`,
		) +
		componentBlock(
			"RAIL_SEC",
			"port",
			40,
			50,
			[{ name: "t", node: 31, x: 40, y: 50 }],
			NO_PROPS,
		) +
		componentBlock(
			"RLOAD",
			"resistor",
			60,
			0,
			[
				{ name: "a", node: 31, x: 60, y: 40 },
				{ name: "b", node: 0, x: 60, y: -90 },
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
        - T1
      groundPolarity: negative-ground
      rails:
        - railComponentId: RAIL_SEC
          role: main-supply
          derivation: direct
`)
	);
}

// --- AC mains-inlet document: MAINS1 is a voltage-source WITH a typed
// Frequency, so it lowers to an ac-source stamp. Sources [MAINS1] (+ optional
// explicit sourceKind for the agreement/contradiction tests).
function acMainsYaml(withSourceKind?: string): string {
	const kindLine =
		withSourceKind === undefined ? "" : `      sourceKind: ${withSourceKind}\n`;
	return (
		docHead("ac mains map", "ac_mains.vdsp") +
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
${kindLine}      rails:
        - railComponentId: RAIL_SEC
          role: main-supply
          derivation: direct
`)
	);
}

function compileOk(source: string): Program {
	const result = compile(source, { registry: emptyRegistry });
	expect(result.status).toBe("ok");
	if (result.status !== "ok") {
		throw new Error("compile refused the test document");
	}
	return result.program;
}

function stampAt(
	program: Program,
	blockIndex: number,
	sourceIndex: number,
): { readonly volts: number } {
	const block = program.blocks[blockIndex];
	expect(block).toBeDefined();
	if (block?.kind !== "mna") {
		throw new Error("expected an mna block");
	}
	const stamp = block.stamps.find(
		(candidate) =>
			candidate.kind === "dc-source" && candidate.sourceIndex === sourceIndex,
	);
	expect(stamp).toBeDefined();
	if (stamp?.kind !== "dc-source") {
		throw new Error("expected a dc-source stamp");
	}
	return { volts: stamp.volts };
}

function dcVolts(program: Program): readonly number[] {
	return program.blocks.flatMap((block) =>
		block.kind === "mna"
			? block.stamps.flatMap((stamp) =>
					stamp.kind === "dc-source" ? [stamp.volts] : [],
				)
			: [],
	);
}

function printResolution(label: string, resolution: SupplyResolution): void {
	console.log(
		`${label} supplies=${JSON.stringify(resolution.supplies)} refused=${JSON.stringify(resolution.refused)}`,
	);
}

function deepFreeze(value: unknown): void {
	if (value === null || typeof value !== "object") {
		return;
	}
	if (Object.isFrozen(value)) {
		return;
	}
	Object.freeze(value);
	for (const child of Object.values(value)) {
		deepFreeze(child);
	}
}

describe("resolveSupplyStamps", () => {
	test("a: declared-node rail with no sourceKind resolves to exactly one stamp", () => {
		const source = muffYaml();
		const program = compileOk(source);
		const before = JSON.stringify(program);
		const resolution = resolveSupplyStamps(source, program);
		printResolution("declared-rail", resolution);

		expect(resolution.supplies).toHaveLength(1);
		const supply = resolution.supplies[0] as ResolvedSupply;
		expect(supply.railComponentId).toBe("VPLUS_RAIL");
		expect(supply.role).toBe("main-supply");
		// No nominalVoltage on the rail and no ratedVoltage on the domain.
		expect(supply.nominalVolts).toBeNull();
		expect(
			stampAt(program, supply.address.blockIndex, supply.address.sourceIndex)
				.volts,
		).toBe(9);
		const byRail = new Map(
			resolution.refused.map((entry) => [entry.railComponentId, entry.reason]),
		);
		expect(byRail.get("RAIL_AUX")).toBe("rail-not-main-supply");
		// A rail with no Voltage lowers to no stamp: the device exists, the
		// stamp does not.
		expect(byRail.get("RAIL_OPEN")).toBe("no-stamp-for-rail");
		expect(resolution.refused).toHaveLength(2);
		expect(JSON.stringify(program)).toBe(before);
	});

	test("a: klon-like domain maps +9 only; +18/-9 refuse and persist", () => {
		const source = chargePumpYaml();
		const program = compileOk(source);
		const before = JSON.stringify(program);
		const resolution = resolveSupplyStamps(source, program);
		printResolution("charge-pump", resolution);

		expect(resolution.supplies).toHaveLength(1);
		const supply = resolution.supplies[0] as ResolvedSupply;
		expect(supply.railComponentId).toBe("RAIL_MAIN");
		expect(supply.nominalVolts).toBe(9);
		expect(
			stampAt(program, supply.address.blockIndex, supply.address.sourceIndex)
				.volts,
		).toBe(9);
		const byRail = new Map(
			resolution.refused.map((entry) => [entry.railComponentId, entry.reason]),
		);
		expect(byRail.get("RAIL_PLUS2")).toBe("derived-rail");
		expect(byRail.get("RAIL_MINUS")).toBe("derived-rail");
		expect(resolution.refused).toHaveLength(2);
		// Three dc-sources (9, 18, -9): one cell that must not be triple-counted.
		// The battery and the 9 V rail declare the same assertion, so lowering
		// collapses the twin to a single 9 V stamp.
		expect([...dcVolts(program)].sort((a, b) => a - b)).toEqual([-9, 9, 18]);
		expect(JSON.stringify(program)).toBe(before);
	});

	test("a: port rail has no lowered device and maps to no stamp", () => {
		// RAIL_PORT sits on node 3 beside the battery stamp, but a port asserts
		// nothing: refusing is honest, guessing the battery would be a name read.
		const source = muffYaml().replace(
			"        - railComponentId: RAIL_OPEN",
			"        - railComponentId: RAIL_PORT\n          role: main-supply\n          derivation: direct\n        - railComponentId: RAIL_OPEN",
		);
		const withPort = source.replace(
			"  - id: RAIL_OPEN",
			`  - id: RAIL_PORT
    kind: port
    name: RAIL_PORT
    origin:
      x: 0
      y: 120
    rotation: 0
    flipped: false
    terminals:
      - name: t
        node: 3
        position:
          x: 0
          y: 120
    properties: {}
  - id: RAIL_OPEN`,
		);
		const program = compileOk(withPort);
		const resolution = resolveSupplyStamps(withPort, program);
		printResolution("port-rail", resolution);
		expect(resolution.supplies).toHaveLength(1);
		expect(
			(resolution.supplies[0] as ResolvedSupply).railComponentId,
		).toBe("VPLUS_RAIL");
		expect(
			resolution.refused.find(
				(entry) => entry.railComponentId === "RAIL_PORT",
			)?.reason,
		).toBe("no-stamp-for-rail");
	});

	test("b: battery-kind source resolves; transformer, ac inlet, unknown refuse", () => {
		// The rail IS the battery: sources [BATT1], no sourceKind.
		const batteryProgram = compileOk(batteryRailYaml());
		const batteryResolution = resolveSupplyStamps(
			batteryRailYaml(),
			batteryProgram,
		);
		printResolution("battery-rail", batteryResolution);
		expect(batteryResolution.supplies).toHaveLength(1);
		expect(
			(batteryResolution.supplies[0] as ResolvedSupply).railComponentId,
		).toBe("BATT1");
		expect(
			stampAt(
				batteryProgram,
				(batteryResolution.supplies[0] as ResolvedSupply).address.blockIndex,
				(batteryResolution.supplies[0] as ResolvedSupply).address.sourceIndex,
			).volts,
		).toBe(9);
		expect(batteryResolution.refused).toEqual([]);

		// Transformer source: mains evidence, no sourceKind.
		const transformerProgram = compileOk(transformerYaml());
		const transformerResolution = resolveSupplyStamps(
			transformerYaml(),
			transformerProgram,
		);
		printResolution("transformer", transformerResolution);
		expect(transformerResolution.supplies).toEqual([]);
		expect(transformerResolution.refused).toHaveLength(1);
		expect(
			(transformerResolution.refused[0] as RefusedSupply).railComponentId,
		).toBe("RAIL_SEC");
		expect((transformerResolution.refused[0] as RefusedSupply).reason).toBe(
			"mains-ac-source",
		);

		// AC inlet (typed Frequency -> ac-source law): mains evidence.
		const acProgram = compileOk(acMainsYaml());
		const acResolution = resolveSupplyStamps(acMainsYaml(), acProgram);
		printResolution("ac-inlet", acResolution);
		expect(acResolution.supplies).toEqual([]);
		expect(acResolution.refused).toHaveLength(1);
		expect((acResolution.refused[0] as RefusedSupply).reason).toBe(
			"mains-ac-source",
		);

		// Unrecognized source (a label: no lowered device): unknown-source-kind,
		// decided before any join is attempted.
		const unknownProgram = compileOk(unknownSourceYaml());
		const unknownResolution = resolveSupplyStamps(
			unknownSourceYaml(),
			unknownProgram,
		);
		printResolution("unknown-source", unknownResolution);
		expect(unknownResolution.supplies).toEqual([]);
		expect(unknownResolution.refused).toHaveLength(3);
		for (const entry of unknownResolution.refused) {
			expect(entry.reason).toBe("unknown-source-kind");
		}
	});

	test("c: explicit sourceKind contradicting the lowered kind is its own refusal", () => {
		// AC inlet declared external-dc: the stamp says mains.
		const acProgram = compileOk(acMainsYaml("external-dc"));
		const acResolution = resolveSupplyStamps(
			acMainsYaml("external-dc"),
			acProgram,
		);
		printResolution("conflict-ac", acResolution);
		expect(acResolution.supplies).toEqual([]);
		expect(acResolution.refused).toHaveLength(1);
		expect((acResolution.refused[0] as RefusedSupply).reason).toBe(
			"source-kind-conflict",
		);

		// Battery declared mains-ac: the stamp says DC.
		const dcProgram = compileOk(muffYaml({ sourceKind: "mains-ac" }));
		const dcResolution = resolveSupplyStamps(
			muffYaml({ sourceKind: "mains-ac" }),
			dcProgram,
		);
		printResolution("conflict-dc", dcResolution);
		expect(dcResolution.supplies).toEqual([]);
		expect(dcResolution.refused).toHaveLength(3);
		for (const entry of dcResolution.refused) {
			expect(entry.reason).toBe("source-kind-conflict");
		}

		// Agreement is not a conflict: explicit mains-ac on an AC inlet.
		const agreeProgram = compileOk(acMainsYaml("mains-ac"));
		const agreeResolution = resolveSupplyStamps(
			acMainsYaml("mains-ac"),
			agreeProgram,
		);
		expect(agreeResolution.supplies).toEqual([]);
		expect((agreeResolution.refused[0] as RefusedSupply).reason).toBe(
			"mains-ac-source",
		);
	});

	test("d: renaming supply components changes nothing; a dangling rail refuses", () => {
		const source = muffYaml();
		const program = compileOk(source);
		const expected = resolveSupplyStamps(source, program);

		// Rename VPLUS_RAIL -> EXT9 everywhere the typed linkage points at it,
		// and plant a decoy: a port carrying the old name and battery prose
		// but no typed linkage. The map follows linkage only.
		const renamed = source
			.replaceAll("VPLUS_RAIL", "EXT9")
			.replace(
				"  - id: RAIL_AUX",
				`  - id: DECOY_RAIL
    kind: port
    name: VPLUS_RAIL
    origin:
      x: 200
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: t
        node: 98
        position:
          x: 200
          y: 100
    properties:
      Description: "9V battery supply, main source"
  - id: RAIL_AUX`,
			);
		const renamedProgram = compileOk(renamed);
		const actual = resolveSupplyStamps(renamed, renamedProgram);
		printResolution("renamed", actual);
		// The decoy shares node 98 with RAIL_OPEN's terminal: a port asserts
		// nothing either way, and the renamed rail still resolves.
		expect(
			(actual.supplies[0] as ResolvedSupply).railComponentId,
		).toBe("EXT9");
		expect(actual.supplies).toHaveLength(expected.supplies.length);
		expect(
			actual.refused.map((entry) => entry.reason).sort(),
		).toEqual(
			expected.refused.map((entry) => entry.reason).sort(),
		);
		expect(
			stampAt(
				renamedProgram,
				(actual.supplies[0] as ResolvedSupply).address.blockIndex,
				(actual.supplies[0] as ResolvedSupply).address.sourceIndex,
			).volts,
		).toBe(9);

		// Negative control: the power section points at a component id that
		// does not exist. That is a refusal, not an invitation to guess.
		const broken = source.replaceAll(
			"railComponentId: VPLUS_RAIL",
			"railComponentId: NO_SUCH_RAIL",
		);
		const brokenProgram = compileOk(broken);
		const brokenResolution = resolveSupplyStamps(broken, brokenProgram);
		printResolution("broken-rail", brokenResolution);
		expect(brokenResolution.supplies).toEqual([]);
		const missing = brokenResolution.refused.find(
			(entry) => entry.railComponentId === "NO_SUCH_RAIL",
		);
		expect(missing?.reason).toBe("no-stamp-for-rail");
	});

	test("d: name independence holds on a declared-node document", () => {
		// Battery and rail renamed together (linkage intact); the old names
		// vanish. Resolution must be unchanged apart from the rail id itself.
		const source = chargePumpYaml();
		const program = compileOk(source);
		const expected = resolveSupplyStamps(source, program);
		const renamed = source
			.replaceAll("BATT1", "CELL9")
			.replaceAll("RAIL_MAIN", "PRIMARY_RAIL");
		const renamedProgram = compileOk(renamed);
		const actual = resolveSupplyStamps(renamed, renamedProgram);
		printResolution("renamed-charge-pump", actual);
		expect(actual.supplies).toHaveLength(1);
		expect(
			(actual.supplies[0] as ResolvedSupply).railComponentId,
		).toBe("PRIMARY_RAIL");
		expect((actual.supplies[0] as ResolvedSupply).nominalVolts).toBe(
			(expected.supplies[0] as ResolvedSupply).nominalVolts,
		);
		expect(
			stampAt(
				renamedProgram,
				(actual.supplies[0] as ResolvedSupply).address.blockIndex,
				(actual.supplies[0] as ResolvedSupply).address.sourceIndex,
			).volts,
		).toBe(9);
		expect(
			actual.refused.map((entry) => entry.reason).sort(),
		).toEqual(
			expected.refused.map((entry) => entry.reason).sort(),
		);
	});

	test("f: the program is deep-frozen and unchanged after the call", () => {
		const source = chargePumpYaml();
		const program = compileOk(source);
		deepFreeze(program);
		const before = JSON.stringify(program);
		const resolution = resolveSupplyStamps(source, program);
		expect(JSON.stringify(program)).toBe(before);
		expect(resolution.supplies).toHaveLength(1);
	});

	test("g: positive-ground supply resolves through the negative terminal", () => {
		const source = positiveGroundYaml();
		const program = compileOk(source);
		const resolution = resolveSupplyStamps(source, program);
		printResolution("positive-ground", resolution);

		expect(resolution.supplies).toHaveLength(1);
		const supply = resolution.supplies[0] as ResolvedSupply;
		expect(supply.railComponentId).toBe("RAIL_NEG");
		// The rail's own nominal (-9 V); the stamp carries the 9 V magnitude.
		expect(supply.nominalVolts).toBe(-9);
		expect(
			stampAt(program, supply.address.blockIndex, supply.address.sourceIndex)
				.volts,
		).toBe(9);
		expect(resolution.refused).toEqual([]);

		// Independent oracle through the compiler netlist (not the map's loop):
		// the rail device's node is the stamp's NEGATIVE row, ground the other.
		const netlist = readNetlist(source);
		const device = netlist.devices.find((entry) => entry.id === "RAIL_NEG");
		expect(device).toBeDefined();
		const block = program.blocks[supply.address.blockIndex];
		if (block?.kind !== "mna") {
			throw new Error("expected an mna block");
		}
		const stamp = block.stamps.find(
			(candidate) =>
				candidate.kind === "dc-source" &&
				candidate.sourceIndex === supply.address.sourceIndex,
		);
		if (stamp?.kind !== "dc-source") {
			throw new Error("expected the resolved dc-source stamp");
		}
		expect(device?.nodes).toContain(block.nodeIds[stamp.negative]);
		expect(block.nodeIds[stamp.positive]).toBe(0);
	});

	test("no power section maps nothing", () => {
		const source = muffYaml({ power: false });
		const bare = compileOk(source);
		const bareResolution = resolveSupplyStamps(source, bare);
		printResolution("no-power", bareResolution);
		expect(bareResolution.supplies).toEqual([]);
		expect(bareResolution.refused).toHaveLength(1);
		expect(
			(bareResolution.refused[0] as RefusedSupply).railComponentId,
		).toBeNull();
		expect((bareResolution.refused[0] as RefusedSupply).reason).toBe(
			"no-power-section",
		);
	});
});
