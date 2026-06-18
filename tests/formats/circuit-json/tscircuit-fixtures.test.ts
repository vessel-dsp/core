import { describe, expect, test } from 'bun:test';
import { any_circuit_element } from 'circuit-json';
import { readdir } from 'node:fs/promises';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    detectCircuitFormat,
    parseCircuitDocument,
    type CircuitFormat,
} from '../../../packages/core/src/formats/document';
import { serializeCircuitJsonDocument } from '../../../packages/core/src/formats/circuit-json/serializer';

const FIXTURES_DIR = new URL('../../fixtures/', import.meta.url);
const SUPPORTED_EXTENSIONS = /\.(schx|asc|cir|net|spice)$/i;

type FixtureCase = Readonly<{
    filename: string;
    url: URL;
    format: CircuitFormat;
}>;

async function collectFixtures(dir: URL = FIXTURES_DIR): Promise<readonly FixtureCase[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const fixtures: FixtureCase[] = [];

    for (const entry of entries) {
        const child = new URL(entry.name, dir);
        if (entry.isDirectory()) {
            fixtures.push(...await collectFixtures(new URL(`${entry.name}/`, dir)));
            continue;
        }
        if (!SUPPORTED_EXTENSIONS.test(entry.name)) {
            continue;
        }
        const filename = relative(fileURLToPath(FIXTURES_DIR), fileURLToPath(child));
        const format = detectCircuitFormat(filename);
        if (format === null) {
            continue;
        }
        fixtures.push({ filename, url: child, format });
    }

    return fixtures.sort((a, b) => a.filename.localeCompare(b.filename));
}

describe('Circuit JSON tscircuit fixture coverage', () => {
    test('converts every bundled fixture into elements accepted by the official circuit-json schema', async () => {
        const fixtures = await collectFixtures();
        expect(fixtures).toHaveLength(49);

        const failures: string[] = [];
        for (const fixture of fixtures) {
            const doc = parseCircuitDocument(await Bun.file(fixture.url).text(), {
                filename: fixture.filename,
            });
            const circuitJson = serializeCircuitJsonDocument(doc, { target: 'tscircuit' });

            if (doc.components.length > 0 && circuitJson.elements.length === 0) {
                failures.push(`${fixture.filename}: converted to no Circuit JSON elements`);
                continue;
            }

            for (const [index, element] of circuitJson.elements.entries()) {
                const result = any_circuit_element.safeParse(element);
                if (!result.success) {
                    failures.push(`${fixture.filename} element ${index}: ${summarizeSchemaError(result.error)}`);
                }
            }
        }

        expect(failures).toEqual([]);
    }, 60000);
});

function summarizeSchemaError(error: {
    readonly issues: readonly {
        readonly code: string;
        readonly message: string;
        readonly path: readonly (string | number)[];
    }[];
}): string {
    return error.issues
        .slice(0, 3)
        .map((issue) => {
            const path = issue.path.length === 0 ? '<root>' : issue.path.join('.');
            return `${path} ${issue.code}: ${issue.message}`;
        })
        .join('; ');
}
