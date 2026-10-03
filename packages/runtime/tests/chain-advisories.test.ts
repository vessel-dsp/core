// Contract for the chain's level seams (`../chain-scaling.ts`) and the bound the compiler derives
// for them (`../../compiler/port-full-scale.ts`).
//
// Same discipline as the supply-ground test beside it: compile real fixtures so the derivation is
// exercised rather than hand-asserted, pair every positive case with a negative control, and
// assert the arithmetic and the null handling rather than any packet's identity.

import { describe, expect, it } from "bun:test";
import { compile } from "@vessel-dsp/compiler";
import { emptyRegistry } from "@vessel-dsp/compiler";
import {
	railedAmplifier,
	resistorDivider,
} from "@vessel-dsp/compiler/fixtures/circuits";
import type { Program } from "@vessel-dsp/compiler";
import { ChainRuntime } from "../src/chain";
import {
	type ChainAdvisory,
	chainAdvisories,
	seamDivider,
	seamScale,
} from "../src/chain-advisories";
import {
	type ChainSlot,
	type ExternalProcessor,
	processorSlot,
	programSlot,
	type SlotContract,
	type StageCoverage,
	slotContract,
} from "../src/chain-slot";

/**
 * Programs as slot contracts, which is what the advisories take now that a chain slot may be an
 * injected NAM or IR processor rather than a compiled circuit.
 */
const asSlots = (programs: readonly Program[]) =>
	programs.map((program) => slotContract(programSlot(program)));

function programFor(source: string): Program {
	const result = compile(source, { registry: emptyRegistry });
	if (result.status !== "ok") {
		throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
	}
	return result.program;
}

/** A program with its port bounds overridden, for the arithmetic cases. */
function withBounds(
	program: Program,
	input: number | null,
	output: number | null,
): Program {
	// `instrument` throughout: the speaker-terminal rule is exercised separately below, and a
	// fixture that silently claimed a speaker output would make every seam case fire twice.
	return {
		...program,
		portFullScaleVolts: { input, output },
		stageCoverage: "instrument",
	};
}

describe("derived port full scale", () => {
	it("bounds an output by the declared supply and leaves an input unstated", () => {
		// `railedAmplifier` declares +9 and -9, so the largest supply magnitude is 9. An input's
		// bound is not derivable from the rails and must stay null rather than be invented.
		const railed = programFor(railedAmplifier).portFullScaleVolts;
		expect(railed.output).toBe(9);
		expect(railed.input).toBeNull();
	});

	it("states no bound at all when the source declares no supply", () => {
		// The negative control: without this, a derivation that always returned a number would
		// pass the case above for the wrong reason.
		expect(programFor(resistorDivider).portFullScaleVolts).toEqual({
			input: null,
			output: null,
		});
	});
});

describe("chain level seams", () => {
	const base = programFor(railedAmplifier);

	it("scales by the ratio of the upstream output to the downstream input", () => {
		const chain = [withBounds(base, null, 20), withBounds(base, 2, null)];
		expect(seamScale(asSlots(chain), 1)).toBe(10);
	});

	it("scales by 1 when either side states no bound, and says which", () => {
		const upstreamOnly = [
			withBounds(base, null, 20),
			withBounds(base, null, null),
		];
		expect(seamScale(asSlots(upstreamOnly), 1)).toBe(1);
		const advisories = chainAdvisories(asSlots(upstreamOnly));
		expect(advisories).toHaveLength(1);
		expect(advisories[0]?.slots).toEqual([0, 1]);
	});

	it("stays quiet when every seam can be scaled", () => {
		// The second negative control: an advisory that always fired would fail here.
		const scalable = [withBounds(base, null, 20), withBounds(base, 2, 5)];
		expect(chainAdvisories(asSlots(scalable))).toEqual([]);
	});

	it("has no seam in a one-slot chain", () => {
		expect(chainAdvisories(asSlots([withBounds(base, null, null)]))).toEqual(
			[],
		);
	});

	it("reports one advisory per unscalable seam, not one per chain", () => {
		const chain = [
			withBounds(base, null, 20),
			withBounds(base, null, 20),
			withBounds(base, 2, null),
		];
		expect(chainAdvisories(asSlots(chain))).toHaveLength(1);
		expect(seamScale(asSlots(chain), 2)).toBe(10);
	});
});

