import { parseQuantity } from "../../model/quantity";
import type {
	CircuitDocument,
	Component,
	ComponentKind,
	DocumentMetadata,
	ParsedQuantity,
	Point,
	PropertyValue,
	Rotation,
	Warning,
	Wire,
} from "../../model/types";
import { splitWiresAtJunctions } from "../../model/wires";
import {
	isSchxRuntimeDescriptor,
	lookupSchxDef,
	shortenSchxType,
	type SchxComponentDef,
} from "./catalog";
import { runtimeDescriptorProperties } from "./runtime-descriptors";
import { mapTerminal, normalizeRotation } from "./transforms";

const ELEMENT_REGEX =
	/<Element\b([^>]*?)\/>|<Element\b([^>]*?)>([\s\S]*?)<\/Element>/g;
const COMPONENT_REGEX = /<Component\b([^>]*?)\/>/;
const ATTR_REGEX = /([A-Za-z_][A-Za-z0-9_:.-]*)="([^"]*)"/g;
const ROOT_REGEX = /<Schematic\b([^>]*)>/;
const COMMENT_REGEX = /<!--[\s\S]*?-->/g;

export function parseSchx(xml: string): CircuitDocument {
	const normalized = xml.replace(/^﻿/, "").replace(COMMENT_REGEX, "");
	const rootMatch = normalized.match(ROOT_REGEX);
	if (!rootMatch || rootMatch[1] === undefined) {
		throw new Error("not a LiveSPICE schematic: missing <Schematic> root");
	}

	const rawAttributes = parseAttributes(rootMatch[1]);
	const metadata = parseMetadata(rawAttributes);
	const warnings: Warning[] = [];
	const components: Component[] = [];
	const wires: Wire[] = [];
	const usedIds = new Map<string, number>();
	let elementIndex = 0;

	for (const match of normalized.matchAll(ELEMENT_REGEX)) {
		const headAttrs = match[1] ?? match[2] ?? "";
		const body = match[3] ?? "";
		const attrs = parseAttributes(headAttrs);
		const typeName = attrs.Type ?? "";

		if (typeName.includes("Circuit.Wire")) {
			const wire = parseWireElement(
				attrs,
				elementIndex,
				wires.length,
				warnings,
			);
			if (wire) {
				wires.push(wire);
			}
		} else if (typeName.includes("Circuit.Symbol")) {
			const component = parseSymbolElement(
				attrs,
				body,
				elementIndex,
				usedIds,
				warnings,
			);
			if (component) {
				components.push(component);
			}
		} else if (typeName.length > 0) {
			warnings.push({
				code: "unsupported-element",
				message: `Element ${elementIndex + 1}: unsupported Element type "${typeName}"`,
			});
		}

		elementIndex += 1;
	}

	return {
		metadata,
		components,
		wires: splitWiresAtJunctions(wires),
		directives: [],
		warnings,
		rawAttributes,
	};
}

function parseMetadata(
	attrs: Readonly<Record<string, string>>,
): DocumentMetadata {
	return {
		name: attrs.Name ?? "",
		description: attrs.Description ?? "",
		partNumber: attrs.PartNumber ?? "",
	};
}

function parseWireElement(
	attrs: Readonly<Record<string, string>>,
	elementIndex: number,
	wireCount: number,
	warnings: Warning[],
): Wire | null {
	const a = parsePoint(attrs.A);
	const b = parsePoint(attrs.B);
	if (a === null || b === null) {
		warnings.push({
			code: "invalid-wire",
			message: `Element ${elementIndex + 1}: wire missing or malformed endpoints`,
		});
		return null;
	}
	return { id: `wire-${wireCount + 1}`, endpoints: [a, b] };
}

