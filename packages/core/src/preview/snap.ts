import type { Component, Point, Wire } from "../model/types";

export const DEFAULT_SNAP_RADIUS = 12;

export type SnapResult = Readonly<{
	origin: Point;
	snappedTo: Point | null;
	distance: number;
}>;

export function findSnap(
	draggedComponent: Component,
	candidateOrigin: Point,
	others: readonly Component[],
	radius: number = DEFAULT_SNAP_RADIUS,
	wires: readonly Wire[] = [],
): SnapResult {
	const dx = candidateOrigin.x - draggedComponent.origin.x;
	const dy = candidateOrigin.y - draggedComponent.origin.y;
	const draggedTerminalKeys = new Set(
		draggedComponent.terminals.map((t) => pointKey(t.position)),
	);

	let bestDelta: Point | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	let bestTarget: Point | null = null;

	for (const draggedTerminal of draggedComponent.terminals) {
		const projected: Point = {
			x: draggedTerminal.position.x + dx,
			y: draggedTerminal.position.y + dy,
		};
		for (const other of others) {
			if (other.id === draggedComponent.id) {
				continue;
			}
			for (const terminal of other.terminals) {
				const ddx = terminal.position.x - projected.x;
				const ddy = terminal.position.y - projected.y;
				const distance = Math.hypot(ddx, ddy);
				if (distance <= radius && distance < bestDistance) {
					bestDistance = distance;
					bestDelta = { x: ddx, y: ddy };
					bestTarget = terminal.position;
				}
			}
		}
	}

	for (const draggedTerminal of draggedComponent.terminals) {
		const projected: Point = {
			x: draggedTerminal.position.x + dx,
			y: draggedTerminal.position.y + dy,
		};
		for (const wire of wires) {
			if (wireTouchesDraggedTerminal(wire, draggedTerminalKeys)) {
				continue;
			}
			const target = nearestInteriorPointOnSegment(
				projected,
				wire.endpoints[0],
				wire.endpoints[1],
			);
			if (target === null) {
				continue;
			}
			const distance = Math.hypot(
				target.x - projected.x,
				target.y - projected.y,
			);
			if (distance <= radius && distance < bestDistance) {
				bestDistance = distance;
				bestDelta = { x: target.x - projected.x, y: target.y - projected.y };
				bestTarget = target;
			}
		}
	}

	if (bestDelta === null || bestTarget === null) {
		return {
			origin: candidateOrigin,
			snappedTo: null,
			distance: Number.POSITIVE_INFINITY,
		};
	}

	return {
		origin: {
			x: candidateOrigin.x + bestDelta.x,
			y: candidateOrigin.y + bestDelta.y,
		},
		snappedTo: bestTarget,
		distance: bestDistance,
	};
}

function wireTouchesDraggedTerminal(
	wire: Wire,
	terminalKeys: ReadonlySet<string>,
): boolean {
	return (
		terminalKeys.has(pointKey(wire.endpoints[0])) ||
		terminalKeys.has(pointKey(wire.endpoints[1]))
	);
}

function nearestInteriorPointOnSegment(
	point: Point,
	a: Point,
	b: Point,
): Point | null {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lengthSq = dx * dx + dy * dy;
	if (lengthSq === 0) {
		return null;
	}
	const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq;
	if (t <= 0 || t >= 1) {
		return null;
	}
	return {
		x: a.x + dx * t,
		y: a.y + dy * t,
	};
}

function pointKey(point: Point): string {
	return `${point.x},${point.y}`;
}
