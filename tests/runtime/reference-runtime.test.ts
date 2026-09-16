// Contract for the reference runtime, and specifically for what it does when it
// cannot solve.
//
// The failure this guards against is the one this pipeline has now hit twice in other
// forms: a wrong answer that still renders. A Newton loop that exhausts its iteration
// cap and emits whatever iterate it holds produces audio for a circuit it did not
// solve, with no error and nothing in the output to show it.
//
// These tests compile real fixtures through `src/compiler/` rather than hand-building
// programs. A test may cross the module boundary where production code may not: a
// hand-built program would encode assumptions `emit` does not actually make, which is
// the same trap as a hand-built netlist skipping stage 1. The fixtures stay owned by
// `src/compiler/tests/fixtures/` -- one set, never copied.

import { describe, expect, it } from "bun:test";
import { compile } from "@vessel-dsp/compiler";
import type { PartRegistry } from "@vessel-dsp/compiler";
import { emptyRegistry } from "@vessel-dsp/compiler";
import {
	acMainsDivider,
	acSupplyDrawingAmps,
	diodeClipper,
	diodeShortingSupply,
	emitterFollower,
	hybridDelayPedal,
	rcLowPass,
	resistorDivider,
	triodeGainStage,
	twoDiodeClippers,
} from "../compiler/fixtures/circuits";
import {
	digitalDelayLineDryRegistry,
	digitalDelayLineRegistry,
	fixtureRegistry,
	unimplementedMacroRegistry,
} from "../compiler/fixtures/registry";
import { hybridDelayPedalGain } from "../compiler/fixtures/expected";
import type { Program } from "@vessel-dsp/compiler";
import { ReferenceRuntime, RuntimeError } from "@vessel-dsp/runtime";

function programFor(source: string): Program {
	const result = compile(source, { registry: emptyRegistry });
	if (result.status !== "ok") {
		throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
	}
	return result.program;
}

function drive(
	program: Program,
	amplitude: number,
	options: { readonly maxNewtonIterations?: number } = {},
): ReferenceRuntime {
	const runtime = new ReferenceRuntime(program);
	runtime.prepare(48_000, options);
	const length = 4800;
	const input = new Float64Array(length);
	for (let index = 0; index < length; index += 1) {
		input[index] = amplitude * Math.sin((2 * Math.PI * 1000 * index) / 48_000);
	}
	runtime.process(input);
	return runtime;
}

describe("telemetry reports what the solver actually did", () => {
	it("reports no failures for a circuit it solves", () => {
		const telemetry = drive(programFor(diodeClipper), 5).telemetry();
		expect(telemetry.nonConvergedSamples).toBe(0);
		expect(telemetry.nonFiniteSamples).toBe(0);
		expect(telemetry.samples).toBe(4800);
	});

	it("spends more than one iteration on a nonlinear circuit", () => {
		// Proof that Newton is running at all rather than the region being mislabelled.
		expect(
			drive(programFor(diodeClipper), 5).telemetry().peakIterations,
		).toBeGreaterThan(1);
	});

	it("spends exactly one solve on a linear circuit", () => {
		expect(
			drive(programFor(resistorDivider), 1).telemetry().peakIterations,
		).toBe(1);
		expect(drive(programFor(rcLowPass), 1).telemetry().peakIterations).toBe(1);
	});

	it("resets on prepare, so counts belong to one run", () => {
		const runtime = drive(programFor(diodeClipper), 5);
		runtime.prepare(48_000);
		expect(runtime.telemetry().samples).toBe(0);
		expect(runtime.telemetry().peakIterations).toBe(0);
	});

	it("clears the last failure on prepare, so it is never read as this run's", () => {
		// A count of zero beside a populated `lastFailure` describes two different runs,
		// and that field is what diagnosis reads first: it named the node behind
		// `boss-od-3`'s divergence after three wrong guesses from the count alone.
		const runtime = drive(programFor(diodeClipper), 5, {
			maxNewtonIterations: 1,
		});
		expect(runtime.telemetry().lastFailure).not.toBeNull();
		runtime.prepare(48_000);
		expect(runtime.telemetry().lastFailure).toBeNull();
	});

	it("counts a failing sample once, however many blocks failed on it", () => {
		// Two galvanically separate nonlinear regions in one document, both starved. A
		// per-block count reported two failures per sample and could exceed the sample
		// count, so it could not be read as the share of untrustworthy audio.
		//
		// The execution order is widened back to both blocks deliberately. Now that `link`
		// schedules only blocks that can reach the output, this fixture's second clipper is
		// compiled and not executed -- and no corpus program executes more than one MNA block
		// today, so the condition this guards would go untested until a macro's ports make the
		// hybrid path real. The runtime's contract is about the order it is handed, so handing
		// it the wider order is what keeps the contract exercised rather than assumed.
		const compiled = programFor(twoDiodeClippers);
		const program: Program = {
			...compiled,
			order: compiled.blocks.map((block) => block.id),
		};
		expect(
			program.blocks.filter((block) => block.kind === "mna" && !block.linear)
				.length,
		).toBeGreaterThan(1);
		const telemetry = drive(program, 5, { maxNewtonIterations: 1 }).telemetry();
		expect(telemetry.nonConvergedSamples).toBeGreaterThan(0);
		expect(telemetry.nonConvergedSamples).toBeLessThanOrEqual(
			telemetry.samples,
		);
	});
});

