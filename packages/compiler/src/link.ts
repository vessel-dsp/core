// Stage 6: order the blocks and assemble the program.
//
// Execution order comes from the partition dependency graph: a macro model whose
// parameters are set by an analog region must run after it. Topological, and a cycle
// is an error rather than an arbitrary tie-break.
//
// **`order` is what executes, and it is not every block.** A block that cannot reach the
// output is left out of it, which is the build order's "do not execute an operator that
// cannot reach the output" -- see `executionOrder`. The blocks themselves all stay in the
// program.
//
// The program carries its controls -- including each one's taper -- because taper is
// emitted rather than evaluated at compile time. It deliberately carries **no sample
// rate**: a program is valid at any rate and is given one at initialization.

import { StageRefusal } from "./errors";
import { portFullScaleVolts } from "./port-full-scale";
import { stageCoverage } from "./stage-coverage";
import { supplyReference } from "./supply-reference";
import type {
	Block,
	Control,
	CostPredictors,
	OperatorKind,
	Partitioning,
	Ports,
	Program,
} from "./types";

export class LinkError extends StageRefusal {
	constructor(message: string) {
		super("link", null, message);
	}
}

export function link(
	blocks: readonly Block[],
	partitioning: Partitioning,
	controls: readonly Control[],
	ports: Ports,
	// Defaulted, because "the source declares no port impedance" is the state of almost every
	// document -- zero corpus input jacks declare one -- so a caller with nothing to say says nothing.
	portImpedanceOhms: Program["portImpedanceOhms"] = {
		input: null,
		output: null,
	},
	// Likewise defaulted, and likewise a stage-1 read: `V0dBFS` is a declaration on the port's own
	// jack, which only stage 1 can see.
	portDeclaredFullScaleVolts: Program["portImpedanceOhms"] = {
		input: null,
		output: null,
	},
): Program {
	const order = executionOrder(blocks, partitioning);
	const live = new Set(order);
	const executed = blocks.filter((block) => live.has(block.id));
	return {
		formatVersion: 1,
		// Read off `order`'s blocks, not `blocks` -- see `requiredOperators`'s own comment for
		// why a pruned block's operator is not "required to execute a program" at all. The
		// same exclusion applies to `requiredModels` and to `costPredictors`, for the same
		// reason: a block that never runs cannot be a cost this program's execution needs to be
		// admitted against, and cannot be an algorithm a runtime needs to gain to execute it.
		requiredOperators: requiredOperators(executed),
		requiredModels: requiredModels(executed),
		costPredictors: costPredictors(executed, order.length),
		blocks,
		order,
		controls,
		ports,
		// From `blocks`, not `executed`, and the difference is deliberate: the three fields
		// above describe what executing this program costs and needs, so a pruned block cannot
		// contribute to them. Which terminal the circuit calls ground is a property of the
		// circuit as declared -- a positive-ground fuzz whose supply island happens not to
		// reach the output port is still a positive-ground fuzz, and a chain sharing one
		// physical supply has to know that.
		supplyReference: supplyReference(blocks),
		// From `blocks` and `ports` together: the bound is a property of the rails feeding the
		// circuit and of which node the port landed on, both of which are already decided by
		// the time this runs.
		portFullScaleVolts: portFullScaleVolts(blocks, ports),
		// **The port's declared 0 dBFS reference, kept apart from the derived ceiling above.**
		//
		// They are different quantities and folding them together is a level error, measured
		// rather than argued: a pedal's derived output is its 9 V supply -- the largest voltage
		// that node can reach -- while a declared input `V0dBFS` is 0.1 to 1 V, the voltage that
		// *means* full scale. Substituting one for the other made 4,994 of the 13,806 ordered
		// pedal-to-pedal seams scale by a median of 9x (+19 dB) and up to 240x (+47.6 dB), by
		// dividing a ceiling by a reference.
		//
		// So a consumer picks the one its question needs. A render converting into a +/-1 file
		// wants the reference where a source states one and the ceiling otherwise -- either is a
		// valid conversion. `chainScaleFactor` compares two ports and needs like with like, so it
		// still reads `portFullScaleVolts`; moving it to reference-to-reference would start
		// scaling 850 seams at a median of +9.5 dB and belongs in its own change with its own
		// listening pass.
		portReferenceVolts: portDeclaredFullScaleVolts,
		stageCoverage: stageCoverage(blocks, ports),
		// A port property, decided in stage 1 where the jack's own declaration is readable.
		portImpedanceOhms,
	};
}

