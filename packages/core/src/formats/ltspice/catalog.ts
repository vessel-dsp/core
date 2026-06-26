import type { ComponentKind, Point } from "../../model/types";

// LTspice's native grid uses pin spacings of ~32–64 units per component
// (resistor pins 64 apart, BJT pins 64 apart). The schematic renderer assumes
// components fit within a ±20 box centered on origin, so we scale every LTspice
// coordinate uniformly at parse time so terminal positions land near the box
// edges instead of floating outside. 0.5 puts a resistor's pin-to-pin span at
// 32 — comfortably inside the 40-unit box. Applied symmetrically to terminal
// local offsets here and to all parsed Points in the parser; connectivity is
// preserved because both sides are scaled identically.
export const LTSPICE_COORD_SCALE = 0.5;

export type LtspiceTerminalDef = Readonly<{ name: string; local: Point }>;

export type LtspiceSymbolDef = Readonly<{
	symbolName: string;
	kind: ComponentKind;
	terminals: readonly LtspiceTerminalDef[];
	valueProperty: string | null;
	modelFromValue: boolean;
	// When true, derive `properties.model` from the basename of the symbol path
	// (e.g. SYMBOL Opamps\LM308 → model = "LM308") instead of from SYMATTR Value.
	// LTspice manufacturer-specific opamp symbols encode the model in the path,
	// not in a Value attribute, so this is how we capture the part number.
	modelFromSymbolPath?: boolean;
}>;

// Per-symbol pin layouts derived empirically from the cushychicken corpus
// (and confirmed against LTspice's bundled .asy files).
// Each layout matches the actual PIN positions in res.asy / cap.asy / etc.,
// so wires drawn by LTspice land exactly on our computed terminal positions.
const RES_PINS: readonly LtspiceTerminalDef[] = [
	{ name: "a", local: { x: 16, y: 16 } },
	{ name: "b", local: { x: 16, y: 96 } },
];

const CAP_PINS: readonly LtspiceTerminalDef[] = [
	{ name: "a", local: { x: 16, y: 0 } },
	{ name: "b", local: { x: 16, y: 64 } },
];

const IND_PINS: readonly LtspiceTerminalDef[] = [
	{ name: "a", local: { x: 16, y: 0 } },
	{ name: "b", local: { x: 16, y: 80 } },
];

const DIODE_PINS: readonly LtspiceTerminalDef[] = [
	{ name: "anode", local: { x: 16, y: 0 } },
	{ name: "cathode", local: { x: 16, y: 64 } },
];

const VOLTAGE_SOURCE_PINS: readonly LtspiceTerminalDef[] = [
	{ name: "+", local: { x: 0, y: 16 } },
	{ name: "-", local: { x: 0, y: 96 } },
];

const BJT_PINS: readonly LtspiceTerminalDef[] = [
	{ name: "collector", local: { x: 64, y: 0 } },
	{ name: "base", local: { x: 0, y: 48 } },
	{ name: "emitter", local: { x: 64, y: 96 } },
];

const JFET_PINS: readonly LtspiceTerminalDef[] = [
	{ name: "drain", local: { x: 64, y: 0 } },
	{ name: "gate", local: { x: 0, y: 32 } },
	{ name: "source", local: { x: 64, y: 64 } },
];

const MOSFET_PINS: readonly LtspiceTerminalDef[] = [
	{ name: "drain", local: { x: 64, y: 0 } },
	{ name: "gate", local: { x: 0, y: 32 } },
	{ name: "source", local: { x: 64, y: 64 } },
	{ name: "body", local: { x: 32, y: 32 } },
];

const DEFS: readonly LtspiceSymbolDef[] = [
	{
		symbolName: "res",
		kind: "resistor",
		terminals: RES_PINS,
		valueProperty: "R",
		modelFromValue: false,
	},
	{
		symbolName: "res2",
		kind: "resistor",
		terminals: RES_PINS,
		valueProperty: "R",
		modelFromValue: false,
	},
	{
		symbolName: "cap",
		kind: "capacitor",
		terminals: CAP_PINS,
		valueProperty: "C",
		modelFromValue: false,
	},
	{
		symbolName: "cap2",
		kind: "capacitor",
		terminals: CAP_PINS,
		valueProperty: "C",
		modelFromValue: false,
	},
	{
		symbolName: "ind",
		kind: "inductor",
		terminals: IND_PINS,
		valueProperty: "L",
		modelFromValue: false,
	},
	{
		symbolName: "diode",
		kind: "diode",
		terminals: DIODE_PINS,
		valueProperty: null,
		modelFromValue: true,
	},
	{
		symbolName: "led",
		kind: "led",
		terminals: DIODE_PINS,
		valueProperty: null,
		modelFromValue: true,
	},
	{
		symbolName: "zener",
		kind: "diode",
		terminals: DIODE_PINS,
		valueProperty: null,
		modelFromValue: true,
	},
	{
		symbolName: "schottky",
		kind: "diode",
		terminals: DIODE_PINS,
		valueProperty: null,
		modelFromValue: true,
	},
	{
		symbolName: "voltage",
		kind: "voltage-source",
		terminals: VOLTAGE_SOURCE_PINS,
		valueProperty: "V",
		modelFromValue: false,
	},
	{
		symbolName: "current",
		kind: "current-source",
		terminals: VOLTAGE_SOURCE_PINS,
		valueProperty: "I",
		modelFromValue: false,
	},
	{
		symbolName: "npn",
		kind: "bjt",
		terminals: BJT_PINS,
		valueProperty: null,
		modelFromValue: true,
	},
	{
		symbolName: "pnp",
		kind: "bjt",
		terminals: BJT_PINS,
		valueProperty: null,
		modelFromValue: true,
	},
	{
		symbolName: "njf",
		kind: "jfet",
		terminals: JFET_PINS,
		valueProperty: null,
		modelFromValue: true,
	},
	{
		symbolName: "pjf",
		kind: "jfet",
		terminals: JFET_PINS,
		valueProperty: null,
		modelFromValue: true,
	},
	{
		symbolName: "nmos",
		kind: "mosfet",
		terminals: MOSFET_PINS,
		valueProperty: null,
		modelFromValue: true,
	},
	{
		symbolName: "pmos",
		kind: "mosfet",
		terminals: MOSFET_PINS,
		valueProperty: null,
		modelFromValue: true,
	},
];

