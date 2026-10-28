// LM386 / NJM386 fixed-gain power-amp registry data: the printed resistor network and
// the derived gain-bandwidth product, by exact part id.
//
// One record per maker sheet (TI, NJR). The five resistor values below are the printed
// internal-schematic figures both sheets draw identically (TI SNAS545D Rev D p1 equivalent
// schematic; NJR NJM386 databook p5-1 Equivalent Circuit): 15 kΩ feedback (output to pin-1
// node), 1.35 kΩ gain-set (pin 1 to pin 8), 150 Ω degeneration (pin-8 node to the
// input-stage emitter node), 50 kΩ input shunt (each input to ground) and 15 kΩ bypass
// upper (Vs to pin 7). The lower bypass 15 kΩ terminates on an unmodeled internal bias
// node, so only the upper half is a pin-to-pin stamp (`lower.ts` documents the omission).
//
// The gain-bandwidth product is DERIVED, not printed: neither sheet prints a GBW row. Both
// print closed-loop bandwidth 300 kHz TYP at gain 20 (TI p5 §6.5, NJR p5-2), and the follower
// that carries the product is a unity-gain buffer, so its closed-loop corner equals the
// product directly (no noise-gain multiple: the pole sits in the x1 follower, not in a x20
// loop; `lower.ts` and the report show the loop algebra and the measured loop factor ~0.9,
// disclosed as part of the derivation rather than hidden in the number). Basis `derived`
// with the working written so it can be checked; the circularity (the product is derived
// from the very bandwidth it reproduces) is stated, not hidden.
//
// Provenance, per parameter:
// - The five resistors: `datasheet`; the value is a direct reading of the printed
//   equivalent schematic.
// - `gainBandwidthHz`: `derived`; the arithmetic is the closed identity above, quoted with
//   the printed BW row it is derived from.
// - `openLoopGain` (class schema) is NOT carried here: like the op-amp rows, the builder in
//   `part-catalog.ts` supplies the house ideal-opamp value (1e5) with its prose citation.
//
// `JRC386D` is the one knowingly non-printed id here, carried on the NJR record per owner
// decision 2026-10-28, on the same footing as `JRC4558D` (part-catalog.ts, owner decision
// 2026-10-15). The NJR databook prints NJM386D (p5-1 lists NJM386D / M / L / E) and carries the
// maker's "JRC" logo and "New Japan Radio Co., Ltd." footer; it does NOT print the string
// JRC386D, so this is an owner marking alias, not a maker statement (the registry rule that a
// typed alias needs a source stating equivalence is met only by that owner decision). Two
// vendor listings name the part ("NJM386D / JRC386D NOS NJR JAPAN"; "JRC386D full analog of
// NJM386D") and are weak, so they are not the basis. The NJR sheet disagrees with itself on
// quiescent current (table ICC 3 mA TYP / 8 mA MAX at 6 V against page-1 prose "4mA"), and TI
// prints 4 mA TYP; no quiescent figure is carried here because the law does not need one.
// Bare `LM386` rides the TI record as an alias: the TI sheet's family title plus its Device
// Information table (all orderables LM386-prefixed) is the stated source, per owner ruling
// 2026-10-28 (asked, answered "Alias allowed on TI title").

import type { PartClassName } from "./schema";
import { definePartData, type PartDataEntry } from "./loader";

/** LM386 resistor + GBW record, as cited parameters. */
export type PowerAmpRegistryRecord = PartDataEntry & { class: "power-amp" };

const TI_SHEET = "TI LM386 SNAS545D Rev D (Aug 2023)";
const NJR_SHEET = "NJR NJM386 databook pp. 5-1-5-5 (JRC logo, New Japan Radio Co., Ltd. footer)";

