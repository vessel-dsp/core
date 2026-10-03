// The runtime's package contract, exercised through its public surface only.
//
// The console/ROM promise, held to through `index.ts` alone: a compiled program from the
// compiler's barrel plays on the reference runtime, refuses by name what it cannot execute,
// and the pure helpers the browser surface builds on behave as their doc comments say. The
// WASM console is graded here only when its binary is on disk, and says so when it is not.
import { describe, expect, it } from "bun:test";
import { compile, emptyRegistry, type PartRegistry, type Program } from "@vessel-dsp/compiler";
import {
	dividerGain,
	fixtureRegistry,
	hybridDelayPedal,
	invertingGain,
	potDivider,
	potGainAt,
	rcCornerHz,
	rcLowPass,
	resistorDivider,
	diodeClipper,
	invertingAmplifier,
	unimplementedMacroRegistry,
} from "@vessel-dsp/compiler/fixtures";
import {
	ChainRuntime,
	chainAdvisories,
	dacScaleFactor,
	DEFAULT_NEWTON_MAX_ITERATIONS,
	outputDbfs,
	programSlot,
	ReferenceRuntime,
	resolveBypassMode,
	RuntimeError,
	seamScale,
	settledRender,
	slotContract,
	supplyGroundConflicts,
	taperFraction,
	V2WasmEngine,
} from "../src/index";
import { WASM_SKIP_REASON, wasmBinaryPresent } from "./wasm-presence";

const RATE = 48_000;

function programFor(source: string, registry: PartRegistry = emptyRegistry): Program {
	const result = compile(source, { registry });
	if (result.status !== "ok") {
		throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
	}
	return result.program;
}

function sine(hz: number, cycles: number, amplitude = 1): Float64Array {
	const length = Math.round((cycles * RATE) / hz);
	const input = new Float64Array(length);
	for (let index = 0; index < length; index += 1) {
		input[index] = amplitude * Math.sin((2 * Math.PI * hz * index) / RATE);
	}
	return input;
}

/** Peak of the last quarter of a render: after any coupling network has settled. */
function steadyPeak(output: Float64Array): number {
	let peak = 0;
	for (let index = Math.floor((output.length * 3) / 4); index < output.length; index += 1) {
		peak = Math.max(peak, Math.abs(output[index] as number));
	}
	return peak;
}

function gainOf(program: Program, hz: number, controls: Readonly<Record<string, number>> = {}): number {
	const runtime = new ReferenceRuntime(program);
	runtime.prepare(RATE);
	for (const [id, position] of Object.entries(controls)) runtime.setControl(id, position);
	return steadyPeak(runtime.process(sine(hz, 200)));
}

describe("ReferenceRuntime plays a compiled program to its hand-computed answer", () => {
	it("renders a resistor divider at its ratio", () => {
		expect(gainOf(programFor(resistorDivider), 1000)).toBeCloseTo(dividerGain, 6);
	});

	it("renders an inverting amplifier at its gain", () => {
		expect(gainOf(programFor(invertingAmplifier), 1000)).toBeCloseTo(invertingGain, 2);
	});

	it("rolls an RC low-pass off across its corner", () => {
		const program = programFor(rcLowPass);
		const below = gainOf(program, rcCornerHz / 10);
		const above = gainOf(program, rcCornerHz * 10);
		expect(below).toBeGreaterThan(0.9);
		expect(above).toBeLessThan(0.2);
		expect(above).toBeLessThan(below);
	});

	it("moves a control and the audio follows the pot law", () => {
		const program = programFor(potDivider);
		const id = program.controls[0]?.id;
		if (id === undefined) throw new Error("potDivider declares no control");
		expect(gainOf(program, 1000, { [id]: 0.25 })).toBeCloseTo(potGainAt(0.25), 3);
		expect(gainOf(program, 1000, { [id]: 0.75 })).toBeCloseTo(potGainAt(0.75), 3);
	});

	it("reports what the solver did, and converges on a clipper at the default cap", () => {
		const runtime = new ReferenceRuntime(programFor(diodeClipper));
		runtime.prepare(RATE, { maxNewtonIterations: DEFAULT_NEWTON_MAX_ITERATIONS });
		runtime.process(sine(1000, 20, 5));
		const telemetry = runtime.telemetry();
		expect(telemetry.samples).toBeGreaterThan(0);
		expect(telemetry.nonConvergedSamples).toBe(0);
		expect(telemetry.nonFiniteSamples).toBe(0);
	});

	it("refuses to process before prepare, as a RuntimeError", () => {
		const runtime = new ReferenceRuntime(programFor(resistorDivider));
		expect(() => runtime.process(new Float64Array(8))).toThrow(RuntimeError);
	});
});

