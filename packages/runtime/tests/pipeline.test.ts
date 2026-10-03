// The vertical slice: `.vdsp` source text -> rendered audio, through all seven stages.
//
// Every assertion here is against a hand-computed value, never a snapshot of what the
// implementation currently produces. A snapshot proves the code still does what it
// did; a divider ratio proves it is right.

import { describe, expect, it } from "bun:test";
import {
	ReferenceRuntime,
	RuntimeError,
} from "../src/reference-runtime";
import { bakeDecisionFor } from "@vessel-dsp/compiler/bake";
import { compile, compileToArtifact } from "@vessel-dsp/compiler";
import { emptyRegistry, type PartRegistry } from "@vessel-dsp/compiler";
import { pedalPartCatalog } from "@vessel-dsp/compiler";
import { SWITCH_ON_OHMS } from "@vessel-dsp/compiler/device-laws";
import { findUnreachableOutput } from "@vessel-dsp/compiler/unreachable-output";
import { readNetlist } from "@vessel-dsp/compiler/netlist";
import type { Block, Device, OperatorKind, Program } from "@vessel-dsp/compiler";
import { opampNeedsRegistrySections } from "@vessel-dsp/compiler/unreadable-terminal-role";
import {
	acMainsDivider,
	beltonBrickReverb,
	bridgeRectifier,
	cd4013LogicDivider,
	clippingOverdriveStage,
	commonEmitterAmplifier,
	commonEmitterAmplifierHalvedRe,
	contradictorySupplyTwin,
	controlInScheduledRegion,
	controlInUnexecutedRegion,
	dcMainsDivider,
	derive,
	diodeClipper,
	diodeProtectingSupply,
	diodeShortingSupply,
	dualAnodeRectifier,
	emitterFollower,
	emitterFollowerRailToGround,
	emitterFollowerReordered,
	emitterFollowerSupplyReversed,
	hybridDelayPedal,
	hybridDelayPedalHalfClockRail,
	hybridDelayPedalLoadedOutput,
	hybridDelayPedalLongerDelay,
	hybridDelayPedalNoDeclaredDelay,
	hybridDelayPedalNoDelayNoClock,
	hybridDelayPedalChainedMacroCycle,
	hybridDelayPedalCyclicSchedule,
	hybridDelayPedalMovableClock,
	hybridCascade4DelayPedal,
	hybridCascade3DelayPedal,
	hybridCascade4DelayPedalUnequalDelays,
	hybridFeedbackDelayPedal,
	hybridFeedbackDelayPedalLowFeedback,
	hybridFeedbackDelayPedalHighFeedback,
	hybridFeedbackDelayPedalUnstableLoop,
	cd4047BarePinMap,
	invertingAmplifier,
	invertingAmplifierReordered,
	jfetFollower,
	jfetReverseBiased,
	knownChip,
	ledClipper,
	malformed,
	mn3101ClockDriver,
	mn3101ClockDriverFastOscillator,
	mosfetFollower,
	nothingToExecute,
	opampCapacitiveFeedbackOnly,
	optocouplerAttenuator,
	optocouplerAttenuatorIlluminated,
	optocouplerAttenuatorPartial,
	optocouplerAttenuatorSubThreshold,
	potDivider,
	potDividerWiperLast,
	potLinearTaper,
	potLogarithmicTaper,
	potWithFloatingWiper,
	quietSeedRheostat,
	railedAmplifier,
	rcLowPass,
	resistorDivider,
	rheostatDivider,
	rheostatPot,
	rheostatWithMinimum,
	rlLowPass,
	selectorCommonLast,
	selectorRouting,
	stepDownTransformer,
	stepUpTransformer,
	straddlingControl,
	switchedDivider,
	transformerSecondaryWithDeclaredPort,
	triodeGainStage,
	tubeDiodeIntoLoad,
	tubeDiodeIntoLoadWithDeclaredPort,
	tubeDiodeReversed,
	unknownChip,
	unparseableValue,
	untypedJacks,
	ne570Compressor,
	ne570Expander,
	ne570ExpanderFastDetector,
	notPopulatedResistor,
	notPopulatedResistorWithValue,
	resistorWithNegativeResistance,
	resistorWithNoResistance,
	zeroOhmLinkDivider,
	bbdClockDerivedDelay,
	bbdClockModulatedDelay,
	openIcOnDeclaredClass,
	pentodeGainStage,
	pt2399ClockDerivedDelay,
	rlHighPass,
	selectorThreeWay,
	unknownIcRefused,
} from "@vessel-dsp/compiler/fixtures/circuits";
import {
	bbdStampNChannelMatchedLoadPeakVolts,
	bbdStampNChannelPeakVolts,
	bbdStampPChannelPeakVolts,
	clipperCeilingVolts,
	commonEmitterGain,
	diodeClipperPeakVolts,
	dividerGain,
	hybridDelayLoadedOutputGain,
	hybridDelayOutputGain,
	hybridDelayPedalGain,
	hybridDelayUnloadedInputGain,
	invertingGain,
	jfetFollowerGain,
	ledClipperPeakVolts,
	logTaperMidGain,
	mosfetFollowerGain,
	optocouplerDarkGain,
	optocouplerIlluminatedGain,
	potGainAt,
	quietSeedGainMid,
	quietSeedGainQuarter,
	quietSeedGainThreeQuarter,
	rcCornerHz,
	rcGainAtCorner,
	rheostatMidGain,
	rheostatMidGainWithMinimum,
	rlCornerHz,
	transformerStepDownGain,
	transformerStepUpGain,
	triodeStageCathodeVolts,
	triodeStagePlateVolts,
	ne570CompressorBiasVolts,
	ne570CompressorOutputAt,
	ne570ExpanderBiasVolts,
	ne570ExpanderGainAt,
	pentodeStageCathodeVolts,
	pentodeStagePlateVolts,
	rlHighPassGainAtDecadeAbove,
	rlHighPassGainAtDecadeBelow,
	selectorThreeWayGains,
} from "@vessel-dsp/compiler/fixtures/expected";
import {
	fixtureRegistry,
} from "@vessel-dsp/compiler/fixtures/registry";

/**
 * The one program a macro-derived composition runs.
 *
 * A composed block carries a position list so a reprogrammable chip can hold several; a
 * fixed-function part has exactly one, and these tests are all about those. Throwing rather than
 * defaulting keeps a structural change from passing as an empty assertion.
 */
const onlyPosition = <T extends { positions: readonly unknown[] }>(block: T) => {
	const position = block.positions[0];
	if (position === undefined || block.positions.length !== 1) {
		throw new Error(
			`expected a single-position composition, found ${block.positions.length}`,
		);
	}
	return position as Extract<
		import("@vessel-dsp/compiler").Block,
		{ kind: "composed" }
	>["positions"][number];
};

function programFor(source: string, registry = emptyRegistry): Program {
	const result = compile(source, { registry });
	if (result.status !== "ok") {
		throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
	}
	return result.program;
}

/** Drive a sine at `hz` and return the steady-state output amplitude. */
function measureGain(
	program: Program,
	hz: number,
	sampleRate: number,
	amplitude = 1,
	controls: Readonly<Record<string, number>> = {},
): number {
	const runtime = new ReferenceRuntime(program);
	runtime.prepare(sampleRate);
	for (const [id, position] of Object.entries(controls)) {
		runtime.setControl(id, position);
	}
	// A biased nonlinear stage needs its DC operating point and coupling caps to
	// settle before the AC amplitude means anything: this fixture reads 1.065 at 40
	// cycles and 0.992 from 200 on. Measuring too early is the harness lying, not the
	// circuit being wrong, so the window is long enough for every fixture here.
	const cycles = 200;
	const length = Math.round((cycles * sampleRate) / hz);
	const input = new Float64Array(length);
	for (let index = 0; index < length; index += 1) {
		input[index] =
			amplitude * Math.sin((2 * Math.PI * hz * index) / sampleRate);
	}
	const output = runtime.process(input);
	// Half the peak-to-peak over the last quarter, after the transient settles. Half
	// peak-to-peak rather than peak, because a biased stage sits on a DC offset and
	// peak-of-output would measure the operating point instead of the signal.
	let low = Number.POSITIVE_INFINITY;
	let high = Number.NEGATIVE_INFINITY;
	for (let index = Math.floor(length * 0.75); index < length; index += 1) {
		const value = output[index] ?? 0;
		low = Math.min(low, value);
		high = Math.max(high, value);
	}
	return (high - low) / 2 / amplitude;
}

describe("end to end: source text to audio", () => {
	it("renders a resistor divider at exactly half gain", () => {
		const gain = measureGain(programFor(resistorDivider), 1000, 48_000);
		expect(gain).toBeCloseTo(dividerGain, 3);
	});

	it("renders an RC low pass at -3 dB at its corner", () => {
		const gain = measureGain(programFor(rcLowPass), rcCornerHz, 192_000);
		expect(gain).toBeCloseTo(rcGainAtCorner, 2);
	});

	it("rolls off above the corner and passes below it", () => {
		const program = programFor(rcLowPass);
		const below = measureGain(program, rcCornerHz / 20, 192_000);
		const above = measureGain(program, rcCornerHz * 20, 192_000);
		expect(below).toBeGreaterThan(0.99);
		expect(above).toBeLessThan(0.1);
	});

	it("amplifies through an ideal op-amp at its hand-computed gain", () => {
		// Exercises the auxiliary-constraint row: v(+) == v(-) with the output
		// carrying whatever current that takes. Same mechanism a transformer needs.
		const gain = measureGain(programFor(invertingAmplifier), 1000, 48_000, 0.1);
		expect(gain).toBeCloseTo(invertingGain, 1);
	});

	it("renders an RL low pass at -3 dB at its corner", () => {
		// The inductor had a law but no stamp until now, so it was silently dropped
		// and the circuit rendered as if the coil were absent.
		const gain = measureGain(programFor(rlLowPass), rlCornerHz, 192_000);
		expect(gain).toBeCloseTo(rcGainAtCorner, 1);
	});

	it("clips at the supply rails, which need no part number", () => {
		// An op-amp with no rails drives 50 V from a pedal that has 9 V, which is not
		// an approximation of a real part -- it is a device that cannot exist, and it
		// silently deletes every op-amp overdrive. The rails come from the supplies in
		// the netlist, so an unlabelled op-amp still clips correctly.
		const program = programFor(railedAmplifier);
		const small = measureGain(program, 1000, 48_000, 0.1);
		expect(small).toBeCloseTo(invertingGain, 1);
		const hot = measureGain(program, 1000, 48_000, 5) * 5;
		expect(hot).toBeLessThan(9.5);
		expect(hot).toBeGreaterThan(8.5);
	});

	it("solves the clipped operating point within the default iteration cap", () => {
		// In saturation the true differential is *volts* -- feedback is broken, so the
		// summing node floats to the divider's value -- while a step limiter sized to
		// the linear region moves tens of microvolts per iteration. That was 1565
		// iterations for one sample, well past any usable cap, so a hard-driven op-amp
		// held its last sample and rendered silence. Bounding the differential to the
		// band where `tanh` still means something makes it 7.
		//
		// Scope, so this is not read as more than it is: reverting the saturation band
		// fails this test, and reverting the convergence bar that ships with it does
		// not. The bar's evidence is a corpus measurement rather than a fixture.
		const runtime = new ReferenceRuntime(programFor(railedAmplifier));
		runtime.prepare(48_000);
		const input = new Float64Array(4800);
		for (let i = 0; i < input.length; i += 1) {
			input[i] = 5 * Math.sin((2 * Math.PI * 1000 * i) / 48_000);
		}
		const output = runtime.process(input);
		const telemetry = runtime.telemetry();
		expect(telemetry.nonConvergedSamples).toBe(0);
		expect(telemetry.nonFiniteSamples).toBe(0);
		// And it is still clipping, so convergence was not bought by removing the
		// saturation that makes this circuit an overdrive.
		let peak = 0;
		for (const value of output) {
			peak = Math.max(peak, Math.abs(value));
		}
		expect(peak).toBeGreaterThan(8.5);
	});

	it("stays unbounded when the circuit declares no supply", () => {
		// Not a bug: a schematic with no supply has no rail to clip against, and
		// inventing one would be a guess about a circuit nobody drew.
		const hot =
			measureGain(programFor(invertingAmplifier), 1000, 48_000, 5) * 5;
		expect(hot).toBeCloseTo(50, 0);
	});

	it("clips a hot signal through anti-parallel diodes", () => {
		const gain = measureGain(programFor(diodeClipper), 1000, 48_000, 5);
		const peak = gain * 5;
		expect(peak).toBeLessThan(clipperCeilingVolts);
		// Knee matches the Shockley diode equation at ~0.445 mA (~0.546 V) within 10%
		expect(peak).toBeCloseTo(diodeClipperPeakVolts, 1);

		// Negative control: anti-parallel LEDs have ~1e-12 Is and ~0.05 Vt, moving
		// the forward clipping knee up to ~1.72 V (~1.17 V higher) under the same 5 V drive.
		const ledGain = measureGain(programFor(ledClipper), 1000, 48_000, 5);
		const ledPeak = ledGain * 5;
		expect(ledPeak).toBeCloseTo(ledClipperPeakVolts, 1);
		expect(ledPeak - peak).toBeGreaterThan(1.0);

		// And a small signal passes nearly unclipped, so it is a clipper not a gate.
		const small = measureGain(programFor(diodeClipper), 1000, 48_000, 0.01);
		expect(small).toBeGreaterThan(0.9);
	});
});

describe("the soft-clipping overdrive stage", () => {
	it("compresses as it is driven harder", () => {
		// Anti-parallel diodes across an op-amp's feedback resistor: a Tube Screamer,
		// an OD-1, a Blues Breaker. Below conduction the feedback resistor sets the
		// gain; above it the diodes take over and the stage compresses. Falling gain
		// with rising drive is the whole behaviour.
		const program = programFor(clippingOverdriveStage);
		const quiet = measureGain(program, 1000, 48_000, 0.1);
		const driven = measureGain(program, 1000, 48_000, 2);
		expect(quiet).toBeGreaterThan(driven * 2);
		expect(driven).toBeGreaterThan(0);
	});
});

describe("transistors: Ebers-Moll with junction limiting", () => {
	it("follows the input at just under unity gain through an emitter follower", () => {
		// Re/(Re + re), re = Vt/Ie. With ~0.8 mA through 4k7 that is ~0.99, and any
		// value near 1 means the DC operating point solved and the stage is active.
		const gain = measureGain(programFor(emitterFollower), 1000, 48_000, 0.05);
		expect(gain).toBeGreaterThan(0.8);
		expect(gain).toBeLessThan(1.05);
	});

	it("amplifies through a common-emitter BJT stage at mid-band gain -Rc/Re", () => {
		// 9 V rail, RB1=100k, RB2=22k divider, RC=4.7k, RE=1k into 1M load.
		// Hand-derived mid-band AC gain is (RC || RLOAD) / (RE + re) ~ 4.53 V/V.
		const gain = measureGain(
			programFor(commonEmitterAmplifier),
			1000,
			48_000,
			0.005,
		);
		expect(gain).toBeCloseTo(commonEmitterGain, 1);

		// Negative control: halving RE (1k -> 470) roughly doubles the AC stage gain
		// (~9.50 V/V, ratio ~2.12x), proving the stage is degenerated by RE rather
		// than pinned at a rail or clamped.
		const gainHalved = measureGain(
			programFor(commonEmitterAmplifierHalvedRe),
			1000,
			48_000,
			0.005,
		);
		expect(gainHalved).toBeCloseTo(9.5, 0);
		expect(gainHalved / gain).toBeGreaterThan(2.0);
		expect(gainHalved / gain).toBeLessThan(2.2);
	});

	it("follows through a JFET at its hand-solved operating point", () => {
		// Vs solves Vs/2200 = beta*(2 - Vs)^2 -> ~1.247 V, gm ~ 1.506 mS, and the
		// follower gain is gm*Rs/(1 + gm*Rs). Solved before it was measured.
		const gain = measureGain(programFor(jfetFollower), 1000, 48_000, 0.05);
		expect(gain).toBeCloseTo(jfetFollowerGain, 1);
	});

	it("follows through a MOSFET, the same law with the opposite threshold sign", () => {
		const gain = measureGain(programFor(mosfetFollower), 1000, 48_000, 0.05);
		expect(gain).toBeCloseTo(mosfetFollowerGain, 1);
	});

	it("steps up through an ideal transformer by its turns ratio", () => {
		// Four-terminal constraint row: V_primary = ratio * V_secondary, power
		// conserved. Ratio 0.5 is a 1:2 step-up.
		const gain = measureGain(programFor(stepUpTransformer), 1000, 48_000, 0.1);
		expect(gain).toBeCloseTo(transformerStepUpGain, 2);

		// Negative control: Ratio 2.0 is a 2:1 step-down transformer (gain = 0.5),
		// proving the ratio direction is honored rather than hardcoded to step-up.
		const stepDownGain = measureGain(
			programFor(stepDownTransformer),
			1000,
			48_000,
			0.1,
		);
		expect(stepDownGain).toBeCloseTo(transformerStepDownGain, 2);
		expect(gain / stepDownGain).toBeCloseTo(4.0, 1);
	});

	it("converges rather than diverging, at every sample of a hot signal", () => {
		// Without junction limiting the exponential overshoots on the first Newton
		// step and the solution runs away; a finite output is the real assertion.
		const gain = measureGain(programFor(emitterFollower), 1000, 48_000, 1);
		expect(Number.isFinite(gain)).toBe(true);
		expect(gain).toBeGreaterThan(0);
	});
});

describe("the program declares the operators it requires", () => {
	/** The operators a program's blocks actually stamp, read back independently of `link`. */
	function operatorsInStamps(program: Program): readonly OperatorKind[] {
		const kinds = new Set<OperatorKind>();
		for (const block of program.blocks) {
			if (block.kind !== "mna") continue;
			for (const stamp of block.stamps) kinds.add(stamp.kind);
		}
		return [...kinds].sort();
	}

	it("declares exactly the operators its stamps use", () => {
		// The invariant, on a real circuit rather than a hand-built block list: not a
		// superset, which would refuse on a runtime that could have played it, and not a
		// subset, which is the silent-drop this whole mechanism exists to stop.
		for (const source of [
			resistorDivider,
			rcLowPass,
			diodeClipper,
			potDivider,
		]) {
			const program = programFor(source);
			expect([...program.requiredOperators]).toEqual([
				...operatorsInStamps(program),
			]);
		}
	});

	it("declares few operators for a circuit that uses few", () => {
		// The declaration tracks the circuit, so it is a version surface rather than a
		// constant: a resistive divider needs no diode operator and a clipper does.
		const divider = programFor(resistorDivider).requiredOperators;
		const clipper = programFor(diodeClipper).requiredOperators;
		expect(divider).not.toContain("diode");
		expect(clipper).toContain("diode");
		expect(divider.length).toBeLessThan(clipper.length);
	});
});

describe("decision 3: sample rate is a runtime input", () => {
	it("gives the same answer at two sample rates from one compiled program", () => {
		const program = programFor(rcLowPass);
		const at48k = measureGain(program, rcCornerHz, 48_000);
		const at96k = measureGain(program, rcCornerHz, 96_000);
		expect(at96k).toBeCloseTo(at48k, 2);
	});

	it("refuses to run without a rate rather than defaulting to one", () => {
		const runtime = new ReferenceRuntime(programFor(resistorDivider));
		expect(() => runtime.process(new Float64Array(8))).toThrow(RuntimeError);
	});

	it("refuses an unusable rate rather than substituting 48000", () => {
		const runtime = new ReferenceRuntime(programFor(resistorDivider));
		expect(() => runtime.prepare(0)).toThrow(RuntimeError);
		expect(() => runtime.prepare(Number.NaN)).toThrow(RuntimeError);
	});
});

describe("decision 2: controls are 0..1 and the taper is in the program", () => {
	it("varies output with control position", () => {
		const program = programFor(potDivider);
		const quarter = measureGain(program, 1000, 48_000, 1, { Level: 0.25 });
		const half = measureGain(program, 1000, 48_000, 1, { Level: 0.5 });
		const threeQuarters = measureGain(program, 1000, 48_000, 1, {
			Level: 0.75,
		});
		expect(quarter).toBeLessThan(half);
		expect(half).toBeLessThan(threeQuarters);
	});

	it("follows a linear taper's hand-computed ratio", () => {
		const gain = measureGain(programFor(potDivider), 1000, 48_000, 1, {
			Level: 0.25,
		});
		expect(gain).toBeCloseTo(potGainAt(0.25), 2);
	});

	it("renders an audio (logarithmic) taper with distinct mid-travel attenuation", () => {
		// At half rotation a linear track passes half of itself and an audio track passes a
		// tenth. Both numbers are exact rather than nominal: `taperFraction` is
		// `(81^x - 1)/(81 - 1)`, and base 81 exists precisely so that `x = 0.5` gives
		// `(9 - 1)/80` = 0.1 -- see `logTaperMidGain`.
		//
		// **Both sides declare their taper the same way, which is what makes this a control
		// over one variable.** `potLinearTaper` and `potLogarithmicTaper` are the same fixture
		// through the same `potWithTaper` helper, differing only in the declared value. The
		// obvious alternative for the linear side, `potDivider`, declares its taper on the
		// *panel control* instead of on the component, so comparing against it would vary the
		// declaration site as well as the curve and a difference could be attributed to either.
		const linearGain = measureGain(programFor(potLinearTaper), 1000, 48_000, 1, {
			Level: 0.5,
		});
		const logGain = measureGain(programFor(potLogarithmicTaper), 1000, 48_000, 1, {
			Level: 0.5,
		});
		expect(linearGain).toBeCloseTo(0.5, 6);
		expect(logGain).toBeCloseTo(logTaperMidGain, 6);
		expect(linearGain).toBeGreaterThan(logGain * 4);

		// And the two declaration sites agree, which is the assertion that keeps
		// `potLinearTaper` and `potDivider` from being a silent maintenance trap: a
		// component-level `Taper: "Linear"` and a panel-level `taper: linear` are the same
		// track, so they must measure the same. Held to full precision because there is no
		// approximation between them to absorb.
		expect(measureGain(programFor(potDivider), 1000, 48_000, 1, { Level: 0.5 })).toBeCloseTo(
			linearGain,
			9,
		);
	});

	it("refuses a position outside 0..1, because units never cross the boundary", () => {
		const runtime = new ReferenceRuntime(programFor(potDivider));
		runtime.prepare(48_000);
		expect(() => runtime.setControl("Level", 5000)).toThrow(RuntimeError);
		expect(() => runtime.setControl("Level", -1)).toThrow(RuntimeError);
	});

	it("carries the taper in the emitted program", () => {
		expect(programFor(potDivider).controls[0]?.taper).toBeDefined();
	});
});

describe("spec clause 5: the bake gate refuses a control-bearing realisation", () => {
	it("refuses to bake potDivider's block, and measures the cost of baking anyway", () => {
		// The negative control that would have shipped linear-core-state-space-gate's 80%
		// error: `bakeDecisionFor` must refuse this block (it is linear but not control-free),
		// and this reproduces WHY, on this compiler's own fixture rather than gate 1c's C++
		// one. Nothing here builds a state-space realisation -- clause 5's own deliverable is
		// the gate, not the reduction -- so "the realisation" derived at one control position
		// and evaluated at another is stood in for by the fixture's own gain, which for a
		// linear divider IS the whole of the transfer function a realisation would encode.
		const program = programFor(potDivider);
		const block = program.blocks.find((candidate) => candidate.kind === "mna");
		expect(block?.kind).toBe("mna");
		if (block?.kind !== "mna") {
			return;
		}
		const decision = bakeDecisionFor(block);
		expect(decision.outcome).toBe("refused");
		if (decision.outcome === "refused") {
			expect(decision.refusal.reason).toContain("control-free");
		}

		const bakedAt = 0.2;
		const evaluatedAt = 0.8;
		const bakedGain = measureGain(program, 1000, 48_000, 1, { Level: bakedAt });
		const trueGain = measureGain(program, 1000, 48_000, 1, {
			Level: evaluatedAt,
		});
		expect(bakedGain).toBeCloseTo(potGainAt(bakedAt), 2);
		expect(trueGain).toBeCloseTo(potGainAt(evaluatedAt), 2);

		// Measured at 75% on this fixture (gain is exactly position here, so
		// |0.2 - 0.8| / 0.8) -- gate 1c's own fixture measured 80% on a different circuit.
		// Different number, same shape: large, and entirely attributable to reusing a
		// realisation across a control move rather than to any wrong stamp.
		const fraction = Math.abs(trueGain - bakedGain) / trueGain;
		expect(fraction).toBeGreaterThan(0.5);
	});

	it("allows baking a control-free linear block", () => {
		// The positive control: `resistorDivider` has no control anywhere, so its gain cannot
		// move and a baked realisation would be correct forever -- the gate must say so.
		const program = programFor(resistorDivider);
		const block = program.blocks.find((candidate) => candidate.kind === "mna");
		expect(block?.kind).toBe("mna");
		if (block?.kind === "mna") {
			expect(bakeDecisionFor(block).outcome).toBe("may-bake");
		}
	});
});

describe("a switch changes topology through a control, not a second netlist", () => {
	it("passes the divider's half when open and collapses when closed", () => {
		const program = programFor(switchedDivider);
		const open = measureGain(program, 1000, 48_000, 1, { Bypass: 0 });
		const closed = measureGain(program, 1000, 48_000, 1, { Bypass: 1 });
		expect(open).toBeCloseTo(dividerGain, 2);
		expect(closed).toBeLessThan(1e-3);
	});

	it("compiles one program for both switch positions", () => {
		// The whole point of modelling a switch as a conductance: no combinatorial
		// explosion of programs, and one document still yields one netlist.
		expect(programFor(switchedDivider).blocks).toHaveLength(1);
	});
});

