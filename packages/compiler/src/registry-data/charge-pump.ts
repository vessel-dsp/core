// Charge-pump registry data: one switched-capacitor inverter model per part family.
// 
// **Loss and slope, not a rail.** Each record carries the two numbers the per-circuit
// derivation reads: `sourceOhms` (the load-dependent slope -- output resistance at the
// datasheet's printed test condition) and `chargePumpLossVolts` (the fixed open-circuit
// shortfall below ideal inversion). The rail itself is derived per circuit from the input
// node (`pumpDerivation` in device-laws.ts: `-(inputVolts) - sign * chargePumpLossVolts`),
// so the entry's `volts: 0` stays an unused placeholder in `part-catalog.ts` code and is
// NOT a parameter here. The pin wiring (BOOST vs NC on pin 1, FBSD/SHDN variants) stays
// in code with the entry skeletons for the same reason the regulator wiring does.
// 
// Provenance: transcribed at stage 1 from the datasheet rows the pre-registry entry
// comments quote (document, page, condition). Basis `datasheet` throughout: every value
// is a printed TYP row, and the MAX column the sheet prints alongside is quoted in the
// source so the choice is checkable.

import { definePartData, type PartDataEntry } from "./loader";

export const chargePumpRegistryRecords: readonly PartDataEntry[] = definePartData([
	{
		partIds: ["TC1044S", "TC1044SCPA", "TC1044SCOA", "TC1044SEPA", "TC1044SEOA", "TC1044SIJA", "TC1044SMJA"],
		class: "charge-pump",
		params: {
			sourceOhms: {
				value: 60,
				basis: "datasheet",
				source:
					"Microchip DS21348A (2001) p2 electrical characteristics: output resistance 60 TYP / " +
					"100 MAX ohm at IOUT = 20 mA, V+ = 5 V, COSC = 0, 25 C. The p4 worked example reads " +
					"'a nearly ideal voltage source in series with 70 ohm ... for -10 mA at +5 V, -4.3 V'.",
				derivation: undefined,
			},
			chargePumpLossVolts: {
				value: 0,
				basis: "datasheet",
				source:
					"Microchip DS21348A p2: open-circuit conversion 99-99.9% at RL = infinity, so the loss " +
					"term is 0 and the rail is ideal inversion plus the series resistance.",
				derivation: undefined,
			},
		},
		note:
			"Ordering codes are DS21348A p1 printings (SCPA = commercial PDIP); bare 'TC1044' is not " +
			"printed there and is not covered. Pin 1 is BOOST here and NC on the ICL7660: the 8-pin " +
			"parts are NOT pin-identical.",
	},
	{
		partIds: ["ICL7660", "ICL7660CPA", "ICL7660CPAZ", "ICL7660CBA", "ICL7660CBAZ", "7660CPA", "7660CPAZ", "7660CBA", "7660CBAZ"],
		class: "charge-pump",
		params: {
			sourceOhms: {
				value: 55,
				basis: "datasheet",
				source:
					"Intersil FN3072 Rev 7.00 pp2-3 and Fig 7 curve slope, 55 ohm; the Thevenin model is an " +
					"ideal -V+ source in series with ROUT (p7 Fig 13B: 'the voltage source has a value of " +
					"-V+'), and the RO formula (p7: ~= 2*RSW + 1/(fPUMP*C1) + 4*ESR_C1 + ESR_C2, RSW ~23 " +
					"ohm at 25 C/5 V) reduces to the printed row at the test-circuit values. 100 MAX alongside.",
				derivation: undefined,
			},
			chargePumpLossVolts: {
				value: 0,
				basis: "datasheet",
				source:
					"Intersil FN3072 p3: open-circuit conversion 97/99.9%, so the loss term is 0.",
				derivation: undefined,
			},
		},
		note:
			"Part ids are the datasheet title plus the p2 ordering table (CPA/CBA, Z = Pb-free) and the " +
			"package markings the same table prints. The S-suffixed codes live in the ICL7660S record " +
			"(FN3179), whose pin 1 is BOOST, not NC.",
	},
	{
		partIds: ["ICL7660A", "ICL7660ACPA", "ICL7660ACPAZ", "ICL7660ACBA", "ICL7660ACBAZ", "ICL7660AIBA", "ICL7660AIBAZ", "7660ACPA", "7660ACPAZ", "7660ACBA", "7660ACBAZ", "7660AIBA", "7660AIBAZ"],
		class: "charge-pump",
		params: {
			sourceOhms: {
				value: 60,
				basis: "datasheet",
				source:
					"Intersil FN3072 (same sheet as the ICL7660), A-model columns: supply 1.5-12.0 V, " +
					"output resistance 60 TYP / 100 MAX ohm at 20 mA, 25 C (p3 five-volt table; 120 max " +
					"0-70 C, 120 max -40-85 C).",
				derivation: undefined,
			},
			chargePumpLossVolts: {
				value: 0,
				basis: "datasheet",
				source:
					"Intersil FN3072: open-circuit conversion 99/99.9%, so the loss term is 0.",
				derivation: undefined,
			},
		},
	},
	{
		partIds: ["ICL7660S", "ICL7660SCPA", "ICL7660SCPAZ", "7660SCPA", "7660SCPAZ"],
		class: "charge-pump",
		params: {
			sourceOhms: {
				value: 60,
				basis: "datasheet",
				source:
					"Renesas FN3179 Rev 7.01 p3: output resistance 60 TYP / 100 MAX ohm at IOUT = 20 mA, " +
					"V+ = 5 V, OSC free-running, 25 C (120 max 0-70 C).",
				derivation: undefined,
			},
			chargePumpLossVolts: {
				value: 0,
				basis: "datasheet",
				source:
					"Renesas FN3179 p3: open-circuit conversion 99/99.9% at RL = infinity, so the loss " +
					"term is 0.",
				derivation: undefined,
			},
		},
		note:
			"Part ids from the FN3179 ordering table (ICL7660SCPA marked 'no longer available', " +
			"ICL7660SCPAZ marking '7660S CPAZ'); the bare marking folds covered as printed-marking aliases.",
	},
	{
		partIds: ["TC7662B", "TC7662BCPA", "TC7662BEPA", "TC7662BCOA", "TC7662BEOA", "7662"],
		class: "charge-pump",
		params: {
			sourceOhms: {
				value: 65,
				basis: "datasheet",
				source:
					"Microchip DS20001469B pp3-4: output resistance 65 TYP / 100 MAX ohm at IOUT = 20 mA, " +
					"0-70 C, V+ = 5 V, OSC free-running (120 max -40-85 C).",
				derivation: undefined,
			},
			chargePumpLossVolts: {
				value: 0,
				basis: "datasheet",
				source:
					"Microchip DS20001469B p4: open-circuit conversion 99/99.9% at RL = infinity, so the " +
					"loss term is 0.",
				derivation: undefined,
			},
		},
		note:
			"Bare '7662' is NOT printed in the document and is covered ONLY because " +
			"moogerfooger-mf-102 declares exactly that PartNumber on a charge-pump-inverter shell whose " +
			"declared roles fit the inverter use (V+ in, GND, negative out); without it the packet would " +
			"refuse. An explicit, documented exception to the sibling rule, not a precedent: the family " +
			"doc is authoritative for the 7662 function and pinout, and the shell carries its own role " +
			"evidence.",
	},
	{
		partIds: ["LT1054", "LT1054C", "LT1054CP", "LT1054CPE4", "LT1054I"],
		class: "charge-pump",
		params: {
			sourceOhms: {
				value: 10,
				basis: "datasheet",
				source:
					"TI SLVS033G p5: output resistance 10 TYP / 15 MAX ohm as the dVO/dIO slope from 10 to " +
					"100 mA (fn5).",
				derivation: undefined,
			},
			chargePumpLossVolts: {
				value: 0.35,
				basis: "datasheet",
				source:
					"TI SLVS033G p5 + fn4: voltage loss VCC - |VO| 0.35 TYP / 0.55 MAX V at 10 mA (1.1/1.6 V " +
					"at 100 mA), device as inverter with pins 1, 6, 7 unconnected, CI = CO = 100 uF " +
					"tantalum. The slope resistance rides separately on sourceOhms.",
				derivation: undefined,
			},
		},
		note:
			"Not the 7660 pin order: pin 1 is FB/SD (shutdown/error-amp input) and pin 6 is VREF " +
			"(2.5 V reference output), so the part is footprint-compatible but not a drop-in substitute. " +
			"Shutdown (100 uA typ with FB/SD = 0 V, pp5, 12) is not modelled; normal operation assumed.",
	},
	{
		partIds: ["LTC1144", "LTC1144CN8", "LTC1144IN8", "LTC1144CS8", "LTC1144IS8"],
		class: "charge-pump",
		params: {
			sourceOhms: {
				value: 56,
				basis: "datasheet",
				source:
					"Linear Technology 1144fa p3: output resistance 56 TYP / 100 MAX ohm at V+ = 15 V, " +
					"IL = 20 mA, 10 kHz, 25 C (120/140 max full-temp; 90/250-300 at 5 V/3 mA/4 kHz).",
				derivation: undefined,
			},
			chargePumpLossVolts: {
				value: 0,
				basis: "datasheet",
				source:
					"Linear Technology 1144fa p3: open-circuit conversion 97.0/99.9% at RL = infinity, so " +
					"the loss term is 0.",
				derivation: undefined,
			},
		},
		note:
			"No LV pin and no low-voltage mode split (supply 2-18 V). Shutdown (8 uA typ with SHDN = 0 V) " +
			"is not modelled; normal operation assumed.",
	},
	{
		partIds: ["MAX1044", "MAX1044CPA", "MAX1044CSA", "MAX1044EPA", "MAX1044ESA"],
		class: "charge-pump",
		params: {
			sourceOhms: {
				value: 65,
				basis: "datasheet",
				source:
					"Maxim 19-4667 Rev 1 p2 EC: output resistance 65 TYP / 100 MAX ohm at IL = 20 mA, " +
					"fOSC = 5 kHz, LV open, 25 C, V+ = 5 V, BOOST open (worked example p8: ~50 ohm typ at " +
					"5 V with 10 uF pump caps, -4.5 V out at 10 mA).",
				derivation: undefined,
			},
			chargePumpLossVolts: {
				value: 0,
				basis: "datasheet",
				source:
					"Maxim 19-4667 p2: open-circuit conversion 97.0/99.9% at RL = infinity, so the loss " +
					"term is 0.",
				derivation: undefined,
			},
		},
		note:
			"Maxim's own ICL7660 rows (55/100 ohm) stay with the ICL7660 record. Bare 'MAX1044S' is not " +
			"printed and not covered.",
	},
]);