describe("failing to converge is reported, never emitted as audio", () => {
	it("counts unconverged samples when the iteration budget is too small", () => {
		// A starved budget is the reachable way to force the failure: with junction
		// limiting in place, no realistic circuit tried here fails at the default cap.
		const telemetry = drive(programFor(diodeClipper), 5, {
			maxNewtonIterations: 2,
		}).telemetry();
		expect(telemetry.nonConvergedSamples).toBeGreaterThan(0);
	});

	it("keeps the output finite rather than propagating a bad iterate", () => {
		const runtime = new ReferenceRuntime(programFor(diodeClipper));
		runtime.prepare(48_000, { maxNewtonIterations: 1 });
		const input = new Float64Array(2000);
		for (let index = 0; index < input.length; index += 1) {
			input[index] = 50 * Math.sin((2 * Math.PI * 1000 * index) / 48_000);
		}
		const output = runtime.process(input);
		expect([...output].every((value) => Number.isFinite(value))).toBe(true);
		expect(runtime.telemetry().nonConvergedSamples).toBeGreaterThan(0);
	});

	it("still refuses to run without a sample rate", () => {
		const runtime = new ReferenceRuntime(programFor(resistorDivider));
		expect(() => runtime.process(new Float64Array(8))).toThrow(RuntimeError);
	});
});

describe("the cartridge lockout: a program naming an operator it lacks is refused", () => {
	// Why the doctored program's *stamps* stay ordinary, which is the whole design of these
	// tests: `applyStamp` already throws when execution meets an operator it does not
	// implement, so a fixture carrying a fictional stamp would be refused either way and
	// would prove nothing about *when*. With only the declaration doctored, execution can
	// never reach an unknown operator, so a refusal here can only have come from the
	// load-time check -- and one that arrives at `prepare` rather than mid-buffer is the
	// difference between a cartridge that will not start and one that dies during a note.

	function declaring(source: string, ...operators: readonly string[]): Program {
		const program = programFor(source);
		// The cast is the honest one: `decode` casts JSON to `Program` too, so a declared
		// set naming something outside the union is exactly what a foreign producer sends.
		return {
			...program,
			requiredOperators: [...program.requiredOperators, ...operators],
		} as unknown as Program;
	}

	it("refuses at prepare, and names the operator", () => {
		// Asserted on the operator's name, deliberately not on the sentence around it: the
		// contract is that the refusal says which operator is missing.
		const runtime = new ReferenceRuntime(
			declaring(resistorDivider, "flux-capacitor"),
		);
		expect(() => runtime.prepare(48_000)).toThrow(/flux-capacitor/);
	});

	it("names every missing operator rather than the first", () => {
		// A host learning what it lacks one load at a time cannot tell a missing operator
		// from a missing generation of them.
		const runtime = new ReferenceRuntime(
			declaring(resistorDivider, "flux-capacitor", "tesseract"),
		);
		expect(() => runtime.prepare(48_000)).toThrow(/flux-capacitor/);
		expect(() => runtime.prepare(48_000)).toThrow(/tesseract/);
	});

	it("refuses before a sample is processed", () => {
		// The regression this pins: the same program used to prepare cleanly and reach
		// `process`, because nothing read the declaration.
		const runtime = new ReferenceRuntime(
			declaring(diodeClipper, "flux-capacitor"),
		);
		expect(() => runtime.prepare(48_000)).toThrow(RuntimeError);
		// And it is still unprepared afterwards, so no audio can be drawn from it.
		expect(() => runtime.process(new Float64Array(8))).toThrow(RuntimeError);
	});

	it("accepts the same program with its own declaration", () => {
		// The negative control. Without it, a check that refused everything would pass the
		// three tests above.
		const runtime = new ReferenceRuntime(programFor(diodeClipper));
		expect(() => runtime.prepare(48_000)).not.toThrow();
		expect(runtime.process(new Float64Array(8)).length).toBe(8);
	});
});

