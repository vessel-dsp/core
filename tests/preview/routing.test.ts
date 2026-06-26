import { describe, expect, test } from "bun:test";
import {
	orthogonalPath,
	pointsToSvg,
} from "../../packages/core/src/preview/routing";

describe("orthogonalPath", () => {
	test("returns a 2-point path when already on the same vertical", () => {
		const path = orthogonalPath({ x: 5, y: 0 }, { x: 5, y: 50 });
		expect(path).toEqual([
			{ x: 5, y: 0 },
			{ x: 5, y: 50 },
		]);
	});

	test("returns a 2-point path when already on the same horizontal", () => {
		const path = orthogonalPath({ x: 0, y: 10 }, { x: 100, y: 10 });
		expect(path).toEqual([
			{ x: 0, y: 10 },
			{ x: 100, y: 10 },
		]);
	});

	test("chooses horizontal-first elbow when dx >= dy", () => {
		const path = orthogonalPath({ x: 0, y: 0 }, { x: 100, y: 30 });
		expect(path).toEqual([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			{ x: 100, y: 30 },
		]);
	});

	test("chooses vertical-first elbow when dy > dx", () => {
		const path = orthogonalPath({ x: 0, y: 0 }, { x: 30, y: 100 });
		expect(path).toEqual([
			{ x: 0, y: 0 },
			{ x: 0, y: 100 },
			{ x: 30, y: 100 },
		]);
	});

	test("pointsToSvg formats a polyline string", () => {
		expect(
			pointsToSvg([
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
				{ x: 10, y: 20 },
			]),
		).toBe("0,0 10,0 10,20");
	});
});
