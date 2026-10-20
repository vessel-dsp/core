// The parts the compiler is given, as data.
//
// **This file is the source. Edit it directly.** It used to claim to be generated from
// `web/assets/registry/component-part-lowering.json` plus the chips JSON, and that stopped being
// true on 2026-09-07 (`29f6ea84`): every commit since corrected it by hand, and nothing noticed,
// because nothing re-ran the generator. By 2026-09-23 regenerating deleted 514 lines, including 22
// `firmware` classifications and the `subsumesRefuted` record that only this file carried, and it
// **re-introduced retracted mistakes** -- a fictitious BBD delay macro on the TU-3's panel CPU among
// them. So the generator and the lowering JSON were deleted and this file kept, rather than the
// reverse: the hand edits are the corrections. Recovery point for both: `892cdcf6`.
//
// The electrical parameters that come from the device database live in
// `registry-data/` as cited values (`{ value, basis, source }`), and this file builds the
// entries that carry them. `scripts/report-part-store-drift.ts` is gone (deleted with the
// lowering-JSON generator); nothing re-runs a generator over this file.
//
// `registry.ts` deliberately holds no parts -- it is the shape and the matching rules, so the
// compiler itself knows about no specific chip and `emptyRegistry` stays a legitimate
// configuration. This file is the other half: the catalog that gets *injected*. Nothing under
// `src/compiler/` imports it, which is checkable in one line, so the compiler is still part-free.
//
// **Every parameter here comes from the part's own datasheet, and every entry cites which.** Not a
// typical value, not the number from a chip that behaves similarly, and not a value chosen because
// it made a packet compile. Where a datasheet does not state what a law needs, the part is absent
// from this file and the reason is recorded below rather than filled in.
//
// Citations prefer `vessel-dsp/artifacts`, which already vendors most of these datasheets under
// `parts/op-amps/<part>/datasheets/` alongside a curated `parts/op-amps/<part>.md`.
//
// The one thing this file needs from an op-amp datasheet is **open-loop gain**. `ideal-opamp` takes
// `openLoopGain` plus rails, and the rails are the pedal's rather than the part's, so a dual op-amp
// is a complete model from one published number and its pinout.
//
// **Gain-bandwidth product is the second figure, and it lives in the data registry**
// (`registry-data/opamp.ts`) rather than as a field on each entry, because one entry here
// often covers parts whose datasheets print different products (the TL072/NE5532/LM358 entry
// is one law over three datasheets). The TYP column is transcribed ("typical" here is that
// datasheet's own TYP column for that part, not a generic typical value), never MIN or MAX,
// never a graph read by eye, never a registry or curated-record number.
// A part whose datasheet prints no TYP gain-bandwidth row is listed in
// `opampGainBandwidthAbsent` with the reason and gets no figure, so its stamp is `null`
// and the compile names it (`opamp-gain-bandwidth-default`).
// Matching is by exact folded part id, as everywhere in this file: an id the datasheet
// does not print is not covered because a sibling is.
//
// **Output swing is the third figure, and lives there too** (`registry-data/opamp.ts`): the
// distance the output stops short of each rail, as a printed **pair** (positive side, negative
// side) with the condition it was printed at (total supply, load) and how it is carried to a
// pedal on another supply (`translation`, `"constant"` or `"proportional"`). TYP column only,
// printed rows only; an id with no such row is listed in `opampOutputSwingAbsent` with the
// reason and states no swing. Nearly every printed row is at +-15 V and nearly every pedal
// runs at 9 V, so the carry is a named choice, and `opamp-law-default-parameters` names
// every device it was carried for.

import type { PartEntry, PartRegistry } from "./registry";
import { foldPartId, opampOutputSwingOf } from "./registry";
import type { DeviceLaw } from "./types";
import {
	bjtRegistryRecords,
	chargePumpRegistryRecords,
	diodeRegistryRecords,
	findPartRegistryData,
	jfetRegistryRecords,
	mosfetRegistryRecords,
	opampGainBandwidthAbsent,
	opampOutputSwingAbsent,
	opampRegistryRecords,
	regulatorRegistryRecords,
	ujtRegistryRecords,
	zenerRegistryRecords,
	communityProvenanceOf,
	type CitedParam,
	type OpampRegistryRecord,
	type PartDataEntry,
} from "./registry-data";
import type { PartClassName } from "./registry-data/schema";

// The absent lists and the merged op-amp records live in `registry-data/opamp.ts` and are
// re-exported here so their existing import sites keep working.
export {
	opampGainBandwidthAbsent,
	opampOutputSwingAbsent,
	opampRegistryRecords,
	type OpampRegistryRecord,
	type OpampSwingPrinted,
} from "./registry-data";
export type { CitedParam, PartDataEntry, PartClassName };

/**
 * An op-amp section as the registry states it: the part's own gain, and no rails.
 */
function opampSection(openLoopGain: number): DeviceLaw {
	return { kind: "ideal-opamp", railHigh: null, railLow: null, openLoopGain };
}

/**
 * A datasheet's decibel figure as the dimensionless gain the law wants.
 */
function decibelGain(decibels: number): number {
	return 10 ** (decibels / 20);
}

/**
 * Grid conduction, identical for every tube below because the registry states it for none of them.
 */
const GENERIC_TUBE_GRID = {
	gridSaturationCurrent: 1.0e-5,
	gridOnsetVolts: 0.05,
	gridScaleVolts: 0.06,
	contactPotentialVolts: 0,
} as const;

function tubeLaw(partIds: readonly string[], law: DeviceLaw): PartEntry {
	return {
		partIds,
		declaredTypes: [],
		terminalRoleGroups: [],
		model: { kind: "law", law },
	};
}

/**
 * A zener diode's reverse knee from the device database, with the forward behaviour held
 * at the class default.
 *
 * Breakdown volts are `reverseBreakdownVoltage.typ` from
 * `web/assets/registry/component-diode-chips.json` (`zener-reference` rows, each with its
 * own source) or `reverseBreakdownVoltage` from
 * `web/assets/registry/component-zener-diode-chips.json` where the diode file has no row.
 * A min/max range is stamped at `typ` and disclosed here, never spanned.
 *
 * Forward parameters are deliberately NOT the registry's: `saturationCurrent`,
 * `emissionCoefficient` and `thermalVoltage` repeat the class default from
 * `device-laws.ts`'s diode case, and `seriesResistance` repeats its 1.0 ohm default
 * (the registry's `reverseBreakdownResistance` is a dynamic impedance at breakdown, not
 * the law's ohmic series resistance, and mapping one to the other needs a fixture first).
 * So a newly covered zener renders its old forward behaviour exactly and only gains a
 * reverse knee; deriving the forward law is plan step 2's work, not this entry's.
 */
function zenerLaw(record: PartDataEntry): PartEntry {
	const breakdownVolts = zenerBreakdownVoltsOf(record);
	return {
		partIds: [...record.partIds],
		declaredTypes: [],
		terminalRoleGroups: [],
		...provisionalArmOf(record),
		model: {
			kind: "law",
			law: {
				kind: "diode",
				saturationCurrent: 2.52e-9,
				emissionCoefficient: 1.752,
				thermalVoltage: 0.025852,
				breakdownVolts,
				seriesResistance: 1.0,
			},
		},
	};
}

/**
 * The `provisionalParams` arm of a law entry built from a data record: the record's
 * `community`-basis parameters with their source URLs, or absent when the record holds
 * none. Spread into the built entry, so an entry with no provisional value is shaped
 * exactly as before (the field stays absent, not empty).
 */
function provisionalArmOf(
	record: PartDataEntry,
): Pick<PartEntry, "provisionalParams"> {
	const provisional = communityProvenanceOf(record);
	return provisional.length === 0 ? {} : { provisionalParams: provisional };
}

/**
 * Every part id a `zenerLaw` entry covers, folded for comparison: a hand-fitted diode law
 * that happens to sit on a zener id is still graded as a forward claim, and a zener entry
 * is never mistaken for one.
 */

// --- Wave-1 discrete builders: cited record -> law entry --------------------------------------
//
// Stage-1 wired the bjt, mosfet, diode-forward and jfet-channel cases to read the registry
// (document-typed > registry > class default, exact folded part id). These builders turn the
// wave-1 `registry-data` records into the law entries those cases read. Every builder maps the
// record's PRESENT parameters and gap-fills the rest with the class default the unregistered
// path stamps -- the literals below repeat `device-laws.ts` (`SILICON_SATURATION_CURRENT`,
// `SILICON_FORWARD_BETA`, reverseBeta 1, `THERMAL_VOLTAGE`, leakageAmps 0; the JFET/MOSFET
// channel and gate constants; the diode forward defaults) BY VALUE, deliberately: importing
// them would drag the stamping path into the catalog, and a drift between the two copies is
// caught by the sparse-record test (`registry-discrete-wiring`), which stamps a one-parameter
// entry and requires every omitted field to equal the empty-registry stamp.
//
// Bin and package spellings merge into the entry's `partIds`: `registryLawFor` matches whole
// folded ids against `partIds` only, so an alias that stayed on the record would never match.
// The data loader's uniqueness scope already covers ids plus aliases, so the merge cannot
// introduce a collision the loader missed.
//
// Structural fields stay at stamp time, never in the entry: a bjt entry's `polarity` and a
// fet entry's `channel` are inert placeholders (`npn` / `n`) that `device-laws.ts` always
// overwrites from the device's own `pnp` / `pChannel`. A bjt entry therefore serves NPN and
// PNP parts alike, and no entry asserts a polarity or channel about anyone's part.

/** One record's cited value for a schema parameter, or absent when the record omits it. */
function citedValueOf(record: PartDataEntry, name: string): number | undefined {
	const param = record.params[name];
	return param === undefined ? undefined : param.value;
}

/** The `citedParams` arm of a law entry built from a record: the parameters it states. */
function citedArmOf(record: PartDataEntry): Pick<PartEntry, "citedParams"> {
	return { citedParams: Object.keys(record.params) };
}

/** The entry's id list: canonical ids plus typed alias spellings, in listing order. */
function entryIdsOf(record: PartDataEntry): readonly string[] {
	return [...record.partIds, ...(record.aliases ?? [])];
}

/** A bjt record's law entry. Throws when the record is not class `bjt` or states nothing. */
export function bjtLawEntry(record: PartDataEntry): PartEntry {
	if (record.class !== "bjt") {
		throw new Error(
			`${record.partIds.join(",")}: a bjt entry needs class "bjt", not "${record.class}"`,
		);
	}
	if (Object.keys(record.params).length === 0) {
		throw new Error(
			`${record.partIds.join(",")}: a bjt record states no parameters`,
		);
	}
	return {
		partIds: entryIdsOf(record),
		declaredTypes: [],
		terminalRoleGroups: [],
		...provisionalArmOf(record),
		...citedArmOf(record),
		model: {
			kind: "law",
			law: {
				kind: "bjt",
				polarity: "npn",
				saturationCurrent:
					citedValueOf(record, "saturationCurrent") ?? 1e-14,
				forwardBeta: citedValueOf(record, "forwardBeta") ?? 100,
				reverseBeta: citedValueOf(record, "reverseBeta") ?? 1,
				thermalVoltage: citedValueOf(record, "thermalVoltage") ?? 0.025_852,
				leakageAmps: citedValueOf(record, "leakageAmps") ?? 0,
			},
		},
	};
}

/**
 * A signal-diode record's law entry. Requires the forward pair together: the only
 * derivation the registry admits (two printed (If, Vf) points) yields IS and n as one
 * working, so a lone IS without n is a broken derivation and throws rather than shipping
 * half a knee. Gap-filled breakdownVolts 0 keeps the no-knee reading the unregistered path
 * stamps (a zener knee belongs to class `zener` and the existing `zenerLaw` path, not here).
 */
export function diodeLawEntry(record: PartDataEntry): PartEntry {
	if (record.class !== "diode") {
		throw new Error(
			`${record.partIds.join(",")}: a diode entry needs class "diode", not "${record.class}"`,
		);
	}
	const saturationCurrent = citedValueOf(record, "saturationCurrent");
	const emissionCoefficient = citedValueOf(record, "emissionCoefficient");
	if (saturationCurrent === undefined || emissionCoefficient === undefined) {
		throw new Error(
			`${record.partIds.join(",")}: a diode record states no forward pair ` +
				`(saturationCurrent ${saturationCurrent === undefined ? "absent" : "present"}, ` +
				`emissionCoefficient ${emissionCoefficient === undefined ? "absent" : "present"})`,
		);
	}
	return {
		partIds: entryIdsOf(record),
		declaredTypes: [],
		terminalRoleGroups: [],
		...provisionalArmOf(record),
		...citedArmOf(record),
		model: {
			kind: "law",
			law: {
				kind: "diode",
				saturationCurrent,
				emissionCoefficient,
				thermalVoltage: citedValueOf(record, "thermalVoltage") ?? 0.025_852,
				breakdownVolts: citedValueOf(record, "breakdownVolts") ?? 0,
				seriesResistance: citedValueOf(record, "seriesResistance") ?? 1.0,
				isLed: false,
			},
		},
	};
}

/**
 * A JFET- or MOSFET-channel record's law entry. The class selects the gap-fill constants
 * (JFET depletion defaults with the silicon gate; MOSFET enhancement defaults with the
 * insulated gate), so a JFET record can never stamp MOSFET gate zeros and the reverse.
 * Throws on any other class and on an empty record.
 */
export function fetLawEntry(
	record: PartDataEntry,
	cls: "jfet" | "mosfet",
): PartEntry {
	if (record.class !== cls) {
		throw new Error(
			`${record.partIds.join(",")}: a ${cls} entry needs class "${cls}", not "${record.class}"`,
		);
	}
	if (Object.keys(record.params).length === 0) {
		throw new Error(
			`${record.partIds.join(",")}: a ${cls} record states no parameters`,
		);
	}
	const channelDefaults =
		cls === "jfet"
			? {
					thresholdVolts: -2,
					transconductance: 1e-3,
					channelLengthModulation: 0,
					subthresholdVolts: 0.07,
					gateSaturationCurrent: 1e-5,
					gateOnsetVolts: 0.5,
					gateScaleVolts: 0.06,
				}
			: {
					thresholdVolts: 2,
					transconductance: 1e-3,
					channelLengthModulation: 0,
					subthresholdVolts: 0,
					gateSaturationCurrent: 0,
					gateOnsetVolts: 0,
					gateScaleVolts: 1,
				};
	return {
		partIds: entryIdsOf(record),
		declaredTypes: [],
		terminalRoleGroups: [],
		...provisionalArmOf(record),
		...citedArmOf(record),
		model: {
			kind: "law",
			law: {
				kind: "fet",
				channel: "n",
				thresholdVolts:
					citedValueOf(record, "thresholdVolts") ??
					channelDefaults.thresholdVolts,
				transconductance:
					citedValueOf(record, "transconductance") ??
					channelDefaults.transconductance,
				channelLengthModulation:
					citedValueOf(record, "channelLengthModulation") ??
					channelDefaults.channelLengthModulation,
				subthresholdVolts:
					citedValueOf(record, "subthresholdVolts") ??
					channelDefaults.subthresholdVolts,
				gateSaturationCurrent:
					citedValueOf(record, "gateSaturationCurrent") ??
					channelDefaults.gateSaturationCurrent,
				gateOnsetVolts:
					citedValueOf(record, "gateOnsetVolts") ??
					channelDefaults.gateOnsetVolts,
				gateScaleVolts:
					citedValueOf(record, "gateScaleVolts") ??
					channelDefaults.gateScaleVolts,
			},
		},
	};
}

/**
 * A unijunction-transistor record's law entry. Requires the tap fraction and the bar
 * together: eta without Rbb cannot place the peak point and Rbb without eta cannot
 * split the bar, so a half record throws rather than shipping half a device. The
 * emitter diode and the snap are law structure, never entry fields.
 */
export function ujtLawEntry(record: PartDataEntry): PartEntry {
	if (record.class !== "ujt") {
		throw new Error(
			`${record.partIds.join(",")}: a ujt entry needs class "ujt", not "${record.class}"`,
		);
	}
	const intrinsicStandoffRatio = citedValueOf(record, "intrinsicStandoffRatio");
	const interbaseResistanceOhms = citedValueOf(record, "interbaseResistanceOhms");
	if (intrinsicStandoffRatio === undefined || interbaseResistanceOhms === undefined) {
		throw new Error(
			`${record.partIds.join(",")}: a ujt record states no tap and bar ` +
				`(intrinsicStandoffRatio ${intrinsicStandoffRatio === undefined ? "absent" : "present"}, ` +
				`interbaseResistanceOhms ${interbaseResistanceOhms === undefined ? "absent" : "present"})`,
		);
	}
	return {
		partIds: entryIdsOf(record),
		declaredTypes: [],
		terminalRoleGroups: [],
		...provisionalArmOf(record),
		model: {
			kind: "law",
			law: {
				kind: "ujt",
				intrinsicStandoffRatio,
				interbaseResistanceOhms,
			},
		},
	};
}

// --- JFET channel records: built by `fetLawEntry` (wave-1 builders above) -------------------
//
// The JFET class default is avowedly no part's values; see `registry-data/jfet.ts` for the
// measured gate-defect note, the rank argument for keeping the 2SK30A class channel, and the
// provenance. The generic builder maps each record's present parameters and gap-fills the
// class channel, so 2SK30A (gate term only) stamps byte-identically to before while full
// channels (2N5457) stamp their cited values.

// --- Zener diodes: reverse breakdown from the data registry -------------------------------------
//
// `breakdownVolts` only; forward behaviour repeats the class default by construction (see
// `zenerLaw` above). A device that declares its own breakdown keeps it: `device-laws.ts`
// overlays the declared value on a catalog match, so the corpus diodes that already
// declare one (e.g. `boss-ph-1r` D1 11 V against the registry's 10.99) render unchanged.
// The rows live in `registry-data/zener.ts` as cited values; the entries array below maps
// them through `zenerLaw`, so the membership set below and the shipped entries cannot
// drift apart: there is one list, not two.

/** Read a zener record's cited breakdown, loudly. The loader guarantees the citation. */
function zenerBreakdownVoltsOf(record: PartDataEntry): number {
	const breakdown = record.params["breakdownVolts"];
	if (breakdown === undefined || !Number.isFinite(breakdown.value)) {
		throw new Error(
			`${record.partIds.join(",")}: a zener record states no breakdownVolts`,
		);
	}
	return breakdown.value;
}

export const zenerCatalogPartIds: ReadonlySet<string> = new Set(
	zenerRegistryRecords.flatMap((record) =>
		record.partIds.map((id) => foldPartId(id)),
	),
);

// --- Fixed-rail regulators: wiring skeletons over registry-data voltages ---------------------------
// The rail numbers live in `registry-data/regulator.ts` as cited values; this table holds only
// the terminal wiring (role groups, section terminals) each rail's entry shares. Keyed by the
// rail volts the record states, so a record always lands on its own wiring and a skeleton row
// no record consumes throws at load (see the check below). `pinout` is `[null, null, null]`
// for all of them: no regulator entry asserts a pin order.
const regulatorTerminalStructures: Record<
	number,
	{ readonly terminalRoleGroups: readonly (readonly string[])[]; readonly terminals: readonly [number, number] }
> = {
	// UNRESOLVED: this entry conflates two packages with OPPOSITE pin orders. The TO-92/SOT-89 78L05 is pin1=VOUT, pin2=GND, pin3=VIN (verified: TI LM78L, SNVS754O, Figure 4-2 SOT-89 top view and Figure 4-3 LP 3-pin TO-92 bottom view). The TO-220 7805 is pin1=VIN, pin2=GND, pin3=VOUT. The role groups below assert the 7805 order, because `pin1` sits in the vin group and `pin3` in the vout group.
	// Consequence: a document that declares a 78L05's terminals as pin1/pin2/pin3 binds its input and output the wrong way round. No corpus packet does today -- all seven three-pin regulators declare typed roles as of 2026-09-05 -- so this is latent, not live. Fixing it means SPLITTING the entry by package before a `pinout` can be written, because one pin map cannot serve both.
	5: {
		terminalRoleGroups: [["vin", "in", "input", "pin1"], ["gnd", "pin2"], ["vout", "out", "output", "pin3"]],
		terminals: [2, 1],
	},
	9: {
		terminalRoleGroups: [["vin", "in", "input", "pin1"], ["gnd", "pin2"], ["vout", "out", "output", "pin3"]],
		terminals: [2, 1],
	},
	// Wave 5: 12 V and 3.3 V 78Lxx rails (LM78L12/LM78L33, TI SNVS754O). Same wiring
	// shape as the 5 V/9 V entries, and the same latent TO-92-vs-TO-220 pin-order
	// caveat as the 5 V entry above: no corpus packet names these rails today, so the
	// order is asserted for parity, not verified against a packet.
	12: {
		terminalRoleGroups: [["vin", "in", "input", "pin1"], ["gnd", "pin2"], ["vout", "out", "output", "pin3"]],
		terminals: [2, 1],
	},
	3.3: {
		terminalRoleGroups: [["vin", "in", "input", "pin1"], ["gnd", "pin2"], ["vout", "out", "output", "pin3"]],
		terminals: [2, 1],
	},
	// electro-harmonix-q-tron's U6 (PartNumber 78L18AC) is the 24V-to-+18V rail; it matches by part id on the first rung, so the role groups below are the standard in/gnd/out family spelling kept for parity with the 5V/9V entries, not a new contract.
	18: {
		terminalRoleGroups: [["vin", "in", "input", "pin1"], ["gnd", "ground", "pin2"], ["vout", "out", "output", "pin3"]],
		terminals: [2, 1],
	},
	// `volts` here is SIGNED, which contradicts the convention its consumer documents: `declaredRegulatorTerminals` says "the law carries a magnitude" and reverses the source's sense for an output declared `negative`. Declaring `negative` against a signed -15 therefore double-negates and puts +15V on the rail -- measured 2026-09-05. Until this is settled, a negative regulator using this entry must declare its output `positive`, which is why deluxe-memory-man does.
	[-15]: {
		terminalRoleGroups: [["gnd", "pin1"], ["vin", "in", "input", "pin2"], ["vout", "out", "output", "pin3"]],
		terminals: [2, 0],
	},
	// `terminalRoleGroups` is left empty rather than copying the existing regulators' generic `in`/`gnd`/`out` aliases: `VR1` already resolves through the exact part id, and this repo's own corpus shows that generic pinout-signature fallback misidentifying an unrelated part with similarly generic terminal names (`boss-oc-2`'s `BA634-5`, five terminals including `in`/`gnd`/`out`, incidentally satisfies the existing 78L05 groups and is only saved from a wrong law by the later terminal-count guard). No reason to add a second entry to that same weak ladder when the exact part id already does the job.
	15: {
		terminalRoleGroups: [],
		terminals: [2, 1],
	},
};

/** Build one regulator entry from its registry record and the wiring skeleton for its rail. */
function regulatorEntry(record: PartDataEntry): PartEntry {
	const volts = record.params["volts"];
	const sourceOhms = record.params["sourceOhms"];
	if (volts === undefined || sourceOhms === undefined) {
		throw new Error(
			`${record.partIds.join(",")}: a regulator record states no volts or sourceOhms`,
		);
	}
	const structure = regulatorTerminalStructures[volts.value];
	if (structure === undefined) {
		throw new Error(
			`${record.partIds.join(",")}: no regulator wiring skeleton for ${String(volts.value)} V`,
		);
	}
	return {
		partIds: [...record.partIds],
		declaredTypes: [],
		terminalRoleGroups: structure.terminalRoleGroups,
		...provisionalArmOf(record),
		model: {
			kind: "sections",
			sections: [
				{
					law: {
						kind: "voltage-source",
						volts: volts.value,
						sourceOhms: sourceOhms.value,
					},
					terminals: [...structure.terminals],
				},
			],
			pinout: [null, null, null],
		},
	};
}

/** The regulator entry for one rail, by the volts its registry record states. Position-preserving. */
function regulatorEntryForVolts(volts: number): PartEntry {
	const record = regulatorRegistryRecords.find(
		(candidate) => candidate.params["volts"]?.value === volts,
	);
	if (record === undefined) {
		throw new Error(`no regulator registry record states ${String(volts)} V`);
	}
	return regulatorEntry(record);
}

// Every skeleton row is consumed by exactly one record, and every record lands on a row:
// a rail added to one side without the other throws here rather than silently defaulting.
for (const key of Object.keys(regulatorTerminalStructures)) {
	if (
		!regulatorRegistryRecords.some(
			(record) => record.params["volts"]?.value === Number(key),
		)
	) {
		throw new Error(`regulator wiring skeleton for ${key} V is consumed by no registry record`);
	}
}

// --- Charge pumps: wiring skeletons over registry-data loss/slope ---------------------------------
// The two numbers the derivation reads (`sourceOhms`, `chargePumpLossVolts`) live in
// `registry-data/charge-pump.ts` as cited values; this table holds only the terminal wiring
// (role groups, package-order pinout) each pump's entry shares. The 8-pin parts are NOT
// pin-identical: pin 1 is BOOST (TC1044S, ICL7660S, TC7662B, MAX1044), NC (ICL7660, ICL7660A),
// FB/SD (LT1054) or SHDN (LTC1144). Keyed by the record's first part id, so a record always
// lands on its own wiring; a record with no skeleton row, or a skeleton row no record
// consumes, throws at load (see the check below).
//
// `volts: 0` in the built law is an unused placeholder: the pump rail is derived per circuit
// from the input node (see `pumpDerivation` in device-laws.ts), and pump parts bypass generic
// section expansion, `registrySuppliedVoltages`, and `declaredRegulatorTerminals`, so this
// number is never stamped.
const chargePumpTerminalStructures: Record<
	string,
	{
		readonly terminalRoleGroups: readonly (readonly string[])[];
		readonly pinout: readonly (string | null)[];
	}
> = {
	// Pinout verified against Microchip DS21348A (2001), p1 pin-configuration diagram and general
	// description: 1 BOOST, 2 CAP+, 3 GND, 4 CAP-, 5 VOUT, 6 LV, 7 OSC, 8 V+.
	BOOST_7660: {
		terminalRoleGroups: [
			["boost"],
			["capp", "capplus"],
			["gnd", "ground"],
			["capm", "capminus"],
			["vout", "negativeoutput", "voutnegative", "out", "output"],
			["lv", "lowvoltage"],
			["osc", "oscillator"],
			["vplus", "vin", "vdd", "vcc", "input"],
		],
		pinout: ["boost", "capp", "gnd", "capm", "vout", "lv", "osc", "vplus"],
	},
	// Pinout verified against Intersil FN3072 Rev 7.00, p1 pinout diagram (8 Ld PDIP/SOIC top view):
	// 1 NC, 2 CAP+, 3 GND, 4 CAP-, 5 VOUT, 6 LV, 7 OSC, 8 V+.
	NC_7660: {
		terminalRoleGroups: [
			["nc", "noconnect"],
			["capp", "capplus"],
			["gnd", "ground"],
			["capm", "capminus"],
			["vout", "negativeoutput", "voutnegative", "out", "output"],
			["lv", "lowvoltage"],
			["osc", "oscillator"],
			["vplus", "vin", "vdd", "vcc", "input"],
		],
		pinout: ["nc", "capp", "gnd", "capm", "vout", "lv", "osc", "vplus"],
	},
	// Pinout verified against TI SLVS033G, p3 pin config + pin-functions table (PDIP-8): 1 FB/SD
	// (shutdown/error-amp input), 2 CAP+, 3 GND, 4 CAP-, 5 VOUT (output), 6 VREF (2.5 V reference
	// output), 7 OSC (input), 8 VCC (supply). This is NOT the 7660 pin order: pin 1 is an input and
	// pin 6 an output, so the part is footprint-compatible but not a drop-in substitute.
	FBSD_LT1054: {
		terminalRoleGroups: [
			["fbsd", "fb", "sd", "shutdown"],
			["capp", "capplus"],
			["gnd", "ground"],
			["capm", "capminus"],
			["vout", "negativeoutput", "voutnegative", "out", "output"],
			["vref", "reference"],
			["osc", "oscillator"],
			["vcc", "vin", "vplus", "vdd", "input"],
		],
		pinout: ["fbsd", "capp", "gnd", "capm", "vout", "vref", "osc", "vcc"],
	},
	// Pinout verified against Linear Technology 1144fa, p2 config + p5 Pin Functions: 1 BOOST
	// (x10 when tied high), 2 CAP+, 3 GND, 4 CAP-, 5 VOUT, 6 SHDN (float/V+ = run, GND = shutdown),
	// 7 OSC, 8 V+. No LV pin and no low-voltage mode split.
	SHDN_LTC1144: {
		terminalRoleGroups: [
			["boost"],
			["capp", "capplus"],
			["gnd", "ground"],
			["capm", "capminus"],
			["vout", "negativeoutput", "voutnegative", "out", "output"],
			["shdn", "shutdown"],
			["osc", "oscillator"],
			["vplus", "vin", "vdd", "vcc", "input"],
		],
		pinout: ["boost", "capp", "gnd", "capm", "vout", "shdn", "osc", "vplus"],
	},
};

/** Which wiring skeleton each charge-pump record builds on, by the record's first part id. */
const chargePumpStructureFor: Record<string, keyof typeof chargePumpTerminalStructures> = {
	TC1044S: "BOOST_7660",
	ICL7660: "NC_7660",
	ICL7660A: "NC_7660",
	ICL7660S: "BOOST_7660",
	TC7662B: "BOOST_7660",
	LT1054: "FBSD_LT1054",
	LTC1144: "SHDN_LTC1144",
	MAX1044: "BOOST_7660",
};

