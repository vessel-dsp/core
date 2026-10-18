// JFET registry data: one gate-refinement row and one full-channel row.
// 
// **Channel deliberately unrefined for 2SK30A only.** That record carries the gate term
// alone: the channel repeats the class default by construction (rank-dependent -- an
// unbinned 2SK30A spans IDSS 0.3-6.5 mA across R/O/Y/GR -- and the database beta disagrees
// with at least one packet's record), so refining it here would trade one packet's fix for
// another's regression on evidence neither side owns. `device-laws.ts` reads the whole
// entry for every part; the 2SK30A entry's channel repeats the class defaults, so its
// stamp is byte-identical either way.
// 
// 2N5457 carries a full channel: the sheet prints IDSS and VGS(off) ranges, so Vt0 is the
// printed VGS(off) range's arithmetic midpoint (form 2, volts are not gains) and Beta
// follows from the square law with the printed IDSS TYP (form 3). Gate terms stay class
// defaults: the sheet prints reverse gate current only (IGSS at VGS = -15 V), never forward
// gate current, so no forward gate figure is admitted.
// 
// Coverage is by exact id, with no prefix or substring rule anywhere on the path. Each
// spelling needs its own packet study before its behaviour may move.

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
	{
		// Full channel: IDSS and VGS(off) ranges printed, so Vt0 and Beta derive by the
		// square law. Gate terms stay class defaults (reverse IGSS only, never forward).
		partIds: ["2N5457"],
		class: "jfet",
		params: {
			thresholdVolts: {
				value: -3.25,
				basis: "derived",
				source:
					"jfets/2N5457/datasheets/2n5457.pdf (onsemi 2N5457/D, Feb 2010 Rev. 6) p2, ELECTRICAL " +
					"CHARACTERISTICS (TA = 25C): 'Gate-Source Cutoff Voltage VGS(off), VDS = 15 V, " +
					"ID = 10 nA: MIN -0.5 MAX -6.0 V' (no TYP printed)",
				derivation:
					"Printed VGS(off) range -0.5 to -6.0 V at VDS = 15 V, ID = 10 nA; arithmetic " +
					"midpoint (form 2, volts are not gains): -(-0.5 + -6.0) / 2 = -3.25 V.",
			},
			transconductance: {
				value: 2.8402367e-4,
				basis: "derived",
				source:
					"jfets/2N5457/datasheets/2n5457.pdf (onsemi 2N5457/D, Feb 2010 Rev. 6) p2: " +
					"'Zero-Gate-Voltage Drain Current IDSS, VDS = 15 V, VGS = 0: MIN 1.0 TYP 3.0 " +
					"MAX 5.0 mA' (Note 1: pulse test, width <= 630 ms, duty <= 10%)",
				derivation:
					"Square law (form 3) with the printed IDSS TYP 3.0 mA and the derived Vt0 -3.25 V: " +
					"Beta = IDSS / Vt0^2 = 3e-3 / 3.25^2 = 2.8402367e-4 S. The printed |Yfs| TYP 3000 " +
					"mmhos at VGS = 0 is a zero-bias small-signal figure, not the square-law Beta, and " +
					"is not used.",
			},
		},
	},
	{
		// Full channel: IDSS and VGS(off) ranges printed (no TYP for either), so both inputs
		// are range midpoints (form 2, arithmetic -- currents and volts are not gains) and Beta
		// follows by the square law (form 3). Gate terms stay class defaults (reverse IGSS
		// only, never forward). J202 columns on the same sheet are the sibling part, not carried.
		partIds: ["J201"],
		class: "jfet",
		params: {
			thresholdVolts: {
				value: -0.9,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): InterFET IF35018.R00, June 2019, p2, " +
					"Static Characteristics (TA = 25C): 'Gate to Source Cutoff Voltage VGS(OFF), VDS = 20 V, " +
					"ID = 10 nA: J201 MIN -0.3 MAX -1.5 V' (no TYP; J202 -0.8/-4 V is the sibling)",
				derivation:
					"Printed J201 VGS(OFF) range -0.3 to -1.5 V at VDS = 20 V, ID = 10 nA; arithmetic " +
					"midpoint (form 2, volts are not gains): -(-0.3 + -1.5) / 2 = -0.9 V.",
			},
			transconductance: {
				value: 7.4074074e-4,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): InterFET IF35018.R00, June 2019, p2: " +
					"'Drain to Source Saturation Current IDSS, VGS = 0 V, VDS = 20 V (pulsed): J201 " +
					"MIN 0.2 MAX 1.0 mA' (no TYP; J202 0.9/4.5 mA is the sibling)",
				derivation:
					"Printed J201 IDSS range 0.2-1.0 mA; arithmetic midpoint (form 2): (0.2 + 1.0) / 2 = " +
					"0.6 mA. Square law (form 3) with the derived Vt0 -0.9 V: Beta = IDSS / Vt0^2 = " +
					"0.6e-3 / 0.9^2 = 7.4074074e-4 S. The printed GFS MIN 500 uS is a zero-bias " +
					"small-signal figure, not the square-law Beta, and is not used.",
			},
		},
	},
]);
