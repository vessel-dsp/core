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
	{
		// Wave 1. GBW only: the output-swing pair is deliberately not typed (owner decision
		// D4, 2026-10-17, upheld by the coordinator 2026-10-18 for this wave -- see
		// `opampOutputSwingAbsent`, which this id is intentionally NOT added to).
		// Wave 4: LM833N rides the shared sections entry for open-loop gain (TI LM833-N
		// sheet SNOSBD8E prints LM833N/NOPB as the PDIP orderable of the same die with the
		// same AV 110 dB TYP) but carries its own GBW row below: the LM833-N sheet prints
		// GBW TYP 15 MHz, not this row's 16, so the gain-bandwidth pass splits the entry.
		partIds: ["LM833"],
		gainBandwidthHz: {
			value: 16e6,
			basis: "datasheet",
			source:
				"LM833/datasheets/lm833-ti.pdf (TI SLOS481B, rev Oct 2014) 7.6 p5, VCC+-=+-15V, TA=25C: " +
				"'GBW | Gain bandwidth product | f = 100 kHz | MIN 10 TYP 16 | MHz'. LM833N: TI " +
				"LM833-N SNOSBD8E Rev. E May 2012 prints LM833N/NOPB (PDIP) orderables; the same " +
				"table prints AV 90/110 dB and GBW 10/15 MHz for the die.",
		},
	},
	{
		// Wave 2 (JED). GBW only (D4 swing freeze stands).
		partIds: ["LF347", "LF347N"],
		gainBandwidthHz: {
			value: 3e6,
			basis: "datasheet",
			source:
				"Fetched manufacturer sheet (no vendored copy): TI LF347/LF347B Quad JFET-Input " +
				"Operational Amplifiers, SLOS013C (Mar 1987, rev Mar 2016), 6.7 Switching Characteristics " +
				"(VCC+- = +-15 V, TA = 25C): 'B1 | Unity-gain bandwidth | TYP 3 | MHz' (no MIN/MAX; " +
				"the AVD rows that set the sections gain are 6.5 LF347 MIN 25 TYP 100 and 6.6 LF347B " +
				"MIN 50 TYP 100 V/mV at VO = +-10 V, RL = 2 kOhm).",
		},
	},
	{
		// Wave 2 (JED). GBW only (D4 swing freeze stands). LF351N is the DIP orderable of the
		// same die (NS Package N08E; sheet p11 'Order Number LF351M or LF351N').
		partIds: ["LF351", "LF351N"],
		gainBandwidthHz: {
			value: 4e6,
			basis: "datasheet",
			source:
				"Fetched manufacturer sheet (no vendored copy): National Semiconductor LF351 Wide " +
				"Bandwidth JFET Input Operational Amplifier, DS005648 Rev. 3 (1998), AC Electrical " +
				"Characteristics (VS = +-15 V, TA = 25C): 'GBW | Gain Bandwidth Product | TYP 4 | MHz' " +
				"(no MIN/MAX; the AVOL row that sets the sections gain is MIN 25 TYP 100 V/mV at " +
				"VS = +-15 V, TA = 25C, VO = +-10 V, RL = 2 kOhm). TI publishes no LF351 sheet of its " +
				"own; National is the TI-predecessor original.",
		},
	},
	{
		// Wave 2 (JED). GBW only (D4 swing freeze stands). One family table for all three
		// packages (Powerdip L272, Minidip L272M, SO16 L272D); the B row carries no package split.
		partIds: ["L272", "L272M", "L272D"],
		gainBandwidthHz: {
			value: 350e3,
			basis: "datasheet",
			source:
				"Fetched manufacturer sheet (no vendored copy): SGS-THOMSON L272 Dual Power Operational " +
				"Amplifiers, Jan 1995, ELECTRICAL CHARACTERISTICS (Vs = 24 V, Tamb = 25C): 'B | " +
				"Gain-bandwidth Product | TYP 350 | kHz' (no MIN/MAX; the Gv rows that set the sections " +
				"gain are f = 100 Hz MIN 60 TYP 70 and f = 1 kHz TYP 50 dB). It is a power amp: the gain " +
				"is specified against frequency, and 70 dB TYP at 100 Hz is the transcribed figure.",
		},
	},
	{
		// Wave 2 (wave-1 re-open). GBW only (D4 swing freeze stands). The C-grade TYP rows cover
		// the PDIP-N (TL074CN) and SOIC-D (TL074CD) orderables, both 'all other devices' for GBW;
		// the I grade prints MIN-only AOL and is not covered. Bare TL074 carries the C TYP.
		partIds: ["TL074", "TL074CN", "TL074CD"],
		gainBandwidthHz: {
			value: 5.25e6,
			basis: "datasheet",
			source:
				"Fetched manufacturer sheet (no vendored copy): TI TL071/TL072/TL074 JFET-Input " +
				"Operational Amplifiers, SLOS080W (Sep 1978, rev Jul 2025), 5.9 AC (VS = +-15 V, TA = 25C): " +
				"'GBW | Gain-bandwidth product | All other devices | TYP 5.25 | MHz' (TYP-only; NS/PS " +
				"packages and M grades are TYP 3). The AOL row that sets the sections gain is 5.8 DC " +
				"(VS = +-15 V, TA = 25C, VO = 0 V): TL07xC MIN 25 TYP 200 V/mV (full-range row MIN-only 15; " +
				"AC/BC 50/200, M 35/200, I MIN-only 25).",
		},
	},
	{
		// Wave 3. GBW only (D4 swing freeze stands). The sheet prints NJM4580 variants; the
		// JRC ids rest on parts/op-amps/JRC4580.md ('JRC4580D / NJM4580D', primary local
		// datasheet this sheet, aliases JRC4580/NJM4580/NJM4580D) -- the JRC4558D precedent
		// (owner decision 2026-10-15: the NJR/JRC marking rides the NJM sheet). The gain and
		// GBW rows are rank-independent (only the noise row splits by D rank).
		partIds: ["JRC4580D", "JRC4580", "NJM4580D", "NJM4580"],
		gainBandwidthHz: {
			value: 15e6,
			basis: "datasheet",
			source:
				"JRC4580/datasheets/njm4580d-njr.pdf (NJR NJM4580, Ver. 2012-09-14) p2, ELECTRICAL " +
				"CHARACTERISTICS (V+/V- = +-15 V, Ta = 25C): 'Gain Bandwidth Product GB, f = 10 kHz: " +
				"TYP 15 MHz' (no MIN/MAX; p1 Features: 'Wide GBW 15MHz typ.'). The AVD row that sets " +
				"the sections gain is on the same table: 'Voltage Gain AV, RL >= 2 kOhm, VO = +-10 V: " +
				"MIN 90 TYP 110 dB'.",
		},
	},
	{
		// Wave 3. GBW only (D4 swing freeze stands). OPA2134PA is a printed PDIP-8
		// orderable of the same die (orderable table, marking OPA2134PA); the specs are
		// family-wide with no per-orderable split.
		partIds: ["OPA2134", "OPA2134PA"],
		gainBandwidthHz: {
			value: 8e6,
			basis: "datasheet",
			source:
				"OPA2134/datasheets/opa2134-ti.pdf (TI OPA2134, SBOS058B, Dec 1997, Rev. B Nov 2024) " +
				"5.7 p7, Electrical Characteristics (TA = 25C, VS = +-15 V): 'GBW Gain bandwidth " +
				"product: TYP 8 MHz' (MIN/MAX blank; p1 Features: 'Bandwidth: 8MHz'). The AOL row " +
				"that sets the sections gain is on the same table: 'AOL Open-loop voltage gain, " +
				"RL = 2 kOhm, -13.8 V <= VO <= 13.5 V: MIN 104 TYP 120 dB' (a second row at " +
				"RL = 10 kOhm reads the same 104/120).",
		},
	},
	{
		// Wave 4. GBW only (D4 swing freeze stands). LM324B prints its own labelled GBW
		// row (also 1.2 MHz) and is NOT aliased: only the plain ids that section 6.7 and
		// the operating conditions cover are listed. The B1 row is a unity-gain bandwidth,
		// which IS the gain-bandwidth product (coordinator ruling 2026-10-19), quoted with
		// the 8.3.1 sentence that states the figure for these devices.
		partIds: ["LM324"],
		gainBandwidthHz: {
			value: 1.2e6,
			basis: "datasheet",
			source:
				"Fetched manufacturer sheet (no vendored copy): TI LMx24/LMx24x/LM2902 SLOS066AE " +
				"(Aug 1975, rev Sept 2025) 6.10 Operating Conditions (VCC = +-15 V, TA = 25C) p13: " +
				"'B1 | Unity-gain bandwidth | RL = 1 MOhm, CL = 20 pF | TYP 1.2 | MHz'; and 8.3.1 " +
				"Unity-Gain Bandwidth p16: 'To calculate the gain bandwidth product, multiply the " +
				"measured bandwidth of an amplifier by the measured bandwidth gain. These devices " +
				"have a high gain bandwidth of 1.2MHz.' The AVD row that sets the sections gain is " +
				"6.7 p11 (VCC = 15 V, VO = 1 V to 11 V, RL >= 2 kOhm, 25C): MIN 25 TYP 100 V/mV.",
		},
	},
	{
		// Wave 4. GBW only (D4 swing freeze stands). Coordinator standing rule 2026-10-19:
		// the bare id the datasheet names in its description takes the commercial (C)
		// grade column, disclosed; no suffixed grade is aliased. The +-5 V (10 V total)
		// table is quoted as the one closest to a 9 V pedal.
		partIds: ["TLC2262"],
		gainBandwidthHz: {
			value: 0.73e6,
			basis: "datasheet",
			source:
				"Fetched manufacturer sheet (no vendored copy): TI Advanced LinCMOS Rail-To-Rail " +
				"Op Amps SLOS177D (Feb 1997, rev Mar 2001) TLC2262C operating characteristics " +
				"(VDD+- = +-5 V) p7: 'Gain-bandwidth product, f = 10 kHz, RL = 50 kOhm, CL = 100 pF, " +
				"VO(PP) = 4.6 V, AV = 1: TYP 0.73 MHz' (the VDD = 5 V table prints 0.71 MHz; quoted " +
				"is the 10 V table, closest to 9 V). The AVD row that sets the sections gain is the " +
				"same table: 'Large-signal differential voltage amplification, RL = 50 kOhm, " +
				"VO = +-4 V: MIN 80 TYP 200 V/mV'.",
		},
	},
	{
		// Wave 4. GBW only (D4 swing freeze stands).
		partIds: ["MC33174"],
		gainBandwidthHz: {
			value: 1.8e6,
			basis: "datasheet",
			source:
				"Fetched manufacturer sheet (no vendored copy): onsemi MC33171/D Rev. 14 Jul 2025, " +
				"AC table (VCC = +15 V, VEE = -15 V, RL to ground, TA = 25C) p4: 'Gain Bandwidth " +
				"Product (f = 100 kHz), GBW MIN 1.4 TYP 1.8 MHz'. The AVOL row that sets the sections " +
				"gain is the DC table p3: 'Large Signal Voltage Gain (VO = +-10 V, RL = 10 k), " +
				"TA = +25C: MIN 50 TYP 500 V/mV'.",
		},
	},
	{
		// Wave 4. GBW only (D4 swing freeze stands). LM833N/NOPB is the PDIP orderable of
		// the LM833 die (TI LM833-N SNOSBD8E Rev. E May 2012) but its sheet prints its own
		// GBW TYP (15 MHz, not the LM833 sheet's 16), so it carries its own row and the
		// gain-bandwidth pass splits the shared sections entry by row.
		partIds: ["LM833N"],
		gainBandwidthHz: {
			value: 15e6,
			basis: "datasheet",
			source:
				"Fetched manufacturer sheet (no vendored copy): TI LM833-N SNOSBD8E Rev. E May 2012 " +
				"(TA = 25C, VS = +-15 V, RL = 2 kOhm), AC Electrical Characteristics: 'GBW Gain " +
				"Bandwidth Product, f = 100 kHz, MIN 10 TYP 15 MHz'; the sheet's orderables table " +
				"prints LM833N/NOPB (PDIP P|8) and the DC table prints 'AV Voltage Gain, RL = 2 kOhm, " +
				"VO = +-10 V: MIN 90 TYP 110 dB' (same 110 dB as the shared sections entry).",
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
		partIds: ["LF353", "LF353N", "LF353M", "LM741", "UA741", "uA741", "TA7504S", "TA7504", "MC33178", "MC33178P", "MC33178D", "BA718", "LM741CN"],
		reason: "No vendored datasheet for these ids. LM741CN (wave 5) rests on the fetched TI LM741 SNOSC25D orderable table, which prints no GBW row.",
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
		partIds: ["AD712"],
		reason:
			"ADI AD712 Rev. B SPECIFICATIONS (VS = +-15 V @ TA = +25C): the frequency row reads 'Small " +
			"Signal Bandwidth 3.0 MIN 4.0 TYP MHz' (J grade; 3.4/4.0 for the other grades) with no " +
			"closed-loop gain stated and the sheet never uses the term gain-bandwidth. Mapping an " +
			"unstated-gain small-signal bandwidth onto gainBandwidthHz is an interpretation, so no " +
			"figure is transcribed; the sections entry carries the citable AOL TYP 400 V/mV alone.",
	},
	{
		partIds: ["LM1458", "LM1458N"],
		reason:
			"LM1458/datasheets/lm1458.pdf (TI SNOSBU4D, Apr 1998, Rev. D Mar 2013, ex-National) prints " +
			"no gain-bandwidth, unity-gain-frequency or frequency-response spec row at all " +
			"(full-text search finds only the Features bullet 'No Frequency Compensation Required'). " +
			"Curves must not be read by eye, so no figure is transcribed; the sections entry carries " +
			"the citable AOL TYP 160 V/mV alone (same AOL-only shape as AD712).",
	},
	{
		partIds: ["LM308"],
		reason:
			"Fetched manufacturer sheet (no vendored copy): TI LM108/LM208/LM308 SNOSBS5A (May 2004, " +
			"rev Sept 2011, OBSOLETE) prints no gain-bandwidth or unity-gain row: only compensation " +
			"values and open-loop response graphs (Fig. 5/6 numbers are the LM101A-boosted application " +
			"circuit's, not the LM308's). The sections entry carries the citable AOL TYP 300 V/mV " +
			"alone (same AOL-only shape as AD712).",
	},
	{
		partIds: ["UA741CP"],
		reason:
			"Fetched manufacturer sheet (no vendored copy): TI uA741 SLOS094H (Nov 1970, rev Feb 2026) " +
			"prints no gain-bandwidth or unity-gain row for uA741C (the switching tables print only " +
			"rise time 0.3 us TYP, 5% overshoot, SR 0.5 V/us). The sections entry carries the citable " +
			"AOL TYP 200 V/mV alone (same AOL-only shape as AD712).",
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
		partIds: ["LF353", "LF353N", "LF353M", "LM741", "UA741", "uA741", "TA7504S", "TA7504", "BA718", "CA1458", "CA1458E", "CA1458T", "LM741CN"],
		reason: "No vendored datasheet for these ids. LM741CN (wave 5) carries the entry's house gain; the swing pair stays absent per the D4 freeze.",
	},
	{
		partIds: ["AD712", "LF347", "LF347N", "LF351", "LF351N", "L272", "L272M", "L272D", "TL074", "TL074CN", "TL074CD"],
		reason:
			"Wave-2 fills: the sections entries carry the citable AOL TYP and the GBW rows (all but " +
			"AD712) the product; the output-swing pair is deliberately NOT typed (owner decision D4, " +
			"2026-10-17, upheld for this wave). Printed swing rows exist (LF347 VOM +-12/+-13.5 at " +
			"RL = 10 kOhm; LF351 VO +-12/+-13.5; TL074 VOM rows) and are left untyped for the same " +
			"supply-translation reason as the 2026-10-17 list.",
	},
	{
		partIds: ["JRC4580D", "JRC4580", "NJM4580D", "NJM4580", "OPA2134", "OPA2134PA", "LM1458", "LM1458N"],
		reason:
			"Wave-3 fills: the sections entries carry the citable AOL TYP (NJM4580 110 dB, OPA2134 " +
			"120 dB, LM1458 160 V/mV) and the GBW rows (all but LM1458/N) the product; the " +
			"output-swing pair is deliberately NOT typed (owner decision D4, 2026-10-17, upheld " +
			"for this wave). Printed swing rows exist (NJM4580 VOM +-12/+-14 and +-10/+-13; OPA2134 " +
			"VO -14.5/+13.8 at RL = 10 kOhm and -13.8/+13.5 at RL = 2 kOhm; LM1458 VO +-12/+-13.5) " +
			"and are left untyped for the same supply-translation reason as the 2026-10-17 list.",
	},
	{
		partIds: ["LM308", "LM324", "UA741CP", "TLC2262", "MC33174"],
		reason:
			"Wave-4 fills: the sections entries carry the citable AOL TYP (LM308 300 V/mV, LM324 " +
			"100 V/mV, UA741CP 200 V/mV, TLC2262 200 V/mV C-grade, MC33174 500 V/mV) and the GBW rows " +
			"(LM324 1.2 MHz, TLC2262 0.73 MHz, MC33174 1.8 MHz; LM308/UA741CP print none) the product; " +
			"the output-swing pair is deliberately NOT typed (owner decision D4, 2026-10-17, upheld " +
			"for this wave). Printed swing rows exist (LM308 VOM +-13/+-14 at RL = 10 kOhm; UA741CP " +
			"VOM +-10/+-14.8 at RL = 2 kOhm; TLC2262C VO 1-4 V at VDD = 5 V; MC33174 VOH/VOL rows) " +
			"and are left untyped for the same supply-translation reason as the 2026-10-17 list.",
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
