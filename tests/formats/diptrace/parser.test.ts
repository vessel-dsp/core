import { describe, expect, test } from "bun:test";
import {
	findDipTracePadLabelMismatches,
	parseDipTraceSchematic,
} from "../../../packages/core/src/formats/diptrace/parser";

const FIXTURE_URL = new URL(
	"../../fixtures/diptrace/minimal.dchxml",
	import.meta.url,
);

async function loadModel() {
	return parseDipTraceSchematic(await Bun.file(FIXTURE_URL).text());
}

describe("diptrace layer-A parser", () => {
	test("parses parts, library sections and nets", async () => {
		const model = await loadModel();
		expect(model.sourceType).toBe("DipTrace-Schematic");
		expect(model.parts.length).toBe(11);
		expect(model.nets.length).toBe(9);
		expect(model.library.length).toBe(10);
	});

	test("joins schematic pins to library pins with pad fallback", async () => {
		const model = await loadModel();
		const r1 = model.parts.find((part) => part.refDes === "R1");
		expect(r1?.value).toBe("4k7");
		expect(r1?.pins.map((pin) => pin.padNumber)).toEqual(["1", "2"]);
		expect(r1?.pins.map((pin) => pin.name)).toEqual(["1", "2"]);
		expect(r1?.pins.map((pin) => pin.netId)).toEqual(["1", "0"]);
		const q1 = model.parts.find((part) => part.refDes === "Q1");
		expect(q1?.pins.map((pin) => pin.name)).toEqual(["E", "B", "C"]);
	});

	test("reads nets by pin membership", async () => {
		const model = await loadModel();
		const net0 = model.nets.find((net) => net.id === "0");
		expect(
			net0?.members.map((member) => `${member.partId}.${member.pinId}`),
		).toEqual(["0.1", "2.0", "3.2", "4.0", "8.2"]);
	});

	test("keeps unconnected pins out of every net", async () => {
		const model = await loadModel();
		const q2 = model.parts.find((part) => part.refDes === "Q2");
		expect(q2?.pins.find((pin) => pin.pinId === "1")?.netId).toBe("-1");
		const membered = new Set(
			model.nets.flatMap((net) =>
				net.members.map((member) => `${member.partId}.${member.pinId}`),
			),
		);
		expect(membered.has("8.1")).toBe(false);
	});

	test("reports lettered pad disagreements and nothing else", async () => {
		const model = await loadModel();
		const mismatches = findDipTracePadLabelMismatches(model);
		// Q2's footprint pads C/E/B disagree with its symbol pins E/B/C.
		expect(mismatches.length).toBe(2);
		expect(
			mismatches.map((mismatch) => `${mismatch.pad}->${mismatch.name}`),
		).toEqual(["C->E", "E->C"]);
		expect(mismatches[0]?.refDes).toBe("Q2");
	});

	test("reads nested LibPath Path text and unquotes it", async () => {
		const model = await loadModel();
		const r1 = model.parts.find((part) => part.refDes === "R1");
		expect(r1?.libPath).toBe("C:\\Program Files\\DipTrace\\Lib\\00000.eli");
		const d1 = model.parts.find((part) => part.refDes === "D1");
		expect(d1?.libPath).toBe("");
		const q1 = model.parts.find((part) => part.refDes === "Q1");
		expect(q1?.libPath).toBe("C:\\Lib\\custom.eli");
	});

	test("throws on non-DipTrace input", () => {
		expect(() => parseDipTraceSchematic("<Schematic></Schematic>")).toThrow(
			/not a DipTrace schematic/,
		);
		expect(() => parseDipTraceSchematic("")).toThrow(
			/not a DipTrace schematic/,
		);
		expect(() =>
			parseDipTraceSchematic(
				`<Source Type="DipTrace-Pcb"><Schematic></Schematic></Source>`,
			),
		).toThrow(/Source Type/);
	});
});
