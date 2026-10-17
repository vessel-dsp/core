// A diode's declared `EmissionCoefficient` as a typed fact: how a packet states it, how it is refused when it is not
// one, where it wins against a catalog entry, and that a document which declares nothing is unchanged.
// No corpus packet is asserted for membership: the circuits are the compiler's own fixtures, the parts fictional
// (`FIXTURE-DIODE-*`), so the contract is tested against a registry the test owns.

import { describe, expect, it } from "bun:test";
import { compile } from "../src/compile";
import { diodeClipper, zenerCatalogDiode } from "../src/fixtures";
import {
	EMISSION_COEFFICIENT_MAX,
	EMISSION_COEFFICIENT_MIN,
	typedEmissionCoefficient,
} from "../src/netlist";
import { emptyRegistry } from "../src/registry";
import type { PartRegistry } from "../src/registry";
import { pedalPartCatalog } from "../src/part-catalog";
import type { Program, Stamp } from "../src/types";

type Component = Parameters<typeof typedEmissionCoefficient>[0];
const component = (value: unknown): Component =>
	({
		id: "D4",
		properties: value === undefined ? {} : { EmissionCoefficient: value },
	}) as unknown as Component;

describe("typedEmissionCoefficient reads a declared ideality factor, whole", () => {
	const accepted: ReadonlyArray<
		readonly [label: string, value: unknown, n: number]
	> = [
		["bare number", 1.9, 1.9],
		["bare integer", 2, 2],
		["numeric string", "1.9", 1.9],
		["numeric string with one quote pair kept", "'1.9'", 1.9],
		["numeric string, exponent", "1.9e0", 1.9],
		["numeric string, leading dot", ".5e1", 5],
		[
			"structured, empty unit (the form the corpus writes)",
			{ raw: "1.9", value: 1.9, unit: "" },
			1.9,
		],
		[
			"structured, quoted empty unit",
			{ raw: "1.9", value: 1.9, unit: "''" },
			1.9,
		],
		["structured, no unit at all", { value: 1.9 }, 1.9],
		["the lower bound", EMISSION_COEFFICIENT_MIN, EMISSION_COEFFICIENT_MIN],
		["the upper bound", EMISSION_COEFFICIENT_MAX, EMISSION_COEFFICIENT_MAX],
	];
	for (const [label, value, n] of accepted) {
		it(`reads ${label} as ${n}`, () => {
			expect(typedEmissionCoefficient(component(value))).toBe(n);
		});
	}

	it("reads the structured value over `raw`, because the value already carries the conversion", () => {
		expect(
			typedEmissionCoefficient(component({ raw: "1.9", value: 2.1, unit: "" })),
		).toBe(2.1);
	});

	it("is null for a component that states none, and for an empty string", () => {
		expect(typedEmissionCoefficient(component(undefined))).toBeNull();
		expect(typedEmissionCoefficient(component(null))).toBeNull();
		expect(typedEmissionCoefficient(component(""))).toBeNull();
	});

	const refused: ReadonlyArray<readonly [label: string, value: unknown]> = [
		["text", "abc"],
		["a number with a trailing note", "1.9 typ"],
		["a number with a unit letter", "1.9n"],
		["a unit-bearing string", "1.9 V"],
		["zero", 0],
		["a negative number", -1.9],
		["just under the lower bound", EMISSION_COEFFICIENT_MIN - 0.001],
		["just over the upper bound", EMISSION_COEFFICIENT_MAX + 0.001],
		["a hundred, which is not a junction", 100],
		["a non-finite number", Number.POSITIVE_INFINITY],
		["not-a-number", Number.NaN],
		["a structured quantity in volts", { raw: "1.9 V", value: 1.9, unit: "V" }],
		[
			"a structured quantity with a text value",
			{ raw: "x", value: "x", unit: "" },
		],
		["a structured quantity with no value", { raw: "1.9" }],
		[
			"an out-of-range structured quantity",
			{ raw: "0.5", value: 0.5, unit: "" },
		],
		["an array", [1.9]],
		["a boolean", true],
	];
	for (const [label, value] of refused) {
		it(`refuses ${label}`, () => {
			expect(() => typedEmissionCoefficient(component(value))).toThrow(
				/D4: EmissionCoefficient/,
			);
		});
	}

	it("names the component and the offending value, and clamps nothing", () => {
		expect(() => typedEmissionCoefficient(component("1.9 typ"))).toThrow(
			/D4: EmissionCoefficient "1\.9 typ"/,
		);
		expect(() => typedEmissionCoefficient(component(11))).toThrow(
			/D4: EmissionCoefficient 11/,
		);
		expect(() => typedEmissionCoefficient(component(0.5))).toThrow(
			/D4: EmissionCoefficient 0\.5/,
		);
	});
});

const FIXTURE_N = 1.3;
const registry: PartRegistry = {
	entries: [
		{
			// A catalogued diode: every parameter is the part's own, including its ideality.
			partIds: ["FIXTURE-DIODE-N"],
			declaredTypes: [],
			terminalRoleGroups: [],
			model: {
				kind: "law",
				law: {
					kind: "diode",
					saturationCurrent: 1e-9,
					emissionCoefficient: FIXTURE_N,
					thermalVoltage: 0.025852,
					breakdownVolts: 0,
					seriesResistance: 2,
				},
			},
		},
	],
};