describe("a speaker terminal is not an input signal", () => {
	const base = programFor(railedAmplifier);
	const speaker = (program: Program): Program => ({
		...program,
		portFullScaleVolts: { input: null, output: 30 },
		stageCoverage: "speaker-electrical",
	});

	it("reports a slot whose speaker-terminal output feeds another slot", () => {
		const chain = [speaker(base), withBounds(base, 2, null)];
		const codes = chainAdvisories(asSlots(chain)).map(
			(advisory) => advisory.code,
		);
		expect(codes).toContain("speaker-signal-into-input");
	});

	it("stays quiet when the speaker terminal is the last slot", () => {
		// The negative control, and the normal case: an amp at the end of a chain is exactly
		// where a speaker-terminal output belongs.
		expect(
			chainAdvisories(asSlots([withBounds(base, 2, 9), speaker(base)])).map(
				(a) => a.code,
			),
		).not.toContain("speaker-signal-into-input");
	});
});

describe("the impedance divider at a seam", () => {
	const base = programFor(railedAmplifier);
	/** A program with both port bounds neutral, so the divider is the only factor in `seamScale`. */
	const withImpedance = (
		input: number | null,
		output: number | null,
	): Program => ({
		...withBounds(base, 1, 1),
		portImpedanceOhms: { input, output },
	});

	it("attenuates by Zin / (Zout + Zin) when both electrical sides declare", () => {
		// 1 kΩ source into a 1 kΩ load is exactly half, and a 9 kΩ source into 1 kΩ is a tenth --
		// two ratios that cannot be produced by a sign slip or an inverted divider.
		const half = [withImpedance(null, 1000), withImpedance(1000, null)];
		expect(seamDivider(asSlots(half), 1)).toBeCloseTo(0.5, 12);
		const tenth = [withImpedance(null, 9000), withImpedance(1000, null)];
		expect(seamDivider(asSlots(tenth), 1)).toBeCloseTo(0.1, 12);
	});

	it("multiplies with the full-scale ratio rather than replacing it", () => {
		// The two factors answer different questions, so a seam that both scales and divides must
		// apply both: 10x of level bound and half of loading is 5x.
		const chain = [
			{
				...withImpedance(null, 1000),
				portFullScaleVolts: { input: null, output: 10 },
			},
			{
				...withImpedance(1000, null),
				portFullScaleVolts: { input: 1, output: null },
			},
		];
		expect(seamScale(asSlots(chain), 1)).toBeCloseTo(5, 12);
	});

	it("crosses undivided when either electrical side declares nothing", () => {
		// The negative control, and the state of every corpus document: no impedance means no
		// loading, never an assumed one.
		expect(
			seamDivider(
				asSlots([withImpedance(null, 1000), withImpedance(null, null)]),
				1,
			),
		).toBe(1);
		expect(
			seamDivider(
				asSlots([withImpedance(null, null), withImpedance(1000, null)]),
				1,
			),
		).toBe(1);
		expect(
			seamDivider(
				asSlots([withImpedance(null, null), withImpedance(null, null)]),
				1,
			),
		).toBe(1);
	});

	it("reports the asymmetric case and stays quiet on the symmetric ones", () => {
		const codes = (chain: readonly Program[]) =>
			chainAdvisories(asSlots(chain)).map((advisory) => advisory.code);
		expect(
			codes([withImpedance(null, 1000), withImpedance(null, null)]),
		).toContain("undividable-seam");
		expect(
			codes([withImpedance(null, null), withImpedance(1000, null)]),
		).toContain("undividable-seam");
		// Both declaring, and neither declaring, are both fine -- the second is every chain today,
		// and reporting it would put a line of noise on every seam.
		expect(
			codes([withImpedance(null, 1000), withImpedance(1000, null)]),
		).not.toContain("undividable-seam");
		expect(
			codes([withImpedance(null, null), withImpedance(null, null)]),
		).not.toContain("undividable-seam");
	});
});

