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
		partIds: ["uPC78L05", "78L05", "7805", "78M05", "TA78L05F", "TA78L05S", "2930L05", "BA78L05", "uPC78L05T"],
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
		partIds: ["uPC78L09", "78L09", "7809", "78M09", "TA78L09F", "2930L09", "BA78L09", "uPC78L09T"],
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
