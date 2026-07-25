import { describe, expect, test } from "bun:test";
import { parseSpiceNetlist } from "../../../packages/core/src/formats/spice/parser";
import { serializeSpiceNetlist } from "../../../packages/core/src/formats/spice/serializer";
import {
	EMPTY_DOCUMENT,
	type CircuitDocument,
} from "../../../packages/core/src/model/types";

describe("serializeSpiceNetlist", () => {
	test("emits a placeholder comment when there is no title", () => {
		const text = serializeSpiceNetlist(EMPTY_DOCUMENT);
		expect(text).toContain("* @vessel-dsp/core");
		expect(text.trim().endsWith(".END")).toBe(true);
	});

	test("emits .TITLE when metadata.name is present", () => {
		const doc = parseSpiceNetlist(`.TITLE My Pedal\nR1 1 0 10k\n.END`);
		const text = serializeSpiceNetlist(doc);
		expect(text).toContain(".TITLE My Pedal");
	});

	test("emits R/C lines from parsed elements", () => {
		const doc = parseSpiceNetlist(`R1 1 2 10k\nC1 2 0 4.7u\n.END`);
		const text = serializeSpiceNetlist(doc);
		expect(text).toMatch(/^R1 \d+ \d+ 10k$/m);
		expect(text).toMatch(/^C1 \d+ \d+ 4\.7u$/m);
	});

	test("emits .MODEL directives verbatim", () => {
		const doc = parseSpiceNetlist(
			`R1 1 0 10k\n.MODEL 2N3904 NPN (IS=1e-14 BF=200)\n.END`,
		);
		const text = serializeSpiceNetlist(doc);
		expect(text).toContain(".MODEL 2N3904 NPN (IS=1e-14 BF=200)");
	});

	test("emits subcircuit-bound components as commented placeholders", () => {
		const doc = parseSpiceNetlist(`R1 1 0 10k\nQ1 3 2 0 2N3904\n.END`);
		const text = serializeSpiceNetlist(doc);
		expect(text).toMatch(/^Q1\b/m);
	});

	test("serializer + parser is connectivity-stable for an RC filter", () => {
		const src = `R1 1 2 10k\nC1 2 0 4.7u\nV1 1 0 9\n.END`;
		const doc1 = parseSpiceNetlist(src);
		const serialized = serializeSpiceNetlist(doc1);
		const doc2 = parseSpiceNetlist(serialized);
		// R, C, V each present; ground (0) auto-created on both passes.
		expect(doc2.components.filter((c) => c.kind === "resistor")).toHaveLength(
			1,
		);
		expect(doc2.components.filter((c) => c.kind === "capacitor")).toHaveLength(
			1,
		);
		expect(
			doc2.components.filter((c) => c.kind === "voltage-source"),
		).toHaveLength(1);
	});

	test("source/reference export includes source-only R/C parts and deterministic metadata comments", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				{
					id: "R_SCREEN",
					kind: "resistor",
					name: "R_SCREEN",
					origin: { x: 0, y: 0 },
					rotation: 0,
					flipped: false,
					terminals: [
						{ name: "a", position: { x: 0, y: 0 } },
						{ name: "b", position: { x: 20, y: 0 } },
					],
					properties: {
						R: "470 ohm",
						SourceOnly: "true",
						SourceReviewStatus: "source-reference",
						SourceBoundaryRole: "power-tube-screen-grid",
					},
					sourceTypeName: "Circuit.Resistor",
				},
				{
					id: "C_MAIN_A",
					kind: "capacitor",
					name: "C_MAIN_A",
					origin: { x: 20, y: 20 },
					rotation: 0,
					flipped: false,
					terminals: [
						{ name: "a", position: { x: 20, y: 0 } },
						{ name: "b", position: { x: 20, y: 20 } },
					],
					properties: {
						C: "16uF",
						SourceOnly: "true",
						SourceReviewStatus: "source-reference",
						CanCapGroupId: "C_MAIN",
						CanCapSection: "A",
					},
					sourceTypeName: "Circuit.Capacitor",
				},
			],
		};

		const text = serializeSpiceNetlist(doc);

		expect(text).toMatch(/^\* R_SCREEN SourceReviewStatus=source-reference$/m);
		expect(text).toMatch(
			/^\* R_SCREEN SourceBoundaryRole=power-tube-screen-grid$/m,
		);
		expect(text).toMatch(/^\* R_SCREEN SourceOnly=true$/m);
		expect(text).toMatch(/^R_SCREEN \d+ \d+ 470 ohm$/m);
		expect(text).toMatch(/^\* C_MAIN_A CanCapGroupId=C_MAIN$/m);
		expect(text).toMatch(/^\* C_MAIN_A CanCapSection=A$/m);
		expect(text).toMatch(/^\* C_MAIN_A SourceOnly=true$/m);
		expect(text).toMatch(/^C_MAIN_A \d+ \d+ 16uF$/m);
	});
});
