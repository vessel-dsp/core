// An active device with a signal terminal wired to nothing, which cannot work.
//
// A collector with nowhere to go, a gate driven by nothing, a drain reaching no load: the device
// is present, it is stamped, and it cannot do its job. `gmin` is why this renders instead of
// failing — every node gets a `1e-12 S` path to ground before the matrix is read, so the row is
// never empty, Newton converges, no sample is held, and the output is silence rather than a
// diagnostic.
//
// **A general "dangling terminal" warning was measured and rejected first.** 2020 dangling nodes
// across 73 of 102 readable packets, with a median of 2 in not-plausible rows against 0 in
// plausible ones, and `boss-mt-2` carrying 11 while rendering fine. Most are harmless — a test
// point, an unpopulated position, an unused pin on a dual op-amp — so the rule had no useful
// signal-to-noise ratio.
//
// Narrowing it to **active devices** changes that, because a passive dangling end is often
// deliberate and an active one is a stage that does nothing. Measured over the compiled corpus:
//
// ```
// flagged                       9 of 52
//   also renders implausibly    8
// ```
//
// `tycobrahe-octavia` is the sharpest case: `Q2.collector` touches no other device, so the
// transistor cannot conduct, its transformer primary never swings, and the pedal draws 10 uA where
// a two-transistor germanium fuzz should draw milliamps. `boss-ds-1` is the loudest: nearly every
// transistor terminal in the packet dangles, which is also why it partitions into 82 regions.
//
// Evidence is stamp connectivity and nothing else. No component name, no `Description`, no part
// number.

import { withStamp } from "./couple";
import { GROUND } from "./types";
import type { Block, CompileWarning, NodeId, Program } from "./types";
import { blockRow, describeRow } from "./block-row";

/**
 * Active-device stamps with a terminal on a node no other stamp touches.
 *
 * **Read from the lowered stamps, not the netlist.** The sibling rule in `over-driven-node.ts`
 * learned this the hard way: `boss-sd-1` declares two supplies on one node and lowering collapses
 * them, so a netlist-level count reported a contradiction that the compiled circuit does not
 * contain. Stamps are what the runtime executes, so they are the only thing that can say whether a
 * terminal really reaches nothing.
 *
 * Per block, because regions are independent solves and the same node id in two regions is two
 * different unknowns.
 *
 * **Op-amp supply pins are excluded, and that exclusion is measured rather than assumed.** An
 * `ideal-opamp` stamp carries no supply nodes at all — its rails are voltages resolved from the
 * circuit's supply set — so a dangling `vcc` is invisible to the solve and cannot be what makes a
 * packet silent. Including it flagged `mxr-distortion-plus` and `mxr-micro-amp`, both of which
 * render plausibly, for a pin the model does not read. The exclusion is free here: those nodes
 * never appear in a stamp.
 *
 * Ground is skipped: every device returns there and it is touched by everything.
 */
export function findDanglingActiveTerminals(
	program: Program,
): readonly CompileWarning[] {
	const warnings: CompileWarning[] = [];
	for (const block of program.blocks) {
		if (block.kind !== "mna") {
			continue;
		}
		const touchCount = new Map<NodeId, number>();
		for (const stamp of block.stamps) {
			for (const node of new Set(stampNodes(stamp))) {
				touchCount.set(node, (touchCount.get(node) ?? 0) + 1);
			}
		}
		for (const stamp of block.stamps) {
			const active = activeTerminals(stamp);
			if (active === null) {
				continue;
			}
			const dangling = active.terminals.filter(
				([, node]) => node !== 0 && touchCount.get(node) === 1,
			);
			if (dangling.length === 0) {
				continue;
			}
			warnings.push({
				code: "active-device-terminal-unwired",
				device: null,
				detail:
					// Named by the source node, not the row it landed on: this message exists to
					// send someone to a net in the `.vdsp`, and a row index is not a net.
					`in block ${block.id}, ${active.label} has ${dangling
						.map(([role, node]) => `${role} on node ${describeRow(block, blockRow(node))}`)
						.join(" and ")}, which no other element touches: the device is stamped and ` +
					"cannot conduct, so the circuit renders silence rather than failing, because " +
					"gmin gives the node a path to ground and the solve converges",
			});
		}
	}
	return warnings;
}

/**
 * Every node a stamp touches, so a node's fan-out can be counted.
 *
 * **Field names come from a closed set, never from scraping integers.** A first version collected
 * every non-negative integer field, which silently counted `sourceIndex` and `stateIndex` as node
 * touches — so a stamp with `sourceIndex: 10` inflated node 10's fan-out and hid
 * `tycobrahe-octavia`'s dangling `Q2.collector`, the packet this rule was built for. An index and a
 * node are both small integers and nothing but the field name distinguishes them.
 */
