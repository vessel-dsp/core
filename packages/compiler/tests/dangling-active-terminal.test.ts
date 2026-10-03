import { describe, expect, test } from "bun:test";
import { findDanglingActiveTerminals } from "../src/dangling-active-terminal";
import { stampControl, stampNeedsNewton } from "../src/lower";
import { computeSparseSchedule } from "../src/sparse-schedule";
import { computeStampPartition } from "../src/stamp-partition";
import type { Program, Stamp } from "../src/types";

// Program literals, because the rule reads lowered stamps. The exclusions carry as much weight as
// the detections: a passive dangling end is usually deliberate, and a general dangling-terminal
// rule was measured and rejected for exactly that reason.

function program(stamps: readonly Stamp[], blocks = 1): Program {
	const ids = Array.from({ length: blocks }, (_, i) => `analog:${i}`);
	const madeBlocks = ids.map((id, index) => {
		const blockStamps = index === 0 ? stamps : [];
		const maxAuxIndex = blockStamps.reduce(
			(max, s) =>
				"sourceIndex" in s
					? Math.max(max, (s as { sourceIndex: number }).sourceIndex)
					: max,
			-1,
		);
		const auxCount = Math.max(4, maxAuxIndex + 1);
		return {
			kind: "mna" as const,
			id,
			nodeCount: 40,
			// Identity numbering: these fixtures name nodes directly, so a row and its source id
			// coincide here. Real blocks get theirs from `lowerRegion`.
			nodeIds: Array.from({ length: 40 }, (_, node) => node),
			auxCount,
			stamps: blockStamps,
			stampPartition: computeStampPartition(blockStamps, 40),
			sparseSchedule: computeSparseSchedule({
				nodeCount: 40,
				auxCount,
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

const bjt = (base: number, collector: number, emitter: number): Stamp => ({
	kind: "bjt",
	base,
	collector,
	emitter,
	polarity: "npn",
	leakageAmps: 0,
	saturationCurrent: 1e-14,
	forwardBeta: 100,
	reverseBeta: 1,
	thermalVoltage: 0.025,
});

const resistor = (a: number, b: number): Stamp => ({
	kind: "conductance",
	a,
	b,
	siemens: 1e-3,
});

const codes = (p: Program) => findDanglingActiveTerminals(p).map((w) => w.code);

describe("findDanglingActiveTerminals", () => {
	test("flags a transistor collector that no other element touches", () => {
		// `tycobrahe-octavia`'s shape: base and emitter wired, collector reaching nothing, so the
		// stage cannot conduct and the pedal renders silence rather than failing.
		const found = findDanglingActiveTerminals(
			program([bjt(10, 20, 0), resistor(10, 11)]),
		);
		expect(found).toHaveLength(1);
		expect(found[0]?.code).toBe("active-device-terminal-unwired");
		expect(found[0]?.detail).toContain("collector on node 20");
	});

	test("accepts a transistor whose every terminal is shared", () => {
		const wired = program([bjt(10, 20, 0), resistor(10, 11), resistor(20, 12)]);
		expect(codes(wired)).toEqual([]);
	});

	test("does not flag a dangling passive end", () => {
		// The rejected general rule flagged 2020 of these. A resistor with a free end is a test
		// point or an unpopulated position far more often than it is a defect.
		expect(codes(program([resistor(10, 20)]))).toEqual([]);
	});

	test("ignores ground, which every device returns to", () => {
		// Two transistors sharing only ground: their emitters are on node 0 and must not count.
		const grounded = program([
			bjt(10, 11, 0),
			resistor(10, 12),
			resistor(11, 13),
		]);
		expect(codes(grounded)).toEqual([]);
	});

	test("does not confuse an auxiliary index with a node", () => {
		// The bug this pins: collecting every small integer field counted `sourceIndex` as a node
		// touch, so an op-amp with `sourceIndex: 20` hid a dangling collector on node 20.
		const withOpamp = program([
			bjt(10, 20, 0),
			resistor(10, 11),
			{
				kind: "ideal-opamp",
				plus: 30,
				minus: 31,
				output: 32,
				openLoopGain: 1e5,
				railHigh: 9,
				railLow: 0,
				sourceIndex: 20,
			},
			resistor(30, 33),
			resistor(31, 34),
			resistor(32, 35),
		]);
		expect(codes(withOpamp)).toEqual(["active-device-terminal-unwired"]);
		expect(findDanglingActiveTerminals(withOpamp)[0]?.detail).toContain(
			"collector on node 20",
		);
	});

	test("counts fan-out per block, since regions solve independently", () => {
		// Node 20 appears in both regions. They are different unknowns, so the transistor's
		// collector is still dangling in its own block.
		const split = program([bjt(10, 20, 0), resistor(10, 11)], 2);
		const blocks = split.blocks.map((b, i) =>
			b.kind === "mna" && i === 1 ? { ...b, stamps: [resistor(20, 21)] } : b,
		);
		expect(codes({ ...split, blocks })).toEqual([
			"active-device-terminal-unwired",
		]);
	});
});
