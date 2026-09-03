// A potentiometer's taper: the resistance law along its track, and the values that state it.
//
// **Why this needs a vocabulary.** Taper is audible -- it is how a knob's travel maps to its
// effect -- and the corpus states it three incompatible ways across *two* keys. Measured over 142
// documents and 609 potentiometers:
//
//   `Taper`  264 declarations, 30 distinct values
//   `Sweep`  397 declarations, 16 distinct values
//   both on the same component: 57
//
// Those 57 are the proof that the two keys are one fact: `Taper: B` sits beside `Sweep: Linear`
// 26 times, `Taper: A` beside `Sweep: Logarithmic` 8 times, `Taper: C` beside
// `Sweep: ReverseLogarithmic` or `ReverseAudio` 7 times. One is the manufacturer's letter code,
// the other the law's English name. **`Taper` is the canonical key and `Sweep` is superseded.**
//
// **The canonical values are the law, not the notation, and letter codes are deliberately not
// accepted.** `A`, `B` and `C` are manufacturer markings whose meaning is a convention rather
// than a definition -- the mapping above is the Japanese/Alps convention this corpus happens to
// use, and it is not universal. Reading a printed marking as a law would be exactly the inference
// this format is removing elsewhere. The marking is source provenance and belongs in a source
// property beside the rest of what the part is printed with; the law goes here.
//
// **Three classes of existing value are not tapers at all**, and `classifyTaper` reports them
// separately because the fix differs:
//
//   provenance   `source-unmarked`, `Unknown`, `not-visible`, `source-unspecified` -- these say
//                the source did not state a taper. The fix is to omit the property, not to
//                invent a value for absence.
//   form factor  `trim`/`Trim` -- a trimmer is a physical package, not a resistance law. A trim
//                pot still has a taper, usually linear, and this value states neither.
//   range        `0..1` -- a travel range, not a law.

import type { Component } from "./types";
import { normalizeToken } from "./tokens";

/**
 * The resistance laws a potentiometer track may follow.
 *
 * **Spellings are taken from `KnobTaper` in `panel/types.ts`, which shipped first.** That enum is
 * published API with consumers in `control-ui` and panel extraction, and it already names three
 * of these laws `linear`, `log` and `reverse-log`. Defining a second spelling for the same fact
 * here -- `logarithmic` was the first draft -- would have created exactly the two-vocabularies
 * drift this work exists to remove, inside the same package. The corpus writes `Logarithmic`, so
 * it is the corpus that backfills; a published enum with consumers is the stronger constraint.
 *
 * `log` is the law audio parts also print as "audio", and `reverse-log` the one printed as
 * "reverse audio", "anti-log" or "negative log". Those are synonyms rather than spellings, so
 * they are not accepted: a document naming one is a document to correct.
 *
 * `custom` is a real, distinct curve with no published form -- a wah's Hot Potz, a Boss G or W
 * taper. It says "there is a law here and it is none of the above", which is true where
 * inventing `log` would not be.
 *
 * **`unknown` is deliberately absent**, though `KnobTaper` carries it. A panel knob's `taper` is
 * a required field, so that model needs a value for "not stated"; a component property can simply
 * be omitted, and absence is the honest way to say the source did not mark the pot.
 */
export type PotentiometerTaper =
	| "linear"
	| "log"
	| "reverse-log"
	| "reverse-linear"
	| "s-curve"
	| "stepped"
	| "custom";

export const POTENTIOMETER_TAPERS: readonly PotentiometerTaper[] = [
	"linear",
	"log",
	"reverse-log",
	"reverse-linear",
	"s-curve",
	"stepped",
	"custom",
];

/** The canonical property key. `Sweep` states the same fact and is superseded. */
export const TAPER_PROPERTY_KEY = "Taper";

/** Superseded keys that state the same fact as {@link TAPER_PROPERTY_KEY}. */
export const SUPERSEDED_TAPER_PROPERTY_KEYS: readonly string[] = ["Sweep"];

/**
 * Values that state the *absence* of a taper rather than a taper.
 *
 * A source that does not mark its pots is a real and common situation, and the honest declaration
 * is no `Taper` property at all. A magic value for absence is worse than absence: a consumer must
 * then know that `Unknown` is not a law, which is the kind of tribal knowledge a typed vocabulary
 * exists to remove.
 */
const ABSENCE_VALUES: ReadonlySet<string> = new Set([
	"unknown",
	"source-unmarked",
	"source-marked",
	"source-unspecified",
	"not-visible",
	"unspecified",
	"none",
]);

