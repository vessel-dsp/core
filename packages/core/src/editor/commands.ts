import { parseQuantity } from "../model/quantity";
import type {
	CircuitDocument,
	Component,
	ComponentKind,
	Point,
	PropertyValue,
} from "../model/types";
import { isParsedQuantity } from "../model/properties";
import { buildComponent } from "./factory";
import { tidyDocumentLayout } from "./layout";

export type DocumentCommand =
	| Readonly<{ type: "delete-component"; componentId: string }>
	| Readonly<{ type: "rename-component"; componentId: string; newName: string }>
	| Readonly<{
			type: "set-property";
			componentId: string;
			propertyName: string;
			value: string;
	  }>
	| Readonly<{
			type: "remove-property";
			componentId: string;
			propertyName: string;
	  }>
	| Readonly<{ type: "move-component"; componentId: string; origin: Point }>
	| Readonly<{ type: "delete-wire"; wireId: string }>
	| Readonly<{ type: "delete-wires"; wireIds: readonly string[] }>
	| Readonly<{ type: "add-wire"; from: Point; to: Point }>
	| Readonly<{ type: "split-wire"; wireId: string; at: Point }>
	| Readonly<{ type: "merge-wires"; at: Point }>
	| Readonly<{ type: "tidy-layout" }>
	| Readonly<{
			type: "add-component";
			kind: ComponentKind;
			origin: Point;
			sourceTypeName?: string | null;
	  }>;

export function applyDocumentCommand(
	doc: CircuitDocument,
	command: DocumentCommand,
): CircuitDocument {
	switch (command.type) {
		case "delete-component":
			return deleteComponent(doc, command.componentId);
		case "rename-component":
			return renameComponent(doc, command.componentId, command.newName);
		case "set-property":
			return setProperty(
				doc,
				command.componentId,
				command.propertyName,
				command.value,
			);
		case "remove-property":
			return removeProperty(doc, command.componentId, command.propertyName);
		case "move-component":
			return moveComponent(doc, command.componentId, command.origin);
		case "delete-wire":
			return deleteWire(doc, command.wireId);
		case "delete-wires":
			return deleteWires(doc, command.wireIds);
		case "add-wire":
			return addWire(doc, command.from, command.to);
		case "split-wire":
			return splitWire(doc, command.wireId, command.at);
		case "merge-wires":
			return mergeWires(doc, command.at);
		case "tidy-layout":
			return tidyDocumentLayout(doc);
		case "add-component":
			return addComponent(
				doc,
				command.kind,
				command.origin,
				command.sourceTypeName ?? null,
			);
	}
}

function addComponent(
	doc: CircuitDocument,
	kind: ComponentKind,
	origin: Point,
	sourceTypeName: string | null,
): CircuitDocument {
	const existingIds = new Set(doc.components.map((c) => c.id));
	const component = buildComponent({
		kind,
		origin,
		sourceTypeName,
		existingIds,
	});
	return { ...doc, components: [...doc.components, component] };
}

function moveComponent(
	doc: CircuitDocument,
	componentId: string,
	origin: Point,
): CircuitDocument {
	const target = doc.components.find((c) => c.id === componentId);
	if (
		target === undefined ||
		(target.origin.x === origin.x && target.origin.y === origin.y)
	) {
		return doc;
	}
	const dx = origin.x - target.origin.x;
	const dy = origin.y - target.origin.y;
	const terminalMoves = new Map<string, Point>();
	for (const terminal of target.terminals) {
		const newPosition = {
			x: terminal.position.x + dx,
			y: terminal.position.y + dy,
		};
		terminalMoves.set(pointKey(terminal.position), newPosition);
	}

	const components = doc.components.map((c) => {
		if (c.id !== componentId) {
			return c;
		}
		const terminals = c.terminals.map((t) => ({
			name: t.name,
			position: terminalMoves.get(pointKey(t.position)) ?? {
				x: t.position.x + dx,
				y: t.position.y + dy,
			},
		}));
		return { ...c, origin, terminals };
	});

	const wires = doc.wires.map((w) => {
		const newA = terminalMoves.get(pointKey(w.endpoints[0]));
		const newB = terminalMoves.get(pointKey(w.endpoints[1]));
		if (newA === undefined && newB === undefined) {
			return w;
		}
		return {
			...w,
			endpoints: [newA ?? w.endpoints[0], newB ?? w.endpoints[1]] as readonly [
				Point,
				Point,
			],
		};
	});

	return { ...doc, components, wires };
}