/** Build one charge-pump entry from its registry record and its wiring skeleton. */
function chargePumpEntry(record: PartDataEntry): PartEntry {
	const sourceOhms = record.params["sourceOhms"];
	const loss = record.params["chargePumpLossVolts"];
	if (sourceOhms === undefined || loss === undefined) {
		throw new Error(
			`${record.partIds.join(",")}: a charge-pump record states no sourceOhms or chargePumpLossVolts`,
		);
	}
	const key = record.partIds[0];
	const skeletonName = key === undefined ? undefined : chargePumpStructureFor[key];
	const skeleton =
		skeletonName === undefined ? undefined : chargePumpTerminalStructures[skeletonName];
	if (skeleton === undefined) {
		throw new Error(
			`${record.partIds.join(",")}: no charge-pump wiring skeleton for ${String(key)}`,
		);
	}
	return {
		partIds: [...record.partIds],
		declaredTypes: [],
		terminalRoleGroups: skeleton.terminalRoleGroups,
		...provisionalArmOf(record),
		model: {
			kind: "sections",
			sections: [
				{
					law: {
						kind: "voltage-source",
						volts: 0,
						sourceOhms: sourceOhms.value,
					},
					terminals: [4, 2],
				},
			],
			pinout: skeleton.pinout,
		},
		chargePumpLossVolts: loss.value,
	};
}

/** The charge-pump entry for one family, by the record's first part id. Position-preserving. */
function chargePumpEntryFor(firstPartId: string): PartEntry {
	const record = chargePumpRegistryRecords.find(
		(candidate) => candidate.partIds[0] === firstPartId,
	);
	if (record === undefined) {
		throw new Error(`no charge-pump registry record starts with ${firstPartId}`);
	}
	return chargePumpEntry(record);
}

// Every skeleton row is consumed by exactly one record, and every record lands on a row.
for (const key of Object.keys(chargePumpStructureFor)) {
	if (
		!chargePumpRegistryRecords.some((record) => record.partIds[0] === key)
	) {
		throw new Error(`charge-pump wiring skeleton for ${key} is consumed by no registry record`);
	}
}

const entries: readonly PartEntry[] = [
// uPC4558, from the artifacts library's own vendored copy:
	// `parts/op-amps/UPC4558/datasheets/renesas-upc258-upc4558.pdf` (Renesas `UPC258, UPC4558`,
	// R03DS0145EJ0200 Rev. 2.00, 2025-02-27), recorded in `parts/op-amps/UPC4558.md`. Electrical
	// characteristics at TA = 25 C, V+/- = +/-15 V:
	//
	//   Large Signal Voltage Gain  AV  RL >= 2 kOhm, VO = +/-10 V   MIN 20,000   TYP 100,000
	//
	// A plain ratio rather than dB, so 100,000 is transcribed and not converted. TYP and not MIN,
	// because the law is asked what a part does, not what the vendor guarantees. The older NEC
	// document (G10518EJ9V0DS00, 9th edition, June 2001) prints the same two figures.
	//
	// `parts/op-amps/UPC4558.md` records that this is family evidence rather than proof of the
	// vintage NEC `uPC4558C` DIP suffix `boss-bf-2` states. Open-loop gain is the only figure taken
	// from it, and the two documents agree on that figure.
	//
	// Supply current from the same document's p.5 curve "ICC vs. V+/-" (TA = 25 C, TYP.), for the
	// whole package: 2.6 mA at +/-4.5 V, which is a 9 V pedal's span, and flat to ~2.7 mA out to
	// +/-20 V. The table's Pd 90 mW at +/-15 V (3.0 mA) agrees. Read off the curve, so +/-0.1 mA.
	{
		"partIds": [
			"uPC4558C",
			"uPC4558G2",
			"uPC4558"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"quiescentSupplyAmps": 2.6e-3,
		"model": {
			"kind": "sections",
			"pinout": [
				"outA",
				"invertingInputA",
				"nonInvertingInputA",
				"outB",
				"invertingInputB",
				"nonInvertingInputB",
				"vcc",
				"vee"
			],
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						2,
						1,
						0
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						5,
						4,
						3
					]
				}
			]
		}
	},

// NJM4558, from `parts/op-amps/NJM4558/datasheets/nisshinbo-njm4558.pdf` (Nisshinbo Micro
	// Devices, the JRC successor), recorded in `parts/op-amps/NJM4558.md` as "A_OL typ | 100 k
	// (20 k min)". Electrical characteristics at V+/V- = +/-15 V, Ta = 25 C:
	//
	//   Large Signal Voltage Gain  AV  RL >= 2 kOhm, VO = +/-10 V   MIN 86 dB   TYP 100 dB
	//
	// 100 dB is 10^(100/20) = 100,000, which is what the part record's "100 k" states in the other
	// unit. `boss-ce-2b` says `NJM4558DD`; the datasheet's own numbers differ from it only in
	// package/rank suffix and are listed alongside.
	// `JRC4558D` is the one knowingly non-printed id here: the Nisshinbo sheet prints NJM4558D,
	// not JRC4558D, and the identification of JRC4558D as the NJR/JRC marking of the NJM4558D
	// rests on `parts/op-amps/JRC4558D.md` ("NJR/JRC version. Same datasheet specs as NJM4558"),
	// not on this sheet. It is carried anyway per owner decision 2026-10-15, because a real
	// Boss SD-1 specimen carries a chip marked "JRC 4558D" and three corpus packets name it.
	// **Pin labels corrected and role groups added 2026-09-02 (W2).** The pinout read `OUT_B, IN_B_MINUS, IN_B_PLUS, VEE, IN_A_PLUS, IN_A_MINUS, OUT_A, VCC` -- the datasheet's A and B swapped. Electrically it made no difference, because both sections are the same `ideal-opamp` law and each section's triple was internally consistent, so this is a documentation correction: the positions are physical DIP-8 pins either way and the `sections` indices are unchanged.
	// The role groups carry **only** the pin-numbered spellings, deliberately. Generic aliases (`noninverting`, `out`) would let one declared role satisfy two different groups -- A's and B's -- and `matchesTerminalRoles` would then identify any 5-terminal section as this whole package. Pin-numbered tokens are unambiguous per position. `boss-dm-3`'s `IC1` is the only corpus device declaring a 4558 as an 8-pin package rather than as sections.
	{
		"partIds": [
			"NJM4558DD",
			"NJM4558D",
			"JRC4558D",
			"JRC4558",
			"JRC4558DD",
			"NJM4558M",
			"NJM4558E",
			"NJM4558V",
			"NJM4558V",
			"NJM4558L",
			"NJM4558",
			"RC4558",
			"RC4558P",
			"RC4558D",
			"RC4558C",
			"4558"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"OUT_A_pin1"
			],
			[
				"INVERTING_A_pin2"
			],
			[
				"NONINVERTING_A_pin3"
			],
			[
				"V_MINUS_pin4"
			],
			[
				"NONINVERTING_B_pin5"
			],
			[
				"INVERTING_B_pin6"
			],
			[
				"OUT_B_pin7"
			],
			[
				"V_PLUS_pin8"
			]
		],
		"model": {
			"kind": "sections",
			"pinout": [
				"OUT_A",
				"IN_A_MINUS",
				"IN_A_PLUS",
				"VEE",
				"IN_B_PLUS",
				"IN_B_MINUS",
				"OUT_B",
				"VCC"
			],
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						2,
						1,
						0
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						4,
						5,
						6
					]
				}
			]
		}
	},

	// Texas Instruments TL061 (single) and TL062 (dual), from "TL061, TL061A, TL061B, TL062, TL062A,
	// TL062B, TL064, TL064A, TL064B" SLOS078N (Nov 1978, revised Aug 2023),
	// `parts/op-amps/TL062/datasheets/tl062.pdf` in vessel-dsp/artifacts. The one sheet covers the
	// family, so it is applied to the single TL061 as well as the dual TL062.
	//
	//   VOM  Maximum peak output voltage swing  RL = 10 kOhm, TA = 25 C, VCC+- = +-15 V
	//        Min +-10 V   Typ +-13.5 V   (table 6.7)
	//
	// Open-loop gain stays the house 100000 the family entry it was split from carried; it is not a
	// sourced TL06x figure. The output swing is not in this entry: it has its own table,
	// `registry-data/opamp.ts`, which stamps the printed pair (1.5 V a side, `constant`) onto these
	// ids, for a declared `opamp` device and a package alike. The graph-read 1.2 V this entry carried
	// until row 16 (Figure 6-1 at +-4.5 V) was not a printed figure and is gone.
	{
		"partIds": [
			"TL062",
			"TL062C",
			"TL062CP",
			"TL062CN"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"pinout": [
				"OUT_B",
				"IN_B_MINUS",
				"IN_B_PLUS",
				"VEE",
				"IN_A_PLUS",
				"IN_A_MINUS",
				"OUT_A",
				"VCC"
			],
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						2,
						1,
						0
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						4,
						5,
						6
					]
				}
			]
		}
	},
	{
		"partIds": [
			"TL061",
			"TL061CP",
			"TL061CN"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"vin+",
				"in+",
				"pin3"
			],
			[
				"vin-",
				"in-",
				"pin2"
			],
			[
				"vout",
				"out",
				"pin6"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						0,
						1,
						2
					]
				}
			],
			"pinout": [
				"vin+",
				"vin-",
				"vout"
			]
		}
	},

// Texas Instruments TL072, TL082, National LF353, Signetics NE5532, and LM358 families
	{
		"partIds": [
			"TL072",
			"TL072CP",
			"TL072CN",
			"TL072IP",
			"TL072D",
			"TL082",
			"TL082CP",
			"LF353",
			"LF353N",
			"LF353M",
			"NE5532",
			"NE5532P",
			"NE5532D",
			"LM358",
			"LM358N",
			"LM358P"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"pinout": [
				"OUT_B",
				"IN_B_MINUS",
				"IN_B_PLUS",
				"VEE",
				"IN_A_PLUS",
				"IN_A_MINUS",
				"OUT_A",
				"VCC"
			],
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						2,
						1,
						0
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						4,
						5,
						6
					]
				}
			]
		}
	},

// Mitsubishi M5218L, from "MITSUBISHI <LINEAR ICs> M5218L, P, FP / M5R4558P - DUAL LOW-NOISE
	// OPERATIONAL AMPLIFIERS (DUAL POWER SUPPLY TYPE)", databook pages 2-50 to 2-54. The scan
	// carries no document number or date; its pin-configuration box labels the SIP outline
	// "8P5 (M5218L)", which is what identifies it as the plain-L document rather than the separate
	// M5218AL/P/FP one. Electrical characteristics at Ta = 25 C, Vcc = +/-15 V:
	//
	//   Gvo  Open loop voltage gain  RL >= 2 kOhm, VO = +/-10 V   Min 86   Typ 110   dB
	//
	// **The A grade was checked rather than assumed away.** M5218L and M5218AL are separate
	// documents, and the corpus says plain L. Compared row by row, the two publish the same Gvo and
	// differ in slew rate (2.2 vs 3.0 V/us) -- so this is the L's own figure, not the AL's borrowed,
	// and the distinction was worth confirming even though it did not move the number.
	// `parts/op-amps/5218.md` independently records "A_OL | 110 dB typ, 86 dB min" for the family.
	//
	// Registered with a neutral null pinout to support all dual op-amp spelling variations flawlessly!
// Section indices CROSS-CHECKED 2026-09-05 against boss-ch-1's own terminal names, which declare the pin functions: section 0 = pin3 IN_A_PLUS / pin2 IN_A_MINUS / pin1 OUT_A, section 1 = pin5 IN_B_PLUS / pin6 IN_B_MINUS / pin7 OUT_B. That is the standard dual op-amp DIP-8 layout and the entry matches it. The binding is correct; what is missing is a machine-checkable assertion, which is what unverified-pinout-binding reports.
	{
		"partIds": [
			"M5218AL",
			"M5218AP",
			"M5218AFP",
			"M5218A",
			"M5218L",
			"M5218P",
			"M5218FP",
			"M5218",
			"M5216AL",
			"M5216AP",
			"M5216AFP",
			"M5216A",
			"M5216L",
			"M5216P",
			"M5216FP",
			"M5216",
			"M5281AL",
			"M5281AP",
			"M5281AFP",
			"M5281A",
			"M5281L",
			"M5281P",
			"M5281FP",
			"M5281"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 316227.7660168379
					},
					"terminals": [
						2,
						1,
						0
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 316227.7660168379
					},
					"terminals": [
						4,
						5,
						6
					]
				}
			],
			"pinout": [
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null
			]
		}
	},

// Mitsubishi M5223L, from the artifacts library's vendored page scans
	// `parts/op-amps/M5223AL/datasheets/m5223al-page-{1,2}.png` -- which are, despite that directory
	// name, the "MITSUBISHI ICs (AV COMMON) M5223L/P/FP - DUAL SINGLE POWER SUPPLY OPERATIONAL
	// AMPLIFIERS" document, databook pages 2-475 to 2-479 (page 1's header and its "Outline 8P5 (L)"
	// pin box both say M5223L/P/FP). Electrical characteristics, Ta = 25 C:
	//
	//   Gvo  Open loop voltage gain  RL >= 2 kOhm, VCM = 7.5 V   Min 90   Typ 100   dB
	//
	// Corroborated on page 1's own feature line, "High voltage gain ... Gvo=100dB(typ.)", and by
	// `parts/op-amps/M5223AL.md`'s "A_OL typ | 100 k typ, 31.6 k min" -- 100 k is 100 dB and 31.6 k
	// is 90 dB, the same two numbers in the other unit.
	//
	// **One printed condition is internally inconsistent and is not being silently repaired.** That
	// table's heading reads `Vcc=+5V`, while the same table states VOH 12.0 min / 13.5 typ V and a
	// common-mode range to +13.5 V, and the facing gain-vs-frequency graph is plotted at Vcc = 15 V
	// and 30 V. The heading is very likely a databook typo for +15 V. It does not touch what is
	// transcribed here: the gain figure is stated twice in the document and agrees with itself.
	{
		"partIds": [
			"M5223L",
			"M5223P",
			"M5223FP",
			"M5223"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"pinout": [
				"OUT_A",
				"IN_A_MINUS",
				"IN_A_PLUS",
				"VEE",
				"IN_B_PLUS",
				"IN_B_MINUS",
				"OUT_B",
				"VCC"
			],
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						2,
						1,
						0
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						4,
						5,
						6
					]
				}
			]
		}
	},

// TL022C, from `parts/op-amps/TL022/datasheets/ti-tl022.pdf` (TI "TL022C, TL022M - DUAL
	// LOW-POWER OPERATIONAL AMPLIFIERS", SLOS076, September 1973, revised September 1990), recorded
	// in `parts/op-amps/TL022.md`. Electrical characteristics at VCC = +/-15 V, TA = 25 C, in the
	// TL022C column and not the military TL022M one beside it:
	//
	//   Large-signal differential voltage amplification  AVD  RL >= 10 kOhm, VO = +/-10 V
	//                                                         MIN 60 dB   TYP 80 dB
	//
	// 80 dB is 10^(80/20) = 10,000 -- **a tenth of the 4558s above and a tenth of the class
	// default**, which is the whole reason a registry beats a default here. The TL022 is a
	// micropower part: 130 uA for both amplifiers, and it buys that with open-loop gain.
	//
	// Registered with a neutral null pinout to support both pin-numbered layouts (like boss-ce-2b)
	// and section-grouped layouts (like boss-bf-2) flawlessly!
	//
	// Supply current, same table: ICC 130 uA TYP (250 uA MAX) for both amplifiers, VO = 0, no load.
	{
		"partIds": [
			"TL022CP",
			"TL022CD",
			"TL022C",
			"TL022",
			"TL022CN"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"quiescentSupplyAmps": 130e-6,
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 10000
					},
					"terminals": [
						2,
						1,
						0
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 10000
					},
					"terminals": [
						4,
						5,
						6
					]
				}
			],
			"pinout": [
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null
			]
		}
	},

// Harris CA1458, in "CA741, CA741C, CA1458, CA1558, LM741, LM741C, LM1458, LM1558 - High Gain
	// Single and Dual Operational Amplifiers", File Number 531.2, March 1993. Electrical
	// Specifications For Equipment Design, V+/- = +/-15 V, limits column "CA741C, CA1458":
	//
	//   Open Loop Differential Voltage Gain  AOL  RL >= 2 kOhm, VO = +/-10 V, +25 C
	//                                             MIN 20,000   TYP 200,000   V/V
	//
	// The datasheet's note 1 on that column reads "Values Apply for Each Section of the Dual
	// Amplifiers", so 200,000 is per section rather than per package. The adjacent CA741/CA1558
	// column states MIN 50,000 for the same row and is **not** this part.
	//
	// The only entry here with no artifacts-library packet behind it: `parts/op-amps/` carries
	// `LM1458.md` and `MC1458.md` but no CA1458. Those are the neighbouring point not to jump to --
	// TI's LM1458 publishes 160 V/mV typ and Motorola's MC1458 200 k typ for the same row, so a
	// 1458 is not one number and this had to come from the document that names CA1458.
	{
		"partIds": [
			"CA1458",
			"CA1458E",
			"CA1458T"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"pinout": [
				"out_a",
				"inverting_a",
				"noninverting_a",
				"vminus",
				"noninverting_b",
				"inverting_b",
				"out_b",
				"vplus"
			],
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 200000
					},
					"terminals": [
						2,
						1,
						0
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 200000
					},
					"terminals": [
						4,
						5,
						6
					]
				}
			]
		}
	},

// Rohm BA718, from the manufacturer datasheet ("Dual Operational Amplifiers BA718 BA728
	// BA728F", ROHM), Fig. 4's BA718 9-pin SIP block diagram and pin row, which states pin 1
	// through 9 as: VCC, VOUT(1ch), I1, IN1, VEE, IN2, I2, VOUT(2ch), VCC. Electrical
	// characteristics (Ta=25C, VCC=6V, VEE=-6V): "Large signal voltage gain Av ... Min 86 Typ
	// 100 ... dB". Used as `openLoopGain: decibelGain(100)`, the typ figure, matching this
	// file's convention for the other op-amps above.
	//
	// `boss-cs-3.vdsp`'s `IC4` declares only 5 of the real 9 pins, named plainly `pin1`
	// through `pin5` (no suffix, so `terminalRoleToken` folds every one of them to `null` --
	// this entry cannot be pinout-guarded, the same bound `identify.ts` documents for a part
	// numbered `pin1..pinN`). Declaration order there is sequential ascending pin number, the
	// same convention verified for the NE570 entry above: `pin1`=idx0 through `pin5`=idx4. Read
	// against the real 9-pin table, that is exactly channel 1's five pins in order -- VCC, OUT1,
	// I1 (the inverting/feedback node), IN1, VEE -- a self-contained single-op-amp capture of
	// the chip's first section, with channel 2's pins 6-9 simply absent from this component.
	// Only the three audio terminals matter to `ideal-opamp`; VCC/VEE are not read (rails come
	// from the circuit's own supply set, same as every other entry here).
	{
		"partIds": [
			"BA718"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						3,
						2,
						1
					]
				}
			],
			"pinout": [
				null,
				null,
				null,
				null,
				null
			]
		}
	},

// --- Reticon bucket-brigade delay memory --------------------------------------------------
	//
	// EG&G Reticon SAD-512D / SAD-1024. `modelId` names the algorithm and not the chip, so this
	// is the same `bucket-brigade-delay-line` an MN3007 would name; what a registry adds is the
	// part's own boundary numbers. Both impedances below are stated with their provenance and
	// their residual, because one is a representation limit and the other is a cited figure the
	// datasheet disagrees with itself about, and a reader of this entry needs both facts without
	// re-deriving them.
	//
	// **`input: 1e9` is a representation limit, not a measurement.** The Reticon datasheet
	// publishes the input as a *capacitance* -- 7 pF typ, recorded in
	// `artifacts/parts/delay-oscillators/SAD1024.md` -- and `audioPortImpedanceOhms` has no way to
	// say that. What the resistive stamp can honestly claim is that it is negligible, and that
	// was measured rather than asserted: the port's effect is a shunt divider against the
	// driver's own source impedance, so its error falls as `1/Rin`, reaching the 2% level
	// tolerance `GAIN_AGREEMENT_TOLERANCE` uses only when `Rin` comes within ~50x of the driver.
	// On the one corpus packet this entry reaches, every value from 1e8 upward renders within
	// 5e-5 relative of the open-circuit limit. What it therefore cannot model is the *frequency
	// dependence* a real capacitive input has: 7 pF is 1.14 MOhm at 20 kHz, so a real BBD input
	// rolls off treble against a stiff driver and this stamp does not.
	//
	// **`output: 400` is the datasheet's own figure, and the datasheet disagrees with itself.**
	// EG&G Reticon SAD-1024, page 2, beside Figure 6: "The data indicate the output source
	// followers have approximately 400 ohms internal impedance." Its own Figure 6 curve, though,
	// reads gain 0.65 at RL = 1 kOhm and 1.25 at 20 kOhm, and fitting `A*RL/(RL+Ro)` to those two
	// points gives Ro ~= 1 kOhm -- about 2.5x the printed number. **So 400 is an
	// order-of-magnitude statement, not a calibrated parameter.** Measured on
	// `electro-harmonix-electric-mistress`, the 400 Ohm / 1 kOhm ambiguity is 6.3% of wet level
	// (0.53 dB), against 52% for the unsourced 100 Ohm..10 kOhm prior this replaces -- the
	// citation collapses the interval eightfold rather than settling it, and 0.53 dB is the
	// residual this entry ships with.
	//
	// This is the chip's *internal* source-follower impedance and nothing else. It is not the
	// external load: Reticon's own output configuration terminates each output into 1 kOhm, and
	// where a packet declares such a resistor it is already an ordinary conductance stamp in the
	// MNA system. Putting a load resistance here would double-count it.
	//
	// `SAD512D` shares the entry because it shares the algorithm and the boundary; the two differ
	// in stage count, which no longer appears here -- the delay time is a property of the pedal's
	// clocking and comes from the source (see `resolveMacro`).
	//
	// **The dual-tap topology is expressed through `audioOut2` now, not collapsed to one port.**
	// An earlier version of this comment defended driving only ODD OUT, because adding `evenout`
	// as a second `audioOut` alias would make `terminalWithRole` see two matches and refuse the
	// part. That constraint was real and the conclusion was wrong anyway: an undriven second tap
	// turns the external recovery network into a stub -- measured on `mxr-carbon-copy`'s balance
	// trimmers as 6 dB lost across four brigades, and on `mxr-micro-flanger` as R18 carrying no
	// current at all. The separate `audioOut2` port (see the SAD512D entry below and the
	// MN3208/MN3009 entries) resolves the second tap without the alias collision.
	// --- Generic Delay-Memory Chip Macro (Interchange Compatibility / Grey-box Fallback) ------
	{
		"partIds": [
			"DELAY_MEMORY_CHIP",
			"CIRCUIT.DELAYMEMORYCHIP"
		],
		"declaredTypes": [
			"Circuit.DelayMemoryChip"
		],
		"terminalRoleGroups": [],
		"model": {
			"kind": "macro",
			"macro": {
				"modelId": "bucket-brigade-delay-line",
				"parameters": {
					"stages": 1024
				},
				"ports": {
					"audioIn": [
						"input",
						"in",
						"sig_in",
						"signalin",
						"signal_in",
						"1",
						"pin1"
					],
					"audioOut": [
						"output",
						"out",
						"sig_out",
						"signalout",
						"signal_out",
						"2",
						"pin2"
					],
					"parameter": []
				},
				"barePinPositions": {
					"audioIn": 0,
					"audioOut": 1
				},
				"audioPortImpedanceOhms": {
					"input": 1000000000,
					"output": 400
				},
				"parameterReferenceVolts": 9
			}
		}
	},

// --- Active Physical Bucket Brigade Devices (MN3007 P-channel PMOS) --------------------------------------------------------
	// Source: Panasonic MN3007 1024-Stage Low Noise BBD datasheet, Page 1.
	{
		"partIds": [
			"MN3007"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"gnd",
				"v-",
				"vss",
				"ground",
				"pin1"
			],
			[
				"clk1",
				"cp1",
				"clock1",
				"phi1",
				"pin2"
			],
			[
				"in",
				"input",
				"sin",
				"signalin",
				"pin3"
			],
			[
				"vgg",
				"bias",
				"pin4"
			],
			[
				"vdd",
				"v+",
				"vcc",
				"power",
				"pin5"
			],
			[
				"clk2",
				"cp2",
				"clock2",
				"phi2",
				"pin6"
			],
			[
				"out1",
				"output1",
				"outa",
				"outputa",
				"pin7"
			],
			[
				"out2",
				"output2",
				"outb",
				"outputb",
				"pin8"
			]
		],
		"model": {
			"kind": "macro",
			"macro": {
				"modelId": "bucket-brigade-delay-line",
				"parameters": {
					"stages": 1024
				},
				"ports": {
					"audioIn": [
						"in",
						"input",
						"sin",
						"signalin",
						"pin3"
					],
					"audioOut": [
						"out",
						"output",
						"out1",
						"output1",
						"outa",
						"outputa",
						"pin7"
					],
					"audioOut2": [
						"out2",
						"output2",
						"outb",
						"outputb",
						"pin8"
					],
					"parameter": []
				},
				"barePinPositions": {
					"audioIn": 2,
					"audioOut": 6
				},
				"audioPortImpedanceOhms": {
					"input": 1000000000,
					"output": 400
				},
				"parameterReferenceVolts": 9
			}
		}
	},

// --- Active Physical Bucket Brigade Devices (MN3207, BL3207 N-channel NMOS) --------------------------------------------------------
	// Source: Panasonic MN3207 / Belling BL3207 1024-Stage Low Voltage BBD datasheet, Page 1.
	{
		"partIds": [
			"MN3207",
			"BL3207"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"vgg",
				"bias",
				"pin1"
			],
			[
				"clk1",
				"cp1",
				"clock1",
				"phi1",
				"pin2"
			],
			[
				"clk2",
				"cp2",
				"clock2",
				"phi2",
				"pin3"
			],
			[
				"gnd",
				"v-",
				"vss",
				"ground",
				"pin4"
			],
			[
				"out",
				"output",
				"out1",
				"output1",
				"outa",
				"outputa",
				"pin5"
			],
			[
				"out2",
				"output2",
				"outb",
				"outputb",
				"pin6"
			],
			[
				"vdd",
				"v+",
				"vcc",
				"power",
				"pin7"
			],
			[
				"in",
				"input",
				"sin",
				"signalin",
				"pin8"
			]
		],
		"model": {
			"kind": "macro",
			"macro": {
				"modelId": "bucket-brigade-delay-line",
				"parameters": {
					"stages": 1024
				},
				"ports": {
					"audioIn": [
						"in",
						"input",
						"sin",
						"signalin",
						"pin8"
					],
					"audioOut": [
						"out",
						"output",
						"out1",
						"output1",
						"outa",
						"outputa",
						"pin5"
					],
					"audioOut2": [
						"out2",
						"output2",
						"outb",
						"outputb",
						"pin6"
					],
					"parameter": []
				},
				"barePinPositions": {
					"audioIn": 7,
					"audioOut": 4
				},
				"audioPortImpedanceOhms": {
					"input": 1000000000,
					"output": 400
				},
				"parameterReferenceVolts": 9
			}
		}
	},

// --- Active Physical BBD Clock Drivers (MN3101, MN3102) ----------------------------------------------------------------------
	// Source: Panasonic MN3101 datasheet p.3, "Terminal Assignments" diagram and the "Terminal
	// Description" table below it, which agree with each other pin for pin:
	//   1 GND, 2 CP1, 3 VDD, 4 CP2, 5 OX3, 6 OX2, 7 OX1, 8 VGG OUT
	// The entry previously carried 1 VDD / 3 GND / 5 VGG / 8 OX3 -- two swapped pairs. That put
	// the VGG output where the third oscillator terminal lives, so no MN3101 packet in the corpus
	// could expose more than two of its three OX pins, and the star oscillator below could not be
	// recognised at all. Note the polarity: the part runs on a single negative supply (VDD -8..-16 V,
	// GND = 0 V), so a +9 V pedal ties the part's GND pin to +9 V and its VDD pin to circuit ground.
	// The pin names stay the datasheet's; the inversion is the pedal's.
	//
	// Supply current from the same datasheet's p.2 "Electrical Characteristics" (Ta = 25 C,
	// VDD = -15 V, GND = 0 V): input drain current IDD 3 mA TYP, no load, clock output 40 kHz
	// (Ptot 45 mW). That condition is a 15 V supply at one clock rate; a CMOS driver's current
	// scales with both, and the datasheet prints no other point, so the TYP is taken as stated.
	{
		"partIds": [
			"MN3101"
		],
		"declaredTypes": [],
		"quiescentSupplyAmps": 3e-3,
		"terminalRoleGroups": [
			[
				"gnd",
				"v-",
				"vss",
				"pin1",
				"gndpin1"
			],
			[
				"cp1",
				"clk1",
				"clock1",
				"phi1",
				"pin2",
				"cp1pin2"
			],
			[
				"vdd",
				"v+",
				"vcc",
				"pin3",
				"vddpin3"
			],
			[
				"cp2",
				"clk2",
				"clock2",
				"phi2",
				"pin4",
				"cp2pin4"
			],
			[
				"ox3",
				"osc3",
				"oscctrl",
				"pin5",
				"ox3pin5"
			],
			[
				"ox2",
				"osc2",
				"oscout",
				"pin6",
				"ox2pin6"
			],
			[
				"ox1",
				"osc1",
				"oscin",
				"osc",
				"pin7",
				"ox1pin7"
			],
			[
				"vgg",
				"vggout",
				"pin8",
				"vggoutpin8"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "clock-driver",
						"defaultFrequency": 10000
					},
					"terminals": [
						1,
						3,
						7,
						2,
						6,
						0
					]
				}
			],
			"pinout": [
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null
			]
		}
	},

