// dbx-style VCA law v4+v5: session-calibrated threshold/rest gain +
// state-dependent release (v4) plus victim-dependent shutdown (v5,
// session-8 fit below).
//
// The numbers are the NEC uPC1252 feature line (control constant -5.9 mV/dB,
// Av -30dB~+30dB) and the 12-point session threshold sweep (sine 1 kHz at
// 10/30/100/300 mV across sus-min/centre/sus-max, nominal jack volts,
// loopback-verified 0.02 dB) the v4 fit is joint against (worst residual
// 0.7 dB). The law's own voltage gain reads the session dB directly: the
// fixture divider is unity by construction (Rin 14.2k, Ro 14.3k, 100 ohm
// input), so a render here IS the law gain, and the pedal's fixed stages net
// out of the comparison the fit was built on.
//
// Rest coupling is inverted vs the naive reading (rest gain RISES with the GC
// node: sustainGain -4.23 against sustainRef 4.6504 V maps the
// engine-measured V70 rest span 4.6325->4.6728 onto the session rest gains)
// with the session curves quoted as the cause on the catalog entry; the old
// -6.8 dB SUSTAIN response is gone on purpose. The detector knee tracks the
// GC node (+4.36 V/V) so sus-min stays flat to 300 mV while centre and
// sus-max engage progressively. Release TC varies with suppression depth
// (50 ms near the top, minutes-slow from deep suppression): a fixed 50 ms
// everywhere is refuted by the session (burst pips annihilated after HOT
// history yet passing after MILD history across the same 3 s gap), so no
// fixed-release fallback may reappear here. releaseSlowdown is the explicit
// fit hook for the hot-start + 60 s trailing-tone take, which does not exist
// yet.
//
// v5 adds the session-8 victim-dependent shutdown on top of the untouched v4
// above: a fast peak-holder pumped only by hot peaks while primed (silence
// builds the prime over ~10 s, signal disarms in fractions of a second) and
// bled only by sustained signal (fast under tone, frozen in silence). The
// post-gap pip crushes in-stimulus to 0.007x the mild-history pip and the
// probe tone sits at baseline flat from +1 s -- a depth-only release clears
// slowly everywhere-post-hot (v4 creeps 1.6x/27 s), which session 8 refutes.
// The priming starts at zero, so render onsets and continuous tones never
// pump: the v4 threshold fit is structurally untouched (the 12-point sweep
// below pins it).

import { describe, expect, it } from "bun:test";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import {
	dbxVcaCell,
	dbxVcaPedalChain,
} from "@vessel-dsp/compiler/fixtures/circuits";
import {
	dbxVcaDcLevelHot,
	dbxVcaDcLevelMid,
	dbxVcaDcRestCentre,
	dbxVcaDcRestMax,
	dbxVcaDcRestMin,
	dbxVcaDcSusMaxHot,
	dbxVcaPedalDcSusCentre,
	dbxVcaPedalDcSusMax,
	dbxVcaPedalDcSusMaxHot,
	dbxVcaPedalDcSusMin,
} from "@vessel-dsp/compiler/fixtures/expected";
import {
	dbxVcaEnvelopeK,
	dbxVcaEnvelopeTerms,
	dbxVcaGainDb,
	dbxVcaGainLinear,
	dbxVcaKneeVolts,
	dbxVcaPrimeTarget,
	dbxVcaReleaseTc,
	dbxVcaRestTerms,
	dbxVcaShutdownTarget,
	dbxVcaVictimTc,
	ReferenceRuntime,
} from "../src/index";
import { V2WasmEngine } from "../src/v2-wasm-engine";
import { WASM_SKIP_REASON, wasmBinaryPresent } from "./wasm-presence";

// Engine-measured GC rests at the three SUSTAIN settings (declared
// defaults; the SUSTAIN 0->1 rest span quoted on the catalog entry).
const REST_MIN = 4.6325;
const REST_CENTRE = 4.6581;
const REST_MAX = 4.6728;

// Session hardware threshold curves (dB, sine 1 kHz, 10/30/100/300 mV):
// centre and sus-max HW numbers, sus-min flat (hand-take -14.5 noted).
const SESSION_DB: Record<number, readonly [number, number, number, number]> = {
	[REST_CENTRE]: [5.68, 4.89, -5.13, -14.45],
	[REST_MAX]: [14.28, 5.09, -5.08, -14.4],
	[REST_MIN]: [-13.2, -13.2, -13.2, -13.2],
};
const SESSION_LEVELS = [0.01, 0.03, 0.1, 0.3] as const;

describe("dbxVcaRestTerms", () => {
	it("inverts the naive reading: rest gain rises with the GC node", () => {
		// sustainGain -4.23 against sustainRef 4.6504 V: above the ref the
		// terms go negative (gain up), below they go positive (gain down).
		// The session curves force this shape (sus-max +14.28 dB vs sus-min
		// -13.2 dB at 10 mV in); a control-follows-detector law gets the
		// sign backwards and parks sus-max at the floor.
		expect(dbxVcaRestTerms(REST_MIN, -4.23, 4.6504)).toBeGreaterThan(0);
		expect(dbxVcaRestTerms(REST_CENTRE, -4.23, 4.6504)).toBeLessThan(0);
		expect(dbxVcaRestTerms(REST_MAX, -4.23, 4.6504)).toBeLessThan(
			dbxVcaRestTerms(REST_CENTRE, -4.23, 4.6504),
		);
	});

	it("maps the rest span onto the session rest gains", () => {
		// Rest alone (no envelope at 10 mV) through 5.9 mV/dB lands within
		// half a dB of the session 10 mV takes; the envelope only trims
		// sus-max (knee +0.03 V there admits ~0.013 V at 10 mV).
		expect(-dbxVcaRestTerms(REST_MIN, -4.23, 4.6504) / 0.0059).toBeCloseTo(-12.83, 0);
		expect(-dbxVcaRestTerms(REST_CENTRE, -4.23, 4.6504) / 0.0059).toBeCloseTo(5.52, 0);
		expect(-dbxVcaRestTerms(REST_MAX, -4.23, 4.6504) / 0.0059).toBeCloseTo(16.06, 0);
	});
});

