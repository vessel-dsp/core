// Contract for a port's declared full-scale voltage (../port-full-scale.ts) -- see the
// signal-chain plan (thoughts/shared/plans/2026-08-21-signal-chain-and-amp-output-stage.md)
// §3.2 for the derivation this asserts: the largest declared supply magnitude, reflected
// through an output transformer's turns ratio when the output sits on one.
//
// Block literals rather than `.vdsp` fixtures, for the same reason `over-driven-node.test.ts`
// gives: the rule reads lowered stamps, and a block literal cannot describe a program its own
// stamps contradict as easily as a hand-rolled netlist could drift from what lowering emits.

import { describe, expect, it } from "bun:test";
import {
	deriveFullScaleVolts,
	portFullScaleVolts,
} from "../src/port-full-scale";
import { computeSparseSchedule } from "../src/sparse-schedule";
import { computeStampPartition } from "../src/stamp-partition";
import type { Block, Stamp } from "../src/types";

function mnaBlock(
	stamps: readonly Stamp[],
	outputNode: number | null,
	// One aux row per source and per transformer. A second transformer needs a third.
	auxCount = 2,
): Block {
	return {
		kind: "mna",
		id: "analog:0",
		nodeCount: 10,
		nodeIds: Array.from({ length: 10 }, (_, node) => node),
		auxCount,
		stamps,
		stampPartition: computeStampPartition(stamps, 10),
		sparseSchedule: computeSparseSchedule({
			nodeCount: 10,
			auxCount,
			stamps,
		}),
		stateCount: 0,
		linear: true,
		controlFree: true,
		eliminate: false,
		inputNode: 1,
		outputNode,
		operatingPointSeeds: [],
	};
}

const dcSource = (positive: number, volts: number): Stamp => ({
	kind: "dc-source",
	positive,
	negative: 0,
	volts,
	sourceIndex: 0,
	sourceOhms: 0,
});

const outputTransformer = (
	secondaryPlus: number,
	turnsRatio: number,
): Stamp => ({
	kind: "transformer",
	primaryPlus: 3,
	primaryMinus: 0,
	secondaryPlus,
	secondaryMinus: 0,
	turnsRatio,
	sourceIndex: 1,
});

/**
 * A push-pull output stage's shape: the true secondary is the shared MNA reference
 * (`primaryPlus`/`primaryMinus`, per `lower.ts`'s `coupledWindings` swap for a tapped
 * primary), coupled to one primary half on `secondaryPlus`/`secondaryMinus`.
 */
const swappedOutputTransformer = (
	primaryPlus: number,
	turnsRatio: number,
): Stamp => ({
	kind: "transformer",
	primaryPlus,
	primaryMinus: 0,
	secondaryPlus: 4,
	secondaryMinus: 5,
	turnsRatio,
	sourceIndex: 1,
});

/** One throw of an impedance selector: a 0.01 ohm link between the jack and a tap. */
const selectorThrow = (
	common: number,
	throwNode: number,
	throwIndex: number,
): Stamp => ({
	kind: "selector",
	common,
	throwNode,
	control: "SEL" as Stamp extends { control: infer C } ? C : never,
	throwIndex,
	throwCount: 3,
	onOhms: 0.01,
	offOhms: 1e9,
});

/** A winding between two taps of one coil: the shape a twice-loaded secondary stamps. */
const tapToTapWinding = (
	primaryPlus: number,
	secondaryPlus: number,
	turnsRatio: number,
): Stamp => ({
	kind: "transformer",
	primaryPlus,
	primaryMinus: 0,
	secondaryPlus,
	secondaryMinus: 0,
	turnsRatio,
	sourceIndex: 2,
});

describe("deriveFullScaleVolts", () => {
	it("is null when the supply magnitude is null, regardless of ratio", () => {
		expect(deriveFullScaleVolts(null, null)).toBeNull();
		expect(deriveFullScaleVolts(null, 2)).toBeNull();
	});

	it("is the supply magnitude when there is no output-transformer ratio", () => {
		expect(deriveFullScaleVolts(9, null)).toBe(9);
	});

	it("divides the supply magnitude by the ratio when one is given", () => {
		// fender-5e3-deluxe-tweed's own shape: B+ reflected through the OT ratio.
		expect(deriveFullScaleVolts(350, 31.62)).toBeCloseTo(350 / 31.62, 10);
		expect(deriveFullScaleVolts(100, 4)).toBe(25);
	});

	it("multiplies when the caller passes a reciprocal ratio (< 1)", () => {
		// `outputTransformerRatio` returns `1 / turnsRatio` for a push-pull swap match, so this
		// function's own contract does not change -- it always divides.
		expect(deriveFullScaleVolts(275, 1 / 0.1265)).toBeCloseTo(275 * 0.1265, 6);
	});
});