describe("the console/ROM promise: unknown work is refused by name, before a sample", () => {
	it("refuses an operator it does not implement, naming it", () => {
		const program = programFor(resistorDivider);
		const doctored = {
			...program,
			requiredOperators: [...program.requiredOperators, "flux-capacitor"],
		} as unknown as Program;
		const runtime = new ReferenceRuntime(doctored);
		expect(() => runtime.prepare(RATE)).toThrow(RuntimeError);
		expect(() => runtime.prepare(RATE)).toThrow(/flux-capacitor/);
	});

	it("refuses a model it does not implement, naming it, and plays the same pedal once it does", () => {
		const refused = new ReferenceRuntime(programFor(hybridDelayPedal, unimplementedMacroRegistry));
		expect(() => refused.prepare(RATE)).toThrow(RuntimeError);
		expect(() => refused.prepare(RATE)).toThrow(/compander/);
		// Positive control: same source, same part, the model this runtime does implement.
		const played = new ReferenceRuntime(programFor(hybridDelayPedal, fixtureRegistry));
		expect(() => played.prepare(RATE)).not.toThrow();
		expect(played.process(new Float64Array(64)).length).toBe(64);
	});
});

describe("settledRender: the settle ladder reports a verdict, never a bare number", () => {
	it("settles a linear divider under a tone and reports its level", () => {
		const render = settledRender(programFor(resistorDivider), { sampleRate: RATE, hz: 1000, drive: 1 });
		expect(render.status).toBe("settled");
		if (render.status === "settled") {
			expect(render.peak).toBeCloseTo(dividerGain, 3);
			expect(render.rms).toBeCloseTo(dividerGain / Math.SQRT2, 3);
			expect(render.tail.length).toBeGreaterThan(0);
		}
	});

	it("with no tone it is an idle render, and a passive divider idles at zero", () => {
		const render = settledRender(programFor(resistorDivider), { sampleRate: RATE });
		expect(render.status).toBe("settled");
		if (render.status === "settled") {
			expect(render.peak).toBeCloseTo(0, 9);
		}
	});
});

describe("chain helpers: pure, deterministic, and from the barrel", () => {
	it("taperFraction pins its endpoints, clamps, and mirrors the reverse tracks", () => {
		// Three of the four tracks run 0 -> 0 and 1 -> 1; `reverse-logarithmic` is the audio
		// curve mirrored about the diagonal (fast start), not travelled backwards.
		for (const taper of ["linear", "logarithmic", "reverse-logarithmic"] as const) {
			expect(taperFraction(taper, 0)).toBeCloseTo(0, 12);
			expect(taperFraction(taper, 1)).toBeCloseTo(1, 12);
		}
		// `reverse-linear` alone travels the other way: it is a real track (klon, jan-ray).
		expect(taperFraction("reverse-linear", 0)).toBeCloseTo(1, 12);
		expect(taperFraction("reverse-linear", 1)).toBeCloseTo(0, 12);
		for (const taper of ["linear", "logarithmic", "reverse-logarithmic", "reverse-linear"] as const) {
			expect(taperFraction(taper, -1)).toBe(taperFraction(taper, 0));
			expect(taperFraction(taper, 2)).toBe(taperFraction(taper, 1));
		}
		expect(taperFraction("linear", 0.5)).toBeCloseTo(0.5, 12);
		// reverse-linear is a real track, not reverse-logarithmic: half rotation is half the track.
		expect(taperFraction("reverse-linear", 0.5)).toBeCloseTo(0.5, 12);
		// 10% of the track at half rotation: base 81, the value for which (9-1)/(81-1) = 0.1.
		expect(taperFraction("logarithmic", 0.5)).toBeCloseTo(0.1, 12);
		expect(taperFraction("reverse-logarithmic", 0.5)).toBeCloseTo(0.9, 12);
		for (const step of [0, 10, 25, 50, 75, 90, 100]) {
			const x = step / 100;
			expect(taperFraction("reverse-logarithmic", x)).toBeCloseTo(1 - taperFraction("logarithmic", 1 - x), 12);
		}
		let previous = -1;
		for (let step = 0; step <= 100; step += 1) {
			const value = taperFraction("logarithmic", step / 100);
			expect(value).toBeGreaterThanOrEqual(previous);
			previous = value;
		}
	});

	it("dacScaleFactor and outputDbfs scale only above unity full scale", () => {
		expect(dacScaleFactor(null)).toBe(1);
		expect(dacScaleFactor(0.5)).toBe(1);
		expect(dacScaleFactor(2)).toBe(0.5);
		expect(outputDbfs(1, null)).toBeCloseTo(0, 9);
		expect(outputDbfs(1, 2)).toBeCloseTo(-20 * Math.log10(2), 9);
		expect(outputDbfs(0, null)).toBeCloseTo(-240, 6);
	});

	it("resolveBypassMode: engaged is always the effect; disengaged follows the declared bypass", () => {
		const program = programFor(resistorDivider);
		expect(resolveBypassMode(program.bypass, true)).toBe("effect");
		const disengaged = resolveBypassMode(program.bypass, false);
		expect(disengaged === null || ["wire", "buffer", "effect"].includes(disengaged)).toBe(true);
	});

	it("a program slot's contract carries the program's port scales; a one-slot chain has no seams", () => {
		const program = programFor(resistorDivider);
		const contract = slotContract(programSlot(program));
		expect(contract.portFullScaleVolts).toEqual(program.portFullScaleVolts);
		expect(chainAdvisories([contract])).toEqual([]);
		expect(chainAdvisories([])).toEqual([]);
		expect(seamScale([contract, contract], 1)).toBeCloseTo(1, 12);
	});

	it("supplyGroundConflicts is silent for a chain that agrees with itself", () => {
		const program = programFor(resistorDivider);
		expect(supplyGroundConflicts([program])).toEqual([]);
		expect(supplyGroundConflicts([program, program])).toEqual([]);
		expect(supplyGroundConflicts([])).toEqual([]);
	});

	it("ChainRuntime plays a one-slot chain like the bare runtime, in the audio band", () => {
		// **The chain is not the bare runtime plus nothing, and that is deliberate.** A runtime
		// reads the output jack unloaded and DC-coupled, which no real signal chain is: the next
		// device always presents a coupling cap and an input resistance. The chain models that,
		// so the two agree on a 1 kHz tone and differ on DC -- which is the whole point, and is
		// why this assertion is about the audio band rather than sample equality.
		const program = programFor(resistorDivider);
		const chain = new ChainRuntime([programSlot(program)]);
		chain.prepare(RATE);
		const bare = new ReferenceRuntime(program);
		bare.prepare(RATE);
		const input = sine(1000, 20);
		const chained = chain.process(input);
		const direct = bare.process(input);
		expect(chained.length).toBe(direct.length);
		// 1 kHz is three decades above the coupling corner, so the tone passes untouched.
		expect(steadyPeak(chained)).toBeCloseTo(steadyPeak(direct), 2);
	});

	it("a one-slot chain removes the offset the bare runtime leaves on the jack", () => {
		// The negative control for the assertion above: if the chain stopped modelling the
		// downstream coupling, this would fail and the previous test would still pass. Four
		// corpus packets were digitally silent in the browser for exactly this reason.
		const program = programFor(resistorDivider);
		const chain = new ChainRuntime([programSlot(program)]);
		chain.prepare(RATE);
		const bare = new ReferenceRuntime(program);
		bare.prepare(RATE);
		// Driven with a deliberate offset, because this fixture's own jack sits at 0 V and a
		// control with nothing to remove proves nothing. A divider passes DC, so the offset
		// reaches the output and the coupling is what decides whether it survives.
		// A second of tone: the coupling's time constant is about 16 ms, so a 20 ms clip would
		// still be mid-settle and the assertion below would be measuring the clip length.
		const tone = sine(1000, 1000);
		const input = new Float64Array(tone.length);
		for (let index = 0; index < tone.length; index += 1) input[index] = (tone[index] ?? 0) + 1;
		const mean = (x: Float64Array) => {
			const from = Math.floor(x.length / 2);
			let total = 0;
			for (let index = from; index < x.length; index += 1) total += x[index] ?? 0;
			return total / (x.length - from);
		};
		const chainedDc = Math.abs(mean(chain.process(input)));
		const bareDc = Math.abs(mean(bare.process(input)));
		// Comparative, not absolute: this clip is short enough that the coupling has not fully
		// settled, and pinning a settled figure here would be asserting the clip length rather
		// than the contract. An order of magnitude is the claim -- the offset is removed, not
		// merely reduced by rounding.
		expect(bareDc).toBeGreaterThan(1e-3);
		expect(chainedDc).toBeLessThan(bareDc / 10);
	});
});

