import type { Point } from "../model/types";

export function orthogonalPath(a: Point, b: Point): readonly Point[] {
	if (a.x === b.x || a.y === b.y) {
		return [a, b];
	}
	const dx = Math.abs(b.x - a.x);
	const dy = Math.abs(b.y - a.y);
	const corner: Point = dx >= dy ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
	return [a, corner, b];
}

export function pointsToSvg(points: readonly Point[]): string {
	return points.map((p) => `${p.x},${p.y}`).join(" ");
}
