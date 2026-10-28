// The `power-amp` device law: a fixed-gain single-supply stage whose gain is set by the
// printed resistor network and programmed by the impedance across pins 1 and 8.
//
// The contract, against synthetic parts and fixtures this test owns (no scraped pedal is
// asserted anywhere): the closed-loop gain lands on the printed points (20.0 / 200.0) to
// 0.1 dB, swapping the input pins flips the phase 180 degrees, a mistyped gain-set
// resistor fails the printed points (a control that has only ever said yes proves
// nothing), a document that orders the chip differently binds no section, the entry's
// gain-bandwidth product reaches the follower stamp, and the shipping LM386 rows resolve
// by exact id (bare LM386 by stated alias; JRC386D as the owner-decided NJM386D marking).

import { describe, expect, it } from "bun:test";
import { compile } from "../src/compile";
import {
	pedalPartCatalog,
	powerAmpEntry,
} from "../src/part-catalog";
import { powerAmpRegistryRecords } from "../src/registry-data/poweramp";
import { registryEntryFor } from "../src/registry";
import type { PartRegistry } from "../src/registry";
import { ReferenceRuntime } from "../../runtime/src/reference-runtime";
import type { Program } from "../src/types";

const RATE = 48000;
const OS = 4;
const SETTLE = 0.05;
const WINDOW = 0.12;

const GROUPS: readonly (readonly string[])[] = [
	["gain1", "g1", "pin1", "power"],
	["vin-", "vinminus", "in-", "inminus", "inverting", "minus", "pin2"],
	["vin+", "vinplus", "in+", "inplus", "noninverting", "plus", "pin3"],
	["gnd", "ground", "vee", "pin4", "power"],
	["vout", "out", "output", "pin5"],
	["vs", "vcc", "vplus", "supply", "pin6", "power"],
	["bypass", "pin7", "power"],
	["gain8", "g8", "pin8"],
];
const PINOUT = ["gain1", "inverting", "noninverting", "gnd", "out", "vcc", "bypass", "gain8"] as const;

function registryWith(gainSetOhms = 1350, gbwHz: number | undefined = 300000): PartRegistry {
	return {
		entries: [
			{
				partIds: ["FIXTURE-PA"],
				declaredTypes: [],
				terminalRoleGroups: GROUPS,
				model: {
					kind: "sections",
					pinout: [...PINOUT],
					sections: [
						{
							law: {
								kind: "power-amp",
								railHigh: null,
								railLow: null,
								openLoopGain: 100000,
								feedbackOhms: 15000,
								gainSetOhms,
								degenerationOhms: 150,
								inputShuntOhms: 50000,
								bypassUpperOhms: 15000,
								...(gbwHz === undefined ? {} : { gainBandwidthHz: gbwHz }),
							},
							terminals: [0, 1, 2, 3, 4, 5, 6, 7],
						},
					],
				},
			},
		],
	};
}

const comp = (
	id: string,
	kind: string,
	name: string,
	typeName: string,
	terminals: ReadonlyArray<readonly [string, number]>,
	extraProps = "",
) => `  - id: ${id}
    kind: ${kind}
    name: ${name}
    sourceTypeName: ${typeName}
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
${terminals.map(([tname, node]) => `      - name: ${tname}
        node: ${node}
        position:
          x: 0
          y: 0`).join("\n")}
${extraProps}`;

const props = (lines: string) => `    properties:
${lines}\n`;

function fixture(options: {
	supplyVolts?: number;
	pin2node?: number;
	pin3node?: number;
	gainCap?: boolean;
	partId?: string;
	terminalNames?: readonly string[];
} = {}): string {
	const {
		supplyVolts = 6,
		pin2node = 0,
		pin3node = 3,
		gainCap = false,
		partId = "FIXTURE-PA",
		terminalNames = ["gain1", "inverting", "noninverting", "gnd", "out", "vcc", "bypass", "gain8"],
	} = options;
	const u1terminals = terminalNames.map(
		(tname, index) => [tname, [5, pin2node, pin3node, 0, 4, 9, 7, 6][index] as number] as const,
	);
	const parts = [
		comp("JIN", "jack", "INPUT", "Circuit.Input", [["tip", 3]]),
		comp("JOUT", "jack", "OUTPUT", "Circuit.Output", [["tip", 2]]),
		comp("GND1", "ground", "GND", "Circuit.Ground", [["terminal", 0]]),
		comp("VSUP", "voltage-source", "VSUP", "Circuit.VoltageSource", [
			["plus", 9],
			["minus", 0],
		], props(`      Voltage: "${supplyVolts}"`)),
		comp("U1", "ic", "U1", "Circuit.LM386", u1terminals, props(`      PartNumber: "${partId}"`)),
		comp("CBYP", "capacitor", "CBYP", "Circuit.Capacitor", [["a", 7], ["b", 0]], props(`      Capacitance: "10u"`)),
		comp("COUT", "capacitor", "COUT", "Circuit.Capacitor", [["a", 4], ["b", 2]], props(`      Capacitance: "250u"`)),
		comp("RL", "resistor", "RL", "Circuit.Resistor", [["a", 2], ["b", 0]], props(`      Resistance: "8"`)),
		...(gainCap
			? [comp("CGAIN", "capacitor", "CGAIN", "Circuit.Capacitor", [["a", 5], ["b", 6]], props(`      Capacitance: "10u"`))]
			: []),
	];
	return `schema: circuit-interchange/v3
metadata:
  name: "Power-amp control"
  description: "Datasheet test circuit."
  partNumber: ""
source:
  format: vdsp
  filename: power-amp-control.vdsp
components:
${parts.join("")}wires: []
`;
}

