// The data-registry loader: cited parameters in, validated entries out, loudly.
//
// Every parameter is `{ value, basis, source }`: `value` is the single number the engine
// uses, `basis` says where it came from (`datasheet`, printed as a typical or point value;
// `derived`, with the derivation written out; `manufacturer-model`, read directly from a
// manufacturer-published SPICE/PSpice model file), and `source` is the citation. An uncited
// value is not loadable -- the loader throws, at module load, on:
//
// - a parameter missing `source` or `basis`;
// - a `derived` basis with no derivation text;
// - a `manufacturer-model` basis without the manufacturer model file URL and the exact
//   model line it was read from (both required, validated, and quoted in `source`);
//   the line is verbatim as the manufacturer printed it: a `.MODEL` / `.SUBCKT` card
//   (with its continuation lines) from a model file, or a Microsim-style `NPN (...)`
//   line from the manufacturer's own datasheet (clarified 2026-10-19: a model the
//   manufacturer prints inside its datasheet is manufacturer-published);
// - a `measured` basis without the owner's bench record (instrument, conditions,
//   sample count, date, evidence path plus sha256 -- every field required, validated,
//   and the evidence path and sha256 quoted in `source`);
// - model file/line fields on any other basis;
// - a model file URL outside the manufacturer's own hosts (third-party libraries,
//   mirrors, forums and aggregators are not manufacturer models, even when the text
//   they carry is manufacturer-authored);
// - measured fields on any other basis;
// - model file/line fields on any other basis;
// - a parameter name that is not in the class schema;
// - a duplicate part id or alias (folded, across the whole assembled set);
// - an alias that collides with another entry (an id or another alias).
//
// The loader validates *shape and provenance*, never electrical plausibility: a finite
// 0.35 V pump loss and a finite 30 V zener both load, and the stamping path keeps its own
// loud checks (a half-stated swing pair still throws in `withDatasheetOutputSwing`).
// A third-party model library (LTspice's standard files, Tina, a forum) is NOT a
// manufacturer model and is not admitted: the file URL must be the manufacturer's own
// publication (onsemi, Vishay, STMicroelectronics, Nexperia, Diodes Inc, TI, Analog Devices).

import { foldPartId } from "../registry";
import { CLASS_PARAM_SCHEMAS, classParamNames, type PartClassName } from "./schema";

/**
 * Manufacturer hosts a `manufacturer-model` file URL may live on. The file must be the
 * manufacturer's own publication: a model text carried by a third-party library, mirror,
 * forum or aggregator is not a manufacturer model even when the text is
 * manufacturer-authored. Matched by domain suffix, so `www.` and asset subdomains pass.
 */
const MANUFACTURER_MODEL_HOSTS = [
	"onsemi.com",
	"vishay.com",
	"st.com",
	"nexperia.com",
	"diodes.com",
	"ti.com",
	"analog.com",
] as const;

/** True when the URL's host belongs to one of the seven publishing manufacturers. */
function isManufacturerModelHost(url: string): boolean {
	let host = "";
	try {
		host = new URL(url).hostname.toLowerCase();
	} catch {
		return false;
	}
	return MANUFACTURER_MODEL_HOSTS.some(
		(suffix) => host === suffix || host.endsWith(`.${suffix}`),
	);
}

/** Where a cited value came from: printed in a datasheet, derived with the working shown,
 * read directly from a manufacturer-published SPICE/PSpice model file, or measured by the
 * owner on the bench (generic LED / diode defaults only, until a measurement JSON exists). */
export type ParamBasis = "datasheet" | "derived" | "manufacturer-model" | "measured";

