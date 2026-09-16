// Stage 4: split the lawed netlist into regions by solver.
//
// Pure graph work: no identification, no text, no geometry. Three region kinds --
// linear regions reduced once, nonlinear regions iterated per sample, and macro
// models the compiler does not solve at all.
//
// Two design commitments live here.
//
// **Partitions form a dependency graph, not a flat list.** A macro model's parameters
// can come from an analog region the compiler does solve -- a BBD's delay time is set
// by its clock network, which is in the netlist. So a region can depend on another
// region's solution, and the structure has to admit that from the start.
//
// **A control must not straddle regions.** Because taper is emitted into the program
// (decision 2), coefficients are evaluated at runtime from a 0..1 position; if one
// control's devices sat in two regions, moving a knob would force both to re-evaluate
// in lockstep. Keeping a control inside one region is what makes the update cheap.

import { StageRefusal } from "./errors";
import type {
	DeviceId,
	DeviceLaw,
	LawedNetlist,
	NodeId,
	Partitioning,
	Region,
} from "./types";

/**
 * Does this law need Newton, or can its region be solved once?
 *
 * **Every law kind states its own answer, so adding one without deciding is a compile error
 * here rather than a silent misclassification.** `Record` over the full union is what enforces
 * that: a missing key and a stale key both fail to type-check, at the table, where the decision
 * is written. A membership test cannot do this job — `Set.has` narrows nothing, so an
 * unclassified kind would fall through to whichever branch happened to be last.
 *
 * The default matters because the two directions fail very differently. Treating a linear law
 * as nonlinear costs a few iterations; treating a nonlinear law as linear is a wrong answer
 * that still renders — `iterate` runs exactly one pass, evaluates the new law once from a zero
 * start, and emits the result as solved, with no held sample, no telemetry and no diagnostic.
 * Adding the `triode` walked straight into that when this was an allow-list of nonlinear kinds.
 *
 * `ideal-opamp` is the one kind whose answer is not a constant, so it is excluded here and
 * decided in `lawNeedsNewton` from its own rails.
 */
const NEWTON_BY_LAW_KIND: Readonly<
	Record<Exclude<DeviceLaw["kind"], "ideal-opamp">, boolean>
> = {
	conductance: false,
	"controlled-conductance": false,
	"controlled-resistance": false,
	capacitance: false,
	inductance: false,
	"voltage-source": false,
	// A sine EMF is time-varying and **linear**: its value changes between samples, and at
	// every sample it is a constant in the system being solved, exactly as an input source
	// is. Nothing about it curves, so a region containing one still solves in a single pass.
	"ac-source": false,
	switch: false,
	selector: false,
	transformer: false,
	"port-engage": false,
	open: false,
	// Linear within a sample, like `transformer`: the tank contributes a fixed conductance
	// and a fixed Thevenin source, and its memory advances after the solve, not inside it.
	"spring-reverb": false,
	// The toggle is a once-per-sample state step, not a mode switch inside the loop: Q
	// is committed before the first stamp and held for the whole Newton pass, so within
	// a sample the divider is a constant voltage source. `stampNeedsNewton` agrees.
	"logic-divider": false,
	diode: true,
	bjt: true,
	fet: true,
	triode: true,
	pentode: true,
	// Space charge is a 3/2 power law, so a tube diode curves as surely as a junction one --
	// and it is the element whose drop under load *is* rectifier sag, which a single linear
	// pass would flatten into a fixed offset.
	"tube-diode": true,
	// An OTA was a linear VCCS when it entered this list and is not one now: its stamp
	// solves an exponential Vbe bias diode and compresses the differential input through
	// tanh. `lower.ts`'s `stampNeedsNewton` says so and this line did not, which is the
	// drift this table's header calls a trap -- kept in step here rather than relying
	// on `Block.linear` being recomputed from the stamps to cover for it.
	ota: true,
	inverter: true,
	"nand-gate": true,
	"analog-switch": true,
	compandor: true,
	comparator: true,
	// Its phase advances once per sample, but the three levels it drives are all read
	// from the solved VDD rail, so its rows move with the solution inside one sample.
	"clock-driver": true,
	optocoupler: true,
};

function lawNeedsNewton(law: DeviceLaw): boolean {
	// A rail-limited op-amp saturates, which is a mode switch and needs Newton. Without rails it
	// is a plain high-gain VCVS and stays linear.
	if (law.kind === "ideal-opamp") {
		return law.railHigh !== null;
	}
	return NEWTON_BY_LAW_KIND[law.kind];
}

