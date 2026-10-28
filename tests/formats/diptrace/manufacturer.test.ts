import { describe, expect, test } from "bun:test";
import { convertDipTrace } from "../../../packages/core/src/formats/diptrace/convert";
import { parseDipTraceSchematic } from "../../../packages/core/src/formats/diptrace/parser";

const FIXTURE_URL = new URL(
	"../../fixtures/diptrace/manufacturer.dchxml",
	import.meta.url,
);

async function loadResult() {
	const model = parseDipTraceSchematic(await Bun.file(FIXTURE_URL).text());
	return convertDipTrace(model, { name: "manufacturer" });
}

function byId(result: Awaited<ReturnType<typeof loadResult>>) {
	return new Map(
		(result.document?.components ?? []).map((component) => [
			component.id,
			component,
		]),
	);
}

describe("diptrace pot values from the Manufacturer field", () => {
	test("parser reads Manufacturer and Datasheet fields", async () => {
		const model = parseDipTraceSchematic(await Bun.file(FIXTURE_URL).text());
		const r1 = model.parts.find((part) => part.refDes === "R1");
		expect(r1?.manufacturer).toBe("Yageo");
		expect(r1?.datasheet).toBe("RC0805-JW-1002");
		const p1 = model.parts.find((part) => part.refDes === "P1");
		expect(p1?.manufacturer).toBe("A500k");
	});

	test("reads track resistance and taper marking from Manufacturer", async () => {
		const result = await loadResult();
		expect(result.refusal).toBeNull();
		const p1 = byId(result).get("P1");
		expect(p1?.kind).toBe("potentiometer");
		expect(p1?.properties.Resistance).toEqual({
			raw: "500k",
			value: 500000,
			unit: "",
		});
		expect(p1?.properties.TaperMarking).toBe("A");
		expect(p1?.properties.DipTraceValueSource).toBe("Manufacturer");
		expect(
			result.diagnostics.some(
				(diagnostic) =>
					diagnostic.code === "pot-value-from-manufacturer-field" &&
					diagnostic.componentId === "P1",
			),
		).toBe(true);
	});

	test("a manufacturer name leaves the pot absent", async () => {
		const result = await loadResult();
		const p2 = byId(result).get("P2");
		expect(p2?.kind).toBe("potentiometer");
		expect(p2?.properties.Resistance).toBeUndefined();
		expect(
			result.diagnostics.some(
				(diagnostic) =>
					diagnostic.code === "pot-resistance-absent" &&
					diagnostic.componentId === "P2",
			),
		).toBe(true);
	});

	test("Manufacturer on a resistor is ignored", async () => {
		const result = await loadResult();
		const r1 = byId(result).get("R1");
		expect(r1?.kind).toBe("resistor");
		expect(r1?.properties.Resistance).toEqual({
			raw: "10k",
			value: 10000,
			unit: "",
		});
		expect(r1?.properties.DipTraceValueSource).toBeUndefined();
		expect(
			result.diagnostics.some(
				(diagnostic) => diagnostic.componentId === "R1",
			),
		).toBe(false);
	});

	test("conflicting Value and Manufacturer leaves the pot absent", async () => {
		const result = await loadResult();
		const p3 = byId(result).get("P3");
		expect(p3?.kind).toBe("potentiometer");
		expect(p3?.properties.Resistance).toBeUndefined();
		expect(
			result.diagnostics.some(
				(diagnostic) =>
					diagnostic.code === "pot-value-conflict" &&
					diagnostic.componentId === "P3",
			),
		).toBe(true);
	});

	test("agreeing Value and Manufacturer takes the value quietly", async () => {
		const result = await loadResult();
		const p4 = byId(result).get("P4");
		expect(p4?.properties.Resistance).toEqual({
			raw: "10k",
			value: 10000,
			unit: "",
		});
		expect(
			result.diagnostics.some(
				(diagnostic) =>
					(diagnostic.code === "pot-value-conflict" ||
						diagnostic.code === "pot-value-from-manufacturer-field") &&
					diagnostic.componentId === "P4",
			),
		).toBe(false);
	});

	test("starred Manufacturer marking stays refused", async () => {
		const result = await loadResult();
		const p5 = byId(result).get("P5");
		expect(p5?.kind).toBe("potentiometer");
		expect(p5?.properties.Resistance).toBeUndefined();
		expect(
			result.diagnostics.some(
				(diagnostic) =>
					diagnostic.code === "pot-resistance-absent" &&
					diagnostic.componentId === "P5",
			),
		).toBe(true);
	});

	test("Value and Name keep their existing path when Manufacturer is empty", async () => {
		const result = await loadResult();
		const p6 = byId(result).get("P6");
		expect(p6?.properties.Resistance).toEqual({
			raw: "50k",
			value: 50000,
			unit: "",
		});
		expect(p6?.properties.TaperMarking).toBe("B");
		expect(p6?.properties.DipTraceValueSource).toBeUndefined();
	});
});

