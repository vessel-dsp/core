import { parseQuantity } from "../../model/quantity";
import type {
	CircuitDocument,
	Component,
	DocumentMetadata,
	Point,
	PropertyValue,
	Warning,
	Wire,
} from "../../model/types";
import { splitWiresAtJunctions } from "../../model/wires";
import {
	extractModelFromSymbolPath,
	lookupLtspiceSymbolDef,
	LTSPICE_COORD_SCALE,
	mapLtspiceTerminal,
	normalizeLtspiceSymbolName,
	type LtspiceSymbolDef,
} from "./catalog";
import { decodeLtspiceBytes } from "./encoding";

type MutableLtspiceSymbol = {
	readonly sourceName: string;
	readonly placement: Point;
	readonly orientation: string;
	readonly index: number;
	readonly attrs: Map<string, string>;
};

type LtspiceFlag = Readonly<{
	point: Point;
	name: string;
}>;

type LtspiceText = Readonly<{
	point: Point;
	text: string;
}>;

const IGNORED_KEYWORDS = new Set<string>([
	"WINDOW",
	"LINE",
	"RECTANGLE",
	"CIRCLE",
	"ARC",
	"DATAFLAG",
	"BUSTAP",
]);

export function parseLtspiceAsc(source: string | Uint8Array): CircuitDocument {
	const text = typeof source === "string" ? source : decodeLtspiceBytes(source);
	const normalized = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
	const lines = normalized.split("\n");
	const firstLine = lines.find((line) => line.trim().length > 0)?.trim() ?? "";
	if (!firstLine.toUpperCase().startsWith("VERSION ")) {
		throw new Error("not an LTspice ASC schematic: missing Version header");
	}

	const warnings: Warning[] = [];
	const wires: Wire[] = [];
	const symbols: MutableLtspiceSymbol[] = [];
	const flags: LtspiceFlag[] = [];
	const iopins = new Map<string, string>();
	const directives: string[] = [];
	const texts: LtspiceText[] = [];
	let currentSymbol: MutableLtspiceSymbol | null = null;
	let version = "";
	let sheet = "";

	lines.forEach((line, lineIndex) => {
		const trimmed = line.trim();
		if (trimmed.length === 0) {
			return;
		}

		const tokens = trimmed.split(/\s+/);
		const keyword = (tokens[0] ?? "").toUpperCase();

		switch (keyword) {
			case "VERSION":
				version = tokens.slice(1).join(" ");
				break;
			case "SHEET":
				sheet = tokens.slice(1).join(" ");
				break;
			case "WIRE": {
				const wire = parseWire(tokens, wires.length, lineIndex, warnings);
				if (wire !== null) {
					wires.push(wire);
				}
				break;
			}
			case "FLAG": {
				const flag = parseFlag(tokens, lineIndex, warnings);
				if (flag !== null) {
					flags.push(flag);
				}
				break;
			}
			case "IOPIN": {
				const iopin = parseIoPin(tokens, lineIndex, warnings);
				if (iopin !== null) {
					iopins.set(pointKey(iopin.point), iopin.polarity);
				}
				break;
			}
			case "SYMBOL": {
				currentSymbol = parseSymbol(
					tokens,
					symbols.length,
					lineIndex,
					warnings,
				);
				if (currentSymbol !== null) {
					symbols.push(currentSymbol);
				}
				break;
			}
			case "SYMATTR": {
				parseSymbolAttribute(tokens, currentSymbol, lineIndex, warnings);
				break;
			}
			case "TEXT": {
				parseText(tokens, lineIndex, warnings, directives, texts);
				break;
			}
			default:
				if (!IGNORED_KEYWORDS.has(keyword)) {
					warnings.push({
						code: "unknown-ltspice-line",
						message: `Line ${lineIndex + 1}: unsupported LTspice command "${tokens[0] ?? ""}"`,
					});
				}
				break;
		}
	});

	const usedIds = new Map<string, number>();
	const components = [
		...symbols.map((symbol) => buildSymbolComponent(symbol, usedIds, warnings)),
		...flags.map((flag) =>
			buildFlagComponent(flag, iopins.get(pointKey(flag.point)), usedIds),
		),
		...texts.map((text, index) => buildTextComponent(text, index, usedIds)),
	];
	const metadata: DocumentMetadata = {
		name: "",
		description: "",
		partNumber: "",
	};

	return {
		metadata,
		components,
		wires: splitWiresAtJunctions(wires),
		directives,
		warnings,
		rawAttributes: buildRawAttributes(version, sheet),
	};
}

function parseWire(
	tokens: readonly string[],
	wireCount: number,
	lineIndex: number,
	warnings: Warning[],
): Wire | null {
	if (tokens.length < 5) {
		warnings.push({
			code: "invalid-wire",
			message: `Line ${lineIndex + 1}: WIRE requires four coordinates`,
		});
		return null;
	}
	const a = parsePoint(tokens[1], tokens[2]);
	const b = parsePoint(tokens[3], tokens[4]);
	if (a === null || b === null) {
		warnings.push({
			code: "invalid-wire",
			message: `Line ${lineIndex + 1}: WIRE has malformed coordinates`,
		});
		return null;
	}
	return { id: `wire-${wireCount + 1}`, endpoints: [a, b] };
}

