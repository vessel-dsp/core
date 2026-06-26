import type { CircuitDocument, Point, Wire } from "../model/types";

// A "chain corner" is a wire endpoint where exactly two wires meet, with no
// component terminal at the same point and no third wire crossing through —
// i.e. a routing bend the user sees as a single bend point on a longer
// connector. These are the points that split-wire / merge-wires operate on.
export function findChainCorners(doc: CircuitDocument): readonly Point[] {
	const wireByEndpoint = new Map<string, Wire[]>();
	for (const wire of doc.wires) {
		for (const endpoint of wire.endpoints) {
			const key = pointKey(endpoint);
			const list = wireByEndpoint.get(key);
			if (list === undefined) {
				wireByEndpoint.set(key, [wire]);
			} else {
				list.push(wire);
			}
		}
	}
	const terminalSet = new Set<string>();
	for (const component of doc.components) {
		for (const terminal of component.terminals) {
			terminalSet.add(pointKey(terminal.position));
		}
	}

	const seen = new Set<string>();
	const corners: Point[] = [];
	for (const wire of doc.wires) {
		for (const endpoint of wire.endpoints) {
			const key = pointKey(endpoint);
			if (seen.has(key)) continue;
			if (terminalSet.has(key)) continue;
			const peers = wireByEndpoint.get(key) ?? [];
			if (peers.length !== 2) continue;
			let crossed = false;
			for (const other of doc.wires) {
				if (peers.some((p) => p.id === other.id)) continue;
				if (
					pointOnSegmentInterior(
						endpoint,
						other.endpoints[0],
						other.endpoints[1],
					)
				) {
					crossed = true;
					break;
				}
			}
			if (crossed) continue;
			seen.add(key);
			corners.push(endpoint);
		}
	}
	return corners;
}

// findWireChain expands a single wire id into the connected "chain" of wires
// the user perceives as one connector. Two wires belong to the same chain when
// they share an endpoint that is:
//   - not a component terminal,
//   - shared by exactly two wires (no branching), and
//   - not on the body of a third wire (no T-junction).
// The chain stops as soon as any of those conditions fails. This lets fixture
// L-shapes authored as two adjacent segments select and delete as one unit,
// while preserving legitimate branching / junctions.
export function findWireChain(
	rootWireId: string,
	doc: CircuitDocument,
): readonly string[] {
	const root = doc.wires.find((w) => w.id === rootWireId);
	if (root === undefined) {
		return [];
	}

	const wireByEndpoint = new Map<string, Wire[]>();
	for (const wire of doc.wires) {
		for (const endpoint of wire.endpoints) {
			const key = pointKey(endpoint);
			const list = wireByEndpoint.get(key);
			if (list === undefined) {
				wireByEndpoint.set(key, [wire]);
			} else {
				list.push(wire);
			}
		}
	}

	const terminalSet = new Set<string>();
	for (const component of doc.components) {
		for (const terminal of component.terminals) {
			terminalSet.add(pointKey(terminal.position));
		}
	}

	function isInteriorCorner(endpoint: Point, owningWire: Wire): boolean {
		const key = pointKey(endpoint);
		if (terminalSet.has(key)) {
			return false;
		}
		const peers = wireByEndpoint.get(key) ?? [];
		if (peers.length !== 2) {
			return false;
		}
		for (const candidate of doc.wires) {
			if (candidate.id === owningWire.id) continue;
			if (peers.some((peer) => peer.id === candidate.id)) continue;
			if (
				pointOnSegmentInterior(
					endpoint,
					candidate.endpoints[0],
					candidate.endpoints[1],
				)
			) {
				return false;
			}
		}
		return true;
	}

	const visited = new Set<string>([root.id]);
	const stack: Wire[] = [root];

	while (stack.length > 0) {
		const wire = stack.pop() as Wire;
		for (const endpoint of wire.endpoints) {
			if (!isInteriorCorner(endpoint, wire)) {
				continue;
			}
			const peers = wireByEndpoint.get(pointKey(endpoint)) ?? [];
			for (const peer of peers) {
				if (peer.id === wire.id) continue;
				if (visited.has(peer.id)) continue;
				visited.add(peer.id);
				stack.push(peer);
			}
		}
	}

	return [...visited];
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
