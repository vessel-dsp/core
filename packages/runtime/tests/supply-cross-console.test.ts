// Cross-console agreement for the supply setter: `ReferenceRuntime` (TypeScript) and
// `V2WasmEngine` (C++/WASM) must render the same audio from the same Program after the same
// `setSupply`.
//
// Claim lane: runtime convergence between the two consoles. Instrument: a synthetic biased
// common-emitter BJT stage (nonlinear, so the setter must rebuild the base matrix AND move the
// bias), rendered 2048 samples of 440 Hz at 0.25 + 1320 Hz at 0.1, verdict over [100, 2048) with
// correlation >= 0.9999 and max |delta| < 1e-4 -- the metric of `scripts/test-v2-wasm-parity.ts`.
// Newton cap 1024 on both. Controls: an un-set render must DISAGREE with a sagged render on the
// same console (the stage is sensitive to the setter), so agreement is not two silences or two
// supply-blind outputs. What it cannot prove: any real pedal -- corpus identity is out of scope.
//
// Ordering: the two consoles solve the operating point at different moments (TypeScript in
// `prepare()`, WASM lazily on first process), so a setter called after `prepare()` but before
// audio starts differs between them. The supported orders are before `prepare()` and mid-stream.
// Skips BY NAME when the compiled artifact is absent (`wasm-presence.ts`).
import { describe, expect, test } from "bun:test";
import { compile, emptyRegistry, type Program } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "../src/index";
import { V2WasmEngine } from "../src/v2-wasm-engine";
import { wasmBinaryPresent, WASM_SKIP_REASON } from "./wasm-presence";

const SR = 48000;
const N = 2048;
const SETTLE = 100;
const CAP = 1024;

function head(name: string, filename: string): string {
	return `schema: circuit-interchange/v3
metadata:
  name: "${name}"
  description: "supply setter probe."
  partNumber: ""
source:
  format: vdsp
  filename: ${filename}
components:
`;
}

function jack(
	id: string,
	name: string,
	node: number,
	x: number,
	stn: string,
): string {
	return `  - id: ${id}
    kind: jack
    name: ${name}
    sourceTypeName: ${stn}
    origin:
      x: ${x}
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: ${node}
        position:
          x: ${x}
          y: 0
`;
}

function ground(): string {
	return `  - id: GND1
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
`;
}

function battery(id: string, node: number, volts: string): string {
	return `  - id: ${id}
    kind: battery
    name: ${id}
    sourceTypeName: Circuit.Battery
    origin:
      x: 0
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: positive
        node: ${node}
        position:
          x: 0
          y: 90
      - name: negative
        node: 0
        position:
          x: 0
          y: 110
    properties:
      Voltage: "${volts}"
`;
}

function resistor(id: string, a: number, b: number, value: string): string {
	return `  - id: ${id}
    kind: resistor
    name: ${id}
    sourceTypeName: Circuit.Resistor
    origin:
      x: 10
      y: 10
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: ${a}
        position:
          x: 0
          y: 0
      - name: b
        node: ${b}
        position:
          x: 20
          y: 20
    properties:
      Resistance: "${value}"
`;
}

function capacitor(id: string, a: number, b: number, value: string): string {
	return `  - id: ${id}
    kind: capacitor
    name: ${id}
    sourceTypeName: Circuit.Capacitor
    origin:
      x: 10
      y: 10
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: ${a}
        position:
          x: 0
          y: 0
      - name: b
        node: ${b}
        position:
          x: 20
          y: 20
    properties:
      Capacitance: "${value}"
`;
}

function bjt(
	id: string,
	base: number,
	collector: number,
	emitter: number,
): string {
	return `  - id: ${id}
    kind: bjt
    name: ${id}
    sourceTypeName: Circuit.Bjt
    origin:
      x: 10
      y: 10
    rotation: 0
    flipped: false
    terminals:
      - name: base
        node: ${base}
        position:
          x: 0
          y: 0
      - name: collector
        node: ${collector}
        position:
          x: 10
          y: 10
      - name: emitter
        node: ${emitter}
        position:
          x: 20
          y: 20
    properties: {}
`;
}

