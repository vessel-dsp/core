// Compile-time stamp partitioning for MNA blocks.
//
// Classifies stamps into linear vs nonlinear (port rows), control-dependent vs
// constant, and dynamic/reactive state. Precomputed at compile time and emitted on
// the program as data, avoiding runtime re-classification or dynamic row allocations.

import type { ControlId, NodeId, Stamp, StampPartition } from "./types";
import { atLeast, type PerBlock, perBlock } from "./denomination";

/**
 * Which fields of each stamp kind hold a node id.
 *
 * One table rather than a switch per consumer. `remapStampNodes` used to restate this as 150
 * lines of `{ ...stamp, anode: row(stamp.anode), cathode: row(stamp.cathode) }`, and
 * `stampTerminals` in `sparse-schedule.ts` restates a near-copy of it again for a different
 * purpose. That is the same fact written twice, and the documented failure mode of getting it
 * wrong is severe: a stamp kind missing a case kept its authored node ids while every other
 * stamp in the block moved to row indices, which is an element quietly wired to the wrong
 * nodes that still renders.
 *
 * `satisfies` checks this harder than the switch did. The mapped type requires **every** stamp
 * kind to appear -- a new kind is a compile error here -- and requires each listed name to be
 * an actual key of that kind's own variant, so a typo or a field moved during a refactor fails
 * to build rather than silently renumbering nothing.
 */
