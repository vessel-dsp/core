// uPC1252H2 dbx-style VCA law + BA718 9-pin dual admission: catalog-to-stamp contracts.
//
// Outcome contracts, not routes: whatever resolution path the compiler takes, the section
// terminals must land on the document's nodes with the catalog's numbers, or the VCA is
// silently dropped (which renders as no compression) and the dual op-amp as half a chip.
// The bare-pin route the `Cell` fixtures take (positional, because bare `pinN` names fold
// to null role tokens) is documented on the catalog entries, not here -- these tests must
// keep passing if the route improves (for example typed control/com roles from a packet).

import { describe, expect, it } from "bun:test";
import { compile } from "../src/compile";
import {
	ba718DualCell,
	ba718SingleCell,
	dbxVcaCell,
	dbxVcaNamedCell,
} from "../src/fixtures/circuits";
import { pedalPartCatalog } from "../src/part-catalog";
import type { Block } from "../src/types";

function okProgram(source: string) {
	const result = compile(source, { registry: pedalPartCatalog });
	expect(result.status).toBe("ok");
	if (result.status !== "ok") return null;
	return result;
}

function mnaBlockContaining(
	result: Extract<ReturnType<typeof compile>, { status: "ok" }>,
	node: number,
): Extract<Block, { kind: "mna" }> {
	const block = result.program.blocks.find(
		(b) => b.kind === "mna" && b.nodeIds.includes(node),
	);
	if (block?.kind !== "mna") throw new Error(`expected an mna block on node ${node}`);
	return block;
}

describe("uPC1252H2 dbx-vca section lands its pins on the right nodes", () => {
	it("bare-pin 8-terminal shell stamps plus/minus/output/control positionally", () => {
		const result = okProgram(dbxVcaCell(4.5));
		if (result === null) return;
		const block = mnaBlockContaining(result, 5);
		const vca = block.stamps.find((s) => s.kind === "dbx-vca");
		if (vca?.kind !== "dbx-vca") throw new Error("expected dbx-vca stamp");
		const row = (source: number): number => {
			const index = block.nodeIds.indexOf(source);
			if (index === -1) throw new Error(`source node ${source} missing`);
			return index;
		};
		// Canonical positions [0, 5, 7, 2]: in = pin1, ref = pin6 (GND),
		// out = pin8, control = pin3 (GC1).
		expect(vca.plus).toBe(row(3)); // pin1 IN
		expect(vca.minus).toBe(row(0)); // pin6 GND
		expect(vca.output).toBe(row(4)); // pin8 OUT
		expect(vca.control).toBe(row(5)); // pin3 GC1
		expect(vca.inputSiemens).toBeCloseTo(0.01, 8);
		expect(vca.vrefVolts).toBeCloseTo(4.66, 8);
		expect(vca.attackSeconds).toBeCloseTo(0.0005, 8);
		expect(vca.releaseSeconds).toBeCloseTo(0.05, 8);
		expect(vca.minGainDb).toBeCloseTo(-30, 8);
		expect(vca.maxGainDb).toBeCloseTo(30, 8);
		expect(vca.stateIndex).toBeGreaterThanOrEqual(0);
	});

	it("LM-2-style named shell binds the same law by role with no positional warning", () => {
		// `boss-lm-2`'s `IC1_UPC1252H2` spells its pins with role suffixes; the entry's
		// groups resolve every one, so this must bind by clean role bijection (and the
		// `unverified-pinout-binding` warning must not fire for it) even though the
		// entry's pinout stays all-null for the bare-pin packets.
		const result = okProgram(dbxVcaNamedCell(4.5));
		if (result === null) return;
		const block = mnaBlockContaining(result, 5);
		const vca = block.stamps.find((s) => s.kind === "dbx-vca");
		if (vca?.kind !== "dbx-vca") throw new Error("expected dbx-vca stamp");
		const row = (source: number): number => {
			const index = block.nodeIds.indexOf(source);
			if (index === -1) throw new Error(`source node ${source} missing`);
			return index;
		};
		expect(vca.plus).toBe(row(3));
		expect(vca.minus).toBe(row(0));
		expect(vca.output).toBe(row(4));
		expect(vca.control).toBe(row(5));
		expect(
			result.warnings.some(
				(w) => w.code === "unverified-pinout-binding" && w.device === "U1",
			),
		).toBe(false);
	});
});

describe("BA718 9-pin dual admission", () => {
	it("expands to two ideal-opamp sections instead of opening on arity", () => {
		const result = okProgram(ba718DualCell());
		if (result === null) return;
		const reasons = result.warnings.filter((w) => w.code === "ic-not-executed");
		expect(reasons.filter((w) => w.device === "U1")).toEqual([]);
		const block = mnaBlockContaining(result, 4);
		const opamps = block.stamps.filter((s) => s.kind === "ideal-opamp");
		expect(opamps.length).toBe(2);
		const row = (source: number): number => {
			const index = block.nodeIds.indexOf(source);
			if (index === -1) throw new Error(`source node ${source} missing`);
			return index;
		};
		// Section 4a [+, -, out] = [pin4, pin3, pin2] = nodes [3, 4, 4];
		// section 4b [+, -, out] = [pin6, pin7, pin8] = nodes [4, 5, 5].
		const byPlus = new Map(opamps.map((s) => [s.kind === "ideal-opamp" ? s.plus : -1, s]));
		const a = byPlus.get(row(3));
		if (a?.kind !== "ideal-opamp") throw new Error("expected channel-A op-amp on node 3");
		expect(a.minus).toBe(row(4));
		expect(a.output).toBe(row(4));
		const b = byPlus.get(row(4));
		if (b?.kind !== "ideal-opamp") throw new Error("expected channel-B op-amp on node 4");
		expect(b.minus).toBe(row(5));
		expect(b.output).toBe(row(5));
	});

	it("keeps the older 5-pin single-section shape working", () => {
		// The pre-retrace capture declares only channel 1's five pins; the 9-pin entry
		// above must not shadow it (identify tells the two apart by arity).
		const result = okProgram(ba718SingleCell());
		if (result === null) return;
		// (Node 4 is unwired in the single-section cell; the stage lives on 3 and 5.)
		expect(
			result.warnings.filter(
				(w) => w.code === "ic-not-executed" && w.device === "U1",
			),
		).toEqual([]);
		const block = mnaBlockContaining(result, 5);
		const opamps = block.stamps.filter((s) => s.kind === "ideal-opamp");
		expect(opamps.length).toBe(1);
	});
});