describe("dbxVcaKneeVolts", () => {
	it("tracks the GC node so one knee cannot serve all three settings", () => {
		// Knee -0.069 V at V70 4.65 rising 4.36 V/V: sus-min -0.145 V,
		// centre -0.034 V, sus-max +0.030 V. A fixed knee cannot sit above
		// 300 mV-equivalent (sus-min flat) and near 10 mV (sus-max hot) at
		// once -- the 30 mV-off (centre) vs 30 mV-on (sus-max) pair proves it.
		expect(dbxVcaKneeVolts(REST_MIN, -0.069, 4.36)).toBeCloseTo(-0.1453, 3);
		expect(dbxVcaKneeVolts(REST_CENTRE, -0.069, 4.36)).toBeCloseTo(-0.0337, 3);
		expect(dbxVcaKneeVolts(REST_MAX, -0.069, 4.36)).toBeCloseTo(0.0304, 3);
	});

	it("puts the engage point near 30 mV at centre and near 10 mV at sus-max", () => {
		// Zero-crossing of the envelope: slope 0.049 V/neper against the
		// knee. iIn per source volt is 100/14300*0.01 = 6.993e-5 A/V.
		const engageVolts = (rest: number): number => {
			const knee = dbxVcaKneeVolts(rest, -0.069, 4.36);
			return Math.exp(-knee / 0.049) / 1e6 / 6.993e-5;
		};
		expect(engageVolts(REST_CENTRE)).toBeGreaterThan(0.02);
		expect(engageVolts(REST_CENTRE)).toBeLessThan(0.05);
		expect(engageVolts(REST_MAX)).toBeGreaterThan(0.005);
		expect(engageVolts(REST_MAX)).toBeLessThan(0.015);
		expect(engageVolts(REST_MIN)).toBeGreaterThan(0.2);
	});
});

describe("dbxVcaEnvelopeTerms", () => {
	it("holds rest gain below the knee and adds a fixed dB per decade above", () => {
		// At centre rest (knee -0.034 V): 10 mV in sits below the knee
		// (terms 0), each decade above adds slope*ln(10) = 0.113 V of terms
		// (~19 dB of reduction per decade).
		expect(dbxVcaEnvelopeTerms(0.01 * 6.993e-5, 0.049, -0.0337)).toBe(0);
		const at100mV = dbxVcaEnvelopeTerms(0.1 * 6.993e-5, 0.049, -0.0337);
		const at1V = dbxVcaEnvelopeTerms(1.0 * 6.993e-5, 0.049, -0.0337);
		expect(at100mV).toBeGreaterThan(0);
		expect(at1V - at100mV).toBeCloseTo(0.049 * Math.log(10), 12);
	});

	it("rectifies: either half-cycle drives toward reduction, silence reads zero", () => {
		expect(dbxVcaEnvelopeTerms(0.001, 0.049, 0)).toBe(
			dbxVcaEnvelopeTerms(-0.001, 0.049, 0),
		);
		expect(dbxVcaEnvelopeTerms(0, 0.049, -0.0337)).toBe(0);
	});
});

describe("dbxVcaReleaseTc", () => {
	it("is fast near the top and minutes-slow from deep suppression", () => {
		// The session-3 immediacy end and the cross-take persistence end on
		// one curve: 50 ms at depth 0, 120 s at depth 1 (0.05 * 2400).
		expect(dbxVcaReleaseTc(0, 0.05, 2400)).toBeCloseTo(0.05, 12);
		expect(dbxVcaReleaseTc(1, 0.05, 2400)).toBeCloseTo(120, 9);
		expect(dbxVcaReleaseTc(0.5, 0.05, 2400)).toBeCloseTo(0.05 * Math.sqrt(2400), 9);
	});

	it("clamps the depth to [0, 1] instead of running away", () => {
		expect(dbxVcaReleaseTc(-0.5, 0.05, 2400)).toBeCloseTo(0.05, 12);
		expect(dbxVcaReleaseTc(2, 0.05, 2400)).toBeCloseTo(120, 9);
	});

	it("pins the fit hook the hot-start take will recalibrate", () => {
		// releaseSlowdown 2400 is the one free number: the hot-start + 60 s
		// trailing-tone take does not exist yet, and when it lands this is
		// what moves. A fixed 50 ms fallback is refuted -- this must stay a
		// depth-varying curve, not a constant wearing a parameter's clothes.
		expect(dbxVcaReleaseTc(1, 0.05, 2400)).toBeGreaterThan(
			100 * dbxVcaReleaseTc(0, 0.05, 2400),
		);
	});
});

describe("dbxVcaGainDb", () => {
	it("reads 0 dB at zero terms", () => {
		expect(dbxVcaGainDb(0, -30, 30)).toBeCloseTo(0, 12);
	});

	it("is millivolt-sensitive: 5.9 mV moves a dB", () => {
		expect(dbxVcaGainDb(0.0059, -30, 30)).toBeCloseTo(-1, 9);
		expect(dbxVcaGainDb(-0.0059, -30, 30)).toBeCloseTo(1, 9);
	});

	it("matches the LM-2 deck's control law", () => {
		// `gain_db = -v(ctrl)/0.0059` with control against center.
		expect(dbxVcaGainDb(0.1, -30, 30)).toBeCloseTo(-0.1 / 0.0059, 9);
	});

	it("clamps to the datasheet +-30 dB range instead of running away", () => {
		expect(dbxVcaGainDb(-2, -30, 30)).toBe(30);
		expect(dbxVcaGainDb(2, -30, 30)).toBe(-30);
		// A volt of envelope alone pins the floor.
		expect(dbxVcaGainDb(1, -30, 30)).toBe(-30);
	});

	it("falls monotonically as terms rise", () => {
		let previous = Infinity;
		for (let terms = -0.1; terms <= 0.15; terms += 0.01) {
			const gain = dbxVcaGainDb(terms, -30, 30);
			expect(gain).toBeLessThan(previous);
			previous = gain;
		}
	});

	it("fails if the law were linear in control", () => {
		// The mutant this pins: a proportional gain law barely notices
		// 10 mV. Ten millivolts of terms must already move more than a dB.
		expect(dbxVcaGainDb(0.01, -30, 30)).toBeLessThan(-1);
		expect(dbxVcaGainDb(-0.01, -30, 30)).toBeGreaterThan(1);
	});
});