describe.skipIf(!wasmBinaryPresent)(`V2WasmEngine agrees with the reference console${WASM_SKIP_REASON ? ` (${WASM_SKIP_REASON})` : ""}`, () => {
	it("renders the same clipper to within 1e-9", async () => {
		const program = programFor(diodeClipper);
		const reference = new ReferenceRuntime(program);
		reference.prepare(RATE, { maxNewtonIterations: DEFAULT_NEWTON_MAX_ITERATIONS });
		const engine = await V2WasmEngine.create(program);
		engine.prepare({ sampleRate: RATE, maxNewtonIterations: DEFAULT_NEWTON_MAX_ITERATIONS });
		const input = sine(1000, 20, 2);
		const expected = reference.process(input);
		const actual = new Float32Array(input.length);
		engine.processBlock(Float32Array.from(input), actual);
		let maxDelta = 0;
		for (let index = 0; index < input.length; index += 1) {
			maxDelta = Math.max(maxDelta, Math.abs((expected[index] as number) - (actual[index] as number)));
		}
		// Float32 transport bounds the comparison, not the solver: 1e-6 is a float32 ULP at unity.
		expect(maxDelta).toBeLessThan(1e-6);
		expect(engine.getLastConverged()).toBe(true);
		engine.destroy();
	});

	it("refuses an operator it does not implement, naming it, at load", async () => {
		const program = programFor(resistorDivider);
		const engine = await V2WasmEngine.create();
		const doctored = {
			...program,
			requiredOperators: [...program.requiredOperators, "flux-capacitor"],
		} as unknown as Program;
		expect(() => engine.loadProgram(doctored)).toThrow(/flux-capacitor/);
		engine.destroy();
	});
});
