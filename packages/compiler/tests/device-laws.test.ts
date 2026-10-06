// Stage 3 contract: laws, macro models, and the unsupported outcome.

import { describe, expect, it } from "bun:test";
import { compile } from "../src/compile";
import {
	attachDeviceLaws,
	classifyOpenIcGap,
	decomposeBucketBrigadeDelayLine,
	decomposeDigitalDelayLine,
	decomposeDigitalReverbModule,
	findIcsNotExecuted,
	SUPPLY_SOURCE_OHMS,
} from "../src/device-laws";
import { readNetlist } from "../src/netlist";
import { emptyRegistry, pinoutMatches, type PartRegistry } from "../src/registry";
import type { Block, Device, LawedNetlist } from "../src/types";
import { pedalPartCatalog } from "../src/part-catalog";
import {
	declaredRegulator,
	undeclaredRegulator,
	acMainsDivider,
	dcMainsDivider,
	diodeClipper,
	dualSectionChip,
	jfetGateLoadedDivider,
	jfetGateLoadedDivider2SK30A,
	knownChip,
	potAntiLogarithmicTaper,
	potDivider,
	powerJackStrandedSupply,
	rcLowPass,
	resistorDivider,
	rheostatDivider,
	switchedJackContacts,
	unknownChip,
	zenerCatalogDiode,
	zenerDeclaredParameters,
	zenerLedKeepsLed,
} from "../src/fixtures/circuits";
import { dualOpampRegistry, fixtureRegistry } from "../src/fixtures/registry";

/**
 * The one program a macro-derived composition runs.
 *
 * A composed block carries a position list so a reprogrammable chip can hold several; a
 * fixed-function part has exactly one, and these tests are all about those. Throwing rather than
 * defaulting keeps a structural change from passing as an empty assertion.
 */
const maybePosition = <T extends { positions: readonly unknown[] }>(
	block: T | null | undefined,
) => (block === null || block === undefined ? undefined : onlyPosition(block));

const onlyPosition = <T extends { positions: readonly unknown[] }>(block: T) => {
	const position = block.positions[0];
	if (position === undefined || block.positions.length !== 1) {
		throw new Error(
			`expected a single-position composition, found ${block.positions.length}`,
		);
	}
	return position as Extract<
		import("../src/types").Block,
		{ kind: "composed" }
	>["positions"][number];
};

function lawKinds(source: string, registry = fixtureRegistry): string[] {
	const lawed = attachDeviceLaws(readNetlist(source), registry);
	return lawed.resolutions
		.filter((resolution) => resolution.outcome === "law")
		.map((resolution) =>
			resolution.outcome === "law" ? resolution.law.kind : "",
		);
}

