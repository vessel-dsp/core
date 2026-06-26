import {
	getPinNode,
	resolveConnectivity,
	type Connectivity,
	type NodeId,
} from "./connectivity";
import { parseQuantity } from "./quantity";
import { propertyQuantityValue, propertyStringValue } from "./properties";
import type {
	CircuitDocument,
	Component,
	ComponentKind,
	ParsedQuantity,
} from "./types";

export type SpiceLetter = "R" | "C" | "L" | "D" | "Q" | "J" | "M" | "V" | "I";

export type NetlistComponent = Readonly<{
	id: string;
	kind: ComponentKind;
	spiceLetter: SpiceLetter | null;
	value: ParsedQuantity | null;
	nodes: readonly NodeId[];
	model: string | null;
	extras: Readonly<Record<string, string>>;
}>;

export type NetlistView = Readonly<{
	components: readonly NetlistComponent[];
	nodeCount: number;
	groundNodeId: NodeId | null;
	directives: readonly string[];
	warnings: readonly string[];
}>;

const SPICE_LETTER: Partial<Record<ComponentKind, SpiceLetter>> = {
	resistor: "R",
	"variable-resistor": "R",
	capacitor: "C",
	inductor: "L",
	diode: "D",
	led: "D",
	bjt: "Q",
	jfet: "J",
	mosfet: "M",
	"voltage-source": "V",
	"current-source": "I",
	battery: "V",
	rail: "V",
};

const NODE_ORDER: Partial<Record<ComponentKind, readonly string[]>> = {
	resistor: ["a", "b"],
	"variable-resistor": ["a", "b"],
	capacitor: ["a", "b"],
	inductor: ["a", "b"],
	diode: ["anode", "cathode"],
	led: ["anode", "cathode"],
	"tube-diode": ["anode", "cathode"],
	bjt: ["collector", "base", "emitter"],
	jfet: ["drain", "gate", "source"],
	mosfet: ["drain", "gate", "source", "body"],
	"voltage-source": ["+", "-"],
	"current-source": ["+", "-"],
	battery: ["+", "-"],
	// Rails have a single terminal "t" that's hot; the other side is implicit ground.
	// toNetlistView appends groundNodeId after node resolution to produce a SPICE-shaped 2-node row.
	rail: ["t"],
	opamp: ["vin+", "vin-", "vout", "vcc", "vee"],
	triode: ["plate", "grid", "cathode"],
	pentode: ["plate", "screen", "grid", "cathode", "suppressor"],
};

const VALUE_PROPERTY: Partial<Record<ComponentKind, string>> = {
	resistor: "R",
	"variable-resistor": "R",
	capacitor: "C",
	inductor: "L",
	"voltage-source": "V",
	"current-source": "I",
	battery: "V",
	rail: "V",
};

// Source-format aliases for the value property (e.g. LiveSPICE stores R as "Resistance").
// Keep in sync with the alias lists in src/model/validation.ts until both fold into the catalog.
const VALUE_PROPERTY_ALIASES: Partial<
	Record<ComponentKind, readonly string[]>
> = {
	resistor: ["Resistance", "resistance"],
	"variable-resistor": ["Resistance", "resistance"],
	capacitor: ["Capacitance", "capacitance"],
	inductor: ["Inductance", "inductance"],
	"voltage-source": ["Voltage", "voltage"],
	"current-source": ["Current", "current"],
	battery: ["Voltage", "voltage"],
	rail: ["Voltage", "voltage"],
};

const REQUIRES_VALUE: ReadonlySet<ComponentKind> = new Set<ComponentKind>([
	"resistor",
	"capacitor",
	"inductor",
	"voltage-source",
	"current-source",
	"battery",
	"rail",
]);

const HAS_MODEL: ReadonlySet<ComponentKind> = new Set<ComponentKind>([
	"diode",
	"led",
	"bjt",
	"jfet",
	"mosfet",
	"opamp",
	"triode",
	"pentode",
	"tube-diode",
]);

