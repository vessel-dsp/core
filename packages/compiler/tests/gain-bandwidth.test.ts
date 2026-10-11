// The op-amp gain-bandwidth product as a declared, typed fact: how a packet states it, how a part's datasheet
// states it, how it reaches the stamp, and how its absence is named. No corpus packet and no shipping catalog
// row is asserted for membership -- the parts here are fictional (`FIXTURE-GBW-*`), so the contract is tested
// against a registry the test owns.

import { describe, expect, it } from "bun:test";
import { nonInvertingStage } from "../../runtime/tests/non-inverting-stage";
import { compile } from "../src/compile";
import { typedFrequencyHz } from "../src/netlist";
import { opampGainBandwidthAbsent, opampGainBandwidthDatasheet, pedalPartCatalog } from "../src/part-catalog";
import { emptyRegistry, registryOpampGainBandwidth } from "../src/registry";
import type { PartRegistry } from "../src/registry";
import type { Program, Stamp } from "../src/types";

type Component = Parameters<typeof typedFrequencyHz>[0];
const component = (value: unknown, key = "GBP"): Component =>
	({ id: "U1", properties: value === undefined ? {} : { [key]: value } }) as unknown as Component;

describe("typedFrequencyHz reads a declared frequency with its unit, whole", () => {
	// Every form the corpus states a GBP in (14 x "7 MHz", 6 x "3 MHz", 14 x "3000000", 12 x "1000000",
	// 4 x "1.2 MHz", 2 x "1 MHz", 2 x "15000000", 1 x "600000"), plus the typed forms the format allows.
	const accepted: ReadonlyArray<readonly [label: string, value: unknown, hertz: number]> = [
		["bare number", 3000000, 3e6],
		["bare float", 1.2e6, 1.2e6],
		["numeric string", "3000000", 3e6],
		["numeric string, one apostrophe pair kept", "'3000000'", 3e6],
		["numeric string, large", "15000000", 15e6],
		["numeric string, small", "600000", 6e5],
		["integer MHz", "3 MHz", 3e6],
		["integer MHz, another", "7 MHz", 7e6],
		["integer MHz, one", "1 MHz", 1e6],
		["fractional MHz", "1.2 MHz", 1.2e6],
		["no space before the unit", "3MHz", 3e6],
		["kHz", "300 kHz", 3e5],
		["capital K kHz", "300 KHz", 3e5],
		["GHz", "0.003 GHz", 3e6],
		["Hz stated", "3000000 Hz", 3e6],
		["exponent", "3e6", 3e6],
		["exponent with unit", "3e6 Hz", 3e6],
		["structured, base unit", { raw: "3 MHz", value: 3000000, unit: "Hz" }, 3e6],
		["structured, empty unit", { raw: "3000000", value: 3000000, unit: "" }, 3e6],
		["structured, quoted empty unit", { raw: "3000000", value: 3000000, unit: "''" }, 3e6],
		["structured, prefixed unit", { raw: "3 MHz", value: 3, unit: "MHz" }, 3e6],
	];
	for (const [label, value, hertz] of accepted) {
		it(`reads ${label} as ${hertz} Hz`, () => {
			expect(typedFrequencyHz(component(value), "GBP")).toBe(hertz);
		});
	}

	it("reads 'raw' last: a structured value wins, because it already carries the conversion", () => {
		// `raw` says 3 MHz; `value` says 4 MHz. The typed value is the quantity.
		expect(typedFrequencyHz(component({ raw: "3 MHz", value: 4e6, unit: "Hz" }), "GBP")).toBe(4e6);
	});

	it("is null for a component that states none, and for an empty string", () => {
		expect(typedFrequencyHz(component(undefined), "GBP")).toBeNull();
		expect(typedFrequencyHz(component(null), "GBP")).toBeNull();
		expect(typedFrequencyHz(component(""), "GBP")).toBeNull();
	});

	// The trap is a unit-bearing string whose number is read by stripping at a delimiter: right number,
	// wrong reason. A frequency property holding anything that is not a number with a frequency unit is
	// refused by name, never read as a number and never silently dropped.
	const refused: ReadonlyArray<readonly [label: string, value: unknown]> = [
		["a slew rate, whose number a strip-after-delimiter parse would return as 1.2", "1.2 V/us"],
		["a sentence with a trailing note", "3 MHz typ"],
		["SPICE shorthand with no frequency unit", "3M"],
		["milli-hertz, which is a frequency but never a gain-bandwidth product", "3 mHz"],
		["a unit that is not a frequency", "3 MV"],
		["text", "fast"],
		["zero", "0"],
		["a negative frequency", "-1 MHz"],
		["a non-finite number", Number.POSITIVE_INFINITY],
		["a structured quantity with a text value", { raw: "x", value: "x", unit: "Hz" }],
		["a structured quantity in volts", { raw: "3 V", value: 3, unit: "V" }],
		["a structured zero", { raw: "0", value: 0, unit: "Hz" }],
		["an array", [3e6]],
		["a boolean", true],
	];
	for (const [label, value] of refused) {
		it(`refuses ${label}`, () => {
			expect(() => typedFrequencyHz(component(value), "GBP")).toThrow(/GBP/);
		});
	}

	it("names the component and the offending value in the refusal", () => {
		expect(() => typedFrequencyHz(component("1.2 V/us"), "GBP")).toThrow(/U1: GBP "1\.2 V\/us"/);
	});
});

