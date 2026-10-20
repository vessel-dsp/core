// UJT registry data: intrinsic standoff ratio and interbase resistance by exact part id.
//
// The two numbers ARE the part model: eta sets the tap (RB1 = eta * Rbb, the peak-point
// fraction) and Rbb sets the bar. Everything else about the law is structure, not data:
// the emitter junction is a silicon diode by construction (the law's constants) and the
// conductivity modulation is the lowering's VCCS factor. So a record states exactly these
// two parameters, and `ujtLawEntry` (part-catalog.ts) throws on anything else shaped
// like a UJT record that omits one.
//
// Derivation rule (standing): a printed range becomes one value by its arithmetic
// midpoint (eta and Rbb are divider fractions and resistances, not gains, so the
// geomean-for-gains rule does not apply). A printed TYP is transcribed with its row
// quoted. One value per parameter, no min/typ/max.
//
// Pending: none. The 2N4871 entry below is seeded from the manufacturer datasheet
// (Digitron Semiconductors 2N4870, 2N4871 UNIJUNCTION TRANSISTORS, Rev. 20120705,
// sha256 81b46aa8ad8a271a3aca154f7129fe3e6abfc7066440d52d50a4d99ff9a17722).
// 2N4870 is deliberately absent: nothing in the corpus uses it, and the registry
// holds parts, not families.

import { definePartData, type PartDataEntry } from "./loader";

export const ujtRegistryRecords: readonly PartDataEntry[] = definePartData([
	{
		partIds: ["2N4871"],
		class: "ujt",
		params: {
			intrinsicStandoffRatio: {
				value: 0.775,
				basis: "derived",
				source:
					"Digitron Semiconductors 2N4870, 2N4871 UNIJUNCTION TRANSISTORS " +
					"(Rev. 20120705) p1, ELECTRICAL CHARACTERISTICS (TA = 25 C): " +
					"'Intrinsic standoff ratio eta (VB2B1 = 10V), 2N4871, MIN 0.70 MAX 0.85' " +
					"(no TYP printed; Note 1: VP = eta*VB2B1 + VF, VF about 0.49V at 25 C @ IF = 10uA)",
				derivation:
					"Printed 2N4871 eta range 0.70-0.85 at VB2B1 = 10 V, no TYP printed; " +
					"arithmetic midpoint (form 2, printed range -- a divider fraction, not a gain, " +
					"so no geomean): (0.70 + 0.85) / 2 = 0.775.",
			},
			interbaseResistanceOhms: {
				value: 6000,
				basis: "datasheet",
				source:
					"Digitron Semiconductors 2N4870, 2N4871 UNIJUNCTION TRANSISTORS " +
					"(Rev. 20120705) p1, ELECTRICAL CHARACTERISTICS (TA = 25 C): " +
					"'Interbase resistance RBB (VB2B1 = 3.0V, IE = 0), MIN 4.0 TYP 6.0 MAX 9.1 kohm' " +
					"(one row for both parts)",
			},
		},
	},
]);