function stimulus(hz: number, amp: number): Float64Array {
	const len = Math.round(RATE * (SETTLE + WINDOW));
	const input = new Float64Array(len);
	for (let i = 0; i < len; i += 1) input[i] = amp * Math.sin((2 * Math.PI * hz * i) / RATE);
	return input;
}

function fundamentalCx(output: ArrayLike<number>, hz: number): { mag: number; phaseDeg: number } {
	const n = output.length;
	let cs = 0;
	let ss = 0;
	for (let i = 0; i < n; i += 1) {
		cs += (output[i] ?? 0) * Math.cos((2 * Math.PI * hz * i) / RATE);
		ss += (output[i] ?? 0) * Math.sin((2 * Math.PI * hz * i) / RATE);
	}
	const mag = (2 * Math.hypot(cs, ss)) / n;
	return { mag, phaseDeg: (Math.atan2(ss, cs) * 180) / Math.PI };
}

function renderDb(program: Program, hz: number, amp: number): { db: number; phase: number } {
	const runtime = new ReferenceRuntime(program as never);
	(runtime as unknown as { prepare: (r: number, o: unknown) => void }).prepare(RATE, { oversample: OS });
	const out = (runtime as unknown as { process: (i: Float64Array) => Float64Array }).process(stimulus(hz, amp));
	const f = fundamentalCx(out.subarray(Math.round(RATE * SETTLE)), hz);
	return { db: 20 * Math.log10(f.mag / amp), phase: f.phaseDeg };
}

function compileOk(source: string, registry: PartRegistry): Program {
	const result = compile(source, { registry }) as unknown as {
		status: string;
		program: Program;
		warnings: unknown[];
	};
	if (result.status !== "ok") throw new Error(`fixture did not compile: ${result.status}`);
	return result.program;
}

// The printed closed-loop gains as linear ratios (TI SNAS545D p5, NJR databook p5-2:
// 26 dB / 46 dB TYP at VS = 6 V, f = 1 kHz, pins open / 10 uF across pins 1-8).
const AV_OPEN = 20;
const AV_SHORT = 200;
const TOL_DB = 0.1;

describe("power-amp law: printed gains", () => {
	it("lands gain 20 with pins 1-8 open", () => {
		const program = compileOk(fixture(), registryWith());
		const { db } = renderDb(program, 1000, 0.05);
		expect(Math.abs(db - 20 * Math.log10(AV_OPEN))).toBeLessThan(TOL_DB);
	});
	it("lands gain 200 with 10 uF across pins 1-8", () => {
		const program = compileOk(fixture({ gainCap: true }), registryWith());
		const { db } = renderDb(program, 1000, 0.005);
		expect(Math.abs(db - 20 * Math.log10(AV_SHORT))).toBeLessThan(TOL_DB);
	});
	it("follows the closed form between the printed points (1.2 k in series)", () => {
		// Av(R) = 2*15k/(150 + 1350*R/(1350+R)); R = 1200 -> 2*15000/(150+635) = 38.2x.
		const expected = (2 * 15000) / (150 + (1350 * 1200) / (1350 + 1200));
		const src = fixture({ gainCap: false }).replace(
			"wires: []",
			`  - id: RGSET
    kind: resistor
    name: RGSET
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 5
        position:
          x: 0
          y: 0
      - name: b
        node: 6
        position:
          x: 0
          y: 0
    properties:
      Resistance: "1.2k"
wires: []`,
		);
		const program = compileOk(src, registryWith());
		const { db } = renderDb(program, 1000, 0.02);
		expect(Math.abs(db - 20 * Math.log10(expected))).toBeLessThan(0.15);
	});
	it("inverts the phase (not the magnitude) when pins 2 and 3 are swapped", () => {
		const reg = registryWith();
		const ok = renderDb(compileOk(fixture(), reg), 1000, 0.05);
		const swapped = renderDb(compileOk(fixture({ pin2node: 3, pin3node: 0 }), reg), 1000, 0.05);
		expect(Math.abs(ok.db - swapped.db)).toBeLessThan(0.5);
		expect(Math.abs(Math.abs(ok.phase - swapped.phase) - 180)).toBeLessThan(5);
	});
	it("a mistyped gain-set resistor fails the printed points (negative control)", () => {
		// Rgs = 13.5k: Av = 2*15k/(150+13500) = 2.198x = 6.84 dB, not 26.02 dB.
		const expected = (2 * 15000) / (150 + 13500);
		const program = compileOk(fixture(), registryWith(13500));
		const { db } = renderDb(program, 1000, 0.05);
		expect(Math.abs(db - 20 * Math.log10(expected))).toBeLessThan(0.15);
		expect(Math.abs(db - 20 * Math.log10(AV_OPEN))).toBeGreaterThan(10);
	});
});

