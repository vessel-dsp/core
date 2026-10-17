// The taper curve, which the runtime owns because decision 2 says the program carries
// which taper a control is and the thing running the program decides what that means.

import { describe, expect, it } from "bun:test";
import { compile, emptyRegistry, type Program } from "@vessel-dsp/compiler";
import { potDivider, potSCurveTaper } from "@vessel-dsp/compiler/fixtures/circuits";
import { IMPLEMENTED_TAPER_NAMES, taperFraction, unrecognisedTapers } from "../src/taper";

describe("taperFraction", () => {
	it("is the identity for a linear taper", () => {
		expect(taperFraction("linear", 0)).toBe(0);
		expect(taperFraction("linear", 0.25)).toBeCloseTo(0.25, 12);
		expect(taperFraction("linear", 1)).toBe(1);
	});

	it("puts 17.5% of the track at half rotation for an audio taper", () => {
		// The Alpha A-taper bracket midpoint (10-25% at the maker's test point), metered
		// at 19-21% on RT-301860. The 10% edge it replaces under-read noon by ~4.4 dB.
		expect(taperFraction("logarithmic", 0.5)).toBeCloseTo(0.175, 6);
		expect(taperFraction("logarithmic", 0)).toBeCloseTo(0, 12);
		expect(taperFraction("logarithmic", 1)).toBeCloseTo(1, 12);
	});

	it("is monotonic and clamped outside 0..1", () => {
		expect(taperFraction("linear", -1)).toBe(0);
		expect(taperFraction("linear", 5)).toBe(1);
		expect(taperFraction("reverse-logarithmic", 0)).toBeCloseTo(0, 12);
		expect(taperFraction("reverse-logarithmic", 1)).toBeCloseTo(1, 12);
	});

	it("reverses a linear track without bending it", () => {
		// A reverse-linear pot is linear travelling the other way, so half rotation is
		// still half the track. Reverse-logarithmic puts 82.5% there (1 - 0.175), which is what
		// this taper was collapsing into before it had a kind of its own.
		expect(taperFraction("reverse-linear", 0)).toBe(1);
		expect(taperFraction("reverse-linear", 0.5)).toBeCloseTo(0.5, 12);
		expect(taperFraction("reverse-linear", 1)).toBe(0);
		expect(taperFraction("reverse-logarithmic", 0.5)).toBeCloseTo(0.825, 6);
	});
});