/**
 * One registry parameter: the single number the engine uses, with its provenance.
 * A datasheet's printed limits are never stored as fields; where they were used to derive
 * the value they are quoted in `derivation` (zener typ from a min/max row) or the value is
 * the printed TYP transcribed with its row quoted in `source` (op-amp gain-bandwidth).
 * A `manufacturer-model` parameter is read directly from the manufacturer's own model
 * file: `modelFileUrl` is that file's URL (one of the seven publishing manufacturers'
 * own hosts) and `modelLine` is the exact model line the value was read from, verbatim
 * as printed -- a `.MODEL` / `.SUBCKT` card (with its continuation lines) from a model
 * file, or a Microsim-style `NPN (...)` line from the manufacturer's own datasheet --
 * both quoted in `source` as well.
 * A `measured` parameter is the owner's own bench value: `measurementInstrument` names
 * the meter, `measurementConditions` states the supply, resistors and temperature,
 * `measurementSampleCount` counts the pooled samples, `measurementDate` is the sitting
 * date (YYYY-MM-DD), and `measurementEvidencePath` plus `measurementEvidenceSha256`
 * point at the committed measurement JSON (repo-relative path, sha256 of the file) --
 * both quoted in `source` as well. The JSON schema is
 * `vesseldsp.junction-default-measurement.v1` (`perDevice` entries with `isEngine`,
 * `nEngine`, `samples`, pooled over every sample, already referred to the engine's
 * thermal voltage 0.025852 V); see `led-measurement.html` and its README.
 */
