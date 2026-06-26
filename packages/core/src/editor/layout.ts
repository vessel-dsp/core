import type { CircuitDocument, Component, Point, Wire } from "../model/types";

export type TidyLayoutOptions = Readonly<{
	spacing?: number;
	margin?: number;
	maxSearchRadius?: number;
}>;

type LayoutBox = Readonly<{
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}>;

const DISPLAY_HALF = 20;
const LABEL_BASELINE_OFFSET = 32;
const LABEL_DESCENDER = 6;
const LABEL_CHAR_WIDTH = 6;
const DEFAULT_SPACING = 64;
const DEFAULT_MARGIN = 4;

export function tidyDocumentLayout(
	doc: CircuitDocument,
	options: TidyLayoutOptions = {},
): CircuitDocument {
	if (doc.components.length < 2) {
		return doc;
	}

	const spacing = positiveOrDefault(options.spacing, DEFAULT_SPACING);
	const margin = nonNegativeOrDefault(options.margin, DEFAULT_MARGIN);
	const maxSearchRadius = Math.max(
		1,
		Math.ceil(options.maxSearchRadius ?? doc.components.length + 4),
	);

	const placed: LayoutBox[] = [];
	const originsById = new Map<string, Point>();

	for (let index = 0; index < doc.components.length; index += 1) {
		const component = doc.components[index]!;
		const origin = overlapsAny(
			boxForComponent(component, component.origin, margin),
			placed,
		)
			? freeOriginNear(
					component,
					[
						...placed,
						...doc.components
							.slice(index + 1)
							.map((future) => boxForComponent(future, future.origin, margin)),
					],
					spacing,
					margin,
					maxSearchRadius,
				)
			: component.origin;

		placed.push(boxForComponent(component, origin, margin));
		if (!pointEquals(origin, component.origin)) {
			originsById.set(component.id, origin);
		}
	}

	if (originsById.size === 0) {
		return doc;
	}

	return moveComponents(doc, originsById);
}

function freeOriginNear(
	component: Component,
	occupied: readonly LayoutBox[],
	spacing: number,
	margin: number,
	maxSearchRadius: number,
): Point {
	for (let radius = 1; radius <= maxSearchRadius; radius += 1) {
		for (const offset of candidateOffsets(radius)) {
			const candidate = {
				x: component.origin.x + offset.x * spacing,
				y: component.origin.y + offset.y * spacing,
			};
			if (
				!overlapsAny(boxForComponent(component, candidate, margin), occupied)
			) {
				return candidate;
			}
		}
	}

	return {
		x: component.origin.x + (maxSearchRadius + 1) * spacing,
		y: component.origin.y,
	};
}

function candidateOffsets(radius: number): readonly Point[] {
	const offsets: Point[] = [];
	for (let y = -radius; y <= radius; y += 1) {
		for (let x = -radius; x <= radius; x += 1) {
			if (Math.max(Math.abs(x), Math.abs(y)) === radius) {
				offsets.push({ x, y });
			}
		}
	}
	return offsets.sort(compareOffsets);
}

function compareOffsets(a: Point, b: Point): number {
	return (
		distanceSq(a) - distanceSq(b) ||
		Math.abs(a.y) - Math.abs(b.y) ||
		directionRank(a) - directionRank(b) ||
		a.y - b.y ||
		a.x - b.x
	);
}

function directionRank(point: Point): number {
	if (point.y === 0 && point.x > 0) return 0;
	if (point.x === 0 && point.y > 0) return 1;
	if (point.y === 0 && point.x < 0) return 2;
	if (point.x === 0 && point.y < 0) return 3;
	return 4;
}

function distanceSq(point: Point): number {
	return point.x * point.x + point.y * point.y;
}

function moveComponents(
	doc: CircuitDocument,
	originsById: ReadonlyMap<string, Point>,
): CircuitDocument {
	const terminalMoves = new Map<string, Point>();
	const components = doc.components.map((component) => {
		const origin = originsById.get(component.id);
		if (origin === undefined) {
			return component;
		}
		const dx = origin.x - component.origin.x;
		const dy = origin.y - component.origin.y;
		const terminals = component.terminals.map((terminal) => {
			const moved = shiftPoint(terminal.position, dx, dy);
			terminalMoves.set(pointKey(terminal.position), moved);
			return { name: terminal.name, position: moved };
		});
		return { ...component, origin, terminals };
	});

	const wires = doc.wires.map((wire) => remapWire(wire, terminalMoves));
	return { ...doc, components, wires };
}

function remapWire(
	wire: Wire,
	terminalMoves: ReadonlyMap<string, Point>,
): Wire {
	const a = terminalMoves.get(pointKey(wire.endpoints[0]));
	const b = terminalMoves.get(pointKey(wire.endpoints[1]));
	if (a === undefined && b === undefined) {
		return wire;
	}
	const endpoints: readonly [Point, Point] = [
		a ?? wire.endpoints[0],
		b ?? wire.endpoints[1],
	];
	return { ...wire, endpoints };
}

function shiftPoint(point: Point, dx: number, dy: number): Point {
	return { x: point.x + dx, y: point.y + dy };
}

function boxForComponent(
	component: Component,
	origin: Point,
	margin: number,
): LayoutBox {
	const labelHalfWidth = Math.max(
		DISPLAY_HALF,
		(component.name.length * LABEL_CHAR_WIDTH) / 2,
	);
	let minX = Math.min(origin.x - DISPLAY_HALF, origin.x - labelHalfWidth);
	let minY = origin.y - DISPLAY_HALF;
	let maxX = Math.max(origin.x + DISPLAY_HALF, origin.x + labelHalfWidth);
	let maxY = Math.max(
		origin.y + DISPLAY_HALF,
		origin.y + LABEL_BASELINE_OFFSET + LABEL_DESCENDER,
	);

	for (const terminal of component.terminals) {
		const x = origin.x + terminal.position.x - component.origin.x;
		const y = origin.y + terminal.position.y - component.origin.y;
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	}

	return {
		minX: minX - margin,
		minY: minY - margin,
		maxX: maxX + margin,
		maxY: maxY + margin,
	};
}

function overlapsAny(box: LayoutBox, placed: readonly LayoutBox[]): boolean {
	return placed.some((other) => boxesOverlap(box, other));
}

function boxesOverlap(a: LayoutBox, b: LayoutBox): boolean {
	return (
		a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
	);
}

function positiveOrDefault(
	value: number | undefined,
	fallback: number,
): number {
	return value !== undefined && value > 0 ? value : fallback;
}

function nonNegativeOrDefault(
	value: number | undefined,
	fallback: number,
): number {
	return value !== undefined && value >= 0 ? value : fallback;
}

function pointEquals(a: Point, b: Point): boolean {
	return a.x === b.x && a.y === b.y;
}

function pointKey(point: Point): string {
	return `${point.x},${point.y}`;
}