const FIXTURE_GBW = 4.4e6;
/** A part the test owns: one section, a datasheet product, and no rails (the pedal owns those). */
const registry: PartRegistry = {
	entries: [
		{
			partIds: ["FIXTURE-GBW-A", "fixture gbw a alias"],
			declaredTypes: [],
			terminalRoleGroups: [],
			model: {
				kind: "sections",
				pinout: [null, null, null],
				sections: [
					{
						law: {
							kind: "ideal-opamp",
							railHigh: null,
							railLow: null,
							openLoopGain: 100000,
							gainBandwidthHz: FIXTURE_GBW,
						},
						terminals: [0, 1, 2],
					},
				],
			},
		},
		{
			// A part whose entry states no product: the datasheet does not print one.
			partIds: ["FIXTURE-GBW-NONE"],
			declaredTypes: [],
			terminalRoleGroups: [],
			model: {
				kind: "sections",
				pinout: [null, null, null],
				sections: [
					{
						law: { kind: "ideal-opamp", railHigh: null, railLow: null, openLoopGain: 100000 },
						terminals: [0, 1, 2],
					},
				],
			},
		},
	],
};

function opampStamps(program: Program): Array<Extract<Stamp, { kind: "ideal-opamp" }>> {
	return program.blocks.flatMap((block) =>
		block.kind === "mna"
			? block.stamps.filter((s): s is Extract<Stamp, { kind: "ideal-opamp" }> => s.kind === "ideal-opamp")
			: [],
	);
}
function build(options: Parameters<typeof nonInvertingStage>[0], reg: PartRegistry = registry) {
	const result = compile(nonInvertingStage(options), { registry: reg });
	if (result.status !== "ok") throw new Error(`stage did not compile: ${result.status}`);
	return result;
}
const stage = { rfOhms: 9000, rgOhms: 1000 };

describe("the gain-bandwidth product reaches the stamp", () => {
	it("carries a packet-declared typed GBP, in every form, to the op-amp stamp", () => {
		for (const [text, hertz] of [
			["3 MHz", 3e6],
			["1.2 MHz", 1.2e6],
			["15000000", 15e6],
			[600000, 6e5],
		] as const) {
			const stamps = opampStamps(build({ ...stage, gbp: text }).program);
			expect(stamps).toHaveLength(1);
			expect(stamps[0]?.gainBandwidthHz).toBe(hertz);
		}
	});

	it("stamps a declared GBP of exactly 1 MHz as 1e6, not as null: the default is a different statement", () => {
		expect(opampStamps(build({ ...stage, gbp: "1 MHz" }).program)[0]?.gainBandwidthHz).toBe(1e6);
	});

	it("takes the datasheet figure of the exact part id when the packet states none", () => {
		const result = build({ ...stage, partNumber: "FIXTURE-GBW-A" });
		expect(opampStamps(result.program)[0]?.gainBandwidthHz).toBe(FIXTURE_GBW);
		expect(result.warnings.some((w) => w.code === "opamp-gain-bandwidth-default")).toBe(false);
	});

	it("matches the part id whole and case-folded, with no prefix, suffix or substring rule", () => {
		for (const [part, expected] of [
			["fixture-gbw-a", FIXTURE_GBW],
			["FIXTURE_GBW_A", FIXTURE_GBW],
			["FIXTURE-GBW-A2", null],
			["FIXTURE-GBW-", null],
			["XFIXTURE-GBW-A", null],
			["FIXTURE-GBW-AB", null],
		] as const) {
			expect(registryOpampGainBandwidth(registry, part)).toBe(expected);
			expect(opampStamps(build({ ...stage, partNumber: part }).program)[0]?.gainBandwidthHz ?? null).toBe(
				expected,
			);
		}
	});

	it("lets the packet's own typed GBP win over the datasheet figure", () => {
		const stamps = opampStamps(build({ ...stage, partNumber: "FIXTURE-GBW-A", gbp: "1 MHz" }).program);
		expect(stamps[0]?.gainBandwidthHz).toBe(1e6);
	});

	it("is null, typed, when neither the packet nor the part states one", () => {
		for (const options of [
			stage, // no part number at all
			{ ...stage, partNumber: "NOT-IN-ANY-REGISTRY" },
			{ ...stage, partNumber: "FIXTURE-GBW-NONE" }, // the part is known and its entry states no product
		]) {
			const result = build(options);
			expect(opampStamps(result.program)[0]?.gainBandwidthHz).toBeNull();
		}
		expect(registryOpampGainBandwidth(registry, "FIXTURE-GBW-NONE")).toBeNull();
		expect(registryOpampGainBandwidth(registry, null)).toBeNull();
		expect(registryOpampGainBandwidth(emptyRegistry, "FIXTURE-GBW-A")).toBeNull();
	});

	it("emits the field in the serialized program, null included", () => {
		const declared = JSON.stringify(build({ ...stage, gbp: "3 MHz" }).program);
		expect(declared).toContain('"gainBandwidthHz":3000000');
		const bare = JSON.stringify(build(stage).program);
		expect(bare).toContain('"gainBandwidthHz":null');
	});

	it("refuses a declared GBP that is not a frequency, by name, rather than ignoring it", () => {
		const result = compile(nonInvertingStage({ ...stage, gbp: "1.2 V/us" }), { registry });
		expect(result.status).not.toBe("ok");
		expect(JSON.stringify(result)).toContain("GBP");
	});
});