function diodeStamps(
	program: Program,
): Array<Extract<Stamp, { kind: "diode" }>> {
	return program.blocks.flatMap((block) =>
		block.kind === "mna"
			? block.stamps.filter(
					(s): s is Extract<Stamp, { kind: "diode" }> => s.kind === "diode",
				)
			: [],
	);
}
const build = (source: string, reg: PartRegistry = emptyRegistry) => {
	const result = compile(source, { registry: reg });
	if (result.status !== "ok")
		throw new Error(`fixture did not compile: ${result.status}`);
	return result;
};
/** The first diode (D1) carries the declaration; the second (D2) never does. */
const declareOnD1 = (source: string, declaration: string) => {
	const anchor = '      Description: "Clipping diode."\n  - id: D2';
	if (!source.includes(anchor)) throw new Error("fixture anchor moved");
	return source.replace(anchor, `      ${declaration}\n${anchor}`);
};
const withPart = (source: string, part: string) =>
	declareOnD1(source, `PartNumber: ${part}`);
const byDevice = (program: Program) =>
	new Map(diodeStamps(program).map((s) => [s.device, s]));

describe("a declared EmissionCoefficient reaches the diode stamp", () => {
	it("stamps the declared value for the declaring diode and the class default for the other", () => {
		for (const declaration of [
			"EmissionCoefficient: 1.9",
			'EmissionCoefficient: "1.9"',
			"EmissionCoefficient:\n        raw: '1.9'\n        value: 1.9\n        unit: ''",
		]) {
			const stamps = byDevice(
				build(declareOnD1(diodeClipper, declaration)).program,
			);
			expect(stamps.get("D1")?.emissionCoefficient).toBe(1.9);
			expect(stamps.get("D2")?.emissionCoefficient).toBe(1.752);
		}
	});

	it("moves nothing but the emission coefficient of the declaring diode", () => {
		const before = diodeStamps(build(diodeClipper).program).find(
			(s) => s.device === "D1",
		);
		const after = diodeStamps(
			build(declareOnD1(diodeClipper, "EmissionCoefficient: 1.9")).program,
		).find((s) => s.device === "D1");
		expect({ ...after, emissionCoefficient: 0 }).toEqual({
			...before,
			emissionCoefficient: 0,
		});
		expect(before?.emissionCoefficient).toBe(1.752);
	});

	it("declares alongside a typed saturation current without either overruling the other", () => {
		const stamp = byDevice(
			build(
				declareOnD1(
					diodeClipper,
					"EmissionCoefficient: 2.1\n      SaturationCurrent:\n        raw: 4e-9 A\n        value: 4e-9\n        unit: A",
				),
			).program,
		).get("D1");
		expect(stamp?.emissionCoefficient).toBe(2.1);
		expect(stamp?.saturationCurrent).toBe(4e-9);
	});

	it("refuses an unreadable declaration by naming the diode, rather than ignoring it", () => {
		for (const declaration of [
			'EmissionCoefficient: "abc"',
			"EmissionCoefficient: 0",
			"EmissionCoefficient: -1.9",
			"EmissionCoefficient: 10.5",
		]) {
			const result = compile(declareOnD1(diodeClipper, declaration), {
				registry: emptyRegistry,
			});
			expect(result.status).not.toBe("ok");
			expect(JSON.stringify(result)).toContain("EmissionCoefficient");
			expect(JSON.stringify(result)).toContain("D1");
		}
	});
});

describe("a declared coefficient wins over a catalog entry, like every other declared diode parameter", () => {
	it("takes the catalog's own coefficient when the packet states none", () => {
		const stamps = byDevice(
			build(withPart(diodeClipper, "FIXTURE-DIODE-N"), registry).program,
		);
		expect(stamps.get("D1")?.emissionCoefficient).toBe(FIXTURE_N);
		expect(stamps.get("D1")?.seriesResistance).toBe(2);
	});

	it("takes the packet's coefficient and keeps the rest of the catalog's law", () => {
		const source = declareOnD1(
			withPart(diodeClipper, "FIXTURE-DIODE-N"),
			"EmissionCoefficient: 1.9",
		);
		const stamp = byDevice(build(source, registry).program).get("D1");
		expect(stamp?.emissionCoefficient).toBe(1.9);
		expect(stamp?.saturationCurrent).toBe(1e-9);
		expect(stamp?.seriesResistance).toBe(2);
	});

	it("applies to a catalogued zener too, and leaves its breakdown knee alone", () => {
		const before = byDevice(
			build(zenerCatalogDiode, pedalPartCatalog).program,
		).get("D1");
		const after = byDevice(
			build(
				declareOnD1(zenerCatalogDiode, "EmissionCoefficient: 1.9"),
				pedalPartCatalog,
			).program,
		).get("D1");
		expect(after?.emissionCoefficient).toBe(1.9);
		expect(after?.breakdownVolts).toBe(before?.breakdownVolts);
		expect(before?.emissionCoefficient).toBe(1.752);
	});
});

describe("a document that declares nothing compiles to the same program", () => {
	it("is byte-identical with and without the reader's other declared diode properties present", () => {
		// The undeclared fixtures, compiled against an empty registry and against the shipping catalog, hold the
		// class default; a declaration is the only thing that may move a stamp.
		for (const source of [diodeClipper, zenerCatalogDiode]) {
			for (const reg of [emptyRegistry, pedalPartCatalog]) {
				for (const stamp of diodeStamps(build(source, reg).program)) {
					expect(stamp.emissionCoefficient).toBe(1.752);
				}
			}
		}
	});
});
