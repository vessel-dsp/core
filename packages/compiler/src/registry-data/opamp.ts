// Op-amp registry data: the datasheet-typical gain-bandwidth product and the printed
// output-swing pair, by exact part id.
// 
// **One record per datasheet row, carrying every parameter that row states.** The
// pre-registry catalog kept two parallel tables (gain-bandwidth rows, output-swing rows)
// applied by two passes; a part with both figures (OP07, TL06x) appeared in both. Merging
// them into one record per row keeps the loader's uniqueness scope meaningful -- the same
// folded id in two records is a table error and throws -- while the two stamping passes in
// `part-catalog.ts` read the same records and split entries exactly as before.
// 
// Provenance, per parameter:
// - `gainBandwidthHz`: the TYP column transcribed ("typical" here is that datasheet's own
//   TYP column for that part, never MIN or MAX, never a graph read by eye, never a registry
//   or curated-record number). Basis `datasheet`; `source` quotes the printed row.
// - `outputSwingDropHighVolts` / `outputSwingDropLowVolts`: the distance the output stops
//   short of each rail, read off the printed row (a +-VOM row states both sides at once, so
//   the pair is equal by print; the subtraction is documented in each source). Basis
//   `datasheet`: the value is a direct reading of the printed row, not a fit or a choice.
//   The judgment call -- how the pair is carried to a pedal on another supply -- stays
//   exactly where it was, in `outputSwingPrinted.translation`, untouched by this move.
// 
// A part whose datasheet prints no TYP figure is not in `opampRegistryRecords`; it is
// listed in the matching `...Absent` list with the reason, and stays `null` at the stamp.
// Both lists live here (they are data: id lists with reasons, validated non-empty), and
// `part-catalog.ts` re-exports them under their existing names.

import type { OpampOutputSwingTranslation } from "../types";
import { foldPartId } from "../registry";
import { validateCitedParam, type CitedParam } from "./loader";

/** The printed condition a swing pair was read at, and how it is carried. */
export type OpampSwingPrinted = {
	/** The printed row's total supply, VS+ minus VS- (30 for +-15 V). */
	readonly supplyVolts: number;
	readonly loadOhms: number;
	readonly translation: OpampOutputSwingTranslation;
	/** The printed column the figure was read from. */
	readonly column: string;
};

/**
 * Every datasheet-stated parameter for one row of part ids. A record states a
 * gain-bandwidth product, a swing pair, or both; a record with neither is a table error.
 * Drops are both or neither, with the printed condition exactly when the pair is.
 */
export type OpampRegistryRecord = {
	readonly partIds: readonly string[];
	readonly gainBandwidthHz?: CitedParam;
	readonly outputSwingDropHighVolts?: CitedParam;
	readonly outputSwingDropLowVolts?: CitedParam;
	readonly outputSwingPrinted?: OpampSwingPrinted;
};

/** Validate op-amp records and freeze them. Throws at module load on any violation. */
export function defineOpampRecords(
	records: readonly OpampRegistryRecord[],
): readonly OpampRegistryRecord[] {
	const seen = new Map<string, string>();
	for (const record of records) {
		const label = record.partIds.join(",") || "(no part ids)";
		if (record.partIds.length === 0) {
			throw new Error(`${label}: an op-amp record names no part ids`);
		}
		if (record.gainBandwidthHz !== undefined) {
			const cited = validateCitedParam(label, "gainBandwidthHz", record.gainBandwidthHz);
			if (!(cited.value > 0)) {
				throw new Error(
					`${label}: gainBandwidthHz must be a positive product, not ${String(cited.value)}`,
				);
			}
		}
		const high = record.outputSwingDropHighVolts;
		const low = record.outputSwingDropLowVolts;
		const printed = record.outputSwingPrinted;
		if (
			high === undefined ||
			low === undefined ||
			printed === undefined
		) {
			if (high !== undefined || low !== undefined || printed !== undefined) {
				throw new Error(
					`${label}: an op-amp output swing is a pair with its printed condition, ` +
						`both sides and the condition or none (high ${high === undefined ? "absent" : "present"}, ` +
						`low ${low === undefined ? "absent" : "present"}, ` +
						`printed ${printed === undefined ? "absent" : "present"})`,
				);
			}
		} else {
			validateCitedParam(label, "outputSwingDropHighVolts", high);
			validateCitedParam(label, "outputSwingDropLowVolts", low);
			const finitePositive = (value: number): boolean =>
				typeof value === "number" && Number.isFinite(value) && value > 0;
			if (
				!finitePositive(high.value) ||
				!finitePositive(low.value) ||
				!finitePositive(printed.supplyVolts) ||
				!finitePositive(printed.loadOhms) ||
				(printed.translation !== "constant" && printed.translation !== "proportional")
			) {
				throw new Error(
					`${label}: an op-amp output swing needs finite positive drops, supply and load ` +
						`and a translation of "constant" or "proportional"`,
				);
			}
			if (printed.column.length === 0) {
				throw new Error(`${label}: an op-amp output swing states no printed column`);
			}
		}
		if (
			record.gainBandwidthHz === undefined &&
			high === undefined
		) {
			throw new Error(`${label}: an op-amp record states no parameter`);
		}
		for (const id of record.partIds) {
			if (typeof id !== "string" || id.length === 0) {
				throw new Error(`${label}: an op-amp record lists an empty part id`);
			}
			const folded = foldPartId(id);
			const first = seen.get(folded);
			if (first !== undefined) {
				throw new Error(
					`${label}: duplicate op-amp part id "${id}" (already listed on ${first})`,
				);
			}
			seen.set(folded, label);
		}
	}
	return Object.freeze(records.map((record) => Object.freeze(record)));
}

