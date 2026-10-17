// The taper law on both consoles: that they evaluate it alike, that a pot divider follows it end
// to end, and that a program naming a taper neither console implements is refused by name.
//
// The law itself is pinned in `taper.test.ts` (printed points, bands, slopes, the four laws that
// were already there). This file is about the *two* implementations: the TypeScript one in
// `src/taper.ts` and the C++ one in `src/cpp/include/v2/Taper.h`, reached through the test-only
// export `v2_testonly_taper_fraction` (the same device the resample cascade uses), which takes
// the program's own spelling so the name table and the curve are both under test. Every test
// that needs the compiled console skips by name when `src/wasm/` is absent.

import { describe, expect, it } from "bun:test";
import { compile, emptyRegistry, type Program } from "@vessel-dsp/compiler";
import { hybridDelayPedal, potDivider, potSCurveTaper } from "@vessel-dsp/compiler/fixtures/circuits";
import { fixtureRegistry } from "@vessel-dsp/compiler/fixtures/registry";
import { ReferenceRuntime, RuntimeError } from "../src/reference-runtime";
import { taperFraction } from "../src/taper";
import { getV2WasmModule, V2WasmEngine } from "../src/v2-wasm-engine";
import { wasmBinaryPresent } from "./wasm-presence";

const RATE = 48_000;
const NAMES = ["linear", "logarithmic", "reverse-logarithmic", "reverse-linear", "s-curve"] as const;
type Name = (typeof NAMES)[number];

function programFor(source: string, registry = emptyRegistry): Program {
	const result = compile(source, { registry });
	if (result.status !== "ok") throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
	return result.program;
}

/** The grid the comparison runs on: 100 001 points, the printed knots, and out of range both ways. */
function grid(): Float64Array {
	const points = [-1, 2, 0.3, 0.5, 0.7];
	const values = new Float64Array(100_001 + points.length);
	for (let index = 0; index <= 100_000; index += 1) values[index] = index / 100_000;
	points.forEach((point, offset) => {
		values[100_001 + offset] = point;
	});
	return values;
}

/** How many doubles differ, `Object.is`: a NaN equals a NaN, and +0 is not -0. */
function countDiffering(a: Float64Array, b: Float64Array): number {
	let count = 0;
	for (let index = 0; index < a.length; index += 1) {
		if (!Object.is(a[index], b[index])) count += 1;
	}
	return count;
}

/** The next double above `value`, by its bits. */
function nextUp(value: number): number {
	const view = new DataView(new ArrayBuffer(8));
	view.setFloat64(0, value);
	view.setBigUint64(0, view.getBigUint64(0) + 1n);
	return view.getFloat64(0);
}

function sine(hz: number, cycles: number): Float64Array {
	const length = Math.round((cycles * RATE) / hz);
	const input = new Float64Array(length);
	for (let index = 0; index < length; index += 1) input[index] = Math.sin((2 * Math.PI * hz * index) / RATE);
	return input;
}

function steadyPeak(output: ArrayLike<number>): number {
	let peak = 0;
	for (let index = Math.floor((output.length * 3) / 4); index < output.length; index += 1) {
		peak = Math.max(peak, Math.abs(output[index] as number));
	}
	return peak;
}

function tsGain(program: Program, position: number): number {
	const runtime = new ReferenceRuntime(program);
	runtime.prepare(RATE);
	runtime.setControl(program.controls[0]?.id as string, position);
	return steadyPeak(runtime.process(sine(1000, 200)));
}

async function wasmGain(program: Program, position: number): Promise<number> {
	const engine = await V2WasmEngine.create(program);
	engine.prepare({ sampleRate: RATE });
	engine.setControl(program.controls[0]?.id as string, position);
	const input = Float32Array.from(sine(1000, 200));
	const output = new Float32Array(input.length);
	engine.processBlock(input, output);
	engine.destroy();
	return steadyPeak(output);
}

describe("the instrument that compares the two consoles can say both yes and no", () => {
	it("reads identical arrays as 0 differing, one unit in the last place as 1, and a different law as nearly all", () => {
		const x = grid();
		const linear = x.map((value) => taperFraction("linear", value));
		const sCurve = x.map((value) => taperFraction("s-curve", value));
		expect(countDiffering(sCurve, sCurve.slice())).toBe(0);
		const nudged = sCurve.slice();
		nudged[12_345] = nextUp(nudged[12_345] as number);
		expect(countDiffering(sCurve, nudged)).toBe(1);
		expect(countDiffering(linear, sCurve)).toBeGreaterThan(0.9 * x.length);
	});
});

