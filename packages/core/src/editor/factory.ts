import {
	defaultDefForKind,
	lookupSchxDef,
	type SchxComponentDef,
} from "../formats/schx/catalog";
import { mapTerminal } from "../formats/schx/transforms";
import type { Component, ComponentKind, Point } from "../model/types";

export type CreateComponentArgs = Readonly<{
	kind: ComponentKind;
	origin: Point;
	sourceTypeName?: string | null;
	existingIds?: ReadonlySet<string>;
	name?: string;
}>;

export function buildComponent(args: CreateComponentArgs): Component {
	const def = resolveDef(args.kind, args.sourceTypeName ?? null);
	const terminals = def.terminals.map((t) => ({
		name: t.name,
		position: mapTerminal(t.local, args.origin, 0, false),
	}));
	const id = args.name ?? uniqueId(args.kind, args.existingIds ?? new Set());
	return {
		id,
		kind: args.kind,
		name: id,
		origin: args.origin,
		rotation: 0,
		flipped: false,
		terminals,
		properties: defaultPropertiesForKind(args.kind),
		sourceTypeName: args.sourceTypeName ?? null,
	};
}

function defaultPropertiesForKind(
	kind: ComponentKind,
): Readonly<Record<string, string>> {
	// Labels are pure annotation — without a Text property they render their
	// auto-generated id (e.g. "LBL1") which is confusing. Seed Text so the
	// Inspector has something editable the moment the label lands.
	if (kind === "label") {
		return { Text: "Note" };
	}
	return {};
}

function resolveDef(
	kind: ComponentKind,
	sourceTypeName: string | null,
): SchxComponentDef {
	const short = shortName(sourceTypeName);
	if (short !== null) {
		const byShort = lookupSchxDef(short);
		if (byShort !== undefined) {
			return byShort;
		}
	}
	const byKind = defaultDefForKind(kind);
	if (byKind !== undefined) {
		return byKind;
	}
	const editorDefault = EDITOR_DEFAULT_DEFS[kind];
	if (editorDefault !== undefined) {
		return editorDefault;
	}
	return FALLBACK_DEF;
}

function shortName(fullType: string | null): string | null {
	if (fullType === null) {
		return null;
	}
	const match = fullType.match(/Circuit\.(?:Components\.)?([A-Za-z0-9_]+)/);
	if (match?.[1] !== undefined) {
		return match[1];
	}
	return fullType;
}

const ID_PREFIX: Readonly<Record<ComponentKind, string>> = {
	resistor: "R",
	capacitor: "C",
	inductor: "L",
	diode: "D",
	led: "LED",
	bjt: "Q",
	jfet: "J",
	mosfet: "M",
	opamp: "U",
	ota: "U",
	triode: "VT",
	pentode: "VP",
	"tube-diode": "VD",
	transformer: "T",
	potentiometer: "RV",
	"variable-resistor": "VR",
	switch: "SW",
	optocoupler: "OPT",
	"voltage-source": "V",
	"current-source": "I",
	battery: "BAT",
	ground: "GND",
	rail: "RAIL",
	jack: "JK",
	bbd: "U",
	"delay-ic": "U",
	"power-amp": "U",
	regulator: "REG",
	"power-converter": "U",
	"analog-switch": "SW",
	flipflop: "FF",
	ic: "U",
	label: "LBL",
	"named-wire": "NW",
	port: "P",
	unsupported: "X",
};

function uniqueId(kind: ComponentKind, existing: ReadonlySet<string>): string {
	const prefix = ID_PREFIX[kind];
	let n = 1;
	while (existing.has(`${prefix}${n}`)) {
		n += 1;
	}
	return `${prefix}${n}`;
}

const FALLBACK_DEF: SchxComponentDef = {
	shortType: "Unknown",
	kind: "unsupported",
	terminals: [],
	quantityProps: [],
};

const EDITOR_DEFAULT_DEFS: Partial<Record<ComponentKind, SchxComponentDef>> = {
	led: {
		shortType: "LED",
		kind: "led",
		terminals: [
			{ name: "anode", local: { x: 0, y: 20 } },
			{ name: "cathode", local: { x: 0, y: -20 } },
		],
		quantityProps: [],
	},
	optocoupler: {
		shortType: "Optocoupler",
		kind: "optocoupler",
		terminals: [
			{ name: "led+", local: { x: -20, y: 10 } },
			{ name: "led-", local: { x: -20, y: -10 } },
			{ name: "r1", local: { x: 20, y: 10 } },
			{ name: "r2", local: { x: 20, y: -10 } },
		],
		quantityProps: [],
	},
};
