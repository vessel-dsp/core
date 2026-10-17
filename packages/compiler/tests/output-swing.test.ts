// The op-amp output swing as a printed, conditioned, per-side fact: how a part's datasheet pair is stated, how it
// is carried to the pedal's supply, how it reaches the stamp, and how a pair carried across a supply is named.
// No corpus packet and no shipping catalog row is asserted for membership -- the parts here are fictional
// (`FIXTURE-SWING-*`), so the contract is tested against a registry the test owns. The shipping table is only
// checked structurally, for whatever rows it carries.

import { describe, expect, it } from "bun:test";
import { nonInvertingStage } from "../../runtime/tests/non-inverting-stage";
import { compile } from "../src/compile";
import {
	opampOutputSwingAbsent,
	opampOutputSwingDatasheet,
	pedalPartCatalog,
	withDatasheetOutputSwing,
	type OpampOutputSwingRow,
} from "../src/part-catalog";
import {
	emptyRegistry,
	opampOutputSwingOf,
	registryOpampSwing,
} from "../src/registry";
import type { PartEntry, PartRegistry } from "../src/registry";
import type {
	DeviceLaw,
	OpampLawDefaultItem,
	Program,
	Stamp,
} from "../src/types";

type OpampLaw = Extract<DeviceLaw, { kind: "ideal-opamp" }>;

/** The stage's rails: `nonInvertingStage` declares +-9 V, so its supply span is 18 V. */
const RAIL = 9;
const SPAN = 18;

const printed = (
	supplyVolts: number,
	translation: "constant" | "proportional",
	loadOhms = 10_000,
) => ({
	supplyVolts,
	loadOhms,
	translation,
});

/** One section, three terminals, no rails: the shape the catalog's op-amp entries have. */
const opampEntry = (
	partIds: readonly string[],
	law: Partial<OpampLaw> = {},
): PartEntry => ({
	partIds,
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
					...law,
				},
				terminals: [0, 1, 2],
			},
		],
	},
});

const registry: PartRegistry = {
	entries: [
		// Asymmetric, constant: the pair an LM358-like part would print (a swing to ground).
		opampEntry(["FIXTURE-SWING-ASYM"], {
			outputSwingDropHighVolts: 1.5,
			outputSwingDropLowVolts: 0.02,
			outputSwingPrinted: printed(30, "constant"),
		}),
		// Proportional: printed at 30 V total, carried to the stage's 18 V by 18 / 30.
		opampEntry(["FIXTURE-SWING-PROP", "fixture swing prop alias"], {
			outputSwingDropHighVolts: 2.0,
			outputSwingDropLowVolts: 3.0,
			outputSwingPrinted: printed(30, "proportional", 2000),
		}),
		// Printed at exactly the stage's own supply: nothing is carried across a supply.
		opampEntry(["FIXTURE-SWING-AT-SUPPLY"], {
			outputSwingDropHighVolts: 1.2,
			outputSwingDropLowVolts: 0.8,
			outputSwingPrinted: printed(SPAN, "constant"),
		}),
		// A pair so wide it would close the output interval at +-9 V.
		opampEntry(["FIXTURE-SWING-CLOSING"], {
			outputSwingDropHighVolts: 9.5,
			outputSwingDropLowVolts: 9.5,
			outputSwingPrinted: printed(SPAN, "constant"),
		}),
		// A part whose entry states no swing: its datasheet prints none.
		opampEntry(["FIXTURE-SWING-NONE"]),
		// Table errors a registry that did not come through the loader can still carry.
		opampEntry(["FIXTURE-SWING-HALF"], {
			outputSwingDropHighVolts: 1.5,
			outputSwingPrinted: printed(30, "constant"),
		}),
		opampEntry(["FIXTURE-SWING-NO-CONDITION"], {
			outputSwingDropHighVolts: 1.5,
			outputSwingDropLowVolts: 1.5,
		}),
		opampEntry(["FIXTURE-SWING-CONDITION-ONLY"], {
			outputSwingPrinted: printed(30, "constant"),
		}),
	],
};