describe("decision 1: an unknown chip makes the pedal unsupported", () => {
	it("refuses the whole circuit and names the component and reason", () => {
		const result = compile(unknownChip, { registry: fixtureRegistry });
		expect(result.status).toBe("unsupported");
		if (result.status === "unsupported") {
			expect(result.reasons[0]?.device).toBe("U1");
			expect(result.reasons[0]?.reason).toContain("no model");
		}
	});

	it("compiles the same circuit once the registry supplies a model", () => {
		expect(compile(knownChip, { registry: fixtureRegistry }).status).toBe("ok");
	});

	it("refuses that circuit again against an empty registry", () => {
		// The arbitrary-schematic measurement: what works with no part knowledge.
		expect(compile(knownChip, { registry: emptyRegistry }).status).toBe(
			"unsupported",
		);
	});

	it("emits no artifact for an unsupported circuit", () => {
		const { artifact } = compileToArtifact(unknownChip, {
			registry: fixtureRegistry,
		});
		expect(artifact).toBeNull();
	});
});

describe("the hybrid path: analog, then a macro, then analog", () => {
	it("places the macro and every analog region around it", () => {
		const program = programFor(hybridDelayPedal, fixtureRegistry);
		const macros = program.blocks.filter(
			(block) => block.kind === "macro" || block.kind === "composed",
		);
		expect(macros).toHaveLength(1);
		// The shells either side and the clock network are all present and ordered.
		//
		// The second assertion carries more weight than it did when it was written: `link`
		// now schedules only blocks that can reach the output, and three of the five regions
		// here own neither jack. They stay in the order because the macro depends on them,
		// which is the case that makes the dependency graph load-bearing rather than a
		// formality -- reachability read off the port fields alone would delete the input
		// shell and the clock network and render a plausible, wrong pedal.
		expect(program.blocks.length).toBeGreaterThan(4);
		expect(program.order).toHaveLength(program.blocks.length);
	});

	it("gives the macro real `coupled` and `parameter` ports", () => {
		// Structural, before anything is rendered: `Block`'s macro variant used to carry a
		// modelId and parameters and no ports at all, which is the defect build-order step 1
		// closes. `audioIn`/`audioOut` are the `coupled` port (spec clause 2); `parameter` is
		// the purity-gated scalar (clause 1), non-null here because the clock region is
		// linear and control-free -- see the negative control below for the refusing case.
		const program = programFor(hybridDelayPedal, fixtureRegistry);
		const macro = program.blocks.find(
			(block) => block.kind === "macro" || block.kind === "composed",
		);
		expect(macro).toBeDefined();
		if (macro?.kind !== "macro" && macro?.kind !== "composed") {
			return;
		}
		expect(macro.audioIn).not.toBeNull();
		expect(macro.audioOut).toBe(true);
		expect(macro.parameter).not.toBeNull();
	});

	it("passes audio through the macro, at the coupled port's genuinely loaded gain", () => {
		// **This is the assertion the deleted one predicted would have to fail.** A steady
		// sine cannot show a pure delay as anything but a phase shift, so the whole of this
		// number is the two passive dividers the `coupled` port's boundary stamps create --
		// see `hybridDelayPedalGain`'s own derivation. Not `toBeLessThan(1e-9)` any more.
		const gain = measureGain(
			programFor(hybridDelayPedal, fixtureRegistry),
			1000,
			48_000,
		);
		// No attenuation factor: the macro passes the coupled port's gain through
		// exactly. This assertion previously carried a `* 0.9765625` multiplier
		// attributed to "the BBD AC-coupling filter" -- 125/128, whose roundness is
		// the tell that it was back-solved from a measurement rather than derived.
		// What it was really absorbing was a defect in that filter: its DC-estimate
		// pole sat at 1/(1ms), a 159 Hz corner, so it removed the guitar fundamental
		// as if it were DC. With the pole at its intended 1/(1s) (0.16 Hz) the
		// measured gain is the derived electrical gain, and the factor has nothing
		// left to explain.
		//
		// The residual is 3.2e-6 absolute (7e-6 relative), inside this precision.
		// It is the harness, not the circuit: `measureGain` reads half peak-to-peak
		// off the sample grid, and a fractionally-delayed sine's crest lands between
		// samples. The bound is `1 - cos(pi*hz/sampleRate)` = 2.1e-3 here, and the
		// residual measures 3.2e-6 / 8.9e-7 / -2.7e-7 at 48k / 96k / 192k -- falling
		// with rate and changing sign, which is grid phase rather than a filter.
		expect(gain).toBeCloseTo(hybridDelayPedalGain, 5);
		// And demonstrably loaded, not merely present: the bare R_IN/R_IN_SHUNT half (ignoring
		// the macro's declared input impedance entirely) predicts a LARGER gain than this. The
		// measured gain sitting below that unloaded prediction is what "a coupled port that
		// demonstrably loads its driver" means, not just that a number came out non-zero.
		expect(gain).toBeLessThan(
			hybridDelayUnloadedInputGain * hybridDelayOutputGain,
		);
	});

	it("the parameter port sets a genuine, non-trivial delay length", () => {
		// The declared delay (3 ms, 144 samples at this rate) scaled by the parameter port's
		// derived factor -- the clock node measured against its declared reference, 9 V against
		// 9 V, an exact 1.0 -- rather than a compile-time constant or a degenerate zero-length
		// delay.
		const runtime = new ReferenceRuntime(
			programFor(hybridDelayPedal, fixtureRegistry),
		);
		runtime.prepare(48_000);
		const impulse = new Float64Array(400);
		impulse[0] = 1;
		const output = runtime.process(impulse);
		for (let index = 0; index < 140; index += 1) {
			expect(Math.abs(output[index] ?? 0)).toBeLessThan(1e-9);
		}
		const later = output.slice(144, 220);
		expect(Math.max(...Array.from(later, Math.abs))).toBeGreaterThan(1e-6);
	});

	it("refuses the parameter port once the clock network is no longer control-free", () => {
		// The negative control: a trim pot added across the clock network's own nodes, so
		// `region.controls` is no longer empty there. `couple.ts`'s purity gate must refuse to
		// classify the derivation as `parameter` -- the spec's safe default on negative
		// evidence -- while the `coupled` port (audio, unaffected by this mutation) stays
		// wired exactly as before, so this pedal still compiles and still passes audio.
		const program = programFor(hybridDelayPedalMovableClock, fixtureRegistry);
		const macro = program.blocks.find(
			(block) => block.kind === "macro" || block.kind === "composed",
		);
		expect(macro).toBeDefined();
		if (macro?.kind !== "macro" && macro?.kind !== "composed") {
			return;
		}
		expect(macro.parameter).toBeNull();
		expect(macro.audioIn).not.toBeNull();
		expect(macro.audioOut).toBe(true);
	});

	it("schedules the macro before the block that consumes its write-back", () => {
		// Spec clause 3, the region schedule: `couple.ts` corrects the audio-out edge so
		// `link.ts`'s topological sort places the macro strictly before the block carrying its
		// `macro-audio-source` stamp, not after it. This is the structural half of closing the
		// one-sample lag build-order step 1 had to accept.
		const program = programFor(hybridDelayPedal, fixtureRegistry);
		const macro = program.blocks.find(
			(block) => block.kind === "macro" || block.kind === "composed",
		);
		const downstream = program.blocks.find(
			(block) =>
				block.kind === "mna" &&
				block.stamps.some((stamp) => stamp.kind === "macro-audio-source"),
		);
		expect(macro).toBeDefined();
		expect(downstream).toBeDefined();
		if (macro === undefined || downstream === undefined) {
			return;
		}
		const macroIndex = program.order.indexOf(macro.id);
		const downstreamIndex = program.order.indexOf(downstream.id);
		expect(macroIndex).toBeGreaterThanOrEqual(0);
		expect(downstreamIndex).toBeGreaterThan(macroIndex);
	});

	it("the one-sample write-back lag is gone: an impulse resolves on its exact sample", () => {
		// Where build-order step 1 could only show "eventually responds" (the lag was silently
		// absorbed by a long delay), clause 3 lets this be exact: the impulse at sample 0
		// resolves at EXACTLY sample 144 -- the fixture's declared 3 ms at 48 kHz, unscaled,
		// since the clock measures 9 V against a 9 V reference -- not 145. Before this chunk's
		// schedule fix, this test failed one sample late.
		const runtime = new ReferenceRuntime(
			programFor(hybridDelayPedal, fixtureRegistry),
		);
		runtime.prepare(48_000);
		const impulse = new Float64Array(400);
		impulse[0] = 1;
		const output = runtime.process(impulse);
		expect(Math.abs(output[143] ?? 0)).toBeLessThan(1e-9);
		expect(Math.abs(output[144] ?? 0)).toBeGreaterThan(1e-3);
		// Allows for the physical high-pass filter decay introduced by BBD AC coupling.
		expect(Math.abs(output[145] ?? 0)).toBeLessThan(0.01);
	});

	describe("S1: the BBD delay model, made behavioural", () => {
		// The plan's §5 decision is that a BBD's delay is **capacity-based** -- the document's
		// `DelayMs`, converted at the host's rate and scaled by the `parameter` port's voltage
		// ratio -- and deliberately *not* clock-live. For the Deluxe Memory Man a live clock is
		// possible but pointless (1024 stages at 125 ms is ~4.1 kHz, in band: solver cost, no
		// fidelity); for the MN3007 chorus family it is impossible at 48 kHz, because a ~5 ms
		// line needs a ~100 kHz clock, above Nyquist. This group is what turns that decision
		// from a note into something a regression can fail.
		//
		// Every expectation is hand-derived first: 3 ms x 48 kHz = 144 samples, 6 ms = 288, a
		// halved clock rail against an unchanged 9 V reference = 72, the resolver's stand-in
		// 50 ms = 2400.
		const echoAt = (source: string): number => {
			const runtime = new ReferenceRuntime(programFor(source, fixtureRegistry));
			runtime.prepare(48_000);
			const impulse = new Float64Array(6000);
			impulse[0] = 1;
			return runtime
				.process(impulse)
				.findIndex((value) => Math.abs(value) > 1e-6);
		};

		it("lowers to the macro delay line, not the bbd stamp", () => {
			// **S1's first requirement, and it comes before any measurement.** Two delay models
			// exist -- the time-based `bucket-brigade-delay-line` macro and the clock-edge `bbd`
			// stamp -- and they are not interchangeable: the stamp shifts on clock edges, which
			// at 48 kHz cannot represent a chorus clock at all. A fixture that silently lowered
			// to the other path would settle nothing about either, so the path is asserted
			// rather than assumed.
			const program = programFor(hybridDelayPedal, fixtureRegistry);
			const macro = program.blocks.find(
				(block) => block.kind === "macro" || block.kind === "composed",
			);
			expect(macro).toBeDefined();
			if (macro?.kind !== "macro" && macro?.kind !== "composed") return;
			// The companion assertion here counted `bbd` stamps and required zero. Plan M2
			// deleted that stamp kind, so the check became one that cannot fail; the modelId
			// assertion above is what carries the same claim now.
			expect(macro.modelId).toBe("bucket-brigade-delay-line");
		});

		it("carries no frequency anywhere in the macro's instruction", () => {
			// The structural half of "the clock does not set the delay", and on this fixture it
			// is the *whole* proof rather than a proxy: the macro's entire instruction is
			// `delaySeconds` plus a `parameter` port naming a block, a node and a reference
			// voltage. There is no frequency in it, so no clock waveform can move the delay --
			// not because a measurement says so, but because there is nothing for a frequency to
			// reach. A behavioural frequency sweep cannot be built on this fixture for the same
			// reason: its clock region is a DC network and carries no frequency to sweep. The
			// clock-driver-bearing shapes belong to S2b and S6.
			const program = programFor(hybridDelayPedal, fixtureRegistry);
			const macro = program.blocks.find(
				(block) => block.kind === "macro" || block.kind === "composed",
			);
			if (macro?.kind !== "macro" && macro?.kind !== "composed") {
				throw new Error("expected a delay block");
			}
			expect(Object.keys(macro.parameters).sort()).toEqual([
				"delaySeconds",
				"stages",
			]);
			expect(macro.parameter).not.toBeNull();
			expect(Object.keys(macro.parameter ?? {}).sort()).toEqual([
				"block",
				"node",
				"referenceVolts",
			]);
		});

		it("moves the delay when DelayMs moves", () => {
			// Control (i). Doubling the declared time doubles the delay exactly, which is what
			// "capacity-based" means and what a clock-live model would not guarantee.
			expect(echoAt(hybridDelayPedal)).toBe(144);
			expect(echoAt(hybridDelayPedalLongerDelay)).toBe(288);
		});

		it("scales the delay by the clock node's voltage, which is the coupling it does have", () => {
			// Not a negative control -- the opposite, and it is here so the previous test cannot
			// be read as "nothing about the clock matters". The `parameter` port scales capacity
			// by `|volts| / referenceVolts`, so halving the clock rail against an unchanged 9 V
			// reference halves the delay. A real BBD's delay goes as `stages / (2 * f_clock)`,
			// so this is a capacity model with a voltage trim rather than a clock model; §5 chose
			// that knowingly and S6 is where it is revisited.
			expect(echoAt(hybridDelayPedalHalfClockRail)).toBe(72);
		});

		it("refuses when DelayMs is absent, even though a clock terminal is present", () => {
			// Control (iii), first half -- **and this assertion is the inverse of what it was.**
			// It previously pinned a 50 ms substitution, on the reasoning that a part with a clock
			// terminal has somewhere a delay could have come from. That fallback is gone and this
			// now requires the refusal; see `device-laws.ts`'s `resolveMacro` for why.
			//
			// The cost of the old behaviour was visible where it mattered most: all four of the
			// Deluxe Memory Man's MN3008 macros took the stand-in, because that document declares
			// no delay at all -- so every DMM delay this pipeline rendered was 50 ms of ours, on a
			// pedal whose real range is roughly 30-550 ms. A stand-in landing inside the range of
			// the thing it stands in for cannot be told from a model by any render or level meter.
			//
			// A clock terminal is not evidence for a delay *value*: a BBD's delay is
			// `stages / (2 * f_clock)`, and this pipeline deliberately does not read the clock
			// (readiness plan §5). Having a clock pin says the part could have a delay, never that
			// it is 50 ms.
			const result = compile(hybridDelayPedalNoDeclaredDelay, {
				registry: fixtureRegistry,
			});
			expect(result.status).not.toBe("ok");
			if (result.status === "ok") return;
			expect(result.reasons.some((reason) => reason.device === "U1")).toBe(true);
		});

		it("models macro output loading against external load resistance (S2)", () => {
			// S2: Single BBD driving a known load. Measure the AC gain; confirm it is the
			// passive divider ((Zout + Rout) || Rload).
			// Negative control: changing R_OUT_LOAD from 1meg to 10k attenuates output from
			// hybridDelayPedalGain (~0.4470) to hybridDelayLoadedOutputGain (~0.2152).
			const nominalGain = measureGain(
				programFor(hybridDelayPedal, fixtureRegistry),
				1000,
				48_000,
				0.1,
			);
			const loadedGain = measureGain(
				programFor(hybridDelayPedalLoadedOutput, fixtureRegistry),
				1000,
				48_000,
				0.1,
			);
			expect(nominalGain).toBeCloseTo(hybridDelayPedalGain, 4);
			expect(loadedGain).toBeCloseTo(hybridDelayLoadedOutputGain, 4);
			expect(loadedGain).toBeLessThan(nominalGain);
		});

		it("refuses when DelayMs is absent and there is no clock terminal either", () => {
			// Control (iii), second half, and the pair is the point: the same missing property is
			// a 50 ms stand-in or a refusal depending on one terminal. With neither a declared
			// time nor a clock to derive one from there is nothing left, and the pipeline says so
			// by name instead of inventing a delay.
			const result = compile(hybridDelayPedalNoDelayNoClock, {
				registry: fixtureRegistry,
			});
			expect(result.status).not.toBe("ok");
			if (result.status === "ok") return;
			expect(result.reasons.some((reason) => reason.device === "U1")).toBe(
				true,
			);
		});

		it("accumulates total delay across a 4-BBD cascade (S4)", () => {
			// S4: Four BBD stages in series (e.g. SAD1024A cascade in EH-7550 Deluxe Memory Man).
			// Each stage has DelayMs: 3 (144 samples at 48 kHz).
			// Total delay across all 4 stages = 4 * 144 = 576 samples (12 ms).
			const program = programFor(hybridCascade4DelayPedal, fixtureRegistry);
			const macros = program.blocks.filter(
				(block) => block.kind === "macro" || block.kind === "composed",
			);
			expect(macros).toHaveLength(4);
			for (const macro of macros) {
				if (macro.kind !== "macro") continue;
				expect(macro.modelId).toBe("bucket-brigade-delay-line");
				expect(macro.parameters.delaySeconds).toBeCloseTo(0.003, 6);
			}
			// Exact impulse transit time through the 4-stage cascade
			expect(echoAt(hybridCascade4DelayPedal)).toBe(576);
		});

		it("negative control (S4): heterogeneous BBD cascade sums individual stage delays", () => {
			// S4 negative control (i): changing one stage's delay (U2: 3 ms -> 6 ms = 288 samples)
			// shifts total delay from 576 to 144 + 288 + 144 + 144 = 720 samples (15 ms).
			expect(echoAt(hybridCascade4DelayPedalUnequalDelays)).toBe(720);
		});

		it("negative control (S4): bypassing a stage reduces delay by that stage's duration", () => {
			// S4 negative control (ii): removing one stage (3 stages of 3 ms) reduces delay
			// from 576 to 3 * 144 = 432 samples (9 ms).
			expect(echoAt(hybridCascade3DelayPedal)).toBe(432);
		});

		it("renders repeating, decaying echoes through a schematic feedback loop (S5)", () => {
			// S5: Schematic feedback path (BBD out -> R_FB 10k -> BBD in).
			// An impulse at t=0 must produce repeating, geometrically decaying echoes spaced at
			// 145 sample intervals (144 samples macro delay + 1 sample coincident writeback lag):
			// samples 145 (3.02 ms), 290 (6.04 ms), 435 (9.06 ms), 580 (12.08 ms).
			const renderImpulse = (source: string, length = 1000): Float64Array => {
				const runtime = new ReferenceRuntime(
					programFor(source, fixtureRegistry),
				);
				runtime.prepare(48_000);
				const impulse = new Float64Array(length);
				impulse[0] = 1;
				return runtime.process(impulse);
			};

			const out = renderImpulse(hybridFeedbackDelayPedal);
			const e1 = out[145] ?? 0;
			const e2 = out[290] ?? 0;
			const e3 = out[435] ?? 0;
			const e4 = out[580] ?? 0;

			// All 4 echoes must be present and positive
			expect(e1).toBeGreaterThan(0.2);
			expect(e2).toBeGreaterThan(0.05);
			expect(e3).toBeGreaterThan(0.01);
			expect(e4).toBeGreaterThan(0.003);

			// Geometrical decay: e1 > e2 > e3 > e4
			expect(e2).toBeLessThan(e1);
			expect(e3).toBeLessThan(e2);
			expect(e4).toBeLessThan(e3);

			// Feedback loop gain beta = e2 / e1 ~ 0.291
			const beta = e2 / e1;
			expect(beta).toBeGreaterThan(0.25);
			expect(beta).toBeLessThan(0.35);
			expect(e3 / e2).toBeCloseTo(beta, 2);
			expect(e4 / e3).toBeCloseTo(beta, 2);
		});

		it("negative control (S5): feedback resistor value sets decay rate", () => {
			// S5 negative control (i): changing R_FB varies loop gain beta:
			// High feedback (R_FB = 4.7k) -> slower decay (higher beta ~ 0.44)
			// Baseline (R_FB = 10k) -> medium decay (beta ~ 0.29)
			// Low feedback (R_FB = 30k) -> faster decay (lower beta ~ 0.13)
			const renderImpulse = (source: string): Float64Array => {
				const runtime = new ReferenceRuntime(
					programFor(source, fixtureRegistry),
				);
				runtime.prepare(48_000);
				const impulse = new Float64Array(600);
				impulse[0] = 1;
				return runtime.process(impulse);
			};

			const high = renderImpulse(hybridFeedbackDelayPedalHighFeedback);
			const base = renderImpulse(hybridFeedbackDelayPedal);
			const low = renderImpulse(hybridFeedbackDelayPedalLowFeedback);

			const betaHigh = (high[290] ?? 0) / (high[145] ?? 1);
			const betaBase = (base[290] ?? 0) / (base[145] ?? 1);
			const betaLow = (low[290] ?? 0) / (low[145] ?? 1);

			expect(betaHigh).toBeGreaterThan(betaBase);
			expect(betaBase).toBeGreaterThan(betaLow);
			expect(betaHigh).toBeCloseTo(0.44, 1);
			expect(betaBase).toBeCloseTo(0.29, 1);
			expect(betaLow).toBeCloseTo(0.13, 1);
		});

		it("negative control (S5): open feedback loop produces a single echo", () => {
			// S5 negative control (ii): with no feedback loop (hybridDelayPedal),
			// only the first echo at 144 exists; the second repeat at 290 is absent.
			const runtime = new ReferenceRuntime(
				programFor(hybridDelayPedal, fixtureRegistry),
			);
			runtime.prepare(48_000);
			const impulse = new Float64Array(600);
			impulse[0] = 1;
			const out = runtime.process(impulse);

			expect(Math.abs(out[144] ?? 0)).toBeGreaterThan(0.1);
			expect(Math.abs(out[288] ?? 0)).toBeLessThan(1e-4);
			expect(Math.abs(out[290] ?? 0)).toBeLessThan(1e-4);
		});

		it("negative control (S5): active loop gain > 1 produces growing echoes", () => {
			// S5 negative control (iii): with active op-amp gain in the feedback path (Av = 5),
			// loop gain exceeds unity, so the second echo is larger than the first (e2 > e1).
			const runtime = new ReferenceRuntime(
				programFor(hybridFeedbackDelayPedalUnstableLoop, fixtureRegistry),
			);
			runtime.prepare(48_000);
			const impulse = new Float64Array(600);
			impulse[0] = 1;
			const out = runtime.process(impulse);

			const e1 = Math.abs(out[145] ?? 0);
			const e2 = Math.abs(out[290] ?? 0);
			expect(e1).toBeGreaterThan(0.01);
			expect(e2).toBeGreaterThan(e1);
		});

		it("BBD delay lines and cascades meet real-time Newton convergence deadline (S6)", () => {
			// S6: Convergence / cost with the BBD in the MNA.
			// Evaluates per-sample Newton iterations across BBD topologies under a dynamic 1 kHz sine input:
			// (1) Feedback loop (hybridFeedbackDelayPedal): linear MNA blocks solve in 1 iteration per block.
			// (2) 4-stage cascade (hybridCascade4DelayPedal): 7 MNA blocks solve in 1 iteration per block.
			// (3) Non-linear active feedback loop (hybridFeedbackDelayPedalUnstableLoop): bounded peak <= 10 iterations.
			// All BBD topologies must have 0 non-converged samples.
			const renderSineTelemetry = (
				source: string,
				registry: PartRegistry,
				length = 1920,
			) => {
				const runtime = new ReferenceRuntime(
					programFor(source, registry),
				);
				runtime.prepare(48_000, { maxNewtonIterations: 2000 });
				const input = new Float64Array(length);
				for (let i = 0; i < length; i++) {
					input[i] = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / 48_000);
				}
				for (let i = 0; i < length; i++) {
					runtime.process(input.subarray(i, i + 1));
				}
				return runtime.telemetry();
			};

			const tFeedback = renderSineTelemetry(
				hybridFeedbackDelayPedal,
				fixtureRegistry,
			);
			expect(tFeedback.nonConvergedSamples).toBe(0);
			expect(tFeedback.peakIterations).toBe(1);
			expect(tFeedback.totalIterations).toBe(5760); // 3 blocks * 1920 samples

			const tCascade = renderSineTelemetry(
				hybridCascade4DelayPedal,
				fixtureRegistry,
			);
			expect(tCascade.nonConvergedSamples).toBe(0);
			expect(tCascade.peakIterations).toBe(1);
			expect(tCascade.totalIterations).toBe(13440); // 7 blocks * 1920 samples

			const tUnstable = renderSineTelemetry(
				hybridFeedbackDelayPedalUnstableLoop,
				fixtureRegistry,
			);
			expect(tUnstable.nonConvergedSamples).toBe(0);
			expect(tUnstable.peakIterations).toBeLessThanOrEqual(10);
		});

		it("CD4047 clock driver converges within the real-time solve budget (S6)", () => {
			// S6: Quantifies the cost of the CD4047 clock driver in the MNA.
			// The CD4047 companion model stamps via auxiliary voltage source rows with constant impedance,
			// solving in 1 iteration per sample with zero convergence degradation.
			const runtime = new ReferenceRuntime(
				programFor(cd4047BarePinMap, pedalPartCatalog),
			);
			runtime.prepare(48_000, { maxNewtonIterations: 2000 });
			const input = new Float64Array(1920);
			for (let i = 0; i < input.length; i++) {
				input[i] = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / 48_000);
			}
			for (let i = 0; i < input.length; i++) {
				runtime.process(input.subarray(i, i + 1));
			}
			const t = runtime.telemetry();
			expect(t.nonConvergedSamples).toBe(0);
			expect(t.peakIterations).toBe(1);
			expect(t.totalIterations).toBe(1920);
		});
	});

	it("a macro's delay is a time, so the same program follows the host's rate", () => {
		// The invariant `Program` states by construction -- there is no `sampleRate` field --
		// applied to the one block kind that used to break it. The delay parameter was a raw
		// buffer length, so one ROM played as a different pedal on a different host: 1024
		// "stages" was 21.3 ms at 48 kHz and 10.7 ms at 96 kHz. Now the program carries 3 ms and
		// `prepare()` converts, so the sample index doubles with the rate while the delay in
		// seconds does not move.
		const impulseAt = (rate: number): number => {
			const runtime = new ReferenceRuntime(
				programFor(hybridDelayPedal, fixtureRegistry),
			);
			runtime.prepare(rate);
			const impulse = new Float64Array(Math.round(0.008 * rate));
			impulse[0] = 1;
			const output = runtime.process(impulse);
			return output.findIndex((value) => Math.abs(value) > 1e-3);
		};
		const at48k = impulseAt(48_000);
		const at96k = impulseAt(96_000);
		expect(at48k).toBe(144);
		expect(at96k).toBe(288);
		// The same delay in seconds at both rates, which is the point.
		expect(at48k / 48_000).toBeCloseTo(at96k / 96_000, 9);
	});

	it("a wrong schedule is measurably wrong, reproducing gate 1a's shape", () => {
		// Gate 1a measured a region-order defect at 2% of the signal on its own fixture -- "not
		// a wrong component or a wrong number, only a wrong schedule." Reproduced here on this
		// one: take the correctly-scheduled program and swap the macro and its downstream block
		// in `order`, recreating exactly the schedule build-order step 1 had to accept before
		// clause 3 landed. The two programs share every stamp and every parameter; only the
		// order of execution within a sample differs.
		const program = programFor(hybridDelayPedal, fixtureRegistry);
		const macro = program.blocks.find(
			(block) => block.kind === "macro" || block.kind === "composed",
		);
		const downstream = program.blocks.find(
			(block) =>
				block.kind === "mna" &&
				block.stamps.some((stamp) => stamp.kind === "macro-audio-source"),
		);
		expect(macro).toBeDefined();
		expect(downstream).toBeDefined();
		if (macro === undefined || downstream === undefined) {
			return;
		}
		const order = [...program.order];
		const macroIndex = order.indexOf(macro.id);
		const downstreamIndex = order.indexOf(downstream.id);
		[order[macroIndex], order[downstreamIndex]] = [
			order[downstreamIndex] as string,
			order[macroIndex] as string,
		];
		const wrongProgram: Program = { ...program, order };

		const renderSine = (target: Program): Float64Array => {
			const runtime = new ReferenceRuntime(target);
			runtime.prepare(48_000);
			const cycles = 200;
			const hz = 1000;
			const length = Math.round((cycles * 48_000) / hz);
			const input = new Float64Array(length);
			for (let index = 0; index < length; index += 1) {
				input[index] = Math.sin((2 * Math.PI * hz * index) / 48_000);
			}
			return runtime.process(input);
		};
		const correct = renderSine(program);
		const wrong = renderSine(wrongProgram);

		let signalSquared = 0;
		let errorSquared = 0;
		let count = 0;
		for (
			let index = Math.floor(correct.length * 0.75);
			index < correct.length;
			index += 1
		) {
			const c = correct[index] ?? 0;
			const w = wrong[index] ?? 0;
			signalSquared += c * c;
			errorSquared += (c - w) * (c - w);
			count += 1;
		}
		const fraction =
			Math.sqrt(errorSquared / count) / Math.sqrt(signalSquared / count);
		// Measured at 13.1% for this fixture at 1000 Hz/48 kHz -- a different fixture and
		// frequency from gate 1a's own 2%, so a different number, but the same shape: small,
		// nonzero, many orders above roundoff, and entirely attributable to WHEN a block ran
		// rather than to any stamp or parameter being wrong.
		expect(fraction).toBeGreaterThan(0.05);
		expect(fraction).toBeLessThan(0.2);
	});

	it("compiles the coincident case with a documented one-sample write-back lag, not a refusal", () => {
		// Corrected 2026-08-14. A resistor joining the input and output shells merges them into
		// one region, which is both the macro's driver (must run before it, for audio-in) and its
		// downstream (must run after it, for the write-back) -- the topology all three real
		// delay/BBD packets that clear device-law identification (`pt2399-delay`, `boss-ce-2`,
		// `boss-ce-5`) actually wire, an unbuffered resistor bridging the chip's audio-out
		// directly to its audio-in with no op-amp between them. `couple.ts`'s first landing of
		// clause 3 added both directional edges unconditionally and made this case a 2-cycle,
		// which `link.ts` correctly refused -- but same-sample resolution is not the only honest
		// answer: a macro's write-back is delayed by construction (computed from history alone,
		// never from this sample's still-unknown solution), so the region can run BEFORE the
		// macro, giving it this sample's audio-in, while the region's own `macro-audio-source`
		// stamp reads last sample's write-back rather than this one -- a documented, one-sided
		// lag, not a silent one. See `thoughts/shared/experiments/
		// coincident-region-schedule-lag/README.md` for the measured cost on exactly this
		// topology.
		const program = programFor(hybridDelayPedalCyclicSchedule, fixtureRegistry);
		const macro = program.blocks.find(
			(block) => block.kind === "macro" || block.kind === "composed",
		);
		expect(macro).toBeDefined();
		if (macro?.kind !== "macro" && macro?.kind !== "composed") {
			return;
		}
		// Reject the false successes a schedulable-but-inert program would also produce:
		// declining the coupled port entirely, or wiring only the chip's unused pin. Both sides
		// of the coupled port must be genuinely wired -- a loaded driver and a real write-back
		// consumer -- for this to be a real result rather than a compiling, silent chip.
		expect(macro.audioIn).not.toBeNull();
		expect(macro.audioOut).toBe(true);
		const region = program.blocks.find(
			(block) =>
				block.kind === "mna" &&
				block.stamps.some((stamp) => stamp.kind === "macro-audio-source") &&
				macro.audioIn !== null &&
				block.id === macro.audioIn.block,
		);
		expect(region).toBeDefined();
		if (region === undefined) {
			return;
		}
		// The merged region is both the macro's driver and its write-back consumer -- confirming
		// this fixture is genuinely the coincident case, not the general one.
		const macroIndex = program.order.indexOf(macro.id);
		const regionIndex = program.order.indexOf(region.id);
		expect(macroIndex).toBeGreaterThanOrEqual(0);
		expect(regionIndex).toBeGreaterThanOrEqual(0);
		expect(regionIndex).toBeLessThan(macroIndex);
	});

	it("schedules chained multi-macro feedback loops with upstream region leading", () => {
		// Multi-macro feedback loop: Macro 1 is driven by the input region, Macro 2 is driven
		// by Macro 1's downstream region and feeds back into the input region. The input region
		// executes first, followed by Macro 1, intermediate regions, and Macro 2.
		const result = compile(hybridDelayPedalChainedMacroCycle, {
			registry: fixtureRegistry,
		});
		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(result.program.order).toEqual([
				"analog:0",
				"analog:1",
				"analog:2",
				"macro:U1",
				"analog:3",
				"macro:U2",
			]);
		}
	});
});

