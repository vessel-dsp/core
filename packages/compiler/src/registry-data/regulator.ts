// Fixed-rail regulator registry data: the output voltage by exact part id.
// 
// **Rails, not models.** Each record is one fixed rail a regulator holds its output at,
// stamped as a single two-terminal `voltage-source` section (output relative to ground).
// The terminal wiring -- which package positions are input, ground and output -- stays in
// `part-catalog.ts` code with the entry skeletons; this file holds only the numbers.
// 
// Provenance, honestly: these are the pre-registry catalog's fixed-rail values, kept
// mechanically. No datasheet row was re-read at stage 1 -- family nominals (5/9/18 V),
// a part-number reading (LM340T-15), and one known-latent sharing (7912 on the 7915
// entry) -- and the derivation of each record says so. Stage 3 must cite the datasheets.
// `sourceOhms` is the `SUPPLY_SOURCE_OHMS` convention (device-laws.ts): a 1 ohm series
// source impedance every supply stamp carries, not a measured part figure.

import { definePartData, type PartDataEntry } from "./loader";

const SUPPLY_OHMS_SOURCE =
	"SUPPLY_SOURCE_OHMS convention (device-laws.ts): 1 ohm series source impedance, not a measured part figure";
const SUPPLY_OHMS_DERIVATION =
	"Every supply stamp in the compiler carries 1 ohm; the regulator records repeat the " +
	"convention rather than claiming a measured output impedance. Stage 3 may refine per part.";

