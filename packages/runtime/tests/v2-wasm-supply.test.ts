// WASM-console supply control: `V2WasmEngine.getSupplies` / `setSupply`.
//
// Claim lane: runtime convergence/cost (the C++/WASM console solves the new
// supply values after a mid-stream retarget). Instrument: this test itself on
// the WASM console (`src/wasm/`, built by `scripts/build-wasm.sh`);
// the rail is read from the engine's last solved voltages via
// `getOperatingPointNode` after settling silence, so the window is 64 silent
// samples at 48 kHz and the tap is the supply stamp's own `positive` row. What
// it cannot prove: anything about the TypeScript reference console -- the
// cross-console parity rows belong to the sibling task.
//
// Every expected value below is computed by hand in the comment preceding its
// assertion. Deterministic: silence in, no randomness anywhere in the solver.
// Skips BY NAME when the compiled artifact is absent, following
// `wasm-presence.ts`: a missing build is a skip, not a pass.

import { describe, expect, it } from "bun:test";
import { compile } from "@vessel-dsp/compiler";
import { emptyRegistry } from "@vessel-dsp/compiler";
import type { Program } from "@vessel-dsp/compiler";
import { RuntimeError } from "../src/reference-runtime";
import type { SupplyInfo } from "../src/supply";
import { V2WasmEngine } from "../src/v2-wasm-engine";
import { wasmBinaryPresent } from "./wasm-presence";

const RATE = 48000;

function head(name: string, filename: string): string {
	return `schema: circuit-interchange/v3
metadata:
  name: "${name}"
  description: "wasm supply setter probe."
  partNumber: ""
source:
  format: vdsp
  filename: ${filename}
components:
`;
}