const nodeFields: ReadonlySet<string> = new Set([
	"a",
	"b",
	"anode",
	"cathode",
	"node",
	"positive",
	"negative",
	"common",
	"throwNode",
	"base",
	"collector",
	"emitter",
	"gate",
	"drain",
	"source",
	"plus",
	"minus",
	"output",
	"primaryPlus",
	"primaryMinus",
	"secondaryPlus",
	"secondaryMinus",
	"grid",
	"plate",
	"screen",
	// Below: derived by enumerating every integer-valued field of every stamp the pedal corpus
	// emits, then keeping the ones whose value indexes a node rather than a quantity. Their
	// absence meant a net held up only by a `vccs`, `compandor`, `ota`, `bbd`, `clock-driver`,
	// `optocoupler` or `logic-divider` terminal read as unoccupied, so this rule could call a
	// wired terminal dangling. `deluxe-memory-man`'s compander summing node is one such net.
	"control",
	"clk1",
	"clk2",
	"input",
	"out1",
	"out2",
	"cp1",
	"cp2",
	"vgg",
	"vdd",
	"ox1",
	"rectIn",
	"rectCap",
	"cellIn",
	"sumNode",
	"vref",
	"vee",
	"bias",
	"clockNode",
	"qNode",
	"gndNode",
	"ledAnode",
	"ledCathode",
	"ldrA",
	"ldrB",
	"outP",
	"outN",
	"inP",
	"inN",
]);

/**
 * Every node a stamp names, from the closed field list above.
 *
 * Exported because `scripts/report-net-graph-health.ts` needs the same answer: its dangling-net
 * count is a gate for source re-capture, and counting *declared* terminals lets a package shell
 * that lowers to no stamp hold a severed net's count down. One enumerator, so the gate and this
 * rule cannot drift apart.
 */
export function stampNodes(
	stamp: Extract<Block, { kind: "mna" }>["stamps"][number],
): readonly NodeId[] {
	const nodes: NodeId[] = [];
	for (const [key, value] of Object.entries(stamp)) {
		if (nodeFields.has(key) && typeof value === "number") {
			nodes.push(value as NodeId);
		}
	}
	return nodes;
}

/**
 * A stamp's signal terminals when it is an active device, or `null` when it is not.
 *
 * Deliberately excludes `dc-source`, `input-source` and `transformer`: a supply's job is to sit on
 * one node, an input source drives one, and a transformer winding with a dangling end is a real but
 * different question — `tycobrahe-octavia`'s shield is exactly that and is not a defect.
 */
