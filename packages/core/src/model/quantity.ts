import type { ParsedQuantity } from "./types";

const SI_PREFIXES: Readonly<Record<string, number>> = {
	f: 1e-15,
	p: 1e-12,
	n: 1e-9,
	u: 1e-6,
	µ: 1e-6, // MICRO SIGN
	μ: 1e-6, // GREEK SMALL LETTER MU — LiveSPICE writes "μF" with this codepoint
	m: 1e-3,
	k: 1e3,
	K: 1e3,
	M: 1e6,
	G: 1e9,
	T: 1e12,
};

const SHORTHAND_MARKERS: Readonly<
	Record<string, { readonly multiplier: number; readonly impliedUnit?: string }>
> = {
	f: { multiplier: 1e-15 },
	p: { multiplier: 1e-12 },
	n: { multiplier: 1e-9 },
	u: { multiplier: 1e-6 },
	µ: { multiplier: 1e-6 },
	μ: { multiplier: 1e-6 },
	m: { multiplier: 1e-3 },
	k: { multiplier: 1e3 },
	K: { multiplier: 1e3 },
	M: { multiplier: 1e6 },
	G: { multiplier: 1e9 },
	T: { multiplier: 1e12 },
	R: { multiplier: 1, impliedUnit: "Ω" },
	r: { multiplier: 1, impliedUnit: "Ω" },
};

const UNIT_ALIASES: Readonly<Record<string, string>> = {
	F: "F",
	f: "F",
	H: "H",
	h: "H",
	V: "V",
	v: "V",
	A: "A",
	a: "A",
	W: "W",
	w: "W",
	Ω: "Ω", // GREEK CAPITAL LETTER OMEGA — canonical form
	Ω: "Ω", // OHM SIGN — LiveSPICE writes "Ω" with this codepoint; canonicalize
	ohm: "Ω",
	Ohm: "Ω",
	OHM: "Ω",
	ohms: "Ω",
	Hz: "Hz",
	HZ: "Hz",
	hz: "Hz",
	s: "s",
	S: "s",
};

const QUANTITY_REGEX =
	/^([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)([A-Za-zµμΩΩ]*)$/;
const SHORTHAND_QUANTITY_REGEX =
	/^([+-]?\d+)([fFpPnNuUµμmMkKGTRr])(\d+)([A-Za-zµμΩΩ]*)$/;
const SPICE_MEG = /^(?:Meg|MEG|meg)/;

export function parseQuantity(input: string): ParsedQuantity | null {
	const raw = input.trim();
	if (raw.length === 0) {
		return null;
	}

	const compact = raw.replace(/\s+/g, "");
	const shorthand = parseShorthandQuantity(raw, compact);
	if (shorthand !== null) {
		return shorthand;
	}

	const match = compact.match(QUANTITY_REGEX);
	if (!match) {
		return null;
	}

	const numStr = match[1];
	const suffix = match[2] ?? "";
	if (numStr === undefined) {
		return null;
	}

	const baseValue = Number.parseFloat(numStr);
	if (!Number.isFinite(baseValue)) {
		return null;
	}

	const parsed = parseSuffix(suffix);

	return {
		raw,
		value: baseValue * parsed.multiplier,
		unit: parsed.unit,
	};
}

function parseShorthandQuantity(
	raw: string,
	compact: string,
): ParsedQuantity | null {
	const match = compact.match(SHORTHAND_QUANTITY_REGEX);
	if (match === null) {
		return null;
	}

	const whole = match[1];
	const marker = match[2];
	const fractional = match[3];
	const trailingUnit = match[4] ?? "";
	if (whole === undefined || marker === undefined || fractional === undefined) {
		return null;
	}

	const markerDef = SHORTHAND_MARKERS[marker];
	if (markerDef === undefined) {
		return null;
	}

	const value = Number.parseFloat(`${whole}.${fractional}`);
	if (!Number.isFinite(value)) {
		return null;
	}

	const aliasedTrailingUnit = UNIT_ALIASES[trailingUnit];
	const unit =
		trailingUnit.length > 0
			? (aliasedTrailingUnit ?? trailingUnit)
			: (markerDef.impliedUnit ?? "");

	return {
		raw,
		value: value * markerDef.multiplier,
		unit,
	};
}

function parseSuffix(suffix: string): { multiplier: number; unit: string } {
	if (suffix.length === 0) {
		return { multiplier: 1, unit: "" };
	}

	// SPICE convention: "Meg" / "MEG" / "meg" = 1e6, distinct from milli "m".
	// Match before the single-char prefix loop so "meg" doesn't get read as milli + "eg".
	const megMatch = SPICE_MEG.exec(suffix);
	if (megMatch) {
		const rest = suffix.slice(megMatch[0].length);
		if (rest.length === 0) {
			return { multiplier: 1e6, unit: "" };
		}
		const restUnit = UNIT_ALIASES[rest];
		return { multiplier: 1e6, unit: restUnit ?? rest };
	}

	const first = suffix.charAt(0);
	const rest = suffix.slice(1);
	const prefixMultiplier = SI_PREFIXES[first];

	if (prefixMultiplier !== undefined) {
		if (rest.length === 0) {
			return { multiplier: prefixMultiplier, unit: "" };
		}
		const restUnit = UNIT_ALIASES[rest];
		if (restUnit !== undefined) {
			return { multiplier: prefixMultiplier, unit: restUnit };
		}
	}

	const fullUnit = UNIT_ALIASES[suffix];
	if (fullUnit !== undefined) {
		return { multiplier: 1, unit: fullUnit };
	}

	return { multiplier: 1, unit: suffix };
}
