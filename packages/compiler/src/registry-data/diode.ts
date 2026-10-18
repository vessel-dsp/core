// Diode registry data: wave-1 discrete fill.
//
// One value per parameter; a parameter with no datasheet citation is not loadable, so it
// is omitted here and the stamp falls back to the class default (never a guess):
//
// - `saturationCurrent` + `emissionCoefficient`: derived ONLY together by form (4), from
//   TWO printed typical (If, Vf) points. A lone point, a MIN/MAX-only limit, a graph, or a
//   vendor's SPICE-model card is not a pair of printed points and yields neither parameter.
// - `thermalVoltage`: omitted for every part below. kT/q at room temperature, not a
//   per-part datasheet figure.
// - `breakdownVolts`: omitted for every signal diode below (the stamp keeps the no-knee 0;
//   a knee belongs to class `zener` and the existing `zenerLaw` path, not here).
// - `seriesResistance`: omitted for every part below. No sheet in this wave prints an ohmic
//   series resistance (dynamic impedance at breakdown is a different quantity and is never
//   mapped onto it); the stamp keeps the class 1.0 ohm.
//
// This module is empty BY VERDICT, not by omission: all eight wave-1 diodes were examined
// and every one is excluded -- the four vendored sheets (1N5817, 1N914, 1N4007, 1N34A) print
// MAX-only forward limits, and the four fetched sheets (Vishay 1N4148/1N5817/1N914/BAT41/BAT46,
// ST BAT41/BAT46, Diodes Inc/Zetex 1N400x, Central Semi 1N34A attempt) print MAX-only limits
// or a single TYP point where the derivation needs two. Form (4) needs two printed typical
// (If, Vf) points; a limit is not a point and one point underdetermines IS+n. See the wave-1
// report for the per-part table. The builder (`diodeLawEntry`) and wiring stand ready for a
// part whose sheet prints the pair.

import { definePartData, type PartDataEntry } from "./loader";

export const diodeRegistryRecords: readonly PartDataEntry[] = definePartData([]);
