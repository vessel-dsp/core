// Controls the document wires so that they provably cannot affect the circuit.
//
// Three reasons, and the third arrived with the execution schedule: a floating pot wiper, a
// device joined to nothing, and a control whose every element sits in a region the program
// does not execute. All three are structural -- connectivity, or the program's own `order`.
//
// This is a *warning* stage, not a refusal. A pedal with a dead knob still renders, and
// refusing it would cost 11 compiling corpus packets to fix a defect the user can hear
// around. What was not acceptable is shipping one silently: `ibanez-ts808` rendered
// bit-identical output at `Drive=0.1` and `Drive=0.9` and nothing in the compile result
// said why.
//
// The evidence is connectivity and nothing else. No component name, no `Description`,
// no role prose -- the same discipline the rest of the pipeline holds to.

import { potTerminals, stampControl } from "./lower";
import type {
	ControlId,
	Device,
	InertControlWarning,
	Netlist,
	NodeId,
	Program,
} from "./types";

/**
 * A pot whose wiper node touches nothing else is electrically a fixed resistor.
 *
 * The two halves of the track are in series with a floating junction between them, so
 * whatever the wiper takes from one half it gives back to the other and their sum is
 * the whole track no matter where the knob sits. The pot still stamps, still solves,
 * and still moves its two conductances -- it just cannot change any node voltage, which
 * is why listening finds it and the matrix does not.
 *
 * A wiper tied back to one of its own ends is a rheostat and genuinely varies, so it
 * has degree 2 and is correctly not reported here.
 */
export function findInertControls(
	netlist: Netlist,
	program: Program,
): readonly InertControlWarning[] {
	const degree = new Map<NodeId, number>();
	for (const device of netlist.devices) {
		for (const node of device.nodes) {
			degree.set(node, (degree.get(node) ?? 0) + 1);
		}
	}

	const byControl = new Map<ControlId, Device[]>();
	for (const device of netlist.devices) {
		if (device.control === null) {
			continue;
		}
		const bound = byControl.get(device.control);
		if (bound === undefined) {
			byControl.set(device.control, [device]);
		} else {
			bound.push(device);
		}
	}

	const unscheduled = controlsOnlyInUnscheduledBlocks(program);

	const scheduledControls = controlsInScheduledBlocks(program);

	const warnings: InertControlWarning[] = [];
	for (const control of netlist.controls) {
		const bound = byControl.get(control.id) ?? [];
		if (bound.length === 0) {
			continue;
		}
		// Every device the control drives must be dead for the claim to hold. One live gang, or a
		// switch sharing the control, and the knob does something -- reporting it then would be a
		// wrong answer about someone's circuit, which is worse than the silence this replaces. The
		// narrower per-device fact is still visible in `devices`.
		//
		// **Two ways to be dead, and the second was missing.** A pot with a floating wiper is the
		// original case. The other is a device with *every* terminal unwired, which the pot rule
		// cannot express: `boss-od-3`'s `EFFECT_FOOTSWITCH` drives a switch whose three nodes are all
		// degree 1, so the footswitch is bound to a real device that is connected to nothing, and the
		// control read as fine. That packet's whole signal path is gated by JFETs whose gates the
		// footswitch network should drive, so this is the control warning the pedal most needed.
		const allPots = bound.every(
			(device) => device.kind === "potentiometer" || device.kind === "rheostat",
		);
		const allDead = bound.every(
			(device) =>
				(device.kind === "potentiometer" && wiperIsFloating(device, degree)) ||
				isFullyDisconnected(device, degree),
		);
		// **Three ways to be dead, and the device-level ones are reported first.** A floating
		// wiper or a device joined to nothing is a fact about the circuit and is what a source
		// reader can act on; sitting in an unexecuted region is a fact about the schedule, and
		// only applies to audio potentiometers/rheostats (power contacts, bypass latches, and
		// indicators naturally reside in DC/power regions outside the scheduled audio blocks).
		if (!allDead && (!allPots || !unscheduled.has(control.id))) {
			continue;
		}
		const disconnected = bound.filter((device) =>
			isFullyDisconnected(device, degree),
		);
		const isDisconnected = disconnected.length === bound.length;
		const reasonKind: "disconnected" | "floating-wiper" | "unscheduled-region" = !allDead
			? "unscheduled-region"
			: isDisconnected
				? "disconnected"
				: "floating-wiper";
		// A structural defect is one that breaks an executed block (a scheduled part of the audio path).
		// Controls for unselected channels or unexecuted regions are warned about but do not refuse compilation.
		const isStructuralDefect =
			allDead && (program.order.length === 0 || scheduledControls.has(control.id));

		warnings.push({
			code: "control-cannot-affect-circuit",
			control: control.id,
			reasonKind,
			isStructuralDefect,
			devices: bound.map((device) => device.id),
			detail: !allDead
				? `control "${control.id}" cannot affect the circuit: ` +
					`${bound.length === 1 ? "the element it varies sits" : "every element it varies sits"} ` +
					"in a region the program does not execute, because nothing in that region " +
					"can reach the output jack"
				: isDisconnected
					? `control "${control.id}" cannot affect the circuit: ` +
						`${bound.length === 1 ? "the device it drives has" : "every device it drives has"} ` +
						"every terminal connected to nothing else, so the device is present in the " +
						"document and joined to no circuit at all"
					: `control "${control.id}" cannot affect the circuit: ` +
						`${bound.length === 1 ? "its potentiometer has" : "every potentiometer it drives has"} ` +
						"a wiper node connected to nothing else, so the two track halves stay in " +
						"series and their sum is fixed at every knob position",
		});
	}
	return warnings;
}

