// Stage 5 contract: symbolic stamps, with rate and control left unevaluated.

import { describe, expect, it } from "bun:test";
import { compile } from "@vessel-dsp/compiler";
import { attachDeviceLaws } from "@vessel-dsp/compiler";
import {
	lower,
	STATE_SLOTS_PER_REACTIVE_ELEMENT,
	stampInSourceNodes,
} from "@vessel-dsp/compiler";
import { readNetlist } from "@vessel-dsp/compiler";
import { partition } from "@vessel-dsp/compiler";
import { emptyRegistry } from "@vessel-dsp/compiler";
import { computeStampPartition } from "@vessel-dsp/compiler";
import type { Block, Stamp } from "@vessel-dsp/compiler";
import {
	bridgeRectifier,
	centerTappedVoltageDerivedTransformer,
	cd4047BarePinMap,
	springReverbTank,
	clampPackageDiode,
	connectedAlternateTapTransformer,
	danglingAlternateTapTransformer,
	danglingSecondary4Transformer,
	diodeClipper,
	distinctAlternateTapsTransformer,
	dualAnodeRectifier,
	dualPlateTubeRectifier,
	knownChip,
	ne570TerminalMap,
	opampOnItsOwnRail,
	opampWithDegenerateRails,
	opampWithUnnamedInputs,
	potDivider,
	rheostatWithLevelRole,
	rheostatWithTimeConstantRole,
	powerTransformerVoltageDerived,
	quietSeedRheostat,
	railedAmplifier,
	rcLowPass,
	resistorDivider,
	reverbTankInputOutputTransformer,
	rlLowPass,
	switchedDivider,
	tappedPrimaryNoReferenceTransformer,
	tappedPrimaryOutputTransformer,
	twoLiveSecondaryTaps,
	twoDiodeClippers,
	twoWindingVoltageDerivedTransformer,
	mn3007RoleMap,
	mn3007BarePinMap,
	mn3207RoleMap,
	mn3207BarePinMap,
	derive,
} from "./fixtures/circuits";
import { pedalPartCatalog } from "@vessel-dsp/compiler";
import {
	centerTappedVoltageDerivedRmsPerHalf,
	drivenWindingPeak,
	powerTransformerFilamentRms,
	powerTransformerHvRmsPerHalf,
	powerTransformerRectifierHeaterRms,
	reverbTankInputOutputRatio,
	twoWindingVoltageDerivedRms,
} from "./fixtures/expected";
import { fixtureRegistry } from "./fixtures/registry";

function blocksFor(source: string, registry = emptyRegistry): readonly Block[] {
	const lawed = attachDeviceLaws(readNetlist(source), registry);
	return lower(partition(lawed), lawed);
}

/**
 * A block's row -> the source node id the fixture declares, via `Block.nodeIds`.
 *
 * The topology assertions below are written in the node ids the `.vdsp` fixtures author
 * ("`ac_a` on node 2, `positive` on 4"), which is deliberate -- they state the circuit
 * rather than snapshot whatever the code emitted. A block numbers its own rows, so the
 * stamps are read back through this to keep those assertions in the fixture's own terms.
 */
function sourceNodeOf(
	block: Extract<Block, { readonly kind: "mna" }>,
): (row: number) => number {
	return (row) => block.nodeIds[row] as number;
}