function jack(id: string, name: string, node: number, x: number, stn: string): string {
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

// 9 V battery on authored node 3 into a 9k load, plus a 10k input-to-output
// resistor so the program has audio ports.
//
// The load returns to the INPUT jack (node 1), not to ground. On silence the
// input source holds an ideal 0 V, so the rail is still the exact divider
// E*9000/(9000+R) -- but the rail now joins the executed signal region. A load
// to ground would leave the supply in a block pruned from `program.order`
// (solved once at the operating point and never re-rendered), so no mid-stream
// setter could move its rail. Same shape as the TypeScript reference test.
const RESISTIVE_DOC =
	head("WASM supply probe: resistive load", "wasm_supply_resistive.vdsp") +
	jack("JIN", "INPUT", 1, -200, "Circuit.Input") +
	jack("JOUT", "OUTPUT", 2, 200, "Circuit.Output") +
	ground() +
	battery("BATT1", 3, "9V") +
	resistor("RLOAD", 3, 1, "9k") +
	resistor("R1", 1, 2, "10k");

function compileOrThrow(doc: string): Program {
	const result = compile(doc, { registry: emptyRegistry });
	if (result.status !== "ok") {
		throw new Error(`probe doc failed to compile: ${JSON.stringify(result.reasons)}`);
	}
	return result.program;
}

/** Settle the engine on silence, then read the rail at the stamp's own row. */
function settledRail(engine: V2WasmEngine, info: SupplyInfo): number {
	for (let i = 0; i < 64; i += 1) engine.processSample(0);
	return engine.getOperatingPointNode(info.address.blockIndex, info.positive);
}

function expectSupplyThrow(fn: () => void): void {
	try {
		fn();
	} catch (error) {
		expect(error).toBeInstanceOf(RuntimeError);
		return;
	}
	throw new Error("expected RuntimeError but nothing threw");
}

describe.skipIf(!wasmBinaryPresent)("V2 WASM Engine supply control", () => {
	// Resistive load: 9 V source into a 9k load. Hand computation: the rail is
	// the Thevenin divider E*9000/(9000+R):
	//   R=0:   rail = 9*9000/9000 = 9.0 exactly.
	//   R=1:   rail = 81000/9001 = 8.9990001110989... (9/9001 = 0.000999888901...).
	//   R=30:  rail = 81000/9030 = 2700/301 = 8.970099667774....
	//   R=100: rail = 81000/9100 = 810/91 = 8.901098901098....
	// Tolerance 2e-9 V: the engine's GMIN is 1e-12 S against a ~1.1e-4 S load
	// (relative ~9e-9, absolute ~8e-8 on a 9 V rail), and the Newton voltage
	// tolerance is 1e-6 V, so 2e-9 is two orders under the solver floor and ~2x
	// the largest measured C++ residual (8.8e-10 at R=100). A self-consistent
	// wrong stamp would still pass this -- the negative controls below are what
	// make it a claim about the setter rather than the stamp.
	it("sweeps the resistive rail through the Thevenin values", async () => {
		const program = compileOrThrow(RESISTIVE_DOC);
		const engine = await V2WasmEngine.create(program);
		engine.prepare({ sampleRate: RATE });
		expect(engine.getSupplies()).toHaveLength(1);
		const info = engine.getSupplies()[0] as SupplyInfo;
		// As compiled, the stamp carries the 1 ohm low-end default.
		expect(info.volts).toBe(9);
		expect(info.sourceOhms).toBe(1);

		for (const r of [0, 1, 30, 100]) {
			engine.setSupply([info.address], 9, r);
			const expected = (9 * 9000) / (9000 + r);
			expect(Math.abs(settledRail(engine, info) - expected)).toBeLessThan(2e-9);
			const live = engine.getSupplies()[0] as SupplyInfo;
			expect(live.volts).toBe(9);
			expect(live.sourceOhms).toBe(r);
		}
		engine.destroy();
	});

	// Negative control: without setSupply the as-compiled program (sourceOhms 1)
	// sits at the R=1 divider value, not the ideal rail. Hand computation:
	// 81000/9001 = 8.9990001110989..., a full millivolt below 9 V.
	it("as-compiled program without setSupply sits at the 1 ohm divider value", async () => {
		const program = compileOrThrow(RESISTIVE_DOC);
		const engine = await V2WasmEngine.create(program);
		engine.prepare({ sampleRate: RATE });
		const info = engine.getSupplies()[0] as SupplyInfo;
		expect(Math.abs(settledRail(engine, info) - (9 * 9000) / 9001)).toBeLessThan(2e-9);
		engine.destroy();
	});

	// Mid-stream: process, retarget volts and ohms, process again. Hand
	// computation: as-compiled 1 ohm gives 81000/9001 = 8.9990001110989...;
	// a dying-battery retarget to 6.8 V through 30 ohm gives
	// 6.8*9000/9030 = 61200/9030 = 6.777409...; back to ideal 9 V gives 9.0.
	it("retargets volts and ohms mid-stream", async () => {
		const program = compileOrThrow(RESISTIVE_DOC);
		const engine = await V2WasmEngine.create(program);
		engine.prepare({ sampleRate: RATE });
		const info = engine.getSupplies()[0] as SupplyInfo;
		expect(Math.abs(settledRail(engine, info) - (9 * 9000) / 9001)).toBeLessThan(2e-9);

		engine.setSupply([info.address], 6.8, 30);
		expect(Math.abs(settledRail(engine, info) - (6.8 * 9000) / 9030)).toBeLessThan(2e-9);
		expect((engine.getSupplies()[0] as SupplyInfo).volts).toBe(6.8);
		expect((engine.getSupplies()[0] as SupplyInfo).sourceOhms).toBe(30);

		engine.setSupply([info.address], 9, 0);
		expect(Math.abs(settledRail(engine, info) - 9)).toBeLessThan(2e-9);
		engine.destroy();
	});

	// Atomic refusal: a valid address paired with an invalid one in the same
	// call leaves the valid rail untouched. Anchor: valid rail pre-set to the
	// 100 ohm value 81000/9100 = 8.901098901098...; the refused retarget to 30
	// ohm (81000/9030 = 8.970099667774...) must not move it, and getSupplies
	// must still report 100 ohm.
	it("refuses a bad address atomically, leaving the valid rail unchanged", async () => {
		const program = compileOrThrow(RESISTIVE_DOC);
		const engine = await V2WasmEngine.create(program);
		engine.prepare({ sampleRate: RATE });
		const info = engine.getSupplies()[0] as SupplyInfo;
		engine.setSupply([info.address], 9, 100);
		expect(Math.abs(settledRail(engine, info) - (9 * 9000) / 9100)).toBeLessThan(2e-9);

		expectSupplyThrow(() =>
			engine.setSupply([info.address, { blockIndex: 999, sourceIndex: 0 }], 9, 30),
		);
		expect(Math.abs(settledRail(engine, info) - (9 * 9000) / 9100)).toBeLessThan(2e-9);
		expect((engine.getSupplies()[0] as SupplyInfo).sourceOhms).toBe(100);

		expectSupplyThrow(() => engine.setSupply([{ blockIndex: 0, sourceIndex: 999 }], 9, 30));
		expect(Math.abs(settledRail(engine, info) - (9 * 9000) / 9100)).toBeLessThan(2e-9);

		expectSupplyThrow(() => engine.setSupply([info.address], 9, -1));
		expect(Math.abs(settledRail(engine, info) - (9 * 9000) / 9100)).toBeLessThan(2e-9);

		expectSupplyThrow(() => engine.setSupply([info.address], Number.NaN, 30));
		expect(Math.abs(settledRail(engine, info) - (9 * 9000) / 9100)).toBeLessThan(2e-9);

		expectSupplyThrow(() => engine.setSupply([info.address], 9, Number.POSITIVE_INFINITY));
		expect(Math.abs(settledRail(engine, info) - (9 * 9000) / 9100)).toBeLessThan(2e-9);

		// An empty address list changes nothing.
		engine.setSupply([], 9, 30);
		expect(Math.abs(settledRail(engine, info) - (9 * 9000) / 9100)).toBeLessThan(2e-9);
		expect((engine.getSupplies()[0] as SupplyInfo).sourceOhms).toBe(100);
		engine.destroy();
	});

	// Idempotent reapply: the values a stamp already carries change nothing.
	// Hand computation anchor: 30 ohm gives 81000/9030 = 8.970099667774....
	it("reapplying identical values changes nothing", async () => {
		const program = compileOrThrow(RESISTIVE_DOC);
		const engine = await V2WasmEngine.create(program);
		engine.prepare({ sampleRate: RATE });
		const info = engine.getSupplies()[0] as SupplyInfo;
		engine.setSupply([info.address], 9, 30);
		expect(Math.abs(settledRail(engine, info) - (9 * 9000) / 9030)).toBeLessThan(2e-9);
		engine.setSupply([info.address], 9, 30);
		expect(Math.abs(settledRail(engine, info) - (9 * 9000) / 9030)).toBeLessThan(2e-9);
		expect((engine.getSupplies()[0] as SupplyInfo).sourceOhms).toBe(30);
		engine.destroy();
	});

	// Copy semantics, negative control: the wrapper clones the program on
	// load, so mutating the caller's object after load moves nothing. Hand
	// computation: the rail stays at the as-compiled 81000/9001 value, NOT the
	// 100 ohm 81000/9100 value the direct write asks for.
	it("mutating the caller program after load moves nothing", async () => {
		const program = compileOrThrow(RESISTIVE_DOC);
		const engine = await V2WasmEngine.create(program);
		engine.prepare({ sampleRate: RATE });
		const info = engine.getSupplies()[0] as SupplyInfo;
		for (const block of program.blocks) {
			if (block.kind !== "mna") continue;
			for (const stamp of block.stamps) {
				if (stamp.kind === "dc-source") (stamp as { sourceOhms: number }).sourceOhms = 100;
			}
		}
		expect(Math.abs(settledRail(engine, info) - (9 * 9000) / 9001)).toBeLessThan(2e-9);
		expect((engine.getSupplies()[0] as SupplyInfo).sourceOhms).toBe(1);
		engine.destroy();
	});
});

// An AudioWorkletGlobalScope has no `structuredClone`; the wasm console loads a program inside one.
describe.skipIf(!wasmBinaryPresent)("loadProgram in a scope without structuredClone", () => {
	it("loads and reports supplies", async () => {
		const original = globalThis.structuredClone;
		// @ts-expect-error -- simulate a worklet scope
		globalThis.structuredClone = undefined;
		try {
			const engine = await V2WasmEngine.create(compileOrThrow(RESISTIVE_DOC));
			expect(engine.getSupplies().length).toBe(1);
		} finally {
			globalThis.structuredClone = original;
		}
	});
});
