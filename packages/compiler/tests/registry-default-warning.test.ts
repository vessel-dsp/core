// `bjt-law-default-parameters` and `fet-law-default-parameters` name a parameter only when
// it truly runs on the class default: not typed by the document, and not stated by the
// registry record for the exact part. A record that states one parameter gap-fills the rest
// with the class default by value, so the law alone cannot tell the two apart; the entry's
// `citedParams` can. Synthetic fixtures and synthetic registries only: no pedal identity,
// no diagnostic wording, nothing corpus-specific.
//
// Imports by relative path from the worktree source so the test provably runs the edited
// code rather than a built dist.
import { describe, expect, test } from "bun:test";
import { compile } from "../src/compile";
import {
	bjtTypedParameters,
	derive,
	diodeClipper,
	emitterFollower,
	jfetFollower,
	ledClipper,
} from "../src/fixtures/circuits";
import { bjtLawEntry, diodeLawEntry, fetLawEntry, pedalPartCatalog } from "../src/part-catalog";
import { emptyRegistry, type PartEntry, type PartRegistry } from "../src/registry";
import type { PartDataEntry } from "../src/registry-data/loader";
import type { Program, Stamp } from "../src/types";

const SYNTH_BJT = "SYNTH-NPN-7";
const SYNTH_FET = "SYNTH-JFET-7";
const SYNTH_DIODE = "SYNTH-D-7";

const bjtWithPart = derive(
	emitterFollower,
	'      Description: "Bucket brigade delay memory chip."',
	`      PartNumber: ${SYNTH_BJT}\n      Description: "Bucket brigade delay memory chip."`,
);
const jfetWithPart = derive(
	jfetFollower,
	'      Description: "Clock driver chip."',
	`      PartNumber: ${SYNTH_FET}\n      Description: "Clock driver chip."`,
);

const cited = (value: number) => ({
	value,
	basis: "datasheet" as const,
	source: "synthetic record",
});

function bjtRegistry(params: PartDataEntry["params"]): PartRegistry {
	return {
		entries: [bjtLawEntry({ partIds: [SYNTH_BJT], class: "bjt", params })],
	};
}

function warningNamed(
	source: string,
	registry: PartRegistry,
	code: "bjt-law-default-parameters" | "fet-law-default-parameters",
) {
	const result = compile(source, { registry });
	if (result.status !== "ok") {
		throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
	}
	return result.warnings.filter((warning) => warning.code === code);
}

describe("bjt-law-default-parameters follows what the registry states", () => {
	test("a record that states IS and BF leaves nothing on the default", () => {
		const registry = bjtRegistry({
			saturationCurrent: cited(2.5e-15),
			forwardBeta: cited(173),
		});
		expect(warningNamed(bjtWithPart, registry, "bjt-law-default-parameters")).toEqual([]);
	});

	test("a record that states BF alone still names IS, and only IS", () => {
		const registry = bjtRegistry({ forwardBeta: cited(173) });
		const named = warningNamed(bjtWithPart, registry, "bjt-law-default-parameters");
		expect(named).toHaveLength(1);
		const [warning] = named;
		if (warning?.code !== "bjt-law-default-parameters") throw new Error("unreachable");
		expect(warning.devices).toEqual(["Q1"]);
		expect(warning.detail).toMatch(/without IS(?!\/)/u);
		expect(warning.detail).not.toMatch(/without IS\/BF/u);
	});

	test("a record that states IS alone still names BF, and only BF", () => {
		const registry = bjtRegistry({ saturationCurrent: cited(2.5e-15) });
		const named = warningNamed(bjtWithPart, registry, "bjt-law-default-parameters");
		expect(named).toHaveLength(1);
		const [warning] = named;
		if (warning?.code !== "bjt-law-default-parameters") throw new Error("unreachable");
		expect(warning.detail).toMatch(/without BF/u);
		expect(warning.detail).not.toMatch(/without IS/u);
	});

	test("a part the registry does not hold is named for both, as before", () => {
		const named = warningNamed(bjtWithPart, emptyRegistry, "bjt-law-default-parameters");
		const [warning] = named;
		if (warning?.code !== "bjt-law-default-parameters") throw new Error("unreachable");
		expect(warning.detail).toMatch(/without IS\/BF/u);
	});

	test("the document typing a parameter covers it, whatever the record states", () => {
		// The document types IS and BF on a part whose record states BF alone.
		const typed = derive(
			bjtTypedParameters,
			"      IS:",
			`      PartNumber: ${SYNTH_BJT}\n      IS:`,
		);
		const registry = bjtRegistry({ forwardBeta: cited(173) });
		expect(warningNamed(typed, registry, "bjt-law-default-parameters")).toEqual([]);
	});

	test("a hand-built entry with no citedParams states its whole law", () => {
		const entry: PartEntry = {
			partIds: [SYNTH_BJT],
			declaredTypes: [],
			terminalRoleGroups: [],
			model: {
				kind: "law",
				law: {
					kind: "bjt",
					polarity: "npn",
					saturationCurrent: 3.3e-14,
					forwardBeta: 250,
					reverseBeta: 2,
					thermalVoltage: 0.025852,
					leakageAmps: 0,
				},
			},
		};
		expect(
			warningNamed(bjtWithPart, { entries: [entry] }, "bjt-law-default-parameters"),
		).toEqual([]);
	});
});