describe("lower", () => {
	it("emits conductance stamps for resistors", () => {
		const [block] = blocksFor(resistorDivider);
		expect(block?.kind).toBe("mna");
		if (block?.kind === "mna") {
			const conductances = block.stamps.filter(
				(stamp) => stamp.kind === "conductance",
			);
			expect(conductances).toHaveLength(2);
		}
	});

	it("leaves the capacitor's conductance unevaluated, because it needs a rate", () => {
		const [block] = blocksFor(rcLowPass);
		if (block?.kind !== "mna") {
			throw new Error("expected an mna block");
		}
		const capacitor = block.stamps.find((stamp) => stamp.kind === "capacitor");
		expect(capacitor).toBeDefined();
		if (capacitor?.kind === "capacitor") {
			// Farads, not siemens: 2C/dt cannot be computed without a sample rate.
			expect(capacitor.farads).toBeCloseTo(10e-9, 15);
			expect(Object.keys(capacitor)).not.toContain("siemens");
		}
	});

	// Declared-only capacitor DC leakage. The negative controls matter more than the
	// positives here: an undeclared capacitor staying ideal is what keeps a floating
	// bias network diagnosable, so a leak appearing without a declaration is the
	// failure mode these exist to catch.
	it("gives a capacitor declaring InsulationResistance a parallel conductance", () => {
		const leaky = derive(
			rcLowPass,
			'Capacitance: "10n"',
			'Capacitance: "10n"\n      InsulationResistance: "100 MΩ"',
		);
		const [block] = blocksFor(leaky);
		if (block?.kind !== "mna") {
			throw new Error("expected an mna block");
		}
		const conductances = block.stamps.filter(
			(stamp) => stamp.kind === "conductance",
		);
		// R1's, plus the leak.
		expect(conductances).toHaveLength(2);
		const leak = conductances.find(
			(stamp) => stamp.kind === "conductance" && stamp.siemens < 1e-6,
		);
		expect(leak).toBeDefined();
		if (leak?.kind === "conductance") {
			expect(leak.siemens).toBeCloseTo(1e-8, 12);
		}
	});

	it("reads the electrolytic form, LeakageCurrent at VoltageRating, as V over I", () => {
		const leaky = derive(
			rcLowPass,
			'Capacitance: "10n"',
			'Capacitance: "10n"\n      LeakageCurrent: "4 μA"\n      VoltageRating: "16 V"',
		);
		const [block] = blocksFor(leaky);
		if (block?.kind !== "mna") {
			throw new Error("expected an mna block");
		}
		const leak = block.stamps.find(
			(stamp) => stamp.kind === "conductance" && stamp.siemens < 1e-6,
		);
		expect(leak).toBeDefined();
		if (leak?.kind === "conductance") {
			// 4 µA / 16 V = 250 nS, i.e. 4 MΩ.
			expect(leak.siemens).toBeCloseTo(2.5e-7, 12);
		}
	});

	it("keeps an undeclared capacitor ideal: exactly one conductance, the resistor's", () => {
		const [block] = blocksFor(rcLowPass);
		if (block?.kind !== "mna") {
			throw new Error("expected an mna block");
		}
		const conductances = block.stamps.filter(
			(stamp) => stamp.kind === "conductance",
		);
		expect(conductances).toHaveLength(1);
	});

	// A potentiometer's declared end resistance. This was read only for a rheostat, so a
	// `MinResistance` on a pot was parsed and dropped; these cover the field arriving and
	// the two ways it is refused.
	it("carries a potentiometer's declared MinResistance onto both track halves", () => {
		const withResidual = derive(
			potDivider,
			'Resistance: "10k"',
			'Resistance: "10k"\n      MinResistance: "100"',
		);
		const [block] = blocksFor(withResidual);
		if (block?.kind !== "mna") {
			throw new Error("expected an mna block");
		}
		const legs = block.stamps.filter(
			(stamp) => stamp.kind === "controlled-conductance",
		);
		// Both halves of one track, each keeping a residual at its own end.
		expect(legs).toHaveLength(2);
		for (const leg of legs) {
			if (leg.kind === "controlled-conductance") {
				expect(leg.residualOhms).toBeCloseTo(100, 9);
				// The residual is taken out of the track, not added to it.
				expect(leg.totalOhms).toBeCloseTo(10000, 9);
			}
		}
	});

	it("lets declaration order orient a rheostat whose control names a time constant", () => {
		// The quiet-distance rule exists to make a rising knob mean louder. A rheostat setting
		// an RC has no such reading -- `boss-nf-1-noise-gate`'s `DECAY` renders the same level
		// at both ends of its sweep -- so the rule has nothing to go on and picked the side that
		// ran the knob backwards: 240 ms at full clockwise where the ET-45C service note sets
		// DECAY full clockwise for its 1.5-2 s decay.
		const [block] = blocksFor(rheostatWithTimeConstantRole);
		if (block?.kind !== "mna") {
			throw new Error("expected an mna block");
		}
		const legs = block.stamps.filter(
			(stamp) => stamp.kind === "controlled-conductance",
		);
		expect(legs).toHaveLength(2);
		// The wiper shares its node with the declared second end, so that leg is the shorted
		// one and the live leg is `end1`-to-wiper. Declaration order keeps it on `upper`;
		// quiet-distance would have swapped the ends and moved it to `lower`.
		const live = legs.find(
			(leg) => leg.kind === "controlled-conductance" && leg.a !== leg.b,
		);
		if (live?.kind !== "controlled-conductance") {
			throw new Error("expected one live leg");
		}
		expect(live.side).toBe("upper");
	});

	it("keeps the quiet-distance rule for a rheostat whose control names a level", () => {
		// The counter-case, and the reason the exemption is keyed on the role rather than on the
		// rheostat shape alone. Applying it to every rheostat was measured across the corpus:
		// it inverts four knobs that are right today, including `boss-fa-1`'s `VOLUME`, which
		// would go from 6.4e-7 -> 9.3e-1 across its sweep to 9.3e-1 -> 6.4e-7 and mute the pedal
		// at full volume.
		const [block] = blocksFor(rheostatWithLevelRole);
		if (block?.kind !== "mna") {
			throw new Error("expected an mna block");
		}
		const legs = block.stamps.filter(
			(stamp) => stamp.kind === "controlled-conductance",
		);
		expect(legs).toHaveLength(2);
		const live = legs.find(
			(leg) => leg.kind === "controlled-conductance" && leg.a !== leg.b,
		);
		if (live?.kind !== "controlled-conductance") {
			throw new Error("expected one live leg");
		}
		// Quiet-distance sees the grounded end, swaps the ends, and puts the live leg on
		// `lower` -- the opposite of what the time-constant fixture above gets.
		expect(live.side).toBe("lower");
	});

	it("leaves an undeclared potentiometer ideal, with a zero residual", () => {
		const [block] = blocksFor(potDivider);
		if (block?.kind !== "mna") {
			throw new Error("expected an mna block");
		}
		const legs = block.stamps.filter(
			(stamp) => stamp.kind === "controlled-conductance",
		);
		expect(legs).toHaveLength(2);
		for (const leg of legs) {
			if (leg.kind === "controlled-conductance") {
				expect(leg.residualOhms).toBe(0);
			}
		}
	});

	it("refuses a residual at or above half the track, which would leave no travel", () => {
		// 6k of a 10k track: both ends would claim it and the wiper would have none.
		const tooLarge = derive(
			potDivider,
			'Resistance: "10k"',
			'Resistance: "10k"\n      MinResistance: "6k"',
		);
		const [block] = blocksFor(tooLarge);
		if (block?.kind !== "mna") {
			throw new Error("expected an mna block");
		}
		const legs = block.stamps.filter(
			(stamp) => stamp.kind === "controlled-conductance",
		);
		expect(legs).toHaveLength(2);
		for (const leg of legs) {
			if (leg.kind === "controlled-conductance") {
				expect(leg.residualOhms).toBe(0);
			}
		}
	});

	it("refuses a LeakageCurrent with no VoltageRating rather than guessing a voltage", () => {
		const declaredCurrentOnly = derive(
			rcLowPass,
			'Capacitance: "10n"',
			'Capacitance: "10n"\n      LeakageCurrent: "4 μA"',
		);
		const [block] = blocksFor(declaredCurrentOnly);
		if (block?.kind !== "mna") {
			throw new Error("expected an mna block");
		}
		const conductances = block.stamps.filter(
			(stamp) => stamp.kind === "conductance",
		);
		expect(conductances).toHaveLength(1);
	});

	it("contains no sample rate anywhere in a lowered program", () => {
		const serialized = JSON.stringify(blocksFor(rcLowPass));
		expect(serialized).not.toContain("sampleRate");
		expect(serialized).not.toContain("48000");
		expect(serialized).not.toContain("44100");
	});

	it("leaves a pot's conductance unevaluated, carrying the track and the taper", () => {
		const [block] = blocksFor(potDivider);
		if (block?.kind !== "mna") {
			throw new Error("expected an mna block");
		}
		const controlled = block.stamps.filter(
			(stamp) => stamp.kind === "controlled-conductance",
		);
		// Both halves of the track, so the wiper node is real.
		expect(controlled).toHaveLength(2);
		if (controlled[0]?.kind === "controlled-conductance") {
			expect(controlled[0].totalOhms).toBe(10_000);
			expect(controlled[0].control).toBe("Level");
		}
	});

	it("marks a diode region nonlinear and allocates no state for it", () => {
		const [block] = blocksFor(diodeClipper);
		if (block?.kind !== "mna") {
			throw new Error("expected an mna block");
		}
		expect(block.linear).toBe(false);
		expect(block.stateCount).toBe(0);
	});

	describe("linear and controlFree, the precondition for factoring once", () => {
		function mnaBlockFor(source: string): Extract<Block, { kind: "mna" }> {
			const [block] = blocksFor(source);
			if (block?.kind !== "mna") {
				throw new Error("expected an mna block");
			}
			return block;
		}

		it("calls a resistive divider both linear and control-free", () => {
			// The only shape a later step may factor once and reuse for the whole run.
			const block = mnaBlockFor(resistorDivider);
			expect(block.linear).toBe(true);
			expect(block.controlFree).toBe(true);
		});

		it("keeps a reactive circuit linear: state is not curvature", () => {
			// A capacitor's companion conductance is a constant at a fixed rate, so an RC
			// network still solves in one pass. Calling it nonlinear would be safe and would
			// also cost every reactive block an iteration cap it does not need.
			expect(mnaBlockFor(rcLowPass).linear).toBe(true);
			expect(mnaBlockFor(rlLowPass).linear).toBe(true);
		});

		it("calls a pot divider linear and not control-free", () => {
			// The two flags are independent, and this is the case that proves it: nothing here
			// needs Newton, and every coefficient moves when the knob does.
			const block = mnaBlockFor(potDivider);
			expect(block.linear).toBe(true);
			expect(block.controlFree).toBe(false);
		});

		it("calls a switched divider not control-free", () => {
			// A switch is a control-dependent conductance, so it disqualifies a block from
			// being factored once even though it needs no iteration.
			const block = mnaBlockFor(switchedDivider);
			expect(block.linear).toBe(true);
			expect(block.controlFree).toBe(false);
		});

		it("calls a diode clipper control-free but not linear", () => {
			// The other diagonal. A block can be constant in the controls and still need
			// Newton, which is why one flag cannot stand in for the other.
			const block = mnaBlockFor(diodeClipper);
			expect(block.linear).toBe(false);
			expect(block.controlFree).toBe(true);
		});

		it("reads a tube diode as nonlinear", () => {
			// Space charge is a 3/2 power law. A rectifier read as linear would flatten the
			// drop that *is* sag into a fixed offset -- and it would be read from the stamp,
			// so the stamp classifier has to know the kind, not just the law.
			expect(
				blocksFor(dualPlateTubeRectifier).some(
					(block) => block.kind === "mna" && !block.linear,
				),
			).toBe(true);
		});
	});

	it("declares enough state slots to cover every slot a stamp addresses", () => {
		// The ROM contract, not a count: whatever executes this program allocates
		// `stateCount` slots, so every offset a stamp reaches must fall inside it. A
		// reactive element needs two -- the voltage across it and the current through it --
		// and declaring one apiece understated the state by half. Against a JS array that
		// grows on write it was invisible; a `Float64Array(stateCount)` in C++/WASM/ESP32
		// would have dropped every capacitor's current memory and rendered a plausible,
		// wrong circuit.
		//
		// Asserted as an invariant rather than a number so a third reactive element, or a
		// companion model needing a third slot, cannot quietly break the contract again.
		for (const source of [rcLowPass, rlLowPass, twoDiodeClippers]) {
			for (const block of blocksFor(source)) {
				if (block.kind !== "mna") {
					continue;
				}
				for (const stamp of block.stamps) {
					if (stamp.kind !== "capacitor" && stamp.kind !== "inductor") {
						continue;
					}
					const highest =
						stamp.stateIndex + STATE_SLOTS_PER_REACTIVE_ELEMENT - 1;
					expect(highest).toBeLessThan(block.stateCount);
				}
			}
		}
	});

	it("gives each reactive element its own slots", () => {
		// Two elements must not share: overlapping offsets would make one capacitor's
		// memory the other's, which is a circuit nobody drew.
		const offsets = blocksFor(rlLowPass)
			.filter((block) => block.kind === "mna")
			.flatMap((block) =>
				block.stamps
					.filter(
						(stamp) => stamp.kind === "capacitor" || stamp.kind === "inductor",
					)
					.map((stamp) => (stamp as { stateIndex: number }).stateIndex),
			);
		expect(new Set(offsets).size).toBe(offsets.length);
	});

	it("emits a macro block that references a model rather than implementing one", () => {
		const blocks = blocksFor(knownChip, fixtureRegistry);
		const macro = blocks.find((block) => block.kind === "macro");
		expect(macro?.kind).toBe("macro");
		if (macro?.kind === "macro") {
			expect(macro.modelId).toBe("bucket-brigade-delay-line");
			// The pedal's own declared delay, carried as a time: the registry states the part
			// and the source states how it is clocked.
			expect(macro.parameters.delaySeconds).toBeCloseTo(0.003, 9);
		}
	});
});

