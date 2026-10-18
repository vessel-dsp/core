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

import { definePartData, type PartDataEntry } from "./loader";

const DB = "component-diode-chips.json";
const FLAT = "component-zener-diode-chips.json";

export const zenerRegistryRecords: readonly PartDataEntry[] = definePartData([
	{
		partIds: ["1N5230"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 4.7,
				basis: "derived",
				source: `${DB} zener-reference row 1N5230 (reverseBreakdownVoltage.typ 4.7)`,
				derivation:
					"Stamped at the database row's typ. The row's own source is a packet validation " +
					"(mxr-phase-45-source-supply-bias.cir models Dref 1N5230 as DZ5230 with BV=4.7), not a " +
					"datasheet; no datasheet was re-read at stage 1. Stage 3 must cite the datasheet.",
			},
		},
	},
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
		partIds: ["1N4733A"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 5.1,
				basis: "derived",
				source: `${DB} zener-reference row 1N4733A (reverseBreakdownVoltage.typ 5.1)`,
				derivation:
					"Stamped at the database row's typ; the row cites no source and no datasheet was " +
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
		partIds: ["1N5239B"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 9.1,
				basis: "derived",
				source: `${DB} zener-reference row 1N5239B (reverseBreakdownVoltage.typ 9.1)`,
				derivation:
					"Stamped at the database row's typ; the row cites no source and no datasheet was " +
					"re-read at stage 1. Stage 3 must cite the datasheet.",
			},
		},
	},
	{
		partIds: ["1N4742A", "1N4742"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 12,
				basis: "derived",
				source: `${DB} zener-reference row 1N4742A (reverseBreakdownVoltage.typ 12, 11.4..12.6)`,
				derivation:
					"Stamped at the database row's typ; the row cites no source and no datasheet was " +
					"re-read at stage 1. 1N4742 has no row of its own and shares the 1N4742A figure. " +
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
		partIds: ["1N5231"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 5.1,
				basis: "derived",
				source: `${FLAT} row 1N5231 (reverseBreakdownVoltage 5.1)`,
				derivation:
					"Stamped at the flat zener file's figure; the flat row carries no source of its own " +
					"and no datasheet was re-read at stage 1. Stage 3 must cite the datasheet.",
			},
		},
	},
	{
		partIds: ["1N5231B"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 5.1,
				basis: "derived",
				source: `${FLAT} row 1N5231B (reverseBreakdownVoltage 5.1)`,
				derivation:
					"Stamped at the flat zener file's figure; the flat row carries no source of its own " +
					"and no datasheet was re-read at stage 1. Stage 3 must cite the datasheet.",
			},
		},
	},
	{
		partIds: ["1N4733"],
		class: "zener",
		params: {
			breakdownVolts: {
				value: 5.1,
				basis: "derived",
				source: `${FLAT} row 1N4733 (reverseBreakdownVoltage 5.1)`,
				derivation:
					"Stamped at the flat zener file's figure; the flat row carries no source of its own " +
					"and no datasheet was re-read at stage 1. Stage 3 must cite the datasheet.",
			},
		},
	},
]);