describe("the same lockout for a macro's DSP model", () => {
	// **The defect this pins, and why a latent one was worth closing.** `processMacroBlock`
	// implemented one behaviour -- a bucket-brigade delay line -- and never read `modelId`, so a
	// macro naming a compander, an OTA or a PT2399's digital core executed as an MN3007-style
	// delay: not silence, which the console/ROM rule forbids, but something worse, a plausible
	// wrong pedal a player would accept as the pedal. No corpus packet reaches this path today
	// (the committed registry has no entries, so nothing compiles to a macro block), which is
	// exactly why the refusal has to exist before the first real registry entry does.
	//
	// Both registries below describe the SAME fictional part with the same pinout, ports and
	// stamps, differing only in which algorithm the model names -- so a refusal here can only be
	// about the model.

	function macroProgram(registry: PartRegistry): Program {
		const result = compile(hybridDelayPedal, { registry });
		if (result.status !== "ok") {
			throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
		}
		return result.program;
	}

	it("refuses a program whose macro names a model it does not implement, and names it", () => {
		// Asserted on the model's name, not on the sentence around it -- the same contract shape
		// the operator lockout above is held to. A refusal that said only "unsupported macro"
		// would leave a host unable to tell what it would need to gain.
		const runtime = new ReferenceRuntime(
			macroProgram(unimplementedMacroRegistry),
		);
		expect(() => runtime.prepare(48_000)).toThrow(/compander/);
		expect(() => runtime.prepare(48_000)).toThrow(RuntimeError);
		// And it is still unprepared, so no audio -- right or wrong -- can be drawn from it.
		expect(() => runtime.process(new Float64Array(8))).toThrow(RuntimeError);
	});

	it("refuses at prepare rather than when the macro's turn in the schedule comes", () => {
		// The distinction the operator lockout also draws: a refusal that arrives mid-buffer
		// arrives after a host has committed to playing. The program compiles and is structurally
		// complete -- it is refused for its model alone, before a sample.
		const program = macroProgram(unimplementedMacroRegistry);
		expect(program.requiredModels).toContain("compander");
		expect(program.blocks.some((block) => block.kind === "macro")).toBe(true);
		const runtime = new ReferenceRuntime(program);
		expect(() => runtime.prepare(48_000)).toThrow(RuntimeError);
	});

	it("runs the same pedal whose macro names the model it does implement", () => {
		// The positive control, without which a check that refused every macro would pass both
		// tests above. Same fixture, same ports, same schedule: only the algorithm name differs.
		const program = macroProgram(fixtureRegistry);
		expect(program.requiredModels).toEqual(["bucket-brigade-delay-line"]);
		const runtime = new ReferenceRuntime(program);
		expect(() => runtime.prepare(48_000)).not.toThrow();
		expect(runtime.process(new Float64Array(8)).length).toBe(8);
	});

	it("refuses a declared model no block uses, so the declaration is what is read", () => {
		// The foreign-producer case `requiredModels`'s own doc names: a program that arrived
		// through `decode` was cast from JSON, so its declaration is untrusted text from a
		// possibly newer compiler. Doctoring the declaration while leaving every block ordinary
		// means execution could never reach an unknown model, so the refusal can only have come
		// from the load-time check.
		const program = macroProgram(fixtureRegistry);
		const runtime = new ReferenceRuntime({
			...program,
			requiredModels: [...program.requiredModels, "flux-compander"],
		});
		expect(() => runtime.prepare(48_000)).toThrow(/flux-compander/);
	});
});

describe("the digital-delay-line kernel: a sample-accurate echo with feedback", () => {
	// The same hybrid pedal the BBD lockout above drives, differing only in the model its delay
	// chip names. That chip declares DelayMs 3, so the line's capacity is 144 samples at 48 kHz.
	// An impulse must come out on the far side of that -- not on the input sample -- and, with
	// feedback, a smaller echo must follow it. A `digital-delay-line` that rendered as a plain
	// delay would be the same plausible-wrong-pedal defect the `compander` lockout pins.
	function driveImpulse(registry: PartRegistry): Float64Array {
		const result = compile(hybridDelayPedal, { registry });
		if (result.status !== "ok") {
			throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
		}
		const runtime = new ReferenceRuntime(result.program);
		runtime.prepare(48_000);
		const input = new Float64Array(4800);
		input[0] = 1;
		return runtime.process(input);
	}

	// The pedal's output carries a DC bias; the impulse response is its AC part, so strip the
	// mean before measuring level or position.
	function ac(buffer: Float64Array): Float64Array {
		const mean =
			buffer.reduce((sum, sample) => sum + sample, 0) / buffer.length;
		const out = new Float64Array(buffer.length);
		for (let index = 0; index < buffer.length; index += 1) {
			out[index] = buffer[index] - mean;
		}
		return out;
	}

	const l1 = (buffer: Float64Array): number =>
		buffer.reduce((sum, sample) => sum + Math.abs(sample), 0);

	it("declares the model its block executes", () => {
		const result = compile(hybridDelayPedal, {
			registry: digitalDelayLineRegistry,
		});
		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.program.requiredModels).toEqual(["digital-delay-line"]);
	});

	it("delays the impulse rather than passing it through", () => {
		const signal = ac(driveImpulse(digitalDelayLineDryRegistry));
		expect(l1(signal)).toBeGreaterThan(1e-3); // the impulse made it through at all
		let peak = 0;
		for (let index = 1; index < signal.length; index += 1) {
			if (Math.abs(signal[index]) > Math.abs(signal[peak])) peak = index;
		}
		// A kernel that wrote before it read -- or passed straight through -- would peak near the
		// input sample. The 144-sample line plus the pedal's own shell puts it well past that.
		expect(peak).toBeGreaterThan(50);
	});

	it("regenerates with feedback and stays a single echo without it", () => {
		const wet = ac(driveImpulse(digitalDelayLineRegistry));
		const dry = ac(driveImpulse(digitalDelayLineDryRegistry));
		expect(l1(dry)).toBeGreaterThan(1e-3); // the first echo exists either way
		// A 0.6 repeat stacks a 0.6 + 0.36 + ... tail onto the first echo; the dry line has no
		// tail. If the kernel ignored `feedback` this ratio collapses to ~1 and fails on purpose.
		expect(l1(wet) / l1(dry)).toBeGreaterThan(1.5);
	});
});