describe("dbxVcaGainLinear", () => {
	it("converts dB to voltage gain", () => {
		expect(dbxVcaGainLinear(0)).toBeCloseTo(1, 12);
		expect(dbxVcaGainLinear(-6)).toBeCloseTo(0.5011872336272722, 9);
		expect(dbxVcaGainLinear(20)).toBeCloseTo(10, 12);
		expect(dbxVcaGainLinear(-30)).toBeCloseTo(0.0316227766016838, 9);
	});
});

describe("dbxVcaEnvelopeK", () => {
	it("matches the one-pole smoothing coefficient", () => {
		expect(dbxVcaEnvelopeK(0.05, 48000)).toBeCloseTo(
			1 - Math.exp(-1 / 2400),
			12,
		);
		expect(dbxVcaEnvelopeK(0.0005, 48000)).toBeCloseTo(
			1 - Math.exp(-1 / 24),
			12,
		);
	});

	it("tracks immediately for a non-positive time constant", () => {
		expect(dbxVcaEnvelopeK(0, 48000)).toBe(1);
		expect(dbxVcaEnvelopeK(-1, 48000)).toBe(1);
	});
});

describe("dbx-style VCA transfer: session-calibrated rest plus log envelope", () => {
	// Hand-computed against the fixture (see `dbxVcaDc*` in fixtures/expected):
	// the divider is unity by construction, so renders read the law's own
	// voltage gain `10^(dc/20)` with the session-fitted rest plus log-domain
	// envelope. DC inputs settle both followers exactly, so these are exact
	// closed forms. A law edit that moves the rest coupling, the knee, the
	// envelope slope, the divisor, or the clamp rails fails here rather than
	// surfacing as a silent level or depth defect in a pedal.
	const dcGain = (controlVolts: number, inputVolts: number): number => {
		const result = compile(dbxVcaCell(controlVolts), {
			registry: pedalPartCatalog,
		});
		if (result.status !== "ok") {
			throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
		}
		const runtime = new ReferenceRuntime(result.program);
		runtime.prepare(48_000);
		// 0.3 s settle: release-dominated points (target below the zero
		// start) converge with the 50 ms release TC, so a 0.1 s window
		// leaves them measurably unsettled.
		const length = 14400;
		const input = new Float64Array(length).fill(inputVolts);
		const output = runtime.process(input);
		let inSum = 0;
		let outSum = 0;
		const window = 2400;
		for (let index = length - window; index < length; index += 1) {
			inSum += input[index] ?? 0;
			outSum += output[index] ?? 0;
		}
		return outSum / window / (inSum / window);
	};

	it("pins the SUSTAIN-coupled rest trio to its closed forms", () => {
		expect(dcGain(REST_MIN, 0.01)).toBeCloseTo(dbxVcaDcRestMin, 2);
		expect(dcGain(REST_CENTRE, 0.01)).toBeCloseTo(dbxVcaDcRestCentre, 2);
		expect(dcGain(REST_MAX, 0.01)).toBeCloseTo(dbxVcaDcRestMax, 2);
		expect(dcGain(REST_MIN, 0.01)).toBeLessThan(dcGain(REST_CENTRE, 0.01));
		expect(dcGain(REST_CENTRE, 0.01)).toBeLessThan(dcGain(REST_MAX, 0.01));
	});

	it("compresses: gain falls as DC input level rises at static control", () => {
		expect(dcGain(REST_CENTRE, 0.1)).toBeCloseTo(dbxVcaDcLevelMid, 2);
		expect(dcGain(REST_CENTRE, 0.3)).toBeCloseTo(dbxVcaDcLevelHot, 2);
		expect(dcGain(REST_MAX, 0.3)).toBeCloseTo(dbxVcaDcSusMaxHot, 2);
		expect(dcGain(REST_CENTRE, 0.01)).toBeGreaterThan(dcGain(REST_CENTRE, 0.1));
		expect(dcGain(REST_CENTRE, 0.1)).toBeGreaterThan(dcGain(REST_CENTRE, 0.3));
	});
});

