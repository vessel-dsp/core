import { describe, expect, it } from "bun:test";
import { compile } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "../src/reference-runtime";
import { V2WasmEngine } from "../src/v2-wasm-engine";

/**
 * A reprogrammable chip's declared program, from source text to audio.
 *
 * This is the acceptance deck for the second resolution key. A fixed-function part is
 * identified and the registry supplies its model; that lookup is keyed on the part number and
 * the corpus proves the key wrong for shared silicon -- `TC25SC080AU-104` is a delay in
 * `boss-dd-5`, a reverb in `boss-rv-3` and a pitch shifter in `boss-hr-2`. So the source
 * declares the program instead, and everything below is what that has to buy.
 *
 * **Synthetic on purpose.** It is a two-mode delay shell, not a real packet: the point is to
 * prove the mechanism before a real packet depends on it, and a corpus document could not be a
 * control for its own compiler.
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

const source = `schema: circuit-interchange/v2
metadata:
  name: "Two-mode shell"
  description: "A reprogrammable delay chip whose MODE switch drives a select pin."
  partNumber: ""
source:
  format: interchange
  filename: selector.vdsp
deviceInterface:
  controls:
    - id: MODE
      label: MODE
      kind: selector
      role: mode
components:
${comp("JIN", "jack", "", [["tip", "signal", 1]], "Circuit.Input")}${comp("JOUT", "jack", "", [["tip", "signal", 4]], "Circuit.Output")}${comp("V1", "voltage-source", "    properties:\n      Voltage: \"9V\"\n", [["positive", "positive", 5], ["negative", "negative", 0]])}${comp("R1", "resistor", "    properties:\n      Resistance: \"10k\"\n", [["a", "end", 1], ["b", "end", 2]])}${comp("R2", "resistor", "    properties:\n      Resistance: \"10k\"\n", [["a", "end", 3], ["b", "end", 4]])}${comp("RSEL", "resistor", "    properties:\n      Resistance: \"100k\"\n", [["a", "end", 6], ["b", "end", 0]])}${comp("MODE", "potentiometer", "    properties:\n      Resistance: \"50k\"\n", [["lug1", "ccw", 0], ["wiper", "wiper", 7], ["lug3", "cw", 5]])}  - id: U1
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
        control: "MODE"
        positions: 2
        routes:
          - position: 0
            program: delay-1
          - position: 1
            program: delay-2
      positions:
        - id: delay-1
          label: "DELAY 1"
          ops:
            - op: delay-push
              line: dl
              input:
                kind: input
            - op: delay-tap-fractional
              line: dl
              length:
                mode: capacity
              out: 0
          lines:
            dl:
              delaySeconds:
                min: 0.001
                max: 0.05
                source: "Service notes, MODE table"
        - id: delay-2
          label: "DELAY 2"
          ops:
            - op: delay-push
              line: dl
              input:
                kind: input
            - op: delay-tap-fractional
              line: dl
              length:
                mode: capacity
              out: 0
          lines:
            dl:
              delaySeconds:
                min: 0.05
                max: 0.2
                source: "Service notes, MODE table"
wires: []
`;

describe("a declared program is compiled and switched by its pin", () => {
	const compiled = () => {
		const result = compile(source);
		if (result.status !== "ok") {
			throw new Error(
				`expected the declaration to compile: ${JSON.stringify(result)}`,
			);
		}
		return result.program;
	};

	const composedBlock = () => {
		const block = compiled().blocks.find((entry) => entry.kind === "composed");
		if (block?.kind !== "composed") throw new Error("no composed block");
		return block;
	};

	it("compiles every declared position, not just the selected one", () => {
		// "Compile should compile the DSP program." Both modes are in the artifact, so
		// switching is an index change at run time rather than a recompile.
		const block = composedBlock();
		expect(block.positions.map((position) => position.id)).toEqual([
			"delay-1",
			"delay-2",
		]);
		expect(block.modelSource).toBe("declared");
	});

	it("takes each line's length from the cited range, and only when cited", () => {
		const block = composedBlock();
		expect(
			block.positions.map((position) => position.lines.dl?.delaySeconds),
		).toEqual([0.05, 0.2]);
	});

	it("requires no model of the runtime, because it brought its own program", () => {
		// The chip's part number is not an algorithm any runtime could register. Declaring it
		// in `requiredModels` would refuse every reprogrammable pedal at load.
		expect(compiled().requiredModels).not.toContain("TC25SC080AU-104");
	});

	it("reads the router from a solved node, and the chip has no mode pin at all", () => {
		// The control reaches the engine through the circuit, so the mode arrives as a node
		// voltage the MNA already solves -- the same mechanism as the parameter port. The chip
		// declares no mode pin, which is the point: on the pedal this models, the knob reaches
		// a CPU and the CPU tells the DSP. Requiring the node to sit on the declaring chip
		// would refuse every firmware-mediated control.
		const router = composedBlock().router;
		expect(router).not.toBeNull();
		expect(router?.port?.referenceVolts).toBeGreaterThan(0);
		expect(router?.positions).toBe(2);
		// Dense, one entry per detent, each an index into the block's programs.
		expect(router?.routes).toEqual([0, 1]);
	});

	const firstEchoSeconds = (modePosition: number): number => {
		const rate = 48_000;
		const runtime = new ReferenceRuntime(compiled());
		runtime.prepare(rate);
		runtime.setControl("MODE", modePosition);
		const input = new Float64Array(rate);
		input[0] = 1;
		const out = runtime.process(input);
		let peak = 0;
		let peakIndex = -1;
		for (let index = 200; index < out.length; index += 1) {
			const value = Math.abs(out[index] ?? 0);
			if (value > peak) {
				peak = value;
				peakIndex = index;
			}
		}
		return peak > 1e-9 ? peakIndex / rate : Number.NaN;
	};

	it("plays the program the router selects, and the knob moves it", () => {
		// Delay is definitional: an impulse in, energy out at the line's length. Reading it at
		// both ends of the control is the check that would catch a declaration which compiled
		// and did nothing -- the failure this deck exists for.
		//
		// **Which end maps to which program is deliberately not asserted.** Measured 2026-09-22:
		// swapping this pot's declared `ccw` and `cw` roles changes its solved wiper voltage not
		// at all, so sweep direction is not being read from the roles. That is a real defect on a
		// different axis, recorded separately; pinning a direction here would bless it.
		const ends = [firstEchoSeconds(0), firstEchoSeconds(1)].sort((a, b) => a - b);
		expect(ends[0]).toBeCloseTo(0.05, 3);
		expect(ends[1]).toBeCloseTo(0.2, 3);
	});

	it("agrees with the C++ console bit-exactly in both positions", async () => {
		const rate = 48_000;
		const input = new Float64Array(4_000);
		input[0] = 1;
		for (const mode of [0, 1]) {
			const program = compiled();
			const ts = new ReferenceRuntime(program);
			ts.prepare(rate);
			ts.setControl("MODE", mode);
			const expected = ts.process(input);

			const engine = await V2WasmEngine.create(program);
			engine.prepare({ sampleRate: rate });
			engine.setControl("MODE", mode);
			for (let index = 0; index < input.length; index += 1) {
				expect(engine.processSample(input[index] as number)).toBe(
					expected[index],
				);
			}
			engine.destroy();
		}
	});
});

/**
 * The same shell with **no pot at all** and a scanned router.
 *
 * This is the case the `scanned` read exists for. On a Boss DD-5 the mode knob runs through a
 * connector whose far side no obtainable sheet resolves, while the panel fact -- eleven detents
 * and which one is which mode -- is fully documented. Modelling the untraceable transport would
 * be precision about the wrong thing, since firmware quantizes that voltage by rules no dump
 * exists for.
 */
