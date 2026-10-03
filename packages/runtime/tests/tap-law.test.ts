import { describe, expect, it } from "bun:test";
import { compile } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "../src/reference-runtime";
import { V2WasmEngine } from "../src/v2-wasm-engine";

/**
 * A tapped delay read under a firmware tap law (core 0.16.0): a DD-5's manual, "Pressing the
 * Footswitch more than four times will automatically set the basic tempo", a 2 s timeout, and a
 * 300 ms quarter note before any tempo is set. The echo time is the answer, known independently.
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
  name: "Tap law shell"
  description: "A delay whose time is tapped under a stated tap law."
  partNumber: ""
source:
  format: interchange
  filename: tap-law.vdsp
deviceInterface:
  controls:
    - id: TEMPO
      label: TEMPO
      kind: jack
      role: tempo-input
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
      positions:
        - id: tempo
          label: "TEMPO"
          ops:
            - op: delay-tap
              line: dl
              length:
                mode: parameter
              out: 0
            - op: delay-push
              line: dl
              input:
                kind: input
          lines:
            dl:
              delaySeconds:
                control: TEMPO
                read: tapped
                scannedBy: CPU
                ratio: 1
                tap:
                  presses: 5
                  timeoutSeconds: 2
                  defaultSeconds: 0.3
                min: 0.001
                max: 2
                source: "test"
wires: []
`;

const RATE = 48000;

function program() {
	const result = compile(source);
	if (result.status !== "ok") throw new Error(JSON.stringify(result.reasons));
	return result.program;
}

type Console = { setControl(id: string, p: number): void; run(n: number, impulse?: boolean): Float64Array };

const tsConsole = (): Console => {
	const runtime = new ReferenceRuntime(program());
	runtime.prepare(RATE);
	return {
		setControl: (id, p) => runtime.setControl(id, p),
		run: (n, impulse = false) => {
			const x = new Float64Array(n);
			if (impulse) x[10] = 1;
			return runtime.process(x);
		},
	};
};

/** Presses `count` times, `spacing` seconds apart. */
function tap(c: Console, count: number, spacing: number): void {
	for (let k = 0; k < count; k++) {
		c.setControl("TEMPO", 1);
		c.run(48);
		c.setControl("TEMPO", 0);
		c.run(Math.round(spacing * RATE) - 48);
	}
}

/** The echo time of an impulse, in seconds. */
function echo(c: Console): number {
	const y = c.run(RATE * 2.5, true);
	let best = 0;
	let at = 0;
	for (let i = 200; i < y.length; i++) {
		if (Math.abs(y[i] as number) > best) {
			best = Math.abs(y[i] as number);
			at = i;
		}
	}
	return (at - 10) / RATE;
}

describe("a tap law", () => {
	it("carries the law on the tapped control", () => {
		expect(program().controls.find((c) => c.id === "TEMPO")?.tap).toEqual({
			presses: 5,
			timeoutSeconds: 2,
			defaultSeconds: 0.3,
		});
	});

	it("uses the stated default before any tempo is set", () => {
		expect(echo(tsConsole())).toBeCloseTo(0.3, 3);
	});

	it("sets no tempo until a run is long enough, then its mean interval", () => {
		const four = tsConsole();
		tap(four, 4, 0.5);
		expect(echo(four)).toBeCloseTo(0.3, 3);
		const five = tsConsole();
		tap(five, 5, 0.5);
		expect(echo(five)).toBeCloseTo(0.5, 3);
	});

	it("keeps the tempo when a run is broken by a gap longer than the timeout", () => {
		const c = tsConsole();
		tap(c, 5, 0.5);
		c.run(RATE * 3);
		tap(c, 2, 0.25);
		expect(echo(c)).toBeCloseTo(0.5, 3);
	});

	it("agrees between the two consoles", async () => {
		const compiled = program();
		const ts = new ReferenceRuntime(compiled);
		ts.prepare(RATE);
		const engine = await V2WasmEngine.create(compiled);
		engine.prepare({ sampleRate: RATE });
		const n = 4 * RATE;
		for (let i = 0; i < n; i++) {
			const pressed = i < 3 * RATE && i % (RATE / 2) < 48 ? 1 : 0;
			ts.setControl("TEMPO", pressed);
			engine.setControl("TEMPO", pressed);
			const x = i === 3 * RATE + 10 ? 1 : 0;
			const expected = ts.process(new Float64Array([x]))[0] as number;
			expect(Math.abs(engine.processSample(x) - expected)).toBeLessThan(1e-9);
		}
		engine.destroy();
	});
});