describe("dbx-vca session threshold curves", () => {
	// The calibration's acceptance shape: sine 1 kHz renders at the three
	// engine-measured GC rests against the 12 session hardware takes. The
	// pre-calibration engine sat ~8-19 dB low at the quiet end (centre
	// 10/30 mV rendered -2.17/-3.25 dB against HW +5.68/+4.89 dB); this sweep
	// fails on that law and passes on the fitted one. Hot points (100/300 mV)
	// must stay within ~4 dB of HW -- regressions there fail the task even if
	// the quiet end closes.
	const sineGainDb = (controlVolts: number, amplitude: number): number => {
		const result = compile(dbxVcaCell(controlVolts), {
			registry: pedalPartCatalog,
		});
		if (result.status !== "ok") {
			throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
		}
		const runtime = new ReferenceRuntime(result.program);
		runtime.prepare(48_000);
		const length = 48000;
		const input = new Float64Array(length);
		for (let index = 0; index < length; index += 1) {
			input[index] =
				amplitude * Math.sin((2 * Math.PI * 1000 * index) / 48_000);
		}
		const output = runtime.process(input);
		let inPeak = 0;
		let outPeak = 0;
		for (let index = length >> 1; index < length; index += 1) {
			inPeak = Math.max(inPeak, Math.abs(input[index] ?? 0));
			outPeak = Math.max(outPeak, Math.abs(output[index] ?? 0));
		}
		return 20 * Math.log10(outPeak / inPeak);
	};

	it("renders the 12-point session sweep within 1.5 dB per point", () => {
		// Joint-fit worst residual is 0.7 dB; 1.5 dB leaves solver headroom
		// while staying an order of magnitude inside the pre-calibration
		// quiet-end gaps (+8/+8/+2/+3 centre, +19/+11/+4/+6 sus-max).
		for (const rest of [REST_MIN, REST_CENTRE, REST_MAX] as const) {
			const hw = SESSION_DB[rest];
			SESSION_LEVELS.forEach((level, index) => {
				const eng = sineGainDb(rest, level);
				expect(Math.abs(eng - (hw[index] ?? 0))).toBeLessThan(1.5);
			});
		}
	});

	it("closes the quiet end: centre 10/30 mV agree hot instead of sitting 8 dB low", () => {
		const hw = SESSION_DB[REST_CENTRE];
		expect(Math.abs(sineGainDb(REST_CENTRE, 0.01) - (hw[0] ?? 0))).toBeLessThan(1.5);
		expect(Math.abs(sineGainDb(REST_CENTRE, 0.03) - (hw[1] ?? 0))).toBeLessThan(1.5);
	});

	it("keeps hot agreement: 100/300 mV stay within the task's 4 dB bar", () => {
		for (const rest of [REST_MIN, REST_CENTRE, REST_MAX] as const) {
			const hw = SESSION_DB[rest];
			expect(Math.abs(sineGainDb(rest, 0.1) - (hw[2] ?? 0))).toBeLessThan(4);
			expect(Math.abs(sineGainDb(rest, 0.3) - (hw[3] ?? 0))).toBeLessThan(4);
		}
	});

	it("holds sus-min flat to 300 mV while centre and sus-max engage progressively", () => {
		// The knee-tracking shape: sus-min spreads <1 dB across the sweep
		// (HW flat -13.2), centre drops ~20 dB, sus-max ~28 dB.
		const susMin = SESSION_LEVELS.map((level) => sineGainDb(REST_MIN, level));
		expect(Math.max(...susMin) - Math.min(...susMin)).toBeLessThan(1);
		const centre = SESSION_LEVELS.map((level) => sineGainDb(REST_CENTRE, level));
		expect(centre[0]! - (centre[3] ?? 0)).toBeGreaterThan(15);
		const susMax = SESSION_LEVELS.map((level) => sineGainDb(REST_MAX, level));
		expect(susMax[0]! - (susMax[3] ?? 0)).toBeGreaterThan(20);
		for (let index = 1; index < susMax.length; index += 1) {
			expect(susMax[index] ?? 0).toBeLessThan(susMax[index - 1] ?? 0);
		}
	});
});

describe("dbx-vca state-dependent release", () => {
	// Session bounds: (a) burst pips annihilated (~0.0002) at sus-max after
	// HOT history while sines stay alive (0.196); (b) the same pips pass
	// (0.013-0.023) after MILD history; (c) no visible slope either way at
	// 10 ms resolution; (d) the hot-start + 60 s trailing-tone take does not
	// exist yet. So: recovery from deep suppression must be orders of
	// magnitude slower than from mild suppression (bounded below by the 3 s
	// pip gap plus cross-take persistence), finite (it moves toward rest,
	// not stuck), and the mild end must recover promptly (session-3
	// immediacy). DC steps stand in for the pip history here: the followers
	// see the same suppression depth either way, and the cell has no reactive
	// parts, so the measured time course is the law's release curve alone.
	const releaseCourse = (
		controlVolts: number,
		historyVolts: number,
		probeVolts: number,
	): { at: (seconds: number) => number; restDb: number } => {
		const render = (historyFill: number): { input: Float64Array; output: Float64Array } => {
			const result = compile(dbxVcaCell(controlVolts), {
				registry: pedalPartCatalog,
			});
			if (result.status !== "ok") {
				throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
			}
			const runtime = new ReferenceRuntime(result.program);
			runtime.prepare(48_000);
			const sampleRate = 48000;
			const historyLength = sampleRate;
			const probeLength = Math.round(3.2 * sampleRate);
			const input = new Float64Array(historyLength + probeLength);
			input.fill(historyFill, 0, historyLength);
			input.fill(probeVolts, historyLength, historyLength + probeLength);
			return { input, output: runtime.process(input) };
		};
		const sampleRate = 48000;
		const historyLength = sampleRate;
		const { input, output } = render(historyVolts);
		const windowDb = (
			renderInput: Float64Array,
			renderOutput: Float64Array,
			start: number,
		): number => {
			let inSum = 0;
			let outSum = 0;
			const window = 2400;
			for (let index = start; index < start + window; index += 1) {
				inSum += renderInput[index] ?? 0;
				outSum += renderOutput[index] ?? 0;
			}
			return 20 * Math.log10(outSum / inSum);
		};
		// Rest gain is empirical, not a re-typed constant: the settled probe
		// gain with no hot history (its own render, so no law numbers are
		// duplicated here -- the catalog stays the single source of truth).
		const settled = render(probeVolts);
		const restDb = windowDb(
			settled.input,
			settled.output,
			historyLength + Math.round(3.0 * sampleRate),
		);
		return {
			at: (seconds: number) =>
				windowDb(input, output, historyLength + Math.round(seconds * sampleRate)),
			restDb,
		};
	};

	it("recovers from mild suppression within half a second (fast end)", () => {
		// Centre rest, 50 mV history: suppression depth ~0.2, TC ~0.2 s.
		const course = releaseCourse(REST_CENTRE, 0.05, 0.01);
		expect(course.at(0.5)).toBeCloseTo(course.restDb, 0);
	});

	it("stays suppressed across the 3 s pip gap after hot history (slow end)", () => {
		// Sus-max rest, 1 V history: depth 1, TC 120 s. After the full pip
		// gap the probe is still >15 dB below rest, having recovered <5 dB
		// from onset -- the session's annihilated pips, bounded below.
		const course = releaseCourse(REST_MAX, 1.0, 0.01);
		const onset = course.at(0.05);
		expect(course.restDb - onset).toBeGreaterThan(30);
		expect(course.restDb - course.at(3.0)).toBeGreaterThan(15);
		expect(course.at(3.0) - onset).toBeLessThan(5);
	});

	it("deep recovery is finite and orders of magnitude slower than fast recovery", () => {
		const deep = releaseCourse(REST_MAX, 1.0, 0.01);
		const fast = releaseCourse(REST_CENTRE, 0.05, 0.01);
		// Finite: the deep probe moves monotonically toward rest, not stuck.
		expect(deep.at(0.5)).toBeGreaterThan(deep.at(0.05));
		expect(deep.at(3.0)).toBeGreaterThan(deep.at(0.5));
		// Order-of-magnitude bar in recovered fraction of the dB gap: fast
		// is >=90% home by 0.5 s, deep is <=10% home at 3 s.
		const recoveredFraction = (
			course: { at: (seconds: number) => number; restDb: number },
			seconds: number,
		): number =>
			(course.at(seconds) - course.at(0.05)) / (course.restDb - course.at(0.05));
		expect(recoveredFraction(fast, 0.5)).toBeGreaterThan(0.9);
		expect(recoveredFraction(deep, 3.0)).toBeLessThan(0.1);
	});
});