function activeTerminals(
	stamp: Extract<Block, { kind: "mna" }>["stamps"][number],
):
	| { readonly label: string; readonly terminals: readonly [string, NodeId][] }
	| null {
	switch (stamp.kind) {
		case "bjt":
			return {
				label: `bjt#${stamp.base}/${stamp.collector}/${stamp.emitter}`,
				terminals: [
					["base", stamp.base],
					["collector", stamp.collector],
					["emitter", stamp.emitter],
				],
			};
		case "fet":
			return {
				label: `fet#${stamp.gate}/${stamp.drain}/${stamp.source}`,
				terminals: [
					["gate", stamp.gate],
					["drain", stamp.drain],
					["source", stamp.source],
				],
			};
		case "ideal-opamp":
			// The output is a driven node and the inputs are read, so all three are signal pins.
			// The supply pins are absent from the stamp entirely, which is why they cannot be
			// checked here and why excluding them costs nothing.
			return {
				label: `ideal-opamp#${stamp.sourceIndex}`,
				terminals: [
					["noninverting input", stamp.plus],
					["inverting input", stamp.minus],
					["output", stamp.output],
				],
			};
		// **Kinds added 2026-09-12.** The switch previously covered bjt, fet, ideal-opamp and vccs
		// only, so a diode, triode, pentode, tube-diode, optocoupler or OTA with a terminal on a
		// node nothing else touches was reported by NOTHING. Measured over the corpus, that is 61
		// devices across 29 packets -- 40 diodes, 11 triodes, 6 OTAs, 4 optocouplers -- including
		// `boss-bf-2`'s five 1S2473 signal diodes sitting on private node pairs, and
		// `mxr-dyna-comp`'s CA3080, the compressor's core device, with two unwired terminals.
		//
		// A diode is two-terminal and passive-looking, which is presumably why it was left out. It
		// is still the difference between a clipping stage and an open circuit.
		case "diode":
			return {
				label: `diode#${stamp.anode}/${stamp.cathode}`,
				terminals: [
					["anode", stamp.anode],
					["cathode", stamp.cathode],
				],
			};
		case "tube-diode":
			return {
				label: `tube-diode#${stamp.plate}/${stamp.cathode}`,
				terminals: [
					["plate", stamp.plate],
					["cathode", stamp.cathode],
				],
			};
		case "triode":
			return {
				label: `triode#${stamp.grid}/${stamp.plate}/${stamp.cathode}`,
				terminals: [
					["grid", stamp.grid],
					["plate", stamp.plate],
					["cathode", stamp.cathode],
				],
			};
		case "pentode":
			// The suppressor is commonly tied to the cathode inside the envelope and is not a
			// separate stamp terminal, so the four checked here are the four the stamp carries.
			return {
				label: `pentode#${stamp.grid}/${stamp.plate}/${stamp.cathode}`,
				terminals: [
					["grid", stamp.grid],
					["plate", stamp.plate],
					["cathode", stamp.cathode],
					["screen", stamp.screen],
				],
			};
		case "optocoupler":
			// Both halves, because they fail differently and independently: an unwired LED side is
			// a control that never modulates, an unwired cell side is an audio path that never
			// varies. `fender-super-reverb`'s tremolo is exactly this shape.
			return {
				label: `optocoupler#${stamp.ledAnode}/${stamp.ldrA}`,
				terminals: [
					["LED anode", stamp.ledAnode],
					["LED cathode", stamp.ledCathode],
					["cell A", stamp.ldrA],
					["cell B", stamp.ldrB],
				],
			};
		case "ota":
			// `bias` and `vee` are supply pins but, unlike an op-amp's, they are present in the
			// stamp and a dangling bias current input silences the device outright.
			return {
				label: `ota#${stamp.plus}/${stamp.minus}/${stamp.output}`,
				terminals: [
					["noninverting input", stamp.plus],
					["inverting input", stamp.minus],
					["output", stamp.output],
					["bias", stamp.bias],
				],
			};
		case "vccs":
			return {
				label: `vccs#${stamp.outP}/${stamp.outN}/${stamp.inP}/${stamp.inN}`,
				terminals: [
					["positive output", stamp.outP],
					["negative output", stamp.outN],
					["positive input", stamp.inP],
					["negative input", stamp.inN],
				],
			};
		default:
			return null;
	}
}

// --- implicit op-amp DC-bias synthesis --------------------------------------------------------
//
// Two op-amp topologies have no DC-conducting path to define their operating point at all:
//
//   (a) no path from the output back to the inverting input except through a capacitor, so the
//       feedback is AC-only and any standing differential integrates without bound
//       (`opamp-operating-point-unbounded`, `unbounded-operating-point.ts`'s netlist-level
//       warning, measured on `ibanez-pql` and `boss-mt-2`);
//   (b) no path from the non-inverting input to any reference at all -- not a rail, not ground,
//       not another stage's driven output -- so the input floats and the solver is free to put
//       it anywhere (the floating-input case, first measured by hand on `tape-echo` and
//       `mxr-noise-gate-line-driver`).
//
// Both were previously diagnostics only. `boss-cs-3` and `boss-oc-2` are two more instances --
// found by the same measurement, not special-cased -- where the ideal-op-amp law's implicit
// assumption of zero input bias current and infinite open-loop gain leaves the DC point
// genuinely undefined, and the runtime's universal `gmin` (`1e-12 S`, see this file's header) is
// far too weak to pin it inside an ordinary render: against a typical corpus feedback or coupling
// capacitor, `gmin` alone needs an RC time constant of thousands of seconds.
//
// **The fix is topological, not numerical.** A real op-amp stage in either shape needs *some*
// finite DC path -- a bleeder resistor across an integrator's feedback cap, or a bias resistor to
// ground on a coupled input -- and a source that omits one is missing an implicit fact about how
// the real device settles, not a fact this compiler can read off the netlist. So this synthesizes
// the same kind of implicit reference `gmin` already is, sized to matter: strong enough to settle
// within a render, weak enough to load no real audio path measurably.
//
// **Read from the lowered stamps, for the same reason the rest of this file is.** A pot's two
// halves, a BBD's clock-gated conductance, a switch's selected throw -- all of that is already
// resolved into plain stamps here, so this needs no per-device-kind wiring knowledge beyond what
// `stampNodes` already extracts.
//
// **This does not retract `opamp-operating-point-unbounded`.** That warning is computed from the
// *declared* netlist, before this stage runs, and it remains true of the source: nothing the
// designer drew pins this operating point, however solvable the compiler has since made it. The
// two are the same relationship `gmin` already has with `active-device-terminal-unwired` -- a
// dangling collector is still genuinely dangling once `gmin` lets the solve converge.