function parseFlag(
	tokens: readonly string[],
	lineIndex: number,
	warnings: Warning[],
): LtspiceFlag | null {
	if (tokens.length < 4) {
		warnings.push({
			code: "invalid-flag",
			message: `Line ${lineIndex + 1}: FLAG requires x, y, and name`,
		});
		return null;
	}
	const point = parsePoint(tokens[1], tokens[2]);
	if (point === null) {
		warnings.push({
			code: "invalid-flag",
			message: `Line ${lineIndex + 1}: FLAG has malformed coordinates`,
		});
		return null;
	}
	return { point, name: tokens.slice(3).join(" ") };
}

function parseIoPin(
	tokens: readonly string[],
	lineIndex: number,
	warnings: Warning[],
): Readonly<{ point: Point; polarity: string }> | null {
	if (tokens.length < 4) {
		warnings.push({
			code: "invalid-iopin",
			message: `Line ${lineIndex + 1}: IOPIN requires x, y, and polarity`,
		});
		return null;
	}
	const point = parsePoint(tokens[1], tokens[2]);
	if (point === null) {
		warnings.push({
			code: "invalid-iopin",
			message: `Line ${lineIndex + 1}: IOPIN has malformed coordinates`,
		});
		return null;
	}
	return { point, polarity: tokens.slice(3).join(" ") };
}

function parseSymbol(
	tokens: readonly string[],
	symbolCount: number,
	lineIndex: number,
	warnings: Warning[],
): MutableLtspiceSymbol | null {
	if (tokens.length < 5) {
		warnings.push({
			code: "invalid-symbol",
			message: `Line ${lineIndex + 1}: SYMBOL requires name, x, y, and orientation`,
		});
		return null;
	}
	const placement = parsePoint(tokens[2], tokens[3]);
	if (placement === null) {
		warnings.push({
			code: "invalid-symbol",
			message: `Line ${lineIndex + 1}: SYMBOL has malformed coordinates`,
		});
		return null;
	}
	return {
		sourceName: tokens[1] ?? "",
		placement,
		orientation: tokens[4] ?? "R0",
		index: symbolCount,
		attrs: new Map<string, string>(),
	};
}

function parseSymbolAttribute(
	tokens: readonly string[],
	currentSymbol: MutableLtspiceSymbol | null,
	lineIndex: number,
	warnings: Warning[],
): void {
	if (currentSymbol === null) {
		warnings.push({
			code: "orphan-symbol-attribute",
			message: `Line ${lineIndex + 1}: SYMATTR without preceding SYMBOL`,
		});
		return;
	}
	if (tokens.length < 3) {
		warnings.push({
			code: "invalid-symbol-attribute",
			message: `Line ${lineIndex + 1}: SYMATTR requires key and value`,
		});
		return;
	}
	currentSymbol.attrs.set(tokens[1] ?? "", tokens.slice(2).join(" "));
}

function parseText(
	tokens: readonly string[],
	lineIndex: number,
	warnings: Warning[],
	directives: string[],
	texts: LtspiceText[],
): void {
	if (tokens.length < 6) {
		warnings.push({
			code: "invalid-text",
			message: `Line ${lineIndex + 1}: TEXT requires x, y, alignment, size, and text`,
		});
		return;
	}
	const point = parsePoint(tokens[1], tokens[2]);
	if (point === null) {
		warnings.push({
			code: "invalid-text",
			message: `Line ${lineIndex + 1}: TEXT has malformed coordinates`,
		});
		return;
	}
	const raw = tokens.slice(5).join(" ");
	if (raw.startsWith("!")) {
		directives.push(decodeText(raw.slice(1).trim()));
		return;
	}
	texts.push({
		point,
		text: decodeText(raw.startsWith(";") ? raw.slice(1).trim() : raw),
	});
}

function buildSymbolComponent(
	symbol: MutableLtspiceSymbol,
	usedIds: Map<string, number>,
	warnings: Warning[],
): Component {
	const normalizedName = normalizeLtspiceSymbolName(symbol.sourceName);
	const def = lookupLtspiceSymbolDef(symbol.sourceName);
	const baseName =
		getAttr(symbol.attrs, "InstName") ?? `${normalizedName}${symbol.index + 1}`;
	const id = uniqueId(baseName, usedIds);
	const terminals = (def?.terminals ?? []).map((terminal) => ({
		name: terminal.name,
		position: mapLtspiceTerminal(
			terminal.local,
			symbol.placement,
			symbol.orientation,
		),
	}));

	if (def === undefined) {
		warnings.push({
			code: "unknown-ltspice-symbol",
			message: `${id}: unsupported LTspice symbol "${symbol.sourceName}"`,
			componentId: id,
		});
	}

	return {
		id,
		kind: def?.kind ?? "unsupported",
		name: baseName,
		origin: symbol.placement,
		rotation: rotationFromLtspiceOrientation(symbol.orientation),
		flipped: symbol.orientation.toUpperCase().startsWith("M"),
		terminals,
		properties: buildProperties(symbol.attrs, def, symbol.sourceName),
		sourceTypeName: `ltspice:${normalizedName}`,
	};
}

