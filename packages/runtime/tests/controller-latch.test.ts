import { describe, expect, it } from "bun:test";
import { compile } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "../src/reference-runtime";
import { V2WasmEngine } from "../src/v2-wasm-engine";

/**
 * A controller latch: a footswitch press flips firmware state, a program reads that state, and a
 * pin the controller drives follows it.
 *
 * Synthetic on purpose. The control is a shell whose answer is known without the engine: the DSP
 * passes its input times the latch, and the pin sits at the chip's supply or its ground. The pin
 * loads the output node, because a block nothing downstream reads is solved at its operating
 * point and then held -- which is right for audio and would hide the pin here.
 */

const comp = (id: string, kind: string, extra: string, terminals: [string, string, number][], typeName = "null") => `  - id: ${id}
    kind: ${kind}
    name: ${id}
    sourceTypeName: ${typeName}
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
${extra}    terminals:
${terminals.map(([n, r, node]) => `      - name: ${n}
        role: ${r}
        node: ${node}
        position:
          x: 0
          y: 0`).join("\n")}
`;

const resistor = (id: string, ohms: string, a: number, b: number) =>
	comp(id, "resistor", `    properties:\n      Resistance: "${ohms}"\n`, [["a", "end", a], ["b", "end", b]]);

const shell = (role: string, extraPins = "") => `schema: circuit-interchange/v2
metadata:
  name: "Controller shell"
  description: "A CPU latch toggled by a footswitch gates a DSP program and drives a lamp pin."
  partNumber: ""
source:
  format: interchange
  filename: controller.vdsp
deviceInterface:
  controls:
    - id: SW1
      label: SW1
      kind: switch
      role: ${role}
    - id: MODE
      label: MODE
      kind: selector
      role: mode
      positions: 3
components:
${comp("JIN", "jack", "", [["tip", "signal", 1]], "Circuit.Input")}${comp("JOUT", "jack", "", [["tip", "signal", 4]], "Circuit.Output")}${resistor("R1", "10k", 1, 2)}${resistor("R2", "10k", 3, 4)}${comp("V5", "voltage-source", '    properties:\n      Voltage: "5V"\n', [["positive", "positive", 5], ["negative", "negative", 0]])}${resistor("RPULL", "10k", 5, 6)}${comp("SW1", "switch", "", [["common", "common", 6], ["throw", "throw", 0]])}${resistor("RLAMP", "100k", 7, 4)}${resistor("RMUTE", "100k", 8, 4)}  - id: CPU
    kind: ic
    name: CPU
    sourceTypeName: Circuit.Microcontroller
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: in
        role: pin
        node: 6
        position:
          x: 0
          y: 0
      - name: lamp
        role: pin
        node: 7
        position:
          x: 0
          y: 0
      - name: mute
        role: pin
        node: 8
        position:
          x: 0
          y: 0
      - name: vcc
        role: supplyPositive
        node: 5
        position:
          x: 0
          y: 0
      - name: vss
        role: supplyNegative
        node: 0
        position:
          x: 0
          y: 0
    controller:
      latches:
        - id: EFFECT
          toggledBy: SW1
          initial: 0
          source: "test"
      pins:
        - terminal: lamp
          follows: EFFECT
          source: "test"
${extraPins}  - id: U1
    kind: ic
    name: U1
    sourceTypeName: null
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      PartNumber: "TC25SC080AU-104"
    terminals:
      - name: input
        role: input
        node: 2
        position:
          x: 0
          y: 0
      - name: output
        role: output
        node: 3
        position:
          x: 0
          y: 0
    program:
      positions:
        - id: gated
          label: "GATED"
          ops:
            - op: mix
              terms:
                - source:
                    kind: input
                  gain:
                    parameter: engaged
              out: 0
          parameters:
            engaged:
              control: EFFECT
              read: scanned
              scannedBy: CPU
              min: 0
              max: 1
              source: "test"
wires: []
`;

const RATE = 48000;

const source = shell("bypass");

function program(text = source) {
	const result = compile(text);
	if (result.status !== "ok") throw new Error(JSON.stringify(result.reasons));
	return result.program;
}

