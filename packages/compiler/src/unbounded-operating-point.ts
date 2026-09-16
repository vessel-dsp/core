// Op-amps whose operating point nothing in the circuit pins down.
//
// A warning, never a refusal: the program is fine to build and the pedal may well render,
// and this says only that its DC solution rests on something the topology does not
// guarantee. `ibanez-pql` is what motivated it -- it diverges to `8.55e+12 V` from a 9 V
// supply, located by hand before this existed -- and this stage names that structurally
// rather than asking the solver to survive it. See
// `docs/troubleshootings/opamp-linearisation-extrapolates-past-the-rail.md`.
//
// Evidence is connectivity and device kinds. No component name, no `Description`, no role
// prose beyond the terminal roles stage 5 already reads to tell an inverting input from a
// non-inverting one.

import { potTerminals } from "./lower";
import type { Device, Netlist, NodeId, UnboundedOpampWarning } from "./types";
import {
} from "./terminal-roles";

/**
 * An op-amp with **no DC-conducting path from its output back to its inverting input** has
 * no feedback at DC. Its inverting node is then set by the input network alone, and unless
 * that network happens to hold it at exactly the non-inverting potential there is a standing
 * differential which the op-amp integrates through its capacitive feedback without bound.
 * A real one winds up too and then sits at a rail; the runtime's linearisation does not,
 * which is the defect that entry records.
 *
 * Three exclusions carry the whole result, and each removes a class this would otherwise be
 * wrong about:
 *
 * 1. **Rails are not routes.** Ground and every node a voltage source touches are excluded,
 *    the same exclusion `switchesClosedForPortPath` makes: a path reaching the input through
 *    a fixed potential does not let the output influence it, so it is not feedback.
 * 2. **No op-amp is a conductor.** Its inputs draw no current -- the whole reason `gmin`
 *    exists -- so linking its terminals invents a path through the device. Leaving this out
 *    made the first version find a route from `ibanez-pql`'s `U3A` output back to its own
 *    inverting input *through two other op-amps*, and miss the one packet it was built for.
 * 3. **Off the signal path does not count.** An LFO integrator is *supposed* to run away and
 *    be reset by its comparator, and a comparator is open-loop by design. Both have no DC
 *    feedback and neither is a defect. Asking whether audio actually passes through the
 *    op-amp separates them by connectivity rather than by intent, and it does the heavy
 *    lifting: **38 of 51 corpus op-amps with no DC feedback are off the signal path**,
 *    including `electro-harmonix-q-tron`'s overload comparator and eight in
 *    `moogerfooger-mf-102`.
 *
 * What survives is 13 op-amps across 7 packets. **The claim is deliberately weaker than
 * "this will diverge":** only two of those seven compile today, and while `ibanez-pql` is the
 * corpus's only diverging packet, `boss-mt-2` is flagged and solves perfectly well. So the
 * warning reports the structural fact -- nothing pins this operating point -- and does not
 * predict the outcome.
 */
export function findUnboundedOpamps(
	netlist: Netlist,
): readonly UnboundedOpampWarning[] {
	const opamps = netlist.devices.filter(
		(device) => device.kind === "opamp" && device.nodes.length >= 3,
	);
	if (opamps.length === 0) {
		return [];
	}

	const rails = new Set<NodeId>([0]);
	for (const device of netlist.devices) {
		if (device.kind === "voltage-source" || device.kind === "rail") {
			for (const node of device.nodes) {
				rails.add(node);
			}
		}
	}

	const dc = conductionGraph(netlist, rails, { capacitorsConduct: false });
	const signal = conductionGraph(netlist, rails, { capacitorsConduct: true });
	const fromInput = reachable(signal, netlist.ports.input);
	const toOutput = reachable(signal, netlist.ports.output);

	const warnings: UnboundedOpampWarning[] = [];
	for (const device of opamps) {
		const [plus, minus, output] = potTerminalsSafeOpampNodes(device);
		// A port on a rail is a different defect and not this one's to diagnose.
		if (rails.has(output) || rails.has(minus)) {
			continue;
		}
		if (reachable(dc, output, minus).has(minus)) {
			continue;
		}
		const carriesAudio =
			(fromInput.has(plus) || fromInput.has(minus)) && toOutput.has(output);
		if (!carriesAudio) {
			continue;
		}
		warnings.push({
			code: "opamp-operating-point-unbounded",
			device: device.id,
			detail:
				`op-amp ${device.id} has no DC-conducting path from its output (node ${output}) ` +
				`back to its inverting input (node ${minus}), so nothing pins its operating ` +
				"point: the inverting node is set by the input network alone, and any standing " +
				"differential integrates through the capacitive feedback",
		});
	}
	return warnings;
}

