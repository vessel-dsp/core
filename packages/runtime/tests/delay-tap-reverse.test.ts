import { describe, expect, it } from "bun:test";
import { compile } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "../src/reference-runtime";
import { V2WasmEngine } from "../src/v2-wasm-engine";

/**
 * `delay-tap-reverse`: a line's most recent segment, played backwards, two heads crossfaded.
 *
 * The contract is the op's own law, so the controls are inputs whose reversed answer is known
 * without the engine: a constant (the windows must sum to 1), and two impulses in a known order.
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

const tap = (reverse: string) => `            - op: ${reverse}
              line: dl
              length:
                mode: capacity
              out: 0
`;

const source = (taps: string) => `schema: circuit-interchange/v2
metadata:
  name: "Reverse shell"
  description: "A reverse tap on one delay line."
  partNumber: ""
source:
  format: interchange
  filename: reverse.vdsp
components:
${comp("JIN", "jack", "", [["tip", "signal", 1]], "Circuit.Input")}${comp("JOUT", "jack", "", [["tip", "signal", 4]], "Circuit.Output")}${comp("R1", "resistor", "    properties:\n      Resistance: \"10k\"\n", [["a", "end", 1], ["b", "end", 2]])}${comp("R2", "resistor", "    properties:\n      Resistance: \"10k\"\n", [["a", "end", 3], ["b", "end", 4]])}  - id: U1
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
        - id: reverse
          label: "REVERSE"
          ops:
            - op: delay-push
              line: dl
              input:
                kind: input
${taps}          lines:
            dl:
              delaySeconds:
                min: 0.01
                max: 0.01
                source: "test"
wires: []
`;

const RATE = 48000;

function programOf(text: string) {
	const result = compile(text);
	if (result.status !== "ok") throw new Error(JSON.stringify(result.reasons));
	return result.program;
}

function render(input: Float64Array): Float64Array {
	const runtime = new ReferenceRuntime(programOf(source(tap("delay-tap-reverse"))));
	runtime.prepare(RATE);
	return runtime.process(input);
}

describe("delay-tap-reverse", () => {
	it("plays a constant back constant, because the two windows sum to one", () => {
		const input = new Float64Array(RATE / 2).fill(0.1);
		const out = render(input).subarray(RATE / 4);
		const mean = out.reduce((a, b) => a + b, 0) / out.length;
		expect(Math.abs(mean)).toBeGreaterThan(1e-3);
		for (const sample of out) expect(Math.abs(sample - mean)).toBeLessThan(1e-9 * Math.abs(mean) + 1e-12);
	});

	it("plays two impulses back in the opposite order", () => {
		const input = new Float64Array(RATE / 10);
		const first = 1000;
		const second = first + 40;
		input[first] = 1;
		input[second] = -1;
		const out = render(input);
		// The circuit around the chip is resistive and memoryless, so a read of either impulse is
		// a spike of its own sign; which appears first is the order the tap reads them in.
		const appears = (sign: number) =>
			out.findIndex((sample, index) => index > second && sign * sample > 1e-6);
		expect(appears(-1)).toBeGreaterThan(0);
		expect(appears(1)).toBeGreaterThan(appears(-1));
	});

	it("agrees between the two consoles", async () => {
		const program = programOf(source(tap("delay-tap-reverse")));
		const input = new Float64Array(RATE / 10);
		for (let i = 0; i < input.length; i++) input[i] = Math.sin((2 * Math.PI * 330 * i) / RATE) * (i / input.length);
		const ts = new ReferenceRuntime(program);
		ts.prepare(RATE);
		const expected = ts.process(input);
		const engine = await V2WasmEngine.create(program);
		engine.prepare({ sampleRate: RATE });
		for (let i = 0; i < input.length; i++) {
			expect(Math.abs(engine.processSample(input[i] as number) - (expected[i] as number))).toBeLessThan(1e-12);
		}
		engine.destroy();
	});

	it("refuses a second reverse tap on the same line", () => {
		const twice = tap("delay-tap-reverse") + tap("delay-tap-reverse").replace("out: 0", "out: 1");
		const result = compile(source(twice));
		expect(result.status).toBe("unsupported");
	});
});