describe("attachDeviceLaws", () => {
	it("derives a resistor's conductance from its value", () => {
		const lawed = attachDeviceLaws(readNetlist(resistorDivider), emptyRegistry);
		const resistor = lawed.resolutions.find(
			(resolution) =>
				resolution.outcome === "law" && resolution.law.kind === "conductance",
		);
		expect(resistor?.outcome).toBe("law");
		if (resistor?.outcome === "law" && resistor.law.kind === "conductance") {
			expect(resistor.law.siemens).toBeCloseTo(1 / 10_000, 12);
		}
	});

	it("gives a capacitor a capacitance law, not a resistance", () => {
		expect(lawKinds(rcLowPass, emptyRegistry)).toContain("capacitance");
	});

	it("gives a diode a nonlinear law", () => {
		expect(lawKinds(diodeClipper, emptyRegistry)).toContain("diode");
	});

	it("gives an undeclared zener part number the catalog knee", () => {
		const lawed = attachDeviceLaws(readNetlist(zenerCatalogDiode), pedalPartCatalog);
		const d1 = lawed.resolutions.find(
			(resolution) => resolution.device === "D1",
		);
		expect(d1?.outcome).toBe("law");
		if (d1?.outcome === "law" && d1.law.kind === "diode") {
			expect(d1.law.breakdownVolts).toBe(5.1);
			expect(d1.law.saturationCurrent).toBe(2.52e-9);
			expect(d1.law.seriesResistance).toBe(1);
		}
	});

	it("keeps every declared diode parameter over a catalog match", () => {
		const lawed = attachDeviceLaws(
			readNetlist(zenerDeclaredParameters),
			pedalPartCatalog,
		);
		const d1 = lawed.resolutions.find(
			(resolution) => resolution.device === "D1",
		);
		expect(d1?.outcome).toBe("law");
		if (d1?.outcome === "law" && d1.law.kind === "diode") {
			expect(d1.law.breakdownVolts).toBe(6.2);
			expect(d1.law.saturationCurrent).toBe(5e-9);
			expect(d1.law.seriesResistance).toBe(2.5);
		}
	});

	it("keeps a declared LED an LED under a catalog match", () => {
		const lawed = attachDeviceLaws(readNetlist(zenerLedKeepsLed), pedalPartCatalog);
		const d1 = lawed.resolutions.find(
			(resolution) => resolution.device === "D1",
		);
		expect(d1?.outcome).toBe("law");
		if (d1?.outcome === "law" && d1.law.kind === "diode") {
			expect(d1.law.isLed).toBe(true);
			expect(d1.law.breakdownVolts).toBe(5.1);
		}
	});

	it("gives a registered 2SK30A the catalog gate over the class channel", () => {
		const lawed = attachDeviceLaws(
			readNetlist(jfetGateLoadedDivider2SK30A),
			pedalPartCatalog,
		);
		const q1 = lawed.resolutions.find(
			(resolution) => resolution.device === "Q1",
		);
		expect(q1?.outcome).toBe("law");
		if (q1?.outcome === "law" && q1.law.kind === "fet") {
			// Gate-only refinement: the channel repeats the class default
			// byte-for-byte, only the gate term carries part data.
			expect(q1.law.thresholdVolts).toBe(-2);
			expect(q1.law.transconductance).toBe(1e-3);
			expect(q1.law.channelLengthModulation).toBe(0);
			expect(q1.law.gateSaturationCurrent).toBe(1e-14);
		}
	});

	it("keeps declared Vt0/Beta over a 2SK30A catalog match", () => {
		const declared = jfetGateLoadedDivider2SK30A.replace(
			'PartNumber: "2SK30A"',
			'PartNumber: "2SK30A"\n      Vt0: "-1.5 V"\n      Beta: "0.7m"',
		);
		const lawed = attachDeviceLaws(readNetlist(declared), pedalPartCatalog);
		const q1 = lawed.resolutions.find(
			(resolution) => resolution.device === "Q1",
		);
		expect(q1?.outcome).toBe("law");
		if (q1?.outcome === "law" && q1.law.kind === "fet") {
			expect(q1.law.thresholdVolts).toBe(-1.5);
			expect(q1.law.transconductance).toBe(0.0007);
			// Declared values win, but the entry still supplies the gate term.
			expect(q1.law.gateSaturationCurrent).toBe(1e-14);
		}
	});

	it("leaves an unregistered JFET on the class gate default", () => {
		const lawed = attachDeviceLaws(
			readNetlist(jfetGateLoadedDivider),
			pedalPartCatalog,
		);
		const q1 = lawed.resolutions.find(
			(resolution) => resolution.device === "Q1",
		);
		expect(q1?.outcome).toBe("law");
		if (q1?.outcome === "law" && q1.law.kind === "fet") {
			expect(q1.law.thresholdVolts).toBe(-2);
			expect(q1.law.transconductance).toBe(1e-3);
			expect(q1.law.channelLengthModulation).toBe(0);
			expect(q1.law.gateSaturationCurrent).toBe(1e-5);
		}
	});

	it("leaves a suffixed 2SK30ATM-Y id on the class default stamp byte-for-byte", () => {
		// The catalog covers the exact folded id `2sk30a` only: `registryLawFor`
		// compares whole folded ids with no prefix rule, so a binned or suffixed
		// spelling must not match. `boss-cs-2`, `boss-ds-1` and `boss-dm-2` declare
		// exactly these spellings and stay on the class law until their packet
		// studies land.
		const suffixed = jfetGateLoadedDivider2SK30A.replace(
			'PartNumber: "2SK30A"',
			'PartNumber: "2SK30ATM-Y"',
		);
		const lawed = attachDeviceLaws(readNetlist(suffixed), pedalPartCatalog);
		const q1 = lawed.resolutions.find(
			(resolution) => resolution.device === "Q1",
		);
		expect(q1?.outcome).toBe("law");
		if (q1?.outcome === "law" && q1.law.kind === "fet") {
			expect(q1.law.thresholdVolts).toBe(-2);
			expect(q1.law.transconductance).toBe(1e-3);
			expect(q1.law.channelLengthModulation).toBe(0);
			expect(q1.law.subthresholdVolts).toBe(0.07);
			expect(q1.law.gateSaturationCurrent).toBe(1e-5);
			expect(q1.law.gateOnsetVolts).toBe(0.5);
			expect(q1.law.gateScaleVolts).toBe(0.06);
		}
	});

	it("makes a pot a control-dependent conductance carrying its control and track", () => {
		const lawed = attachDeviceLaws(readNetlist(potDivider), emptyRegistry);
		const pot = lawed.resolutions.find(
			(resolution) =>
				resolution.outcome === "law" &&
				resolution.law.kind === "controlled-conductance",
		);
		expect(pot?.outcome).toBe("law");
		if (pot?.outcome === "law" && pot.law.kind === "controlled-conductance") {
			expect(pot.law.control).toBe("Level");
			expect(pot.law.totalOhms).toBe(10_000);
		}
	});

	it("carries the taper the source actually declares, not a hardcoded default", () => {
		// `potDivider` alone cannot prove this: its declared taper IS "linear", so a law
		// that hardcodes "linear" regardless of the source would pass that fixture by
		// accident -- which is exactly how this defect shipped unnoticed. This fixture
		// declares "AntiLogarithmic" on the pot itself (no panel-control taper to shadow
		// it), which `netlist.ts` resolves to "reverse-logarithmic", so only a law that
		// truly reads `Netlist.controls` rather than defaulting can pass here.
		const lawed = attachDeviceLaws(
			readNetlist(potAntiLogarithmicTaper),
			emptyRegistry,
		);
		const pot = lawed.resolutions.find(
			(resolution) =>
				resolution.outcome === "law" &&
				resolution.law.kind === "controlled-conductance",
		);
		expect(pot?.outcome).toBe("law");
		if (pot?.outcome === "law" && pot.law.kind === "controlled-conductance") {
			expect(pot.law.taper).toBe("reverse-logarithmic");
		}
	});

	it("carries a rheostat's declared taper the same way", () => {
		// Same defect, same fix, the other controlled-law kind: `device-laws.ts` hardcoded
		// "linear" here too. Panel taper removed and the device's own `Sweep: Log`
		// substituted, so this only passes if the law reads the resolved control.
		const rheostatWithLogTaper = rheostatDivider
			.replace("      taper: linear\n", "")
			.replace("Sweep: Linear", "Sweep: Log");
		const lawed = attachDeviceLaws(
			readNetlist(rheostatWithLogTaper),
			emptyRegistry,
		);
		const rheostat = lawed.resolutions.find(
			(resolution) =>
				resolution.outcome === "law" &&
				resolution.law.kind === "controlled-resistance",
		);
		expect(rheostat?.outcome).toBe("law");
		if (
			rheostat?.outcome === "law" &&
			rheostat.law.kind === "controlled-resistance"
		) {
			expect(rheostat.law.taper).toBe("logarithmic");
		}
	});

	it("supplies a macro model when the registry knows the part", () => {
		const lawed = attachDeviceLaws(readNetlist(knownChip), fixtureRegistry);
		const macro = lawed.resolutions.find(
			(resolution) => resolution.outcome === "macro",
		);
		expect(macro?.outcome).toBe("macro");
	});

	it("reports unsupported, with a reason, for an unknown chip", () => {
		const lawed = attachDeviceLaws(readNetlist(unknownChip), fixtureRegistry);
		const refused = lawed.resolutions.find(
			(resolution) => resolution.outcome === "unsupported",
		);
		expect(refused?.outcome).toBe("unsupported");
		if (refused?.outcome === "unsupported") {
			expect(refused.device).toBe("U1");
			expect(refused.reason.length).toBeGreaterThan(0);
		}
	});

	it("reports unsupported for a known part against an empty registry", () => {
		const lawed = attachDeviceLaws(readNetlist(knownChip), emptyRegistry);
		expect(
			lawed.resolutions.some(
				(resolution) => resolution.outcome === "unsupported",
			),
		).toBe(true);
	});
});

