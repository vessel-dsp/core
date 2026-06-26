import type { Point, Wire } from "./types";

export function splitWiresAtJunctions(wires: readonly Wire[]): Wire[] {
	const endpointKeys = new Set<string>();
	const endpoints: Point[] = [];
	for (const wire of wires) {
		for (const ep of wire.endpoints) {
			const key = pointKey(ep);
			if (!endpointKeys.has(key)) {
				endpointKeys.add(key);
				endpoints.push(ep);
			}
		}
	}

	const result: Wire[] = [];
	for (const wire of wires) {
		const a = wire.endpoints[0];
		const b = wire.endpoints[1];
		const splits: Point[] = [];
		for (const ep of endpoints) {
			if (pointEquals(ep, a) || pointEquals(ep, b)) {
				continue;
			}
			if (pointOnSegment(ep, a, b)) {
				splits.push(ep);
			}
		}
		if (splits.length === 0) {
			result.push(wire);
			continue;
		}
		const sortValue = (p: Point): number => {
			if (a.x !== b.x) {
				return (p.x - a.x) / (b.x - a.x);
			}
			if (a.y !== b.y) {
				return (p.y - a.y) / (b.y - a.y);
			}
			return 0;
		};
		splits.sort((p, q) => sortValue(p) - sortValue(q));

		let prev = a;
		let segmentIndex = 0;
		for (const split of splits) {
			segmentIndex += 1;
			result.push({
				id: `${wire.id}-${segmentIndex}`,
				endpoints: [prev, split],
			});
			prev = split;
		}
		segmentIndex += 1;
		result.push({ id: `${wire.id}-${segmentIndex}`, endpoints: [prev, b] });
	}
	return result;
}

function pointKey(p: Point): string {
	return `${p.x},${p.y}`;
}

function pointEquals(a: Point, b: Point): boolean {
	return a.x === b.x && a.y === b.y;
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