describe("fet-law-default-parameters follows what the registry states", () => {
	test("a record that states only the gate still names Vt0 and Beta", () => {
		const registry: PartRegistry = {
			entries: [
				fetLawEntry(
					{
						partIds: [SYNTH_FET],
						class: "jfet",
						params: { gateSaturationCurrent: cited(2e-9) },
					},
					"jfet",
				),
			],
		};
		const [warning] = warningNamed(jfetWithPart, registry, "fet-law-default-parameters");
		if (warning?.code !== "fet-law-default-parameters") throw new Error("expected a warning");
		expect(warning.detail).toMatch(/without Vt0\/Beta/u);
	});

	test("a record that states Vt0 and Beta leaves nothing on the default", () => {
		const registry: PartRegistry = {
			entries: [
				fetLawEntry(
					{
						partIds: [SYNTH_FET],
						class: "jfet",
						params: {
							thresholdVolts: cited(-1.5),
							transconductance: cited(2e-3),
						},
					},
					"jfet",
				),
			],
		};
		expect(warningNamed(jfetWithPart, registry, "fet-law-default-parameters")).toEqual([]);
	});
});

const diodeWithPart = derive(
	diodeClipper,
	'      Description: "Clipping diode."\n  - id: D2',
	`      PartNumber: ${SYNTH_DIODE}\n      Description: "Clipping diode."\n  - id: D2`,
);

const diodeBothWithPart = diodeClipper.replaceAll(
	'Description: "Clipping diode."',
	`PartNumber: ${SYNTH_DIODE}\n      Description: "Clipping diode."`,
);

const d1Listing = (detail: string) =>
	detail.match(/D1 \([^)]*\) without [A-Z/]*/)?.[0] ?? "(no D1 listing)";

function diodeRegistry(params: PartDataEntry["params"]): PartRegistry {
	return {
		entries: [diodeLawEntry({ partIds: [SYNTH_DIODE], class: "diode", params })],
	};
}

// diodeLawEntry requires the IS+n forward pair together, so a record stating N
// alone is hand-built: citedParams names exactly what the record states.
function diodeNOnlyRegistry(): PartRegistry {
	const entry: PartEntry = {
		partIds: [SYNTH_DIODE],
		declaredTypes: [],
		terminalRoleGroups: [],
		citedParams: ["emissionCoefficient"],
		model: {
			kind: "law",
			law: {
				kind: "diode",
				saturationCurrent: 5e-6,
				emissionCoefficient: 1.08,
				thermalVoltage: 0.025852,
				breakdownVolts: 0,
				seriesResistance: 1.0,
				isLed: false,
			},
		},
	};
	return { entries: [entry] };
}

function diodeWarningNamed(source: string, registry: PartRegistry) {
	const result = compile(source, { registry });
	if (result.status !== "ok") {
		throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
	}
	return result.warnings.filter((warning) => warning.code === "diode-law-default-parameters");
}