describe("a switched jack's engage element", () => {
	function jackLaw(id: string, source = switchedJackContacts) {
		const netlist = readNetlist(source);
		const lawed = attachDeviceLaws(netlist, emptyRegistry);
		const device = netlist.devices.find((candidate) => candidate.id === id);
		const resolution = lawed.resolutions.find(
			(candidate) => candidate.device === id,
		);
		if (device === undefined || resolution?.outcome !== "law") {
			throw new Error(`fixture has no lawed device ${id}`);
		}
		return { device, law: resolution.law };
	}

	it("closes the contact that carries the supply return", () => {
		const { device, law } = jackLaw("IN");
		if (law.kind !== "port-engage") {
			throw new Error(`expected a port-engage law, got ${law.kind}`);
		}
		// The derived pair is the contact against the return, never declaration order:
		// the first terminal is the signal one on every jack shaped like this.
		expect(device.nodes[law.contactIndex]).not.toBe(device.nodes[0]);
		expect(device.nodes[law.againstIndex]).toBe(0);
	});

	it("leaves an identically named contact open when it carries no supply return", () => {
		// Same role token as the jack above. Only what landed on the node differs, which
		// is why the sense cannot come from the name.
		expect(jackLaw("OUT").law.kind).toBe("open");
	});

	it("routes a stranded supply drive onward instead of to the return", () => {
		const { device, law } = jackLaw("PWR", powerJackStrandedSupply);
		if (law.kind !== "port-engage") {
			throw new Error(`expected a port-engage law, got ${law.kind}`);
		}
		// The whole point: against the remaining terminal, NOT the sleeve. Making this one
		// against the return shorts the supply to ground instead of delivering it.
		expect(device.nodes[law.againstIndex]).not.toBe(0);
		expect(device.nodes[law.contactIndex]).not.toBe(
			device.nodes[law.againstIndex],
		);
	});

	it("adds nothing when the supply already reaches the circuit", () => {
		// `PWR_REACHED` names its terminals exactly like the jack above; the only
		// difference is that a resistor also sits on its supply node. Firing here would
		// bridge two live nodes, which is the same defect class as shorting one.
		expect(jackLaw("PWR_REACHED", powerJackStrandedSupply).law.kind).toBe(
			"open",
		);
	});

	it("refuses to choose when a jack offers two destinations", () => {
		// Four terminals, two candidates, and the packet does not say which is wired.
		// `boss-ch-1` is this shape with three positives on one jack.
		expect(jackLaw("PWR_AMBIGUOUS", powerJackStrandedSupply).law.kind).toBe(
			"open",
		);
	});

	it("delivers the stranded supply into the same solved block as the circuit", () => {
		// The consequence worth asserting, since the law alone does not show it: without
		// the element that supply sits in its own partition and the circuit solves with no
		// voltage source driving it.
		//
		// It has to name the *stranded* supply's node. Asserting "some dc-source reached
		// the driven block" passes vacuously here, because the fixture's other two
		// batteries reach the circuit by ordinary wiring -- checked by mutation, and it
		// did pass vacuously until this looked for node 5 specifically.
		const { device, law } = jackLaw("PWR", powerJackStrandedSupply);
		if (law.kind !== "port-engage") {
			throw new Error(`expected a port-engage law, got ${law.kind}`);
		}
		const stranded = device.nodes[law.contactIndex];
		const result = compile(powerJackStrandedSupply, {
			registry: emptyRegistry,
		});
		if (result.status !== "ok") {
			throw new Error(`fixture did not compile: ${JSON.stringify(result)}`);
		}
		const driven = result.program.blocks.find(
			(block) => block.kind === "mna" && block.outputNode !== null,
		);
		if (driven === undefined || driven.kind !== "mna") {
			throw new Error("fixture produced no driven block");
		}
		expect(
			(
				driven.stamps as readonly {
					kind: string;
					positive?: number;
					negative?: number;
				}[]
			).some(
				(stamp) =>
					stamp.kind === "dc-source" &&
					(stamp.positive === stranded || stamp.negative === stranded),
			),
		).toBe(true);
	});
});

describe("multi-section parts", () => {
	// One matched part becoming N elements. Neither other `PartModel` arm can express a dual
	// op-amp: a `law` produces one element, and a `macro` becomes a block solved outside the MNA
	// system, which breaks the feedback loop that makes an op-amp an amplifier.
	it("expands one chip into a law per section", () => {
		const lawed = attachDeviceLaws(
			readNetlist(dualSectionChip),
			dualOpampRegistry,
		);
		const opamps = lawed.resolutions.filter(
			(resolution) =>
				resolution.outcome === "law" && resolution.law.kind === "ideal-opamp",
		);
		expect(opamps).toHaveLength(2);
	});

	it("gives each section only its own terminals, in the order the registry gave them", () => {
		const lawed = attachDeviceLaws(
			readNetlist(dualSectionChip),
			dualOpampRegistry,
		);
		const sections = lawed.netlist.devices.filter((device) =>
			device.id.startsWith("U1#"),
		);
		expect(sections).toHaveLength(2);
		// Terminals [0,1,2] and [5,4,3] of pins numbered from node 10 upward.
		expect(sections[0]?.nodes).toEqual([10, 11, 12]);
		expect(sections[1]?.nodes).toEqual([15, 14, 13]);
	});

	it("substitutes the circuit's rails rather than the registry's", () => {
		// A registry describes a part; the rails belong to the pedal it is fitted to. The fixture
		// declares them null and the fixture circuit carries a 9 V supply.
		const lawed = attachDeviceLaws(
			readNetlist(dualSectionChip),
			dualOpampRegistry,
		);
		const rails = lawed.resolutions.flatMap((resolution) =>
			resolution.outcome === "law" && resolution.law.kind === "ideal-opamp"
				? [[resolution.law.railHigh, resolution.law.railLow]]
				: [],
		);
		expect(rails).toEqual([
			[9, 0],
			[9, 0],
		]);
	});

	it("leaves a single-law part alone", () => {
		// The expansion must not disturb the arm that already worked.
		expect(lawKinds(knownChip)).not.toContain("ideal-opamp");
	});

	// The negative control for the pinout guard, and the reason it exists: a section's terminal
	// indices are only meaningful against one declaration order, so an entry applied to a document
	// that orders the chip differently would wire an amplifier's output to its own input and render
	// a plausible wrong circuit. Here the entry claims role tokens the fixture does not declare.
	//
	// **The guard is "not expanded, and said so", which is what this asserts.** It asserted a
	// device-level `unsupported` until 2026-09-04, when that became an `open` tagged
	// `registry-arity-mismatch`: the part is registered, so an arity disagreement between a real
	// entry and a real document should cost that one component rather than the whole pedal. The
	// property that matters is unchanged and still fails loudly -- expanding against a mismatched
	// pinout brings the law back, and dropping the tag makes the component silent.
	it("opens rather than expanding a part whose declared pinout it was not written against", () => {
		const mismatched = {
			entries: dualOpampRegistry.entries.map((entry) => ({
				...entry,
				model:
					entry.model.kind === "sections"
						? {
								...entry.model,
								pinout: entry.model.pinout.map(() => "someOtherRole"),
							}
						: entry.model,
			})),
		};
		const lawed = attachDeviceLaws(readNetlist(dualSectionChip), mismatched);
		expect(
			lawed.resolutions.filter(
				(resolution) =>
					resolution.outcome === "law" && resolution.law.kind === "ideal-opamp",
			),
		).toHaveLength(0);
		// The tag, not the open count: the fixture's ground and jack symbols carry no element
		// either, and they are not what this guard is about.
		expect(
			lawed.resolutions.filter(
				(resolution) =>
					resolution.outcome === "law" &&
					resolution.openReason === "registry-arity-mismatch",
			),
		).toHaveLength(1);
	});

	it("opens a part whose terminal count differs from the pinout the entry states", () => {
		// The same guard catches the other shape of the same mistake: a document that declares a
		// two-terminal symbol for an eight-pin chip. Indices into a list that short would resolve to
		// nothing, and dropping a section silently renders half a circuit.
		const shortened = {
			entries: dualOpampRegistry.entries.map((entry) => ({
				...entry,
				model:
					entry.model.kind === "sections"
						? { ...entry.model, pinout: entry.model.pinout.slice(0, 2) }
						: entry.model,
			})),
		};
		const lawed = attachDeviceLaws(readNetlist(dualSectionChip), shortened);
		expect(
			lawed.resolutions.filter(
				(resolution) =>
					resolution.outcome === "law" && resolution.law.kind === "ideal-opamp",
			),
		).toHaveLength(0);
	});
});