function opampStamps(
	program: Program,
): Array<Extract<Stamp, { kind: "ideal-opamp" }>> {
	return program.blocks.flatMap((block) =>
		block.kind === "mna"
			? block.stamps.filter(
					(s): s is Extract<Stamp, { kind: "ideal-opamp" }> =>
						s.kind === "ideal-opamp",
				)
			: [],
	);
}
const stage = { rfOhms: 9000, rgOhms: 1000 };
/** A declared `opamp` is one door to the registry; an `ic` package that expands into sections is the other. */
const asPackage = (partNumber: string) =>
	nonInvertingStage({ ...stage, partNumber }).replace(
		"kind: opamp",
		"kind: ic",
	);
const doors: ReadonlyArray<
	readonly [label: string, source: (part: string) => string]
> = [
	[
		"a declared opamp",
		(part) => nonInvertingStage({ ...stage, partNumber: part }),
	],
	["a package section", asPackage],
];

function build(source: string, reg: PartRegistry = registry) {
	const result = compile(source, { registry: reg });
	if (result.status !== "ok")
		throw new Error(`stage did not compile: ${result.status}`);
	return result;
}
function railsOf(
	source: string,
	reg: PartRegistry = registry,
): readonly [low: number | null, high: number | null] {
	const stamps = opampStamps(build(source, reg).program);
	expect(stamps).toHaveLength(1);
	return [stamps[0]?.railLow ?? null, stamps[0]?.railHigh ?? null];
}
function itemsOf(
	source: string,
	reg: PartRegistry = registry,
): readonly OpampLawDefaultItem[] {
	const warnings = build(source, reg).warnings.filter(
		(w) => w.code === "opamp-law-default-parameters",
	);
	expect(warnings.length).toBeLessThanOrEqual(1);
	const warning = warnings[0];
	return warning?.code === "opamp-law-default-parameters" ? warning.items : [];
}

describe("the printed pair reaches the stamp, a side at a time", () => {
	for (const [door, source] of doors) {
		it(`pulls each rail in by its own printed side, constant, through ${door}`, () => {
			const [low, high] = railsOf(source("FIXTURE-SWING-ASYM"));
			expect(high).toBeCloseTo(RAIL - 1.5, 9);
			expect(low).toBeCloseTo(-RAIL + 0.02, 9);
		});

		it(`carries a proportional pair by the supply span over the printed supply, through ${door}`, () => {
			const [low, high] = railsOf(source("FIXTURE-SWING-PROP"));
			const scale = SPAN / 30;
			expect(high).toBeCloseTo(RAIL - 2.0 * scale, 9);
			expect(low).toBeCloseTo(-RAIL + 3.0 * scale, 9);
		});

		it(`applies a pair printed at the stage's own supply exactly, through ${door}`, () => {
			const [low, high] = railsOf(source("FIXTURE-SWING-AT-SUPPLY"));
			expect(high).toBeCloseTo(RAIL - 1.2, 9);
			expect(low).toBeCloseTo(-RAIL + 0.8, 9);
		});

		it(`leaves the rails alone for a part that states no pair, or one that would close the interval, through ${door}`, () => {
			// A package whose part no registry names has no law at all (it is refused), so only the declared
			// opamp door is asked about an unknown id.
			const parts = [
				"FIXTURE-SWING-NONE",
				"FIXTURE-SWING-CLOSING",
				...(door === "a declared opamp" ? ["NOT-IN-ANY-REGISTRY"] : []),
			];
			for (const part of parts) {
				const [low, high] = railsOf(source(part));
				expect(high).toBe(RAIL);
				expect(low).toBe(-RAIL);
			}
		});
	}

	it("matches the part id whole and case-folded, with no prefix, suffix or substring rule", () => {
		expect(registryOpampSwing(registry, "fixture-swing-asym")?.highVolts).toBe(
			1.5,
		);
		expect(registryOpampSwing(registry, "FIXTURE_SWING_ASYM")?.lowVolts).toBe(
			0.02,
		);
		for (const part of [
			"FIXTURE-SWING-ASYM2",
			"FIXTURE-SWING-",
			"XFIXTURE-SWING-ASYM",
			"FIXTURE-SWING-ASYM-B",
		]) {
			expect(registryOpampSwing(registry, part)).toBeNull();
		}
		expect(registryOpampSwing(registry, null)).toBeNull();
		expect(registryOpampSwing(emptyRegistry, "FIXTURE-SWING-ASYM")).toBeNull();
	});

	it("does not write a swing field into the stamp: only the rails leave the compiler", () => {
		const stamp = opampStamps(
			build(nonInvertingStage({ ...stage, partNumber: "FIXTURE-SWING-ASYM" }))
				.program,
		)[0];
		expect(
			Object.keys(stamp ?? {}).filter((key) =>
				key.toLowerCase().includes("swing"),
			),
		).toEqual([]);
	});
});