/**
 * Controls whose every stamp sits in a block the program does not execute.
 *
 * The third way a knob can be provably dead, and the one only the emitted program can see:
 * the device is wired, its stamps are real, and the region they are in owns neither jack and
 * feeds nothing that does — so `link` leaves it out of `order` and the runtime never solves
 * it. Measured on the corpus: 11 controls across 5 packets, `boss-od-1`'s battery contact and
 * `boss-sd-1`'s effect switch being the two that no earlier rule catches.
 *
 * **A control with no stamp at all is deliberately not this warning.** 74 declared controls
 * are in that position and almost all of them are jacks, LED indicators and DC-adaptor
 * entries that were never knobs — a separate question about what belongs in
 * `program.controls`, and warning about them would bury these 11 in 74 rows of noise.
 *
 * Reads `program.order` rather than re-deriving reachability, because the program's own
 * statement of what executes is the fact being reported.
 */
function controlsOnlyInUnscheduledBlocks(
	program: Program,
): ReadonlySet<ControlId> {
	const scheduled = new Set(program.order);
	const stampedAnywhere = new Set<ControlId>();
	const stampedInScheduled = new Set<ControlId>();
	for (const block of program.blocks) {
		if (block.kind === "macro") {
			const controlId = block.clockControl?.controlId;
			if (controlId !== undefined) {
				stampedAnywhere.add(controlId);
				if (scheduled.has(block.id)) {
					stampedInScheduled.add(controlId);
				}
			}
			continue;
		}
		if (block.kind !== "mna") {
			continue;
		}
		for (const stamp of block.stamps) {
			const control = stampControl(stamp);
			if (control === null) {
				continue;
			}
			stampedAnywhere.add(control);
			if (scheduled.has(block.id)) {
				stampedInScheduled.add(control);
			}
		}
	}
	for (const control of stampedInScheduled) {
		stampedAnywhere.delete(control);
	}
	return stampedAnywhere;
}

/**
 * Controls whose stamps sit in at least one block the program executes in `order`.
 */
function controlsInScheduledBlocks(
	program: Program,
): ReadonlySet<ControlId> {
	const scheduled = new Set(program.order);
	const inScheduled = new Set<ControlId>();
	for (const block of program.blocks) {
		if (!scheduled.has(block.id)) {
			continue;
		}
		if (block.kind === "macro") {
			const controlId = block.clockControl?.controlId;
			if (controlId !== undefined) {
				inScheduled.add(controlId);
			}
			continue;
		}
		if (block.kind !== "mna") {
			continue;
		}
		for (const stamp of block.stamps) {
			const control = stampControl(stamp);
			if (control !== null) {
				inScheduled.add(control);
			}
		}
	}
	return inScheduled;
}

/**
 * A device joined to no circuit: every terminal it declares is touched by nothing else.
 *
 * Ground is deliberately *not* excused here, unlike in the dangling-terminal rule. A device with one
 * terminal on ground and the rest unwired still cannot do anything, and a control driving it still
 * cannot be heard -- which is the claim this file makes.
 */
function isFullyDisconnected(
	device: Device,
	degree: ReadonlyMap<NodeId, number>,
): boolean {
	return (
		device.nodes.length > 0 &&
		device.nodes.every((node) => (degree.get(node) ?? 0) <= 1)
	);
}

function wiperIsFloating(
	device: Device,
	degree: ReadonlyMap<NodeId, number>,
): boolean {
	if (device.nodes.length !== 3) {
		return false;
	}
	// The same terminal-order reading the lowering stage uses, imported rather than
	// repeated: a second copy of "which lug is the wiper" would drift from the one that
	// decides what actually gets stamped, and then the warning would describe a
	// different circuit from the program. Only the wiper is read here, which is decided
	// before `potTerminals` ever consults connectivity, so two empty maps are exact -- not a
	// stand-in -- for what this caller needs.
	const [, wiper] = potTerminals(device, new Map(), new Map());
	return (degree.get(wiper) ?? 0) === 1;
}
