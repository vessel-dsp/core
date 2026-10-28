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
// What lives here after wave 5 plus the wave-6 transistor-records wave-1 fill (stage 1
// moved mechanically, behaviour unchanged; waves 1-5 fill the discrete classes under the
// four derived bases plus the manufacturer-model basis, wave 6 adds the next BJT/JFET rows):
// - op-amp gain-bandwidth products and output-swing pairs (24 GBW rows: the 11 stage-1 rows
//   plus LM833 wave-1, LF347/LF351/L272M/TL074 wave-2, NJM4580-family/OPA2134 wave-3,
//   LM324/TLC2262/MC33174/LM833N wave-4, and OPA1678/OPA134PA/OPA604AP wave-5;
//   AD712, LM1458/N, LM308, UA741CP, TL072C and LM741CN are GBW-absent by verdict and LM833
//   stays GBW-only per the D4 swing freeze);
// - zener reverse-breakdown rows (35 rows: the stage-1 rows plus 13 wave-5 nominal-voltage
//   rows at 2.5/2.7/3.3/3.6/4.7/5.1/5.6/6.2/8.2/9.1/10/12/13 V absorbing seven stage-1
//   derived rows at identical values; forward behaviour stays class default);
// - BJT records (62 rows: unbinned parts plus 2SC1815-Y/BL, 2SC732TM-GR/2SC945-P and
//   wave-6 2SC3324-GR/2SC2459-GR/2SC4116-GR/2SA1048-GR/KTC3198-BL ranks, and the SOT-23
//   MMBT5089 pair;
//   IS by form 1 from a printed Vbe range midpoint or TYP, or by manufacturer-model where
//   published (2N2222A, 2N5088, ZTX618); IS omitted where neither exists; BF by
//   form 2 geomean or printed TYP; reverseBeta/leakageAmps/thermalVoltage omitted throughout
//   for want of a citable figure);
// - JFET rows (27 rows: 2SK30A gate-only plus full-channel rows by form 3, including
//   wave-6 2SK30A-O, 2SK879/Y, 2SK880/GR and Vt0-only J113);
// - MOSFET rows (2 rows: BS170 and 2N7000 thresholdVolts only -- gfs is small-signal gm, not
//   square-law Beta, and no approved form converts it);
// - fixed-rail regulator voltages (7 records: 5/9/18/-15/15 plus wave-5 12/3.3 V) and
//   charge-pump loss/slope (8 records).
// Diode records are wave-3 manufacturer-model fills (12 rows: BAT41/46/43/48, 1N5817/5819,
// B340A, 1N4001/4002/4004/4007, 1N914) plus wave-4 (community 1N34A, DEC-sheet
// 1N60/1N60P, and the 1N4148 community record since replaced by the owner's measured
// pair), BAT85 (Nexperia model) and BAT85S (community, same card): 18 rows, one
// measured (1N4148), two community (1N34A, BAT85S). No datasheet-derived diode pair
// exists (form 4 needs two printed typical points and never met).
// LED colour-default records (5 rows: red keyed "RED LED"/"5mm red LED"/"LED-RED",
// green keyed "LED-GREEN", blue/white/yellow reached via typed `Color` and carrying
// the colour word as their registry id; IS and n measured 2026-10-20, VT derived,
// two-point Rs derived).
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
import { ledRegistryRecords } from "./led";
import { mosfetRegistryRecords } from "./mosfet";
import { opampRegistryRecords } from "./opamp";
import { zenerRegistryRecords } from "./zener";
import { jfetRegistryRecords } from "./jfet";
import { ujtRegistryRecords } from "./ujt";
import { regulatorRegistryRecords } from "./regulator";
import { powerAmpRegistryRecords } from "./poweramp";
import { chargePumpRegistryRecords } from "./charge-pump";

export {
	CLASS_PARAM_SCHEMAS,
	classParamNames,
	REQUIRED_CLASS_PARAMS,
	requiredClassParams,
	type PartClassName,
} from "./schema";
export {
	assemblePartData,
	definePartData,
	findPartData,
	validateCitedParam,
	communityProvenanceOf,
	type CitedParam,
	type CommunityProvenance,
	type CommunitySourceKind,
	type ParamBasis,
	type PartDataEntry,
} from "./loader";
export { bjtRegistryRecords } from "./bjt";
export { diodeRegistryRecords } from "./diode";
export { LED_COLOUR_RECORD_ID, ledRegistryRecords, type LedColour } from "./led";
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
export { ujtRegistryRecords } from "./ujt";
export { regulatorRegistryRecords } from "./regulator";
export { powerAmpRegistryRecords } from "./poweramp";
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
	ledRegistryRecords,
	mosfetRegistryRecords,
	zenerRegistryRecords,
	jfetRegistryRecords,
	regulatorRegistryRecords,
	chargePumpRegistryRecords,
	ujtRegistryRecords,
	powerAmpRegistryRecords,
]);

/** Find a stage-1 data entry by exact folded part id or alias. */
export function findPartRegistryData(partId: string): PartDataEntry | null {
	return findPartData(partRegistryData, partId);
}
