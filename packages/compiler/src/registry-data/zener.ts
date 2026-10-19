// Zener registry data: reverse breakdown voltage by exact part id.
// 
// **Breakdown volts only; forward behaviour repeats the class default by construction.**
// A device that declares its own breakdown keeps it: `device-laws.ts` overlays the declared
// value on a catalog match, so the corpus diodes that already declare one render unchanged.
// Forward parameters are deliberately NOT the registry's: `saturationCurrent`,
// `emissionCoefficient` and `thermalVoltage` repeat the class default, and
// `seriesResistance` repeats its 1.0 ohm default (the database's `reverseBreakdownResistance`
// is a dynamic impedance at breakdown, not the law's ohmic series resistance, and mapping
// one to the other needs a fixture first). Deriving the forward law is stage 3's work.
// 
// Provenance, honestly: every value below is the pre-registry catalog number, kept
// mechanically. Where the device-database row the catalog transcribed states its own
// source, the derivation quotes that chain; most rows state a bare typ (or the value lives
// only in a packet declaration), and the derivation says so. **Basis is `derived` for all
// of them**: no datasheet row was re-read at stage 1, and stage 3 must cite one. A min/max
// range from the database is stamped at typ and disclosed here, never spanned.
// 
// Only real manufacturer part numbers appear here: no prose aliases (`3V`, `5V6 zener`,
// `zener/protection diode`) and no `SOURCE-*-ZENER` placeholder ids. A packet that prints
// a voltage instead of a part number states no part, so the registry must not answer it;
// those values belong in the packet as declared `breakdownVolts`.
//
// Wave 5 exception (coordinator keying, owner may revisit): nominal-voltage TOKENS
// (`9V1`, `5V1`, `3V6`, `3V3`, `4V7`, `8V2`, `2V7`, `6V2`, `12V`) ARE registry ids, one
// entry per nominal voltage together with the datasheet part numbers that print that Vz.
// Diode-class voltage tokens (`9.1VZENNER`, `5.1V`, `3V`, ...) are a different class's
// ids and do not join these entries.

import { definePartData, type PartDataEntry } from "./loader";

const DB = "component-diode-chips.json";
const FLAT = "component-zener-diode-chips.json";

