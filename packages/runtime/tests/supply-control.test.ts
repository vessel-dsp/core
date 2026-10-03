// Runtime-settable supply: `ReferenceRuntime.getSupplies` / `setSupply` /
// `supplyRebuilds`.
//
// Every expected value below is computed by hand in the comment preceding its
// assertion. Deterministic: silence in, no randomness anywhere in the solver.
import { describe, expect, test } from "bun:test";
import {
	compile,
	emptyRegistry,
	type Block,
	type Program,
} from "@vessel-dsp/compiler";
import {
	ReferenceRuntime,
	RuntimeError,
	type SupplyAddress,
	type SupplyInfo,
} from "../src/index";

const RATE = 48000;

// ---------------------------------------------------------------------------
// Probe document builders.
// ---------------------------------------------------------------------------

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

// 9 V battery on authored node 3 into a 9k load, plus a 10k input-to-output
// resistor so the program has audio ports.
//
// The load returns to the INPUT jack (node 1), not to ground. On silence the
// input source holds an ideal 0 V, so the rail is still the exact divider
// E*9000/(9000+R) -- but the rail now joins the executed signal region. A load
// to ground would leave the supply in a block pruned from `program.order`
// (never executed, by any runtime), which solves once at the operating point
// and never re-renders: `setSupply` could not move its rail mid-stream.
const RESISTIVE_DOC =
	head("Supply probe: resistive load", "supply_resistive.vdsp") +
	jack("JIN", "INPUT", 1, -200, "Circuit.Input") +
	jack("JOUT", "OUTPUT", 2, 200, "Circuit.Output") +
	ground() +
	battery("BATT1", 3, "9V") +
	resistor("RLOAD", 3, 1, "9k") +
	resistor("R1", 1, 2, "10k");

// Two supplies: 9 V rail (node 3, 9k load) and 5 V reference (node 4, 5k load).
// Both loads return to the input jack for the same executed-region reason as
// above: on silence each rail is an independent exact divider (9 V:
// E*9000/(9000+R); 5 V: 5*5000/(5000+R)), fully decoupled through the ideal
// 0 V input source.
const TWO_SUPPLY_DOC =
	head("Supply probe: two rails", "supply_two_rail.vdsp") +
	jack("JIN", "INPUT", 1, -200, "Circuit.Input") +
	jack("JOUT", "OUTPUT", 2, 200, "Circuit.Output") +
	ground() +
	battery("BATT9", 3, "9V") +
	resistor("RLOAD9", 3, 1, "9k") +
	battery("BATT5", 4, "5V") +
	resistor("RLOAD5", 4, 1, "5k") +
	resistor("R1", 1, 2, "10k");

// Two biased common-emitter BJT stages: nonlinear, 12 unknowns.
const TWO_STAGE_BJT_DOC =
	head("Supply probe: two-stage BJT", "supply_two_stage_bjt.vdsp") +
	jack("JIN", "INPUT", 1, -200, "Circuit.Input") +
	jack("JOUT", "OUTPUT", 2, 200, "Circuit.Output") +
	ground() +
	battery("BATT1", 3, "9V") +
	resistor("RB1A", 3, 4, "470k") +
	resistor("RB2A", 4, 0, "100k") +
	resistor("RCA", 3, 5, "4.7k") +
	resistor("REA", 6, 0, "1k") +
	capacitor("CINA", 1, 4, "100n") +
	bjt("QA", 4, 5, 6) +
	resistor("RB1B", 3, 7, "470k") +
	resistor("RB2B", 7, 0, "100k") +
	resistor("RCB", 3, 8, "4.7k") +
	resistor("REB", 9, 0, "1k") +
	capacitor("CC", 5, 7, "100n") +
	capacitor("COUT", 8, 2, "100n") +
	bjt("QB", 7, 8, 9);

function compileOrThrow(doc: string): Program {
	const result = compile(doc, { registry: emptyRegistry });
	expect(result.status).toBe("ok");
	if (result.status !== "ok") {
		throw new Error(`probe doc failed to compile: ${JSON.stringify(result.reasons)}`);
	}
	return result.program;
}