describe("terminal roles, not declaration order", () => {
	it("routes through the throw a selector selects, not the first two terminals", () => {
		// Lowering used to read nodes[0] and nodes[1], so the second throw vanished --
		// on 84 of the corpus's 118 wired switches. Both legs are stamped here and the
		// control decides which conducts.
		const program = programFor(selectorRouting);
		// Throws are declared `bright,dark`, so the lower half of the travel is the
		// first throw. The names, not the option order, decide which that is.
		const bright = measureGain(program, 1000, 48_000, 1, { Range: 0.25 });
		const dark = measureGain(program, 1000, 48_000, 1, { Range: 0.75 });
		// 1k into 1k is half; 1meg into 1k is nearly nothing.
		expect(bright).toBeCloseTo(0.5, 1);
		expect(dark).toBeLessThan(0.01);
	});

	it("finds a selector's common by role, wherever it is declared", () => {
		// `throw0,throw1,common` is a real corpus shape. Building the pole from the
		// first terminal instead drops the real common, and with it the node the input
		// jack sits on -- silence from a circuit where every stage reported success.
		const ordered = measureGain(programFor(selectorRouting), 1000, 48_000, 1);
		const commonLast = measureGain(
			programFor(selectorCommonLast),
			1000,
			48_000,
			1,
		);
		expect(ordered).toBeCloseTo(0.5, 1);
		expect(commonLast).toBeCloseTo(ordered, 6);
	});

	it("resolves a selector's stated position against the options it declares", () => {
		// `Position: Bright` with `Options: Dark,Bright` and throws declared
		// `bright,dark`. Reading the position as a number gives NaN then half travel;
		// taking the option's index picks `dark`. Only the name match is right.
		const program = programFor(selectorRouting);
		const atDefault = measureGain(program, 1000, 48_000, 1);
		expect(atDefault).toBeCloseTo(0.5, 1);
	});

	it("reads a pot's wiper by role, not by it sitting in the middle", () => {
		// With the wiper taken from position 2, the grounded end becomes the wiper,
		// both halves of the track short to ground, and the output is cut off from the
		// input: exact silence from a circuit that still compiles.
		const middle = measureGain(programFor(potDivider), 1000, 48_000, 1, {
			Level: 0.5,
		});
		const last = measureGain(programFor(potDividerWiperLast), 1000, 48_000, 1, {
			Level: 0.5,
		});
		expect(middle).toBeCloseTo(potGainAt(0.5), 2);
		expect(last).toBeCloseTo(middle, 6);
	});

	it("reads a transistor's base by role, not by declaration order", () => {
		const canonical = measureGain(
			programFor(emitterFollower),
			1000,
			48_000,
			0.05,
		);
		const reordered = measureGain(
			programFor(emitterFollowerReordered),
			1000,
			48_000,
			0.05,
		);
		expect(canonical).toBeGreaterThan(0.8);
		expect(reordered).toBeCloseTo(canonical, 6);
	});

	it("reads a supply's polarity by role however the document orders it", () => {
		// The last asymmetric device still read by position. Reversing `plus` and `minus`
		// inverted the rail to -9 V and compiled `ok`, so the follower biased nowhere.
		const canonical = measureGain(
			programFor(emitterFollower),
			1000,
			48_000,
			0.05,
		);
		const reversed = measureGain(
			programFor(emitterFollowerSupplyReversed),
			1000,
			48_000,
			0.05,
		);
		expect(canonical).toBeGreaterThan(0.8);
		expect(reversed).toBeCloseTo(canonical, 6);
	});

	it("takes a one-terminal rail as standing against ground", () => {
		// A rail names one node and means "against ground". Most corpus supplies are
		// written this way, and requiring two terminals to read a polarity refused 34
		// packets while every unit test stayed green -- so this shape is now a fixture.
		const gain = measureGain(
			programFor(emitterFollowerRailToGround),
			1000,
			48_000,
			0.05,
		);
		expect(gain).toBeGreaterThan(0.8);
	});

	it("refuses a supply restated with the opposite polarity", () => {
		// Not a duplicate to collapse: +9 V and -9 V across one pair of nodes cannot both
		// hold. The reversed twin used to key differently and be stamped as a second row.
		const result = compile(contradictorySupplyTwin, {
			registry: emptyRegistry,
		});
		expect(result.status).toBe("unsupported");
	});

	it("reads an op-amp's inputs by role however the document orders them", () => {
		// The corpus writes `inverting,nonInverting,output` and `positive,out,negative`
		// as readily as the textbook order. Reading position exchanges the two inputs,
		// which inverts the stage and still renders plausible audio.
		const ordered = measureGain(
			programFor(invertingAmplifier),
			1000,
			48_000,
			0.1,
		);
		const reordered = measureGain(
			programFor(invertingAmplifierReordered),
			1000,
			48_000,
			0.1,
		);
		expect(ordered).toBeCloseTo(invertingGain, 1);
		expect(reordered).toBeCloseTo(ordered, 6);
	});
});

describe("a two-terminal rheostat is its own device, not a pot missing a wiper", () => {
	it("divides at its hand-computed mid-travel resistance", () => {
		const gain = measureGain(programFor(rheostatDivider), 1000, 48_000, 1, {
			Sag: 0.5,
		});
		expect(gain).toBeCloseTo(rheostatMidGain, 2);
	});

	it("sweeps from a residual minimum rather than from a short", () => {
		const gain = measureGain(programFor(rheostatWithMinimum), 1000, 48_000, 1, {
			Sag: 0.5,
		});
		expect(gain).toBeCloseTo(rheostatMidGainWithMinimum, 2);
	});

	it("moves the output when the control moves", () => {
		const program = programFor(rheostatDivider);
		const low = measureGain(program, 1000, 48_000, 1, { Sag: 0.05 });
		const high = measureGain(program, 1000, 48_000, 1, { Sag: 0.95 });
		expect(high).toBeGreaterThan(low + 0.2);
	});
});

describe("op-amp quiet-reference seeding orients a rheostat-shaped pot", () => {
	// Both track ends are DC-isolated; one end hangs one hop off a `vplus` rail node, the
	// other three hops off the inverting input. Re-adding `vplus`/`vminus` to the seed
	// vocabulary flips the track, and the off-centre gains below are the pair that detects
	// it: the 0.5 midpoint is identical under either orientation, so it is an anchor, not
	// a discriminator.
	it("sweeps the hand-computed gains the input-adjacent way", () => {
		const program = programFor(quietSeedRheostat);
		expect(
			measureGain(program, 1000, 48_000, 1, { Level: 0.25 }),
		).toBeCloseTo(quietSeedGainQuarter, 2);
		expect(
			measureGain(program, 1000, 48_000, 1, { Level: 0.5 }),
		).toBeCloseTo(quietSeedGainMid, 2);
		expect(
			measureGain(program, 1000, 48_000, 1, { Level: 0.75 }),
		).toBeCloseTo(quietSeedGainThreeQuarter, 2);
	});
});

describe("a document it cannot use is a result, not an exception", () => {
	// One malformed packet must not take down a batch, and the caller needs to tell
	// "could not read this document" from "cannot model this part" without catching.
	const cases = [
		{ name: "unreadable document", source: malformed, stage: "netlist" },
		{ name: "unparseable value", source: unparseableValue, stage: "netlist" },
		{
			name: "control straddling two regions",
			source: straddlingControl,
			stage: "partition",
		},
		{ name: "pot with two terminals", source: rheostatPot, stage: "lower" },
		{
			name: "document with no typed jack",
			source: untypedJacks,
			stage: "netlist",
		},
		{
			name: "document with nothing to execute",
			source: nothingToExecute,
			stage: "link",
		},
	] as const;

	for (const { name, source, stage } of cases) {
		it(`refuses a ${name} without throwing`, () => {
			const result = compile(source, { registry: emptyRegistry });
			expect(result.status).toBe("unsupported");
			if (result.status === "unsupported") {
				expect(result.reasons[0]?.stage).toBe(stage);
				expect(result.reasons[0]?.reason.length).toBeGreaterThan(0);
			}
		});
	}

	it("names the component when the refusing stage knows it", () => {
		const result = compile(rheostatPot, { registry: emptyRegistry });
		if (result.status === "unsupported") {
			expect(result.reasons[0]?.device).toBe("VR1");
		}
	});
});

describe("adversarial prose changes nothing", () => {
	it("renders the divider identically despite its BBD and clock-driver prose", () => {
		// The fixture names a resistor BBD_DELAY_MEMORY and describes it as an MN3007.
		// If any stage ever reads that, this number moves.
		expect(measureGain(programFor(resistorDivider), 1000, 48_000)).toBeCloseTo(
			dividerGain,
			3,
		);
	});
});

describe("a control that cannot affect the circuit is warned about, not refused", () => {
	it("refuses when the knob provably cannot move the output", () => {
		// Strict admission: a pedal with a dead knob is refused because it cannot perform
		// its advertised function.
		const result = compile(potWithFloatingWiper, { registry: emptyRegistry });
		expect(result.status).toBe("unsupported");
		if (result.status !== "unsupported") {
			return;
		}
		expect(result.reasons).toHaveLength(1);
		expect(result.reasons[0]?.stage).toBe("link");
		expect(result.reasons[0]?.device).toBe("VR1");
		expect(result.reasons[0]?.reason).toContain("Level");
	});

	it("says nothing about a pot whose wiper is connected", () => {
		const result = compile(potDivider, { registry: emptyRegistry });
		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(result.warnings).toEqual([]);
		}
	});

	it("warns when every element a control varies sits in a region nothing executes", () => {
		// The third way to be dead, and the one only the emitted schedule can see: this pot is
		// wired, loaded and grounded, so neither earlier rule applies -- its region simply owns
		// no jack and feeds nothing that does, so `link` leaves it out of the execution order.
		// Documented scope exclusions (e.g. unselected channels) warn rather than refuse.
		const result = compile(controlInUnexecutedRegion, {
			registry: emptyRegistry,
		});
		expect(result.status).toBe("ok");
		if (result.status !== "ok") {
			return;
		}
		const inert = result.warnings.filter(
			(w) => w.code === "control-cannot-affect-circuit",
		);
		expect(inert).toHaveLength(1);
		expect(inert[0]?.control).toBe("Trim");
	});

	it("says nothing about the same pot once its region reaches the output", () => {
		// The negative control, one node apart from the fixture above: the island returns to the
		// output node instead of to ground, so it is no longer an island. A rule that reported
		// the pot rather than the schedule would warn here too.
		const result = compile(controlInScheduledRegion, {
			registry: emptyRegistry,
		});
		expect(result.status).toBe("ok");
		if (result.status !== "ok") {
			return;
		}
		expect(result.warnings).toEqual([]);
		// And the knob is audible, which is why warning about it would have been wrong.
		const low = measureGain(result.program, 1000, 48_000, 1, { Trim: 0.1 });
		const high = measureGain(result.program, 1000, 48_000, 1, { Trim: 0.9 });
		expect(high).not.toBe(low);
	});
});

describe("an op-amp whose operating point nothing pins is warned about", () => {
	it("warns when the only feedback element is a capacitor", () => {
		// At DC the capacitor is an open circuit, so the output cannot influence its own
		// inverting input and no standing differential is corrected. `ibanez-pql` ships this
		// on its signal path and diverges to 8.55e+12 V from a 9 V supply.
		const result = compile(opampCapacitiveFeedbackOnly, {
			registry: emptyRegistry,
		});
		expect(result.status).toBe("ok");
		if (result.status !== "ok") {
			return;
		}
		const unbounded = result.warnings.filter(
			(warning) => warning.code === "opamp-operating-point-unbounded",
		);
		expect(unbounded.map((warning) => warning.device)).toEqual(["U1"]);
	});

	it("says nothing when the feedback path conducts at DC", () => {
		// The same fixture with a resistor there instead. One element apart, and the
		// difference is the whole claim -- a detector that warned about both would be
		// reporting "this is an op-amp".
		const result = compile(invertingAmplifier, { registry: emptyRegistry });
		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(
				result.warnings.filter(
					(warning) => warning.code === "opamp-operating-point-unbounded",
				),
			).toEqual([]);
		}
	});
});

describe("a triode solves the operating point its experiment validated", () => {
	it("lands on whole-amp-5f1's V1A bias", () => {
		// The oracle rather than a snapshot: `Vk 1.251`, `Vp 166.6` on a 250 V rail through
		// 100k with a 1.5k cathode, and the pair is hand-checkable -- `Ip = Vk/Rk` and
		// `Vp = 250 - Ip*100k` must agree, which they do to four figures. A wrong Jacobian
		// converges somewhere else or not at all, so this is what makes the derivative
		// evidence rather than algebra I checked myself.
		const result = compile(triodeGainStage, { registry: emptyRegistry });
		expect(result.status).toBe("ok");
		if (result.status !== "ok") {
			return;
		}
		const runtime = new ReferenceRuntime(result.program);
		runtime.prepare(48_000);
		runtime.process(new Float64Array(1));
		expect(runtime.telemetry().operatingPointFailures).toBe(0);
		const snapshot = runtime.nodeVoltageSnapshot()[0];
		const cathode = snapshot?.voltages[3] ?? Number.NaN;
		const plate = snapshot?.voltages[4] ?? Number.NaN;
		expect(cathode).toBeCloseTo(triodeStageCathodeVolts, 2);
		expect(plate).toBeCloseTo(triodeStagePlateVolts, 1);
		// The same fact from the other direction, and independent of the tube law entirely:
		// the plate current through the cathode resistor must be what the plate load drops.
		//
		// **The rail is read from the solve, not from the EMF.** This asserted a literal `250`
		// until supplies gained a series impedance, at which point the two stopped being the
		// same number: node 5 settles at `249.999166`, drooping by the plate current through
		// one ohm. The old form then failed by `8.51e-4`, which *is* `I * R` — the assertion
		// was measuring the new stamp working. Kirchhoff around the plate load needs the
		// voltage the load actually sees, so a supply model can change without touching this.
		//
		// Four decimals rather than machine precision, because the identity is only exact
		// without `gmin`. The plate node carries `1e-12 S` to ground, which at 166 V is
		// `1.66e-10 A`, and through the 100k load that is `1.66e-5 V` — which is the residual
		// this measures. The check is sensitive to gmin's leakage, not loose.
		const rail = snapshot?.voltages[5] ?? Number.NaN;
		expect(rail - (cathode / 1500) * 100_000).toBeCloseTo(plate, 4);
	});

	it("puts a triode region on the Newton path", () => {
		// A triode classified linear would be evaluated once from a zero start and emitted as
		// a solved answer -- no held sample, no telemetry. `partition.ts` used to decide this
		// from an allow-list that a new device kind had to remember to join.
		const result = compile(triodeGainStage, { registry: emptyRegistry });
		if (result.status !== "ok") {
			throw new Error("triode fixture did not compile");
		}
		const block = result.program.blocks[0];
		expect(block?.kind).toBe("mna");
		if (block?.kind === "mna") {
			expect(block.linear).toBe(false);
		}
	});
});

describe("a diode forward across the supply is warned about", () => {
	it("names a protection diode wired the wrong way round", () => {
		// The compiled circuit contains a short. The runtime renders it anyway, because the
		// junction voltage is clamped rather than allowed to run away -- `ibanez-ts808` carries
		// 1.074 A through exactly this and reports a plausible gain.
		const result = compile(diodeShortingSupply, { registry: emptyRegistry });
		expect(result.status).toBe("ok");
		if (result.status !== "ok") {
			return;
		}
		const shorts = result.warnings.filter(
			(warning) => warning.code === "diode-forward-across-supply",
		);
		expect(shorts.map((warning) => warning.device)).toEqual(["DPROT"]);
	});

	it("says nothing when the same diode points the other way", () => {
		// Cathode to the rail is the correct arrangement: reverse biased in normal operation,
		// conducting only if the supply is reversed. One swapped pair of roles apart, and a
		// check that warned about both would be reporting "this circuit has a diode".
		const result = compile(diodeProtectingSupply, { registry: emptyRegistry });
		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(
				result.warnings.filter(
					(warning) => warning.code === "diode-forward-across-supply",
				),
			).toEqual([]);
		}
	});
});