/**
 * The rate-independent cost facts the executed blocks can honestly declare — see
 * `CostPredictors`'s own doc for what this deliberately omits and why.
 */
function costPredictors(
	executed: readonly Block[],
	executedBlockCount: number,
): CostPredictors {
	let stateCount = 0;
	const solvedBlocks: {
		blockId: string;
		unknownCount: number;
		linear: boolean;
	}[] = [];
	const macroBlocks: { blockId: string; modelId: string }[] = [];
	for (const block of executed) {
		if (block.kind === "macro") {
			// Declared, not priced -- see `CostPredictors.macroBlocks`. Its absence is what let
			// a macro's per-sample work cost zero at the admission gate.
			macroBlocks.push({ blockId: block.id, modelId: block.modelId });
			continue;
		}
		stateCount += block.stateCount;
		solvedBlocks.push({
			blockId: block.id,
			unknownCount: block.nodeCount + block.auxCount,
			linear: block.linear,
		});
	}
	return { executedBlockCount, stateCount, solvedBlocks, macroBlocks };
}

/**
 * The blocks to execute, in dependency order: those that can reach the output.
 *
 * **Why any block cannot.** Stage 4 groups devices into regions by shared non-ground node,
 * so two analog regions share nothing but ground — they are separate subcircuits, not
 * halves of one system. The runtime solves each independently and takes its output sample
 * from the block owning the output jack. A region owning neither the output nor an edge into
 * something that does therefore has its entire solution discarded, every sample. Measured
 * across the corpus: 141 of 191 regions own neither port, and 84% of the nodes solved per
 * sample are thrown away. `boss-ds-1` is the extreme, and is exactly why it is both the
 * slowest packet and a silent one.
 *
 * **Why the dependency graph is needed rather than the port fields alone.** A macro model's
 * parameters can be set by an analog region it shares a node with — a BBD's delay time comes
 * from its clock network — so a region with no port of its own can still be load-bearing.
 * Reachability computed from `inputNode`/`outputNode` alone would delete the input shell and
 * the clock network of the `hybridDelayPedal` fixture, which is a silent wrong answer rather
 * than a slow one. Hence the traversal: if a live block depends on a producer, the producer
 * is live too.
 *
 * **Why a macro block is seeded live unconditionally**, which is the conservative half of
 * this rule and the reason it is safe to land before the operator format is finished. The
 * `macro` variant carries no `inputNode` or `outputNode` at all, so the compiler cannot show
 * that a macro fails to reach the output — the ports that would answer do not exist. The two
 * errors are not symmetric: keeping a dead block costs solve time that shows up in a
 * measurement, while dropping a live one is audio that is quietly missing a stage. So an
 * unprovable case stays.
 *
 * **Why `order` and not `blocks`.** Pruning the block list would delete the structural
 * record `report-compiler-fidelity.ts` reads — the compiler's own correctness gate while
 * stamps exist — turning a scheduling change into a fidelity regression, and would also
 * discard the circuit a later step still has to eliminate or factor. Leaving the blocks and
 * shortening the execution list is the whole of the change the runtime needs: it already
 * iterates `order`.
 *
 * The cycle refusal is deliberately computed over *every* block, before this filter: a
 * cyclic dependency is a compiler defect whether or not the blocks in it are audible.
 */
function executionOrder(
	blocks: readonly Block[],
	partitioning: Partitioning,
): readonly string[] {
	const live = blocksReachingOutput(blocks, partitioning);
	return topologicalOrder(blocks, partitioning).filter((id) => live.has(id));
}

function blocksReachingOutput(
	blocks: readonly Block[],
	partitioning: Partitioning,
): ReadonlySet<string> {
	const live = new Set<string>();
	const pending: string[] = [];
	for (const block of blocks) {
		if (block.kind === "macro" || block.outputNode !== null) {
			live.add(block.id);
			pending.push(block.id);
		}
	}
	while (pending.length > 0) {
		const id = pending.pop() as string;
		for (const producer of partitioning.dependencies[id] ?? []) {
			if (!live.has(producer)) {
				live.add(producer);
				pending.push(producer);
			}
		}
	}
	return live;
}