/** Values naming a physical package or a travel range rather than a resistance law. */
const NOT_A_LAW_VALUES: ReadonlySet<string> = new Set(["trim", "0..1"]);

export type TaperVerdict =
	| { readonly status: "canonical"; readonly taper: PotentiometerTaper }
	/** The value states that no taper is known. Fix: omit the property. */
	| { readonly status: "absence" }
	/** The value names a package or a range, not a law. */
	| { readonly status: "not-a-law" }
	/** Anything else, including manufacturer letter codes. */
	| { readonly status: "unrecognized" };

/**
 * Normalize a declared taper to the canonical token shape.
 *
 * Beyond `normalizeToken`'s case and separator folding, a word boundary written as CamelCase is
 * split: `ReverseLogarithmic` and `reverse-logarithmic` are the same word sequence joined two
 * ways, so accepting both is normalization rather than aliasing. What is *not* normalized is a
 * synonym -- `Audio` names the same law as `logarithmic` under a different word, and accepting it
 * would be the accommodation this vocabulary exists to avoid.
 */
function normalizeTaperToken(value: string): string {
	return normalizeToken(value.replace(/([a-z0-9])([A-Z])/g, "$1-$2"));
}

/** Classify one declared taper value. */
export function classifyTaper(value: string): TaperVerdict {
	const token = normalizeTaperToken(value);
	if ((POTENTIOMETER_TAPERS as readonly string[]).includes(token)) {
		return { status: "canonical", taper: token as PotentiometerTaper };
	}
	if (ABSENCE_VALUES.has(token)) return { status: "absence" };
	if (NOT_A_LAW_VALUES.has(token)) return { status: "not-a-law" };
	return { status: "unrecognized" };
}

export type TaperIssue = Readonly<{
	code: string;
	severity: "error" | "warning";
	message: string;
	componentId: string;
}>;

const TAPER_BEARING_KINDS: ReadonlySet<string> = new Set([
	"potentiometer",
	"variable-resistor",
	"rheostat",
]);

/**
 * Report a component's taper declaration against the vocabulary.
 *
 * Every verdict is a **warning**, not an error, for the reason the terminal-role work settled: a
 * required vocabulary that refused every document written before it existed would refuse the whole
 * corpus. The counts are the backfill's remaining work, and each message says what the fix is,
 * because "unrecognized" alone does not distinguish a letter code from a provenance note from a
 * package name.
 */
export function collectTaperIssues(
	component: Component,
): readonly TaperIssue[] {
	if (!TAPER_BEARING_KINDS.has(component.kind)) return [];
	const issues: TaperIssue[] = [];
	const properties = component.properties;

	for (const key of SUPERSEDED_TAPER_PROPERTY_KEYS) {
		if (properties[key] !== undefined) {
			issues.push({
				code: "taper-property-superseded",
				severity: "warning",
				message: `property "${key}" states the same fact as "${TAPER_PROPERTY_KEY}"; declare the taper law under "${TAPER_PROPERTY_KEY}" only`,
				componentId: component.id,
			});
		}
	}

	const declared = properties[TAPER_PROPERTY_KEY];
	if (declared === undefined) return issues;
	if (typeof declared !== "string") {
		issues.push({
			code: "taper-not-a-string",
			severity: "warning",
			message: `property "${TAPER_PROPERTY_KEY}" must be one of: ${POTENTIOMETER_TAPERS.join(", ")}`,
			componentId: component.id,
		});
		return issues;
	}

	const verdict = classifyTaper(declared);
	switch (verdict.status) {
		case "canonical":
			return issues;
		case "absence":
			issues.push({
				code: "taper-states-absence",
				severity: "warning",
				message: `"${declared}" says no taper is known rather than naming a law; omit the "${TAPER_PROPERTY_KEY}" property instead`,
				componentId: component.id,
			});
			return issues;
		case "not-a-law":
			issues.push({
				code: "taper-not-a-law",
				severity: "warning",
				message: `"${declared}" names a package or a travel range, not a resistance law; a trimmer still has a taper, and this states neither`,
				componentId: component.id,
			});
			return issues;
		default:
			issues.push({
				code: "taper-unrecognized",
				severity: "warning",
				message: `"${declared}" is not a taper law. A manufacturer letter code is a printed marking whose meaning is a convention, not a definition -- record it as source provenance and declare the law here, one of: ${POTENTIOMETER_TAPERS.join(", ")}`,
				componentId: component.id,
			});
			return issues;
	}
}
