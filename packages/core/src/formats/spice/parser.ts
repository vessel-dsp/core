import {
	kindForSpiceLetter,
	getSpiceNodeOrder,
	type SpiceLetter,
} from "../../model/netlist";
import { parseQuantity } from "../../model/quantity";
import type {
	CircuitDocument,
	Component,
	ComponentKind,
	DocumentMetadata,
	Point,
	PropertyValue,
	Terminal,
	Warning,
	Wire,
} from "../../model/types";

const GRID_SPACING = 120;
const GRID_COLS = 6;

type SpiceElement = Readonly<{
	id: string;
	letter: SpiceLetter;
	nodes: readonly string[];
	value: string | null;
	model: string | null;
	extras: readonly string[];
}>;

export function parseSpiceNetlist(source: string): CircuitDocument {
	const warnings: Warning[] = [];
	const lines = preprocessLines(source);
	const elements: SpiceElement[] = [];
	const directives: string[] = [];
	let title = "";

	let i = 0;
	while (i < lines.length) {
		const line = (lines[i] ?? "").trim();
		if (line.length === 0) {
			i += 1;
			continue;
		}
		if (line.startsWith(".")) {
			const head = line.split(/\s+/, 1)[0] ?? "";
			const upper = head.toUpperCase();
			if (upper === ".TITLE") {
				title = line.slice(head.length).trim();
				i += 1;
				continue;
			}
			if (upper === ".END") {
				break;
			}
			if (upper === ".SUBCKT") {
				const block: string[] = [line];
				i += 1;
				while (i < lines.length) {
					const next = lines[i] ?? "";
					block.push(next);
					if (next.trim().toUpperCase().startsWith(".ENDS")) {
						i += 1;
						break;
					}
					i += 1;
				}
				directives.push(block.join("\n"));
				continue;
			}
			directives.push(line);
			i += 1;
			continue;
		}

		const element = parseElement(line, warnings);
		if (element !== null) {
			elements.push(element);
		}
		i += 1;
	}

	const { components, wires } = layoutElements(elements, warnings);
	const metadata: DocumentMetadata = {
		name: title,
		description: "",
		partNumber: "",
	};

	return {
		metadata,
		components,
		wires,
		directives,
		warnings,
		rawAttributes: {},
	};
}

function preprocessLines(source: string): readonly string[] {
	const raw = source.replace(/\r\n/g, "\n").split("\n");
	const out: string[] = [];
	for (const original of raw) {
		const trimmed = stripComment(original);
		if (trimmed.startsWith("+") && out.length > 0) {
			out[out.length - 1] =
				`${out[out.length - 1] ?? ""} ${trimmed.slice(1).trim()}`;
			continue;
		}
		out.push(trimmed);
	}
	return out;
}

function stripComment(line: string): string {
	const trimmed = line.replace(/\t/g, " ").trimEnd();
	if (trimmed.trimStart().startsWith("*")) {
		return "";
	}
	const semiIdx = trimmed.indexOf(";");
	return semiIdx >= 0 ? trimmed.slice(0, semiIdx).trimEnd() : trimmed;
}