// Source: Panasonic MN3102 CMOS Clock Generator Driver for Low Voltage BBD datasheet, Page 1-2.
	// Standard 8-pin DIP: Pin 1 (GND), Pin 2 (CP1), Pin 3 (VDD), Pin 4 (CP2), Pin 5 (VGG), Pin 6 (OX2), Pin 7 (OX1), Pin 8 (VBB/NC)
	// Or Pin 1 (VDD), Pin 2 (CP1), Pin 3 (GND), Pin 4 (CP2), Pin 5 (OX3), Pin 6 (OX2), Pin 7 (OX1), Pin 8 (VGG/VBB)
	{
		"partIds": [
			"MN3102"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"gnd",
				"v-",
				"vss",
				"pin1",
				"vdd",
				"v+",
				"vcc",
				"vddpin1",
				"gndpin1"
			],
			[
				"cp1",
				"clk1",
				"clock1",
				"phi1",
				"pin2",
				"cp1pin2"
			],
			[
				"vdd",
				"v+",
				"vcc",
				"pin3",
				"gnd",
				"v-",
				"vss",
				"gndpin3",
				"vddpin3"
			],
			[
				"cp2",
				"clk2",
				"clock2",
				"phi2",
				"pin4",
				"cp2pin4"
			],
			[
				"vgg",
				"vggout",
				"ox3",
				"osc3",
				"oscctrl",
				"clockcontrol",
				"pin5",
				"ox3pin5",
				"vggoutpin5"
			],
			[
				"ox2",
				"osc2",
				"oscout",
				"oscillatoroutput",
				"pin6",
				"ox2pin6"
			],
			[
				"ox1",
				"osc1",
				"oscin",
				"osc",
				"oscillatorinput",
				"pin7",
				"ox1pin7"
			],
			[
				"vbb",
				"nc",
				"vgg",
				"vggout",
				"biasoutput",
				"pin8",
				"vggoutpin8",
				"vbbpin8"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "clock-driver",
						"defaultFrequency": 10000
					},
					"terminals": [
						1,
						3,
						4,
						2,
						6,
						0
					]
				}
			],
			"pinout": [
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null
			]
		}
	},

// --- SCL4043A CMOS quad R-S latch (slapback-echo BBD clock/control logic) ---------------------------------------------------
	//
	// `electro-harmonix-slapback-echo.vdsp`'s IC3 (`PartNumber: SCL4043A`) is a 14-pin CMOS
	// quad 3-stage R-S latch (R-E International / Solid State Scientific SCL4043 family) that the
	// source declares as "clock/control logic primitive between UJT/BJT clock support and
	// SAD1024A pins": it shapes the oscillator into the BBD clock and is NOT on the audio path.
	// The audio path is the SAD1024A (modelled below as a bucket-brigade delay line), so this
	// control-logic IC is admitted as a non-executable support shell (empty sections) -- the same
	// treatment the BBD clock drivers above get, where the BBD macro owns the delay parameter and
	// the latch logic is not solved.
	{
		"partIds": [
			"SCL4043A",
			"SCL4043",
			"SCL4043B",
			"SCL4044A",
			"SCL4044B"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [],
			"pinout": [
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null
			]
		}
	},

// --- Reticon SAD1024 / SAD1024A Dual 512-Stage BBD (1024 stages total) --------------------
	// Source: Reticon SAD-1024 / SAD-1024A Dual 512-Stage Analog Delay Line datasheet,
	// Section "General Description" / Table 1 (two 512-stage serial/parallel sections = 1024 total stages).
	{
		"partIds": [
			"SAD1024A",
			"SAD1024"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"in",
				"input",
				"inputa",
				"ina"
			],
			[
				"out",
				"out1",
				"output",
				"outputa"
			],
			[
				"cp1",
				"cp",
				"clock",
				"phi1",
				"phi1a"
			]
		],
		"model": {
			"kind": "macro",
			"macro": {
				"modelId": "bucket-brigade-delay-line",
				"parameters": {
					"stages": 1024
				},
				"ports": {
					"audioIn": [
						"in",
						"input",
						"inputa",
						"ina"
					],
					"audioOut": [
						"out",
						"out1",
						"output",
						"outputa"
					],
					"parameter": [
						"cp1",
						"cp",
						"clock",
						"phi1",
						"phi1a"
					],
					// The two 512-stage sections chain when the document ties the first's output to the
					// second's input (the EH-4700 does: pins 5 and 15 share one node). The 1024 stages
					// are then read at the second section's output, pin 12.
					"cascade": {
						"sectionOut": [
							"outputa"
						],
						"nextIn": [
							"inputb"
						],
						"finalOut": [
							"outputb"
						]
					}
				},
				"barePinPositions": {
					"audioIn": 1,
					"audioOut": 11,
					"parameter": 7
				},
				"audioPortImpedanceOhms": {
					"input": 1000000000,
					"output": 400
				},
				"parameterReferenceVolts": 9
			}
		}
	},

// --- Reticon SAD512D 512-stage BBD --------------------------------------------------------
	// Source: Reticon SAD-512D 512-Stage Analog Delay Line datasheet, Page 1 ("General Description").
	{
		"partIds": [
			"SAD512D"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"in",
				"input",
				"inputa",
				"ina"
			],
			[
				"out",
				"out1",
				"output",
				"outputa",
				"oddout"
			],
			[
				"cp1",
				"cp",
				"clock",
				"phi1",
				"phi1a"
			]
		],
		"model": {
			"kind": "macro",
			"macro": {
				"modelId": "bucket-brigade-delay-line",
				"parameters": {
					"stages": 512
				},
				"ports": {
					"audioIn": [
						"in",
						"input",
						"inputa",
						"ina"
					],
					"audioOut": [
						"out",
						"out1",
						"output",
						"outputa",
						"oddout"
					],
					"parameter": [
						"cp1",
						"cp",
						"clock",
						"phi1",
						"phi1a"
					]
				},
				"audioPortImpedanceOhms": {
					"input": 1000000000,
					"output": 400
				},
				"parameterReferenceVolts": 9
			}
		}
	},

// --- Panasonic MN3008 2048-stage BBD ------------------------------------------------------
	// Source: Panasonic MN3008 2048-Stage Low Noise BBD datasheet, Page 1.
	// deluxe-memory-man numbers its 8 pins (`pin1`..`pin8`, no role tokens) and resolves by the
	// positions below (datasheet: GND=1, CP2=2, OUT1=3, OUT2=4, VDD=5, CP1=6, IN=7, VGG=8).
	// A bare-pin document and a role-named document are the same part, so one entry serves both.
	{
		"partIds": [
			"MN3008"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"in",
				"in7",
				"pin7"
			],
			[
				"out1",
				"out1pin3",
				"pin3"
			],
			[
				"cp1",
				"pin6"
			]
		],
		"model": {
			"kind": "macro",
			"macro": {
				"modelId": "bucket-brigade-delay-line",
				"parameters": {
					"stages": 2048
				},
				"ports": {
					"audioIn": [
						"in",
						"in7",
						"pin7"
					],
					"audioOut": [
						"out1",
						"out1pin3",
						"pin3"
					],
					"parameter": [
						"cp1",
						"pin6"
					]
				},
				"barePinPositions": {
					"audioIn": 6,
					"audioOut": 2,
					"parameter": 5
				},
				"audioPortImpedanceOhms": {
					"input": 1000000000,
					"output": 400
				},
				"parameterReferenceVolts": 3
			}
		}
	},

// --- Panasonic MN3005 4096-stage P-channel BBD --------------------------------------------
	// Source: Panasonic MN3005 4096-Stage Low Noise BBD datasheet, Page 1.
	// EH7550 Memory Man Deluxe uses four MN3005 BBDs in cascade. Same 8-lead DIP layout as
	// the MN3008 above (GND=1, CP2=2, OUT1=3, OUT2=4, VDD=5, CP1=6, IN=7, VSS=8).
	{
		"partIds": [
			"MN3005"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"in",
				"input",
				"in7",
				"pin7"
			],
			[
				"out1",
				"output",
				"out1pin3",
				"pin3"
			],
			[
				"cp1",
				"clock",
				"pin6"
			]
		],
		"model": {
			"kind": "macro",
			"macro": {
				"modelId": "bucket-brigade-delay-line",
				"parameters": {
					"stages": 4096
				},
				"ports": {
					"audioIn": [
						"in",
						"input",
						"in7",
						"pin7"
					],
					"audioOut": [
						"out1",
						"output",
						"out1pin3",
						"pin3"
					],
					"parameter": [
						"cp1",
						"clock",
						"pin6"
					]
				},
				"barePinPositions": {
					"audioIn": 6,
					"audioOut": 2,
					"parameter": 5
				},
				"audioPortImpedanceOhms": {
					"input": 1000000000,
					"output": 400
				},
				"parameterReferenceVolts": 9
			}
		}
	},

// --- Panasonic MN3208 / Belling BL3208 2048-stage low-voltage BBD -------------------------
	// Source: Panasonic MN3208 / Belling BL3208 2048-Stage Low Voltage BBD datasheet, Page 1.
	{
		"partIds": [
			"MN3208",
			"MN3208A",
			"BL3208",
			"BL3208A"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"in",
				"input",
				"sin",
				"signalin",
				"inputa",
				"ina"
			],
			[
				"out",
				"out1",
				"output",
				"output1",
				"outa",
				"outputa",
				"oddout"
			],
			[
				"cp1",
				"cp",
				"clock",
				"clk",
				"clock1",
				"phi1",
				"phi1a"
			]
		],
		"model": {
			"kind": "macro",
			"macro": {
				"modelId": "bucket-brigade-delay-line",
				"parameters": {
					"stages": 2048
				},
				"ports": {
					"audioIn": [
						"in",
						"input",
						"sin",
						"signalin",
						"inputa",
						"ina"
					],
					"audioOut": [
						"out",
						"out1",
						"output",
						"output1",
						"outa",
						"outputa",
						"oddout"
					],
					"audioOut2": [
						"out2",
						"outb",
						"outputb",
						"output2",
						"evenout"
					],
					"parameter": [
						"cp1",
						"cp",
						"clock",
						"clk",
						"clock1",
						"phi1",
						"phi1a"
					]
				},
				"audioPortImpedanceOhms": {
					"input": 1000000000,
					"output": 400
				},
				"parameterReferenceVolts": 9
			}
		}
	},

// --- Panasonic MN3009 256-stage BBD -------------------------------------------------------
	// Source: Panasonic MN3009 256-Stage Low Noise BBD datasheet, Page 1.
	{
		"partIds": [
			"MN3009"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"in",
				"input",
				"sin",
				"signalin",
				"inputa",
				"ina"
			],
			[
				"out",
				"out1",
				"output",
				"output1",
				"outa",
				"outputa",
				"oddout"
			],
			[
				"cp1",
				"cp",
				"clock",
				"clk",
				"clock1",
				"phi1",
				"phi1a"
			]
		],
		"model": {
			"kind": "macro",
			"macro": {
				"modelId": "bucket-brigade-delay-line",
				"parameters": {
					"stages": 256
				},
				"ports": {
					"audioIn": [
						"in",
						"input",
						"sin",
						"signalin",
						"inputa",
						"ina"
					],
					"audioOut": [
						"out",
						"out1",
						"output",
						"output1",
						"outa",
						"outputa",
						"oddout"
					],
					"audioOut2": [
						"out2",
						"outb",
						"outputb",
						"output2",
						"evenout"
					],
					"parameter": [
						"cp1",
						"cp",
						"clock",
						"clk",
						"clock1",
						"phi1",
						"phi1a"
					]
				},
				"audioPortImpedanceOhms": {
					"input": 1000000000,
					"output": 400
				},
				"parameterReferenceVolts": 9
			}
		}
	},

// --- Panasonic MN3002 512-stage BBD -------------------------------------------------------
	// Source: Panasonic MN3002 512-Stage BBD datasheet, Page 1.
	{
		"partIds": [
			"MN3002"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"inpin3",
				"in",
				"pin3"
			],
			[
				"out1pin13",
				"out1",
				"pin13"
			]
		],
		"model": {
			"kind": "macro",
			"macro": {
				"modelId": "bucket-brigade-delay-line",
				"parameters": {
					"stages": 512
				},
				"ports": {
					"audioIn": [
						"inpin3",
						"in",
						"pin3"
					],
					"audioOut": [
						"out1pin13",
						"out1",
						"pin13"
					],
					"parameter": [
						"cp1",
						"cp",
						"clock",
						"clk",
						"clock1",
						"phi1",
						"phi1a",
						"cp2"
					]
				},
				"audioPortImpedanceOhms": {
					"input": 1000000000,
					"output": 400
				},
				"parameterReferenceVolts": 9
			}
		}
	},

// --- Panasonic MN3205 4096-stage low-voltage BBD ------------------------------------------
	// Source: Panasonic MN3205 4096-Stage Low Voltage BBD datasheet, Page 1.
	{
		"partIds": [
			"MN3205"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"inpin7",
				"in",
				"pin7"
			],
			[
				"out1pin3",
				"out1",
				"pin3"
			]
		],
		"model": {
			"kind": "macro",
			"macro": {
				"modelId": "bucket-brigade-delay-line",
				"parameters": {
					"stages": 4096
				},
				"ports": {
					"audioIn": [
						"inpin7",
						"in",
						"pin7"
					],
					"audioOut": [
						"out1pin3",
						"out1",
						"pin3"
					],
					"parameter": [
						"cp1",
						"cp",
						"clock",
						"clk",
						"clock1",
						"phi1",
						"phi1a",
						"cp2"
					]
				},
				"audioPortImpedanceOhms": {
					"input": 1000000000,
					"output": 400
				},
				"parameterReferenceVolts": 9
			}
		}
	},

// --- Princeton PT2399 digital delay core --------------------------------------------------
//
// `sections-core`: the chip's silicon holds two filter op-amps around the sampled core, so the
// entry carries both. Signal order, Princeton PT2399 datasheet V1.9 (Mar 2022) pin table,
// identical in V1.1/V1.2/V1.4/V1.6, with the loop roles from the ElectroSmash PT2399 analysis
// §4.1/§4.2: pin 16 -> LPF1 (input MFB summer over the external mix network, where the
// Echo feedback also sums) -> pin 15, which
// internally feeds the ADC delta-sigma loop (integrator C3 across OP1 pins 9-10); the DAC feeds
// the committed demodulator LPF (C6 across OP2 pins 11-12) whose output is OP2 = pin 12. The
// page's input-stage and internal-circuit figures draw an internal 4.7 kΩ on both integrators,
// pins 9-10 and 11-12 (page authority, neither datasheet states it); pin 13 -> LPF2 (output
// MFB) -> pin 14.
//
// Section choices, each cited:
// - LPF1/LPF2 as `ideal-opamp` sections on [pin-2 bias, pin-in, pin-out]: the MFB
//   networks span those pins in both the Princeton echo application circuit (v1.1
//   p.3 figure: input -> 4.7uF -> 15k -> mix node; pin 16 -> 10k -> mix; pin 15 ->
//   10k -> mix; 560 pF across 16/15; 3900 pF mix shunt) and the Rebote copy of it
//   (600 dpi read of rebote-delay-schematic.pdf: same island, with the input load
//   as 56k and a second series 4.7uF ahead of the 15k). Pin 16 touches only the
//   560 pF and its 10k arm; the 56k loads the input line, never the op-amp input.
//   openLoopGain 100000 is the house ideal-opamp value,
//   not a PT2399 measurement; rails come from the pedal's own supply pins as always.
// - Non-inverting inputs on the pin-2 node: the MFB stages need mid-rail at +, and pin 2 is
//   the chip's VREF output (datasheet: REF = 1/2 VCC), so this is connectivity, not invention.
// - The internal Vcc/2 divider as two `conductance` sections, pin 1 -> pin 2 -> AGND: the page's
//   §3 "Pin2" cites an internal divider with about 6 kΩ measured pin resistance, and the
//   datasheet fixes the ratio at 1/2 VCC. Cited: 6 kΩ Thevenin and the 1/2 ratio. Inferred:
//   the equal split, i.e. 12 kΩ + 12 kΩ (the only split with both). The packet's own 47 µF on
//   pin 2 then decouples a driven reference instead of floating on an undriven pin.
// - Core audioIn at pin 15 (the ADC samples the LPF1 output; the Echo feedback sums
//   at the external mix network ahead of pin 16 and reaches the core through LPF1,
//   so sampling at pin 15 captures dry plus feedback after LPF1's shaping, while
//   sampling anywhere earlier would tap pre-filter) and audioOut at pin 12 (the demodulator
//   op-amp's output pin): pin 13 was deliberately NOT chosen, because the real signal
//   crosses the 10k/15k network between nodes 10/11 and 8 on its way to LPF2, and driving
//   pin 13 would skip that network. C3/C6 stay MNA loads on their pins; their integrator
//   action is the core's inside, which is the stated approximation (same class as the
//   delta-sigma loop itself, which no entry models).
// - Terminal discovery reuses the existing folded-role/pinout channel (empirically:
//   pin16_LPF1_IN folds to `lpf1in` etc.); no new text matching. Section terminal indices
//   are declaration positions, valid where the document declares pin order, as the entry's
//   full pinout asserts position by position.
	{
		"firmware": {
			"firmwareClass": "fixed-function",
			"basis": [
				"The datasheet states the audio transfer as a function of external components: the on-chip VCO frequency, and therefore the delay time, is set by the pin-6 resistor.",
				"No CPU core is named anywhere in the family documentation -- an adaptive-delta modulator, internal RAM, an on-chip VCO and on-chip filter op-amps.",
				"Mask logic holding coefficients rather than an instruction stream; no program store and no load sequence."
			]
		},
		"partIds": [
			"PT2399",
			"PT2399S"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"pin16_lpf1_in",
				"lpf1in"
			],
			[
				"pin14_lpf2_out",
				"lpf2out"
			]
		],
		"model": {
			"kind": "sections-core",
			"pinout": [
				"vcc",
				"ref",
				"agnd",
				"dgnd",
				"clko",
				"vco",
				"cc1",
				"cc0",
				"op1out",
				"op1in",
				"op2in",
				"op2out",
				"lpf2in",
				"lpf2out",
				"lpf1out",
				"lpf1in"
			],
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						1,
						15,
						14
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						1,
						12,
						13
					]
				},
				{
					"law": {
						"kind": "conductance",
						"siemens": 0.00008333333333333333
					},
					"terminals": [
						0,
						1
					]
				},
				{
					"law": {
						"kind": "conductance",
						"siemens": 0.00008333333333333333
					},
					"terminals": [
						1,
						2
					]
				}
			],
			"core": {
				"modelId": "digital-delay-line",
				"parameters": {},
				"ports": {
					"audioIn": [
						"pin15_lpf1_out",
						"lpf1out"
					],
					"audioOut": [
						"pin12_op2_out",
						"op2out"
					],
					"parameter": [
						"pin6_vco",
						"vco",
						"pin6"
					]
				},
				"audioPortImpedanceOhms": {
					"input": 1000000000,
					"output": 100
				},
				"parameterReferenceVolts": 2.5
			}
		}
	},

// --- Accutronics/Belton BTDR-2 "Digi-Log" reverb brick -----------------------------------------
	//
	// Source: the Accutronics/Belton BTDR-2 datasheet page 1, read from
	// `pedals/belton-brick-reverb/schematics/belton-btdr-2-datasheet.pdf`. Every number below is
	// on that page:
	//
	//   Decay (T60):  S short 2.0 s   M medium 2.5 s   L long 2.85 s
	//   Voltage gain: -3 dB, stated "each output"
	//   Z_in 10 kOhm   Z_out 220 Ohm   V_in 1.5 V peak max   V_cc 5 V, I_cc 60 mA typ
	//   Pinout: 1 +5V, 2 Power GND, 3 Input, 4 Signal GND, 5 Output 2, 6 Output 1
	//
	// `belton-brick-reverb.vdsp` names its terminals `pin3_input`, `pin6_output_1`,
	// `pin5_output_2`, which `terminalRoleToken` folds to `input`, `output1`, `output2`, so this
	// resolves by role and needs no `barePinPositions`.
	//
	// **`decaySeconds` is the medium variant, and that is a choice the packet forces.** The
	// datasheet sells three decay lengths selected by a box ticked on the module's own label
	// (`S`/`M`/`L`), and `belton-brick-reverb` declares only `PartNumber: BTDR-2H` with no
	// variant. The three span 2.0-2.85 s, so the medium is at worst 0.5 s from the truth, and
	// naming it here keeps the number visible and citable instead of hidden in a kernel. A packet
	// that states its variant should override this rather than inherit it.
	//
	// `outputGain` is the datasheet's -3 dB as a ratio. `audioPortImpedanceOhms` are its stated
	// Z_in and Z_out, so unlike the MN-series entries above this part needs no estimate: Belton
	// published both.
	//
	// **What this model does not claim.** The datasheet gives decay, gain and impedances; it does
	// not give the internal topology, and the packet's own `BTDR2H` component records
	// `SourceTraceStatus: complete-pin-shell` with "Internal DSP/firmware is not present in the
	// packet". The runtime's `digital-reverb-module` is therefore a Schroeder reverberator whose
	// T60 is designed to the datasheet figure and whose level is the datasheet figure, with comb
	// and allpass lengths that are a modelling choice setting timbre and echo density. It renders
	// a reverb with this brick's published decay and level; it is not a capture of this brick's
	// own tail, and no measurement here can claim otherwise. See
	// `docs/troubleshootings/a-reverb-module-is-opened-silently-so-the-reverb-vanishes.md`.
	//
	// Registered for the BTDR-2 family only. BTDR-1 and BTDR-3 are different modules and this
	// datasheet does not cover them.
	{
		"partIds": [
			"BTDR-2H",
			"BTDR-2"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "macro",
			"macro": {
				"modelId": "digital-reverb-module",
				"parameters": {
					"decaySeconds": 2.5,
					"outputGain": 0.9205
				},
				"ports": {
					"audioIn": [
						"input",
						"in",
						"pin3"
					],
					"audioOut": [
						"output1",
						"out1",
						"pin6"
					],
					"audioOut2": [
						"output2",
						"out2",
						"pin5"
					],
					"parameter": []
				},
				"audioPortImpedanceOhms": {
					"input": 10000,
					"output": 220
				},
				"parameterReferenceVolts": null
			}
		}
	},

// --- Mitsubishi M50195P adaptive-delta digital echo LSI --------------------------------------------------
	//
	// A fixed-function digital echo, not an MCU/DSP: documented architecture, mask behaviour, no
	// reprogrammable or externally-borne program. That is what makes it a *model* rather than a
	// firmware asset (the artifacts ownership contract's digital-primitive rule): it is
	// runtime-modeled from its documented behaviour the way a BBD is, and it needs no binary. Its
	// 64Kx1 external DRAM (a 4164 in the Ibanez DL5) is the sample buffer behind the echo; the
	// kernel's own buffer represents it, so the DRAM is internal to this behaviour owner, not a
	// port. Identified by exact part id (the documents that use it name it), so this entry carries
	// no pinout signature: the superset guard would never match the LSI's full terminal set anyway.
	//
	// `modelId` names the algorithm, not the chip, exactly as the BBD entries do: this is the
	// `digital-delay-line` any other fixed-function digital echo would name. The audio boundary is
	// the LSI's own `SIN` (in) and `OP2_OUT` (the wet, post-echo tap) terminals; the dry/wet mix is
	// the pedal's analog shell, not the kernel. `CLK1` is the delay clock, carried as the
	// `parameter` port the same way a BBD carries its clock, so the pedal's D.Time network scales
	// the delay. The DL5 declares no `DelayMs`, so `resolveMacro` falls back to a safe 50 ms
	// buffer scaled by that clock -- never a delay time this document does not state.
	//
	// **`parameters.feedback` and the two impedances below are model defaults, not measured pedal
	// values.** The M50195P's repeat is set by the pedal's Repeat network (a panel pot in
	// parallel with a range trim), which is not a single pure node, so it cannot be read through
	// the `parameter` port the way the clock is; until a live feedback port exists this standing
	// level is what the kernel regenerates at. `input: 1e9` is the same open-circuit
	// representation limit the BBD entries carry, and `output` / `parameterReferenceVolts` are
	// standing model values. All three are calibrated against the DL5's packet-local
	// `output-recovery` and `repeat-level-mix` decks when that packet first compiles, not here.
	{
		"subsumesRefuted": [
			{
				"parts": ["4164"],
				"refutedBy": "scripts/report-subsumption-mutant.ts -- mutating IC4's part leaves feedback and delaySeconds identical",
				"on": "2026-09-11"
			}
		],
		"firmware": {
			"firmwareClass": "fixed-function",
			"basis": [
				"Adaptive-delta digital echo LSI with a documented transfer; the delay follows the clock network and the packet's declared parameters, not a program.",
				"No CPU core in the family documentation; carries the same `digital-delay-line` model as the PT2399, which the protocol names as a fixed-function example."
			]
		},
		"partIds": [
			"M50195P",
			"M50195"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "macro",
			"macro": {
				"modelId": "digital-delay-line",
				"parameters": {
					"feedback": 0.6
				},
				"ports": {
					"audioIn": [
						"sin"
					],
					"audioOut": [
						"op2out"
					],
					"parameter": [
						"clk1"
					]
				},
				"audioPortImpedanceOhms": {
					"input": 1000000000,
					"output": 1000
				},
				"parameterReferenceVolts": 5
			}
		}
	},

// --- 4164 64Kx1 DRAM, the external sample buffer behind an M50195P digital echo --------------------------
	//
	// The M50195P entry above owns the delay behaviour and its kernel already carries the sample
	// buffer, so this DRAM is internal to that behaviour owner, not a separately solved device.
	// It is registered `open` for the same reason a duplicate single-terminal divider is: giving
	// it a nontrivial law would stamp a second, invented memory on the same address/data nets
	// without any DRAM timing model this runtime carries.
	{
		"partIds": [
			"4164",
			"4164DRAM"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"firmware": {
			"firmwareClass": "fixed-function",
			"basis": [
				"64Kx1 DRAM storage array: retention of the address/data nets, no instruction stream",
				"No CPU core in the DRAM family documentation; the mask holds storage cells, not a program"
			]
		},
		"model": {
			"kind": "law",
			"law": {
				"kind": "open"
			}
		}
	},

// --- Operational Transconductance Amplifiers (OTAs) - CA3080, CA3094, LM13600, LM13700 ----------------------------------------
// CA3094 pinout verified against Intersil/RCA `CA3094, CA3094A, CA3094B` (30MHz, High Output Current OTA), Pinouts, PDIP/SOIC top view: pin1 ext. frequency compensation or inhibit, pin2/pin3 differential inputs, pin4 GND (V- in dual supply), pin5 I_ABC, pin6 drive output (emitter), pin7 V+, pin8 sink output (collector).
// Input polarity is conditional and the pinout diagram does not show it. The datasheet's output-mode table: output at terminal 6 makes pin2 inverting and pin3 non-inverting; output at terminal 8 swaps them, because the collector inverts what the emitter follows. The roles below are the terminal-6 reading. A circuit taking its output at pin 8 needs the inputs exchanged and must not use this entry unchanged.
// CA3080 and CA3094 share these five signal pins; the CA3094 adds an integral Darlington (pin6 emitter / pin8 collector) that the CA3080 does not have, so the two are not interchangeable beyond this mapping.
	{
		"partIds": [
			"CA3080",
			"CA3080E",
			"CA3094",
			"CA3094E"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"vin+",
				"in+",
				"pin3"
			],
			[
				"vin-",
				"in-",
				"pin2"
			],
			[
				"vout",
				"out",
				"pin6"
			],
			[
				"i_bias",
				"bias",
				"pin5"
			],
			[
				"v-",
				"vee",
				"pin4"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "ota",
						"transconductance": 0.001,
						"veeIndex": 4
					},
					"terminals": [
						0,
						1,
						2,
						3,
						4
					]
				}
			],
			"pinout": [
				"vin+",
				"vin-",
				"vout",
				"i_bias",
				"v-"
			]
		}
	},

	{
		"partIds": [
			"LM13600",
			"LM13700"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"vin+a",
				"in+a",
				"pin3"
			],
			[
				"vin-a",
				"in-a",
				"pin4"
			],
			[
				"vouta",
				"outa",
				"pin5"
			],
			[
				"i_biasa",
				"biasa",
				"pin1"
			],
			[
				"vin+b",
				"in+b",
				"pin14"
			],
			[
				"vin-b",
				"in-b",
				"pin13"
			],
			[
				"voutb",
				"outb",
				"pin12"
			],
			[
				"i_biasb",
				"biasb",
				"pin16"
			],
			[
				"v-",
				"vee",
				"pin6"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "ota",
						"transconductance": 0.001,
						"veeIndex": 4
					},
					"terminals": [
						0,
						1,
						2,
						3,
						8
					]
				},
				{
					"law": {
						"kind": "ota",
						"transconductance": 0.001,
						"veeIndex": 4
					},
					"terminals": [
						4,
						5,
						6,
						7,
						8
					]
				}
			],
			"pinout": [
				"vin+a",
				"vin-a",
				"vouta",
				"i_biasa",
				"vin+b",
				"vin-b",
				"voutb",
				"i_biasb",
				"v-"
			]
		}
	},