describe("pinoutMatches", () => {
	// A deterministic comparison, tested directly because it is what stands between a positional
	// registry entry and a silently mis-wired chip.
	it("accepts the declaration order it was written against", () => {
		expect(pinoutMatches(["outA", "inA_minus"], ["outa", "inaminus"])).toBe(
			true,
		);
	});

	it("folds case and separators the same way a terminal role token is folded", () => {
		expect(pinoutMatches(["IN_A_PLUS"], ["inaplus"])).toBe(true);
	});

	it("rejects the same tokens in a different order", () => {
		expect(pinoutMatches(["outA", "inAminus"], ["inaminus", "outa"])).toBe(
			false,
		);
	});

	it("rejects a different terminal count", () => {
		expect(pinoutMatches(["outA"], ["outa", "inaminus"])).toBe(false);
	});

	it("leaves a null position unchecked, for a document that numbers its pins", () => {
		// `terminalRoleToken` returns null for a bare `pin1`, so there is no token to compare and
		// the entry must not be able to claim one.
		expect(pinoutMatches([null, null], [null, null])).toBe(true);
		expect(pinoutMatches([null, "outA"], [null, "outa"])).toBe(true);
	});

	it("does not let a named entry position match an unnamed terminal", () => {
		expect(pinoutMatches(["outA"], [null])).toBe(false);
	});
});

describe("a supply's frequency decides which source it is", () => {
	function supplyLaw(source: string) {
		const lawed = attachDeviceLaws(readNetlist(source), emptyRegistry);
		const resolution = lawed.resolutions.find(
			(candidate) => candidate.device === "VMAINS",
		);
		if (resolution?.outcome !== "law") {
			throw new Error("fixture has no lawed VMAINS");
		}
		return resolution.law;
	}

	it("gives a declared frequency an AC law carrying it", () => {
		const law = supplyLaw(acMainsDivider);
		if (law.kind !== "ac-source") {
			throw new Error(`expected an ac-source law, got ${law.kind}`);
		}
		// Both come from structured `{raw, value, unit}` properties whose prose says "VAC RMS"
		// and "assumed nominal", which is the shape the amp packets use. The declared magnitude
		// is read as RMS by project convention (the prose stays unread either way) and the law
		// converts it to the peak amplitude the sine evaluation needs -- `10 * sqrt(2)`.
		expect(law.amplitudeVolts).toBeCloseTo(10 * Math.SQRT2, 12);
		expect(law.frequencyHz).toBe(60);
		// The same series impedance a battery gets. A supply is a supply.
		expect(law.sourceOhms).toBe(SUPPLY_SOURCE_OHMS);
	});

	it("gives the same supply a DC law when the frequency is removed", () => {
		// The negative control, and the whole discriminator: one deleted property turns a mains
		// inlet back into a battery. Every AC supply in both corpora used to take this branch
		// silently, which is what the pair exists to stop.
		const law = supplyLaw(dcMainsDivider);
		if (law.kind !== "voltage-source") {
			throw new Error(`expected a voltage-source law, got ${law.kind}`);
		}
		expect(law.volts).toBe(10);
	});
});