function pointKey(p: Point): string {
	return `${p.x},${p.y}`;
}

function deleteComponent(
	doc: CircuitDocument,
	componentId: string,
): CircuitDocument {
	const components = doc.components.filter((c) => c.id !== componentId);
	if (components.length === doc.components.length) {
		return doc;
	}
	return { ...doc, components };
}

function deleteWire(doc: CircuitDocument, wireId: string): CircuitDocument {
	const wires = doc.wires.filter((w) => w.id !== wireId);
	if (wires.length === doc.wires.length) {
		return doc;
	}
	return { ...doc, wires };
}

function deleteWires(
	doc: CircuitDocument,
	wireIds: readonly string[],
): CircuitDocument {
	if (wireIds.length === 0) {
		return doc;
	}
	const targets = new Set(wireIds);
	const wires = doc.wires.filter((w) => !targets.has(w.id));
	if (wires.length === doc.wires.length) {
		return doc;
	}
	return { ...doc, wires };
}

function addWire(
	doc: CircuitDocument,
	from: Point,
	to: Point,
): CircuitDocument {
	if (from.x === to.x && from.y === to.y) {
		return doc;
	}
	const id = uniqueWireId(doc);
	const wire = { id, endpoints: [from, to] as const };
	return { ...doc, wires: [...doc.wires, wire] };
}

function splitWire(
	doc: CircuitDocument,
	wireId: string,
	at: Point,
): CircuitDocument {
	const target = doc.wires.find((w) => w.id === wireId);
	if (target === undefined) {
		return doc;
	}
	const [a, b] = target.endpoints;
	const snapped = projectOntoSegment(at, a, b);
	if (pointEquals(snapped, a) || pointEquals(snapped, b)) {
		return doc;
	}
	const taken = new Set(doc.wires.map((w) => w.id));
	taken.delete(wireId);
	const firstId = uniqueWireIdFromSet(taken);
	taken.add(firstId);
	const secondId = uniqueWireIdFromSet(taken);
	const replacement = [
		{ id: firstId, endpoints: [a, snapped] as const },
		{ id: secondId, endpoints: [snapped, b] as const },
	];
	const wires = doc.wires.flatMap((w) => (w.id === wireId ? replacement : [w]));
	return { ...doc, wires };
}

function mergeWires(doc: CircuitDocument, at: Point): CircuitDocument {
	const meeting: (typeof doc.wires)[number][] = [];
	for (const wire of doc.wires) {
		if (
			pointEquals(wire.endpoints[0], at) ||
			pointEquals(wire.endpoints[1], at)
		) {
			meeting.push(wire);
		}
	}
	if (meeting.length !== 2) {
		return doc;
	}
	for (const component of doc.components) {
		for (const terminal of component.terminals) {
			if (pointEquals(terminal.position, at)) {
				return doc;
			}
		}
	}
	// Reject if another wire's body crosses the corner — that's a T-junction.
	for (const wire of doc.wires) {
		if (wire === meeting[0] || wire === meeting[1]) continue;
		if (pointOnSegmentInterior(at, wire.endpoints[0], wire.endpoints[1])) {
			return doc;
		}
	}
	const [w1, w2] = meeting as [
		(typeof doc.wires)[number],
		(typeof doc.wires)[number],
	];
	const outer1 = pointEquals(w1.endpoints[0], at)
		? w1.endpoints[1]
		: w1.endpoints[0];
	const outer2 = pointEquals(w2.endpoints[0], at)
		? w2.endpoints[1]
		: w2.endpoints[0];
	if (pointEquals(outer1, outer2)) {
		// Degenerate: two wires looping back to the same outer point. Just drop both.
		const wires = doc.wires.filter((w) => w.id !== w1.id && w.id !== w2.id);
		return { ...doc, wires };
	}
	const taken = new Set(doc.wires.map((w) => w.id));
	taken.delete(w1.id);
	taken.delete(w2.id);
	const newId = uniqueWireIdFromSet(taken);
	const replacement = { id: newId, endpoints: [outer1, outer2] as const };
	const seen = new Set([w1.id, w2.id]);
	const wires = doc.wires.filter((w) => !seen.has(w.id)).concat([replacement]);
	return { ...doc, wires };
}