describe.skipIf(!wasmBinaryPresent)(
	"dbx-vca cross-console agreement",
	() => {
		it(`renders DC and sine transfer identically on both consoles (${WASM_SKIP_REASON || "wasm present"})`, async () => {
			const check = async (
				controlVolts: number,
				input: Float64Array,
			): Promise<{ correlation: number; maxDelta: number }> => {
				const result = compile(dbxVcaCell(controlVolts), {
					registry: pedalPartCatalog,
				});
				if (result.status !== "ok") {
					throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
				}
				const ts = new ReferenceRuntime(result.program);
				ts.prepare(48_000);
				const tsOut = ts.process(input);

				const wasm = await V2WasmEngine.create(result.program);
				wasm.prepare({ sampleRate: 48000, maxNewtonIterations: 1024 });
				const wasmOut = new Float32Array(input.length);
				wasm.processBlock(Float32Array.from(input), wasmOut);
				wasm.destroy();

				const from = input.length >> 1;
				let sumT = 0;
				let sumW = 0;
				let sumTT = 0;
				let sumWW = 0;
				let sumTW = 0;
				let maxDelta = 0;
				const count = input.length - from;
				for (let index = from; index < input.length; index += 1) {
					const t = tsOut[index] ?? 0;
					const w = wasmOut[index] ?? 0;
					sumT += t;
					sumW += w;
					sumTT += t * t;
					sumWW += w * w;
					sumTW += t * w;
					maxDelta = Math.max(maxDelta, Math.abs(t - w));
				}
				const denom = Math.sqrt(
					Math.max(0, count * sumTT - sumT * sumT) *
						Math.max(0, count * sumWW - sumW * sumW),
				);
				const correlation =
					denom === 0 ? 1 : (count * sumTW - sumT * sumW) / denom;
				return { correlation, maxDelta };
			};

			// DC input sweep point: exercises the settled smoothed followers.
			// maxDelta only, no correlation bar: a settled DC render has no
			// variance, so correlation divides rounding noise by rounding
			// noise (measured 0.99987/1.00007 at maxDelta ~2e-9 -- codegen
			// luck, not agreement). maxDelta at 1e-4 is the operative bar
			// and currently clears it by ~50,000x.
			const dc = new Float64Array(4800).fill(2);
			const dcAgreement = await check(REST_CENTRE, dc);
			expect(dcAgreement.maxDelta).toBeLessThan(1e-4);

			// Rest-offset DC point: the pedal's deep-suppression region.
			// maxDelta only, same ill-conditioning note as above.
			const dcRest = new Float64Array(4800).fill(0.5);
			const dcRestAgreement = await check(REST_MAX, dcRest);
			expect(dcRestAgreement.maxDelta).toBeLessThan(1e-4);

			// Sine sweep point: exercises the attack/release limit cycle.
			const sine = new Float64Array(4800);
			for (let index = 0; index < sine.length; index += 1) {
				sine[index] = 2 * Math.sin((2 * Math.PI * 1000 * index) / 48_000);
			}
			const sineAgreement = await check(REST_CENTRE, sine);
			expect(sineAgreement.correlation).toBeGreaterThan(0.9999);
			expect(sineAgreement.maxDelta).toBeLessThan(1e-4);
		});

		it("agrees on the session spot points and the slow-release end", async () => {
			const renderDb = async (
				controlVolts: number,
				input: Float64Array,
				settleFrom: number,
			): Promise<{ tsDb: number; wasmDb: number }> => {
				const result = compile(dbxVcaCell(controlVolts), {
					registry: pedalPartCatalog,
				});
				if (result.status !== "ok") {
					throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
				}
				const ts = new ReferenceRuntime(result.program);
				ts.prepare(48_000);
				const tsOut = ts.process(input);
				const wasm = await V2WasmEngine.create(result.program);
				wasm.prepare({ sampleRate: 48000, maxNewtonIterations: 1024 });
				const wasmOut = new Float32Array(input.length);
				wasm.processBlock(Float32Array.from(input), wasmOut);
				wasm.destroy();
				const peak = (out: ArrayLike<number>): number => {
					let peak = 0;
					for (let index = settleFrom; index < input.length; index += 1) {
						peak = Math.max(peak, Math.abs(out[index] ?? 0));
					}
					return peak;
				};
				let inPeak = 0;
				for (let index = settleFrom; index < input.length; index += 1) {
					inPeak = Math.max(inPeak, Math.abs(input[index] ?? 0));
				}
				return {
					tsDb: 20 * Math.log10(peak(tsOut) / inPeak),
					wasmDb: 20 * Math.log10(peak(wasmOut) / inPeak),
				};
			};

			// Session spot points: centre 10 mV (rest-dominated) and sus-max
			// 300 mV (deep-suppression end) read the session dB on both
			// consoles within headroom the float32 console can hold.
			const spot = async (
				controlVolts: number,
				amplitude: number,
				hwDb: number,
			): Promise<void> => {
				const length = 48000;
				const input = new Float64Array(length);
				for (let index = 0; index < length; index += 1) {
					input[index] =
						amplitude * Math.sin((2 * Math.PI * 1000 * index) / 48_000);
				}
				const { tsDb, wasmDb } = await renderDb(controlVolts, input, length >> 1);
				expect(Math.abs(tsDb - hwDb)).toBeLessThan(1.5);
				expect(Math.abs(wasmDb - hwDb)).toBeLessThan(2);
			};
			await spot(REST_CENTRE, 0.01, 5.68);
			await spot(REST_MAX, 0.3, -14.4);

			// Slow-release end on the compiled console: hot history then a
			// 10 mV probe is still >15 dB below rest 3 s later, matching the
			// TS-console bound above (the 3 s pip gap, bounded below).
			const historyLength = 48000;
			const probeLength = Math.round(3.2 * 48000);
			const input = new Float64Array(historyLength + probeLength);
			input.fill(1.0, 0, historyLength);
			input.fill(0.01, historyLength, historyLength + probeLength);
			const { tsDb, wasmDb } = await renderDb(
				REST_MAX,
				input,
				historyLength + Math.round(3.0 * 48000),
			);
			const susMaxRestDb = SESSION_DB[REST_MAX]?.[0] ?? 0;
			expect(susMaxRestDb - tsDb).toBeGreaterThan(15);
			expect(susMaxRestDb - wasmDb).toBeGreaterThan(15);
		});
	},
);