/** Rail voltage for one supply: `voltages[positive]`, where `positive` is the stamp's row. */
function railOf(rt: ReferenceRuntime, program: Program, info: SupplyInfo): number {
	const blockId = program.blocks[info.address.blockIndex]?.id;
	const snap = rt.nodeVoltageSnapshot().find((s) => s.blockId === blockId);
	return snap?.voltages[info.positive] ?? NaN;
}

/** Signed branch current of one dc-source stamp (negative = delivering). */
function branchOf(
	rt: ReferenceRuntime,
	program: Program,
	info: SupplyInfo,
): number {
	const blockId = program.blocks[info.address.blockIndex]?.id;
	const entry = rt
		.branchCurrentSnapshot()
		.find(
			(b) =>
				b.blockId === blockId &&
				b.kind === "dc-source" &&
				b.sourceIndex === info.address.sourceIndex,
		);
	return entry?.amps ?? NaN;
}

/** Every dc-source stamp's series resistance on the caller's program object. */
function programSourceOhms(program: Program): number[] {
	const ohms: number[] = [];
	for (const block of program.blocks) {
		if (block.kind !== "mna") continue;
		for (const stamp of block.stamps) {
			if (stamp.kind === "dc-source") ohms.push(stamp.sourceOhms);
		}
	}
	return ohms;
}

/** Direct-write every dc-source stamp's series resistance on a program object. */
function setAllProgramSourceOhms(program: Program, ohms: number): void {
	for (const block of program.blocks) {
		if (block.kind !== "mna") continue;
		for (const stamp of block.stamps) {
			if (stamp.kind === "dc-source") {
				(stamp as { sourceOhms: number }).sourceOhms = ohms;
			}
		}
	}
}

function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const key of Object.keys(value)) {
			deepFreeze((value as Record<string, unknown>)[key]);
		}
	}
	return value;
}

/** Asserts `fn` throws RuntimeError (and nothing else). */
function expectSupplyThrow(fn: () => void): void {
	try {
		fn();
	} catch (error) {
		expect(error).toBeInstanceOf(RuntimeError);
		return;
	}
	throw new Error("expected RuntimeError but nothing threw");
}

