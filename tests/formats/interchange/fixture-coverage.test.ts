import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
	detectCircuitFormat,
	parseCircuitDocument,
	serializeInterchangeYaml,
	type CircuitFormat,
} from "../../../packages/core/src";

const FIXTURES_DIR = new URL("../../fixtures/", import.meta.url);
const SUPPORTED_EXTENSIONS = /\.(schx|asc|cir|net|spice)$/i;

type FixtureCase = Readonly<{
	filename: string;
	url: URL;
	format: CircuitFormat;
}>;

async function collectFixtures(
	dir: URL = FIXTURES_DIR,
): Promise<readonly FixtureCase[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const fixtures: FixtureCase[] = [];

	for (const entry of entries) {
		const child = new URL(entry.name, dir);
		if (entry.isDirectory()) {
			fixtures.push(...(await collectFixtures(new URL(`${entry.name}/`, dir))));
			continue;
		}
		if (!SUPPORTED_EXTENSIONS.test(entry.name)) {
			continue;
		}
		const filename = relative(
			fileURLToPath(FIXTURES_DIR),
			fileURLToPath(child),
		);
		const format = detectCircuitFormat(filename);
		if (format === null) {
			continue;
		}
		fixtures.push({ filename, url: child, format });
	}

	return fixtures.sort((a, b) => a.filename.localeCompare(b.filename));
}

describe("interchange YAML fixture coverage", () => {
	test("serializes every supported fixture into the intermediary YAML view", async () => {
		const fixtures = await collectFixtures();
		const formatCounts = countByFormat(fixtures);
		expect(fixtures).toHaveLength(49);
		expect(formatCounts.schx).toBe(36);
		expect(formatCounts["ltspice-asc"]).toBe(10);
		expect(formatCounts.spice).toBe(3);

		const failures: string[] = [];
		for (const fixture of fixtures) {
			try {
				const doc = parseCircuitDocument(await Bun.file(fixture.url).text(), {
					filename: fixture.filename,
				});
				const yaml = serializeInterchangeYaml(doc, {
					filename: fixture.filename,
					sourceFormat: fixture.format,
				});

				collectYamlFailure(
					failures,
					yaml,
					fixture.filename,
					"schema: circuit-interchange/v2",
					"schema",
				);
				collectYamlFailure(
					failures,
					yaml,
					fixture.filename,
					`format: ${fixture.format}`,
					"source format",
				);
				collectYamlFailure(
					failures,
					yaml,
					fixture.filename,
					fixture.filename,
					"filename",
				);
				collectYamlFailure(
					failures,
					yaml,
					fixture.filename,
					"components:",
					"components block",
				);
				collectYamlFailure(
					failures,
					yaml,
					fixture.filename,
					"nodes:",
					"nodes block",
				);
				collectYamlFailure(
					failures,
					yaml,
					fixture.filename,
					"wires:",
					"wires block",
				);
				if (yaml.includes("node: null")) {
					failures.push(
						`${fixture.filename}: contains an unresolved terminal node`,
					);
				}
			} catch (error) {
				failures.push(
					`${fixture.filename}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		expect(failures).toEqual([]);
	});
});

function collectYamlFailure(
	failures: string[],
	yaml: string,
	filename: string,
	expected: string,
	label: string,
): void {
	if (!yaml.includes(expected)) {
		failures.push(`${filename}: missing ${label}`);
	}
}

function countByFormat(
	fixtures: readonly FixtureCase[],
): Record<CircuitFormat, number> {
	const counts: Record<CircuitFormat, number> = {
		schx: 0,
		spice: 0,
		"ltspice-asc": 0,
	};
	for (const fixture of fixtures) {
		counts[fixture.format] += 1;
	}
	return counts;
}