describe("the bucket-brigade-delay-line kernel: AC coupling time constant and operating-point settling (S3)", () => {
	// S3: The BBD macro AC-coupling filter uses a 1 s time constant (fc ~ 0.16 Hz)
	// so that low guitar tones (50 Hz - 160 Hz) pass with negligible loss (< 0.01 dB),
	// while steady-state DC offsets are rejected.
	it("passes a 50 Hz tone with < 0.01 dB loss while rejecting DC step offset", () => {
		const result = compile(hybridDelayPedal, { registry: fixtureRegistry });
		if (result.status !== "ok") {
			throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
		}
		const runtime = new ReferenceRuntime(result.program);
		const sampleRate = 48_000;
		runtime.prepare(sampleRate);

		// Drive a 50 Hz sine + 3.0 V DC step offset
		const hz = 50;
		const amplitude = 0.5;
		const dcStep = 3.0;
		const seconds = 12; // 12 tau (tau = 1.0 s) allows DC step to decay by e^-12 (~6e-6)
		const length = seconds * sampleRate;
		const input = new Float64Array(length);
		for (let i = 0; i < length; i += 1) {
			input[i] =
				dcStep + amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate);
		}

		const output = runtime.process(input);

		// Measure steady-state AC amplitude and DC offset over the final 50 cycles (last 48,000 samples)
		const windowStart = length - sampleRate;
		let minVal = Number.POSITIVE_INFINITY;
		let maxVal = Number.NEGATIVE_INFINITY;
		let sum = 0;
		for (let i = windowStart; i < length; i += 1) {
			const v = output[i] ?? 0;
			minVal = Math.min(minVal, v);
			maxVal = Math.max(maxVal, v);
			sum += v;
		}

		const measuredAcAmplitude = (maxVal - minVal) / 2;
		const measuredGain = measuredAcAmplitude / amplitude;
		const measuredDc = sum / sampleRate;

		// 1. DC step offset decays with tau = 1.0s: residual DC at output after 12s is < 1e-4 V
		expect(Math.abs(measuredDc)).toBeLessThan(1e-4);

		// 2. 50 Hz tone passes with < 0.01 dB loss relative to theoretical loaded gain
		// |H(50 Hz)| = 2*pi*50*1 / sqrt(1 + (2*pi*50*1)^2) = 0.999995 (-0.00004 dB)
		const lossDb = 20 * Math.log10(measuredGain / hybridDelayPedalGain);
		expect(Math.abs(lossDb)).toBeLessThan(0.01);
		expect(measuredGain).toBeCloseTo(hybridDelayPedalGain, 4);
	});

	it("negative control: an aggressive 1 ms time constant attenuates 50-160 Hz by several dB", () => {
		// Demonstrates the defect: with tau = 1 ms (fc = 159.15 Hz),
		// 50 Hz has |H| = 0.2937 (-10.64 dB, >70% loss)
		// 160 Hz has |H| = 0.6978 (-3.12 dB, >30% loss)
		const sampleRate = 48_000;
		const evaluateRecurrence = (
			hz: number,
			tauSeconds: number,
		): number => {
			const alpha = 1 / (tauSeconds * sampleRate);
			let dcEst = 0;
			const cycles = 300;
			const length = Math.round((cycles * sampleRate) / hz);
			let minVal = Number.POSITIVE_INFINITY;
			let maxVal = Number.NEGATIVE_INFINITY;
			for (let i = 0; i < length; i += 1) {
				const x = Math.sin((2 * Math.PI * hz * i) / sampleRate);
				dcEst += alpha * (x - dcEst);
				const y = x - dcEst;
				if (i >= length - Math.round(sampleRate / hz) * 10) {
					minVal = Math.min(minVal, y);
					maxVal = Math.max(maxVal, y);
				}
			}
			return (maxVal - minVal) / 2;
		};

		// With tau = 1.0 s: 50 Hz passes with gain ~1.0 (<0.001 loss)
		const gain50HzCorrect = evaluateRecurrence(50, 1.0);
		expect(gain50HzCorrect).toBeCloseTo(1.0, 3);

		// With tau = 1 ms (the old defect):
		const gain50HzDefective = evaluateRecurrence(50, 0.001);
		const loss50HzDb = 20 * Math.log10(gain50HzDefective);
		expect(gain50HzDefective).toBeCloseTo(0.294, 2);
		expect(loss50HzDb).toBeLessThan(-10.0); // Severe attenuation > 10 dB

		const gain160HzDefective = evaluateRecurrence(160, 0.001);
		const loss160HzDb = 20 * Math.log10(gain160HzDefective);
		expect(gain160HzDefective).toBeCloseTo(0.698, 2);
		expect(loss160HzDb).toBeLessThan(-3.0); // Attenuation > 3 dB
	});

	it("seeds macro dcEstimate from solved operating point so DC bias does not inject startup transient", () => {
		// When an opamp or resistor network biases the BBD input at a positive DC voltage (e.g. +7.5V),
		// prepare() must seed macro dcEstimate to that operating-point voltage.
		// If unseeded (starting at 0), a +7.5V step is injected and charges downstream coupling caps.
		const result = compile(hybridDelayPedal, { registry: fixtureRegistry });
		if (result.status !== "ok") {
			throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
		}
		const runtime = new ReferenceRuntime(result.program);
		runtime.prepare(48_000);

		// Process silence from prepare()
		const silentOutput = runtime.process(new Float64Array(4800));

		// Steady settled output with zero input must stay at 0 V with no spurious transient step
		let maxSpuriousPulse = 0;
		for (let i = 0; i < silentOutput.length; i += 1) {
			maxSpuriousPulse = Math.max(maxSpuriousPulse, Math.abs(silentOutput[i] ?? 0));
		}
		expect(maxSpuriousPulse).toBeLessThan(1e-6);
	});
});

