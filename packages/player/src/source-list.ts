// Parsing and validation for the inputs, nam and ir attribute lists.
// DOM-free. The element reuses this for attributes (JSON text) and for
// property setters (already-parsed arrays) through validateSourceItems.

import type { SourceItem } from "./types.js";

/**
 * Closed parse reasons. Compared as whole values; never match message text.
 * not-json: the attribute text is not valid JSON.
 * not-array: the parsed JSON is not an array.
 * item-not-object: an array entry is not an object.
 * missing-id-or-label-or-src: an entry has no usable label or src, or an
 *   id that is present but not a non-empty string. An absent id is fine:
 *   it is derived from the entry index as source-<index>.
 * duplicate-id: two entries share an id after derivation.
 * unsafe-src: the src is not an http(s) URL or a same-origin relative URL.
 */
export type ParseSourceListReason =
	| "not-json"
	| "not-array"
	| "item-not-object"
	| "missing-id-or-label-or-src"
	| "duplicate-id"
	| "unsafe-src";

export type ParseSourceListResult =
	| { readonly items: SourceItem[] }
	| { readonly reason: ParseSourceListReason };

/**
 * Derive the id for an entry whose id was omitted in JSON. The rule is
 * source-<index>, where index is the zero-based position in the list. This
 * keeps ids stable for a fixed list and unique unless an explicit id
 * collides with a derived one, which is reported as duplicate-id.
 */
export function deriveSourceId(index: number): string {
	return `source-${index}`;
}

/**
 * Accept only http and https absolute URLs plus same-origin relative URLs.
 * Refuses javascript:, data:, blob:, file: and every other scheme, as well
 * as protocol-relative URLs (//host/...) which are not same-origin
 * relative. Leading and trailing whitespace is trimmed before the check.
 */
export function isSafeSrc(src: string, baseUrl = "https://player.invalid/"): boolean {
	const trimmed = src.trim();
	if (trimmed === "") {
		return false;
	}
	// Browsers strip tabs, newlines and leading control characters before reading
	// the scheme, so "java<TAB>script:x" and "<NUL>javascript:x" are javascript: URLs
	// to a browser. A regex over the raw text cannot see that, so refuse any control
	// character outright, and any backslash, which browsers read as a slash and which
	// turns "\\host/x" into a cross-origin URL.
	if (/[\u0000-\u001f\u007f\\]/.test(trimmed)) {
		return false;
	}
	let resolved: URL;
	try {
		resolved = new URL(trimmed, baseUrl);
	} catch {
		return false;
	}
	if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
		return false;
	}
	// A scheme-less reference is documented as same-origin: refuse "//host/x".
	if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed) && trimmed.startsWith("//")) {
		return false;
	}
	return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}

/**
 * Validate an already-parsed value as a source list. Shared by
 * parseSourceList (JSON text) and by the element property setters.
 */
export function validateSourceItems(value: unknown): ParseSourceListResult {
	if (!Array.isArray(value)) {
		return { reason: "not-array" };
	}
	const items: SourceItem[] = [];
	const seen = new Set<string>();
	for (let index = 0; index < value.length; index += 1) {
		const entry = value[index];
		if (!isRecord(entry)) {
			return { reason: "item-not-object" };
		}
		let id: string;
		if (entry.id === undefined) {
			id = deriveSourceId(index);
		} else if (isNonEmptyString(entry.id)) {
			id = entry.id.trim();
		} else {
			return { reason: "missing-id-or-label-or-src" };
		}
		if (!isNonEmptyString(entry.label) || !isNonEmptyString(entry.src)) {
			return { reason: "missing-id-or-label-or-src" };
		}
		const src = (entry.src as string).trim();
		const label = (entry.label as string).trim();
		if (!isSafeSrc(src)) {
			return { reason: "unsafe-src" };
		}
		if (seen.has(id)) {
			return { reason: "duplicate-id" };
		}
		seen.add(id);
		items.push({ id, label, src });
	}
	return { items };
}

/**
 * Parse an inputs, nam or ir attribute value. Empty or whitespace-only
 * text means an empty list (the picker hides or shows None only). The
 * error side carries only the closed reason; the element turns it into a
 * display message without matching text.
 */
export function parseSourceList(json: string): ParseSourceListResult {
	if (json.trim() === "") {
		return { items: [] };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return { reason: "not-json" };
	}
	return validateSourceItems(parsed);
}
