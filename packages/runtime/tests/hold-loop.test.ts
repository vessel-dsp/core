import { describe, expect, it } from "bun:test";
import { compile } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "../src/reference-runtime";
import { V2WasmEngine } from "../src/v2-wasm-engine";

/**
 * `hold-loop`: a manual's hold procedure as an op. Idle until the pedal goes down; record while it
 * is held; loop what was recorded on release; stop and erase on the next press, and on a mode
 * change. The control is a shell whose answer is known without the engine: what comes back is the
 * recorded samples, repeating with the recorded length.
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

const source = `schema: circuit-interchange/v2
metadata:
  name: "Hold shell"
  description: "A hold sampler gated by a pedal the CPU reads, beside a pass-through mode."
  partNumber: ""
source:
  format: interchange
  filename: hold.vdsp
deviceInterface:
  controls:
    - id: SW1
      label: SW1
      kind: switch
      role: bypass
    - id: MODE
      label: MODE
      kind: selector
      role: mode
      positions: 2
components:
${comp("JIN", "jack", "", [["tip", "signal", 1]], "Circuit.Input")}${comp("JOUT", "jack", "", [["tip", "signal", 4]], "Circuit.Output")}${resistor("R1", "10k", 1, 2)}${resistor("R2", "10k", 3, 4)}${comp("CPU", "ic", "", [["p0", "pin", 9]], "Circuit.Microcontroller")}  - id: U1
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
      router:
        control: MODE
        read: scanned
        scannedBy: CPU
        positions: 2
        routes:
          - position: 0
            program: hold
          - position: 1
            program: thru
      positions:
        - id: hold
          label: "HOLD"
          ops:
            - op: hold-loop
              line: hl
              input:
                kind: input
              gate:
                parameter: pedal
              out: 0
          lines:
            hl:
              delaySeconds:
                min: 0.5
                max: 0.5
                source: "test"
          parameters:
            pedal:
              control: SW1
              read: scanned
              scannedBy: CPU
              min: 0
              max: 1
              source: "test"
        - id: thru
          label: "THRU"
          ops:
            - op: mix
              terms:
                - source:
                    kind: input
                  gain: 1
              out: 0
wires: []
`;

const RATE = 48000;
const RECORD = 4800;

function program() {
	const result = compile(source);
	if (result.status !== "ok") throw new Error(JSON.stringify(result.reasons));
	return result.program;
}

const tone = (n: number) => {
	const x = new Float64Array(n);
	for (let i = 0; i < n; i++) x[i] = 0.1 * Math.sin((2 * Math.PI * 440 * i) / RATE) * (1 + i / n);
	return x;
};
const peak = (y: Float64Array) => y.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

/** Record RECORD samples of a rising tone, release, and return the next three periods. */
function recordAndLoop(runtime: { setControl(id: string, p: number): void; process(x: Float64Array): Float64Array }) {
	const idle = runtime.process(tone(RECORD));
	runtime.setControl("SW1", 1);
	runtime.process(tone(RECORD));
	runtime.setControl("SW1", 0);
	return { idle, loop: runtime.process(new Float64Array(3 * RECORD)) };
}

describe("hold-loop", () => {
	it("derives the pedal it reads as momentary", () => {
		const sw1 = program().controls.find((control) => control.id === "SW1");
		expect(sw1?.momentary).toBe(true);
		expect(sw1?.defaultPosition).toBe(0);
	});

	it("is silent until pressed, then loops exactly what was recorded", () => {
		const runtime = new ReferenceRuntime(program());
		runtime.prepare(RATE);
		runtime.setControl("MODE", 0);
		const { idle, loop } = recordAndLoop(runtime);
		expect(peak(idle)).toBeLessThan(1e-9);
		expect(peak(loop)).toBeGreaterThan(1e-3);
		for (let i = 0; i < RECORD; i++) {
			expect(Math.abs((loop[i + RECORD] as number) - (loop[i] as number))).toBeLessThan(1e-9);
		}
		// The recorded tone rises, so the loop is not a steady tone: its first and last quarter differ.
		const quarter = (a: number) => peak(loop.subarray(a, a + RECORD / 4));
		expect(quarter((3 * RECORD) / 4)).toBeGreaterThan(1.5 * quarter(0));
	});

	it("stops and erases on the next press", () => {
		const runtime = new ReferenceRuntime(program());
		runtime.prepare(RATE);
		runtime.setControl("MODE", 0);
		recordAndLoop(runtime);
		runtime.setControl("SW1", 1);
		runtime.process(new Float64Array(480));
		runtime.setControl("SW1", 0);
		expect(peak(runtime.process(new Float64Array(3 * RECORD)))).toBeLessThan(1e-9);
	});

	it("erases on a mode change", () => {
		const runtime = new ReferenceRuntime(program());
		runtime.prepare(RATE);
		runtime.setControl("MODE", 0);
		recordAndLoop(runtime);
		runtime.setControl("MODE", 1);
		runtime.process(new Float64Array(480));
		runtime.setControl("MODE", 0);
		expect(peak(runtime.process(new Float64Array(3 * RECORD)))).toBeLessThan(1e-9);
	});

	it("agrees between the two consoles", async () => {
		const compiled = program();
		const ts = new ReferenceRuntime(compiled);
		ts.prepare(RATE);
		ts.setControl("MODE", 0);
		const engine = await V2WasmEngine.create(compiled);
		engine.prepare({ sampleRate: RATE });
		engine.setControl("MODE", 0);
		const input = tone(4 * RECORD);
		for (let i = 0; i < input.length; i++) {
			const pedal = i >= RECORD && i < 2 * RECORD ? 1 : 0;
			if (i === RECORD || i === 2 * RECORD) {
				ts.setControl("SW1", pedal);
				engine.setControl("SW1", pedal);
			}
			const expected = ts.process(input.subarray(i, i + 1))[0] as number;
			expect(Math.abs(engine.processSample(input[i] as number) - expected)).toBeLessThan(1e-9);
		}
		engine.destroy();
	});
});
