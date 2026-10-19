// A `registry-provisional-value` notice for every compiled device that runs on a
// `community` registry value. Synthetic fixtures and synthetic registries only: no pedal
// identity, no diagnostic wording, nothing corpus-specific.
//
// Imports by relative path from the worktree source so the test provably runs the
// edited code rather than a built dist.
import { describe, expect, test } from "bun:test";
import { compile } from "../src/compile";
import { derive, diodeClipper } from "../src/fixtures/circuits";
import type { PartEntry, PartRegistry, ProvisionalParam } from "../src/registry";

const SYNTH_DIODE = "SYNTH-DIODE-9";
const COMMUNITY_URL = "https://example.test/models/synth-diode-9.lib.txt";

function diodeRegistry(
	provisionalParams: readonly ProvisionalParam[] = [],
): PartRegistry {
	const entry: PartEntry = {
		partIds: [SYNTH_DIODE],
		declaredTypes: [],
		terminalRoleGroups: [],
		...(provisionalParams.length === 0 ? {} : { provisionalParams }),
		model: {
			kind: "law",
			law: {
				kind: "diode",
				saturationCurrent: 4.5e-9,
				emissionCoefficient: 1.6,
				thermalVoltage: 0.025852,
				breakdownVolts: 0,
				seriesResistance: 0.5,
				isLed: false,
			},
		},
	};
	return { entries: [entry] };
}

const diodeWithPart = derive(
	diodeClipper,
	`      Description: "Clipping diode."\n  - id: D2`,
	`      PartNumber: ${SYNTH_DIODE}\n      Description: "Clipping diode."\n  - id: D2`,
);

const communityPair: readonly ProvisionalParam[] = [
	{ name: "saturationCurrent", url: COMMUNITY_URL },
	{ name: "emissionCoefficient", url: COMMUNITY_URL },
];

function provisionalWarningsOf(source: string, registry: PartRegistry) {
	const result = compile(source, { registry });
	if (result.status !== "ok") {
		throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
	}
	return result.warnings.filter(
		(warning) => warning.code === "registry-provisional-value",
	);
}

describe("registry-provisional-value", () => {
	test("warns once per device that runs on a community value", () => {
		const warnings = provisionalWarningsOf(
			diodeWithPart,
			diodeRegistry(communityPair),
		);
		expect(warnings).toHaveLength(1);
		const warning = warnings[0];
		if (warning?.code !== "registry-provisional-value") {
			throw new Error("expected a registry-provisional-value warning");
		}
		expect(warning.device).toBe("D1");
		expect(warning.partNumber).toBe(SYNTH_DIODE);
		expect([...warning.parameters].sort()).toEqual([
			"emissionCoefficient",
			"saturationCurrent",
		]);
		expect(warning.urls).toEqual([COMMUNITY_URL]);
		expect(warning.detail).toContain("D1");
		expect(warning.detail).toContain(SYNTH_DIODE);
		expect(warning.detail).toContain(COMMUNITY_URL);
	});

	test("a typed parameter wins and leaves the warning for the rest", () => {
		const typedBoth = derive(
			diodeWithPart,
			`      PartNumber: ${SYNTH_DIODE}\n      Description: "Clipping diode."`,
			`      PartNumber: ${SYNTH_DIODE}\n      SaturationCurrent: "4.5n"\n      EmissionCoefficient: "1.6"\n      Description: "Clipping diode."`,
		);
		expect(
			provisionalWarningsOf(typedBoth, diodeRegistry(communityPair)),
		).toHaveLength(0);
		const typedOne = derive(
			diodeWithPart,
			`      PartNumber: ${SYNTH_DIODE}\n      Description: "Clipping diode."`,
			`      PartNumber: ${SYNTH_DIODE}\n      SaturationCurrent: "4.5n"\n      Description: "Clipping diode."`,
		);
		const partial = provisionalWarningsOf(
			typedOne,
			diodeRegistry(communityPair),
		);
		expect(partial).toHaveLength(1);
		const warning = partial[0];
		if (warning?.code !== "registry-provisional-value") {
			throw new Error("expected a registry-provisional-value warning");
		}
		expect(warning.parameters).toEqual(["emissionCoefficient"]);
	});

	test("an entry with no provisional value warns nothing", () => {
		expect(provisionalWarningsOf(diodeWithPart, diodeRegistry())).toHaveLength(
			0,
		);
	});

	test("a part with no registry entry warns nothing", () => {
		const result = compile(diodeWithPart, { registry: diodeRegistry() });
		if (result.status !== "ok") {
			throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
		}
		expect(
			result.warnings.filter(
				(warning) => warning.code === "registry-provisional-value",
			),
		).toHaveLength(0);
	});
});