describe("a dual tube rectifier is two elements in one component", () => {
	it("stamps one element per plate, sharing the cathode", () => {
		// The corpus's shape: `plate_a`, `plate_b`, `cathode_filament`, `heater_a`, `heater_b`.
		// Taking the first plate and dropping the second is a full-wave rectifier reduced to
		// half-wave, which renders -- with twice the ripple and half the current.
		const [block] = blocksFor(dualPlateTubeRectifier);
		if (block?.kind !== "mna") {
			throw new Error("expected an mna block");
		}
		const plates = block.stamps.filter((stamp) => stamp.kind === "tube-diode");
		expect(plates).toHaveLength(2);
		const cathodes = new Set(
			plates.map((stamp) => (stamp.kind === "tube-diode" ? stamp.cathode : -1)),
		);
		const anodes = new Set(
			plates.map((stamp) => (stamp.kind === "tube-diode" ? stamp.plate : -1)),
		);
		// One cathode, two distinct plates, and neither plate is the cathode.
		expect(cathodes.size).toBe(1);
		expect(anodes.size).toBe(2);
		expect([...anodes]).not.toContain([...cathodes][0]);
	});

	it("reads the heaters and gives them no element", () => {
		// A heater carries no signal current, so its node holds nothing but `gmin` -- the same
		// place a pentode's heater and a FET's gate already sit. Stamping one would put the
		// filament winding in the B+ path.
		const [block] = blocksFor(dualPlateTubeRectifier);
		if (block?.kind !== "mna") {
			throw new Error("expected an mna block");
		}
		const touched = new Set(
			block.stamps.flatMap((stamp) =>
				Object.entries(stamp).flatMap(([key, value]) =>
					typeof value === "number" &&
					[
						"a",
						"b",
						"plate",
						"cathode",
						"positive",
						"negative",
						"node",
					].includes(key)
						? [value]
						: [],
				),
			),
		);
		// The fixture puts the heaters alone on nodes 6 and 7.
		expect(touched.has(6)).toBe(false);
		expect(touched.has(7)).toBe(false);
	});
});