export const regulatorRegistryRecords: readonly PartDataEntry[] = definePartData([
	{
		// Wave 5: LM78L05 and L7805 ride this 5 V entry. LM78L05 is the exact spelling
		// printed in TI LM78L SNVS754O (Jan 2000, rev Aug 2026) 5.6 'Electrical
		// Characteristics: LM78L05 (Legacy and New Chip)' (VIN = 10 V, IO = 40 mA):
		// 'VO Output voltage, TJ = 25C: MIN 4.8 TYP 5 MAX 5.2 V' (legacy chip; new chip
		// 4.9/5/5.18). L7805 is the exact TYPE printed in the ST L7800 series device
		// summary (Doc ID 2143 Rev 26, Feb 2012, Table 1: 'L7805' among L7805C/L7805AB/
		// L7805AC). Bare L78L05 is NOT added: no ST L78L revision prints the bare stem
		// (TYPE rows are L78L05C/AC/AB only), so suffix-folding it would be unsourced.
		partIds: ["uPC78L05", "78L05", "7805", "78M05", "TA78L05F", "TA78L05S", "2930L05", "BA78L05", "uPC78L05T", "LM78L05", "L7805"],
		class: "regulator",
		params: {
			volts: {
				value: 5,
				basis: "derived",
				source: "Pre-registry catalog fixed-rail value (5 V family nominal)",
				derivation:
					"Transcribed mechanically from the pre-registry entry; no datasheet row was re-read " +
					"at stage 1 (the Toshiba TA78L05S spelling shares the 5 V TA78L die in TO-92). Stage 3 " +
					"must cite the datasheet.",
			},
			sourceOhms: {
				value: 1,
				basis: "derived",
				source: SUPPLY_OHMS_SOURCE,
				derivation: SUPPLY_OHMS_DERIVATION,
			},
		},
		note:
			"Toshiba's TA78L05S (product page detail.TA78L05S): the same 5 V TA78L die in TO-92. " +
			"Without it, boss-dd-5's IC5 fell to the pin-name rung and matched the 78L18 entry, " +
			"solving the pedal's 5 V rail at 18 V.",
	},
	{
		// Wave 5: LM78L09 rides this 9 V entry. It is the exact spelling printed in TI
		// LM78L SNVS754O (Jan 2000, rev Aug 2026) 5.8 'Electrical Characteristics:
		// LM78L09 (Legacy Chip Only)' (VIN = 15 V, IO = 40 mA): 'VO Output voltage,
		// TJ = 25C: MIN 8.64 TYP 9 MAX 9.36 V'. Bare L78L09 is NOT added: no ST L78L
		// revision prints the bare stem (TYPE rows are L78L09C/AC/AB only).
		partIds: ["uPC78L09", "78L09", "7809", "78M09", "TA78L09F", "2930L09", "BA78L09", "uPC78L09T", "LM78L09"],
		class: "regulator",
		params: {
			volts: {
				value: 9,
				basis: "derived",
				source: "Pre-registry catalog fixed-rail value (9 V family nominal)",
				derivation:
					"Transcribed mechanically from the pre-registry entry; no datasheet row was re-read " +
					"at stage 1. Stage 3 must cite the datasheet.",
			},
			sourceOhms: {
				value: 1,
				basis: "derived",
				source: SUPPLY_OHMS_SOURCE,
				derivation: SUPPLY_OHMS_DERIVATION,
			},
		},
	},
	{
		partIds: ["78L18", "78L18AC", "78L18T", "7818"],
		class: "regulator",
		params: {
			volts: {
				value: 18,
				basis: "derived",
				source: "Pre-registry catalog fixed-rail value (18 V family nominal)",
				derivation:
					"Transcribed mechanically from the pre-registry entry (electro-harmonix-q-tron's U6, " +
					"24 V to +18 V rail); no datasheet row was re-read at stage 1. Stage 3 must cite the " +
					"datasheet.",
			},
			sourceOhms: {
				value: 1,
				basis: "derived",
				source: SUPPLY_OHMS_SOURCE,
				derivation: SUPPLY_OHMS_DERIVATION,
			},
		},
	},
	{
		partIds: ["LM7915", "7915", "7912", "LM7912"],
		class: "regulator",
		params: {
			volts: {
				value: -15,
				basis: "derived",
				source: "Pre-registry catalog fixed-rail value (-15 V family nominal)",
				derivation:
					"Transcribed mechanically from the pre-registry entry; no datasheet row was re-read at " +
					"stage 1. Stage 3 must cite the datasheet and split the entry: 7912/LM7912 are -12 V " +
					"parts sharing this -15 V row, so a 7912 would be modelled 3 V low (latent -- the only " +
					"corpus user is deluxe-memory-man's U12_LM7915).",
			},
			sourceOhms: {
				value: 1,
				basis: "derived",
				source: SUPPLY_OHMS_SOURCE,
				derivation: SUPPLY_OHMS_DERIVATION,
			},
		},
		note:
			"`volts` here is SIGNED, against the convention the consumer documents (the law carries a " +
			"magnitude and the lowering reverses the source's sense for an output declared `negative`); " +
			"until that is settled, a negative regulator using this entry must declare its output " +
			"`positive`, which is why deluxe-memory-man does. See the entry note in part-catalog.ts.",
	},
	{
		// Wave 5: the 12 V rail (no 12 V entry existed). LM78L12 is the exact spelling
		// printed in TI LM78L SNVS754O (Jan 2000, rev Aug 2026) 5.9 'Electrical
		// Characteristics: LM78L12 (Legacy and New Chip)' (VIN = 19 V, CIN = 0.33 uF,
		// COUT = 0.1 uF, IO = 40 mA): 'VO Output voltage, TJ = 25C: MIN 11.5 TYP 12
		// MAX 12.5 V' (legacy chip; new chip 11.8/12/12.3). Bare L78L12 is NOT added
		// (same unsuffixed-stem reason as L78L05/L78L09 above).
		partIds: ["LM78L12"],
		class: "regulator",
		params: {
			volts: {
				value: 12,
				basis: "datasheet",
				source:
					"TI LM78L SNVS754O (Jan 2000, rev Aug 2026) 5.9 'Electrical " +
					"Characteristics: LM78L12 (Legacy and New Chip)' (VIN = 19 V, IO = 40 mA): " +
					"'VO Output voltage, TJ = 25C: MIN 11.5 TYP 12 MAX 12.5 V' (new chip 11.8/12/12.3)",
			},
			sourceOhms: {
				value: 1,
				basis: "derived",
				source: SUPPLY_OHMS_SOURCE,
				derivation: SUPPLY_OHMS_DERIVATION,
			},
		},
	},
	{
		// Wave 5: the 3.3 V rail (no 3.3 V entry existed). LM78L33 is the exact spelling
		// printed in TI LM78L SNVS754O (Jan 2000, rev Aug 2026) 5.5 'Electrical
		// Characteristics: LM78L33 (New Chip Only)' (VIN = 5.5-20 V, IO = 1-40 mA):
		// 'VO Output voltage, TJ = 25C: MIN 3.29 TYP 3.3 MAX 3.44 V'. Bare L78L33 is
		// NOT added (same unsuffixed-stem reason as above).
		partIds: ["LM78L33"],
		class: "regulator",
		params: {
			volts: {
				value: 3.3,
				basis: "datasheet",
				source:
					"TI LM78L SNVS754O (Jan 2000, rev Aug 2026) 5.5 'Electrical " +
					"Characteristics: LM78L33 (New Chip Only)' (VIN = 5.5-20 V, IO = 1-40 mA): " +
					"'VO Output voltage, TJ = 25C: MIN 3.29 TYP 3.3 MAX 3.44 V'",
			},
			sourceOhms: {
				value: 1,
				basis: "derived",
				source: SUPPLY_OHMS_SOURCE,
				derivation: SUPPLY_OHMS_DERIVATION,
			},
		},
	},
	{
		partIds: ["LM340T-15"],
		class: "regulator",
		params: {
			volts: {
				value: 15,
				basis: "derived",
				source: "Pre-registry catalog value, read off the part number and the packet's Description",
				derivation:
					"15 V fixed regulator read off the part number and mxr-m117r-flanger VR1's own " +
					"Description ('15 V regulator from the selected factory schematic'); no datasheet row " +
					"was re-read at stage 1. Stage 3 must cite the datasheet.",
			},
			sourceOhms: {
				value: 1,
				basis: "derived",
				source: SUPPLY_OHMS_SOURCE,
				derivation: SUPPLY_OHMS_DERIVATION,
			},
		},
	},
]);
