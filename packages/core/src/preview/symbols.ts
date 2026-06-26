import { propertyStringValue } from "../model/properties";
import type { ComponentKind, PropertyValue } from "../model/types";
import { SYMBOL_CONTENT, type SymbolContent } from "./symbols/svg-content";

export type SymbolDef = SymbolContent;
export type SymbolProperties = Readonly<Record<string, PropertyValue>>;

const FALLBACK_KEY = "unsupported";
const EMPTY_PROPERTIES: SymbolProperties = {};

function lookup(key: string): SymbolDef {
	const def = SYMBOL_CONTENT[key];
	if (def === undefined) {
		return SYMBOL_CONTENT[FALLBACK_KEY] as SymbolDef;
	}
	return def;
}

export function symbolFor(
	kind: ComponentKind,
	sourceTypeName: string | null = null,
	properties: SymbolProperties = EMPTY_PROPERTIES,
): SymbolDef {
	return lookup(resolveKey(kind, sourceTypeName, properties));
}

function resolveKey(
	kind: ComponentKind,
	sourceTypeName: string | null,
	properties: SymbolProperties,
): string {
	switch (kind) {
		case "capacitor":
			return resolveCapacitor(properties);
		case "diode":
			return resolveDiode(sourceTypeName, properties);
		case "bjt":
			return resolveBjt(sourceTypeName);
		case "jfet":
			return resolveJfet(sourceTypeName);
		case "mosfet":
			return resolveMosfet(sourceTypeName);
		case "jack":
			return resolveJack(sourceTypeName);
		case "switch":
			return resolveSwitch(sourceTypeName);
		case "variable-resistor":
			return "variable-resistor";
		case "tube-diode":
			return "tube-diode";
		case "voltage-source":
			return "voltage-source";
		case "current-source":
			return "current-source";
		case "named-wire":
			return "named-wire";
		default:
			return kind;
	}
}

const NPN_SHORT_TYPES = new Set(["NpnBjt"]);
const PNP_SHORT_TYPES = new Set(["PnpBjt"]);

function resolveBjt(sourceTypeName: string | null): string {
	const short = shortName(sourceTypeName);
	if (short !== null && PNP_SHORT_TYPES.has(short)) {
		return "bjt-pnp";
	}
	if (short !== null && NPN_SHORT_TYPES.has(short)) {
		return "bjt-npn";
	}
	return "bjt-npn";
}

const N_JFET_SHORT_TYPES = new Set(["NjfJfet"]);
const P_JFET_SHORT_TYPES = new Set(["PjfJfet"]);
const LIVE_SPICE_JUNCTION_FET_TYPES = new Set([
	"JunctionFieldEffectTransistor",
]);

function resolveJfet(sourceTypeName: string | null): string {
	const short = shortName(sourceTypeName);
	if (short !== null && LIVE_SPICE_JUNCTION_FET_TYPES.has(short)) {
		return "jfet-junction-n";
	}
	if (short !== null && P_JFET_SHORT_TYPES.has(short)) {
		return "jfet-p";
	}
	if (short !== null && N_JFET_SHORT_TYPES.has(short)) {
		return "jfet-n";
	}
	return "jfet-n";
}

function resolveCapacitor(properties: SymbolProperties): string {
	const material =
		propertyText(properties, "Material") ??
		propertyText(properties, "material");
	if (material !== null && material.toLowerCase().includes("electrolytic")) {
		return "capacitor-electrolytic";
	}
	return "capacitor";
}

function resolveDiode(
	sourceTypeName: string | null,
	properties: SymbolProperties,
): string {
	const short = shortName(sourceTypeName)?.toLowerCase() ?? null;
	const type = propertyText(properties, "Type")?.toLowerCase() ?? null;
	if (short === "zener" || type?.includes("zener")) {
		return "diode-zener";
	}
	if (short === "schottky" || type?.includes("schottky")) {
		return "diode-schottky";
	}
	return "diode";
}

const N_MOSFET_SHORT_TYPES = new Set(["NMosfet"]);
const P_MOSFET_SHORT_TYPES = new Set(["PMosfet"]);

function resolveMosfet(sourceTypeName: string | null): string {
	const short = shortName(sourceTypeName);
	if (short !== null && P_MOSFET_SHORT_TYPES.has(short)) {
		return "mosfet-p";
	}
	if (short !== null && N_MOSFET_SHORT_TYPES.has(short)) {
		return "mosfet-n";
	}
	return "mosfet-n";
}

const OUTPUT_JACK_SHORT_TYPES = new Set(["Speaker", "OutputJack"]);

function resolveJack(sourceTypeName: string | null): string {
	const short = shortName(sourceTypeName);
	if (short !== null && OUTPUT_JACK_SHORT_TYPES.has(short)) {
		return "jack-output";
	}
	return "jack-input";
}

function resolveSwitch(sourceTypeName: string | null): string {
	const short = shortName(sourceTypeName);
	if (short === null) {
		return "switch-spst";
	}
	switch (short.toUpperCase()) {
		case "SPDT":
		case "SP3T":
		case "SP4T":
			return "switch-spdt";
		case "3PDT":
			return "switch-3pdt";
		case "TOGGLE":
			return "switch-toggle";
		case "ROTARY":
			return "switch-rotary";
		default:
			return "switch-spst";
	}
}

function shortName(fullType: string | null): string | null {
	if (fullType === null) {
		return null;
	}
	const match = fullType.match(/Circuit\.(?:Components\.)?([A-Za-z0-9_]+)/);
	if (match?.[1] !== undefined) {
		return match[1];
	}
	const ltspiceMatch = fullType.match(/^ltspice:([A-Za-z0-9_]+)/);
	return ltspiceMatch?.[1] ?? fullType;
}

function propertyText(
	properties: SymbolProperties,
	name: string,
): string | null {
	return propertyStringValue(properties[name]);
}

export const COMPONENT_KINDS: readonly ComponentKind[] = [
	"resistor",
	"capacitor",
	"inductor",
	"diode",
	"led",
	"bjt",
	"jfet",
	"mosfet",
	"opamp",
	"ota",
	"triode",
	"pentode",
	"tube-diode",
	"transformer",
	"potentiometer",
	"variable-resistor",
	"switch",
	"optocoupler",
	"voltage-source",
	"current-source",
	"battery",
	"ground",
	"rail",
	"jack",
	"bbd",
	"delay-ic",
	"power-amp",
	"regulator",
	"analog-switch",
	"flipflop",
	"ic",
	"label",
	"named-wire",
	"port",
	"unsupported",
];