function buildFlagComponent(
	flag: LtspiceFlag,
	polarity: string | undefined,
	usedIds: Map<string, number>,
): Component {
	const isGround = flag.name === "0";
	const isJack = polarity !== undefined;
	const baseName = isGround ? "GND" : flag.name;
	const properties: Record<string, PropertyValue> = { Name: flag.name };
	if (polarity !== undefined) {
		properties.polarity = polarity;
		properties.connector = '1/4" TS jack';
	}

	return {
		id: uniqueId(baseName, usedIds),
		kind: isJack ? "jack" : isGround ? "ground" : "named-wire",
		name: baseName,
		origin: flag.point,
		rotation: 0,
		flipped: false,
		terminals: [{ name: isJack ? "tip" : "t", position: flag.point }],
		properties,
		sourceTypeName: isJack ? ltspiceJackSourceType(polarity) : "ltspice:FLAG",
	};
}

function ltspiceJackSourceType(polarity: string | undefined): string {
	return polarity?.toLowerCase() === "out"
		? "ltspice:OutputJack"
		: "ltspice:InputJack";
}

function buildTextComponent(
	text: LtspiceText,
	index: number,
	usedIds: Map<string, number>,
): Component {
	const id = uniqueId(`TEXT${index + 1}`, usedIds);
	return {
		id,
		kind: "label",
		name: id,
		origin: text.point,
		rotation: 0,
		flipped: false,
		terminals: [],
		properties: { Text: text.text },
		sourceTypeName: "ltspice:TEXT",
	};
}

function buildProperties(
	attrs: ReadonlyMap<string, string>,
	def: LtspiceSymbolDef | undefined,
	rawSymbolName: string,
): Readonly<Record<string, PropertyValue>> {
	const properties: Record<string, PropertyValue> = {};
	for (const [key, value] of attrs) {
		properties[key] = value;
	}

	const value = getAttr(attrs, "Value");
	if (value !== null && def !== undefined) {
		if (def.valueProperty !== null) {
			properties[def.valueProperty] = parseQuantity(value) ?? value;
		}
		if (def.modelFromValue) {
			properties.model = value;
		}
	}

	if (def?.modelFromSymbolPath === true && properties.model === undefined) {
		properties.model = extractModelFromSymbolPath(rawSymbolName);
	}

	return properties;
}

function getAttr(
	attrs: ReadonlyMap<string, string>,
	wanted: string,
): string | null {
	for (const [key, value] of attrs) {
		if (key.toLowerCase() === wanted.toLowerCase()) {
			return value;
		}
	}
	return null;
}

function buildRawAttributes(
	version: string,
	sheet: string,
): Readonly<Record<string, string>> {
	const attrs: Record<string, string> = { format: "ltspice-asc" };
	if (version.length > 0) {
		attrs.version = version;
	}
	if (sheet.length > 0) {
		attrs.sheet = sheet;
	}
	return attrs;
}

function parsePoint(
	xText: string | undefined,
	yText: string | undefined,
): Point | null {
	const x = Number.parseInt(xText ?? "", 10);
	const y = Number.parseInt(yText ?? "", 10);
	if (!Number.isFinite(x) || !Number.isFinite(y)) {
		return null;
	}
	// Scale LTspice grid units down to the document-level scale used by the rest
	// of the library — see LTSPICE_COORD_SCALE in catalog.ts for the rationale.
	return { x: x * LTSPICE_COORD_SCALE, y: y * LTSPICE_COORD_SCALE };
}

function pointKey(point: Point): string {
	return `${point.x},${point.y}`;
}

function uniqueId(baseName: string, usedIds: Map<string, number>): string {
	const sanitized = baseName
		.replace(/\s+/g, "-")
		.replace(/[^A-Za-z0-9_-]/g, "");
	const base = sanitized.length > 0 ? sanitized : "component";
	const count = usedIds.get(base) ?? 0;
	usedIds.set(base, count + 1);
	return count === 0 ? base : `${base}-${count + 1}`;
}

function decodeText(text: string): string {
	return text.replaceAll("\\n", "\n");
}

function rotationFromLtspiceOrientation(
	orientation: string,
): Component["rotation"] {
	const match = orientation.toUpperCase().match(/[MR](0|90|180|270)$/);
	if (match?.[1] === "90") {
		return 1;
	}
	if (match?.[1] === "180") {
		return 2;
	}
	if (match?.[1] === "270") {
		return 3;
	}
	return 0;
}