describe("a half-stated pair is a table error, not a default", () => {
	const law = (partial: Partial<OpampLaw>): OpampLaw => ({
		kind: "ideal-opamp",
		railHigh: null,
		railLow: null,
		openLoopGain: 1e5,
		...partial,
	});

	it("reads neither side, or both with their condition, and nothing between", () => {
		expect(opampOutputSwingOf(law({}), "X")).toBeNull();
		const both = opampOutputSwingOf(
			law({
				outputSwingDropHighVolts: 1,
				outputSwingDropLowVolts: 2,
				outputSwingPrinted: printed(30, "constant"),
			}),
			"X",
		);
		expect(both).toEqual({
			highVolts: 1,
			lowVolts: 2,
			printed: printed(30, "constant"),
		});
	});

	it("throws, naming the part, on one side only, a pair with no condition, or a condition with no pair", () => {
		expect(() =>
			opampOutputSwingOf(law({ outputSwingDropHighVolts: 1 }), "PART-A"),
		).toThrow(/PART-A/);
		expect(() =>
			opampOutputSwingOf(law({ outputSwingDropLowVolts: 1 }), "PART-A"),
		).toThrow(/PART-A/);
		expect(() =>
			opampOutputSwingOf(
				law({ outputSwingPrinted: printed(30, "constant") }),
				"PART-A",
			),
		).toThrow(/PART-A/);
		expect(() =>
			opampOutputSwingOf(
				law({ outputSwingDropHighVolts: 1, outputSwingDropLowVolts: 1 }),
				"PART-A",
			),
		).toThrow(/PART-A/);
	});

	it("throws on a non-positive or non-finite figure and on a translation that is not one of the two words", () => {
		const base = { outputSwingDropHighVolts: 1, outputSwingDropLowVolts: 1 };
		for (const bad of [
			{
				...base,
				outputSwingDropHighVolts: 0,
				outputSwingPrinted: printed(30, "constant"),
			},
			{
				...base,
				outputSwingDropLowVolts: -0.1,
				outputSwingPrinted: printed(30, "constant"),
			},
			{
				...base,
				outputSwingDropHighVolts: Number.NaN,
				outputSwingPrinted: printed(30, "constant"),
			},
			{ ...base, outputSwingPrinted: printed(0, "constant") },
			{
				...base,
				outputSwingPrinted: printed(30, "constant", Number.POSITIVE_INFINITY),
			},
			{ ...base, outputSwingPrinted: printed(30, "Proportional" as never) },
			{ ...base, outputSwingPrinted: printed(30, "prop" as never) },
		]) {
			expect(() => opampOutputSwingOf(law(bad), "PART-B")).toThrow(/PART-B/);
		}
	});

	it("throws from the registry reader and from the compile, never skipping the part", () => {
		for (const part of [
			"FIXTURE-SWING-HALF",
			"FIXTURE-SWING-NO-CONDITION",
			"FIXTURE-SWING-CONDITION-ONLY",
		]) {
			expect(() => registryOpampSwing(registry, part)).toThrow(part);
			expect(() =>
				compile(nonInvertingStage({ ...stage, partNumber: part }), {
					registry,
				}),
			).toThrow(part);
			expect(() => compile(asPackage(part), { registry })).toThrow(part);
		}
	});
});

