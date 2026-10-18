// MOSFET registry data: wave-1 discrete fill.
//
// One value per parameter; a parameter with no datasheet citation is not loadable, so it
// is omitted here and the stamp falls back to the class default (never a guess):
//
// - `thresholdVolts`: a printed VGS(th) bin or range becomes one value by its midpoint
//   (form 2, arithmetic -- a threshold is not a gain). A MIN-only VGS(th) with no MAX is a
//   limit, not a range, and yields nothing.
// - `transconductance`: the square-law Beta is NOT derived from gfs here -- gfs is a
//   small-signal figure at one bias, a different quantity. Only a printed TYP gfs stated as
//   the part's transconductance transcribes directly (basis `datasheet`); a MIN-only gfs
//   yields nothing.
// - `channelLengthModulation`, `subthresholdVolts`, gate terms: omitted for every part below.
//   No sheet in this wave prints lambda, and the insulated gate draws no current by
//   construction (gate zeros stand).
//
// This module starts empty: no vendored MOSFET sheet exists in the artifacts library, and the
// fetched sheets land here as they are verified. See the wave-1 report for the per-part
// verdicts.
//
// NOTE (method gap for later waves): a printed gfs/Yfs -- even TYP -- is a small-signal
// transconductance at one bias, NOT the square-law Beta the shared `fet` law wants
// (`current = beta * drive^2`). Converting one to the other needs the bias point, which is
// a fifth derived form the owner has not approved, so gfs never transcribes here even when
// printed. BS170 and 2N7000 therefore carry thresholdVolts only.

import { definePartData, type PartDataEntry } from "./loader";

export const mosfetRegistryRecords: readonly PartDataEntry[] = definePartData([
	{
		// transconductance omitted: the sheet's gfs TYP 200 mmhos at VDS = 10 V, ID = 250 mA
		// is small-signal gm at one bias, not square-law Beta (see module note).
		partIds: ["BS170"],
		class: "mosfet",
		params: {
			thresholdVolts: {
				value: 2.0,
				basis: "datasheet",
				source:
					"Fetched manufacturer sheet (no vendored copy): onsemi BS170/D, Nov 2017 Rev. 7, p2, ON " +
					"CHARACTERISTICS (Note 1: pulse test): 'Gate Threshold Voltage VGS(th), VDS = VGS, " +
					"ID = 1.0 mA: MIN 0.8 TYP 2.0 MAX 3.0 V'",
				derivation:
					"Printed VGS(th) TYP 2.0 V at VDS = VGS, ID = 1.0 mA, transcribed (no midpoint: a " +
					"TYP is already one value). The range midpoint would be 1.9; the printed TYP wins.",
			},
		},
	},
	{
		// transconductance omitted: the sheet's gfs is MIN-only 100 mS (a limit, not a value)
		// and in any case small-signal gm, not square-law Beta (see module note).
		partIds: ["2N7000"],
		class: "mosfet",
		params: {
			thresholdVolts: {
				value: 1.9,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): Zetex 2N7000 (now Diodes Inc), Issue 2 " +
					"Nov 1994, p1 table: 'Gate-Source Threshold Voltage VGS(th), ID = 1 mA, VDS = VGS: " +
					"MIN 0.8 MAX 3.0 V' (no TYP)",
				derivation:
					"Printed VGS(th) range 0.8-3.0 V at ID = 1 mA; arithmetic midpoint (form 2, a " +
					"threshold is not a gain): (0.8 + 3.0) / 2 = 1.9 V.",
			},
		},
	},
]);