function parseSymbolElement(
	attrs: Readonly<Record<string, string>>,
	body: string,
	elementIndex: number,
	usedIds: Map<string, number>,
	warnings: Warning[],
): Component | null {
	const componentMatch = body.match(COMPONENT_REGEX);
	if (!componentMatch || componentMatch[1] === undefined) {
		warnings.push({
			code: "missing-component",
			message: `Element ${elementIndex + 1}: missing <Component> inside Symbol`,
		});
		return null;
	}

	const componentAttrs = parseAttributes(componentMatch[1]);
	const fullType = componentAttrs._Type ?? "";
	const shortType = shortenSchxType(fullType);
	const def = lookupSchxDef(shortType);
	const kind = resolveSchxKind(shortType, componentAttrs, def);
	const runtimeDescriptor = isSchxRuntimeDescriptor(shortType);

	if (def === undefined && fullType.length > 0) {
		warnings.push({
			code: "unknown-component-type",
			message: `Element ${elementIndex + 1}: unrecognized component type "${shortType}"`,
		});
	}

	const baseName = componentAttrs.Name ?? componentAttrs.Text ?? shortType;
	const id = uniqueId(baseName, usedIds);
	const origin = parsePoint(attrs.Position) ?? { x: 0, y: 0 };
	const rotation: Rotation = normalizeRotation(
		Number.parseInt(attrs.Rotation ?? "0", 10),
	);
	const flipped = attrs.Flip === "true";

	const propertyEntries = Object.entries(componentAttrs).filter(
		([k]) => k !== "_Type",
	);
	const properties = runtimeDescriptor
		? withRuntimeDescriptorProperties(
				buildProperties(propertyEntries, def),
				shortType,
			)
		: buildProperties(propertyEntries, def);

	const terminals = (def?.terminals ?? []).map((terminal) => ({
		name: terminal.name,
		position: mapTerminal(terminal.local, origin, rotation, flipped),
	}));

	if (runtimeDescriptor) {
		warnings.push({
			code: "runtime-descriptor-imported",
			message: `${baseName} is an imported runtime descriptor from .schx source data, not a source-visible builder primitive.`,
			componentId: id,
		});
	}

	return {
		id,
		kind,
		name: baseName,
		origin,
		rotation,
		flipped,
		terminals,
		properties,
		sourceTypeName: sourceTypeNameForComponent(
			shortType,
			fullType,
			runtimeDescriptor,
		),
	};
}

function resolveSchxKind(
	shortType: string,
	componentAttrs: Readonly<Record<string, string>>,
	def: SchxComponentDef | undefined,
): ComponentKind {
	if (shortType === "Diode" && componentAttrs.Type?.toLowerCase() === "led") {
		return "led";
	}
	return def?.kind ?? "unsupported";
}

function buildProperties(
	entries: ReadonlyArray<[string, string]>,
	def: SchxComponentDef | undefined,
): Readonly<Record<string, PropertyValue>> {
	const quantityKeys = new Set<string>(def?.quantityProps ?? []);
	const properties: Record<string, PropertyValue> = {};
	for (const [key, value] of entries) {
		if (quantityKeys.has(key)) {
			const parsed: ParsedQuantity | null = parseQuantity(value);
			if (parsed) {
				properties[key] = parsed;
				continue;
			}
		}
		properties[key] = value;
	}
	return properties;
}

function withRuntimeDescriptorProperties(
	properties: Readonly<Record<string, PropertyValue>>,
	shortType: string,
): Readonly<Record<string, PropertyValue>> {
	return {
		...properties,
		RuntimeDescriptor: "true",
		...runtimeDescriptorProperties(shortType, properties),
	};
}

function sourceTypeNameForComponent(
	shortType: string,
	fullType: string,
	runtimeDescriptor: boolean,
): string | null {
	if (runtimeDescriptor) {
		return `Circuit.${shortType}`;
	}
	return fullType.length > 0 ? fullType : null;
}

function parseAttributes(input: string): Readonly<Record<string, string>> {
	const out: Record<string, string> = {};
	for (const match of input.matchAll(ATTR_REGEX)) {
		const name = match[1];
		const value = match[2];
		if (name === undefined || value === undefined) {
			continue;
		}
		out[name] = decodeXmlEntities(value);
	}
	return out;
}

function parsePoint(value: string | undefined): Point | null {
	if (value === undefined || value.length === 0) {
		return null;
	}
	const parts = value.split(",");
	if (parts.length !== 2) {
		return null;
	}
	const x = Number.parseInt(parts[0]?.trim() ?? "", 10);
	const y = Number.parseInt(parts[1]?.trim() ?? "", 10);
	if (!Number.isFinite(x) || !Number.isFinite(y)) {
		return null;
	}
	return { x, y };
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

function decodeXmlEntities(value: string): string {
	return value
		.replaceAll("&quot;", '"')
		.replaceAll("&apos;", "'")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&amp;", "&");
}