export const STAMP_SHAPES = {
	conductance: { nodes: ["a", "b"], aux: 0, ports: "none", newton: false },
	"controlled-conductance": {
		nodes: ["a", "b"],
		aux: 0,
		ports: "none",
		newton: false,
		control: true,
	},
	"controlled-resistance": {
		nodes: ["a", "b"],
		aux: 0,
		ports: "none",
		newton: false,
		control: true,
	},
	capacitor: {
		nodes: ["a", "b"],
		aux: 0,
		ports: "none",
		newton: false,
		dynamic: true,
	},
	inductor: {
		nodes: ["a", "b"],
		aux: 0,
		ports: "none",
		newton: false,
		dynamic: true,
	},
	switch: {
		nodes: ["a", "b"],
		aux: 0,
		ports: "none",
		newton: false,
		control: true,
	},
	selector: {
		nodes: ["common", "throwNode"],
		aux: 0,
		ports: "none",
		newton: false,
		control: true,
	},
	// A sine EMF is time-varying and linear: it differs between samples and is a constant
	// within the system being solved at each one, exactly as the input source is.
	"dc-source": {
		nodes: ["positive", "negative"],
		aux: 1,
		ports: "none",
		newton: false,
	},
	"ac-source": {
		nodes: ["positive", "negative"],
		aux: 1,
		ports: "none",
		newton: false,
	},
	"input-source": { nodes: ["node"], aux: 1, ports: "none", newton: false },
	// A `coupled` port's write-back, same shape as `dc-source`: a same-sample source term,
	// not a curve. The macro core it reads from is a delay line, which needs no Newton loop
	// of its own either -- see couple.ts's header for why that stays true for this build.
	"macro-audio-source": {
		nodes: ["node"],
		aux: 1,
		ports: "none",
		newton: false,
	},
	"logic-divider": {
		nodes: ["clockNode", "qNode", "gndNode"],
		aux: 1,
		ports: "none",
		newton: false,
		dynamic: true,
	},
	// A VCCS is linear within a sample: transconductance couples the controlling input pair
	// (inP, inN) to the output pair (outP, outN) across the Jacobian matrix.
	vccs: {
		nodes: ["outP", "outN", "inP", "inN"],
		aux: 0,
		ports: "none",
		newton: false,
	},
	transformer: {
		nodes: ["primaryPlus", "primaryMinus", "secondaryPlus", "secondaryMinus"],
		aux: 1,
		ports: "nodes-and-aux",
		newton: false,
	},
	// A tank is stateful but not non-linear: within one sample it is a fixed conductance and a
	// fixed Thevenin source. Its memory advances once per sample, after the solve. It still
	// declares port rows, which is why `ports` and `newton` are separate facts here.
	"spring-reverb": {
		nodes: ["inputPlus", "inputMinus", "outputPlus", "outputMinus"],
		aux: 1,
		ports: "nodes",
		newton: false,
		dynamic: true,
	},
	// Rails make an op-amp saturate, which is the mode switch Newton is for. Without them it is
	// a plain high-gain VCVS and the row stays linear.
	"ideal-opamp": {
		nodes: ["plus", "minus", "output"],
		aux: 1,
		ports: "railed-opamp",
		newton: "railed-opamp",
	},
	diode: { nodes: ["anode", "cathode"], aux: 0, ports: "nodes", newton: true },
	"tube-diode": {
		nodes: ["plate", "cathode"],
		aux: 0,
		ports: "nodes",
		newton: true,
	},
	bjt: {
		nodes: ["base", "collector", "emitter"],
		aux: 0,
		ports: "nodes",
		newton: true,
	},
	fet: {
		nodes: ["gate", "drain", "source"],
		aux: 0,
		ports: "nodes",
		newton: true,
	},
	triode: {
		nodes: ["grid", "cathode", "plate"],
		aux: 0,
		ports: "nodes",
		newton: true,
	},
	pentode: {
		nodes: ["grid", "cathode", "plate", "screen"],
		aux: 0,
		ports: "nodes",
		newton: true,
	},
	ota: {
		nodes: ["plus", "minus", "bias", "output", "vee"],
		aux: 0,
		ports: "nodes",
		newton: true,
	},
	optocoupler: {
		nodes: ["ldrA", "ldrB", "ledAnode", "ledCathode"],
		aux: 0,
		ports: "nodes",
		newton: true,
	},
	"analog-switch": {
		nodes: ["a", "b", "control"],
		aux: 0,
		ports: "nodes",
		newton: true,
	},
	compandor: {
		nodes: ["rectIn", "rectCap", "cellIn", "sumNode", "vref"],
		aux: 0,
		ports: "nodes",
		newton: true,
		dynamic: true,
	},
	// Owns three consecutive auxiliary rows, which its matrix square covers but its port rows
	// deliberately do not.
	"clock-driver": {
		nodes: ["cp1", "cp2", "vgg", "vdd", "ox1", "gnd"],
		aux: 3,
		ports: "nodes",
		newton: true,
	},
	comparator: {
		nodes: ["plus", "minus", "output", "vee"],
		aux: 0,
		ports: "nodes",
		newton: true,
	},
} as const satisfies {
	[K in Stamp["kind"]]: {
		readonly nodes: readonly (keyof Extract<Stamp, { kind: K }> & string)[];
		readonly aux: 0 | 1 | 3;
		readonly ports: "none" | "nodes" | "nodes-and-aux" | "railed-opamp";
		readonly newton: boolean | "railed-opamp";
		readonly terminalNodes?: readonly (keyof Extract<Stamp, { kind: K }> &
			string)[];
		readonly terminalsDropGround?: true;
		/** Carries a `control` field naming the knob that moves its value. */
		readonly control?: true;
		/** Carries companion state across time steps. */
		readonly dynamic?: true;
	};
};

type StampShape = {
	readonly nodes: readonly string[];
	readonly aux: 0 | 1 | 3;
	readonly ports: "none" | "nodes" | "nodes-and-aux" | "railed-opamp";
	readonly newton: boolean | "railed-opamp";
	readonly terminalNodes?: readonly string[];
	readonly terminalsDropGround?: true;
	readonly control?: true;
	readonly dynamic?: true;
};

/** The shape entry for a stamp, with the table's per-kind literal types widened away. */
export function stampShape(stamp: Stamp): StampShape {
	return STAMP_SHAPES[stamp.kind] as StampShape;
}