// Alpha RV16AF W(4B), SP16050157 p. 4 section 2.4, of the 300-degree rotation on p. 3 section 1.1:
// 90 +- 5 degrees 5-15 %, 150 degrees 40-60 %, 210 +- 5 degrees 85-95 %. The engine's nominal is
// each band's midpoint; the shape between the points is a convention (a PCHIP), so only the
// printed points, the stops and the noon are claims and everything else here is arithmetic on
// the registered law (`thoughts/shared/2026-10-17-core-s-curve/REGISTRATION.md` section 3).
describe("taperFraction s-curve (Alpha W(4B))", () => {
	const KNOTS: ReadonlyArray<readonly [number, number]> = [
		[0, 0],
		[0.3, 0.1],
		[0.5, 0.5],
		[0.7, 0.9],
		[1, 1],
	];

	it("returns the printed midpoints and both stops exactly", () => {
		for (const [x, y] of KNOTS) {
			expect(taperFraction("s-curve", x)).toBe(y);
		}
	});

	it("sits inside every printed band, the +-5 degree allowance on the outer two included", () => {
		const angle = 5 / 300;
		for (const x of [0.3 - angle, 0.3, 0.3 + angle]) {
			const f = taperFraction("s-curve", x);
			expect(f).toBeGreaterThanOrEqual(0.05);
			expect(f).toBeLessThanOrEqual(0.15);
		}
		expect(taperFraction("s-curve", 0.5)).toBeGreaterThanOrEqual(0.4);
		expect(taperFraction("s-curve", 0.5)).toBeLessThanOrEqual(0.6);
		for (const x of [0.7 - angle, 0.7, 0.7 + angle]) {
			const f = taperFraction("s-curve", x);
			expect(f).toBeGreaterThanOrEqual(0.85);
			expect(f).toBeLessThanOrEqual(0.95);
		}
	});

	it("is clamped, strictly increasing, and odd about the centre", () => {
		expect(taperFraction("s-curve", -1)).toBe(0);
		expect(taperFraction("s-curve", 2)).toBe(1);
		let previous = -1;
		let worstOdd = 0;
		for (let step = 0; step <= 10_000; step += 1) {
			const x = step / 10_000;
			const f = taperFraction("s-curve", x);
			expect(f).toBeGreaterThan(previous);
			previous = f;
			worstOdd = Math.max(worstOdd, Math.abs(f + taperFraction("s-curve", 1 - x) - 1));
		}
		// Rounding of 1 - x and of a few multiply-adds, nothing structural. The registration
		// said 4e-16 and the first run read 4.44e-16, which is exactly two units in the last place
		// of 1.0: that registered expectation was missed and is reported as such, not chased by
		// re-ordering the arithmetic. The bound here is that measured value (2 ulp of 1.0).
		expect(worstOdd).toBeLessThanOrEqual(2 ** -51);
	});

	it("is the Hermite curve of the knots with Fritsch-Butland slopes, derived here independently", () => {
		// The implementation holds the slopes as literals; this derives them from the knots by
		// the weighted harmonic mean and evaluates the cubic in a different form (Bernstein),
		// so a wrong literal, a wrong segment table or a wrong basis all show.
		const xs = KNOTS.map(([x]) => x);
		const ys = KNOTS.map(([, y]) => y);
		const h = xs.slice(1).map((x, i) => x - (xs[i] as number));
		const d = ys.slice(1).map((y, i) => (y - (ys[i] as number)) / (h[i] as number));
		const slope: number[] = [0];
		for (let k = 1; k < xs.length - 1; k += 1) {
			const w1 = 2 * (h[k] as number) + (h[k - 1] as number);
			const w2 = (h[k] as number) + 2 * (h[k - 1] as number);
			slope.push((w1 + w2) / (w1 / (d[k - 1] as number) + w2 / (d[k] as number)));
		}
		slope.push(0);
		expect(slope[1]).toBeCloseTo(0.6, 14);
		expect(slope[2]).toBeCloseTo(2, 14);
		expect(slope[3]).toBeCloseTo(0.6, 14);
		const reference = (x: number): number => {
			let k = 0;
			while (k < 3 && x >= (xs[k + 1] as number)) k += 1;
			const t = (x - (xs[k] as number)) / (h[k] as number);
			const p0 = ys[k] as number;
			const p3 = ys[k + 1] as number;
			const p1 = p0 + ((h[k] as number) * (slope[k] as number)) / 3;
			const p2 = p3 - ((h[k] as number) * (slope[k + 1] as number)) / 3;
			const u = 1 - t;
			return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
		};
		let worst = 0;
		for (let step = 1; step < 10_000; step += 1) {
			const x = step / 10_000;
			worst = Math.max(worst, Math.abs(taperFraction("s-curve", x) - reference(x)));
		}
		expect(worst).toBeLessThan(1e-14);
	});

	it("reads the registered unprinted values, which the sheet does not state", () => {
		// Arithmetic on the convention, not evidence about any pot: a piecewise-linear
		// interpolant through the same knots reads 0.033 and 0.30 at 0.10 and 0.40.
		const registered: ReadonlyArray<readonly [number, number]> = [
			[0.1, 0.0126],
			[0.25, 0.0718],
			[0.4, 0.265],
			[0.6, 0.735],
			[0.75, 0.928],
			[0.9, 0.987],
		];
		for (const [x, y] of registered) {
			expect(taperFraction("s-curve", x)).toBeCloseTo(y, 3);
		}
	});

	it("is not linear, and not any other law", () => {
		expect(taperFraction("s-curve", 0.3)).not.toBeCloseTo(taperFraction("linear", 0.3), 1);
		expect(taperFraction("s-curve", 0.7)).not.toBeCloseTo(taperFraction("linear", 0.7), 1);
		// The audio law is 0.072 at 0.3 (near the S-curve's 0.1) but 0.366 at 0.7 against 0.9.
		expect(taperFraction("s-curve", 0.7)).not.toBeCloseTo(taperFraction("logarithmic", 0.7), 1);
		expect(taperFraction("s-curve", 0.5)).not.toBeCloseTo(taperFraction("logarithmic", 0.5), 1);
	});
});