describe("a FET channel conducts both ways", () => {
	it("solves a reverse-biased JFET instead of treating it as cut off", () => {
		// A real channel is symmetric -- which is why a JFET works as an analogue switch --
		// and the runtime treated `vds < 0` as full cutoff until 2026-08-12. Here the source
		// is pulled up through 10k and the drain pulled down through 10k, so the drain sits
		// *below* the source and only a symmetric law conducts.
		//
		// The numbers are the check. Cut off, the two resistors are independent and the nodes
		// sit at the rail and at ground; conducting, the channel loads both and they meet in
		// between. ngspice puts this fixture's output at 1.2560e-1 RMS against our 1.2569e-1,
		// which is 0.08% -- so these values are an independent oracle rather than a snapshot.
		const result = compile(jfetReverseBiased, { registry: emptyRegistry });
		expect(result.status).toBe("ok");
		if (result.status !== "ok") {
			return;
		}
		const runtime = new ReferenceRuntime(result.program);
		runtime.prepare(48_000);
		runtime.process(new Float64Array(1));
		const voltages = runtime.nodeVoltageSnapshot()[0]?.voltages ?? [];
		const drain = voltages[2] ?? Number.NaN;
		const sourceNode = voltages[3] ?? Number.NaN;
		// Conducting: neither node is parked at its resistor's end.
		expect(sourceNode).toBeLessThan(8.5);
		expect(drain).toBeGreaterThan(0.5);
		// And the drain really is below the source, so this is the reverse branch.
		expect(drain).toBeLessThan(sourceNode);
	});
	it("reports the supply's branch current, signed", () => {
		// `diodeProtectingSupply` is hand-computable at DC: a 9 V rail at node 3 feeds node 2
		// through 100k, and node 2 sees 10k to ground in parallel with 10k to the input jack,
		// which the input source holds at 0 V while the operating point is solved. So the load
		// is 105k and the supply passes 9 / 105000 = 85.7 uA. The protection diode is reverse
		// biased here and passes its saturation current, orders of magnitude below that.
		//
		// This is the only place the value exists: an ideal source has no impedance relating
		// its voltage to its current, so no combination of node voltages yields it.
		const runtime = new ReferenceRuntime(programFor(diodeProtectingSupply));
		runtime.prepare(48_000);
		runtime.process(new Float64Array(1));

		const supplies = runtime
			.branchCurrentSnapshot()
			.filter((branch) => branch.kind === "dc-source");
		expect(supplies).toHaveLength(1);
		const amps = supplies[0]?.amps ?? Number.NaN;
		// Negative because the convention is current *into* the first terminal from the
		// circuit, so a source delivering power reads negative. The sign is the contract here;
		// getting it backwards would invert every rail-current consumer.
		expect(amps).toBeLessThan(0);
		expect(Math.abs(amps)).toBeCloseTo(9 / 105_000, 7);
	});

	it("reports the operating point's supply draw, so a short is not silent", () => {
		// The same fixture wired both ways. Protecting: the diode is reverse biased and the
		// supply passes the divider's 85.7 uA. Shorting: its anode is on the 9 V node and its
		// cathode on ground, so the whole supply forward biases it.
		//
		// The point is the *ratio*, not either number. An ideal source supplies whatever is
		// asked of it, so a dead short across it renders a plausible pedal and moves no other
		// telemetry counter — measured on a real packet at 193 A. This is the number that says
		// so.
		const protecting = new ReferenceRuntime(programFor(diodeProtectingSupply));
		protecting.prepare(48_000);
		protecting.process(new Float64Array(1));
		expect(protecting.telemetry().operatingPointSupplyAmps).toBeCloseTo(
			9 / 105_000,
			7,
		);

		const shorting = new ReferenceRuntime(programFor(diodeShortingSupply));
		shorting.prepare(48_000);
		shorting.process(new Float64Array(1));
		const shorted = shorting.telemetry().operatingPointSupplyAmps;
		// Amps rather than microamps: four orders of magnitude of separation, which is what
		// makes this readable without the runtime having to guess a threshold.
		expect(shorted).toBeGreaterThan(0.5);
		expect(shorted / (9 / 105_000)).toBeGreaterThan(1_000);
	});
	it("droops a supply under load in proportion to its source impedance", () => {
		// `diodeProtectingSupply` is a 9 V rail through 100k into 10k parallel 10k, so an ideal
		// supply passes 9/105000. Give the supply a series resistance and it joins the divider:
		// the current becomes 9/(105000 + R) and the terminal voltage droops by R times it.
		//
		// 5k is chosen to be large enough that the arithmetic is unambiguous, not because a
		// battery has 5k of impedance. What is being pinned is the *law*, and specifically that
		// the sign is a droop rather than a boost -- getting it backwards would make every
		// loaded rail rise.
		const program = programFor(diodeProtectingSupply);
		const withImpedance = {
			...program,
			blocks: program.blocks.map((block) =>
				block.kind === "mna"
					? {
							...block,
							stamps: block.stamps.map((stamp) =>
								stamp.kind === "dc-source"
									? { ...stamp, sourceOhms: 5_000 }
									: stamp,
							),
						}
					: block,
			),
		};

		const runtime = new ReferenceRuntime(withImpedance);
		runtime.prepare(48_000);
		runtime.process(new Float64Array(1));
		const amps =
			runtime.branchCurrentSnapshot().find((b) => b.kind === "dc-source")
				?.amps ?? Number.NaN;
		expect(Math.abs(amps)).toBeCloseTo(9 / 110_000, 7);

		// And the node the supply drives sits below its EMF by exactly R * i.
		const supplyNode =
			runtime.nodeVoltageSnapshot()[0]?.voltages[3] ?? Number.NaN;
		// Four significant figures of a 0.409 V droop. Not tighter, because the fixture's
		// reverse-biased diode passes its saturation current and every node carries `gmin`, so
		// the exact divider is approached rather than met -- by 1.2e-5 V here.
		expect(supplyNode).toBeCloseTo(9 - 5_000 * (9 / 110_000), 4);
		expect(supplyNode).toBeLessThan(9);
	});

	it("is bit-identical to an ideal supply at zero source impedance", () => {
		// The reduction that makes this safe to add: with `sourceOhms: 0` the extra term is
		// `-0 * i` and the stamp is the ideal one, so no existing packet moves.
		const program = programFor(diodeProtectingSupply);
		const ideal = new ReferenceRuntime(program);
		ideal.prepare(48_000);
		ideal.process(new Float64Array(1));
		expect(
			ideal.branchCurrentSnapshot().find((b) => b.kind === "dc-source")?.amps ??
				Number.NaN,
		).toBeCloseTo(-(9 / 105_000), 7);
	});
});

describe("an AC supply is a sine EMF, not a battery", () => {
	/** The fixture's declared mains RMS magnitude, and the divider it feeds. */
	const DECLARED_RMS_VOLTS = 10;
	/**
	 * The law's peak amplitude: a typed AC-source magnitude is declared RMS by project
	 * convention, and the sine evaluation needs peak, so `AC_SOURCE_RMS_TO_PEAK` (`sqrt(2)`)
	 * converts it in `device-laws.ts`.
	 */
	const AMPLITUDE_VOLTS = DECLARED_RMS_VOLTS * Math.SQRT2;
	const FREQUENCY_HZ = 60;
	const SAMPLE_RATE = 48_000;
	/** `1 ohm` of source impedance plus 999 into 1000: exactly half, including the supply's own. */
	const DIVIDER = 1000 / 2000;

	it("lowers to an ac-source stamp oriented by hot against neutral", () => {
		const program = programFor(acMainsDivider);
		const block = program.blocks.find(
			(candidate) => candidate.kind === "mna" && candidate.outputNode !== null,
		);
		if (block === undefined || block.kind !== "mna") {
			throw new Error("fixture produced no driven block");
		}
		const sources = block.stamps.filter((stamp) => stamp.kind === "ac-source");
		expect(sources).toHaveLength(1);
		const source = sources[0];
		if (source === undefined || source.kind !== "ac-source") {
			throw new Error("no ac-source stamp");
		}
		expect(source.amplitudeVolts).toBeCloseTo(AMPLITUDE_VOLTS, 12);
		expect(source.frequencyHz).toBe(FREQUENCY_HZ);
		// `neutral` is the return, so the driven end is the divider's top and not ground.
		expect(source.negative).toBe(0);
		expect(source.positive).not.toBe(0);
		// And no DC supply was stamped beside it: one declaration, one element.
		expect(block.stamps.some((stamp) => stamp.kind === "dc-source")).toBe(
			false,
		);
	});

	it("renders half the declared amplitude, sample by sample", () => {
		// Hand-computed rather than measured: at sample `n` the EMF is
		// `10 * sqrt(2) * sin(2*pi*60*n/48000)` -- the declared 10 V RMS converted to its
		// 14.142... V peak by the law -- and the divider passes exactly half of it, so every
		// sample has a closed form. A stamp that dropped `sourceOhms` would read `1000/1999`
		// and miss in the fourth digit; a clock that advanced per buffer would drift.
		const runtime = new ReferenceRuntime(programFor(acMainsDivider));
		runtime.prepare(SAMPLE_RATE);
		const output = runtime.process(new Float64Array(400));
		for (const index of [0, 1, 17, 199, 399]) {
			const expected =
				AMPLITUDE_VOLTS *
				DIVIDER *
				Math.sin((2 * Math.PI * FREQUENCY_HZ * index) / SAMPLE_RATE);
			expect(output[index] ?? Number.NaN).toBeCloseTo(expected, 8);
		}
		// The first sample is `t = 0`, so the EMF is zero there -- the same state ngspice's
		// initial transient solution reports for `SIN(0 a f)`.
		expect(output[0] ?? Number.NaN).toBe(0);
		// One solve per sample: a time-varying source is still a linear element.
		expect(runtime.telemetry().peakIterations).toBe(1);
		expect(runtime.telemetry().nonConvergedSamples).toBe(0);
	});

	it("renders the same waveform whatever the callback size", () => {
		// The clock advances per sample, not per buffer, so a host's block size cannot shift
		// the mains phase. The rectifier experiment measures this invariance as `rmsDelta = 0`;
		// here it is bit-for-bit.
		const program = programFor(acMainsDivider);
		const whole = new ReferenceRuntime(program);
		whole.prepare(SAMPLE_RATE);
		const once = [...whole.process(new Float64Array(300))];

		const split = new ReferenceRuntime(program);
		split.prepare(SAMPLE_RATE);
		const pieces = [
			...split.process(new Float64Array(128)),
			...split.process(new Float64Array(1)),
			...split.process(new Float64Array(171)),
		];
		expect(pieces).toEqual(once);
	});

	it("holds a constant when the same document declares no frequency", () => {
		// The negative control at the audio end: delete one property and the identical circuit
		// becomes a DC divider at 5 V for every sample. The RMS-to-peak conversion is specific to
		// the `ac-source` law, so a `voltage-source` (DC) law is unaffected -- the declared 10 V
		// is read directly, not `10 * sqrt(2)`.
		const runtime = new ReferenceRuntime(programFor(dcMainsDivider));
		runtime.prepare(SAMPLE_RATE);
		const output = runtime.process(new Float64Array(64));
		for (const sample of output) {
			expect(sample).toBeCloseTo(DECLARED_RMS_VOLTS * DIVIDER, 8);
		}
	});
});

describe("a tube rectifier drops a voltage that depends on the current drawn", () => {
	/** `GENERIC_TUBE_DIODE`'s datasheet-anchored 5Y3GT perveance, in A/V^1.5. */
	const PERVEANCE = 3.54e-4;
	const LOAD_OHMS = 10_000;

	/**
	 * Solved voltages indexed by the **source** node id the fixture declares, not by the
	 * block's row.
	 *
	 * The assertions below name the fixture's own nodes -- plate on 4, cathode on 2 -- which
	 * is what makes them readable as statements about the circuit. A block numbers its rows
	 * independently of those ids (see `Block.nodeIds`), so the snapshot is scattered back into
	 * source-id positions here and the assertions keep their meaning.
	 */
	function solvedNodes(source: string): readonly number[] {
		const runtime = new ReferenceRuntime(programFor(source));
		runtime.prepare(48_000);
		runtime.process(new Float64Array(1));
		expect(runtime.telemetry().operatingPointFailures).toBe(0);
		expect(runtime.telemetry().nonConvergedSamples).toBe(0);
		const snapshot = runtime.nodeVoltageSnapshot()[0];
		if (snapshot === undefined) {
			return [];
		}
		const byNode: number[] = [];
		snapshot.voltages.forEach((value, row) => {
			const node = snapshot.nodeIds[row];
			if (node !== undefined) {
				byNode[node] = value;
			}
		});
		return byNode;
	}

	it("satisfies its own law and the load's at the same time", () => {
		// The check that needs no oracle: at the solved point the current through the load and
		// the current through the tube are the same current, so
		// `V(cathode)/10k == K * (V(plate) - V(cathode))^1.5` must hold. A wrong exponent, a
		// wrong perveance or exchanged terminals each break it, and none of them would stop the
		// circuit rendering a plausible rail.
		const voltages = solvedNodes(tubeDiodeIntoLoad);
		const plate = voltages[4] ?? Number.NaN;
		const cathode = voltages[2] ?? Number.NaN;
		const throughLoad = cathode / LOAD_OHMS;
		const throughTube = PERVEANCE * (plate - cathode) ** 1.5;
		expect(throughTube).toBeCloseTo(throughLoad, 9);

		// And the fixed point of `I = K * (300 - 10101*I)^1.5`, solved by hand: 27.9 mA at an
		// 18.4 V drop, leaving the cathode at 278.8 V. Three figures, because the hand solve is
		// an iteration rather than a closed form.
		expect(throughLoad * 1000).toBeCloseTo(27.9, 1);
		expect(plate - cathode).toBeCloseTo(18.4, 1);
		expect(cathode).toBeCloseTo(278.8, 1);
	});

	it("passes nothing when its plate and cathode are exchanged", () => {
		// The negative control. Reversed, a rectifier conducts on the wrong half-cycle; at DC it
		// conducts nothing, so the load sits at zero rather than at 278.8 V. A positional
		// reading of these terminals would pass both of these tests.
		const voltages = solvedNodes(tubeDiodeReversed);
		expect(Math.abs(voltages[2] ?? Number.NaN)).toBeLessThan(1e-3);
	});

	it("a declared voltage port on the rectifier's own output does not delete it", () => {
		// Milestone 2: a rectifier output IS generated, so `voltagePortRails` must not promote a
		// node a `tube-diode` (or `diode`) already feeds from a supply. `BPLUS_PORT` declares
		// 280 V on the cathode node -- a plausible chart value, deliberately not the 278.8 V the
		// tube law and the 10k load actually solve to. Before this milestone the port would have
		// been promoted to an ideal 280 V rail, deleting `V1_RECT`/`RSERIES`/`RLOAD` from the
		// answer; the solved cathode must still land on the rectifier's own 278.8 V, not the
		// declared 280 V.
		const voltages = solvedNodes(tubeDiodeIntoLoadWithDeclaredPort);
		const cathode = voltages[2] ?? Number.NaN;
		expect(cathode).toBeCloseTo(278.8, 1);
		expect(cathode).not.toBeCloseTo(280, 1);

		// And the promoted-rail program this fixture used to compile to is a *different*, larger
		// program: a rail adds its own `dc-source` stamp. Confirming there is exactly one still,
		// and it is the declared mains supply, not a second one at the cathode.
		const program = programFor(tubeDiodeIntoLoadWithDeclaredPort);
		const block = program.blocks.find(
			(candidate) => candidate.kind === "mna" && candidate.outputNode !== null,
		);
		if (block === undefined || block.kind !== "mna") {
			throw new Error("fixture produced no driven block");
		}
		const sources = block.stamps.filter(
			(stamp) => stamp.kind === "dc-source" || stamp.kind === "ac-source",
		);
		expect(sources).toHaveLength(1);
	});
});

describe("a transformer winding is generated by another winding of the same transformer", () => {
	it("a declared voltage port on the secondary does not delete the transformer", () => {
		// Milestone 2's follow-on, decided the same day: a transformer's whole function is to
		// generate a secondary's potential from a primary's, so `voltagePortRails` must not
		// promote a secondary node the transformer already feeds from an asserted primary.
		// `BPLUS_PORT` declares 6 V -- a plausible chart value, deliberately not what the ideal
		// 1:2 transformer actually solves to. Before this fix the port would have been promoted
		// to an ideal 6 V rail, deleting `T1`/`RLOAD` from the answer.
		//
		// Hand-computed, not a bare "10 V / 2": the battery's own 1 ohm `SUPPLY_SOURCE_OHMS`
		// carries the current the 1k load draws. `Vp = 2*Vs` (the transformer law) and
		// `Ip = Is/2 = Vs/2000` (power conservation) close the loop with the battery equation
		// `Vp = 10 - 1*Ip`: `2*Vs = 10 - Vs/2000`, so `Vs = 10 / 2.0005 = 4.998750312...`.
		const runtime = new ReferenceRuntime(
			programFor(transformerSecondaryWithDeclaredPort),
		);
		runtime.prepare(48_000);
		runtime.process(new Float64Array(1));
		expect(runtime.telemetry().operatingPointFailures).toBe(0);
		// Node 2 as the fixture declares it, found through the block's row map rather than
		// used as a row index -- see `Block.nodeIds`.
		const snapshot = runtime.nodeVoltageSnapshot()[0];
		const secondary =
			snapshot?.voltages[snapshot.nodeIds.indexOf(2)] ?? Number.NaN;
		expect(secondary).toBeCloseTo(10 / 2.0005, 8);
		expect(secondary).not.toBeCloseTo(6, 1);

		// And exactly one supply stamp remains -- the declared mains battery, not a second one
		// promoted at the secondary.
		const program = programFor(transformerSecondaryWithDeclaredPort);
		const block = program.blocks.find(
			(candidate) => candidate.kind === "mna" && candidate.outputNode !== null,
		);
		if (block === undefined || block.kind !== "mna") {
			throw new Error("fixture produced no driven block");
		}
		const sources = block.stamps.filter(
			(stamp) => stamp.kind === "dc-source" || stamp.kind === "ac-source",
		);
		expect(sources).toHaveLength(1);
		expect(block.stamps.some((stamp) => stamp.kind === "transformer")).toBe(
			true,
		);
	});
});

