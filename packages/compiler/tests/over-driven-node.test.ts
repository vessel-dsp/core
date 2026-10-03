import { describe, expect, test } from "bun:test";
import { stampControl, stampNeedsNewton } from "../src/lower";
import { findOverDrivenNodes } from "../src/over-driven-node";
import { computeSparseSchedule } from "../src/sparse-schedule";
import { computeStampPartition } from "../src/stamp-partition";
import type { Program, Stamp } from "../src/types";

// Program literals rather than `.vdsp` fixtures, because the rule reads **lowered stamps** and
// that is the whole point of it: `boss-sd-1` declares two supply devices on one node and
// lowering collapses them into a single `dc-source`, so a netlist-level version of this check
// reported a redundant declaration as a contradiction. Only the stamps can say whether two
// sources really force one unknown.
//
// The exclusions matter as much as the detections. A transistor collector and a supply return
// both sit on driven nodes legitimately, and flagging either would make this warning noise.

function program(stamps: readonly Stamp[], blocks = 1): Program {
	const ids = Array.from({ length: blocks }, (_, i) => `analog:${i}`);
	const madeBlocks = ids.map((id, index) => {
		const blockStamps = index === 0 ? stamps : [];
		return {
			kind: "mna" as const,
			id,
			nodeCount: 40,
			// Identity numbering: these fixtures name nodes directly, so a row and its source id
			// coincide here. Real blocks get theirs from `lowerRegion`.
			nodeIds: Array.from({ length: 40 }, (_, node) => node),
			auxCount: 4,
			// Every stamp goes in the first block unless a test asks for more.
			stamps: blockStamps,
			stampPartition: computeStampPartition(blockStamps, 40),
			sparseSchedule: computeSparseSchedule({
				nodeCount: 40,
				auxCount: 4,
				stamps: blockStamps,
			}),
			stateCount: 0,
			// Derived as `lower` derives them, for the same reason as the operator set above:
			// a literal that hardcoded these could describe a block its own stamps contradict.
			linear: index === 0 ? !stamps.some(stampNeedsNewton) : true,
			controlFree:
				index === 0
					? stamps.every((stamp) => stampControl(stamp) === null)
					: true,
			eliminate: false,
			inputNode: 1,
			outputNode: index === 0 ? 2 : null,
			operatingPointSeeds: [],
		};
	});
	return {
		formatVersion: 6,
		// Declared from the stamps, as `link` does, so the literal cannot claim an operator
		// set the blocks below do not use.
		requiredOperators: [...new Set(stamps.map((stamp) => stamp.kind))].sort(),
		// Empty for the same reason, not by omission: these blocks are all `mna`, so there is
		// no macro model for a runtime to implement.
		requiredModels: [],
		// Declared from the same blocks, as `link`'s own `costPredictors` does.
		costPredictors: {
			executedBlockCount: madeBlocks.length,
		macroBlocks: [],
			stateCount: madeBlocks.reduce((sum, block) => sum + block.stateCount, 0),
			solvedBlocks: madeBlocks.map((block) => ({
				blockId: block.id,
				unknownCount: block.nodeCount + block.auxCount,
				linear: block.linear,
			})),
		},
		blocks: madeBlocks,
		order: ids,
		controls: [],
		ports: { input: 1, output: 2 },
		// Derived from the stamps, as `link` does: these fixtures declare no `dc-source`, so
		// the honest value is `unpowered` rather than a default that claims a supply.
		supplyReference: "unpowered",
		// Derived from the stamps as `link` does: no `dc-source` here, so no bound exists.
		portFullScaleVolts: { input: null, output: null },
		// No transformer and no high-voltage winding in these fixtures, so the honest value is
		// the least-processed one rather than a default that claims an amp stage.
		stageCoverage: "instrument",
		portImpedanceOhms: { input: null, output: null },
		portReferenceVolts: { input: null, output: null },
		bypass: { declared: "none" },
	};
}

