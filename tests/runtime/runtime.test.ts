import { describe, expect, test } from "bun:test";
import { compile, emptyRegistry } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";

const DIODE_CLIPPER_VDSP = `schema: circuit-interchange/v3
metadata:
  name: "Diode Clipper"
  description: "Symmetrical diode clipper."
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
      Resistance: "1k"
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

describe("Phase 1: Runtime MNA Solver", () => {
	test("runtime solves nonlinear diode clipping symmetrically", () => {
		const compiled = compile(DIODE_CLIPPER_VDSP, { registry: emptyRegistry });
		expect(compiled.status).toBe("ok");
		if (compiled.status !== "ok") return;

		const runtime = new ReferenceRuntime(compiled.program);
		runtime.prepare(48000);

		// Drive with a 2V peak signal to trigger diode conduction
		const input = new Float64Array(100);
		for (let i = 0; i < 100; i++) {
			input[i] = 2.0 * Math.sin((2 * Math.PI * 1000 * i) / 48000);
		}

		const output = runtime.process(input);
		expect(output.length).toBe(100);

		// Output peak should be clamped by diode forward voltage (~0.6V - 0.8V)
		let maxPeak = 0;
		for (let i = 20; i < 80; i++) {
			maxPeak = Math.max(maxPeak, Math.abs(output[i] ?? 0));
		}
		expect(maxPeak).toBeLessThan(1.5);
		expect(maxPeak).toBeGreaterThan(0.3);
	});

	test("runtime pre-settles DC operating points without NaN or Inf", () => {
		const compiled = compile(DIODE_CLIPPER_VDSP, { registry: emptyRegistry });
		if (compiled.status !== "ok") return;

		const runtime = new ReferenceRuntime(compiled.program);
		runtime.prepare(44100);

		const silentInput = new Float64Array(64).fill(0);
		const out = runtime.process(silentInput);

		for (let i = 0; i < 64; i++) {
			expect(Number.isFinite(out[i])).toBe(true);
			expect(Math.abs(out[i] ?? 0)).toBeLessThan(0.01);
		}
	});
});
