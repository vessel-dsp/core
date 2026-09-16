// Stage 5.5: wire a macro's `coupled` and `parameter` ports across the blocks `lower` already
// produced.
//
// Why a separate stage rather than something `lowerRegion` does. A macro's ports reference
// OTHER blocks entirely -- the region sharing its audio-in node, the region sharing its
// audio-out node, the region whose solved state sets its delay time -- and `lowerRegion` lowers
// one region at a time with no visibility into the rest. This stage runs after every region has
// a block, and rewires three things: the macro block itself (so it carries real ports where
// `Block`'s macro variant used to carry none at all), the block that shares the macro's audio-in
// node (an added `conductance` stamp: the macro's own declared admittance, so its driver is
// genuinely loaded rather than driving an open circuit), and the block that shares its audio-out
// node (an added `macro-audio-source` stamp: a same-sample voltage source behind the macro's
// declared output impedance, whose *value* the runtime reads from the macro's own delay-line
// state each sample rather than from a number baked in at compile time).
//
// **Why the `coupled` port needs no per-iteration exchange here.** Both stamps this stage adds
// are linear (`conductance`, `macro-audio-source`) and the macro's own core -- a delay line, per
// the plan's "a microblock is compiled, not called" decision -- has no same-sample algebraic
// dependence on the node it taps: what it writes back this sample was computed from history, not
// from this sample's still-unknown solution. So the driver's and downstream's own blocks solve
// exactly as they always did, with one extra linear term each, and gate 1d's per-iteration rule
// (mandatory the moment either side of a seam is nonlinear) simply does not apply -- there is no
// seam left needing it, because the loading is inside the matrix. This is the fixture's only
// case, not a general answer: a macro whose *core itself* were nonlinear and zero-delay would
// still need the interface gate 1d validated, and this stage does not build one.
//
// **Spec clause 3, the region schedule, landed 2026-08-14 -- the write-back edge is now real,
// and the one-sample lag build-order step 1 had to accept is gone.** `partition.ts`'s existing
// dependency computation only ever expressed one direction: "a macro depends on every analog
// region sharing a node with it", built for a macro's PARAMETERS being set by an analog region.
// That rule is too coarse once audio also flows *through* a macro, because it points the wrong
// way for the audio-out side -- the block receiving a `macro-audio-source` stamp does not set
// the macro's inputs, it *consumes* the macro's write-back, so it must run AFTER the macro, not
// before it. `coupleSchedule` below corrects exactly that one edge: the blanket
// "macro depends on downstream" from stage 4 is replaced with "downstream depends on macro" for
// the specific region wired as this macro's audio-out, leaving every other shared-node edge
// (audio-in, `parameter`, and any region with no port role at all, like `hybridDelayPedal`'s bias
// network) exactly as `partition.ts` already computed it -- those are genuine reads, and the
// existing direction is already correct for them.
//
// **This is a graph edit, not a new solving primitive.** The corrected dependency graph is
// still exactly what `link.ts`'s existing `topologicalOrder` consumes, unchanged; a schedule
// this stage cannot satisfy surfaces as `link.ts`'s own `LinkError` -- the "no valid order
// exists" refusal clause 3 asks for was already built for the macro-parameter graph, and
// generalizes to this edge for free once the edge is in the same graph.
//
// **The coincident case -- driver and downstream the SAME region -- is no longer one of those
// refusals, corrected 2026-08-14.** Measured against the real corpus (not assumed): all three
// real delay/BBD packets that clear device-law identification (`pt2399-delay`, `boss-ce-2`,
// `boss-ce-5`) wire an UNBUFFERED resistor network directly between the chip's audio-out and
// audio-in -- a dry blend or regen path with no op-amp between them, which `partition.ts` merges
// into one region because that is what a region is (devices sharing a non-ground node). Adding
// both directional edges unconditionally, as the first landing of clause 3 did, makes this case
// a 2-cycle: the region must run before the macro (audio-in) and after it (audio-out) in the
// same sample, which `link.ts` correctly refused. The resolution is neither same-sample
// resolution (gate 1a's premise -- a macro's write-back is delayed by construction, computed
// from history alone, so a same-sample edge is a strengthening this format can afford not to
// have here, not a correctness requirement) nor a refusal: it is a documented one-sample lag on
// the write-back side ONLY in this exact case, chosen over the audio-in direction because stage
// 4's own blanket rule already produces "macro after region" for free, so keeping it costs no
// new edge, where the reverse would have to invent one. See the coincident-case comment in
// `couple` below for the mechanism and `thoughts/shared/experiments/
// coincident-region-schedule-lag/README.md` for the measured cost -- a different topology from
// gate 1a's buffered fixture, so a different number, measured rather than reused. See
// `hybridDelayPedalCyclicSchedule` in the tests: it now compiles (this is what changed), and a
// separate, still-uncovered fixture would be needed to exercise a genuine multi-region cycle
// (chained macros whose driver/downstream form a longer loop through DISTINCT regions), which
// this correction does not resolve and `link.ts` still correctly refuses.
//
// **`Program.order` is the "region schedule as first-class program data" clause 3 asks for**,
// not a new field beside it. It already satisfies both halves of the requirement -- computed by
// the compiler from a dependency graph, iterated by the runtime with no graph walk of its own --
// so the gap clause 3 closes is in what feeds that computation, not in `order`'s own shape. A
// second, parallel `Program.schedule` field would only duplicate it.
//
// **The `parameter` port's purity gate, and where it diverges from the census's own check.**
// Spec clause 1 names two checks: node-equality between the derivation's supply and an
// audio-path active device's supply pin (the "sag" failure), and reachability of a
// modulation-role control from the derivation's own control pin (the "lfo" failure). Neither
// check is representable here exactly as worded, for reasons specific to this compiler's own
// architecture rather than a disagreement with the measurement:
//
//   - `partition.ts` merges any devices sharing a non-ground node into ONE region -- that is
//     what a region *is*. So two DIFFERENT regions can never share a non-ground node; if a real
//     shared supply existed, the clock network and the active device would already be one
//     region, not two, and the cross-region check gate 1b's census runs on raw source documents
//     would be comparing something that cannot occur post-partition. The check this stage runs
//     instead is the one that IS representable and catches the same class of defect: the
//     derivation's own region must be `linear`, i.e. contain no nonlinear device at all -- an
//     active device reacting to the passing audio from *inside* the derivation's own region is
//     exactly the impurity gate 1b's `sag` row measures, and unlike cross-region sharing, this
//     is a real, checkable, single-region fact.
//   - This compiler's `Control` type carries no role at all (`{id, taper, defaultPosition}`) --
//     `deviceInterface.controls[].role` is read by stage 1 for jack classification only and
//     never reaches this type. So "a modulation-role control is reachable" narrows to "any
//     control is reachable", which is a STRICTER superset of the census's check, not a weaker
//     one: refusing on any control is safe in the direction that matters (never wrongly admits
//     an impure derivation), even though it will also refuse some genuinely-pure knob-rate cases
//     a role-aware check would admit. Recorded as a dated correction against the spec, not a
//     silent narrowing: see the plan's clause 1 annotation.
//
// Both checks read `Partitioning.Region`, already computed by `partition.ts` and already exact
// for this purpose -- `region.kind` is `linear` only when nothing in it needs Newton, and
// `region.controls` is already the exhaustive list of controls the region's own devices carry.

