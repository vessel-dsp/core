import { describe, expect, test } from "bun:test";
import { convertDipTrace } from "../../../packages/core/src/formats/diptrace/convert";
import { parseDipTraceSchematic } from "../../../packages/core/src/formats/diptrace/parser";
import {
	detectCircuitFormat,
	parseCircuitDocument,
	parseCircuitDocumentFile,
} from "../../../packages/core/src/formats/document";
import { parseVdspCircuitDocument } from "../../../packages/core/src/formats/document";
import { serializeInterchangeYaml } from "../../../packages/core/src/formats/interchange/serializer";

const FIXTURE_URL = new URL(
	"../../fixtures/diptrace/minimal.dchxml",
	import.meta.url,
);

async function loadDocument() {
	const model = parseDipTraceSchematic(await Bun.file(FIXTURE_URL).text());
	return convertDipTrace(model, { name: "minimal" });
}

function codesOf(result: ReturnType<typeof convertDipTrace>): string[] {
	return result.diagnostics.map((diagnostic) => diagnostic.code);
}

describe("diptrace layer-B conversion", () => {
	test("emits one component per schematic part with audio and supply", async () => {
		const result = await loadDocument();
		expect(result.refusal).toBeNull();
		expect(result.document?.components.length).toBe(11);
		expect(result.document?.audio).toEqual({
			input: "Connector1",
			output: "Connector2",
			bypass: "none",
		});
		const codes = codesOf(result);
		expect(codes).toContain("supply-assumed");
		expect(codes).toContain("bypass-none");
		expect(codes).toContain("audio-proposed");
	});

	test("maps resistor, diode, bjt and pot from typed evidence", async () => {
		const result = await loadDocument();
		const byId = new Map(
			(result.document?.components ?? []).map((component) => [
				component.id,
				component,
			]),
		);
		const r1 = byId.get("R1");
		expect(r1?.kind).toBe("resistor");
		expect(r1?.properties.Resistance).toEqual({
			raw: "4k7",
			value: 4700,
			unit: "",
		});
		const d1 = byId.get("D1");
		expect(d1?.kind).toBe("diode");
		expect(d1?.properties.PartNumber).toBe("1N4148");
		expect(
			d1?.terminals.map((terminal) => `${terminal.name}:${terminal.role}`),
		).toEqual(["1:anode", "2:cathode"]);
		const q1 = byId.get("Q1");
		expect(q1?.kind).toBe("bjt");
		expect(q1?.properties.Type).toBe("NPN");
		const p1 = byId.get("P1");
		expect(p1?.kind).toBe("potentiometer");
		expect(p1?.properties.Resistance).toEqual({
			raw: "500k",
			value: 500000,
			unit: "",
		});
		expect(p1?.properties.TaperMarking).toBe("B");
		expect(p1?.properties.Taper).toBeUndefined();
		expect(
			p1?.terminals.map((terminal) => `${terminal.name}:${terminal.role}`),
		).toEqual(["1:ccw", "2:wiper", "3:cw"]);
	});

	test("splits multi-part RefDes groups instead of asserting a pin order", async () => {
		const result = await loadDocument();
		const ids = (result.document?.components ?? []).map(
			(component) => component.id,
		);
		expect(ids).toContain("IC1A");
		expect(ids).toContain("IC1B");
		expect(ids).not.toContain("IC1");
		const codes = codesOf(result);
		expect(codes).toContain("multipart-sections-split");
	});

	test("reports the lettered-pad disagreement as a diagnostic", async () => {
		const result = await loadDocument();
		const mismatches = result.diagnostics.filter(
			(diagnostic) => diagnostic.code === "pad-label-mismatch",
		);
		expect(mismatches.length).toBe(2);
		const q2 = result.document?.components.find(
			(component) => component.id === "Q2",
		);
		expect(q2?.kind).toBe("bjt");
		// Role follows the symbol pin name, not the pad label.
		expect(
			q2?.terminals.map((terminal) => `${terminal.name}:${terminal.role}`),
		).toEqual(["B:base", "C:emitter", "E:collector"]);
	});

	test("refuses with a named reason when audio is not exactly one pair", async () => {
		const source = await Bun.file(FIXTURE_URL).text();
		const model = parseDipTraceSchematic(
			source.replace('<Value>OUT</Value>', "<Value>ALT</Value>"),
		);
		const result = convertDipTrace(model);
		expect(result.document).toBeNull();
		expect(result.refusal).toMatch(/audio-ports-unresolved/);
		expect(codesOf(result)).toContain("audio-ports-unresolved");
	});

	test("emitted document round-trips through the vdsp reader", async () => {
		const result = await loadDocument();
		expect(result.document).not.toBeNull();
		if (result.document === null) {
			return;
		}
		const yaml = serializeInterchangeYaml({
			...result.document,
			interchangeSchema: "circuit-interchange/v4",
		});
		const back = parseVdspCircuitDocument(yaml);
		expect(back.audio).toEqual({
			input: "Connector1",
			output: "Connector2",
			bypass: "none",
		});
		expect(back.components.length).toBe(11);
	});

	test("document dispatch reaches diptrace by extension and content", async () => {
		const source = await Bun.file(FIXTURE_URL).text();
		expect(detectCircuitFormat("amp.dchxml")).toBe("diptrace-dchxml");
		const byExtension = parseCircuitDocument(source, {
			filename: "amp.dchxml",
		});
		expect(
			byExtension.components.some((component) => component.id === "R1"),
		).toBe(true);
		const byContent = parseCircuitDocument(source, {});
		expect(
			byContent.components.some((component) => component.id === "R1"),
		).toBe(true);
		const byFile = parseCircuitDocumentFile(source, {
			filename: "amp.dchxml",
		});
		expect(byFile.components.length).toBe(11);
	});

	test("content sniff reads the root Type, with or without a BOM", async () => {
		const source = await Bun.file(FIXTURE_URL).text();
		expect(parseCircuitDocument(source, {}).rawAttributes.format).toBe(
			"diptrace-dchxml",
		);
		const withBom = `﻿${source}`;
		expect(withBom.charCodeAt(0)).toBe(0xfeff);
		expect(parseCircuitDocument(withBom, {}).rawAttributes.format).toBe(
			"diptrace-dchxml",
		);
	});

	test("a schx containing the DipTrace string still sniffs as schx", () => {
		// Negative control: the marker string in prose must not reroute.
		const hostile =
			`<Schematic Name="DipTrace-Schematic clone" Description="mentions DipTrace-Schematic in text">` +
			`<Element Type="Circuit.Symbol, Circuit" Position="0,0" Rotation="0"><Component _Type="Circuit.Resistor" Name="R1" Resistance="10k" /></Element>` +
			`</Schematic>`;
		expect(parseCircuitDocument(hostile, {}).rawAttributes.format).toBe(
			undefined,
		);
		expect(
			parseCircuitDocument(hostile, {}).components.some(
				(component) => component.id === "R1",
			),
		).toBe(true);
	});
});