function parseElement(line: string, warnings: Warning[]): SpiceElement | null {
	const tokens = line.split(/\s+/).filter((t) => t.length > 0);
	if (tokens.length < 3) {
		return null;
	}
	const id = tokens[0]!;
	const first = id.charAt(0).toUpperCase();
	const letter = first as SpiceLetter;

	switch (first) {
		case "R":
		case "C":
		case "L":
		case "V":
		case "I": {
			const nodes = [tokens[1]!, tokens[2]!];
			const value = tokens.slice(3).join(" ");
			return {
				id,
				letter,
				nodes,
				value: value.length > 0 ? value : null,
				model: null,
				extras: [],
			};
		}
		case "D": {
			if (tokens.length < 4) {
				warnings.push({
					code: "invalid-element",
					message: `${id}: diode requires <anode> <cathode> <model>`,
				});
				return null;
			}
			return {
				id,
				letter,
				nodes: [tokens[1]!, tokens[2]!],
				value: null,
				model: tokens[3]!,
				extras: tokens.slice(4),
			};
		}
		case "Q": {
			if (tokens.length < 5) {
				warnings.push({
					code: "invalid-element",
					message: `${id}: BJT requires <c> <b> <e> <model>`,
				});
				return null;
			}
			const hasSubstrate =
				tokens.length >= 6 && !looksLikeModelParam(tokens[5]!);
			const nodes = tokens.slice(1, hasSubstrate ? 5 : 4);
			const modelIndex = hasSubstrate ? 5 : 4;
			const model = tokens[modelIndex];
			if (model === undefined) {
				warnings.push({
					code: "invalid-element",
					message: `${id}: BJT missing model`,
				});
				return null;
			}
			return {
				id,
				letter,
				nodes,
				value: null,
				model,
				extras: tokens.slice(modelIndex + 1),
			};
		}
		case "J": {
			if (tokens.length < 5) {
				warnings.push({
					code: "invalid-element",
					message: `${id}: JFET requires <d> <g> <s> <model>`,
				});
				return null;
			}
			return {
				id,
				letter,
				nodes: [tokens[1]!, tokens[2]!, tokens[3]!],
				value: null,
				model: tokens[4]!,
				extras: tokens.slice(5),
			};
		}
		case "M": {
			if (tokens.length < 6) {
				warnings.push({
					code: "invalid-element",
					message: `${id}: MOSFET requires <d> <g> <s> <b> <model>`,
				});
				return null;
			}
			return {
				id,
				letter,
				nodes: [tokens[1]!, tokens[2]!, tokens[3]!, tokens[4]!],
				value: null,
				model: tokens[5]!,
				extras: tokens.slice(6),
			};
		}
		case "X": {
			warnings.push({
				code: "subcircuit-instance",
				message: `${id}: subcircuit instances not yet supported`,
			});
			return null;
		}
		default:
			warnings.push({
				code: "unknown-element",
				message: `${id}: unknown element type "${first}"`,
			});
			return null;
	}
}

function looksLikeModelParam(token: string): boolean {
	return token.includes("=");
}

function layoutElements(
	elements: readonly SpiceElement[],
	warnings: Warning[],
): { components: Component[]; wires: Wire[] } {
	const components: Component[] = [];
	const nodeTerminals = new Map<string, Point[]>();

	elements.forEach((element, index) => {
		const kind = kindForSpiceLetter(element.letter);
		const origin: Point = {
			x: (index % GRID_COLS) * GRID_SPACING,
			y: Math.floor(index / GRID_COLS) * GRID_SPACING,
		};
		const terminalNames =
			getSpiceNodeOrder(kind) ??
			defaultTerminalNames(kind, element.nodes.length);
		const terminals = computeTerminals(terminalNames, origin);

		if (terminals.length !== element.nodes.length) {
			warnings.push({
				code: "arity-mismatch",
				message: `${element.id} (${kind}): expected ${terminals.length} nodes, got ${element.nodes.length}`,
				componentId: element.id,
			});
		}

		for (
			let i = 0;
			i < Math.min(terminals.length, element.nodes.length);
			i += 1
		) {
			const nodeName = element.nodes[i]!;
			const position = terminals[i]!.position;
			const list = nodeTerminals.get(nodeName) ?? [];
			list.push(position);
			nodeTerminals.set(nodeName, list);
		}

		components.push({
			id: element.id,
			kind,
			name: element.id,
			origin,
			rotation: 0,
			flipped: false,
			terminals,
			properties: buildProperties(element),
			sourceTypeName: null,
		});
	});

	const groundPosition = ensureGroundComponent(components, nodeTerminals);
	const wires = synthesizeWires(nodeTerminals, groundPosition);
	return { components, wires };
}

