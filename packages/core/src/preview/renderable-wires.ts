import type { CircuitDocument, Point, Wire } from "../model/types";

export function buildRenderableWires(
	document: CircuitDocument,
): readonly Wire[] {
	const splitCandidates = collectSplitCandidates(document);
	const result: Wire[] = [];

	for (const wire of document.wires) {
		const segments = splitWire(wire, splitCandidates);
		result.push(...segments);
	}

	return result;
}

function collectSplitCandidates(document: CircuitDocument): readonly Point[] {
	const byKey = new Map<string, Point>();

	for (const wire of document.wires) {
		addPoint(byKey, wire.endpoints[0]);
		addPoint(byKey, wire.endpoints[1]);
	}

	for (const component of document.components) {
		for (const terminal of component.terminals) {
			addPoint(byKey, terminal.position);
		}
	}

	return Array.from(byKey.values());
}

function splitWire(wire: Wire, candidates: readonly Point[]): readonly Wire[] {
	const a = wire.endpoints[0];
	const b = wire.endpoints[1];
	const points = [a, b];

	for (const candidate of candidates) {
		if (pointEquals(candidate, a) || pointEquals(candidate, b)) {
			continue;
		}
		if (pointOnSegment(candidate, a, b)) {
			points.push(candidate);
		}
	}

	if (points.length === 2) {
		return [wire];
	}

	const ordered = points
		.slice()
		.sort((p, q) => segmentParameter(p, a, b) - segmentParameter(q, a, b));
	const segments: Wire[] = [];
	for (let i = 0; i < ordered.length - 1; i += 1) {
		const start = ordered[i];
		const end = ordered[i + 1];
		if (start === undefined || end === undefined || pointEquals(start, end)) {
			continue;
		}
		segments.push({
			id: `${wire.id}-${segments.length + 1}`,
			endpoints: [start, end],
		});
	}

	return segments;
}

function addPoint(points: Map<string, Point>, point: Point): void {
	const key = pointKey(point);
	if (!points.has(key)) {
		points.set(key, point);
	}
}

function segmentParameter(point: Point, a: Point, b: Point): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lengthSq = dx * dx + dy * dy;
	if (lengthSq === 0) {
		return 0;
	}
	return ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq;
}

function pointOnSegment(point: Point, a: Point, b: Point): boolean {
	const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
	if (cross !== 0) {
		return false;
	}
	const minX = Math.min(a.x, b.x);
	const maxX = Math.max(a.x, b.x);
	const minY = Math.min(a.y, b.y);
	const maxY = Math.max(a.y, b.y);
	if (minX === maxX && minY === maxY) {
		return false;
	}
	const inXRange = point.x > minX && point.x < maxX;
	const inYRange = point.y > minY && point.y < maxY;
	if (minX === maxX) {
		return inYRange;
	}
	if (minY === maxY) {
		return inXRange;
	}
	return inXRange && inYRange;
}

function pointEquals(a: Point, b: Point): boolean {
	return a.x === b.x && a.y === b.y;
}

function pointKey(point: Point): string {
	return `${point.x},${point.y}`;
}