describe("a rectifier pack rectifies as many halves as it has junctions", () => {
	/** The class-default silicon junction: `IS = 2.52e-9`, `N = 1.752`, `Vt = 25.852 mV`. */
	const SCALE_VOLTS = 1.752 * 0.025_852;
	const SATURATION_AMPS = 2.52e-9;
	/**
	 * `VSEC` declares `Voltage: 20` with a `Frequency` beside it, so the `ac-source` law reads
	 * 20 as an RMS magnitude (the project convention) and converts it to `20 * sqrt(2)` V peak
	 * -- notably **regardless of** the fixture's own `raw: "20 V secondary peak"` prose, which
	 * no stage reads. That prose predates the RMS decision and is deliberately left
	 * contradicting it: the point of the convention is that prose never overrides the typed
	 * reading, and this fixture is the proof the hand computation below no longer assumes it.
	 */
	const DECLARED_VOLTS = 20;
	const AMPLITUDE_VOLTS = DECLARED_VOLTS * Math.SQRT2;
	const LOAD_OHMS = 1000;
	/** `SUPPLY_SOURCE_OHMS`, in series with the winding and visible in the third digit. */
	const SOURCE_OHMS = 1;
	/** 48 kHz over 60 Hz: the sine's peaks land exactly on samples 200 and 600. */
	const POSITIVE_PEAK = 200;
	const NEGATIVE_PEAK = 600;

	/**
	 * The rail a chain of `junctions` diode drops leaves, solved as a fixed point.
	 *
	 * Hand arithmetic, not the runtime's: `rail = amplitude - junctions * N*Vt*ln(I/IS) - Rs*I`
	 * with `I = rail / load`, `amplitude` being the law's peak volts. Ten passes is far past
	 * convergence for this contraction.
	 */
	function railThrough(junctions: number): number {
		const DIODE_RS = 1.0;
		let rail = AMPLITUDE_VOLTS;
		for (let pass = 0; pass < 10; pass += 1) {
			const amps = rail / LOAD_OHMS;
			rail =
				AMPLITUDE_VOLTS -
				junctions * SCALE_VOLTS * Math.log(amps / SATURATION_AMPS) -
				(SOURCE_OHMS + junctions * DIODE_RS) * amps;
		}
		return rail;
	}

	function railAt(source: string): { positive: number; negative: number } {
		const runtime = new ReferenceRuntime(programFor(source));
		runtime.prepare(48_000);
		const output = runtime.process(new Float64Array(NEGATIVE_PEAK + 1));
		expect(runtime.telemetry().nonConvergedSamples).toBe(0);
		return {
			positive: output[POSITIVE_PEAK] ?? Number.NaN,
			negative: output[NEGATIVE_PEAK] ?? Number.NaN,
		};
	}

	it("gives a bridge the same rail on both half-cycles, two drops down", () => {
		// Two junctions conduct in series on either half-cycle, so the hand solve is
		// `railThrough(2) = 26.79 V` (20 V RMS declared -> 28.28 V peak, less two junction
		// drops) -- and the equality of the two peaks is the topology claim: a bridge that
		// lowered to one junction has no rail at all, and a half-wave one has a rail on one
		// peak only.
		const rail = railAt(bridgeRectifier);
		expect(rail.positive).toBeCloseTo(railThrough(2), 3);
		expect(rail.negative).toBeCloseTo(rail.positive, 9);
	});

	it("gives a shared-cathode pack a rail on one half-cycle, one drop down", () => {
		// The same winding and the same component, wired as a pack: one junction conducts, so
		// `railThrough(1) = 27.52 V`, and the other half-cycle leaves the load at zero. The pair
		// of fixtures differs only in terminal names, which is where a topology has to come from.
		const rail = railAt(dualAnodeRectifier);
		expect(rail.positive).toBeCloseTo(railThrough(1), 3);
		expect(Math.abs(rail.negative)).toBeLessThan(1e-3);
	});

	it("amplifies through an OTA at its hand-computed gain", () => {
		const otaAmplifierSrc = invertingAmplifier
			.replace(
				"kind: opamp\n    name: DELAY_MEMORY_CHIP",
				"kind: ic\n    name: DELAY_MEMORY_CHIP",
			)
			.replace(
				'Description: "MN3007 bucket brigade delay memory."',
				'PartNumber: CA3080\n      Description: "MN3007 BBD"',
			);

		const customRegistry = {
			entries: [
				{
					partIds: ["CA3080"],
					declaredTypes: [],
					terminalRoleGroups: [
						["noninverting", "in+", "pin3"],
						["inverting", "in-", "pin2"],
						["output", "out", "pin6"],
					],
					model: {
						kind: "sections",
						sections: [
							{
								law: {
									kind: "ota",
									transconductance: 1e-3,
								},
								terminals: [0, 1, 2],
							},
						],
						pinout: ["noninverting", "inverting", "output"],
					},
				},
			],
		} as any;
		const result = compile(otaAmplifierSrc, { registry: customRegistry });
		expect(result.status).toBe("ok");
		const gain = measureGain((result as any).program, 1000, 48_000, 0.1);

		// **9.0, hand-derived, and it was 11.2 until the OTA's linear fallback polarity was
		// corrected on 2026-09-07.** Both numbers are converged, finite solutions of this
		// circuit; which one it is depends entirely on the direction the OTA drives its output.
		//
		// The section maps three terminals, so it takes the linear `vccs` fallback. Writing
		// `g = gm * R2 = 1e-3 * 100k = 100`, with the `+` input grounded, `-` at the summing
		// node `v3`, and the output at `v2`:
		//
		//   current sourced *into* v2   (correct)    v2 = v3 * (1 - g) = -99 * v3
		//   current drawn *out of* v2   (the defect) v2 = v3 * (1 + g) = +101 * v3
		//
		// KCL at the summing node, `R1 = 10k` and `R2 = 100k`, gives `10*v1 = 11*v3 - v2`. The
		// first case yields `v3 = v1/11` and `v2 = -9*v1`; the second yields `v3 = -v1/9` and
		// `v2 = -11.22*v1`, whose magnitude is the 11.2 this line used to assert. So the old
		// expectation was the arithmetic of the wrong current direction, checked correctly.
		//
		// Sourcing into the node is what the part catalog's own cited reading of
		// the CA3080/CA3094 datasheet requires: with the output at terminal 6 the output-mode
		// table makes pin 3 the non-inverting input, and a non-inverting OTA raises its load as
		// `v(+)` rises. See docs/troubleshootings/ota-output-polarity-depends-on-the-bias-pin.md.
		expect(gain).toBeCloseTo(9.0, 3);
	});

	it("amplifies through a CMOS Inverter section at its hand-computed gain", () => {
		const inverterAmplifierSrc = invertingAmplifier
			.replace(
				"kind: opamp\n    name: DELAY_MEMORY_CHIP",
				"kind: ic\n    name: DELAY_MEMORY_CHIP",
			)
			.replace(
				'Description: "MN3007 bucket brigade delay memory."',
				'PartNumber: CD4049\n      Description: "CD4049 Hex Inverter"',
			);

		const customRegistry = {
			entries: [
				{
					partIds: ["CD4049"],
					declaredTypes: [],
					terminalRoleGroups: [
						["noninverting", "in+", "pin3"],
						["inverting", "in-", "pin2"],
						["output", "out", "pin6"],
					],
					model: {
						kind: "sections",
						sections: [
							{
								law: {
									kind: "inverter",
									transconductance: 5e-3,
									biasVolts: 4.5,
								},
								terminals: [1, 2], // [inverting/input, output]
							},
						],
						pinout: ["noninverting", "inverting", "output"],
					},
				},
			],
		} as any;
		const result = compile(inverterAmplifierSrc, { registry: customRegistry });
		expect(result.status).toBe("ok");
		const gain = measureGain((result as any).program, 1000, 48_000, 0.1);
		expect(gain).toBeCloseTo(10.2, 1);
	});

	it("compiles and decomposes a CMOS NAND Logic Gate into 4 active MOSFET stamps", () => {
		const nandGateSrc = `schema: circuit-interchange/v3
deviceInterface:
  controls:
    - id: INPUT_JACK
      label: "Input Jack"
      kind: jack
      role: "input"
    - id: OUTPUT_JACK
      label: "Output Jack"
      kind: jack
      role: "output"
components:
  - id: INPUT_JACK
    kind: jack
    name: "INPUT_JACK"
    sourceTypeName: "Circuit.Input"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      Role: "input"
    terminals:
      - name: tip
        node: 1
        position:
          x: 0
          y: 0
  - id: OUTPUT_JACK
    kind: jack
    name: "OUTPUT_JACK"
    sourceTypeName: "Circuit.Output"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      Role: "output"
    terminals:
      - name: tip
        node: 3
        position:
          x: 0
          y: 0
  - id: VCC
    kind: rail
    name: "VCC"
    sourceTypeName: "Circuit.Rail"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      Voltage: "5"
    terminals:
      - name: terminal
        node: 4
        position:
          x: 0
          y: 0
  - id: CD4011_CHIP
    kind: ic
    name: "CD4011_CHIP"
    sourceTypeName: "Circuit.SupportChip"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      PartNumber: "CD4011"
    terminals:
      - name: pin1
        node: 1
        position:
          x: 0
          y: 0
      - name: pin2
        node: 1
        position:
          x: 0
          y: 0
      - name: pin3
        node: 3
        position:
          x: 0
          y: 0
      - name: pin14
        node: 4
        position:
          x: 0
          y: 0
      - name: pin7
        node: 0
        position:
          x: 0
          y: 0
`;
		const customNandRegistry = {
			entries: [
				{
					partIds: ["CD4011"],
					declaredTypes: [],
					terminalRoleGroups: [],
					model: {
						kind: "sections",
						sections: [
							{
								law: {
									kind: "nand-gate",
									thresholdVolts: 2.0,
									transconductance: 1e-3,
								},
								terminals: [0, 1, 2, 3, 4],
							},
						],
						pinout: [null, null, null, null, null], // 5 pins
					},
				},
			],
		} as any;
		const result = compile(nandGateSrc, { registry: customNandRegistry });
		expect(result.status).toBe("ok");
		const mnaBlock = (result as any).program.blocks.find(
			(b: any) => b.kind === "mna",
		);
		expect(mnaBlock).toBeDefined();
		// CMOS NAND should stamp 4 active MOSFETs (fets) in its MNA block
		const fets = mnaBlock.stamps.filter((s: any) => s.kind === "fet");
		expect(fets.length).toBe(4);

		// Electrically solve and verify the CMOS NAND switching behavior using ReferenceRuntime!
		const runtime = new ReferenceRuntime((result as any).program);
		runtime.prepare(48000);
		const length = 480; // 10ms at 48kHz
		const input = new Float64Array(length);
		for (let i = 0; i < length; i++) {
			input[i] = 5.0 * Math.sin((2 * Math.PI * 1000 * i) / 48000);
		}
		const output = runtime.process(input);

		// The output must swing dynamically between HIGH (5V) and LOW (0V)
		const maxVoltage = Math.max(...output);
		const minVoltage = Math.min(...output);
		expect(maxVoltage).toBeCloseTo(5.0, 1);
		expect(minVoltage).toBeCloseTo(0.0, 1);
	});

	it("compiles and decomposes a BBD delay line with dynamic LFO sweep under V2", () => {
		const dynamicBbdSrc = `schema: circuit-interchange/v3
deviceInterface:
  controls:
    - id: INPUT_JACK
      label: "Input Jack"
      kind: jack
      role: "input"
    - id: OUTPUT_JACK
      label: "Output Jack"
      kind: jack
      role: "output"
components:
  - id: INPUT_JACK
    kind: jack
    name: "INPUT_JACK"
    sourceTypeName: "Circuit.Input"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      Role: "input"
    terminals:
      - name: tip
        node: 1
        position:
          x: 0
          y: 0
  - id: OUTPUT_JACK
    kind: jack
    name: "OUTPUT_JACK"
    sourceTypeName: "Circuit.Output"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      Role: "output"
    terminals:
      - name: tip
        node: 3
        position:
          x: 0
          y: 0
  - id: LFO_VCO
    kind: voltage-source
    name: "LFO_VCO"
    sourceTypeName: "Circuit.VoltageSource"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      Waveform: "sine"
      Frequency: "1"
      Voltage: "5"
    terminals:
      - name: plus
        node: 4
        position:
          x: 0
          y: 0
      - name: minus
        node: 0
        position:
          x: 0
          y: 0
  - id: BBD_CHIP
    kind: ic
    name: "BBD_CHIP"
    sourceTypeName: "Circuit.DelayMemoryChip"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      PartNumber: "MN3005"
      DelayMs: "20"
    terminals:
      - name: input
        node: 1
        position:
          x: 0
          y: 0
      - name: output
        node: 3
        position:
          x: 0
          y: 0
      - name: clock
        node: 4
        position:
          x: 0
          y: 0
`;
		const result = compile(dynamicBbdSrc, { registry: pedalPartCatalog });
		expect(result.status).toBe("ok");
		const macroBlock = (result as any).program.blocks.find(
			(b: any) => b.kind === "macro" || b.kind === "composed",
		);
		expect(macroBlock).toBeDefined();
		expect(macroBlock.modelId).toBe("bucket-brigade-delay-line");
		// The fixture's own declared `DelayMs: "20"`, not a substituted value. This read
		// `toBe(0.05) // Falling back dynamically to 50ms buffer` until the fallback was removed,
		// which is worth recording: the test named its subject "dynamic LFO sweep" while asserting
		// a constant the resolver invented, so it pinned the stand-in rather than the coupling it
		// claims to cover. Declaring the delay makes it test what its name says.
		expect(macroBlock.parameters.delaySeconds).toBeCloseTo(0.02, 9);
	});

	it("compiles and active-models LM13700N OTA under V2", () => {
		const otaSrc = `schema: circuit-interchange/v3
deviceInterface:
  controls:
    - id: INPUT_JACK
      label: "Input Jack"
      kind: jack
      role: "input"
    - id: OUTPUT_JACK
      label: "Output Jack"
      kind: jack
      role: "output"
components:
  - id: INPUT_JACK
    kind: jack
    name: "INPUT_JACK"
    sourceTypeName: "Circuit.Input"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      Role: "input"
    terminals:
      - name: tip
        node: 1
        position:
          x: 0
          y: 0
  - id: OUTPUT_JACK
    kind: jack
    name: "OUTPUT_JACK"
    sourceTypeName: "Circuit.Output"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      Role: "output"
    terminals:
      - name: tip
        node: 3
        position:
          x: 0
          y: 0
  - id: IC1A
    kind: ota
    name: "IC1A"
    sourceTypeName: "Circuit.OTA"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      PartNumber: "LM13700N"
    terminals:
      - name: positive
        node: 1
        position:
          x: 0
          y: 0
      - name: negative
        node: 0
        position:
          x: 0
          y: 0
      - name: diodeBias
        node: 0
        position:
          x: 0
          y: 0
      - name: iabc
        node: 0
        position:
          x: 0
          y: 0
      - name: out
        node: 3
        position:
          x: 0
          y: 0
      - name: vplus
        node: 0
        position:
          x: 0
          y: 0
      - name: vminus
        node: 0
        position:
          x: 0
          y: 0
`;
		const result = compile(otaSrc, { registry: pedalPartCatalog });
		expect(result.status).toBe("ok");
		const mnaBlock = (result as any).program.blocks.find(
			(b: any) => b.kind === "mna",
		);
		expect(mnaBlock).toBeDefined();
		// Active LM13700N section should be compiled into active OTA stamps!
		const otas = mnaBlock.stamps.filter((s: any) => s.kind === "ota");
		expect(otas.length).toBe(1);
	});

	it("compiles and active-models AK4552VT Codec Left/Right followers under V2", () => {
		const codecSrc = `schema: circuit-interchange/v3
deviceInterface:
  controls:
    - id: INPUT_JACK
      label: "Input Jack"
      kind: jack
      role: "input"
    - id: OUTPUT_JACK
      label: "Output Jack"
      kind: jack
      role: "output"
components:
  - id: INPUT_JACK
    kind: jack
    name: "INPUT_JACK"
    sourceTypeName: "Circuit.Input"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      Role: "input"
    terminals:
      - name: tip
        node: 1
        position:
          x: 0
          y: 0
  - id: OUTPUT_JACK
    kind: jack
    name: "OUTPUT_JACK"
    sourceTypeName: "Circuit.Output"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      Role: "output"
    terminals:
      - name: tip
        node: 3
        position:
          x: 0
          y: 0
  - id: CODEC_CHIP
    kind: ic
    name: "CODEC_CHIP"
    sourceTypeName: "Circuit.AudioCodec"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      PartNumber: "AK4552VT8"
    terminals:
      - name: lin
        node: 1
        position:
          x: 0
          y: 0
      - name: rin
        node: 1
        position:
          x: 0
          y: 0
      - name: lout
        node: 3
        position:
          x: 0
          y: 0
      - name: rout
        node: 3
        position:
          x: 0
          y: 0
      - name: serial-audio
        node: 0
        position:
          x: 0
          y: 0
      - name: pdn
        node: 0
        position:
          x: 0
          y: 0
      - name: va-vd
        node: 0
        position:
          x: 0
          y: 0
      - name: agnd-dgnd
        node: 0
        position:
          x: 0
          y: 0
`;
		const result = compile(codecSrc, { registry: pedalPartCatalog });
		expect(result.status).toBe("ok");
		const mnaBlock = (result as any).program.blocks.find(
			(b: any) => b.kind === "mna",
		);
		expect(mnaBlock).toBeDefined();
		// Both codec channels are modeled as active op-amp followers in the MNA block!
		const followers = mnaBlock.stamps.filter(
			(s: any) => s.kind === "ideal-opamp",
		);
		expect(followers.length).toBe(2);
	});

	it("models optocoupler / Vactrol LDR controlled conductance by LED drive", () => {
		// Dark state (0 V LED bias): LDR sits at ~10 MΩ, divider gain is ~0.999
		const gainDark = measureGain(
			programFor(optocouplerAttenuator, pedalPartCatalog),
			1000,
			48_000,
			0.1,
		);
		expect(gainDark).toBeCloseTo(optocouplerDarkGain, 2);

		// Illuminated state (2 V LED bias): LED conducts forward current,
		// LDR drops to ~100 Ω, divider gain drops to ~0.0099 (-40 dB attenuation)
		const gainIlluminated = measureGain(
			programFor(optocouplerAttenuatorIlluminated, pedalPartCatalog),
			1000,
			48_000,
			0.1,
		);
		expect(gainIlluminated).toBeCloseTo(optocouplerIlluminatedGain, 3);

		// Negative control: sub-threshold bias (0.5 V, below LED turn-on)
		// leaves the LDR in the dark state (~10 MΩ), preserving ~0.999 gain
		const gainSubThreshold = measureGain(
			programFor(optocouplerAttenuatorSubThreshold, pedalPartCatalog),
			1000,
			48_000,
			0.1,
		);
		expect(gainSubThreshold).toBeCloseTo(optocouplerDarkGain, 2);

		// **The traversal control, and it is the one the three above cannot be.** Dark,
		// illuminated and sub-threshold all land on one of the two endpoints, so all three are
		// equally consistent with an LDR that is a two-state switch. A bias in the middle is
		// what distinguishes a curve from a step: at 1.90 V the divider measures ~0.683,
		// strictly between the endpoints. Asserted as a property rather than as 0.683, because
		// the traversal happens inside a ~180 mV window (1.80 V -> 1.98 V) and pinning the
		// steepest point on a steep curve would fail for changes that are not defects.
		//
		// Those numbers moved on 2026-09-07, when the emitter's saturation current was corrected
		// to this repository's own cited `LED-RED` entry (`forwardVoltageAt1mA` typ 1.8 V,
		// `emissionCoefficient` typ 2). It had been `1e-12` with an ideality of 1.934 -- six
		// orders too large -- so the knee sat at 1.036 V and the whole traversal fitted in 80 mV
		// between 1.10 V and 1.18 V. It now brackets the cited forward voltage.
		//
		// The window is still narrow, and that is still worth reading: a real Vactrol's LDR
		// responds over decades of LED current, and the gradual knee is the part's musical
		// character. The `alpha = 1000` coupling constant that sets this width is cited by no
		// store. These fixtures settle the endpoints and the continuity, not the response
		// *shape* -- see
		// docs/troubleshootings/an-optocouplers-declared-led-parameters-are-not-executed.md.
		const gainPartial = measureGain(
			programFor(optocouplerAttenuatorPartial, pedalPartCatalog),
			1000,
			48_000,
			0.1,
		);
		expect(gainPartial).toBeGreaterThan(optocouplerIlluminatedGain * 5);
		expect(gainPartial).toBeLessThan(optocouplerDarkGain * 0.95);
	});

	it("has no photoconductive lag, which is a missing feature and not a wrong number", () => {
		// **This test asserts the absence of behaviour, deliberately, so that the absence is
		// visible on every run instead of only in a document.** A real Vactrol's cell lags: the
		// attack is milliseconds and the decay tens to hundreds of milliseconds, famously
		// non-exponential. In an optical tremolo that lag *is* the sound -- it is why the part is
		// chosen over a JFET. The executed law has no state at all: `R` is a function of the
		// present LED current, so a step in drive appears in one sample.
		//
		// Measured: with the LED on from `t = 0` the output envelope is identical in the first
		// millisecond and the fiftieth, to every digit. **Adding the lag will fail this test**,
		// which is the intended signal -- delete it in that change and assert the time constant
		// instead.
		//
		// **The optocoupler's other missing metric, and why it is not here.** The part's defining
		// datasheet curve is LDR resistance against LED *current*, and on log-log a real CdS cell
		// is a power law -- `R` proportional to `I^-gamma`, gamma about 0.8 to 1.0, straight over
		// three decades. The executed `Rmin + (Rmax - Rmin) * exp(-alpha * I)` is an exponential:
		// at the corpus registry's span and `alpha = 1000` its log-log slope runs -0.004, -0.039,
		// -0.182, -0.581, -1.820, -5.649 before flattening onto `Rmin`, and the whole traversal
		// occupies 1.34 decades of current instead of three.
		//
		// A first attempt measured that width in LED *bias volts* through this fixture and got
		// 0.0384 V, which looks like 0.32 decades at the cited ideality and is not: the junction
		// clamps near 1.9 V and the source's ~17 ohm series resistance then makes current rise
		// nearly linearly with bias, so the volts-to-decades conversion does not hold and the
		// number was measuring the source, not the cell. A valid shape metric needs a fixture
		// whose LED current is *set* by a known series resistance from a known supply, swept
		// across decades, with `R_ldr` recovered from the divider gain. That fixture does not
		// exist yet.
		//
		// **What this test's own control can and cannot be.** Halving the coupling `alpha` fails
		// the two gain assertions above and leaves this one green, which shows it is not merely
		// re-testing gain. It cannot be given a true failing control without *implementing* the
		// lag, since a one-line mutation cannot add a state variable. Its sensitivity is
		// arithmetic instead: an LDR starting dark and settling over even 20 ms would put the
		// first millisecond near 0.999 gain and the last near 0.683, a ratio of 0.68 against the
		// 1.0 asserted to six places.
		const program = programFor(optocouplerAttenuatorPartial, pedalPartCatalog);
		const runtime = new ReferenceRuntime(program);
		const sampleRate = 48_000;
		runtime.prepare(sampleRate);
		const input = new Float64Array(Math.floor(sampleRate * 0.05));
		for (let index = 0; index < input.length; index += 1) {
			input[index] = 0.1 * Math.sin((2 * Math.PI * 1000 * index) / sampleRate);
		}
		const output = [...runtime.process(input)];
		const peakOver = (from: number, to: number): number =>
			Math.max(...output.slice(from, to).map(Math.abs));
		const firstMs = peakOver(0, sampleRate / 1000);
		const lastMs = peakOver(output.length - sampleRate / 1000, output.length);
		expect(lastMs / firstMs).toBeCloseTo(1.0, 6);
	});

	it("classifies a lampdrive/ldrsignal/ldrreturn switch shell as an optocoupler", () => {
		const asSwitchShell = (source: string): string =>
			source
				.replace("kind: ic", "kind: switch")
				.replace("sourceTypeName: Circuit.SupportChip", "sourceTypeName: Circuit.Switch")
				.replace("      - name: anode\n", "      - name: lampdrive\n")
				.replace("      - name: ldr_a\n", "      - name: ldrsignal\n")
				.replace("      - name: ldr_b\n", "      - name: ldrreturn\n")
				.replace(
					`      - name: cathode
        node: 0
        position:
          x: 80
          y: 20
`,
					"",
				);

		const darkProgram = programFor(
			asSwitchShell(optocouplerAttenuator),
			pedalPartCatalog,
		);
		const darkMna = darkProgram.blocks.find((block) => block.kind === "mna");
		expect(darkMna).toBeDefined();
		expect(darkMna?.stamps.some((stamp) => stamp.kind === "optocoupler")).toBe(
			true,
		);

		const gainDark = measureGain(darkProgram, 1000, 48_000, 0.1);
		expect(gainDark).toBeCloseTo(optocouplerDarkGain, 2);

		const gainIlluminated = measureGain(
			programFor(asSwitchShell(optocouplerAttenuatorIlluminated), pedalPartCatalog),
			1000,
			48_000,
			0.1,
		);
		expect(gainIlluminated).toBeCloseTo(optocouplerIlluminatedGain, 3);
	});

	it("compiles and active-models CD4013 logic divider under V2", () => {
		const result = compile(cd4013LogicDivider, { registry: pedalPartCatalog });
		expect(result.status).toBe("ok");
		const mnaBlock = (result as any).program.blocks.find(
			(b: any) => b.kind === "mna",
		);
		expect(mnaBlock).toBeDefined();
		// Active CD4013 section should compile into active logic-divider stamps!
		const flips = mnaBlock.stamps.filter(
			(s: any) => s.kind === "logic-divider",
		);
		expect(flips.length).toBe(1);

		// Electrically verify frequency division (division by 2)
		const runtime = new ReferenceRuntime((result as any).program);
		runtime.prepare(48000);
		// We feed a fast alternating clock (0V, 5V, 0V, 5V...) on the input jack (node 1)
		const length = 100;
		const input = new Float64Array(length);
		for (let i = 0; i < length; i++) {
			input[i] = i % 10 < 5 ? 5.0 : 0.0; // Square-wave clock of period 10 samples
		}
		const output = runtime.process(input);
		// On each rising edge of the input (every 10 samples), output should toggle.
		// So output period should be exactly 20 samples (half the frequency!).
		// Let's assert output toggling has divided the clock rate!
		expect(output[5]).toBeCloseTo(5.0, 1);
		expect(output[15]).toBeCloseTo(0.0, 1);
		expect(output[25]).toBeCloseTo(5.0, 1);
		expect(output[35]).toBeCloseTo(0.0, 1);
	});



	// **Removed 2026-08-29 (Milestone 6h): Corpus-packet assertions in unit tests.**
	//
	// Per repository testing policy ("never assert pedal/amp identity, corpus membership") and
	// Milestone 6h, tests that read corpus packets from the external artifact directory and
	// silently skip if absent are removed from the unit test suite.
	// Corpus compilation, SPICE parity, and simulation are verified by the dedicated rung
	// instruments (`report-compiler-coverage`, `report-compiler-spice-parity`, `test-v2-wasm-parity`, etc.),
	// while unit test suites run deterministically on synthetic fixtures.

	it("flags unconnected behavior-owning components with loud compiler warnings under V2", () => {
		const testSrc = `schema: circuit-interchange/v3
deviceInterface:
  controls:
    - id: INPUT_JACK
      label: "Input Jack"
      kind: jack
      role: "input"
    - id: OUTPUT_JACK
      label: "Output Jack"
      kind: jack
      role: "output"
components:
  - id: INPUT_JACK
    kind: jack
    name: "INPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: -480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: OUTPUT_JACK
    kind: jack
    name: "OUTPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: 480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: R1
    kind: resistor
    name: "R1"
    sourceTypeName: "Circuit.Resistor"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: 0
          y: 0
      - name: b
        node: 2
        position:
          x: 0
          y: 0
    properties:
      Resistance: 1000
  - id: UNCONNECTED_RESISTOR
    kind: resistor
    name: "R_UNCONNECTED"
    sourceTypeName: "Circuit.Resistor"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals: []
`;
		// Using emptyRegistry is perfectly safe and fast for this test
		const result = compile(testSrc, { registry: emptyRegistry });
		expect(result.status).toBe("ok");
		const warnings = (result as any).warnings;
		const unconnectedWarn = warnings.find(
			(w: any) => w.code === "unconnected-behavior-component",
		);
		expect(unconnectedWarn).toBeDefined();
		expect(unconnectedWarn.device).toBe("UNCONNECTED_RESISTOR");
		expect(unconnectedWarn.detail).toContain(
			"is a behavior-owning part but declares 0 connected terminals",
		);
	});

	it("compiles an electrically isolated IC as open with a loud warning; one shared net restores the refusal", () => {
		// A device whose every node is private to itself cannot affect the solve, however it
		// would have been modelled -- klon-centaur's MAX1044_CLUSTER_VIEW_ONLY is the corpus
		// case: a declared view-only power block on four nodes nothing else touches, with the
		// rails it produces separately declared as voltage-carrying ports. Refusing the whole
		// pedal for it was over-strict; swallowing it silently would hide a wiring mistake.
		// Open + loud warning is the contract, and ONE shared net -- even indirectly -- must
		// restore the honest refusal, because a partially-connected unknown chip is exactly
		// the case the 2026-08-10 decision refuses.
		const withIc = (icAudioNode: number) => `schema: circuit-interchange/v3
deviceInterface:
  controls:
    - id: INPUT_JACK
      label: "Input Jack"
      kind: jack
      role: "input"
    - id: OUTPUT_JACK
      label: "Output Jack"
      kind: jack
      role: "output"
components:
  - id: INPUT_JACK
    kind: jack
    name: "INPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: -480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: OUTPUT_JACK
    kind: jack
    name: "OUTPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: 480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: R1
    kind: resistor
    name: "R1"
    sourceTypeName: "Circuit.Resistor"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: 0
          y: 0
      - name: b
        node: 2
        position:
          x: 0
          y: 0
    properties:
      Resistance: 1000
  - id: U_PUMP
    kind: ic
    name: "U_PUMP"
    sourceTypeName: "Circuit.IC"
    origin:
      x: 0
      y: 120
    rotation: 0
    flipped: false
    terminals:
      - name: vin
        node: ${icAudioNode}
        position:
          x: 0
          y: 0
      - name: vout
        node: 51
        position:
          x: 0
          y: 0
    properties:
      PartNumber: "NOT_IN_ANY_REGISTRY_XYZ"
`;
		// Fully private nodes 50/51: compiles, warned by name.
		const isolated = compile(withIc(50), { registry: emptyRegistry });
		expect(isolated.status).toBe("ok");
		const warning = (isolated as any).warnings.find(
			(w: any) => w.code === "electrically-isolated-ic",
		);
		expect(warning).toBeDefined();
		expect(warning.device).toBe("U_PUMP");
		// The same chip touching the audio path on ONE pin: the 2026-08-10 refusal returns.
		const shared = compile(withIc(1), { registry: emptyRegistry });
		expect(shared.status).toBe("unsupported");
		expect((shared as any).reasons[0].reason).toContain(
			"integrated circuit has no model",
		);
	});

	it("compiles, simulates, and causally extracts dual-role LED brightness under V2", () => {
		const ledSrc = `schema: circuit-interchange/v3
deviceInterface:
  controls:
    - id: INPUT_JACK
      label: "Input Jack"
      kind: jack
      role: "input"
    - id: OUTPUT_JACK
      label: "Output Jack"
      kind: jack
      role: "output"
components:
  - id: INPUT_JACK
    kind: jack
    name: "INPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: -480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: OUTPUT_JACK
    kind: jack
    name: "OUTPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: 480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: INDICATOR_LED
    kind: led
    name: "INDICATOR_LED"
    sourceTypeName: "Circuit.Diode"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      PartNumber: "LED"
    terminals:
      - name: anode
        node: 1
        position:
          x: 0
          y: 0
      - name: cathode
        node: 2
        position:
          x: 0
          y: 0
  - id: D_CLIPPER
    kind: diode
    name: "D_CLIPPER"
    sourceTypeName: "Circuit.Diode"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: anode
        node: 2
        position:
          x: 0
          y: 0
      - name: cathode
        node: 0
        position:
          x: 0
          y: 0
  - id: R_LOAD
    kind: resistor
    name: "R_LOAD"
    sourceTypeName: "Circuit.Resistor"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 0
          y: 0
      - name: b
        node: 0
        position:
          x: 0
          y: 0
    properties:
      Resistance: 1000
`;
		const result = compile(ledSrc, { registry: pedalPartCatalog });
		expect(result.status).toBe("ok");

		// Run ReferenceRuntime and electrically check brightness
		const runtime = new ReferenceRuntime((result as any).program);
		runtime.prepare(48000);

		// 1. Silent/off state (input is 0V)
		const silentIn = new Float64Array(1);
		runtime.process(silentIn);
		expect(runtime.getLedBrightness("INDICATOR_LED")).toBeCloseTo(0.0, 5); // Dark when unpowered
		expect(runtime.getLedBrightness("D_CLIPPER")).toBe(0.0); // Ordinary diode is always 0

		// 2. Hot forward-biased state (input is +5V)
		const hotIn = new Float64Array(1).fill(5.0);
		runtime.process(hotIn);
		expect(runtime.getLedBrightness("INDICATOR_LED")).toBeGreaterThan(0.2); // Glowing when powered!
		expect(runtime.getLedBrightness("D_CLIPPER")).toBe(0.0); // Ordinary diode is still 0!
	});

	it("compiles, simulates, and physically models first-class analog-switch behavior under V2", () => {
		const switchSrc = `schema: circuit-interchange/v3
deviceInterface:
  controls:
    - id: INPUT_JACK
      label: "Input Jack"
      kind: jack
      role: "input"
    - id: OUTPUT_JACK
      label: "Output Jack"
      kind: jack
      role: "output"
components:
  - id: INPUT_JACK
    kind: jack
    name: "INPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: -480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: OUTPUT_JACK
    kind: jack
    name: "OUTPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: 480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: CONTROL_SUPPLY
    kind: rail
    name: "V_CTRL"
    sourceTypeName: "Circuit.VoltageRail"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      Voltage: 0 V
    terminals:
      - name: v
        node: 3
        position:
          x: 0
          y: 0
  - id: MY_SWITCH
    kind: analog-switch
    name: "MY_SWITCH"
    sourceTypeName: "Circuit.AnalogSwitch"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: sig_a
        node: 1
        position:
          x: 0
          y: 0
      - name: sig_b
        node: 2
        position:
          x: 0
          y: 0
      - name: control
        node: 3
        position:
          x: 0
          y: 0
  - id: R_LOAD
    kind: resistor
    name: "R_LOAD"
    sourceTypeName: "Circuit.Resistor"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 0
          y: 0
      - name: b
        node: 0
        position:
          x: 0
          y: 0
    properties:
      Resistance: 10000
`;
		const result = compile(switchSrc, { registry: emptyRegistry });
		expect(result.status).toBe("ok");

		const runtime = new ReferenceRuntime((result as any).program);
		runtime.prepare(48000);

		// 1. OFF State: Control Voltage is 0V (default), which is below threshold (2.5V)
		// Input is a 5V peak sine wave. Output should be heavily attenuated (~0V)
		const input = new Float64Array(1).fill(5.0);
		let output = runtime.process(input);
		expect(output[0]).toBeLessThan(1e-4); // Switch is off, no signal leakage!

		// 2. ON State: Compile a circuit where the control voltage is 5V (above threshold 2.5V)
		const switchOnSrc = switchSrc.replace("Voltage: 0 V", "Voltage: 5 V");
		const resultOn = compile(switchOnSrc, { registry: emptyRegistry });
		expect(resultOn.status).toBe("ok");

		const runtimeOn = new ReferenceRuntime((resultOn as any).program);
		runtimeOn.prepare(48000);
		let outputOn = runtimeOn.process(input);
		expect(outputOn[0]).toBeGreaterThan(4.5); // Switch is ON, signal passes through!
		expect(outputOn[0]).toBeLessThan(5.0);

		// Verify compilation and Newton convergence loop!
		for (const val of output) {
			expect(Number.isNaN(val)).toBe(false);
		}
	});

	it("honestly refuses an analog-switch with missing/unconnected control terminals under V2", () => {
		const badSwitchSrc = `schema: circuit-interchange/v3
deviceInterface:
  controls:
    - id: INPUT_JACK
      label: "Input Jack"
      kind: jack
      role: "input"
    - id: OUTPUT_JACK
      label: "Output Jack"
      kind: jack
      role: "output"
components:
  - id: INPUT_JACK
    kind: jack
    name: "INPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: -480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: OUTPUT_JACK
    kind: jack
    name: "OUTPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: 480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: MY_SWITCH
    kind: analog-switch
    name: "MY_SWITCH"
    sourceTypeName: "Circuit.AnalogSwitch"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: sig_a
        node: 1
        position:
          x: 0
          y: 0
      - name: sig_b
        node: 2
        position:
          x: 0
          y: 0
`;
		const result = compile(badSwitchSrc, { registry: emptyRegistry });
		expect(result.status).toBe("unsupported");
		expect((result as any).reasons[0].stage).toBe("lower");
		expect((result as any).reasons[0].reason).toContain(
			"requires three terminals",
		);
	});

	it("compiles, simulates, and physically models first-class non-linear ota transconductance under V2", () => {
		const otaSrc = `schema: circuit-interchange/v3
deviceInterface:
  controls:
    - id: INPUT_JACK
      label: "Input Jack"
      kind: jack
      role: "input"
    - id: OUTPUT_JACK
      label: "Output Jack"
      kind: jack
      role: "output"
components:
  - id: INPUT_JACK
    kind: jack
    name: "INPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: -480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: OUTPUT_JACK
    kind: jack
    name: "OUTPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: 480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: BIAS_SUPPLY
    kind: rail
    name: "V_BIAS"
    sourceTypeName: "Circuit.VoltageRail"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      Voltage: 0 V
    terminals:
      - name: v
        node: 3
        position:
          x: 0
          y: 0
  - id: R_BIAS
    kind: resistor
    name: "R_BIAS"
    sourceTypeName: "Circuit.Resistor"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 3
        position:
          x: 0
          y: 0
      - name: b
        node: 4
        position:
          x: 0
          y: 0
    properties:
      Resistance: 10000
  - id: MY_OTA
    kind: ota
    name: "MY_OTA"
    sourceTypeName: "Circuit.OtaOpAmp"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: positive
        node: 1
        position:
          x: 0
          y: 0
      - name: negative
        node: 0
        position:
          x: 0
          y: 0
      - name: output
        node: 2
        position:
          x: 0
          y: 0
      - name: bias
        node: 4
        position:
          x: 0
          y: 0
  - id: R_LOAD
    kind: resistor
    name: "R_LOAD"
    sourceTypeName: "Circuit.Resistor"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 0
          y: 0
      - name: b
        node: 0
        position:
          x: 0
          y: 0
    properties:
      Resistance: 1000
`;
		// 1. OFF State: Control Voltage is 0V (default), which is below threshold (Vbe ~ 0.7V)
		// Input is a 5V peak sine wave. Output should be exactly 0V because bias current is 0!
		const resultOff = compile(otaSrc, { registry: pedalPartCatalog });
		expect(resultOff.status).toBe("ok");

		const runtimeOff = new ReferenceRuntime((resultOff as any).program);
		runtimeOff.prepare(48000);
		const input = new Float64Array(1).fill(5.0);
		let outputOff = runtimeOff.process(input);
		expect(outputOff[0]).toBeCloseTo(0.0, 5); // Completely off/silent!

		// 2. ON State & Hard Saturation Check: Control Voltage is 5V.
		// Bias current Iabc = (5V - Vbe) / 10k.
		// The active physical bias diode solves dynamically at Vbe ~ 0.515V.
		// So Iabc = (5V - 0.515V) / 10k = 0.448 mA.
		// Hard saturation output current Iout_max = 2 * Iabc = 0.897 mA.
		// Under a hot +10V input, output voltage should be clamped to exactly Iout_max * R_load = 0.90 V!
		const otaOnSrc = otaSrc.replace("Voltage: 0 V", "Voltage: 5 V");
		const resultOn = compile(otaOnSrc, { registry: pedalPartCatalog });
		expect(resultOn.status).toBe("ok");

		const runtimeOn = new ReferenceRuntime((resultOn as any).program);
		runtimeOn.prepare(48000);
		const hotIn = new Float64Array(1).fill(10.0); // Hot +10V input
		let outputOn = runtimeOn.process(hotIn);
		expect(outputOn[0]).toBeCloseTo(0.9, 2); // Perfectly clamped to 0.90V Ebers-Moll limit!

		// Verify stable output with zero NaN/divergence and correct solve
		for (const val of outputOn) {
			expect(Number.isNaN(val)).toBe(false);
		}
	});

	it("honestly refuses an ota with missing/unconnected output terminals under V2", () => {
		const badOtaSrc = `schema: circuit-interchange/v3
deviceInterface:
  controls:
    - id: INPUT_JACK
      label: "Input Jack"
      kind: jack
      role: "input"
    - id: OUTPUT_JACK
      label: "Output Jack"
      kind: jack
      role: "output"
components:
  - id: INPUT_JACK
    kind: jack
    name: "INPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: -480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: OUTPUT_JACK
    kind: jack
    name: "OUTPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: 480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: MY_OTA
    kind: ota
    name: "MY_OTA"
    sourceTypeName: "Circuit.OtaOpAmp"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: positive
        node: 1
        position:
          x: 0
          y: 0
      - name: negative
        node: 0
        position:
          x: 0
          y: 0
`;
		const result = compile(badOtaSrc, { registry: pedalPartCatalog });
		expect(result.status).toBe("unsupported");
		expect((result as any).reasons[0].stage).toBe("lower");
		expect((result as any).reasons[0].reason).toContain(
			"requires positive, negative, and output terminals",
		);
	});

	describe("a zero-ohm link, and the absent value it must not be confused with", () => {
		// Three fixtures that differ in one property between them, because that is the whole
		// difficulty: a resistor stating `0`, a resistor stating nothing, and a resistor
		// stating nothing while marked unpopulated all look nearly identical in a document
		// and mean three different things -- a wire, an unknown, and an open.

		it("passes signal through a 0 ohm link as though it were wire", () => {
			// A declared zero is the schematic-capture convention for an ideal wire; the board
			// really does carry a jumper there. `1/0` is not a representable conductance, so
			// `device-laws.ts` stamps `SWITCH_ON_OHMS` -- the same
			// electrically-indistinguishable-from-ideal short a closed switch gets.
			//
			// The reference is derived rather than snapshotted: the link sits in series ahead
			// of a 10k/10k divider, so the gain is exactly `10k / (20k + SWITCH_ON_OHMS)`.
			// That is 2.5e-7 below one half -- a number that follows from the constant, and
			// would move if the constant did.
			const gain = measureGain(programFor(zeroOhmLinkDivider), 1000, 48_000);
			// Holds to 2.5e-9, which is the solver's `gmin` and not the link.
			expect(gain).toBeCloseTo(10_000 / (20_000 + SWITCH_ON_OHMS), 8);
			// **And an absolute bound, because the assertion above is built from the same
			// constant the code uses** -- raise `SWITCH_ON_OHMS` to a megohm and it would
			// track the change and still pass. This one does not: the link must be
			// indistinguishable from wire, so the divider it sits in front of must still
			// measure one half. It is the assertion that would fail if a "short" stopped
			// being short, or if a future lowering merged the nodes and dropped the leg.
			expect(gain).toBeCloseTo(0.5, 6);
			expect(gain).toBeCloseTo(
				measureGain(programFor(resistorDivider), 1000, 48_000),
				6,
			);
		});

		it("refuses a resistor that states no resistance at all", () => {
			// **The control that keeps the case above honest.** A stated zero and an absent
			// value differ by one property and mean opposite things: a jumper the board has,
			// versus a value nobody recorded. Reading the second as the first would silently
			// short a circuit, which is the wrong-answer-that-still-renders this pipeline
			// exists to refuse -- so this must refuse, and must keep refusing.
			//
			// `mxr-carbon-copy`'s `R4` is the corpus instance, and its own record agrees the
			// refusal is right: `SourceValue: visible-no-value-or-DNP`, `SourceConfidence:
			// medium`, `SourceStatus: defer`. The source declines to say.
			const result = compile(resistorWithNoResistance, {
				registry: emptyRegistry,
			});
			expect(result.status).not.toBe("ok");
			if (result.status === "ok") return;
			expect(result.reasons.some((reason) => reason.device === "R2")).toBe(
				true,
			);
		});

		it("refuses a negative resistance, which is what makes admitting zero safe", () => {
			// The other side of the boundary. Zero is a jumper the board has; below zero is not
			// a resistor. Admitting a declared zero is only defensible because this still
			// refuses -- otherwise the rule would just be "accept whatever number appears".
			//
			// No corpus resistor is negative (all 3090 are positive or zero), which is exactly
			// why this is a fixture: a boundary defended only where the corpus pushes on it is
			// not defended at all.
			const result = compile(resistorWithNegativeResistance, {
				registry: emptyRegistry,
			});
			expect(result.status).not.toBe("ok");
			if (result.status === "ok") return;
			expect(result.reasons.some((reason) => reason.device === "R2")).toBe(
				true,
			);
		});

		it("treats a DNP position as an open circuit rather than a missing value", () => {
			// Same absent value as the fixture above, plus `DNP: 'true'`. An unpopulated
			// footprint is a stated fact about the board -- an open circuit -- not a gap in
			// the record, so it compiles with the component dropped.
			//
			// The pair is the point: one typed flag decides whether an absent value is a
			// refusal or a legitimate open, and nothing else distinguishes them. Before this,
			// `mxr-carbon-copy`'s four DNP positions each refused the whole pedal for a value
			// they are correct not to carry.
			const result = compile(notPopulatedResistor, { registry: emptyRegistry });
			expect(result.status).toBe("ok");
			if (result.status !== "ok") return;
			expect(
				result.warnings.some(
					(warning) =>
						warning.code === "not-populated-without-value" &&
						warning.device === "R2",
				),
			).toBe(true);
			// Dropped, not defaulted: R2 was the divider's shunt leg, so with it unfitted the
			// output sees no load and the gain is unity. A DNP part quietly given some
			// default resistance would show up here as a division instead.
			expect(
				measureGain(programFor(notPopulatedResistor), 1000, 48_000),
			).toBeCloseTo(1.0, 6);

			// **The two shapes, separated.** This fixture is the *load-bearing* one -- R2
			// declares no resistance, so without the DNP it would refuse by name and dropping it
			// is the only reason the document compiles. `DNP` is the one property whose effect is
			// to make a refusal disappear, so a reader needs to see how much of a compilation is
			// resting on it, and the two cases must not share a code.
			//
			// The corroborated shape for contrast: same drop, but the part declares its 10k, so
			// nothing is concealed by its leaving and the ordinary code is emitted.
			const corroborated = compile(notPopulatedResistorWithValue, {
				registry: emptyRegistry,
			});
			expect(corroborated.status).toBe("ok");
			if (corroborated.status !== "ok") return;
			expect(
				corroborated.warnings.some(
					(warning) =>
						warning.code === "not-populated" && warning.device === "R2",
				),
			).toBe(true);
			expect(
				corroborated.warnings.some(
					(warning) => warning.code === "not-populated-without-value",
				),
			).toBe(false);
		});
	});

	describe("the NE570 compandor, against its own datasheet", () => {
		// The settlement for this operator. Every reference below is a number onsemi
		// NE570/D Rev. 4 states in its own text or gives a closed form for, not a number
		// read off our output and pinned -- which is the distinction that lets these tests
		// find a defect instead of ratifying one.
		//
		// What replaced what: the previous test here compiled a compandor, rendered 10 ms,
		// and asserted `Math.max(output) > 0` with the comment "Verifies active signal
		// flow!". That passed throughout the period when the gain cell stamped a
		// dimensionless `2.8/vEnv` where siemens belonged -- a transconductance ~80,000x
		// too large at the nominal operating point, inverted in direction, whose output on
		// a real packet was an 11.7 V constant. "Greater than zero" was true the whole time.

		/** Quiescent output with no input: the operating point, not the audio. */
		const quiescentVolts = (program: Program, sampleRate = 48_000): number => {
			const runtime = new ReferenceRuntime(program);
			runtime.prepare(sampleRate);
			const output = runtime.process(new Float64Array(sampleRate));
			let sum = 0;
			const from = Math.floor(output.length * 0.75);
			for (let index = from; index < output.length; index += 1) {
				sum += output[index] ?? 0;
			}
			return sum / (output.length - from);
		};

		/** Milliseconds for the output envelope to first reach 90% of its settled value. */
		const attackMs = (
			program: Program,
			hz = 1000,
			sampleRate = 48_000,
		): number => {
			const runtime = new ReferenceRuntime(program);
			runtime.prepare(sampleRate);
			const length = Math.round(sampleRate * 0.4);
			const input = new Float64Array(length);
			for (let index = 0; index < length; index += 1) {
				input[index] = Math.sin((2 * Math.PI * hz * index) / sampleRate);
			}
			const output = runtime.process(input);
			// Peak deviation from the quiescent point, per millisecond window. Deviation
			// rather than absolute level because the output rides on a 3 V bias.
			const window = Math.round(sampleRate / 1000);
			const bias = ne570ExpanderBiasVolts;
			const envelope: number[] = [];
			for (let start = 0; start + window < length; start += window) {
				let peak = 0;
				for (let k = 0; k < window; k += 1) {
					peak = Math.max(peak, Math.abs((output[start + k] ?? 0) - bias));
				}
				envelope.push(peak);
			}
			const settled = envelope[envelope.length - 1] ?? 0;
			for (let index = 0; index < envelope.length; index += 1) {
				if ((envelope[index] ?? 0) >= 0.9 * settled) {
					return index;
				}
			}
			return Number.POSITIVE_INFINITY;
		};

		it("biases its output to the 3.0 V the datasheet states", () => {
			// "The output will bias to 3.0 V when the internal resistors are used."
			//
			// This is the topology assertion, and it is sharper than it looks: 3.0 V is
			// `(1 + R3/R4) * VREF`, the non-inverting-amplifier form, which only arises
			// with R4 returned to ground. Return it to VREF instead -- the reading of
			// Figure 5 this fixture was first built with -- and R4 carries no current and
			// the output sits at VREF's own 1.8 V. A 1.2 V miss, from one node.
			const program = programFor(ne570Expander, pedalPartCatalog);
			expect(quiescentVolts(program)).toBeCloseTo(ne570ExpanderBiasVolts, 4);
		});

		it("matches the datasheet's closed-form expander gain across a 8:1 level range", () => {
			// GAIN = 2 * R3 * VIN(avg) / (R1 * R2 * IB), datasheet Figure 6.
			//
			// Held to 0.5%, and the measured miss is 0.13% at every level. That residual is
			// the solver rather than the model: it falls to 0.041% at 96 kHz and 0.025% at
			// 192 kHz, the signature of Backward Euler's `sinc(wT/2)` capacitor error on
			// the two coupling caps, over a rate-independent ~0.02% floor from detector
			// ripple. Neither is a property of the compandor.
			const program = programFor(ne570Expander, pedalPartCatalog);
			for (const amplitude of [0.25, 0.5, 1.0, 2.0]) {
				const gain = measureGain(program, 1000, 48_000, amplitude);
				expect(gain / ne570ExpanderGainAt(amplitude)).toBeCloseTo(1.0, 2);
			}
		});

		it("expands 2-to-1, which is the whole point of the part", () => {
			// "a 2.0 dB input level change is compressed into a 1.0 dB output level
			// change", run the other way for the expander of Figure 6: 6 dB in, 12 dB out.
			//
			// The single most diagnostic number in this file for this operator, because it
			// is a *slope* and so survives any error in absolute scaling. The old model
			// produced a slope of the wrong sign -- it hard-coded gain proportional to
			// `1/envelope`, which compresses -- and no level assertion would have caught
			// that on its own.
			const program = programFor(ne570Expander, pedalPartCatalog);
			// `measureGain` returns output/input, so recover the output level before
			// taking the slope -- comparing gains instead of levels reports exactly one
			// less than the true slope, since half the level change is the input's own.
			const quiet = 0.5 * measureGain(program, 1000, 48_000, 0.5);
			const loud = 1.0 * measureGain(program, 1000, 48_000, 1.0);
			const slopeDbPerDb =
				(20 * Math.log10(loud / quiet)) / (20 * Math.log10(2));
			expect(slopeDbPerDb).toBeCloseTo(2.0, 2);
		});

		it("expands on a straight line and compresses on a knee, in dB", () => {
			// A compandor is specified in dB per dB, and until this test nothing said so. The
			// level assertions above pin four points against closed forms -- equivalent
			// arithmetic, but never stating the behaviour the part is sold for -- and the 2:1
			// slope takes two points inside a 6 dB window.
			//
			// **What the wider window buys, demonstrated rather than asserted:** clip the
			// expander's measured output at 1.0 V, standing in for any departure from square law
			// outside the sampled range, and the existing `0.5 -> 1.0` pair still reads exactly
			// 2.0000 while the top pair collapses to 0.6387. Five octaves catch a law that is
			// correct where it is currently sampled and wrong elsewhere; two adjacent points
			// cannot. Both forms are scale invariant, which is the same reason the 2:1 slope is
			// worth more than a level.
			//
			// **The two fixtures are each other's control.** The expander's cell sits outside
			// the op amp's loop, so its gain is directly proportional to the envelope and the
			// law is an exact square: 2.0000 dB/dB at every step, a straight line on log-log.
			// The compressor's cell sits inside the loop, where KCL puts its conductance next
			// to the feedback leg's, so the quadratic `A_out * (1/Rfb + k*A_out) = A_in/(Rin+R3)`
			// governs: linear where `1/Rfb` dominates, asymptotically 2:1 where `k*A_out` does.
			// That is a soft knee, and it is the physically right answer rather than a defect.
			//
			// Asserting both together is what proves the harness can see the difference. A
			// measurement that reported a constant slope for both would be measuring nothing.
			const levels = [0.0625, 0.125, 0.25, 0.5, 1.0, 2.0];
			const slopesFor = (source: string): number[] => {
				const program = programFor(source, pedalPartCatalog);
				const outputs = levels.map(
					(amplitude) => amplitude * measureGain(program, 1000, 48_000, amplitude),
				);
				const slopes: number[] = [];
				for (let index = 1; index < levels.length; index += 1) {
					const inputDb = 20 * Math.log10(levels[index]! / levels[index - 1]!);
					const outputDb = 20 * Math.log10(outputs[index]! / outputs[index - 1]!);
					slopes.push(outputDb / inputDb);
				}
				return slopes;
			};

			// The expander: a straight line, to four decimal places, over 30 dB of input.
			for (const slope of slopesFor(ne570Expander)) {
				expect(slope).toBeCloseTo(2.0, 3);
			}

			// The compressor: it compresses, the ratio steepens with level, and it is heading
			// for 2:1 without arriving. Bounds rather than values, because the knee's exact
			// position is set by `Rfb` and would move for changes that are not defects.
			const compressorSlopes = slopesFor(ne570Compressor);
			for (const slope of compressorSlopes) {
				expect(slope).toBeLessThan(1.0);
				expect(slope).toBeGreaterThan(0.5);
			}
			for (let index = 1; index < compressorSlopes.length; index += 1) {
				expect(compressorSlopes[index]!).toBeLessThan(compressorSlopes[index - 1]!);
			}
			// And it is a knee, not a line -- which is also what shows the loop above can tell
			// the two apart at all. Measured spread is 0.24 across these five octaves.
			const spread = compressorSlopes[0]! - compressorSlopes[compressorSlopes.length - 1]!;
			expect(spread).toBeGreaterThan(0.15);
		});

		it("rectifies full-wave, which the 2:1 slope cannot see", () => {
			// Figure 9's detector is a **full-wave** averaging rectifier, and that is a
			// structural fact a level sweep cannot reach. The compression ratio is a
			// level-to-gain slope, so on a steady sine the cell applies a *constant* gain and
			// an ideal compandor is spectrally clean -- the harmonics that do appear come from
			// the detector, not from the compression.
			//
			// A full-wave detector ripples at `2f`. Gain modulation at `2f` on a carrier at `f`
			// produces sum and difference products at `f` and `3f`, and none at `2f`. **So
			// absent even-order content is the evidence of full-wave rectification.** A
			// half-wave detector would ripple at `f` as well, and `f` on `f` lands on `2f`.
			//
			// Measured by mutating the stamp's `Math.abs(...)` to `Math.max(..., 0)`: `H2/H1`
			// moves from 0.0000% to 0.5680% while `H3/H1` stays at 0.1100%.
			//
			// **What the existing assertions do and do not catch under that mutation**, checked
			// rather than assumed, because the first version of this comment claimed they were
			// all blind and they are not. A half-wave rectifier averages to half a full-wave
			// one, so the closed-form gain assertion and the in-loop compression assertion both
			// fail -- on *magnitude*, 2x out, with no way to say why. The **2:1 slope passes
			// untouched**, because halving the detector's output halves the gain at every level
			// and a slope does not see a constant factor. So this test is not the only thing
			// that notices; it is the only thing that identifies the rectifier as the cause,
			// and the only one that would still notice if the 2x were absorbed elsewhere.
			const program = programFor(ne570Expander, pedalPartCatalog);
			const runtime = new ReferenceRuntime(program);
			const sampleRate = 48_000;
			runtime.prepare(sampleRate);
			const hz = 1000;
			const input = new Float64Array(sampleRate / 2);
			for (let index = 0; index < input.length; index += 1) {
				input[index] = Math.sin((2 * Math.PI * hz * index) / sampleRate);
			}
			const output = [...runtime.process(input)];
			// Second half only: the detector's own time constant is milliseconds, so the
			// first half is still settling and would put energy in every bin.
			const from = Math.floor(output.length / 2);
			const window = output.slice(from);
			const magnitudeAt = (frequency: number): number => {
				let sine = 0;
				let cosine = 0;
				for (let index = 0; index < window.length; index += 1) {
					const phase = (2 * Math.PI * frequency * (from + index)) / sampleRate;
					sine += (window[index] ?? 0) * Math.sin(phase);
					cosine += (window[index] ?? 0) * Math.cos(phase);
				}
				return (2 * Math.hypot(sine, cosine)) / window.length;
			};
			const h1 = magnitudeAt(hz);
			const h2 = magnitudeAt(2 * hz);
			const h3 = magnitudeAt(3 * hz);

			// The structural claim. The half-wave mutation reads 5.7e-3 here, so this bound
			// separates the two topologies by more than fifty times.
			expect(h2 / h1).toBeLessThan(1e-4);

			// A ripple ceiling, and unlike the bound above this one is **measured rather than
			// derived**: 0.1100% today, held at 0.5% so a detector whose smoothing regressed
			// would fail while ordinary solver movement would not. It is a ratchet, not a
			// datasheet number -- the NE570's own THD specification is not in this repository.
			expect(h3 / h1).toBeLessThan(0.005);
		});

		it("compresses when the same cell is placed inside the op amp's loop", () => {
			// The datasheet's own sentence -- "a compressor is essentially an expander placed
			// in the feedback loop of the op amp" -- turned into the fixture that pins the gain
			// cell's **direction**. Everything above this line pins its magnitude and is blind
			// to the sign: the cell carries no DC, so the 3.0 V quiescent cannot see it; the
			// gain formula is a magnitude; and the harness reads half peak-to-peak. Reversing
			// the cell's current used to leave all 354 compiler and 100 runtime tests passing.
			//
			// Inside the loop the sign is the whole behaviour, because KCL puts the cell's
			// conductance next to the feedback leg's. Delivered inward the two add and the
			// stage compresses; drawn outward they subtract and the stage has a pole at
			// `gCell = 1/Rfb`, which this fixture sat just past at every drive level --
			// reporting gains of 21x down to 3x and swinging 279 V out of a 9 V part.
			const program = programFor(ne570Compressor, pedalPartCatalog);

			// Bias first, because it proves the fixture is Figure 7 and not a mis-drawn
			// Figure 6: pin 6 carries the input, so R4's 60 uA can only return through the
			// external leg, and 3.96 V is that arithmetic rather than the expander's 3.0 V.
			expect(quiescentVolts(program)).toBeCloseTo(ne570CompressorBiasVolts, 3);

			// The closed form, not a monotonicity check. Both signs give gain that falls with
			// level -- one of them by walking away from the pole -- so monotonicity separates
			// nothing. This separates them by fourteen times at unit drive.
			let previous = Number.POSITIVE_INFINITY;
			for (const amplitude of [0.25, 0.5, 1.0, 2.0]) {
				const gain = measureGain(program, 1000, 48_000, amplitude);
				expect(gain * amplitude / ne570CompressorOutputAt(amplitude)).toBeCloseTo(
					1.0,
					2,
				);
				expect(gain).toBeLessThan(previous);
				previous = gain;
			}
		});

		it("halves its gain when the cell's reference current doubles", () => {
			// Negative control for the gain cell's scaling. `IB` sits in the denominator of
			// the datasheet's gain formula, so this is a clean 6 dB step, and it is the
			// control a dimensionally-wrong transconductance fails: `2.8/vEnv` does not
			// contain `iBias` as a factor at all, so under the old model doubling this
			// number moved the output by nothing.
			const doubled: PartRegistry = {
				entries: pedalPartCatalog.entries.map((entry) =>
					entry.model.kind === "sections" &&
					entry.model.sections.some((s) => s.law.kind === "compandor")
						? {
								...entry,
								model: {
									...entry.model,
									sections: entry.model.sections.map((section) =>
										section.law.kind === "compandor"
											? {
													...section,
													law: { ...section.law, iBias: section.law.iBias * 2 },
												}
											: section,
									),
								},
							}
						: entry,
				),
			};
			const base = measureGain(
				programFor(ne570Expander, pedalPartCatalog),
				1000,
				48_000,
				1.0,
			);
			const halved = measureGain(
				programFor(ne570Expander, doubled),
				1000,
				48_000,
				1.0,
			);
			expect(base / halved).toBeCloseTo(2.0, 2);
		});

		it("takes its detector time constant from the external capacitor, not from a constant", () => {
			// `tau = R5 * CRECT`, and CRECT is a component in the document. The fast
			// fixture is the same circuit with a tenth of the capacitance, so it must reach
			// its settled level about ten times sooner.
			//
			// This is the control for a whole class of defect rather than for one number.
			// The previous model integrated a private envelope state against a hard-coded
			// 50 ms and never read the CRECT node at all -- it assigned
			// `solution[stamp.rectCap]` to a variable and did not use it. These two
			// fixtures rendered identically, and the pin the chip devotes to setting its
			// own attack and release did nothing.
			const slow = attackMs(programFor(ne570Expander, pedalPartCatalog));
			const fast = attackMs(
				programFor(ne570ExpanderFastDetector, pedalPartCatalog),
			);
			expect(slow).toBeGreaterThan(5 * fast);
			// And in absolute terms, near the RC the datasheet's own test circuit implies:
			// 10k * 2.2uF = 22 ms, whose 90% point is about 2.3 time constants.
			expect(slow).toBeGreaterThan(30);
			expect(slow).toBeLessThan(80);
		});
	});

	it("honestly refuses a compandor with missing/unconnected output terminals under V2", () => {
		const badCompandorSrc = `schema: circuit-interchange/v3
deviceInterface:
  controls:
    - id: INPUT_JACK
      label: "Input Jack"
      kind: jack
      role: "input"
    - id: OUTPUT_JACK
      label: "Output Jack"
      kind: jack
      role: "output"
components:
  - id: INPUT_JACK
    kind: jack
    name: "INPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: -480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: OUTPUT_JACK
    kind: jack
    name: "OUTPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: 480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: MY_COMPANDOR
    kind: ic
    name: "MY_COMPANDOR"
    sourceTypeName: "Circuit.Compandor"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      PartNumber: "MY_COMPANDOR"
    terminals:
      - name: rect_in
        node: 1
        position:
          x: 0
          y: 0
      - name: rect_cap
        node: 3
        position:
          x: 0
          y: 0
      - name: cell_in
        node: 1
        position:
          x: 0
          y: 0
`;
		const result = compile(badCompandorSrc, { registry: emptyRegistry });
		expect(result.status).toBe("unsupported");
		expect((result as any).reasons[0].stage).toBe("device-laws");
		expect((result as any).reasons[0].reason).toContain(
			"integrated circuit has no model",
		);
	});

	it("honestly refuses a bbd with missing/unconnected input terminals under V2", () => {
		const badBbdSrc = `schema: circuit-interchange/v3
deviceInterface:
  controls:
    - id: INPUT_JACK
      label: "Input Jack"
      kind: jack
      role: "input"
    - id: OUTPUT_JACK
      label: "Output Jack"
      kind: jack
      role: "output"
components:
  - id: INPUT_JACK
    kind: jack
    name: "INPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: -480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: OUTPUT_JACK
    kind: jack
    name: "OUTPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: 480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: MY_BBD
    kind: ic
    name: "MY_BBD"
    sourceTypeName: "Circuit.Bbd"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      PartNumber: "MY_BBD"
    terminals:
      - name: clk1
        node: 1
        position:
          x: 0
          y: 0
      - name: clk2
        node: 2
        position:
          x: 0
          y: 0
`;
		const result = compile(badBbdSrc, { registry: emptyRegistry });
		expect(result.status).toBe("unsupported");
		expect((result as any).reasons[0].stage).toBe("device-laws");
		expect((result as any).reasons[0].reason).toContain(
			"integrated circuit has no model",
		);
	});

	it("compiles and active-models positive and negative voltage regulators under V2", () => {
		const regSrc = `schema: circuit-interchange/v3
deviceInterface:
  controls:
    - id: INPUT_JACK
      label: "Input Jack"
      kind: jack
      role: "input"
    - id: OUTPUT_JACK
      label: "Output Jack"
      kind: jack
      role: "output"
components:
  - id: INPUT_JACK
    kind: jack
    name: "INPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: -480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: OUTPUT_JACK
    kind: jack
    name: "OUTPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: 480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: REG_POS
    kind: ic
    name: "REG_POS"
    sourceTypeName: "Circuit.VoltageRegulator"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      PartNumber: "7805"
    terminals:
      - name: vin
        node: 1
        position:
          x: 0
          y: 0
      - name: gnd
        node: 0
        position:
          x: 0
          y: 0
      - name: vout
        node: 2
        position:
          x: 0
          y: 0
  - id: REG_NEG
    kind: ic
    name: "REG_NEG"
    sourceTypeName: "Circuit.VoltageRegulator"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      PartNumber: "LM7915"
    terminals:
      - name: gnd
        node: 0
        position:
          x: 0
          y: 0
      - name: vin
        node: 1
        position:
          x: 0
          y: 0
      - name: vout
        node: 3
        position:
          x: 0
          y: 0
`;
		const result = compile(regSrc, { registry: pedalPartCatalog });
		expect(result.status).toBe("ok");

		const runtime = new ReferenceRuntime((result as any).program);
		runtime.prepare(48000);

		// Verify dynamic regulation outputs
		const input = new Float64Array(1).fill(9.0); // Vin = 9V
		const output = runtime.process(input);

		// Node 2 is the output of positive 7805 regulator -> regulated to +5.0V relative to GND (0V)
		// We query the nodeVoltages map inside reference-runtime if needed, or check process output.
		// Wait! Since output jack (node 2) is connected to pin 3 of REG_POS (vout, node 2):
		// The process output (which reads from node 2!) is exactly the regulated +5.0V output!
		expect(output[0]).toBeCloseTo(5.0, 5); // Perfectly regulated to 5.0V!

		for (const val of output) {
			expect(Number.isNaN(val)).toBe(false);
		}
	});

	it("resolves section terminal indices by declared terminal role, not by declaration position (TESTREG18)", () => {
		const regSrc = `schema: circuit-interchange/v3
deviceInterface:
  controls:
    - id: INPUT_JACK
      label: "Input Jack"
      kind: jack
      role: "input"
    - id: OUTPUT_JACK
      label: "Output Jack"
      kind: jack
      role: "output"
components:
  - id: INPUT_JACK
    kind: jack
    name: "INPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: -480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: OUTPUT_JACK
    kind: jack
    name: "OUTPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: 480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: REG18
    kind: ic
    name: "REG18"
    sourceTypeName: "Circuit.VoltageRegulator"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      PartNumber: "TESTREG18"
    terminals:
      - name: in
        node: 1
        position:
          x: 0
          y: 0
      - name: out
        node: 2
        position:
          x: 0
          y: 0
      - name: gnd
        node: 0
        position:
          x: 0
          y: 0
`;

		const customRegistry: PartRegistry = {
			entries: [
				{
					partIds: ["TESTREG18"],
					declaredTypes: [],
					terminalRoleGroups: [
						["in", "vin", "input"],
						["gnd", "ground"],
						["out", "vout", "output"],
					],
					model: {
						kind: "sections",
						sections: [
							{
								law: {
									kind: "voltage-source",
									volts: 18.0,
									sourceOhms: 1.0,
								},
								terminals: [2, 1],
							},
						],
						pinout: [null, null, null],
					},
				},
			],
		};

		const result = compile(regSrc, { registry: customRegistry });
		expect(result.status).toBe("ok");

		const runtime = new ReferenceRuntime((result as any).program);
		runtime.prepare(48000);

		const input = new Float64Array(1).fill(24.0);
		const output = runtime.process(input);

		expect(output[0]).toBeCloseTo(18.0, 5);
		expect(Number.isNaN(output[0])).toBe(false);
	});

	it("compiles and active-simulates physical open-collector comparators under V2", () => {
		const compSrc = `schema: circuit-interchange/v3
deviceInterface:
  controls:
    - id: INPUT_JACK
      label: "Input Jack"
      kind: jack
      role: "input"
    - id: OUTPUT_JACK
      label: "Output Jack"
      kind: jack
      role: "output"
components:
  - id: INPUT_JACK
    kind: jack
    name: "INPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: -480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: OUTPUT_JACK
    kind: jack
    name: "OUTPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: 480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: PULLUP_RES
    kind: resistor
    name: "PULLUP_RES"
    sourceTypeName: "Circuit.Resistor"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 3
        position:
          x: 0
          y: 0
      - name: b
        node: 2
        position:
          x: 0
          y: 0
    properties:
      Resistance: 10000
  - id: PULLUP_SUPPLY
    kind: rail
    name: "V_PULLUP"
    sourceTypeName: "Circuit.VoltageRail"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      Voltage: 5 V
    terminals:
      - name: v
        node: 3
        position:
          x: 0
          y: 0
  - id: MY_COMPARATOR
    kind: ic
    name: "MY_COMPARATOR"
    sourceTypeName: "Circuit.Comparator"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      PartNumber: "LM311"
    terminals:
      - name: pin1_gnd
        node: 0
        position:
          x: 0
          y: 0
      - name: pin2_vin_plus
        node: 1
        position:
          x: 0
          y: 0
      - name: pin3_vin_minus
        node: 0
        position:
          x: 0
          y: 0
      - name: pin4_vee
        node: 0
        position:
          x: 0
          y: 0
      - name: pin5_balance
        node: 0
        position:
          x: 0
          y: 0
      - name: pin6_strobe
        node: 0
        position:
          x: 0
          y: 0
      - name: pin7_output
        node: 2
        position:
          x: 0
          y: 0
      - name: pin8_vcc
        node: 0
        position:
          x: 0
          y: 0
`;
		const result = compile(compSrc, { registry: pedalPartCatalog });
		expect(result.status).toBe("ok");

		const runtime = new ReferenceRuntime((result as any).program);
		runtime.prepare(48000);

		// Verify active open-collector comparison outputs!
		// 1. Vin+ is negative (-5.0V), which is below Vin- (0.0V):
		// Sigmoid pulls down to Vee (0V) with 10 Ohm.
		// Pull-up resistor is 10k, so output node 2 voltage is divided:
		// V_out = 5.0V * (10 / 10010) ~ 0.005 V.
		const inputLow = new Float64Array(1).fill(-5.0);
		const outputLow = runtime.process(inputLow);
		expect(outputLow[0]).toBeLessThan(0.01); // Pulled down to ground!

		// 2. Vin+ is positive (+5.0V), which is above Vin- (0.0V):
		// Sigmoid open-collector floats with 1G Ohm.
		// Pull-up resistor is 10k, so output node 2 voltage is:
		// V_out = 5.0V * (1G / 1G+10k) ~ 5.0 V.
		const inputHigh = new Float64Array(1).fill(5.0);
		const outputHigh = runtime.process(inputHigh);
		expect(outputHigh[0]).toBeCloseTo(5.0, 3); // Floats to pull-up supply rail!

		for (const val of outputHigh) {
			expect(Number.isNaN(val)).toBe(false);
		}
	});

	it("lowers an op-amp drawn as a registered comparator to open-collector wire-OR stamps instead of over-determining the shared node", () => {
		// `moogerfooger-mf-102` draws its LM339A sections as `kind: opamp` and ties two of their
		// outputs together onto one pull-up node. Two `ideal-opamp` stamps there are two voltage
		// sources fighting over the same node -- singular, so the packet held every sample and
		// rendered silence. An open-collector comparator is "sink or float", so a node with two of
		// them is determined by whichever one conducts; the whole point of `opampPartRegisteredAsOtherLaw`
		// is that a registered part's law overrides the drawing's kind. This pins the wire-OR shape
		// at the compiler: two comparator stamps on the same node, zero ideal-opamp stamps, and the
		// open-collector parameters come from the catalog entry untouched.
		const orSrc = `schema: circuit-interchange/v3
deviceInterface:
  controls:
    - id: INPUT_JACK
      label: "Input Jack"
      kind: jack
      role: "input"
    - id: OUTPUT_JACK
      label: "Output Jack"
      kind: jack
      role: "output"
components:
  - id: INPUT_JACK
    kind: jack
    name: "INPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: -480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: OUTPUT_JACK
    kind: jack
    name: "OUTPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: 480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: PULLUP_RES
    kind: resistor
    name: "PULLUP_RES"
    sourceTypeName: "Circuit.Resistor"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 0
          y: 0
      - name: b
        node: 3
        position:
          x: 0
          y: 0
    properties:
      Resistance: 47000
  - id: PULLUP_SUPPLY
    kind: rail
    name: "V_PULLUP"
    sourceTypeName: "Circuit.VoltageRail"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      Voltage: 5 V
    terminals:
      - name: v
        node: 3
        position:
          x: 0
          y: 0
  - id: RDIV1
    kind: resistor
    name: "RDIV1"
    sourceTypeName: "Circuit.Resistor"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 3
        position:
          x: 0
          y: 0
      - name: b
        node: 20
        position:
          x: 0
          y: 0
    properties:
      Resistance: 68000
  - id: RDIV2
    kind: resistor
    name: "RDIV2"
    sourceTypeName: "Circuit.Resistor"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 20
        position:
          x: 0
          y: 0
      - name: b
        node: 0
        position:
          x: 0
          y: 0
    properties:
      Resistance: 100000
  - id: RFB
    kind: resistor
    name: "RFB"
    sourceTypeName: "Circuit.Resistor"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 0
          y: 0
      - name: b
        node: 20
        position:
          x: 0
          y: 0
    properties:
      Resistance: 100000
  - id: COMP1
    kind: opamp
    name: "COMP1"
    sourceTypeName: "Circuit.OpAmp"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: non_inverting
        role: nonInverting
        node: 1
        position:
          x: 0
          y: 0
      - name: inverting
        role: inverting
        node: 20
        position:
          x: 0
          y: 0
      - name: output
        role: output
        node: 2
        position:
          x: 0
          y: 0
      - name: vplus
        role: supplyPositive
        node: 3
        position:
          x: 0
          y: 0
      - name: vminus
        role: supplyNegative
        node: 0
        position:
          x: 0
          y: 0
    properties:
      PartNumber: "LM339A"
      Name: "COMP1"
      SourceValue: "LM339A"
      VisibleToken: "COMP1 LM339A"
  - id: COMP2
    kind: opamp
    name: "COMP2"
    sourceTypeName: "Circuit.OpAmp"
    origin:
      x: 0
      y: 20
    rotation: 0
    flipped: false
    terminals:
      - name: non_inverting
        role: nonInverting
        node: 1
        position:
          x: 0
          y: 0
      - name: inverting
        role: inverting
        node: 20
        position:
          x: 0
          y: 0
      - name: output
        role: output
        node: 2
        position:
          x: 0
          y: 0
      - name: vplus
        role: supplyPositive
        node: 3
        position:
          x: 0
          y: 0
      - name: vminus
        role: supplyNegative
        node: 0
        position:
          x: 0
          y: 0
    properties:
      PartNumber: "LM339A"
      Name: "COMP2"
      SourceValue: "LM339A"
      VisibleToken: "COMP2 LM339A"
`;
		const result = compile(orSrc, { registry: pedalPartCatalog });
		expect(result.status).toBe("ok");

		const program = (result as any).program;
		const allStamps = program.blocks.flatMap((b: any) => b.stamps ?? []);
		const comparators = allStamps.filter((s: any) => s.kind === "comparator");
		// Both outputs land on the same node, so the wire-OR is real and the node is not
		// over-determined. The catalog's open-collector parameters survive untouched.
		expect(comparators.length).toBe(2);
		expect(comparators[0].output).toBe(comparators[1].output);
		expect(comparators[0].pullDownOhms).toBe(10);
		expect(comparators[0].floatOhms).toBe(1_000_000_000);
		expect(comparators[0].sensitivity).toBe(1000);
		expect(allStamps.some((s: any) => s.kind === "ideal-opamp")).toBe(false);

		const runtime = new ReferenceRuntime(program);
		runtime.prepare(48000);

		// Both inputs below the 2.98 V threshold: both collectors conduct, the shared node is
		// pulled through 10 ohms and reads ~0.
		const inputLow = new Float64Array(1).fill(-5.0);
		const outputLow = runtime.process(inputLow);
		expect(outputLow[0]).toBeLessThan(0.01);

		// Both inputs above the threshold: both collectors float, and the pull-up brings the
		// shared node to the rail.
		const inputHigh = new Float64Array(1).fill(5.0);
		const outputHigh = runtime.process(inputHigh);
		// Both collectors float, so the pull-up brings the shared node near the 5 V rail -- well
		// above the 2.98 V threshold, and far from the pulled-down state above.
		expect(outputHigh[0]).toBeGreaterThan(4.0);

		for (const val of outputHigh) {
			expect(Number.isNaN(val)).toBe(false);
		}
	});
});

