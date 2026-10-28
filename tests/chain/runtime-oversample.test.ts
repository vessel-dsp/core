// Oversample plumbing through @vessel-dsp/chain: RuntimeNode.prepare and
// reset carry the factor into ReferenceRuntime.prepare, and SignalChain
// forwards it to nodes added before or after. Chain stays headless: no
// AudioContext, no DOM, only compiled programs and Float64Arrays.

import { describe, expect, test } from "bun:test";
import { RuntimeNode, SignalChain } from "@vessel-dsp/chain";
import { compile, emptyRegistry } from "@vessel-dsp/compiler";
import type { Program } from "@vessel-dsp/compiler";

const RC_LOW_PASS_VDSP = `schema: circuit-interchange/v3
metadata:
  name: "RC Low Pass"
  description: "Passive low pass filter."
  partNumber: ""
source:
  format: vdsp
  filename: rc_filter.vdsp
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
          x: -200
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
  - id: C1
    kind: capacitor
    name: C1
    sourceTypeName: Circuit.Capacitor
    origin:
      x: 50
      y: -50
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 50
          y: 0
      - name: b
        node: 0
        position:
          x: 50
          y: -100
    properties:
      Capacitance: "10n"
`;

function rcProgram(): Program {
	const compiled = compile(RC_LOW_PASS_VDSP, { registry: emptyRegistry });
	if (compiled.status !== "ok") {
		throw new Error("the RC fixture did not compile");
	}
	return compiled.program;
}

describe("RuntimeNode oversample plumbing", () => {
	test("prepare defaults to 1x and stores a valid factor", () => {
		const node = new RuntimeNode("rc", "RC", rcProgram());
		node.prepare(48000);
		// Expected: today's behaviour when no factor is given
		expect(node.getOversample()).toBe(1);
		node.prepare(48000, { oversample: 4 });
		expect(node.getOversample()).toBe(4);
		// Expected: the runtime renders at the prepared factor
		const output = node.process(new Float64Array(128).fill(0.1));
		expect(output.length).toBe(128);
		expect(output.every((value) => Number.isFinite(value))).toBe(true);
	});

	test("reset re-prepares at the stored factor", () => {
		const node = new RuntimeNode("rc", "RC", rcProgram());
		node.prepare(48000, { oversample: 2 });
		node.process(new Float64Array(128).fill(0.1));
		node.reset();
		// Expected: reset keeps 2x rather than falling back to 1x
		expect(node.getOversample()).toBe(2);
		const output = node.process(new Float64Array(128).fill(0.1));
		expect(output.every((value) => Number.isFinite(value))).toBe(true);
	});

	test("a fractional factor floors and a non-finite factor refuses", () => {
		const node = new RuntimeNode("rc", "RC", rcProgram());
		node.prepare(48000, { oversample: 2.7 });
		// Expected: same rule as ReferenceRuntime (floor, minimum 1)
		expect(node.getOversample()).toBe(2);
		expect(() => node.prepare(48000, { oversample: Number.NaN })).toThrow();
		expect(() => node.prepare(48000, { oversample: 0 })).not.toThrow();
		expect(node.getOversample()).toBe(1);
	});
});

describe("SignalChain oversample forwarding", () => {
	test("prepare forwards the factor to nodes added before and after", () => {
		const chain = new SignalChain({ sampleRate: 48000 });
		const early = new RuntimeNode("early", "Early", rcProgram());
		chain.addNode(early);
		chain.prepare(48000, { oversample: 4 });
		const late = new RuntimeNode("late", "Late", rcProgram());
		chain.addNode(late);
		// Expected: both the pre-existing and the later node run at 4x
		expect(early.getOversample()).toBe(4);
		expect(late.getOversample()).toBe(4);
		const output = chain.process(new Float64Array(128).fill(0.1));
		expect(output.length).toBe(128);
		expect(output.every((value) => Number.isFinite(value))).toBe(true);
	});

	test("the constructor oversample reaches the nodes", () => {
		const chain = new SignalChain({ sampleRate: 48000, oversample: 2 });
		const node = new RuntimeNode("rc", "RC", rcProgram());
		chain.addNode(node);
		expect(node.getOversample()).toBe(2);
	});
});