/** Read a named node field off a stamp. */
export function stampNodeValue(stamp: Stamp, field: string): number {
	return (stamp as unknown as Record<string, number>)[field] as number;
}

/** The auxiliary rows a stamp owns, as absolute row indices. */
export function stampAuxRows(stamp: Stamp, nodeCount: number): number[] {
	const shape = stampShape(stamp);
	if (shape.aux === 0) return [];
	const base =
		nodeCount + ((stamp as unknown as Record<string, number>).sourceIndex ?? 0);
	return Array.from({ length: shape.aux }, (_, offset) => base + offset);
}

/**
 * Rewrite a stamp's node fields through `row`.
 *
 * The spread reassigns keys the stamp already carries, so their position in the object is
 * unchanged -- which matters because a lowered stamp is serialised into the emitted program
 * and key order is part of those bytes.
 */
export function remapStampNodes(
	stamp: Stamp,
	row: (node: NodeId) => NodeId,
): Stamp {
	const remapped: Record<string, unknown> = { ...stamp };
	for (const field of stampShape(stamp).nodes) {
		remapped[field] = row(stampNodeValue(stamp, field) as NodeId);
	}
	return remapped as unknown as Stamp;
}

/**
 * Does this stamp have to be re-evaluated inside a Newton loop?
 *
 * **The stamp-level twin of `partition.ts`'s `lawNeedsNewton`, and deliberately a second fact
 * rather than a reuse of the first.** A law and its stamps are not the same list -- a jack's
 * `port-engage` law lowers to a plain `conductance`, an `ac-source` law lowers to two stamps,
 * an `open` law lowers to none -- and what a solver has to do is decided by what is in the
 * block, not by what was in the document. `Block.linear` is read by the runtime to choose
 * between one pass and an iteration cap, so it has to describe the stamps it will evaluate.
 *
 * The two mistakes are not symmetric, which is why the table has to be exhaustive. Calling a
 * linear stamp nonlinear costs a few iterations; calling a nonlinear stamp linear makes
 * `iterate` run one pass, evaluate the curve once from a zero start, and emit that as a solved
 * answer -- no held sample, no telemetry, no diagnostic.
 */
export function stampNeedsNewton(stamp: Stamp): boolean {
	const { newton } = stampShape(stamp);
	if (newton === "railed-opamp") {
		return (stamp as Extract<Stamp, { kind: "ideal-opamp" }>).railHigh !== null;
	}
	return newton;
}

/**
 * Which runtime control moves a stamp's value, or `null` when it is constant.
 *
 * Read off the shape table's `control` flag. A stamp missing that flag would silently make a
 * block look `controlFree`, and step 4's whole promise is that such a block's matrix is
 * constant -- so the omission would be a factorisation frozen against a knob that still moves.
 */
export function stampControl(stamp: Stamp): ControlId | null {
	return stampShape(stamp).control === true
		? ((stamp as unknown as Record<string, ControlId>).control ?? null)
		: null;
}

/**
 * Which rows a stamp's device law actually writes into the Jacobian / RHS, or `null` when the
 * stamp writes none.
 *
 * Read off the shape table's `ports`, which is a **separate fact from `newton`** and not a
 * synonym for it. `transformer` and `spring-reverb` are both linear within a sample yet
 * declare port rows, so deriving this from `stampNeedsNewton` would drop them.
 *
 * The returned order is not significant: `computeStampPartition` feeds these into a `Set` and
 * sorts it.
 */
export function stampPortRows(
	stamp: Stamp,
	nodeCount: number,
): readonly number[] | null {
	const shape = stampShape(stamp);
	if (shape.ports === "none") return null;
	if (
		shape.ports === "railed-opamp" &&
		(stamp as Extract<Stamp, { kind: "ideal-opamp" }>).railHigh === null
	) {
		return null;
	}
	const rows = shape.nodes.map((field) => stampNodeValue(stamp, field));
	return shape.ports === "nodes"
		? rows
		: [...rows, ...stampAuxRows(stamp, nodeCount)];
}

