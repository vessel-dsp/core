// Taper evaluation: a 0..1 control position to a fraction of a track.
//
// This lives in the runtime rather than the compiler on purpose. Decision 2 of the
// pipeline plan says the taper is *emitted into the program* and resolved by whoever
// runs it -- never folded into coefficients at compile time, and never applied by a UI.
// Keeping the only implementation of the curve outside `src/compiler/` makes that
// unviolable by construction: a stage cannot evaluate a function it does not contain.
//
// Two front ends therefore cannot disagree about a knob's curve, because neither owns it.

import type { Program, TaperKind } from "@vessel-dsp/compiler";

/**
 * The tapers this runtime implements: the whole of `TaperKind`, and nothing else.
 *
 * A record, so a new `TaperKind` is a compile error here until someone decides whether this
 * console executes it; `satisfies` also rejects an entry `TaperKind` does not have. The C++
 * console's `parseTaperKind` holds the same five names and refuses everything else.
 */
const IMPLEMENTED_TAPERS = {
	linear: true,
	logarithmic: true,
	"reverse-logarithmic": true,
	"reverse-linear": true,
	"s-curve": true,
} as const satisfies Record<TaperKind, true>;

/** The closed vocabulary as text, for refusals that name what a console could have read. */
export const IMPLEMENTED_TAPER_NAMES: readonly string[] = Object.keys(IMPLEMENTED_TAPERS);

/**
 * A taper a program names and this runtime does not implement, and where it names it.
 *
 * `taper` is `string`, not `TaperKind`: a program that arrived through `decode` was cast from
 * JSON, so what it names is untrusted text from another producer, possibly a newer compiler.
 */
export type UnrecognisedTaper = {
	readonly where: string;
	readonly taper: string;
};

/**
 * Every taper in `program` that is not one of the five this runtime implements.
 *
 * **Why this exists: a taper string used to be read by falling through to linear.** An unknown
 * name played the wrong curve in silence on both consoles, which is the outcome the
 * console/ROM contract forbids ("an operator the runtime does not implement is a refusal that
 * names it, never silence"). `requiredOperators` cannot carry it: it is typed by stamp kind. So
 * the vocabulary is checked where the program is loaded, at the three places a program names a
 * taper -- a control, an MNA stamp, a macro or composed block's `clockControl` -- the same three
 * the C++ loader reads.
 */
export function unrecognisedTapers(program: Program): readonly UnrecognisedTaper[] {
	const found: UnrecognisedTaper[] = [];
	const check = (where: string, taper: unknown): void => {
		// A key that is absent names nothing, and both consoles read it as linear (the C++
		// loader's `readTaperKind`). Present and not one of the five, `null` and `""` included,
		// is a name this runtime does not implement.
		if (taper === undefined) return;
		if (typeof taper !== "string" || !Object.hasOwn(IMPLEMENTED_TAPERS, taper)) {
			found.push({ where, taper: String(taper) });
		}
	};
	for (const control of program.controls) {
		check(`control "${control.id}"`, control.taper);
	}
	for (const block of program.blocks) {
		if (block.kind === "mna") {
			for (const stamp of block.stamps) {
				if ("taper" in stamp) {
					check(`${stamp.kind} stamp in block "${block.id}"`, stamp.taper);
				}
			}
		} else if (block.clockControl != null) {
			check(`clockControl of block "${block.id}"`, block.clockControl.taper);
		}
	}
	return found;
}

/**
 * Alpha RV16AF W(4B), the one S-curve a vendor sheet on file prints (SP16050157 p. 4 section
 * 2.4, terminal 1-2, of the 300-degree rotation stated on p. 3 section 1.1):
 *
 *   90 +- 5 degrees   5-15 %   -> 0.30 of rotation, nominal 0.10
 *   150 degrees      40-60 %   -> 0.50 of rotation, nominal 0.50
 *   210 +- 5 degrees 85-95 %   -> 0.70 of rotation, nominal 0.90
 *
 * The sheet prints bands, not typicals; the nominal is each band's midpoint, the same rule that
 * puts the A taper at 0.175 (the midpoint of 10-25 %). **The shape between the points is an
 * engine convention, not a printed fact**: a monotone cubic Hermite (the PCHIP rule) through
 * (0, 0), (0.30, 0.10), (0.50, 0.50), (0.70, 0.90), (1, 1) with zero slope at the stops. Only the
 * printed points and the stops are claims; a piecewise-linear interpolant through the same five
 * points would read 0.033 where this reads 0.013 at 10 % of rotation, and the sheet cannot say
 * which is right.
 *
 * The interior slopes are the Fritsch-Butland weighted harmonic mean of the neighbouring
 * secants, computed once and written as literals so that this file and `Engine.cpp` evaluate
 * identical numbers in identical order (`taper.test.ts` re-derives them from the knots):
 *
 *   knot 0.30: h = (0.3, 0.2), secants (1/3, 2), weights (0.7, 0.8): 1.5 / (2.1 + 0.4) = 0.6
 *   knot 0.50: equal secants of 2: 2
 *   knot 0.70: the mirror of 0.30: 0.6
 *
 * The curve is odd about the centre (`f(1 - x) = 1 - f(x)`), so which end of the track a
 * lug sits on does not change the law, only the orientation, which is a separate claim.
 * No `pow` and no libm: only `+ - * /`, so the two consoles agree bit for bit.
 */
const S_CURVE_SEGMENTS = [
	{ x0: 0, h: 0.3, y0: 0, y1: 0.1, m0: 0, m1: 0.6 },
	{ x0: 0.3, h: 0.2, y0: 0.1, y1: 0.5, m0: 0.6, m1: 2 },
	{ x0: 0.5, h: 0.2, y0: 0.5, y1: 0.9, m0: 2, m1: 0.6 },
	{ x0: 0.7, h: 0.3, y0: 0.9, y1: 1, m0: 0.6, m1: 0 },
] as const;

function sCurveFraction(x: number): number {
	// The stops are exact, and each interior knot is the t = 0 of its own segment, so the
	// three printed midpoints come back as exactly 0.1, 0.5 and 0.9.
	if (x <= 0) return 0;
	if (x >= 1) return 1;
	const segment = x < 0.3 ? 0 : x < 0.5 ? 1 : x < 0.7 ? 2 : 3;
	const { x0, h, y0, y1, m0, m1 } = S_CURVE_SEGMENTS[segment];
	const t = (x - x0) / h;
	const t2 = t * t;
	const t3 = t2 * t;
	const h00 = 2 * t3 - 3 * t2 + 1;
	const h10 = t3 - 2 * t2 + t;
	const h01 = -2 * t3 + 3 * t2;
	const h11 = t3 - t2;
	return h00 * y0 + h10 * h * m0 + h01 * y1 + h11 * h * m1;
}

/**
 * The fraction of the track at `position`, clamped to 0..1.
 *
 * `reverse-linear` is a real track (`klon-centaur`, `vemuram-jan-ray`) and is not the
 * same device as `reverse-logarithmic`: it is linear travelling the other way, so half
 * rotation is half the track rather than a tenth of it.
 *
 * A taper outside the five implemented is read as linear here only because this is a pure
 * function with no way to refuse; a program is refused before it can reach it
 * (`unrecognisedTapers`, checked at `prepare()`).
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
	if (taper === "s-curve") {
		return sCurveFraction(x);
	}
	return x;
}
