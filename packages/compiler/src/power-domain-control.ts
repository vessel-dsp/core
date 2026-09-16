import type { CompileWarning, Device, Netlist, NodeId } from "./types";

/**
 * The kinds that separate the mains and HT domains from the audio graph.
 *
 * A supply, a rail and a battery are the domain's origin. A **transformer** is here because its
 * windings couple magnetically rather than electrically: a mains primary and a heater secondary
 * share no node, and treating the device as a conductor would make every rail reachable from the
 * wall socket.
 */
const DOMAIN_BOUNDARY_KINDS: ReadonlySet<string> = new Set([
	"voltage-source",
	"current-source",
	"battery",
	"rail",
	"transformer",
	"ground",
]);

/**
 * The devices reachable from the audio ports without crossing a domain boundary.
 *
 * Ground is excluded as a hop for the reason a shared-node test always must: nearly every device
 * touches it, so counting it makes the whole circuit one neighbourhood.
 */
function devicesReachableFromPorts(
	netlist: Netlist,
	ports: readonly NodeId[],
): ReadonlySet<string> {
	const byNode = new Map<NodeId, Device[]>();
	for (const device of netlist.devices) {
		if (DOMAIN_BOUNDARY_KINDS.has(device.kind)) {
			continue;
		}
		for (const node of device.nodes) {
			if (node === 0) {
				continue;
			}
			const bucket = byNode.get(node) ?? [];
			bucket.push(device);
			byNode.set(node, bucket);
		}
	}
	const seenNodes = new Set<NodeId>(ports);
	const seenDevices = new Set<string>();
	const queue = [...ports];
	while (queue.length > 0) {
		const node = queue.pop() as NodeId;
		for (const device of byNode.get(node) ?? []) {
			if (seenDevices.has(device.id)) {
				continue;
			}
			seenDevices.add(device.id);
			for (const next of device.nodes) {
				if (next !== 0 && !seenNodes.has(next)) {
					seenNodes.add(next);
					queue.push(next);
				}
			}
		}
	}
	return seenDevices;
}

/**
 * A device exposed as a sweepable user control that is **power-domain hardware**: it sits outside
 * the audio graph and no panel entry claims it.
 *
 * **Why this is reported rather than decided.** Structure cannot tell a user control from fixed
 * hardware on this side of the boundary. A standby switch and a mains fuse are both switches in
 * the supply, and one belongs on the front panel while the other belongs inside the chassis --
 * only the document can say which. So the compiler names the ambiguity and the fix is a
 * `deviceInterface.controls` entry, or a kind that is not a switch.
 *
 * **A rule was attempted and it does not exist.** The promising one was "a switch declaring a
 * `FuseRating` is a fuse, therefore not a control" -- legal evidence, since it reads the presence
 * of a typed property rather than a name, and 26 corpus switches declare one. It fails on its own
 * data: `mesa-boogie-dual-rectifier`'s `SRC_POWER_SWITCH_FUSE_4A`, `orange-rockerverb`'s
 * `SRC_PRIMARY_POWER_SWITCH_AND_FUSE` and `sunn-beta-lead`'s `SRC_POWER_SWITCH_FUSE` are each a
 * power switch *and* a fuse in one two-terminal component, and a power switch is exactly the user
 * control the rule would have suppressed. Narrowing it to "two terminals and no switch-shaped
 * property" keeps all three, because a fuse and a combined switch-and-fuse are structurally
 * identical: two terminals, one closed contact. The difference is whether a human operates it,
 * which is not a fact about the circuit.
 *
 * **Measured 2026-09-04: 67 of the corpus's 958 program controls**, across the packets that
 * model their own power supply. It read 80 before `boss-bf-2`'s three service trims were
 * declared, and 76 before every signal jack became a seed -- see the note in the function. They are mains switches,
 * voltage selectors, and mains, HT and heater fuses -- `vox-ac30-top-boost` alone contributes
 * `SW_MAINS`, a 230/120 selector and four fuses. A fuse offered to a player as a knob to sweep is
 * the shape of the problem.
 *
 * **The traversal's one known imprecision** is at the B+ boundary: it stops at the transformer but
 * not at the rectifier and filter, so B+ nodes stay reachable through a tube's plate. That keeps
 * `SW1_STANDBY` and `S_STANDBY_SWITCH` out of this warning, which is right -- a standby switch is
 * a front-panel control -- and also keeps `F2_HT_FUSE` out, which is not.
 */
export function findPowerDomainControls(
	netlist: Netlist,
	// A control carries the `role` and `label` its `deviceInterface.controls` entry gave it, so
	// "the panel does not claim this" is exactly both being absent -- no second pass over the
	// document, and no way for the two readings to drift apart.
	controls: readonly {
		readonly id: string;
		readonly role?: string | null;
		readonly label?: string | null;
	}[],
	ports: readonly NodeId[],
): readonly CompileWarning[] {
	// **Every signal jack is a seed, not just the two selected ports.**
	//
	// A `.vdsp` names one input and one output port, and on a two-channel amp that selects one
	// channel: `fender-super-reverb-aa1069`'s port is its *Vibrato* input, so the Normal channel
	// hangs off a jack the traversal never started from. Combined with the transformer cut --
	// which stops the walk re-entering from the speaker-side output port -- the search was
	// effectively one-directional from a single channel's input, and it called three
	// `Normal-Volume` pots and `soldano-slo-100`'s `SRC_PRESENCE_25K` power-domain hardware.
	//
	// Seeding every jack node drops the count from 76 to 67 and rescues all nine. It also rescues
	// `soldano-slo-100`'s `SRC_F1_BPLUS_FUSE`, which is a false negative -- a B+ fuse is not a
	// panel control -- and that trade is deliberate: this warning offers candidates for a human
	// decision, and naming a Presence knob as power hardware costs more than missing one fuse.
	const jackNodes = netlist.devices
		.filter((device) => device.kind === "jack")
		.flatMap((device) => device.nodes)
		.filter((node) => node !== 0);
	const unclaimed = controls.filter(
		(control) =>
			(control.role ?? null) === null && (control.label ?? null) === null,
	);
	if (unclaimed.length === 0) {
		return [];
	}
	const reachable = devicesReachableFromPorts(netlist, [
		...ports,
		...new Set(jackNodes),
	]);
	const warnings: CompileWarning[] = [];
	for (const { id } of unclaimed) {
		if (reachable.has(id)) {
			continue;
		}
		const device = netlist.devices.find((candidate) => candidate.id === id);
		if (device === undefined) {
			continue;
		}
		warnings.push({
			code: "power-domain-control",
			device: id,
			detail:
				`${device.kind} ${id} is offered as a sweepable control, but it sits outside the ` +
				"audio graph -- unreachable from either port without crossing a supply, rail or " +
				"transformer -- and no `deviceInterface.controls` entry claims it as a panel " +
				"control. Power-domain hardware, not a control: declare it on the panel if a " +
				"player operates it, and give it a kind that is not a switch if one does not.",
		});
	}
	return warnings;
}