describe("a diode component can be several junctions", () => {
	function junctionsOf(source: string) {
		const [block] = blocksFor(source);
		if (block?.kind !== "mna") {
			throw new Error("expected an mna block");
		}
		const node = sourceNodeOf(block);
		return block.stamps.flatMap((stamp) =>
			stamp.kind === "diode"
				? [{ anode: node(stamp.anode), cathode: node(stamp.cathode) }]
				: [],
		);
	}

	it("lowers a bridge to its four junctions, in the right direction", () => {
		// The fixture declares `ac_a` on node 2, `ac_b` on 3, `positive` on 4 and `negative` on
		// ground. A bridge is then each AC leg up to the positive rail and each one fed from the
		// negative rail -- expressed from the declared nodes rather than as a snapshot, so the
		// assertion states the topology instead of recording what the code did.
		const junctions = junctionsOf(bridgeRectifier);
		expect(junctions).toHaveLength(4);
		const has = (anode: number, cathode: number) =>
			junctions.some(
				(junction) => junction.anode === anode && junction.cathode === cathode,
			);
		for (const leg of [2, 3]) {
			expect(has(leg, 4)).toBe(true);
			expect(has(0, leg)).toBe(true);
		}
		// And nothing between the two AC legs, which is what the positional reading produced:
		// one junction across the winding, with both DC terminals touching nothing.
		expect(has(2, 3)).toBe(false);
		expect(has(3, 2)).toBe(false);
	});

	it("lowers a shared-cathode pack to one junction per anode, ignoring the heaters", () => {
		const junctions = junctionsOf(dualAnodeRectifier);
		expect(junctions).toHaveLength(2);
		// One cathode, both anodes on it.
		expect(new Set(junctions.map((junction) => junction.cathode)).size).toBe(1);
		expect(new Set(junctions.map((junction) => junction.anode)).size).toBe(2);
		// The heaters sit alone on nodes 5 and 6 and carry no signal current, exactly as a
		// pentode's and a tube diode's do.
		const [block] = blocksFor(dualAnodeRectifier);
		if (block?.kind !== "mna") {
			throw new Error("expected an mna block");
		}
		const touched = new Set(
			block.stamps.flatMap((stamp) =>
				Object.entries(stamp).flatMap(([key, value]) =>
					typeof value === "number" &&
					[
						"a",
						"b",
						"anode",
						"cathode",
						"positive",
						"negative",
						"node",
					].includes(key)
						? [value]
						: [],
				),
			),
		);
		expect(touched.has(5)).toBe(false);
		expect(touched.has(6)).toBe(false);
	});

	it("refuses a multi-terminal diode whose roles name no topology", () => {
		// The negative control. This shape compiled before -- a junction between whichever two
		// terminals came first -- so the pedal rendered a device the source does not contain.
		const result = compile(clampPackageDiode, { registry: emptyRegistry });
		expect(result.status).toBe("unsupported");
		if (result.status !== "unsupported") {
			return;
		}
		expect(result.reasons).toHaveLength(1);
		expect(result.reasons[0]?.stage).toBe("lower");
		expect(result.reasons[0]?.device).toBe("DBRIDGE");
	});
});

describe("a transformer specified by winding voltages drives each winding directly", () => {
	// 2026-08-14: a power transformer's windings lower to one `ac-source` each at the winding's
	// own stated voltage, and its primary is not modelled at all -- an amp's audio is downstream
	// of the secondaries, so the mains side is not needed to solve it. See `transformerWindings`
	// in `lower.ts` for the argument and for what the model cannot represent.
	//
	// Every fixture here also declares a mains inlet on node 1, which is the frequency's source
	// and is itself an `ac-source`, so `positive !== 1` separates the driven windings from it.
	function drivenStamps(source: string) {
		const [block] = blocksFor(source);
		if (block?.kind !== "mna") {
			throw new Error("expected an mna block");
		}
		// Read back in the fixture's own declared node ids -- see `sourceNodeOf`.
		return block.stamps
			.map((stamp) => stampInSourceNodes(block, stamp))
			.filter(
				(stamp): stamp is Extract<typeof stamp, { kind: "ac-source" }> =>
					stamp.kind === "ac-source",
			)
			.filter((stamp) => stamp.positive !== 1);
	}

	function coupledStamps(source: string) {
		const [block] = blocksFor(source);
		if (block?.kind !== "mna") {
			throw new Error("expected an mna block");
		}
		return block.stamps.filter((stamp) => stamp.kind === "transformer");
	}

	it("drives an untapped winding at its own voltage, and stamps no transformer at all", () => {
		const stamps = drivenStamps(twoWindingVoltageDerivedTransformer);
		expect(stamps).toHaveLength(1);
		expect(stamps[0]?.amplitudeVolts).toBeCloseTo(
			drivenWindingPeak(twoWindingVoltageDerivedRms),
			10,
		);
		expect(stamps[0]?.positive).toBe(2);
		expect(stamps[0]?.negative).toBe(0);
		// The frequency comes from the document's AC supply, because a transformer does not
		// change frequency -- the same place a coupled winding used to inherit it from.
		expect(stamps[0]?.frequencyHz).toBe(60);
		// The negative control for "no primary is modelled": a coupled stamp here would mean the
		// old ratio path is still live and the fixture's typed `PrimaryVoltage: 120` is still in
		// the answer.
		expect(coupledStamps(twoWindingVoltageDerivedTransformer)).toHaveLength(0);
	});

	it("puts one source of the stated size across each half of a centre-tapped winding", () => {
		const stamps = drivenStamps(centerTappedVoltageDerivedTransformer);
		// Two sources, one per half: (hv_a, hv_center_tap) and (hv_center_tap, hv_b), so the two
		// ends swing in antiphase about the tap and the rectifier downstream is full-wave rather
		// than half-wave.
		expect(stamps).toHaveLength(2);
		expect(
			new Set(stamps.map((stamp) => `${stamp.positive}-${stamp.negative}`)),
		).toEqual(new Set(["2-0", "0-3"]));
		for (const stamp of stamps) {
			// The stated 20 V is already the per-half figure (`20-0-20` is printed as 20), so each
			// half gets 20 V and neither gets 40. The `not` is the negative control: doubling is
			// the silent-truncation failure mode this transformer work has been bitten by before.
			expect(stamp.amplitudeVolts).toBeCloseTo(
				drivenWindingPeak(centerTappedVoltageDerivedRmsPerHalf),
				10,
			);
			expect(stamp.amplitudeVolts).not.toBeCloseTo(
				drivenWindingPeak(centerTappedVoltageDerivedRmsPerHalf * 2),
				10,
			);
		}
	});

	it("drives each of a power transformer's three windings at its own voltage", () => {
		const stamps = drivenStamps(powerTransformerVoltageDerived);
		// hv (tapped, 2 sources) + rectifierheater (1) + filament (1) = 4. Three voltages off one
		// core is what no single `Ratio` can express.
		expect(stamps).toHaveLength(4);
		const byPair = new Map(
			stamps.map((stamp) => [
				`${stamp.positive}-${stamp.negative}`,
				stamp.amplitudeVolts,
			]),
		);
		// hv_a=2, hv_center_tap=0, hv_b=3; rectifier_heater_a=4, _b=0; filament_a=5, _b=0.
		expect(byPair.get("2-0")).toBeCloseTo(
			drivenWindingPeak(powerTransformerHvRmsPerHalf),
			10,
		);
		expect(byPair.get("0-3")).toBeCloseTo(
			drivenWindingPeak(powerTransformerHvRmsPerHalf),
			10,
		);
		expect(byPair.get("4-0")).toBeCloseTo(
			drivenWindingPeak(powerTransformerRectifierHeaterRms),
			10,
		);
		expect(byPair.get("5-0")).toBeCloseTo(
			drivenWindingPeak(powerTransformerFilamentRms),
			10,
		);
	});

	it("leaves a coil the source states no voltage for undriven, whatever its role", () => {
		// `fender-bassman`'s rectifier heater is the corpus case: its packet's own `Derivation`
		// says the 5 V is "assumed from GZ34 heater, unprinted on selected schematic" and that
		// typing it would be the invented-typical-value inference the source discipline forbids.
		// So the absence is a decision, and it used to be excused by a five-name class set that
		// could not see the reason. It is now read from the coil, and the coil's role does not
		// enter into it -- which this checks by removing the *HV* coil's voltage, the one the old
		// class set refused for.
		const withoutOne = derive(
			powerTransformerVoltageDerived,
			`        voltage:
          raw: "5 VAC rectifier heater winding"
          value: 5
          unit: "V"
`,
			"",
		);
		expect(compile(withoutOne, { registry: emptyRegistry }).status).toBe("ok");

		const withoutHv = derive(
			powerTransformerVoltageDerived,
			`        voltage:
          raw: "250-0-250 VAC RMS derived, per-half voltage"
          value: 250
          unit: "V"
`,
			"",
		);
		expect(compile(withoutHv, { registry: emptyRegistry }).status).toBe("ok");

		// What is still refused is a transformer stating no coil voltage *at all*, which is a
		// device nothing can be stamped from rather than a coil deliberately left unrated.
		const withNone = powerTransformerVoltageDerived.replaceAll(
			/\n        voltage:\n(?:          .*\n)+/g,
			"\n",
		);
		expect(withNone).not.toBe(powerTransformerVoltageDerived);
		const bare = compile(withNone, { registry: emptyRegistry });
		expect(bare.status).toBe("unsupported");
		if (bare.status !== "unsupported") return;
		expect(bare.reasons[0]?.device).toBe("T1");
	});

	it("refuses when the document states no frequency for the windings to run at", () => {
		// `vox-ac15-top-boost` declares no supply component at all, so nothing in it says what its
		// power transformer's secondaries run at. A voltage with no frequency is not a waveform,
		// and choosing 50 or 60 would be inventing the amp's hum.
		const withoutFrequency = twoWindingVoltageDerivedTransformer.replace(
			`      Frequency:
        raw: 60 Hz nominal
        value: 60
        unit: Hz
`,
			"",
		);
		expect(withoutFrequency).not.toBe(twoWindingVoltageDerivedTransformer);
		const result = compile(withoutFrequency, { registry: emptyRegistry });
		expect(result.status).toBe("unsupported");
		if (result.status !== "unsupported") {
			return;
		}
		expect(result.reasons[0]?.stage).toBe("lower");
		expect(result.reasons[0]?.device).toBe("T1");
	});
});