/**
 * The operators the *executed* blocks actually use, sorted and deduplicated.
 *
 * Read off the stamps rather than assumed from the device kinds, because the two are not
 * the same list: a pot lowers to two `controlled-conductance` stamps, a jack's engage
 * contact to a `conductance`, and a device whose law is `open` stamps nothing at all. What
 * a runtime must implement is what is in the program, not what was in the document.
 *
 * **Callers pass only the live blocks (`order`'s), not every retained one.** `Program`'s own
 * doc comment calls this "every operator this program needs a runtime to implement... to
 * execute a program," and a block `executionOrder` prunes never executes under any runtime --
 * so its operators cannot be needed to execute the program regardless of what a consumer
 * implements. Declaring them anyway is not safe conservatism either: the console/ROM
 * principle's refusal exists to prevent *silence*, and a pruned block is silent (never runs)
 * under every runtime already, so requiring its operator cannot prevent silence and can only
 * cause a constrained second runtime (e.g. ESP32, implementing a subset) to refuse a pedal it
 * could actually play. Measured on the corpus before this changed: 4 of 52 compiling packets
 * (`boss-ds-1`, `analog-man-prince-of-tone` -- both zero live blocks -- plus `boss-od-3` and
 * `boss-sd-1`, each carrying a `selector` only in a region that never reaches the output) had
 * exactly this gap. A consumer that wants every retained block's operators regardless of
 * liveness (a fidelity/structural tool, say) can compute it itself from `Program.blocks`,
 * which still carries every block -- only this declared, "must implement" set narrows.
 *
 * Sorted so the declaration is a function of the set and not of stamp order — otherwise two
 * identical circuits drawn in a different order would emit different bytes and different
 * digests.
 */
function requiredOperators(blocks: readonly Block[]): readonly OperatorKind[] {
	const kinds = new Set<OperatorKind>();
	for (const block of blocks) {
		if (block.kind !== "mna") {
			continue;
		}
		for (const stamp of block.stamps) {
			kinds.add(stamp.kind);
		}
	}
	return [...kinds].sort();
}

/**
 * The DSP algorithms the executed macro blocks name — `requiredOperators`'s counterpart for
 * the half of the instruction set that is not a stamp. See `Program.requiredModels` for why
 * this is a second set rather than more entries in the first.
 *
 * Live blocks only and sorted, for the two reasons `requiredOperators` records: a pruned
 * block cannot be an algorithm a runtime needs to gain, and an unsorted declaration would
 * make the emitted bytes a function of block order rather than of the set.
 *
 * **No validation here, deliberately.** This compiler cannot know which algorithms the
 * runtime that will execute the program implements, and inventing an allowlist here would
 * either duplicate one runtime's list into a portable artifact or refuse a program a second,
 * richer runtime could play. Declaring truthfully is the whole contribution; refusing is the
 * runtime's job, by name, at load.
 */
function requiredModels(blocks: readonly Block[]): readonly string[] {
	const models = new Set<string>();
	for (const block of blocks) {
		if (block.kind !== "macro") {
			continue;
		}
		models.add(block.modelId);
	}
	return [...models].sort();
}

function topologicalOrder(
	blocks: readonly Block[],
	partitioning: Partitioning,
): readonly string[] {
	const ids = blocks.map((block) => block.id);
	const remaining = new Set(ids);
	const ordered: string[] = [];

	while (remaining.size > 0) {
		const ready = [...remaining].filter((id) =>
			(partitioning.dependencies[id] ?? []).every(
				(dependency) => !remaining.has(dependency),
			),
		);
		if (ready.length === 0) {
			throw new LinkError(
				`cyclic region dependencies among ${[...remaining].join(", ")}`,
			);
		}
		// Stable: preserve the order blocks were produced in.
		ready.sort((a, b) => ids.indexOf(a) - ids.indexOf(b));
		for (const id of ready) {
			ordered.push(id);
			remaining.delete(id);
		}
	}

	return ordered;
}
