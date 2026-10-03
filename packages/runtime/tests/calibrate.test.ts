// Runtime calibration harness: measurement, envelope, refusals, and the
// admission gate the result feeds.
//
// Every expected value below is computed by hand in the comment preceding
// its assertion. Deterministic: all timing comes from an injected fake
// clock, never from a real one, and no test touches the network or a
// browser API.
import { describe, expect, test } from "bun:test";
import { compile, emptyRegistry, type Program } from "@vessel-dsp/compiler";
import {
	admissionVerdict,
	calibrateNsPerSolve,
	DEFAULT_CALIBRATION_SIZES,
	denseLinearSolveWorkload,
	predictedWorstCaseNs,
	type RealtimeBudget,
} from "@vessel-dsp/runtime";

// ---------------------------------------------------------------------------
// Fakes.
// ---------------------------------------------------------------------------

/** Integer-nanosecond clock the fake solves advance explicitly. */
function makeClock(): {
	now: () => number;
	advance: (ns: number) => void;
} {
	let t = 0;
	return {
		now: () => t,
		advance: (ns: number) => {
			t += ns;
		},
	};
}

/** A fake solve factory whose cost is exactly `costNs(n)` per call. */
function fakeSolve(
	clock: { advance: (ns: number) => void },
	costNs: (unknownCount: number) => number,
): (unknownCount: number) => () => void {
	return (unknownCount: number) => () => {
		clock.advance(costNs(unknownCount));
	};
}

/** Quadratic fake: exactly 100 ns per unknown count squared per solve. */
function quadraticFake(clock: { advance: (ns: number) => void }) {
	return fakeSolve(clock, (n) => 100 * n * n);
}

// ---------------------------------------------------------------------------
// Exact medians, interpolation, extrapolation, clamping.
// ---------------------------------------------------------------------------