function ensureGroundComponent(
	components: Component[],
	nodeTerminals: Map<string, Point[]>,
): Point | null {
	const groundPins = nodeTerminals.get("0");
	if (groundPins === undefined || groundPins.length === 0) {
		return null;
	}
	const ground: Point = centroid(groundPins);
	const groundY = ground.y + 80;
	const groundOrigin: Point = { x: ground.x, y: groundY };
	components.push({
		id: "GND",
		kind: "ground",
		name: "GND",
		origin: groundOrigin,
		rotation: 0,
		flipped: false,
		terminals: [{ name: "t", position: groundOrigin }],
		properties: {},
		sourceTypeName: null,
	});
	groundPins.push(groundOrigin);
	return groundOrigin;
}

function synthesizeWires(
	nodeTerminals: ReadonlyMap<string, readonly Point[]>,
	groundHint: Point | null,
): Wire[] {
	const wires: Wire[] = [];
	let counter = 0;
	for (const [nodeName, positions] of nodeTerminals) {
		if (positions.length < 2) {
			continue;
		}
		const hub =
			nodeName === "0" && groundHint !== null
				? groundHint
				: centroid(positions);
		for (const position of positions) {
			if (position.x === hub.x && position.y === hub.y) {
				continue;
			}
			counter += 1;
			wires.push({ id: `w${counter}`, endpoints: [position, hub] });
		}
	}
	return wires;
}

function centroid(points: readonly Point[]): Point {
	if (points.length === 0) {
		return { x: 0, y: 0 };
	}
	let sx = 0;
	let sy = 0;
	for (const p of points) {
		sx += p.x;
		sy += p.y;
	}
	return { x: sx / points.length, y: sy / points.length };
}

function defaultTerminalNames(
	_kind: ComponentKind,
	count: number,
): readonly string[] {
	return Array.from({ length: count }, (_, i) => `t${i + 1}`);
}

function computeTerminals(names: readonly string[], origin: Point): Terminal[] {
	const half = 20;
	if (names.length === 2) {
		return [
			{ name: names[0]!, position: { x: origin.x, y: origin.y - half } },
			{ name: names[1]!, position: { x: origin.x, y: origin.y + half } },
		];
	}
	if (names.length === 3) {
		return [
			{ name: names[0]!, position: { x: origin.x, y: origin.y - half } },
			{ name: names[1]!, position: { x: origin.x - half, y: origin.y } },
			{ name: names[2]!, position: { x: origin.x, y: origin.y + half } },
		];
	}
	if (names.length === 4) {
		return [
			{ name: names[0]!, position: { x: origin.x, y: origin.y - half } },
			{ name: names[1]!, position: { x: origin.x - half, y: origin.y } },
			{ name: names[2]!, position: { x: origin.x, y: origin.y + half } },
			{ name: names[3]!, position: { x: origin.x + half, y: origin.y } },
		];
	}
	return names.map((name, idx) => ({
		name,
		position: {
			x: origin.x + Math.cos((idx * 2 * Math.PI) / names.length) * half,
			y: origin.y + Math.sin((idx * 2 * Math.PI) / names.length) * half,
		},
	}));
}

function buildProperties(
	element: SpiceElement,
): Readonly<Record<string, PropertyValue>> {
	const properties: Record<string, PropertyValue> = {};
	if (element.value !== null) {
		const valueProp = valuePropertyName(element.letter);
		if (valueProp !== null) {
			const parsed = parseQuantity(element.value);
			properties[valueProp] = parsed ?? element.value;
		}
	}
	if (element.model !== null) {
		properties.model = element.model;
	}
	if (element.extras.length > 0) {
		properties.spiceExtras = element.extras.join(" ");
	}
	return properties;
}

function valuePropertyName(letter: SpiceLetter): string | null {
	switch (letter) {
		case "R":
			return "R";
		case "C":
			return "C";
		case "L":
			return "L";
		case "V":
			return "V";
		case "I":
			return "I";
		default:
			return null;
	}
}