describe("dbxVcaPrimeTarget", () => {
	it("is 1 in silence and 0 under any session signal", () => {
		expect(dbxVcaPrimeTarget(0, 5e-7)).toBe(1);
		expect(dbxVcaPrimeTarget(1e-9, 5e-7)).toBe(1);
		// The quietest session tone (10 mV in ~= 0.7 uA) counts as signal.
		expect(dbxVcaPrimeTarget(7e-7, 5e-7)).toBe(0);
		expect(dbxVcaPrimeTarget(-0.001, 5e-7)).toBe(0);
	});
});

describe("dbxVcaShutdownTarget", () => {
	it("is zero below threshold, quadratic above, gated by prime", () => {
		// Below the diode-forward-plus-headroom threshold: no gulp.
		expect(dbxVcaShutdownTarget(0.02, 0.08, 1, 28)).toBe(0);
		expect(dbxVcaShutdownTarget(0.08, 0.08, 1, 28)).toBe(0);
		// Above: quadratic in the excess (the diode exponential over range).
		expect(dbxVcaShutdownTarget(0.18, 0.08, 1, 28)).toBeCloseTo(
			28 * 0.1 * 0.1,
			12,
		);
		// Unprimed (render onsets, continuous tones): no pump whatever the peak.
		expect(dbxVcaShutdownTarget(0.18, 0.08, 0, 28)).toBe(0);
		// Prime clamps at 1 rather than scaling without bound.
		expect(dbxVcaShutdownTarget(0.18, 0.08, 2, 28)).toBeCloseTo(
			28 * 0.1 * 0.1,
			12,
		);
	});

	it("sizes the session-8 crush: post-gap hot excess pumps ~0.25 V of terms", () => {
		// Post-gap hot peak (sus-max 0.3 V: log-target ~0.18 V) against the
		// 0.08 V threshold at full prime: ~0.28 V of shutdown terms, i.e.
		// ~-48 dB on top of the linear gain -- the annihilated-pip regime
		// (session 8: 0.007x mild; sessions 1/2: 0.005-0.01x).
		const terms = dbxVcaShutdownTarget(0.18, 0.08, 0.95, 28);
		expect(terms).toBeGreaterThan(0.15);
		expect(terms).toBeLessThan(0.35);
		// A mild peak after a gap stays small (graded priming, not annihilation).
		const mild = dbxVcaShutdownTarget(0.067, 0.08, 0.95, 28);
		expect(mild).toBe(0);
		// Ripple never pumps even fully primed (0.022 V log-domain ripple).
		expect(dbxVcaShutdownTarget(0.022, 0.08, 1, 28)).toBe(0);
	});
});

describe("dbxVcaVictimTc", () => {
	it("is fast once the prime disarms and frozen while primed", () => {
		expect(dbxVcaVictimTc(0, 0.025, 300)).toBeCloseTo(0.025, 12);
		expect(dbxVcaVictimTc(0.04, 0.025, 300)).toBeCloseTo(0.025, 12);
		expect(dbxVcaVictimTc(1, 0.025, 300)).toBe(300);
		expect(dbxVcaVictimTc(0.5, 0.025, 300)).toBe(300);
		// Clamps rather than running away.
		expect(dbxVcaVictimTc(-1, 0.025, 300)).toBeCloseTo(0.025, 12);
		expect(dbxVcaVictimTc(2, 0.025, 300)).toBe(300);
	});
});

describe("dbx-style VCA pedal chain: session-coupled control plus LEVEL output", () => {
	// The chain reads the law through the pedal's own biasing (V70 span on
	// the control node, LEVEL divider on the output) rather than the bare
	// cell. DC inputs settle every follower exactly (priming starts at zero
	// and signal holds it there, so the shutdown is identically zero), so
	// these are exact closed forms pinning the chain wiring. LEVEL 1.
	const chainDcGain = (sustainPos: number, inputVolts: number): number => {
		const result = compile(dbxVcaPedalChain(sustainPos, 1), {
			registry: pedalPartCatalog,
		});
		if (result.status !== "ok") {
			throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
		}
		const runtime = new ReferenceRuntime(result.program);
		runtime.prepare(48_000);
		const length = 14400;
		const input = new Float64Array(length).fill(inputVolts);
		const output = runtime.process(input);
		let inSum = 0;
		let outSum = 0;
		const window = 2400;
		for (let index = length - window; index < length; index += 1) {
			inSum += input[index] ?? 0;
			outSum += output[index] ?? 0;
		}
		return outSum / window / (inSum / window);
	};

	it("renders the SUSTAIN-coupled rest trio to its closed forms", () => {
		expect(chainDcGain(0, 0.01)).toBeCloseTo(dbxVcaPedalDcSusMin, 2);
		expect(chainDcGain(0.5, 0.01)).toBeCloseTo(dbxVcaPedalDcSusCentre, 2);
		expect(chainDcGain(1, 0.01)).toBeCloseTo(dbxVcaPedalDcSusMax, 2);
	});

	it("renders the sus-max hot point to its closed form", () => {
		expect(chainDcGain(1, 0.3)).toBeCloseTo(dbxVcaPedalDcSusMaxHot, 2);
	});

	it("divides by two at LEVEL 0.5 (linear pot, exact loading)", () => {
		const result = compile(dbxVcaPedalChain(1, 0.5), {
			registry: pedalPartCatalog,
		});
		if (result.status !== "ok") {
			throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
		}
		const runtime = new ReferenceRuntime(result.program);
		runtime.prepare(48_000);
		const length = 14400;
		const input = new Float64Array(length).fill(0.01);
		const output = runtime.process(input);
		let inSum = 0;
		let outSum = 0;
		const window = 2400;
		for (let index = length - window; index < length; index += 1) {
			inSum += input[index] ?? 0;
			outSum += output[index] ?? 0;
		}
		const half = outSum / window / (inSum / window);
		expect(half).toBeCloseTo(chainDcGain(1, 0.01) / 2, 2);
	});
});

