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
// What lives here after wave 1 (stage 1 moved mechanically, behaviour unchanged; wave 1
// fills the discrete classes under the four derived bases):
// - op-amp gain-bandwidth products and output-swing pairs (11 + 2 datasheet rows; LM833 is
//   GBW-only per the D4 swing freeze);
// - zener reverse-breakdown rows (30 rows; forward behaviour stays class default);
// - BJT records (10 rows: unbinned parts plus 2SC1815-Y/BL ranks; IS by form 1 from a
//   printed Vbe range midpoint or TYP, BF by form 2 geomean or printed TYP; IS omitted where
//   the sheet prints a MAX-only Vbe; reverseBeta/leakageAmps/thermalVoltage omitted throughout
//   for want of a citable figure);
// - JFET rows (3 rows: 2SK30A gate-only, 2N5457 and J201 full channel by form 3);
// - MOSFET rows (2 rows: BS170 and 2N7000 thresholdVolts only -- gfs is small-signal gm, not
//   square-law Beta, and no approved form converts it);
// - fixed-rail regulator voltages (5 records) and charge-pump loss/slope (8 records).
// Diode records are empty by verdict: all eight wave-1 diodes print MAX-only forward limits
// (or a single TYP point); form (4) needs two printed typical (If, Vf) points.
// Everything else -- IC macros, `sections` entries, open-loop gains, tube laws, the
// class-default fallbacks -- stays in `part-catalog.ts` / `device-laws.ts` code.
// 
// Nothing here changes behaviour: the compiler builds the same `PartEntry` laws from
// these numbers that the pre-registry literals stated, and the digest gate (every
// canonical `.vdsp` before and after) proves it.

import { assemblePartData, definePartData, findPartData } from "./loader";
import type { PartDataEntry } from "./loader";
import { bjtRegistryRecords } from "./bjt";
import { diodeRegistryRecords } from "./diode";
import { mosfetRegistryRecords } from "./mosfet";
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
export { bjtRegistryRecords } from "./bjt";
export { diodeRegistryRecords } from "./diode";
export { mosfetRegistryRecords } from "./mosfet";
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
 * The whole wave-1 data set, validated and frozen. Throws at module load on a duplicate
 * part id or alias across the per-class lists -- an alias that collides with another
 * entry is refused rather than shadowed.
 */
export const partRegistryData: readonly PartDataEntry[] = assemblePartData([
	opampAsEntries,
	bjtRegistryRecords,
	diodeRegistryRecords,
	mosfetRegistryRecords,
	zenerRegistryRecords,
	jfetRegistryRecords,
	regulatorRegistryRecords,
	chargePumpRegistryRecords,
]);

/** Find a stage-1 data entry by exact folded part id or alias. */
export function findPartRegistryData(partId: string): PartDataEntry | null {
	return findPartData(partRegistryData, partId);
}
