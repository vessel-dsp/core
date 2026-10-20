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
// Pending: the 2N4871 entry waits on the manufacturer datasheet (owner to fetch; see the
// UJT task). No values are staged here until the sheet is in hand -- a guessed eta or
// Rbb would move the peak point it exists to set.

import { definePartData, type PartDataEntry } from "./loader";

export const ujtRegistryRecords: readonly PartDataEntry[] = definePartData([]);
