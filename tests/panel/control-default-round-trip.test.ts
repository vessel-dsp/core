import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
	extractPanel,
	parseCircuitDocumentFile,
	parseVdspCircuitDocument,
	serializeVdspCircuitDocument,
} from "../../packages/core/src";

// A control's default position is derived, not stored: knobs and sliders read
// `Wipe`, switches read `Position`. Those are component properties, so they survive
// a `.vdsp` round trip -- but only while the derivation keeps reading both the string
// and the structured-quantity form of them. This guards that, over the whole corpus.
function fixtures(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...fixtures(path));
		else if (!entry.name.endsWith(".md")) out.push(path);
	}
	return out;
}

type Defaults = ReadonlyMap<string, number>;

function controlDefaults(document: ReturnType<typeof parseVdspCircuitDocument>): Defaults {
	const panel = extractPanel(document);
	const out = new Map<string, number>();
	for (const knob of panel.knobs) out.set(`knob:${knob.id}`, knob.defaultPosition);
	for (const slider of panel.sliders ?? [])
		out.set(`slider:${slider.id}`, slider.defaultPosition);
	for (const sw of panel.switches) out.set(`switch:${sw.id}`, sw.defaultPosition);
	return out;
}

describe("control defaults through the .vdsp flow", () => {
	test("survive a round trip across the fixture corpus", () => {
		let compared = 0;
		let nonDefault = 0;
		const drift: string[] = [];

		for (const path of fixtures("tests/fixtures")) {
			let document: ReturnType<typeof parseCircuitDocumentFile>;
			try {
				document = parseCircuitDocumentFile(readFileSync(path, "utf8"), {
					filename: path,
				});
			} catch {
				continue;
			}
			const before = controlDefaults(document);
			const after = controlDefaults(
				parseVdspCircuitDocument(serializeVdspCircuitDocument(document)),
			);
			for (const [id, value] of before) {
				compared += 1;
				// 0.5 for a knob and 0 for a switch are the fallbacks, so a corpus of
				// only those would pass this test without preserving anything.
				if (!(value === 0.5 || value === 0)) nonDefault += 1;
				if (after.get(id) !== value) {
					drift.push(`${path} ${id}: ${value} -> ${String(after.get(id))}`);
				}
			}
		}

		expect(drift).toEqual([]);
		expect(compared).toBeGreaterThan(50);
		expect(nonDefault).toBeGreaterThan(20);
	});

	test("preserve an explicitly declared non-default wiper position", () => {
		const source = `schema: circuit-interchange/v2
metadata:
  name: Knob default
  description: ""
  partNumber: ""
source:
  format: interchange
components:
  - id: VR1
    kind: potentiometer
    name: DRIVE
    sourceTypeName: Circuit.Potentiometer
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: "1"
        position:
          x: 0
          y: 0
      - name: "2"
        position:
          x: 10
          y: 0
      - name: "3"
        position:
          x: 20
          y: 0
    properties:
      Resistance: 100k
      Wipe: "0.8"
wires: []
directives: []
diagnostics: []
rawAttributes: {}
`;
		const document = parseVdspCircuitDocument(source);
		expect(extractPanel(document).knobs[0]?.defaultPosition).toBe(0.8);
		const reparsed = parseVdspCircuitDocument(
			serializeVdspCircuitDocument(document),
		);
		expect(extractPanel(reparsed).knobs[0]?.defaultPosition).toBe(0.8);
	});
});
