// Document-to-supply-stamp map: resolveSupplyStamps over typed power evidence.
//
// Fixtures used (tests/fixtures/interchange/):
// - voltage-divider-power-topology.vdsp: the power-section SHAPE (external-dc
//   domain, direct main-supply rail + divider bias rail) is reused, but the raw
//   fixture does not compile (verified: compile() refuses it at the netlist
//   stage with "document declares no connected jack" -- it is a parser
//   fixture with no jacks, no wires, and a `V:` battery property the compiler
//   does not read). The tests below build compilable geometric derivatives:
//   same domain/rail declarations, plus jacks, a signal resistor, stub wires
//   so every non-ground terminal touches copper, and `Voltage: "9V"`.
// - charge-pump-derived-rails-valid.vdsp: same treatment; its power-converter
//   component is dropped (emptyRegistry has no model for it and the derived
//   rails are declared separately, exactly the klon view-only cluster the
//   compiler already documents), while its converterComponentId references are
//   kept so the map must ignore them without reading them.
// - voltage-divider.vdsp: not a power fixture; not used.
//
// All synthetic documents are PURELY GEOMETRIC (no `node:` keys, no `nodes:`
// ledger). CircuitDocument drops declared node info, so the map reads
// geometric connectivity; geometry the compiler and core agree on is the only
// topology both sides can share. Stub wires (12 units, perpendicular, clear of
// every foreign lead axis and T-junction) satisfy the compiler's every-
// terminal-touches-copper rule without merging nets.

import { describe, expect, test } from "bun:test";
import {
	compile,
	emptyRegistry,
	resolveSupplyStamps,
} from "../../packages/compiler/src/index.ts";
import type { Program } from "../../packages/compiler/src/index.ts";
import type {
	RefusedSupply,
	ResolvedSupply,
	SupplyResolution,
} from "../../packages/compiler/src/index.ts";
import {
	getPinNode,
	parseInterchangeYaml,
	resolveConnectivity,
} from "../../packages/core/src/index.ts";
import type { CircuitDocument } from "../../packages/core/src/index.ts";

// --- YAML builders (block style only: the interchange subset parser takes no flow mappings) ---