export const opampRegistryRecords: readonly OpampRegistryRecord[] = defineOpampRecords([
	{
		partIds: ["NJM4558DD", "NJM4558D", "JRC4558D", "NJM4558M", "NJM4558E", "NJM4558V", "NJM4558L", "NJM4558"],
		gainBandwidthHz: {
			value: 3e6,
			basis: "datasheet",
			source:
				"NJM4558/datasheets/nisshinbo-njm4558.pdf (Nisshinbo NJM4558, date code 20250303) p2, ELECTRICAL " +
				"CHARACTERISTICS (V+/V-=+-15V, Ta=25C): 'Gain Bandwidth Product | GB | MIN - | TYP 3 | MAX - | MHz'. " +
				"One column for every suffix; the D rank changes the noise row only. " +
				"JRC4558D is not a printed id in this sheet: it is the NJR/JRC marking of the NJM4558D per " +
				"parts/op-amps/JRC4558D.md ('NJR/JRC version. Same datasheet specs as NJM4558'; GBP 3 M), included per " +
				"owner decision 2026-10-15 because a Boss SD-1 specimen carries a chip marked 'JRC 4558D' and three " +
				"corpus packets name JRC4558D. Secondary only: the 1980s JRC databook scan prints the part as NJM4558D " +
				"under the JRC logo (p2-98).",
		},
	},
	{
		partIds: ["RC4558", "RC4558P", "RC4558D"],
		gainBandwidthHz: {
			value: 4e6,
			basis: "datasheet",
			source:
				"RC4558/datasheets/rc4558-ti.pdf and RC4558P/datasheets/rc4558p-ti.pdf (TI SLOS073H, rev Oct 2024; the " +
				"two are identical through p35) 5.5 p6, VCC+-=+-15V, TA=25C, RL=2k: 'GBW | Gain-bandwidth product | " +
				"f = 10kHz | TYP 4 | MHz'. Rev G printed 3 MHz; this copy (Rev H) changed it to 4.",
		},
	},
	{
		partIds: ["TL061", "TL061CP", "TL061CN", "TL062", "TL062C", "TL062CP", "TL062CN"],
		gainBandwidthHz: {
			value: 1e6,
			basis: "datasheet",
			source:
				"TL062/datasheets/tl062.pdf (TI SLOS078N, rev Aug 2023) Table 6.7 p8 (the same row and value in Tables " +
				"6.8 p9 and 6.9 p10): 'B1 | Unity-gain bandwidth | RL = 10k, TA = 25C | TYP 1 | MHz' in every grade column.",
		},
		outputSwingDropHighVolts: {
			value: 1.5,
			basis: "datasheet",
			source:
				"TL062/datasheets/tl062.pdf (TI SLOS078N, rev Aug 2023) Table 6.7 p8, 'VCC+- = +-15 V, RL = 10 kOhm to " +
				"(VCC+ + VCC-)/2 (unless otherwise noted)': 'VOM | Maximum peak output voltage swing | RL = 10 kOhm, TA = 25C " +
				"| MIN +-10 | TYP +-13.5 | V' in both the TL06xC and the TL06xAC column (TA = full range, RL >= 10 kOhm: MIN " +
				"+-10). A +-VOM row states both sides at once: 15 - 13.5 = 1.5 V a side. The ids are the gain-bandwidth " +
				"row's, whose convention this follows. 'constant' is the owner's decision of 2026-10-17 (row 16, D3): the " +
				"sheet prints no figure below +-15 V; Figure 6-1 (VOM against |VCC+-|, RL = 10 kOhm) is a graph, and the " +
				"1.2 V that was read from it by eye (about 3.3 V at +-4.5 V) is retired because it is not printed.",
		},
		outputSwingDropLowVolts: {
			value: 1.5,
			basis: "datasheet",
			source:
				"TL062/datasheets/tl062.pdf (TI SLOS078N, rev Aug 2023) Table 6.7 p8, 'VCC+- = +-15 V, RL = 10 kOhm to " +
				"(VCC+ + VCC-)/2 (unless otherwise noted)': 'VOM | Maximum peak output voltage swing | RL = 10 kOhm, TA = 25C " +
				"| MIN +-10 | TYP +-13.5 | V' in both the TL06xC and the TL06xAC column (TA = full range, RL >= 10 kOhm: MIN " +
				"+-10). A +-VOM row states both sides at once: 15 - 13.5 = 1.5 V a side. The ids are the gain-bandwidth " +
				"row's, whose convention this follows. 'constant' is the owner's decision of 2026-10-17 (row 16, D3): the " +
				"sheet prints no figure below +-15 V; Figure 6-1 (VOM against |VCC+-|, RL = 10 kOhm) is a graph, and the " +
				"1.2 V that was read from it by eye (about 3.3 V at +-4.5 V) is retired because it is not printed.",
		},
		outputSwingPrinted: {
			supplyVolts: 30,
			loadOhms: 10000,
			translation: "constant",
			column: "TL061C/TL062C and TL061AC/TL062AC, TYP",
		},
	},
	{
		partIds: ["TL071CP", "TL072CP", "TL082CP"],
		gainBandwidthHz: {
			value: 5.25e6,
			basis: "datasheet",
			source:
				"TL072/datasheets/tl072.pdf and TL071/datasheets/tl071.pdf (byte-identical; TI SLOS080W, rev Jul 2025) " +
				"5.8 p15, VS=+-15V, TA=25C: 'GBW | Gain-bandwidth product | All other devices | TYP 5.25 | MHz' (the row " +
				"'All NS and PS packages; All TL07xM devices' is TYP 3). TL082CP: TL082/datasheets/tl082.pdf (SLOS081O, " +
				"rev Sep 2025) 5.8 p14, the same two rows; its Rev N entry p29: 'Increased gain bandwidth of all " +
				"non-NS/non-PS packages and non-TL08xM devices from 3 MHz to 5.25 MHz'. A -CP part is a PDIP: neither an " +
				"NS/PS package nor an M device, so the 'all other devices' row applies.",
		},
	},
	{
		partIds: ["NE5532", "NE5532P", "NE5532D"],
		gainBandwidthHz: {
			value: 12e6,
			basis: "datasheet",
			source:
				"NE5532/datasheets/ne5532.pdf (TI SLOS075K, rev Dec 2025) 5.5 p4, VCC+-=+-15V, TA=25C: 'B1 | Unity-gain " +
				"bandwidth | TYP 12 | MHz' (p1 Features: '12MHz Typ'; Rev K p11: 'Changed ... from 10MHz to 12MHz typ'). " +
				"The same document's prose, 6.3.1 p6 and 7.1.2.1 p8, still says 10 MHz; the characteristics table is taken.",
		},
	},
	{
		partIds: ["LM358", "LM358N", "LM358P"],
		gainBandwidthHz: {
			value: 0.7e6,
			basis: "datasheet",
			source:
				"LM358/datasheets/lm358-ti.pdf (TI SLOS068AB, rev Oct 2024) 5.7 p10 (LM358, LM358A), VS=5V, TA=25C: " +
				"'GBW | Gain bandwidth product | TYP 0.7 | MHz'. The B/BA versions (5.5 p6) are TYP 1.2 and are different " +
				"part ids; the only PDIP orderables printed are LM358P and LM358AP.",
		},
	},
	{
		partIds: ["M5218AL", "M5218AP", "M5218AFP"],
		gainBandwidthHz: {
			value: 7e6,
			basis: "datasheet",
			source:
				"5218/datasheets/mitsubishi-m5218.pdf (Mitsubishi M5218AL/P/FP, no document number or date; image scan) " +
				"p2 (folio 2-468), Ta=25C, Vcc=+-15V: 'fT | Gain bandwidth product | TYP 7 | MHz' (p1 Features: " +
				"'fT=7MHz(typ.)'). The sheet is the A grade; the plain M5218L, P and FP ids are not on it.",
		},
	},
	{
		partIds: ["TL022", "TL022C", "TL022CP", "TL022CD", "TL022CN"],
		gainBandwidthHz: {
			value: 0.5e6,
			basis: "datasheet",
			source:
				"TL022/datasheets/ti-tl022.pdf (TI SLOS076, rev Sep 1990) p3, VCC+-=+-15V, TA=25C: 'B1 | Unity-gain " +
				"bandwidth | TL022C TYP 0.5 | TL022M TYP 0.5 | MHz'.",
		},
	},
	{
		partIds: ["OP07CP", "OP07DP", "OP07DN"],
		gainBandwidthHz: {
			value: 0.6e6,
			basis: "datasheet",
			source:
				"OP07/datasheets/op07-ti.pdf (TI SLOS099H, rev Mar 2023) 6.5 p6, TA=25C, VS=+-15V, RL=2k, FREQUENCY " +
				"RESPONSE: 'Unity gain bandwidth | MIN 0.4 | TYP 0.6 | MHz'; footnote (1): the listed specifications apply " +
				"to OP07C and OP07D. The row has no package split.",
		},
		outputSwingDropHighVolts: {
			value: 2.2,
			basis: "datasheet",
			source:
				"OP07/datasheets/op07-ti.pdf (TI SLOS099H, rev Mar 2023) 6.5 p6 (continued table), 'at TA = 25C, VS = +-15 V, " +
				"RL = 2 kOhm connected to mid-supply, and VCM = VOUT = mid-supply (unless otherwise noted)': 'OUTPUT | Voltage " +
				"output swing | MIN +-11.5 | TYP +-12.8 | V' (the group's first row, no test condition printed beside it, so " +
				"the table's default RL = 2 kOhm applies; the TA = 0C to 70C row reads +-11 / +-12.6, RL = 10 kOhm +-12 / " +
				"+-13, RL = 1 kOhm +-12 typ); footnote (1): the listed specifications apply to OP07C and OP07D, so the bare " +
				"'OP07' id has no column. A +-VOM row states both sides at once, so the pair is equal by " +
				"print: 15 - 12.8 = 2.2 V a side. 'proportional' is the owner's decision of 2026-10-17 (row 16): the rule " +
				"was written before the RAT pin-6 reading and that reading is its held-out test; the datasheet states " +
				"nothing below +-15 V. At a 9 V pedal it gives 0.66 V a side, with a printed bracket of 2.0 V (TYP, " +
				"RL = 10 kOhm: +-13) to 3.5 V (MIN, RL = 2 kOhm: +-11.5) at 30 V.",
		},
		outputSwingDropLowVolts: {
			value: 2.2,
			basis: "datasheet",
			source:
				"OP07/datasheets/op07-ti.pdf (TI SLOS099H, rev Mar 2023) 6.5 p6 (continued table), 'at TA = 25C, VS = +-15 V, " +
				"RL = 2 kOhm connected to mid-supply, and VCM = VOUT = mid-supply (unless otherwise noted)': 'OUTPUT | Voltage " +
				"output swing | MIN +-11.5 | TYP +-12.8 | V' (the group's first row, no test condition printed beside it, so " +
				"the table's default RL = 2 kOhm applies; the TA = 0C to 70C row reads +-11 / +-12.6, RL = 10 kOhm +-12 / " +
				"+-13, RL = 1 kOhm +-12 typ); footnote (1): the listed specifications apply to OP07C and OP07D, so the bare " +
				"'OP07' id has no column. A +-VOM row states both sides at once, so the pair is equal by " +
				"print: 15 - 12.8 = 2.2 V a side. 'proportional' is the owner's decision of 2026-10-17 (row 16): the rule " +
				"was written before the RAT pin-6 reading and that reading is its held-out test; the datasheet states " +
				"nothing below +-15 V. At a 9 V pedal it gives 0.66 V a side, with a printed bracket of 2.0 V (TYP, " +
				"RL = 10 kOhm: +-13) to 3.5 V (MIN, RL = 2 kOhm: +-11.5) at 30 V.",
		},
		outputSwingPrinted: {
			supplyVolts: 30,
			loadOhms: 2000,
			translation: "proportional",
			column: "OP07C and OP07D, TYP",
		},
	},
	{
		partIds: ["NE5534", "NJM5534", "NJM5534D", "NJM5534M"],
		gainBandwidthHz: {
			value: 10e6,
			basis: "datasheet",
			source:
				"NJM5534D/datasheets/NE5534_TI.pdf (TI SLOS070D, rev Nov 2014) 7.5 p5, VCC+-=+-15V, TA=25C: 'B1 | " +
				"Unity-gain bandwidth | CC = 22 pF, CL = 100 pF | TYP 10 | MHz'; and njrc-njm5534d-page-2.png (New Japan " +
				"Radio NJM5534, folio 4-236): 'Gain Bandwidth Product | GB | CC=22pF, CL=100pF | TYP 10 | MHz'. Both state " +
				"the figure with a 22 pF compensation capacitor.",
		},
	},
]);