describe("a chain slot that is not a compiled circuit", () => {
	/**
	 * A host-supplied processor. Deliberately not a NAM or an IR implementation -- the runtime never
	 * contains one -- only the contract a slot must state.
	 */
	const processor = (
		id: string,
		produces: SlotContract["produces"],
		expects: SlotContract["expects"],
		gain = 1,
	): ExternalProcessor => ({
		id,
		produces,
		expects,
		portFullScaleVolts: { input: 1, output: 1 },
		// Not applicable rather than unknown: a capture's ports are digital. See `SlotContract`.
		portImpedanceOhms: null,
		prepare: () => undefined,
		process: (buffer) => buffer.map((sample) => sample * gain),
	});

	/**
	 * An amp capture: taken through a reactive load box, so the signal is the one at the speaker
	 * terminal and a cabinet stage is still to come. That is exactly `speaker-electrical` -- the same
	 * coverage a whitebox amp's own output has, which is why NAM + IR and amp + IR are one case.
	 */
	const namAmp = () => processor("nam:amp", "speaker-electrical", "instrument");
	/** A full-rig capture: cabinet and microphone already in it. */
	const namFullRig = () => processor("nam:full-rig", "miked", "instrument");
	/** A cabinet stage, whether an impulse response or the simulation. */
	const cabinet = () => processor("ir:cab", "miked", "speaker-electrical");

	it("passes a signal through an injected processor", () => {
		const chain = new ChainRuntime([
			programSlot(withBounds(programFor(resistorDivider), 1, 1)),
			processorSlot(processor("double", "instrument", "instrument", 2)),
		]);
		chain.prepare(48_000);
		const out = chain.process(new Float64Array([0.25, 0.5]));
		// Whatever the divider did, the processor doubled it -- so the ratio is the processor's.
		const solo = new ChainRuntime([
			programSlot(withBounds(programFor(resistorDivider), 1, 1)),
		]);
		solo.prepare(48_000);
		const before = solo.process(new Float64Array([0.25, 0.5]));
		expect(out[1]! / before[1]!).toBeCloseTo(2, 10);
	});

	it("reports no telemetry for a processor slot rather than zeroes", () => {
		// A zero held-sample count would read as "converged fine" for something that never solved.
		const chain = new ChainRuntime([
			programSlot(programFor(resistorDivider)),
			processorSlot(namAmp()),
		]);
		chain.prepare(48_000);
		expect(chain.telemetry().map((t) => t.slot)).toEqual([0]);
	});

	it("refuses a control on a processor slot instead of ignoring it", () => {
		const chain = new ChainRuntime([processorSlot(namAmp())]);
		chain.prepare(48_000);
		expect(() => chain.setControl(0, "Level", 0.5)).toThrow(
			/injected processor/,
		);
	});

	it("stays silent on an amp capture into a cabinet, which is the ordinary chain", () => {
		// NAM + IR is what most players do: the capture is taken through a load box with no speaker,
		// so the cabinet stage is the expected next one and nothing here should report it.
		const codes = chainAdvisories([namAmp(), cabinet()]).map((a) => a.code);
		expect(codes).not.toContain("cab-after-miked");
	});

	it("stays silent on an amp capture with no cabinet at all", () => {
		// A player who wants no cabinet has a complete chain. Nothing may nag for one.
		expect(chainAdvisories([namAmp()])).toEqual([]);
	});

	it("reports a cabinet applied to an already-miked signal", () => {
		// The one warnable arrangement: a full-rig capture already carries cabinet and microphone.
		const codes = chainAdvisories([namFullRig(), cabinet()]).map((a) => a.code);
		expect(codes).toContain("cab-after-miked");
	});

	it("does not call a speaker terminal into a cabinet a kind error", () => {
		// The negative control for the narrowed rule. A speaker terminal feeding a cabinet is what a
		// speaker terminal is *for*; before narrowing, this fired on the most ordinary amp chain.
		const speakerAmp = {
			...slotContract(programSlot(programFor(resistorDivider))),
			produces: "speaker-electrical" as const,
		};
		const codes = chainAdvisories([speakerAmp, cabinet()]).map((a) => a.code);
		expect(codes).not.toContain("speaker-signal-into-input");
	});

	it("still reports a speaker terminal into an instrument input", () => {
		// And the positive case it must keep catching.
		const speakerAmp = {
			...slotContract(programSlot(programFor(resistorDivider))),
			produces: "speaker-electrical" as const,
		};
		const pedal = slotContract(programSlot(programFor(resistorDivider)));
		const codes = chainAdvisories([speakerAmp, pedal]).map((a) => a.code);
		expect(codes).toContain("speaker-signal-into-input");
	});

	it("asks a processor for no impedance, even beside a circuit that declares one", () => {
		// The distinction `portImpedanceOhms: null` exists for. A capture's ports are digital, so
		// there is nothing missing at this seam -- where the same asymmetry between two *circuits*
		// is reported. Without this, every NAM or IR beside a declaring circuit would be nagged for
		// data that cannot exist.
		const declaring = {
			...slotContract(programSlot(programFor(resistorDivider))),
			portImpedanceOhms: { input: null, output: 1000 },
		};
		const codes = chainAdvisories([declaring, cabinet()]).map((a) => a.code);
		expect(codes).not.toContain("undividable-seam");
		// And it crosses undivided rather than at some invented ratio.
		expect(seamDivider([declaring, cabinet()], 1)).toBe(1);
	});
});