describe("per-op-amp supply rails", () => {
	it("resolves per-device rails from vcc/vee terminals when present", () => {
		const testCircuit = `schema: circuit-interchange/v3
components:
  - id: JIN
    kind: jack
    name: INPUT
    sourceTypeName: Circuit.Input
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        role: signal
        node: 1
        position:
          x: 0
          y: 0
  - id: JOUT
    kind: jack
    name: OUTPUT
    sourceTypeName: Circuit.Output
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        role: signal
        node: 3
        position:
          x: 0
          y: 0
  - id: V_24V
    kind: voltage-source
    name: V_24V
    sourceTypeName: Circuit.Battery
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: positive
        role: positive
        node: 24
        position:
          x: 0
          y: 0
      - name: negative
        role: negative
        node: 0
        position:
          x: 0
          y: 0
    properties:
      Voltage: "24 V"
  - id: V_18V
    kind: voltage-source
    name: V_18V
    sourceTypeName: Circuit.Battery
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: positive
        role: positive
        node: 18
        position:
          x: 0
          y: 0
      - name: negative
        role: negative
        node: 0
        position:
          x: 0
          y: 0
    properties:
      Voltage: "18 V"
  - id: U1
    kind: opamp
    name: OPAMP_1
    sourceTypeName: Circuit.OpAmp
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: positive
        role: positive
        node: 1
        position:
          x: 0
          y: 0
      - name: negative
        role: negative
        node: 2
        position:
          x: 0
          y: 0
      - name: out
        role: output
        node: 3
        position:
          x: 0
          y: 0
      - name: vcc
        role: supplyPositive
        node: 18
        position:
          x: 0
          y: 0
      - name: vee
        role: supplyNegative
        node: 0
        position:
          x: 0
          y: 0
    properties:
      openLoopGain: "100000"
wires: []
`;
		const lawed = attachDeviceLaws(readNetlist(testCircuit), emptyRegistry);
		const opamp = lawed.resolutions.find(
			(resolution) =>
				resolution.outcome === "law" && resolution.law.kind === "ideal-opamp",
		);
		expect(opamp?.outcome).toBe("law");
		if (opamp?.outcome === "law" && opamp.law.kind === "ideal-opamp") {
			expect(opamp.law.railHigh).toBe(18);
			expect(opamp.law.railLow).toBe(0);
		}
	});

	describe("bucket-brigade delay lines: stage count in registry parameters", () => {
		const stageCountFixtures = [
			{ stages: 256, part: "FIXTURE-BBD-256" },
			{ stages: 512, part: "FIXTURE-BBD-512" },
			{ stages: 1024, part: "FIXTURE-BBD-1024" },
			{ stages: 2048, part: "FIXTURE-BBD-2048" },
			{ stages: 4096, part: "FIXTURE-BBD-4096" },
		];

		for (const { stages, part } of stageCountFixtures) {
			it(`attaches ${stages} stages for a part declaring ${stages} stages`, () => {
				const registry: PartRegistry = {
					entries: [
						{
							partIds: [part],
							declaredTypes: [],
							terminalRoleGroups: [["in"], ["out"], ["cp1"]],
							model: {
								kind: "macro",
								macro: {
									modelId: "bucket-brigade-delay-line",
									parameters: { stages },
									ports: {
										audioIn: ["in"],
										audioOut: ["out"],
										parameter: ["cp1"],
									},
									audioPortImpedanceOhms: { input: 1e9, output: 400 },
									parameterReferenceVolts: 9.0,
								},
							},
						},
					],
				};
				const circuit = knownChip.replace(
					'PartNumber: "FIXTURE-DELAY-1"',
					`PartNumber: "${part}"`,
				);
				const lawed = attachDeviceLaws(readNetlist(circuit), registry);
				const macro = lawed.resolutions.find(
					(r) =>
						r.outcome === "macro" &&
						r.macro.modelId === "bucket-brigade-delay-line",
				);
				expect(macro?.outcome).toBe("macro");
				if (macro?.outcome === "macro") {
					expect(macro.macro.parameters.stages).toBe(stages);
				}
			});
		}

		it("refuses with unsupported when a BBD part has no declared stages in its registry entry", () => {
			const registryWithoutStages: PartRegistry = {
				entries: [
					{
						partIds: ["FIXTURE-BBD-NO-STAGES"],
						declaredTypes: [],
						terminalRoleGroups: [["in"], ["out"], ["cp1"]],
						model: {
							kind: "macro",
							macro: {
								modelId: "bucket-brigade-delay-line",
								parameters: {},
								ports: {
									audioIn: ["in"],
									audioOut: ["out"],
									parameter: ["cp1"],
								},
								audioPortImpedanceOhms: { input: 1e9, output: 400 },
								parameterReferenceVolts: 9.0,
							},
						},
					},
				],
			};
			const circuit = knownChip.replace(
				'PartNumber: "FIXTURE-DELAY-1"',
				'PartNumber: "FIXTURE-BBD-NO-STAGES"',
			);
			const lawed = attachDeviceLaws(readNetlist(circuit), registryWithoutStages);
			const refused = lawed.resolutions.find(
				(r) => r.outcome === "unsupported",
			);
			expect(refused?.outcome).toBe("unsupported");
			if (refused?.outcome === "unsupported") {
				expect(refused.reason).toContain(
					"no stage count declared in its registry entry",
				);
			}
		});
	});
});

describe("a regulator's declared electrodes", () => {
	function supplySpan(source: string): readonly [number, number] {
		const netlist = readNetlist(source);
		const lawed = attachDeviceLaws(netlist, pedalPartCatalog);
		// Both paths produce a section, so both name it `REG#0`.
		const resolution = lawed.resolutions.find(
			(candidate) => candidate.device === "REG#0",
		);
		if (resolution?.outcome !== "law") {
			throw new Error("fixture has no lawed REG");
		}
		if (resolution.law.kind !== "voltage-source") {
			throw new Error(
				`expected a voltage-source law, got ${resolution.law.kind}`,
			);
		}
		const device = lawed.netlist.devices.find(
			(candidate) => candidate.id === "REG#0",
		);
		const [positive, negative] = device?.nodes ?? [];
		if (positive === undefined || negative === undefined) {
			throw new Error("lawed REG does not span two nodes");
		}
		return [positive, negative];
	}

	it("orients the source onto the terminal declared positive", () => {
		// Node 2 is the regulated rail and node 0 the reference. The entry's own pin aliases
		// disagree -- they list `pin2` as a ground spelling and `pin3` as an output one -- and
		// the declaration is what settles it.
		expect(supplySpan(declaredRegulator)).toEqual([2, 0]);
	});

	it("falls back to the entry's pin naming when no electrode is declared", () => {
		// The negative control, and the reason the first case is not vacuous: with the two roles
		// removed, the same document resolves the other way round. A test that passed both ways
		// would be measuring the fixture, not the binding.
		expect(supplySpan(undeclaredRegulator)).not.toEqual([2, 0]);
	});
});

describe("classifyOpenIcGap", () => {
	it("keeps an undetermined chip in the phase-3 set even when it shares nets", () => {
		// The negative control the other arms need: sharing a net with an
		// executing device is not coverage by itself. An open question about
		// the chip's nature keeps the row, so only positive fixed-function
		// evidence can move one out.
		expect(
			classifyOpenIcGap({
				firmwareClass: "undetermined",
				sharesNodeWithExecutedMacro: true,
				sharesNodeWithExecutedLaw: true,
			}),
		).toBe("programmable-no-program");
	});

	it("keeps a fixed-function chip with no executing coverage in the set", () => {
		// Fixed-function alone is not a filing: with nothing executing around
		// it the chip still needs a law, and the three buckets have nowhere
		// to put it, so it stays until coverage or a model arrives.
		expect(
			classifyOpenIcGap({
				firmwareClass: "fixed-function",
				sharesNodeWithExecutedMacro: false,
				sharesNodeWithExecutedLaw: false,
			}),
		).toBe("programmable-no-program");
	});

	it("files fixed-function memory behind an executing macro as support", () => {
		expect(
			classifyOpenIcGap({
				firmwareClass: "fixed-function",
				sharesNodeWithExecutedMacro: true,
				sharesNodeWithExecutedLaw: false,
			}),
		).toBe("support-chip-subsumed");
	});

	it("files a fixed-function placeholder on an executing law as a miss", () => {
		expect(
			classifyOpenIcGap({
				firmwareClass: "fixed-function",
				sharesNodeWithExecutedMacro: false,
				sharesNodeWithExecutedLaw: true,
			}),
		).toBe("part-number-miss");
	});

	it("prefers macro coverage when both are present", () => {
		// Memory on a shared bus touches laws too (pull-ups, series
		// resistors). The macro abstraction outranks them: the chip is
		// support for the kernel, not a redundant view of a law.
		expect(
			classifyOpenIcGap({
				firmwareClass: "fixed-function",
				sharesNodeWithExecutedMacro: true,
				sharesNodeWithExecutedLaw: true,
			}),
		).toBe("support-chip-subsumed");
	});

	it("treats a reprogrammable chip as programmable even when covered", () => {
		// Coverage never excuses a program: a reprogrammable core behind an
		// executing macro is still a missing program, not support.
		expect(
			classifyOpenIcGap({
				firmwareClass: "reprogrammable",
				sharesNodeWithExecutedMacro: true,
				sharesNodeWithExecutedLaw: true,
			}),
		).toBe("programmable-no-program");
	});
});