function diodeStampsOf(program: Program): Array<Extract<Stamp, { kind: "diode" }>> {
	return program.blocks.flatMap((block) =>
		block.kind === "mna"
			? block.stamps.filter(
					(s): s is Extract<Stamp, { kind: "diode" }> => s.kind === "diode",
				)
			: [],
	);
}

function build(source: string, registry: PartRegistry = emptyRegistry) {
	const result = compile(source, { registry });
	if (result.status !== "ok") {
		throw new Error(`fixture did not compile: ${JSON.stringify(result)}`);
	}
	return result;
}

describe("diode-law-default-parameters follows what the registry states", () => {
	test("a record that states IS, N and RS leaves nothing on the default", () => {
		const registry = diodeRegistry({
			saturationCurrent: cited(5e-6),
			emissionCoefficient: cited(1.08),
			seriesResistance: cited(45),
		});
		expect(diodeWarningNamed(diodeBothWithPart, registry)).toEqual([]);
	});

	test("a record that states N alone still names IS and RS, and only those", () => {
		const named = diodeWarningNamed(diodeWithPart, diodeNOnlyRegistry());
		expect(named).toHaveLength(1);
		const [warning] = named;
		if (warning?.code !== "diode-law-default-parameters") throw new Error("unreachable");
		expect(warning.devices).toEqual(["D1", "D2"]);
		expect(d1Listing(warning.detail)).toBe(`D1 (${SYNTH_DIODE}) without IS/RS`);
	});

	test("a part the registry does not hold is named for IS/N/RS", () => {
		const named = diodeWarningNamed(diodeWithPart, emptyRegistry);
		expect(named).toHaveLength(1);
		const [warning] = named;
		if (warning?.code !== "diode-law-default-parameters") throw new Error("unreachable");
		expect(warning.devices).toEqual(["D1", "D2"]);
		expect(warning.detail).toMatch(/without IS\/N\/RS/u);
		expect(warning.detail).toMatch(/\(SYNTH-D-7\)/u);
	});

	test("the document typing a parameter covers it, whatever the record states", () => {
		const typed = derive(
			diodeWithPart,
			`      PartNumber: ${SYNTH_DIODE}\n`,
			`      PartNumber: ${SYNTH_DIODE}\n      SaturationCurrent: "5 uA"\n`,
		);
		const registry = diodeNOnlyRegistry();
		const named = diodeWarningNamed(typed, registry);
		expect(named).toHaveLength(1);
		const [warning] = named;
		if (warning?.code !== "diode-law-default-parameters") throw new Error("unreachable");
		expect(d1Listing(warning.detail)).toBe(`D1 (${SYNTH_DIODE}) without RS`);
	});

	test("LEDs never raise it: they run on colour defaults, a different claim", () => {
		expect(diodeWarningNamed(ledClipper, emptyRegistry)).toEqual([]);
	});
});

describe("1S188FM registry entry and the open 1SS-188FM spelling", () => {
	const bothWithPart = (spelling: string) =>
		diodeClipper.replaceAll(
			'Description: "Clipping diode."',
			`PartNumber: ${spelling}\n      Description: "Clipping diode."`,
		);
	test("the entry and its hyphen alias stamp the measured law with no warning", () => {
		for (const spelling of ["1S188FM", "1S-188FM"]) {
			const result = build(bothWithPart(spelling), pedalPartCatalog);
			expect(
				result.warnings.filter((warning) => warning.code === "diode-law-default-parameters"),
			).toEqual([]);
			const stamps = new Map(diodeStampsOf(result.program).map((s) => [s.device, s]));
			expect(stamps.get("D1")?.saturationCurrent).toBe(5.4e-6);
			expect(stamps.get("D1")?.emissionCoefficient).toBe(1.079);
			expect(stamps.get("D1")?.seriesResistance).toBe(45.9);
		}
	});

	test("1SS-188FM has no record: it warns and stamps silicon", () => {
		const result = build(bothWithPart("1SS-188FM"), pedalPartCatalog);
		const named = result.warnings.filter(
			(warning) => warning.code === "diode-law-default-parameters",
		);
		expect(named).toHaveLength(1);
		const stamps = new Map(diodeStampsOf(result.program).map((s) => [s.device, s]));
		expect(stamps.get("D1")?.saturationCurrent).toBe(2.52e-9);
	});
});
