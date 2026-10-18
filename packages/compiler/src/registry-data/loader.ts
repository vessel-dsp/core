// The data-registry loader: cited parameters in, validated entries out, loudly.
// 
// Every parameter is `{ value, basis, source }`: `value` is the single number the engine
// uses, `basis` says where it came from (`datasheet`, printed as a typical or point value;
// `derived`, with the derivation written out), and `source` is the citation. An uncited
// value is not loadable -- the loader throws, at module load, on:
// 
// - a parameter missing `source` or `basis`;
// - a `derived` basis with no derivation text;
// - a parameter name that is not in the class schema;
// - a duplicate part id or alias (folded, across the whole assembled set);
// - an alias that collides with another entry (an id or another alias).
// 
// The loader validates *shape and provenance*, never electrical plausibility: a finite
// 0.35 V pump loss and a finite 30 V zener both load, and the stamping path keeps its own
// loud checks (a half-stated swing pair still throws in `withDatasheetOutputSwing`).

import { foldPartId } from "../registry";
import { CLASS_PARAM_SCHEMAS, classParamNames, type PartClassName } from "./schema";

/** Where a cited value came from: printed in a datasheet, or derived with the working shown. */
export type ParamBasis = "datasheet" | "derived";

/**
 * One registry parameter: the single number the engine uses, with its provenance.
 * A datasheet's printed limits are never stored as fields; where they were used to derive
 * the value they are quoted in `derivation` (zener typ from a min/max row) or the value is
 * the printed TYP transcribed with its row quoted in `source` (op-amp gain-bandwidth).
 */
export type CitedParam = {
	/** The single number the engine uses. Must be finite. */
	readonly value: number;
	readonly basis: ParamBasis;
	/** The citation: datasheet document, page and row, or the actual provenance chain. */
	readonly source: string;
	/** Required when `basis` is `derived`: the working, written so it can be checked. */
	readonly derivation?: string;
};

/**
 * One part's parameters, as data.
 *
 * Bin and package spellings are typed explicitly -- every spelling is a listed string,
 * never a pattern: `partIds` holds the canonical ids and `aliases` the bin/package
 * spellings that resolve to them. Both are matched whole and case-folded, and both share
 * one uniqueness scope: an alias may not collide with any other entry's id or alias.
 * Stage-1 data keeps each row's spellings exactly as the pre-registry catalog listed them
 * (all in `partIds`); `aliases` is validated and available for stage 3's bin splits.
 */
export type PartDataEntry = {
	readonly partIds: readonly string[];
	readonly aliases?: readonly string[];
	readonly class: PartClassName;
	readonly params: Readonly<Record<string, CitedParam>>;
	/** Provenance disclosures that are not a parameter: stand-ins, exceptions, caveats. */
	readonly note?: string;
};

/** Validate one cited value. Returns it unchanged; throws naming the entry and parameter. */
export function validateCitedParam(
	entryLabel: string,
	name: string,
	param: CitedParam,
): CitedParam {
	if (param.basis !== "datasheet" && param.basis !== "derived") {
		throw new Error(
			`${entryLabel}: parameter "${name}" has no basis: expected "datasheet" or "derived"`,
		);
	}
	if (typeof param.value !== "number" || !Number.isFinite(param.value)) {
		throw new Error(
			`${entryLabel}: parameter "${name}" has no finite value: ${String(param.value)}`,
		);
	}
	if (typeof param.source !== "string" || param.source.length === 0) {
		throw new Error(
			`${entryLabel}: parameter "${name}" is missing its source citation`,
		);
	}
	if (
		param.basis === "derived" &&
		(typeof param.derivation !== "string" || param.derivation.length === 0)
	) {
		throw new Error(
			`${entryLabel}: parameter "${name}" has a derived basis with no derivation text`,
		);
	}
	return param;
}

/** The folded id scope of one entry: canonical ids plus aliases, in listing order. */
function entryIds(entry: PartDataEntry): readonly string[] {
	return [...entry.partIds, ...(entry.aliases ?? [])];
}

/**
 * Validate a list of entries and freeze it. Throws at module load on any violation:
 * unknown class, unknown parameter name for the class, uncited parameter, or a folded
 * id claimed by two entries in this list. Cross-list collisions are `assemblePartData`'s
 * beat.
 *
 * Two spellings in the SAME entry that fold to one id (`RD5.6JB2`, `RD5.6J B2`,
 * `RD5.6J-B2`) are redundant, not conflicting: the pre-registry catalog lists every
 * observed spelling explicitly, and the matcher folds them anyway. Only two entries
 * claiming one id is a wrong answer about somebody's part.
 */
export function definePartData(
	entries: readonly PartDataEntry[],
): readonly PartDataEntry[] {
	const seen = new Map<string, string>();
	for (const entry of entries) {
		const label = entry.partIds.join(",") || "(no part ids)";
		if (!(entry.class in CLASS_PARAM_SCHEMAS)) {
			throw new Error(`${label}: unknown part class "${entry.class}"`);
		}
		const allowed = new Set<string>(classParamNames(entry.class));
		for (const [name, param] of Object.entries(entry.params)) {
			if (!allowed.has(name)) {
				throw new Error(
					`${label}: unknown parameter "${name}" for class "${entry.class}" ` +
						`(accepted: ${[...allowed].join(", ")})`,
				);
			}
			validateCitedParam(label, name, param);
		}
		const ids = entryIds(entry);
		if (ids.length === 0) {
			throw new Error(`${label}: an entry names no part ids`);
		}
		// Within-entry folded duplicates are redundant spellings, not a conflict (see above).
		const foldedHere = new Set<string>();
		for (const id of ids) {
			if (typeof id !== "string" || id.length === 0) {
				throw new Error(`${label}: an entry lists an empty part id or alias`);
			}
			foldedHere.add(foldPartId(id));
		}
		for (const folded of foldedHere) {
			const first = seen.get(folded);
			if (first !== undefined) {
				throw new Error(
					`${label}: duplicate part id or alias (already listed on ${first})`,
				);
			}
			seen.set(folded, label);
		}
	}
	return Object.freeze(entries.map((entry) => Object.freeze(entry)));
}

/**
 * Assemble the per-class lists into the one registry data set. Throws when an id or
 * alias in one list collides with another list's -- an alias that collides with another
 * entry is a wrong answer about somebody's part, so it refuses rather than shadowing.
 */
export function assemblePartData(
	lists: readonly (readonly PartDataEntry[])[],
): readonly PartDataEntry[] {
	const seen = new Map<string, string>();
	for (const list of lists) {
		for (const entry of list) {
			const label = entry.partIds.join(",") || "(no part ids)";
			// Same within-entry tolerance as `definePartData`: redundant spellings, one entry.
			const foldedHere = new Set(
				entryIds(entry).map((id) => foldPartId(id)),
			);
			for (const folded of foldedHere) {
				const first = seen.get(folded);
				if (first !== undefined) {
					throw new Error(
						`${label}: part id or alias collides with another entry (${first})`,
					);
				}
				seen.set(folded, label);
			}
		}
	}
	return Object.freeze(lists.flat());
}

/** Find an entry by exact folded id or alias. Whole folded id only; no prefix or family rule. */
export function findPartData(
	data: readonly PartDataEntry[],
	partId: string,
): PartDataEntry | null {
	const folded = foldPartId(partId);
	for (const entry of data) {
		if (entryIds(entry).some((id) => foldPartId(id) === folded)) {
			return entry;
		}
	}
	return null;
}
