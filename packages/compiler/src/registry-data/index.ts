// The stage-1 data registry: per-class cited parameters, validated at module load.
// 
// **Typed TS data modules, not JSON, and that is deliberate.** This file is imported by
// `part-catalog.ts`, which ships in the package `dist` build, the browser bundle, and
// `bun test` alike. A JSON import would need `resolveJsonModule` under `tsc` *and* a JSON
// loader plugin in every downstream bundler (the browser bundle has none configured);
// typed TS modules work under all four with zero loader risk, keep every figure a
// type-checked number (never a string to parse), tree-shake cleanly, and need no async
// fetch in the browser. The cost is verbosity, which is the point: each value carries its
// citation inline.
// 
// What lives here at stage 1 (mechanically moved, behaviour unchanged):
// - op-amp gain-bandwidth products and output-swing pairs (10 + 2 datasheet rows);
// - zener reverse-breakdown rows (30 rows; forward behaviour stays class default);
// - the 2SK30A gate refinement (1 row; channel stays class default);
// - fixed-rail regulator voltages (5 records) and charge-pump loss/slope (8 records).
// Everything else -- IC macros, `sections` entries, open-loop gains, tube laws, the
// class-default fallbacks -- stays in `part-catalog.ts` / `device-laws.ts` code.
// 
// Nothing here changes behaviour: the compiler builds the same `PartEntry` laws from
// these numbers that the pre-registry literals stated, and the digest gate (every
// canonical `.vdsp` before and after) proves it.

import { assemblePartData, definePartData, findPartData } from "./loader";
import type { PartDataEntry } from "./loader";
import { opampRegistryRecords } from "./opamp";
import { zenerRegistryRecords } from "./zener";
import { jfetRegistryRecords } from "./jfet";
import { regulatorRegistryRecords } from "./regulator";
import { chargePumpRegistryRecords } from "./charge-pump";

export {
	CLASS_PARAM_SCHEMAS,
	classParamNames,
	type PartClassName,
} from "./schema";
export {
	assemblePartData,
	definePartData,
	findPartData,
	validateCitedParam,
	type CitedParam,
	type ParamBasis,
	type PartDataEntry,
} from "./loader";
export {
	defineOpampRecords,
	opampGainBandwidthAbsent,
	opampOutputSwingAbsent,
	opampRegistryRecords,
	type OpampRegistryRecord,
	type OpampSwingPrinted,
} from "./opamp";
export { zenerRegistryRecords } from "./zener";
export { jfetRegistryRecords } from "./jfet";
export { regulatorRegistryRecords } from "./regulator";
export { chargePumpRegistryRecords } from "./charge-pump";

const opampAsEntries: readonly PartDataEntry[] = definePartData(
	// The cited engine params only: the swing's printed condition (supply, load,
	// translation, column) is record metadata read by the swing stamping pass, not an
	// engine parameter, so it is not projected here. Uniqueness still covers every id.
	opampRegistryRecords.map(
		(record): PartDataEntry => ({
			partIds: record.partIds,
			class: "opamp",
			params: {
				...(record.gainBandwidthHz !== undefined
					? { gainBandwidthHz: record.gainBandwidthHz }
					: {}),
				...(record.outputSwingDropHighVolts !== undefined &&
				record.outputSwingDropLowVolts !== undefined
					? {
							outputSwingDropHighVolts: record.outputSwingDropHighVolts,
							outputSwingDropLowVolts: record.outputSwingDropLowVolts,
						}
					: {}),
			},
		}),
	),
);

/**
 * The whole stage-1 data set, validated and frozen. Throws at module load on a duplicate
 * part id or alias across the per-class lists -- an alias that collides with another
 * entry is refused rather than shadowed.
 */
export const partRegistryData: readonly PartDataEntry[] = assemblePartData([
	opampAsEntries,
	zenerRegistryRecords,
	jfetRegistryRecords,
	regulatorRegistryRecords,
	chargePumpRegistryRecords,
]);

/** Find a stage-1 data entry by exact folded part id or alias. */
export function findPartRegistryData(partId: string): PartDataEntry | null {
	return findPartData(partRegistryData, partId);
}