// --- CMOS Hex Inverting Buffers / Inverters (CD4049, 74HCU04, CD4069UBE) ----------------------------------------------------
	{
		"partIds": [
			"CD4049",
			"CD4049UBE"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"in_a",
				"ina",
				"pin3"
			],
			[
				"out_a",
				"outa",
				"pin2"
			],
			[
				"in_b",
				"inb",
				"pin5"
			],
			[
				"out_b",
				"outb",
				"pin4"
			],
			[
				"in_c",
				"inc",
				"pin7"
			],
			[
				"out_c",
				"outc",
				"pin6"
			],
			[
				"in_d",
				"ind",
				"pin9"
			],
			[
				"out_d",
				"outd",
				"pin10"
			],
			[
				"in_e",
				"ine",
				"pin11"
			],
			[
				"out_e",
				"oute",
				"pin12"
			],
			[
				"in_f",
				"inf",
				"pin14"
			],
			[
				"out_f",
				"outf",
				"pin15"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "inverter",
						"transconductance": 0.005,
						"biasVolts": 4.5
					},
					"terminals": [
						0,
						1
					]
				},
				{
					"law": {
						"kind": "inverter",
						"transconductance": 0.005,
						"biasVolts": 4.5
					},
					"terminals": [
						2,
						3
					]
				},
				{
					"law": {
						"kind": "inverter",
						"transconductance": 0.005,
						"biasVolts": 4.5
					},
					"terminals": [
						4,
						5
					]
				},
				{
					"law": {
						"kind": "inverter",
						"transconductance": 0.005,
						"biasVolts": 4.5
					},
					"terminals": [
						6,
						7
					]
				},
				{
					"law": {
						"kind": "inverter",
						"transconductance": 0.005,
						"biasVolts": 4.5
					},
					"terminals": [
						8,
						9
					]
				},
				{
					"law": {
						"kind": "inverter",
						"transconductance": 0.005,
						"biasVolts": 4.5
					},
					"terminals": [
						10,
						11
					]
				}
			],
			"pinout": [
				"in_a",
				"out_a",
				"in_b",
				"out_b",
				"in_c",
				"out_c",
				"in_d",
				"out_d",
				"in_e",
				"out_e",
				"in_f",
				"out_f"
			]
		}
	},

// Section indices CROSS-CHECKED 2026-09-05 against mxr-micro-flanger's own terminal names. All six inverters pair correctly INCLUDING the mirrored half -- pin9->in4/pin8->out4, pin11->in5/pin10->out5, pin13->in6/pin12->out6 -- with pin14 vdd and pin7 vss shared. A wrong entry would not produce a clean mirror across the package, so this is verified, not assumed.
	{
		"partIds": [
			"74HCU04",
			"74HCU04N",
			"CD4069UBE",
			"CD4069",
			"MC14069UB",
			"MC14069UBP"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "inverter",
						"transconductance": 0.005,
						"thresholdVolts": 2
					},
					"terminals": [
						0,
						1,
						13,
						6
					]
				},
				{
					"law": {
						"kind": "inverter",
						"transconductance": 0.005,
						"thresholdVolts": 2
					},
					"terminals": [
						2,
						3,
						13,
						6
					]
				},
				{
					"law": {
						"kind": "inverter",
						"transconductance": 0.005,
						"thresholdVolts": 2
					},
					"terminals": [
						4,
						5,
						13,
						6
					]
				},
				{
					"law": {
						"kind": "inverter",
						"transconductance": 0.005,
						"thresholdVolts": 2
					},
					"terminals": [
						8,
						7,
						13,
						6
					]
				},
				{
					"law": {
						"kind": "inverter",
						"transconductance": 0.005,
						"thresholdVolts": 2
					},
					"terminals": [
						10,
						9,
						13,
						6
					]
				},
				{
					"law": {
						"kind": "inverter",
						"transconductance": 0.005,
						"thresholdVolts": 2
					},
					"terminals": [
						12,
						11,
						13,
						6
					]
				}
			],
			"pinout": [
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null
			]
		}
	},

	{
		"partIds": [
			"CD4009",
			"CD4009UBE",
			"MC14009UB",
			"MC14009UBP"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "inverter",
						"transconductance": 0.005,
						"thresholdVolts": 2
					},
					"terminals": [
						2,
						1,
						0,
						7
					]
				},
				{
					"law": {
						"kind": "inverter",
						"transconductance": 0.005,
						"thresholdVolts": 2
					},
					"terminals": [
						4,
						3,
						0,
						7
					]
				},
				{
					"law": {
						"kind": "inverter",
						"transconductance": 0.005,
						"thresholdVolts": 2
					},
					"terminals": [
						6,
						5,
						0,
						7
					]
				},
				{
					"law": {
						"kind": "inverter",
						"transconductance": 0.005,
						"thresholdVolts": 2
					},
					"terminals": [
						8,
						9,
						0,
						7
					]
				},
				{
					"law": {
						"kind": "inverter",
						"transconductance": 0.005,
						"thresholdVolts": 2
					},
					"terminals": [
						10,
						11,
						0,
						7
					]
				},
				{
					"law": {
						"kind": "inverter",
						"transconductance": 0.005,
						"thresholdVolts": 2
					},
					"terminals": [
						13,
						14,
						0,
						7
					]
				}
			],
			"pinout": [
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null
			]
		}
	},

// Section indices CROSS-CHECKED 2026-09-05 against mxr-micro-flanger's own terminal names. All six inverters pair correctly INCLUDING the mirrored half -- pin9->in4/pin8->out4, pin11->in5/pin10->out5, pin13->in6/pin12->out6 -- with pin14 vdd and pin7 vss shared. A wrong entry would not produce a clean mirror across the package, so this is verified, not assumed.
	{
		"partIds": [
			"74HCU04_SUB_GATE",
			"74HCU04_SUB",
			"74HCU04",
			"74HCU04N",
			"74HC04",
			"74HC04N"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"input"
			],
			[
				"output"
			],
			[
				"vcc"
			],
			[
				"gnd"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "inverter",
						"transconductance": 0.005,
						"thresholdVolts": 2
					},
					"terminals": [
						0,
						1,
						2,
						3
					]
				}
			],
			"pinout": [
				"input",
				"output",
				"vcc",
				"gnd"
			]
		}
	},

	{
		"partIds": [
			"CD4069UBE_SUB",
			"CD4069_SUB",
			"CD4069UBE_SUB_GATE"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "inverter",
						"transconductance": 0.005,
						"biasVolts": 4.5
					},
					"terminals": [
						0,
						1
					]
				}
			],
			"pinout": [
				"input",
				"output"
			]
		}
	},

// --- CMOS Dual Complementary Pair Plus Inverter (CD4007 / MC14007UB) --------------------------------------------------------
	{
		"partIds": [
			"MC14007UB",
			"MC14007",
			"CD4007",
			"CD4007UB",
			"CD4007UBE",
			"4007"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "inverter",
						"transconductance": 0.005,
						"thresholdVolts": 2
					},
					"terminals": [
						0,
						5,
						9,
						8
					]
				},
				{
					"law": {
						"kind": "inverter",
						"transconductance": 0.005,
						"thresholdVolts": 2
					},
					"terminals": [
						1,
						6,
						9,
						8
					]
				},
				{
					"law": {
						"kind": "inverter",
						"transconductance": 0.005,
						"thresholdVolts": 2
					},
					"terminals": [
						2,
						4,
						9,
						8
					]
				}
			],
			"pinout": [
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null
			]
		}
	},

	// Texas Instruments OP07x, from "OP07x Precision Operational Amplifiers" SLOS099H (rev. March
	// 2023), `parts/op-amps/OP07/datasheets/op07-ti.pdf` in vessel-dsp/artifacts, section 6.5.
	// Open-loop gain stays the house 100000. The output swing is not in this entry: it has its own
	// registry-data record (`registry-data/opamp.ts`), which types the printed +-12.8 V (RL = 2 kOhm, VS = +-15 V)
	// as a `proportional` pair for OP07CP, OP07DP and OP07DN, and lists the bare `OP07` id absent (the
	// sheet's characteristics apply to the C and D grades only).
	{
		"partIds": [
			"OP07",
			"OP07CP",
			"OP07DP",
			"OP07DN"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"vin+",
				"in+",
				"pin3"
			],
			[
				"vin-",
				"in-",
				"pin2"
			],
			[
				"vout",
				"out",
				"pin6"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						0,
						1,
						2
					]
				}
			],
			"pinout": [
				"vin+",
				"vin-",
				"vout"
			]
		}
	},

// --- Single Op-Amps (LM741, TL071, NJM5534D) --------------------------------------------------------------------------
// Wave 5: LM741CN rides this entry. It is the exact PDIP orderable spelling printed
// in the TI LM741 SNOSC25D (May 1998, rev Oct 2015) Package Option Addendum:
// 'LM741CN/NOPB | Active | Production | PDIP (P) | 8', part marking 'LM 741CN'.
// The specs sit under the LM741C column family; open-loop gain stays the house
// 100000 and no GBW row is quoted (see opampGainBandwidthAbsent).
	{
		"partIds": [
			"LM741",
			"UA741",
			"uA741",
			"TL071",
			"TL071CP",
			"TL071CN",
			"NJM5534",
			"NJM5534D",
			"NE5534",
			"NJM5534M",
			"JRC5534",
			"LM741CN"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"vin+",
				"in+",
				"pin3"
			],
			[
				"vin-",
				"in-",
				"pin2"
			],
			[
				"vout",
				"out",
				"pin6"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						0,
						1,
						2
					]
				}
			],
			"pinout": [
				"vin+",
				"vin-",
				"vout"
			]
		}
	},

// --- Toshiba TA7504S Single Op-Amp (5-terminal variant inside Boss CE-1) -----------------------------------------------------
	{
		"partIds": [
			"TA7504S",
			"TA7504"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						1,
						0,
						3
					]
				}
			],
			"pinout": [
				null,
				null,
				null,
				null,
				null
			]
		}
	},


// --- 5V Voltage Regulators: ids and rail from registry-data/regulator.ts; wiring above --------
	regulatorEntryForVolts(5),

// --- 9V Voltage Regulators: ids and rail from registry-data/regulator.ts; wiring above --------
	regulatorEntryForVolts(9),

// --- 12V Voltage Regulators (wave 5: LM78L12): ids and rail from registry-data/regulator.ts; wiring above --------
	regulatorEntryForVolts(12),

// --- 3.3V Voltage Regulators (wave 5: LM78L33): ids and rail from registry-data/regulator.ts; wiring above --------
	regulatorEntryForVolts(3.3),

// --- 18V Voltage Regulators: ids and rail from registry-data/regulator.ts; wiring above --------
	regulatorEntryForVolts(18),

// --- Active Physical Analog Comparators (LM311, NJM311M, LM319, NJM319M) ----------------------------------------------------
	// --- Active Physical Analog Comparators (LM311, NJM311M, LM319, NJM319M, LM393, LM339) ------------------------------------
	{
		"partIds": [
			"LM311",
			"NJM311M",
			"NJM311D",
			"LM311N",
			"LM311P"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "comparator",
						"pullDownOhms": 10,
						"floatOhms": 1000000000,
						"sensitivity": 1000
					},
					"terminals": [
						1,
						2,
						6,
						3
					]
				}
			],
			"pinout": [
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null
			]
		}
	},

	{
		"partIds": [
			"LM311",
			"NJM311M",
			"NJM311D",
			"LM311N",
			"LM311P",
			"LM319",
			"NJM319M",
			"LM319N",
			"LM319D",
			"LM393",
			"LM393N",
			"LM393P",
			"LM339",
			"LM339A",
			"LM339N"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"noninverting",
				"non_inverting",
				"vin+",
				"in+",
				"noninv",
				"plus",
				"input_plus"
			],
			[
				"inverting",
				"vin-",
				"in-",
				"inv",
				"minus",
				"input_minus"
			],
			[
				"output",
				"out",
				"vout"
			],
			[
				"vcc",
				"v+",
				"vplus",
				"vdd"
			],
			[
				"vee",
				"v-",
				"vminus",
				"gnd",
				"vss",
				"ground"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "comparator",
						"pullDownOhms": 10,
						"floatOhms": 1000000000,
						"sensitivity": 1000
					},
					"terminals": [
						0,
						1,
						2,
						4
					]
				}
			],
			"pinout": [
				"noninverting",
				"inverting",
				"output",
				"vcc",
				"vee"
			]
		}
	},

	{
		"partIds": [
			"LM319",
			"NJM319M",
			"LM319N",
			"LM319D",
			"LM393",
			"LM393N",
			"LM393P",
			"LM339",
			"LM339N"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"vcc",
				"v+",
				"vplus",
				"vdd"
			],
			[
				"gnd",
				"vee",
				"v-",
				"vminus",
				"vss",
				"ground"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [],
			"pinout": [
				"vcc",
				"gnd"
			]
		}
	},

	{
		"partIds": [
			"LM319",
			"NJM319M",
			"LM319N",
			"LM319D"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "comparator",
						"pullDownOhms": 10,
						"floatOhms": 1000000000,
						"sensitivity": 1000
					},
					"terminals": [
						3,
						4,
						11,
						2
					]
				},
				{
					"law": {
						"kind": "comparator",
						"pullDownOhms": 10,
						"floatOhms": 1000000000,
						"sensitivity": 1000
					},
					"terminals": [
						9,
						8,
						6,
						7
					]
				}
			],
			"pinout": [
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null
			]
		}
	},

// --- CMOS Dual D-Type Flip-Flops (CD4013, CD4013BE, uPD4013C) - Active frequency divider modeling! --------------------------
	{
		"partIds": [
			"CD4013",
			"CD4013BE",
			"uPD4013C",
			"CD4013B"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "logic-divider",
						"thresholdVolts": 2,
						"highVolts": 5
					},
					"terminals": [
						2,
						0,
						6
					]
				},
				{
					"law": {
						"kind": "logic-divider",
						"thresholdVolts": 2,
						"highVolts": 5
					},
					"terminals": [
						10,
						12,
						6
					]
				}
			],
			"pinout": [
				"1q",
				"1q_bar",
				"1clock",
				"1reset",
				"1data",
				"1set",
				"gnd",
				"2set",
				"2reset",
				"2data",
				"2clock",
				"2q_bar",
				"2q",
				"vDD"
			]
		}
	},

// --- Active Physical Dynamics Compandors (NE570, NE571, SA571) --------------------------------------------------------------
	//
	// Pin table verified against `parts/vca-ota/NE570/datasheets/onsemi-ne570-d.pdf` (onsemi
	// NE570/D Rev. 4 "PIN FUNCTION DESCRIPTION"), which states, pin 1 through 16:
	//   1 RECT CAP 1, 2 RECT IN 1, 3 G CELL IN 1, 4 GND, 5 INV. IN 1, 6 RES. R3 1, 7 OUTPUT 1,
	//   8 THD TRIM 1, 9 THD TRIM 2, 10 OUTPUT 2, 11 RES. R3 2, 12 INV. IN 2, 13 VCC,
	//   14 G CELL IN 2, 15 RECT IN 2, 16 RECT CAP 2.
	// The previous entry here (`terminals: [15, 1, 13, 2]` / `[0, 14, 2, 12]`) mixed pins from
	// both channels -- e.g. it fed the law's `output` argument from pin 3 (G CELL IN 1, not an
	// output at all) for section A and from pin 13 (VCC, the supply pin) for section B. Verified
	// against `electro-harmonix-deluxe-memory-man.vdsp`'s `U9_NE570`, whose 16 terminals declare
	// `pin1` through `pin16` in that exact strict sequential order (so declaration index N is
	// real pin N+1), each channel below uses only its own four pins.
// Section indices CROSS-CHECKED 2026-09-05 against boss-dm-2's own terminal names. Both channels are symmetric mirrors: channel 1 = pins 2,1,3,5,6,7 and channel 2 = pins 15,16,14,12,11,10 for the same six slots. The entry matches the packet's declared layout.
	{
		"partIds": [
			"NE570",
			"NE571",
			"SA571",
			"NE570N",
			"NE571N",
			"SA571N",
			"SA571D",
			"uPC1571",
			"uPC1571C",
			"NE570 / SA571 family"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "compandor",
						"r1": 10000,
						"r2": 20000,
						"r3": 20000,
						"r4": 30000,
						"r5": 10000,
						"iBias": 0.00014,
						"vrefVolts": 1.8,
						"openLoopGain": 100000,
						"railHigh": null,
						"railLow": null
					},
					"terminals": [
						1,
						0,
						2,
						4,
						5,
						6
					]
				},
				{
					"law": {
						"kind": "compandor",
						"r1": 10000,
						"r2": 20000,
						"r3": 20000,
						"r4": 30000,
						"r5": 10000,
						"iBias": 0.00014,
						"vrefVolts": 1.8,
						"openLoopGain": 100000,
						"railHigh": null,
						"railLow": null
					},
					"terminals": [
						14,
						15,
						13,
						11,
						10,
						9
					]
				}
			],
			"pinout": [
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null
			]
		}
	},

// --- Analog Devices AD633 four-quadrant analog multiplier (electro-harmonix-frequency-analyzer) -----------------------------
	//
	// `electro-harmonix-frequency-analyzer.vdsp`'s `U2_AD633JN` names its 8 terminals
	// `pin1_x1`, `pin2_y1`, `pin3_y2`, `pin4_z`, `pin5_x2`, `pin6_w`, `pin7_vsneg`, `pin8_vspos`
	// -- every one of those folds (via `terminalRoleToken`) to a real, non-null role token
	// (`x1`, `y1`, `y2`, `z`, `x2`, `w`, `vsneg`, `vspos`, in that declared order) because each
	// carries a suffix beyond the bare pin number, unlike the `pinN`-only corpus convention this
	// file's other entries have to work around. This is the AD633's own function set (Analog
	// Devices AD633: two differential inputs X1/X2 and Y1/Y2, a summing input Z, and output
	// `W = (X1-X2)(Y1-Y2)/10V + Z`) by *name*, so the `pinout` guard below is a real check
	// against declaration order, not an unchecked null placeholder -- a document that declares
	// this part with a different order or with bare `pinN` names refuses by name instead of
	// silently mis-wiring the multiplier's quadrant sense.
	//
	// **Modelled as the existing `ota` law run in its small-signal *linear* regime, not its
	// usual exponential one.** The stock LM13700-style entries below use this law's diode
	// (`iAbc = Is*(exp((Vbias-Vee)/Vt)-1)`) for real exponential/dB-linear gain control; here
	// `thermalVoltage` is instead set large (10 V) against the few-volt signal swings this
	// pedal's X/Y pairs actually carry, which drives `exp(x)-1 -> x` and `tanh(x) -> x` on both
	// nonlinearities at once and leaves `iOut ~= (Is/Vt^2) * (Y1-Y2) * (X1-X2)` -- an ordinary
	// four-quadrant multiply, symmetric and zero at rest on *both* inputs, which is the right
	// shape for a ring-modulator/frequency-shifter core (contrast the VCA entries below, whose
	// real chips are asymmetric around a rest point the same technique cannot reach; see the
	// uPC1252H2 and M5207L notes). `saturationCurrent = 10`, `thermalVoltage = 10` are chosen so
	// `Is/Vt^2 = 0.1 = 1/10V`, matching the datasheet's `/10V` scale factor. The `Z` summing
	// input is not read by this law -- `R16_AD633_Z_RETURN` in the packet suggests it returns
	// near a fixed reference in this application, but that is this catalog's known omission,
	// not a verified fact, and is worth checking with a render.
	//
	// **Current-output approximation, not the real chip's behaviour.** The AD633's `W` pin is a
	// low-impedance buffered *voltage* output; this law's `output` terminal is a current
	// injection (the same convention every other `ota`/`compandor` entry here uses), correct in
	// shape (proportional to the product) but not in source impedance. Whatever real load the
	// packet's own support network presents at `W` sets the absolute level -- verify by render
	// rather than assuming the datasheet's `/10V` figure lands exactly.
	{
		"partIds": [
			"AD633JN",
			"AD633"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "ota",
						"transconductance": 0.001,
						"saturationCurrent": 10,
						"thermalVoltage": 10,
						"veeIndex": 4
					},
					"terminals": [
						0,
						4,
						5,
						1,
						2
					]
				}
			],
			"pinout": [
				"x1",
				"y1",
				"y2",
				"z",
				"x2",
				"w",
				"vsneg",
				"vspos"
			]
		}
	},

// --- Roland Proprietary OTAs (BA662, BA662A) -----------------------------------------------------------------
	{
		"partIds": [
			"BA662",
			"BA662A"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"control",
				"i_bias",
				"bias",
				"ampbias",
				"pin1_control",
				"pin1"
			],
			[
				"minusinput",
				"in-",
				"vin-",
				"minus",
				"inminus",
				"pin2_minus_input",
				"pin2"
			],
			[
				"plusinput",
				"in+",
				"vin+",
				"plus",
				"inplus",
				"pin3_plus_input",
				"pin3"
			],
			[
				"negativesupply",
				"v-",
				"vee",
				"vminus",
				"gnd",
				"pin4_negative_supply",
				"pin4"
			],
			[
				"otaoutput",
				"out",
				"vout",
				"output",
				"pin5_ota_output",
				"pin5"
			],
			[
				"bufferinput",
				"buf_in",
				"base",
				"bin",
				"pin6_buffer_input",
				"pin6"
			],
			[
				"buffertie",
				"buf_tie",
				"tie",
				"pin7_buffer_tie",
				"pin7"
			],
			[
				"bufferoutput",
				"buf_out",
				"emitter",
				"bout",
				"pin8_buffer_output",
				"pin8"
			],
			[
				"positivesupply",
				"v+",
				"vcc",
				"vplus",
				"collector",
				"pin9_positive_supply",
				"pin9"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "ota",
						"transconductance": 0.001,
						"veeIndex": 4
					},
					"terminals": [
						2,
						1,
						4,
						0,
						3
					]
				},
				{
					"law": {
						"kind": "bjt",
						"polarity": "npn",
						"saturationCurrent": 1e-14,
						"forwardBeta": 200,
						"reverseBeta": 1,
						"thermalVoltage": 0.025852,
						"leakageAmps": 0
					},
					"terminals": [
						5,
						8,
						7
					]
				}
			],
			"pinout": [
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null
			]
		}
	},

// --- Mitsubishi M5207L VCA / Electronic Volume Control -----------------------------------------------------------------------
	{
		"partIds": [
			"M5207L",
			"M5207"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"in",
				"input",
				"pin4"
			],
			[
				"gnd",
				"pin1"
			],
			[
				"out",
				"output",
				"pin8"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "ota",
						"transconductance": 0.001
					},
					"terminals": [
						0,
						1,
						2
					]
				}
			],
			"pinout": [
				"in",
				"gnd",
				"out"
			]
		}
	},

// --- NEC uPC1252H2 dbx-style VCA (boss-cs-3, boss-lm-2) -------------------------------------------------------------------
	//
	// Pin table verified against the real NEC uPC1252 datasheet (`www.DataSheet4U.com`
	// UPC1252.pdf, "dbx NRシステム用VCA回路" -- "VCA circuit for dbx NR system"), whose block
	// diagram ("ブロック図") and pin-connection diagram ("端子接続図") state, pin 1 through 8:
	// 1 IIN (input current), 2 GC2, 3 GC1, 4 GC3, 5 ISET, 6 GND, 7 Vc (labelled "Vc" in the
	// block diagram, not a supply pin), 8 IOUT (output current). Feature line: "コントロール・
	// コンスタントの直線性に優れています。(Vc=-5.9mV/dB, Av=-30dB~+30dB)" -- the control
	// constant is -5.9 mV per dB, over a +/-30 dB range, matching `boss-lm-2`'s own
	// `boss-lm-2-upc1252h2-vca-control.cir` reference deck (`gain_db = -v(ctrl)/0.0059`).
	//
	// `declaredTypes` deliberately empty. It listed `Circuit.IC`, the format's generic "this is a
	// chip", which identifies nothing and could only ever act as a catch-all: measured 2026-09-04,
	// both corpus users (`boss-cs-3`'s `IC3` and `boss-lm-2`'s `IC1_UPC1252H2`) match by exact part
	// id, while four unrelated components reached this VCA's 8-pin sections entry solely by
	// declaring `Circuit.IC`.
	{
		"partIds": [
			"uPC1252H2",
			"UPC1252H2",
			"uPC1252",
			"UPC1252"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"pin1",
				"iin",
				"input",
				"in"
			],
			[
				"pin2",
				"gc2"
			],
			[
				"pin3",
				"gc1"
			],
			[
				"pin4",
				"gc3",
				"symmetry"
			],
			[
				"pin5",
				"iset"
			],
			[
				"pin6",
				"gnd",
				"ref",
				"ground"
			],
			[
				"pin7",
				"vc"
			],
			[
				"pin8",
				"iout",
				"output",
				"out"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "conductance",
						"siemens": 0.01
					},
					"terminals": [
						0,
						5
					]
				},
				{
					"law": {
						"kind": "ota",
						"transconductance": 0.01
					},
					"terminals": [
						0,
						5,
						7
					]
				}
			],
			"pinout": [
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null
			]
		}
	},

// --- Mitsubishi M5207L01 Dual VCA (boss-tr-2) -------------------------------------------------------------
//
// Pin table verified against the Mitsubishi M5207L01/M5207L05 databook
// (filed artifacts-side under parts/vca-ota/M5207L01/): 10-pin SIL with
// 1 COM (Vcc/2 generated internally), 2 OUT1, 3 LINE Vc1, 4 IN1, 5 -Vcc,
// 6 NC, 7 IN2, 8 LINE Vc2, 9 OUT2, 10 +Vcc. IC1B (channel 2: IN2/Vc2/OUT2)
// is the TR-2 VCA; IC1A (channel 1) is unused with in/out as floating stubs.
//
// LAW (databook, linear not exponential): gain is proportional to Vc measured
// between the LINE Vc pin and COM. L01: 0 dB at Vc = 1 V, ATT 0..-100 dB,
// linear to about 1.6 V (160%). Current-in (Ri converts the input to a
// current) / current-out into an external Ro; 0 dB when Vc = 1 V AND
// Ro = 2*Ri. TR-2: Ri = R9 10k, Ro = R12 22k, so gain = 1.1 * Vc. In-pedal
// Vc window at Depth 0.5: N69 4.85-5.45 V vs COM 4.5 V, i.e. Vc 0.35-0.95 V,
// gain 0.39-1.05 (about -8 dB to +0.4 dB) -- a plausible tremolo. Control
// bias is about 100 nA (negligible).
//
// MAPPING: the input pin is a small resistance to COM (conductance g_in
// standing in for the virtual ground). The `linear-vca` law multiplies the
// input current by max(minGain, Vc / vrefVolts) with Vc read between the
// control terminal and the minus input -- and draws nothing from the
// control node, which is what lets a high-impedance depth network drive it.
// bias = LINE Vc (pin8/N69), minus = COM (ref terminal, N3 4.5 V rail),
// plus = IN. With V+ - V- = i_in/g_in and target iOut = i_in*Vc/(2 V):
// inputSiemens = 0.01, vrefVolts = 1, minGain = 0. Polarity note: the old
// 3-terminal fixed-gm fallback inverted; the new stamp is non-inverting, so
// audio phase flips vs the pre-VCA model -- level is calibrated by render
// and tremolo audibility is phase-independent.
//
// BINDING (read before touching): the packet's physical pin names tokenize
// to null (terminalRoleToken), so role groups can never match pin8/pin5 and
// a clean role bijection is impossible for the 5-terminal device. Binding
// goes the pinoutMatches positional route, which needs pinout.length ===
// terminal count: hence the two trailing nulls. They are unchecked slots
// (a null pinout position asserts nothing about declaration order), so the
// entry still refuses a genuinely mis-ordered document at in/ref/out.
// Lengthening the pinout retires the old 3-terminal packet: it now resolves
// open (registry-arity-mismatch) instead of executing the fixed-gm fallback.
// That packet is superseded by the v1.19 re-net; the corpus ratchet update
// this forces is part of landing, not a regression.
//
// KNOWN DEVIATIONS (documented, not hidden):
// - For Vc < 0 this law flips polarity; the real chip floors at -100 dB.
//   (Watch N69 vs COM at the Depth extremes.)
// - minGain 0 is mute (-infinite), the ear's -100 dB.
{
	"partIds": [
		"M5207L01_5",
		"M5207L01",
		"M5207L"
	],
	"declaredTypes": [],
	"terminalRoleGroups": [
		[
			"in",
			"input",
			"pin4",
			"pin7"
		],
		[
			"com",
			"common",
			"ref",
			"pin1"
		],
		[
			"out",
			"output",
			"pin2",
			"pin9"
		],
		[
			"control",
			"line-vc",
			"vc",
			"line-vc1",
			"line-vc2",
			"pin3",
			"pin8"
		],
		[
			"gnd",
			"ground",
			"pin5"
		],
		[
			"supply",
			"pin10"
		]
	],
	"model": {
		"kind": "sections",
		"sections": [
			{
				"law": {
					"kind": "linear-vca",
					"inputSiemens": 0.01,
					"vrefVolts": 1,
					"minGain": 0
				},
				"terminals": [
					0,
					1,
					2,
					3
				]
			}
		],
		"pinout": [
			"in",
			"ref",
			"out",
			null,
			null
		]
	}
},