function projectOntoSegment(p: Point, a: Point, b: Point): Point {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	if (dx === 0 && dy === 0) {
		return { x: a.x, y: a.y };
	}
	const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
	const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
	return {
		x: Math.round(a.x + clamped * dx),
		y: Math.round(a.y + clamped * dy),
	};
}

function pointEquals(a: Point, b: Point): boolean {
	return a.x === b.x && a.y === b.y;
}

function pointOnSegmentInterior(p: Point, a: Point, b: Point): boolean {
	const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
	if (cross !== 0) return false;
	const minX = Math.min(a.x, b.x);
	const maxX = Math.max(a.x, b.x);
	const minY = Math.min(a.y, b.y);
	const maxY = Math.max(a.y, b.y);
	if (minX === maxX && minY === maxY) return false;
	const inX = p.x > minX && p.x < maxX;
	const inY = p.y > minY && p.y < maxY;
	if (minX === maxX) return inY;
	if (minY === maxY) return inX;
	return inX && inY;
}

function uniqueWireId(doc: CircuitDocument): string {
	return uniqueWireIdFromSet(new Set(doc.wires.map((w) => w.id)));
}

function uniqueWireIdFromSet(taken: Set<string>): string {
	let n = taken.size + 1;
	while (taken.has(`wire-${n}`)) {
		n += 1;
	}
	return `wire-${n}`;
}

function renameComponent(
	doc: CircuitDocument,
	componentId: string,
	newName: string,
): CircuitDocument {
	const trimmed = newName.trim();
	if (trimmed.length === 0) {
		return doc;
	}
	let changed = false;
	const components = doc.components.map((c) => {
		if (c.id !== componentId || c.name === trimmed) {
			return c;
		}
		changed = true;
		return { ...c, name: trimmed };
	});
	return changed ? { ...doc, components } : doc;
}

function setProperty(
	doc: CircuitDocument,
	componentId: string,
	propertyName: string,
	rawValue: string,
): CircuitDocument {
	const trimmedName = propertyName.trim();
	if (trimmedName.length === 0) {
		return doc;
	}
	let changed = false;
	const components = doc.components.map((c) => {
		if (c.id !== componentId) {
			return c;
		}
		const next: PropertyValue = nextValue(c, trimmedName, rawValue);
		if (propertyEquals(c.properties[trimmedName], next)) {
			return c;
		}
		changed = true;
		return { ...c, properties: { ...c.properties, [trimmedName]: next } };
	});
	return changed ? { ...doc, components } : doc;
}

function removeProperty(
	doc: CircuitDocument,
	componentId: string,
	propertyName: string,
): CircuitDocument {
	let changed = false;
	const components = doc.components.map((c) => {
		if (c.id !== componentId || c.properties[propertyName] === undefined) {
			return c;
		}
		changed = true;
		const { [propertyName]: _omitted, ...rest } = c.properties;
		return { ...c, properties: rest };
	});
	return changed ? { ...doc, components } : doc;
}

function nextValue(
	component: Component,
	propertyName: string,
	rawValue: string,
): PropertyValue {
	const existing = component.properties[propertyName];
	const existingWasQuantity = isParsedQuantity(existing);
	if (existingWasQuantity) {
		const parsed = parseQuantity(rawValue);
		if (parsed !== null) {
			return parsed;
		}
		return rawValue;
	}
	const parsed = parseQuantity(rawValue);
	if (parsed !== null && parsed.unit.length > 0) {
		return parsed;
	}
	return rawValue;
}

function propertyEquals(
	a: PropertyValue | undefined,
	b: PropertyValue,
): boolean {
	if (a === undefined) {
		return false;
	}
	if (typeof a === "string" && typeof b === "string") {
		return a === b;
	}
	if (isParsedQuantity(a) && isParsedQuantity(b)) {
		return a.raw === b.raw && a.value === b.value && a.unit === b.unit;
	}
	if (
		(typeof a === "number" || typeof a === "boolean" || a === null) &&
		(typeof b === "number" || typeof b === "boolean" || b === null)
	) {
		return Object.is(a, b);
	}
	return false;
}