const BY_SYMBOL = new Map<string, LtspiceSymbolDef>(
	DEFS.map((def) => [def.symbolName, def]),
);

// LTspice manufacturer opamps live under `Opamps\<model>` or `OpAmps/<model>` paths
// (mixed case, both separators). Without the corresponding .asy files we don't know
// per-model pin geometry, so the generic fallback uses an empty terminal list and
// records the model name via modelFromSymbolPath. Wire-snapping for opamp pins is
// best-effort until a future change parses .asy pin positions.
const GENERIC_OPAMP_DEF: LtspiceSymbolDef = {
	symbolName: "_generic-opamp",
	kind: "opamp",
	terminals: [],
	valueProperty: null,
	modelFromValue: false,
	modelFromSymbolPath: true,
};

export function normalizeLtspiceSymbolName(symbolName: string): string {
	const pathParts = symbolName.replaceAll("\\", "/").split("/");
	const base = pathParts[pathParts.length - 1] ?? symbolName;
	return base.replace(/\.asy$/i, "").toLowerCase();
}

// Returns the model name from a path-style symbol identifier, preserving the
// original case. e.g. "Opamps\\LM308" -> "LM308", "OpAmps/AD820.asy" -> "AD820".
export function extractModelFromSymbolPath(symbolName: string): string {
	const parts = symbolName.replaceAll("\\", "/").split("/");
	const last = parts[parts.length - 1] ?? symbolName;
	return last.replace(/\.asy$/i, "");
}

function isOpampPath(symbolName: string): boolean {
	const normalized = symbolName.replaceAll("\\", "/").toLowerCase();
	return /(^|\/)opamps\//.test(normalized);
}

export function lookupLtspiceSymbolDef(
	symbolName: string,
): LtspiceSymbolDef | undefined {
	const direct = BY_SYMBOL.get(normalizeLtspiceSymbolName(symbolName));
	if (direct !== undefined) {
		return direct;
	}
	if (isOpampPath(symbolName)) {
		return GENERIC_OPAMP_DEF;
	}
	return undefined;
}

export function mapLtspiceTerminal(
	local: Point,
	placement: Point,
	orientation: string,
): Point {
	// Scale the per-symbol local offset; placement is scaled upstream by the parser.
	const sx = local.x * LTSPICE_COORD_SCALE;
	const sy = local.y * LTSPICE_COORD_SCALE;
	const mirrored = orientation.toUpperCase().startsWith("M");
	const degrees = parseOrientationDegrees(orientation);
	const x = mirrored ? -sx : sx;
	const y = sy;

	// LTspice's R90 rotates the symbol 90° clockwise on screen. Because the
	// screen y axis points down in LTspice, on-screen-CW corresponds to the
	// math transform (x, y) → (-y, x), and R270 (CCW on screen) is (y, -x).
	// The previous case 90 / case 270 had these swapped — every R90 component
	// ended up with its pins on the wrong side, so wires "floated" away from
	// terminals. Verified against the cushychicken corpus.
	switch (degrees) {
		case 0:
			return { x: placement.x + x, y: placement.y + y };
		case 90:
			return { x: placement.x - y, y: placement.y + x };
		case 180:
			return { x: placement.x - x, y: placement.y - y };
		case 270:
			return { x: placement.x + y, y: placement.y - x };
	}
}

function parseOrientationDegrees(orientation: string): 0 | 90 | 180 | 270 {
	const match = orientation.toUpperCase().match(/[MR](0|90|180|270)$/);
	if (match?.[1] === "90") {
		return 90;
	}
	if (match?.[1] === "180") {
		return 180;
	}
	if (match?.[1] === "270") {
		return 270;
	}
	return 0;
}