/** Op-amp ids this catalog holds whose datasheet states no TYP gain-bandwidth figure, and why. */
export const opampGainBandwidthAbsent: ReadonlyArray<{
	readonly partIds: readonly string[];
	readonly reason: string;
}> = [
	{
		partIds: ["uPC4558C", "uPC4558G2", "uPC4558"],
		reason:
			"UPC4558/datasheets/renesas-upc258-upc4558.pdf (Renesas R03DS0145EJ0200 Rev 2.00) prints no gain-bandwidth " +
			"row: the p3 electrical characteristics list slew rate (1.0 V/us) and no GB/GBW/fT/B1. The p4 'AV vs. f' " +
			"graph reaches 0 dB near 1.5 MHz by eye, which is not a printed figure. The registry's 3 MHz has no " +
			"support in this sheet.",
	},
	{
		partIds: ["RC4558C", "4558"],
		reason:
			"RC4558C is not an orderable printed in SLOS073H, and '4558' is a generic name no datasheet owns.",
	},
	{
		partIds: ["TL071", "TL071CN", "TL072", "TL072CN", "TL072IP", "TL072D", "TL082"],
		reason:
			"The TL07x/TL08x GBW row splits on package and grade (TYP 3 MHz for NS/PS packages and M grades, TYP 5.25 " +
			"for all other devices). These ids do not state, or the datasheet does not print for them, which row " +
			"applies.",
	},
	{
		partIds: ["LF353", "LF353N", "LF353M", "LM741", "UA741", "uA741", "TA7504S", "TA7504", "MC33178", "MC33178P", "MC33178D", "BA718"],
		reason: "No vendored datasheet.",
	},
	{
		partIds: ["CA1458", "CA1458E", "CA1458T"],
		reason:
			"The datasheet this file cites for open-loop gain (Harris File Number 531.2) is not vendored in the " +
			"artifacts library, so no GBW row can be quoted.",
	},
	{
		partIds: [
			"M5218A", "M5218L", "M5218P", "M5218FP", "M5218",
			"M5216AL", "M5216AP", "M5216AFP", "M5216A", "M5216L", "M5216P", "M5216FP", "M5216",
			"M5281AL", "M5281AP", "M5281AFP", "M5281A", "M5281L", "M5281P", "M5281FP", "M5281",
		],
		reason:
			"The vendored Mitsubishi sheet is the M5218AL/P/FP document; the plain M5218 L/P/FP, the bare 'A' and " +
			"'M5218' ids are not printed on it, and M5216/M5281 appear in no vendored datasheet.",
	},
	{
		partIds: ["M5223L", "M5223P", "M5223FP", "M5223"],
		reason:
			"M5223AL/datasheets/m5223al-page-2.png has no gain-bandwidth row; its 'Voltage Gain vs Frequency Response' " +
			"graph reaches 0 dB near 1 MHz at VCC=15 V and near 2 MHz at VCC=30 V by eye.",
	},
	{
		partIds: ["OP07"],
		reason: "The OP07 sheet's electrical characteristics apply to OP07C and OP07D only; the bare id has no column.",
	},
	{
		partIds: ["TL022CP2", "AK4552VT", "AK4552", "AK4552VT13", "AK4552VT8"],
		reason: "Not an op-amp datasheet part: a converter or macro shell modelled with an op-amp section.",
	},
];