/**
 * Whether a stamp carries dynamic/reactive state (e.g. companion state across time steps).
 */
export function stampIsDynamic(stamp: Stamp): boolean {
	return stampShape(stamp).dynamic === true;
}

/**
 * Compute the complete stamp partition for an MNA block.
 */
export function computeStampPartition(
	stamps: readonly Stamp[],
	nodeCount: number,
): StampPartition {
	const ports = new Set<number>();
	const linearStampIndices: number[] = [];
	const nonlinearStampIndices: number[] = [];
	const constantStampIndices: number[] = [];
	const controlStampIndices: number[] = [];
	const dynamicStampIndices: number[] = [];

	for (let index = 0; index < stamps.length; index += 1) {
		const stamp = stamps[index] as Stamp;
		const rows = stampPortRows(stamp, nodeCount);
		const isLinear = rows === null;
		if (isLinear) {
			linearStampIndices.push(index);
		} else {
			nonlinearStampIndices.push(index);
			for (const row of rows) {
				if (row !== 0) {
					ports.add(row);
				}
			}
		}

		const isControl = stampControl(stamp) !== null;
		if (isControl) {
			controlStampIndices.push(index);
		}

		const isDynamic = stampIsDynamic(stamp);
		if (isDynamic) {
			dynamicStampIndices.push(index);
		}

		const isSignalSource =
			stamp.kind === "input-source" ||
			stamp.kind === "macro-audio-source" ||
			stamp.kind === "ac-source";
		if (isLinear && !isControl && !isDynamic && !isSignalSource) {
			constantStampIndices.push(index);
		}
	}

	// Auxiliary rows owned by sources whose non-ground terminals are all in `ports` have no
	// off-diagonal coupling into the linear interior `L`. Leaving such an aux row in `L` creates an
	// all-zero row in `M_lin[L][L]` when source resistance is zero, making `M_lin[L][L]` singular
	// and dropping the source excitation. Promoting the aux row to `ports` couples it directly to
	// the port equations.
	for (const stamp of stamps) {
		const auxRows = stampAuxRows(stamp, nodeCount);
		if (auxRows.length === 0) continue;
		const nodes = stampShape(stamp).nodes.map((f) => stampNodeValue(stamp, f));
		const nonGroundNodes = nodes.filter((n) => n !== 0);
		if (
			nonGroundNodes.length > 0 &&
			nonGroundNodes.every((n) => ports.has(n))
		) {
			for (const aux of auxRows) {
				ports.add(aux);
			}
		}
	}

	return {
		portRows: [...ports].sort((a, b) => a - b),
		linearStampIndices,
		nonlinearStampIndices,
		constantStampIndices,
		controlStampIndices,
		dynamicStampIndices,
	};
}

/**
 * Thresholds for solving a block by eliminating its linear interior and iterating only the
 * nonlinear port rows (the runtime's Schur-complement path).
 *
 * All three must hold, and they are a cost model rather than a correctness rule -- eliminating
 * a block that fails them is still a correct solve, just a slower one. The ratio says the
 * interior is worth removing at all, the floor keeps the extra bookkeeping off small blocks,
 * and the cubic saving estimates the dense-factorisation work actually avoided.
 */
const ELIMINATE_MIN_UNKNOWN_RATIO = 2.4;
const ELIMINATE_MIN_UNKNOWNS = 12;
/**
 * **Per BLOCK, and typed so it cannot be compared against a per-packet figure.** A prediction
 * stated in these units was measured in packet units on 2026-09-11 and the resulting null was
 * meaningless -- 84% of a block became 0.3% of a packet, and four independent checks passed it
 * because each was correct at the level it was stated. The type now makes that comparison fail
 * to compile rather than fail to be noticed.
 */
const ELIMINATE_MIN_ALGEBRAIC_SAVING: PerBlock = perBlock(5000);