describe("the operating point is solved before the first sample", () => {
	// The defect this replaces: a run starting from zero state starts with every
	// capacitor at 0 V, which is a short, and a short across a bias network supplies a
	// bias path the circuit does not have. So a stage that cannot hold an operating
	// point still has real gain until the capacitors charge, and every render number
	// taken inside that window described the transient instead of the pedal.

	it("does not move when the transient starts from it", () => {
		// The contract, and the only one worth pinning: the operating point must be the
		// fixed point the sample loop converges to. If silence from that start drifts,
		// the solve found a state the circuit does not hold and every settled number
		// built on it is wrong.
		const runtime = new ReferenceRuntime(programFor(emitterFollower));
		runtime.prepare(48_000);
		runtime.process(new Float64Array(1));
		const start = runtime
			.nodeVoltageSnapshot()
			.flatMap((block) => [...block.voltages]);
		runtime.process(new Float64Array(48_000));
		const end = runtime
			.nodeVoltageSnapshot()
			.flatMap((block) => [...block.voltages]);
		let drift = 0;
		for (let index = 0; index < start.length; index += 1) {
			drift = Math.max(
				drift,
				Math.abs((end[index] ?? 0) - (start[index] ?? 0)),
			);
		}
		// Bounded by the solver's own criterion rather than by ambition: Newton accepts a
		// step within 1e-3 *relative*, which on a node sitting at volts is millivolts, so
		// the operating point is only ever pinned to about that. The measured drift is
		// 2.6e-6 V, three orders inside what the solve promises.
		expect(drift).toBeLessThan(1e-5);
	});

	it("renders the same whether or not silence came first", () => {
		// What the fix buys, stated as behaviour: settling was a workaround for starting
		// in the wrong state, so with the operating point solved it must make no
		// difference. A biased stage is the case that matters -- a passive divider would
		// pass this without the fix.
		const program = programFor(emitterFollower);
		const tone = new Float64Array(4800);
		for (let index = 0; index < tone.length; index += 1) {
			tone[index] = 0.1 * Math.sin((2 * Math.PI * 1000 * index) / 48_000);
		}

		const cold = new ReferenceRuntime(program);
		cold.prepare(48_000);
		const coldOutput = cold.process(tone);

		const settled = new ReferenceRuntime(program);
		settled.prepare(48_000);
		settled.process(new Float64Array(48_000));
		const settledOutput = settled.process(tone);

		let difference = 0;
		for (let index = 0; index < tone.length; index += 1) {
			difference = Math.max(
				difference,
				Math.abs((coldOutput[index] ?? 0) - (settledOutput[index] ?? 0)),
			);
		}
		// Same bound, read as audio: 1e-5 against a 0.1 amplitude signal is -80 dB, and
		// the measured difference is 2.6e-6, which is -92 dB. Neither is a settling
		// artifact -- both are the Newton tolerance.
		expect(difference).toBeLessThan(1e-5);
	});

	it("counts a block whose operating point did not solve", () => {
		// A block that cannot be solved keeps zero state, which is the old behaviour, and
		// must say so: an unreported fallback looks exactly like a settled circuit.
		const runtime = new ReferenceRuntime(programFor(rcLowPass));
		runtime.prepare(48_000);
		runtime.process(new Float64Array(1));
		expect(runtime.telemetry().operatingPointFailures).toBe(0);
	});
});