const SKIP_KINDS: ReadonlySet<ComponentKind> = new Set<ComponentKind>([
	"ground",
	"label",
	"named-wire",
	"port",
	"jack",
]);

const MODEL_PROPERTY_NAMES: readonly string[] = [
	"model",
	"Model",
	"modelName",
	"ModelName",
	"partNumber",
	"PartNumber",
	"Type",
];

export function getSpiceLetter(kind: ComponentKind): SpiceLetter | null {
	return SPICE_LETTER[kind] ?? null;
}

export function getSpiceNodeOrder(
	kind: ComponentKind,
): readonly string[] | null {
	return NODE_ORDER[kind] ?? null;
}

export function kindForSpiceLetter(letter: SpiceLetter): ComponentKind {
	switch (letter) {
		case "R":
			return "resistor";
		case "C":
			return "capacitor";
		case "L":
			return "inductor";
		case "D":
			return "diode";
		case "Q":
			return "bjt";
		case "J":
			return "jfet";
		case "M":
			return "mosfet";
		case "V":
			return "voltage-source";
		case "I":
			return "current-source";
	}
}

export function toNetlistView(
	doc: CircuitDocument,
	precomputed?: Connectivity,
): NetlistView {
	const connectivity = precomputed ?? resolveConnectivity(doc);
	const components: NetlistComponent[] = [];
	const warnings: string[] = [];

	for (const component of doc.components) {
		if (SKIP_KINDS.has(component.kind)) {
			continue;
		}

		if (component.kind === "unsupported") {
			warnings.push(
				`${component.id}: unsupported source type ${component.sourceTypeName ?? "unknown"} — skipped from netlist`,
			);
			continue;
		}

		// Components that need a SPICE subcircuit (opamps, pots, tubes, etc.) are signaled
		// structurally via `spiceLetter: null` — no per-component warning needed.

		const spiceLetter = SPICE_LETTER[component.kind] ?? null;
		const expectedOrder =
			spiceLetter === null && component.terminals.length === 0
				? null
				: (NODE_ORDER[component.kind] ?? null);
		const ordered = orderedNodes(component, connectivity, expectedOrder);
		warnings.push(...ordered.warnings);

		let nodes = ordered.nodes;
		if (component.kind === "rail") {
			// Append implicit ground as the negative terminal so the SPICE row is well-shaped.
			if (connectivity.groundNodeId === null) {
				warnings.push(
					`${component.id} (rail): no ground node in document — cannot anchor implicit return`,
				);
			} else {
				nodes = [...nodes, connectivity.groundNodeId];
			}
		}

		const valueResult = extractValue(component);
		const value = valueResult.value;
		if (
			value === null &&
			REQUIRES_VALUE.has(component.kind) &&
			!valueResult.present
		) {
			warnings.push(
				`${component.id} (${component.kind}): missing required value property`,
			);
		}

		const model = extractModel(component);
		const consumed = consumedPropertyKeys(component.kind);
		const extras = extractExtras(component, consumed);

		components.push({
			id: component.id,
			kind: component.kind,
			spiceLetter,
			value,
			nodes,
			model,
			extras,
		});
	}

	return {
		components,
		nodeCount: connectivity.nodeCount,
		groundNodeId: connectivity.groundNodeId,
		directives: doc.directives,
		warnings,
	};
}

