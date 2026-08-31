import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
	isParsedQuantity,
	parseCircuitDocumentFile,
	parseQuantity,
} from "../../../packages/core/src";

const FIXTURE_ROOT = "tests/fixtures/schx";

// Identity and free-text properties are not quantities however they happen to parse.
const NOT_QUANTITY = new Set([
	"PartNumber",
	"Text",
	"Name",
	"InstName",
	"Description",
	"Notes",
	"Model",
	"model",
	"Manufacturer",
	"Package",
]);

// A discrete selector index is state, not a device parameter, so it stays a string.
const DISCRETE_STATE = new Set(["Position"]);

function schxFixtures(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...schxFixtures(path));
		else if (entry.name.endsWith(".schx")) out.push(path);
	}
	return out;
}

describe("schx quantity properties", () => {
	test("structures every device parameter that reads as a quantity", () => {
		const leftAsText: string[] = [];
		for (const path of schxFixtures(FIXTURE_ROOT)) {
			const document = parseCircuitDocumentFile(readFileSync(path, "utf8"), {
				filename: path,
			});
			for (const component of document.components) {
				for (const [key, value] of Object.entries(component.properties)) {
					if (isParsedQuantity(value) || typeof value !== "string") continue;
					if (NOT_QUANTITY.has(key) || DISCRETE_STATE.has(key)) continue;
					if (parseQuantity(value) === null) continue;
					leftAsText.push(`${component.sourceTypeName}.${key}=${value}`);
				}
			}
		}
		expect(leftAsText).toEqual([]);
	});

	test("keeps the tube, op-amp and bipolar parameters structured", () => {
		const triode = parseCircuitDocumentFile(
			readFileSync(
				join(FIXTURE_ROOT, "livespice-examples/Common Cathode Triode Amplifier.schx"),
				"utf8",
			),
			{ filename: "Common Cathode Triode Amplifier.schx" },
		)
			.components.find((component) => component.kind === "triode");
		expect(triode).toBeDefined();
		const rgk = triode?.properties.Rgk;
		expect(isParsedQuantity(rgk)).toBe(true);
		if (isParsedQuantity(rgk)) {
			expect(rgk.value).toBe(1_000_000);
			// `raw` keeps the source verbatim -- this file writes U+2126 OHM SIGN --
			// while `unit` is canonicalized to U+03A9 GREEK CAPITAL LETTER OMEGA.
			expect(rgk.raw).toBe("1 M\u2126");
			expect(rgk.unit).toBe("\u03a9");
		}
	});
});
