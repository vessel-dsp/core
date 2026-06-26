import { parseQuantity } from "./quantity";
import type { ParsedQuantity, PropertyObject, PropertyValue } from "./types";

export function isParsedQuantity(value: unknown): value is ParsedQuantity {
	if (!isUnknownRecord(value)) {
		return false;
	}
	return (
		typeof value["raw"] === "string" &&
		typeof value["value"] === "number" &&
		typeof value["unit"] === "string"
	);
}

export function isPropertyObject(
	value: PropertyValue | undefined,
): value is PropertyObject {
	return (
		isUnknownRecord(value) && !Array.isArray(value) && !isParsedQuantity(value)
	);
}

export function propertyStringValue(
	value: PropertyValue | undefined,
): string | null {
	if (value === undefined || value === null) {
		return null;
	}
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (isParsedQuantity(value)) {
		return value.raw;
	}
	return null;
}

export function propertyQuantityValue(
	value: PropertyValue | undefined,
): ParsedQuantity | null {
	if (value === undefined || value === null) {
		return null;
	}
	if (isParsedQuantity(value)) {
		return value;
	}
	if (typeof value === "string") {
		return parseQuantity(value);
	}
	if (typeof value === "number") {
		return {
			raw: String(value),
			value,
			unit: "",
		};
	}
	return null;
}

export function propertyNumericValue(
	value: PropertyValue | undefined,
): number | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : undefined;
	}
	if (isParsedQuantity(value)) {
		return Number.isFinite(value.value) ? value.value : undefined;
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
			return undefined;
		}
		const parsed = Number.parseFloat(trimmed);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

export function propertyBooleanValue(
	value: PropertyValue | undefined,
): boolean | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value === "boolean") {
		return value;
	}
	const text = propertyStringValue(value)?.trim().toLowerCase();
	if (text === "true" || text === "1" || text === "yes") {
		return true;
	}
	if (text === "false" || text === "0" || text === "no") {
		return false;
	}
	return undefined;
}

export function propertyValueForSourceAttribute(
	value: PropertyValue,
): string | null {
	const scalar = propertyStringValue(value);
	if (scalar !== null) {
		return scalar;
	}
	return null;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
