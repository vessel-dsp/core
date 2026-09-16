// Contract for the settling policy (../settle.ts): the module must hold exactly ONE definition of
// "the level stopped moving", and every entry point must use it.
//
// **This exists because "give the rule one home" turned out to be necessary and not sufficient.**
// `settle.ts` was created to stop each instrument rediscovering its own settling rule, and it did
// -- while itself carrying two implementations of that rule. `measureSettled` centred each window;
// the settling loops inside `measureInputAttributable` and `measureSettledSignal` squared the raw
// samples. A module can satisfy the letter of consolidation and still contain the disagreement it
// was created to remove, and nothing detected that for as long as the two spellings agreed on the
// circuits anyone happened to look at.
//
// What separates them is a circuit whose DC is still moving after its AC has arrived. The fixture
// below is that shape, synthesised rather than borrowed from the corpus: a steady sine plus a
// decaying offset, through a plain resistive divider that passes both. Measured against the two
// criteria directly, an 8 s offset tail settles at **1.5 s** centred and **30.5 s** uncentred --
// and under the ladder as it stood, the uncentred path would have returned "never settled" at all.
//
// So a future refactor that reintroduces a second criterion fails here immediately, which is the
// same guard applied twice elsewhere today: assert that two paths agree on a case whose answer is
// known independently of either.

import { describe, expect, it } from "bun:test";
import { compile } from "@vessel-dsp/compiler";
import { pedalPartCatalog } from "@vessel-dsp/compiler";
import { resistorDivider } from "../compiler/fixtures/circuits";
import {
	SETTLE_DEFAULTS,
	SettleRefusal,
	measureSettled,
	measureSettledSignal,
	settledLevel,
	settledRender,
	settledSweep,
	settledSweepVerified,
	sweepMatchesIndependent,
} from "@vessel-dsp/runtime";

const SAMPLE_RATE = 48_000;

/** A resistive divider: no reactance, so the stimulus shape reaches the output unchanged. */
function dividerProgram() {
	const result = compile(resistorDivider, { registry: pedalPartCatalog });
	if (result.status !== "ok") throw new Error(`fixture did not compile: ${result.status}`);
	return result.program;
}

/** Steady tone from the first sample, plus an offset that decays over `tauSeconds`. */
const toneWithOffsetTail =
	(tauSeconds: number) =>
	(index: number): number =>
		0.2 * Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE) +
		5 * Math.exp(-index / (SAMPLE_RATE * tauSeconds));

describe("settling policy", () => {
	it("uses one criterion: both entry points settle a steady tone at the same point", () => {
		const program = dividerProgram();
		const tone = (index: number) => 0.2 * Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE);

		expect(measureSettled(program, SAMPLE_RATE, tone).settleSeconds).toBe(
			measureSettledSignal(program, SAMPLE_RATE, tone).settleSeconds,
		);
	});

	it("uses one criterion when the DC is still moving after the AC has arrived", () => {
		const program = dividerProgram();

		// The discriminating case. Under two criteria these disagreed by a factor of twenty.
		for (const tau of [3, 8]) {
			const stimulus = toneWithOffsetTail(tau);
			expect(measureSettled(program, SAMPLE_RATE, stimulus).settleSeconds).toBe(
				measureSettledSignal(program, SAMPLE_RATE, stimulus).settleSeconds,
			);
		}
	});

	it("measures the level about the mean, so a DC pedestal is not counted as audio", () => {
		const program = dividerProgram();
		const tone = (index: number) => 0.2 * Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE);
		const offsetTone = (index: number) => tone(index) + 3;

		const plain = measureSettled(program, SAMPLE_RATE, tone).rms;
		const offset = measureSettled(program, SAMPLE_RATE, offsetTone).rms;
		expect(plain).not.toBeNull();
		expect(offset).not.toBeNull();
		// A constant pedestal changes the mean, never the level about it.
		expect(offset!).toBeCloseTo(plain!, 10);
	});

	it("gives the ladder a top rung the corpus cannot reach", () => {
		// A maximum equal to the observed population maximum cannot distinguish "settled at the
		// last rung" from "never settled" -- both produce the same row. The rung above is what
		// makes a maximum reading meaningful rather than ambiguous.
		const ladder = SETTLE_DEFAULTS.ladderSeconds;
		const slowestObserved = 16;
		expect(ladder[ladder.length - 1]!).toBeGreaterThan(slowestObserved);
	});
});

