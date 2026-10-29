/**
 * DipTrace `.dchxml` to `circuit-interchange/v4` conversion (layer B).
 *
 * `convertDipTrace(model, options)` maps the typed layer-A model to a
 * `CircuitDocument`. Every kind decision cites its discriminating feature and
 * the mapping lives below as data keyed on that feature:
 *
 * - library identity: the library section's whole `Name` value (a symbol
 *   identity, never parsed prose) plus pin count and pin-name set;
 * - RefDes class letter and whole-value off-board labels (`IN`/`OUT`);
 * - terminal-role tokens from the symbol's pin names, never pad numbers;
 * - connectivity (pin membership) for ground/supply resolution.
 *
 * What the source does not state is never guessed: unmapped parts become
 * `kind: unsupported` with a typed diagnostic (kept in the document, so the
 * B3 pin-membership round trip stays exact), pot taper markings are recorded
 * as provenance with `Taper` unset, and supply voltage arrives via the
 * explicit `supplyVolts` option (default 9, pedal convention).
 *
 * Geometry carries connectivity: every net's member terminals share one
 * coordinate, so core's geometric resolution reproduces the pin-membership
 * partition exactly. Node ids are therefore deterministic from connectivity.
 */

import { parseQuantity } from "../../model/quantity";
import type {
	CircuitDocument,
	Component,
	ComponentKind,
	ParsedQuantity,
	Point,
	PropertyValue,
	Terminal,
} from "../../model/types";
import {
	findDipTracePadLabelMismatches,
	dipTraceCapacitorPositivePad,
	type DipTraceLibrarySection,
	type DipTraceModel,
	type DipTracePart,
} from "./parser";

export type DipTraceDiagnosticCode =
	| "supply-assumed"
	| "rail-port-on-regulator-output"
	| "audio-proposed"
	| "audio-ports-unresolved"
	| "bypass-none"
	| "taper-marking-recorded"
	| "taper-from-declared-convention"
	| "taper-convention-declared"
	| "pot-resistance-absent"
	| "pot-value-from-manufacturer-field"
	| "pot-value-from-datasheet-field"
	| "pot-value-conflict"
	| "value-unparseable"
	| "quantity-with-remark"
	| "value-selection-marker"
	| "pad-label-mismatch"
	| "bjt-polarity-undeclared"
	| "fet-channel-undeclared"
	| "fet-class-ambiguous"
	| "diode-family-noted"
	| "electrolytic-orientation-undeclared"
	| "electrolytic-positive-from-geometry"
	| "led-colour-unstated"
	| "partnumber-absent"
	| "unmapped-pin-name"
	| "switch-fragments-merged"
	| "multipart-sections-split"
	| "multipart-sections-merged"
	| "multipart-merge-declined"
	| "dual-gang-split"
	| "dual-gang-roles-by-analogy"
	| "switch-position-defaulted"
	| "jumper-as-closed-switch"
	| "offboard-pad-as-port"
	| "jack-audio-ambiguous"
	| "power-amp-needs-model"
	| "logic-part-unmodelled"
	| "opto-half-unmodelled"
	| "put-unmodelled"
	| "transformer-unmodelled"
	| "ferrite-bead-unmodelled"
	| "unclassified-part"
	| "library-pin-missing"
	| "terminal-name-collision";

export type DipTraceDiagnostic = Readonly<{
	code: DipTraceDiagnosticCode;
	message: string;
	componentId?: string;
}>;

export type ConvertDipTraceOptions = Readonly<{
	/** Declared supply voltage (volts). The source carries none. Default 9. */
	supplyVolts?: number;
	/** Document name (defaults to the first audio input label or `diptrace-import`). */
	name?: string;
	/**
	 * Owner-declared taper convention for printed pot markings. When set to
	 * `"alps"`, a recorded single-letter `TaperMarking` of `A`, `B` or `C`
	 * is declared as the `log`, `linear` or `reverse-log` law, mirroring
	 * what the compiler already executes for those letters. Absent by
	 * default, in which case no `Taper` is ever written.
	 */
	taperConvention?: DipTraceTaperConvention;
}>;

export type DipTraceTaperConvention = "alps";

/**
 * Printed-letter to taper law under the owner-declared `alps` convention.
 * Whole-letter keys only; anything else (including lowercase) is not mapped.
 * Mirrors the compiler's own reader (`a` logarithmic, `b` linear, `c`
 * reverse-logarithmic) in core's canonical law spellings, so the two cannot
 * drift without the cross-package test failing.
 */
const TAPER_LAW_BY_MARKING_LETTER: ReadonlyMap<string, "log" | "linear" | "reverse-log"> = new Map([
	["A", "log"],
	["B", "linear"],
	["C", "reverse-log"],
]);

export type ConvertDipTraceResult = Readonly<{
	/** The converted document, or null when conversion is refused. */
	document: CircuitDocument | null;
	/** Named refusal reason, or null when a document was emitted. */
	refusal: string | null;
	/** Typed diagnostics (never prose to be matched later). */
	diagnostics: readonly DipTraceDiagnostic[];
}>;

const DEFAULT_SUPPLY_VOLTS = 9;

/** Ground-symbol library identities (whole values, NetPort symbols). */
const GROUND_LIB_NAMES: ReadonlySet<string> = new Set(["GRND", "GND"]);

/**
 * Supply-rail NetPort library identities (whole values). Single-pin symbols
 * whose library name is one of these carry the board supply; the voltage
 * itself is not in the source and arrives via `supplyVolts`.
 */
const SUPPLY_RAIL_LIB_NAMES: ReadonlySet<string> = new Set([
	"VA",
	"VB",
	"VC",
	"VD",
	"VE",
	"VL",
	"VN",
	"VP",
	"VCA",
	"VCB",
	"VCC",
	"VDD",
	"VEE",
	"VSS",
	"4.5V",
	"+4.5V",
	"-4.5V",
	"9V",
	"+9V",
	"-9V",
	"5V",
	"+5V",
	"-5V",
	"-VA",
	"PWR",
]);

/** Whole-value off-board audio labels (exact, never substrings). */
const AUDIO_LABELS: ReadonlySet<string> = new Set(["IN", "OUT"]);

/** Off-board indicator labels: kept as ports, never rails. */
const INDICATOR_LABELS: ReadonlySet<string> = new Set([
	"LED",
	"LED_1",
	"LED_2",
	"CRLED",
]);

/** Resistor library identities (whole values). */
const RESISTOR_LIB_NAMES: ReadonlySet<string> = new Set(["RES"]);

/** Capacitor library identities (whole values). */
const CAPACITOR_LIB_NAMES: ReadonlySet<string> = new Set([
	"CAP 5,08",
	"CAP",
	"CAP100RP",
	"CAP200",
	"CAP 7,62",
]);

/** Diode library identities (whole values). */
const DIODE_LIB_NAMES: ReadonlySet<string> = new Set([
	"DIODE DO_41",
	"DIODE DO_35",
	"DIODE",
	"DIODE 2",
]);

/** Diode family identities: law stays the class default; family is noted. */
const DIODE_FAMILY_LIB_NAMES: ReadonlyMap<string, string> = new Map([
	["DIODE shottky DO_35", "schottky"],
	["DIODE zenner DO_35", "zener"],
]);

/** LED library identities (whole values). */
const LED_LIB_NAMES: ReadonlySet<string> = new Set(["LED_Short", "LED"]);

/** BJT library identities that state polarity (whole values). */
const BJT_POLARITY_LIB_NAMES: ReadonlyMap<string, "NPN" | "PNP"> = new Map([
	["NPN", "NPN"],
	["PNP", "PNP"],
]);

/** JFET library identities (whole values) and the channel they state. */
const JFET_LIB_NAMES: ReadonlyMap<string, "N-channel JFET" | null> = new Map([
	["JFET N", "N-channel JFET"],
	["JFET", null],
]);

/** MOSFET library identities (whole values) and the channel they state. */
const MOSFET_LIB_NAMES: ReadonlyMap<string, "N-channel MOSFET" | null> =
	new Map([["MosFet N V2", "N-channel MOSFET"]]);

/** Power-amp symbol identities (whole values): never an op-amp law. */
const POWER_AMP_LIB_NAMES: ReadonlySet<string> = new Set([
	"LM386 DIP8",
	"LM386 DIP8 V2",
]);

/** Whole-value part ids that mark a power amp regardless of symbol. */
const POWER_AMP_PART_IDS: ReadonlySet<string> = new Set([
	"LM386",
	"JRC386D",
	"JRC386",
]);

/** Potentiometer pin-name sets, in library declaration order. */
const POT_PIN_ORDERS: ReadonlyArray<readonly string[]> = [
	["1", "3", "2"],
	["1", "2", "3"],
	["CW", "CCW", "W"],
	// Second-gang numbering of a dual pot sharing one RefDes: pins 4/5/6 in
	// the same positions as lugs 1/2/3 (measured on Xotic BB P3, where gang B
	// pin names 4 and 5 share a net in rheostat wiring).
	["4", "6", "5"],
];

/** Potentiometer terminal roles by pin-name token (core lug convention). */
const POT_ROLE_BY_PIN_NAME: ReadonlyMap<string, "ccw" | "wiper" | "cw"> =
	new Map([
		["1", "ccw"],
		["2", "wiper"],
		["3", "cw"],
		["CW", "cw"],
		["CCW", "ccw"],
		["W", "wiper"],
		["4", "ccw"],
		["5", "wiper"],
		["6", "cw"],
	]);

const BJT_ROLE_BY_PIN_NAME: ReadonlyMap<string, string> = new Map([
	["C", "collector"],
	["E", "emitter"],
	["B", "base"],
]);

const FET_ROLE_BY_PIN_NAME: ReadonlyMap<string, string> = new Map([
	["D", "drain"],
	["S", "source"],
	["G", "gate"],
]);