describe("taperFraction: the four laws that were already there did not move", () => {
	// Independent inline copies of the formulas as they stood before `s-curve` was added.
	const base = 1089 / 49;
	const before = {
		linear: (x: number) => x,
		logarithmic: (x: number) => (base ** x - 1) / (base - 1),
		"reverse-logarithmic": (x: number) => 1 - (base ** (1 - x) - 1) / (base - 1),
		"reverse-linear": (x: number) => 1 - x,
	} as const;

	it("is bit-identical to the pre-change formulas over a dense grid and out of range", () => {
		for (const taper of ["linear", "logarithmic", "reverse-logarithmic", "reverse-linear"] as const) {
			for (let step = -100; step <= 10_100; step += 1) {
				const position = step / 10_000;
				const x = Math.min(1, Math.max(0, position));
				expect(Object.is(taperFraction(taper, position), before[taper](x))).toBe(true);
			}
		}
	});
});

describe("the closed taper vocabulary", () => {
	const programFor = (source: string): Program => {
		const result = compile(source, { registry: emptyRegistry });
		if (result.status !== "ok") throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
		return result.program;
	};
	const withControlTaper = (program: Program, taper: unknown): Program =>
		({
			...program,
			controls: program.controls.map((control) => ({ ...control, taper })),
		}) as unknown as Program;

	it("names the five implemented tapers, exactly", () => {
		expect([...IMPLEMENTED_TAPER_NAMES]).toEqual([
			"linear",
			"logarithmic",
			"reverse-logarithmic",
			"reverse-linear",
			"s-curve",
		]);
	});

	it("finds nothing in a program that names only those, s-curve included", () => {
		expect(unrecognisedTapers(programFor(potDivider))).toEqual([]);
		expect(unrecognisedTapers(programFor(potSCurveTaper))).toEqual([]);
	});

	it("finds a name it does not implement on a control, a stamp and a clockControl, and says where", () => {
		const program = programFor(potDivider);
		const control = unrecognisedTapers(withControlTaper(program, "bogus"));
		expect(control.map((entry) => entry.taper)).toEqual(["bogus"]);
		expect(control[0]?.where).toContain("control");
		const stampMutated = {
			...program,
			blocks: program.blocks.map((block) =>
				block.kind === "mna"
					? { ...block, stamps: block.stamps.map((stamp) => ("taper" in stamp ? { ...stamp, taper: "anti-logarithmic" } : stamp)) }
					: block,
			),
		} as unknown as Program;
		const stamp = unrecognisedTapers(stampMutated);
		expect(stamp.length).toBeGreaterThan(0);
		expect(stamp.every((entry) => entry.taper === "anti-logarithmic" && entry.where.includes("stamp"))).toBe(true);
		const clocked = {
			...program,
			blocks: [
				...program.blocks,
				{ kind: "composed", id: "clocked", clockControl: { controlId: "Delay", taper: "custom" } },
			],
		} as unknown as Program;
		expect(unrecognisedTapers(clocked)).toEqual([{ where: 'clockControl of block "clocked"', taper: "custom" }]);
	});

	it("refuses the spellings the compiler folds and the names a neighbour might guess", () => {
		const program = programFor(potDivider);
		for (const name of ["", "scurve", "S-Curve", "Linear", "anti-logarithmic", "log", "W20", "custom", "stepped"]) {
			expect(unrecognisedTapers(withControlTaper(program, name)).map((entry) => entry.taper)).toEqual([name]);
		}
		expect(unrecognisedTapers(withControlTaper(program, null)).map((entry) => entry.taper)).toEqual(["null"]);
	});

	it("reads an absent taper as naming nothing, as the C++ loader does", () => {
		const program = programFor(potDivider);
		const absent = {
			...program,
			controls: program.controls.map(({ taper: _taper, ...rest }) => rest),
		} as unknown as Program;
		expect(unrecognisedTapers(absent)).toEqual([]);
	});
});