export type CitedParam = {
	/** The single number the engine uses. Must be finite. */
	readonly value: number;
	readonly basis: ParamBasis;
	/** The citation: datasheet document, page and row, or the actual provenance chain. */
	readonly source: string;
	/** Required when `basis` is `derived`: the working, written so it can be checked. */
	readonly derivation?: string;
	/** Required when `basis` is `manufacturer-model`: the manufacturer model file's URL. */
	readonly modelFileUrl?: string;
	/** Required when `basis` is `manufacturer-model`: the exact `.MODEL` / `.SUBCKT` line. */
	readonly modelLine?: string;
	/** Required when `basis` is `measured`: the meter (make/model). */
	readonly measurementInstrument?: string;
	/** Required when `basis` is `measured`: supply, resistors, temperature. */
	readonly measurementConditions?: string;
	/** Required when `basis` is `measured`: pooled sample count (>= 1, integer). */
	readonly measurementSampleCount?: number;
	/** Required when `basis` is `measured`: sitting date, YYYY-MM-DD. */
	readonly measurementDate?: string;
	/** Required when `basis` is `measured`: repo-relative path of the measurement JSON. */
	readonly measurementEvidencePath?: string;
	/** Required when `basis` is `measured`: lowercase hex sha256 of the measurement JSON. */
	readonly measurementEvidenceSha256?: string;
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
	if (
		param.basis !== "datasheet" &&
		param.basis !== "derived" &&
		param.basis !== "manufacturer-model" &&
		param.basis !== "measured"
	) {
		throw new Error(
			`${entryLabel}: parameter "${name}" has no basis: expected "datasheet", "derived", "manufacturer-model" or "measured"`,
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
	if (param.basis === "manufacturer-model") {
		if (
			typeof param.modelFileUrl !== "string" ||
			param.modelFileUrl.length === 0
		) {
			throw new Error(
				`${entryLabel}: parameter "${name}" has a manufacturer-model basis with no model file URL`,
			);
		}
		if (
			!/^https?:\/\//u.test(param.modelFileUrl) ||
			/\s/u.test(param.modelFileUrl)
		) {
			throw new Error(
				`${entryLabel}: parameter "${name}" has a manufacturer-model basis with a model file that is not an http(s) URL: ${param.modelFileUrl}`,
			);
		}
		if (!isManufacturerModelHost(param.modelFileUrl)) {
			throw new Error(
				`${entryLabel}: parameter "${name}" has a manufacturer-model basis with a model file outside the manufacturer's own hosts: ${param.modelFileUrl}`,
			);
		}
		if (typeof param.modelLine !== "string" || param.modelLine.length === 0) {
			throw new Error(
				`${entryLabel}: parameter "${name}" has a manufacturer-model basis with no model line`,
			);
		}
		if (!param.source.includes(param.modelFileUrl)) {
			throw new Error(
				`${entryLabel}: parameter "${name}" has a manufacturer-model basis whose source does not quote the model file URL`,
			);
		}
		if (!param.source.includes(param.modelLine.trim())) {
			throw new Error(
				`${entryLabel}: parameter "${name}" has a manufacturer-model basis whose source does not quote the model line`,
			);
		}
	} else {
		if (param.modelFileUrl !== undefined || param.modelLine !== undefined) {
			throw new Error(
				`${entryLabel}: parameter "${name}" states a model file/line on a "${param.basis}" basis (manufacturer-model only)`,
			);
		}
	}
	if (param.basis === "measured") {
		if (
			typeof param.measurementInstrument !== "string" ||
			param.measurementInstrument.length === 0
		) {
			throw new Error(
				`${entryLabel}: parameter "${name}" has a measured basis with no instrument`,
			);
		}
		if (
			typeof param.measurementConditions !== "string" ||
			param.measurementConditions.length === 0
		) {
			throw new Error(
				`${entryLabel}: parameter "${name}" has a measured basis with no conditions (supply, resistors, temperature)`,
			);
		}
		if (
			typeof param.measurementSampleCount !== "number" ||
			!Number.isInteger(param.measurementSampleCount) ||
			param.measurementSampleCount < 1
		) {
			throw new Error(
				`${entryLabel}: parameter "${name}" has a measured basis with no sample count (integer >= 1): ${String(param.measurementSampleCount)}`,
			);
		}
		if (
			typeof param.measurementDate !== "string" ||
			!/^\d{4}-\d{2}-\d{2}$/u.test(param.measurementDate) ||
			Number.isNaN(Date.parse(`${param.measurementDate}T00:00:00Z`))
		) {
			throw new Error(
				`${entryLabel}: parameter "${name}" has a measured basis with no date (YYYY-MM-DD): ${String(param.measurementDate)}`,
			);
		}
		if (
			typeof param.measurementEvidencePath !== "string" ||
			param.measurementEvidencePath.length === 0
		) {
			throw new Error(
				`${entryLabel}: parameter "${name}" has a measured basis with no evidence path`,
			);
		}
		if (
			param.measurementEvidencePath.startsWith("/") ||
			param.measurementEvidencePath.includes("..") ||
			!param.measurementEvidencePath.endsWith(".json")
		) {
			throw new Error(
				`${entryLabel}: parameter "${name}" has a measured basis with an evidence path that is not a repo-relative JSON path: ${param.measurementEvidencePath}`,
			);
		}
		if (
			typeof param.measurementEvidenceSha256 !== "string" ||
			!/^[0-9a-f]{64}$/u.test(param.measurementEvidenceSha256)
		) {
			throw new Error(
				`${entryLabel}: parameter "${name}" has a measured basis with no evidence sha256 (64 lowercase hex): ${String(param.measurementEvidenceSha256)}`,
			);
		}
		if (!param.source.includes(param.measurementEvidencePath)) {
			throw new Error(
				`${entryLabel}: parameter "${name}" has a measured basis whose source does not quote the evidence path`,
			);
		}
		if (!param.source.includes(param.measurementEvidenceSha256)) {
			throw new Error(
				`${entryLabel}: parameter "${name}" has a measured basis whose source does not quote the evidence sha256`,
			);
		}
	} else {
		if (
			param.measurementInstrument !== undefined ||
			param.measurementConditions !== undefined ||
			param.measurementSampleCount !== undefined ||
			param.measurementDate !== undefined ||
			param.measurementEvidencePath !== undefined ||
			param.measurementEvidenceSha256 !== undefined
		) {
			throw new Error(
				`${entryLabel}: parameter "${name}" states measured fields on a "${param.basis}" basis (measured only)`,
			);
		}
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