describe("findIcsNotExecuted gap classes", () => {
	const gapRegistry: PartRegistry = {
		entries: [
			{
				partIds: ["FIXED-MEM-1"],
				declaredTypes: [],
				terminalRoleGroups: [],
				firmware: {
					firmwareClass: "fixed-function",
					basis: ["synthetic fixed-function memory"],
				},
				model: { kind: "law", law: { kind: "open" } },
			},
			{
				partIds: ["FIXED-PLACEHOLDER-1"],
				declaredTypes: [],
				terminalRoleGroups: [],
				firmware: {
					firmwareClass: "fixed-function",
					basis: ["synthetic fixed-function divider"],
				},
				model: { kind: "law", law: { kind: "open" } },
			},
		],
	};

	function gapLawed(): LawedNetlist {
		const devices: Device[] = [
			{
				id: "MEM1",
				kind: "ic",
				nodes: [1, 2, 3],
				parameters: {},
				control: null,
				identity: {
					partNumber: "FIXED-MEM-1",
					declaredType: null,
					terminalRoles: [],
					declaredTerminalRoles: [],
					declaredWindings: null,
				},
			},
			{
				id: "MAC1",
				kind: "ic",
				nodes: [2, 3, 4],
				parameters: {},
				control: null,
				identity: {
					partNumber: "EXEC-MACRO-1",
					declaredType: null,
					terminalRoles: [],
					declaredTerminalRoles: [],
					declaredWindings: null,
				},
			},
			{
				id: "PH1",
				kind: "ic",
				nodes: [5],
				parameters: {},
				control: null,
				identity: {
					partNumber: "FIXED-PLACEHOLDER-1",
					declaredType: null,
					terminalRoles: [],
					declaredTerminalRoles: [],
					declaredWindings: null,
				},
			},
			{
				id: "R1",
				kind: "resistor",
				nodes: [5, 6],
				parameters: { ohms: 1000 },
				control: null,
				identity: {
					partNumber: null,
					declaredType: null,
					terminalRoles: [],
					declaredTerminalRoles: [],
					declaredWindings: null,
				},
			},
			{
				id: "UNK1",
				kind: "ic",
				nodes: [4, 6],
				parameters: {},
				control: null,
				identity: {
					partNumber: "UNKNOWN-9",
					declaredType: null,
					terminalRoles: [],
					declaredTerminalRoles: [],
					declaredWindings: null,
				},
			},
			{
				id: "SHL1",
				kind: "ic",
				nodes: [1],
				parameters: {},
				control: null,
				identity: {
					partNumber: null,
					declaredType: "Circuit.SupportChip",
					terminalRoles: [],
					declaredTerminalRoles: [],
					declaredWindings: null,
				},
			},
		];
		const netlist = {
			nodes: [0, 1, 2, 3, 4, 5, 6],
			devices,
			controls: [],
			ports: { input: 1, output: 6 },
			bypass: { declared: "none" },
			portImpedanceOhms: { input: null, output: null },
			portDeclaredFullScaleVolts: { input: null, output: null },
			convergenceOptIn: false,
		} as const;
		return {
			netlist: { ...netlist, devices: [...devices] },
			resolutions: [
				{
					outcome: "law",
					device: "MEM1",
					law: { kind: "open" },
					openReason: "registry-open",
				},
				{
					outcome: "macro",
					device: "MAC1",
					macro: {
						modelId: "digital-delay-line",
						parameters: {},
						portTerminals: [0, 1],
						audioPortImpedanceOhms: null,
						parameterTerminal: null,
						parameterReferenceVolts: null,
					},
				},
				{
					outcome: "law",
					device: "PH1",
					law: { kind: "open" },
					openReason: "registry-open",
				},
				{
					outcome: "law",
					device: "R1",
					law: { kind: "conductance", siemens: 1e-3 },
				},
				{
					outcome: "law",
					device: "UNK1",
					law: { kind: "open" },
					openReason: "registry-open",
				},
				{
					outcome: "law",
					device: "SHL1",
					law: { kind: "open" },
					openReason: "source-boundary-shell",
				},
			],
		} as LawedNetlist;
	}

	function gapByDevice() {
		const lawed = gapLawed();
		const warnings = findIcsNotExecuted(lawed, lawed.netlist, gapRegistry);
		return new Map(warnings.map((warning) => [warning.device, warning]));
	}

	it("marks memory behind an executing macro as support-chip-subsumed", () => {
		expect(gapByDevice().get("MEM1")?.gapClass).toBe(
			"support-chip-subsumed",
		);
	});

	it("marks a placeholder on an executing law as part-number-miss", () => {
		expect(gapByDevice().get("PH1")?.gapClass).toBe("part-number-miss");
	});

	it("keeps an unknown chip sharing those nets in the phase-3 set", () => {
		// UNK1 touches the macro's net and the resistor's net. Without
		// positive fixed-function evidence that coverage means nothing, so
		// the row stays -- the same negative control as the unit case above,
		// now through the full reporter.
		expect(gapByDevice().get("UNK1")?.gapClass).toBe(
			"programmable-no-program",
		);
	});

	it("leaves non-candidate reasons without a gap class", () => {
		expect("gapClass" in (gapByDevice().get("SHL1") ?? {})).toBe(false);
	});
});

