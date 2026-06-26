import type { Point, Rotation } from "../../model/types";

export function mapTerminal(
	local: Point,
	origin: Point,
	rotation: Rotation,
	flipped: boolean,
): Point {
	const x = local.x;
	const y = flipped ? local.y : -local.y;
	const cos = quarterCos(rotation);
	const sin = quarterSin(rotation);
	return {
		x: x * cos + y * sin + origin.x,
		y: y * cos - x * sin + origin.y,
	};
}

export function normalizeRotation(raw: number): Rotation {
	if (!Number.isFinite(raw)) {
		return 0;
	}
	const r = (((Math.trunc(raw) % 4) + 4) % 4) as Rotation;
	return r;
}

function quarterCos(r: Rotation): number {
	switch (r) {
		case 0:
			return 1;
		case 1:
			return 0;
		case 2:
			return -1;
		case 3:
			return 0;
	}
}

function quarterSin(r: Rotation): number {
	switch (r) {
		case 0:
			return 0;
		case 1:
			return 1;
		case 2:
			return 0;
		case 3:
			return -1;
	}
}