/** 10 M-ohm. See the section header for why this value and not `gmin`. */
const IMPLICIT_BIAS_SIEMENS = 1e-7;

type MnaBlock = Extract<Block, { kind: "mna" }>;
type Graph = ReadonlyMap<NodeId, readonly NodeId[]>;

/**
 * Every node id this block's `dc-source`/`ac-source` stamps declare as a fixed rail, plus
 * ground. Shared by both conduction graphs below: a rail is either the thing a route must not be
 * allowed to pass through unbroken (case a) or a legitimate destination (case b), and both need
 * the same set to say so.
 */
function railsOf(block: MnaBlock): ReadonlySet<NodeId> {
	const rails = new Set<NodeId>([GROUND]);
	for (const stamp of block.stamps) {
		if (stamp.kind !== "dc-source" && stamp.kind !== "ac-source") {
			continue;
		}
		if (stamp.positive !== GROUND) {
			rails.add(stamp.positive);
		}
		if (stamp.negative !== GROUND) {
			rails.add(stamp.negative);
		}
	}
	return rails;
}

/**
 * One block's DC (or, with `capacitorsConduct`, AC) conduction graph at stamp granularity.
 *
 * **No op-amp is a conductor** -- excluded the same way `unbounded-operating-point.ts` excludes
 * one, and for the same reason: an op-amp's inputs draw no current, so linking its own terminals
 * would invent a path through the device and let an op-amp bootstrap its own reference. **No
 * transformer winding is either**, though `stampNodes` would otherwise link all four of its
 * terminals: a transformer's primary and secondary are galvanically isolated at DC, and the
 * generic all-pairs treatment below has no notion of which pairs are actually the same winding,
 * so the conservative answer is to treat it as no path at all rather than invent one across the
 * isolation barrier.
 *
 * **`rails` says whether a rail is a hole or a normal node.** Passing the block's real rails
 * (from `railsOf`) makes every edge touching one vanish -- "rails are not routes", the exclusion
 * `findUnboundedOpamps` needs so that a path reaching the input through a fixed potential does
 * not count as feedback. Passing an empty set makes rails ordinary graph nodes, reachable like
 * anything else -- what the floating-input case needs, since reaching ground is exactly the
 * question it asks.
 */
function stampConductionGraph(
	block: MnaBlock,
	options: { readonly capacitorsConduct: boolean; readonly rails: ReadonlySet<NodeId> },
): Graph {
	const adjacency = new Map<NodeId, NodeId[]>();
	const link = (a: NodeId, b: NodeId): void => {
		if (a === b || options.rails.has(a) || options.rails.has(b)) {
			return;
		}
		for (const [from, to] of [
			[a, b],
			[b, a],
		] as const) {
			const edges = adjacency.get(from);
			if (edges === undefined) {
				adjacency.set(from, [to]);
			} else {
				edges.push(to);
			}
		}
	};
	for (const stamp of block.stamps) {
		if (stamp.kind === "ideal-opamp" || stamp.kind === "transformer") {
			continue;
		}
		if (stamp.kind === "capacitor" && !options.capacitorsConduct) {
			continue;
		}
		const nodes = [...new Set(stampNodes(stamp))];
		for (let i = 0; i < nodes.length; i += 1) {
			for (let j = i + 1; j < nodes.length; j += 1) {
				link(nodes[i] as NodeId, nodes[j] as NodeId);
			}
		}
	}
	return adjacency;
}

/** Every node reachable from `from`, breadth-first. */
function reachableSet(graph: Graph, from: NodeId): ReadonlySet<NodeId> {
	const seen = new Set<NodeId>([from]);
	const queue: NodeId[] = [from];
	let head = 0;
	while (head < queue.length) {
		const node = queue[head] as NodeId;
		head += 1;
		for (const next of graph.get(node) ?? []) {
			if (!seen.has(next)) {
				seen.add(next);
				queue.push(next);
			}
		}
	}
	return seen;
}

/**
 * Whether `start` reaches any node in `targets`, stopping expansion at ground -- the same rule
 * `report-compiler-coverage.ts`'s `reachesSupplyNode` uses, so a route through ground cannot
 * smuggle two otherwise-unrelated nets together into one answer.
 */