const DIODE_ROLE_BY_PIN_NAME: ReadonlyMap<string, string> = new Map([
	["A", "anode"],
	["K", "cathode"],
]);

const OPAMP_ROLE_BY_PIN_NAME: ReadonlyMap<string, string> = new Map([
	["OUT", "output"],
	["IN+", "nonInverting"],
	["IN-", "inverting"],
	["POWER +", "supplyPositive"],
	["POWER -", "supplyNegative"],
]);

/** Pin names that together mark an op-amp section (whole tokens). */
const OPAMP_SIGNATURE_NAMES: ReadonlySet<string> = new Set([
	"OUT",
	"IN+",
	"IN-",
]);

/** Closed resistance-unit vocabulary for value fields (whole units).
 *
 * Bare single-letter `K`/`k`/`M`/`G` are deliberately absent: the quantity
 * parser only ever returns them for malformed shorthand with a doubled
 * marker (`2k5k` reads 2500 with unit `k`), never for a real value (`10k`
 * and `4k7` both return the empty unit). Letting one through would value a
 * malformed marking.
 */
const RESISTANCE_UNITS: ReadonlySet<string> = new Set([
	"",
	"Ω",
	"ohm",
	"ohms",
	"OHM",
	"OHMS",
	"Meg",
]);

const CAPACITANCE_UNITS: ReadonlySet<string> = new Set([
	"",
	"F",
	"f",
	"p",
	"n",
	"u",
	"µ",
	"μ",
	"m",
	"P",
	"N",
	"U",
	"M",
]);

const INDUCTANCE_UNITS: ReadonlySet<string> = new Set([
	"H",
	"h",
	"p",
	"n",
	"u",
	"µ",
	"μ",
	"m",
	"P",
	"N",
	"U",
	"M",
	"",
]);

/**
 * Potentiometer taper-marking shape: one taper letter plus a resistance
 * quantity (`B500k`, `A100k`, RKM-infix `B2k5`). The letter is provenance
 * only; `Taper` stays unset because letter codes are a convention, not a
 * definition. The quantity half accepts whatever the quantity parser reads
 * whole (the parser already handles RKM infix); the unit filter beside it
 * keeps malformed doubles (`2k5k`) out.
 */
const POT_MARKING_REGEX = /^\s*([A-Za-z])\s*(\S(?:.*\S)?)\s*$/;

function refDesLetter(refDes: string): string {
	const match = /^[A-Za-z]+/.exec(refDes);
	return match?.[0] ?? "?";
}

function padSortKey(token: string): [number, string, string] {
	if (/^\d+$/.test(token)) {
		return [0, token.padStart(10, "0"), token];
	}
	return [1, token, token];
}

function sortedPinIndices(
	pins: readonly { padNumber: string; pinId: string }[],
): number[] {
	return pins
		.map((_pin, index) => index)
		.sort((a, b) => {
			const ka = padSortKey(pins[a]?.padNumber ?? "");
			const kb = padSortKey(pins[b]?.padNumber ?? "");
			if (ka[0] !== kb[0]) {
				return ka[0] - kb[0];
			}
			if (ka[1] !== kb[1]) {
				return ka[1] < kb[1] ? -1 : 1;
			}
			const ia = pins[a]?.pinId ?? "";
			const ib = pins[b]?.pinId ?? "";
			return ia < ib ? -1 : ia > ib ? 1 : 0;
		});
}

function stripSelectionMarker(raw: string): {
	text: string;
	marked: boolean;
} {
	const text = raw.trim();
	if (text.endsWith("*") && text.length > 1) {
		return { text: text.slice(0, -1).trim(), marked: true };
	}
	return { text, marked: false };
}

function tryParseQuantity(
	raw: string,
	allowedUnits: ReadonlySet<string>,
): ParsedQuantity | null {
	const { text } = stripSelectionMarker(raw);
	if (text.length === 0) {
		return null;
	}
	const parsed = parseQuantity(text);
	if (parsed === null) {
		return null;
	}
	if (!allowedUnits.has(parsed.unit)) {
		return null;
	}
	return parsed;
}

/**
 * Quantity with a trailing remark (`10u Tant`): the first whitespace-
 * separated token parses as the quantity and the remainder is provenance.
 */
function tryParseQuantityWithRemark(
	raw: string,
	allowedUnits: ReadonlySet<string>,
): { quantity: ParsedQuantity; remark: string } | null {
	const direct = tryParseQuantity(raw, allowedUnits);
	if (direct !== null) {
		return { quantity: direct, remark: "" };
	}
	const { text, marked } = stripSelectionMarker(raw);
	if (marked) {
		return null;
	}
	const first = text.split(/\s+/)[0];
	if (first === undefined || first === text) {
		return null;
	}
	const parsed = tryParseQuantity(first, allowedUnits);
	if (parsed === null) {
		return null;
	}
	return { quantity: parsed, remark: text.slice(first.length).trim() };
}

function tryParsePotMarking(
	raw: string,
): { resistance: ParsedQuantity; taperLetter: string } | null {
	const { text, marked } = stripSelectionMarker(raw);
	if (marked) {
		return null;
	}
	const match = POT_MARKING_REGEX.exec(text);
	if (match === null) {
		return null;
	}
	const resistance = tryParseQuantity(match[2] ?? "", RESISTANCE_UNITS);
	if (resistance === null) {
		return null;
	}
	return { resistance, taperLetter: match[1] ?? "" };
}

type PartEvidence = Readonly<{
	part: DipTracePart;
	libraryName: string;
	libraryValue: string;
	categoryIndex: string | null;
	letter: string;
	pinNames: readonly string[];
	pads: readonly string[];
}>;

function evidenceOf(
	part: DipTracePart,
	model: DipTraceModel,
): PartEvidence & {
	librarySection: DipTraceLibrarySection | undefined;
} {
	const section = model.library.find(
		(entry) => entry.style === part.style && entry.sectionId === part.section,
	);
	return {
		part,
		libraryName: section?.name ?? "",
		libraryValue: section?.value ?? "",
		categoryIndex: section?.categoryIndex ?? part.categoryIndex,
		letter: refDesLetter(part.refDes),
		pinNames: part.pins.map((pin) => pin.name),
		pads: part.pins.map((pin) => pin.padNumber),
		librarySection: section,
	};
}

function orderedTuple(values: readonly string[]): string {
	return values.join("|");
}

function isPotPinOrder(pinNames: readonly string[]): boolean {
	const key = orderedTuple(pinNames);
	return POT_PIN_ORDERS.some((order) => orderedTuple(order) === key);
}

type Emitter = {
	diagnostics: DipTraceDiagnostic[];
	supplyVolts: number;
	taperConvention: DipTraceTaperConvention | undefined;
	taperDeclaredCount: { next: number };
	netCoord: ReadonlyMap<string, Point>;
	floaterSeq: { next: number };
	componentSeq: { next: number };
};

function floaterPosition(emitter: Emitter): Point {
	emitter.floaterSeq.next += 1;
	return { x: -1000 - emitter.floaterSeq.next * 10, y: -1000 };
}

function originFor(emitter: Emitter): Point {
	emitter.componentSeq.next += 1;
	return { x: emitter.componentSeq.next * 10 + 5, y: 5000 };
}

const EMPTY_SET: ReadonlySet<string> = new Set();

function uniqueTerminalName(
	taken: Set<string>,
	base: string,
	fallback: string,
	emitter: Emitter,
	componentId: string,
): string {
	const candidate = base.length > 0 ? base : fallback;
	if (!taken.has(candidate)) {
		taken.add(candidate);
		return candidate;
	}
	let index = 2;
	while (taken.has(`${candidate}~${index}`)) {
		index += 1;
	}
	const renamed = `${candidate}~${index}`;
	taken.add(renamed);
	emitter.diagnostics.push({
		code: "terminal-name-collision",
		message:
			`${componentId}: pad token "${candidate}" repeats within one component; ` +
			`renamed to "${renamed}"`,
		componentId,
	});
	return renamed;
}

function baseProperties(
	part: DipTracePart,
	libraryName: string,
): Record<string, PropertyValue> {
	const out: Record<string, PropertyValue> = {};
	if (part.value.length > 0) {
		out.Value = part.value;
	}
	if (part.name.length > 0) {
		out.Name = part.name;
	}
	if (libraryName.length > 0) {
		out.DipTraceSymbol = libraryName;
	}
	out.SourceDesignator = part.refDes;
	return out;
}

function buildTerminals(
	part: DipTracePart,
	netOfPin: (pinId: string) => Point | null,
	roleOf: ((pinName: string) => string | null) | null,
	emitter: Emitter,
	componentId: string,
	unmappedCollector: (pinName: string) => void,
	silentNames: ReadonlySet<string> = EMPTY_SET,
): Terminal[] {
	const taken = new Set<string>();
	const terminals: Terminal[] = [];
	for (const index of sortedPinIndices(part.pins)) {
		const pin = part.pins[index];
		if (pin === undefined) {
			continue;
		}
		const position = netOfPin(pin.pinId) ?? floaterPosition(emitter);
		const role = roleOf === null ? null : roleOf(pin.name);
		if (
			roleOf !== null &&
			role === null &&
			pin.name.length > 0 &&
			!silentNames.has(pin.name)
		) {
			unmappedCollector(pin.name);
		}
		terminals.push({
			name: uniqueTerminalName(taken, pin.padNumber, pin.pinId, emitter, componentId),
			...(role === null ? {} : { role }),
			position,
		});
	}
	return terminals;
}

function makeComponent(
	kind: ComponentKind,
	id: string,
	name: string,
	sourceTypeName: string,
	terminals: readonly Terminal[],
	properties: Readonly<Record<string, PropertyValue>>,
	emitter: Emitter,
): Component {
	return {
		id,
		kind,
		name,
		sourceTypeName,
		origin: originFor(emitter),
		rotation: 0,
		flipped: false,
		terminals,
		properties,
	};
}