describe("terminal-role and property synonyms added 2026-08-14, grouping the 22 amp refusals", () => {
	// Surveyed while grouping which of the 22 refusals left after the transformer-ratio work
	// were one source fact away versus hiding a second, consumer-side gap behind the first --
	// changelog/2026-08-14.md's `marshall-jtm45` bias-tap follow-up entry. Each synonym below
	// recurred at least twice across the real amp corpus with no conflicting second meaning in
	// any one document, the same bar `secondary16` cleared when it was added.
	function transformerStamps(source: string) {
		const [block] = blocksFor(source);
		if (block?.kind !== "mna") {
			throw new Error("expected an mna block");
		}
		// Read back in the fixture's own declared node ids -- see `sourceNodeOf`.
		return block.stamps
			.map((stamp) => stampInSourceNodes(block, stamp))
			.filter(
				(stamp): stamp is Extract<typeof stamp, { kind: "transformer" }> =>
					stamp.kind === "transformer",
			);
	}

	// Both power-transformer synonyms below are on the driven path, so what proves the synonym
	// reached the answer is a winding source at the right node pair -- the primary spelling
	// matters because an unrecognised role is a refusal, not because the primary is stamped.
	function drivenWindingStamps(source: string) {
		const [block] = blocksFor(source);
		if (block?.kind !== "mna") {
			throw new Error("expected an mna block");
		}
		return block.stamps
			.map((stamp) => stampInSourceNodes(block, stamp))
			.filter(
				(stamp): stamp is Extract<typeof stamp, { kind: "ac-source" }> =>
					stamp.kind === "ac-source",
			)
			.filter((stamp) => stamp.positive !== 1);
	}

	it("treats a mislabelled tank's drive coil as the primary, so it still lowers", () => {
		const stamps = transformerStamps(reverbTankInputOutputTransformer);
		expect(stamps).toHaveLength(1);
		expect(stamps[0]?.turnsRatio).toBeCloseTo(reverbTankInputOutputRatio, 10);
		expect(stamps[0]?.primaryPlus).toBe(1);
		expect(stamps[0]?.primaryMinus).toBe(0);
		expect(stamps[0]?.secondaryPlus).toBe(2);
		expect(stamps[0]?.secondaryMinus).toBe(0);
	});

	it("drops a dangling secondary_4 the same way secondary_8 already drops", () => {
		const stamps = transformerStamps(danglingSecondary4Transformer);
		expect(stamps).toHaveLength(2);
		for (const stamp of stamps) {
			expect(stamp.secondaryPlus).not.toBe(5);
			expect(stamp.secondaryMinus).not.toBe(5);
		}
	});

	it("refuses a wired alternate tap whether or not a third tap is declared beside it", () => {
		// secondary_8 is wired to a load here (as in connectedAlternateTapTransformer) and must
		// still refuse with secondary_4 (dangling) also present -- so the connectivity test picks
		// the wired tap regardless of how many others the coil declares.
		const result = compile(distinctAlternateTapsTransformer, {
			registry: emptyRegistry,
		});
		expect(result.status).toBe("unsupported");
		if (result.status !== "unsupported") {
			return;
		}
		expect(result.reasons[0]?.stage).toBe("lower");
		expect(result.reasons[0]?.device).toBe("T1");
	});
});