function reachesAny(
	graph: Graph,
	start: NodeId,
	targets: ReadonlySet<NodeId>,
): boolean {
	if (targets.has(start)) {
		return true;
	}
	const seen = new Set<NodeId>([start]);
	const queue: NodeId[] = [start];
	let head = 0;
	while (head < queue.length) {
		const at = queue[head] as NodeId;
		head += 1;
		if (at === GROUND) {
			continue;
		}
		for (const next of graph.get(at) ?? []) {
			if (targets.has(next)) {
				return true;
			}
			if (!seen.has(next)) {
				seen.add(next);
				queue.push(next);
			}
		}
	}
	return false;
}

/**
 * Adds an implicit high-value DC-bias conductance for every op-amp in `program` whose operating
 * point is genuinely undefined by the topology -- see this section's header for the two shapes
 * and why. Runs once, after linking, on the program the runtime will actually execute; every
 * later Program-consuming warning (including this file's own `findDanglingActiveTerminals`) sees
 * the bridged circuit, because that is the circuit that now exists.
 *
 * **Fires on any op-amp matching either condition, corpus-wide.** There is no packet slug, part
 * number, or component name anywhere in this function -- the two conditions are read entirely off
 * stamp connectivity, the same evidence discipline `findDanglingActiveTerminals` already keeps.
 */
export function synthesizeOpampImplicitBias(program: Program): Program {
	return {
		...program,
		blocks: program.blocks.map((block) =>
			block.kind === "mna" ? synthesizeForBlock(block) : block,
		),
	};
}

function synthesizeForBlock(block: MnaBlock): MnaBlock {
	const opamps = block.stamps.filter(
		(stamp): stamp is Extract<typeof stamp, { kind: "ideal-opamp" }> =>
			stamp.kind === "ideal-opamp",
	);
	if (opamps.length === 0) {
		return block;
	}

	const rails = railsOf(block);
	const opampOutputs = new Set<NodeId>(opamps.map((stamp) => stamp.output));
	// Case (b)'s references: a rail, ground, or another stage's driven output -- the same set
	// `findFloatingOpampInputs` builds. A plus input that only reaches its own op-amp's output
	// would be a self-satisfying test, but that can only happen through a resistor, which is real
	// feedback and does define the point, so no exclusion for it is needed here.
	const floatingReferences = new Set<NodeId>([...rails, ...opampOutputs]);
	const dcNormal = stampConductionGraph(block, {
		capacitorsConduct: false,
		rails: new Set(),
	});

	// Case (a)'s graphs: rails are holes, and the audio-path test needs both a DC and an AC
	// version of the same rail-excluded graph.
	const dcHoles = stampConductionGraph(block, { capacitorsConduct: false, rails });
	const acHoles = stampConductionGraph(block, { capacitorsConduct: true, rails });
	const fromInput =
		block.inputNode === null
			? new Set<NodeId>()
			: reachableSet(acHoles, block.inputNode);
	const toOutput =
		block.outputNode === null
			? new Set<NodeId>()
			: reachableSet(acHoles, block.outputNode);

	let next: MnaBlock = block;
	for (const stamp of opamps) {
		const { plus, minus, output } = stamp;

		if (!reachesAny(dcNormal, plus, floatingReferences)) {
			next = withStamp(next, {
				kind: "conductance",
				a: plus,
				b: GROUND,
				siemens: IMPLICIT_BIAS_SIEMENS,
			});
		}

		// A port on a rail is a different defect (`over-driven-node.ts`'s business), not this
		// one's, the same exclusion `findUnboundedOpamps` makes.
		if (rails.has(output) || rails.has(minus)) {
			continue;
		}
		if (reachableSet(dcHoles, output).has(minus)) {
			continue;
		}
		// Off the signal path does not count: an LFO integrator is supposed to run away and be
		// reset by its comparator, and a comparator is open-loop by design. Both have no DC
		// feedback and neither is a defect -- 38 of 51 corpus op-amps with no DC feedback are off
		// the signal path this same exclusion removes in `unbounded-operating-point.ts`.
		const carriesAudio =
			(fromInput.has(plus) || fromInput.has(minus)) && toOutput.has(output);
		if (!carriesAudio) {
			continue;
		}
		next = withStamp(next, {
			kind: "conductance",
			a: output,
			b: minus,
			siemens: IMPLICIT_BIAS_SIEMENS,
		});
	}
	return next;
}