// --- 2-terminal dual op-amp power section (e.g. IC2C_POWER in Boss TR-2) -----------------------------------
	{
		"partIds": [
			"M5281AL",
			"M5281L",
			"M5281P",
			"M5281",
			"M5216AL",
			"M5216L",
			"M5216P",
			"M5216",
			"M5218L",
			"M5218P",
			"M5218",
			"TL072",
			"TL062",
			"TL082",
			"RC4558",
			"NJM4558",
			"LF353",
			"NE5532",
			"LM358",
			"OP275",
			"NJM2068D"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [],
			"pinout": [
				null,
				null
			]
		}
	},

// --- CMOS Quad 2-Input NAND Logic Gates (CD4011, 74HC00) - Active dynamic MOSFET transistor decomposition! -----------------
	{
		"partIds": [
			"CD4011",
			"CD4011BP",
			"HD14011BP",
			"TC74HC00AF",
			"TC74HC00P",
			"74HC00",
			"TC40H000P",
			"1/474HC00",
			"HD14011",
			"1/474HC00P",
			"TC74HC00",
			"HD14011B"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "nand-gate",
						"thresholdVolts": 2,
						"transconductance": 0.001
					},
					"terminals": [
						0,
						1,
						2,
						13,
						6
					]
				},
				{
					"law": {
						"kind": "nand-gate",
						"thresholdVolts": 2,
						"transconductance": 0.001
					},
					"terminals": [
						4,
						5,
						3,
						13,
						6
					]
				},
				{
					"law": {
						"kind": "nand-gate",
						"thresholdVolts": 2,
						"transconductance": 0.001
					},
					"terminals": [
						7,
						8,
						9,
						13,
						6
					]
				},
				{
					"law": {
						"kind": "nand-gate",
						"thresholdVolts": 2,
						"transconductance": 0.001
					},
					"terminals": [
						11,
						12,
						10,
						13,
						6
					]
				}
			],
			"pinout": [
				"1a",
				"1b",
				"1y",
				"2y",
				"2a",
				"2b",
				"gnd",
				"3a",
				"3b",
				"3y",
				"4y",
				"4a",
				"4b",
				"vdd"
			]
		}
	},

	{
		"partIds": [
			"CD4011",
			"CD4011BP",
			"HD14011BP",
			"TC74HC00AF",
			"TC74HC00P",
			"74HC00",
			"TC40H000P",
			"1/474HC00",
			"HD14011",
			"1/474HC00P",
			"TC74HC00",
			"HD14011B"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"input_a",
				"in_a",
				"ina",
				"a",
				"1a"
			],
			[
				"input_b",
				"in_b",
				"inb",
				"b",
				"1b"
			],
			[
				"output",
				"out",
				"y",
				"1y"
			],
			[
				"vcc",
				"vdd",
				"vplus",
				"v+"
			],
			[
				"gnd",
				"vss",
				"vminus",
				"v-",
				"ground"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "nand-gate",
						"thresholdVolts": 2,
						"transconductance": 0.001
					},
					"terminals": [
						0,
						1,
						2,
						3,
						4
					]
				}
			],
			"pinout": [
				"input_a",
				"input_b",
				"output",
				"vcc",
				"gnd"
			]
		}
	},

	{
		"partIds": [
			"CD4011",
			"CD4011BP",
			"HD14011BP",
			"TC74HC00AF",
			"TC74HC00P",
			"74HC00",
			"TC40H000P",
			"1/474HC00",
			"HD14011",
			"1/474HC00P",
			"TC74HC00",
			"HD14011B"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"pin14_vdd",
				"vcc",
				"vdd",
				"vplus",
				"v+"
			],
			[
				"pin7_vss",
				"vss",
				"gnd",
				"vminus",
				"v-",
				"ground"
			],
			[
				"logic_io",
				"io",
				"nc",
				"section",
				"unused"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [],
			"pinout": [
				"pin14_vdd",
				"pin7_vss",
				"logic_io"
			]
		}
	},

	{
		"partIds": [
			"HD14066BP",
			"HD14066",
			"4066",
			"CD4066",
			"CD4066BCN",
			"TC4066BP",
			"1/44066",
			"TC7W66FU",
			"74HC4066",
			"74HCT4066"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"switch_a",
				"in",
				"a",
				"sig_in",
				"inout1",
				"1in/out",
				"in/out"
			],
			[
				"switch_b",
				"out",
				"b",
				"sig_out",
				"inout2",
				"1out/in",
				"out/in"
			],
			[
				"control",
				"ctrl",
				"c",
				"gate",
				"ctl",
				"1control"
			],
			[
				"vcc",
				"vdd",
				"vplus",
				"v+"
			],
			[
				"vss",
				"gnd",
				"vminus",
				"v-",
				"ground"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "analog-switch",
						"onOhms": 80,
						"offOhms": 1000000000,
						"thresholdVolts": 2
					},
					"terminals": [
						0,
						1,
						2
					]
				}
			],
			"pinout": [
				"switch_a",
				"switch_b",
				"control",
				"vcc",
				"vss"
			]
		}
	},

	{
		"partIds": [
			"HD14066BP",
			"HD14066",
			"4066",
			"CD4066",
			"CD4066BCN",
			"TC4066BP",
			"1/44066",
			"TC7W66FU",
			"74HC4066",
			"74HCT4066"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"switch_a",
				"in",
				"a",
				"sig_in",
				"inout1",
				"1in/out",
				"in/out"
			],
			[
				"switch_b",
				"out",
				"b",
				"sig_out",
				"inout2",
				"1out/in",
				"out/in"
			],
			[
				"pin14_vdd",
				"vcc",
				"vdd",
				"vplus",
				"v+"
			],
			[
				"pin7_vss",
				"vss",
				"gnd",
				"vminus",
				"v-",
				"ground"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "analog-switch",
						"onOhms": 80,
						"offOhms": 1000000000,
						"thresholdVolts": 2
					},
					"terminals": [
						0,
						1,
						2
					]
				}
			],
			"pinout": [
				"switch_a",
				"switch_b",
				"pin14_vdd",
				"pin7_vss"
			]
		}
	},

// --- LM13700N 7-pin package alternative (unblocks keeley-compressor-plus) -----------------------------------------------------
	{
		"partIds": [
			"LM13700",
			"LM13700N",
			"LM13600",
			"LM13600N"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "ota",
						"transconductance": 0.001,
						"veeIndex": 6
					},
					"terminals": [
						0,
						1,
						3,
						4
					]
				}
			],
			"pinout": [
				"positive",
				"negative",
				"diodeBias",
				"iabc",
				"out",
				"vplus",
				"vminus"
			]
		}
	},

// TL-022CP 2-pin package alternative (unblocks boss-oc-2) --------------------------------------------------------------------
	{
		"partIds": [
			"TL022CP2"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 10
					},
					"terminals": [
						0,
						1,
						1
					]
				}
			],
			"pinout": [
				null,
				null
			]
		}
	},

// AK4552VT alternative pinouts (unblocks boss-bf-3, boss-st-2) ---------------------------------------------------------------
	{
		"partIds": [
			"AK4552VT",
			"AK4552",
			"AK4552VT13"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 10
					},
					"terminals": [
						0,
						2,
						2
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 10
					},
					"terminals": [
						1,
						3,
						3
					]
				}
			],
			"pinout": [
				"LIN",
				"RIN",
				"LOUT",
				"ROUT",
				"VCOM",
				"AD",
				"DA",
				"MCLK",
				"BICK",
				"LRCK",
				"PDN",
				"VDD",
				"VSS"
			]
		}
	},

// --- Light-Emitting Diodes / LED Indicators (SLP24B, SLP-24B, general LEDs) --------------------------------------------------
	{
		"partIds": [
			"LED",
			"red-led",
			"green-led",
			"yellow-led",
			"IndicatorLED"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "diode",
						"saturationCurrent": 1e-12,
						"emissionCoefficient": 1,
						"thermalVoltage": 0.05,
						"breakdownVolts": 5
					},
					"terminals": [
						0,
						1
					]
				}
			],
			"pinout": [
				null,
				null
			]
		}
	},

// --- Active Physical Split-Package CdS LDR Photoresistors (VTL5C2_LDR, CdS_LDR, LDR_CDS) -------------------------------------
	{
		"partIds": [
			"VTL5C2_LDR",
			"CdS_LDR",
			"LDR_CDS",
			"Vactec (5Cx/2)",
			"Vactec",
			"VTL5C2/2",
			"VTL5C4/2"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"a",
				"1",
				"pin1",
				"ldr_a",
				"ldra"
			],
			[
				"b",
				"2",
				"pin2",
				"ldr_b",
				"ldrb"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "conductance",
						"siemens": 0.0002
					},
					"terminals": [
						0,
						1
					]
				}
			],
			"pinout": [
				"a",
				"b"
			]
		}
	},

// --- Optocouplers & Vactrols - Active physical Light-Dependent Resistor modeling! -------------------------------------------
	//
	// `VTL5C2` used to share this row; it now has its own entry below, because
	// `runoffgroove-tremulus-lune`'s packet cites a real VTL5C2 datasheet current-resistance curve
	// (R@1mA=5.5k, R@10mA=800, R@40mA=200, dark>=1M) that this row's placeholder bounds
	// (ldrMinOhms=100, ldrMaxOhms=10M with the generic exp(-1000*amps) law) put 56.7% of the way to
	// fully dark at a genuinely-lit 0.567 mA. None of the other parts here carry a cited curve, so
	// this row is untouched -- moving them to chase the one part that has evidence is the mistake
	// this repo calls a seventeenth spelling table.
	{
		"partIds": [
			"PC817",
			"MOC3021",
			"VTL5C1",
			"VTL3C3",
			"VTL5C3",
			"VTL5C4",
			"P873G35-380",
			"P873G35",
			"P873G35380"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"ledanode",
				"anode",
				"led_anode",
				"pin1"
			],
			[
				"ledcathode",
				"cathode",
				"led_cathode",
				"pin2"
			],
			[
				"ldra",
				"a",
				"ldr_a",
				"pin3"
			],
			[
				"ldrb",
				"b",
				"ldr_b",
				"pin4"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "optocoupler",
						"ledThresholdVolts": 1.6,
						"ledTransconductance": 0.001,
						"ldrMinOhms": 100,
						"ldrMaxOhms": 10000000
					},
					"terminals": [
						0,
						1,
						2,
						3
					]
				}
			],
			"pinout": [
				"led_anode",
				"led_cathode",
				"ldr_a",
				"ldr_b"
			]
		}
	},

// --- Vactec VTL5C2 (unblocks runoffgroove-tremulus-lune) ----------------------------------------------------------------------
	//
	// Own entry, split out of the PC817/MOC3021 row above (2026-09-15). `runoffgroove-tremulus-lune`
	// declares `OPTO_VTL5C2` with typed terminal roles (`anode`/`cathode`/`end`/`end`), and its own
	// `SelectedLaneLedCurrentToResistanceLaw` property cites the VTL5C2 datasheet: R@1mA=5.5k,
	// R@10mA=800, R@40mA=200, dark/off resistance >=1M. Those three points are linear in log-log
	// space (pairwise slopes -0.837 and -1.000), which the generic bucket's exponential-in-current
	// law cannot fit at any choice of constant -- confirmed by attempting the fit and finding no
	// sane solution (see changelog). `ldrPowerLawCoefficientOhms`/`ldrPowerLawExponent` are a
	// least-squares power-law fit to those three anchors instead: `ohms = 11.9861 *
	// amps^-0.892233`, clamped to `[ldrMinOhms, ldrMaxOhms]`. Residuals against the cited anchors:
	// +3.5% at 1 mA, -8.8% at 10 mA, +5.9% at 40 mA. `ldrMaxOhms` is tightened to 1e6 (the packet's
	// own cited dark floor) from the generic bucket's placeholder 1e7; `ldrMinOhms` keeps the
	// generic 100 ohm floor, which the datasheet does not further constrain below the 40 mA point.
	{
		"partIds": [
			"VTL5C2"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"ledanode",
				"anode",
				"led_anode",
				"pin1"
			],
			[
				"ledcathode",
				"cathode",
				"led_cathode",
				"pin2"
			],
			[
				"ldra",
				"a",
				"ldr_a",
				"pin3"
			],
			[
				"ldrb",
				"b",
				"ldr_b",
				"pin4"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "optocoupler",
						"ledThresholdVolts": 1.6,
						"ledTransconductance": 0.001,
						"ldrMinOhms": 100,
						"ldrMaxOhms": 1000000,
						"ldrPowerLawCoefficientOhms": 11.9861,
						"ldrPowerLawExponent": -0.892233
					},
					"terminals": [
						0,
						1,
						2,
						3
					]
				}
			],
			"pinout": [
				"led_anode",
				"led_cathode",
				"ldr_a",
				"ldr_b"
			]
		}
	},

// --- Xvive VTL5C6 (unblocks pigtronix-philosophers-tone) ---------------------------------------------------------------------
	//
	// Own entry rather than folding into the PC817/MOC3021 row above: that row's `pinout` reads
	// bare `anode`/`cathode` role tokens, and `pigtronix-philosophers-tone`'s VTL5C6 declares
	// `ledAnode`/`ledCathode`/`ldrA`/`ldrB` instead -- a different terminal-naming convention that
	// folds to a different token (`ledanode`, not `anode`), so it would refuse against that row's
	// pinout rather than compile. On/off resistance are the packet's own persisted-datasheet
	// properties (`OnResistanceAt5mA` = 6k, `OffResistance` = 400k after 10s), not invented: the
	// packet's own `Description` says these are "from the persisted Xvive VTL5C6 datasheet".
	{
		"partIds": [
			"VTL5C6"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "optocoupler",
						"ledThresholdVolts": 1.6,
						"ledTransconductance": 0.001,
						"ldrMinOhms": 6000,
						"ldrMaxOhms": 400000
					},
					"terminals": [
						0,
						1,
						2,
						3
					]
				}
			],
			"pinout": [
				"ledAnode",
				"ledCathode",
				"ldrA",
				"ldrB"
			]
		}
	},

// --- NSL50461 (unblocks electro-harmonix-slapback-echo) ----------------------------------------------------------------------
	//
	// `electro-harmonix-slapback-echo`'s `PC1` declares `led_anode`/`led_cathode`/`ldr_a`/`ldr_b` --
	// same role tokens as the PC817 row above once folded, but that row only matches on `partIds`
	// and this part number is not in it, so a separate entry keyed on `NSL50461` is what actually
	// resolves it. The packet states no `OnResistance`/`OffResistance` properties for this part (only
	// `PartNumber`/`SourceValue`/`Role`/`OpaqueBoundary`), so on/off resistance fall back to the same
	// generic vactrol bounds the PC817 row uses rather than an invented NSL50461-specific figure.
	{
		"partIds": [
			"NSL50461"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "optocoupler",
						"ledThresholdVolts": 1.6,
						"ledTransconductance": 0.001,
						"ldrMinOhms": 100,
						"ldrMaxOhms": 10000000
					},
					"terminals": [
						0,
						1,
						2,
						3
					]
				}
			],
			"pinout": [
				"led_anode",
				"led_cathode",
				"ldr_a",
				"ldr_b"
			]
		}
	},

// --- Generic source-labeled "OPTO" vactrol (unblocks electro-harmonix-q-tron) ------------------------------------------------
	//
	// `electro-harmonix-q-tron`'s `OPTO1`/`OPTO2` both declare `PartNumber: OPTO` -- a source-authored
	// placeholder label, not a manufacturer number, per each component's own `Model: source-labeled
	// OPTO/Vactrol` property -- with terminals in `photo_a, photo_b, led_anode, led_cathode` order
	// (LDR pair first, LED pair second, the reverse of the two rows above). No on/off resistance is
	// declared for either instance, so both fall back to the same generic vactrol bounds as the
	// NSL50461 row. OPTO1 and OPTO2 share one LED's nodes (both declare `led_anode`/`led_cathode` on
	// nodes 28/29): each is still resolved as its own complete 4-terminal device from its own
	// declared terminals, which is what the source states -- two vactrols in the SVF control path,
	// each independently wired across the same shared control-LED nodes.
	{
		"partIds": [
			"OPTO"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "optocoupler",
						"ledThresholdVolts": 1.6,
						"ledTransconductance": 0.001,
						"ldrMinOhms": 100,
						"ldrMaxOhms": 10000000
					},
					"terminals": [
						2,
						3,
						0,
						1
					]
				}
			],
			"pinout": [
				"photo_a",
				"photo_b",
				"led_anode",
				"led_cathode"
			]
		}
	},

// --- Power Transformers / Signal Transformers (Active physical turns-ratio coupled-windings modeling!) ----------------------
	{
		"partIds": [
			"transformer",
			"POWER_TRANSFORMER",
			"PowerTransformer"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"primary_a",
				"primarymainsa",
				"pri_a",
				"in_a",
				"primary_mains_a"
			],
			[
				"primary_b",
				"primarymainsb",
				"pri_b",
				"in_b",
				"primary_mains_b"
			],
			[
				"secondary_a",
				"secondaryacleft",
				"sec_a",
				"out_a",
				"secondary_ac_left"
			],
			[
				"secondary_b",
				"secondaryacright",
				"sec_b",
				"out_b",
				"secondary_ac_right"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "transformer",
						"turnsRatio": 1,
						"windingAmplitudeVolts": [],
						"mainsFrequencyHz": null,
						"windingSourceOhms": 1
					},
					"terminals": [
						0,
						1,
						2,
						3
					]
				}
			],
			"pinout": [
				"primary_a",
				"primary_b",
				"secondary_a",
				"secondary_b"
			]
		}
	},

// --- Negative Voltage Regulators: ids and rail from registry-data/regulator.ts; wiring above --------
// The 7912/LM7912 sharing and the signed-volts convention are recorded on the record; the
// wiring skeleton for -15 V is shared. Until the convention is settled, a negative regulator
// using this entry must declare its output `positive`, which is why deluxe-memory-man does.
	regulatorEntryForVolts(-15),


// --- TC1044S charge-pump inverter (Microchip): ids and loss/slope from registry-data/charge-pump.ts; wiring above ---
	chargePumpEntryFor("TC1044S"),

// --- ICL7660 charge-pump inverter (Intersil/Renesas): ids and loss/slope from registry-data/charge-pump.ts; wiring above ---
	chargePumpEntryFor("ICL7660"),

// --- ICL7660A charge-pump inverter (Intersil/Renesas): ids and loss/slope from registry-data/charge-pump.ts; wiring above ---
	chargePumpEntryFor("ICL7660A"),

// --- ICL7660S charge-pump inverter (Renesas): ids and loss/slope from registry-data/charge-pump.ts; wiring above ---
	chargePumpEntryFor("ICL7660S"),

// --- TC7662B charge-pump inverter (Microchip): ids and loss/slope from registry-data/charge-pump.ts; wiring above ---
	chargePumpEntryFor("TC7662B"),

// --- LT1054 switched-capacitor converter (TI second source): ids and loss/slope from registry-data/charge-pump.ts; wiring above ---
	chargePumpEntryFor("LT1054"),

// --- LTC1144 wide-input converter (Linear Tech): ids and loss/slope from registry-data/charge-pump.ts; wiring above ---
	chargePumpEntryFor("LTC1144"),

// --- MAX1044 switched-capacitor converter (Maxim): ids and loss/slope from registry-data/charge-pump.ts; wiring above ---
	chargePumpEntryFor("MAX1044"),

// --- AK4552VT8 8-pin codec body alternative ----------------------------------------------------------------------------------
	{
		"partIds": [
			"AK4552VT8",
			"AK4552VT",
			"AK4552"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 10
					},
					"terminals": [
						0,
						2,
						2
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 10
					},
					"terminals": [
						1,
						3,
						3
					]
				}
			],
			"pinout": [
				"lin",
				"rin",
				"lout",
				"rout",
				"serial-audio",
				"pdn",
				"va-vd",
				"agnd-dgnd"
			]
		}
	},

// --- CD4049 hex inverter, declared one gate per "ic" component (moogerfooger-mf-102) --------------------------------------
	//
	// The existing CD4049/CD4049UBE entry above assumes one 12-terminal component holding all six
	// gate pairs. `moogerfooger-mf-102.vdsp` instead declares each gate (U3A..U3F) as its own `ic`
	// instance with `PartNumber: "4049"` (bare, no "CD") and five terminals apiece --
	// `non_inverting, inverting, output, vplus, vminus` -- an op-amp-shaped template applied to a
	// digital gate. Verified against the document: every one of U3A/B/C/D/E/F declares exactly that
	// name order. Bare "4049" is not registered anywhere else in this catalog, so this entry cannot
	// collide with the 12-terminal package entry (different partId string, and `pinoutMatches`'s
	// length check would refuse rather than mis-wire even if it somehow did).
	//
	// Only `non_inverting` (input) and `output` are wired to the law; `inverting` is a second
	// input-shaped slot the template always emits but this part has no second input pin, and
	// `vplus`/`vminus` are unused by `inverter`'s stamp exactly as they are for the existing
	// CD4049/74HCU04 entries (the law takes a fixed `biasVolts` rather than a modelled rail).
	// Same transconductance/bias constants as the existing CD4049 entry: same physical part.
	{
		"partIds": [
			"4049"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "inverter",
						"transconductance": 0.005,
						"thresholdVolts": 2
					},
					"terminals": [
						0,
						2,
						3,
						4
					]
				}
			],
			"pinout": [
				"noninverting",
				"inverting",
				"output",
				"vplus",
				"vminus"
			]
		}
	},

// --- National Semiconductor MC33178 dual low-noise op-amp, declared one section per "ic"
	// (mxr-carbon-copy) --------------------------------------------------------------
	//
	// `mxr-carbon-copy.vdsp` declares each half of the dual (U8A, U8B) as its own `ic`
	// instance with `PartNumber: "MC33178"` and five role-named terminals, both in the same
	// order: `output, inverting, noninverting, vplus, vminus`. With no role groups this entry
	// is wired by position, so the pinout is written in that declared order and the section's
	// three audio terminals index it as noninverting=pinout[2], inverting=pinout[1],
	// output=pinout[0] -- the `ideal-opamp` law reads only those three; vplus/vminus are not
	// wired to the law (rails come from the circuit, exactly as the CD4049 template above).
	// No MC33178 datasheet is vendored in the artifacts library, so the open-loop gain is the
	// class-general 100 dB (1e4) rather than a sourced MC33178 figure. It states **no output swing**:
	// the 1.1 V this entry carried until row 16 was the registry's (`component-opamp-chips.json`)
	// citation of the onsemi MC33178-D table at +-15 V, never re-read here because the datasheet is not
	// vendored, which does not meet the printed-TYP-only rule; the id is listed in
	// `opampOutputSwingAbsent` with that reason.
	{
		"partIds": [
			"MC33178",
			"MC33178P",
			"MC33178D"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						2,
						1,
						0
					]
				}
			],
			"pinout": [
				"output",
				"inverting",
				"noninverting",
				"vplus",
				"vminus"
			]
		}
	},

// --- RCA/TI CD4047 gatable astable multivibrator, BBD clock (mxr-carbon-copy) ------------------
	//
	// `mxr-carbon-copy.vdsp`'s U6 declares 14 terminals in strict pin order with the CD4047's
	// function names (`pin1_C` ... `pin14_VDD`), folding to `c, r, rccommon, astablebar,
	// astable, negtrigger, vss, postigger, extreset, q, qbar, retrigger, oscout, vdd`. It is the
	// two-phase BBD clock: Q (pin10, node 106) -> CP1 and Q-bar (pin11, node 107) -> CP2 on the
	// BL3208A brigade. Modelled with the existing `clock-driver` law (the same law the MN3101
	// fitting above uses): Q/Q-bar toggle 0<->VDD and the law's regulated VGG tap lands on the
	// spare OSC_OUT pin. Because the brigade's CP1 node is driven by this *active* device it is
	// not a pure linear derivation, so `couple` leaves the brigade's `parameter` port un-wired and
	// the bucket-brigade macro falls back to the document's `DelayMs`, else the resolver's 50 ms
	// stand-in -- never to a catalog value, since `resolveMacro` always overrides `delaySeconds`
	// in the merge. The clock rate is decoupled exactly as the MN3101 fittings are (see
	// `non-executable-clock-drivers`), which is BBD plan S1's open defect, not a feature.
	{
		"partIds": [
			"CD4047BM",
			"CD4047B",
			"CD4047"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [],
			"pinout": [
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				"vdd"
			]
		}
	},

// --- CD4013AE dual D flip-flop, mxr-m117r-flanger's own pin-legend terminal names ------------------------------------------
	//
	// Functionally the same part the existing CD4013/CD4013BE/uPD4013C/CD4013B entry above already
	// covers (same `logic-divider` law, same thresholdVolts/highVolts), but that entry's `pinout`
	// assumes terminal names folding to `1q`, `1q_bar`, `1clock`, ... -- and this document's `U3`
	// names every terminal `pin<N>_<role>` (`pin1_q1`, `pin2_not_q1`, `pin3_clock1`, ...), which
	// folds to `q1`, `notq1`, `clock1`, ... instead (the `pin<N>` prefix is stripped by
	// `terminalRoleToken`, leaving a differently-spelled suffix). Different token strings at the same
	// positions fail `pinoutMatches`, so this needs its own entry rather than an alias added to the
	// existing one. "CD4013AE" is not registered elsewhere, so no collision.
	//
	// `SCL4013A` (Solid State Scientific, the part `electro-harmonix-slapback-echo`'s `IC3` is printed as on the
	// factory sheet: a 14-pin 7+7 package with the 4013 pin legend, second-half outputs 12/13 NC) rides this
	// entry rather than the first CD4013 one because that packet declares the same `pin<N>_<role>` names
	// as `mxr-m117r-flanger`'s `U3`, in strict pin order 1..14.
	//
	// Verified directly against the document: `U3`'s 14 terminals are declared in strict ascending
	// pin order (`pin1_q1` through `pin14_vdd`), matching the standard CD4013 pinout, and the
	// component's own `Description` corroborates the same reading pin-by-pin ("pins 4 RESET1, 6 SET1,
	// 7 VSS, and 10 RESET2 are tied to source ground, pin 5 DATA1 is tied to pin 2 /Q1, pin 11 CLOCK2
	// is looped from pin 1 Q1, ..."), which is exactly the textbook D=Qbar toggle-divider wiring the
	// existing CD4013 entry already assumes for the same law.
	{
		"partIds": [
			"CD4013AE",
			"SCL4013A"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "logic-divider",
						"thresholdVolts": 2,
						"highVolts": 5
					},
					"terminals": [
						2,
						0,
						6
					]
				},
				{
					"law": {
						"kind": "logic-divider",
						"thresholdVolts": 2,
						"highVolts": 5
					},
					"terminals": [
						10,
						12,
						6
					]
				}
			],
			"pinout": [
				"q1",
				"notq1",
				"clock1",
				"reset1",
				"data1",
				"set1",
				"vss",
				"set2",
				"data2",
				"reset2",
				"clock2",
				"notq2",
				"q2",
				"vdd"
			]
		}
	},

// --- MC14013/CD4013 dual D flip-flop, mxr-blue-box's own function-name terminal order ------------------------------------
	//
	// Same part and law as the existing CD4013 entry again, but `mxr-blue-box.vdsp`'s `IC2` declares
	// the compound partId string `"MC14013/CD4013"` (its own distinct folded id, no collision) and
	// orders its 14 terminals *by section*, not by physical pin number: `1Q, 1QBAR, 1CLK, 1D, 1RESET,
	// 1SET, 2Q, 2QBAR, 2CLK, 2D, 2RESET, 2SET, VDD, VSS`. That is neither the existing entry's pin
	// order nor its exact token spellings (`1CLK` folds to `1clk`, not `1clock`; `VSS` last instead of
	// after section 1), so it needs its own `pinout`/section-terminal indices.
	//
	// Verified two ways: the declared names are unambiguous role words (no "pin7"-style bare numbers
	// to guess at), and the wiring is internally self-consistent with the part's function --
	// `1D` and `1QBAR` share a node (D tied to Qbar, the standard divide-by-2 toggle configuration),
	// `2D`/`2QBAR` likewise, and `1Q` shares a node with `2CLK` (stage 1's Q drives stage 2's clock,
	// the cascade the packet's own `Role` names: "two cascaded divide-by-two stages; Q2 output is
	// divide-by-four/two-octaves-down").
	{
		"partIds": [
			"MC14013/CD4013"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "logic-divider",
						"thresholdVolts": 2,
						"highVolts": 5
					},
					"terminals": [
						2,
						0,
						13
					]
				},
				{
					"law": {
						"kind": "logic-divider",
						"thresholdVolts": 2,
						"highVolts": 5
					},
					"terminals": [
						8,
						6,
						13
					]
				}
			],
			"pinout": [
				"1q",
				"1qbar",
				"1clk",
				"1d",
				"1reset",
				"1set",
				"2q",
				"2qbar",
				"2clk",
				"2d",
				"2reset",
				"2set",
				"vdd",
				"vss"
			]
		}
	},