describe("a tapped primary swaps to the secondary as its shared reference", () => {
	// v2/transformer-primary-tap milestone: the ordinary push-pull output-transformer shape --
	// a centre-tapped primary -- used to refuse outright. `fender-5e3-deluxe-tweed` and
	// `vox-ac30-top-boost` compile end to end once this lands (see the changelog for the
	// measured projection); this file's fixtures are hand-computed proxies for that shape.
	function transformerStamps(source: string) {
		const [block] = blocksFor(source);
		if (block?.kind !== "mna") {
			throw new Error("expected an mna block");
		}
		// Read back in the fixture's own declared node ids -- see `sourceNodeOf`.
		return block.stamps
			.map((stamp) => stampInSourceNodes(block, stamp))
			.filter(
				(stamp): stamp is Extract<typeof stamp, { kind: "transformer" }> =>
					stamp.kind === "transformer",
			);
	}

	it("stamps each primary half against the untapped secondary, ratio halved and inverted", () => {
		const stamps = transformerStamps(tappedPrimaryOutputTransformer);
		// declaredRatio = sqrt(4000/10) = 20; swapped ratio = 2/20 = 0.1 per half, applied
		// directly -- not doubled again, the same rule an overridden winding already follows.
		expect(stamps).toHaveLength(2);
		const byPair = new Map(
			stamps.map((stamp) => [
				`${stamp.secondaryPlus}-${stamp.secondaryMinus}`,
				stamp,
			]),
		);
		// primary_a=1, primary_ct=4, primary_b=0.
		const half1 = byPair.get("1-4");
		const half2 = byPair.get("4-0");
		expect(half1).toBeDefined();
		expect(half2).toBeDefined();
		expect(half1?.turnsRatio).toBeCloseTo(0.1, 10);
		expect(half2?.turnsRatio).toBeCloseTo(0.1, 10);
		// The reference is the secondary (hot=3, common=0), on BOTH stamps -- one shared
		// reference is the entire point of the reduction, swapped or not.
		for (const stamp of [half1, half2]) {
			expect(stamp?.primaryPlus).toBe(3);
			expect(stamp?.primaryMinus).toBe(0);
		}
	});

	it("drops a dangling alternate tap rather than guessing a ratio for it", () => {
		// vox-ac30-top-boost's exact shape: an "8 ohm alternate" terminal beside the wired 16
		// ohm one, connected to nothing else in the document. Must compile to the identical two
		// stamps as the base fixture -- no third stamp, no stamp touching node 5 at all.
		const stamps = transformerStamps(danglingAlternateTapTransformer);
		expect(stamps).toHaveLength(2);
		for (const stamp of stamps) {
			expect(stamp.secondaryPlus).not.toBe(5);
			expect(stamp.secondaryMinus).not.toBe(5);
		}
	});

	it("refuses an alternate tap once connectivity says it is actually in use", () => {
		// The negative control for the previous test: the same tap, now wired to a load. A
		// reader that dropped it by spelling rather than by connectivity would silently produce
		// the same two stamps here too, and this is the case where that would be wrong.
		const result = compile(connectedAlternateTapTransformer, {
			registry: emptyRegistry,
		});
		expect(result.status).toBe("unsupported");
		if (result.status !== "unsupported") {
			return;
		}
		expect(result.reasons[0]?.stage).toBe("lower");
		expect(result.reasons[0]?.device).toBe("T1");
	});

	it("refuses a tapped primary with no untapped winding to pivot the reduction on", () => {
		const result = compile(tappedPrimaryNoReferenceTransformer, {
			registry: emptyRegistry,
		});
		expect(result.status).toBe("unsupported");
		if (result.status !== "unsupported") {
			return;
		}
		expect(result.reasons[0]?.stage).toBe("lower");
		expect(result.reasons[0]?.device).toBe("T1");
	});

	describe("an op-amp's rails come from its own supply pins", () => {
		// The rail lookup used to accept only the exact spellings `vcc`/`vee`; everything
		// else fell through to the circuit's supply *extremes*, which is the widest pair in
		// the document. A fallback is right for an op-amp that states no supply at all. For
		// one that states it under another name it is a wrong answer that still renders --
		// and it lands on the clipping ceiling, which for a drive pedal is the whole point
		// of the part.
		const opampStamps = (source: string) => {
			const result = compile(source, { registry: emptyRegistry });
			expect(result.status).toBe("ok");
			if (result.status !== "ok") throw new Error("did not compile");
			const stamps = result.program.blocks.flatMap((block) =>
				block.kind === "mna"
					? block.stamps.filter((stamp) => stamp.kind === "ideal-opamp")
					: [],
			);
			expect(stamps.length).toBeGreaterThan(0);
			return stamps;
		};

		it("takes the circuit's supply set when the op-amp declares no supply pins", () => {
			// The baseline, and the behaviour that must not change: three terminals, no
			// supply pins, so the +9/-9 supply set is the only evidence available.
			for (const stamp of opampStamps(railedAmplifier)) {
				if (stamp.kind !== "ideal-opamp") continue;
				expect(stamp.railHigh).toBe(9);
				expect(stamp.railLow).toBe(-9);
			}
		});

		it("prefers the op-amp's own +4 V rail over the circuit's wider extremes", () => {
			// `vPlus` on a +4 V node, `vMinus` on ground, inside a circuit whose supply set
			// is +9/-9. Neither 4 nor 0 is a circuit extreme, so this cannot pass by
			// coincidence -- and both numbers being wrong in the same direction is what the
			// old lookup produced.
			for (const stamp of opampStamps(opampOnItsOwnRail)) {
				if (stamp.kind !== "ideal-opamp") continue;
				expect(stamp.railHigh).toBe(4);
				expect(stamp.railLow).toBe(0);
			}
		});

		it("refuses a rail pair that is not ordered, and keeps the circuit's", () => {
			// Negative control for the invariant. Both supply pins on one node gives
			// `railHigh == railLow`: not a narrow window but a contradiction, a linear
			// region of negative width. `mxr-m117r-flanger` produces exactly this on eight
			// stamps, because it puts its +15 V rail component on the ground node.
			for (const stamp of opampStamps(opampWithDegenerateRails)) {
				if (stamp.kind !== "ideal-opamp") continue;
				expect(stamp.railHigh).toBe(9);
				expect(stamp.railLow).toBe(-9);
			}
		});

		it("does not read vPlus/vMinus as rails when they are the op-amp's inputs", () => {
			// The control that justifies splitting the supply vocabulary in two, and the one
			// the corpus could not have supplied -- it contains no part shaped like this.
			//
			// `vPlus` and `vMinus` are this op-amp's **inputs**: its terminals are named the way
			// every corpus op-amp names its supplies, and their declared roles say
			// `nonInverting`/`inverting`. The rail reader is still name-based, so it is the one
			// thing here that could be fooled -- and reading them as rails would clamp the
			// op-amp to its own input voltages, so the rails must stay the circuit's.
			//
			// Sharper than it was: the fixture used to declare no input roles at all and rely on
			// `opampTerminals` falling back to declaration order. That fallback is gone, and the
			// name-against-role divergence is now the whole point of the fixture.
			for (const stamp of opampStamps(opampWithUnnamedInputs)) {
				if (stamp.kind !== "ideal-opamp") continue;
				expect(stamp.railHigh).toBe(9);
				expect(stamp.railLow).toBe(-9);
				// And they really are wired as the signal terminals, which is what makes the
				// clamp above wrong rather than merely redundant.
				expect(stamp.plus).not.toBe(stamp.minus);
			}
		});
	});

	describe("part-catalog terminal mapping contracts", () => {
		it("NE570 section A binds cellIn to pin 3 (G_CELL_IN) and the summing node to pin 5", () => {
			const result = compile(ne570TerminalMap, { registry: pedalPartCatalog });
			expect(result.status).toBe("ok");
			if (result.status !== "ok") return;
			// Each section lowers into its own MNA block; section A is the one whose
			// nodeIds contain pin 5 (source node 13) and pin 7 (source node 15).
			const blocks = result.program.blocks.filter((b) => b.kind === "mna");
			const a = blocks.find((b) => b.kind === "mna" && b.nodeIds.includes(13) && b.nodeIds.includes(15));
			if (a?.kind !== "mna") throw new Error("expected section A mna block");
			const comp = a.stamps.find((s) => s.kind === "compandor");
			if (comp?.kind !== "compandor") throw new Error("expected compandor stamp");
			// nodeIds [0, 10, 11, 12, 13, 14, 15, 24] → row 1=pin1, 2=pin2, 3=pin3,
			// 4=pin5, 5=pin6, 6=pin7, 7=the internal VREF node lowering allocated.
			expect(comp.rectIn).toBe(2); // pin2 RECT_IN
			expect(comp.rectCap).toBe(1); // pin1 RECT_CAP
			// **pin 3, G_CELL_IN -- the gain cell's signal input.** This assertion used to
			// name pin 5 and that was the defect: pin 5 is INV_IN, the internal op-amp's
			// summing node, so the cell was reading the node its own output current lands
			// on and the real input pin was left unloaded.
			expect(comp.cellIn).toBe(3); // pin3 G_CELL_IN
			expect(comp.sumNode).toBe(4); // pin5 INV_IN
		});

		it("NE570 lowers one channel to the datasheet's Figure 5 block diagram", () => {
			// The structural half of the compandor settlement: the chip is built out of
			// primitives, so the packet's wiring -- not this law -- decides whether it
			// compresses or expands. Five internal resistors (R1, R2, R3, R4, R5), the
			// band-gap reference, the output op-amp, and the one bespoke stamp that is
			// actually active silicon.
			const result = compile(ne570TerminalMap, { registry: pedalPartCatalog });
			expect(result.status).toBe("ok");
			if (result.status !== "ok") return;
			const a = result.program.blocks.find(
				(b) => b.kind === "mna" && b.nodeIds.includes(13) && b.nodeIds.includes(15),
			);
			if (a?.kind !== "mna") throw new Error("expected section A mna block");
			const kinds = a.stamps.map((s) => s.kind).sort();
			expect(kinds).toEqual([
				"compandor",
				"conductance",
				"conductance",
				"conductance",
				"conductance",
				"conductance",
				"dc-source",
				"ideal-opamp",
			]);
			// The reference is a private node: no pin of the document reaches it, so it
			// sits above every source node rather than aliasing one of them.
			const vref = a.stamps.find((s) => s.kind === "dc-source");
			if (vref?.kind !== "dc-source") throw new Error("expected the VREF source");
			expect(vref.volts).toBeCloseTo(1.8, 6);
			// Two state slots, held once per sample: the rectified current and the cell's
			// transconductance.
			expect(a.stateCount).toBe(2);
		});

		it("bare-pin CD4047 compiles cleanly as a decoupled non-executable clock driver shell", () => {
			const result = compile(cd4047BarePinMap, { registry: pedalPartCatalog });
			expect(result.status).toBe("ok");
			if (result.status !== "ok") return;
			const hasClockWarning = result.warnings.some(
				(w) => w.code === "non-executable-clock-driver" && w.device === "U1",
			);
			expect(hasClockWarning).toBe(true);
		});

		// **These three replaced their `bbd`-stamp originals on 2026-08-29 (plan M2).** The
		// stamp is gone, so `channel`/`vggBiasVolts`/`clk1`/`clk2` are genuinely obsolete: a
		// `bucket-brigade-delay-line` macro reads no clock and has no channel polarity. What is
		// NOT obsolete is the pin binding, which is what catches a registry entry whose
		// `barePinPositions` or role aliases are wrong, so it is asserted here against the
		// macro's ports rather than deleted with the stamp.
		const macroPortSourceNodes = (
			result: Extract<ReturnType<typeof compile>, { status: "ok" }>,
		): { input: number | null; outs: number[] } => {
			const macro = result.program.blocks.find((b) => b.kind === "macro");
			if (macro?.kind !== "macro") throw new Error("expected a macro block");
			const owner = result.program.blocks.find(
				(b) => b.kind === "mna" && b.id === macro.audioIn?.block,
			);
			const input =
				owner?.kind === "mna" && macro.audioIn !== null
					? (owner.nodeIds[macro.audioIn.node] ?? null)
					: null;
			const outs: number[] = [];
			for (const b of result.program.blocks) {
				if (b.kind !== "mna") continue;
				for (const stamp of b.stamps) {
					if (stamp.kind === "macro-audio-source" && stamp.macroId === macro.id) {
						outs.push(b.nodeIds[stamp.node] ?? stamp.node);
					}
				}
			}
			return { input, outs: outs.sort((a, z) => a - z) };
		};

		it("MN3007 role-named terminals bind IN/OUT1 to the right pins", () => {
			const result = compile(mn3007RoleMap, { registry: pedalPartCatalog });
			expect(result.status).toBe("ok");
			if (result.status !== "ok") return;
			// Pin 3 (IN) = node 12, Pin 7 (OUT1) = node 16. OUT2 (node 17) carries only the
			// BBD's own terminal in this fixture, so it belongs to no MNA region and `couple.ts`
			// skips it by design -- a tap driving nothing is not a write-back site.
			const ports = macroPortSourceNodes(result);
			expect(ports.input).toBe(12);
			expect(ports.outs).toEqual([16]);
		});

		it("MN3007 bare-pin DIP-8 terminals bind identically by position", () => {
			const result = compile(mn3007BarePinMap, { registry: pedalPartCatalog });
			expect(result.status).toBe("ok");
			if (result.status !== "ok") return;
			const ports = macroPortSourceNodes(result);
			expect(ports.input).toBe(12);
			expect(ports.outs).toEqual([16]);
		});

		it("MN3207 binds IN/OUT1 to its own distinct pinout (role and bare-pin)", () => {
			// Physical MN3207 DIP-8: Pin 8 (IN) = 12, Pin 5 (OUT1) = 16 -- a different pinout
			// from the MN3007 above, which is the whole reason both are asserted. Evidence:
			// boss-vb-2 IC2 (pin1_vgg, pin2_cp1, pin3_cp2, pin4_gnd, pin5_out1, pin6_out2,
			// pin7_vdd, pin8_input).
			for (const document of [mn3207RoleMap, mn3207BarePinMap]) {
				const result = compile(document, { registry: pedalPartCatalog });
				expect(result.status).toBe("ok");
				if (result.status !== "ok") return;
				const ports = macroPortSourceNodes(result);
				expect(ports.input).toBe(12);
				expect(ports.outs).toEqual([16]);
			}
		});
	});

	it("stamps a coupled winding per loaded tap, each at the ratio its rating gives", () => {
		// Turns go as the square root of impedance, so a rating at each end of a coupled pair
		// states the ratio completely: sqrt(3200/8) = 20 and sqrt(3200/16) = 14.142. Before this,
		// the reduction picked one tap and the other's load was silently dropped -- which cost
		// `orange-rockerverb` a wired 8 Ω speaker and a 22 kΩ feedback resistor.
		const stamps = transformerStamps(twoLiveSecondaryTaps);
		expect(stamps).toHaveLength(2);
		const ratios = stamps.map((stamp) => stamp.turnsRatio).sort((a, b) => a - b);
		expect(ratios[0]).toBeCloseTo(Math.sqrt(3200 / 16), 10);
		expect(ratios[1]).toBeCloseTo(Math.sqrt(3200 / 8), 10);
		// Both taps refer to the same primary pair, which is what makes them one coil rather than
		// two windings that happen to share a node.
		expect(new Set(stamps.map((stamp) => stamp.primaryPlus)).size).toBe(1);
		expect(new Set(stamps.map((stamp) => stamp.secondaryPlus)).size).toBe(2);
	});

	it("refuses a loaded tap with no rating rather than guessing where it sits", () => {
		// The negative control for the test above: a rating is the only thing that says how many
		// turns a tap is at, so removing one must refuse instead of falling back to a ratio.
		const unrated = derive(
			twoLiveSecondaryTaps,
			`          - across:
              - secondary_common
              - secondary_8
            impedance:
              raw: "8 Ω"
              value: 8
              unit: "Ω"
`,
			"",
		);
		const result = compile(unrated, { registry: emptyRegistry });
		expect(result.status).toBe("unsupported");
		if (result.status !== "unsupported") return;
		expect(result.reasons[0]?.reason).toContain("state no rated impedance");
	});

	describe("spring reverb tank", () => {
		it("an exact tank part number lowers to a spring-reverb operator, not a transformer", () => {
			const result = compile(springReverbTank, { registry: emptyRegistry });
			expect(result.status).toBe("ok");
			if (result.status !== "ok") return;
			const block = result.program.blocks.find((b) => b.kind === "mna");
			if (block?.kind !== "mna") throw new Error("expected an mna block");
			// The point of the operator: a tank must NOT lower to the memoryless element its
			// shell declares, or send-to-return is a wire with a turns ratio.
			expect(block.stamps.filter((s) => s.kind === "transformer")).toHaveLength(0);
			const tanks = block.stamps.filter((s) => s.kind === "spring-reverb");
			expect(tanks).toHaveLength(1);
			const tank = tanks[0];
			if (tank?.kind !== "spring-reverb") throw new Error("expected spring-reverb");
			// Ports come from the role vocabulary, so the drive coil and the pickup cannot be
			// swapped by terminal order: the packet's own impedances land on the right pair.
			expect(tank.inputOhms).toBe(8);
			expect(tank.outputOhms).toBe(2250);
			expect(tank.decaySeconds).toBeGreaterThan(0);
			expect(tank.delaySeconds).toBeGreaterThan(0);
		});

		it("a transformer with no tank part number still lowers to a transformer", () => {
			// The negative control for the classification above. Without it this test would
			// pass just as well if every transformer in the corpus became a spring.
			const result = compile(
				springReverbTank.replace('PartNumber: "4AB3C1B"', 'PartNumber: "125A9A"'),
				{ registry: emptyRegistry },
			);
			expect(result.status).toBe("ok");
			if (result.status !== "ok") return;
			const block = result.program.blocks.find((b) => b.kind === "mna");
			if (block?.kind !== "mna") throw new Error("expected an mna block");
			expect(block.stamps.filter((s) => s.kind === "spring-reverb")).toHaveLength(0);
			expect(
				block.stamps.filter((s) => s.kind === "transformer").length,
			).toBeGreaterThan(0);
		});
	});
});