describe("a registry section carries its part's datasheet product onto every section it expands to", () => {
	// An `ic` package matched by exact part id expands into one `<device>#<index>` op-amp per section;
	// a declared `opamp` never does, so this is the other door through which the product reaches a stamp.
	const asPackage = (partNumber: string) =>
		nonInvertingStage({ ...stage, partNumber }).replace("kind: opamp", "kind: ic");

	it("stamps the entry's product on the expanded section", () => {
		const result = compile(asPackage("FIXTURE-GBW-A"), { registry });
		if (result.status !== "ok") throw new Error(`package did not compile: ${result.status}`);
		const stamps = opampStamps(result.program);
		expect(stamps).toHaveLength(1);
		expect(stamps[0]?.gainBandwidthHz).toBe(FIXTURE_GBW);
		expect(result.warnings.some((w) => w.code === "opamp-gain-bandwidth-default")).toBe(false);
	});

	it("stamps null on a section whose entry states none, and names the package once", () => {
		const result = compile(asPackage("FIXTURE-GBW-NONE"), { registry });
		if (result.status !== "ok") throw new Error(`package did not compile: ${result.status}`);
		expect(opampStamps(result.program)[0]?.gainBandwidthHz).toBeNull();
		const warnings = result.warnings.filter((w) => w.code === "opamp-gain-bandwidth-default");
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.code === "opamp-gain-bandwidth-default" && warnings[0].devices).toEqual(["U1"]);
	});
});

describe("opamp-gain-bandwidth-default names the sections that run on the class default", () => {
	const named = (program: ReturnType<typeof build>) =>
		program.warnings.filter((w) => w.code === "opamp-gain-bandwidth-default");

	it("counts and names a railed section that no source states a product for", () => {
		const warnings = named(build(stage));
		expect(warnings).toHaveLength(1);
		const warning = warnings[0];
		expect(warning?.code === "opamp-gain-bandwidth-default" && warning.sections).toBe(1);
		expect(warning?.code === "opamp-gain-bandwidth-default" && warning.devices).toEqual(["U1"]);
		expect(warning?.detail).toContain("U1");
	});

	it("is silent when the packet states a product, and when the part's datasheet does", () => {
		expect(named(build({ ...stage, gbp: "3 MHz" }))).toHaveLength(0);
		expect(named(build({ ...stage, partNumber: "FIXTURE-GBW-A" }))).toHaveLength(0);
	});

	it("names a known part whose entry states no product, with its part number", () => {
		const warnings = named(build({ ...stage, partNumber: "FIXTURE-GBW-NONE" }));
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.detail).toContain("FIXTURE-GBW-NONE");
	});
});

describe("the shipping catalog's gain-bandwidth table is applied exactly", () => {
	// Structural, not a membership snapshot: it holds for whatever rows the table carries.
	it("answers every datasheet row's ids with that row's figure, by exact id", () => {
		for (const row of opampGainBandwidthDatasheet) {
			expect(Number.isFinite(row.hertz) && row.hertz > 0).toBe(true);
			expect(row.source.length).toBeGreaterThan(40);
			for (const id of row.partIds) {
				expect(registryOpampGainBandwidth(pedalPartCatalog, id)).toBe(row.hertz);
			}
		}
	});

	it("answers null for every id listed absent, each with a stated reason", () => {
		for (const { partIds, reason } of opampGainBandwidthAbsent) {
			expect(reason.length).toBeGreaterThan(20);
			for (const id of partIds) {
				expect(registryOpampGainBandwidth(pedalPartCatalog, id)).toBeNull();
			}
		}
	});

	it("gives a sibling nothing: an id no row names has no figure, whatever it resembles", () => {
		for (const row of opampGainBandwidthDatasheet) {
			for (const id of row.partIds) {
				expect(registryOpampGainBandwidth(pedalPartCatalog, `${id}X`)).toBeNull();
				expect(registryOpampGainBandwidth(pedalPartCatalog, `X${id}`)).toBeNull();
			}
		}
	});

	it("never lists an id both given a figure and absent", () => {
		const given = new Set(opampGainBandwidthDatasheet.flatMap((row) => row.partIds.map((id) => id.toLowerCase())));
		for (const { partIds } of opampGainBandwidthAbsent) {
			for (const id of partIds) expect(given.has(id.toLowerCase())).toBe(false);
		}
	});
});