export function partition(lawed: LawedNetlist): Partitioning {
	const { netlist, resolutions } = lawed;
	const resolutionByDevice = new Map(
		resolutions.map((resolution) => [resolution.device, resolution] as const),
	);

	const macroRegions: Region[] = [];
	const analogDevices: DeviceId[] = [];

	for (const device of netlist.devices) {
		const resolution = resolutionByDevice.get(device.id);
		if (resolution === undefined || resolution.outcome === "unsupported") {
			continue;
		}
		if (resolution.outcome === "macro") {
			macroRegions.push({
				id: `macro:${device.id}`,
				kind: "macro",
				devices: [device.id],
				nodes: [...new Set(device.nodes)],
				macro: resolution.macro,
				controls: device.control === null ? [] : [device.control],
			});
			continue;
		}
		if (resolution.law.kind === "open") {
			continue;
		}
		analogDevices.push(device.id);
	}

	// Everything lumped forms one connected analog region per galvanically-joined
	// group. Ground joins everything, so it is excluded when grouping.
	const deviceById = new Map(
		netlist.devices.map((device) => [device.id, device] as const),
	);
	const groups = connectedGroups(analogDevices, (id) =>
		(deviceById.get(id)?.nodes ?? []).filter((node) => node !== 0),
	);

	const analogRegions: Region[] = groups.map((group, index) => {
		const nonlinear = group.some((id) => {
			const resolution = resolutionByDevice.get(id);
			return resolution?.outcome === "law" && lawNeedsNewton(resolution.law);
		});
		const nodes = [
			...new Set(group.flatMap((id) => deviceById.get(id)?.nodes ?? [])),
		].sort((a, b) => a - b);
		const controls = [
			...new Set(
				group
					.map((id) => deviceById.get(id)?.control ?? null)
					.filter((control): control is string => control !== null),
			),
		];
		return {
			id: `analog:${index}`,
			kind: nonlinear ? "nonlinear" : "linear",
			devices: group,
			nodes,
			macro: null,
			controls,
		};
	});

	const regions = [...analogRegions, ...macroRegions];

	// A macro model's parameters may be set by an analog region it shares a node with.
	const dependencies: Record<string, string[]> = {};
	for (const region of regions) {
		dependencies[region.id] = [];
	}
	for (const macro of macroRegions) {
		const shared = analogRegions
			.filter((analog) =>
				analog.nodes.some((node) => node !== 0 && macro.nodes.includes(node)),
			)
			.map((analog) => analog.id);
		dependencies[macro.id] = shared;
	}

	assertControlsDoNotStraddle(regions);

	return { regions, dependencies };
}

/** Group devices that share any non-ground node. */
function connectedGroups(
	devices: readonly DeviceId[],
	nodesOf: (device: DeviceId) => readonly NodeId[],
): DeviceId[][] {
	const parents = new Map<DeviceId, DeviceId>();
	const find = (value: DeviceId): DeviceId => {
		const parent = parents.get(value);
		if (parent === undefined) {
			parents.set(value, value);
			return value;
		}
		if (parent === value) {
			return value;
		}
		const root = find(parent);
		parents.set(value, root);
		return root;
	};
	const union = (a: DeviceId, b: DeviceId): void => {
		const rootA = find(a);
		const rootB = find(b);
		if (rootA !== rootB) {
			parents.set(rootB, rootA);
		}
	};

	for (const device of devices) {
		find(device);
	}
	const byNode = new Map<NodeId, DeviceId[]>();
	for (const device of devices) {
		for (const node of nodesOf(device)) {
			const list = byNode.get(node) ?? [];
			list.push(device);
			byNode.set(node, list);
		}
	}
	for (const list of byNode.values()) {
		for (let index = 1; index < list.length; index += 1) {
			union(list[0] as DeviceId, list[index] as DeviceId);
		}
	}

	const groups = new Map<DeviceId, DeviceId[]>();
	for (const device of devices) {
		const root = find(device);
		const group = groups.get(root) ?? [];
		group.push(device);
		groups.set(root, group);
	}
	return [...groups.values()];
}

export class PartitionError extends StageRefusal {
	constructor(message: string) {
		super("partition", null, message);
	}
}

function assertControlsDoNotStraddle(regions: readonly Region[]): void {
	const seen = new Map<string, string>();
	for (const region of regions) {
		for (const control of region.controls) {
			const existing = seen.get(control);
			if (existing !== undefined && existing !== region.id) {
				throw new PartitionError(
					`control ${control} spans regions ${existing} and ${region.id}; a control must sit in one region so a knob move re-evaluates one region's coefficients`,
				);
			}
			seen.set(control, region.id);
		}
	}
}