export const zenerRegistryRecords: readonly PartDataEntry[] = definePartData([
	{
		partIds: ["1N961B"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 10,
				basis: "derived",
				source: `${DB} zener-reference row 1N961B (reverseBreakdownVoltage.typ 10, 9.5..10.5)`,
				derivation:
					"Stamped at the database row's typ; the row cites no source and no datasheet was " +
					"re-read at stage 1. Stage 3 must cite the datasheet.",
			},
		},
	},
	{
		partIds: ["1N965B"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 15,
				basis: "derived",
				source: `${DB} zener-reference row 1N965B (reverseBreakdownVoltage.typ 15, 14.25..15.75)`,
				derivation:
					"Stamped at the database row's typ; the row cites no source and no datasheet was " +
					"re-read at stage 1. Stage 3 must cite the datasheet.",
			},
		},
	},
	{
		partIds: ["1N969B"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 22,
				basis: "derived",
				source: `${DB} zener-reference row 1N969B (reverseBreakdownVoltage.typ 22, 20.9..23.1)`,
				derivation:
					"Stamped at the database row's typ; the row cites no source and no datasheet was " +
					"re-read at stage 1. Stage 3 must cite the datasheet.",
			},
		},
	},
	{
		partIds: ["1N4744A"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 15,
				basis: "derived",
				source: `${DB} zener-reference row 1N4744A (reverseBreakdownVoltage.typ 15, 14.25..15.75)`,
				derivation:
					"Stamped at the database row's typ; the row cites no source and no datasheet was " +
					"re-read at stage 1. Stage 3 must cite the datasheet.",
			},
		},
	},
	{
		partIds: ["1N4751A", "1N4751A 30V", "1N4751A-30V", "1N4751A 30 V"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 30,
				basis: "derived",
				source: `${DB} zener-reference row 1N4751A (reverseBreakdownVoltage.typ 30, 28.5..31.5)`,
				derivation:
					"Stamped at the database row's typ. The row's own source is a family-table reading " +
					"('1N4728A-1N4764A family tables list 1N4751A as a 30 V, 5% zener; the Deluxe Memory Man " +
					"source label includes the explicit 30V suffix'), not a re-read datasheet row at stage 1. " +
					"Stage 3 must cite the datasheet.",
			},
		},
	},
	{
		partIds: ["1N4753A"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 36,
				basis: "derived",
				source: `${DB} zener-reference row 1N4753A (reverseBreakdownVoltage.typ 36, 34.2..37.8)`,
				derivation:
					"Stamped at the database row's typ. The row's own source names the Q-Tron source graph " +
					"(D_ZENER_PROTECT, 1N4753A 36 V) and the onsemi 1N4728A-1N4758A table (36 V nominal, 5%); " +
					"no datasheet was re-read at stage 1. Stage 3 must cite the datasheet.",
			},
		},
	},
	{
		partIds: ["RD5.1EB3", "RD5.1EB 3", "RD5.1EB-3"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 5.235,
				basis: "derived",
				source: `${DB} zener-reference row RD5.1EB3 (reverseBreakdownVoltage.typ 5.235, 5.12..5.35)`,
				derivation:
					"Stamped at the database row's typ; the row cites no source and no datasheet was " +
					"re-read at stage 1. Stage 3 must cite the NEC RD datasheet.",
			},
		},
		note:
			"Bare RD5.1EB spans every bin but only B3 is a database row (NEC RD5.1E B3: Vz 5.12..5.35 V, " +
			"typ 5.235, vendored at parts/diodes/RD5_1EB3). Stamping B3's typical for the unbinned part " +
			"is a derived stand-in, disclosed, not a printed unbinned value.",
	},
	{
		partIds: ["RD5.1EB"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 5.235,
				basis: "derived",
				source: "Pre-registry catalog stand-in (no database row for the unbinned part)",
				derivation:
					"B3's typical 5.235 stamped for the unbinned RD5.1EB as a disclosed derived stand-in " +
					"(see the RD5.1EB3 record's note); the unbinned part has no database row and no " +
					"datasheet was re-read at stage 1. Stage 3 must give the unbinned part its own entry.",
			},
		},
	},
	{
		partIds: ["RD3.0EB3", "RD3.0EB1", "RD3.0EB-1", "RD3.0EB-3"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 3,
				basis: "derived",
				source: "Pre-registry catalog value for the packet-declared SOURCE-3V-ZENER row (BV 3)",
				derivation:
					"RD3.0EB1/RD3.0EB3 are real part numbers whose pre-registry value lives on the packet's " +
					"source-declared 3 V zener row; the placeholder id and prose aliases stay out of the " +
					"registry. No datasheet was re-read at stage 1. Stage 3 must cite the NEC RD datasheet.",
			},
		},
		note:
			"RD3.0EB1/RD3.0EB3 are real part numbers with no database row; their value comes from the " +
			"source's declared 3 V zener row.",
	},
	{
		partIds: ["RD4.7EB", "02BZ4.7A", "02BZ4_7A", "02BZ4-7A"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 4.7,
				basis: "derived",
				source: `${DB} zener-reference row RD4.7EB (reverseBreakdownVoltage.typ 4.7, 4.47..4.91)`,
				derivation:
					"Stamped at the database row's typ. The row's own source names the NEC RD4.7E suffix B " +
					"datasheet table (Vz 4.47..4.91 V) and the Boss NF-1 source graph (D2/D3, 4.7 V); no " +
					"datasheet was re-read at stage 1. Stage 3 must cite the datasheet.",
			},
		},
	},
	{
		partIds: ["RD5.6EB3", "RD-5.6EB3", "RD5.6EB 3", "RD5.6EB-3"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 5.76,
				basis: "derived",
				source: `${DB} zener-reference row RD5.6EB3 (reverseBreakdownVoltage.typ 5.76, 5.64..5.88)`,
				derivation:
					"Stamped at the database row's typ; the row cites no source and no datasheet was " +
					"re-read at stage 1. Stage 3 must cite the NEC RD datasheet.",
			},
		},
	},
	{
		partIds: ["RD5.6EB2", "RD-5.6EB2", "RD5.6EB 2", "RD5.6EB-2", "RD5.6JB2", "RD5.6J B2", "RD5.6J-B2"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 5.58,
				basis: "derived",
				source: `${DB} zener-reference row RD5.6EB2 (reverseBreakdownVoltage.typ 5.58, 5.46..5.7)`,
				derivation:
					"Stamped at the database row's typ. The row's own source names the NEC RD suffix B2 " +
					"table (5.46..5.70 V); no datasheet was re-read at stage 1. Stage 3 must cite the datasheet.",
			},
		},
	},
	{
		partIds: ["RD6.6EB3", "RD6.6EB 3", "RD6.6EB-3"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 6.62,
				basis: "derived",
				source: `${DB} zener-reference row RD6.6EB3 (reverseBreakdownVoltage.typ 6.62, 6.49..6.76)`,
				derivation:
					"Stamped at the database row's typ. The row's own source names the NEC RD zener family " +
					"B3 rank envelope and the Boss DM-3 source graph; no datasheet was re-read at stage 1. " +
					"Stage 3 must cite the datasheet.",
			},
		},
	},
	{
		partIds: ["RD8.2EB3", "RD8.2EB 3", "RD8.2EB-3"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 8.18,
				basis: "derived",
				source: `${DB} zener-reference row RD8.2EB3 (reverseBreakdownVoltage.typ 8.18, 8.02..8.34)`,
				derivation:
					"Stamped at the database row's typ. The row's own source names the NEC RD zener family " +
					"B3 rank envelope and the Boss DM-3 source graph; no datasheet was re-read at stage 1. " +
					"Stage 3 must cite the datasheet.",
			},
		},
	},
	{
		partIds: ["MTZ5.6B"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 5.6,
				basis: "derived",
				source: "Pre-registry catalog value for the packet-declared SOURCE-5V6-ZENER row (BV 5.6)",
				derivation:
					"MTZ5.6B is the real part behind the packet's source-declared 5.6 V zener row; it has " +
					"no database row and no datasheet was re-read at stage 1. Stage 3 must cite the datasheet.",
			},
		},
	},
	{
		partIds: ["RD11EB3", "RD11EB 3", "RD11EB-3", "RD11E B3", "RD11E-B3"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 10.99,
				basis: "derived",
				source: `${DB} zener-reference row RD11EB3 (reverseBreakdownVoltage.typ 10.99, 10.82..11.16)`,
				derivation:
					"Stamped at the database row's typ. The row's own source names the NEC RD11E suffix B3 " +
					"datasheet table (Vz 10.82..11.16 V at Iz=10 mA); no datasheet was re-read at stage 1. " +
					"Stage 3 must cite the datasheet.",
			},
		},
	},
	{
		partIds: ["RD11EB"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 11,
				basis: "derived",
				source: `${DB} zener-reference row RD11EB (reverseBreakdownVoltage.typ 11, 10.18..11.26)`,
				derivation:
					"Stamped at the database row's typ (the unbinned part's own row, NEC suffix-B range " +
					"10.18..11.26 V -- not the B3 typical under a shorter name). The row's own source " +
					"additionally names the Boss NF-1 source graph (D1, 11 V); no datasheet was re-read at " +
					"stage 1. Stage 3 must cite the datasheet.",
			},
		},
	},
	{
		partIds: ["0Z11A", "05Z11A"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 11,
				basis: "derived",
				source: `${DB} zener-reference row 0Z11A (reverseBreakdownVoltage.typ 11)`,
				derivation:
					"Stamped at the database row's typ. The row's own source is a packet validation " +
					"(boss-sp-1-spectrum-service-supply-island.cir models D1 0Z11A as DZ11 with Bv=11), not " +
					"a datasheet; 05Z11A has no row of its own and shares the 0Z11A figure. No datasheet was " +
					"re-read at stage 1. Stage 3 must cite the datasheet.",
			},
		},
	},
	{
		partIds: ["1N5331"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 5.1,
				basis: "derived",
				source: `${DB} zener-reference row 1N5331 (reverseBreakdownVoltage.typ 5.1)`,
				derivation:
					"Stamped at the database row's typ. The row's own source is a packet graph (MXR Noise " +
					"Gate/Line Driver D_ZENER, 5.1 V), not a datasheet; no datasheet was re-read at stage 1. " +
					"Stage 3 must cite the datasheet.",
			},
		},
	},
	{
		partIds: ["RD5.6S", "RD5.6S B3", "RD5.6SB3", "RD5.6S-B3"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 5.6,
				basis: "derived",
				source: `${DB} zener-reference row RD5.6S (reverseBreakdownVoltage.typ 5.6, 5.48..5.72)`,
				derivation:
					"Stamped at the database row's typ; the row cites no source and no datasheet was " +
					"re-read at stage 1. Stage 3 must cite the NEC RD datasheet.",
			},
		},
	},
	{
		partIds: ["RD11FB3", "RD11FB-3"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 11.15,
				basis: "derived",
				source: `${DB} zener-reference row RD11FB3 (reverseBreakdownVoltage.typ 11.15, 10.87..11.43)`,
				derivation:
					"Stamped at the database row's typ; the row cites no source and no datasheet was " +
					"re-read at stage 1. Stage 3 must cite the NEC RD datasheet.",
			},
		},
	},
	{
		partIds: ["PESD12VL1BA"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 12,
				basis: "derived",
				source: `${DB} zener-reference row PESD12VL1BA (reverseBreakdownVoltage.typ 12, 11.4..12.6)`,
				derivation:
					"Stamped at the database row's typ. The row's own source is a support-profile bound " +
					"('Bounded 12 V ESD/protection diode support profile for source-visible protection " +
					"branches'), not a datasheet; no datasheet was re-read at stage 1. Stage 3 must cite " +
					"the datasheet.",
			},
		},
	},
	{
		// Wave 5: 2.5 V nominal-voltage entry (keying per the wave-5 proposal: one entry
		// per nominal voltage; partIds are the exact backlog tokens plus the datasheet
		// part numbers that print that Vz). No 2V5-style token exists in the backlog;
		// the entry serves the 1N5222B backlog row.
		partIds: ["1N5222B"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 2.5,
				basis: "datasheet",
				source:
					"onsemi 1N5221B-1N5252B (1N5221B/D, Nov 2023 Rev. 5) p2, ELECTRICAL " +
					"CHARACTERISTICS (TA = 25C): '1N5222B: VZ MIN 2.375 TYP 2.5 MAX 2.625 V @ IZ = 20 mA'",
			},
		},
	},
	{
		// Wave 5: 2.7 V nominal-voltage entry. Token 2V7 plus the onsemi 500 mW number.
		partIds: ["2V7", "1N5223B"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 2.7,
				basis: "datasheet",
				source:
					"onsemi 1N5221B-1N5252B (1N5221B/D, Nov 2023 Rev. 5) p2, ELECTRICAL " +
					"CHARACTERISTICS (TA = 25C): '1N5223B: VZ MIN 2.565 TYP 2.7 MAX 2.835 V @ IZ = 20 mA'",
			},
		},
	},
	{
		// Wave 5: 3.3 V nominal-voltage entry. Token 3V3 plus the 1 W and 500 mW numbers.
		partIds: ["3V3", "1N4728A", "1N5226B"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 3.3,
				basis: "datasheet",
				source:
					"onsemi 1N4728A-1N4758A (1N4736AT/D, Aug 2021 Rev. 10) p2, ELECTRICAL " +
					"CHARACTERISTICS (Ta = 25C): '1N4728A: VZ MIN 3.135 TYP 3.3 MAX 3.465 V @ IZ = 76 mA'; " +
					"onsemi 1N5221B-1N5252B (1N5221B/D, Nov 2023 Rev. 5) p2: '1N5226B: VZ MIN 3.135 " +
					"TYP 3.3 MAX 3.465 V @ IZ = 20 mA' (GenSemi 1N5225-1N5267 1999-01-21 p2 corroborates " +
					"'1N5226: Nominal VZ 3.3 V at IZT = 20 mA')",
			},
		},
	},
	{
		// Wave 5: 3.6 V nominal-voltage entry. Token 3V6 plus the 500 mW numbers (the
		// 1 W onsemi table skips 3.6 V). 1N747A stays uncovered: Central Semi prints
		// the 3.6 V nominal but its test current could not be verified here (two fetch
		// attempts failed), so no cited row exists for it.
		partIds: ["3V6", "1N5227B", "1N5227"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 3.6,
				basis: "datasheet",
				source:
					"onsemi 1N5221B-1N5252B (1N5221B/D, Nov 2023 Rev. 5) p2, ELECTRICAL " +
					"CHARACTERISTICS (TA = 25C): '1N5227B: VZ MIN 3.42 TYP 3.6 MAX 3.78 V @ IZ = 20 mA'; " +
					"GenSemi 1N5225-1N5267 (1999-01-21) p2: '1N5227: Nominal VZ 3.6 V at IZT = 20 mA' " +
					"(base number; the sheet heads the series 'Standard Zener voltage tolerance is " +
					"+-5% with a B suffix')",
			},
		},
	},
	{
		// Wave 5: 4.7 V nominal-voltage entry. Absorbs the stage-1 derived 1N5230 row
		// (same 4.7 V value, now cited).
		partIds: ["4V7", "1N4732A", "1N5230B", "1N5230"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 4.7,
				basis: "datasheet",
				source:
					"onsemi 1N4728A-1N4758A (1N4736AT/D, Aug 2021 Rev. 10) p2, ELECTRICAL " +
					"CHARACTERISTICS (Ta = 25C): '1N4732A: VZ MIN 4.465 TYP 4.7 MAX 4.935 V @ IZ = 53 mA'; " +
					"onsemi 1N5221B-1N5252B (1N5221B/D, Nov 2023 Rev. 5) p2: '1N5230B: VZ MIN 4.465 " +
					"TYP 4.7 MAX 4.935 V @ IZ = 20 mA' (GenSemi p2 corroborates '1N5230: 4.7 V at 20 mA')",
			},
		},
	},
	{
		// Wave 5: 5.1 V nominal-voltage entry. Absorbs the four stage-1 derived 5.1 V
		// rows (1N4733A, 1N5231, 1N5231B, 1N4733; same value, now cited). 1N5331 keeps
		// its own derived row: it is a 5 W part outside both series tables quoted here.
		partIds: ["5V1", "1N4733A", "1N5231B", "1N5231", "1N4733"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 5.1,
				basis: "datasheet",
				source:
					"onsemi 1N4728A-1N4758A (1N4736AT/D, Aug 2021 Rev. 10) p2, ELECTRICAL " +
					"CHARACTERISTICS (Ta = 25C): '1N4733A: VZ MIN 4.845 TYP 5.1 MAX 5.355 V @ IZ = 49 mA'; " +
					"onsemi 1N5221B-1N5252B (1N5221B/D, Nov 2023 Rev. 5) p2: '1N5231B: VZ MIN 4.845 " +
					"TYP 5.1 MAX 5.355 V @ IZ = 20 mA' (GenSemi p2 corroborates '1N5231: 5.1 V at 20 mA')",
			},
		},
	},
	{
		// Wave 5: 5.6 V nominal-voltage entry (no voltage token in the backlog; serves
		// the 1N5232B row).
		partIds: ["1N4734A", "1N5232B", "1N5232"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 5.6,
				basis: "datasheet",
				source:
					"onsemi 1N4728A-1N4758A (1N4736AT/D, Aug 2021 Rev. 10) p2, ELECTRICAL " +
					"CHARACTERISTICS (Ta = 25C): '1N4734A: VZ MIN 5.32 TYP 5.6 MAX 5.88 V @ IZ = 45 mA'; " +
					"onsemi 1N5221B-1N5252B (1N5221B/D, Nov 2023 Rev. 5) p2: '1N5232B: VZ MIN 5.32 " +
					"TYP 5.6 MAX 5.88 V @ IZ = 20 mA' (GenSemi p2 corroborates '1N5232: 5.6 V at 20 mA')",
			},
		},
	},
	{
		// Wave 5: 6.2 V nominal-voltage entry. Token 6V2 plus the 1 W and 500 mW numbers.
		partIds: ["6V2", "1N4735A", "1N5234B", "1N5234"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 6.2,
				basis: "datasheet",
				source:
					"onsemi 1N4728A-1N4758A (1N4736AT/D, Aug 2021 Rev. 10) p2, ELECTRICAL " +
					"CHARACTERISTICS (Ta = 25C): '1N4735A: VZ MIN 5.89 TYP 6.2 MAX 6.51 V @ IZ = 41 mA'; " +
					"onsemi 1N5221B-1N5252B (1N5221B/D, Nov 2023 Rev. 5) p2: '1N5234B: VZ MIN 5.89 " +
					"TYP 6.2 MAX 6.51 V @ IZ = 20 mA' (GenSemi p2 corroborates '1N5234: 6.2 V at 20 mA')",
			},
		},
	},
	{
		// Wave 5: 8.2 V nominal-voltage entry. Token 8V2 plus the 1 W and 500 mW numbers.
		partIds: ["8V2", "1N4738A", "1N5237B", "1N5237"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 8.2,
				basis: "datasheet",
				source:
					"onsemi 1N4728A-1N4758A (1N4736AT/D, Aug 2021 Rev. 10) p2, ELECTRICAL " +
					"CHARACTERISTICS (Ta = 25C): '1N4738A: VZ MIN 7.79 TYP 8.2 MAX 8.61 V @ IZ = 31 mA'; " +
					"onsemi 1N5221B-1N5252B (1N5221B/D, Nov 2023 Rev. 5) p2: '1N5237B: VZ MIN 7.79 " +
					"TYP 8.2 MAX 8.61 V @ IZ = 20 mA' (GenSemi p2 corroborates '1N5237: 8.2 V at 20 mA')",
			},
		},
	},
	{
		// Wave 5: 9.1 V nominal-voltage entry. Absorbs the stage-1 derived 1N5239B row
		// (same 9.1 V value, now cited). 1N4739 non-A shares the A-row nominal (the
		// registered 1N4742/1N4742A precedent).
		partIds: ["9V1", "1N4739A", "1N4739", "1N5239B", "1N5239"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 9.1,
				basis: "datasheet",
				source:
					"onsemi 1N4728A-1N4758A (1N4736AT/D, Aug 2021 Rev. 10) p2, ELECTRICAL " +
					"CHARACTERISTICS (Ta = 25C): '1N4739A: VZ MIN 8.645 TYP 9.1 MAX 9.555 V @ IZ = 28 mA'; " +
					"onsemi 1N5221B-1N5252B (1N5221B/D, Nov 2023 Rev. 5) p2: '1N5239B: VZ MIN 8.645 " +
					"TYP 9.1 MAX 9.555 V @ IZ = 20 mA' (GenSemi p2 corroborates '1N5239: 9.1 V at 20 mA')",
			},
		},
	},
	{
		// Wave 5: 10 V nominal-voltage entry (no voltage token in the backlog; serves
		// the 1N5240B row).
		partIds: ["1N4740A", "1N5240B", "1N5240"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 10,
				basis: "datasheet",
				source:
					"onsemi 1N4728A-1N4758A (1N4736AT/D, Aug 2021 Rev. 10) p2, ELECTRICAL " +
					"CHARACTERISTICS (Ta = 25C): '1N4740A: VZ MIN 9.5 TYP 10 MAX 10.5 V @ IZ = 25 mA'; " +
					"onsemi 1N5221B-1N5252B (1N5221B/D, Nov 2023 Rev. 5) p2: '1N5240B: VZ MIN 9.5 " +
					"TYP 10 MAX 10.5 V @ IZ = 20 mA' (GenSemi p2 corroborates '1N5240: 10 V at 20 mA')",
			},
		},
	},
	{
		// Wave 5: 12 V nominal-voltage entry. Absorbs the stage-1 derived 1N4742A row
		// (same 12 V value, now cited; 1N4742 non-A shares it as before).
		partIds: ["12V", "1N4742A", "1N4742", "1N5242B", "1N5242"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 12,
				basis: "datasheet",
				source:
					"onsemi 1N4728A-1N4758A (1N4736AT/D, Aug 2021 Rev. 10) p2, ELECTRICAL " +
					"CHARACTERISTICS (Ta = 25C): '1N4742A: VZ MIN 11.4 TYP 12 MAX 12.6 V @ IZ = 21 mA'; " +
					"onsemi 1N5221B-1N5252B (1N5221B/D, Nov 2023 Rev. 5) p2: '1N5242B: VZ MIN 11.4 " +
					"TYP 12 MAX 12.6 V @ IZ = 20 mA' (GenSemi p2 corroborates '1N5242: 12 V at 20 mA')",
			},
		},
	},
	{
		// Wave 5: 13 V nominal-voltage entry (no voltage token in the backlog; serves
		// the 1N4743A row).
		partIds: ["1N4743A"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 13,
				basis: "datasheet",
				source:
					"onsemi 1N4728A-1N4758A (1N4736AT/D, Aug 2021 Rev. 10) p2, ELECTRICAL " +
					"CHARACTERISTICS (Ta = 25C): '1N4743A: VZ MIN 12.35 TYP 13 MAX 13.65 V @ IZ = 19 mA'",
			},
		},
	},
]);
