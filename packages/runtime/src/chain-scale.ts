// The chain's level convention: multiply between slots by the ratio of declared full-scale
// voltages, per the signal-chain plan
// (thoughts/shared/plans/2026-08-21-signal-chain-and-amp-output-stage.md) §3.1 —
//
//   x_normalized(slot n+1) = y_normalized(slot n) * (fullScale(out n) / fullScale(in n+1))
//
// **Unity, not a refusal, when either side is `null`.** A program that declares no supply
// gives `Program.ports` nothing to derive a ceiling from — see `../compiler/port-full-
// scale.ts` — and the chain still has to produce audio: it is not wrong to play it, only
// unable to say the boundary's level is correct. `chainScaleAdvisories` is the visible half
// of that (structured, matching `../runtime/supply-ground.ts`'s pattern rather than a
// console.warn), so a host can surface it without the render itself refusing.

import type { Program } from "@vessel-dsp/compiler";

/**
 * Pure arithmetic: the multiplier `ChainRuntime` applies to one boundary's samples, from the
 * two adjacent ports' full-scale voltages. `null` on either side is unity — see this
 * module's header for why that is not a refusal.
 */
export function chainScaleFactor(
	outFullScaleVolts: number | null,
	inFullScaleVolts: number | null,
): number {
	if (outFullScaleVolts === null || inFullScaleVolts === null) {
		return 1;
	}
	return outFullScaleVolts / inFullScaleVolts;
}

/** One boundary where the chain fell back to unity because a full scale was `null`. */
export type ChainScaleAdvisory = {
	/** The boundary sits between this slot and the next. */
	readonly slot: number;
	readonly message: string;
};

/**
 * Every boundary in an ordered chain where at least one side's full-scale voltage is `null`,
 * so `ChainRuntime` applied unity there instead of the declared ratio.
 *
 * Mirrors `supplyGroundConflicts`'s shape deliberately: a chain-level fact, computed from
 * the programs alone, carried alongside a successful load rather than blocking one.
 */
export function chainScaleAdvisories(
	programs: readonly Program[],
): readonly ChainScaleAdvisory[] {
	const advisories: ChainScaleAdvisory[] = [];
	for (let slot = 0; slot < programs.length - 1; slot++) {
		const out = programs[slot]?.portFullScaleVolts.output ?? null;
		const nextIn = programs[slot + 1]?.portFullScaleVolts.input ?? null;
		if (out === null || nextIn === null) {
			advisories.push({
				slot,
				message:
					`slot ${slot}'s output or slot ${slot + 1}'s input declares no full-scale ` +
					"voltage (its program declares no supply), so the chain applies unity " +
					"scaling at this boundary instead of the declared ratio",
			});
		}
	}
	return advisories;
}

/**
 * The multiplier the **worklet** applies to the chain's last slot before the samples reach the
 * DAC, so a program that swings to its supply rail does not peg the output against it.
 *
 * **This lives here because it was living in exactly one place and that place was not reachable
 * from a report.** It was inline in `src/web/v2-audio-worklet.ts`, which no instrument imports, so
 * every corpus measurement was taken on the program's output in volts while the app played that
 * output divided by up to 558.61 (`marshall-1959-super-lead-plexi`). A packet could read a healthy
 * 5e-3 V and reach the speaker at -101 dBFS. Both halves have to read the same rule or the
 * measurement is not of the product.
 *
 * Unity below 1.0 V rather than a gain: this normalises a rail down, it never boosts a quiet
 * program up to meet the ceiling.
 */
export function dacScaleFactor(fullScaleOutVolts: number | null): number {
	return fullScaleOutVolts !== null && fullScaleOutVolts > 1.0 ? 1.0 / fullScaleOutVolts : 1.0;
}

/**
 * A program's output level in the domain a listener is in: dBFS at the DAC, after
 * `dacScaleFactor`.
 *
 * **Volts and dBFS are not interchangeable and the corpus has been treating them as if they
 * were.** `report-input-dependence.ts`'s `AUDIBLE_FLOOR` comment reconciles its absolute-volts bar
 * against a tier's `-50 dBFS` one by taking "full scale 1.0" -- true of no packet in the corpus,
 * where the declared full scale runs 4.5 V to 558.61 V. Converted through the rule the app
 * actually applies, a single volts threshold is a different dBFS bar for every packet: 1e-3 V is
 * -60 dBFS at full scale 1.0, -79 dBFS on a 9 V pedal and -115 dBFS on the plexi.
 */
export function outputDbfs(rmsVolts: number, fullScaleOutVolts: number | null): number {
	return 20 * Math.log10(Math.max(rmsVolts * dacScaleFactor(fullScaleOutVolts), 1e-12));
}

/**
 * The number a level conversion divides an output by: the port's declared 0 dBFS
 * reference where it states one, the derived ceiling otherwise.
 *
 * These are different quantities -- `link.ts` says so and keeps them apart -- and a folding
 * consumer has to pick the one its question needs. A conversion into a level (a +/-1 file,
 * a DAC scale, a dBFS audibility judgement) wants the **reference** where a source states it:
 * it is what the source says full scale *means* rather than what the node can reach, and it
 * is the only number at all for a preamp monitor tap with no transformer between it and the
 * rail. `render-v2-audio.ts` used to inline this rule; one copy is load-bearing, because the
 * worklet's DAC scale and a report's dBFS floor have to read the same number the file any
 * listener hears is converted by.
 */
export function outputConversionFullScale(
	program: Pick<Program, "portFullScaleVolts" | "portReferenceVolts">,
): number | null {
	const declared = program.portReferenceVolts.output;
	return declared !== null && declared > 0
		? declared
		: program.portFullScaleVolts.output;
}