const STAGE_DOC =
	head("Cross-console supply probe: CE stage", "supply_cross_console.vdsp") +
	jack("JIN", "INPUT", 1, -200, "Circuit.Input") +
	jack("JOUT", "OUTPUT", 2, 200, "Circuit.Output") +
	ground() +
	battery("BATT1", 3, "9V") +
	resistor("RB1", 3, 4, "470k") +
	resistor("RB2", 4, 0, "100k") +
	resistor("RC", 3, 5, "4.7k") +
	resistor("RE", 6, 0, "1k") +
	capacitor("CIN", 1, 4, "100n") +
	capacitor("COUT", 5, 2, "100n") +
	bjt("Q1", 4, 5, 6);

const stimulus = new Float32Array(N).map(
	(_, i) =>
		0.25 * Math.sin((2 * Math.PI * 440 * i) / SR) +
		0.1 * Math.sin((2 * Math.PI * 1320 * i) / SR),
);

type Order = "none" | "before-prepare" | "mid-stream";

function compileStage(): Program {
	const result = compile(STAGE_DOC, { registry: emptyRegistry });
	if (result.status !== "ok") {
		throw new Error(`probe doc failed to compile: ${JSON.stringify(result.reasons)}`);
	}
	return result.program;
}

async function render(
	console_: "ts" | "wasm",
	program: Program,
	order: Order,
	volts: number,
	ohms: number,
): Promise<Float32Array> {
	const ts = console_ === "ts" ? new ReferenceRuntime(program) : undefined;
	const wasm = console_ === "wasm" ? await V2WasmEngine.create(program) : undefined;
	const live = (ts ?? wasm)!;
	const addresses = live.getSupplies().map((s) => s.address);
	const prepare = () => {
		if (ts) ts.prepare(SR, { maxNewtonIterations: CAP });
		else wasm!.prepare({ sampleRate: SR, maxNewtonIterations: CAP });
	};
	const run = (input: Float32Array): Float32Array => {
		if (ts) return Float32Array.from(ts.process(new Float64Array(input)));
		const out = new Float32Array(input.length);
		wasm!.processBlock(input, out);
		return out;
	};
	if (order === "before-prepare") live.setSupply(addresses, volts, ohms);
	prepare();
	if (order === "mid-stream") {
		run(new Float32Array(9600).map((_, i) => 0.25 * Math.sin((2 * Math.PI * 440 * i) / SR)));
		live.setSupply(addresses, volts, ohms);
	}
	return run(stimulus);
}

function agreement(a: Float32Array, b: Float32Array) {
	let sa = 0, sb = 0, sab = 0, saa = 0, sbb = 0, maxDelta = 0;
	const n = N - SETTLE;
	for (let i = SETTLE; i < N; i += 1) {
		const x = a[i]!, y = b[i]!;
		sa += x; sb += y; sab += x * y; saa += x * x; sbb += y * y;
		maxDelta = Math.max(maxDelta, Math.abs(x - y));
	}
	const va = saa / n - (sa / n) ** 2;
	const vb = sbb / n - (sb / n) ** 2;
	const correlation = (sab / n - (sa / n) * (sb / n)) / Math.sqrt(Math.max(va * vb, 1e-300));
	return { correlation, maxDelta, rms: Math.sqrt(saa / n) };
}

const suite = wasmBinaryPresent ? describe : describe.skip;
if (!wasmBinaryPresent) test(`supply cross-console agreement: ${WASM_SKIP_REASON}`, () => {});

suite("supply setter: TypeScript and WASM consoles agree", () => {
	const program = compileStage();

	for (const order of ["before-prepare", "mid-stream"] as const) {
		test(`sagged supply, setter ${order}`, async () => {
			const ts = await render("ts", program, order, 7.5, 150);
			const wasm = await render("wasm", program, order, 7.5, 150);
			const v = agreement(ts, wasm);
			expect(v.rms).toBeGreaterThan(1e-3);
			expect(v.correlation).toBeGreaterThanOrEqual(0.9999);
			expect(v.maxDelta).toBeLessThan(1e-4);
		});
	}

	test("control: the sag is audible on the same console, so agreement is not supply-blind", async () => {
		const plain = await render("ts", program, "none", 9, 0);
		const sagged = await render("ts", program, "before-prepare", 7.5, 150);
		const v = agreement(plain, sagged);
		expect(v.maxDelta).toBeGreaterThan(1e-3);
	});
});
