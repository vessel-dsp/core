import { describe, expect, test } from "bun:test";
import {
	dipTraceCapacitorPositivePad,
	parseDipTraceSchematic,
} from "../../../packages/core/src/formats/diptrace/parser";
import { convertDipTrace } from "../../../packages/core/src/formats/diptrace/convert";

const FIXTURE_URL = new URL(
	"../../fixtures/diptrace/polarity.dchxml",
	import.meta.url,
);

async function loadModel() {
	return parseDipTraceSchematic(await Bun.file(FIXTURE_URL).text());
}

describe("diptrace capacitor polarity from symbol geometry", () => {
	test("reads the plus glyph's plate on a hand-drawn symbol", async () => {
		const model = await loadModel();
		// CompType0: plus crossing drawn at the pad-2 plate.
		const drawn = model.library.find(
			(section) => section.style === "CompType0",
		);
		expect(drawn).toBeDefined();
		expect(dipTraceCapacitorPositivePad(drawn!)).toBe("2");
	});

	test("returns null when the symbol carries no plus glyph", async () => {
		const model = await loadModel();
		// CompType1: identical plates but an Arc segment instead of the cross.
		const arced = model.library.find(
			(section) => section.style === "CompType1",
		);
		expect(arced).toBeDefined();
		expect(dipTraceCapacitorPositivePad(arced!)).toBeNull();
	});

	test("conversion records the positive terminal as a typed field", async () => {
		const model = await loadModel();
		const result = convertDipTrace(model, { supplyVolts: 9 });
		expect(result.refusal).toBeNull();
		expect(result.document).not.toBeNull();
		const byId = new Map(
			(result.document?.components ?? []).map((component) => [
				component.id,
				component,
			]),
		);
		// C1's plus glyph sits at the pad-2 plate: typed field + diagnostic.
		expect(byId.get("C1")?.properties.PositiveTerminal).toBe("2");
		expect(
			result.diagnostics.some(
				(diagnostic) =>
					diagnostic.code === "electrolytic-positive-from-geometry" &&
					diagnostic.componentId === "C1",
			),
		).toBe(true);
		// C2's arc segment is no glyph: undeclared stays undeclared.
		expect(byId.get("C2")?.properties.PositiveTerminal).toBeUndefined();
		expect(
			result.diagnostics.some(
				(diagnostic) =>
					diagnostic.code === "electrolytic-orientation-undeclared" &&
					diagnostic.componentId === "C2",
			),
		).toBe(true);
	});
});