/**
 * Whether a block should carry the eliminated (Schur-complement) solve.
 *
 * Shared by `lower.ts`, which decides it when a region is first lowered, and `couple.ts`,
 * which must re-decide it after adding a stamp. The two carried byte-identical copies of this
 * predicate, so a threshold changed in one and not the other would have made a coupled block
 * disagree with the same block uncoupled.
 */
export function shouldEliminate(
	unknowns: number,
	portRowCount: number,
	linear: boolean,
): boolean {
	if (linear || portRowCount === 0) {
		return false;
	}
	if (derivedAdmissionEnabled()) {
		return derivedShouldEliminate(unknowns, portRowCount);
	}
	return (
		unknowns / portRowCount >= ELIMINATE_MIN_UNKNOWN_RATIO &&
		unknowns >= ELIMINATE_MIN_UNKNOWNS &&
		atLeast(perBlock(unknowns ** 3 - portRowCount ** 3), ELIMINATE_MIN_ALGEBRAIC_SAVING)
	);
}

/**
 * **The measured dense-versus-sparse penalty**, from the WASM console on two matched-size pairs:
 * `boss-ch-1` (dense) against `orange-gro100` (sparse) at 85 unknowns, and `boss-ce-5` against
 * `mxr-carbon-copy` at ~100. **Measured, not chosen** — which is the whole point of using it here.
 *
 * **It is measured at 85–105 unknowns only and should GROW with size**, since dense factorisation
 * scales roughly `n³` against a sparse schedule's `n^1.5`-ish. Two pairs at one size cannot tell a
 * constant from a size-dependent penalty, so treat this as "about 1.9 at ~100 unknowns, unmeasured
 * above".
 */
const MEASURED_DENSIFICATION = 1.9;

/**
 * The derived admission rule, behind `VESSEL_DERIVED_ELIMINATION=1`.
 *
 * **Cost goes as unknowns² × nonlinear count** — fitted across ten packets with WASM-measured cost,
 * `R² = 0.674`. Elimination replaces an `n`-unknown iterated system with a `p`-unknown one, and its
 * own factorisation is prepare-time for a linear interior. What it costs per sample is
 * **densification**: the port system is dense where the original may have been sparse. So:
 *
 * ```
 * admit when   MEASURED_DENSIFICATION * p²  <  n²      i.e.  n/p > sqrt(1.9) = 1.378
 * ```
 *
 * **No free constant.** `1.9` is measured and the exponent is fitted; neither was chosen to admit
 * any particular packet — which is the failure this replaces. Lowering `2.4` until it admitted the
 * three packets whose saving had been predicted would have made the prediction and the admission
 * one choice, and no later measurement could have separated them.
 *
 * **`ELIMINATE_MIN_UNKNOWNS` is still consulted and is still hand-set.** The model has **no term
 * for fixed per-block overhead**, and without one the inequality admits every block with any
 * interior — 241 of 241, which is not a predicate. The floor stands in for that missing term, and
 * the sample straddling it (15 admitted blocks below, 31 above) is designed to retire it: if a
 * 7-unknown block predicted at 84% delivers nothing, the overhead is the whole saving at that size
 * and the crossover **is** the floor, derived rather than chosen.
 */
export function derivedShouldEliminate(
	unknowns: number,
	portRowCount: number,
): boolean {
	if (portRowCount === 0) {
		return false;
	}
	return (
		MEASURED_DENSIFICATION * portRowCount ** 2 < unknowns ** 2 &&
		unknowns >= ELIMINATE_MIN_UNKNOWNS
	);
}

/**
 * Off by default, and deliberately so: enabling it changes the compiled program of a large share of
 * the corpus, which moves all seven gates at once and would not localise a failure. It is measured
 * on a registered sample spanning the prediction range first — see
 * `artifacts/docs/validation/2026-09-11-what-actually-drives-cpu-cost.md`.
 */
function derivedAdmissionEnabled(): boolean {
	return process.env.VESSEL_DERIVED_ELIMINATION === "1";
}
