// Stage 3 contract: laws, macro models, and the unsupported outcome.

import { describe, expect, it } from "bun:test";
import { compile } from "@vessel-dsp/compiler";
import { attachDeviceLaws, SUPPLY_SOURCE_OHMS } from "@vessel-dsp/compiler";
import { readNetlist } from "@vessel-dsp/compiler";
import { emptyRegistry, pinoutMatches, type PartRegistry } from "@vessel-dsp/compiler";
import { pedalPartCatalog } from "@vessel-dsp/compiler";
import {
	declaredRegulator,
	undeclaredRegulator,
	acMainsDivider,
	dcMainsDivider,
	diodeClipper,
	dualSectionChip,
	knownChip,
	potAntiLogarithmicTaper,
	potDivider,
	powerJackStrandedSupply,
	rcLowPass,
	resistorDivider,
	rheostatDivider,
	switchedJackContacts,
	unknownChip,
} from "./fixtures/circuits";
import { dualOpampRegistry, fixtureRegistry } from "./fixtures/registry";

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
