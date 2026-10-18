// JFET registry data: the one part whose gate the catalog refines.
// 
// **Channel deliberately unrefined.** The record carries the gate term only: the channel
// repeats the class default by construction (rank-dependent -- an unbinned 2SK30A spans
// IDSS 0.3-6.5 mA across R/O/Y/GR -- and the database beta disagrees with at least one
// packet's record), so refining it here would trade one packet's fix for another's
// regression on evidence neither side owns. `device-laws.ts` reads only the gate term from
// a part entry; the channel stays the declared-or-class law byte-for-byte.
// 
// Coverage is deliberately a single exact id: the part `ibanez-ts9` declares. The match is
// whole folded id, with no prefix or substring rule anywhere on the path, so `2SK30ATM`,
// `2SK30ATM-Y` and `2SK44SPC` do not match; each needs its own packet study before its
// behaviour may move.

import { definePartData, type PartDataEntry } from "./loader";

export const jfetRegistryRecords: readonly PartDataEntry[] = definePartData([
	{
		partIds: ["2SK30A"],
		class: "jfet",
		params: {
			gateSaturationCurrent: {
				value: 1e-14,
				basis: "derived",
				source:
					"Device database silicon-junction convention (saturationCurrent.typ 1e-14, the same " +
					"constant as SILICON_SATURATION_CURRENT); Toshiba 2SK30A sheet " +
					"(parts/jfets/2SK30A/datasheets/toshiba-2sk30a.pdf, curated in parts/jfets/2SK30A.md)",
				derivation:
					"The Toshiba sheet prints IDSS ranks, VGS(off) and Yfs, and no forward gate current " +
					"at all (only reverse IGSS), so the gate IS is a silicon-junction order choice, not a " +
					"measured 2SK30A forward current: it puts the foot current at switch biases three " +
					"orders below signal currents (verified H2-free for gateSaturationCurrent in " +
					"{1e-7, 1e-8, 1e-9, 0}; 1e-14 sits inside that verified-flat region at the repo's " +
					"silicon constant). Never fitted to a specimen. `boss-sg-1-slow-gear` declares the " +
					"same id with its gate 0.5 V below onset in every state, so the refinement is inert " +
					"there (a ~0.02 Vgs shift from the removed 4.5 nA foot current, measured in the " +
					"report-5 rerun).",
			},
		},
	},
]);
