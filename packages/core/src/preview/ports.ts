import type { Component, Point, Wire } from "../model/types";

export type WireBodyHit = Readonly<{
	wireId: string;
	position: Point;
}>;

export type Port = Readonly<{
	componentId: string;
	terminalName: string;
	position: Point;
}>;

// Flatten every component's terminals into a port list. The position is the
// raw catalog terminal position — the same coordinate space used in wire
// endpoints, so an add-wire command built from these positions lands on
// existing junction / connectivity logic without further mapping.
export function collectPorts(
	components: readonly Component[],
): readonly Port[] {
	const ports: Port[] = [];
	for (const component of components) {
		for (const terminal of component.terminals) {
			ports.push({
				componentId: component.id,
				terminalName: terminal.name,
				position: terminal.position,
			});
		}
	}
	return ports;
}

// Find the port nearest to `cursor` within `radius` distance, optionally
// excluding a particular port (used to avoid snapping back onto the wire's
// own start terminal during a wire-create drag).
export function findNearestPort<T extends Port>(
	ports: readonly T[],
	cursor: Point,
	radius: number,
	exclude: { componentId: string; terminalName: string } | null = null,
): T | null {
	let best: T | null = null;
	let bestDistance = radius;
	for (const port of ports) {
		if (
			exclude !== null &&
			port.componentId === exclude.componentId &&
			port.terminalName === exclude.terminalName
		) {
			continue;
		}
		const dx = port.position.x - cursor.x;
		const dy = port.position.y - cursor.y;
		const distance = Math.hypot(dx, dy);
		if (
			distance < bestDistance ||
			(best === null && distance <= bestDistance)
		) {
			best = port;
			bestDistance = distance;
		}
	}
	return best;
}

// Find the wire whose body is closest to `cursor`, within `radius`, and return
// the projection of the cursor onto that wire. Used to snap a wire-create
// gesture to a wire body so dropping there auto-forms a T-junction.
export function findNearestWireBodyHit(
	wires: readonly Wire[],
	cursor: Point,
	radius: number,
	excludeWireId: string | null = null,
): WireBodyHit | null {
	let best: WireBodyHit | null = null;
	let bestDistance = radius;
	for (const wire of wires) {
		if (excludeWireId !== null && wire.id === excludeWireId) {
			continue;
		}
		const projection = projectOntoSegment(
			cursor,
			wire.endpoints[0],
			wire.endpoints[1],
		);
		const dx = projection.x - cursor.x;
		const dy = projection.y - cursor.y;
		const distance = Math.hypot(dx, dy);
		if (distance < bestDistance) {
			best = { wireId: wire.id, position: projection };
			bestDistance = distance;
		}
	}
	return best;
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
