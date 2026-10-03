import { describe, expect, it } from "bun:test";
import { compile } from "../src/compile";
import { emptyRegistry } from "../src/registry";

/**
 * Two islands, deliberately: an audio path from input jack to output jack, and a second
 * galvanically separate group sharing no node with it. Whether the island holds an active
 * device is the only thing that varies between the two cases below, which is exactly the
 * threshold under test.
 */
function twoIslands(islandIsActive: boolean): string {
	const island = islandIsActive
		? `  - id: Q_ISLAND
    kind: bjt
    name: "Q_ISLAND"
    sourceTypeName: "Circuit.BJT"
    origin:
      x: 0
      y: 200
    rotation: 0
    flipped: false
    terminals:
      - name: collector
        node: 50
        position:
          x: 0
          y: 0
      - name: base
        node: 51
        position:
          x: 0
          y: 0
      - name: emitter
        node: 52
        position:
          x: 0
          y: 0
    properties:
      Type: NPN
`
		: `  - id: R_ISLAND
    kind: resistor
    name: "R_ISLAND"
    sourceTypeName: "Circuit.Resistor"
    origin:
      x: 0
      y: 200
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 50
        position:
          x: 0
          y: 0
      - name: b
        node: 51
        position:
          x: 0
          y: 0
    properties:
      Resistance: 2200
`;
	return `schema: circuit-interchange/v3
deviceInterface:
  controls:
    - id: INPUT_JACK
      label: "In"
      kind: jack
      role: "input"
    - id: OUTPUT_JACK
      label: "Out"
      kind: jack
      role: "output"
components:
  - id: INPUT_JACK
    kind: jack
    name: "INPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: -100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: OUTPUT_JACK
    kind: jack
    name: "OUTPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: 100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: R_PATH
    kind: resistor
    name: "R_PATH"
    sourceTypeName: "Circuit.Resistor"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: 0
          y: 0
      - name: b
        node: 2
        position:
          x: 0
          y: 0
    properties:
      Resistance: 1000
${island}`;
}

describe("a region that is compiled but never executed", () => {
	it("is reported when it carries an active device", () => {
		const result = compile(twoIslands(true), { registry: emptyRegistry });
		expect(result.status).toBe("ok");
		const warning = (result as any).warnings.find(
			(w: any) => w.code === "unexecuted-active-region",
		);
		// The island shares no node with the audio path, so `link` cannot reach it from the
		// output port and it never runs -- with a transistor inside that is worth saying.
		expect(warning).toBeDefined();
		expect(warning.detail).toContain("bjt");
		expect(warning.detail).toContain("is never executed");
	});

	it("is NOT reported for a passive-only island, which is the threshold that keeps it useful", () => {
		// Measured over the corpus, 28 of 79 compiling packets have some unexecuted region and
		// only 9 have one holding an active device. Reporting bias and filter islands is what
		// would turn this check into noise nobody reads, so a passive island stays silent.
		const result = compile(twoIslands(false), { registry: emptyRegistry });
		expect(result.status).toBe("ok");
		expect(
			(result as any).warnings.filter(
				(w: any) => w.code === "unexecuted-active-region",
			),
		).toHaveLength(0);
	});
});
