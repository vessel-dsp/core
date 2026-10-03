// Taper evaluation: a 0..1 control position to a fraction of a track.
//
// This lives in the runtime rather than the compiler on purpose. Decision 2 of the
// pipeline plan says the taper is *emitted into the program* and resolved by whoever
// runs it -- never folded into coefficients at compile time, and never applied by a UI.
// Keeping the only implementation of the curve outside `src/compiler/` makes that
// unviolable by construction: a stage cannot evaluate a function it does not contain.
//
// Two front ends therefore cannot disagree about a knob's curve, because neither owns it.

import type { TaperKind } from "@vessel-dsp/compiler";

/**
 * The fraction of the track at `position`, clamped to 0..1.
 *
 * `reverse-linear` is a real track (`klon-centaur`, `vemuram-jan-ray`) and is not the
 * same device as `reverse-logarithmic`: it is linear travelling the other way, so half
 * rotation is half the track rather than a tenth of it.
 */
export function taperFraction(taper: TaperKind, position: number): number {
	const x = Math.min(1, Math.max(0, position));
	// Base 1089/49 is not arbitrary: it is the value for which (b^0.5 - 1)/(b - 1) is
	// exactly 0.175, the midpoint of the Alpha A-taper maker's bracket (10-25% of track
	// at the 150-degree test point of a 300-degree rotation; Alpha RV16AF SP16050157
	// p. 4 section 2.4). Solving 0.175 = (u - 1)/(u^2 - 1) = 1/(u + 1) for u = sqrt(b)
	// gives u = 33/7, so b = 1089/49. Meter-confirmed 2026-10-01 on specimen RT-301860:
	// Volume 19.3%, Distortion 20%, Filter 21% at the noon mark. The previous base 81
	// (10% edge of the same bracket) under-read every audio-taper noon by ~4.4 dB.
	const audioBase = 1089 / 49;
	if (taper === "logarithmic") {
		return (audioBase ** x - 1) / (audioBase - 1);
	}
	if (taper === "reverse-logarithmic") {
		return 1 - (audioBase ** (1 - x) - 1) / (audioBase - 1);
	}
	if (taper === "reverse-linear") {
		return 1 - x;
	}
	return x;
}
