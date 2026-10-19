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
//
// Wave-2 re-examination (same verdict, extended): the manufacturer-model rule unlocks nothing
// retrievable for these parts in this run. onsemi's diode model files are portal-gated
// (guessed /download/models/txt/*.lib.txt URLs fall back to the docs landing page; only
// 2n2222a.lib.txt is directly fetchable), Diodes Inc's portal is bot-walled (403), ST's
// 'Signal Schottky PSpice v8.0' zip (BAT41/BAT46) is not bot-downloadable, Nexperia's pages
// are bot-walled, and Vishay publishes no SPICE for 1N4148/BAT41/BAT46/BAT85S. The one
// onsemi-authored line circulating for this family (1N4148/1N914 Is=2.52n N=1.752) reaches
// this repo only through LTspice's standard files, which the owner rule explicitly excludes.
// Re-checked sheets, all MAX-only or single-TYP (one printed typical point, form (4) needs
// two): Vishay 1N4148 (VF MAX-only 1 V @ 10 mA); Vishay BAT41 85659 (VF @ 1 mA TYP 400 MAX
// 450 mV, @ 200 mA MAX-only 1000 mV -- one TYP point); Vishay BAT85S 85513 (all five VF rows
// MAX-only: 240/320/400/500/800 mV at 0.1/1/10/30/100 mA); Taitron 1N60/1N60P (VF 1.0 V @
// 5 mA, single figure); onsemi 1N4007 (vF TYP 0.93 MAX 1.1 V @ 1 A -- one TYP point).
// 1N60P is a Semtech part (outside the seven allowed manufacturers); 1N34A is germanium
// with no allowed-manufacturer model; D9E/D9K are Soviet germanium with no authoritative
// source at all (owner measurement needed). Owner follow-up: download the ST PSpice zip,
// the Diodes Inc per-part .spice.txt files, and the onsemi MMSD4148 simulation-models ZIP
// from the manufacturers' portals; each yields citable IS+n under `manufacturer-model`.

import { definePartData, type PartDataEntry } from "./loader";

export const diodeRegistryRecords: readonly PartDataEntry[] = definePartData([]);