describe("opamp-law-default-parameters names the reason an op-amp's swing is not the part's at this supply", () => {
	for (const [door, source] of doors) {
		it(`names a part that states no pair as not-stated, through ${door}`, () => {
			expect(itemsOf(source("FIXTURE-SWING-NONE"))).toEqual([
				{ device: "U1", reason: "not-stated" },
			]);
			if (door === "a declared opamp") {
				expect(itemsOf(source("NOT-IN-ANY-REGISTRY"))).toEqual([
					{ device: "U1", reason: "not-stated" },
				]);
			}
		});

		it(`names a pair carried across a supply with both supplies, constant or proportional, through ${door}`, () => {
			for (const part of ["FIXTURE-SWING-ASYM", "FIXTURE-SWING-PROP"]) {
				expect(itemsOf(source(part))).toEqual([
					{
						device: "U1",
						reason: "stated-at-other-supply",
						printedSupplyVolts: 30,
						circuitSupplyVolts: SPAN,
					},
				]);
			}
		});

		it(`is silent for a pair printed at the supply it runs at, and for one the lowering did not carry, through ${door}`, () => {
			expect(itemsOf(source("FIXTURE-SWING-AT-SUPPLY"))).toEqual([]);
			expect(itemsOf(source("FIXTURE-SWING-CLOSING"))).toEqual([]);
		});
	}

	it("lists the same device in `devices` and `items`, in one warning per document", () => {
		const result = build(
			nonInvertingStage({ ...stage, partNumber: "FIXTURE-SWING-NONE" }),
		);
		const warnings = result.warnings.filter(
			(w) => w.code === "opamp-law-default-parameters",
		);
		expect(warnings).toHaveLength(1);
		const [warning] = warnings;
		expect(
			warning?.code === "opamp-law-default-parameters" && warning.devices,
		).toEqual(["U1"]);
		expect(warning?.detail).toContain("U1");
	});
});

describe("withDatasheetOutputSwing is loud on a table error", () => {
	const holder = (ids: readonly string[]) => opampEntry(ids);
	const row = (
		partIds: readonly string[],
		extra: Partial<OpampOutputSwingRow> = {},
	): OpampOutputSwingRow => ({
		partIds,
		highVolts: 1.5,
		lowVolts: 1.5,
		supplyVolts: 30,
		loadOhms: 10_000,
		translation: "constant",
		column: "test column",
		source: "test source",
		...extra,
	});
	const absent = (partIds: readonly string[], reason = "no row printed") => ({
		partIds,
		reason,
	});

	it("stamps exactly the ids a row covers and splits an entry whose ids differ", () => {
		const out = withDatasheetOutputSwing(
			[holder(["FIX-A", "FIX-B"])],
			[row(["FIX-A"])],
			[absent(["FIX-B"])],
		);
		const reg: PartRegistry = { entries: out };
		expect(registryOpampSwing(reg, "FIX-A")).toEqual({
			highVolts: 1.5,
			lowVolts: 1.5,
			printed: printed(30, "constant"),
		});
		expect(registryOpampSwing(reg, "FIX-B")).toBeNull();
		expect(out).toHaveLength(2);
	});

	it("throws on a row naming an id no op-amp entry holds", () => {
		expect(() =>
			withDatasheetOutputSwing([holder(["FIX-A"])], [row(["FIX-Z"])], []),
		).toThrow(/fix.?z/i);
		expect(() =>
			withDatasheetOutputSwing([holder(["FIX-A"])], [], [absent(["FIX-Z"])]),
		).toThrow(/fix.?z/i);
	});

	it("throws on an id in both lists and on an id in two rows", () => {
		expect(() =>
			withDatasheetOutputSwing(
				[holder(["FIX-A"])],
				[row(["FIX-A"])],
				[absent(["FIX-A"])],
			),
		).toThrow(/FIX-A/);
		expect(() =>
			withDatasheetOutputSwing(
				[holder(["FIX-A"])],
				[row(["FIX-A"]), row(["fix-a"])],
				[],
			),
		).toThrow(/fix.?a/i);
	});

	it("throws on an absent row with no reason", () => {
		expect(() =>
			withDatasheetOutputSwing(
				[holder(["FIX-A"])],
				[],
				[absent(["FIX-A"], "")],
			),
		).toThrow(/reason/);
	});

	it("throws on a base entry that already states a swing in place", () => {
		const stated = opampEntry(["FIX-A"], {
			outputSwingDropHighVolts: 1,
			outputSwingDropLowVolts: 1,
			outputSwingPrinted: printed(30, "constant"),
		});
		expect(() => withDatasheetOutputSwing([stated], [], [])).toThrow(/FIX-A/);
	});

	it("throws on a row whose numbers do not validate", () => {
		for (const bad of [
			row(["FIX-A"], { highVolts: 0 }),
			row(["FIX-A"], { lowVolts: -1 }),
			row(["FIX-A"], { supplyVolts: Number.NaN }),
			row(["FIX-A"], { loadOhms: 0 }),
			row(["FIX-A"], { translation: "scaled" as never }),
		]) {
			expect(() =>
				withDatasheetOutputSwing([holder(["FIX-A"])], [bad], []),
			).toThrow(/FIX-A/);
		}
	});

	it("leaves a non-op-amp entry and an op-amp entry no row names exactly as it was", () => {
		const diode: PartEntry = {
			partIds: ["FIX-D"],
			declaredTypes: [],
			terminalRoleGroups: [],
			model: { kind: "law", law: { kind: "open" } },
		};
		const plain = holder(["FIX-C"]);
		const out = withDatasheetOutputSwing([diode, plain], [], []);
		expect(out).toEqual([diode, plain]);
	});
});