describe("power-amp law: pinout guard", () => {
	it("refuses a differently-ordered declaration by name (no silent mis-wire)", () => {
		// Eight terminals in a rotated order with opaque names: neither the role
		// bijection nor the pinout check can bind them, so no power-amp stamps land.
		const program = compileOk(
			fixture({ terminalNames: ["a", "b", "c", "d", "e", "f", "g", "h"] }),
			registryWith(),
		);
		const vccs = (program.blocks as ReadonlyArray<{ kind: string; stamps?: ReadonlyArray<{ kind: string }> }>)
			.filter((b) => b.kind === "mna")
			.flatMap((b) => b.stamps ?? [])
			.filter((s) => s.kind === "vccs");
		expect(vccs).toHaveLength(0);
	});
	it("refuses pin-numbered declarations by name (no silent positional bind)", () => {
		// Bare pin numbers carry no role tokens, so the pinout guard cannot verify the
		// order: the entry refuses (open chip, named warning) rather than stamping a
		// possibly mis-wired chip.
		const result = compile(
			fixture({ terminalNames: ["pin1", "pin2", "pin3", "pin4", "pin5", "pin6", "pin7", "pin8"] }),
			{ registry: registryWith() },
		) as unknown as { status: string; warnings: Array<{ code: string; reason?: string }>; program: Program };
		expect(result.status).toBe("ok");
		expect(result.warnings.some((w) => w.code === "ic-not-executed")).toBe(true);
		const vccs = (
			result.program.blocks as ReadonlyArray<{ kind: string; stamps?: ReadonlyArray<{ kind: string }> }>
		)
			.filter((block) => block.kind === "mna")
			.flatMap((block) => block.stamps ?? [])
			.filter((stamp) => stamp.kind === "vccs");
		expect(vccs).toHaveLength(0);
	});
});

describe("power-amp law: entry and registry", () => {
	it("builds entries from every power-amp record", () => {
		expect(powerAmpRegistryRecords.length).toBeGreaterThan(0);
		for (const record of powerAmpRegistryRecords) {
			const entry = powerAmpEntry(record);
			expect(entry.model.kind).toBe("sections");
			if (entry.model.kind !== "sections") continue;
			expect(entry.model.sections).toHaveLength(1);
			expect(entry.model.sections[0]?.law.kind).toBe("power-amp");
		}
	});
	it("resolves the printed TI ids and the bare-LM386 alias by exact id", () => {
		for (const id of ["LM386N-1", "LM386N-4", "LM386M-1", "LM386"]) {
			const entry = registryEntryFor(pedalPartCatalog, { partId: id, evidence: "exact-part" });
			expect(entry?.model.kind).toBe("sections");
			if (entry?.model.kind !== "sections") continue;
			expect(entry.model.sections[0]?.law.kind).toBe("power-amp");
		}
	});
	it("resolves the printed NJR ids", () => {
		const entry = registryEntryFor(pedalPartCatalog, { partId: "NJM386D", evidence: "exact-part" });
		expect(entry?.model.kind).toBe("sections");
	});
	it("resolves JRC386D to the NJM386D row (owner marking alias, not a maker statement)", () => {
		const jrc = registryEntryFor(pedalPartCatalog, { partId: "JRC386D", evidence: "exact-part" });
		const njm = registryEntryFor(pedalPartCatalog, { partId: "NJM386D", evidence: "exact-part" });
		expect(jrc).not.toBeNull();
		expect(jrc).toBe(njm);
	});
	it("still leaves an unlisted look-alike unresolved (the alias is an exact id, not a prefix)", () => {
		for (const id of ["JRC386", "JRC386M", "NJM386", "LM386D"]) {
			expect(registryEntryFor(pedalPartCatalog, { partId: id, evidence: "exact-part" })).toBeNull();
		}
	});
	it("carries the record's gain-bandwidth product to the follower stamp", () => {
		const program = compileOk(fixture({ partId: "LM386N-1" }), {
			entries: pedalPartCatalog.entries,
		});
		const followers = (
			program.blocks as ReadonlyArray<{ kind: string; stamps?: ReadonlyArray<Record<string, unknown>> }>
		)
			.filter((b) => b.kind === "mna")
			.flatMap((b) => b.stamps ?? [])
			.filter((s) => s.kind === "ideal-opamp");
		expect(followers.length).toBeGreaterThan(0);
		for (const follower of followers) {
			expect(follower["gainBandwidthHz"]).toBe(300000);
		}
	});
	it("names the missing swing pair and the stated product in the compile warnings", () => {
		const result = compile(fixture({ partId: "LM386N-1" }), {
			registry: { entries: pedalPartCatalog.entries },
		}) as unknown as { status: string; warnings: Array<{ code: string }> };
		expect(result.status).toBe("ok");
		const codes = result.warnings.map((w) => w.code);
		expect(codes).toContain("opamp-law-default-parameters");
		expect(codes).not.toContain("opamp-gain-bandwidth-default");
	});
});