describe("decomposeDigitalDelayLine", () => {
	function delayMacro(overrides: Record<string, unknown> = {}) {
		return {
			kind: "macro",
			id: "D0",
			modelId: "digital-delay-line",
			parameters: { delaySeconds: 0.003, feedback: 0.6 },
			audioIn: null,
			audioOut: false,
			parameter: null,
			...overrides,
		} as Extract<Block, { kind: "macro" }>;
	}

	it("refuses other models", () => {
		expect(
			decomposeDigitalDelayLine({
				...delayMacro(),
				modelId: "bucket-brigade-delay-line",
			}),
		).toBeNull();
	});

	it("refuses a block carrying modulation the kernel has no branch for", () => {
		expect(
			decomposeDigitalDelayLine(
				delayMacro({ modulation: { block: "X", node: 0 } }),
			),
		).toBeNull();
	});

	it("emits tap, mix, and push in kernel order with the block's fittings", () => {
		const composed = decomposeDigitalDelayLine(delayMacro());
		if (composed === null) {
			throw new Error("expected a decomposition");
		}
		expect(composed.kind).toBe("composed");
		expect(composed.id).toBe("D0");
		expect(composed.modelId).toBe("digital-delay-line");
		expect(onlyPosition(composed).out).toBe(0);
		expect(onlyPosition(composed).lines).toEqual({ dl: { delaySeconds: 0.003, minSeconds: 0 } });
		expect(onlyPosition(composed).ops.map((op) => op.op)).toEqual([
			"delay-tap",
			"mix",
			"delay-push",
		]);
		const tap = onlyPosition(composed).ops[0];
		const mix = onlyPosition(composed).ops[1];
		const push = onlyPosition(composed).ops[2];
		if (tap?.op !== "delay-tap" || mix?.op !== "mix" || push?.op !== "delay-push") {
			throw new Error("op order moved under the test");
		}
		expect(tap.length).toEqual({ mode: "capacity" });
		expect(tap.out).toBe(0);
		// The kernel writes back tap plus feedback times delayed, in that
		// order: float addition is not associative, so the term order is the
		// gate, not a detail.
		expect(mix.terms).toEqual([
			{ source: { kind: "input" }, gain: 1 },
			{ source: { kind: "temp", index: 0 }, gain: 0.6 },
		]);
		expect(mix.out).toBe(1);
		expect(push.line).toBe("dl");
		expect(push.input).toEqual({ kind: "temp", index: 1 });
	});

	it("selects the clock length mode when the block is clock-controlled", () => {
		const composed = decomposeDigitalDelayLine(
			delayMacro({
				clockControl: {
					controlId: "TIME",
					taper: "linear",
					ohmsAtControlMin: 1000,
					ohmsAtControlMax: 100000,
					farads: 1e-9,
					stages: 1024,
					formulaConstant: 1,
					offsetSeconds: 0,
				},
			}),
		);
		const tap = maybePosition(composed)?.ops[0];
		if (tap?.op !== "delay-tap") {
			throw new Error("expected a tap first");
		}
		expect(tap.length).toEqual({ mode: "clock" });
	});

	it("selects the parameter length mode on a valid parameter port", () => {
		const composed = decomposeDigitalDelayLine(
			delayMacro({
				parameter: { block: "P0", node: 0, referenceVolts: 1 },
			}),
		);
		const tap = maybePosition(composed)?.ops[0];
		if (tap?.op !== "delay-tap") {
			throw new Error("expected a tap first");
		}
		expect(tap.length).toEqual({ mode: "parameter" });
	});
});

describe("decomposeBucketBrigadeDelayLine", () => {
	function brigadeMacro(overrides: Record<string, unknown> = {}) {
		return {
			kind: "macro",
			id: "B0",
			modelId: "bucket-brigade-delay-line",
			parameters: { delaySeconds: 0.05, stages: 1024 },
			audioIn: null,
			audioOut: false,
			parameter: null,
			...overrides,
		} as Extract<Block, { kind: "macro" }>;
	}

	it("refuses other models", () => {
		expect(
			decomposeBucketBrigadeDelayLine({
				...brigadeMacro(),
				modelId: "digital-delay-line",
			}),
		).toBeNull();
	});

	it("emits coupling filter, fractional tap, and push in kernel order", () => {
		const composed = decomposeBucketBrigadeDelayLine(brigadeMacro());
		if (composed === null) {
			throw new Error("expected a decomposition");
		}
		expect(composed.kind).toBe("composed");
		expect(composed.id).toBe("B0");
		expect(composed.modelId).toBe("bucket-brigade-delay-line");
		expect(onlyPosition(composed).out).toBe(1);
		expect(onlyPosition(composed).lines).toEqual({ dl: { delaySeconds: 0.05, minSeconds: 0 } });
		expect(onlyPosition(composed).ops.map((op) => op.op)).toEqual([
			"filter-dcblock",
			"delay-tap-fractional",
			"delay-push",
		]);
		const filter = onlyPosition(composed).ops[0];
		const tap = onlyPosition(composed).ops[1];
		const push = onlyPosition(composed).ops[2];
		if (
			filter?.op !== "filter-dcblock" ||
			tap?.op !== "delay-tap-fractional" ||
			push?.op !== "delay-push"
		) {
			throw new Error("op order moved under the test");
		}
		// The kernel couples the tap to AC first, reads the delayed sample,
		// publishes it, and writes the AC back -- so the push takes the
		// filter's output, not the tap's.
		expect(filter.input).toEqual({ kind: "input" });
		expect(filter.out).toBe(0);
		expect(tap.length).toEqual({ mode: "capacity" });
		expect(tap.out).toBe(1);
		expect(push.line).toBe("dl");
		expect(push.input).toEqual({ kind: "temp", index: 0 });
	});

	it("carries no converter: the kernel performs no conversion stage", () => {
		// The row-4 converter question, answered by construction: no corpus
		// kernel compands or quantizes, so no decomposition names one. The
		// enum gains `converter` when a decomposition needs it, not before.
		const composed = decomposeBucketBrigadeDelayLine(brigadeMacro());
		expect(
			(maybePosition(composed)?.ops ?? []).some(
				(op) => op.op === ("converter" as string),
			),
		).toBe(false);
	});

	it("prioritises clock over modulation over parameter, like the kernel", () => {
		const withModulation = brigadeMacro({
			modulation: { block: "X", node: 0 },
			parameter: { block: "P0", node: 0, referenceVolts: 1 },
		});
		const tapMod = maybePosition(decomposeBucketBrigadeDelayLine(withModulation))?.ops[1];
		if (tapMod?.op !== "delay-tap-fractional") {
			throw new Error("expected a fractional tap second");
		}
		expect(tapMod.length).toEqual({ mode: "modulation" });
		const withClock = brigadeMacro({
			clockControl: {
				controlId: "TIME",
				taper: "linear",
				ohmsAtControlMin: 1000,
				ohmsAtControlMax: 100000,
				farads: 1e-9,
				stages: 1024,
				formulaConstant: 1,
				offsetSeconds: 0,
			},
			modulation: { block: "X", node: 0 },
		});
		const tapClock = maybePosition(decomposeBucketBrigadeDelayLine(withClock))?.ops[1];
		if (tapClock?.op !== "delay-tap-fractional") {
			throw new Error("expected a fractional tap second");
		}
		expect(tapClock.length).toEqual({ mode: "clock" });
	});

	it("prioritises a recognised clock law over the ratio fallback, carrying its constants", () => {
		const law = {
			rOhms: 150000,
			cFarads: 47e-12,
			vddVolts: 9,
			vthVolts: 4.757,
			vfVolts: 0.65,
			floorVolts: -5.35,
		};
		const withLaw = brigadeMacro({
			modulation: { block: "X", node: 0 },
			clockLaw: { block: "Y", node: 1, steeredBy: "Q5" },
			clockLawParams: law,
		});
		const tapLaw = maybePosition(decomposeBucketBrigadeDelayLine(withLaw))?.ops[1];
		if (tapLaw?.op !== "delay-tap-fractional") {
			throw new Error("expected a fractional tap second");
		}
		expect(tapLaw.length).toEqual({ mode: "clock-law", ...law, stages: 1024 });
		const composed = decomposeBucketBrigadeDelayLine(withLaw);
		expect(composed?.kind).toBe("composed");
		if (composed?.kind === "composed") {
			expect(composed.clockLaw).toEqual({ block: "Y", node: 1, steeredBy: "Q5" });
			expect(composed.clockLawParams).toEqual(law);
		}
		const withClock = brigadeMacro({
			clockControl: {
				controlId: "TIME",
				taper: "linear",
				ohmsAtControlMin: 1000,
				ohmsAtControlMax: 100000,
				farads: 1e-9,
				stages: 1024,
				formulaConstant: 1,
				offsetSeconds: 0,
			},
			clockLaw: { block: "Y", node: 1, steeredBy: "Q5" },
			clockLawParams: law,
		});
		const tapClock = maybePosition(decomposeBucketBrigadeDelayLine(withClock))?.ops[1];
		if (tapClock?.op !== "delay-tap-fractional") {
			throw new Error("expected a fractional tap second");
		}
		expect(tapClock.length).toEqual({ mode: "clock" });
	});
});