export const powerAmpRegistryRecords: readonly PartDataEntry[] = definePartData([
	{
		// TI orderables: Device Information table p1 (LM386N-1/N-3/N-4 PDIP, LM386M-1/MX-1
		// SOIC, LM386MMX-1 VSSOP). The bare LM386 alias rests on the sheet's family title
		// 'LM386 Low Voltage Audio Power Amplifier' (p1) plus this table (every orderable
		// LM386-prefixed); no orderable prints the bare stem alone.
		partIds: ["LM386N-1", "LM386N-3", "LM386N-4", "LM386M-1", "LM386MX-1", "LM386MMX-1"],
		aliases: ["LM386"],
		class: "power-amp",
		params: {
			feedbackOhms: {
				value: 15000,
				basis: "datasheet",
				source:
					`${TI_SHEET} p1 equivalent schematic: the 15 k resistor from the ` +
					`VOUT (pin 5) node to the GAIN 1 node (feedback path). Identical value and ` +
					`placement in ${NJR_SHEET} p5-1 Equivalent Circuit.`,
			},
			gainSetOhms: {
				value: 1350,
				basis: "datasheet",
				source:
					`${TI_SHEET} p1 equivalent schematic: the 1.35 k resistor between the ` +
					`GAIN 8 and GAIN 1 pins. Identical in ${NJR_SHEET} p5-1 Equivalent Circuit.`,
			},
			degenerationOhms: {
				value: 150,
				basis: "datasheet",
				source:
					`${TI_SHEET} p1 equivalent schematic: the 150 resistor from the GAIN 8 ` +
					`node to the input-stage emitter node (internal end). Identical in ` +
					`${NJR_SHEET} p5-1 Equivalent Circuit.`,
			},
			inputShuntOhms: {
				value: 50000,
				basis: "datasheet",
				source:
					`${TI_SHEET} p1 equivalent schematic and §9.2.1.2.2 Input Biasing p11 ` +
					`('both inputs are biased to ground with a 50 kΩ resistor'); the 50 k ` +
					`resistors from -INPUT (pin 2) and +INPUT (pin 3) to ground. Identical in ` +
					`${NJR_SHEET} p5-1 Equivalent Circuit and p5-3 INPUT BIASING ('biased to ` +
					`ground with a 50 kΩ resistor').`,
			},
			bypassUpperOhms: {
				value: 15000,
				basis: "datasheet",
				source:
					`${TI_SHEET} p1 equivalent schematic: the 15 k resistor from Vs (pin 6) ` +
					`to the BYPASS (pin 7) node (upper half of the bypass divider; the lower ` +
					`15 k lands on an unmodeled internal bias node). Identical in ` +
					`${NJR_SHEET} p5-1 Equivalent Circuit.`,
			},
			gainBandwidthHz: {
				value: 300000,
				basis: "derived",
				source:
					`${TI_SHEET} p5 §6.5 Electrical Characteristics: 'BW | Bandwidth | VS = 6 V, ` +
					`Pins 1 and 8 Open | TYP 300 | kHz' (TYP column; MIN/MAX blank). Derivation: ` +
					`the GBW is carried by the output follower, a unity-gain buffer whose ` +
					`closed-loop corner equals the product directly (no noise-gain multiple: ` +
					`the pole sits in the x1 follower, not in a x20 loop). The engine's measured ` +
					`loop factor is ~0.9 at high solver rates (see report), disclosed here rather ` +
					`than folded into the number; at standard 48 kHz rates the corner sits above ` +
					`Nyquist either way. Circularity disclosed: the product is derived from the ` +
					`bandwidth it reproduces.`,
				derivation:
					`GBW = printed closed-loop BW = 300 kHz, because the stamp carrying it is ` +
					`the unity-gain output follower (closed-loop corner = GBW / 1). The brief's ` +
					`6 MHz parenthetical assumed the pole sits in a x20 loop (NG = Av); the ` +
					`lowering documents why it does not (the pole sits in the x1 buffer, and ` +
					`the outer Rfb network divides by ~11 while the differential action ` +
					`multiplies by 2, so no single NG applies). Engine check at high solver ` +
					`rates gives fc ~0.9 x GBW for both gains (report), consistent with unity.`,
			},
		},
		note:
			"TI SNAS545D prints supply range 4-12 V (N-1/N-3/M) and 5-18 V (N-4) " +
			"and output-power rows split by suffix (N-1 325 mW TYP at 6 V/8 Ω; N-3 700 mW TYP " +
			"at 9 V/8 Ω; N-4 1000 mW TYP at 16 V/32 Ω): the variants differ in printed output " +
			"power and supply range, and neither is a modeled law field, so one row shares the " +
			"suffix-independent parameters (gain, BW, THD, RIN, IBIAS rows are single-column). " +
			"A quiescent figure is deliberately not registered: TI prints IQ 4 mA TYP against " +
			"NJR's ICC 3 mA TYP (both at 6 V), and no quiescent figure is needed to land the " +
			"printed gain.",
	},
	{
		// NJR orderables: package outline drawings p5-1 (DIP NJM386D, M NJM386M, L NJM386L,
		// E NJM386E; scanned figures, no text layer). `JRC386D` is the owner-decided marking
		// of the NJM386D (see the header: the sheet does not print it). No bare NJM386 alias:
		// no scraped project needs one and none was asked for.
		partIds: ["NJM386D", "NJM386M", "NJM386L", "NJM386E", "JRC386D"],
		class: "power-amp",
		params: {
			feedbackOhms: {
				value: 15000,
				basis: "datasheet",
				source:
					`${NJR_SHEET} p5-1 Equivalent Circuit: the 15 k resistor from the ` +
					`OUTPUT (pin 5) node to the GAIN 1 node (feedback path). Identical value ` +
					`and placement in ${TI_SHEET} p1 equivalent schematic.`,
			},
			gainSetOhms: {
				value: 1350,
				basis: "datasheet",
				source:
					`${NJR_SHEET} p5-1 Equivalent Circuit: the 1.35 k resistor between the ` +
					`GAIN 8 and GAIN 1 pins. Identical in ${TI_SHEET} p1 equivalent schematic.`,
			},
			degenerationOhms: {
				value: 150,
				basis: "datasheet",
				source:
					`${NJR_SHEET} p5-1 Equivalent Circuit: the 150 resistor from the GAIN 8 ` +
					`node to the input-stage emitter node (internal end). Identical in ` +
					`${TI_SHEET} p1 equivalent schematic.`,
			},
			inputShuntOhms: {
				value: 50000,
				basis: "datasheet",
				source:
					`${NJR_SHEET} p5-1 Equivalent Circuit and p5-3 INPUT BIASING ('both inputs ` +
					`are biased to ground with a 50 kΩ resistor'); the 50 k resistors from ` +
					`-INPUT (pin 2) and +INPUT (pin 3) to ground. Identical in ${TI_SHEET} ` +
					`p1 and §9.2.1.2.2 p11.`,
			},
			bypassUpperOhms: {
				value: 15000,
				basis: "datasheet",
				source:
					`${NJR_SHEET} p5-1 Equivalent Circuit: the 15 k resistor from V+ (pin 6) ` +
					`to the BY PASS (pin 7) node (upper half; lower 15 k internal). Identical ` +
					`in ${TI_SHEET} p1 equivalent schematic.`,
			},
			gainBandwidthHz: {
				value: 300000,
				basis: "derived",
				source:
					`${NJR_SHEET} p5-2 Electrical Characteristics (Ta = 25 C): 'Bandwidth BW, ` +
					`V+ = 6 V, Pins 1 and 8 Open: MIN - TYP 300 MAX - kHz'. Derivation: same ` +
					`unity-gain-follower identity as the TI record (closed-loop corner = GBW; ` +
					`measured loop factor ~0.9 disclosed in the report; circularity disclosed).`,
				derivation:
					`GBW = printed closed-loop BW = 300 kHz (follower unity-gain corner = ` +
					`closed-loop BW; see TI record for the noise-gain discussion).`,
			},
		},
		note:
			"NJR prints operating supply 4-12 V (all types) and output-power rows 325 mW TYP " +
			"at 6 V/8 Ω and 500 mW TYP at 9 V/16 Ω: same suffix-independent sharing as the TI " +
			"row. Quiescent omitted for the TI/NJR TYP conflict (4 vs 3 mA), as on the TI row.",
	},
]);

export function findPowerAmpRegistryData(
	data: readonly PartDataEntry[] = powerAmpRegistryRecords,
	partId: string,
): PartDataEntry | null {
	const folded = partId.toLowerCase().replace(/[^a-z0-9]/gu, "");
	for (const entry of data) {
		const ids = [...entry.partIds, ...(entry.aliases ?? [])];
		if (ids.some((id) => id.toLowerCase().replace(/[^a-z0-9]/gu, "") === folded)) {
			return entry;
		}
	}
	return null;
}

export type { PartClassName };