// --- uPD4013C6, boss-oc-2's per-half-package terminal shells (IC7A, IC7B) --------------------------------------------------
	//
	// `boss-oc-2.vdsp` declares this divider as two separate `ic` instances, `IC7A` and `IC7B`, one
	// per physical half of the package (`IC7A` on pins 8-13, `IC7B` on pins 1-6), each with six
	// terminals named `pin<N>_cl, pin<N>_d, pin<N>_ck, pin<N>_q, pin<N>_qbar, pin<N>_ps` in that
	// order. Folding strips the `pin<N>` prefix, so both instances present the same five-token
	// pinout signature (`cl, d, ck, q, qbar, ps`) despite different physical pin numbers -- one entry
	// covers both.
	//
	// Verified which slot is really the clock several ways, because `cl` and `ck` both abbreviate
	// "clock" on sight: (1) `IC7A.pin10_cl`'s node is the same node the packet's other, single-
	// terminal `uPD4013C1` placeholder names `clock_drive_input` (fed from R36/IC3B, the tracker's
	// comparator output -- exactly how an octave-divider derives a clock from a zero-crossing
	// detector); (2) `IC7B.pin4_cl`'s node is the same node as `IC7A.pin13_q` -- stage 1's Q output
	// cascading into stage 2's clock, matching the packet's own "second divide-by-two shell" role;
	// (3) `pin9_d`/`pin12_qbar` (and `pin5_d`/`pin2_qbar`) share a node -- the standard D=Qbar toggle
	// wiring; (4) each `ck` terminal (`pin11_ck`, `pin3_ck`) is the *only* declared terminal on its
	// node anywhere in the document -- floating, so it cannot be the driven clock input. `ps`
	// (preset) ties to the document's ground node at both instances, which is what the law needs for
	// its `gndNode` regardless of the pin's own datasheet name.
	{
		"partIds": [
			"uPD4013C6"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "logic-divider",
						"thresholdVolts": 2,
						"highVolts": 5
					},
					"terminals": [
						0,
						3,
						5
					]
				}
			],
			"pinout": [
				"cl",
				"d",
				"ck",
				"q",
				"qbar",
				"ps"
			]
		}
	},

// --- uPD4013C1, boss-oc-2's redundant single-terminal divider placeholder -------------------------------------------------
	//
	// A *second*, separate `ic` component (`IC_DIVIDER_UPD4013C`) in the same document, for the same
	// physical chip `uPD4013C6`/`IC7A`/`IC7B` above already model. It carries exactly one terminal,
	// `clock_drive_input`, wired to the identical node as `IC7A.pin10_cl`, and its own `Description`
	// says so directly: "matching the source-net trace's IC7_DRIVE_NODE/IC7A.pin10_cl; internal
	// D/Q/Qbar divider timing remains opaque source-boundary behavior, not terminal-solved." With
	// only one terminal there is no Q or ground terminal for `logic-divider` to use even if I wanted
	// one, and giving this stray duplicate any nontrivial law would stamp the same physical divider's
	// loading on that node a second time on top of the real model above. Registered as `open` (no
	// element, matching its own "not terminal-solved" self-description) rather than left refusing,
	// since refusing here would block the whole packet on a component that contributes nothing the
	// real `uPD4013C6` shells don't already carry.
	{
		"partIds": [
			"uPD4013C1"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"firmware": {
			"firmwareClass": "fixed-function",
			"basis": [
				"CMOS dual D-type flip-flop: divide-by-two toggle transfer in the family documentation",
				"No CPU core, no program store; behaviour is a function of the clock/data nets and supply"
			]
		},
		"model": {
			"kind": "law",
			"law": {
				"kind": "open"
			}
		}
	},

// --- CD4024 7-stage binary counter, moogerfooger-mf-102's Q1 tap only (U6) ------------------------------------------------
	//
	// Not one of this lane's seven named parts, but the sole remaining blocker left on
	// `moogerfooger-mf-102` after the `4049` fix above: the packet's `U6` names PartNumber `"4024"`.
	// `U6` declares only 5 of the real 14 pins -- `pin1_CLK, pin2_RST, pin7_VSS, pin12_Q1, pin14_VDD`
	// -- i.e. just the clock, reset, supplies, and the *first* counter stage's output. A CD4024's
	// first stage is an ordinary toggle flip-flop (Q1 divides CLK by two, same as one CD4013 half),
	// so `logic-divider` fits exactly what this document actually traces; the six later ripple stages
	// are simply absent as terminals; nothing else declared in `U6` calls for them.
	//
	// Verified: `pin1_CLK`'s node is shared with `R41` (3.3M to the +9V rail), `C9`, and the `CN2`
	// STOMP-footswitch jack contacts -- exactly the "CLK pin 1 shares the CN2 STOMP node with R41
	// 3.3M and C9 10nF" wiring the packet's own README records for this chip. `pin12_Q1`'s node is the
	// same node `U3E`'s (the 4049 section modelling the bypass-indicator gate) `non_inverting`
	// terminal uses, matching the README's "Q1 pin 12 drives the U3E 4049 bypass-indicator chain."
	// `pin2_RST` ties to the document's ground node (reset held inactive), consistent with a counter
	// meant to free-run from the footswitch clock. Same thresholdVolts/highVolts as the existing
	// CD4013 entry: no CD4024-specific threshold value is available, and this is the same generic
	// CMOS logic-high assumption already used for that chip.
	{
		"partIds": [
			"4024"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "logic-divider",
						"thresholdVolts": 2,
						"highVolts": 5
					},
					"terminals": [
						0,
						3,
						2
					]
				}
			],
			"pinout": [
				"clk",
				"rst",
				"vss",
				"q1",
				"vdd"
			]
		}
	},

// --- LM340T-15 +15V linear regulator (mxr-m117r-flanger): ids and rail from registry-data/regulator.ts; wiring above ----
// The sole remaining blocker on `mxr-m117r-flanger` after the `CD4013AE` fix above: its `VR1`
// names PartNumber `LM340T-15`, an unregistered fixed +15V linear regulator. Same shape and same
// `voltage-source` law as the 78L05/78L09 entries (input/ground/output, output held at the
// regulator's fixed rail relative to ground) -- `VR1` declares exactly three terminals,
// `input, ground, output`, in that order, matching the regulator entries' `terminals: [2, 1]`
// (output relative to ground) convention directly.
	regulatorEntryForVolts(15),

// --- Tube rectifiers ------------------------------------------------------------------
	//
	// A vacuum rectifier drops tens of volts where a silicon diode drops less than one, and that
	// difference sets the whole amp's B+. Eight of the corpus's eleven tube rectifiers are declared
	// `kind: diode` while naming a tube part -- `fender-5e3-deluxe-tweed`'s `5Y3GT`,
	// `marshall-jtm45`'s and `fender-bassman`'s `GZ34`, `vox-ac15-top-boost`'s `5Y3WGTA` -- so they
	// were lowered as semiconductors and their rails sat at nearly the transformer's peak.
	//
	// **Perveance is derived from two printed figures, not fitted.** The law is
	// `I = perveance * V^1.5`, and `component-tube-rectifier-chips.json` states each part's forward
	// drop at a test current, so `perveance = I / V^1.5` follows by arithmetic on datasheet data:
	//
	//   5Y3GT   50 V at 0.125 A -> 3.536e-4   (and `typicalOperation` 360 V out at 125 mA)
	//   5U4GB   50 V at 0.275 A -> 7.778e-4
	//   GZ34    17 V at 0.250 A -> 3.567e-3   (indirectly heated, a far stiffer rectifier)
	//
	// The 5Y3 figure is worth noting: it reproduces `GENERIC_TUBE_DIODE`'s 3.54e-4 exactly, which
	// confirms that default is a 5Y3-class part -- and therefore that `GZ34`, ten times stiffer, was
	// wrong for the two packets already declaring `tube-diode` and getting the generic.
	//
	// Only ids the registry states, plus the aliases it states, appear here. `5Y3WGTA` and a bare
	// `5U4` are **absent on purpose**: neither is a registry entry nor a stated alias of one, and
	// matching them by their resemblance to `5Y3GT` and `5U4GB` would be exactly the part-number
	// string inference the diode path's own comment forbids. Those two need a registry entry with
	// cited figures, or a packet correction, before they can resolve.
	tubeLaw(["5Y3GT","5Y3"], {
		kind: "tube-diode",
		perveance: 0.00035355339059327376,
		exponent: 1.5,
	}),

	tubeLaw(["5U4GB"], {
		kind: "tube-diode",
		perveance: 0.0007778174593052024,
		exponent: 1.5,
	}),

	tubeLaw(["GZ34","5AR4"], {
		kind: "tube-diode",
		perveance: 0.0035667003681813677,
		exponent: 1.5,
	}),

// --- Tubes ---------------------------------------------------------------------------
	//
	// Koren coefficients, so a declared EL84 stops being lowered as the generic 6V6 fit. Every
	// value below is transcribed from `web/assets/registry/component-triode-chips.json` and
	// `component-power-tube-chips.json`, which carry a per-parameter `source` -- the citations are
	// quoted per entry and their strength differs sharply, so read them before trusting a claim
	// about a specific tube:
	//
	//   - **Triodes are fit to a published plate-characteristics chart.** RCA average-plate curves,
	//     refit here; `12AX7` was refit on a fixed train/holdout split. That is a real datasheet
	//     anchor.
	//   - **Power pentodes are a "Koren-style point calibration"**, not a chart fit, and the script
	//     that produced them (`scripts/check-tube-curves.ts`) was gone from the tree. Measured
	//     against the class-A point each entry itself states, all five run low by 26% to 34% --
	//     EL84 -29%, 6V6GT -31%, 6L6GC -26%, EL34 -26%, EF86 -34%. A deviation that consistent
	//     across five independently fit tubes reads as a mismatch between the fitting procedure and
	//     this law rather than five bad fits, and it is unexplained. They are far better than one
	//     shared 6V6 fit and are still not calibrated models. `scripts/check-tube-curves.ts` was
	//     rebuilt to report this gap rather than leave it asserted; it is the bound on any level
	//     claim about a specific tube.
	//
	// **Two things an entry does not change, both stated so the improvement is not overclaimed.**
	// Grid conduction (`gridSaturationCurrent`, `gridOnsetVolts`, `gridScaleVolts`) is absent from
	// the registry for every tube, so each entry reuses the same preamp-triode numbers the generic
	// laws use; power-tube grid conduction is the blocking-distortion mechanism, so overdrive
	// character stays uncalibrated after this. The plate knee is no longer a separate coefficient at
	// all: it is `kvb`, which each registry entry does state, after the gate was corrected to
	// Koren's `atan(Vp/Kvb)` -- see `PentodeLaw` in `types.ts`.
	//
	// A tube whose part number matches nothing here keeps its device-class default and is reported
	// by `findGenericTubeFits`. The corpus's `5881`, `KT66`, `5U4` and `GZ34` have registry entries
	// with no Koren coefficients at all, so they stay generic *and* visible rather than being given
	// a neighbouring tube's numbers.

	// 12AX7: RCA 12AX7-A average plate characteristics chart, page 3 (S1 fixed train/holdout refit, see scripts/check-tube-curves.ts).
	// ECC83 and 7025 share this fit on the registry's own numbers, not on their names: all three
	// entries state an identical `mu` 100, `transconductance` 0.002242 and `exponent` 1.4.
	//
	// **Replaced 2026-08-22.** The registry's own refit (`mu 100.29, kg1 1375.3, kp 2052,
	// kvb 9706.8, ex 1.0`) reads 23% low on plate current and 16% low on transconductance at RCA's
	// published typical point, and its `ex` of 1.0 and `kvb` of 9707 are far from physical for a
	// space-charge law. Both are what a fit must do when the law it is fitted against has no
	// `Vct` to absorb: measured, the set below lands at +2% and +3% *with* `Vct = 0.5` and at -58%
	// and -28% without it, so the term was never optional. See
	// `docs/audio-simulation-realism/tube-model-class-and-scale.md`.
	//
	// This is the widely-used published Koren 12AX7 set, quoted from Amperatubes' own worked
	// `.subckt` example at <https://amperatubes.com/learn/spice-simulation/>:
	// `mu=100.26 Ex=1.394 Kg1=1651.8 Kp=1000 Kvb=524 Vct=0.5`.
	tubeLaw(["12AX7","12AX7A","ECC83","7025"], {
		kind: "triode",
		mu: 100.26,
		kg1: 1651.8,
		kp: 1000,
		kvb: 524,
		ex: 1.394,
		...GENERIC_TUBE_GRID,
	}),

// 12AT7: RCA 12AT7 average plate characteristics chart, page 3.
	// ECC81 shares it on the same evidence -- both entries state `mu` 60 and `transconductance`
	// 0.0055.
	tubeLaw(["12AT7","ECC81"], {
		kind: "triode",
		mu: 60,
		kg1: 460,
		kp: 300,
		kvb: 300,
		ex: 1.35,
		...GENERIC_TUBE_GRID,
	}),

// 12AU7: RCA 12AU7A average plate characteristics chart, page 4.
	// ECC82 shares it on the same evidence -- both entries state `mu` 21.5.
	tubeLaw(["12AU7","12AU7A","ECC82"], {
		kind: "triode",
		mu: 21.5,
		kg1: 1180,
		kp: 84,
		kvb: 300,
		ex: 1.3,
		...GENERIC_TUBE_GRID,
	}),

// 12AY7: RCA 12AY7 average plate characteristics chart, page 3.
	tubeLaw(["12AY7"], {
		kind: "triode",
		mu: 44.16,
		kg1: 1192.4,
		kp: 409.96,
		kvb: 300,
		ex: 1.11,
		...GENERIC_TUBE_GRID,
	}),

// EL84: scripts/check-tube-curves.ts EL84 Koren-style point calibration. Cited class-A point: Va 250 V, Vg -7.3 V, Ia 0.048 A.
	tubeLaw(["EL84","6BQ5","EL84/6BQ5"], {
		kind: "pentode",
		mu: 21.29,
		kg1: 401.7,
		kp: 111.04,
		kvb: 17.9,
		ex: 1.24,
		...GENERIC_TUBE_GRID,
	}),

// 6V6GT: scripts/check-tube-curves.ts 6V6GT Koren-style point calibration. Cited class-A point: Va 250 V, Vg -12.5 V, Ia 0.045 A.
	tubeLaw(["6V6GT","6V6"], {
		kind: "pentode",
		mu: 12.67,
		kg1: 915,
		kp: 38.07,
		kvb: 30.2,
		ex: 1.198,
		...GENERIC_TUBE_GRID,
	}),

// 6L6GC: scripts/check-tube-curves.ts 6L6GC Koren-style point calibration. Cited class-A point: Va 250 V, Vg -14 V, Ia 0.072 A.
	tubeLaw(["6L6GC"], {
		kind: "pentode",
		mu: 13.9,
		kg1: 317.36,
		kp: 33.2,
		kvb: 54.79,
		ex: 1.06,
		...GENERIC_TUBE_GRID,
	}),

// EL34: scripts/check-tube-curves.ts EL34 Koren-style point calibration. Cited class-A point: Va 250 V, Vg -12.2 V, Ia 0.1 A.
	tubeLaw(["EL34"], {
		kind: "pentode",
		mu: 11.5,
		kg1: 622.47,
		kp: 51.8,
		kvb: 58.91,
		ex: 1.35,
		...GENERIC_TUBE_GRID,
	}),

// EF86: scripts/check-tube-curves.ts EF86 Koren-style point calibration. Cited class-A point: Va 250 V, Vg -2 V, Ia 0.003 A. Screen share = 0.2: the published A.F. point is Ia 3.0 mA with Ig2 0.6 mA (artifacts/parts/tubes/EF86.md), a 5:1 plate:screen split, so the screen draws 1/5 of the plate current (1/6 of the total cathode current).
	tubeLaw(["EF86","Z729","EF86/Z729"], {
		kind: "pentode",
		mu: 35.5,
		kg1: 2042.2,
		kp: 316,
		kvb: 12.7,
		ex: 1.05,
		screenShare: 0.2,
		...GENERIC_TUBE_GRID,
	}),

// --- Rohm / Roland BA634 5-pin comparator/chopper SIP-5 (boss-oc-2 IC6) -----------------------------------------------------
	// Pin 1 (IN), Pin 2 (OUT), Pin 3 (VEE), Pin 4 (GND), Pin 5 (RESET)
	{
		"partIds": [
			"BA634-5",
			"BA634",
			"BA-634"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "inverter",
						"transconductance": 0.001,
						"biasVolts": 0,
						"thresholdVolts": 2.5
					},
					"terminals": [
						0,
						1,
						3
					]
				}
			],
			"pinout": [
				"in",
				"out",
				"vee",
				"gnd",
				"reset"
			]
		}
	},

// --- Intersil ICL8038 Precision Waveform / Function Generator DIP-14 (ehx frequency analyzer U5) --------------------------
	{
		"partIds": [
			"ICL8038",
			"ICL8038CCPD"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "ac-source",
						"amplitudeVolts": 2,
						"frequencyHz": 440,
						"sourceOhms": 100
					},
					"terminals": [
						1,
						10
					]
				}
			],
			"pinout": [
				null,
				"sine_out",
				"triangle_out",
				null,
				null,
				"vpos",
				null,
				null,
				"square_out",
				"timing_cap",
				"vneg",
				null,
				null,
				null
			]
		}
	},

// --- Roland / Boss M74007 (BOS-0001) Pitch Shifter / Delay Gate Array (boss-ps-2) ---
	{
		"partIds": [
			"M74007",
			"M74007 (BOS-0001)",
			"BOS-0001"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "macro",
			"macro": {
				"modelId": "bucket-brigade-delay-line",
				"parameters": {
					"stages": 1024
				},
				"ports": {
					"audioIn": [
						"in",
						"ain",
						"data"
					],
					"audioOut": [
						"out",
						"aout",
						"dout"
					],
					"parameter": []
				},
				"barePinPositions": {
					"audioIn": 0,
					"audioOut": 1
				},
				"audioPortImpedanceOhms": {
					"input": 1000000000,
					"output": 400
				},
				"parameterReferenceVolts": 9
			}
		}
	},

// --- Boss TU-3 Panel CPU Presence Shell (boss-tu-3) ---
	// Source: Boss TU-3 service notes panel-board schematic. The panel CPU is a digital microcontroller
	// running opaque tuner/display firmware; it is admitted as a non-executable support shell (empty
	// sections) so the document compiles without fabricating a fictitious BBD delay line macro.
	{
		"partIds": [
			"UPD780034AY",
			"UPD780034",
			"source-visible TU-3 panel CPU"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [],
			"pinout": [
				null,
				null
			]
		}
	},

// --- Roland / Boss RDD63H101 Delay Processor DIP-64 (boss-dd-2, boss-dd-3 long chip, boss-dsd-2, boss-dsd-3) ---
	{
		"firmware": {
			"firmwareClass": "undetermined",
			"basis": [],
			"wouldBeDecidedBy": "The shared-silicon rule says NOTHING here and that is the point: RDD63H101 appears in boss-dd-2 and boss-dsd-3 and BOTH ARE DELAYS, so one effect kind and no evidence either way. A part already bound to a bucket-brigade macro staying undetermined is the right outcome and is evidence the rule is not just counting packets. Deciding it needs the DSD-3/DD-2 service documentation or a die photograph."
		},
		"partIds": [
			"RDD63H101"
		],
		"subsumesRefuted": [
			{
				"parts": ["M5K4164ANL-15", "RKM14L492-103F"],
				"refutedBy": "AND THE MECHANISM EXISTS IN THIS EXACT FAMILY, WHICH STRENGTHENS THE REFUTATION RATHER THAN WEAKENING IT: cross-device derivation is live in the bucket-brigade family, where seven macros derive their delay from their MN3101/MN3102 CLOCK DRIVER's catalog entry (boss-ce-2, ce-2b, ce-5, ch-1, dm-2, bf-2, dm-3), and boss-dm-2 comes out with delayProvenance 'derived'. So these nine claims are not refuted by an absent capability -- the capability is present, used, and NOT used by them. An absent mechanism would have been the weaker case. scripts/report-subsumption-mutant.ts -- mutating the subsumed device's part leaves `stages` and `delaySeconds` identical. `stages: 1024` is declared in this entry and is the MN3007's datasheet stage count -- a BORROWED number rather than a macro-wide default, since `stages` is genuinely part-specific across the corpus (MN3002 512, MN3008 2048, MN3005 4096). The RDD63H101 contains no bucket brigade, so 1024 is a choice recorded here, not a property of this silicon: boss-rv-6's Renesas reverb DSP resolved to the same macro with the same 1024 and a 64Mbit SDRAM rather than three 64Kx1 DRAMs. No formula from DRAM bits lands on 1024 stages of a device class the pedal does not contain.",
				"on": "2026-09-11"
			}
		],
		"proxy": {
			"standsFor": "Roland/Boss RDD63H101, a 64-pin microcode-driven DIGITAL delay processor (boss-dd-2, boss-dd-3 long chip, boss-dsd-2, boss-dsd-3). It is not a charge-transfer device and contains no bucket brigade.",
			"justification": "EVIDENCE BASE, so a reader of the table does not have to ask: this proxy is declared ONCE at the catalog and exercised on ONE of its two packets. boss-dd-2 carries the measurements below; boss-dsd-3 carries the same chip and renders SILENT (its macro resolves with audioIn: null and audioOut: false -- scheduled but wired to neither port), so none of these rows can be taken there. A fourth row claiming the microcode's mode behaviour was WITHDRAWN 2026-09-11 rather than labelled: no packet in the corpus exposes this chip's mode control, so nothing could falsify it, and keeping an unfalsifiable row in a field whose purpose is falsifiability is the same move we refused when nine subsumption claims were withdrawn the same afternoon. SCOPE: this proxy accounts for the RDD63H101 ALONE. It does NOT account for the DRAMs on its bus or the R2R ladder on its output -- a `subsumes` claim to that effect was made and withdrawn on 2026-09-11 when all nine such claims collapsed under the parameter mutant, because `stages` is a constant here and `delaySeconds` comes from the packet. Those devices are counted in the honesty gap, which went 4 to 11 when they returned. The audible product of this chip in these pedals is a delay line with a band-limited, noisy repeat, and `bucket-brigade-delay-line` reproduces that envelope at the pedal's analog boundary. The alternative is no model at all, which makes both packets silent -- trading a stated approximation for an unstated absence and destroying the information that these pedals delay at all. Declared rather than removed for that reason on 2026-09-11.",
			"doesNotReproduce": [
				{
					"claim": "the converter's quantisation floor -- this is an analog charge-transfer model and has no word length",
					"measurement": "measureSettled(program, 48000, zero input). USE THE SETTLE LADDER: zero input on boss-dd-2 needs 16 s to settle, and a hand-rolled 1.6 s render reports -155 dBFS instead of the true floor.",
					"standIn": "MEASURED 2026-09-11 on boss-dd-2: rms 4.395e-13, about -247 dBFS -- numerical zero, orders below any converter floor. A real converter model must place it near -6.02 x wordLength dBFS.",
					"status": "measured"
				},
				{
					"claim": "the companding law applied around the real converter",
					"measurement": "measureSettled at -40 dBFS and -10 dBFS drive (settles at 2.5 s); slope = 20*log10(loud/quiet)/30",
					"standIn": "MEASURED 2026-09-11 on boss-dd-2: 5.778e-3 and 1.827e-1, slope 1.000 dB/dB exactly. CONFIRMED BY MEASUREMENT, not by reading the code: a compander would not give 1.000, so this row is evidence rather than restatement.",
					"status": "measured"
				},
				{
					"claim": "anything the microcode does, including the DSD-3's sampler modes",
					"measurement": "sweep the chip's mode control through every position with measureSettled at each, and compare output rms",
					"standIn": "REGISTERED, UNRUN. Predicted: identical rms at every position, because the macro has parameter: null and modulation: null.",
					"status": "registered-unrun",
					"fixture": "a packet that BOTH exposes this chip's mode control AND renders audio. boss-dd-2 exposes only V1 and S1, a supply and a jack; boss-dsd-3 has the sampler modes and renders silent (its macro resolves audioIn: null, audioOut: false). Fixing dsd-3's macro ports would supply the fixture.",
					"expires": "2026-12-31"
				}
			],
			"structuralInvariants": [
				"The delay cannot track a clock: `delaySeconds` is fed from the packet's declared `DelayMs` and the macro resolves with `clockControl: null`, so time-of-first-energy equals `DelayMs` at every control position. MEASURED at 800.0 ms on boss-dd-2 -- and the measurement proves nothing, because it was true by construction before anyone ran it. Reclassified out of `doesNotReproduce` on 2026-09-11: its pass is not evidence, and a compiler check is its right home."
			]
		},
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"data"
			],
			[
				"dout"
			]
		],
		"model": {
			"kind": "macro",
			"macro": {
				"modelId": "bucket-brigade-delay-line",
				"parameters": {
					"stages": 1024
				},
				"ports": {
					"audioIn": [
						"data"
					],
					"audioOut": [
						"dout"
					],
					"parameter": []
				},
				"barePinPositions": {
					"audioIn": 0,
					"audioOut": 1
				},
				"audioPortImpedanceOhms": {
					"input": 1000000000,
					"output": 400
				},
				"parameterReferenceVolts": 9
			}
		}
	},

