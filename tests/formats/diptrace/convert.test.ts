import { describe, expect, test } from "bun:test";
import { convertDipTrace } from "../../../packages/core/src/formats/diptrace/convert";
import { parseDipTraceSchematic } from "../../../packages/core/src/formats/diptrace/parser";
import type {
	DipTraceLibrarySection,
	DipTraceModel,
} from "../../../packages/core/src/formats/diptrace/parser";
import {
	detectCircuitFormat,
	parseCircuitDocument,
	parseCircuitDocumentFile,
} from "../../../packages/core/src/formats/document";
import {
	parseVdspCircuitDocument,
	parseVdspCircuitDocumentWithTopology,
} from "../../../packages/core/src/formats/document";
import { serializeInterchangeYaml } from "../../../packages/core/src/formats/interchange/serializer";
import { getPinNode } from "../../../packages/core/src/model/connectivity";

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
		expect(result.document?.components.length).toBe(10);
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

	test("merges a multi-unit IC package into one numbered ic", async () => {
		const result = await loadDocument();
		const ids = (result.document?.components ?? []).map(
			(component) => component.id,
		);
		expect(ids).toContain("IC1");
		expect(ids).not.toContain("IC1A");
		expect(ids).not.toContain("IC1B");
		const merged = result.document?.components.find(
			(component) => component.id === "IC1",
		);
		expect(merged?.kind).toBe("ic");
		expect(merged?.terminals.map((terminal) => terminal.name)).toEqual([
			"1",
			"2",
			"3",
			"4",
			"5",
			"6",
			"7",
			"8",
		]);
		const codes = codesOf(result);
		expect(codes).toContain("multipart-sections-merged");
		expect(codes).not.toContain("multipart-sections-split");
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
		expect(back.components.length).toBe(10);
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
		expect(byFile.components.length).toBe(10);
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

import {
	SYN_CONNECTOR_SECTION,
	dualOpampModel,
	quadOpampModel,
	syntheticNet,
	syntheticPart,
	syntheticSection,
	toYaml,
} from "./merge-fixtures";

describe("diptrace IC package merge", () => {
	test("a dual TL072 merges into one numbered ic", () => {
		const converted = convertDipTrace(dualOpampModel({}), { name: "synthetic-dual" });
		expect(converted.refusal).toBeNull();
		const merged = converted.document?.components.find(
			(component) => component.id === "IC1",
		);
		expect(merged?.kind).toBe("ic");
		expect(merged?.terminals.map((terminal) => terminal.name)).toEqual([
			"1", "2", "3", "4", "5", "6", "7", "8",
		]);
		expect(merged?.terminals.some((terminal) => terminal.role !== undefined)).toBe(false);
		expect(
			(converted.document?.components ?? []).some(
				(component) => component.id === "IC1A" || component.id === "IC1B",
			),
		).toBe(false);
		expect(codesOf(converted)).toContain("multipart-sections-merged");
	});
	test("a quad TL074 merges into one 14-terminal ic", () => {
		const converted = convertDipTrace(quadOpampModel(), { name: "synthetic-quad" });
		expect(converted.refusal).toBeNull();
		const merged = converted.document?.components.find(
			(component) => component.id === "IC1",
		);
		expect(merged?.kind).toBe("ic");
		expect(merged?.terminals.map((terminal) => terminal.name)).toEqual([
			"1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14",
		]);
		expect(codesOf(converted)).toContain("multipart-sections-merged");
	});
	test("mixed or empty values stay split with the decline diagnostic", () => {
		const converted = convertDipTrace(
			dualOpampModel({ values: ["TL072", ""] }),
			{ name: "synthetic-mixed" },
		);
		expect(converted.refusal).toBeNull();
		const ids = (converted.document?.components ?? []).map(
			(component) => component.id,
		);
		expect(ids).toContain("IC1A");
		expect(ids).toContain("IC1B");
		expect(ids).not.toContain("IC1");
		expect(codesOf(converted)).not.toContain("multipart-sections-merged");
		const decline = converted.diagnostics.find(
			(diagnostic) => diagnostic.code === "multipart-merge-declined",
		);
		expect(decline?.componentId).toBe("IC1");
	});
	test("units under different RefDes never merge", () => {
		const first = dualOpampModel({ tag: "a", refDes: "IC1" });
		const second = dualOpampModel({ tag: "b", refDes: "IC2", audio: false });
		const library = [...first.library];
		for (const section of second.library) {
			if (
				!library.some(
					(entry) => entry.style === section.style && entry.sectionId === section.sectionId,
				)
			) {
				library.push(section);
			}
		}
		const model: DipTraceModel = {
			sourceType: "DipTrace-Schematic",
			version: "1",
			units: "mm",
			library,
			parts: [...first.parts, ...second.parts],
			nets: [...first.nets, ...second.nets],
		};
		const converted = convertDipTrace(model, { name: "synthetic-two-duals" });
		expect(converted.refusal).toBeNull();
		for (const refDes of ["IC1", "IC2"]) {
			const merged = converted.document?.components.find(
				(component) => component.id === refDes,
			);
			expect(merged?.kind).toBe("ic");
			expect(merged?.terminals.map((terminal) => terminal.name)).toEqual([
				"1", "2", "3", "4", "5", "6", "7", "8",
			]);
		}
		expect(codesOf(converted)).not.toContain("multipart-merge-declined");
	});
	test("a placed unit with no library section declines and stays split", () => {
		const converted = convertDipTrace(
			dualOpampModel({ librarySectionB: false }),
			{ name: "synthetic-no-section" },
		);
		expect(converted.refusal).toBeNull();
		const ids = (converted.document?.components ?? []).map(
			(component) => component.id,
		);
		expect(ids).toContain("IC1A");
		expect(ids).toContain("IC1B");
		const decline = converted.diagnostics.find(
			(diagnostic) => diagnostic.code === "multipart-merge-declined",
		);
		expect(decline?.componentId).toBe("IC1");
		expect(codesOf(converted)).not.toContain("multipart-sections-merged");
	});
	test("a shared pad on different nets declines and stays split", () => {
		const converted = convertDipTrace(
			dualOpampModel({
				padsA: ["1", "2", "3", "5"],
				padsB: ["5", "6", "7", "8"],
				netA3: "nShared",
			}),
			{ name: "synthetic-pad-conflict" },
		);
		expect(converted.refusal).toBeNull();
		const ids = (converted.document?.components ?? []).map(
			(component) => component.id,
		);
		expect(ids).toContain("IC1A");
		expect(ids).toContain("IC1B");
		const decline = converted.diagnostics.find(
			(diagnostic) => diagnostic.code === "multipart-merge-declined",
		);
		expect(decline?.componentId).toBe("IC1");
		expect(codesOf(converted)).not.toContain("multipart-sections-merged");
	});
	test("a shared pad on one net folds into a single pin", () => {
		const converted = convertDipTrace(
			dualOpampModel({
				padsA: ["1", "2", "3", "5"],
				padsB: ["5", "6", "7", "8"],
				netA3: "nAOUT",
			}),
			{ name: "synthetic-pad-shared" },
		);
		expect(converted.refusal).toBeNull();
		const merged = converted.document?.components.find(
			(component) => component.id === "IC1",
		);
		expect(merged?.terminals.map((terminal) => terminal.name)).toEqual([
			"1", "2", "3", "5", "6", "7", "8",
		]);
		expect(codesOf(converted)).not.toContain("multipart-merge-declined");
		expect(codesOf(converted)).not.toContain("terminal-name-collision");
	});
	test("a spare library section contributes its pads as unconnected pins", () => {
		const converted = convertDipTrace(
			dualOpampModel({ sparePads: ["9", "10", "11", "12"] }),
			{ name: "synthetic-spare" },
		);
		expect(converted.refusal).toBeNull();
		const merged = converted.document?.components.find(
			(component) => component.id === "IC1",
		);
		expect(merged?.terminals.map((terminal) => terminal.name)).toEqual([
			"1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12",
		]);
		expect(codesOf(converted)).toContain("multipart-sections-merged");
	});
	test("dual-gang pots and switch fragments are untouched", () => {
		const potSectionA = syntheticSection("SYN-POT", "0", "POT", ["1", "3", "2"]);
		const potSectionB = syntheticSection("SYN-POT", "1", "POT", ["4", "6", "5"]);
		const switchSection = syntheticSection("SYN-SW", "0", "SW", ["1"]);
		const library: DipTraceLibrarySection[] = [
			potSectionA,
			potSectionB,
			switchSection,
			SYN_CONNECTOR_SECTION,
		];
		const model: DipTraceModel = {
			sourceType: "DipTrace-Schematic",
			version: "1",
			units: "mm",
			library,
			parts: [
				syntheticPart(library, "0", "SYN-POT", "0", "P1", "GAIN A", ["nA", "nB", "nC"]),
				syntheticPart(library, "1", "SYN-POT", "1", "P1", "GAIN B", ["nD", "nE", "nF"]),
				syntheticPart(library, "2", "SYN-SW", "0", "SW1", "", ["nG"]),
				syntheticPart(library, "3", "SYN-SW", "1", "SW1", "", ["nH"]),
				syntheticPart(library, "4", "SYN-SW", "2", "SW1", "", ["nI"]),
				syntheticPart(library, "5", "SYN-CNCT", "0", "Connector1", "IN", ["nA"]),
				syntheticPart(library, "6", "SYN-CNCT", "0", "Connector2", "OUT", ["nD"]),
			],
			nets: [
				syntheticNet("nA", [["0", "0"], ["5", "0"]]),
				syntheticNet("nB", [["0", "1"]]),
				syntheticNet("nC", [["0", "2"]]),
				syntheticNet("nD", [["1", "0"], ["6", "0"]]),
				syntheticNet("nE", [["1", "1"]]),
				syntheticNet("nF", [["1", "2"]]),
				syntheticNet("nG", [["2", "0"]]),
				syntheticNet("nH", [["3", "0"]]),
				syntheticNet("nI", [["4", "0"]]),
			],
		};
		const converted = convertDipTrace(model, { name: "synthetic-gangs" });
		expect(converted.refusal).toBeNull();
		const byId = new Map(
			(converted.document?.components ?? []).map((component) => [component.id, component]),
		);
		expect(byId.get("P1A")?.kind).toBe("potentiometer");
		expect(byId.get("P1B")?.kind).toBe("potentiometer");
		expect(byId.get("SW1")?.kind).toBe("switch");
		expect(byId.get("SW1")?.terminals.length).toBe(3);
		expect(codesOf(converted)).toContain("dual-gang-split");
		expect(codesOf(converted)).toContain("switch-fragments-merged");
		expect(codesOf(converted)).not.toContain("multipart-sections-merged");
		expect(codesOf(converted)).not.toContain("multipart-merge-declined");
		const gangSplit = converted.diagnostics.find(
			(diagnostic) =>
				diagnostic.code === "dual-gang-split" && diagnostic.componentId === "P1A",
		);
		expect(gangSplit).toBeDefined();
	});
	test("a merged package keeps which net each pad number lands on", () => {
		const model = dualOpampModel({ padsB: ["9", "6", "7", "8"] });
		const converted = convertDipTrace(model, { name: "synthetic-swapped" });
		expect(converted.refusal).toBeNull();
		// Pads are not merge evidence: the package still merges.
		expect(codesOf(converted)).toContain("multipart-sections-merged");
		// Two pads share a node exactly when the source puts them on one net.
		const yaml = toYaml(converted.document);
		const parsed = parseVdspCircuitDocumentWithTopology(yaml);
		const padNode = new Map<string, number>();
		for (const component of parsed.document.components) {
			if (component.id !== "IC1") {
				continue;
			}
			for (const terminal of component.terminals) {
				const node = getPinNode(parsed.connectivity, {
					componentId: component.id,
					terminalName: terminal.name,
				});
				if (node !== undefined) {
					padNode.set(terminal.name, node);
				}
			}
		}
		const padNet = new Map<string, string | null>();
		for (const part of model.parts) {
			if (part.refDes !== "IC1") {
				continue;
			}
			for (const pin of part.pins) {
				if (!padNet.has(pin.padNumber)) {
					padNet.set(pin.padNumber, pin.netId);
				}
			}
		}
		const pads = [...padNode.keys()];
		expect(pads.length).toBeGreaterThan(0);
		for (let a = 0; a < pads.length; a++) {
			for (let b = a + 1; b < pads.length; b++) {
				const padA = pads[a]!;
				const padB = pads[b]!;
				const netA = padNet.get(padA);
				const netB = padNet.get(padB);
				const sameNet = netA !== null && netA === netB;
				expect(padNode.get(padA) === padNode.get(padB)).toBe(sameNet);
			}
		}
	});
});
