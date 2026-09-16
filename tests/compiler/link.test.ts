// Stage 6 contract: ordering and program assembly.

import { describe, expect, it } from "bun:test";
import { LinkError, link } from "@vessel-dsp/compiler";
import { stampControl, stampNeedsNewton } from "@vessel-dsp/compiler";
import { computeSparseSchedule } from "@vessel-dsp/compiler";
import { computeStampPartition } from "@vessel-dsp/compiler";
import type { Block, Control, Partitioning, Ports, Stamp } from "@vessel-dsp/compiler";

const ports: Ports = { input: 1, output: 2 };
const controls: readonly Control[] = [
	{ id: "Level", taper: "logarithmic", defaultPosition: 0.5 },
];

function mnaBlock(id: string, stamps: readonly Stamp[] = []): Block {
	return {
		kind: "mna",
		id,
		nodeCount: 3,
		// Identity numbering: this fixture names nodes directly, so a row and its source id
		// coincide here. Real blocks get theirs from `lowerRegion`.
		nodeIds: [0, 1, 2],
		auxCount: 1,
		stamps,
		stampPartition: computeStampPartition(stamps, 3),
		sparseSchedule: computeSparseSchedule({
			nodeCount: 3,
			auxCount: 1,
			stamps,
		}),
		stateCount: 0,
		// Derived as `lower` derives them, so a block literal cannot claim a solver cost or a
		// control independence its own stamps contradict.
		linear: !stamps.some(stampNeedsNewton),
		controlFree: stamps.every((stamp) => stampControl(stamp) === null),
		eliminate: false,
		inputNode: 1,
		outputNode: 2,
		operatingPointSeeds: [],
	};
}

/** A region owning neither jack: solved every sample and its answer discarded. */
function unportedBlock(id: string): Block {
	return {
		...(mnaBlock(id) as Extract<Block, { kind: "mna" }>),
		inputNode: null,
		outputNode: null,
	};
}

function macroBlock(id: string): Block {
	return {
		kind: "macro",
		id,
		modelId: "bucket-brigade-delay-line",
		parameters: {},
		audioIn: null,
		audioOut: false,
		parameter: null,
	};
}

const noDependencies = {
	regions: [],
	dependencies: {},
} as unknown as Partitioning;