describe("decomposeDigitalReverbModule", () => {
	function reverbMacro(overrides: Record<string, unknown> = {}) {
		return {
			kind: "macro",
			id: "R0",
			modelId: "digital-reverb-module",
			parameters: { decaySeconds: 2.5, outputGain: 0.9205 },
			audioIn: null,
			audioOut: false,
			parameter: null,
			...overrides,
		} as Extract<Block, { kind: "macro" }>;
	}

	it("refuses other models", () => {
		expect(
			decomposeDigitalReverbModule({
				...reverbMacro(),
				modelId: "digital-delay-line",
			}),
		).toBeNull();
	});

	it("emits four combs averaged through two allpasses with output gain", () => {
		const composed = decomposeDigitalReverbModule(reverbMacro());
		if (composed === null) {
			throw new Error("expected a decomposition");
		}
		expect(composed.kind).toBe("composed");
		expect(composed.id).toBe("R0");
		expect(composed.modelId).toBe("digital-reverb-module");
		expect(onlyPosition(composed).out).toBe(8);
		expect(onlyPosition(composed).lines).toEqual({});
		expect(onlyPosition(composed).ops.map((op) => op.op)).toEqual([
			"comb",
			"comb",
			"comb",
			"comb",
			"mix",
			"mix",
			"allpass",
			"allpass",
			"mix",
		]);
		const combs = onlyPosition(composed).ops.slice(0, 4);
		for (let index = 0; index < 4; index += 1) {
			const comb = combs[index];
			if (comb?.op !== "comb") {
				throw new Error("expected four combs first");
			}
			// Index-addressed echo-density tables; only the decay varies.
			expect(comb.index).toBe(index);
			expect(comb.decaySeconds).toBe(2.5);
			expect(comb.input).toEqual({ kind: "input" });
			expect(comb.out).toBe(index);
		}
		const average = onlyPosition(composed).ops[4];
		const quarter = onlyPosition(composed).ops[5];
		if (average?.op !== "mix" || quarter?.op !== "mix") {
			throw new Error("expected the averaging pair fifth");
		}
		// The kernel sums full-size then divides once: unit gains here,
		// exact quarter after, never quartered inputs (different rounding).
		expect(
			average.terms.map((term) => [
				term.source,
				term.gain,
			]),
		).toEqual([
			[{ kind: "temp", index: 0 }, 1],
			[{ kind: "temp", index: 1 }, 1],
			[{ kind: "temp", index: 2 }, 1],
			[{ kind: "temp", index: 3 }, 1],
		]);
		expect(average.out).toBe(4);
		expect(quarter.terms).toEqual([
			{ source: { kind: "temp", index: 4 }, gain: 0.25 },
		]);
		expect(quarter.out).toBe(5);
		const first = onlyPosition(composed).ops[6];
		const second = onlyPosition(composed).ops[7];
		if (first?.op !== "allpass" || second?.op !== "allpass") {
			throw new Error("expected two diffusers seventh");
		}
		expect([first.index, second.index]).toEqual([0, 1]);
		expect(first.input).toEqual({ kind: "temp", index: 5 });
		expect(first.out).toBe(6);
		expect(second.input).toEqual({ kind: "temp", index: 6 });
		expect(second.out).toBe(7);
		const gain = onlyPosition(composed).ops[8];
		if (gain?.op !== "mix") {
			throw new Error("expected the output gain last");
		}
		expect(gain.terms).toEqual([
			{ source: { kind: "temp", index: 7 }, gain: 0.9205 },
		]);
		expect(gain.out).toBe(8);
	});

	it("drops ports the kernel has no branch for", () => {
		// The reverb kernel reads audioIn, decaySeconds, and outputGain and
		// nothing else: a clock, parameter, or modulation port on the block
		// would be dead data implying behaviour the composition lacks.
		const composed = decomposeDigitalReverbModule(
			reverbMacro({
				clockControl: {
					controlId: "TIME",
					taper: "linear",
					ohmsAtControlMin: 1000,
					ohmsAtControlMax: 100000,
					farads: 1e-9,
					stages: 1024,
					formulaConstant: 1,
					offsetSeconds: 0,
				},
				parameter: { block: "P0", node: 0, referenceVolts: 1 },
				modulation: { block: "X", node: 0 },
			}),
		);
		if (composed === null) {
			throw new Error("expected a decomposition");
		}
		expect(composed.clockControl).toBeUndefined();
		expect(composed.parameter).toBeNull();
		expect(composed.modulation).toBeUndefined();
	});
});
