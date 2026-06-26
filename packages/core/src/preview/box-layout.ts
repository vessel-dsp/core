import type { Bounds } from "./bounds";
import type { Component } from "../model/types";

// Every component renders in a uniform square container centered on its origin.
// HALF_SIZE=20 matches the symbol viewBox (−25..25 with body content within ±20).
// Lead axes that extend beyond ±20 (potentiometer ±40, op-amp ±30) intentionally
// reach OUT of the container — they're connection lines to wires, not symbol body.
const HALF_SIZE = 20;

export function computeComponentBox(component: Component): Bounds {
	const minX = component.origin.x - HALF_SIZE;
	const minY = component.origin.y - HALF_SIZE;
	const maxX = component.origin.x + HALF_SIZE;
	const maxY = component.origin.y + HALF_SIZE;

	return {
		minX,
		minY,
		maxX,
		maxY,
		width: maxX - minX,
		height: maxY - minY,
	};
}