/** Op-amp ids this catalog holds that state no output-swing pair, and why. */
export const opampOutputSwingAbsent: ReadonlyArray<{
	readonly partIds: readonly string[];
	readonly reason: string;
}> = [
	{
		partIds: ["OP07"],
		reason:
			"The OP07 sheet's electrical characteristics apply to OP07C and OP07D only (footnote 1); the bare id has no column.",
	},
	{
		partIds: ["MC33178", "MC33178P", "MC33178D"],
		reason:
			"No MC33178 datasheet is vendored. The registry's 1.1 V (15 - 13.9, onsemi MC33178-D at +-15 V, RL = 2 kOhm) " +
			"is carried from a citation and was never re-read here, which does not meet the printed-TYP-only rule.",
	},
	{
		partIds: [
			"NJM4558DD", "NJM4558D", "JRC4558D", "NJM4558M", "NJM4558E", "NJM4558V", "NJM4558L", "NJM4558",
			"RC4558", "RC4558P", "RC4558D",
			"uPC4558C", "uPC4558G2", "uPC4558",
			"TL071", "TL071CN", "TL071CP", "TL072", "TL072CN", "TL072IP", "TL072D", "TL072CP", "TL082", "TL082CP",
			"NE5534", "NJM5534", "NJM5534D", "NJM5534M",
			"LM358", "LM358N", "LM358P",
		],
		reason:
			"A printed swing row exists in the vendored sheet (NJM4558 p2 +-12/+-14 at RL >= 10 kOhm and +-10/+-13 at " +
			"RL >= 2 kOhm; RC4558 SLOS073H 5.5 p6; uPC4558 R03DS0145EJ0200 p3, two tables and the sheet does not say which a " +
			"bare id belongs to; TL07x/TL08x SLOS080W 5.8; NE5534 SLOS070D 7.5 p5, peak-to-peak, constant 2.0 V a side at +-15 " +
			"V and +-18 V; LM358 SLOS068AB 5.7 p10, asymmetric and printed at 5 V and 30 V only) and is deliberately NOT typed: " +
			"owner decision D4, 2026-10-17. Every one is printed at +-15 V or more and almost every pedal runs at 9 V; typing " +
			"them would move about 25 corpus packets on a translation that has one held-out data point.",
	},
	{
		partIds: ["RC4558C", "4558"],
		reason: "RC4558C is not an orderable printed in SLOS073H and '4558' is a generic name no datasheet owns.",
	},
	{
		partIds: ["NE5532", "NE5532P", "NE5532D"],
		reason: "TI SLOS075K (Dec 2025) removed the output-swing row; its revision history says so.",
	},
	{
		partIds: ["TL022", "TL022C", "TL022CP", "TL022CD", "TL022CN"],
		reason: "TI SLOS076 prints VO(PP) as a peak-to-peak figure only (20 min / 26 typ at RL = 10 kOhm, +-15 V): no per-side figure.",
	},
	{
		partIds: ["LF353", "LF353N", "LF353M", "LM741", "UA741", "uA741", "TA7504S", "TA7504", "BA718", "CA1458", "CA1458E", "CA1458T"],
		reason: "No vendored datasheet for these ids.",
	},
	{
		partIds: [
			"M5218AL", "M5218AP", "M5218AFP", "M5218A", "M5218L", "M5218P", "M5218FP", "M5218",
			"M5216AL", "M5216AP", "M5216AFP", "M5216A", "M5216L", "M5216P", "M5216FP", "M5216",
			"M5281AL", "M5281AP", "M5281AFP", "M5281A", "M5281L", "M5281P", "M5281FP", "M5281",
			"M5223L", "M5223P", "M5223FP", "M5223",
		],
		reason:
			"The vendored Mitsubishi sheets are image-only or package drawings; no swing row was read, and none is claimed.",
	},
	{
		partIds: ["TL022CP2", "AK4552VT", "AK4552", "AK4552VT13", "AK4552VT8"],
		reason: "Not an op-amp datasheet part: a converter or macro shell modelled with an op-amp section.",
	},
];