import {
	blockNodeIndex,
	stampControl,
	stampNeedsNewton,
} from "./lower";
import { computeSparseSchedule } from "./sparse-schedule";
import {
	computeStampPartition,
	shouldEliminate,
	stampShape,
} from "./stamp-partition";
import type { Block, LawedNetlist, NodeId, Partitioning, Region, Stamp } from "./types";
import { GROUND } from "./types";

export type Coupled = {
	readonly blocks: readonly Block[];
	/**
	 * `partitioning.dependencies`, corrected for every macro's audio-out edge -- see this
	 * file's header. This is what `link.ts` must sort against instead of the stage-4 graph,
	 * so a coupled seam's two sides land in the right order within a sample rather than the
	 * downstream side reading last sample's write-back by accident.
	 */
	readonly dependencies: Partitioning["dependencies"];
};

export function couple(
	blocks: readonly Block[],
	partitioning: Partitioning,
	lawed: LawedNetlist,
): Coupled {
	const deviceById = new Map(
		lawed.netlist.devices.map((device) => [device.id, device] as const),
	);
	const byId = new Map(blocks.map((block) => [block.id, block] as const));
	// A working copy, corrected in place as each macro's audio-out edge is found. Every other
	// edge `partition.ts` computed -- audio-in, `parameter`, and any node with no port role at
	// all -- is a genuine read and stays exactly as stage 4 left it.
	const dependencies: Record<string, string[]> = Object.fromEntries(
		Object.entries(partitioning.dependencies).map(([id, deps]) => [id, [...deps]]),
	);

	for (const region of partitioning.regions) {
		if (region.kind !== "macro" || region.macro === null) {
			continue;
		}
		const macroBlock = byId.get(region.id);
		if (macroBlock === undefined || macroBlock.kind !== "macro") {
			continue;
		}
		const device = deviceById.get(region.devices[0] ?? "");
		if (device === undefined) {
			continue;
		}
		const macro = region.macro;
		let next = macroBlock;

		// The `coupled` port. Wired only when the part declares an audio boundary at all
		// (`audioPortImpedanceOhms`) and names enough port terminals to locate both nodes --
		// the safe default for a part that declares neither is the port staying absent, not an
		// assumed ideal (zero-impedance, or an unwritten sample) boundary nothing measured.
		if (macro.audioPortImpedanceOhms !== null && macro.portTerminals.length >= 2) {
			const inNode = device.nodes[macro.portTerminals[0] as number];
			const outNode = device.nodes[macro.portTerminals[1] as number];
			// Hoisted out of the `inNode` block: the audio-out side needs to know the driver's
			// id too, because the driver and the downstream region can be the SAME region (a
			// direct wire loops the macro's audio-out back toward its own audio-in side) --
			// `hybridDelayPedalCyclicSchedule` is exactly this. Rewriting the dependency edge
			// from "downstream" alone, without knowing whether it coincides with "driver",
			// dropped the audio-in edge entirely in that case on this file's first version --
			// caught by the negative control below expecting a refusal and silently compiling a
			// wrongly-scheduled program instead. Both edges are added explicitly now, and
			// removal only ever targets the specific stale edge this stage means to correct.
			const driver = inNode === undefined ? undefined : ownerOf(inNode, partitioning);
			if (inNode !== undefined && driver !== undefined) {
				const driverBlock = byId.get(driver.id);
				// `inNode` and `outNode` are the source ids `partition.ts` works in, and a block's
				// rows are numbered independently of those (see `Block.nodeIds`), so every node
				// crossing into a block from here goes through that block's own map. `ownerOf` has
				// already proved the node belongs to the region, so `null` would be a compiler
				// defect rather than an absent port -- but it is checked rather than asserted,
				// because the failure it would otherwise produce is a stamp on row 0, which is
				// ground, and a macro seam quietly shorted to ground still renders.
				const driverRow =
					driverBlock?.kind === "mna" ? blockNodeIndex(driverBlock, inNode) : null;
				if (driverBlock?.kind === "mna" && driverRow !== null) {
					byId.set(
						driver.id,
						withStamp(driverBlock, {
							kind: "conductance",
							a: driverRow,
							b: GROUND,
							siemens: 1 / macro.audioPortImpedanceOhms.input,
						}),
					);
					next = { ...next, audioIn: { block: driver.id, node: driverRow } };
					// The macro reads this region's solved node every sample, so it must run
					// after it -- made explicit here rather than left to whatever stage 4's
					// blanket shared-node rule happened to produce.
					if (!(dependencies[region.id] ?? []).includes(driver.id)) {
						dependencies[region.id] = [...(dependencies[region.id] ?? []), driver.id];
					}
				}
			}
			if (outNode !== undefined) {
				const downstream = ownerOf(outNode, partitioning);
				const downstreamBlock =
					downstream === undefined ? undefined : byId.get(downstream.id);
				const downstreamRow =
					downstreamBlock?.kind === "mna"
						? blockNodeIndex(downstreamBlock, outNode)
						: null;
				if (
					downstream !== undefined &&
					downstreamBlock?.kind === "mna" &&
					downstreamRow !== null
				) {
					byId.set(
						downstream.id,
						withStamp(downstreamBlock, {
							kind: "macro-audio-source",
							node: downstreamRow,
							macroId: region.id,
							sourceOhms: macro.audioPortImpedanceOhms.output,
							sourceIndex: downstreamBlock.auxCount,
						}),
					);
					next = { ...next, audioOut: true };
					// The schedule correction: this region no longer *sets* the macro's inputs
					// (drop it from the macro's own dependency list, if stage 4 put it there via
					// the shared-node rule) and now *consumes* the macro's write-back instead, so
					// it must run after the macro -- UNLESS this region is also the driver, the
					// coincident case an unbuffered dry/wet blend produces (`R13` straight from a
					// BBD's `in` to `out1`, no op-amp between them -- measured 2026-08-14 as the
					// common case for this corpus's real delay/BBD-chorus pedals, not the
					// exception gate 1a's own buffered fixture tested). There, adding this edge
					// on top of the audio-in edge already added above (macro depends on driver,
					// same region) is a same-sample lag AND a same-sample read of the same pair,
					// which is exactly the 2-cycle `link.ts` correctly refuses -- this file's
					// first version created that cycle by *also* deleting the audio-in edge here,
					// which was wrong the other way (a silently stale schedule). Neither wrong is
					// necessary: the coincident case has a genuinely different, honest resolution
					// -- see "the coincident case" below -- so this branch simply does not add
					// the reverse edge, leaving the one already-correct direction (region before
					// macro) as the schedule.
					const isFeedback =
						driver !== undefined &&
						(downstream.id === driver.id ||
							reaches(driver.id, downstream.id, dependencies));
					if (!isFeedback) {
						dependencies[region.id] = (dependencies[region.id] ?? []).filter(
							(id) => id !== downstream.id,
						);
						if (!(dependencies[downstream.id] ?? []).includes(region.id)) {
							dependencies[downstream.id] = [
								...(dependencies[downstream.id] ?? []),
								region.id,
							];
						}
					}
					// **The coincident case, resolved 2026-08-14: a documented one-sample lag,
					// not same-sample resolution and not a refusal.** When driver and downstream
					// are the SAME region (an unbuffered regen/dry-blend network), that region
					// cannot run both before the macro (to supply this sample's audio-in) and
					// after it (to consume this sample's write-back) -- both cannot be same-
					// sample. The audio-in direction wins, kept exactly as added above: the
					// macro reads this sample's driven node, because that is the read the
					// `parameter` port and every other macro-parameter dependency already assume
					// and because it is the direction stage 4's own blanket rule already
					// produces for this region regardless (a macro sharing a node with an analog
					// region runs after it), so choosing it costs no new edge. The write-back
					// stays exactly where build-order step 1 already had it before clause 3: the
					// region's `macro-audio-source` stamp reads last sample's `macroOutputVolts`,
					// not this sample's -- unchanged from what stage 4 alone already schedules,
					// since no edge is added here. This is honest exactly because it is
					// documented and its cost is measured rather than assumed: see
					// `docs/troubleshootings/` and `thoughts/shared/experiments/
					// coincident-region-schedule-lag/README.md` for the measured fraction on
					// this exact topology (a resistor bridging a macro's own audio-in and
					// audio-out nodes), which is a different topology from gate 1a's buffered
					// regen path and therefore a different number. **Not same-sample
					// resolution**: that would need the macro's per-sample step split into a
					// publish half (before the region, from history alone) and a consume half
					// (after the region) as two schedule nodes, which is a new scheduling
					// primitive this program format does not have and neither `Program.order`
					// nor `costPredictors`' `executedBlockCount` (computed as `order.length`,
					// spec build-order step 6) is built to carry -- recorded as what remains,
					// not implemented speculatively here. **Not a refusal**: gate 1a's own
					// premise is that a macro's write-back is delayed by construction (a delay
					// core's output depends only on past samples), so a same-sample edge here is
					// a strengthening this format can afford to not have, not a correctness
					// requirement -- unlike a truly algebraic (zero-delay) coupled boundary,
					// which this is not.
				}
			}

			// **The second audio output, for a part that has two.**
			//
			// A BBD brings out two taps and a design puts a balance trimmer across them, because
			// the audio appears on both while the clock feedthrough appears in antiphase. Driving
			// only the first left the second an undriven node, so the trimmer stopped being a
			// balance control and became an attenuator against whatever bled through its own
			// track: measured on `mxr-carbon-copy` as **6.0 dB lost across four brigades at the
			// trimmers' centre default, against 0.67 dB with each wiper on the driven pin** -- and
			// a compandor downstream squared it.
			//
			// The same write-back value is published on both taps, which is what the *audio* does:
			// both outputs carry the signal, and the trimmer exists to null a clock feedthrough
			// this model does not represent at all. So a centred wiper now recovers the signal
			// instead of half of it, and the trimmer is inert for audio -- honest, because nothing
			// here models the thing it trims.
			//
			// **No schedule edge is added.** The dependency direction was settled by the first
			// output above, and this stamp reads the same `macroOutputVolts` entry; a second edge
			// for the same producer/consumer pair would either duplicate that or, where the second
			// tap lands in another region, assert an ordering this stage has not measured. A tap
			// whose node is not in an MNA block is skipped, exactly as the first output is.
			const out2Terminal = macro.portTerminals[2];
			const out2Node =
				out2Terminal === undefined ? undefined : device.nodes[out2Terminal];
			const out2Owner =
				out2Node === undefined ? undefined : ownerOf(out2Node, partitioning);
			const out2Block =
				out2Owner === undefined ? undefined : byId.get(out2Owner.id);
			const out2Row =
				out2Block?.kind === "mna" && out2Node !== undefined
					? blockNodeIndex(out2Block, out2Node)
					: null;
			if (out2Owner !== undefined && out2Block?.kind === "mna" && out2Row !== null) {
				byId.set(
					out2Owner.id,
					withStamp(out2Block, {
						kind: "macro-audio-source",
						node: out2Row,
						macroId: region.id,
						sourceOhms: macro.audioPortImpedanceOhms.output,
						sourceIndex: out2Block.auxCount,
					}),
				);
			}
		}

		// The `parameter` port, purity-gated -- see this file's header for the two checks and
		// where they diverge from the census's own. Missing or negative evidence leaves
		// `parameter` at its `null` default from `lower.ts`, which is the spec's safe default:
		// no pedal is refused for lacking this port, and the macro falls back to its own
		// `parameters` alone.
		if (macro.parameterTerminal !== null && macro.parameterReferenceVolts !== null) {
			const node = device.nodes[macro.parameterTerminal];
			const source = node === undefined ? undefined : ownerOf(node, partitioning);
			const sourceBlock = source === undefined ? undefined : byId.get(source.id);
			// Through the owning block's map, as the `coupled` port above: this port names a row
			// the runtime reads out of another block's solution every sample.
			const sourceRow =
				sourceBlock?.kind === "mna" && node !== undefined
					? blockNodeIndex(sourceBlock, node)
					: null;

			if (
				source !== undefined &&
				sourceRow !== null &&
				isPureDerivation(source)
			) {
				next = {
					...next,
					parameter: {
						block: source.id,
						node: sourceRow,
						referenceVolts: macro.parameterReferenceVolts,
					},
				};
			} else {
				// The registry declared this part's modulation input and the document wired it,
				// and admission still refused it. That is not a silent condition: it is the
				// difference between a flanger and a fixed comb filter, and until now the two
				// compiled to the same program.
				//
				// Refusing is correct here rather than a limitation to route around. Gate 1b
				// measured this exact case -- see
				// `thoughts/shared/experiments/clock-parameter-port-gate/README.md` -- and found
				// that an LFO-swept clock "turns the `parameter` port into a `signal` by
				// definition". The port carries a value re-derived when a control moves; a swept
				// clock has no such moments. Admitting it anyway would read the clock pin's own
				// square wave as though it were a control voltage, which slams the delay between
				// zero and full scale at the clock rate: audible garbage in place of a quiet
				// wrong answer.
				next = {
					...next,
					// The CAUSE only. What it costs depends on whether the delay has any other
					// derivation, which this stage cannot see and `compile` can -- a packet whose
					// delay follows a knob loses only the sweep, one with no derivation at all is
					// a fixed comb filter. Stating the wrong one of those was a real misfire:
					// `pt2399-delay` derives 239 ms from its own resistor network and was being
					// told its delay was fixed.
					modulationRefusal:
						source === undefined || sourceRow === null
							? "its modulation input is not owned by any solved analog block"
							: `its modulation input is driven by ${source.id}, a ${source.kind} region with ` +
								`${source.controls.length} control(s), which is a signal rather than a ` +
								`control-rate parameter (compiler gate 1b)`,
				};
			}
		}

		// The `modulation` port. Unlike `parameter` above, the node is **not on this device** --
		// it is a transistor's control terminal elsewhere in the clock circuit -- so it arrives
		// as a source node rather than a terminal index and is mapped to a row here.
		//
		// No purity gate, deliberately, and the reason is the inverse of gate 1b's. That gate
		// exists because a `parameter` is cached until a control moves, so an impure derivation
		// silently serves a stale value. This port is read every sample and caches nothing, so
		// there is no staleness to guard. What it needs instead is that the node carry a
		// modulation rather than the oscillator itself, and `resolveClockModulationSource` has
		// already established that by refusing any control terminal sitting on the timing
		// network.
		if (
			macro.modulationNode !== null &&
			macro.modulationNode !== undefined &&
			macro.modulationSteeredBy != null
		) {
			const modNode = macro.modulationNode;
			const modSource = ownerOf(modNode, partitioning);
			const modBlock = modSource === undefined ? undefined : byId.get(modSource.id);
			const modRow =
				modBlock?.kind === "mna" ? blockNodeIndex(modBlock, modNode) : null;
			if (modSource !== undefined && modRow !== null) {
				next = {
					...next,
					modulation: {
						block: modSource.id,
						node: modRow,
						steeredBy: macro.modulationSteeredBy,
					},
				};
			}
		}

		byId.set(region.id, next);
	}

	return {
		blocks: blocks.map((block) => byId.get(block.id) ?? block),
		dependencies,
	};
}

