import { describe, expect, test } from "bun:test";
import { compile, emptyRegistry } from "@vessel-dsp/compiler";

const TUBE_SCREAMER_CLIPPING_STAGE = `schema: circuit-interchange/v3
metadata:
  name: "Diode Clipper"
  description: "Symmetrical back-to-back diode clipping stage."
  partNumber: ""
source:
  format: vdsp
  filename: fixture.vdsp
components:
  - id: JIN
    kind: jack
    name: INPUT
    sourceTypeName: Circuit.Input
    origin:
      x: -200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: -200
          y: 0
  - id: JOUT
    kind: jack
    name: OUTPUT
    sourceTypeName: Circuit.Output
    origin:
      x: 200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 200
          y: 0
  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: gnd
        node: 0
        position:
          x: 0
          y: -100
  - id: R1
    kind: resistor
    name: R1
    sourceTypeName: Circuit.Resistor
    origin:
      x: -50
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -70
          y: 0
      - name: b
        node: 2
        position:
          x: -30
          y: 0
    properties:
      Resistance: "10k"
  - id: D1
    kind: diode
    name: D1
    sourceTypeName: Circuit.Diode
    origin:
      x: 50
      y: -50
    rotation: 0
    flipped: false
    terminals:
      - name: anode
        role: anode
        node: 2
        position:
          x: 50
          y: 0
      - name: cathode
        role: cathode
        node: 0
        position:
          x: 50
          y: -100
    properties:
      Model: "1N4148"
  - id: D2
    kind: diode
    name: D2
    sourceTypeName: Circuit.Diode
    origin:
      x: 80
      y: -50
    rotation: 0
    flipped: false
    terminals:
      - name: anode
        role: anode
        node: 0
        position:
          x: 80
          y: -100
      - name: cathode
        role: cathode
        node: 2
        position:
          x: 80
          y: 0
    properties:
      Model: "1N4148"
`;

describe("Phase 1: Compiler Pipeline", () => {
	test("compile produces valid Program with linear and nonlinear blocks", () => {
		const res = compile(TUBE_SCREAMER_CLIPPING_STAGE, { registry: emptyRegistry });
		expect(res.status).toBe("ok");
		if (res.status !== "ok") return;

		expect(res.program.formatVersion).toBe(1);
		expect(res.program.blocks.length).toBeGreaterThan(0);
		expect(res.program.requiredOperators).toContain("diode");
		expect(res.program.ports.input).toBe(1);
		expect(res.program.ports.output).toBe(2);
	});

	test("compiler rejects invalid circuit documents gracefully", () => {
		const invalidVdsp = `schema: circuit-interchange/v3
components:
  - id: BAD
    kind: unknown-device
`;
		const res = compile(invalidVdsp, { registry: emptyRegistry });
		expect(res.status).not.toBe("ok");
	});
});