/**
 * The six chains a player can actually build, end to end through `ChainRuntime`.
 *
 * Every test above this asserts one rule on hand-built contracts. These assert the **chains**, which
 * is a different question: that audio reaches the far end of a three-slot chain, that each slot is
 * really in the path, and that the advisory set for each shape is the intended one rather than an
 * accident of rule ordering.
 *
 * **The processors are stubs, and that is the boundary rather than a shortcut.** The v2 runtime may
 * import the program contract and nothing else, so a real NAM engine, convolver or cab simulation
 * cannot appear here and never will -- the host supplies those. What is testable in this module is
 * the seam contract, and a stub with a known gain tests it more sharply than a real engine would,
 * because a change in the output can only have come from the seam.
 */
describe("the six chains, end to end", () => {
	const RATE = 48_000;
	const INPUT = new Float64Array(64).fill(0.25);

	/** A compiled circuit with both bounds stated, so no seam is unscalable and the noise is gone. */
	const circuit = (produces: StageCoverage): Program => ({
		...programFor(resistorDivider),
		portFullScaleVolts: { input: 1, output: 1 },
		stageCoverage: produces,
	});
	/** A host processor with a known gain, so its presence in the path is measurable. */
	const stub = (
		id: string,
		produces: StageCoverage,
		expects: StageCoverage,
		gain: number,
	): ExternalProcessor => ({
		id,
		produces,
		expects,
		portFullScaleVolts: { input: 1, output: 1 },
		portImpedanceOhms: null,
		prepare: () => undefined,
		process: (buffer) => buffer.map((sample) => sample * gain),
	});

	const pedal = () => programSlot(circuit("instrument"));
	const amp = () => programSlot(circuit("speaker-electrical"));
	const nam = (gain = 3) =>
		processorSlot(stub("nam", "speaker-electrical", "instrument", gain));
	const cab = (gain = 5) =>
		processorSlot(stub("cab", "miked", "speaker-electrical", gain));
	const ir = (gain = 5) =>
		processorSlot(stub("ir", "miked", "speaker-electrical", gain));

	const render = (slots: readonly ChainSlot[]): Float64Array => {
		const chain = new ChainRuntime(slots);
		chain.prepare(RATE);
		return chain.process(INPUT);
	};
	const codesOf = (slots: readonly ChainSlot[]) =>
		chainAdvisories(slots.map(slotContract))
			.map((advisory) => advisory.code)
			.sort();

	const chains: readonly (readonly [
		string,
		() => readonly ChainSlot[],
		readonly ChainAdvisory["code"][],
	])[] = [
		["1 pedal -> amp -> cabMicSim", () => [pedal(), amp(), cab()], []],
		["2 pedal -> amp -> IR", () => [pedal(), amp(), ir()], []],
		["3 pedal -> amp", () => [pedal(), amp()], []],
		["4 pedal -> IR", () => [pedal(), ir()], ["instrument-into-speaker-stage"]],
		["5 pedal -> NAM", () => [pedal(), nam()], []],
		["6 pedal -> NAM -> cabMicSim", () => [pedal(), nam(), cab()], []],
	];

	for (const [label, build, expected] of chains) {
		it(`${label}: runs, carries signal, and reports ${expected.length === 0 ? "nothing" : expected.join(" + ")}`, () => {
			const out = render(build());
			expect(out).toHaveLength(INPUT.length);
			expect(out.every((sample) => Number.isFinite(sample))).toBe(true);
			// A chain that silently produced nothing would pass every advisory assertion below.
			expect(Math.max(...Array.from(out, Math.abs))).toBeGreaterThan(0);
			expect(codesOf(build())).toEqual([...expected].sort());
		});
	}

	it("carries the last slot's gain to the output of a three-slot chain", () => {
		// Proves the final slot is in the path at all. Without this, a chain that dropped its last
		// slot would still be finite, non-zero and advisory-clean.
		const at = (gain: number) => render([pedal(), amp(), cab(gain)])[32] ?? 0;
		expect(at(10) / at(5)).toBeCloseTo(2, 10);
	});

	it("carries a middle slot's gain too, so no slot is skipped", () => {
		const at = (gain: number) => render([pedal(), nam(gain), cab()])[32] ?? 0;
		expect(at(6) / at(3)).toBeCloseTo(2, 10);
	});

	it("treats an IR and a cabinet simulation as the same chain", () => {
		// The design claim from `chain-slot.ts`: nothing distinguishes a NAM from an IR, so chains 1
		// and 2 are one case. If a discriminator ever creeps in, these stop matching.
		expect(Array.from(render([pedal(), amp(), cab()]))).toEqual(
			Array.from(render([pedal(), amp(), ir()])),
		);
		expect(codesOf([pedal(), amp(), cab()])).toEqual(
			codesOf([pedal(), amp(), ir()]),
		);
	});

	it("reports a full-rig capture sent into a cabinet, and only then", () => {
		// Chain 5's warnable variant: a capture that already contains cab and mic, plus a cab stage.
		const fullRig = processorSlot(
			stub("nam:full-rig", "miked", "instrument", 3),
		);
		expect(codesOf([pedal(), fullRig, cab()])).toContain("cab-after-miked");
		expect(codesOf([pedal(), nam(), cab()])).not.toContain("cab-after-miked");
	});

	it("reports a miked signal fed back into an instrument input", () => {
		// The hole the coverage ranking closed: this reported nothing while the same error one rung
		// lower did, because the rule named a single value instead of "at or beyond".
		expect(codesOf([pedal(), cab(), pedal()])).toContain(
			"speaker-signal-into-input",
		);
	});
});
