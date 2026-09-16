// How far down the amplification chain this program's output already is.
//
// A chain cannot otherwise know. `mesa-boogie-mark-v` renders 11.7 V and `fender-5e3-deluxe-tweed`
// renders 7.08 V, and those numbers are not comparable: the first is a preamp monitor tap on a
// packet that declares no output transformer, the second is a speaker terminal with an 8 ohm load
// across it. For a day they sat in the same "plausible" column. The same blindness is what lets a
// signal that already contains a cabinet be sent through another one.
//
// Deliberately a small closed vocabulary, ordered from least to most processed, because the useful
// questions are ordinal: is this a speaker-terminal signal, and does it already contain a cabinet.
//
// `miked` is in the vocabulary and is **never derived here**. No compiled circuit contains a
// microphone; it exists for a NAM profile, whose own metadata is the only thing that can claim it,
// and for the chain rule that a miked source must not be sent through an IR or the cab simulation.

import { GROUND, type Block, type NodeId, type Ports, type Program } from "./types";

/**
 * Read from the lowered stamps, the same discipline as `supply-reference.ts` and
 * `port-full-scale.ts`.
 *
 * The distinctions available from a program, and nothing finer:
 *
 * - `speaker-electrical` — the output port sits on a winding of a transformer declaring a `ratio`,
 *   so it *is* the speaker terminal. **Position, not load quality**: whether a speaker is
 *   modelled across it is a different question, answered by Stage A of the output-stage plan and
 *   its §4.6 table. An earlier draft here split this by "is something resistive across the node",
 *   and `fender-bassman` showed why that fails -- a 27 kOhm network element sits on its secondary
 *   and no test at this stage can tell that from an 8 Ohm driver without guessing from magnitude.
 * - `preamp` — no output transformer at all, but the program declares a high-voltage supply
 *   winding (`voltsHv`), which only an amp has. `mesa-boogie-mark-v` lands here: its packet hands
 *   the transformer and speaker to a companion fixture, so its render is a preamp level.
 * - `instrument` — everything else, which is every pedal: a pedal does not claim to be further
 *   along the chain than the instrument feeding it.
 */
export function stageCoverage(
	blocks: readonly Block[],
	ports: Ports,
): Program["stageCoverage"] {
	const windingNodes = new Set<NodeId>();
	let declaresHighVoltageWinding = false;
	for (const block of blocks) {
		if (block.kind !== "mna") {
			continue;
		}
		for (const stamp of block.stamps) {
			if (stamp.kind !== "transformer") {
				continue;
			}
			if (!Number.isFinite(stamp.turnsRatio) || stamp.turnsRatio <= 0) {
				continue;
			}
			for (const row of [
				stamp.primaryPlus,
				stamp.primaryMinus,
				stamp.secondaryPlus,
				stamp.secondaryMinus,
			]) {
				const node = block.nodeIds[row];
				if (node !== undefined && node !== GROUND) {
					windingNodes.add(node);
				}
			}
		}
	}
	// **Widen through an impedance selector, which is where the speaker actually sits.** An ohms
	// selector stands between a secondary's taps and the speaker jack, so the port is one hop past
	// the winding rather than on it -- `hiwatt-dr103` stamps three selector throws at nodes
	// 130/131/132, all on its output transformer, with their common at node 133 carrying both
	// speaker jacks and the selected load, and `resolvePorts` correctly picks 133. Without this the
	// packet classified as `preamp` while holding a fully stamped power stage, which is the same
	// mistake `output-port-not-transformer-coupled` was making in `netlist.ts` and for the same
	// reason: two tests of one question, only one of which followed the circuit.
	//
	// **One throw on the winding is enough, and the guard that matters is `windingNodes` being
	// non-empty.** A count of two was tried first and does not work here: the unselected taps of an
	// impedance selector are dropped during lowering as open throws, so only the live tap is ever a
	// winding node -- `hiwatt-dr103` reaches this with exactly one. What stops a pedal's footswitch
	// from qualifying is not the count but that a pedal declares no ratio-bearing transformer, so
	// `windingNodes` is empty and no throw can be on it. Measured: exactly one corpus document holds
	// both a ratio-bearing transformer stamp and a selector stamp -- `fender-bassman`, already
	// `speaker-electrical` -- so relaxing the count reclassifies nothing that compiles today. Read
	// off stamps and node ids only; no name, no role.
	for (const block of blocks) {
		if (block.kind !== "mna") {
			continue;
		}
		const throwsByCommon = new Map<NodeId, Set<NodeId>>();
		for (const stamp of block.stamps) {
			if (stamp.kind !== "selector") {
				continue;
			}
			const common = block.nodeIds[stamp.common];
			const thrown = block.nodeIds[stamp.throwNode];
			if (common === undefined || thrown === undefined) {
				continue;
			}
			if (!windingNodes.has(thrown)) {
				continue;
			}
			const seen = throwsByCommon.get(common) ?? new Set<NodeId>();
			seen.add(thrown);
			throwsByCommon.set(common, seen);
		}
		for (const [common, thrown] of throwsByCommon) {
			if (thrown.size >= 1 && common !== GROUND) {
				windingNodes.add(common);
			}
		}
	}
	// A high-voltage winding is a power transformer's, whose windings are lowered as independent
	// sources rather than a ratio — hence a separate pass over the same blocks rather than the
	// loop above.
	for (const block of blocks) {
		if (block.kind !== "mna") {
			continue;
		}
		for (const stamp of block.stamps) {
			if (stamp.kind === "ac-source" && Math.abs(stamp.amplitudeVolts) > 100) {
				declaresHighVoltageWinding = true;
			}
		}
	}
	if (windingNodes.has(ports.output)) {
		return "speaker-electrical";
	}
	return declaresHighVoltageWinding ? "preamp" : "instrument";
}