export function convertDipTrace(
	model: DipTraceModel,
	options: ConvertDipTraceOptions = {},
): ConvertDipTraceResult {
	const diagnostics: DipTraceDiagnostic[] = [];
	const emitter: Emitter = {
		diagnostics,
		supplyVolts: options.supplyVolts ?? DEFAULT_SUPPLY_VOLTS,
		taperConvention: options.taperConvention,
		taperDeclaredCount: { next: 0 },
		netCoord: new Map(),
		floaterSeq: { next: 0 },
		componentSeq: { next: 0 },
	};

	if (model.parts.length === 0) {
		return { document: null, refusal: "empty-circuit: no schematic parts", diagnostics };
	}

	// Net coordinates: one shared point per net id, sorted numerically for
	// determinism. Terminals sharing a point resolve to one node in core.
	const sortedNetIds = [...model.nets.map((net) => net.id)].sort((a, b) => {
		const na = Number(a);
		const nb = Number(b);
		if (Number.isInteger(na) && Number.isInteger(nb)) {
			return na - nb;
		}
		return a < b ? -1 : 1;
	});
	const netCoord = new Map<string, Point>();
	sortedNetIds.forEach((id, index) => {
		netCoord.set(id, { x: index * 10, y: 0 });
	});
	emitter.netCoord = netCoord;

	const netOfPin = (part: DipTracePart) => (pinId: string) => {
		for (const net of model.nets) {
			if (
				net.members.some(
					(member) => member.partId === part.id && member.pinId === pinId,
				)
			) {
				return netCoord.get(net.id) ?? null;
			}
		}
		return null;
	};

	// Group parts by RefDes for fragment/section handling.
	const groups = new Map<string, DipTracePart[]>();
	for (const part of model.parts) {
		const group = groups.get(part.refDes);
		if (group !== undefined) {
			group.push(part);
		} else {
			groups.set(part.refDes, [part]);
		}
	}

	const components: Component[] = [];
	let audioIn: string | null = null;
	let audioOut: string | null = null;
	const audioInCandidates: string[] = [];
	const audioOutCandidates: string[] = [];
	let railCount = 0;

	// Regulator-output nets (connectivity only): the net ids holding the OUT
	// pin of a part the classifier reads as a regulator (letter IC/U with the
	// exact GND/IN/OUT pin-name tuple; OUT is the same token the classifier
	// maps to the `positive` terminal role). A supply symbol on one of these
	// nets sits downstream of the regulator, so it must not assert the board
	// supply. A pre-pass because NetPort branches emit inline in RefDes-group
	// order while a regulator may sort later; a post-pass would build rails
	// first and then mutate kind, properties and diagnostics while repairing
	// railCount retroactively, splitting one decision across two sites.
	const regulatorOutputNets = new Map<string, string[]>();
	for (const part of model.parts) {
		const partEv = evidenceOf(part, model);
		if (
			(partEv.letter === "IC" || partEv.letter === "U") &&
			orderedTuple([...partEv.pinNames].sort()) ===
				orderedTuple(["GND", "IN", "OUT"])
		) {
			const outPin = part.pins.find((pin) => pin.name === "OUT");
			if (outPin === undefined) {
				continue;
			}
			for (const net of model.nets) {
				if (
					net.members.some(
						(member) =>
							member.partId === part.id && member.pinId === outPin.pinId,
					)
				) {
					const drivers = regulatorOutputNets.get(net.id) ?? [];
					drivers.push(part.refDes);
					regulatorOutputNets.set(net.id, drivers);
				}
			}
		}
	}

	// Regulator RefDes list driving any net a part's pins sit on (empty when
	// the part shares no net with a regulator output). Reads pin membership
	// only: never net names, port labels, values or part numbers.
	const regulatorsDrivingPart = (part: DipTracePart): string[] => {
		const drivers = new Set<string>();
		for (const pin of part.pins) {
			for (const net of model.nets) {
				if (
					net.members.some(
						(member) => member.partId === part.id && member.pinId === pin.pinId,
					)
				) {
					for (const refDes of regulatorOutputNets.get(net.id) ?? []) {
						drivers.add(refDes);
					}
				}
			}
		}
		return [...drivers].sort();
	};

	const notePadMismatch = (part: DipTracePart) => {
		for (const mismatch of findDipTracePadLabelMismatches({
			...model,
			parts: [part],
		})) {
			diagnostics.push({
				code: "pad-label-mismatch",
				message:
					`${mismatch.refDes}: pad "${mismatch.pad}" wired to symbol pin ` +
					`"${mismatch.name}"; role follows the symbol pin name, pad label kept as provenance`,
				componentId: mismatch.refDes,
			});
		}
	};

	const noteLibraryPinMissing = (part: DipTracePart) => {
		for (const pin of part.pins) {
			if (pin.libraryPinMissing) {
				diagnostics.push({
					code: "library-pin-missing",
					message:
						`${part.refDes}: schematic pin Id ${pin.pinId} has no library pin; ` +
						`pad falls back to the pin Id with no pin name`,
					componentId: part.refDes,
				});
			}
		}
	};

	const classifySingle = (
		part: DipTracePart,
		componentId: string,
	): Component | null => {
		const ev = evidenceOf(part, model);
		const netOf = netOfPin(part);
		const properties = baseProperties(part, ev.libraryName);
		notePadMismatch(part);
		noteLibraryPinMissing(part);
		const unmapped = new Set<string>();
		const collectUnmapped = (pinName: string) => {
			unmapped.add(pinName);
		};
		const finishUnmapped = () => {
			for (const pinName of [...unmapped].sort()) {
				diagnostics.push({
					code: "unmapped-pin-name",
					message:
						`${componentId}: symbol pin name "${pinName}" carries no terminal-role mapping; role omitted`,
					componentId,
				});
			}
		};

		// --- NetPort symbols -------------------------------------------------
		if (ev.letter === "NetPort") {
			// Off-board label: the schematic Name first, then the Value when the
			// Name is blank or a connector synonym. A field carrying a connector
			// synonym (CNCT) is not a label. Both fields carrying different
			// labels is not a label at all (falls back to the library name).
			const rawName = part.name.trim();
			const rawValue = part.value.trim();
			const nameIsLabel =
				rawName.length > 0 &&
				rawName !== "CNCT" &&
				rawName !== "Connector";
			const valueIsLabel =
				rawValue.length > 0 &&
				rawValue !== "CNCT" &&
				rawValue !== "Connector";
			const audioLabel =
				nameIsLabel && (!valueIsLabel || rawValue === rawName)
					? rawName
					: valueIsLabel && !nameIsLabel
						? rawValue
						: ev.libraryName;
			if (GROUND_LIB_NAMES.has(ev.libraryName)) {
				const terminals = buildTerminals(part, netOf, null, emitter, componentId, collectUnmapped);
				finishUnmapped();
				return makeComponent("ground", componentId, part.refDes, "Circuit.Ground", terminals, properties, emitter);
			}
			if (SUPPLY_RAIL_LIB_NAMES.has(ev.libraryName)) {
				const drivers = regulatorsDrivingPart(part);
				if (drivers.length > 0) {
					const terminals = buildTerminals(part, netOf, null, emitter, componentId, collectUnmapped);
					finishUnmapped();
					diagnostics.push({
						code: "rail-port-on-regulator-output",
						message:
							`${componentId}: supply-symbol NetPort "${ev.libraryName}" sits on a regulator output net ` +
							`(driven by ${drivers.join(", ")}); kept as an annotation port, no supply asserted`,
						componentId,
					});
					return makeComponent("port", componentId, part.refDes, "Circuit.Port", terminals, properties, emitter);
				}
				railCount += 1;
				properties.Voltage = {
					raw: `${emitter.supplyVolts} V`,
					value: emitter.supplyVolts,
					unit: "V",
				};
				const terminals = buildTerminals(part, netOf, null, emitter, componentId, collectUnmapped);
				finishUnmapped();
				return makeComponent("rail", componentId, part.refDes, "Circuit.Rail", terminals, properties, emitter);
			}
			if (AUDIO_LABELS.has(audioLabel)) {
				const kind = "jack";
				const sourceTypeName =
					audioLabel === "IN" ? "Circuit.Input" : "Circuit.Output";
				const terminals = buildTerminals(part, netOf, null, emitter, componentId, collectUnmapped);
				finishUnmapped();
				const component = makeComponent(kind, componentId, part.refDes, sourceTypeName, terminals, properties, emitter);
				components.push(component);
				diagnostics.push({
					code: "audio-proposed",
					message:
						`${componentId}: single-pin NetPort labelled "${audioLabel}" proposed as audio ` +
						(audioLabel === "IN" ? "input" : "output"),
					componentId,
				});
				if (audioLabel === "IN") {
					audioInCandidates.push(`${componentId} (NetPort)`);
				} else {
					audioOutCandidates.push(`${componentId} (NetPort)`);
				}
				return null;
			}
			if (audioLabel === "GND") {
				const terminals = buildTerminals(part, netOf, null, emitter, componentId, collectUnmapped);
				finishUnmapped();
				return makeComponent("ground", componentId, part.refDes, "Circuit.Ground", terminals, properties, emitter);
			}
			if (audioLabel === "PWR") {
				const drivers = regulatorsDrivingPart(part);
				if (drivers.length > 0) {
					const terminals = buildTerminals(part, netOf, null, emitter, componentId, collectUnmapped);
					finishUnmapped();
					diagnostics.push({
						code: "rail-port-on-regulator-output",
						message:
							`${componentId}: supply-labelled NetPort "${audioLabel}" sits on a regulator output net ` +
							`(driven by ${drivers.join(", ")}); kept as an annotation port, no supply asserted`,
						componentId,
					});
					return makeComponent("port", componentId, part.refDes, "Circuit.Port", terminals, properties, emitter);
				}
				railCount += 1;
				properties.Voltage = {
					raw: `${emitter.supplyVolts} V`,
					value: emitter.supplyVolts,
					unit: "V",
				};
				const terminals = buildTerminals(part, netOf, null, emitter, componentId, collectUnmapped);
				finishUnmapped();
				return makeComponent("rail", componentId, part.refDes, "Circuit.Rail", terminals, properties, emitter);
			}
			const terminals = buildTerminals(part, netOf, null, emitter, componentId, collectUnmapped);
			finishUnmapped();
			diagnostics.push({
				code: "offboard-pad-as-port",
				message:
					`${componentId}: NetPort "${ev.libraryName || audioLabel || part.refDes}" kept as an annotation port; no supply, audio or ground evidence`,
				componentId,
			});
			return makeComponent("port", componentId, part.refDes, "Circuit.Port", terminals, properties, emitter);
		}

		// --- Single-pin off-board connectors ----------------------------------
		if (
			(ev.letter === "Connector" ||
				ev.libraryName === "CNCT" ||
				ev.libraryName === "Untitled" ||
				ev.libraryName === "OUT" ||
				ev.libraryName === "Connector") &&
			part.pins.length === 1
		) {
			const label = part.value.trim();
			if (AUDIO_LABELS.has(label)) {
				const sourceTypeName =
					label === "IN" ? "Circuit.Input" : "Circuit.Output";
				const terminals = buildTerminals(part, netOf, null, emitter, componentId, collectUnmapped);
				finishUnmapped();
				const component = makeComponent("jack", componentId, part.refDes, sourceTypeName, terminals, properties, emitter);
				components.push(component);
				diagnostics.push({
					code: "audio-proposed",
					message:
						`${componentId}: single-pin connector labelled "${label}" proposed as audio ` +
						(label === "IN" ? "input" : "output"),
					componentId,
				});
				if (label === "IN") {
					audioInCandidates.push(`${componentId} (connector)`);
				} else {
					audioOutCandidates.push(`${componentId} (connector)`);
				}
				return null;
			}
			if (label === "PWR") {
				const drivers = regulatorsDrivingPart(part);
				if (drivers.length > 0) {
					const terminals = buildTerminals(part, netOf, null, emitter, componentId, collectUnmapped);
					finishUnmapped();
					diagnostics.push({
						code: "rail-port-on-regulator-output",
						message:
							`${componentId}: supply-labelled connector "${label}" sits on a regulator output net ` +
							`(driven by ${drivers.join(", ")}); kept as an annotation port, no supply asserted`,
						componentId,
					});
					return makeComponent("port", componentId, part.refDes, "Circuit.Port", terminals, properties, emitter);
				}
				railCount += 1;
				properties.Voltage = {
					raw: `${emitter.supplyVolts} V`,
					value: emitter.supplyVolts,
					unit: "V",
				};
				const terminals = buildTerminals(part, netOf, null, emitter, componentId, collectUnmapped);
				finishUnmapped();
				return makeComponent("rail", componentId, part.refDes, "Circuit.Rail", terminals, properties, emitter);
			}
			if (label === "GND") {
				const terminals = buildTerminals(part, netOf, null, emitter, componentId, collectUnmapped);
				finishUnmapped();
				return makeComponent("ground", componentId, part.refDes, "Circuit.Ground", terminals, properties, emitter);
			}
			const terminals = buildTerminals(part, netOf, null, emitter, componentId, collectUnmapped);
			finishUnmapped();
			diagnostics.push({
				code: "offboard-pad-as-port",
				message:
					`${componentId}: off-board pad "${label || part.refDes}" kept as an annotation port; no supply, audio or ground evidence`,
				componentId,
			});
			return makeComponent("port", componentId, part.refDes, "Circuit.Port", terminals, properties, emitter);
		}

		// --- Multi-pin jacks ----------------------------------------------------
		if (ev.letter === "J") {
			const sourceTypeName =
				ev.libraryName === "Power_Jack" ? "Circuit.PowerJack" : "Circuit.Jack";
			const terminals = buildTerminals(part, netOf, null, emitter, componentId, collectUnmapped);
			finishUnmapped();
			if (AUDIO_LABELS.has(part.value.trim())) {
				const label = part.value.trim();
				const component = makeComponent("jack", componentId, part.refDes, label === "IN" ? "Circuit.Input" : "Circuit.Output", terminals, properties, emitter);
				components.push(component);
				diagnostics.push({
					code: "jack-audio-ambiguous",
					message:
						`${componentId}: ${part.pins.length}-pin jack labelled "${label}" proposed as audio ` +
						(label === "IN" ? "input" : "output") +
						`; tip terminal is not inferable from numeric pins, so the compiler default (first non-ground terminal) applies`,
					componentId,
				});
				if (label === "IN") {
					audioInCandidates.push(`${componentId} (jack)`);
				} else {
					audioOutCandidates.push(`${componentId} (jack)`);
				}
				return null;
			}
			return makeComponent("jack", componentId, part.refDes, sourceTypeName, terminals, properties, emitter);
		}

		// --- Resistors ------------------------------------------------------------
		if (RESISTOR_LIB_NAMES.has(ev.libraryName) || (ev.libraryName === "" && ev.letter === "R" && part.pins.length === 2)) {
			const parsed = tryParseQuantityWithRemark(part.value, RESISTANCE_UNITS);
			if (parsed !== null) {
				properties.Resistance = parsed.quantity;
				if (parsed.remark.length > 0) {
					diagnostics.push({
						code: "quantity-with-remark",
						message: `${componentId}: resistance "${part.value}" reads ${parsed.quantity.value} ohm with trailing remark "${parsed.remark}" kept as provenance`,
						componentId,
					});
					properties.DipTraceValueRemark = parsed.remark;
				}
				if (stripSelectionMarker(part.value).marked) {
					diagnostics.push({
						code: "value-selection-marker",
						message: `${componentId}: value "${part.value}" carries a selection marker; quantity parsed without it`,
						componentId,
					});
				}
			} else if (part.value.trim().length > 0) {
				diagnostics.push({
					code: "value-unparseable",
					message: `${componentId}: resistor value "${part.value}" is not a resistance quantity; Resistance omitted`,
					componentId,
				});
			} else {
				diagnostics.push({
					code: "value-unparseable",
					message: `${componentId}: resistor states no value; Resistance omitted`,
					componentId,
				});
			}
			const terminals = buildTerminals(part, netOf, null, emitter, componentId, collectUnmapped);
			finishUnmapped();
			return makeComponent("resistor", componentId, part.refDes, "Circuit.Resistor", terminals, properties, emitter);
		}

		// --- Capacitors -------------------------------------------------------------
		if (
			CAPACITOR_LIB_NAMES.has(ev.libraryName) ||
			ev.libraryName === "Pole_CAP" ||
			(ev.libraryName === "" && ev.letter === "C" && part.pins.length === 2)
		) {
			const parsed = tryParseQuantityWithRemark(part.value, CAPACITANCE_UNITS);
			if (parsed !== null) {
				properties.Capacitance = parsed.quantity;
				if (parsed.remark.length > 0) {
					diagnostics.push({
						code: "quantity-with-remark",
						message: `${componentId}: capacitance "${part.value}" reads ${parsed.quantity.value} F with trailing remark "${parsed.remark}" kept as provenance`,
						componentId,
					});
					properties.DipTraceValueRemark = parsed.remark;
				}
				if (stripSelectionMarker(part.value).marked) {
					diagnostics.push({
						code: "value-selection-marker",
						message: `${componentId}: value "${part.value}" carries a selection marker; quantity parsed without it`,
						componentId,
					});
				}
			} else if (part.value.trim().length > 0) {
				diagnostics.push({
					code: "value-unparseable",
					message: `${componentId}: capacitor value "${part.value}" is not a capacitance quantity; Capacitance omitted`,
					componentId,
				});
			} else {
				diagnostics.push({
					code: "value-unparseable",
					message: `${componentId}: capacitor states no value; Capacitance omitted`,
					componentId,
				});
			}
			if (ev.libraryName === "Pole_CAP") {
				properties.Polarity = "electrolytic";
				const positivePad =
					ev.librarySection === undefined
						? null
						: dipTraceCapacitorPositivePad(ev.librarySection);
				if (positivePad !== null) {
					properties.PositiveTerminal = positivePad;
					diagnostics.push({
						code: "electrolytic-positive-from-geometry",
						message: `${componentId}: Pole_CAP plus glyph (two line segments crossing at midpoints) marks the pad-${positivePad} plate as positive; read from library symbol geometry, independent of placement`,
						componentId,
					});
				} else {
					diagnostics.push({
						code: "electrolytic-orientation-undeclared",
						message: `${componentId}: Pole_CAP symbol states a polarized capacitor but no + or - pin; orientation undeclared`,
						componentId,
					});
				}
			}
			const terminals = buildTerminals(part, netOf, null, emitter, componentId, collectUnmapped);
			finishUnmapped();
			return makeComponent("capacitor", componentId, part.refDes, "Circuit.Capacitor", terminals, properties, emitter);
		}

		// --- Diodes and LEDs ----------------------------------------------------------
		if (DIODE_LIB_NAMES.has(ev.libraryName) || DIODE_FAMILY_LIB_NAMES.has(ev.libraryName) || (ev.libraryName === "" && ev.letter === "D" && part.pins.length === 2)) {
			const family = DIODE_FAMILY_LIB_NAMES.get(ev.libraryName);
			if (family !== undefined) {
				diagnostics.push({
					code: "diode-family-noted",
					message: `${componentId}: library symbol "${ev.libraryName}" states a ${family} diode; law stays the class default, breakdown never inferred from the part number`,
					componentId,
				});
			}
			if (part.value.length > 0) {
				properties.PartNumber = part.value;
			} else {
				diagnostics.push({
					code: "partnumber-absent",
					message: `${componentId}: diode states no part number`,
					componentId,
				});
			}
			const terminals = buildTerminals(
				part,
				netOf,
				(pinName) => DIODE_ROLE_BY_PIN_NAME.get(pinName) ?? null,
				emitter,
				componentId,
				collectUnmapped,
			);
			finishUnmapped();
			return makeComponent("diode", componentId, part.refDes, "Circuit.Diode", terminals, properties, emitter);
		}
		if (LED_LIB_NAMES.has(ev.libraryName)) {
			if (part.value.length > 0) {
				properties.PartNumber = part.value;
			} else {
				diagnostics.push({
					code: "partnumber-absent",
					message: `${componentId}: LED states no part number`,
					componentId,
				});
			}
			diagnostics.push({
				code: "led-colour-unstated",
				message: `${componentId}: LED colour "${part.value}" is outside the closed colour vocabulary; no Color stated, registry part id decides`,
				componentId,
			});
			const terminals = buildTerminals(
				part,
				netOf,
				(pinName) => DIODE_ROLE_BY_PIN_NAME.get(pinName) ?? null,
				emitter,
				componentId,
				collectUnmapped,
			);
			finishUnmapped();
			return makeComponent("led", componentId, part.refDes, "Circuit.LED", terminals, properties, emitter);
		}

		// --- Potentiometers (panel pots and trimmers) ------------------------------------
		if (
			(ev.letter === "P" || ev.letter === "TR" || ev.libraryName === "POT" || ev.libraryName === "TRIMPOT") &&
			part.pins.length === 3 &&
			isPotPinOrder(ev.pinNames)
		) {
			const fields: Array<[string, string]> = [
				["Name", part.name],
				["Value", part.value],
				["library Name", ev.libraryName],
				["library Value", ev.libraryValue],
				["BaseName", part.baseName],
			];
			const readField = (
				raw: string,
			): { resistance: ParsedQuantity; taperLetter: string } | null => {
				if (raw.trim().length === 0) {
					return null;
				}
				const marking = tryParsePotMarking(raw);
				if (marking !== null) {
					return marking;
				}
				const parsed = tryParseQuantity(raw, RESISTANCE_UNITS);
				if (parsed !== null) {
					return { resistance: parsed, taperLetter: "" };
				}
				return null;
			};
			let resistance: ParsedQuantity | null = null;
			let taperLetter = "";
			let resistanceSource = "";
			for (const [field, raw] of fields) {
				const found = readField(raw);
				if (found !== null) {
					resistance = found.resistance;
					taperLetter = found.taperLetter;
					resistanceSource = field;
					break;
				}
			}
			// The part's Manufacturer and Datasheet fields carry the track
			// value/taper marking on potentiometer-class parts only (never read
			// on any other class). Whole-field parse by the same parser; a
			// manufacturer name or part number that does not parse whole leaves
			// the pot absent. Precedence: Value/Name, then Manufacturer, then
			// Datasheet; any two parsing sources that disagree leave the pot
			// absent with a conflict diagnostic naming every reading.
			type PotReading = Readonly<{
				source: string;
				raw: string;
				resistance: ParsedQuantity;
				taperLetter: string;
			}>;
			const readSource = (
				source: string,
				raw: string,
			): PotReading | null => {
				if (raw.trim().length === 0) {
					return null;
				}
				const found = readField(raw);
				return found === null
					? null
					: {
							source,
							raw: raw.trim(),
							resistance: found.resistance,
							taperLetter: found.taperLetter,
						};
			};
			const extraReadings: PotReading[] = [
				readSource("Manufacturer", part.manufacturer),
				readSource("Datasheet", part.datasheet),
			].filter((reading): reading is PotReading => reading !== null);
			let conflicted = false;
			if (resistance !== null) {
				const disagreements = extraReadings.filter(
					(reading) => reading.resistance.value !== resistance!.value,
				);
				if (disagreements.length > 0) {
					const readings = [
						`${resistanceSource} ${resistance.value}`,
						...extraReadings.map(
							(reading) => `${reading.source} ${reading.resistance.value}`,
						),
					].join(" vs ");
					diagnostics.push({
						code: "pot-value-conflict",
						message:
							`${componentId}: conflicting track readings (${readings} ohm); ` +
							`no side chosen, Resistance omitted`,
						componentId,
					});
					resistance = null;
					taperLetter = "";
					resistanceSource = "";
					conflicted = true;
				}
			} else if (extraReadings.length > 0) {
				const first = extraReadings[0]!;
				const disagreements = extraReadings
					.slice(1)
					.filter(
						(reading) => reading.resistance.value !== first.resistance.value,
					);
				if (disagreements.length > 0) {
					const readings = extraReadings
						.map((reading) => `${reading.source} ${reading.resistance.value}`)
						.join(" vs ");
					diagnostics.push({
						code: "pot-value-conflict",
						message:
							`${componentId}: conflicting track readings (${readings} ohm); ` +
							`no side chosen, Resistance omitted`,
						componentId,
					});
					conflicted = true;
				} else {
					resistance = first.resistance;
					taperLetter = first.taperLetter;
					resistanceSource = first.source;
					properties.DipTraceValueSource = first.source;
					diagnostics.push({
						code:
							first.source === "Manufacturer"
								? "pot-value-from-manufacturer-field"
								: "pot-value-from-datasheet-field",
						message:
							`${componentId}: track resistance ${resistance.value} ohm read from the ${first.source} field ` +
							`("${first.raw}"); Value/Name state no resistance`,
						componentId,
					});
				}
			}
			if (resistance !== null) {
				properties.Resistance = resistance;
			} else if (!conflicted) {
				diagnostics.push({
					code: "pot-resistance-absent",
					message: `${componentId}: potentiometer states no track resistance (Name "${part.name}", Value "${part.value}", Manufacturer "${part.manufacturer}"); Resistance omitted`,
					componentId,
				});
			}
			if (taperLetter.length > 0) {
				properties.TaperMarking = taperLetter;
				diagnostics.push({
					code: "taper-marking-recorded",
					message: `${componentId}: taper marking "${taperLetter}" from ${resistanceSource} recorded as provenance; Taper unset, letter codes are never read as a law`,
					componentId,
				});
			} else if (part.name.trim().length > 0 && part.name.trim() !== "POT" && part.name.trim() !== "TRIMPOT") {
				properties.TaperMarking = part.name.trim();
				diagnostics.push({
					code: "taper-marking-recorded",
					message: `${componentId}: name marking "${part.name.trim()}" recorded as provenance; Taper unset`,
					componentId,
				});
			}
			// Owner-declared taper convention (OFF by default): a recorded
			// single-letter marking of exactly A, B or C is declared as the
			// log, linear or reverse-log law. Trimmers never take a law here;
			// neither do unmarked, starred, conflicted or otherwise unmapped
			// letters (their taperLetter is empty or outside the table).
			if (
				emitter.taperConvention !== undefined &&
				taperLetter.length > 0 &&
				ev.libraryName !== "TRIMPOT" &&
				ev.letter !== "TR"
			) {
				const law = TAPER_LAW_BY_MARKING_LETTER.get(taperLetter);
				if (law !== undefined) {
					properties.Taper = law;
					properties.DipTraceTaperSource = `TaperMarking:${emitter.taperConvention}`;
					emitter.taperDeclaredCount.next += 1;
					diagnostics.push({
						code: "taper-from-declared-convention",
						message:
							`${componentId}: taper marking "${taperLetter}" declared as ${law} ` +
							`under the owner-declared ${emitter.taperConvention} convention; audit via TaperMarking`,
						componentId,
					});
				}
			}
			const terminals = buildTerminals(
				part,
				netOf,
				(pinName) => POT_ROLE_BY_PIN_NAME.get(pinName) ?? null,
				emitter,
				componentId,
				collectUnmapped,
			);
			finishUnmapped();
			if (orderedTuple(ev.pinNames) === orderedTuple(["4", "6", "5"])) {
				diagnostics.push({
					code: "dual-gang-roles-by-analogy",
					message: `${componentId}: second-gang pins 4/5/6 read as lugs 1/2/3 by position correspondence with gang A; rheostat ties (if any) come from connectivity, not the analogy`,
					componentId,
				});
			}
			return makeComponent("potentiometer", componentId, part.refDes, "Circuit.Potentiometer", terminals, properties, emitter);
		}

		// --- Bipolar transistors -------------------------------------------------------
		if (
			BJT_POLARITY_LIB_NAMES.has(ev.libraryName) ||
			ev.libraryName === "BJT" ||
			ev.libraryName === "MPSA14" ||
			((ev.letter === "Q" || ev.letter === "TR" || ev.letter === "V") &&
				part.pins.length === 3 &&
				orderedTuple([...ev.pinNames].sort()) === orderedTuple(["B", "C", "E"]))
		) {
			const polarity =
				BJT_POLARITY_LIB_NAMES.get(ev.libraryName) ??
				(part.name.trim() === "NPN" || part.name.trim() === "PNP" ? part.name.trim() : null) ??
				(part.value.trim() === "NPN" || part.value.trim() === "PNP" ? part.value.trim() : null);
			if (polarity !== null) {
				properties.Type = polarity;
			} else {
				diagnostics.push({
					code: "bjt-polarity-undeclared",
					message: `${componentId}: bjt symbol states no NPN or PNP polarity; Type omitted and the compiler default applies`,
					componentId,
				});
			}
			if (ev.libraryName === "MPSA14") {
				diagnostics.push({
					code: "bjt-polarity-undeclared",
					message: `${componentId}: MPSA14 is a Darlington with no per-specimen figures in the source; passed through as one bjt`,
					componentId,
				});
			}
			if (part.value.length > 0) {
				properties.PartNumber = part.value;
			} else {
				diagnostics.push({
					code: "partnumber-absent",
					message: `${componentId}: bjt states no part number`,
					componentId,
				});
			}
			const terminals = buildTerminals(
				part,
				netOf,
				(pinName) => BJT_ROLE_BY_PIN_NAME.get(pinName) ?? null,
				emitter,
				componentId,
				collectUnmapped,
			);
			finishUnmapped();
			return makeComponent("bjt", componentId, part.refDes, "Circuit.BipolarJunctionTransistor", terminals, properties, emitter);
		}

		// --- JFETs ------------------------------------------------------------------
		if (
			JFET_LIB_NAMES.has(ev.libraryName) ||
			((ev.letter === "Q" || ev.letter === "TR" || ev.letter === "V") &&
				part.pins.length === 3 &&
				orderedTuple([...ev.pinNames].sort()) === orderedTuple(["D", "G", "S"]) &&
				!MOSFET_LIB_NAMES.has(ev.libraryName))
		) {
			// A D/S/G symbol with no JFET library identity is class-ambiguous: the
			// same drawing carries JFETs and MOSFETs across the corpus, and the part
			// number is prose the importer never reads.
			if (!JFET_LIB_NAMES.has(ev.libraryName)) {
				diagnostics.push({
					code: "fet-class-ambiguous",
					message: `${componentId}: D/S/G symbol with no JFET or MOSFET library identity; kind unsupported, neither class guessed`,
					componentId,
				});
				const terminals = buildTerminals(part, netOf, null, emitter, componentId, collectUnmapped);
				finishUnmapped();
				return makeComponent("unsupported", componentId, part.refDes, "Circuit.Unsupported", terminals, properties, emitter);
			}
			const channel = JFET_LIB_NAMES.get(ev.libraryName);
			if (channel !== null && channel !== undefined) {
				properties.Type = channel;
			} else {
				diagnostics.push({
					code: "fet-channel-undeclared",
					message: `${componentId}: jfet symbol states no channel; Type omitted and the compiler default applies`,
					componentId,
				});
			}
			if (part.value.length > 0) {
				properties.PartNumber = part.value;
			} else {
				diagnostics.push({
					code: "partnumber-absent",
					message: `${componentId}: jfet states no part number`,
					componentId,
				});
			}
			const terminals = buildTerminals(
				part,
				netOf,
				(pinName) => FET_ROLE_BY_PIN_NAME.get(pinName) ?? null,
				emitter,
				componentId,
				collectUnmapped,
			);
			finishUnmapped();
			return makeComponent("jfet", componentId, part.refDes, "Circuit.JunctionFieldEffectTransistor", terminals, properties, emitter);
		}

		// --- MOSFETs -----------------------------------------------------------------
		if (MOSFET_LIB_NAMES.has(ev.libraryName)) {
			const channel = MOSFET_LIB_NAMES.get(ev.libraryName);
			if (channel !== null && channel !== undefined) {
				properties.Type = channel;
			} else {
				diagnostics.push({
					code: "fet-channel-undeclared",
					message: `${componentId}: mosfet symbol states no channel; Type omitted and the compiler default applies`,
					componentId,
				});
			}
			if (part.value.length > 0) {
				properties.PartNumber = part.value;
			} else {
				diagnostics.push({
					code: "partnumber-absent",
					message: `${componentId}: mosfet states no part number`,
					componentId,
				});
			}
			const terminals = buildTerminals(
				part,
				netOf,
				(pinName) => FET_ROLE_BY_PIN_NAME.get(pinName) ?? null,
				emitter,
				componentId,
				collectUnmapped,
			);
			finishUnmapped();
			return makeComponent("mosfet", componentId, part.refDes, "Circuit.Mosfet", terminals, properties, emitter);
		}

		// --- Programmable unijunction: no device law -----------------------------------
		if (ev.libraryName === "PNPN PUT V2") {
			diagnostics.push({
				code: "put-unmodelled",
				message: `${componentId}: programmable unijunction (2N6027) has no device law; kind unsupported`,
				componentId,
			});
			if (part.value.length > 0) {
				properties.PartNumber = part.value;
			}
			const terminals = buildTerminals(part, netOf, null, emitter, componentId, collectUnmapped);
			finishUnmapped();
			return makeComponent("unsupported", componentId, part.refDes, "Circuit.Unsupported", terminals, properties, emitter);
		}

		// --- Optocoupler halves and LDRs: no standalone law ------------------------------
		if (
			ev.libraryName === "VTL5C2" ||
			ev.libraryName === "LDR" ||
			ev.letter === "LDR" ||
			(ev.letter === "V" && part.pins.length === 2) ||
			(ev.letter === "U" && ev.libraryName === "" && part.value === "LDR")
		) {
			diagnostics.push({
				code: "opto-half-unmodelled",
				message: `${componentId}: optocoupler half or standalone LDR ("${part.value || ev.libraryName}") has no standalone law; kind unsupported`,
				componentId,
			});
			if (part.value.length > 0) {
				properties.PartNumber = part.value;
			}
			const terminals = buildTerminals(part, netOf, null, emitter, componentId, collectUnmapped);
			finishUnmapped();
			return makeComponent("unsupported", componentId, part.refDes, "Circuit.Unsupported", terminals, properties, emitter);
		}

		// --- Integrated circuits -------------------------------------------------------
		if (ev.letter === "IC" || ev.letter === "U") {
			const pinNameSet = new Set(ev.pinNames);
			const hasOpampSignature =
				pinNameSet.has("OUT") && pinNameSet.has("IN+") && pinNameSet.has("IN-");
			const isPowerAmp =
				POWER_AMP_LIB_NAMES.has(ev.libraryName) ||
				POWER_AMP_PART_IDS.has(part.value.trim());
			if (hasOpampSignature && !isPowerAmp) {
				if (part.value.length > 0) {
					properties.PartNumber = part.value;
				}
				const terminals = buildTerminals(
					part,
					netOf,
					(pinName) => OPAMP_ROLE_BY_PIN_NAME.get(pinName) ?? null,
					emitter,
					componentId,
					collectUnmapped,
				);
				finishUnmapped();
				return makeComponent("opamp", componentId, part.refDes, "Circuit.OpAmp", terminals, properties, emitter);
			}
			if (isPowerAmp) {
				diagnostics.push({
					code: "power-amp-needs-model",
					message: `${componentId}: power amp "${part.value.trim() || ev.libraryName}" kept as kind power-amp; the registry decides the law and an unregistered part refuses downstream`,
					componentId,
				});
				if (part.value.length > 0) {
					properties.PartNumber = part.value;
				}
				const terminals = buildTerminals(
					part,
					netOf,
					(pinName) => OPAMP_ROLE_BY_PIN_NAME.get(pinName) ?? null,
					emitter,
					componentId,
					collectUnmapped,
				);
				finishUnmapped();
				return makeComponent("power-amp", componentId, part.refDes, "Circuit.IC", terminals, properties, emitter);
			}
			if (
				orderedTuple([...ev.pinNames].sort()) === orderedTuple(["GND", "IN", "OUT"])
			) {
				if (part.value.length > 0) {
					properties.PartNumber = part.value;
				}
				const terminals = buildTerminals(
					part,
					netOf,
					(pinName) =>
						pinName === "OUT" ? "positive" : pinName === "GND" ? "ground" : null,
					emitter,
					componentId,
					collectUnmapped,
					// A regulator input carries no distinct role in the format;
					// its presence is wiring, reported by connectivity, not here.
					new Set(["IN"]),
				);
				finishUnmapped();
				return makeComponent("regulator", componentId, part.refDes, "Circuit.VoltageRegulator", terminals, properties, emitter);
			}
			if (
				part.value.trim() === "CD4024BE" ||
				part.value.trim() === "42TM011R"
			) {
				diagnostics.push({
					code:
						part.value.trim() === "CD4024BE"
							? "logic-part-unmodelled"
							: "transformer-unmodelled",
					message:
						`${componentId}: "${part.value.trim()}" has no importable device law ` +
						(part.value.trim() === "CD4024BE"
							? "(logic divider sections bind by registry position, which this importer will not assert); kind unsupported"
							: "(centre-tap transformer form unmodelled); kind unsupported"),
					componentId,
				});
				properties.PartNumber = part.value;
				const terminals = buildTerminals(part, netOf, null, emitter, componentId, collectUnmapped);
				finishUnmapped();
				return makeComponent("unsupported", componentId, part.refDes, "Circuit.Unsupported", terminals, properties, emitter);
			}
			if (part.value.length > 0) {
				properties.PartNumber = part.value;
			} else {
				diagnostics.push({
					code: "partnumber-absent",
					message: `${componentId}: ic states no part number; registry pinout cannot resolve`,
					componentId,
				});
			}
			const terminals = buildTerminals(part, netOf, null, emitter, componentId, collectUnmapped);
			finishUnmapped();
			return makeComponent("ic", componentId, part.refDes, "Circuit.IC", terminals, properties, emitter);
		}

		// --- Switches (single-part: DIP, DPDT sections handled per part) ------------------
		if (ev.letter === "SW") {
			diagnostics.push({
				code: "switch-position-defaulted",
				message: `${componentId}: switch states no position; the compiler default applies and the position is unclaimed`,
				componentId,
			});
			if (part.value.length > 0) {
				properties.Function = part.value;
			}
			const terminals = buildTerminals(part, netOf, null, emitter, componentId, collectUnmapped);
			finishUnmapped();
			return makeComponent("switch", componentId, part.refDes, "Circuit.Switch", terminals, properties, emitter);
		}

		// --- Inductors ------------------------------------------------------------------
		if (ev.libraryName === "Ind" || ev.letter === "I") {
			const parsed = tryParseQuantityWithRemark(part.value, INDUCTANCE_UNITS);
			if (parsed !== null) {
				properties.Inductance = parsed.quantity;
			} else {
				diagnostics.push({
					code: "value-unparseable",
					message: `${componentId}: inductor value "${part.value}" is not an inductance quantity; Inductance omitted`,
					componentId,
				});
			}
			const terminals = buildTerminals(part, netOf, null, emitter, componentId, collectUnmapped);
			finishUnmapped();
			return makeComponent("inductor", componentId, part.refDes, "Circuit.Inductor", terminals, properties, emitter);
		}

		// --- Jumpers: ideal shorts by construction ---------------------------------------
		if (ev.libraryName === "Jumper") {
			diagnostics.push({
				code: "jumper-as-closed-switch",
				message: `${componentId}: jumper is a physical short by construction; kept as a closed switch`,
				componentId,
			});
			properties.State = "closed";
			const terminals = buildTerminals(part, netOf, null, emitter, componentId, collectUnmapped);
			finishUnmapped();
			return makeComponent("switch", componentId, part.refDes, "Circuit.Switch", terminals, properties, emitter);
		}

		// --- Ferrite beads: no inductance stated ------------------------------------------
		if (ev.libraryName === "Ferrite Bead") {
			diagnostics.push({
				code: "ferrite-bead-unmodelled",
				message: `${componentId}: ferrite bead states no inductance; kind unsupported`,
				componentId,
			});
			const terminals = buildTerminals(part, netOf, null, emitter, componentId, collectUnmapped);
			finishUnmapped();
			return makeComponent("unsupported", componentId, part.refDes, "Circuit.Unsupported", terminals, properties, emitter);
		}

		// --- Fallback: never guess ---------------------------------------------------------
		diagnostics.push({
			code: "unclassified-part",
			message:
				`${componentId}: no kind mapping for (library "${ev.libraryName}", category ` +
				`${ev.categoryIndex ?? "?"}, ${part.pins.length} pins, RefDes ${part.refDes}, ` +
				`pin names {${ev.pinNames.join(", ")}}); kind unsupported`,
			componentId,
		});
		const terminals = buildTerminals(part, netOf, null, emitter, componentId, collectUnmapped);
		finishUnmapped();
		return makeComponent("unsupported", componentId, part.refDes, "Circuit.Unsupported", terminals, properties, emitter);
	};

	// Suffixes for one-component-per-part splits (shared by the legacy split
	// below and by IC groups declined from the package merge).
	const splitSuffix = (index: number): string => {
		const letters = "ABCDEFGH";
		return letters[index] ?? `P${index + 1}`;
	};

	// Legacy split: one component per schematic part with a suffixed id.
	// `code` is null for IC groups declined from the package merge (the
	// decline diagnostic names the reason instead of this generic split one).
	const emitSplitParts = (
		refDes: string,
		group: DipTracePart[],
		code: DipTraceDiagnosticCode | null,
	): void => {
		group.forEach((part, index) => {
			const componentId = `${refDes}${splitSuffix(index)}`;
			if (code !== null) {
				// The dual-gang wording is unchanged (that path is untouched);
				// only the IC split wording names the merge it falls outside of.
				const message =
					code === "dual-gang-split"
						? `${componentId}: RefDes ${refDes} holds ${group.length} schematic parts; ` +
							`emitted as one component per part so no package pin order is asserted`
						: `${componentId}: RefDes ${refDes} holds ${group.length} schematic parts ` +
							`outside the IC package merge; emitted as one component per part so no package pin order is asserted`;
				diagnostics.push({ code, message, componentId });
			}
			const component = classifySingle(part, componentId);
			if (component !== null) {
				components.push(component);
			}
		});
	};

	// Would this unit classify as kind ic? Typed-field mirror of the kind
	// dispatch inside classifySingle for letter IC/U: every earlier kind
	// mapping (whole library identities, the single-pin connector shapes, the
	// LDR shape) and every non-ic outcome of the IC branch (op-amp
	// signature, power-amp, regulator, logic-unmodelled) excludes. Anything
	// not excluded reaches the IC branch's final ic return, so the merge
	// below can union the pads without re-reading roles, pinouts or prose.
	const isMergeableIcUnit = (part: DipTracePart): boolean => {
		const ev = evidenceOf(part, model);
		if (
			RESISTOR_LIB_NAMES.has(ev.libraryName) ||
			CAPACITOR_LIB_NAMES.has(ev.libraryName) ||
			ev.libraryName === "Pole_CAP" ||
			DIODE_LIB_NAMES.has(ev.libraryName) ||
			DIODE_FAMILY_LIB_NAMES.has(ev.libraryName) ||
			LED_LIB_NAMES.has(ev.libraryName) ||
			BJT_POLARITY_LIB_NAMES.has(ev.libraryName) ||
			ev.libraryName === "BJT" ||
			ev.libraryName === "MPSA14" ||
			JFET_LIB_NAMES.has(ev.libraryName) ||
			MOSFET_LIB_NAMES.has(ev.libraryName) ||
			ev.libraryName === "POT" ||
			ev.libraryName === "TRIMPOT" ||
			ev.libraryName === "PNPN PUT V2" ||
			ev.libraryName === "VTL5C2" ||
			ev.libraryName === "LDR"
		) {
			return false;
		}
		if (
			part.pins.length === 1 &&
			(ev.libraryName === "CNCT" ||
				ev.libraryName === "Untitled" ||
				ev.libraryName === "OUT" ||
				ev.libraryName === "Connector")
		) {
			return false;
		}
		if (ev.letter === "U" && ev.libraryName === "" && part.value === "LDR") {
			return false;
		}
		const pinNameSet = new Set(ev.pinNames);
		const hasOpampSignature = [...OPAMP_SIGNATURE_NAMES].every((name) =>
			pinNameSet.has(name),
		);
		const isPowerAmp =
			POWER_AMP_LIB_NAMES.has(ev.libraryName) ||
			POWER_AMP_PART_IDS.has(part.value.trim());
		if (hasOpampSignature && !isPowerAmp) {
			return false;
		}
		if (isPowerAmp) {
			return false;
		}
		if (
			orderedTuple([...ev.pinNames].sort()) ===
			orderedTuple(["GND", "IN", "OUT"])
		) {
			return false;
		}
		if (
			part.value.trim() === "CD4024BE" ||
			part.value.trim() === "42TM011R"
		) {
			return false;
		}
		return true;
	};

	// Merge one IC/U multi-unit package into a single ic component. Returns
	// true when the group is handled here (merged, or declined with the
	// split output kept); false when the group is not an IC package and the
	// legacy split below applies untouched.
	const tryMergeIcPackage = (
		refDes: string,
		group: DipTracePart[],
	): boolean => {
		if (!group.every(isMergeableIcUnit)) {
			return false;
		}
		const decline = (reason: string): boolean => {
			emitSplitParts(refDes, group, null);
			diagnostics.push({
				code: "multipart-merge-declined",
				message: `${refDes}: not merged (${reason}); emitted as one component per part`,
				componentId: refDes,
			});
			return true;
		};
		const styles = new Set(group.map((part) => part.style));
		if (styles.size !== 1) {
			return decline(
				`units differ in ComponentStyle (${[...styles].join(", ")})`,
			);
		}
		const sections = group.map((part) => part.section);
		if (new Set(sections).size !== sections.length) {
			return decline(`units share a ComponentPart (${sections.join(", ")})`);
		}
		const first = group[0];
		if (first === undefined) {
			return false;
		}
		if (
			first.value.trim().length === 0 ||
			!group.every((part) => part.value === first.value)
		) {
			const values = group.map((part) =>
				part.value.length > 0 ? `"${part.value}"` : "(empty)",
			);
			return decline(
				`units state different or empty values (${values.join(", ")})`,
			);
		}
		for (const part of group) {
			const placed = model.library.some(
				(section) =>
					section.style === part.style && section.sectionId === part.section,
			);
			if (!placed) {
				return decline(
					`placed unit ${part.partRefDes} has no library section for style "${part.style}" part "${part.section}"`,
				);
			}
		}
		// Net identity per schematic pin, for the shared-pad check below.
		const netOf = new Map<string, string>();
		for (const net of model.nets) {
			for (const member of net.members) {
				netOf.set(`${member.partId}\0${member.pinId}`, net.id);
			}
		}
		// One pad token on two units must name one net; two nets decline.
		// Duplicate pads within one unit keep the legacy rename below.
		const padUnits = new Map<string, Set<number>>();
		const padNets = new Map<string, Set<string>>();
		group.forEach((part, unitIndex) => {
			for (const pin of part.pins) {
				const units = padUnits.get(pin.padNumber) ?? new Set<number>();
				units.add(unitIndex);
				padUnits.set(pin.padNumber, units);
				const net = netOf.get(`${part.id}\0${pin.pinId}`);
				if (net !== undefined) {
					const nets = padNets.get(pin.padNumber) ?? new Set<string>();
					nets.add(net);
					padNets.set(pin.padNumber, nets);
				}
			}
		});
		for (const [pad, nets] of padNets) {
			if ((padUnits.get(pad)?.size ?? 0) > 1 && nets.size > 1) {
				return decline(`pad "${pad}" appears on units with different nets`);
			}
		}
		// Per-unit diagnostics still hold for the merged package.
		for (const part of group) {
			notePadMismatch(part);
			noteLibraryPinMissing(part);
		}
		const style = first.style;
		const placedSections = new Set<string>();
		for (const part of model.parts) {
			if (part.style === style) {
				placedSections.add(part.section);
			}
		}
		const taken = new Set<string>();
		const seenPadNet = new Map<string, string | null>();
		type PendingTerminal = {
			name: string;
			position: Point;
			pad: string;
			unit: number;
			pin: string;
		};
		const pending: PendingTerminal[] = [];
		group.forEach((part, unitIndex) => {
			const resolveNet = netOfPin(part);
			for (const index of sortedPinIndices(part.pins)) {
				const pin = part.pins[index];
				if (pin === undefined) {
					continue;
				}
				const net = netOf.get(`${part.id}\0${pin.pinId}`) ?? null;
				const seen = seenPadNet.get(pin.padNumber);
				// Same pad, same net folds into one pin (shared power pads
				// deduplicated by pad number). A second net on the same unit
				// keeps the legacy rename; across units it declined above.
				// Empty pad tokens never fold: the pad is unstated.
				if (
					pin.padNumber.length > 0 &&
					seen !== undefined &&
					seen === net
				) {
					continue;
				}
				const position = resolveNet(pin.pinId) ?? floaterPosition(emitter);
				pending.push({
					name: uniqueTerminalName(
						taken,
						pin.padNumber,
						pin.pinId,
						emitter,
						refDes,
					),
					position,
					pad: pin.padNumber,
					unit: unitIndex,
					pin: pin.pinId,
				});
				if (seen === undefined) {
					seenPadNet.set(pin.padNumber, net);
				}
			}
		});
		// Spare library sections of the same style (placed by no part in the
		// document) contribute their pads as unconnected pins.
		for (const section of model.library) {
			if (section.style !== style || placedSections.has(section.sectionId)) {
				continue;
			}
			for (const pin of section.pins) {
				const pad = pin.padNumber.length > 0 ? pin.padNumber : pin.pinId;
				if (pad.length > 0 && seenPadNet.has(pad)) {
					continue;
				}
				pending.push({
					name: uniqueTerminalName(taken, pad, pin.pinId, emitter, refDes),
					position: floaterPosition(emitter),
					pad,
					unit: group.length,
					pin: pin.pinId,
				});
				if (pad.length > 0 && !seenPadNet.has(pad)) {
					seenPadNet.set(pad, null);
				}
			}
		}
		pending.sort((a, b) => {
			const ka = padSortKey(a.pad);
			const kb = padSortKey(b.pad);
			if (ka[0] !== kb[0]) {
				return ka[0] - kb[0];
			}
			if (ka[1] !== kb[1]) {
				return ka[1] < kb[1] ? -1 : 1;
			}
			if (a.unit !== b.unit) {
				return a.unit - b.unit;
			}
			return a.pin < b.pin ? -1 : a.pin > b.pin ? 1 : 0;
		});
		const terminals: Terminal[] = pending.map(({ name, position }) => ({
			name,
			position,
		}));
		const properties = baseProperties(
			first,
			evidenceOf(first, model).libraryName,
		);
		properties.PartNumber = first.value;
		components.push(
			makeComponent("ic", refDes, refDes, "Circuit.IC", terminals, properties, emitter),
		);
		// The split below would consume one origin per unit; burn the
		// difference so later components keep their sequence numbers.
		emitter.componentSeq.next += group.length - 1;
		diagnostics.push({
			code: "multipart-sections-merged",
			message:
				`${refDes}: ${group.length} parts share RefDes, style and PartNumber; ` +
				`merged into one ic with terminals named by pad number in pad order`,
			componentId: refDes,
		});
		return true;
	};

	// Emit one component per schematic part, except switch fragments sharing a
	// RefDes (each a single pin of one physical switch: a one-terminal switch
	// is not a device, so the RefDes group is merged).
	for (const [refDes, group] of groups) {
		if (
			refDesLetter(refDes) === "SW" &&
			group.length > 1 &&
			group.every((part) => part.pins.length === 1)
		) {
			const first = group[0];
			if (first === undefined) {
				continue;
			}
			const mergedPins = group.flatMap((part) => part.pins);
			const merged: DipTracePart = {
				...first,
				pins: mergedPins,
			};
			diagnostics.push({
				code: "switch-fragments-merged",
				message: `${refDes}: ${group.length} single-pin switch fragments merged into one switch; throws unordered, compiler default position applies`,
				componentId: refDes,
			});
			const properties = baseProperties(first, evidenceOf(first, model).libraryName);
			if (first.value.length > 0) {
				properties.Function = first.value;
			}
			notePadMismatch(merged);
			noteLibraryPinMissing(merged);
			const taken = new Set<string>();
			const terminals: Terminal[] = [];
			for (const part of group) {
				const netOf = netOfPin(part);
				for (const pin of part.pins) {
					const position = netOf(pin.pinId) ?? floaterPosition(emitter);
					terminals.push({
						name: uniqueTerminalName(taken, pin.padNumber, pin.pinId, emitter, refDes),
						position,
					});
				}
			}
			components.push(
				makeComponent("switch", refDes, refDes, "Circuit.Switch", terminals, properties, emitter),
			);
			diagnostics.push({
				code: "switch-position-defaulted",
				message: `${refDes}: switch states no position; the compiler default applies and the position is unclaimed`,
				componentId: refDes,
			});
			continue;
		}
		if (group.length === 1) {
			const single = group[0];
			if (single === undefined) {
				continue;
			}
			const component = classifySingle(single, refDes);
			if (component !== null) {
				components.push(component);
			}
			continue;
		}
		// Multi-part groups: IC/U packages merge above into one component per
		// package; what remains split here (dual-gang pots, switch groups,
		// op-amp pairs that already execute, declined IC groups with their own
		// diagnostic) emits one component per part with a suffixed id and
		// asserts no package pin order.
		const letter = refDesLetter(refDes);
		if (
			(letter === "IC" || letter === "U") &&
			tryMergeIcPackage(refDes, group)
		) {
			continue;
		}
		emitSplitParts(
			refDes,
			group,
			refDesLetter(refDes) === "P" ? "dual-gang-split" : "multipart-sections-split",
		);
	}

	// Audio ports: exactly one IN and one OUT proposal, or a named refusal.
	// Single-pin connector/NetPort labels outrank multi-pin jack labels: a
	// 6-pin jack's tip is ambiguous, so it only proposes when no single-pin
	// label exists.
	const singleIn = audioInCandidates.filter(
		(entry) => !entry.endsWith("(jack)"),
	);
	const singleOut = audioOutCandidates.filter(
		(entry) => !entry.endsWith("(jack)"),
	);
	let inCandidates = audioInCandidates;
	let outCandidates = audioOutCandidates;
	if (singleIn.length === 1 && singleOut.length === 1) {
		const dropped = audioInCandidates.length + audioOutCandidates.length - 2;
		if (dropped > 0) {
			diagnostics.push({
				code: "jack-audio-ambiguous",
				message:
					"multi-pin jack audio labels superseded by single-pin connector labels; jack candidates not used",
			});
		}
		inCandidates = singleIn;
		outCandidates = singleOut;
	} else if (singleIn.length === 0 && singleOut.length === 0) {
		inCandidates = audioInCandidates;
		outCandidates = audioOutCandidates;
	} else {
		inCandidates = singleIn.length > 0 ? singleIn : audioInCandidates;
		outCandidates = singleOut.length > 0 ? singleOut : audioOutCandidates;
	}
	if (inCandidates.length !== 1 || outCandidates.length !== 1) {
		const reason =
			`audio-ports-unresolved: found ${inCandidates.length} IN ` +
			`(${inCandidates.join(", ") || "none"}) and ${outCandidates.length} OUT ` +
			`(${outCandidates.join(", ") || "none"}); v4 requires exactly one of each`;
		diagnostics.push({ code: "audio-ports-unresolved", message: reason });
		return { document: null, refusal: reason, diagnostics };
	}
	const takeId = (entry: string | undefined): string | null =>
		entry === undefined ? null : entry.replace(/ \([^)]*\)$/, "");
	audioIn = takeId(inCandidates[0]);
	audioOut = takeId(outCandidates[0]);
	if (audioIn === null || audioOut === null) {
		const reason = "audio-ports-unresolved: no audio candidates";
		return { document: null, refusal: reason, diagnostics };
	}

	if (railCount > 0) {
		diagnostics.push({
			code: "supply-assumed",
			message:
				`declared supply ${emitter.supplyVolts} V on ${railCount} rail ` +
				`component${railCount === 1 ? "" : "s"} (option supplyVolts, default 9); no voltage is in the source`,
		});
	}
	diagnostics.push({
		code: "bypass-none",
		message:
			"audio.bypass is none: no footswitch-class part in the source carries bypass function evidence, so absence is declared rather than omitted",
	});
	if (emitter.taperConvention !== undefined) {
		const declared = emitter.taperDeclaredCount.next;
		diagnostics.push({
			code: "taper-convention-declared",
			message:
				`import ran under the owner-declared ${emitter.taperConvention} taper convention: ` +
				`${declared} potentiometer${declared === 1 ? "" : "s"} declare a taper law from a printed A/B/C marking; ` +
				`a wrong convention for a given designer swaps A and B — audit via TaperMarking`,
		});
	}

	const document: CircuitDocument = {
		metadata: {
			name: options.name ?? "diptrace-import",
			description:
				`Imported from DipTrace .dchxml schematic. Supply ${emitter.supplyVolts} V declared by importer ` +
				`option (not in source). Audio input ${audioIn} (label IN), output ${audioOut} ` +
				`(label OUT), bypass none.`,
			partNumber: "",
		},
		source: {
			format: "diptrace-dchxml",
			importer: "@vessel-dsp/core diptrace",
			supplyVolts: String(emitter.supplyVolts),
			...(emitter.taperConvention === undefined
				? {}
				: { taperConvention: emitter.taperConvention }),
		},
		audio: { input: audioIn, output: audioOut, bypass: "none" },
		components,
		wires: [],
		directives: [],
		warnings: [],
		rawAttributes: { format: "diptrace-dchxml" },
	};
	return { document, refusal: null, diagnostics };
}