describe("dbx-vca session-8 victim shutdown on the pedal program", () => {
	// Session 8 (hotgap stimulus, sus-max throughout): 20 s-class hot history
	// (3 s here -- the followers settle in ms; the gap is the load-bearing
	// part), 30 s silence, ONE hot pip, 30 s probe. The post-gap pip must
	// crush to ~0.01x the mild-history pip (order bar [0.002, 0.05];
	// hardware 0.007-0.008x, sessions 1/2 0.005-0.01x) and the probe tone
	// must sit at baseline flat from +1 s (hardware: 1.000x, cleared in
	// <1 s; v4 creeps 1.6x/27 s). Runs on the pedal chain (SUSTAIN-coupled
	// control plus LEVEL output), not the bare cell.
	const SR = 48000;
	const HOT = 0.3;
	const MILD = 0.03;

	const renderChain = (
		segments: readonly { secs: number; amp: number }[],
	): Float64Array => {
		const result = compile(dbxVcaPedalChain(1, 1), {
			registry: pedalPartCatalog,
		});
		if (result.status !== "ok") {
			throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
		}
		const runtime = new ReferenceRuntime(result.program);
		runtime.prepare(SR);
		const total = Math.round(
			segments.reduce((acc, s) => acc + s.secs, 0) * SR,
		);
		const input = new Float64Array(total);
		let offset = 0;
		for (const s of segments) {
			const n = Math.round(s.secs * SR);
			for (let i = 0; i < n; i++) {
				input[offset + i] =
					s.amp * Math.sin((2 * Math.PI * 1000 * (offset + i)) / SR);
			}
			offset += n;
		}
		return runtime.process(input);
	};
	const windowRms = (out: Float64Array, from: number, to: number): number => {
		const a = Math.round(from * SR);
		const b = Math.round(to * SR);
		let sum = 0;
		let count = 0;
		for (let i = a; i < b; i++) {
			sum += (out[i] ?? 0) * (out[i] ?? 0);
			count++;
		}
		return Math.sqrt(sum / count);
	};

	// Shared fixtures, rendered once per suite run: the session-8 protocol,
	// the mild-history pip, and the settled baseline.
	let session: Float64Array | null = null;
	let mildRef: Float64Array | null = null;
	let baseline: Float64Array | null = null;
	const fixtures = (): {
		session: Float64Array;
		mildRef: Float64Array;
		baseline: Float64Array;
	} => {
		if (session === null) {
			session = renderChain([
				{ secs: 3, amp: HOT },
				{ secs: 30, amp: 0 },
				{ secs: 0.05, amp: HOT },
				{ secs: 30, amp: HOT },
			]);
		}
		if (mildRef === null) {
			mildRef = renderChain([
				{ secs: 3, amp: MILD },
				{ secs: 0.05, amp: HOT },
			]);
		}
		if (baseline === null) {
			baseline = renderChain([{ secs: 3, amp: HOT }]);
		}
		return { session, mildRef, baseline };
	};

	it("crushes the post-gap pip to ~0.01x the mild-history pip", () => {
		const { session, mildRef } = fixtures();
		// Settled crush (tail window, excluding the sub-ms charge transient):
		// the in-stimulus collapse the session confirms.
		const pipTail = windowRms(session, 33.02, 33.05);
		const mildTail = windowRms(mildRef, 3.02, 3.05);
		const ratio = pipTail / mildTail;
		expect(ratio).toBeGreaterThan(0.002);
		expect(ratio).toBeLessThan(0.05);
	}, 300_000);

	it("holds the crush through the pip (in-stimulus, both ends settled)", () => {
		const { session, mildRef } = fixtures();
		const early = windowRms(session, 33.01, 33.02) / windowRms(mildRef, 3.01, 3.02);
		const late = windowRms(session, 33.04, 33.05) / windowRms(mildRef, 3.04, 3.05);
		// No order-of-magnitude recovery across the pip: the shutdown holds
		// while primed rather than bleeding into the pip tail.
		expect(late / early).toBeGreaterThan(0.3);
		expect(late / early).toBeLessThan(3);
	}, 300_000);

	it("clears to baseline flat by +1 s with no creep over 30 s", () => {
		const { session, baseline } = fixtures();
		const base = windowRms(baseline, 2, 3);
		const probeMean = windowRms(session, 34.05, 63.05);
		expect(20 * Math.log10(probeMean / base)).toBeGreaterThan(-1);
		expect(20 * Math.log10(probeMean / base)).toBeLessThan(1);
		let lo = Infinity;
		let hi = 0;
		for (let t = 34.05; t < 63; t += 1) {
			const w = windowRms(session, t, t + 1);
			lo = Math.min(lo, w);
			hi = Math.max(hi, w);
		}
		expect(20 * Math.log10(hi / lo)).toBeLessThan(1);
	}, 300_000);

	it("passes the mild-history pip uncrushed", () => {
		const { mildRef, baseline } = fixtures();
		const mild = windowRms(mildRef, 3.02, 3.05);
		const base = windowRms(baseline, 2, 3);
		// Mild history never primes (P stays 0): the hot pip after it must
		// read within 3 dB of the settled hot level, not crushed.
		expect(20 * Math.log10(mild / base)).toBeGreaterThan(-3);
		expect(20 * Math.log10(mild / base)).toBeLessThan(3);
	}, 300_000);
});