/** The analog region owning `node`, if any -- never a macro region. */
function ownerOf(node: NodeId, partitioning: Partitioning): Region | undefined {
	return partitioning.regions.find(
		(region) => region.kind !== "macro" && region.nodes.includes(node),
	);
}

/** See this file's header for what these two checks are proxies for and why. */
function isPureDerivation(region: Region): boolean {
	return region.kind === "linear" && region.controls.length === 0;
}

/**
 * A new stamp, added to a block whose `linear`/`controlFree` are re-derived rather than
 * assumed unchanged -- the same rule `lowerRegion` itself follows, so a stamp this stage adds
 * cannot silently leave a block claiming a solver cost or a control independence its own
 * stamps contradict.
 *
 * Exported for `dangling-active-terminal.ts`'s implicit op-amp bias synthesis, which adds a
 * stamp to an already-linked block for the same reason this stage does: a block's derived
 * fields must never describe a stamps array it does not have.
 */
export function withStamp(
	block: Extract<Block, { readonly kind: "mna" }>,
	stamp: Stamp,
): Extract<Block, { readonly kind: "mna" }> {
	const stamps = [...block.stamps, stamp];
	// The stamp's own auxiliary-row count, from the shape table, rather than a second local
	// list of which kinds need one. The two had already drifted: the local list omitted
	// `logic-divider`, `spring-reverb` and `clock-driver`, and added a flat 1 where
	// `clock-driver` owns 3. Unreachable today -- this stage only ever adds `conductance` and
	// `macro-audio-source` -- but wrong for any kind it is later asked to add.
	const auxCount = block.auxCount + stampShape(stamp).aux;
	const stampPartition = computeStampPartition(stamps, block.nodeCount);
	const sparseSchedule = computeSparseSchedule({
		nodeCount: block.nodeCount,
		auxCount,
		stamps,
	});
	const linear = !stamps.some(stampNeedsNewton);
	const controlFree = stamps.every((candidate) => stampControl(candidate) === null);
	const eliminate = shouldEliminate(
		block.nodeCount + auxCount,
		stampPartition.portRows.length,
		linear,
	);
	return {
		...block,
		stamps,
		stampPartition,
		sparseSchedule,
		auxCount,
		linear,
		controlFree,
		eliminate,
	};
}


/** Whether target is reachable from from in the dependency graph. */
function reaches(
	from: string,
	target: string,
	dependencies: Record<string, string[]>,
): boolean {
	if (from === target) {
		return true;
	}
	const visited = new Set<string>();
	const queue = [from];
	while (queue.length > 0) {
		const current = queue.shift()!;
		if (current === target) {
			return true;
		}
		if (visited.has(current)) {
			continue;
		}
		visited.add(current);
		for (const next of dependencies[current] ?? []) {
			queue.push(next);
		}
	}
	return false;
}