describe("diptrace pot RKM infix markings", () => {
	test("B2k5 reads 2.5 kOhm with TaperMarking B", async () => {
		const result = await loadResult();
		const p7 = byId(result).get("P7");
		expect(p7?.kind).toBe("potentiometer");
		expect(p7?.properties.Resistance).toEqual({
			raw: "2k5",
			value: 2500,
			unit: "",
		});
		expect(p7?.properties.TaperMarking).toBe("B");
		expect(p7?.properties.Taper).toBeUndefined();
		expect(p7?.properties.DipTraceValueSource).toBe("Manufacturer");
	});

	test("A4M7 reads 4.7 MOhm", async () => {
		const result = await loadResult();
		const p8 = byId(result).get("P8");
		expect(p8?.properties.Resistance).toEqual({
			raw: "4M7",
			value: 4700000,
			unit: "",
		});
		expect(p8?.properties.TaperMarking).toBe("A");
	});

	test("malformed markings stay absent", async () => {
		const result = await loadResult();
		for (const id of ["P9", "P10", "P11", "P12"]) {
			const component = byId(result).get(id);
			expect(component?.kind).toBe("potentiometer");
			expect(component?.properties.Resistance).toBeUndefined();
			expect(
				result.diagnostics.some(
					(diagnostic) =>
						diagnostic.code === "pot-resistance-absent" &&
						diagnostic.componentId === id,
				),
			).toBe(true);
		}
	});
});

describe("diptrace pot values from the Datasheet field", () => {
	test("a pot with only a Datasheet value reads", async () => {
		const result = await loadResult();
		const p13 = byId(result).get("P13");
		expect(p13?.kind).toBe("potentiometer");
		expect(p13?.properties.Resistance).toEqual({
			raw: "100k",
			value: 100000,
			unit: "",
		});
		expect(p13?.properties.TaperMarking).toBe("B");
		expect(p13?.properties.DipTraceValueSource).toBe("Datasheet");
		expect(
			result.diagnostics.some(
				(diagnostic) =>
					diagnostic.code === "pot-value-from-datasheet-field" &&
					diagnostic.componentId === "P13",
			),
		).toBe(true);
	});

	test("a non-parsing Datasheet stays absent", async () => {
		const result = await loadResult();
		const p14 = byId(result).get("P14");
		expect(p14?.properties.Resistance).toBeUndefined();
		expect(
			result.diagnostics.some(
				(diagnostic) =>
					diagnostic.code === "pot-resistance-absent" &&
					diagnostic.componentId === "P14",
			),
		).toBe(true);
	});

	test("a Datasheet on a resistor is ignored", async () => {
		const result = await loadResult();
		const r2 = byId(result).get("R2");
		expect(r2?.kind).toBe("resistor");
		expect(r2?.properties.Resistance).toEqual({
			raw: "4k7",
			value: 4700,
			unit: "",
		});
		expect(r2?.properties.DipTraceValueSource).toBeUndefined();
	});

	test("Value versus Datasheet conflict stays absent", async () => {
		const result = await loadResult();
		const p15 = byId(result).get("P15");
		expect(p15?.properties.Resistance).toBeUndefined();
		expect(
			result.diagnostics.some(
				(diagnostic) =>
					diagnostic.code === "pot-value-conflict" &&
					diagnostic.componentId === "P15",
			),
		).toBe(true);
	});

	test("Manufacturer still wins its own path on agreement", async () => {
		const result = await loadResult();
		const p16 = byId(result).get("P16");
		expect(p16?.properties.Resistance).toEqual({
			raw: "100k",
			value: 100000,
			unit: "",
		});
		expect(p16?.properties.DipTraceValueSource).toBe("Manufacturer");
		expect(
			result.diagnostics.some(
				(diagnostic) =>
					diagnostic.code === "pot-value-from-manufacturer-field" &&
					diagnostic.componentId === "P16",
			),
		).toBe(true);
		expect(
			result.diagnostics.some(
				(diagnostic) =>
					diagnostic.code === "pot-value-from-datasheet-field" &&
					diagnostic.componentId === "P16",
			),
		).toBe(false);
	});
});