const opampAt = (output: number, sourceIndex: number): Stamp => ({
	kind: "ideal-opamp",
	plus: 10,
	minus: 11,
	output,
	openLoopGain: 1e5,
	railHigh: 9,
	railLow: 0,
	sourceIndex,
});

const supplyAt = (positive: number, sourceIndex: number): Stamp => ({
	kind: "dc-source",
	positive,
	negative: 0,
	volts: 9,
	sourceIndex,
	sourceOhms: 0,
});

const clockVggAt = (vgg: number, sourceIndex: number): Stamp => ({
	kind: "clock-driver",
	cp1: 30,
	cp2: 31,
	vgg,
	vdd: 32,
	ox1: 33,
	gnd: 0,
	defaultFrequency: 10000,
	stateIndex: 0,
	sourceIndex,
});

const codes = (p: Program) => findOverDrivenNodes(p).map((w) => w.code);

describe("findOverDrivenNodes", () => {
	test("flags two op-amp outputs on one node", () => {
		const found = findOverDrivenNodes(
			program([opampAt(20, 0), opampAt(20, 1)]),
		);
		expect(found).toHaveLength(1);
		expect(found[0]?.code).toBe("node-driven-by-two-sources");
		// Both offenders are named: knowing only one does not locate the conflict, and a stamp
		// carries no device id, so the auxiliary index is the most specific label available.
		expect(found[0]?.detail).toContain("ideal-opamp#0");
		expect(found[0]?.detail).toContain("ideal-opamp#1");
	});

	test("flags a supply and an op-amp output on one node", () => {
		// The `boss-pq-4` shape: a declared reference rail with a buffer also driving it.
		expect(codes(program([supplyAt(20, 0), opampAt(20, 1)]))).toEqual([
			"node-driven-by-two-sources",
		]);
	});

	test("flags a declared rail fighting a clock driver's VGG output", () => {
		// The `boss-ce-5` shape: a 7.5 V rail and the MN3102's VGG pin on one node.
		const found = findOverDrivenNodes(program([supplyAt(20, 0), clockVggAt(20, 1)]));
		expect(found).toHaveLength(1);
		expect(found[0]?.code).toBe("node-driven-by-two-sources");
		expect(found[0]?.detail).toContain("clock-driver-vgg#1");
	});

	test("a clock VGG on its own node is not a fight", () => {
		expect(codes(program([supplyAt(20, 0), clockVggAt(21, 1)]))).toEqual([]);
	});

	test("accepts every source on its own node", () => {
		expect(codes(program([opampAt(20, 0), opampAt(21, 1)]))).toEqual([]);
	});

	test("does not count a conductance as a driver", () => {
		// Stands for every element that is not an ideal source: a transistor collector, a
		// resistor, a capacitor. None of them force a node's voltage.
		const withPassive = program([
			opampAt(20, 0),
			{ kind: "conductance", a: 20, b: 0, siemens: 1e-3 },
		]);
		expect(codes(withPassive)).toEqual([]);
	});

	test("does not count a supply's return as a driver", () => {
		// Two supplies returning to the same node is every grounded circuit.
		expect(codes(program([supplyAt(20, 0), supplyAt(21, 1)]))).toEqual([]);
	});

	test("ignores ground, which every source returns to", () => {
		expect(codes(program([opampAt(0, 0), opampAt(0, 1)]))).toEqual([]);
	});

	test("does not flag the same node id across independent regions", () => {
		// Regions are separate solves, so node 20 in one is a different unknown from node 20
		// in another. Both blocks here hold one driver each.
		const split = program([opampAt(20, 0)], 2);
		const blocks = split.blocks.map((b, i) =>
			b.kind === "mna" && i === 1 ? { ...b, stamps: [opampAt(20, 1)] } : b,
		);
		expect(codes({ ...split, blocks })).toEqual([]);
	});
});
