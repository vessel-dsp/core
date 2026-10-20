// The closed LED indicator colour vocabulary behind a stated `Color` property.
// Pure contract on the parser: no fixture, no packet, no panel extraction.
import { describe, expect, test } from "bun:test";
import {
	LED_INDICATOR_COLOURS,
	parseLedIndicatorColour,
} from "../../packages/core/src/panel/types";

describe("parseLedIndicatorColour", () => {
	test("accepts exactly the five closed-vocabulary words", () => {
		expect([...LED_INDICATOR_COLOURS].sort()).toEqual([
			"blue",
			"green",
			"red",
			"white",
			"yellow",
		]);
		for (const colour of LED_INDICATOR_COLOURS) {
			expect(parseLedIndicatorColour(colour)).toBe(colour);
		}
	});

	test("rejects everything outside the vocabulary without normalising", () => {
		for (const value of [
			"Red",
			"RED",
			"amber",
			"red-green",
			'"red"',
			" red",
			"red ",
			"",
			null,
			undefined,
			42,
			{ raw: "red" },
		]) {
			expect(parseLedIndicatorColour(value)).toBeUndefined();
		}
	});
});