// --- Digital Support Chips (DRAM, Codecs, Microcontrollers, EEPROMs, Crystals, Supervisors, Regulators, DAC array networks) ---
	//
	// Registered `open` by **exact part id only**. This entry carried seventeen `declaredTypes`
	// until 2026-09-04 -- `Circuit.MemoryIC` through the format's generic `Circuit.IC` -- which made
	// it the catalog's catch-all: any chip the registry could not otherwise place was *identified as
	// this DRAM* and took its law. `boss-dd-3b`'s `SA571D` compandor and
	// `electro-harmonix-holy-grail`'s `CS4811` DSP both reported `partId: M12L64164A` with evidence
	// `exact-part`. A registry entry claiming a class it does not model is the wrong answer
	// `identify.ts` exists to refuse: "a wrong identity is worse than none".
	//
	// The graceful degradation those classes were really providing now lives where it can be stated
	// as itself and reported -- `classesOpenedWithoutModel` in `device-laws.ts`, which produces no
	// identity and is consulted only after a part-id lookup has already failed. Every component it
	// opens is named by an `ic-not-executed` warning.
	//
	// **Part ids another entry owns were removed 2026-09-04.** Seven of the seventy-two were also
	// claimed by a real model, and because this entry binds at any terminal count while a
	// `sections` entry binds only at its own, this one won whenever the arity did not fit:
	// `SA571D` (the NE570/SA571 compandor), `AK4552VT`/`AK4552VT13` (the codec's two op-amp
	// sections, which the catalog already carries at two separate pin counts),
	// `UPD780034`/`UPD780034AY` (the TU-3 panel CPU) and `4164`/`4164DRAM` (a duplicate of the
	// entry that already owns them). `boss-dd-3b`'s SA571D compandor was being opened as this
	// DRAM. A part number belongs to the entry that models the part; an arity that does not fit is
	// reported as `registry-arity-mismatch`, not resolved by falling back to a chip it is not.
	{
		"partIds": [
			"M37470M2-333SP"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "law",
			"law": {
				"kind": "open"
			}
		},
		"firmware": {
			"firmwareClass": "reprogrammable",
			"basis": [
				"Mitsubishi 740-family MCU. A documented instruction set means the mask holds a PROGRAM, which decides the class from the part number alone."
			]
		}
	},
	{
		"partIds": [
			"M37470M2-326SP"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "law",
			"law": {
				"kind": "open"
			}
		},
		"firmware": {
			"firmwareClass": "reprogrammable",
			"basis": [
				"Mitsubishi 740-family MCU -- documented instruction set."
			]
		}
	},
	{
		"partIds": [
			"M37470E4-161SP"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "law",
			"law": {
				"kind": "open"
			}
		},
		"firmware": {
			"firmwareClass": "reprogrammable",
			"basis": [
				"Mitsubishi 740-family MCU -- documented instruction set. The E4 suffix is the EPROM variant, which is field-programmability stated in the part number."
			]
		}
	},
	{
		"partIds": [
			"M37470M2-245SP"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "law",
			"law": {
				"kind": "open"
			}
		},
		"firmware": {
			"firmwareClass": "reprogrammable",
			"basis": [
				"Mitsubishi 740-family MCU -- documented instruction set."
			]
		}
	},
	{
		"partIds": [
			"UPD780034AGK-B10-9ET"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "law",
			"law": {
				"kind": "open"
			}
		},
		"firmware": {
			"firmwareClass": "reprogrammable",
			"basis": [
				"NEC 78K/0 MCU -- documented instruction set."
			]
		}
	},
	{
		"partIds": [
			"UPD780034AGK-B0"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "law",
			"law": {
				"kind": "open"
			}
		},
		"firmware": {
			"firmwareClass": "reprogrammable",
			"basis": [
				"NEC 78K/0 MCU -- documented instruction set."
			]
		}
	},
	{
		"partIds": [
			"MN101C427BS"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "law",
			"law": {
				"kind": "open"
			}
		},
		"firmware": {
			"firmwareClass": "reprogrammable",
			"basis": [
				"Panasonic MN101C 8-bit MCU core -- documented instruction set."
			]
		}
	},
	{
		"partIds": [
			"MN101C427RH"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "law",
			"law": {
				"kind": "open"
			}
		},
		"firmware": {
			"firmwareClass": "reprogrammable",
			"basis": [
				"Panasonic MN101C 8-bit MCU core -- documented instruction set."
			]
		}
	},
	{
		"partIds": [
			"CS4811"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "law",
			"law": {
				"kind": "open"
			}
		},
		"firmware": {
			"firmwareClass": "reprogrammable",
			"basis": [
				"Cirrus DSP that boots its program from an external serial EEPROM. AN EXTERNAL PROGRAM STORE IS THE PROTOCOL'S OWN DECISIVE CRITERION -- not an inference from a part number -- and electro-harmonix-holy-grail's record states the arrangement explicitly."
			]
		}
	},
	{
		"partIds": [
			"25LC640ISN"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "law",
			"law": {
				"kind": "open"
			}
		},
		"firmware": {
			"firmwareClass": "reprogrammable",
			"basis": [
				"The serial EEPROM itself: not a processor, but the external program store the CS4811 loads from. Blocked for the IMAGE IT HOLDS rather than for any behaviour of its own."
			]
		}
	},
	{
		"partIds": [
			"TC25SC080AU-104"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "law",
			"law": {
				"kind": "open"
			}
		},
		"firmware": {
			"firmwareClass": "reprogrammable",
			"basis": [
				"SHARED SILICON, decided by the corpus itself: this exact code appears in boss-dd-5 (delay), boss-rv-3 (reverb) and boss-hr-2 (pitch/harmonist). No fixed-function mask is a delay AND a reverb AND a pitch shifter. Direct behavioural evidence, not an inference from a part-number family."
			]
		}
	},
	{
		"partIds": [
			"TC220CCA0AF-B01"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "law",
			"law": {
				"kind": "open"
			}
		},
		"firmware": {
			"firmwareClass": "reprogrammable",
			"basis": [
				"SHARED SILICON: this exact code, including the (MR3) mask revision, appears in boss-oc-3 (octave/pitch), boss-rv-5 (reverb) and boss-bf-3 (flanger), plus the boss-syb5 seed (bass synth) and -- per rv-5's own sources/crossref/boss-dd-20-tc220-mr3-crossref.md -- the DD-20 (delay). Five effects differing in kind behind one mask revision."
			]
		}
	},
	{
		"partIds": [
			"TC220CCA0AF-B01(MR3)"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "law",
			"law": {
				"kind": "open"
			}
		},
		"firmware": {
			"firmwareClass": "reprogrammable",
			"basis": [
				"SHARED SILICON: see TC220CCA0AF-B01. The full code INCLUDING the mask revision matches across every packet, which is what carries the argument -- a differing suffix would weaken it to nothing, because a mask option can change behaviour."
			]
		}
	},
	{
		"partIds": [
			"TC220C040AF-001"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "law",
			"law": {
				"kind": "open"
			}
		},
		"firmware": {
			"firmwareClass": "undetermined",
			"basis": [
				"Toshiba CMOS gate array, customer mask code."
			],
			"wouldBeDecidedBy": "Service-note block diagram or die photo. boss-ph-3's record already cites a service note; whether that note contains an internal diagram is the cheapest thing to check first."
		}
	},
	{
		"partIds": [
			"MN51010RBA"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "law",
			"law": {
				"kind": "open"
			}
		},
		"firmware": {
			"firmwareClass": "undetermined",
			"basis": [
				"Panasonic custom gate array carrying a BOS- mask code. The mask decides and the part number does not report it."
			],
			"wouldBeDecidedBy": "The DD-3 service note's internal description, or a die photograph. The BOS-008 mask code is a Boss part designation, so Roland documentation is the route."
		}
	},
	{
		"partIds": [
			"UPD800402GJ-211-UEN-A(ESC)"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "law",
			"law": {
				"kind": "open"
			}
		},
		"firmware": {
			"firmwareClass": "reprogrammable",
			"basis": [
				"SHARED SILICON: same silicon as UPD800402GJ-211, whose packets span gain and reverb."
			]
		}
	},
	{
		"partIds": [
			"UPD800402GJ-211"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "law",
			"law": {
				"kind": "open"
			}
		},
		"firmware": {
			"firmwareClass": "reprogrammable",
			"basis": [
				"SHARED SILICON: appears in boss-st-2 (Power Stack -- gain/distortion) and boss-rv-6 (reverb). Two effect kinds behind one part code. This one was NOT decidable from the part-number family and the corpus decided it."
			]
		}
	},
	{
		"partIds": [
			"M12L64164A",
			"M12L64164A-7T",
			"AK4556VT",
			"AK4556VT-B2",
			"M24M01",
			"M24M01-RMN6TP",
			"BR24L02",
			"BR24L02FJ-WE2",
			"M24512",
			"S-8520E33ML-BJS",
			"S-80130ALMC-JAP-T2",
			"TC220C020AF",
			"TC220C020",
			"TC220C020AF-001",
			"MN101C427",
			"UDA1340M",
			"UDA1344TS",
			"MN51010",
			"LC8390M",
			"MA506",
			"11.2896 MHz crystal",
			"DSX321G",
			"BD45301G-TR",
			"M5K4164ANL-15",
			"M5K4164ANL",
			"M5K4164",
			"MN41C4256ASJ-07SLZ",
			"M5M44256BJ",
			"M5M4464L-12",
			"M5M4464L",
			"M11B416256A-35J(T)",
			"M11B416256A",
			"RKM14L492-103F",
			"RKM14L492",
			"RKM14L472-942F",
			"RKM14L472",
			"R2R_DAC",
			"CRN34103J",
			"DSS306-55FZ103N",
			"RH03ADC13X",
			"TC25SC080AU_104",
			"M37470",
			"MN51010RBA BOS-008",
			"BD45301G",
			"S-80830CLMC",
			"S-80830",
			"BD9851EFV-E2",
			"BD9851EFV",
			"BD9701FP",
			"TC7W04FK(TE85L/F)",
			"TC7W04FK",
			"BD45431G-TR",
			"BD45431G",
			"ESB16.9344F16D35F",
			"M24512-RMN6TP",
			"AK4552VT2"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "law",
			"law": {
				"kind": "open"
			}
		}
	},
	{
		"partIds": [
			"UPD6379GR"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "law",
			"law": {
				"kind": "open"
			}
		},
		"converter": {
			"direction": "dac",
			"fullScaleVoltsPeakToPeak": 2.0,
			"basis": "NEC uPD6379 datasheet, ELECTRICAL CHARACTERISTICS (TA = 25 C, VDD = +5 V, fS = 176.4 kHz): full-scale output voltage VFS 2.0 Vp-p typ, 2.3 max. The typical value. Copy at wiki.console5.com/wiki/UPD6379, sha256 de319a36f88a8a1db11f2e6b90408dab297c4a4f178ec09e5117d98d8460621a. The 3.3 V uPD6379L is a different ordering code (1.32 Vp-p). Pinout (console5 UPD6379-pinout.png): uPD6379GR pin 1 LRCK, 2 SI, 3 CLK, 4 VDD, 5 R.OUT, 6 REF, 7 GND, 8 L.OUT; the uPD6379AGR reverses it."
		}
	},
	{
		"partIds": [
			"AK5345-VS"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "law",
			"law": {
				"kind": "open"
			}
		},
		"converter": {
			"direction": "adc",
			"fullScaleVoltsPeakToPeak": null,
			"basis": "AKM product catalog, page 46, vendored at artifacts parts/dsp-audio/AK5345-VS/60d17e5f-c6fc-4bce-8acb-d5e5f7949a54.pdf (one page, sha256 f88d1baacfa63d8e7df305e1b2e47cdefa479eddeaac6231c9bf731a59830e2a): AK5345 is a 16-bit 2-channel 4th-order delta-sigma A/D converter, +5.0 V single supply (4.5 to 5.5 V), 64x oversampling, on-chip voltage reference, compatible with AK5343 and AK5344. The page states no analog input full scale. The datasheet was not obtained: alldatasheet and datasheets360 refuse automated fetches (403), datasheetarchive and datasheet4u have no copy (404), a PDF indexed as the AK5345 datasheet is a power-cord drawing, and the AK5343/AK5344 datasheets lead to the same sites. The boss-dd-5 packet record reports the same. Search exhausted (Joseph, 2026-09-23): the part is discontinued and no further source is expected, so this full scale stays uncited."
		}
	},
	{
		// Toshiba RN1307: an NPN bias-resistor built-in transistor (BRT). Toshiba's product page
		// (toshiba.semicon-storage.com, detail.RN1307) states R1, the series base resistor, 10 kOhm
		// and R2, base to emitter, 47 kOhm. The transistor is the class default silicon NPN; only the
		// two resistors are part-specific. Index 3 is the package's internal base.
		"partIds": [
			"RN1307"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"base",
				"b"
			],
			[
				"collector",
				"c"
			],
			[
				"emitter",
				"e"
			]
		],
		"model": {
			"kind": "sections",
			"pinout": [
				"base",
				"collector",
				"emitter"
			],
			"sections": [
				{
					"law": {
						"kind": "bjt",
						"polarity": "npn",
						"saturationCurrent": 1e-14,
						"forwardBeta": 100,
						"reverseBeta": 1,
						"thermalVoltage": 0.025852,
						"leakageAmps": 0
					},
					"terminals": [
						3,
						1,
						2
					]
				},
				{
					"law": {
						"kind": "conductance",
						"siemens": 0.0001
					},
					"terminals": [
						0,
						3
					]
				},
				{
					"law": {
						"kind": "conductance",
						"siemens": 0.00002127659574468085
					},
					"terminals": [
						3,
						2
					]
				}
			]
		}
	},

	// Wave-1 op-amp entries: sections whose gain-bandwidth product the data registry
	// stamps (see `registry-data/opamp.ts` and `withDatasheetGainBandwidth` below). The
	// open-loop gain is the sheet's own TYP AOL transcribed; the swing pair is deliberately
	// absent (owner D4 freeze, upheld for this wave).

	// TI LM833 dual audio op-amp, from `parts/op-amps/LM833/datasheets/lm833-ti.pdf` (TI
	// SLOS481B, rev Oct 2014). Pin diagram and Pin Functions table, 6 p3 (D/SOIC, DGK/MSOP
	// and P/PDIP packages, TOP VIEW): 1 OUT1, 2 IN1-, 3 IN1+, 4 VCC-, 5 IN2+, 6 IN2-,
	// 7 OUT2, 8 VCC+ -- the standard dual order, read off the sheet's own table, with the
	// same pin-numbered role convention as the 4558 entry above (pin-numbered tokens only;
	// no generic alias may satisfy two sections at once).
	//
	// Electrical characteristics 7.5/7.6 p5 at VCC+- = +-15 V, TA = 25 C:
	//   Large-signal differential voltage amplification AVD, RL >= 2 kOhm, VO = +-10 V:
	//   MIN 90 TYP 110 dB. Used as `openLoopGain: decibelGain(110)`, the typ figure.
	// GBW is not in this entry: it lives in the data-registry row (TYP 16 MHz at f = 100 kHz),
	// stamped by the pass below. Wave 4: LM833N rides this entry for open-loop gain
	// (TI LM833-N sheet SNOSBD8E prints LM833N/NOPB as the PDIP orderable of the same
	// die with the same AV 110 dB TYP) but carries its own GBW row: the LM833-N sheet
	// prints GBW TYP 15 MHz, not the LM833 sheet's 16, so the pass splits the entry.
	{
		"partIds": [
			"LM833",
			"LM833N"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"OUT_A_pin1"
			],
			[
				"INVERTING_A_pin2"
			],
			[
				"NONINVERTING_A_pin3"
			],
			[
				"V_MINUS_pin4"
			],
			[
				"NONINVERTING_B_pin5"
			],
			[
				"INVERTING_B_pin6"
			],
			[
				"OUT_B_pin7"
			],
			[
				"V_PLUS_pin8"
			]
		],
		"model": {
			"kind": "sections",
			"pinout": [
				"OUT_A",
				"IN_A_MINUS",
				"IN_A_PLUS",
				"VEE",
				"IN_B_PLUS",
				"IN_B_MINUS",
				"OUT_B",
				"VCC"
			],
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 316227.7660168379
					},
					"terminals": [
						2,
						1,
						0
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 316227.7660168379
					},
					"terminals": [
						4,
						5,
						6
					]
				}
			]
		}
	},

	// Wave-3 op-amp entries: sections whose open-loop gain is the sheet's own TYP AOL
	// transcribed (the gain-bandwidth product lives in `registry-data/opamp.ts`, stamped by
	// the passes below; the swing pair stays absent per the D4 freeze). GBW rows and catalog
	// entries are 1:1 by part id, so no entry splits. LM1458/N carry AOL only (no GBW row
	// exists; see `opampGainBandwidthAbsent`).

	// NJR NJM4580 dual audio op-amp, from `parts/op-amps/JRC4580/datasheets/njm4580d-njr.pdf`
	// (NJR Ver. 2012-09-14). PIN FUNCTION table, p1 (DIP-8 TOP VIEW): 1 A OUTPUT, 2 A -INPUT,
	// 3 A +INPUT, 4 V-, 5 B +INPUT, 6 B -INPUT, 7 B OUTPUT, 8 V+ -- the standard dual order,
	// with the same pin-numbered role convention as the LM833 entry above (pin-numbered
	// tokens only; no generic alias may satisfy two sections at once).
	//
	// Electrical characteristics p2 at V+/V- = +-15 V, Ta = 25 C:
	//   Voltage Gain AV, RL >= 2 kOhm, VO = +-10 V: MIN 90 TYP 110 dB.
	// Used as `openLoopGain: decibelGain(110)`, the typ figure (the D rank changes the noise
	// row only). The JRC ids rest on `parts/op-amps/JRC4580.md` ('JRC4580D / NJM4580D',
	// primary local datasheet this sheet) -- the JRC4558D precedent (owner decision
	// 2026-10-15: the NJR/JRC marking rides the NJM sheet). GBW is not in this entry: it
	// lives in the data-registry row (TYP 15 MHz at f = 10 kHz), stamped by the pass below.
	{
		"partIds": [
			"JRC4580D",
			"JRC4580",
			"NJM4580D",
			"NJM4580"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"OUT_A_pin1"
			],
			[
				"INVERTING_A_pin2"
			],
			[
				"NONINVERTING_A_pin3"
			],
			[
				"V_MINUS_pin4"
			],
			[
				"NONINVERTING_B_pin5"
			],
			[
				"INVERTING_B_pin6"
			],
			[
				"OUT_B_pin7"
			],
			[
				"V_PLUS_pin8"
			]
		],
		"model": {
			"kind": "sections",
			"pinout": [
				"OUT_A",
				"IN_A_MINUS",
				"IN_A_PLUS",
				"VEE",
				"IN_B_PLUS",
				"IN_B_MINUS",
				"OUT_B",
				"VCC"
			],
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 316227.7660168379
					},
					"terminals": [
						2,
						1,
						0
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 316227.7660168379
					},
					"terminals": [
						4,
						5,
						6
					]
				}
			]
		}
	},

	// TI OPA2134 dual audio op-amp, from `parts/op-amps/OPA2134/datasheets/opa2134-ti.pdf`
	// (TI SBOS058B, Dec 1997, Rev. B Nov 2024). Table 4-1 Pin Functions: OPA2134, p3 (D/SOIC
	// and P/PDIP 8-pin, top view Fig. 4-2): OUT A-1, -IN A-2, +IN A-3, V--4, +IN B-5, -IN B-6,
	// OUT B-7, V+-8 -- the standard dual order, same pin-numbered role convention.
	// OPA2134PA is a printed PDIP-8 orderable of the same die (orderable table, marking
	// OPA2134PA); the specs below are family-wide with no per-orderable split.
	//
	// Electrical characteristics 5.7 p7 at TA = 25 C, VS = +-15 V:
	//   AOL Open-loop voltage gain, RL = 2 kOhm, -13.8 V <= VO <= 13.5 V:
	//   MIN 104 TYP 120 dB (a second row at RL = 10 kOhm reads the same 104/120).
	// Used as `openLoopGain: decibelGain(120)`, the typ figure. GBW is not in this entry:
	// it lives in the data-registry row (TYP 8 MHz), stamped by the pass below.
	{
		"partIds": [
			"OPA2134",
			"OPA2134PA"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"OUT_A_pin1"
			],
			[
				"INVERTING_A_pin2"
			],
			[
				"NONINVERTING_A_pin3"
			],
			[
				"V_MINUS_pin4"
			],
			[
				"NONINVERTING_B_pin5"
			],
			[
				"INVERTING_B_pin6"
			],
			[
				"OUT_B_pin7"
			],
			[
				"V_PLUS_pin8"
			]
		],
		"model": {
			"kind": "sections",
			"pinout": [
				"OUT_A",
				"IN_A_MINUS",
				"IN_A_PLUS",
				"VEE",
				"IN_B_PLUS",
				"IN_B_MINUS",
				"OUT_B",
				"VCC"
			],
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 1000000
					},
					"terminals": [
						2,
						1,
						0
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 1000000
					},
					"terminals": [
						4,
						5,
						6
					]
				}
			]
		}
	},

	// TI LM1458 dual op-amp, from `parts/op-amps/LM1458/datasheets/lm1458.pdf` (TI SNOSBU4D,
	// Apr 1998, Rev. D Mar 2013, ex-National; NOT the ST sheet `MC1458.md` points at).
	// Connection Diagram Fig. 2 Dual-In-Line Package (Top View), p1: 1 OUTPUT A,
	// 2 INVERTING INPUT A, 3 NON-INVERTING INPUT A, 4 V-, 5 NON-INVERTING INPUT B,
	// 6 INVERTING INPUT B, 7 OUTPUT B, 8 V+ -- the standard dual order, same pin-numbered
	// role convention. LM1458N is printed (Abs Max 'LM1458N 400 mW' p2; orderables
	// LM1458N/NOPB p5, PDIP-8); the AC specs sit under the generic LM1458 column, which
	// covers it (the CA1458 entry above is the neighbouring point not jumped to: Harris
	// 200,000 vs TI 160,000 for the same row, so this comes from the document that names
	// LM1458).
	//
	// Electrical characteristics p2 at TA = 25 C, VS = +-15 V, VOUT = +-10 V, RL >= 2 kOhm:
	//   Large Signal Voltage Gain: LM1458 MIN 20 TYP 160 V/mV (LM1558 50/160 is the sibling
	//   column). Used as `openLoopGain: 160000`, the typ figure. The sheet prints no GBW row
	//   at all (see `opampGainBandwidthAbsent`); the swing pair stays absent per the D4 freeze
	//   (see `opampOutputSwingAbsent`).
	{
		"partIds": [
			"LM1458",
			"LM1458N"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"OUT_A_pin1"
			],
			[
				"INVERTING_A_pin2"
			],
			[
				"NONINVERTING_A_pin3"
			],
			[
				"V_MINUS_pin4"
			],
			[
				"NONINVERTING_B_pin5"
			],
			[
				"INVERTING_B_pin6"
			],
			[
				"OUT_B_pin7"
			],
			[
				"V_PLUS_pin8"
			]
		],
		"model": {
			"kind": "sections",
			"pinout": [
				"OUT_A",
				"IN_A_MINUS",
				"IN_A_PLUS",
				"VEE",
				"IN_B_PLUS",
				"IN_B_MINUS",
				"OUT_B",
				"VCC"
			],
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 160000
					},
					"terminals": [
						2,
						1,
						0
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 160000
					},
					"terminals": [
						4,
						5,
						6
					]
				}
			]
		}
	},

	// Wave-4 op-amp entries: sections whose open-loop gain is the sheet's own TYP AOL
	// transcribed (the gain-bandwidth product lives in `registry-data/opamp.ts`, stamped by
	// the passes below; the swing pair stays absent per the D4 freeze). GBW rows and catalog
	// entries are 1:1 by part id, so no entry splits. LM308 and UA741CP carry AOL only (no
	// GBW row exists; see `opampGainBandwidthAbsent`).

	// TI LM108/LM208/LM308 single precision op-amp, from SNOSBS5A (May 2004, rev Sept
	// 2011, OBSOLETE): 5.x Electrical Characteristics (TA = 25C, VS = +-15 V, VOUT = +-10 V,
	// RL >= 10 kOhm): 'Large Signal Voltage Gain | MIN 50 (LM108/208) / 25 (LM308) |
	// TYP 300 | V/mV'. Used as `openLoopGain: 300000`. No GBW row is transcribed (the
	// sheet prints compensation values and open-loop response graphs only; the Fig. 6
	// 250 kHz/3.5 MHz numbers belong to the LM101A-boosted application circuit).
	// Pinout: Figure 8 Dual-In-Line Package Top View (8-Pin) p11 (1 COMP, 2 INPUT-,
	// 3 INPUT+, 4 V-, 5 NC, 6 OUTPUT, 7 V+, 8 COMP 2); the entry keeps the LF351
	// three-terminal capture (IN+ pin3, IN- pin2, OUT pin6), which is the same
	// LM741-compatible single layout.
	{
		"partIds": [
			"LM308"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"vin+",
				"in+",
				"pin3"
			],
			[
				"vin-",
				"in-",
				"pin2"
			],
			[
				"vout",
				"out",
				"pin6"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 300000
					},
					"terminals": [
						0,
						1,
						2
					]
				}
			],
			"pinout": [
				"vin+",
				"vin-",
				"vout"
			]
		}
	},

	// TI LM324 quad op-amp, from SLOS066AE (Aug 1975, rev Sept 2025): 6.7 Electrical
	// Characteristics for LM324/LM324K (VCC = 15 V, VO = 1 V to 11 V, RL >= 2 kOhm, 25C):
	// 'Large-signal differential voltage amplification AVD | MIN 25 TYP 100 | V/mV'.
	// Used as `openLoopGain: 100000`. GBW is not in this entry: it lives in the
	// data-registry row (B1 unity-gain bandwidth TYP 1.2 MHz, 6.10 Operating Conditions),
	// stamped by the pass below. Pinout: Table 5-1 Pin Functions N (PDIP) p3, the
	// standard quad order (1OUT, 1IN-, 1IN+, VCC+, 2IN+, 2IN-, 2OUT, 3OUT, 3IN-, 3IN+,
	// VCC-, 4IN+, 4IN-, 4OUT), same A/B/C/D convention as the TL074 entry above.
	{
		"partIds": [
			"LM324"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"OUT_A_pin1"
			],
			[
				"INVERTING_A_pin2"
			],
			[
				"NONINVERTING_A_pin3"
			],
			[
				"V_PLUS_pin4"
			],
			[
				"NONINVERTING_B_pin5"
			],
			[
				"INVERTING_B_pin6"
			],
			[
				"OUT_B_pin7"
			],
			[
				"OUT_C_pin8"
			],
			[
				"INVERTING_C_pin9"
			],
			[
				"NONINVERTING_C_pin10"
			],
			[
				"V_MINUS_pin11"
			],
			[
				"NONINVERTING_D_pin12"
			],
			[
				"INVERTING_D_pin13"
			],
			[
				"OUT_D_pin14"
			]
		],
		"model": {
			"kind": "sections",
			"pinout": [
				"OUT_A",
				"IN_A_MINUS",
				"IN_A_PLUS",
				"VCC",
				"IN_B_PLUS",
				"IN_B_MINUS",
				"OUT_B",
				"OUT_C",
				"IN_C_MINUS",
				"IN_C_PLUS",
				"VEE",
				"IN_D_PLUS",
				"IN_D_MINUS",
				"OUT_D"
			],
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						2,
						1,
						0
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						4,
						5,
						6
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						9,
						8,
						7
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						11,
						12,
						13
					]
				}
			]
		}
	},

	// TI uA741C single op-amp in the PDIP-8 UA741CP orderable, from SLOS094H (Nov 1970,
	// rev Feb 2026): 5.4 Electrical Characteristics uA741C (VCC+- = +-15 V, VO = +-10 V,
	// RL >= 2 kOhm, 25C): 'Large-signal differential voltage amplification AVD |
	// MIN 20 TYP 200 | V/mV'. Used as `openLoopGain: 200000`. The sheet prints the
	// orderable as UA741CP (PDIP P|8) and the device table as uA741CP; the ASCII id is
	// the orderable spelling. No GBW row is transcribed (switching tables print only
	// rise time, overshoot and SR). Pinout: Figure 4-2 D-or-P 8-pin Top View + Table 4-2
	// Pin Functions p3 (1 NC, 2 IN-, 3 IN+, 4 VCC-, 5 NC, 6 OUT, 7 VCC+, 8 NC); the entry
	// keeps the LF351 three-terminal capture (IN+ pin3, IN- pin2, OUT pin6).
	{
		"partIds": [
			"UA741CP"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"vin+",
				"in+",
				"pin3"
			],
			[
				"vin-",
				"in-",
				"pin2"
			],
			[
				"vout",
				"out",
				"pin6"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 200000
					},
					"terminals": [
						0,
						1,
						2
					]
				}
			],
			"pinout": [
				"vin+",
				"vin-",
				"vout"
			]
		}
	},

	// TI TLC2262 dual LinCMOS op-amp, from SLOS177D (Feb 1997, rev Mar 2001): TLC2262C
	// operating characteristics (VDD+- = +-5 V, the 10 V table closest to a 9 V pedal):
	// 'Large-signal differential voltage amplification, RL = 50 kOhm, VO = +-4 V:
	// MIN 80 TYP 200 V/mV'. Used as `openLoopGain: 200000`. Coordinator standing rule
	// 2026-10-19: the bare id the sheet names in its description takes the commercial (C)
	// grade column, disclosed here; no suffixed grade is aliased. GBW is not in this
	// entry: it lives in the data-registry row (TYP 0.73 MHz, same table), stamped by the
	// pass below. Pinout: D/P/PW 8-pin Top View p3, the standard dual order
	// (1OUT, 1IN-, 1IN+, VDD-/GND, 2IN+, 2IN-, 2OUT, VDD+), same A/B convention as the
	// LM833 entry above.
	{
		"partIds": [
			"TLC2262"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"OUT_A_pin1"
			],
			[
				"INVERTING_A_pin2"
			],
			[
				"NONINVERTING_A_pin3"
			],
			[
				"V_MINUS_pin4"
			],
			[
				"NONINVERTING_B_pin5"
			],
			[
				"INVERTING_B_pin6"
			],
			[
				"OUT_B_pin7"
			],
			[
				"V_PLUS_pin8"
			]
		],
		"model": {
			"kind": "sections",
			"pinout": [
				"OUT_A",
				"IN_A_MINUS",
				"IN_A_PLUS",
				"VEE",
				"IN_B_PLUS",
				"IN_B_MINUS",
				"OUT_B",
				"VCC"
			],
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 200000
					},
					"terminals": [
						2,
						1,
						0
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 200000
					},
					"terminals": [
						4,
						5,
						6
					]
				}
			]
		}
	},

	// onsemi MC33174 quad op-amp, from MC33171/D Rev. 14 Jul 2025: DC table (VCC = +15 V,
	// VEE = -15 V, RL to ground, TA = 25C) p3: 'Large Signal Voltage Gain (VO = +-10 V,
	// RL = 10 k), AVOL MIN 50 TYP 500 V/mV'. Used as `openLoopGain: 500000`. GBW is not
	// in this entry: it lives in the data-registry row (TYP 1.8 MHz at f = 100 kHz, AC
	// table p4), stamped by the pass below. Pinout: PIN CONNECTIONS quad diagram p2
	// incl. PDIP-14 (Output 1 = 1, Inputs 1, VCC, Inputs 2, Output 2, Output 3,
	// Inputs 3, VEE, Inputs 4, Output 4), the standard quad order, same A/B/C/D
	// convention as the TL074 entry.
	{
		"partIds": [
			"MC33174"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"OUT_A_pin1"
			],
			[
				"INVERTING_A_pin2"
			],
			[
				"NONINVERTING_A_pin3"
			],
			[
				"V_PLUS_pin4"
			],
			[
				"NONINVERTING_B_pin5"
			],
			[
				"INVERTING_B_pin6"
			],
			[
				"OUT_B_pin7"
			],
			[
				"OUT_C_pin8"
			],
			[
				"INVERTING_C_pin9"
			],
			[
				"NONINVERTING_C_pin10"
			],
			[
				"V_MINUS_pin11"
			],
			[
				"NONINVERTING_D_pin12"
			],
			[
				"INVERTING_D_pin13"
			],
			[
				"OUT_D_pin14"
			]
		],
		"model": {
			"kind": "sections",
			"pinout": [
				"OUT_A",
				"IN_A_MINUS",
				"IN_A_PLUS",
				"VCC",
				"IN_B_PLUS",
				"IN_B_MINUS",
				"OUT_B",
				"OUT_C",
				"IN_C_MINUS",
				"IN_C_PLUS",
				"VEE",
				"IN_D_PLUS",
				"IN_D_MINUS",
				"OUT_D"
			],
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 500000
					},
					"terminals": [
						2,
						1,
						0
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 500000
					},
					"terminals": [
						4,
						5,
						6
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 500000
					},
					"terminals": [
						9,
						8,
						7
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 500000
					},
					"terminals": [
						11,
						12,
						13
					]
				}
			]
		}
	},

	// Wave-5 op-amp entries: sections whose open-loop gain is the sheet's own TYP AOL
	// transcribed (the gain-bandwidth product lives in `registry-data/opamp.ts`, stamped by
	// the passes below; the swing pair stays absent per the D4 freeze). GBW rows and catalog
	// entries are 1:1 by part id, so no entry splits. TL072C carries AOL only (no single
	// GBW figure exists; see `opampGainBandwidthAbsent`).

	// TI TL072C dual JFET-input op-amp, from SLOS080W (Sep 1978, rev Jul 2025): 5.8 DC
	// (VS = +-15 V, TA = 25C, VO = 0 V): 'AOL | Open-loop voltage gain | TL07xC |
	// MIN 25 TYP 200 V/mV'. Used as `openLoopGain: 200000` (bare id takes the commercial
	// C-grade column, disclosed; no suffixed alias). Pinout: Table 4-3 Pin Functions
	// TL072x (1 1OUT, 2 1IN-, 3 1IN+, 4 VCC-, 5 2IN+, 6 2IN-, 7 2OUT, 8 VCC+), the
	// standard dual order, same pin-numbered role convention as the NJM4580 entry.
	{
		"partIds": [
			"TL072C"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"OUT_A_pin1"
			],
			[
				"INVERTING_A_pin2"
			],
			[
				"NONINVERTING_A_pin3"
			],
			[
				"V_MINUS_pin4"
			],
			[
				"NONINVERTING_B_pin5"
			],
			[
				"INVERTING_B_pin6"
			],
			[
				"OUT_B_pin7"
			],
			[
				"V_PLUS_pin8"
			]
		],
		"model": {
			"kind": "sections",
			"pinout": [
				"OUT_A",
				"IN_A_MINUS",
				"IN_A_PLUS",
				"VEE",
				"IN_B_PLUS",
				"IN_B_MINUS",
				"OUT_B",
				"VCC"
			],
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 200000
					},
					"terminals": [
						2,
						1,
						0
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 200000
					},
					"terminals": [
						4,
						5,
						6
					]
				}
			]
		}
	},

	// TI OPA1678 dual audio op-amp, from SBOS855E (Jan 2017 - Dec 2022): 6.7 Electrical
	// Characteristics (VS = +-15 V, TA = 25C, RL = 2 kOhm, VCM = VOUT = midsupply):
	// 'AOL | Open-loop voltage gain | (V-) + 0.8 V <= VO <= (V+) - 0.8 V | MIN 106
	// TYP 114 | dB'. Used as `openLoopGain: decibelGain(114)` = 501187.2336272725.
	// GBW lives in the data-registry row (TYP 16 MHz at G = 1). Pinout: 5 Pin
	// Configuration and Functions, Pin Functions OPA1678 (OUT A-1, -IN A-2, +IN A-3,
	// V--4, +IN B-5, -IN B-6, OUT B-7, V+-8), the standard dual order.
	{
		"partIds": [
			"OPA1678"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"OUT_A_pin1"
			],
			[
				"INVERTING_A_pin2"
			],
			[
				"NONINVERTING_A_pin3"
			],
			[
				"V_MINUS_pin4"
			],
			[
				"NONINVERTING_B_pin5"
			],
			[
				"INVERTING_B_pin6"
			],
			[
				"OUT_B_pin7"
			],
			[
				"V_PLUS_pin8"
			]
		],
		"model": {
			"kind": "sections",
			"pinout": [
				"OUT_A",
				"IN_A_MINUS",
				"IN_A_PLUS",
				"VEE",
				"IN_B_PLUS",
				"IN_B_MINUS",
				"OUT_B",
				"VCC"
			],
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 501187.2336272725
					},
					"terminals": [
						2,
						1,
						0
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 501187.2336272725
					},
					"terminals": [
						4,
						5,
						6
					]
				}
			]
		}
	},

	// TI (Burr-Brown) OPA134 single audio op-amp, from SBOS058B (Dec 1997, Rev. B
	// Nov 2024): 5.7 Electrical Characteristics (TA = 25C, VS = +-15 V): 'AOL |
	// Open-loop voltage gain | RL = 2 kOhm, -13.8 V <= VO <= 13.5 V | MIN 104
	// TYP 120 | dB' (a second row at RL = 10 kOhm reads the same 104/120). Used as
	// `openLoopGain: decibelGain(120)` = 1000000. GBW lives in the data-registry row
	// (TYP 8 MHz). OPA134PA is the printed PDIP-8 orderable of the same die
	// (orderable table: 'OPA134PA | Active | Production | PDIP (P) | 8'; family specs
	// with no per-orderable split). Pinout: Figure 4-1 + Pin Functions OPA134
	// (+IN-3, -IN-2, OUT-6); the entry keeps the LF351 three-terminal capture.
	{
		"partIds": [
			"OPA134PA"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"vin+",
				"in+",
				"pin3"
			],
			[
				"vin-",
				"in-",
				"pin2"
			],
			[
				"vout",
				"out",
				"pin6"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 1000000
					},
					"terminals": [
						0,
						1,
						2
					]
				}
			],
			"pinout": [
				"vin+",
				"vin-",
				"vout"
			]
		}
	},

	// TI (Burr-Brown) OPA604 single op-amp, from SBOS019A (Jan 1992 - Sep 2003):
	// ELECTRICAL CHARACTERISTICS (TA = +25C, VS = +-15 V, MIN/TYP/MAX columns):
	// 'OPEN-LOOP GAIN | Open-Loop Voltage Gain, VO = +-10 V, RL = 1 kOhm: MIN 80
	// TYP 100 dB'. Used as `openLoopGain: decibelGain(100)` = 100000. GBW lives in
	// the data-registry row (TYP 20 MHz at G = 100, quoted with its condition).
	// OPA604AP is named by the specs header ('OPA604AP, AU'); the PDIP suffix follows
	// the Burr-Brown AP convention (the Package Option Addendum lists AU active).
	// Pinout: the DIP/SOIC diagram (-In-2, +In-3, OUT-6); the LF351 three-terminal
	// capture, same as the UA741CP entry.
	{
		"partIds": [
			"OPA604AP"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"vin+",
				"in+",
				"pin3"
			],
			[
				"vin-",
				"in-",
				"pin2"
			],
			[
				"vout",
				"out",
				"pin6"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						0,
						1,
						2
					]
				}
			],
			"pinout": [
				"vin+",
				"vin-",
				"vout"
			]
		}
	},

	// Wave-2 op-amp entries: sections whose open-loop gain is the sheet's own TYP AOL
	// transcribed (the gain-bandwidth product lives in `registry-data/opamp.ts`, stamped by
	// the passes below; the swing pair stays absent per the D4 freeze). GBW rows and catalog
	// entries are 1:1 by part id, so no entry splits.

	// ADI AD712 dual precision BiFET op-amp, from the ADI AD712 datasheet Rev. B
	// (SPECIFICATIONS at VS = +-15 V @ TA = +25C): OPEN-LOOP GAIN MIN 150 TYP 400 V/mV
	// (J/A/S grades; K/B/T and C print MIN 200 TYP 400 -- TYP 400 in every grade, so the
	// bare id carries it). Used as `openLoopGain: 400000`. The sheet's frequency row reads
	// 'Small Signal Bandwidth 3.0 MIN 4.0 TYP MHz' with no closed-loop gain stated and never
	// uses the term gain-bandwidth, so no GBW figure is transcribed (see
	// `opampGainBandwidthAbsent`). Pinout: 'pinned out in a standard op amp configuration'
	// (dual DIP-8 order, same pin-numbered role convention as the LM833 entry above).
	{
		"partIds": [
			"AD712"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"OUT_A_pin1"
			],
			[
				"INVERTING_A_pin2"
			],
			[
				"NONINVERTING_A_pin3"
			],
			[
				"V_MINUS_pin4"
			],
			[
				"NONINVERTING_B_pin5"
			],
			[
				"INVERTING_B_pin6"
			],
			[
				"OUT_B_pin7"
			],
			[
				"V_PLUS_pin8"
			]
		],
		"model": {
			"kind": "sections",
			"pinout": [
				"OUT_A",
				"IN_A_MINUS",
				"IN_A_PLUS",
				"VEE",
				"IN_B_PLUS",
				"IN_B_MINUS",
				"OUT_B",
				"VCC"
			],
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 400000
					},
					"terminals": [
						2,
						1,
						0
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 400000
					},
					"terminals": [
						4,
						5,
						6
					]
				}
			]
		}
	},

	// TI LF347 quad JFET-input op-amp, from SLOS013C (Mar 1987, rev Mar 2016):
	// 6.5 AVD 'Large signal differential voltage, VO = +-10 V, RL = 2 kOhm, 25C: MIN 25
	// TYP 100 V/mV' (6.6 LF347B: MIN 50 TYP 100). Used as `openLoopGain: 100000`.
	// LF347N is the PDIP-14 of the LF347 grade. Pinout: the sheet's own Pin Functions
	// table (1 1OUT, 2 1IN-, 3 1IN+, 4 VCC+, 5 2IN+, 6 2IN-, 7 2OUT, 8 3OUT, 9 3IN-,
	// 10 3IN+, 11 VCC-, 12 4IN+, 13 4IN-, 14 4OUT) -- the standard quad order.
	{
		"partIds": [
			"LF347",
			"LF347N"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"OUT_A_pin1"
			],
			[
				"INVERTING_A_pin2"
			],
			[
				"NONINVERTING_A_pin3"
			],
			[
				"V_PLUS_pin4"
			],
			[
				"NONINVERTING_B_pin5"
			],
			[
				"INVERTING_B_pin6"
			],
			[
				"OUT_B_pin7"
			],
			[
				"OUT_C_pin8"
			],
			[
				"INVERTING_C_pin9"
			],
			[
				"NONINVERTING_C_pin10"
			],
			[
				"V_MINUS_pin11"
			],
			[
				"NONINVERTING_D_pin12"
			],
			[
				"INVERTING_D_pin13"
			],
			[
				"OUT_D_pin14"
			]
		],
		"model": {
			"kind": "sections",
			"pinout": [
				"OUT_A",
				"IN_A_MINUS",
				"IN_A_PLUS",
				"VCC",
				"IN_B_PLUS",
				"IN_B_MINUS",
				"OUT_B",
				"OUT_C",
				"IN_C_MINUS",
				"IN_C_PLUS",
				"VEE",
				"IN_D_PLUS",
				"IN_D_MINUS",
				"OUT_D"
			],
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						2,
						1,
						0
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						4,
						5,
						6
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						9,
						8,
						7
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						11,
						12,
						13
					]
				}
			]
		}
	},

	// National Semiconductor LF351 single JFET-input op-amp, from DS005648 Rev. 3 (1998):
	// AVOL 'Large Signal Voltage Gain, VS = +-15 V, TA = 25C, VO = +-10 V, RL = 2 kOhm:
	// MIN 25 TYP 100 V/mV'. Used as `openLoopGain: 100000`. LF351N is the DIP orderable
	// (NS Package N08E, sheet p11 'Order Number LF351M or LF351N'). Pinout: 'pin compatible
	// with the standard LM741' (single DIP-8: IN+ pin3, IN- pin2, OUT pin6), the same
	// three-terminal capture as the TL061 entry above.
	{
		"partIds": [
			"LF351",
			"LF351N"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"vin+",
				"in+",
				"pin3"
			],
			[
				"vin-",
				"in-",
				"pin2"
			],
			[
				"vout",
				"out",
				"pin6"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 100000
					},
					"terminals": [
						0,
						1,
						2
					]
				}
			],
			"pinout": [
				"vin+",
				"vin-",
				"vout"
			]
		}
	},

	// SGS-THOMSON L272 dual power op-amp, from the L272 datasheet (Jan 1995):
	// ELECTRICAL CHARACTERISTICS (Vs = 24 V, Tamb = 25C): 'Gv | O. L. Voltage Gain |
	// f = 100 Hz | MIN 60 TYP 70 dB' (f = 1 kHz TYP 50 dB). Used as
	// `openLoopGain: decibelGain(70)` = 3162.2776601683795. Pinout: the sheet's PIN
	// CONNECTIONS are diagrams only (no text pin table could be extracted), so this entry
	// asserts NO pin order (neutral null pinout, M5218 precedent) and serves
	// section-grouped declarations; a packet study must verify the order before pin
	// positions are typed. One family table for L272/L272M/L272D.
	{
		"partIds": [
			"L272",
			"L272M",
			"L272D"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 3162.2776601683795
					},
					"terminals": [
						2,
						1,
						0
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 3162.2776601683795
					},
					"terminals": [
						4,
						5,
						6
					]
				}
			],
			"pinout": [
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null
			]
		}
	},

	// TI TL074 quad JFET-input op-amp, from SLOS080W (Sep 1978, rev Jul 2025):
	// 5.8 DC (VS = +-15 V, TA = 25C, VO = 0 V): 'AOL | Open-loop voltage gain | TL07xC |
	// MIN 25 TYP 200 V/mV' (full-range row MIN-only 15; AC/BC 50/200, M 35/200, I MIN-only
	// 25 -- the I grade is not covered). Used as `openLoopGain: 200000`. TL074CN (PDIP-N)
	// and TL074CD (SOIC-D) are C-grade 'all other devices' for the 5.25 MHz GBW row.
	// Pinout: the sheet's own Table 4-6 Pin Functions TL074x (1 1OUT, 2 1IN-, 3 1IN+,
	// 4 VCC+, 5 2IN+, 6 2IN-, 7 2OUT, 8 3OUT, 9 3IN-, 10 3IN+, 11 VCC-, 12 4IN+,
	// 13 4IN-, 14 4OUT).
	{
		"partIds": [
			"TL074",
			"TL074CN",
			"TL074CD"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"OUT_A_pin1"
			],
			[
				"INVERTING_A_pin2"
			],
			[
				"NONINVERTING_A_pin3"
			],
			[
				"V_PLUS_pin4"
			],
			[
				"NONINVERTING_B_pin5"
			],
			[
				"INVERTING_B_pin6"
			],
			[
				"OUT_B_pin7"
			],
			[
				"OUT_C_pin8"
			],
			[
				"INVERTING_C_pin9"
			],
			[
				"NONINVERTING_C_pin10"
			],
			[
				"V_MINUS_pin11"
			],
			[
				"NONINVERTING_D_pin12"
			],
			[
				"INVERTING_D_pin13"
			],
			[
				"OUT_D_pin14"
			]
		],
		"model": {
			"kind": "sections",
			"pinout": [
				"OUT_A",
				"IN_A_MINUS",
				"IN_A_PLUS",
				"VCC",
				"IN_B_PLUS",
				"IN_B_MINUS",
				"OUT_B",
				"OUT_C",
				"IN_C_MINUS",
				"IN_C_PLUS",
				"VEE",
				"IN_D_PLUS",
				"IN_D_MINUS",
				"OUT_D"
			],
			"sections": [
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 200000
					},
					"terminals": [
						2,
						1,
						0
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 200000
					},
					"terminals": [
						4,
						5,
						6
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 200000
					},
					"terminals": [
						9,
						8,
						7
					]
				},
				{
					"law": {
						"kind": "ideal-opamp",
						"railHigh": null,
						"railLow": null,
						"openLoopGain": 200000
					},
					"terminals": [
						11,
						12,
						13
					]
				}
			]
		}
	},

	// Wave 2 (JED): TI CD4016B quad bilateral switch. Its own entry (NOT an alias of the
	// CD4066 entry above): the 4016 is the high-Ron predecessor and the 4066 its
	// pin-compatible low-Ron replacement (onsemi MC14066B: 'designed to be pin-for-pin
	// compatible with the MC14016B, but has much lower ON resistance'; ST HCF4066B: 'pin
	// for pin compatible with HCF4016B, but exhibits a much lower ON resistance').
	// On-resistance from TI CD4016B SCHS026D Rev. E (Aug 2024), Features p1: '280 Ohm
	// typical on-state resistance for 15 V operation' (switch matching 'within 10 Ohm typ
	// over 15 V signal-input range'). The 4.5 table's at-rail TYP at 15 V is 200 Ohm
	// (MAX 400; mid-supply worst-case MAX-only 850) -- the 280 headline is the over-range
	// figure and is the transcribed value. offOhms/thresholdVolts repeat the 4066 entry
	// (not newly cited). Only the ids the TI sheet owns: the unbuffered CD4016, HEF/HCF/MC
	// variants are not covered (Nexperia's HEF4016B specs a different test: 115 Ohm
	// peak-typ at 15 V, 100 uA, sharing no figure with this row).
	{
		"partIds": [
			"4016B",
			"CD4016B"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"switch_a",
				"in",
				"a",
				"sig_in",
				"inout1",
				"1in/out",
				"in/out"
			],
			[
				"switch_b",
				"out",
				"b",
				"sig_out",
				"inout2",
				"1out/in",
				"out/in"
			],
			[
				"control",
				"ctrl",
				"c",
				"gate",
				"ctl",
				"1control"
			],
			[
				"vcc",
				"vdd",
				"vplus",
				"v+"
			],
			[
				"vss",
				"gnd",
				"vminus",
				"v-",
				"ground"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "analog-switch",
						"onOhms": 280,
						"offOhms": 1000000000,
						"thresholdVolts": 2
					},
					"terminals": [
						0,
						1,
						2
					]
				}
			],
			"pinout": [
				"switch_a",
				"switch_b",
				"control",
				"vcc",
				"vss"
			]
		}
	},

	// Wave 2 (JED): Cabintech CT3101 BBD clock generator. Its own entry mirroring the
	// MN3101 above (same 8-pin DIL footprint, same terminal order), NOT an unsourced alias:
	// the CT3101's own datasheet ('CT3101 BBD Clock Generator - Datasheet', Rev 1,
	// Aug 2023, Cabintech Global LLC, https://cabintechglobal.com/pdf/CABINTECH_CT3101.pdf)
	// states it 'is pin-for-pin compatible with the discontinued Panasonic MN3101' and 'can
	// be used as a drop-in replacement for the MN3101', with the pin table 1 GND, 2 CP1,
	// 3 Vdd (-3 V to -18 V), 4 CP2, 5 OX3, 6 OX2, 7 OX1, 8 Vgg (14/15 Vdd output).
	// No quiescentSupplyAmps: the sheet says only 'about 1/2 of MN3101' (no figure).
	// It is a hybrid module (CD4047-based), not a monolithic second source.
	{
		"partIds": [
			"CT3101"
		],
		"declaredTypes": [],
		"terminalRoleGroups": [
			[
				"gnd",
				"v-",
				"vss",
				"pin1",
				"gndpin1"
			],
			[
				"cp1",
				"clk1",
				"clock1",
				"phi1",
				"pin2",
				"cp1pin2"
			],
			[
				"vdd",
				"v+",
				"vcc",
				"pin3",
				"vddpin3"
			],
			[
				"cp2",
				"clk2",
				"clock2",
				"phi2",
				"pin4",
				"cp2pin4"
			],
			[
				"ox3",
				"osc3",
				"oscctrl",
				"pin5",
				"ox3pin5"
			],
			[
				"ox2",
				"osc2",
				"oscout",
				"pin6",
				"ox2pin6"
			],
			[
				"ox1",
				"osc1",
				"oscin",
				"osc",
				"pin7",
				"ox1pin7"
			],
			[
				"vgg",
				"vggout",
				"pin8",
				"vggoutpin8"
			]
		],
		"model": {
			"kind": "sections",
			"sections": [
				{
					"law": {
						"kind": "clock-driver",
						"defaultFrequency": 10000
					},
					"terminals": [
						1,
						3,
						7,
						2,
						6,
						0
					]
				}
			],
			"pinout": [
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null
			]
		}
	},

	...zenerRegistryRecords.map((record) => zenerLaw(record)),

	// Wave-1 discrete fill: bjt, diode-forward, mosfet and jfet-channel records become
	// law entries through the builders above -- one list per class, so the entries cannot
	// drift from the records. 2SK30A rides the same generic path as every other JFET: its
	// record carries only gateSaturationCurrent, so the builder gap-fills the class channel
	// and the stamp is byte-identical to the bespoke mapping this replaces.
	...bjtRegistryRecords.map((record) => bjtLawEntry(record)),
	...diodeRegistryRecords.map((record) => diodeLawEntry(record)),
	...mosfetRegistryRecords.map((record) => fetLawEntry(record, "mosfet")),
	...jfetRegistryRecords.map((record) => fetLawEntry(record, "jfet")),
	...ujtRegistryRecords.map((record) => ujtLawEntry(record)),
];

