import type { CircuitDocument, Point, Wire } from "../model/types";

export type HangingEndpoint = Readonly<{
	wireId: string;
	point: Point;
	// 0 = first endpoint (A), 1 = second endpoint (B)
	endpointIndex: 0 | 1;
}>;

// A wire endpoint is "hanging" when it doesn't actually connect to anything:
// - It doesn't coincide with any component terminal position
// - It doesn't coincide with another wire's endpoint
// - It doesn't lie on another wire's body (T-junction)
// These show up as floating dots in the schematic view and almost always
// indicate a fixture data bug.
export function findHangingEndpoints(
	doc: CircuitDocument,
): readonly HangingEndpoint[] {
	const terminalSet = new Set<string>();
	for (const component of doc.components) {
		for (const terminal of component.terminals) {
			terminalSet.add(pointKey(terminal.position));
		}
	}

	const endpointCounts = new Map<string, number>();
	for (const wire of doc.wires) {
		endpointCounts.set(
			pointKey(wire.endpoints[0]),
			(endpointCounts.get(pointKey(wire.endpoints[0])) ?? 0) + 1,
		);
		endpointCounts.set(
			pointKey(wire.endpoints[1]),
			(endpointCounts.get(pointKey(wire.endpoints[1])) ?? 0) + 1,
		);
	}

	const hanging: HangingEndpoint[] = [];
	for (const wire of doc.wires) {
		for (const [endpointIndex, point] of [
			[0, wire.endpoints[0]] as const,
			[1, wire.endpoints[1]] as const,
		]) {
			if (isConnected(point, wire, doc.wires, terminalSet, endpointCounts)) {
				continue;
			}
			hanging.push({ wireId: wire.id, point, endpointIndex });
		}
	}
	return hanging;
}

function isConnected(
	point: Point,
	owningWire: Wire,
	allWires: readonly Wire[],
	terminalSet: ReadonlySet<string>,
	endpointCounts: ReadonlyMap<string, number>,
): boolean {
	if (terminalSet.has(pointKey(point))) {
		return true;
	}
	// Shared with another wire's endpoint?
	const count = endpointCounts.get(pointKey(point)) ?? 0;
	if (count > 1) {
		return true;
	}
	// Lies on another wire's body (T-junction)?
	for (const other of allWires) {
		if (other.id === owningWire.id) {
			continue;
		}
		if (pointOnSegmentInterior(point, other.endpoints[0], other.endpoints[1])) {
			return true;
		}
	}
	return false;
}

function pointOnSegmentInterior(p: Point, a: Point, b: Point): boolean {
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

function pointKey(p: Point): string {
	return `${p.x},${p.y}`;
}