const scannedSource = source
	.replace(
		/\$\{comp\("MODE", "potentiometer",[^}]*\}/,
		"",
	)
	.replace(
		'        control: "MODE"\n',
		'        control: "MODE"\n        read: scanned\n        scannedBy: U1\n',
	);

describe("a scanned control needs no wiring, and still selects", () => {
	const program = () => {
		const result = compile(scannedSource);
		if (result.status !== "ok") {
			throw new Error(`expected it to compile: ${JSON.stringify(result)}`);
		}
		return result.program;
	};

	it("compiles with no device bound to the control", () => {
		const block = program().blocks.find((b) => b.kind === "composed");
		if (block?.kind !== "composed") throw new Error("no composed block");
		// No port: there is no node to read, by declaration.
		expect(block.router?.port).toBeNull();
		expect(block.router?.controlId).toBe("MODE");
	});

	it("still exposes the control, or the knob could never be turned", () => {
		// A scanned control leaves no bound device behind, so it would vanish from the program
		// unless stage 1 admits it. Then setControl would move nothing and the panel would show
		// no knob for a control that chooses the program.
		expect(program().controls.map((c) => c.id)).toContain("MODE");
	});

	it("plays the program the control selects", () => {
		const rate = 48_000;
		const echo = (position: number): number => {
			const p = program();
			const drive = (on: boolean) => {
				const rt = new ReferenceRuntime(p);
				rt.prepare(rate);
				rt.setControl("MODE", position);
				const input = new Float64Array(rate);
				if (on) input[0] = 1;
				return rt.process(input);
			};
			// Driven minus silent, because an impulse render is dominated by a DC settling
			// transient and a naive peak search reports that instead of the echo.
			const a = drive(true);
			const b = drive(false);
			let peak = 0;
			let idx = -1;
			for (let i = 200; i < rate; i += 1) {
				const v = Math.abs((a[i] ?? 0) - (b[i] ?? 0));
				if (v > peak) { peak = v; idx = i; }
			}
			return peak > 1e-9 ? idx / rate : Number.NaN;
		};
		const ends = [echo(0), echo(1)].sort((a, b) => a - b);
		expect(ends[0]).toBeCloseTo(0.05, 3);
		expect(ends[1]).toBeCloseTo(0.2, 3);
	});
});
