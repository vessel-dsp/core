// An active device's carrier polarity, and the values that state it.
//
// **Why this needs one key and one vocabulary.** Polarity flips a device's whole transfer curve:
// an NPN read as PNP does not conduct, and a p-channel FET read as n-channel biases backwards.
// It is stated across **three keys** in the corpus, with case drift and quoting artifacts:
//
//   bjt     `Type` NPN(196) PNP(43)          `Polarity` NPN(15) npn(9) PNP(2) pnp(2)
//   jfet    `Type` N-channel JFET(72) 'N'(16) N(9) N-channel(3) NJF(3)
//           `Polarity` N-channel(2) N-channel JFET(1)      `Channel` N(3)
//   mosfet  `Type` P-channel MOSFET(1)
//
// `Polarity` is canonical. `Type` and `Channel` state the same fact and are reported.
//
// **`Type` and `Polarity` are each carrying more than this one concept, and the others are
// deliberately left alone rather than folded in here:**
//
//   diode `Type`      Diode(38) Zener(18) Germanium(3) Schottky(1) -- a device *family*, and
//                     each selects a different law (a zener has a breakdown region, germanium a
//                     lower forward drop). That wants its own vocabulary, not this one.
//   capacitor         `Polarity: electrolytic`(41) / `non-polar`(1) -- a dielectric and
//                     construction, which *implies* polarization rather than stating a carrier
//                     polarity. A different fact under a colliding key.
//   voltage-source    `Polarity: center-negative`(1) -- a DC barrel jack's sleeve polarity. A
//                     third distinct sense of the word.
//   ic / led / ota    `Type: IC` / `LED` / `OTA` -- a restatement of `kind`, carrying nothing.
//   transformer       a sentence about winding phase being validation-bounded. Prose.
//
// Reading any of those as a carrier polarity would be worse than reporting them.

import type { Component } from "./types";
import { normalizeToken } from "./tokens";

/**
 * The carrier polarity of an active device.
 *
 * Bipolar devices are `npn`/`pnp`; field-effect devices are `n-channel`/`p-channel`. The two
 * pairs are not interchangeable, and `POLARITIES_BY_KIND` is what keeps them apart -- an `npn`
 * MOSFET is not a thing.
 */
export type DevicePolarity = "npn" | "pnp" | "n-channel" | "p-channel";

export const DEVICE_POLARITIES: readonly DevicePolarity[] = [
	"npn",
	"pnp",
	"n-channel",
	"p-channel",
];

/** Which polarities each kind may declare. A kind absent here carries no carrier polarity. */
export const POLARITIES_BY_KIND: Readonly<
	Record<string, readonly DevicePolarity[]>
> = {
	bjt: ["npn", "pnp"],
	jfet: ["n-channel", "p-channel"],
	mosfet: ["n-channel", "p-channel"],
};

/** The canonical property key. */
export const POLARITY_PROPERTY_KEY = "Polarity";

/** Keys that state the same fact and are superseded by {@link POLARITY_PROPERTY_KEY}. */
export const SUPERSEDED_POLARITY_PROPERTY_KEYS: readonly string[] = [
	"Type",
	"Channel",
];

/**
 * Normalize a declared polarity.
 *
 * Beyond case and separators, two artifacts are folded because neither is a different value:
 * surrounding quote characters that survived YAML (`'N'` appears 16 times), and a CamelCase word
 * boundary. What is **not** folded is an abbreviation or a kind restatement: `N`, `NJF` and
 * `N-channel JFET` all mean n-channel, and all three are documents to correct, for the same
 * reason the taper vocabulary rejects `A` -- one spelling per fact, decided once.
 */