describe.skipIf(!wasmBinaryPresent)("the C++ console evaluates every taper as the TypeScript one does", () => {
	const compare = async (name: Name): Promise<{ differing: number; worst: number; ts: Float64Array; cpp: Float64Array }> => {
		const mod = await getV2WasmModule();
		const length = mod.lengthBytesUTF8(name) + 1;
		const pointer = mod._malloc(length);
		mod.stringToUTF8(name, pointer, length);
		const x = grid();
		const ts = x.map((value) => taperFraction(name, value));
		const cpp = x.map((value) => mod._v2_testonly_taper_fraction(pointer, value) as number);
		mod._free(pointer);
		let worst = 0;
		for (let index = 0; index < x.length; index += 1) {
			worst = Math.max(worst, Math.abs((ts[index] as number) - (cpp[index] as number)));
		}
		return { differing: countDiffering(ts, cpp), worst, ts, cpp };
	};

	it("agrees bit for bit on s-curve, linear and reverse-linear: no pow, no libm", async () => {
		for (const name of ["s-curve", "linear", "reverse-linear"] as const) {
			const { differing } = await compare(name);
			expect(differing).toBe(0);
		}
	});

	it("agrees to rounding on the two laws that call pow, which this change did not touch", async () => {
		// `Math.pow` and the C++ `pow` are not promised to round alike, so these two are bounded
		// rather than required to be identical; their count of last-place differences is reported
		// by the study script, not asserted.
		for (const name of ["logarithmic", "reverse-logarithmic"] as const) {
			const { worst } = await compare(name);
			expect(worst).toBeLessThan(1e-12);
		}
	});

	it("does not agree when the laws differ: the comparison would have caught a stale s-curve", async () => {
		const mod = await getV2WasmModule();
		const length = mod.lengthBytesUTF8("linear") + 1;
		const pointer = mod._malloc(length);
		mod.stringToUTF8("linear", pointer, length);
		const x = grid();
		const cppLinear = x.map((value) => mod._v2_testonly_taper_fraction(pointer, value) as number);
		mod._free(pointer);
		const tsSCurve = x.map((value) => taperFraction("s-curve", value));
		expect(countDiffering(tsSCurve, cppLinear)).toBeGreaterThan(0.9 * x.length);
	});

	it("returns NaN, never a number, for a name outside the five", async () => {
		const mod = await getV2WasmModule();
		for (const name of ["bogus", "", "scurve", "S-Curve", "anti-logarithmic", "custom"]) {
			const length = mod.lengthBytesUTF8(name) + 1;
			const pointer = mod._malloc(length);
			mod.stringToUTF8(name, pointer, length);
			expect(Number.isNaN(mod._v2_testonly_taper_fraction(pointer, 0.5))).toBe(true);
			mod._free(pointer);
		}
	});
});

describe("a pot divider follows the s-curve end to end", () => {
	// The existing pot test passes `toBeCloseTo(.., 3)`: |error| below 5e-4. The function returns
	// the stops exactly (above); a solved divider reads them to within the contact floor and that
	// bar, which is all a circuit can.
	const expected: ReadonlyArray<readonly [number, number]> = [
		[0, 0],
		[0.3, 0.1],
		[0.5, 0.5],
		[0.7, 0.9],
		[1, 1],
	];

	it("TypeScript console: 0.10 / 0.50 / 0.90 at 0.30 / 0.50 / 0.70, and the stops", () => {
		const program = programFor(potSCurveTaper);
		for (const [position, fraction] of expected) {
			expect(Math.abs(tsGain(program, position) - fraction)).toBeLessThan(5e-4);
		}
	});

	it.skipIf(!wasmBinaryPresent)("C++ console: the same", async () => {
		const program = programFor(potSCurveTaper);
		for (const [position, fraction] of expected) {
			expect(Math.abs((await wasmGain(program, position)) - fraction)).toBeLessThan(5e-4);
		}
	});

	it("the same divider declared linear reads the position itself, so the instrument can say linear", async () => {
		const program = programFor(potDivider);
		for (const position of [0.3, 0.5, 0.7]) {
			expect(Math.abs(tsGain(program, position) - position)).toBeLessThan(5e-4);
			if (wasmBinaryPresent) {
				expect(Math.abs((await wasmGain(program, position)) - position)).toBeLessThan(5e-4);
			}
		}
	});
});