function orderedNodes(
	component: Component,
	connectivity: Connectivity,
	expected: readonly string[] | null,
): { nodes: readonly NodeId[]; warnings: readonly string[] } {
	const warnings: string[] = [];

	if (expected === null) {
		const nodes = collectDeclarationOrder(component, connectivity, warnings);
		return { nodes, warnings };
	}

	const byName = new Map(component.terminals.map((t) => [t.name, t]));
	const missing: string[] = [];
	const ordered: NodeId[] = [];

	for (const name of expected) {
		const terminal = byName.get(name);
		if (terminal === undefined) {
			missing.push(name);
			continue;
		}
		const node = getPinNode(connectivity, {
			componentId: component.id,
			terminalName: name,
		});
		if (node === undefined) {
			warnings.push(`${component.id}: terminal "${name}" has no resolved node`);
		} else {
			ordered.push(node);
		}
	}

	if (missing.length > 0) {
		warnings.push(
			`${component.id} (${component.kind}): expected terminals [${expected.join(", ")}], missing [${missing.join(", ")}] — falling back to declaration order`,
		);
		const fallback = collectDeclarationOrder(component, connectivity, warnings);
		return { nodes: fallback, warnings };
	}

	return { nodes: ordered, warnings };
}

function collectDeclarationOrder(
	component: Component,
	connectivity: Connectivity,
	warnings: string[],
): readonly NodeId[] {
	const nodes: NodeId[] = [];
	for (const terminal of component.terminals) {
		const node = getPinNode(connectivity, {
			componentId: component.id,
			terminalName: terminal.name,
		});
		if (node === undefined) {
			warnings.push(
				`${component.id}: terminal "${terminal.name}" has no resolved node`,
			);
		} else {
			nodes.push(node);
		}
	}
	return nodes;
}

function extractValue(component: Component): {
	value: ParsedQuantity | null;
	present: boolean;
} {
	const baseName = VALUE_PROPERTY[component.kind];
	if (baseName === undefined) {
		return { value: null, present: false };
	}

	const aliases = VALUE_PROPERTY_ALIASES[component.kind] ?? [];
	const variants = uniqueVariants([
		baseName,
		baseName.toLowerCase(),
		baseName.toUpperCase(),
		capitalize(baseName),
		...aliases,
		"value",
		"Value",
	]);

	for (const name of variants) {
		const raw = component.properties[name];
		if (raw === undefined) {
			continue;
		}
		if (typeof raw === "string") {
			return { value: parseQuantity(raw), present: raw.trim().length > 0 };
		}
		return { value: propertyQuantityValue(raw), present: true };
	}
	return { value: null, present: false };
}

function extractModel(component: Component): string | null {
	if (!HAS_MODEL.has(component.kind)) {
		return null;
	}
	for (const name of MODEL_PROPERTY_NAMES) {
		const raw = component.properties[name];
		if (typeof raw === "string" && raw.length > 0) {
			return raw;
		}
	}
	return null;
}

function consumedPropertyKeys(kind: ComponentKind): ReadonlySet<string> {
	const consumed = new Set<string>();
	const baseName = VALUE_PROPERTY[kind];
	if (baseName !== undefined) {
		consumed.add(baseName);
		consumed.add(baseName.toLowerCase());
		consumed.add(baseName.toUpperCase());
		consumed.add(capitalize(baseName));
		for (const alias of VALUE_PROPERTY_ALIASES[kind] ?? []) {
			consumed.add(alias);
		}
		consumed.add("value");
		consumed.add("Value");
	}
	if (HAS_MODEL.has(kind)) {
		for (const name of MODEL_PROPERTY_NAMES) {
			consumed.add(name);
		}
	}
	return consumed;
}

function extractExtras(
	component: Component,
	consumed: ReadonlySet<string>,
): Readonly<Record<string, string>> {
	const extras: Record<string, string> = {};
	for (const [key, value] of Object.entries(component.properties)) {
		if (consumed.has(key)) {
			continue;
		}
		const text = propertyStringValue(value);
		if (text !== null) {
			extras[key] = text;
		}
	}
	return extras;
}

function uniqueVariants(input: readonly string[]): readonly string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const name of input) {
		if (seen.has(name)) {
			continue;
		}
		seen.add(name);
		out.push(name);
	}
	return out;
}

function capitalize(s: string): string {
	if (s.length === 0) {
		return s;
	}
	return s.charAt(0).toUpperCase() + s.slice(1);
}
