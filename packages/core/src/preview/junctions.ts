import type { Point, Wire } from "../model/types";

export function findJunctions(
	wires: readonly Wire[],
	terminals: readonly Point[],
): readonly Point[] {
	const endpointCounts = new Map<string, number>();
	const knownPoints = new Map<string, Point>();

	for (const wire of wires) {
		for (const endpoint of wire.endpoints) {
			const key = pointKey(endpoint);
			endpointCounts.set(key, (endpointCounts.get(key) ?? 0) + 1);
			if (!knownPoints.has(key)) {
				knownPoints.set(key, endpoint);
			}
		}
	}

	const junctions = new Map<string, Point>();

	for (const [key, count] of endpointCounts) {
		const point = knownPoints.get(key);
		if (point === undefined) {
			continue;
		}

		if (count >= 3) {
			junctions.set(key, point);
			continue;
		}

		if (count >= 1 && hasMidSegmentHit(point, wires)) {
			junctions.set(key, point);
		}
	}

	for (const terminal of terminals) {
		const key = pointKey(terminal);
		if (junctions.has(key)) {
			continue;
		}
		if (hasMidSegmentHit(terminal, wires)) {
			junctions.set(key, terminal);
		}
	}

	return Array.from(junctions.values());
}

function hasMidSegmentHit(point: Point, wires: readonly Wire[]): boolean {
	for (const wire of wires) {
		const a = wire.endpoints[0];
		const b = wire.endpoints[1];
		if (pointEquals(point, a) || pointEquals(point, b)) {
			continue;
		}
		if (pointOnSegment(point, a, b)) {
			return true;
		}
	}
	return false;
}

function pointOnSegment(p: Point, a: Point, b: Point): boolean {
	const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
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
	const inXRange = p.x > minX && p.x < maxX;
	const inYRange = p.y > minY && p.y < maxY;
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

function pointKey(p: Point): string {
	return `${p.x},${p.y}`;
}