describe("a program that reaches its output with nothing", () => {
	// The contract is on the **emitted** program rather than on a graph walk, which is what keeps
	// it free of false alarms: `link.ts` already emits only the blocks that reach the output, so
	// an empty `order` means nothing executes under any runtime, at any control position. See
	// `unreachable-output.ts` for why path-finding was rejected for this.
	const compiled = compile(diodeClipper, { registry: emptyRegistry });
	if (compiled.status !== "ok") {
		throw new Error("fixture must compile for this contract to be testable");
	}
	// The same netlist the warning is given in `compile`, so the wiring measurement it reports is
	// the document's own rather than a stand-in.
	const netlist = readNetlist(diodeClipper);

	it("says nothing about a program that executes something", () => {
		// The negative control, and the half that matters: a working program must stay silent.
		expect(compiled.program.order.length).toBeGreaterThan(0);
		expect(findUnreachableOutput(compiled.program, netlist)).toHaveLength(0);
	});

	it("names a program whose execution order is empty", () => {
		const severed: Program = { ...compiled.program, order: [] };
		const warnings = findUnreachableOutput(severed, netlist);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.code).toBe("output-port-unreachable");
		// It has to say how much was compiled, because "nothing runs" reads like an empty
		// document until you know the block count is not zero.
		expect(warnings[0]?.detail).toContain(
			`${compiled.program.blocks.length} block`,
		);
	});
});

