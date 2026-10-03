// Derive program bypass configuration from netlist topology and declared audio.bypass.
//
// **Typed Source Evidence Rule**:
// Classification, admission, and derivation decisions MUST NOT read authored prose
// (Description, Role phrases, component names) by substring or regex, and must never
// match text joined across fields.
//
// Evidence is exact part/device kinds, switch connectivity, port nodes, and the
// presence of bistable latches / electronic switching gates.
//
// Contract:
// - `{ declared: "none" }` when no bypass switch is declared in `audio.bypass`.
//   `kind` is strictly absent.
// - `{ declared: "switch", kind, control? }` when a declared switch is modeled:
//   - `buffered`: bistable flip-flop latches exist in circuit, or active electronic
//     switching gates (JFET audio switches / analog switch ICs) are present.
//   - `hardwire`: switch contacts audio output / routes audio without isolating the
//     input jack from the passive effect core (input port remains permanently tied to
//     effect input devices).
//   - `buffered-mechanical`: no electronic switching, but at least one audio port reaches
//     the switch poles only through an active stage (a buffer the switch cannot remove), so
//     the bypass path is buffered. Distinguished from `hardwire` by the active hop: a
//     hardwire pedal's poles reach the input jack through series passives alone.
//   - `true-bypass`: switch isolates both input and output paths (bridges input jack
//     directly to output jack in bypass; input jack connects to effect core only through
//     switch contacts).
//   - `not-in-audio-path`: declared switch has no presence in the audio path (e.g.
//     auxiliary status LED contact to ground, or dropped view-only shell) and has no
//     electronic switching gates.

import { findBistableLatches } from "./latch-seed";
import { stripPoleSuffix } from "./netlist";
import type { ControlId, Netlist, NodeId, ProgramBypass } from "./types";

/** Walk series two-terminal passive components (resistors, inductors) from fromNode to targetNode. */
/**
 * A two-terminal element audio passes through in series. A capacitor belongs here: the walk asks
 * "is this switch in the audio path", and a coupling capacitor between a pole and a jack is the
 * commonest thing on that path. Before 2026-09-22 the walk stopped at capacitors, so a pole behind
 * an output cap read as touching no port.
 */
function isSeriesPassive(d: Netlist["devices"][number]): boolean {
	return (
		(d.kind === "resistor" || d.kind === "inductor" || d.kind === "capacitor") &&
		d.nodes.length === 2
	);
}

/** The device kinds that carry audio from one terminal to another actively: a stage. */
const STAGE_KINDS: ReadonlySet<string> = new Set([
	"bjt",
	"jfet",
	"mosfet",
	"opamp",
	"ota",
	"triode",
	"pentode",
	"ic",
]);

/**
 * Like `reachesPassively`, but an active device is a hop too: any two of its non-rail terminals
 * are connected for the purpose of "is there a signal route here". Used only to tell a switch
 * behind a buffer (`buffered-mechanical`) from a switch outside the audio path
 * (`not-in-audio-path`): the passive walk has already said neither port is reached directly.
 */
function reachesThroughStages(
	fromNode: NodeId,
	targetNode: NodeId,
	netlist: Netlist,
	rails: ReadonlySet<NodeId>,
): boolean {
	const visited = new Set<NodeId>([fromNode, ...rails]);
	const queue: NodeId[] = [fromNode];
	while (queue.length > 0) {
		const curr = queue.shift()!;
		if (curr === targetNode) return true;
		for (const d of netlist.devices) {
			if (!d.nodes.includes(curr)) continue;
			if (!isSeriesPassive(d) && !STAGE_KINDS.has(d.kind)) continue;
			for (const other of d.nodes) {
				if (!visited.has(other)) {
					visited.add(other);
					queue.push(other);
				}
			}
		}
	}
	return false;
}

function reachesPassively(
	fromNode: NodeId,
	targetNode: NodeId,
	netlist: Netlist,
	rails: ReadonlySet<NodeId>,
): boolean {
	if (fromNode === targetNode) return true;
	if (rails.has(fromNode)) return false;
	const visited = new Set<NodeId>([fromNode, ...rails]);
	const queue: NodeId[] = [fromNode];
	while (queue.length > 0) {
		const curr = queue.shift()!;
		if (curr === targetNode) return true;
		for (const d of netlist.devices) {
			if (isSeriesPassive(d) && d.nodes.includes(curr)) {
				const other = (d.nodes[0] === curr ? d.nodes[1] : d.nodes[0]) as NodeId;
				if (!visited.has(other)) {
					visited.add(other);
					queue.push(other);
				}
			}
		}
	}
	return false;
}

/** Check whether circuit has positive evidence of active electronic switching gates. */
function hasElectronicSwitching(netlist: Netlist, rails: ReadonlySet<NodeId>): boolean {
	if (findBistableLatches(netlist).length > 0) return true;
	if (netlist.devices.some((d) => d.kind === "analog-switch")) return true;

	// In electronic switching circuits (Boss, Ibanez, DOD), JFETs are used as audio gates.
	// An audio JFET switch has its channel (drain and source) on non-rail, non-ground nodes,
	// and the circuit has BJT drivers (>= 2 BJTs for flip-flop / muting control).
	const jfets = netlist.devices.filter((d) => d.kind === "jfet");
	const audioJfets = jfets.filter(
		(j) => !rails.has(j.nodes[0] as NodeId) && !rails.has(j.nodes[2] as NodeId),
	);
	const bjts = netlist.devices.filter((d) => d.kind === "bjt");
	if (audioJfets.length > 0 && bjts.length >= 2) {
		return true;
	}
	return false;
}