function normalizePolarityToken(value: string): string {
	const unquoted = value.trim().replace(/^['"]+|['"]+$/g, "");
	const split = unquoted
		// `PChannel` -> `P-Channel`: an initial capital followed by a capitalised word.
		.replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
		// `nChannel` -> `n-Channel`. Neither rule touches an all-caps acronym, so `NPN` is left
		// whole rather than split into letters.
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2");
	return normalizeToken(split);
}

export type PolarityVerdict =
	| { readonly status: "canonical"; readonly polarity: DevicePolarity }
	/** A polarity, but not one this kind can have -- an `npn` FET. */
	| { readonly status: "wrong-kind"; readonly polarity: DevicePolarity }
	/** States a different fact: a dielectric, a barrel-jack sleeve, a device family, prose. */
	| { readonly status: "not-a-polarity" }
	| { readonly status: "unrecognized" };

const NOT_A_POLARITY: ReadonlySet<string> = new Set([
	// Capacitor dielectric/construction.
	"electrolytic",
	"non-polar",
	"nonpolar",
	"bipolar",
	"film",
	"ceramic",
	"tantalum",
	// DC barrel jack sleeve.
	"center-negative",
	"center-positive",
	// Diode families -- a law selector, wanting its own vocabulary.
	"diode",
	"zener",
	"schottky",
	"germanium",
	"germanium-diode",
	// Restatements of `kind`.
	"ic",
	"led",
	"ota",
]);

/** Classify one declared polarity value for a component kind. */
export function classifyPolarity(
	kind: string,
	value: string,
): PolarityVerdict {
	const token = normalizePolarityToken(value);
	if ((DEVICE_POLARITIES as readonly string[]).includes(token)) {
		const polarity = token as DevicePolarity;
		return (POLARITIES_BY_KIND[kind] ?? []).includes(polarity)
			? { status: "canonical", polarity }
			: { status: "wrong-kind", polarity };
	}
	if (NOT_A_POLARITY.has(token)) return { status: "not-a-polarity" };
	return { status: "unrecognized" };
}

export type PolarityIssue = Readonly<{
	code: string;
	severity: "error" | "warning";
	message: string;
	componentId: string;
}>;

/**
 * Report a component's polarity declaration.
 *
 * Warnings throughout, for the reason the terminal-role and taper work settled: a vocabulary that
 * refused every document written before it existed would refuse the corpus, and the counts are
 * the backfill's remaining work. The one exception is `wrong-kind`, which is an **error**: an
 * `npn` MOSFET is not a document that predates a vocabulary, it is a claim that cannot be true.
 */
export function collectPolarityIssues(
	component: Component,
): readonly PolarityIssue[] {
	const legal = POLARITIES_BY_KIND[component.kind];
	if (legal === undefined) return [];
	const issues: PolarityIssue[] = [];
	const properties = component.properties;

	for (const key of SUPERSEDED_POLARITY_PROPERTY_KEYS) {
		const value = properties[key];
		if (typeof value !== "string") continue;
		// Only report the superseded key where it is actually carrying a polarity; `Type` on a
		// diode is a device family and belongs to a different question.
		const verdict = classifyPolarity(component.kind, value);
		if (verdict.status === "canonical" || verdict.status === "wrong-kind") {
			issues.push({
				code: "polarity-property-superseded",
				severity: "warning",
				message: `property "${key}" carries the carrier polarity "${value}"; declare it under "${POLARITY_PROPERTY_KEY}" only`,
				componentId: component.id,
			});
		}
	}

	const declared = properties[POLARITY_PROPERTY_KEY];
	if (declared === undefined) {
		// Suppress the missing-polarity report only where a superseded key actually carries a
		// usable polarity. Merely *having* a `Type` is not enough: a JFET declaring
		// `Type: 'N'` states no polarity this vocabulary can read, so it is missing one, and an
		// earlier version of this check reported nothing for it -- 105 devices hidden by the
		// presence of a key whose value did not resolve.
		const carriedElsewhere = SUPERSEDED_POLARITY_PROPERTY_KEYS.some((key) => {
			const value = properties[key];
			if (typeof value !== "string") return false;
			const status = classifyPolarity(component.kind, value).status;
			return status === "canonical" || status === "wrong-kind";
		});
		// A declared part identifies the polarity even when the document does not spell it out --
		// a 2N3904 is NPN and a 2N3906 is PNP. Core holds no part catalog, so it cannot check
		// which, but a consumer that does is not guessing. Reporting these would make the warning
		// noise on every properly identified transistor, and the warning exists for the devices
		// where *nothing* determines the polarity.
		const identified = ["PartNumber", "Model", "Chip"].some(
			(key) => typeof properties[key] === "string" && properties[key] !== "",
		);
		if (!carriedElsewhere && !identified) {
			issues.push({
				code: "polarity-missing",
				severity: "warning",
				message: `a ${component.kind} declares neither a carrier polarity nor a part that would identify one; its transfer curve depends on it, so a consumer must guess. Declare "${POLARITY_PROPERTY_KEY}" as one of: ${legal.join(", ")}, or identify the part`,
				componentId: component.id,
			});
		}
		return issues;
	}
	if (typeof declared !== "string") {
		issues.push({
			code: "polarity-not-a-string",
			severity: "warning",
			message: `property "${POLARITY_PROPERTY_KEY}" must be one of: ${legal.join(", ")}`,
			componentId: component.id,
		});
		return issues;
	}

	const verdict = classifyPolarity(component.kind, declared);
	switch (verdict.status) {
		case "canonical":
			return issues;
		case "wrong-kind":
			issues.push({
				code: "polarity-wrong-kind",
				severity: "error",
				message: `"${declared}" is not a polarity a ${component.kind} can have; legal: ${legal.join(", ")}`,
				componentId: component.id,
			});
			return issues;
		case "not-a-polarity":
			issues.push({
				code: "polarity-not-a-polarity",
				severity: "warning",
				message: `"${declared}" states a different fact -- a dielectric, a barrel-jack sleeve, a diode family or a restatement of the kind -- not a carrier polarity`,
				componentId: component.id,
			});
			return issues;
		default:
			issues.push({
				code: "polarity-unrecognized",
				severity: "warning",
				message: `"${declared}" is not a carrier polarity. An abbreviation or a kind restatement (\`N\`, \`NJF\`, \`N-channel JFET\`) is a document to correct; declare one of: ${legal.join(", ")}`,
				componentId: component.id,
			});
			return issues;
	}
}