describe("a taper neither console implements is refused by name, not read as linear", () => {
	const BAD = ["bogus", "", "anti-logarithmic", "scurve", "custom"];
	const withControlTaper = (program: Program, taper: unknown): Program =>
		({ ...program, controls: program.controls.map((control) => ({ ...control, taper })) }) as unknown as Program;
	const withStampTaper = (program: Program, taper: string): Program =>
		({
			...program,
			blocks: program.blocks.map((block) =>
				block.kind === "mna"
					? { ...block, stamps: block.stamps.map((stamp) => ("taper" in stamp ? { ...stamp, taper } : stamp)) }
					: block,
			),
		}) as unknown as Program;
	const withClockTaper = (taper: string): Program => {
		const program = programFor(hybridDelayPedal, fixtureRegistry);
		const clock = {
			controlId: "Delay",
			taper,
			ohmsAtControlMin: 10_000,
			ohmsAtControlMax: 100_000,
			farads: 100e-12,
			stages: 2048,
			formulaConstant: 2.2,
			offsetSeconds: 0,
		};
		return {
			...program,
			controls: [...program.controls, { id: "Delay", taper: "linear", defaultPosition: 0.5 }],
			blocks: program.blocks.map((block) =>
				block.kind === "composed" ? { ...block, clockControl: clock } : block,
			),
		} as unknown as Program;
	};

	it("TypeScript console: prepare() throws a RuntimeError that quotes the name and says where", () => {
		const program = programFor(potDivider);
		for (const name of BAD) {
			const attempt = (): void => new ReferenceRuntime(withControlTaper(program, name)).prepare(RATE);
			expect(attempt).toThrow(RuntimeError);
			expect(attempt).toThrow(`"${name}"`);
			expect(attempt).toThrow("control");
		}
		expect(() => new ReferenceRuntime(withStampTaper(program, "bogus")).prepare(RATE)).toThrow(/"bogus" \(.*stamp/);
		expect(() => new ReferenceRuntime(withClockTaper("bogus")).prepare(RATE)).toThrow(/"bogus" \(clockControl of block/);
	});

	it("TypeScript console: prepares every one of the five, s-curve on a control, a stamp and a clockControl", () => {
		const program = programFor(potDivider);
		for (const name of NAMES) {
			expect(() => new ReferenceRuntime(withControlTaper(program, name)).prepare(RATE)).not.toThrow();
			expect(() => new ReferenceRuntime(withStampTaper(program, name)).prepare(RATE)).not.toThrow();
		}
		expect(() => new ReferenceRuntime(withClockTaper("s-curve")).prepare(RATE)).not.toThrow();
	});

	it.skipIf(!wasmBinaryPresent)("C++ console: the load fails and the message quotes the name and says where", async () => {
		const program = programFor(potDivider);
		for (const name of BAD) {
			await expect(V2WasmEngine.create(withControlTaper(program, name))).rejects.toThrow(`unknown taper "${name}" in control`);
		}
		await expect(V2WasmEngine.create(withStampTaper(program, "bogus"))).rejects.toThrow(/unknown taper "bogus" in stamp/);
		await expect(V2WasmEngine.create(withClockTaper("bogus"))).rejects.toThrow(/unknown taper "bogus" in clockControl/);
		// A `null` is present and names nothing it can read: refused, the type said.
		await expect(V2WasmEngine.create(withControlTaper(program, null))).rejects.toThrow(/taper in control .* is not a string/);
	});

	it.skipIf(!wasmBinaryPresent)("C++ console: loads every one of the five, and reads an absent key as linear", async () => {
		const program = programFor(potDivider);
		for (const name of NAMES) {
			(await V2WasmEngine.create(withControlTaper(program, name))).destroy();
			(await V2WasmEngine.create(withStampTaper(program, name))).destroy();
		}
		(await V2WasmEngine.create(withClockTaper("s-curve"))).destroy();
		const absent = {
			...program,
			controls: program.controls.map(({ taper: _taper, ...rest }) => rest),
		} as unknown as Program;
		(await V2WasmEngine.create(absent)).destroy();
		expect(() => new ReferenceRuntime(absent).prepare(RATE)).not.toThrow();
	});
});