type TerminalSpec = {
	readonly name: string;
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
		out += `        position:\n          x: ${terminal.x}\n          y: ${terminal.y}\n`;
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

const stubWire = (
	id: string,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
): string =>
	`  - id: ${id}\n    points:\n      - x: ${x1}\n        y: ${y1}\n      - x: ${x2}\n        y: ${y2}\n`;

// Every document under test carries this audio path: input jack tip + one
// resistor end on (-200, 0), output jack tip + the other end on (200, 0).
function signalComponents(): string {
	return [
		componentBlock(
			"JIN",
			"jack",
			-200,
			0,
			[{ name: "tip", x: -200, y: 0 }],
			NO_PROPS,
			"Circuit.Input",
		),
		componentBlock(
			"JOUT",
			"jack",
			200,
			0,
			[{ name: "tip", x: 200, y: 0 }],
			NO_PROPS,
			"Circuit.Output",
		),
		componentBlock(
			"RSIG",
			"resistor",
			0,
			0,
			[
				{ name: "a", x: -200, y: 0 },
				{ name: "b", x: 200, y: 0 },
			],
			props('Resistance: "10k"'),
			"Circuit.Resistor",
		),
	].join("");
}

function signalWires(): string {
	return (
		stubWire("W_IN", -200, 0, -200, 12) + stubWire("W_OUT", 200, 0, 200, 12)
	);
}

function groundComponent(): string {
	return componentBlock(
		"GND1",
		"ground",
		0,
		-100,
		[{ name: "gnd", x: 0, y: -100 }],
		NO_PROPS,
		"Circuit.Ground",
	);
}

// Negative-ground 9 V battery. Terminals are listed negative-first on purpose:
// the typed roles (not order, not the names) decide which end is positive.
function batteryComponent(id: string, posX: number, posY: number): string {
	return componentBlock(
		id,
		"battery",
		0,
		0,
		[
			{ name: "negative", x: 0, y: -100, role: "negative" },
			{ name: "positive", x: posX, y: posY, role: "positive" },
		],
		props('Voltage: "9V"'),
		"Circuit.Battery",
	);
}

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

function docFoot(wires: string, power: string): string {
	return `wires:
${wires}directives: []
diagnostics: []
rawAttributes: {}
${power}`;
}

// --- hand-derived topology, divider document ---
//
// Nets (core insertion order: JIN, JOUT, GND1, BATT1, RAIL_MAIN, RAIL_BIAS,
// R1, R2, RSIG, RAIL_AUX; ground first):
//   0 = GND1.gnd, BATT1.negative, R2.b
//   1 = JIN.tip, RSIG.a
//   2 = JOUT.tip, RSIG.b
//   3 = BATT1.positive, RAIL_MAIN.t, R1.a
//   4 = RAIL_BIAS.t, R1.b, R2.a
//   5 = RAIL_AUX.t
// Compiled stamps (block analog:0 over [0,3,4]; signal block over [0,1,2]):
//   dc-source positive->3 negative->0 volts 9 (the battery; roles make the
//   listed-negative-first order irrelevant)
//   10k R1 across 3-4, 10k R2 across 4-0, 10k RSIG across 1-2.
// Expected map: RAIL_MAIN -> the one 9 V stamp (nominal falls back to the
// domain ratedVoltage 9, the rail declares no nominalVoltage); RAIL_BIAS ->
// derived-rail; RAIL_AUX (direct but bias-reference) -> rail-not-main-supply.
function dividerYaml(powerSourceKind: string | null): string {
	const power =
		powerSourceKind === null
			? ""
			: `power:
  schema: circuit-power/v1
  coverage: explicit-topology
  domains:
    - id: main
      sourceComponentIds:
        - BATT1
      ratedVoltage:
        raw: "9V"
        value: 9
        unit: V
      groundPolarity: negative-ground
      sourceKind: ${powerSourceKind}
      rails:
        - railComponentId: RAIL_MAIN
          role: main-supply
          derivation: direct
        - railComponentId: RAIL_BIAS
          role: bias-reference
          derivation: divider
          parentRailComponentId: RAIL_MAIN
          nominalVoltage:
            raw: "4.5V"
            value: 4.5
            unit: V
        - railComponentId: RAIL_AUX
          role: bias-reference
          derivation: direct
`;
	return (
		docHead("divider supply map", "divider_supply.vdsp") +
		signalComponents() +
		groundComponent() +
		batteryComponent("BATT1", 0, 100) +
		componentBlock(
			"RAIL_MAIN",
			"port",
			0,
			100,
			[{ name: "t", x: 0, y: 100 }],
			NO_PROPS,
		) +
		componentBlock(
			"RAIL_BIAS",
			"port",
			60,
			100,
			[{ name: "t", x: 60, y: 100 }],
			NO_PROPS,
		) +
		componentBlock(
			"R1",
			"resistor",
			30,
			100,
			[
				{ name: "a", x: 0, y: 100 },
				{ name: "b", x: 60, y: 100 },
			],
			props('Resistance: "10k"'),
			"Circuit.Resistor",
		) +
		componentBlock(
			"R2",
			"resistor",
			30,
			0,
			[
				{ name: "a", x: 60, y: 100 },
				{ name: "b", x: 0, y: -100 },
			],
			props('Resistance: "10k"'),
			"Circuit.Resistor",
		) +
		componentBlock(
			"RAIL_AUX",
			"port",
			140,
			100,
			[{ name: "t", x: 140, y: 100 }],
			NO_PROPS,
		) +
		docFoot(
			signalWires() +
				stubWire("W_PWR", 0, 100, 0, 112) +
				stubWire("W_BIAS", 60, 100, 60, 112) +
				stubWire("W_AUX", 140, 100, 140, 112),
			power,
		)
	);
}

// --- hand-derived topology, klon-like charge-pump document ---
//
// Nets:
//   0 = GND1.gnd, BATT1.negative, RHI.b, RLO.b
//   1 = JIN.tip, RSIG.a
//   2 = JOUT.tip, RSIG.b
//   3 = BATT1.positive, RAIL_MAIN.t
//   4 = RAIL_PLUS2.t, RHI.a            (derived +18 rail, stamped 18 V)
//   5 = RAIL_MINUS.t, RLO.a            (derived -9 rail, stamped -9 V)
// The derived rails are `kind: rail` WITH Voltage, so they lower to real
// dc-source stamps: the program carries three supplies (9, 18, -9) and the map
// must return only the 9 V one. Derived nets sit at x = +80 / -80 so no lead
// axis of one crosses a foreign wire endpoint of the other (the vertical
// lead-tap heuristic merged them when both shared x = 80).
// Expected map: RAIL_MAIN -> the 9 V stamp; RAIL_PLUS2, RAIL_MINUS ->
// derived-rail; the 18 V / -9 V stamps stay in the program untouched.
function chargePumpYaml(): string {
	return (
		docHead("charge pump supply map", "charge_pump_supply.vdsp") +
		signalComponents() +
		groundComponent() +
		batteryComponent("BATT1", 0, 100) +
		componentBlock(
			"RAIL_MAIN",
			"port",
			0,
			100,
			[{ name: "t", x: 0, y: 100 }],
			NO_PROPS,
		) +
		componentBlock(
			"RAIL_PLUS2",
			"rail",
			80,
			20,
			[{ name: "t", x: 80, y: 20 }],
			props('Voltage: "18V"'),
			"Circuit.Rail",
		) +
		componentBlock(
			"RAIL_MINUS",
			"rail",
			-80,
			20,
			[{ name: "t", x: -80, y: 20 }],
			props('Voltage: "-9V"'),
			"Circuit.Rail",
		) +
		componentBlock(
			"RHI",
			"resistor",
			40,
			-20,
			[
				{ name: "a", x: 80, y: 20 },
				{ name: "b", x: 0, y: -100 },
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
				{ name: "a", x: -80, y: 20 },
				{ name: "b", x: 0, y: -100 },
			],
			props('Resistance: "100k"'),
			"Circuit.Resistor",
		) +
		docFoot(
			signalWires() +
				stubWire("W_PWR", 0, 100, 0, 112) +
				stubWire("W_P18", 80, 20, 80, 32) +
				stubWire("W_M9", -80, 20, -80, 32),
			`power:
  schema: circuit-power/v1
  coverage: explicit-topology
  domains:
    - id: klon-charge-pump-domain
      sourceComponentIds:
        - BATT1
      ratedVoltage:
        raw: "9V"
        value: 9
        unit: V
      groundPolarity: bipolar
      sourceKind: external-dc
      rails:
        - railComponentId: RAIL_MAIN
          role: main-supply
          derivation: direct
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
`,
		)
	);
}

// --- hand-derived topology, positive-ground fuzz document ---
//
// Germanium PNP style: the battery's POSITIVE terminal is grounded and the
// rail runs at -9 V off the NEGATIVE terminal. Terminals are listed
// negative-first; the roles still orient the stamp.
// Nets:
//   0 = GND1.gnd, BATT1.positive, RLOAD.b
//   1 = JIN.tip, RSIG.a
//   2 = JOUT.tip, RSIG.b
//   3 = BATT1.negative, RAIL_NEG.t, RLOAD.a
// Compiled: one dc-source positive->0 negative->3 volts 9 (V(3) = -9).
// Expected map (positive-ground reads the NEGATIVE terminal): RAIL_NEG -> that
// stamp, nominalVolts -9 from the rail's own nominalVoltage.
function positiveGroundYaml(): string {
	return (
		docHead("positive ground supply map", "positive_ground_supply.vdsp") +
		signalComponents() +
		groundComponent() +
		componentBlock(
			"BATT1",
			"battery",
			0,
			0,
			[
				{ name: "negative", x: 0, y: 60, role: "negative" },
				{ name: "positive", x: 0, y: -100, role: "positive" },
			],
			props('Voltage: "9V"'),
			"Circuit.Battery",
		) +
		componentBlock(
			"RAIL_NEG",
			"port",
			0,
			60,
			[{ name: "t", x: 0, y: 60 }],
			NO_PROPS,
		) +
		componentBlock(
			"RLOAD",
			"resistor",
			0,
			-20,
			[
				{ name: "a", x: 0, y: 60 },
				{ name: "b", x: 0, y: -100 },
			],
			props('Resistance: "9k"'),
			"Circuit.Resistor",
		) +
		docFoot(
			signalWires() + stubWire("W_NEG", 0, 60, 0, 72),
			`power:
  schema: circuit-power/v1
  coverage: explicit-topology
  domains:
    - id: fuzz-battery
      sourceComponentIds:
        - BATT1
      ratedVoltage:
        raw: "9V"
        value: 9
        unit: V
      groundPolarity: positive-ground
      sourceKind: external-dc
      rails:
        - railComponentId: RAIL_NEG
          role: main-supply
          derivation: direct
          nominalVoltage:
            raw: "-9V"
            value: -9
            unit: V
`,
		)
	);
}

// --- absence / derivation-coverage document ---
//
// Same audio path, ground, and an UNCLAIMED 9 V battery (its stamp exists but
// no rail points at its node), plus four rails that must all refuse:
//   RAIL_GHOST direct/main-supply on an isolated net -> no-stamp-for-rail
//   RAIL_REG regulator/regulated-output -> derived-rail
//   RAIL_UNS unspecified/main-supply -> derived-rail
//   RAIL_ISO isolated/charge-pump-output -> derived-rail
// Expected: supplies empty; four refusals with those reasons.
function absenceYaml(): string {
	return (
		docHead("absent supply map", "absent_supply.vdsp") +
		signalComponents() +
		groundComponent() +
		batteryComponent("BATT1", 0, 100) +
		componentBlock(
			"RAIL_GHOST",
			"port",
			140,
			100,
			[{ name: "t", x: 140, y: 100 }],
			NO_PROPS,
		) +
		componentBlock(
			"RAIL_REG",
			"port",
			160,
			100,
			[{ name: "t", x: 160, y: 100 }],
			NO_PROPS,
		) +
		componentBlock(
			"RAIL_UNS",
			"port",
			180,
			100,
			[{ name: "t", x: 180, y: 100 }],
			NO_PROPS,
		) +
		componentBlock(
			"RAIL_ISO",
			"port",
			200,
			100,
			[{ name: "t", x: 200, y: 100 }],
			NO_PROPS,
		) +
		docFoot(
			signalWires() +
				stubWire("W_PWR", 0, 100, 0, 112) +
				stubWire("W_GHOST", 140, 100, 140, 112) +
				stubWire("W_REG", 160, 100, 160, 112) +
				stubWire("W_UNS", 180, 100, 180, 112) +
				stubWire("W_ISO", 200, 100, 200, 112),
			`power:
  schema: circuit-power/v1
  coverage: explicit-topology
  domains:
    - id: main
      sourceComponentIds:
        - BATT1
      ratedVoltage:
        raw: "9V"
        value: 9
        unit: V
      groundPolarity: negative-ground
      sourceKind: external-dc
      rails:
        - railComponentId: RAIL_GHOST
          role: main-supply
          derivation: direct
        - railComponentId: RAIL_REG
          role: regulated-output
          derivation: regulator
          parentRailComponentId: RAIL_GHOST
          nominalVoltage:
            raw: "5V"
            value: 5
            unit: V
        - railComponentId: RAIL_UNS
          role: main-supply
          derivation: unspecified
        - railComponentId: RAIL_ISO
          role: charge-pump-output
          derivation: isolated
`,
		)
	);
}

function compileOk(source: string): {
	readonly document: CircuitDocument;
	readonly program: Program;
} {
	const document = parseInterchangeYaml(source);
	const result = compile(source, { registry: emptyRegistry });
	expect(result.status).toBe("ok");
	if (result.status !== "ok") {
		throw new Error("compile refused the test document");
	}
	return { document, program: result.program };
}

function stampAt(
	program: Program,
	blockIndex: number,
	sourceIndex: number,
): { readonly volts: number; readonly kind: string } {
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
	return { volts: stamp.volts, kind: stamp.kind };
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
	test("a: divider power topology maps the direct rail and refuses the divider", () => {
		const { document, program } = compileOk(dividerYaml("external-dc"));
		const before = JSON.stringify(program);
		const resolution = resolveSupplyStamps(document, program);
		printResolution("divider", resolution);

		expect(resolution.supplies).toHaveLength(1);
		const supply = resolution.supplies[0] as ResolvedSupply;
		expect(supply.railComponentId).toBe("RAIL_MAIN");
		expect(supply.role).toBe("main-supply");
		// The rail declares no nominalVoltage, so the domain ratedVoltage (9 V)
		// is the nominal; the stamp itself is the 9 V battery.
		expect(supply.nominalVolts).toBe(9);
		expect(
			stampAt(program, supply.address.blockIndex, supply.address.sourceIndex)
				.volts,
		).toBe(9);
		expect(resolution.refused).toHaveLength(2);
		const byRail = new Map(
			resolution.refused.map((entry) => [entry.railComponentId, entry.reason]),
		);
		expect(byRail.get("RAIL_BIAS")).toBe("derived-rail");
		expect(byRail.get("RAIL_AUX")).toBe("rail-not-main-supply");
		// Untouched: the call is pure and rewrites nothing.
		expect(JSON.stringify(program)).toBe(before);
	});

	test("a: klon-like charge-pump domain maps +9 only; +18/-9 refuse and persist", () => {
		const { document, program } = compileOk(chargePumpYaml());
		const before = JSON.stringify(program);
		const resolution = resolveSupplyStamps(document, program);
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
		// The derived rails' compiled stamps are still in the program: three
		// dc-sources (9, 18, -9), one cell that must not be counted three times.
		const volts = program.blocks.flatMap((block) =>
			block.kind === "mna"
				? block.stamps.flatMap((stamp) =>
						stamp.kind === "dc-source" ? [stamp.volts] : [],
					)
				: [],
		);
		expect([...volts].sort((a, b) => a - b)).toEqual([-9, 9, 18]);
		expect(JSON.stringify(program)).toBe(before);
	});

	test("b: no power section maps nothing; the same circuit with power resolves", () => {
		const bare = compileOk(dividerYaml(null));
		const bareResolution = resolveSupplyStamps(bare.document, bare.program);
		printResolution("no-power", bareResolution);
		expect(bareResolution.supplies).toEqual([]);
		expect(bareResolution.refused).toHaveLength(1);
		expect(
			(bareResolution.refused[0] as RefusedSupply).railComponentId,
		).toBeNull();
		expect((bareResolution.refused[0] as RefusedSupply).reason).toBe(
			"no-power-section",
		);

		const powered = compileOk(dividerYaml("external-dc"));
		const poweredResolution = resolveSupplyStamps(
			powered.document,
			powered.program,
		);
		expect(poweredResolution.supplies).toHaveLength(1);
		expect(
			(poweredResolution.supplies[0] as ResolvedSupply).railComponentId,
		).toBe("RAIL_MAIN");
	});

	test("c: a mains-ac domain is refused as mains-ac-source", () => {
		const { document, program } = compileOk(dividerYaml("mains-ac"));
		const resolution = resolveSupplyStamps(document, program);
		printResolution("mains-ac", resolution);
		expect(resolution.supplies).toEqual([]);
		expect(resolution.refused).toHaveLength(3);
		for (const entry of resolution.refused) {
			expect(entry.reason).toBe("mains-ac-source");
		}
		expect(
			resolution.refused.map((entry) => entry.railComponentId).sort(),
		).toEqual(["RAIL_AUX", "RAIL_BIAS", "RAIL_MAIN"]);
	});

	test("d: a rail on a stamp-less node refuses; two stamps on one node refuse", () => {
		const { document, program } = compileOk(absenceYaml());
		const resolution = resolveSupplyStamps(document, program);
		printResolution("absence", resolution);
		expect(resolution.supplies).toEqual([]);
		const byRail = new Map(
			resolution.refused.map((entry) => [entry.railComponentId, entry.reason]),
		);
		expect(byRail.get("RAIL_GHOST")).toBe("no-stamp-for-rail");
		expect(byRail.get("RAIL_REG")).toBe("derived-rail");
		expect(byRail.get("RAIL_UNS")).toBe("derived-rail");
		expect(byRail.get("RAIL_ISO")).toBe("derived-rail");

		// Ambiguity cannot be authored in YAML: the lowering collapses twin
		// same-volt supplies on one node to a single stamp and refuses
		// contradictory ones, so two same-node sources are unrepresentable
		// from source. Inject the second stamp at the program level instead.
		const divider = compileOk(dividerYaml("external-dc"));
		const direct = resolveSupplyStamps(divider.document, divider.program);
		expect(direct.supplies).toHaveLength(1);
		const address = (direct.supplies[0] as ResolvedSupply).address;
		const ambiguous = structuredClone(divider.program);
		const block = ambiguous.blocks[address.blockIndex];
		if (block?.kind !== "mna") {
			throw new Error("expected an mna block");
		}
		const first = block.stamps.find(
			(stamp) =>
				stamp.kind === "dc-source" && stamp.sourceIndex === address.sourceIndex,
		);
		if (first?.kind !== "dc-source") {
			throw new Error("expected the resolved dc-source stamp");
		}
		const mutable = block.stamps as unknown[];
		mutable.push({
			kind: "dc-source",
			positive: first.positive,
			negative: first.negative,
			volts: first.volts,
			sourceIndex: 999,
			sourceOhms: 1,
		});
		const again = resolveSupplyStamps(divider.document, ambiguous);
		printResolution("ambiguous", again);
		expect(again.supplies).toEqual([]);
		const ghost = again.refused.find(
			(entry) => entry.railComponentId === "RAIL_MAIN",
		);
		expect(ghost?.reason).toBe("ambiguous-stamp");
	});

	test("e: renaming the supply component changes nothing; a dangling rail refuses", () => {
		const baseline = compileOk(dividerYaml("external-dc"));
		const expected = resolveSupplyStamps(baseline.document, baseline.program);

		// Rename BATT1 -> CELL9 in the components and in the power section that
		// still points at it, and plant a decoy: a port that carries the old
		// name and battery prose but no typed linkage. The map follows typed
		// linkage only, so the decoy must not attract it.
		const renamedSource = dividerYaml("external-dc")
			.replaceAll("BATT1", "CELL9")
			.replace(
				"RAIL_AUX",
				`DECOY_BATT
    kind: port
    name: BATT1
    origin:
      x: 200
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: t
        position:
          x: 200
          y: 100
    properties:
      Description: "9V battery supply, main source"
  - id: RAIL_AUX`,
			);
		const renamed = compileOk(renamedSource);
		const actual = resolveSupplyStamps(renamed.document, renamed.program);
		printResolution("renamed", actual);
		expect(actual).toEqual(expected);

		// Negative control: the power section points at a component id that
		// does not exist. That is a refusal, not an invitation to guess by
		// name (the BATT1-named decoy is right there and must not be picked).
		const brokenSource = dividerYaml("external-dc").replaceAll(
			"railComponentId: RAIL_MAIN",
			"railComponentId: NO_SUCH_RAIL",
		);
		const broken = compileOk(brokenSource);
		const brokenResolution = resolveSupplyStamps(
			broken.document,
			broken.program,
		);
		printResolution("broken-rail", brokenResolution);
		expect(brokenResolution.supplies).toEqual([]);
		expect(brokenResolution.refused).toHaveLength(3);
		const missing = brokenResolution.refused.find(
			(entry) => entry.railComponentId === "NO_SUCH_RAIL",
		);
		expect(missing?.reason).toBe("no-stamp-for-rail");
	});

	test("f: inputs are deep-frozen and unchanged after the call", () => {
		const { document, program } = compileOk(chargePumpYaml());
		deepFreeze(document);
		deepFreeze(program);
		const beforeDocument = JSON.stringify(document);
		const beforeProgram = JSON.stringify(program);
		const resolution = resolveSupplyStamps(document, program);
		expect(JSON.stringify(document)).toBe(beforeDocument);
		expect(JSON.stringify(program)).toBe(beforeProgram);
		expect(resolution.supplies).toHaveLength(1);
	});

	test("g: positive-ground supply resolves through the negative terminal", () => {
		const { document, program } = compileOk(positiveGroundYaml());
		const resolution = resolveSupplyStamps(document, program);
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

		// Independent oracle, not the implementation: the rail pin's node is
		// the stamp's NEGATIVE row, and the positive row is ground.
		const connectivity = resolveConnectivity(document);
		const railNode = getPinNode(connectivity, {
			componentId: "RAIL_NEG",
			terminalName: "t",
		});
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
		expect(block.nodeIds[stamp.negative]).toBe(railNode);
		expect(block.nodeIds[stamp.positive]).toBe(0);
	});
});
