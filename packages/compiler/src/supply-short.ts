// Diodes wired forward across a supply, which no built circuit contains.
//
// A warning rather than a refusal, matching the other two: the program builds, the pedal
// renders, and this says the rendered circuit contains a short that the source almost certainly
// did not intend. `ibanez-ts808` and `ibanez-ts9` each carry **1.074 A** through a
// reverse-polarity protection diode on a 9 V supply, and reported nothing until now.
//
// Evidence is connectivity plus terminal roles, both of which this pipeline already reads to
// tell an anode from a cathode. No component name, no `Description`, no part number.

import type { Device, Netlist, NodeId, SupplyShortWarning } from "./types";

/** Role tokens naming a diode's ends, as `terminalRoleToken` leaves them. */
const anodeRoles = new Set(["anode", "a", "p", "plus", "positive"]);
const cathodeRoles = new Set(["cathode", "k", "c", "minus", "negative"]);

/**
 * A diode whose **anode sits on a supply node and whose cathode sits on ground** is forward
 * biased by the whole supply. In a real circuit that is a dead short: the junction conducts
 * until something fails.
 *
 * The runtime does not diverge on it, which is why this went unseen. `DIODE_VOLTAGE_LIMIT` caps
 * the junction voltage at `0.9 V` before the current is computed, so instead of running away the
 * diode settles at about **1 A** — and the supply is an ideal source, so it simply sinks that
 * current and the pedal renders a plausible level. `ibanez-ts808` renders a gain of `0.506` with
 * a 1 A short on its rail. The clamp is a convergence device that turned out to be hiding a
 * circuit defect, which is the same shape as several other masks found the same day.
 *
 * **Directness is required, and it is what makes this precise.** The check asks that the anode
 * be *on* a node a `voltage-source` or `rail` device terminates, and the cathode be ground
 * itself. An indicator LED fed through a series resistor does not match, because its anode sits
 * on the resistor's node rather than the supply's — so the common legitimate arrangement is
 * excluded by construction rather than by a special case.
 *
 * Measured over the pedal corpus: **6 diodes across 6 packets** match structurally, of which the
 * two that compile carry `1.074 A` each. The other four are in the unsupported population, so
 * they are flagged the moment their packets compile.
 *
 * The warning states the structure and the polarity, and does **not** claim the source is wrong.
 * A protection diode reversed in the source and a protection diode this pipeline has mis-read
 * look identical from here; what makes it reportable is that either way the compiled circuit
 * contains a short. Checked on `ibanez-ts808`: the source itself declares `anode` on the 9 V
 * node and `cathode` on ground, so the role reading is not at fault there — but that is a
 * per-packet finding rather than something this stage should assert.
 */
export function findSupplyShorts(
	netlist: Netlist,
): readonly SupplyShortWarning[] {
	const positiveSupplyNodes = new Set<NodeId>();
	const negativeSupplyNodes = new Set<NodeId>();
	for (const device of netlist.devices) {
		if (device.kind !== "voltage-source" && device.kind !== "rail") {
			continue;
		}
		const volts = device.parameters.volts;
		for (const node of device.nodes) {
			if (node !== 0) {
				if (volts !== undefined && volts < 0) {
					negativeSupplyNodes.add(node);
				} else {
					positiveSupplyNodes.add(node);
				}
			}
		}
	}
	if (positiveSupplyNodes.size === 0 && negativeSupplyNodes.size === 0) {
		return [];
	}

	const warnings: SupplyShortWarning[] = [];
	for (const device of netlist.devices) {
		if (device.kind !== "diode" || device.nodes.length !== 2) {
			continue;
		}
		const ends = diodeEnds(device);
		if (ends === null) {
			continue;
		}
		const [anode, cathode] = ends;
		if (positiveSupplyNodes.has(anode) && cathode === 0) {
			warnings.push({
				code: "diode-forward-across-supply",
				device: device.id,
				detail:
					`diode ${device.id} has its anode on positive supply node ${anode} and its cathode on ground, ` +
					"so the whole supply forward biases it: the compiled circuit contains a short across " +
					"the supply, which the runtime renders rather than diverging on only because the " +
					"junction voltage is clamped",
			});
		} else if (negativeSupplyNodes.has(cathode) && anode === 0) {
			warnings.push({
				code: "diode-forward-across-supply",
				device: device.id,
				detail:
					`diode ${device.id} has its anode on ground and its cathode on negative supply node ${cathode}, ` +
					"so the whole supply forward biases it: the compiled circuit contains a short across " +
					"the supply, which the runtime renders rather than diverging on only because the " +
					"junction voltage is clamped",
			});
		}
	}
	return warnings;
}

/**
 * A diode's `(anode, cathode)` nodes, or `null` when its roles do not name exactly one of each.
 *
 * No positional fallback. A diode whose ends are unlabelled cannot be said to point anywhere, and
 * guessing would let this warning accuse a circuit of a short on the strength of terminal order.
 */
function diodeEnds(device: Device): readonly [NodeId, NodeId] | null {
	const roles = device.identity.terminalRoles;
	const only = (accepted: ReadonlySet<string>): number | null => {
		const found = roles.flatMap((role, index) =>
			role !== null && accepted.has(role) ? [index] : [],
		);
		return found.length === 1 ? (found[0] ?? null) : null;
	};
	const anode = only(anodeRoles);
	const cathode = only(cathodeRoles);
	if (anode === null || cathode === null) {
		return null;
	}
	const a = device.nodes[anode];
	const c = device.nodes[cathode];
	return a === undefined || c === undefined ? null : [a, c];
}