describe("the shipping catalog's output-swing table is applied exactly", () => {
	// Structural, not a membership snapshot: it holds for whatever rows the table carries.
	it("answers every datasheet row's ids with that row's pair and condition, by exact id", () => {
		for (const row of opampOutputSwingDatasheet) {
			expect(Number.isFinite(row.highVolts) && row.highVolts > 0).toBe(true);
			expect(Number.isFinite(row.lowVolts) && row.lowVolts > 0).toBe(true);
			expect(row.source.length).toBeGreaterThan(80);
			expect(row.column.length).toBeGreaterThan(0);
			for (const id of row.partIds) {
				expect(registryOpampSwing(pedalPartCatalog, id)).toEqual({
					highVolts: row.highVolts,
					lowVolts: row.lowVolts,
					printed: {
						supplyVolts: row.supplyVolts,
						loadOhms: row.loadOhms,
						translation: row.translation,
					},
				});
			}
		}
	});

	it("answers null for every id listed absent, each with a stated reason", () => {
		for (const { partIds, reason } of opampOutputSwingAbsent) {
			expect(reason.length).toBeGreaterThan(20);
			for (const id of partIds) {
				expect(registryOpampSwing(pedalPartCatalog, id)).toBeNull();
			}
		}
	});

	it("gives a sibling nothing: an id no row names has no pair, whatever it resembles", () => {
		for (const row of opampOutputSwingDatasheet) {
			for (const id of row.partIds) {
				expect(registryOpampSwing(pedalPartCatalog, `${id}X`)).toBeNull();
				expect(registryOpampSwing(pedalPartCatalog, `X${id}`)).toBeNull();
			}
		}
	});

	it("never lists an id both given a pair and absent", () => {
		const given = new Set(
			opampOutputSwingDatasheet.flatMap((row) =>
				row.partIds.map((id) => id.toLowerCase()),
			),
		);
		for (const { partIds } of opampOutputSwingAbsent) {
			for (const id of partIds) expect(given.has(id.toLowerCase())).toBe(false);
		}
	});

	it("keeps no figure on an op-amp entry that did not come through the table", () => {
		const tabled = new Set(
			opampOutputSwingDatasheet.flatMap((row) =>
				row.partIds.map((id) => id.toLowerCase()),
			),
		);
		for (const entry of pedalPartCatalog.entries) {
			if (entry.model.kind !== "sections") continue;
			for (const section of entry.model.sections) {
				if (
					section.law.kind !== "ideal-opamp" ||
					section.law.outputSwingDropHighVolts === undefined
				)
					continue;
				for (const id of entry.partIds)
					expect(tabled.has(id.toLowerCase())).toBe(true);
			}
		}
	});
});