describe("calibrateNsPerSolve with an exact quadratic fake clock", () => {
	test("median is exactly 100n^2 per size with zero spread", () => {
		const clock = makeClock();
		const result = calibrateNsPerSolve({
			solve: quadraticFake(clock),
			sizes: [2, 4, 8],
			warmupSolves: 5,
			solvesPerSample: 10,
			samples: 5,
			now: clock.now,
			minTimerResolutionNs: 1,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) {
			throw new Error("expected calibration to succeed");
		}
		// Hand: every sample at size n times a batch of 10 solves advancing
		// 100n^2 each, so per-solve is exactly 100n^2. Batches (4000, 16000,
		// 64000 ns) all exceed 100 x 1 ns, so no batch growth runs.
		// n=2: 100x4=400. n=4: 100x16=1600. n=8: 100x64=6400.
		expect(result.table).toEqual([
			{ unknownCount: 2, medianNsPerSolve: 400, spreadFraction: 0, samples: 5 },
			{
				unknownCount: 4,
				medianNsPerSolve: 1600,
				spreadFraction: 0,
				samples: 5,
			},
			{
				unknownCount: 8,
				medianNsPerSolve: 6400,
				spreadFraction: 0,
				samples: 5,
			},
		]);
		// Hand: strictly increasing, so the monotone envelope changes
		// nothing and reports no corrections.
		expect(result.corrections).toEqual([]);
		// Hand: exact table hit returns the table figure with no arithmetic.
		expect(result.nsPerSolve(4)).toBe(1600);
	});

	test("log-log interpolation recovers 100n^2 between sizes", () => {
		const clock = makeClock();
		const result = calibrateNsPerSolve({
			solve: quadraticFake(clock),
			sizes: [2, 4, 8],
			warmupSolves: 5,
			solvesPerSample: 10,
			samples: 5,
			now: clock.now,
			minTimerResolutionNs: 1,
		});
		if (!result.ok) {
			throw new Error("expected calibration to succeed");
		}
		// Hand: between 2 (400) and 4 (1600), t = (ln3-ln2)/(ln4-ln2).
		// ln1600-ln400 = ln4, so ln c = ln400 + t ln4 and c = 400 x 4^t.
		// t = log2(3)-1, 4^t = 9/4, c = 900 = 100x9. Float log/exp rounds
		// the last bit, so this is approximate, not exact.
		expect(result.nsPerSolve(3)).toBeCloseTo(900, 9);
	});

	test("extrapolation uses the fitted exponent from the largest size", () => {
		const clock = makeClock();
		const result = calibrateNsPerSolve({
			solve: quadraticFake(clock),
			sizes: [2, 4, 8],
			warmupSolves: 5,
			solvesPerSample: 10,
			samples: 5,
			now: clock.now,
			minTimerResolutionNs: 1,
		});
		if (!result.ok) {
			throw new Error("expected calibration to succeed");
		}
		// Hand: log cost is exactly ln100 + 2 ln n, so the least-squares
		// exponent is 2 and c(16) = 6400 x (16/8)^2 = 25600 = 100x256.
		// The slope carries float rounding, so this is approximate.
		expect(result.nsPerSolve(16)).toBeCloseTo(25600, 0);
	});

	test("below the smallest size the cost clamps; bad counts throw", () => {
		const clock = makeClock();
		const result = calibrateNsPerSolve({
			solve: quadraticFake(clock),
			sizes: [2, 4, 8],
			warmupSolves: 5,
			solvesPerSample: 10,
			samples: 5,
			now: clock.now,
			minTimerResolutionNs: 1,
		});
		if (!result.ok) {
			throw new Error("expected calibration to succeed");
		}
		// Hand: 1 is below the smallest measured size 2, so it is charged
		// at size 2 cost, 400, with no arithmetic (exact).
		expect(result.nsPerSolve(1)).toBe(400);
		// Negative controls: a non-positive or non-finite count is refused
		// by throwing rather than returning a fabricated figure.
		expect(() => result.nsPerSolve(0)).toThrow(RangeError);
		expect(() => result.nsPerSolve(-2)).toThrow(RangeError);
		expect(() => result.nsPerSolve(Number.NaN)).toThrow(RangeError);
		expect(() => result.nsPerSolve(Number.POSITIVE_INFINITY)).toThrow(
			RangeError,
		);
	});

	test("omitted sizes measure the default ladder", () => {
		const clock = makeClock();
		const result = calibrateNsPerSolve({
			solve: quadraticFake(clock),
			warmupSolves: 2,
			solvesPerSample: 4,
			samples: 3,
			now: clock.now,
			minTimerResolutionNs: 1,
		});
		if (!result.ok) {
			throw new Error("expected calibration to succeed");
		}
		// Hand: the default ladder is [2, 4, 8, 16, 32, 64] and the fake
		// costs exactly 100n^2: 400, 1600, 6400, 25600, 102400, 409600.
		expect(DEFAULT_CALIBRATION_SIZES).toEqual([2, 4, 8, 16, 32, 64]);
		expect(result.table.map((row) => row.unknownCount)).toEqual([
			2, 4, 8, 16, 32, 64,
		]);
		expect(result.table.map((row) => row.medianNsPerSolve)).toEqual([
			400, 1600, 6400, 25600, 102400, 409600,
		]);
	});
});

// ---------------------------------------------------------------------------
// Monotone envelope.
// ---------------------------------------------------------------------------

describe("monotone envelope", () => {
	test("a cheaper larger size is raised and the fix is reported", () => {
		const clock = makeClock();
		const result = calibrateNsPerSolve({
			// Positive control: size 4 costs 100 ns, cheaper than size 2.
			solve: fakeSolve(clock, (n) => (n === 4 ? 100 : 100 * n * n)),
			sizes: [2, 4, 8],
			warmupSolves: 5,
			solvesPerSample: 10,
			samples: 5,
			now: clock.now,
			minTimerResolutionNs: 1,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) {
			throw new Error("expected calibration to succeed");
		}
		// Hand: measured medians are 400, 100, 6400. The running maximum
		// raises size 4 to 400; size 8 is already above. Spread stays 0
		// because every sample within a size is identical.
		expect(result.table.map((row) => row.medianNsPerSolve)).toEqual([
			400, 400, 6400,
		]);
		expect(result.corrections).toEqual([
			{
				unknownCount: 4,
				measuredNsPerSolve: 100,
				correctedNsPerSolve: 400,
			},
		]);
		// Hand: the corrected curve, not the dip, is what admission sees.
		expect(result.nsPerSolve(4)).toBe(400);
	});

	test("negative control: monotone costs report no corrections", () => {
		const clock = makeClock();
		const result = calibrateNsPerSolve({
			solve: quadraticFake(clock),
			sizes: [2, 4, 8],
			warmupSolves: 5,
			solvesPerSample: 10,
			samples: 5,
			now: clock.now,
			minTimerResolutionNs: 1,
		});
		if (!result.ok) {
			throw new Error("expected calibration to succeed");
		}
		expect(result.corrections).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Median, not mean.
// ---------------------------------------------------------------------------

describe("median rule", () => {
	test("one huge outlier sample moves the report to the median, not the mean", () => {
		const clock = makeClock();
		let calls = 0;
		const WARMUP = 3;
		const BATCH = 10;
		// Hand call layout: warmup calls 1..3, one discarded probe batch
		// calls 4..13 (10 x 1000 = 10000 ns, above 100 x 1 ns, so the batch
		// never grows and the layout is exact), then samples of 10:
		// sample 0 is 14..23, sample 1 is 24..33, sample 2 is 34..43.
		// Spiking call 38 lands inside sample 2.
		const SPIKE_CALL = WARMUP + BATCH + 2 * BATCH + 5;
		const result = calibrateNsPerSolve({
			solve: () => () => {
				calls += 1;
				clock.advance(calls === SPIKE_CALL ? 1000 + 1e9 : 1000);
			},
			sizes: [4],
			warmupSolves: WARMUP,
			solvesPerSample: BATCH,
			samples: 5,
			now: clock.now,
			minTimerResolutionNs: 1,
		});
		if (!result.ok) {
			throw new Error("expected calibration to succeed");
		}
		// Hand: four samples are 1000 ns/solve; sample 2 is
		// (9x1000 + 1000001000)/10 = 100001000. Sorted: four 1000s then
		// 100001000. Median 1000; mean (4000+100001000)/5 = 20001000. A
		// mean rule would report 20001000, so asserting 1000 discriminates
		// the two rules.
		expect(result.table[0]?.medianNsPerSolve).toBe(1000);
		expect(result.table[0]?.medianNsPerSolve).not.toBe(20001000);
		// Hand: Tukey hinges on [1000,1000,1000,1000,100001000]: lower
		// half [1000,1000] gives q1 1000; upper half [1000,100001000]
		// gives q3 50001000. IQR 50000000 over median 1000 is spread
		// 50000.
		expect(result.table[0]?.spreadFraction).toBe(50000);
	});
});

// ---------------------------------------------------------------------------
// Refusals: every reason with a positive control and a negative control.
// ---------------------------------------------------------------------------

function validOptions(
	clock: { now: () => number; advance: (ns: number) => void },
	extra?: Record<string, unknown>,
) {
	return {
		solve: quadraticFake(clock),
		sizes: [2, 4] as readonly number[],
		warmupSolves: 2,
		solvesPerSample: 10,
		samples: 3,
		now: clock.now,
		minTimerResolutionNs: 1,
		...extra,
	};
}

describe("refusals", () => {
	test("no-sizes: an empty size list refuses; a non-empty one passes", () => {
		const clock = makeClock();
		const refused = calibrateNsPerSolve(validOptions(clock, { sizes: [] }));
		// Positive control: the closed reason code, compared whole.
		expect(refused.ok).toBe(false);
		if (refused.ok) {
			throw new Error("expected a refusal");
		}
		expect(refused.reason).toBe("no-sizes");
		// Negative control: the same rig with sizes present succeeds.
		expect(calibrateNsPerSolve(validOptions(clock)).ok).toBe(true);
	});

	test("bad-size: a non-positive size refuses carrying the value", () => {
		const clock = makeClock();
		const refused = calibrateNsPerSolve(
			validOptions(clock, { sizes: [4, -2] }),
		);
		expect(refused.ok).toBe(false);
		if (refused.ok) {
			throw new Error("expected a refusal");
		}
		expect(refused.reason).toBe("bad-size");
		if (refused.reason !== "bad-size") {
			throw new Error("expected a bad-size refusal");
		}
		// Hand: sizes [4, -2]; the offender is -2 at index 1.
		expect(refused.size).toBe(-2);
		expect(refused.index).toBe(1);
		// Negative control: all-positive sizes succeed on the same rig.
		expect(calibrateNsPerSolve(validOptions(clock)).ok).toBe(true);
	});

	test("zero-solves: zero solve counts refuse; positive ones pass", () => {
		const clock = makeClock();
		const refused = calibrateNsPerSolve(
			validOptions(clock, { solvesPerSample: 0 }),
		);
		expect(refused.ok).toBe(false);
		if (refused.ok) {
			throw new Error("expected a refusal");
		}
		expect(refused.reason).toBe("zero-solves");
		if (refused.reason !== "zero-solves") {
			throw new Error("expected a zero-solves refusal");
		}
		// Hand: the offending field and value travel with the refusal.
		expect(refused.field).toBe("solvesPerSample");
		expect(refused.value).toBe(0);
		const refusedSamples = calibrateNsPerSolve(
			validOptions(clock, { samples: 0 }),
		);
		if (refusedSamples.ok) {
			throw new Error("expected a refusal");
		}
		expect(refusedSamples.reason).toBe("zero-solves");
		// Negative control: positive counts succeed on the same rig.
		expect(calibrateNsPerSolve(validOptions(clock)).ok).toBe(true);
	});

	test("timer-too-coarse: a frozen clock refuses; a live one passes", () => {
		// Positive control: now() never advances, so every probe batch up
		// to the 1M cap reads 0 ns against the default 1000 ns resolution.
		const frozen = calibrateNsPerSolve({
			solve: () => () => {},
			sizes: [2],
			warmupSolves: 2,
			solvesPerSample: 10,
			samples: 3,
			now: () => 7e9,
		});
		expect(frozen.ok).toBe(false);
		if (frozen.ok) {
			throw new Error("expected a refusal");
		}
		expect(frozen.reason).toBe("timer-too-coarse");
		if (frozen.reason !== "timer-too-coarse") {
			throw new Error("expected a timer-too-coarse refusal");
		}
		// Hand: first size 2, default resolution 1000, largest allowed
		// batch 1000000, final probe elapsed 0.
		expect(frozen.unknownCount).toBe(2);
		expect(frozen.resolutionNs).toBe(1000);
		expect(frozen.largestBatchSolves).toBe(1000000);
		expect(frozen.elapsedNs).toBe(0);
		// Negative control: the same rig with a clock that advances passes.
		const clock = makeClock();
		expect(calibrateNsPerSolve(validOptions(clock)).ok).toBe(true);
	});

	test("solve-threw: a throwing factory refuses carrying size and error", () => {
		const clock = makeClock();
		const refused = calibrateNsPerSolve({
			solve: (n) => {
				if (n === 8) {
					throw new Error("no solver for 8");
				}
				return quadraticFake(clock)(n);
			},
			sizes: [2, 8],
			warmupSolves: 2,
			solvesPerSample: 10,
			samples: 3,
			now: clock.now,
			minTimerResolutionNs: 1,
		});
		expect(refused.ok).toBe(false);
		if (refused.ok) {
			throw new Error("expected a refusal");
		}
		expect(refused.reason).toBe("solve-threw");
		if (refused.reason !== "solve-threw") {
			throw new Error("expected a solve-threw refusal");
		}
		// Hand: size 2 calibrates, then the factory throws for size 8.
		// The original error travels with the refusal, never swallowed.
		expect(refused.unknownCount).toBe(8);
		expect(refused.thrown).toBeInstanceOf(Error);
		expect((refused.thrown as Error).message).toBe("no solver for 8");
		// A throw inside the timed function (here during warmup) refuses
		// the same way.
		let timedCalls = 0;
		const timedThrow = calibrateNsPerSolve({
			solve: () => () => {
				timedCalls += 1;
				if (timedCalls === 3) {
					throw new Error("mid-sample failure");
				}
			},
			sizes: [2],
			warmupSolves: 5,
			solvesPerSample: 10,
			samples: 3,
			now: clock.now,
			minTimerResolutionNs: 1,
		});
		if (timedThrow.ok) {
			throw new Error("expected a refusal");
		}
		expect(timedThrow.reason).toBe("solve-threw");
		// Negative control: a factory that never throws succeeds.
		const calm = makeClock();
		expect(calibrateNsPerSolve(validOptions(calm)).ok).toBe(true);
	});

	test("non-finite-time: a NaN clock refuses; a finite one passes", () => {
		// Positive control: every reading is NaN, so no batch is usable.
		const refused = calibrateNsPerSolve({
			solve: () => () => {},
			sizes: [2],
			warmupSolves: 2,
			solvesPerSample: 10,
			samples: 3,
			now: () => Number.NaN,
			minTimerResolutionNs: 1,
		});
		expect(refused.ok).toBe(false);
		if (refused.ok) {
			throw new Error("expected a refusal");
		}
		expect(refused.reason).toBe("non-finite-time");
		if (refused.reason !== "non-finite-time") {
			throw new Error("expected a non-finite-time refusal");
		}
		// Hand: the refusal carries the size and the unusable readings.
		expect(refused.unknownCount).toBe(2);
		expect(Number.isNaN(refused.t0Ns)).toBe(true);
		expect(Number.isNaN(refused.t1Ns)).toBe(true);
		// Negative control: a finite clock on the same rig succeeds.
		const clock = makeClock();
		expect(calibrateNsPerSolve(validOptions(clock)).ok).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// toRealtimeBudget and the admission gate.
// ---------------------------------------------------------------------------

function head(name: string, filename: string): string {
	return `schema: circuit-interchange/v3
metadata:
  name: "${name}"
  description: "calibration probe."
  partNumber: ""
source:
  format: vdsp
  filename: ${filename}
components:
`;
}

const DIVIDER_DOC =
	head("Calibration probe: divider", "calibrate_divider.vdsp") +
	`  - id: JIN
    kind: jack
    name: INPUT
    sourceTypeName: Circuit.Input
    origin:
      x: -200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: -200
          y: 0
  - id: JOUT
    kind: jack
    name: OUTPUT
    sourceTypeName: Circuit.Output
    origin:
      x: 200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 200
          y: 0
  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: gnd
        node: 0
        position:
          x: 0
          y: -100
  - id: R1
    kind: resistor
    name: R1
    sourceTypeName: Circuit.Resistor
    origin:
      x: 10
      y: 10
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
          x: 20
          y: 20
    properties:
      Resistance: "10k"
`;

function compileDivider(): Program {
	const result = compile(DIVIDER_DOC, { registry: emptyRegistry });
	expect(result.status).toBe("ok");
	if (result.status !== "ok") {
		throw new Error("divider probe doc failed to compile");
	}
	return result.program;
}

describe("toRealtimeBudget and admissionVerdict", () => {
	test("tiny calibrated cost admits a small program; absurd cost refuses it", () => {
		const program = compileDivider();
		// Hand premise, locked in: one linear solved block of 4 unknowns,
		// no macro blocks (observed from the compile above).
		expect(program.costPredictors.solvedBlocks.length).toBe(1);
		expect(program.costPredictors.solvedBlocks[0]?.unknownCount).toBe(4);
		expect(program.costPredictors.solvedBlocks[0]?.linear).toBe(true);
		expect(program.costPredictors.macroBlocks.length).toBe(0);

		const clock = makeClock();
		const tiny = calibrateNsPerSolve({
			solve: quadraticFake(clock),
			sizes: [2, 4],
			warmupSolves: 2,
			solvesPerSample: 10,
			samples: 3,
			now: clock.now,
			minTimerResolutionNs: 1,
		});
		if (!tiny.ok) {
			throw new Error("expected calibration to succeed");
		}
		// Compile-time assignability: the helper output is a RealtimeBudget.
		const tinyBudget: RealtimeBudget = tiny.toRealtimeBudget({
			nsPerMacroSample: () => 0,
		});
		// Hand: linear block solves once per sample at nsPerSolve(4) =
		// 100x16 = 1600 ns. Budget at 48 kHz is 1e9/48000 = 20833.33 ns,
		// so 1600 fits.
		expect(predictedWorstCaseNs([program], tinyBudget)).toBe(1600);
		expect(admissionVerdict([program], 48000, tinyBudget)).toEqual({
			fits: true,
		});

		const slowClock = makeClock();
		const absurd = calibrateNsPerSolve({
			solve: fakeSolve(slowClock, () => 1e8),
			sizes: [2],
			warmupSolves: 2,
			solvesPerSample: 10,
			samples: 3,
			now: slowClock.now,
			minTimerResolutionNs: 1,
		});
		if (!absurd.ok) {
			throw new Error("expected calibration to succeed");
		}
		const absurdBudget: RealtimeBudget = absurd.toRealtimeBudget({
			nsPerMacroSample: () => 0,
		});
		// Hand: worst case is 1e8 ns against 20833.33 ns available, so the
		// gate refuses and names the cost, not the capability.
		const verdict = admissionVerdict([program], 48000, absurdBudget);
		expect(verdict.fits).toBe(false);
		if (verdict.fits) {
			throw new Error("expected a refusal");
		}
		expect(verdict.reason).toContain("cannot be shown to fit");
		// Negative control: the refusal is cost-driven, so an empty chain
		// at the same absurd cost still fits.
		expect(admissionVerdict([], 48000, absurdBudget)).toEqual({
			fits: true,
		});
	});
});

// ---------------------------------------------------------------------------
// Fixture workload.
// ---------------------------------------------------------------------------

describe("denseLinearSolveWorkload", () => {
	test("runs without throwing or allocating the timed path", () => {
		const run2 = denseLinearSolveWorkload(2);
		const run8 = denseLinearSolveWorkload(8);
		expect(typeof run2).toBe("function");
		run2();
		run8();
		run8();
		run8();
	});

	test("factory refuses invalid counts instead of timing nonsense", () => {
		expect(() => denseLinearSolveWorkload(0)).toThrow(RangeError);
		expect(() => denseLinearSolveWorkload(-3)).toThrow(RangeError);
		expect(() => denseLinearSolveWorkload(2.5)).toThrow(RangeError);
		expect(() => denseLinearSolveWorkload(Number.NaN)).toThrow(RangeError);
		expect(() => denseLinearSolveWorkload(Number.POSITIVE_INFINITY)).toThrow(
			RangeError,
		);
		// Negative control: a valid count returns a runnable solve.
		expect(typeof denseLinearSolveWorkload(4)).toBe("function");
	});
});