describe("runtime supply control", () => {
	// Resistive load: 9 V source into a 9k load.
	// Hand computation: the rail is the Thevenin divider E*9000/(9000+R):
	//   R=0:   rail = 9*9000/9000 = 9.0 exactly;            |I| = 9/9000 = 0.001
	//   R=1:   rail = 81000/9001 = 8.9990001110989...;     |I| = 9/9001 = 0.000999888901...
	//   R=30:  rail = 81000/9030 = 8.970099667774...;        |I| = 9/9030 = 0.000996677740...
	//   R=100: rail = 81000/9100 = 8.901098901098...;        |I| = 9/9100 = 0.000989010989...
	// (81000/9001: 9/9001 = 0.000999888901099..., so 9 - that = 8.9990001110989...;
	// 81000/9030 = 2700/301 = 8.970099667774...;
	// 81000/9100 = 810/91 = 8.901098901098....)
	test("setSupply sweeps the resistive rail through the Thevenin values", () => {
		const program = compileOrThrow(RESISTIVE_DOC);
		const rt = new ReferenceRuntime(program);
		rt.prepare(RATE);
		expect(rt.getSupplies()).toHaveLength(1);
		const info = rt.getSupplies()[0] as SupplyInfo;
		// As compiled, the stamp carries the 1 ohm low-end default.
		expect(info.volts).toBe(9);
		expect(info.sourceOhms).toBe(1);

		const silence = new Float64Array(64);
		for (const r of [0, 1, 30, 100]) {
			rt.setSupply([info.address], 9, r);
			rt.process(silence);
			const expectedRail = (9 * 9000) / (9000 + r);
			const expectedAmps = 9 / (9000 + r);
			expect(Math.abs(railOf(rt, program, info) - expectedRail)).toBeLessThan(1e-9);
			const amps = branchOf(rt, program, info);
			// Delivering supplies read negative by the branch-current convention.
			expect(amps).toBeLessThan(0);
			expect(Math.abs(Math.abs(amps) - expectedAmps)).toBeLessThan(1e-9);
			// getSupplies reports the values the solver now reads.
			const live = rt.getSupplies()[0] as SupplyInfo;
			expect(live.volts).toBe(9);
			expect(live.sourceOhms).toBe(r);
		}
		// One block rebuilt per value applied: four values, four rebuilds.
		expect(rt.supplyRebuilds).toBe(4);
	});

	// Negative control: without setSupply the as-compiled program
	// (sourceOhms 1) sits at the R=1 divider value, not the ideal rail.
	test("as-compiled program without setSupply sits at the 1 ohm divider value", () => {
		const program = compileOrThrow(RESISTIVE_DOC);
		const rt = new ReferenceRuntime(program);
		rt.prepare(RATE);
		rt.process(new Float64Array(64));
		const info = rt.getSupplies()[0] as SupplyInfo;
		// Hand computation: 81000/9001 = 8.9990001110989..., a full millivolt
		// below the ideal 9 V rail -- the compiled 1 ohm default is visible.
		expect(Math.abs(railOf(rt, program, info) - (9 * 9000) / 9001)).toBeLessThan(1e-9);
		expect(rt.supplyRebuilds).toBe(0);
	});

	// Mid-stream: process, setSupply, process again; the second block
	// reflects the new rail. Negative control: writing the Program's stamp fields
	// directly does NOT move the rail, because volts/sourceOhms are baked into
	// the base matrices at prepare().
	test("setSupply takes effect mid-stream; direct Program writes do not", () => {
		const program = compileOrThrow(RESISTIVE_DOC);
		const rt = new ReferenceRuntime(program);
		rt.prepare(RATE);
		const info = rt.getSupplies()[0] as SupplyInfo;

		rt.process(new Float64Array(64));
		// Hand computation: as-compiled 1 ohm gives 81000/9001 = 8.9990001110989....
		expect(Math.abs(railOf(rt, program, info) - (9 * 9000) / 9001)).toBeLessThan(1e-9);

		// Direct mutation of the live Program object: silently ignored, because
		// volts/sourceOhms are baked into the base matrices at prepare().
		setAllProgramSourceOhms(program, 100);
		rt.process(new Float64Array(64));
		// Hand computation: still 81000/9001 = 8.9990001110989..., NOT the 100 ohm
		// value 81000/9100 = 8.901098901....
		expect(Math.abs(railOf(rt, program, info) - (9 * 9000) / 9001)).toBeLessThan(1e-9);

		// Undo the negative-control mutation, then move the rail properly.
		setAllProgramSourceOhms(program, 1);
		rt.setSupply([info.address], 9, 100);
		rt.process(new Float64Array(64));
		// Hand computation: 81000/9100 = 810/91 = 8.901098901098....
		expect(Math.abs(railOf(rt, program, info) - (9 * 9000) / 9100)).toBeLessThan(1e-9);

		rt.setSupply([info.address], 9, 0);
		rt.process(new Float64Array(64));
		// Hand computation: 9*9000/9000 = 9.0 exactly.
		expect(Math.abs(railOf(rt, program, info) - 9)).toBeLessThan(1e-9);
	});

	// Copy on write: two runtimes from one Program never interact, the
	// Program object is unchanged, and a deep-frozen Program does not throw.
	test("two runtimes from one Program are independent; frozen Programs work", () => {
		const program = compileOrThrow(RESISTIVE_DOC);
		const a = new ReferenceRuntime(program);
		const b = new ReferenceRuntime(program);
		a.prepare(RATE);
		b.prepare(RATE);
		const infoA = a.getSupplies()[0] as SupplyInfo;
		const infoB = b.getSupplies()[0] as SupplyInfo;

		a.process(new Float64Array(64));
		b.process(new Float64Array(64));
		// Hand computation: both start at 81000/9001 = 8.9990001110989....
		expect(Math.abs(railOf(a, program, infoA) - (9 * 9000) / 9001)).toBeLessThan(1e-9);
		expect(Math.abs(railOf(b, program, infoB) - (9 * 9000) / 9001)).toBeLessThan(1e-9);

		a.setSupply([infoA.address], 9, 100);
		a.process(new Float64Array(64));
		b.process(new Float64Array(64));
		// Hand computation: A moves to 81000/9100 = 8.901098901... while B stays
		// at 81000/9001 = 8.9990001110989....
		expect(Math.abs(railOf(a, program, infoA) - (9 * 9000) / 9100)).toBeLessThan(1e-9);
		expect(Math.abs(railOf(b, program, infoB) - (9 * 9000) / 9001)).toBeLessThan(1e-9);
		// The caller's Program object still carries the compiled values.
		expect(programSourceOhms(program)).toEqual([1]);

		// A deep-frozen Program: construction, prepare, setSupply and process all
		// work, because the runtime only ever writes its own copies.
		const frozen = deepFreeze(structuredClone(program));
		const f = new ReferenceRuntime(frozen);
		f.prepare(RATE);
		const infoF = f.getSupplies()[0] as SupplyInfo;
		f.setSupply([infoF.address], 9, 100);
		f.process(new Float64Array(64));
		// Hand computation: 81000/9100 = 8.901098901....
		expect(Math.abs(railOf(f, frozen, infoF) - (9 * 9000) / 9100)).toBeLessThan(1e-9);
		expect(f.supplyRebuilds).toBe(1);
	});

	// Addressing on a two-supply program (9 V rail + 5 V reference).
	test("setSupply addresses one rail and leaves the other alone", () => {
		const program = compileOrThrow(TWO_SUPPLY_DOC);
		const rt = new ReferenceRuntime(program);
		rt.prepare(RATE);
		expect(rt.getSupplies()).toHaveLength(2);
		const rail9 = rt.getSupplies().find((s) => s.volts === 9) as SupplyInfo;
		const rail5 = rt.getSupplies().find((s) => s.volts === 5) as SupplyInfo;
		expect(rail9).toBeDefined();
		expect(rail5).toBeDefined();

		rt.process(new Float64Array(64));
		// Hand computation: 9 V rail at 81000/9001 = 8.9990001110989...; 5 V rail at
		// 25000/5001 = 4.999000199960... (5*5000/5001; 5/5001 = 0.000999800040...).
		expect(Math.abs(railOf(rt, program, rail9) - (9 * 9000) / 9001)).toBeLessThan(1e-9);
		expect(Math.abs(railOf(rt, program, rail5) - (5 * 5000) / 5001)).toBeLessThan(1e-9);

		rt.setSupply([rail9.address], 9, 100);
		rt.process(new Float64Array(64));
		// Hand computation: addressed rail moves to 81000/9100 = 8.901098901...
		// while the 5 V rail stays at 25000/5001 = 4.999000199960... to solver
		// tolerance.
		expect(Math.abs(railOf(rt, program, rail9) - (9 * 9000) / 9100)).toBeLessThan(1e-9);
		expect(Math.abs(railOf(rt, program, rail5) - (5 * 5000) / 5001)).toBeLessThan(1e-9);
		expect(rt.supplyRebuilds).toBe(1);

		// An empty address list changes nothing, including the rebuild counter.
		rt.setSupply([], 9, 30);
		rt.process(new Float64Array(64));
		expect(Math.abs(railOf(rt, program, rail9) - (9 * 9000) / 9100)).toBeLessThan(1e-9);
		expect(Math.abs(railOf(rt, program, rail5) - (5 * 5000) / 5001)).toBeLessThan(1e-9);
		expect(rt.supplyRebuilds).toBe(1);
	});

	// Invalid calls: every bad address or value throws RuntimeError and
	// changes NOTHING -- rails, stamps and the rebuild counter included, even for
	// the valid addresses named in the same call.
	test("invalid setSupply calls throw and change nothing", () => {
		const program = compileOrThrow(TWO_SUPPLY_DOC);
		const rt = new ReferenceRuntime(program);
		rt.prepare(RATE);
		const rail9 = rt.getSupplies().find((s) => s.volts === 9) as SupplyInfo;
		const rail5 = rt.getSupplies().find((s) => s.volts === 5) as SupplyInfo;
		rt.setSupply([rail9.address], 9, 100);
		rt.process(new Float64Array(64));
		// Hand computation anchor points: addressed rail at 81000/9100 =
		// 8.901098901..., untouched rail at 25000/5001 = 4.999000199960....
		const anchor9 = (9 * 9000) / 9100;
		const anchor5 = (5 * 5000) / 5001;
		expect(Math.abs(railOf(rt, program, rail9) - anchor9)).toBeLessThan(1e-9);
		const rebuildsBefore = rt.supplyRebuilds;
		const ohmsBefore = programSourceOhms(program);

		const checkUnchanged = (): void => {
			rt.process(new Float64Array(64));
			expect(Math.abs(railOf(rt, program, rail9) - anchor9)).toBeLessThan(1e-9);
			expect(Math.abs(railOf(rt, program, rail5) - anchor5)).toBeLessThan(1e-9);
			expect(rt.supplyRebuilds).toBe(rebuildsBefore);
			expect(programSourceOhms(program)).toEqual(ohmsBefore);
		};

		// Unknown block index.
		expectSupplyThrow(() =>
			rt.setSupply(
				[{ blockIndex: program.blocks.length + 5, sourceIndex: 0 }],
				9,
				30,
			),
		);
		checkUnchanged();

		// A sourceIndex with no dc-source behind it.
		expectSupplyThrow(() =>
			rt.setSupply(
				[{ blockIndex: rail9.address.blockIndex, sourceIndex: 999 }],
				9,
				30,
			),
		);
		checkUnchanged();

		// Negative resistance is gain, not sag.
		expectSupplyThrow(() => rt.setSupply([rail9.address], 9, -1));
		checkUnchanged();

		// Non-finite values.
		expectSupplyThrow(() => rt.setSupply([rail9.address], NaN, 30));
		checkUnchanged();
		expectSupplyThrow(() => rt.setSupply([rail9.address], 9, Infinity));
		checkUnchanged();

		// A valid address paired with an invalid one in the same call: the valid
		// one must not move either (validate all before touching any).
		expectSupplyThrow(() =>
			rt.setSupply(
				[rail9.address, { blockIndex: program.blocks.length + 5, sourceIndex: 0 }],
				9,
				30,
			),
		);
		checkUnchanged();

		// Non-MNA block: a program carrying a macro block refuses supply
		// addressing into it by name.
		const withMacro = {
			...program,
			blocks: [
				...program.blocks,
				{ kind: "macro", id: "fake-macro" } as unknown as Block,
			],
		} as Program;
		const rtMacro = new ReferenceRuntime(withMacro);
		expect(rtMacro.getSupplies()).toHaveLength(2);
		const macroIndex = withMacro.blocks.length - 1;
		expectSupplyThrow(() =>
			rtMacro.setSupply([{ blockIndex: macroIndex, sourceIndex: 0 }], 9, 1),
		);
		expect(rtMacro.getSupplies()).toHaveLength(2);
	});

	// Elimination invalidation: a nonlinear 12-unknown block takes the eliminated
	// path (forced via the constructor option), and the eliminated path must
	// agree with the dense path at every swept value.
	test("eliminated and dense paths agree across the sourceOhms sweep", () => {
		const program = compileOrThrow(TWO_STAGE_BJT_DOC);
		const mna = program.blocks.filter((b) => b.kind === "mna");
		expect(mna).toHaveLength(1);
		const block = mna[0];
		if (block?.kind !== "mna") throw new Error("unreachable");
		// The fixture contract: nonlinear, with 12 or more unknowns.
		expect(block.linear).toBe(false);
		expect(block.nodeCount + block.auxCount).toBeGreaterThanOrEqual(12);

		const denseProgram = structuredClone(program);
		for (const b of denseProgram.blocks) {
			if (b.kind === "mna") (b as { eliminate: boolean }).eliminate = false;
		}
		const elim = new ReferenceRuntime(program, {
			eliminateBlocks: new Set([block.id]),
		});
		const dense = new ReferenceRuntime(denseProgram);
		elim.prepare(RATE);
		dense.prepare(RATE);

		const silence = new Float64Array(512);
		elim.process(silence);
		dense.process(silence);
		const infoElim = elim.getSupplies()[0] as SupplyInfo;
		const infoDense = dense.getSupplies()[0] as SupplyInfo;
		// Both paths start from the same compiled 1 ohm rail.
		expect(
			Math.abs(railOf(elim, program, infoElim) - railOf(dense, denseProgram, infoDense)),
		).toBeLessThan(1e-9);

		for (const r of [0, 1, 30, 100]) {
			elim.setSupply([infoElim.address], 9, r);
			dense.setSupply([infoDense.address], 9, r);
			elim.process(silence);
			dense.process(silence);
			// No hand-computed rail here: the nonlinear load has no closed form.
			// The assertion is path agreement -- the eliminated factorisation was
			// rebuilt from the new values, not reused stale.
			expect(
				Math.abs(railOf(elim, program, infoElim) - railOf(dense, denseProgram, infoDense)),
			).toBeLessThan(1e-9);
		}
	});

	// The idle-rebuild counter: re-applying the values a stamp already
	// has rebuilds nothing.
	test("re-applying identical values leaves supplyRebuilds unchanged", () => {
		const program = compileOrThrow(RESISTIVE_DOC);
		const rt = new ReferenceRuntime(program);
		rt.prepare(RATE);
		const info = rt.getSupplies()[0] as SupplyInfo;
		expect(rt.supplyRebuilds).toBe(0);

		rt.setSupply([info.address], 9, 30);
		expect(rt.supplyRebuilds).toBe(1);
		rt.process(new Float64Array(64));
		// Hand computation: 81000/9030 = 2700/301 = 8.970099667774....
		expect(Math.abs(railOf(rt, program, info) - (9 * 9000) / 9030)).toBeLessThan(1e-9);

		// Same numbers again: no rebuild, rail untouched.
		rt.setSupply([info.address], 9, 30);
		expect(rt.supplyRebuilds).toBe(1);
		rt.process(new Float64Array(64));
		expect(Math.abs(railOf(rt, program, info) - (9 * 9000) / 9030)).toBeLessThan(1e-9);

		// As-compiled values on a fresh runtime are likewise a no-op.
		const fresh = new ReferenceRuntime(program);
		fresh.prepare(RATE);
		const freshInfo = fresh.getSupplies()[0] as SupplyInfo;
		fresh.setSupply([freshInfo.address], 9, 1);
		expect(fresh.supplyRebuilds).toBe(0);
	});

	// Addressing shape contract: SupplyAddress is { blockIndex, sourceIndex }
	// with blockIndex into program.blocks, and getSupplies output feeds setSupply
	// directly.
	test("supply addresses round-trip from getSupplies to setSupply", () => {
		const program = compileOrThrow(TWO_SUPPLY_DOC);
		const rt = new ReferenceRuntime(program);
		const infos = rt.getSupplies();
		expect(infos.length).toBe(2);
		for (const info of infos) {
			const keys = Object.keys(info.address).sort();
			expect(keys).toEqual(["blockIndex", "sourceIndex"]);
			const block = program.blocks[info.address.blockIndex];
			expect(block?.id).toBeDefined();
		}
		const addresses: readonly SupplyAddress[] = infos.map((s) => s.address);
		rt.prepare(RATE);
		// Re-applying a stamp's own compiled values through the round-tripped
		// address is a no-op: nothing to rebuild.
		const rail9 = infos.find((s) => s.volts === 9) as SupplyInfo;
		rt.setSupply([rail9.address], rail9.volts, rail9.sourceOhms);
		expect(rt.supplyRebuilds).toBe(0);
		expect(addresses).toHaveLength(2);
	});
});