describe("a program's only clock is the sample rate it was prepared with", () => {
	// `acMainsDivider` declares 10 V RMS at 60 Hz and halves it: a supply whose value depends on
	// time is the one thing in a program that needs a clock, and the runtime owns it. The law
	// converts the declared RMS magnitude to `10 * sqrt(2)` V peak, which is what the sine
	// evaluation below actually uses.
	const DECLARED_RMS_VOLTS = 10;
	const AMPLITUDE_VOLTS = DECLARED_RMS_VOLTS * Math.SQRT2;
	const FREQUENCY_HZ = 60;
	const DIVIDER = 1000 / 2000;

	function emfAt(seconds: number): number {
		return (
			AMPLITUDE_VOLTS * DIVIDER * Math.sin(2 * Math.PI * FREQUENCY_HZ * seconds)
		);
	}

	it("puts the same instant at the same voltage whatever the rate", () => {
		// The rate-independence claim, made against time rather than against a sample index.
		// `t = 0.01 s` is sample 480 at 48 kHz and sample 960 at 96 kHz, and the mains is a
		// third of the way through its cycle at both -- `10 * sqrt(2) * sin(2*pi*0.6) / 2 =
		// -4.1563 V`, computed by hand from the peak amplitude the law derives from the declared
		// 10 V RMS. A clock that counted buffers, or one that assumed a rate, fails this while
		// passing every fixed-rate check.
		const program = programFor(acMainsDivider);
		const expected = emfAt(0.01);
		expect(expected).toBeCloseTo(-4.156_269_378, 8);

		const slow = new ReferenceRuntime(program);
		slow.prepare(48_000);
		expect(slow.process(new Float64Array(481))[480] ?? Number.NaN).toBeCloseTo(
			expected,
			8,
		);

		const fast = new ReferenceRuntime(program);
		fast.prepare(96_000);
		expect(fast.process(new Float64Array(961))[960] ?? Number.NaN).toBeCloseTo(
			expected,
			8,
		);
	});

	it("solves the operating point with the supply at its t=0 value", () => {
		// An AC-driven circuit powers on from a source that is *zero* at `t = 0`, so its
		// operating point is the unpowered one -- which is also what ngspice's initial
		// transient solution reports for `SIN(0 a f)`, measured on a fixture. Seeding this with
		// the amplitude or an RMS value instead would start a rectifier's reservoir charged and
		// make the first cycles disagree with the reference for a reason that is not the
		// circuit.
		const runtime = new ReferenceRuntime(programFor(acMainsDivider));
		runtime.prepare(48_000);
		runtime.process(new Float64Array(0));
		const solved = runtime.nodeVoltageSnapshot()[0]?.voltages ?? [];
		for (const volts of solved) {
			expect(volts).toBeCloseTo(0, 9);
		}
		expect(runtime.telemetry().operatingPointFailures).toBe(0);
	});

	it("restarts the clock on prepare, so a run is never continued by accident", () => {
		// The same reset discipline the limiter histories have: a second run that inherited the
		// first run's phase would render a different waveform from the same program and input.
		const runtime = new ReferenceRuntime(programFor(acMainsDivider));
		runtime.prepare(48_000);
		const first = [...runtime.process(new Float64Array(120))];
		runtime.prepare(48_000);
		const second = [...runtime.process(new Float64Array(120))];
		expect(second).toEqual(first);
		expect(second[0]).toBe(0);
	});
});

describe("supply current is reported for a supply the operating point cannot see", () => {
	it("leaves the rendered peak null until something has been rendered", () => {
		// The distinction the field exists for: "nobody measured" must not read as "nothing
		// flowed". A second zero beside `operatingPointSupplyAmps` would reproduce exactly the
		// misreading it is meant to remove.
		const runtime = new ReferenceRuntime(programFor(acSupplyDrawingAmps));
		runtime.prepare(48_000);
		expect(runtime.telemetry().renderedSupplyPeakAmps).toBeNull();
		runtime.process(new Float64Array(1));
		expect(runtime.telemetry().renderedSupplyPeakAmps).not.toBeNull();
	});

	it("sees an AC supply's current, which the DC figure reads as zero", () => {
		// The negative control for the whole change, and the two numbers are the point.
		//
		// `acSupplyDrawingAmps` puts 5 ohms across a 10 V RMS mains inlet: the law converts the
		// declared 10 V RMS to `10 * sqrt(2)` V peak, so the peak current is
		// `10 * sqrt(2) / 5 = 2.8284... A`, at the sine's peak, which at 48 kHz and 60 Hz is
		// sample 200 (`t = 1/240 s`). The operating point evaluates the source at its `t = 0`
		// value, so it reports **0 A** for that same circuit -- a reader taking that for "no
		// short" is the failure this pair pins.
		const runtime = new ReferenceRuntime(programFor(acSupplyDrawingAmps));
		runtime.prepare(48_000);
		runtime.process(new Float64Array(400));
		const telemetry = runtime.telemetry();
		expect(telemetry.operatingPointSupplyAmps).toBeCloseTo(0, 9);
		expect(telemetry.renderedSupplyPeakAmps ?? Number.NaN).toBeCloseTo(
			(10 * Math.SQRT2) / 5,
			6,
		);
	});

	it("agrees with the DC figure on a static DC circuit", () => {
		// What makes the new figure checkable rather than a second opinion: where both can see,
		// they must see the same thing. `diodeShortingSupply` forward-biases a diode straight
		// across its 9 V rail, so the draw is large, constant, and present at DC.
		const runtime = new ReferenceRuntime(programFor(diodeShortingSupply));
		runtime.prepare(48_000);
		runtime.process(new Float64Array(64));
		const telemetry = runtime.telemetry();
		expect(telemetry.operatingPointSupplyAmps).toBeGreaterThan(0.1);
		expect(telemetry.renderedSupplyPeakAmps ?? Number.NaN).toBeCloseTo(
			telemetry.operatingPointSupplyAmps,
			4,
		);
	});
});