describe("link", () => {
	it("runs a region before the macro model that depends on it", () => {
		const blocks = [mnaBlock("macro:U1"), mnaBlock("analog:0")];
		const partitioning = {
			regions: [],
			dependencies: { "macro:U1": ["analog:0"], "analog:0": [] },
		} as unknown as Partitioning;
		const program = link(blocks, partitioning, controls, ports);
		expect(program.order.indexOf("analog:0")).toBeLessThan(
			program.order.indexOf("macro:U1"),
		);
	});

	it("carries the controls, including their tapers", () => {
		const partitioning = {
			regions: [],
			dependencies: { a: [] },
		} as unknown as Partitioning;
		const program = link([mnaBlock("a")], partitioning, controls, ports);
		expect(program.controls[0]?.taper).toBe("logarithmic");
	});

	it("carries no sample rate, by construction", () => {
		const partitioning = {
			regions: [],
			dependencies: { a: [] },
		} as unknown as Partitioning;
		const program = link([mnaBlock("a")], partitioning, controls, ports);
		expect(Object.keys(program)).not.toContain("sampleRate");
	});

	it("declares the operators the stamps use, deduplicated and sorted", () => {
		// The cartridge lockout's producing half. Two conductances declare one operator, not
		// two; the sort is what keeps the declaration a function of the set rather than of
		// stamp order, so the same circuit drawn in a different order emits the same bytes.
		const stamps: readonly Stamp[] = [
			{ kind: "conductance", a: 1, b: 2, siemens: 1e-3 },
			{ kind: "capacitor", a: 2, b: 0, farads: 1e-7, stateIndex: 0 },
			{ kind: "conductance", a: 2, b: 0, siemens: 1e-3 },
		];
		const program = link(
			[mnaBlock("analog:0", stamps)],
			noDependencies,
			controls,
			ports,
		);
		expect(program.requiredOperators).toEqual(["capacitor", "conductance"]);
	});

	it("collects operators across every block, not only the first", () => {
		const program = link(
			[
				mnaBlock("analog:0", [
					{ kind: "conductance", a: 1, b: 2, siemens: 1e-3 },
				]),
				mnaBlock("analog:1", [
					{ kind: "input-source", node: 1, sourceIndex: 0 },
				]),
			],
			noDependencies,
			controls,
			ports,
		);
		expect(program.requiredOperators).toEqual(["conductance", "input-source"]);
	});

	it("declares nothing when there is nothing to execute", () => {
		// A program requiring no operator runs on any runtime, which is the honest reading
		// of a block that stamps nothing -- not a version claim withheld.
		const program = link(
			[mnaBlock("analog:0")],
			noDependencies,
			controls,
			ports,
		);
		expect(program.requiredOperators).toEqual([]);
	});

	it("declares a macro's DSP model in its own set, not among the operators", () => {
		// The producing half of the model lockout, and the answer to the question the operator
		// format left open: a `modelId` is declared, so a runtime lacking the algorithm can refuse
		// by name at load -- but in a set of its own, because a stamp kind and a DSP algorithm are
		// different vocabularies and one flat set could not tell a missing stamp function from a
		// missing algorithm (nor keep a `modelId` of `diode` from being satisfied by the runtime's
		// stamp diode). See `Program.requiredModels`.
		const program = link(
			[
				mnaBlock("analog:0", [
					{ kind: "conductance", a: 1, b: 2, siemens: 1e-3 },
				]),
				macroBlock("macro:U1"),
			],
			{
				regions: [],
				dependencies: { "analog:0": [], "macro:U1": ["analog:0"] },
			} as unknown as Partitioning,
			controls,
			ports,
		);
		expect(program.requiredModels).toEqual(["bucket-brigade-delay-line"]);
		expect(program.requiredOperators).toEqual(["conductance"]);
	});

	it("declares no model for a program with no macro", () => {
		// The negative control for the pair above: an all-analog program declares an empty model
		// set, which is what makes a non-empty one mean something.
		const program = link(
			[
				mnaBlock("analog:0", [
					{ kind: "conductance", a: 1, b: 2, siemens: 1e-3 },
				]),
			],
			noDependencies,
			controls,
			ports,
		);
		expect(program.requiredModels).toEqual([]);
	});

	it("does not declare an operator only a pruned block uses", () => {
		// The external-review finding this test is named for: `requiredOperators` used to be
		// collected from every retained block, while `order` executes only the live ones --
		// against `Program`'s own contract text, "every operator this program needs a runtime
		// to implement... to execute a program." A pruned block never executes under any
		// runtime, so its operator cannot be needed to execute the program, and declaring it
		// anyway risks a constrained second runtime refusing a pedal it could actually play.
		// Measured on the real corpus before this changed: `boss-od-3` and `boss-sd-1` each
		// carry a `selector` stamp only in a region that cannot reach the output.
		const program = link(
			[
				mnaBlock("analog:0", [
					{ kind: "conductance", a: 1, b: 2, siemens: 1e-3 },
				]),
				{
					...(unportedBlock("analog:1") as Extract<Block, { kind: "mna" }>),
					stamps: [
						{ kind: "capacitor", a: 1, b: 0, farads: 1e-7, stateIndex: 0 },
					],
				},
			],
			noDependencies,
			controls,
			ports,
		);
		expect(program.order).toEqual(["analog:0"]);
		// The pruned block's own operator does not appear...
		expect(program.requiredOperators).toEqual(["conductance"]);
		// ...even though the block itself, and its stamp, still stay in the program's record.
		expect(program.blocks).toHaveLength(2);
	});

	it("does not execute a region that cannot reach the output", () => {
		// Regions share no non-ground node, so a region owning neither jack has its whole
		// solution discarded every sample. 141 of the corpus's 191 regions are of that kind.
		const program = link(
			[mnaBlock("analog:0"), unportedBlock("analog:1")],
			noDependencies,
			controls,
			ports,
		);
		expect(program.order).toEqual(["analog:0"]);
		// The block itself stays: it is the circuit's record, and the fidelity gate reads it.
		expect(program.blocks).toHaveLength(2);
	});

	it("executes a portless region that a live block depends on", () => {
		// The silent break this rule risks. A clock network owns no jack and still sets a
		// delay time, so reachability has to follow the dependency graph and not the port
		// fields -- transitively, since a producer may have a producer of its own.
		const partitioning = {
			regions: [],
			dependencies: {
				"macro:U1": ["analog:1"],
				"analog:1": ["analog:2"],
			},
		} as unknown as Partitioning;
		const program = link(
			[
				mnaBlock("analog:0"),
				unportedBlock("analog:1"),
				unportedBlock("analog:2"),
				macroBlock("macro:U1"),
			],
			partitioning,
			controls,
			ports,
		);
		expect([...program.order].sort()).toEqual([
			"analog:0",
			"analog:1",
			"analog:2",
			"macro:U1",
		]);
	});

	it("executes a macro block, which has no ports to prove dead by", () => {
		// Conservative on purpose: the macro variant carries no input or output node, so the
		// compiler cannot show that one fails to reach the output. Keeping a dead block costs
		// solve time; dropping a live one is a stage silently missing from the audio.
		const program = link(
			[macroBlock("macro:U1")],
			noDependencies,
			controls,
			ports,
		);
		expect(program.order).toEqual(["macro:U1"]);
	});

	it("declares cost predictors from the executed blocks' own sizes", () => {
		// The admission gate's producing half: unknown count and linearity, read off the
		// same blocks `requiredOperators` reads its stamps off, not re-derived some other way.
		const program = link(
			[
				mnaBlock("analog:0", [
					{ kind: "conductance", a: 1, b: 2, siemens: 1e-3 },
				]),
			],
			noDependencies,
			controls,
			ports,
		);
		expect(program.costPredictors.executedBlockCount).toBe(1);
		expect(program.costPredictors.solvedBlocks).toEqual([
			{ blockId: "analog:0", unknownCount: 4, linear: true },
		]);
	});

	it("sums state across executed blocks and reports each one's linearity", () => {
		const partitioning = {
			regions: [],
			dependencies: { "analog:0": [], "analog:1": [] },
		} as unknown as Partitioning;
		const program = link(
			[
				{
					...(mnaBlock("analog:0", [
						{ kind: "capacitor", a: 1, b: 0, farads: 1e-7, stateIndex: 0 },
					]) as Extract<Block, { kind: "mna" }>),
					stateCount: 2,
				},
				mnaBlock("analog:1", [
					{
						anode: 1,
						cathode: 0,
						kind: "diode",
						saturationCurrent: 1e-12,
						thermalVoltage: 0.025852,
						emissionCoefficient: 1,
						breakdownVolts: 0,
					},
				]),
			],
			partitioning,
			controls,
			ports,
		);
		expect(program.costPredictors.stateCount).toBe(2);
		expect(program.costPredictors.solvedBlocks).toEqual([
			{ blockId: "analog:0", unknownCount: 4, linear: true },
			{ blockId: "analog:1", unknownCount: 4, linear: false },
		]);
	});

	it("does not declare a pruned block's cost, matching requiredOperators' own exclusion", () => {
		// Same fixture as "does not declare an operator only a pruned block uses" above: a
		// block that never reaches the output never executes under any runtime, so its solve
		// cost cannot be a cost this program's execution needs to be admitted against.
		const program = link(
			[
				mnaBlock("analog:0", [
					{ kind: "conductance", a: 1, b: 2, siemens: 1e-3 },
				]),
				{
					...(unportedBlock("analog:1") as Extract<Block, { kind: "mna" }>),
					stamps: [
						{ kind: "capacitor", a: 1, b: 0, farads: 1e-7, stateIndex: 0 },
					],
					stateCount: 3,
				},
			],
			noDependencies,
			controls,
			ports,
		);
		expect(program.costPredictors.executedBlockCount).toBe(1);
		expect(program.costPredictors.stateCount).toBe(0);
		expect(program.costPredictors.solvedBlocks).toEqual([
			{ blockId: "analog:0", unknownCount: 4, linear: true },
		]);
	});

	it("declares nothing for a macro-only program, which stamps nothing to solve", () => {
		const program = link(
			[macroBlock("macro:U1")],
			noDependencies,
			controls,
			ports,
		);
		expect(program.costPredictors.executedBlockCount).toBe(1);
		expect(program.costPredictors.solvedBlocks).toEqual([]);
	});

	it("refuses a dependency cycle among blocks it would not execute", () => {
		// The cycle check runs over every block, before reachability: a cyclic dependency is
		// a compiler defect whether or not the blocks in it are audible.
		const partitioning = {
			regions: [],
			dependencies: { "analog:1": ["analog:2"], "analog:2": ["analog:1"] },
		} as unknown as Partitioning;
		expect(() =>
			link(
				[
					mnaBlock("analog:0"),
					unportedBlock("analog:1"),
					unportedBlock("analog:2"),
				],
				partitioning,
				controls,
				ports,
			),
		).toThrow(LinkError);
	});

	it("refuses a dependency cycle rather than picking an arbitrary order", () => {
		const partitioning = {
			regions: [],
			dependencies: { a: ["b"], b: ["a"] },
		} as unknown as Partitioning;
		expect(() =>
			link([mnaBlock("a"), mnaBlock("b")], partitioning, controls, ports),
		).toThrow(LinkError);
	});
});