describe("dbx-vca session-6/7 no-regression cells on the pedal program", () => {
	// Session 6 (tone-after-hot at baseline) and session 7
	// (pip-after-continuous-hot at hot level): neither may move under the v5
	// law, which only pumps post-gap transients (priming starts at zero).
	const SR = 48000;
	const renderChain = (
		segments: readonly { secs: number; amp: number }[],
	): Float64Array => {
		const result = compile(dbxVcaPedalChain(1, 1), {
			registry: pedalPartCatalog,
		});
		if (result.status !== "ok") {
			throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
		}
		const runtime = new ReferenceRuntime(result.program);
		runtime.prepare(SR);
		const total = Math.round(
			segments.reduce((acc, s) => acc + s.secs, 0) * SR,
		);
		const input = new Float64Array(total);
		let offset = 0;
		for (const s of segments) {
			const n = Math.round(s.secs * SR);
			for (let i = 0; i < n; i++) {
				input[offset + i] =
					s.amp * Math.sin((2 * Math.PI * 1000 * (offset + i)) / SR);
			}
			offset += n;
		}
		return runtime.process(input);
	};
	const windowRms = (out: Float64Array, from: number, to: number): number => {
		const a = Math.round(from * SR);
		const b = Math.round(to * SR);
		let sum = 0;
		let count = 0;
		for (let i = a; i < b; i++) {
			sum += (out[i] ?? 0) * (out[i] ?? 0);
			count++;
		}
		return Math.sqrt(sum / count);
	};

	it("tone-after-hot reads baseline (session 6)", () => {
		const cont = renderChain([{ secs: 5, amp: 0.3 }]);
		const settled = windowRms(cont, 4, 5);
		const fresh = renderChain([{ secs: 3, amp: 0.3 }]);
		const base = windowRms(fresh, 2, 3);
		expect(20 * Math.log10(settled / base)).toBeGreaterThan(-1);
		expect(20 * Math.log10(settled / base)).toBeLessThan(1);
	});

	it("pip-after-continuous-hot passes at hot level (session 7)", () => {
		const out = renderChain([
			{ secs: 5, amp: 0.3 },
			{ secs: 0.05, amp: 0.3 },
		]);
		const steady = windowRms(out, 4, 5);
		const pip = windowRms(out, 5.02, 5.05);
		expect(20 * Math.log10(pip / steady)).toBeGreaterThan(-2);
		expect(20 * Math.log10(pip / steady)).toBeLessThan(2);
	});
});

describe.skipIf(!wasmBinaryPresent)(
	"dbx-vca session-8 victim shutdown cross-console",
	() => {
		// The session-8 protocol on the compiled console: post-gap pip crush
		// ratio, probe baseline agreement, and flatness must match the TS
		// console within headroom the float32 console can hold (ratios, not
		// bit-identity: the shutdown is exponentially sensitive by design).
		const SR = 48000;
		const HOT = 0.3;
		const MILD = 0.03;

		const renderWasm = async (
			segments: readonly { secs: number; amp: number }[],
		): Promise<Float32Array> => {
			const result = compile(dbxVcaPedalChain(1, 1), {
				registry: pedalPartCatalog,
			});
			if (result.status !== "ok") {
				throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
			}
			const wasm = await V2WasmEngine.create(result.program);
			wasm.prepare({ sampleRate: SR, maxNewtonIterations: 1024 });
			const total = Math.round(
				segments.reduce((acc, s) => acc + s.secs, 0) * SR,
			);
			const input = new Float32Array(total);
			let offset = 0;
			for (const s of segments) {
				const n = Math.round(s.secs * SR);
				for (let i = 0; i < n; i++) {
					input[offset + i] =
						s.amp * Math.sin((2 * Math.PI * 1000 * (offset + i)) / SR);
				}
				offset += n;
			}
			const out = new Float32Array(total);
			wasm.processBlock(input, out);
			wasm.destroy();
			return out;
		};
		const windowRms = (out: ArrayLike<number>, from: number, to: number): number => {
			const a = Math.round(from * SR);
			const b = Math.round(to * SR);
			let sum = 0;
			let count = 0;
			for (let i = a; i < b; i++) {
				sum += (out[i] ?? 0) * (out[i] ?? 0);
				count++;
			}
			return Math.sqrt(sum / count);
		};

		it(`session-8 crush and clear agree on both consoles (${WASM_SKIP_REASON || "wasm present"})`, async () => {
			const out = await renderWasm([
				{ secs: 3, amp: HOT },
				{ secs: 30, amp: 0 },
				{ secs: 0.05, amp: HOT },
				{ secs: 30, amp: HOT },
			]);
			const mild = await renderWasm([
				{ secs: 3, amp: MILD },
				{ secs: 0.05, amp: HOT },
			]);
			const base = await renderWasm([{ secs: 3, amp: HOT }]);
			const pipTail = windowRms(out, 33.005, 33.05);
			const mildTail = windowRms(mild, 3.005, 3.05);
			const ratio = pipTail / mildTail;
			expect(ratio).toBeGreaterThan(0.001);
			expect(ratio).toBeLessThan(0.08);
			const baseline = windowRms(base, 2, 3);
			const probeMean = windowRms(out, 34.05, 63.05);
			expect(20 * Math.log10(probeMean / baseline)).toBeGreaterThan(-1.5);
			expect(20 * Math.log10(probeMean / baseline)).toBeLessThan(1.5);
			let lo = Infinity;
			let hi = 0;
			for (let t = 34.05; t + 2 <= 63.05; t += 2) {
				const w = windowRms(out, t, t + 2);
				lo = Math.min(lo, w);
				hi = Math.max(hi, w);
			}
			expect(20 * Math.log10(hi / lo)).toBeLessThan(1.5);
		}, 300_000);
	},
);