// The shortest-path helper (`settledRender` / `settledLevel`) exists because four ad-hoc probes on
// 2026-09-10 rendered fixed windows shorter than the packet's settle time and produced four false
// findings. Its contract has two halves and both are load-bearing: it must agree with the module's
// existing entry points, and it must REFUSE rather than return a level it could not settle.
describe("settledRender, the shortest path to a level", () => {
	const tone = { hz: 440, drive: 0.2, sampleRate: SAMPLE_RATE };

	it("agrees with measureSettled: the same policy, not a second copy", () => {
		const program = dividerProgram();
		const viaHelper = settledRender(program, tone);
		const viaModule = measureSettled(program, SAMPLE_RATE, (index) =>
			0.2 * Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE),
		);

		expect(viaHelper.status).toBe("settled");
		expect(viaModule.settleSeconds).not.toBeNull();
		if (viaHelper.status !== "settled" || viaModule.settleSeconds === null) return;
		expect(viaHelper.seconds).toBe(viaModule.settleSeconds);
		expect(viaHelper.rms).toBeCloseTo(viaModule.rms ?? Number.NaN, 12);
	});

	it("hands back the settled window itself, so spectral work runs on settled audio", () => {
		const program = dividerProgram();
		const result = settledRender(program, tone);

		expect(result.status).toBe("settled");
		if (result.status !== "settled") return;
		expect(result.tail.length).toBe(Math.round(SETTLE_DEFAULTS.windowSeconds * SAMPLE_RATE));
		// The tail is the window the level was read from, so its own rms must be that level.
		let sum = 0;
		for (const v of result.tail) sum += v;
		const dc = sum / result.tail.length;
		let square = 0;
		for (const v of result.tail) square += (v - dc) ** 2;
		expect(Math.sqrt(square / result.tail.length)).toBeCloseTo(result.rms, 12);
	});

	// The half that matters. A criterion nothing can satisfy must produce a refusal, never a
	// number: `stableDb: 0` makes `Math.abs(diff) < 0` false for every window pair.
	const impossible = {
		...tone,
		settle: { ...SETTLE_DEFAULTS, stableDb: 0, ladderSeconds: [1] },
	};

	it("refuses rather than returning a level it could not settle", () => {
		const result = settledRender(dividerProgram(), impossible);

		expect(result.status).toBe("unsettled");
		if (result.status !== "unsettled") return;
		expect(result.triedSeconds).toBe(1);
		expect(result.windows.length).toBeGreaterThan(0);
	});

	it("throws from settledLevel on that refusal, so a scratch script stops rather than reports", () => {
		expect(() => settledLevel(dividerProgram(), impossible)).toThrow(SettleRefusal);
		// And returns the bare number on the path that does settle.
		expect(settledLevel(dividerProgram(), tone)).toBeGreaterThan(0);
	});
});

// `settledSweep` trades independence for speed: one runtime, settled once, then walked through the
// control settings. Worth 6.7x on `marshall-jcm800` and nothing on a packet already at the settling
// floor -- so the contract to guard is not the saving, it is that the answers still match the
// independent ones on a circuit without memory, and that the order check can tell.
describe("settledSweep, paying the start-up transient once", () => {
	const tone = { hz: 440, drive: 0.2, sampleRate: SAMPLE_RATE };

	it("agrees with independent settled renders on a memoryless circuit", () => {
		const program = dividerProgram();
		// A divider has no state to carry, so sweeping and restarting must agree exactly.
		const points: (readonly [string, number])[][] = [[], []];
		const swept = settledSweep(program, points, tone);
		const independent = points.map(() => settledRender(program, tone));

		expect(swept).toHaveLength(2);
		swept.forEach((result, i) => {
			const alone = independent[i];
			expect(result.status).toBe("settled");
			if (result.status !== "settled" || alone?.status !== "settled") return;
			expect(result.rms).toBeCloseTo(alone.rms, 12);
		});
	});

	// An order check was the WRONG question and is kept out of the contract deliberately: on
	// `boss-lm-2` it answered "order-independent: true" while the sweep was wrong by 84 dB,
	// because a shared initial settle poisons every point equally rather than unequally.
	it("verifies against independent renders, not against a reversed sweep", () => {
		expect(sweepMatchesIndependent(dividerProgram(), [[], []], tone)).toBe(true);
	});

	it("accepts the shared runtime on a memoryless circuit", () => {
		const { results, shared } = settledSweepVerified(dividerProgram(), [[], []], tone);
		expect(shared).toBe(true);
		expect(results).toHaveLength(2);
	});
});
