// JFET registry data: one gate-refinement row, three wave-1 full-channel rows, and the
// wave-3 2N5952 plus wave-4 rows below.
// 
// **Channel deliberately unrefined for 2SK30A only.** That record carries the gate term
// alone: the channel repeats the class default by construction (rank-dependent -- an
// unbinned 2SK30A spans IDSS 0.3-6.5 mA across R/O/Y/GR -- and the database beta disagrees
// with at least one packet's record), so refining it here would trade one packet's fix for
// another's regression on evidence neither side owns. `device-laws.ts` reads the whole
// entry for every part; the 2SK30A entry's channel repeats the class defaults, so its
// stamp is byte-identical either way. The ranked 2SK30A-Y/GR entries below carry full
// channels from the sheet's rank rows; they do not touch the unbinned record.
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
		// Wave 6 (transistor-records wave 1). Bare mini-package spelling: the Toshiba
		// 2SK30ATM sheet (1997-04-10) is the TM title with the same IDSS/VGS(OFF)
		// table and rank note as the 2SK30A sheet, so the unbinned mini is the same
		// die in the mini package -- an alias on the gate-only unbinned entry.
		partIds: ["2SK30A"],
		aliases: ["2SK30ATM"],
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
	{
		// Wave 3. Full channel by the same J201 form (no TYP either side): IDSS and
		// VGS(off) are range midpoints (form 2) and Beta follows by the square law
		// (form 3). Gate terms stay class defaults (reverse IGSS only, never forward).
		// The printed yfs 2.0-6.5 mS at VGS = 0 is a zero-bias small-signal figure, not
		// the square-law Beta, and is not used.
		partIds: ["2N5952"],
		class: "jfet",
		params: {
			thresholdVolts: {
				value: -2.4,
				basis: "derived",
				source:
					"2N5952/datasheets/2N5949_SERIES.pdf (Central Semiconductor 2N5949 Series, R1 " +
					"25-April-2018; sha256 " +
					"da3614d6a24b425e670ad9f6abf27d50dc8c073243cc76065350e8ae4b19c053) p1, " +
					"ELECTRICAL CHARACTERISTICS (TA = 25C), MIN/MAX columns, no TYP column on any " +
					"row: 'VGS(OFF), VDS = 15 V, ID = 100 nA: 2N5952 MIN 1.3 MAX 3.5 V' (magnitudes; " +
					"N-channel, so Vt0 is negative)",
				derivation:
					"Printed 2N5952 VGS(OFF) range 1.3-3.5 V at VDS = 15 V, ID = 100 nA; " +
					"arithmetic midpoint (form 2, volts are not gains): -(1.3 + 3.5) / 2 = -2.4 V.",
			},
			transconductance: {
				value: 1.0416667e-3,
				basis: "derived",
				source:
					"2N5952/datasheets/2N5949_SERIES.pdf (Central Semiconductor 2N5949 Series, R1 " +
					"25-April-2018) p1: 'IDSS, VDS = 15 V, VGS = 0: 2N5952 MIN 4.0 MAX 8.0 mA' " +
					"(no TYP; 2N5949/5951/5953 columns are the siblings)",
				derivation:
					"Printed 2N5952 IDSS range 4.0-8.0 mA; arithmetic midpoint (form 2): " +
					"(4.0 + 8.0) / 2 = 6.0 mA. Square law (form 3) with the derived Vt0 -2.4 V: " +
					"Beta = IDSS / Vt0^2 = 6e-3 / 2.4^2 = 1.0416667e-3 S.",
			},
		},
	},
	{
		// Wave 4. Central R1 (2-May-2014): IDSS and VGS(off) print MIN/MAX only (no TYP),
		// so both are arithmetic midpoints (form 2) and Beta follows by the square law
		// (form 3). Gate terms stay class defaults (reverse IGSS only).
		partIds: ["2N5485"],
		class: "jfet",
		params: {
			thresholdVolts: {
				value: -2.25,
				basis: "derived",
				source:
					"2N5485/datasheets/central-2n5484-2n5485-2n5486.pdf (Central Semiconductor " +
					"2N5484/2N5485/2N5486, R1 2-May-2014) p1, ELECTRICAL CHARACTERISTICS (TA = 25C), " +
					"MIN/MAX columns, no TYP column: 'VGS(off), VDS = 15 V, ID = 10 nA: 2N5485 " +
					"MIN 0.5 MAX 4.0 V' (magnitudes; N-channel, so Vt0 is negative)",
				derivation:
					"Printed 2N5485 VGS(off) range 0.5-4.0 V at VDS = 15 V, ID = 10 nA; arithmetic " +
					"midpoint (form 2, volts are not gains): -(0.5 + 4.0) / 2 = -2.25 V.",
			},
			transconductance: {
				value: 1.382716e-3,
				basis: "derived",
				source:
					"2N5485/datasheets/central-2n5484-2n5485-2n5486.pdf (Central R1 2-May-2014) p1: " +
					"'IDSS, VDS = 15 V: 2N5485 MIN 4.0 MAX 10 mA' (no TYP; |yfs| at 1 kHz not used)",
				derivation:
					"Printed 2N5485 IDSS range 4.0-10 mA; arithmetic midpoint (form 2): " +
					"(4.0 + 10) / 2 = 7.0 mA. Square law (form 3) with the derived Vt0 -2.25 V: " +
					"Beta = IDSS / Vt0^2 = 7e-3 / 2.25^2 = 1.382716e-3 S.",
			},
		},
	},
	{
		// Wave 4. Rank entries (2SC1815 precedent): the Toshiba 2SK30A sheet shares one
		// VGS(off) row (-0.4..-5.0 V) across ranks and splits IDSS by rank (Y: 1.2-3.0 mA,
		// GR: 2.6-6.5 mA). The TM spellings are Toshiba mini-package spellings of the same
		// ranked die observed across eighteen corpus packets (boss-cs-2: 'Q1-Q3 2SK30ATM-Y
		// JFETs'); no TM-specific sheet exists, which the alias note discloses. Unbinned
		// 2SK30A stays gate-only (wave-1 verdict: the 0.3-6.5 mA span is rank-dependent).
		partIds: ["2SK30A-Y"],
		aliases: ["2SK30ATM-Y"],
		class: "jfet",
		params: {
			thresholdVolts: {
				value: -2.7,
				basis: "derived",
				source:
					"2SK30A/datasheets/toshiba-2sk30a.pdf (Toshiba 2SK30A) ELECTRICAL " +
					"CHARACTERISTICS (Ta = 25C): 'Gate to Source cut-off voltage VGS(OFF), " +
					"VDS = 10 V, ID = 0.1 uA, -0.4 to -5.0 V' (shared row, no rank split) with " +
					"'IDSS Rank Classification R: 0.3-0.75, O: 0.6-1.4, Y: 1.2-3.0, GR: 2.6-6.5 mA'",
				derivation:
					"Printed VGS(OFF) range -0.4..-5.0 V; arithmetic midpoint (form 2): " +
					"-(0.4 + 5.0) / 2 = -2.7 V.",
			},
			transconductance: {
				value: 2.8806584e-4,
				basis: "derived",
				source:
					"2SK30A/datasheets/toshiba-2sk30a.pdf, 'IDSS Rank Classification Y: 1.2-3.0 mA " +
					"(VDS = 10 V, VGS = 0 V)' (|Yfs| at 1 kHz not used)",
				derivation:
					"Printed Y-rank IDSS range 1.2-3.0 mA; arithmetic midpoint (form 2): " +
					"(1.2 + 3.0) / 2 = 2.1 mA. Square law (form 3) with the derived Vt0 -2.7 V: " +
					"Beta = 2.1e-3 / 2.7^2 = 2.8806584e-4 S.",
			},
		},
	},
	{
		partIds: ["2SK30A-GR"],
		aliases: ["2SK30ATM-GR"],
		class: "jfet",
		params: {
			thresholdVolts: {
				value: -2.7,
				basis: "derived",
				source:
					"2SK30A/datasheets/toshiba-2sk30a.pdf (Toshiba 2SK30A) ELECTRICAL " +
					"CHARACTERISTICS (Ta = 25C): shared 'VGS(OFF), VDS = 10 V, ID = 0.1 uA, " +
					"-0.4 to -5.0 V' row (see the 2SK30A-Y entry)",
				derivation:
					"Printed VGS(OFF) range -0.4..-5.0 V; arithmetic midpoint (form 2): -2.7 V.",
			},
			transconductance: {
				value: 6.2414266e-4,
				basis: "derived",
				source:
					"2SK30A/datasheets/toshiba-2sk30a.pdf, 'IDSS Rank Classification GR: 2.6-6.5 mA " +
					"(VDS = 10 V, VGS = 0 V)'",
				derivation:
					"Printed GR-rank IDSS range 2.6-6.5 mA; arithmetic midpoint (form 2): " +
					"(2.6 + 6.5) / 2 = 4.55 mA. Square law (form 3): " +
					"Beta = 4.55e-3 / 2.7^2 = 6.2414266e-4 S.",
			},
		},
	},
	{
		// Wave 4. Toshiba 2SK118 (2003-03-25): same table as the 2SK30A sheet (IDSS
		// 0.3-6.5 mA, VGS(off) -0.4..-5.0 V, ranks R/O/Y/GR). Unbinned plus the
		// corpus-dominant Y rank (eighteen 2SK118Y uses); R/O/GR stay out.
		partIds: ["2SK118"],
		class: "jfet",
		params: {
			thresholdVolts: {
				value: -2.7,
				basis: "derived",
				source:
					"2SK118/datasheets/toshiba-2sk118.pdf (Toshiba 2SK118, 2003-03-25) p1, ELECTRICAL " +
					"CHARACTERISTICS (Ta = 25C): 'Gate-source cut-off voltage VGS (OFF), VDS = 10 V, " +
					"ID = 0.1 uA, MIN -0.4 MAX -5.0 V' with 'Note: IDSS classification R: 0.3~0.75, " +
					"O: 0.6~1.4, Y: 1.2~3.0, GR: 2.6~6.5 mA'",
				derivation:
					"Printed VGS(OFF) range -0.4..-5.0 V; arithmetic midpoint (form 2): -2.7 V.",
			},
			transconductance: {
				value: 4.6639232e-4,
				basis: "derived",
				source:
					"2SK118/datasheets/toshiba-2sk118.pdf (Toshiba 2SK118, 2003-03-25) p1: 'Drain " +
					"current IDSS (Note), VDS = 10 V, VGS = 0, MIN 0.3 MAX 6.5 mA' (|Yfs| not used)",
				derivation:
					"Printed IDSS range 0.3-6.5 mA; arithmetic midpoint (form 2): (0.3 + 6.5) / 2 = " +
					"3.4 mA. Square law (form 3): Beta = 3.4e-3 / 2.7^2 = 4.6639232e-4 S.",
			},
		},
	},
	{
		partIds: ["2SK118Y", "2SK118-Y"],
		class: "jfet",
		note:
			"The hyphenated and unhyphenated spellings fold to one id (2sk118y); both are " +
			"corpus-observed.",
		params: {
			thresholdVolts: {
				value: -2.7,
				basis: "derived",
				source:
					"2SK118/datasheets/toshiba-2sk118.pdf (Toshiba 2SK118, 2003-03-25) p1, shared " +
					"VGS(OFF) row '-0.4 to -5.0 V' (see the 2SK118 entry)",
				derivation:
					"Printed VGS(OFF) range -0.4..-5.0 V; arithmetic midpoint (form 2): -2.7 V.",
			},
			transconductance: {
				value: 2.8806584e-4,
				basis: "derived",
				source:
					"2SK118/datasheets/toshiba-2sk118.pdf (Toshiba 2SK118, 2003-03-25) p1, 'Note: IDSS " +
					"classification Y: 1.2~3.0 mA (VDS = 10 V, VGS = 0 V)'",
				derivation:
					"Printed Y-rank IDSS range 1.2-3.0 mA; arithmetic midpoint (form 2): 2.1 mA. " +
					"Square law (form 3): Beta = 2.1e-3 / 2.7^2 = 2.8806584e-4 S.",
			},
		},
	},
	{
		// Wave 4. Toshiba 2SK184 (1997-04-10, scan, read visually). IDSS and VGS(off)
		// print MIN/MAX only (no TYP). Unbinned plus the corpus-used GR rank (fourteen
		// 2SK184GR/eight 2SK184-GR uses); Y/BL stay out. The corpus '2SK184SR' spelling
		// is not a sheet rank and stays uncovered.
		partIds: ["2SK184"],
		class: "jfet",
		params: {
			thresholdVolts: {
				value: -0.85,
				basis: "derived",
				source:
					"2SK184/datasheets/toshiba-2sk184.pdf (Toshiba 2SK184, 1997-04-10, scan, read " +
					"visually, no text layer) p1, ELECTRICAL CHARACTERISTICS (Ta = 25C): " +
					"'Gate-Source Cut-off Voltage VGS (OFF), VDS = 10 V, ID = 0.1 uA, " +
					"MIN -0.2 MAX -1.5 V' with 'Note: IDSS Classification Y: 1.2~3.0 mA, " +
					"GR: 2.6~6.5 mA, BL: 6.0~14.0 mA'",
				derivation:
					"Printed VGS(OFF) range -0.2..-1.5 V; arithmetic midpoint (form 2): " +
					"-(0.2 + 1.5) / 2 = -0.85 V.",
			},
			transconductance: {
				value: 1.0519031e-2,
				basis: "derived",
				source:
					"2SK184/datasheets/toshiba-2sk184.pdf (Toshiba 2SK184, 1997-04-10, scan) p1: " +
					"'Drain Current IDSS (Note), VDS = 10 V, VGS = 0, MIN 1.2 MAX 14.0 mA' " +
					"(|Yfs| at 1 kHz not used)",
				derivation:
					"Printed IDSS range 1.2-14.0 mA; arithmetic midpoint (form 2): (1.2 + 14.0) / 2 " +
					"= 7.6 mA. Square law (form 3): Beta = 7.6e-3 / 0.85^2 = 1.0519031e-2 S.",
			},
		},
	},
	{
		partIds: ["2SK184GR", "2SK184-GR"],
		class: "jfet",
		note:
			"The hyphenated and unhyphenated spellings fold to one id (2sk184gr); both are " +
			"corpus-observed.",
		params: {
			thresholdVolts: {
				value: -0.85,
				basis: "derived",
				source:
					"2SK184/datasheets/toshiba-2sk184.pdf (Toshiba 2SK184, 1997-04-10, scan) p1, " +
					"shared VGS(OFF) row '-0.2 to -1.5 V' (see the 2SK184 entry)",
				derivation:
					"Printed VGS(OFF) range -0.2..-1.5 V; arithmetic midpoint (form 2): -0.85 V.",
			},
			transconductance: {
				value: 6.2975779e-3,
				basis: "derived",
				source:
					"2SK184/datasheets/toshiba-2sk184.pdf (Toshiba 2SK184, 1997-04-10, scan) p1, " +
					"'Note: IDSS Classification GR: 2.6~6.5 mA (VDS = 10 V, VGS = 0 V)'",
				derivation:
					"Printed GR-rank IDSS range 2.6-6.5 mA; arithmetic midpoint (form 2): 4.55 mA. " +
					"Square law (form 3): Beta = 4.55e-3 / 0.85^2 = 6.2975779e-3 S.",
			},
		},
	},
	{
		// Wave 4. Toshiba 2SK209 (2014-03-01): same IDSS/VGS(off) rows as the 2SK184 sheet
		// (IDSS 1.2-14.0 mA, VGS(off) -0.2..-1.5 V, ranks Y/GR/BL). Unbinned only (no
		// corpus rank use to drive a rank entry).
		partIds: ["2SK209"],
		class: "jfet",
		params: {
			thresholdVolts: {
				value: -0.85,
				basis: "derived",
				source:
					"2SK209/datasheets/2sk209-toshiba.pdf (Toshiba 2SK209, 2014-03-01) p1, ELECTRICAL " +
					"CHARACTERISTICS (Ta = 25C): 'Gate-source cut-off voltage VGS (OFF), VDS = 10 V, " +
					"ID = 0.1 uA, MIN -0.2 MAX -1.5 V' with 'Note: IDSS classification Y: 1.2~3.0 mA, " +
					"GR: 2.6~6.5 mA, BL: 6.0~14 mA'",
				derivation:
					"Printed VGS(OFF) range -0.2..-1.5 V; arithmetic midpoint (form 2): -0.85 V.",
			},
			transconductance: {
				value: 1.0519031e-2,
				basis: "derived",
				source:
					"2SK209/datasheets/2sk209-toshiba.pdf (Toshiba 2SK209, 2014-03-01) p1: 'Drain " +
					"current IDSS (Note), VDS = 10 V, VGS = 0, MIN 1.2 MAX 14.0 mA'",
				derivation:
					"Printed IDSS range 1.2-14.0 mA; arithmetic midpoint (form 2): 7.6 mA. Square " +
					"law (form 3): Beta = 7.6e-3 / 0.85^2 = 1.0519031e-2 S.",
			},
		},
	},
	{
		// Wave 4, overturning the wave-3 exclusion (which read a university-hosted mirror):
		// the manufacturer sheet prints 2N5458 MIN/MAX columns with no TYP, and the IDSS
		// column prints a transcribed TYP 6.0 mA.
		partIds: ["2N5458"],
		class: "jfet",
		params: {
			thresholdVolts: {
				value: -4,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): onsemi 2N5457/D Rev. 6 Feb 2010, " +
					"p2, ELECTRICAL CHARACTERISTICS: 'Gate-Source Cutoff Voltage VGS(off), " +
					"VDS = 15 Vdc, ID = 10 nAdc: 2N5458 MIN -1.0 MAX -7.0 V' (no TYP; the 2N5457 " +
					"sibling column is -0.5..-6.0)",
				derivation:
					"Printed 2N5458 VGS(off) range -1.0..-7.0 V; arithmetic midpoint (form 2): " +
					"-(1.0 + 7.0) / 2 = -4.0 V.",
			},
			transconductance: {
				value: 3.75e-4,
				basis: "derived",
				source:
					"onsemi 2N5457/D Rev. 6 Feb 2010, p2: 'Zero-Gate-Voltage Drain Current IDSS, " +
					"VDS = 15 Vdc, VGS = 0: 2N5458 MIN 2.0 TYP 6.0 MAX 9.0 mA' (|yfs| not used)",
				derivation:
					"Printed 2N5458 IDSS TYP 6.0 mA transcribed. Square law (form 3) with the " +
					"derived Vt0 -4.0 V: Beta = 6e-3 / 4.0^2 = 3.75e-4 S.",
			},
		},
	},
	{
		// Wave 4, overturning the wave-3 exclusion (which had no manufacturer sheet): the
		// onsemi sheet prints an MPF4393 column. The cutoff row's symbol reads 'VGS', not
		// 'VGS(off)' -- coordinator ruling 2026-10-19: the VDS = 15 V, ID = 10 nA condition
		// is the standard pinch-off test, so the row is the VGS(off) quantity (form 3),
		// quoted verbatim with its printed symbol and disclosed here.
		partIds: ["MPF4393"],
		class: "jfet",
		params: {
			thresholdVolts: {
				value: -1.75,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): onsemi MPF4392/D Rev. 6 Feb 2012, " +
					"p2, ELECTRICAL CHARACTERISTICS (TA = 25C): 'Gate Source Voltage VGS " +
					"(VDS = 15 Vdc, ID = 10 nAdc): MPF4393 MIN -0.5 MAX -3.0 Vdc' (no TYP; the " +
					"MPF4392 sibling column is -2.0..-5.0)",
				derivation:
					"Printed MPF4393 gate-source cutoff range -0.5..-3.0 V at VDS = 15 V, ID = 10 nA " +
					"(the 10 nA cutoff condition makes this the VGS(off) quantity despite the VGS " +
					"symbol); arithmetic midpoint (form 2): -(0.5 + 3.0) / 2 = -1.75 V.",
			},
			transconductance: {
				value: 5.7142857e-3,
				basis: "derived",
				source:
					"onsemi MPF4392/D Rev. 6 Feb 2012, p2: 'Zero-Gate-Voltage Drain Current IDSS " +
					"(VDS = 15 Vdc, VGS = 0): MPF4393 MIN 5.0 MAX 30 mAdc' (no TYP)",
				derivation:
					"Printed MPF4393 IDSS range 5.0-30 mA; arithmetic midpoint (form 2): " +
					"(5.0 + 30) / 2 = 17.5 mA. Square law (form 3) with the derived Vt0 -1.75 V: " +
					"Beta = 17.5e-3 / 1.75^2 = 5.7142857e-3 S.",
			},
		},
	},
	{
		// Wave 4. onsemi J309/D: VGS(off) and IDSS print MIN/MAX only (no TYP). Small-signal
		// yfs/gfs rows at 1 kHz and RF are not the square-law Beta.
		partIds: ["J309"],
		class: "jfet",
		params: {
			thresholdVolts: {
				value: -2.5,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): onsemi J309/D Rev. 1 Mar 2006, " +
					"p2, ELECTRICAL CHARACTERISTICS: 'Gate Source Cutoff Voltage VGS(off), " +
					"VDS = 10 Vdc, ID = 1.0 nAdc: J309 MIN -1.0 MAX -4.0 Vdc' (no TYP; the J310 " +
					"sibling column is -2.0..-6.5)",
				derivation:
					"Printed J309 VGS(off) range -1.0..-4.0 V; arithmetic midpoint (form 2): " +
					"-(1.0 + 4.0) / 2 = -2.5 V.",
			},
			transconductance: {
				value: 3.36e-3,
				basis: "derived",
				source:
					"onsemi J309/D Rev. 1 Mar 2006, p2: 'Zero-Gate-Voltage Drain Current IDSS, " +
					"VDS = 10 Vdc, VGS = 0: J309 MIN 12 MAX 30 mAdc' (no TYP)",
				derivation:
					"Printed J309 IDSS range 12-30 mA; arithmetic midpoint (form 2): (12 + 30) / 2 " +
					"= 21 mA. Square law (form 3) with the derived Vt0 -2.5 V: " +
					"Beta = 21e-3 / 2.5^2 = 3.36e-3 S.",
			},
		},
	},
	{
		// Wave 4. Same InterFET document, revision and conditions as the wave-1 J201 row
		// (IF35018.R00 June 2019, 'J201-2, 2 of 4'): the J202 columns print IDSS and
		// VGS(OFF), so J202 carries a full channel where wave 1 carried only J201.
		partIds: ["J202"],
		class: "jfet",
		params: {
			thresholdVolts: {
				value: -2.4,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): InterFET IF35018.R00 June 2019 " +
					"(J201-2, 2 of 4, jfet-j201-j202-interfet.pdf) p2, Electrical Characteristics, " +
					"Static Characteristics: 'VGS(OFF) Gate to Source Cutoff Voltage, VDS = 20 V, " +
					"ID = 10 nA: J202 MIN -0.8 MAX -4 V' (no TYP; the J201 sibling column is -0.3..-1.5)",
				derivation:
					"Printed J202 VGS(OFF) range -0.8..-4 V; arithmetic midpoint (form 2): " +
					"-(0.8 + 4.0) / 2 = -2.4 V.",
			},
			transconductance: {
				value: 4.6875e-4,
				basis: "derived",
				source:
					"InterFET IF35018.R00 June 2019 p2: 'IDSS Drain to Source Saturation Current, " +
					"VGS = 0 V, VDS = 20 V (Pulsed): J202 MIN 0.9 MAX 4.5 mA' (GFS/GOS/Ciss/Crss/en " +
					"TYP rows are not converted: no fifth form)",
				derivation:
					"Printed J202 IDSS range 0.9-4.5 mA; arithmetic midpoint (form 2): (0.9 + 4.5) / " +
					"2 = 2.7 mA. Square law (form 3) with the derived Vt0 -2.4 V: " +
					"Beta = 2.7e-3 / 2.4^2 = 4.6875e-4 S.",
			},
		},
	},
	{
		// Wave 4, overturning the wave-3 note (which read the IDSS row as MAX-only): the
		// Fairchild table prints MIN and MAX columns, so the pair exists. VGS(off) and
		// IDSS print no TYP. gfs at 1 kHz is not the square-law Beta.
		partIds: ["PF5102"],
		class: "jfet",
		params: {
			thresholdVolts: {
				value: -1.15,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): Fairchild PF5102 Rev. B0 (2011, " +
					"'N-Channel Switch') p1, table MIN/MAX columns: 'VGS(off) Gate-Source Cutoff " +
					"Voltage, VDS = 15 V, ID = 1.0 nA, MIN -0.7 MAX -1.6 V' (no TYP)",
				derivation:
					"Printed PF5102 VGS(off) range -0.7..-1.6 V; arithmetic midpoint (form 2): " +
					"-(0.7 + 1.6) / 2 = -1.15 V.",
			},
			transconductance: {
				value: 9.073724e-3,
				basis: "derived",
				source:
					"Fairchild PF5102 Rev. B0 p1: 'IDSS Zero-Gate Voltage Drain Current, VDS = 15 V, " +
					"VGS = 0, MIN 4.0 MAX 20 mA' (no TYP)",
				derivation:
					"Printed PF5102 IDSS range 4.0-20 mA; arithmetic midpoint (form 2): (4.0 + 20) / " +
					"2 = 12 mA. Square law (form 3) with the derived Vt0 -1.15 V: " +
					"Beta = 12e-3 / 1.15^2 = 9.073724e-3 S.",
			},
		},
	},
	{
		// Wave 5. GR rank (no corpus rank use beyond the backlog token; Y/BL stay out).
		// Vendored Toshiba 2SK209 sheet (doc 2014-03-01) p1: the VGS(OFF) row is shared
		// (no rank split) and the Note classifies IDSS (Y 1.2-3.0, GR 2.6-6.5, BL 6.0-14).
		// 2SK209G is NOT added: no document names it (most likely a truncated marking
		// of 2SK209-GR). |Yfs| 4.0/15 mS at 1 kHz is small-signal, not used.
		partIds: ["2SK209-GR", "2SK209GR"],
		class: "jfet",
		params: {
			thresholdVolts: {
				value: -0.85,
				basis: "derived",
				source:
					"jfets/2SK209/datasheets/2sk209-toshiba.pdf (Toshiba 2SK209, start of commercial " +
					"production 1981-06, doc 2014-03-01) p1, ELECTRICAL CHARACTERISTICS (Ta = 25C): " +
					"'Gate-source cut-off voltage VGS (OFF), VDS = 10 V, ID = 0.1 uA: MIN -0.2 " +
					"MAX -1.5 V' (shared row, no rank split)",
				derivation:
					"Printed VGS(OFF) range -0.2..-1.5 V at VDS = 10 V, ID = 0.1 uA; arithmetic " +
					"midpoint (form 2, volts are not gains): -(-0.2 + -1.5) / 2 = -0.85 V.",
			},
			transconductance: {
				value: 6.2975779e-3,
				basis: "derived",
				source:
					"jfets/2SK209/datasheets/2sk209-toshiba.pdf (Toshiba 2SK209, doc 2014-03-01) p1: " +
					"'Drain current IDSS, VDS = 10 V, VGS = 0: MIN 1.2 MAX 14.0 mA' with 'Note: IDSS " +
					"classification Y: 1.2~3.0 mA, GR: 2.6~6.5 mA, BL: 6.0~14 mA'",
				derivation:
					"Printed GR IDSS range 2.6-6.5 mA; arithmetic midpoint (form 2): (2.6 + 6.5) / 2 = " +
					"4.55 mA. Square law (form 3) with the derived Vt0 -0.85 V: Beta = IDSS / Vt0^2 = " +
					"4.55e-3 / 0.85^2 = 6.2975779e-3 S.",
			},
		},
	},
	{
		// Wave 5. R rank (Toshiba 2SK208 via the Farnell-hosted Toshiba original,
		// 3622372.pdf, doc 2014-03-01) p1: VGS(OFF) -0.4..-5.0 at 10 V/0.1 uA (shared
		// row) with the Note classifying IDSS (R 0.30-0.75, O 0.60-1.40, Y 1.2-3.0,
		// GR 2.6-6.5 mA). |Yfs| 1.2 mS at 1 kHz is small-signal, not used.
		partIds: ["2SK208-R", "2SK208R"],
		class: "jfet",
		params: {
			thresholdVolts: {
				value: -2.7,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): Toshiba 2SK208 (Farnell 3622372.pdf, " +
					"doc 2014-03-01) p1, ELECTRICAL CHARACTERISTICS (Ta = 25C): 'Gate-source cut-off " +
					"voltage VGS (OFF), VDS = 10 V, ID = 0.1 uA: MIN -0.4 MAX -5.0 V' (shared row)",
				derivation:
					"Printed VGS(OFF) range -0.4..-5.0 V at VDS = 10 V, ID = 0.1 uA; arithmetic " +
					"midpoint (form 2): -(-0.4 + -5.0) / 2 = -2.7 V.",
			},
			transconductance: {
				value: 7.2016461e-5,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): Toshiba 2SK208 (Farnell 3622372.pdf) " +
					"p1: 'Drain current IDSS, VDS = 10 V, VGS = 0: MIN 0.3 MAX 6.5 mA' with 'Note: IDSS " +
					"classification R: 0.30 to 0.75 mA, O: 0.60 to 1.40 mA, Y: 1.2 to 3.0 mA, " +
					"GR: 2.6 to 6.5 mA'",
				derivation:
					"Printed R IDSS range 0.30-0.75 mA; arithmetic midpoint (form 2): (0.30 + 0.75) / " +
					"2 = 0.525 mA. Square law (form 3) with the derived Vt0 -2.7 V: Beta = IDSS / " +
					"Vt0^2 = 0.525e-3 / 2.7^2 = 7.2016461e-5 S.",
			},
		},
	},
	{
		// Wave 5. Y rank on the same 2SK208 sheet (serves the 2SK208-Y backlog row).
		partIds: ["2SK208-Y", "2SK208Y"],
		class: "jfet",
		params: {
			thresholdVolts: {
				value: -2.7,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): Toshiba 2SK208 (Farnell 3622372.pdf, " +
					"doc 2014-03-01) p1: 'Gate-source cut-off voltage VGS (OFF), VDS = 10 V, ID = 0.1 uA: " +
					"MIN -0.4 MAX -5.0 V' (shared row, same as the R-rank record)",
				derivation:
					"Printed VGS(OFF) range -0.4..-5.0 V; arithmetic midpoint (form 2): -2.7 V.",
			},
			transconductance: {
				value: 2.8806584e-4,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): Toshiba 2SK208 (Farnell 3622372.pdf) " +
					"p1 IDSS Note: 'Y: 1.2 to 3.0 mA'",
				derivation:
					"Printed Y IDSS range 1.2-3.0 mA; arithmetic midpoint (form 2): (1.2 + 3.0) / 2 = " +
					"2.1 mA. Square law (form 3) with the derived Vt0 -2.7 V: Beta = 2.1e-3 / 2.7^2 = " +
					"2.8806584e-4 S.",
			},
		},
	},
	{
		// Wave 5. Unbinned 2SK3557 (no corpus rank use). onsemi 2SK3557/D, Sep 2024
		// Rev. 3: VGS(off) prints MIN/TYP/MAX (-0.3/-0.7/-1.5 at 5 V/100 uA) and IDSS
		// MIN/MAX only (10-32 mA, rank-classified 6: 10-20 / 7: 16-32). Vt0 is the
		// range midpoint (form 2), NOT the printed -0.7 TYP. |yfs| 24/35 mS not used.
		partIds: ["2SK3557"],
		class: "jfet",
		params: {
			thresholdVolts: {
				value: -0.9,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): onsemi 2SK3557/D, Sep 2024 Rev. 3, " +
					"Electrical Characteristics (Ta = 25C): 'Cutoff Voltage VGS(off), VDS = 5 V, " +
					"ID = 100 uA: MIN -0.3 TYP -0.7 MAX -1.5 V'",
				derivation:
					"Printed VGS(off) range -0.3..-1.5 V at VDS = 5 V, ID = 100 uA; arithmetic " +
					"midpoint (form 2, volts are not gains): -(-0.3 + -1.5) / 2 = -0.9 V (the printed " +
					"-0.7 TYP is not transcribed: the registry takes one value by the stated rule).",
			},
			transconductance: {
				value: 2.5925926e-2,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): onsemi 2SK3557/D, Sep 2024 Rev. 3: " +
					"'Drain Current IDSS, VDS = 5 V, VGS = 0 V: min 10 max 32 mA' (no TYP; 'classified " +
					"by IDSS: Rank 6: 10.0-20.0, Rank 7: 16.0-32.0 mA')",
				derivation:
					"Printed unbinned IDSS range 10-32 mA; arithmetic midpoint (form 2): (10 + 32) / 2 = " +
					"21 mA. Square law (form 3) with the derived Vt0 -0.9 V: Beta = 21e-3 / 0.9^2 = " +
					"2.5925926e-2 S.",
			},
		},
	},
	{
		// Wave 6 (transistor-records wave 1). O rank (2SC1815-Y/BL precedent: a rank
		// is a different gain, so its own entry). The Toshiba 2SK30ATM sheet
		// (1997-04-10, scan, read visually, no text layer) prints the same table as
		// the 2SK30A sheet: IDSS 0.3-6.5 mA (no TYP), VGS(OFF) -0.4..-5.0 V at
		// VDS = 10 V, ID = 0.1 uA, with Note 'IDSS Classification R: 0.30~0.75,
		// O: 0.60~1.40, Y: 1.20~3.00, GR: 2.60~6.50' (same ranks as the registered
		// Y/GR entries). |Yfs| 1.2 mS at 1 kHz is small-signal, not used.
		partIds: ["2SK30A-O"],
		class: "jfet",
		params: {
			thresholdVolts: {
				value: -2.7,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): Toshiba 2SK30ATM (1997-04-10, " +
					"scan p1, read visually, no text layer) ELECTRICAL CHARACTERISTICS (Ta = 25C): " +
					"'Gate-Source Cut-off Voltage VGS(OFF), VDS = 10 V, ID = 0.1 uA, MIN -0.4 MAX -5.0 V' " +
					"(shared row, no rank split; same table as the 2SK30A sheet behind the Y/GR entries)",
				derivation:
					"Printed VGS(OFF) range -0.4..-5.0 V at VDS = 10 V, ID = 0.1 uA; arithmetic " +
					"midpoint (form 2, volts are not gains): -(0.4 + 5.0) / 2 = -2.7 V.",
			},
			transconductance: {
				value: 1.3717421e-4,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): Toshiba 2SK30ATM (1997-04-10, " +
					"scan p1) 'Note: IDSS Classification O: 0.60~1.40 mA (VDS = 10 V, VGS = 0 V)'",
				derivation:
					"Printed O-rank IDSS range 0.60-1.40 mA; arithmetic midpoint (form 2): " +
					"(0.60 + 1.40) / 2 = 1.0 mA. Square law (form 3) with the derived Vt0 -2.7 V: " +
					"Beta = 1.0e-3 / 2.7^2 = 1.3717421e-4 S.",
			},
		},
	},
]);