const tone = (n: number) => {
	const x = new Float64Array(n);
	for (let i = 0; i < n; i++) x[i] = 0.1 * Math.sin((2 * Math.PI * 500 * i) / RATE);
	return x;
};
/** The lamp pin's solved voltage, from whichever block solves node 7. */
const lampVolts = (runtime: ReferenceRuntime): number => {
	for (const snapshot of runtime.nodeVoltageSnapshot()) {
		const row = snapshot.nodeIds.indexOf(7 as never);
		if (row >= 0) return snapshot.voltages[row] as number;
	}
	throw new Error("no block solves the lamp node");
};
const rms = (y: Float64Array) => Math.sqrt(y.reduce((a, v) => a + v * v, 0) / y.length);

describe("a controller latch", () => {
	it("derives the toggle as momentary and the latch as firmware state", () => {
		const controls = program().controls;
		expect(controls.find((c) => c.id === "SW1")?.momentary).toBe(true);
		expect(controls.find((c) => c.id === "EFFECT")?.latch).toEqual({ toggledBy: "SW1", initial: 0 });
	});

	it("starts engaged when a bypass footswitch toggles it, and a press turns it off and back", () => {
		const runtime = new ReferenceRuntime(program());
		runtime.prepare(RATE);
		const on = rms(runtime.process(tone(4800)));
		expect(lampVolts(runtime)).toBeGreaterThan(0.1);
		runtime.setControl("SW1", 1);
		runtime.setControl("SW1", 0);
		const off = rms(runtime.process(tone(4800)));
		expect(on).toBeGreaterThan(100 * off + 1e-6);
		runtime.setControl("SW1", 1);
		runtime.setControl("SW1", 0);
		expect(rms(runtime.process(tone(4800)))).toBeGreaterThan(on / 2);
	});

	it("keeps its declared power-on state when nothing says which end is the effect", () => {
		const controls = program(shell("mode")).controls;
		expect(controls.find((c) => c.id === "EFFECT")?.defaultPosition).toBe(0);
	});

	it("drives its pin between the chip's own ground and supply", () => {
		const runtime = new ReferenceRuntime(program(shell("mode")));
		runtime.prepare(RATE);
		runtime.process(tone(4800));
		const low = lampVolts(runtime);
		runtime.setControl("SW1", 1);
		runtime.setControl("SW1", 0);
		runtime.process(tone(4800));
		expect(lampVolts(runtime) - low).toBeGreaterThan(1);
	});

	it("returns to its starting state at prepare", () => {
		const runtime = new ReferenceRuntime(program());
		runtime.prepare(RATE);
		runtime.process(tone(480));
		const start = lampVolts(runtime);
		runtime.setControl("SW1", 1);
		runtime.setControl("SW1", 0);
		runtime.prepare(RATE);
		runtime.process(tone(480));
		expect(Math.abs(lampVolts(runtime) - start)).toBeLessThan(1e-3);
	});

	it("drives a pin high at a control's listed detents and low at the rest", () => {
		const text = shell("mode", `        - terminal: mute
          highAt:
            control: MODE
            positions:
              - 1
          source: "test"
`);
		const levels = [0, 0.5, 1].map((mode) => {
			const runtime = new ReferenceRuntime(program(text));
			runtime.prepare(RATE);
			runtime.setControl("MODE", mode);
			runtime.process(tone(4800));
			for (const snapshot of runtime.nodeVoltageSnapshot()) {
				const row = snapshot.nodeIds.indexOf(8 as never);
				if (row >= 0) return snapshot.voltages[row] as number;
			}
			throw new Error("no block solves the mute node");
		});
		expect(levels[1]! - levels[0]!).toBeGreaterThan(1);
		expect(levels[1]! - levels[2]!).toBeGreaterThan(1);
	});

	it("agrees between the two consoles across a press", async () => {
		const compiled = program();
		const ts = new ReferenceRuntime(compiled);
		ts.prepare(RATE);
		const engine = await V2WasmEngine.create(compiled);
		engine.prepare({ sampleRate: RATE });
		const input = tone(RATE / 10);
		for (let i = 0; i < input.length; i++) {
			if (i === 1000) {
				ts.setControl("SW1", 1);
				engine.setControl("SW1", 1);
			}
			if (i === 1100) {
				ts.setControl("SW1", 0);
				engine.setControl("SW1", 0);
			}
			const expected = ts.process(input.subarray(i, i + 1))[0]!;
			expect(Math.abs(engine.processSample(input[i]!) - expected)).toBeLessThan(1e-9);
		}
		engine.destroy();
	});
});