describe("a rheostat-shaped pot whose far end hangs off an op-amp rail", () => {
	// The narrow path of the pot's orientation evidence: both track ends are unreachable
	// from ground, one end sits one hop from a `vplus` rail node, the other three hops from
	// the inverting input. Before `vplus` left the seed vocabulary the rail-adjacent end
	// won the tie and the track oriented the wrong way.
	it("orients the track to the input-adjacent end, not the rail-adjacent one", () => {
		const [block] = blocksFor(quietSeedRheostat);
		if (block?.kind !== "mna") {
			throw new Error("expected an mna block");
		}
		const sourceNode = sourceNodeOf(block);
		const controlled = block.stamps.filter(
			(stamp) => stamp.kind === "controlled-conductance",
		);
		// Both halves of the track are stamped, so the wiper node is real.
		expect(controlled).toHaveLength(2);
		// The wiper shares its node with one end, so one half is a no-op and the other
		// carries the whole sweep. That one must run from the wiper (node 4) to the end
		// three hops from the inverting input (node 5), on the lower side, so that gain
		// grows with the control. The rail-adjacent end sits on the wiper's own node.
		const effective = controlled.find((stamp) => stamp.a !== stamp.b);
		expect(effective).toBeDefined();
		if (effective?.kind === "controlled-conductance") {
			expect(sourceNode(effective.a)).toBe(4);
			expect(sourceNode(effective.b)).toBe(5);
			expect(effective.side).toBe("lower");
		}
	});
});

describe("stamp partition auxiliary row promotion", () => {
	it("promotes an auxiliary source row to portRows when all non-ground terminals are ports", () => {
		// When an input-source directly drives a nonlinear port node (e.g. diode or JFET gate),
		// leaving its aux row in L causes an all-zero row in M_lin[L][L] (since its only connection
		// is in P), rendering the linear interior singular and silencing the input excitation.
		const stamps: Stamp[] = [
			{ kind: "input-source", node: 1, sourceIndex: 0 },
			{
				kind: "diode",
				anode: 1,
				cathode: 0,
				saturationCurrent: 1e-14,
				thermalVoltage: 0.026,
				emissionCoefficient: 1,
				breakdownVolts: 100,
			},
		];
		const partition = computeStampPartition(stamps, 2);
		expect(partition.portRows).toContain(1);
		// Aux row 2 (nodeCount=2 + sourceIndex=0) must be promoted to portRows
		expect(partition.portRows).toContain(2);
	});
});