describe("portFullScaleVolts", () => {
	it("is null for both ports when the program declares no supply", () => {
		const blocks = [mnaBlock([], 2)];
		expect(portFullScaleVolts(blocks)).toEqual({ input: null, output: null });
	});

	it("ignores a zero-volt source -- a ground tie, not a supply", () => {
		const blocks = [mnaBlock([dcSource(6, 0)], 2)];
		expect(portFullScaleVolts(blocks)).toEqual({ input: null, output: null });
	});

	it("is the largest declared supply magnitude for a port not on a transformer secondary", () => {
		const blocks = [mnaBlock([dcSource(6, 9), dcSource(7, -18)], 2)];
		// The larger magnitude wins regardless of sign, and applies to the output port
		// when it does not sit on an output transformer's secondary. Input is null (plan §3.2).
		expect(portFullScaleVolts(blocks)).toEqual({ input: null, output: 18 });
	});

	it("divides the output by the output transformer's ratio, leaving the input alone", () => {
		const blocks = [
			mnaBlock([dcSource(6, 350), outputTransformer(2, 31.62)], 2),
		];
		const result = portFullScaleVolts(blocks);
		expect(result.input).toBeNull();
		expect(result.output).toBeCloseTo(350 / 31.62, 10);
	});

	it("reads the largest supply across every block, not only the one owning the port", () => {
		// The output-owning block's own rail is smaller than a supply declared in a separate
		// region -- a node cannot swing beyond its own rails, but the *largest* declared
		// supply in the program is still the honest ceiling (`link.ts` reads `blocks`, not
		// `executed`, for the same reason).
		const outputBlock = mnaBlock([dcSource(4, 9)], 2);
		const supplyBlock = mnaBlock([dcSource(6, 350)], null);
		expect(portFullScaleVolts([outputBlock, supplyBlock])).toEqual({
			input: null,
			output: 350,
		});
	});

	it("does not apply a ratio when the output is not transformer-coupled, even if a transformer exists elsewhere", () => {
		// A transformer stamp whose secondary is not this port's node -- e.g. a mains supply
		// feeding a rectifier upstream of the output -- must not be picked up.
		const blocks = [
			mnaBlock(
				[dcSource(6, 100), outputTransformer(9, 4)],
				2, // output node 2, not the transformer's secondary (node 9)
			),
		];
		expect(portFullScaleVolts(blocks)).toEqual({ input: null, output: 100 });
	});

	it("inverts the ratio when the output matches primaryPlus/primaryMinus -- the push-pull swap", () => {
		// vox-ac30-top-boost's own measured shape: the output node matches `primaryPlus` on a
		// coupled winding whose `turnsRatio` is 0.1265 (a primary half's-worth, not the full
		// declared ratio). Dividing by 0.1265 directly -- treating this like an ordinary
		// secondary match -- would overstate the output by a factor of ~64.
		const blocks = [
			mnaBlock(
				[dcSource(6, 275), swappedOutputTransformer(2, 0.12649110640673517)],
				2,
			),
		];
		const result = portFullScaleVolts(blocks);
		expect(result.input).toBeNull();
		expect(result.output).toBeCloseTo(275 * 0.12649110640673517, 10);
		expect(result.output).toBeCloseTo(34.786, 2);
	});

	it("falls back to the plain supply magnitude when no block owns the output port", () => {
		// No `outputTransformerRatio` match is possible when nothing declares `outputNode`, so
		// this is indistinguishable from the no-transformer case above.
		const blocks = [mnaBlock([dcSource(6, 9)], null)];
		expect(portFullScaleVolts(blocks)).toEqual({ input: null, output: 9 });
	});

	it("reaches a winding one selector throw away from the port", () => {
		// `marshall-jcm800` and `hiwatt-dr103`: the speaker jack sits on an impedance selector's
		// common, and a direct node lookup cannot cross a 0.01 ohm throw. Both reported their bare
		// rail for a speaker terminal -- 466.7 V and 495.0 V -- until this traversal existed.
		const bounded = portFullScaleVolts(
			[
				mnaBlock(
					[
						dcSource(3, 400),
						swappedOutputTransformer(6, 0.2),
						selectorThrow(7, 6, 0),
					],
					7,
				),
			],
			{ input: 1, output: 7 },
		);
		expect(bounded.output).toBeCloseTo(80, 10);

		// The negative control: without the throw the port is on nothing and falls back to the
		// rail, which is the behaviour this case exists to change.
		expect(
			portFullScaleVolts(
				[mnaBlock([dcSource(3, 400), swappedOutputTransformer(6, 0.2)], 7)],
				{ input: 1, output: 7 },
			).output,
		).toBeCloseTo(400, 10);
	});

	it("takes the tightest factor when several stamps touch the port", () => {
		// A coil with two loaded taps stamps a winding between them, and that stamp relates the
		// port to its sibling tap rather than to any supply. Held in a map written per stamp, its
		// ratio replaced the plate step-down by write order: `orange-rockerverb` reported 580 V,
		// above its own 410 V rail.
		const bounded = portFullScaleVolts(
			[
				mnaBlock(
					[
						dcSource(3, 410),
						swappedOutputTransformer(6, 0.1372),
						tapToTapWinding(6, 8, 1.4142),
					],
					6,
					3,
				),
			],
			{ input: 1, output: 6 },
		);
		expect(bounded.output).toBeCloseTo(410 * 0.1372, 6);
		// And never above the rail that feeds it, which is what made the defect visible.
		expect(bounded.output ?? 0).toBeLessThan(410);
	});
});