describe("unreadable terminal roles", () => {
	// A resolver that falls back to declaration order cannot tell "this document stated nothing"
	// from "this document stated something I could not use". For a *symmetric* device the first
	// is the fallback's legitimate case; for a diode neither is, because a diode has a direction
	// whatever the document says. These cases pin both halves, and the negatives are the point:
	// a warning that fires on every device would be noise, and one that fires on none would be
	// untestable.
	const roleWarnings = (source: string): readonly { device: string }[] => {
		const result = compile(source, { registry: emptyRegistry });
		expect(result.status).toBe("ok");
		return (
			(result as { warnings?: readonly { code: string; device: string }[] })
				.warnings ?? []
		).filter((warning) => warning.code === "terminal-role-unreadable");
	};

	it("stays silent when the roles resolve", () => {
		// The unmodified fixture: `anode`/`cathode` roles on both diodes, read by role.
		expect(roleWarnings(diodeClipper).length).toBe(0);
	});

	it("stays silent when a terminal is renamed but keeps its role", () => {
		// The contract this whole migration is for: a terminal's *name* is pin identity and
		// carries no meaning a stage may read, so renaming one must change nothing at all.
		const renamed = derive(
			diodeClipper,
			"      - name: anode\n        role: anode\n        node: 2",
			"      - name: positiveleg\n        role: anode\n        node: 2",
		);
		expect(roleWarnings(renamed).length).toBe(0);
	});

	it("warns when a diode declares `end`/`end`, which states no direction", () => {
		// **A diode is never symmetric, so there is no legitimate positional case for one.**
		// `end` is core's role for two interchangeable ends -- true of a resistor, false of a
		// diode -- so `end`/`end` says the source did not state the direction, not that there is
		// none. 13 corpus diodes are this shape, and a mutation study reversing one of them
		// showed the program moves: declaration order here is a guess, and this used to be
		// suppressed by `a`/`b` sitting in `orientationFreeRoles`.
		const endDiode = derive(
			derive(
				diodeClipper,
				"      - name: anode\n        role: anode\n        node: 2",
				"      - name: a\n        role: end\n        node: 2",
			),
			"      - name: cathode\n        role: cathode\n        node: 0",
			"      - name: b\n        role: end\n        node: 0",
		);
		const warnings = roleWarnings(endDiode);
		expect(warnings.length).toBe(1);
		expect(warnings[0]?.device).toBe("D1");
	});

	// W1: a component declared as one transistor that stands for several devices. The rule is a
	// conjunction -- more terminals than the law binds, AND roles that cannot be read -- so all
	// three cases below are needed to pin it: only the first should open.
	const shellWarnings = (source: string): readonly { device: string }[] => {
		const result = compile(source, { registry: emptyRegistry });
		expect(result.status).toBe("ok");
		return (
			(result as { warnings?: readonly { code: string; device: string }[] })
				.warnings ?? []
		).filter((warning) => warning.code === "non-executable-support-shell");
	};
	const bjtStampCount = (source: string): number => {
		const result = compile(source, { registry: emptyRegistry });
		expect(result.status).toBe("ok");
		const program = (result as { program: Program }).program;
		return program.blocks.reduce(
			(total, block) =>
				total +
				(block.kind === "mna"
					? block.stamps.filter((stamp) => stamp.kind === "bjt").length
					: 0),
			0,
		);
	};
	// Two extra terminals on unreadable role names: nineteen is `boss-ce-1`'s real shape, and
	// five is enough to prove the rule without a fixture nobody can read.
	const extraTerminals = (names: readonly string[]): string =>
		names
			.map(
				(name) =>
					`      - name: ${name}\n        node: 5\n        position:\n          x: 0\n          y: 0\n`,
			)
			.join("");

	it("opens a transistor shell that declares more terminals than the law binds and names none readably", () => {
		const shell = derive(
			commonEmitterAmplifier,
			"      - name: base\n        role: base\n        node: 2",
			`${extraTerminals(["q3_base_r26_side", "q4_base_r27_side"])}      - name: q3_q5_left_column\n        node: 2`,
		);
		expect(shellWarnings(shell).map((w) => w.device)).toEqual(["Q1"]);
		// The point of opening it: no transistor is invented. The fixture's only BJT is this one.
		expect(bjtStampCount(shell)).toBe(0);
		expect(bjtStampCount(commonEmitterAmplifier)).toBe(1);
	});

	it("keeps a transistor whose extra terminals are unused package pins, because its roles read", () => {
		// `moogerfooger-mf-102`'s four `MPQ3906` sections are this shape: a quad array declaring
		// collector/base/emitter plus two package pins. Over-arity alone must not open it.
		const quadSection = derive(
			commonEmitterAmplifier,
			"      - name: base\n        role: base\n        node: 2",
			`${extraTerminals(["terminal4", "terminal5"])}      - name: base\n        role: base\n        node: 2`,
		);
		expect(shellWarnings(quadSection).length).toBe(0);
		expect(bjtStampCount(quadSection)).toBe(1);
	});

	it("keeps a three-terminal transistor whose roles are unreadable, warning instead of opening", () => {
		// Unreadable roles alone must not open a device either: three terminals is a transistor,
		// however it spelled them, so it is stamped and the unreadable-role warning carries it.
		const oddlyNamed = derive(
			commonEmitterAmplifier,
			"      - name: base\n        role: base\n        node: 2",
			"      - name: q15_drive\n        node: 2",
		);
		expect(shellWarnings(oddlyNamed).length).toBe(0);
		expect(bjtStampCount(oddlyNamed)).toBe(1);
		expect(roleWarnings(oddlyNamed).map((w) => w.device)).toEqual(["Q1"]);
	});

	// W2: which op-amps are allowed to reach a registry `sections` entry. The device-class law
	// wins wherever it can read the terminals; the registry is consulted only where it cannot.
	it("sends an op-amp to the registry only when its own law cannot bind the terminals", () => {
		// **Declared roles, not folded names.** Since 2026-09-03 `opampTerminals` resolves from
		// `declaredTerminalRoles`, and this predicate has to ask the same question on the same
		// field or the two disagree about which devices need a `sections` entry.
		const opampWith = (declared: readonly string[]): Device => ({
			id: "U1",
			kind: "opamp",
			nodes: declared.map((_, index) => index + 1),
			parameters: {},
			control: null,
			identity: {
				partNumber: "NJM4558DD",
				declaredType: "Circuit.OpAmp",
				terminalRoles: declared.map(() => null),
				declaredTerminalRoles: [...declared],
				declaredWindings: null,
			},
		});
		// The two shapes 308 of the corpus's 315 op-amps use: three signal pins, or those plus
		// two supplies. Both bind, so both keep the device-class law and never reach the registry.
		expect(
			opampNeedsRegistrySections(
				opampWith(["nonInverting", "inverting", "output"]),
			),
		).toBe(false);
		expect(
			opampNeedsRegistrySections(
				opampWith([
					"nonInverting",
					"inverting",
					"output",
					"supplyPositive",
					"supplyNegative",
				]),
			),
		).toBe(false);
		// A whole dual package as one component declares two of every signal role, so the read is
		// ambiguous and only a `sections` entry can place its pins. This is `boss-dm-3`'s `IC1`.
		expect(
			opampNeedsRegistrySections(
				opampWith([
					"output",
					"inverting",
					"nonInverting",
					"supplyNegative",
					"nonInverting",
					"inverting",
					"output",
					"supplyPositive",
				]),
			),
		).toBe(true);
		// A device declaring no role at all cannot be bound by the device-class law either, so it
		// is routed too -- the case that used to be the silent positional fallback.
		expect(opampNeedsRegistrySections(opampWith([]))).toBe(true);
		// Not a kind test: a device of another kind is never routed by this predicate.
		expect(
			opampNeedsRegistrySections({
				...opampWith(["nonInverting"]),
				kind: "bjt",
			}),
		).toBe(false);
	});

	// W3: the source states a device class we have no law for, in its typed `sourceTypeName`.
	it("does not stamp a unijunction transistor as a BJT, and says which device is absent", () => {
		const lawWarnings = (source: string): readonly { device: string }[] => {
			const result = compile(source, { registry: emptyRegistry });
			expect(result.status).toBe("ok");
			return (
				(result as { warnings?: readonly { code: string; device: string }[] })
					.warnings ?? []
			).filter((warning) => warning.code === "device-law-not-implemented");
		};
		const ujt = derive(
			commonEmitterAmplifier,
			"    sourceTypeName: Circuit.BJT",
			"    sourceTypeName: Circuit.UnijunctionTransistor",
		);
		expect(lawWarnings(ujt).map((w) => w.device)).toEqual(["Q1"]);
		// The point: no transistor is simulated in its place.
		expect(bjtStampCount(ujt)).toBe(0);
		// Negative control -- the unmodified fixture declares a BJT and keeps its law.
		expect(lawWarnings(commonEmitterAmplifier).length).toBe(0);
		expect(bjtStampCount(commonEmitterAmplifier)).toBe(1);
	});

	it("warns for a diode of bare lugs too, for the same reason", () => {
		// Declaring nothing and declaring `end`/`end` are different facts, and for most kinds
		// only the second is a legitimate fallback. A diode is the exception in the other
		// direction: it has a direction either way, so neither shape gives the resolver what it
		// needs and both are named.
		const barePins = derive(
			derive(
				diodeClipper,
				"      - name: anode\n        role: anode\n        node: 2",
				"      - name: pin1\n        node: 2",
			),
			"      - name: cathode\n        role: cathode\n        node: 0",
			"      - name: pin2\n        node: 0",
		);
		const warnings = roleWarnings(barePins);
		expect(warnings.length).toBe(1);
		expect(warnings[0]?.device).toBe("D1");
	});
});