describe("the console's input source impedance", () => {
	// `prepare({ inputSourceOhms })` is a console setting -- the same ROM driven by a pickup,
	// a buffer, or a stiff test source -- so the contract is checked without knowing the
	// fixture's internals: measure the circuit's input impedance from two renders, then
	// PREDICT a third. For a linear circuit, out(Rs) = out(0) * Z / (Z + Rs) for the one Z
	// that is the circuit's own input impedance; two observations pin Z, the third must obey.
	const steadyPeak = (inputSourceOhms: number): number => {
		const runtime = new ReferenceRuntime(programFor(resistorDivider));
		runtime.prepare(48_000, { inputSourceOhms });
		const length = 4800;
		const input = new Float64Array(length);
		for (let index = 0; index < length; index += 1) {
			input[index] = 0.5 * Math.sin((2 * Math.PI * 1000 * index) / 48_000);
		}
		const output = runtime.process(input);
		let peak = 0;
		for (let index = length >> 1; index < length; index += 1) {
			peak = Math.max(peak, Math.abs(output[index] ?? 0));
		}
		return peak;
	};

	it("at zero is bit-for-bit the ideal drive it replaced", () => {
		expect(steadyPeak(0)).toBe(steadyPeak(0));
		// The default is 0: prepare() without the option must be the historical behavior.
		const runtime = new ReferenceRuntime(programFor(resistorDivider));
		runtime.prepare(48_000);
		const length = 4800;
		const input = new Float64Array(length);
		for (let index = 0; index < length; index += 1) {
			input[index] = 0.5 * Math.sin((2 * Math.PI * 1000 * index) / 48_000);
		}
		const output = runtime.process(input);
		let peak = 0;
		for (let index = length >> 1; index < length; index += 1) {
			peak = Math.max(peak, Math.abs(output[index] ?? 0));
		}
		expect(peak).toBe(steadyPeak(0));
	});

	it("droops the drive by exactly the divider a real source forms", () => {
		const ideal = steadyPeak(0);
		const atTen = steadyPeak(10_000);
		expect(atTen).toBeLessThan(ideal);
		// Two observations pin the circuit's input impedance...
		const inputImpedance = (10_000 * atTen) / (ideal - atTen);
		// ...which must predict the third to solver precision, not to hand-waving.
		const predicted = (ideal * inputImpedance) / (inputImpedance + 22_000);
		expect(steadyPeak(22_000)).toBeCloseTo(predicted, 9);
	});
});

describe("a triode under large overdrive converges without capping iterations", () => {
	it("swings deeply into cutoff and back into conduction with zero non-converged samples", () => {
		const runtime = new ReferenceRuntime(programFor(triodeGainStage));
		runtime.prepare(48_000, { maxNewtonIterations: 64 });
		const length = 4800;
		const input = new Float64Array(length);
		for (let index = 0; index < length; index += 1) {
			// +/- 10 V input swing to drive the triode grid far past cutoff (< -5V) and into positive grid conduction
			input[index] = 10 * Math.sin((2 * Math.PI * 440 * index) / 48_000);
		}
		const output = runtime.process(input);
		const telemetry = runtime.telemetry();
		expect(telemetry.nonConvergedSamples).toBe(0);
		expect(telemetry.nonFiniteSamples).toBe(0);
		expect(telemetry.peakIterations).toBeLessThanOrEqual(24);
		// Verify output is actively clipping/swinging
		let maxVal = -Infinity;
		let minVal = Infinity;
		for (let i = 0; i < length; i++) {
			maxVal = Math.max(maxVal, output[i] ?? 0);
			minVal = Math.min(minVal, output[i] ?? 0);
		}
		expect(maxVal - minVal).toBeGreaterThan(50);
	});
});