// --- Op-amp gain-bandwidth product: stamped from the data registry ------------------------------
/**
 * Merge a stamped row's `community`-basis parameters into the entry's provisional arm.
 * A row whose parameters are all better-sourced adds nothing, and an entry with no
 * provisional value keeps the field absent rather than gaining an empty one.
 */
function withRowProvisional(
	entry: PartEntry,
	row: { params: readonly (CitedParam | undefined)[]; names: readonly string[] },
): Pick<PartEntry, "provisionalParams"> {
	const merged = [...(entry.provisionalParams ?? [])];
	row.params.forEach((param, index) => {
		if (param?.basis !== "community" || typeof param.url !== "string") return;
		const name = row.names[index] as string;
		if (!merged.some((held) => held.name === name)) {
			merged.push({ name, url: param.url });
		}
	});
	return merged.length === 0 ? {} : { provisionalParams: merged };
}
//
// The figures live in `registry-data/opamp.ts` as cited values (datasheet TYP rows, quoted).
// This pass stamps each record's product onto the op-amp sections of exactly the ids it
// covers. An entry whose ids have different products (or none) is split into one entry per
// product, keeping every other field, so no id changes behaviour except by gaining its own
// figure.
//
// Loud on any mismatch, as before: a record or absent id the catalog holds no op-amp entry
// for, an id in both lists, or an id in two records is a table error and throws at load
// rather than being silently skipped.
function withDatasheetGainBandwidth(base: readonly PartEntry[]): readonly PartEntry[] {
	const rowOf = new Map<string, OpampRegistryRecord>();
	for (const row of opampRegistryRecords) {
		if (row.gainBandwidthHz === undefined) continue;
		for (const id of row.partIds) {
			const folded = foldPartId(id);
			if (rowOf.has(folded)) throw new Error(`gain-bandwidth table names ${id} twice`);
			rowOf.set(folded, row);
		}
	}
	const absent = new Set<string>();
	for (const { partIds } of opampGainBandwidthAbsent) {
		for (const id of partIds) {
			const folded = foldPartId(id);
			if (rowOf.has(folded)) throw new Error(`${id} is both given a gain-bandwidth figure and listed absent`);
			absent.add(folded);
		}
	}
	const seen = new Set<string>();
	const out: PartEntry[] = [];
	for (const entry of base) {
		const sections = entry.model.kind === "sections" ? entry.model.sections : null;
		const isOpamp =
			sections !== null && sections.length > 0 && sections.every((section) => section.law.kind === "ideal-opamp");
		if (!isOpamp || sections === null || entry.model.kind !== "sections") {
			out.push(entry);
			continue;
		}
		const groups = new Map<OpampRegistryRecord | null, string[]>();
		for (const id of entry.partIds) {
			const folded = foldPartId(id);
			seen.add(folded);
			const row = rowOf.get(folded) ?? null;
			const group = groups.get(row);
			if (group === undefined) groups.set(row, [id]);
			else group.push(id);
		}
		const model = entry.model;
		for (const [row, partIds] of groups) {
			if (row === null) {
				out.push(groups.size === 1 ? entry : { ...entry, partIds });
				continue;
			}
			const hertz = row.gainBandwidthHz?.value;
			if (hertz === undefined || !(hertz > 0)) {
				throw new Error(
					`${partIds.join(",")}: gain-bandwidth record states no positive product`,
				);
			}
			out.push({
				...entry,
				partIds,
				...withRowProvisional(entry, {
					params: [row.gainBandwidthHz],
					names: ["gainBandwidthHz"],
				}),
				model: {
					...model,
					sections: model.sections.map((section) =>
						section.law.kind === "ideal-opamp"
							? { ...section, law: { ...section.law, gainBandwidthHz: hertz } }
							: section,
					),
				},
			});
		}
	}
	for (const folded of [...rowOf.keys(), ...absent]) {
		if (!seen.has(folded)) throw new Error(`gain-bandwidth table names ${folded}, which no op-amp entry holds`);
	}
	return out;
}

// --- Op-amp output swing: stamped from the data registry -------------------------------------------------
//
// The same rules as the gain-bandwidth pass above. A record states the drop from each rail at
// the printed condition; `translation` is how that pair is carried to a pedal on another supply:
//   "constant"      the printed drops are applied as printed (a headroom independent of the supply);
//   "proportional"  both are multiplied by the op-amp's supply span over `supplyVolts`.
// The datasheet states neither: it is the owner's reading, recorded per record, and the table does not
// say it is shown right. Only the OP07 reading has a held-out hardware test behind it (T-a1, row 16),
// and a test of a rule written first is not a measurement of the rule.

/**
 * The catalog's op-amp entries with each registry record's swing pair stamped onto the sections
 * of exactly the ids it covers. An entry whose ids have different rows (or none) is split into
 * one entry per row, keeping every other field, so no id changes behaviour except by gaining
 * its own pair.
 *
 * Loud on any mismatch, as `withDatasheetGainBandwidth` is: a record or absent id the catalog
 * holds no op-amp entry for, an id in both lists, an id in two records, a base entry that
 * already carries a swing field (every figure comes through the registry), or a record whose
 * numbers do not validate (`opampOutputSwingOf`) throws at load.
 */
export function withDatasheetOutputSwing(
	base: readonly PartEntry[],
	rows: readonly OpampRegistryRecord[] = opampRegistryRecords,
	absentRows: ReadonlyArray<{ readonly partIds: readonly string[]; readonly reason: string }> = opampOutputSwingAbsent,
): readonly PartEntry[] {
	const rowOf = new Map<string, OpampRegistryRecord>();
	for (const row of rows) {
		const high = row.outputSwingDropHighVolts;
		const low = row.outputSwingDropLowVolts;
		const printed = row.outputSwingPrinted;
		if (high === undefined && low === undefined && printed === undefined) continue;
		if (high === undefined || low === undefined || printed === undefined) {
			throw new Error(
				`${row.partIds.join(",")}: an op-amp swing record states a half pair (high ${high === undefined ? "absent" : "present"}, low ${low === undefined ? "absent" : "present"}, printed ${printed === undefined ? "absent" : "present"})`,
			);
		}
		for (const id of row.partIds) {
			const folded = foldPartId(id);
			if (rowOf.has(folded)) throw new Error(`output-swing table names ${id} twice`);
			rowOf.set(folded, row);
		}
	}
	const absent = new Set<string>();
	for (const { partIds, reason } of absentRows) {
		if (reason.length === 0) throw new Error(`output-swing absent row for ${partIds.join(",")} states no reason`);
		for (const id of partIds) {
			const folded = foldPartId(id);
			if (rowOf.has(folded)) throw new Error(`${id} is both given an output-swing pair and listed absent`);
			absent.add(folded);
		}
	}
	const seen = new Set<string>();
	const out: PartEntry[] = [];
	for (const entry of base) {
		const sections = entry.model.kind === "sections" ? entry.model.sections : null;
		const isOpamp =
			sections !== null && sections.length > 0 && sections.every((section) => section.law.kind === "ideal-opamp");
		if (!isOpamp || sections === null || entry.model.kind !== "sections") {
			out.push(entry);
			continue;
		}
		for (const section of sections) {
			const law = section.law;
			if (
				law.kind === "ideal-opamp" &&
				(law.outputSwingDropHighVolts !== undefined ||
					law.outputSwingDropLowVolts !== undefined ||
					law.outputSwingPrinted !== undefined)
			) {
				throw new Error(
					`${entry.partIds.join(",")}: an op-amp entry states an output swing in place; it must come through the registry`,
				);
			}
		}
		const groups = new Map<OpampRegistryRecord | null, string[]>();
		for (const id of entry.partIds) {
			const folded = foldPartId(id);
			seen.add(folded);
			const row = rowOf.get(folded) ?? null;
			const group = groups.get(row);
			if (group === undefined) groups.set(row, [id]);
			else group.push(id);
		}
		const model = entry.model;
		for (const [row, partIds] of groups) {
			if (row === null) {
				out.push(groups.size === 1 ? entry : { ...entry, partIds });
				continue;
			}
			const high = row.outputSwingDropHighVolts?.value;
			const low = row.outputSwingDropLowVolts?.value;
			const printed = row.outputSwingPrinted;
			if (high === undefined || low === undefined || printed === undefined) {
				throw new Error(
					`${partIds.join(",")}: an op-amp swing record states a half pair`,
				);
			}
			const stamped: PartEntry = {
				...entry,
				partIds,
				...withRowProvisional(entry, {
					params: [row.outputSwingDropHighVolts, row.outputSwingDropLowVolts],
					names: ["outputSwingDropHighVolts", "outputSwingDropLowVolts"],
				}),
				model: {
					...model,
					sections: model.sections.map((section) =>
						section.law.kind === "ideal-opamp"
							? {
									...section,
									law: {
										...section.law,
										outputSwingDropHighVolts: high,
										outputSwingDropLowVolts: low,
										outputSwingPrinted: {
											supplyVolts: printed.supplyVolts,
											loadOhms: printed.loadOhms,
											translation: printed.translation,
										},
									},
								}
							: section,
					),
				},
			};
			// A malformed record (a non-positive figure, an unknown translation) throws here, naming the ids.
			for (const section of stamped.model.kind === "sections" ? stamped.model.sections : []) {
				if (section.law.kind === "ideal-opamp") opampOutputSwingOf(section.law, partIds.join(","));
			}
			out.push(stamped);
		}
	}
	for (const folded of [...rowOf.keys(), ...absent]) {
		if (!seen.has(folded)) throw new Error(`output-swing table names ${folded}, which no op-amp entry holds`);
	}
	return out;
}

/**
 * Every part id whose `fet` entry refines the gate term only, folded for comparison.
 * Derived from the jfet registry records that state NO channel parameter (a record that
 * states thresholdVolts or transconductance carries a full channel and is not gate-only):
 * such an entry keeps its avowed class channel, which is never graded against the database's
 * beta/lambda/Vp the way a transcribed channel would be. Mirrors `zenerCatalogPartIds`.
 */
const GATE_ONLY_EXCLUDED_PARAMS: ReadonlySet<string> = new Set([
	"thresholdVolts",
	"transconductance",
	"channelLengthModulation",
	"subthresholdVolts",
]);
export const gateOnlyFetPartIds: ReadonlySet<string> = new Set(
	jfetRegistryRecords
		.filter((record) =>
			Object.keys(record.params).every((name) => !GATE_ONLY_EXCLUDED_PARAMS.has(name)),
		)
		.flatMap((record) => [
			...record.partIds,
			...(record.aliases ?? []),
		])
		.map((id) => foldPartId(id)),
);

/**
 * The catalog the corpus-facing scripts inject.
 */
export const pedalPartCatalog: PartRegistry = {
	entries: withDatasheetOutputSwing(withDatasheetGainBandwidth(entries)),
};