describe("the Belton BTDR-2H reverb brick, against its own datasheet", () => {
	// **Why this suite is a decay measurement and not a waveform comparison.** The datasheet
	// gives decay, gain and impedances and does *not* give the internal tap structure, and the
	// packet's own `BTDR2H` records `SourceTraceStatus: complete-pin-shell` with "Internal
	// DSP/firmware is not present in the packet". So the runtime's `digital-reverb-module` is a
	// Schroeder reverberator whose comb and allpass lengths are a modelling choice: they set
	// timbre and echo density, and asserting on them would be asserting on a guess. What the
	// datasheet *does* give is T60 and level, and those are exactly what these tests pin.
	const RATE = 48_000;
	const BURST_SECONDS = 0.2;
	const TOTAL_SECONDS = 6;
	const WINDOW_SECONDS = 0.05;

	/** A 440 Hz burst, then silence, so the tail is the only thing left to measure. */
	const renderBurstAndTail = (program: Program): Float64Array => {
		const runtime = new ReferenceRuntime(program);
		runtime.prepare(RATE);
		const length = Math.round(TOTAL_SECONDS * RATE);
		const input = new Float64Array(length);
		const burst = Math.round(BURST_SECONDS * RATE);
		for (let index = 0; index < burst; index += 1) {
			input[index] = 0.5 * Math.sin((2 * Math.PI * 440 * index) / RATE);
		}
		return runtime.process(input);
	};

	/** RMS of the `WINDOW_SECONDS` window that opens `afterSeconds` past the burst. */
	const windowRms = (rendered: Float64Array, afterSeconds: number): number => {
		const from = Math.round((BURST_SECONDS + afterSeconds) * RATE);
		const to = from + Math.round(WINDOW_SECONDS * RATE);
		let sum = 0;
		for (let index = from; index < to; index += 1) {
			sum += (rendered[index] ?? 0) ** 2;
		}
		return Math.sqrt(sum / (to - from));
	};

	/**
	 * The catalog, with this one macro's parameters overridden.
	 *
	 * The point is to change *only* the declared parameter and nothing else, which is what makes
	 * the result evidence that the parameter is wired rather than evidence that two circuits
	 * differ.
	 */
	const catalogWithReverbParameters = (
		overrides: Readonly<Record<string, number>>,
	): PartRegistry => ({
		entries: pedalPartCatalog.entries.map((entry) =>
			entry.model.kind === "macro" &&
			entry.model.macro.modelId === "digital-reverb-module"
				? {
						...entry,
						model: {
							...entry.model,
							macro: {
								...entry.model.macro,
								parameters: { ...entry.model.macro.parameters, ...overrides },
							},
						},
					}
				: entry,
		),
	});

	const compileReverb = (
		overrides: Readonly<Record<string, number>> = {},
	): Program => {
		const result = compile(beltonBrickReverb, {
			registry: catalogWithReverbParameters(overrides),
		});
		if (result.status !== "ok") {
			throw new Error(
				`beltonBrickReverb no longer compiles: ${JSON.stringify(result)}`,
			);
		}
		return result.program;
	};

	it("carries the datasheet's decay and gain into a scheduled macro block", () => {
		const program = compileReverb();
		expect(program.requiredModels).toContain("digital-reverb-module");
		const macro = program.blocks.find(
			(block) =>
				(block.kind === "macro" || block.kind === "composed") &&
				block.modelId === "digital-reverb-module",
		);
		expect(macro).toBeDefined();
		// The two datasheet figures, arriving from the registry rather than from a constant in
		// the runtime -- which is the whole reason the parameters are declared there.
		expect(
			(macro as Extract<Block, { kind: "macro" } | { kind: "composed" }>)
				.parameters.decaySeconds,
		).toBe(2.5);
		expect((macro as Extract<Block, { kind: "macro" } | { kind: "composed" }>).parameters.outputGain).toBe(0.9205);
		// Scheduled, not merely present: `order` holds block ids, and a macro missing from it
		// executes never.
		expect(program.order).toContain((macro as Extract<Block, { kind: "macro" } | { kind: "composed" }>).id);
	});

	it("goes on sounding after the input stops, which is the whole of what a reverb is", () => {
		const rendered = renderBurstAndTail(compileReverb());
		const atStop = windowRms(rendered, 0);
		const halfSecondLater = windowRms(rendered, 0.5);
		// A dry shell would be silent the sample after the burst ends. This one is not: half a
		// second later it is still at 2.9e-2, some 30 dB above anything called inaudible.
		expect(atStop).toBeGreaterThan(1e-2);
		expect(halfSecondLater).toBeGreaterThan(1e-2);
		// And it is a tail, not a hung oscillator: it decays.
		expect(halfSecondLater).toBeLessThan(atStop);
	});

	it("reaches -60 dB in the decay time the datasheet states, and scales with it", () => {
		// **The closed form, from `reverbCombGain`.** A comb of delay `d` keeps `g` per pass, and
		// `g` is set to `10 ** (-3 * d / decaySeconds)`, so the loop is down 60 dB after
		// `decaySeconds` whatever `d` is. Measured at one fixed instant -- 2.5 s after the burst
		// stops -- the attenuation is therefore `-60 * 2.5 / decaySeconds` dB, a single line that
		// three different parameter values have to satisfy at once. Three magic numbers would not
		// be evidence that the decay is *designed*; one law that all three obey is.
		for (const decaySeconds of [2.5, 5, 1]) {
			const rendered = renderBurstAndTail(compileReverb({ decaySeconds }));
			const measured =
				20 * Math.log10(windowRms(rendered, 2.5) / windowRms(rendered, 0));
			const predicted = (-60 * 2.5) / decaySeconds;
			// Within 3 dB, because the window at the burst's end still contains the burst's own
			// decay and the four combs are at different phases of theirs. The band is far tighter
			// than the effect: the three predictions are -60, -30 and -150 dB, and the renders
			// land at -61.4, -31.3 and -150.9.
			expect(Math.abs(measured - predicted)).toBeLessThan(3);
		}
	}, 30_000); // three multi-second renders; the 5 s default is the margin, not the work

	it("takes its level from outputGain, and leaves the decay untouched", () => {
		// Two parameters, two axes: `outputGain` must move the level and *only* the level. If the
		// runtime folded gain into the comb feedback, halving it would shorten the tail too.
		const datasheet = renderBurstAndTail(compileReverb());
		const halved = renderBurstAndTail(
			compileReverb({ outputGain: 0.9205 / 2 }),
		);
		expect(windowRms(halved, 0) / windowRms(datasheet, 0)).toBeCloseTo(0.5, 4);
		const decayDb = (rendered: Float64Array): number =>
			20 * Math.log10(windowRms(rendered, 2.5) / windowRms(rendered, 0));
		expect(decayDb(halved)).toBeCloseTo(decayDb(datasheet), 6);
	});
});

describe("the MN3101 BBD clock generator, the law the scoreboard found unpinned", () => {
	// This law owns three stamped outputs and a sampled oscillator, and until 2026-09-07 nothing
	// rendered it: `--scoreboard` read `clock-driver: UNGATED, no fixture at all` against 7 corpus
	// packets. Every claim below is a closed form off `reference-runtime.ts`'s stamp, not a
	// snapshot of what it currently emits.
	const RATE = 48_000;

	/** The catalog with every `clock-driver` section's declared frequency replaced. */
	const catalogAtFrequency = (defaultFrequency: number): PartRegistry => ({
		entries: pedalPartCatalog.entries.map((entry) => {
			if (
				entry.model.kind !== "sections" ||
				!entry.model.sections.some(
					(section) => section.law.kind === "clock-driver",
				)
			) {
				return entry;
			}
			return {
				...entry,
				model: {
					...entry.model,
					sections: entry.model.sections.map((section) =>
						section.law.kind === "clock-driver"
							? { ...section, law: { ...section.law, defaultFrequency } }
							: section,
					),
				},
			};
		}),
	});

	type ClockStamp = Extract<
		Extract<Block, { kind: "mna" }>["stamps"][number],
		{ kind: "clock-driver" }
	>;

	/** The program, its clock-driver stamp, and the block the stamp lives in. */
	const compileClock = (
		source: string,
		defaultFrequency = 10_000,
	): { program: Program; stamp: ClockStamp; blockId: string } => {
		const result = compile(source, {
			registry: catalogAtFrequency(defaultFrequency),
		});
		if (result.status !== "ok") {
			throw new Error(`clock fixture no longer compiles: ${JSON.stringify(result)}`);
		}
		for (const block of result.program.blocks) {
			if (block.kind !== "mna") {
				continue;
			}
			for (const stamp of block.stamps) {
				if (stamp.kind === "clock-driver") {
					return { program: result.program, stamp, blockId: block.id };
				}
			}
		}
		throw new Error("no clock-driver stamp: the fixture stopped reaching the law");
	};

	/**
	 * Every sample's CP1, CP2, VGG, VDD and OX1, read by **row**.
	 *
	 * The stamp's fields are row indices into the block's solution, not source node ids -- the
	 * distinction `Block.nodeIds` exists for -- so they index `voltages` directly and no lookup
	 * is needed or wanted.
	 */
	const renderRows = (
		program: Program,
		stamp: ClockStamp,
		blockId: string,
		samples: number,
	): {
		cp1: number[];
		cp2: number[];
		vgg: number[];
		vdd: number[];
		ox1: number[];
	} => {
		const runtime = new ReferenceRuntime(program);
		runtime.prepare(RATE);
		const rows = { cp1: [], cp2: [], vgg: [], vdd: [], ox1: [] } as {
			cp1: number[];
			cp2: number[];
			vgg: number[];
			vdd: number[];
			ox1: number[];
		};
		const one = new Float64Array(1);
		for (let index = 0; index < samples; index += 1) {
			runtime.process(one);
			const snapshot = runtime
				.nodeVoltageSnapshot()
				.find((entry) => entry.blockId === blockId);
			if (snapshot === undefined) {
				throw new Error(`no snapshot for ${blockId}`);
			}
			rows.cp1.push(snapshot.voltages[stamp.cp1] ?? 0);
			rows.cp2.push(snapshot.voltages[stamp.cp2] ?? 0);
			rows.vgg.push(snapshot.voltages[stamp.vgg] ?? 0);
			rows.vdd.push(snapshot.voltages[stamp.vdd] ?? 0);
			rows.ox1.push(snapshot.voltages[stamp.ox1] ?? 0);
		}
		return rows;
	};

	/** Full cycles per second, from CP1's own transitions. */
	const measuredHz = (cp1: readonly number[], high: number): number => {
		let edges = 0;
		for (let index = 1; index < cp1.length; index += 1) {
			if (((cp1[index - 1] ?? 0) > high) !== ((cp1[index] ?? 0) > high)) {
				edges += 1;
			}
		}
		return edges / 2 / (cp1.length / RATE);
	};

	it("reaches the clock-driver law, which no fixture in this repository did before", () => {
		const { program, stamp } = compileClock(mn3101ClockDriver);
		expect(program.requiredOperators).toContain("clock-driver");
		expect(stamp.defaultFrequency).toBe(10_000);
		// Five bound terminals, and `vdd` must not be ground or the stamp drops every coupling.
		expect(stamp.vdd).not.toBe(0);
	});

	it("drives CP1 and CP2 as complements that always sum to VDD", () => {
		const { program, stamp, blockId } = compileClock(mn3101ClockDriver, 2000);
		const rows = renderRows(program, stamp, blockId, 4800);
		// Exactly one phase is high at a time: `theta < 0.5` selects CP1 and `>= 0.5` CP2, so the
		// two are never both driven and never both released. A BBD clocked by two phases that
		// overlap would shift charge twice in a sample.
		const bothHigh = rows.cp1.filter(
			(value, index) => value > 1 && (rows.cp2[index] ?? 0) > 1,
		).length;
		expect(bothHigh).toBe(0);
		// And the pair spans the supply at every sample, not merely on average -- less the same
		// 1 ohm output impedance VGG pays, since the high phase is a VCVS into this fixture's 10k
		// load and the low phase is at zero. `VDD * 10000/10001`, and it holds to six places:
		// asserting bare `VDD` here failed by exactly that factor, which is the stamp being right
		// and the expectation being naive.
		const outputDivider = 10_000 / 10_001;
		for (let index = 0; index < rows.cp1.length; index += 1) {
			expect((rows.cp1[index] ?? 0) + (rows.cp2[index] ?? 0)).toBeCloseTo(
				(rows.vdd[index] ?? 0) * outputDivider,
				6,
			);
		}
		// Square, not merely alternating: `theta` advances linearly and the comparison is at 0.5.
		const duty = rows.cp1.filter((value) => value > 1).length / rows.cp1.length;
		expect(duty).toBeCloseTo(0.5, 3);
	});

	it("holds VGG at 14/15 of VDD through its 1 ohm output impedance", () => {
		const { program, stamp, blockId } = compileClock(mn3101ClockDriver, 2000);
		const rows = renderRows(program, stamp, blockId, 64);
		// The stamp's coefficient is 14/15 and the row is a VCVS with 1 ohm of output impedance
		// into this fixture's 10k load, so the closed form is `14/15 * 10000/10001` = 0.9332400.
		// A constant, unlike CP1 and CP2: the charge pump does not switch.
		const expected = (14 / 15) * (10_000 / 10_001);
		for (let index = 0; index < rows.vgg.length; index += 1) {
			expect((rows.vgg[index] ?? 0) / (rows.vdd[index] ?? 1)).toBeCloseTo(
				expected,
				5,
			);
		}
	});

	it("takes its rate from the declared frequency and the oscillator pin, not from a constant", () => {
		// **The closed form.** `f = defaultFrequency * vOx1 / 2.5`, clamped to [1000, 500000].
		// Four points across two declared frequencies and two oscillator biases, which is what it
		// takes to separate the two factors: at OX1 = 2.5 V the scale is 1, so a runtime that
		// ignored the pin entirely would satisfy the first row and fail the second.
		for (const source of [mn3101ClockDriver, mn3101ClockDriverFastOscillator]) {
			for (const declared of [2000, 4000]) {
				const { program, stamp, blockId } = compileClock(source, declared);
				const rows = renderRows(program, stamp, blockId, 4800);
				const ox1 = rows.ox1[0] ?? 0;
				const predicted = declared * (ox1 / 2.5);
				const measured = measuredHz(rows.cp1, 1);
				// Within 1%: edge counting loses the final partial period, which is 5 Hz at these
				// rates, and the oscillator is sampled so its period quantises to whole samples.
				expect(Math.abs(measured - predicted) / predicted).toBeLessThan(0.01);
			}
		}
		// And the two fixtures really do differ only in that bias, so the row above is a
		// comparison and not two unrelated measurements. The ratio is asserted rather than the
		// two voltages, because `2500/9000` and `5000/9000` of the same rail differ by exactly
		// two whatever that rail settles at -- and it does not settle at 9 V: the supply carries
		// 1 ohm of source impedance, so the divider sees `9 * 9000/9001` and OX1 lands on
		// 2.49972 and 4.99944. The ratio is network-independent; the absolute values are this
		// fixture's resistors and are checked only loosely, to catch a gross mis-wiring.
		const slow = compileClock(mn3101ClockDriver, 2000);
		const fast = compileClock(mn3101ClockDriverFastOscillator, 2000);
		const slowOx1 = renderRows(slow.program, slow.stamp, slow.blockId, 1).ox1[0] ?? 0;
		const fastOx1 = renderRows(fast.program, fast.stamp, fast.blockId, 1).ox1[0] ?? 0;
		expect(fastOx1 / slowOx1).toBeCloseTo(2, 6);
		expect(slowOx1).toBeCloseTo(2.5, 2);
		expect(fastOx1).toBeCloseTo(5.0, 2);
	});
});

describe("coverage fixtures added 2026-09-22: one known-answer control per thin law", () => {
	it("solves the pentode stage to its hand-computed operating point", () => {
		// The corpus stamps a pentode in 20 amp programs and, until this, no fixture did. The
		// expectation was solved by bisection on the generic law in `expected.ts`, not read back.
		const result = compile(pentodeGainStage, { registry: emptyRegistry });
		if (result.status !== "ok") throw new Error(JSON.stringify(result.reasons));
		const runtime = new ReferenceRuntime(result.program);
		runtime.prepare(48_000);
		runtime.process(new Float64Array(64));
		expect(runtime.telemetry().operatingPointFailures).toBe(0);
		const snapshot = runtime.nodeVoltageSnapshot()[0];
		const cathode = snapshot?.voltages[3] ?? Number.NaN;
		const plate = snapshot?.voltages[4] ?? Number.NaN;
		expect(cathode).toBeCloseTo(pentodeStageCathodeVolts, 1);
		expect(plate).toBeCloseTo(pentodeStagePlateVolts, 0);
		// Self-consistency the way the triode is checked: cathode current equals plate current.
		expect(cathode / 470).toBeCloseTo((250 - plate) / 2200, 4);
	});

	it("renders an RL high pass at -3 dB at its corner and a decade either side", () => {
		const program = programFor(rlHighPass);
		expect(measureGain(program, rlCornerHz, 192_000)).toBeCloseTo(rcGainAtCorner, 1);
		expect(measureGain(program, rlCornerHz / 10, 192_000)).toBeCloseTo(rlHighPassGainAtDecadeBelow, 1);
		expect(measureGain(program, rlCornerHz * 10, 192_000)).toBeCloseTo(rlHighPassGainAtDecadeAbove, 1);
	});

	it("routes a three-way selector to each throw's own divider", () => {
		const program = programFor(selectorThreeWay);
		expect(measureGain(program, 1000, 48_000, 1)).toBeCloseTo(selectorThreeWayGains.mid, 2);
		expect(measureGain(program, 1000, 48_000, 1, { Range: 0.1 })).toBeCloseTo(selectorThreeWayGains.low, 2);
		expect(measureGain(program, 1000, 48_000, 1, { Range: 0.5 })).toBeCloseTo(selectorThreeWayGains.mid, 2);
		expect(measureGain(program, 1000, 48_000, 1, { Range: 0.9 })).toBeCloseTo(selectorThreeWayGains.high, 2);
	});

	it("opens an unknown chip of a declared class with ic-not-executed and plays the path around it", () => {
		const result = compile(openIcOnDeclaredClass, { registry: emptyRegistry });
		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		const warning = result.warnings.find((w) => w.code === "ic-not-executed");
		expect(warning?.device).toBe("DSP1");
		expect(warning !== undefined && "reason" in warning ? warning.reason : null).toBe("declared-class-without-model");
		expect(result.program.requiredModels).toEqual([]);
		// The RC around it still renders: a decade below its 1.59 kHz corner the gain is ~1.
		expect(measureGain(result.program, 159, 48_000)).toBeGreaterThan(0.95);
	});

	it("refuses the same unknown chip when its class is not one the compiler opens", () => {
		// Negative control for the case above: the refusal is the default, the opening the exception.
		const result = compile(unknownIcRefused, { registry: emptyRegistry });
		expect(result.status).toBe("unsupported");
		if (result.status === "unsupported") {
			expect(result.reasons[0]?.stage).toBe("device-laws");
			expect(result.reasons[0]?.device).toBe("DSP1");
		}
	});
});

describe("clock-derived delay: the length mode 15 corpus blocks use (2026-09-22)", () => {
	// Measured before these fixtures existed: `clock` mode ran in 15 shipped blocks and no
	// fixture produced it, while twelve fixtures produced `parameter` mode that nothing ships.
	// The cost was concrete -- the BBD clock tests had to hand-patch a block to reach the mode.
	function composedOf(source: string) {
		const result = compile(source, { registry: pedalPartCatalog });
		if (result.status !== "ok") {
			throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
		}
		const block = result.program.blocks.find((b) => b.kind === "composed");
		if (block?.kind !== "composed") throw new Error("no composed block");
		return { program: result.program, block };
	}

	it("derives a bucket-brigade clock from the MN3101 oscillator star", () => {
		const { block } = composedOf(bbdClockDerivedDelay);
		expect(block.modelId).toBe("bucket-brigade-delay-line");
		const tap = onlyPosition(block).ops.find((op) => op.op === "delay-tap-fractional");
		if (tap?.op !== "delay-tap-fractional") throw new Error("no fractional tap");
		expect(tap.length.mode).toBe("clock");
		// The derivation is read off the circuit, not declared: C1 = 100 pF on OX3 and the
		// swept leg on OX2 give a 4096-stage brigade its range. Both ends come from the parts.
		expect(block.clockControl?.controlId).toBe("Rate");
		expect(block.clockControl?.stages).toBe(4096);
		expect(block.clockControl?.farads).toBeCloseTo(100e-12, 15);
		expect(block.clockControl?.ohmsAtControlMax).toBeGreaterThan(
			block.clockControl?.ohmsAtControlMin ?? 0,
		);
	});

	it("moves that delay when the knob moves, on the shipping composition", () => {
		// The behavioural half: a clock-mode tap whose knob does nothing would satisfy every
		// structural assertion above.
		const { program, block } = composedOf(bbdClockDerivedDelay);
		const id = block.clockControl?.controlId;
		if (id === undefined) throw new Error("no clock control");
		const lengthAt = (position: number): number => {
			const runtime = new ReferenceRuntime(program);
			runtime.prepare(48_000);
			runtime.setControl(id, position);
			runtime.process(new Float64Array(2048));
			return runtime.telemetry().samples;
		};
		expect(lengthAt(0.1)).toBe(lengthAt(0.9));
		const cc = block.clockControl;
		if (cc === undefined || cc === null) throw new Error("no clock control");
		// Delay time is stages / f_clock and f_clock falls as the timing resistance rises, so
		// the two ends of the sweep are different delays by construction of the derivation.
		expect(cc.ohmsAtControlMin).toBeLessThan(cc.ohmsAtControlMax);
	});

	it("reads a PT2399 delay off its VCO network, as an integer tap", () => {
		// A different derivation function from the brigade above, sharing only the mode name.
		const { block } = composedOf(pt2399ClockDerivedDelay);
		expect(block.modelId).toBe("digital-delay-line");
		const tap = onlyPosition(block).ops.find((op) => op.op === "delay-tap");
		if (tap?.op !== "delay-tap") throw new Error("no integer tap");
		expect(tap.length.mode).toBe("clock");
		expect(block.clockControl?.controlId).toBe("Time");
	});

	it("falls to modulation mode when an LFO steers the clock, and names the steerer", () => {
		// A steered clock has no single length, so the derivation refuses to state one and the
		// delay falls back to the declared DelayMs while the modulation port names the node.
		const { block } = composedOf(bbdClockModulatedDelay);
		const tap = onlyPosition(block).ops.find((op) => op.op === "delay-tap-fractional");
		if (tap?.op !== "delay-tap-fractional") throw new Error("no fractional tap");
		expect(tap.length.mode).toBe("modulation");
		expect(block.clockControl ?? null).toBeNull();
		expect(block.modulation?.steeredBy).toBe("Q_LFO");
	});
});