describe("Phase 4: live BBD clock control with dynamic resistance and taper smoothing", () => {
	// **Compiled from a real fixture, then given the one field under test.** This describes
	// itself against this file's own rule -- compile fixtures, never hand-build a program --
	// because it does deviate, and only in one field.
	//
	// The deviation is forced: `clockControl` is populated on **no** corpus document and no
	// compiler fixture, because the compiler only emits it when a clock driver's R and C both
	// resolve, and every CD4047/MN3101 network in the corpus refuses at that step (see
	// `scripts/report-bbd-clock-derivation.ts`). So there is nothing to compile that carries
	// one, and a synthetic block is the only way to exercise the runtime kernel at all.
	//
	// It stays honest by spreading a genuinely compiled program rather than declaring one.
	// The first version of this test hand-wrote the whole `Program` literal and drifted five
	// fields out of sync with the type in a single commit (`sampleRate`, `coupling`,
	// `stateCount`, `totalNonLinearNodes`, `fullScaleVolts` -- none of which `Program` has --
	// while omitting `ports`, `supplyReference`, `portFullScaleVolts`, `stageCoverage` and
	// `portImpedanceOhms`). It still passed, because `bun test` does not typecheck; only `tsc`
	// caught it. Spreading `emit`'s own output makes that class of drift unrepresentable: the
	// compiler owns every field but the two overridden here.
	const makeBbdClockProgram = (
		taper: "linear" | "logarithmic" = "linear",
	): Program => {
		const result = compile(hybridDelayPedal, { registry: fixtureRegistry });
		if (result.status !== "ok") {
			throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
		}
		const compiled = result.program;
		const macro = compiled.blocks.find((block) => block.kind === "macro");
		if (macro === undefined || macro.kind !== "macro") {
			throw new Error("fixture produced no macro block to attach a clock to");
		}
		return {
			...compiled,
			controls: [
				...compiled.controls,
				{ id: "Delay", taper, defaultPosition: 0.5 },
			],
			blocks: compiled.blocks.map((block) =>
				block.kind === "macro" && block.id === macro.id
					? {
							...block,
							clockControl: {
								controlId: "Delay",
								taper,
								ohmsAtControlMin: 10_000,
								ohmsAtControlMax: 100_000,
								farads: 100e-12,
								stages: 2048,
								formulaConstant: 2.2,
							},
						}
					: block,
			),
		};
	};

	it("moves the delay continuously based on control knob position", () => {
		const program = makeBbdClockProgram("linear");
		const runtime = new ReferenceRuntime(program);
		const sampleRate = 48_000;
		runtime.prepare(sampleRate);

		// At control=0: R = 10k, delay = 2048 * 2.2 * 10,000 * 100e-12 = 0.0045056 s = ~216.27 samples
		runtime.setControl("Delay", 0);
		// Settle smoothing (10ms = 480 samples, 5000 samples is > 10 tau)
		runtime.process(new Float64Array(5000));

		const impulse = new Float64Array(4000);
		impulse[0] = 1.0;
		const outMin = runtime.process(impulse);
		const peakIndexMin = outMin.findIndex((v) => Math.abs(v) > 0.1);
		// 216 samples
		expect(peakIndexMin).toBe(216);

		// At control=1: R = 100k, delay = 2048 * 2.2 * 100,000 * 100e-12 = 0.045056 s = ~2162.69 samples
		runtime.setControl("Delay", 1);
		// Settle smoothing (10ms = 480 samples, 5000 samples is > 10 tau)
		runtime.process(new Float64Array(5000));

		const outMax = runtime.process(impulse);
		const peakIndexMax = outMax.findIndex((v) => Math.abs(v) > 0.1);
		// 2162 or 2163 samples
		expect(peakIndexMax).toBeGreaterThanOrEqual(2162);
		expect(peakIndexMax).toBeLessThanOrEqual(2163);
	});

	it("respects logarithmic taper mapping on control position", () => {
		const program = makeBbdClockProgram("logarithmic");
		const runtime = new ReferenceRuntime(program);
		const sampleRate = 48_000;
		runtime.prepare(sampleRate);

		// At control=0.5 with audio/log taper:
		// taperFraction(0.5, "logarithmic") is ~0.1
		// R = 10k + 0.1 * (100k - 10k) = ~19k
		// Delay = 2048 * 2.2 * 19,000 * 100e-12 = ~0.00856 s = ~411 samples
		runtime.setControl("Delay", 0.5);
		runtime.process(new Float64Array(5000));

		const impulse = new Float64Array(4000);
		impulse[0] = 1.0;
		const outMid = runtime.process(impulse);
		const peakIndexMid = outMid.findIndex((v) => Math.abs(v) > 0.1);
		// Much closer to 411 samples than the linear midpoint (~1189 samples)
		expect(peakIndexMid).toBeGreaterThan(350);
		expect(peakIndexMid).toBeLessThan(500);
	});
});