/**
 * The op-amp's `(plus, minus, output)` from its declared roles, falling back to order.
 *
 * **The fallback stays here, unlike in `lower.ts`.** This is a *warning* stage: it looks for an
 * op-amp whose operating point is unbounded, and a wrong guess costs a missing or spurious
 * warning rather than a wrong circuit. Refusing a whole document from a diagnostic would be the
 * tail wagging the dog, so a package or an unroled device falls back and the worst case is that
 * this check says nothing about it.
 */
function potTerminalsSafeOpampNodes(
	device: Device,
): readonly [NodeId, NodeId, NodeId] {
	const declared = device.identity.declaredTerminalRoles;
	const only = (role: string): number | null => {
		const found = declared.flatMap((value, index) =>
			value === role ? [index] : [],
		);
		return found.length === 1 ? (found[0] ?? null) : null;
	};
	const plus = only("nonInverting");
	const minus = only("inverting");
	const out = only("output");
	if (plus !== null && minus !== null && out !== null) {
		return [
			device.nodes[plus] as NodeId,
			device.nodes[minus] as NodeId,
			device.nodes[out] as NodeId,
		];
	}
	return [
		device.nodes[0] as NodeId,
		device.nodes[1] as NodeId,
		device.nodes[2] as NodeId,
	];
}


type Graph = ReadonlyMap<NodeId, readonly NodeId[]>;

function conductionGraph(
	netlist: Netlist,
	rails: ReadonlySet<NodeId>,
	options: { readonly capacitorsConduct: boolean },
): Graph {
	const adjacency = new Map<NodeId, NodeId[]>();
	const link = (a: NodeId, b: NodeId): void => {
		if (a === b || rails.has(a) || rails.has(b)) {
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
	for (const device of netlist.devices) {
		if (device.kind === "opamp") {
			continue;
		}
		if (device.kind === "capacitor" && !options.capacitorsConduct) {
			continue;
		}
		// A pot conducts along its track, half by half, and not from one end to the other
		// through a wiper that may be tied elsewhere. `link` is undirected, so which end
		// `potTerminals` calls `end1` versus `end2` cannot change this graph -- two empty maps
		// keep that fact visible rather than computing an orientation nothing here reads.
		if (device.kind === "potentiometer" && device.nodes.length === 3) {
			const [end1, wiper, end2] = potTerminals(device, new Map(), new Map());
			link(end1, wiper);
			link(wiper, end2);
			continue;
		}
		for (let i = 0; i < device.nodes.length; i += 1) {
			for (let j = i + 1; j < device.nodes.length; j += 1) {
				link(device.nodes[i] as NodeId, device.nodes[j] as NodeId);
			}
		}
	}
	return adjacency;
}

function reachable(graph: Graph, from: NodeId, stopAt?: NodeId): Set<NodeId> {
	const seen = new Set<NodeId>([from]);
	const queue: NodeId[] = [from];
	while (queue.length > 0) {
		const node = queue.shift() as NodeId;
		if (stopAt !== undefined && node === stopAt) {
			return seen;
		}
		for (const next of graph.get(node) ?? []) {
			if (!seen.has(next)) {
				seen.add(next);
				queue.push(next);
			}
		}
	}
	return seen;
}