/** Check whether the input port is physically isolated by the switch from effect core loading. */
function isInputIsolatedBySwitch(
	inPort: NodeId,
	matchingSwitchNodes: ReadonlySet<NodeId>,
	netlist: Netlist,
): boolean {
	const devicesOnInPort = netlist.devices.filter((d) => d.nodes.includes(inPort));
	const nonJackSwOnInPort = devicesOnInPort.filter(
		(d) => d.kind !== "jack" && d.kind !== "switch",
	);

	if (nonJackSwOnInPort.length === 0) {
		// Only jacks and switches touch inPort: fully isolated!
		return true;
	}

	// Check if devices on inPort are purely series elements (resistor/inductor) leading to switch poles
	for (const d of nonJackSwOnInPort) {
		if ((d.kind !== "resistor" && d.kind !== "inductor") || d.nodes.length !== 2) {
			return false;
		}
		const otherNode = (d.nodes[0] === inPort ? d.nodes[1] : d.nodes[0]) as NodeId;
		if (!matchingSwitchNodes.has(otherNode)) {
			return false;
		}
		const onOther = netlist.devices.filter((dev) => dev.nodes.includes(otherNode));
		const nonSwitchOnOther = onOther.filter((dev) => dev.kind !== "switch" && dev !== d);
		if (nonSwitchOnOther.length > 0) {
			return false;
		}
	}

	return true;
}

export function deriveBypass(netlist: Netlist): ProgramBypass {
	if (netlist.bypass.declared === "none") {
		return { declared: "none" };
	}

	const rails = new Set<NodeId>([0]);
	for (const d of netlist.devices) {
		if (d.kind === "rail" || d.kind === "voltage-source") {
			for (const n of d.nodes) rails.add(n);
		}
	}

	const swName = netlist.bypass.switch;
	const baseName = stripPoleSuffix(swName);
	const allSwitches = netlist.devices.filter((d) => d.kind === "switch");
	const matchingSwitches = allSwitches.filter(
		(s) =>
			s.id === swName ||
			stripPoleSuffix(s.id) === baseName ||
			s.id.startsWith(`${swName}_`) ||
			s.id.startsWith(`${baseName}_`),
	);

	// A declared switch that was dropped (e.g. view-only shell with no terminals)
	// stays declared: "switch", but is explicitly marked as not in the audio path.
	if (matchingSwitches.length === 0) {
		return { declared: "switch", kind: "not-in-audio-path" };
	}

	let controlId: ControlId | undefined = undefined;
	for (const s of matchingSwitches) {
		if (s.control !== null) {
			controlId = s.control;
			break;
		}
	}

	// Positive evidence of active electronic buffering: bistable flip-flop latches
	// or JFET / analog-switch bypass gates.
	if (hasElectronicSwitching(netlist, rails)) {
		const latches = findBistableLatches(netlist);
		return {
			declared: "switch",
			kind: "buffered",
			control: controlId ?? (latches[0]?.controlId ?? undefined),
		};
	}

	const inPort = netlist.ports.input;
	const outPort = netlist.ports.output;

	// Collect non-rail, non-ground nodes touched by the matching switch poles
	const switchNodes = new Set<NodeId>();
	for (const s of matchingSwitches) {
		for (const node of s.nodes) {
			if (!rails.has(node)) {
				switchNodes.add(node);
			}
		}
	}

	// Walk series passive elements (resistors, inductors, capacitors) between switch poles and I/O ports
	let touchesIn = false;
	let touchesOut = false;
	for (const n of switchNodes) {
		if (reachesPassively(n, inPort, netlist, rails)) touchesIn = true;
		if (reachesPassively(n, outPort, netlist, rails)) touchesOut = true;
	}

	// A pole that no port reaches through series passives may still sit in the audio path
	// behind a buffer: a mechanical switch between always-on stages (Klon, Moog). If both ports
	// reach the poles once active hops are allowed, the bypass path is buffered without any
	// electronic switching. If neither does even then, the contact is auxiliary (an LED) or
	// outside the audio path.
	if (!touchesIn || !touchesOut) {
		const stagesIn =
			touchesIn || [...switchNodes].some((n) => reachesThroughStages(n, inPort, netlist, rails));
		const stagesOut =
			touchesOut || [...switchNodes].some((n) => reachesThroughStages(n, outPort, netlist, rails));
		if (stagesIn && stagesOut) {
			return { declared: "switch", kind: "buffered-mechanical", control: controlId };
		}
		if (!touchesIn && !touchesOut) {
			return { declared: "switch", kind: "not-in-audio-path", control: controlId };
		}
	}

	// For mechanical audio routing: does the switch isolate the input from the effect core?
	if (isInputIsolatedBySwitch(inPort, switchNodes, netlist)) {
		return { declared: "switch", kind: "true-bypass", control: controlId };
	}

	return { declared: "switch", kind: "hardwire", control: controlId };
}