describe("diptrace pot taper from the declared convention", () => {
	async function loadWithConvention() {
		const model = parseDipTraceSchematic(await Bun.file(FIXTURE_URL).text());
		return convertDipTrace(model, { name: "taper", taperConvention: "alps" });
	}

	function byId(result: Awaited<ReturnType<typeof loadWithConvention>>) {
		return new Map(
			(result.document?.components ?? []).map((component) => [
				component.id,
				component,
			]),
		);
	}

	test("A/B/C markings declare log/linear/reverse-log", async () => {
		const result = await loadWithConvention();
		expect(result.refusal).toBeNull();
		const p1 = byId(result).get("P1");
		expect(p1?.properties.Taper).toBe("log");
		expect(p1?.properties.TaperMarking).toBe("A");
		expect(p1?.properties.DipTraceTaperSource).toBe("TaperMarking:alps");
		const p6 = byId(result).get("P6");
		expect(p6?.properties.Taper).toBe("linear");
		const p22 = byId(result).get("P22");
		expect(p22?.properties.Taper).toBe("reverse-log");
		for (const [id, letter, law] of [
			["P1", "A", "log"],
			["P6", "B", "linear"],
			["P22", "C", "reverse-log"],
		] as const) {
			expect(
				result.diagnostics.some(
					(diagnostic) =>
						diagnostic.code === "taper-from-declared-convention" &&
						diagnostic.componentId === id &&
						diagnostic.message.includes(`"${letter}"`) &&
						diagnostic.message.includes(law),
				),
			).toBe(true);
		}
	});

	test("unmapped letters, unmarked, starred and trimmers stay unset", async () => {
		const result = await loadWithConvention();
		for (const id of ["P23", "P24", "P25", "P26", "P2", "P5", "TR1"]) {
			const component = byId(result).get(id);
			expect(component?.properties.Taper).toBeUndefined();
			expect(component?.properties.DipTraceTaperSource).toBeUndefined();
			expect(
				result.diagnostics.some(
					(diagnostic) =>
						diagnostic.code === "taper-from-declared-convention" &&
						diagnostic.componentId === id,
				),
			).toBe(false);
		}
		// TR1 still reads its track value; only the law is withheld.
		expect(byId(result).get("TR1")?.properties.Resistance).toEqual({
			raw: "100k",
			value: 100000,
			unit: "",
		});
	});

	test("a resistor carrying an A marking takes no law", async () => {
		const result = await loadWithConvention();
		const r3 = byId(result).get("R3");
		expect(r3?.kind).toBe("resistor");
		expect(r3?.properties.Taper).toBeUndefined();
	});

	test("both gangs of a dual-gang part take the marking", async () => {
		const result = await loadWithConvention();
		const ids = (result.document?.components ?? [])
			.filter((component) => component.id.startsWith("P29"))
			.map((component) => component.id)
			.sort();
		expect(ids.length).toBe(2);
		for (const id of ids) {
			const component = byId(result).get(id);
			expect(component?.properties.Taper).toBe("linear");
			expect(component?.properties.TaperMarking).toBe("B");
		}
	});

	test("option unset leaves every Taper absent", async () => {
		const result = await loadResult();
		for (const component of result.document?.components ?? []) {
			expect(component.properties.Taper).toBeUndefined();
			expect(component.properties.DipTraceTaperSource).toBeUndefined();
		}
		expect(
			result.diagnostics.some((diagnostic) =>
				["taper-from-declared-convention", "taper-convention-declared"].includes(
					diagnostic.code,
				),
			),
		).toBe(false);
		expect(result.document?.source?.taperConvention).toBeUndefined();
	});

	test("the declared convention is recorded in the document", async () => {
		const result = await loadWithConvention();
		expect(result.document?.source?.taperConvention).toBe("alps");
		expect(
			result.diagnostics.some(
				(diagnostic) => diagnostic.code === "taper-convention-declared",
			),
		).toBe(true);
	});
});
