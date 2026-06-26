import { propertyValueForSourceAttribute } from "../../model/properties";
import type {
	CircuitDocument,
	Component,
	Point,
	PropertyValue,
	Rotation,
	Wire,
} from "../../model/types";
import { LTSPICE_COORD_SCALE, normalizeLtspiceSymbolName } from "./catalog";

export type SerializeLtspiceAscOptions = Readonly<{
	version?: string;
	sheet?: string;
}>;

const KIND_TO_SYMBOL: Readonly<Record<string, string>> = {
	resistor: "res",
	capacitor: "cap",
	inductor: "ind",
	diode: "diode",
	led: "led",
	"voltage-source": "voltage",
	"current-source": "current",
	bjt: "npn",
	jfet: "njf",
	mosfet: "nmos",
};

export function serializeLtspiceAsc(
	doc: CircuitDocument,
	options: SerializeLtspiceAscOptions = {},
): string {
	const version = options.version ?? doc.rawAttributes.version ?? "4";
	const sheet = options.sheet ?? doc.rawAttributes.sheet ?? "1 880 680";
	const lines: string[] = [`Version ${version}`, `SHEET ${sheet}`];

	for (const wire of doc.wires) {
		lines.push(wireLine(wire));
	}

	for (const component of doc.components) {
		lines.push(...componentLines(component));
	}

	for (const directive of doc.directives) {
		lines.push(`TEXT 0 0 Left 2 !${encodeText(directive)}`);
	}

	return `${lines.join("\n")}\n`;
}

function componentLines(component: Component): readonly string[] {
	if (component.kind === "ground" || component.kind === "named-wire") {
		return flagLines(component);
	}
	if (component.kind === "jack") {
		return jackLines(component);
	}
	if (component.kind === "label") {
		return labelLines(component);
	}

	const symbolName = ltspiceSymbolName(component);
	const lines = [
		`SYMBOL ${symbolName} ${scaledCoordinate(component.origin.x)} ${scaledCoordinate(component.origin.y)} ${orientation(component.rotation, component.flipped)}`,
		`SYMATTR InstName ${component.name}`,
	];
	const value = componentValue(component);
	if (value !== null) {
		lines.push(`SYMATTR Value ${value}`);
	}
	for (const [key, property] of Object.entries(component.properties)) {
		if (shouldSkipSymattr(key)) {
			continue;
		}
		const serialized = propertyValueForSourceAttribute(property);
		if (serialized !== null) {
			lines.push(`SYMATTR ${key} ${serialized}`);
		}
	}
	return lines;
}

function flagLines(component: Component): readonly string[] {
	const terminal = component.terminals[0];
	const point = terminal?.position ?? component.origin;
	const name =
		component.kind === "ground"
			? "0"
			: (propertyText(component.properties.Name) ?? component.name);
	return [
		`FLAG ${scaledCoordinate(point.x)} ${scaledCoordinate(point.y)} ${name}`,
	];
}

function jackLines(component: Component): readonly string[] {
	const terminal = component.terminals[0];
	const point = terminal?.position ?? component.origin;
	const name = propertyText(component.properties.Name) ?? component.name;
	const polarity =
		propertyText(component.properties.polarity) ??
		(component.sourceTypeName?.toLowerCase().includes("output") === true
			? "Out"
			: "In");
	return [
		`FLAG ${scaledCoordinate(point.x)} ${scaledCoordinate(point.y)} ${name}`,
		`IOPIN ${scaledCoordinate(point.x)} ${scaledCoordinate(point.y)} ${polarity}`,
	];
}

function labelLines(component: Component): readonly string[] {
	const text = propertyText(component.properties.Text) ?? component.name;
	return [
		`TEXT ${scaledCoordinate(component.origin.x)} ${scaledCoordinate(component.origin.y)} Left 2 ;${encodeText(text)}`,
	];
}

function wireLine(wire: Wire): string {
	return [
		"WIRE",
		scaledCoordinate(wire.endpoints[0].x),
		scaledCoordinate(wire.endpoints[0].y),
		scaledCoordinate(wire.endpoints[1].x),
		scaledCoordinate(wire.endpoints[1].y),
	].join(" ");
}

function ltspiceSymbolName(component: Component): string {
	if (component.sourceTypeName?.startsWith("ltspice:") === true) {
		const source = component.sourceTypeName.slice("ltspice:".length);
		if (source !== "flag" && source !== "text" && source.length > 0) {
			return normalizeLtspiceSymbolName(source);
		}
	}
	return KIND_TO_SYMBOL[component.kind] ?? "unknown";
}

function componentValue(component: Component): string | null {
	const keys = [
		"Value",
		"R",
		"Resistance",
		"C",
		"Capacitance",
		"L",
		"Inductance",
		"V",
		"Voltage",
		"I",
		"Current",
		"model",
		"Model",
	];
	for (const key of keys) {
		const value = component.properties[key];
		const serialized =
			value === undefined ? null : propertyValueForSourceAttribute(value);
		if (serialized !== null && serialized.trim().length > 0) {
			return serialized;
		}
	}
	return null;
}

function propertyText(value: PropertyValue | undefined): string | null {
	const serialized =
		value === undefined ? null : propertyValueForSourceAttribute(value);
	return serialized === null || serialized.trim().length === 0
		? null
		: serialized;
}

function shouldSkipSymattr(key: string): boolean {
	return new Set([
		"Name",
		"Value",
		"R",
		"Resistance",
		"C",
		"Capacitance",
		"L",
		"Inductance",
		"V",
		"Voltage",
		"I",
		"Current",
	]).has(key);
}

function orientation(rotation: Rotation, flipped: boolean): string {
	const prefix = flipped ? "M" : "R";
	return `${prefix}${rotation * 90}`;
}

function scaledCoordinate(value: number): number {
	return Math.round(value / LTSPICE_COORD_SCALE);
}

function encodeText(text: string): string {
	return text.replaceAll("\n", "\\n");
}
