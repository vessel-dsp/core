// BBD clock derivation: resolves the timing network of dedicated BBD clock drivers
// (CD4047, MN3101, MN3102) to derive BBD macro delaySeconds = stages / (2 * f_clock).
//
// Sourced datasheet formulas:
// - Texas Instruments CD4047B (SCHS044C, Astable Mode):
//   "The output frequency (at the Q and Q̄ outputs) of this circuit can be made fixed or variable by varying R or C.
//    The output waveform is a 50% duty cycle square wave of period equal to 4.40 RC. f_Q = 1 / (4.40 * R * C)."
//   Driven from complementary outputs Q/Q̄: f_clock = 1 / (4.40 * R * C) => delay = stages * 2.20 * R * C.
// - Panasonic MN3101/MN3102 (MN3101 datasheet p.2):
//   Oscillation frequency f_clock ≈ 1 / (5.0 * R * C) at CP1/CP2 => delay = stages * 2.50 * R * C.
//
// Refusals are strictly raised for:
// - collapsed-timing-network (shorted timing pins)
// - no-timing-capacitor / no-timing-resistor
// - grounded timing pins
// - ambiguous multi-path timing networks across different oscillator node pairs
// - unconnected oscillator pins

import type {
	ControlId,
	Device,
	DeviceKind,
	Netlist,
	NodeId,
	TaperKind,
} from "./types";
import { GROUND } from "./types";
import type { PartRegistry } from "./registry";
import { foldToken, registryEntryFor } from "./registry";

export type ClockDriverFamily = "CD4047" | "MN3101" | "MN3102" | "unknown";

export type BbdClockDerivationOutcome =
	| {
			readonly outcome: "derived";
			readonly delaySeconds: number;
			readonly rOhms: number;
			readonly cFarads: number;
			readonly fClockHz: number;
			readonly family: ClockDriverFamily;
			readonly stages: number;
			readonly formulaConstant: number;
			readonly controlId: ControlId | null;
			readonly taper: TaperKind;
			readonly ohmsAtControlMin: number;
			readonly ohmsAtControlMax: number;
	  }
	| {
			readonly outcome: "no-clock-driver";
	  }
	| {
			readonly outcome: "refused";
			readonly reason: string;
	  };

const CD4047_PART_IDS = new Set([
	"cd4047",
	"cd4047b",
	"cd4047be",
	"cd4047bm",
	"cd4047bc",
	"hcf4047",
	"hef4047",
	"mc14047b",
	"mc14047bd",
]);

const MN3101_PART_IDS = new Set([
	"mn3101",
	"mn3101a",
	"upd3101",
	"upd3101c",
	"upd3101d",
]);
const MN3102_PART_IDS = new Set([
	"mn3102",
	"mn3102a",
	"upd3102",
	"upd3102c",
	"upd3102d",
]);

const CD4047_C_ROLES = new Set(["c", "pin1", "1", "cext", "c_ext"]);
const CD4047_R_ROLES = new Set(["r", "pin2", "2", "rext", "r_ext"]);
const CD4047_RC_ROLES = new Set(["rccommon", "pin3", "3", "rc_common", "rc", "common"]);

const PT2399_VCO_ROLES = new Set(["vco", "vcopin", "vco_pin", "pin6", "6"]);

const INVERTER_OSCILLATOR_PART_IDS = new Set([
	"74hc04",
	"74hcu04",
	"74hc04n",
	"74hcu04n",
	"74hc04d",
	"74hcu04d",
	"74hc14",
	"74hc14n",
	"cd4069",
	"cd4069ub",
	"cd4069ube",
	"cd4069ubm",
	"hcf4069",
	"hef4069",
	"hef4069ub",
	"tc4069",
	"tc4069ub",
]);

const OX_CANONICAL_ROLES = new Set(["ox1", "ox2", "ox3"]);

const isPositionalToken = (token: string): boolean => /^(?:pin)?\d+$/.test(token);

function oscillatorRoleTokens(
	device: Device,
	registry: PartRegistry,
): ReadonlySet<string> {
	const tokens = new Set(OX_CANONICAL_ROLES);
	const partNumber = device.identity.partNumber;
	if (partNumber === null) {
		return tokens;
	}
	const entry = registryEntryFor(
		registry,
		{ partId: partNumber, evidence: "exact-part" },
		device.nodes.length,
	);
	if (entry === null) {
		return tokens;
	}
	for (const group of entry.terminalRoleGroups) {
		const folded = group.map(foldToken);
		if (!folded.some((token) => OX_CANONICAL_ROLES.has(token))) {
			continue;
		}
		for (const token of folded) {
			if (!isPositionalToken(token)) {
				tokens.add(token);
			}
		}
	}
	return tokens;
}

/**
 * Device kinds that can *drive* a timing node rather than merely set it.
 *
 * A resistor, a capacitor and a potentiometer are the timing network — a pot is a knob, which is
 * control-rate and already carried as `controlId`. Anything on this list sitting on the timing
 * network is steering it at signal rate, which is how an LFO reaches a BBD clock.
 *
 * `diode` is deliberately absent: `mxr-carbon-copy` clamps its CD4047 timing node with `D5` to
 * ground, and a clamp is not a modulator. `ic` is absent because the clock driver is itself an
 * `ic` on its own timing pins.
 */
export const ACTIVE_TIMING_KINDS: ReadonlySet<DeviceKind> = new Set<DeviceKind>([
	"bjt",
	"jfet",
	"mosfet",
	"opamp",
	"triode",
	"pentode",
]);

/**
 * Devices actively steering this clock driver's timing network, by id.
 *
 * The discrimination this exists for, measured 2026-08-29 across the corpus: `mxr-carbon-copy`
 * and `boss-dm-2` carry only resistors, capacitors and pots on their timing nodes, so their
 * derived delays are a property of the circuit. `boss-ce-5` carries **`Q8`'s emitter directly
 * on oscillator node 42**, so the frequency is set by that transistor's current and the R·C
 * arithmetic reads a resistor that is not what times the oscillator.
 */
export function activeTimingDrivers(
	clockDevice: Device,
	netlist: Netlist,
	registry: PartRegistry,
): readonly string[] {
	const timing = clockTimingNodes(clockDevice, registry);
	if (timing.size === 0) {
		return [];
	}
	const found = new Set<string>();
	for (const candidate of netlist.devices) {
		if (candidate.id === clockDevice.id) {
			continue;
		}
		if (!ACTIVE_TIMING_KINDS.has(candidate.kind)) {
			continue;
		}
		if (candidate.nodes.some((n) => timing.has(n))) {
			found.add(candidate.id);
		}
	}
	return [...found].sort();
}

/**
 * Logic parts that generate or divide a BBD clock, by exact part id.
 *
 * A closed vocabulary, matched as whole folded values — never a substring, never a declared-type
 * or name heuristic. Two corpus packets clock their brigade this way instead of from a dedicated
 * CD4047/MN310x: `mxr-micro-flanger` (MC14069UB hex inverter, a relaxation oscillator) and
 * `mxr-m117r-flanger` (CD4013AE dual D flip-flop, dividing an upstream oscillator into the two
 * phases the SAD1024 wants).
 *
 * Recognising them buys a **correct diagnosis, not a delay**: both are flangers, so both sweep,
 * and both therefore reach the modulated refusal below. That is the whole point — before this
 * they reported "no clock driver device is wired to this delay line", which is false.
 */
const GATE_CLOCK_PART_IDS: ReadonlySet<string> = new Set([
	...INVERTER_OSCILLATOR_PART_IDS,
	"mc14069",
	"mc14069b",
	"mc14069ub",
	"mc14069ubcp",
	"cd4013",
	"cd4013a",
	"cd4013ae",
	"cd4013b",
	"cd4013be",
	"hef4013",
	"hcf4013",
	"mc14013",
	"mc14013b",
	"cd4011",
	"cd4011b",
	"cd4011be",
	"hef4011",
	"mc14011",
	"mc14011b",
	"hd14011",
	"hd14011bp",
	"cd4043",
	"cd4043b",
	"scl4043",
	"scl4043a",
]);

/** Role tokens naming a supply pin, which is never part of a timing network. */
const SUPPLY_ROLE_TOKENS: ReadonlySet<string> = new Set([
	"vss",
	"vdd",
	"vcc",
	"vee",
	"gnd",
	"ground",
	"v+",
	"v-",
	"vbb",
]);

/**
 * Role tokens naming a bucket brigade's clock pins.
 *
 * Closed and compared as whole values. The `a`/`b` suffixes are the SAD1024's two independent
 * halves, which `mxr-m117r-flanger` declares as `phi1a`/`phi2a`/`phi1b`/`phi2b`.
 */
const BBD_CLOCK_ROLE_TOKENS: ReadonlySet<string> = new Set([
	"clk",
	"clk1",
	"clk2",
	"clock",
	"clock1",
	"clock2",
	"cp1",
	"cp2",
	"phi1",
	"phi2",
	"phi1a",
	"phi2a",
	"phi1b",
	"phi2b",
]);

/** The nodes a bucket brigade takes its clock on. */
function bbdClockNodes(bbdDevice: Device): ReadonlySet<NodeId> {
	const nodes = new Set<NodeId>();
	(bbdDevice.identity.terminalRoles ?? []).forEach((role, index) => {
		if (role === null || !BBD_CLOCK_ROLE_TOKENS.has(foldToken(role))) {
			return;
		}
		const node = bbdDevice.nodes[index];
		if (node !== undefined && node !== GROUND) {
			nodes.add(node);
		}
	});
	return nodes;
}

/** A logic part generating or dividing this brigade's clock, or `null`. */
function findGateClockSource(
	bbdDevice: Device,
	netlist: Netlist,
): Device | null {
	const clockNodes = bbdClockNodes(bbdDevice);
	if (clockNodes.size === 0) {
		return null;
	}
	for (const candidate of netlist.devices) {
		if (candidate.id === bbdDevice.id) {
			continue;
		}
		if (!GATE_CLOCK_PART_IDS.has(foldToken(candidate.identity.partNumber ?? ""))) {
			continue;
		}
		if (candidate.nodes.some((n) => clockNodes.has(n))) {
			return candidate;
		}
	}
	return null;
}

/** A gate part's supply nodes, by role token. */
function gateSupplyNodes(device: Device): ReadonlySet<NodeId> {
	const nodes = new Set<NodeId>();
	(device.identity.terminalRoles ?? []).forEach((role, index) => {
		if (role === null || !SUPPLY_ROLE_TOKENS.has(foldToken(role))) {
			return;
		}
		const node = device.nodes[index];
		if (node !== undefined) {
			nodes.add(node);
		}
	});
	return nodes;
}

/**
 * Every `GATE_CLOCK_PART_IDS` device electrically chained to `entryGate` through shared
 * non-supply pins -- the whole relaxation-oscillator loop, not just the one gate whose output
 * happens to land on the BBD's clock pin.
 *
 * `mxr-micro-flanger` clocks its SAD512D from `U2.G2` (an MC14069 inverter), but the actual
 * oscillator is **two** inverters in series: `U2.G1`'s output (node 2) feeds `U2.G2`'s input,
 * and the timing capacitor `C15` bridges back from that same node to `U2.G1`'s own input (node
 * 1) -- the node `Q3` steers to sweep the rate. Scoping the timing network to `U2.G2` alone drops
 * node 1 from it entirely, so `Q3` reads as two passive hops away instead of one and
 * `resolveClockModulationSource` returns "none" for a pedal that plainly sweeps.
 *
 * The walk follows only the closed `GATE_CLOCK_PART_IDS` vocabulary and only actual shared
 * connectivity -- never a name, an id, or a declared type -- so it generalises to any oscillator
 * built from more than one package section: a fan-in/fan-out ambiguity is not resolved by
 * guessing, it just does not extend the walk past it. `U2.G3`..`U2.G6` on this same package are
 * tied-off spare gates with no node in common with `U2.G1`/`U2.G2`'s signal nodes, so they are
 * correctly left out.
 */
function gateOscillatorChain(entryGate: Device, netlist: Netlist): readonly Device[] {
	const chain = new Map<string, Device>([[entryGate.id, entryGate]]);
	const stack: Device[] = [entryGate];
	while (stack.length > 0) {
		const current = stack.pop()!;
		const currentSignal = gateSignalNodes(current);
		for (const candidate of netlist.devices) {
			if (chain.has(candidate.id)) {
				continue;
			}
			if (!GATE_CLOCK_PART_IDS.has(foldToken(candidate.identity.partNumber ?? ""))) {
				continue;
			}
			const candidateSignal = gateSignalNodes(candidate);
			const connected = [...candidateSignal].some((n) => currentSignal.has(n));
			if (connected) {
				chain.set(candidate.id, candidate);
				stack.push(candidate);
			}
		}
	}
	return [...chain.values()];
}

/** The signal nodes of every gate chained into `entryGate`'s oscillator loop. */
function gateOscillatorSignalNodes(
	entryGate: Device,
	netlist: Netlist,
): ReadonlySet<NodeId> {
	const nodes = new Set<NodeId>();
	for (const device of gateOscillatorChain(entryGate, netlist)) {
		for (const n of gateSignalNodes(device)) {
			nodes.add(n);
		}
	}
	return nodes;
}

/** The supply nodes of every gate chained into `entryGate`'s oscillator loop. */
function gateOscillatorSupplyNodes(
	entryGate: Device,
	netlist: Netlist,
): ReadonlySet<NodeId> {
	const nodes = new Set<NodeId>();
	for (const device of gateOscillatorChain(entryGate, netlist)) {
		for (const n of gateSupplyNodes(device)) {
			nodes.add(n);
		}
	}
	return nodes;
}

/** A gate part's non-supply nodes: its oscillator, once the rails are excluded by role. */
function gateSignalNodes(device: Device): ReadonlySet<NodeId> {
	const nodes = new Set<NodeId>();
	(device.identity.terminalRoles ?? []).forEach((role, index) => {
		if (role !== null && SUPPLY_ROLE_TOKENS.has(foldToken(role))) {
			return;
		}
		const node = device.nodes[index];
		if (node !== undefined && node !== GROUND) {
			nodes.add(node);
		}
	});
	return nodes;
}

/** Two-terminal passives a steering current reaches a timing node through. */
const PASSIVE_HOP_KINDS: ReadonlySet<DeviceKind> = new Set<DeviceKind>([
	"resistor",
	"capacitor",
	"potentiometer",
	"rheostat",
]);

const TIMING_RESISTANCE_KINDS: ReadonlySet<DeviceKind> = new Set<DeviceKind>([
	"resistor",
	"potentiometer",
	"rheostat",
]);

/**
 * Active devices on a timing network, optionally reached through one passive component.
 *
 * **The one-hop form is used only on the gate-oscillator branch, and that restriction is
 * load-bearing.** `mxr-micro-flanger` steers its MC14069 oscillator with `Q3`, whose collector
 * feeds oscillator node 1 through `R27`/`R29` rather than sitting on it — direct contact cannot
 * see that. But widening the dedicated-driver check the same way would reach past the timing
 * components of circuits that currently derive honestly, and there the cost of a false positive
 * is a lost delay rather than a slightly less precise refusal. The gate branch refuses either
 * way, so a false positive there costs only wording.
 */
function activeDevicesOn(
	timing: ReadonlySet<NodeId>,
	netlist: Netlist,
	exclude: ReadonlySet<string>,
	throughOnePassive = false,
	blockedNodes: ReadonlySet<NodeId> = new Set(),
): readonly string[] {
	const reachable = new Set<NodeId>(timing);
	if (throughOnePassive) {
		for (const d of netlist.devices) {
			if (!PASSIVE_HOP_KINDS.has(d.kind)) {
				continue;
			}
			if (!d.nodes.some((n) => timing.has(n))) {
				continue;
			}
			for (const n of d.nodes) {
				// **Never hop onto a supply rail.** `mxr-micro-flanger` decouples its MC14069
				// with `C21` from VDD to oscillator node 4, so without this the rail joins the
				// reachable set and every transistor with an emitter on it -- `Q1`, `Q2` --
				// reads as steering the oscillator. Only `Q3` actually does.
				if (n !== GROUND && !blockedNodes.has(n)) {
					reachable.add(n);
				}
			}
		}
	}
	const found = new Set<string>();
	for (const candidate of netlist.devices) {
		if (exclude.has(candidate.id)) {
			continue;
		}
		if (!ACTIVE_TIMING_KINDS.has(candidate.kind)) {
			continue;
		}
		if (candidate.nodes.some((n) => reachable.has(n))) {
			found.add(candidate.id);
		}
	}
	return [...found].sort();
}

/** Terminal roles that *control* an active device, as opposed to carrying its current. */
const CONTROL_ROLE_TOKENS: ReadonlySet<string> = new Set(["base", "gate"]);

export type ClockModulationSource =
	| { readonly outcome: "resolved"; readonly steeredBy: string; readonly node: NodeId }
	| { readonly outcome: "none" }
	| { readonly outcome: "refused"; readonly reason: string };

/**
 * The node an LFO reaches a modulated BBD clock on: the steering device's **control** terminal.
 *
 * **Not the timing node.** That is the point of this function. The timing node carries the
 * oscillator's own waveform at the clock rate — for a chorus, ~100 kHz, far above anything a
 * 48 kHz host can sample — so reading it as a modulation source would alias garbage into the
 * delay length. The control terminal carries the LFO and nothing else: on `boss-ce-2` that is
 * `Q5`'s base, which the DEPTH pot reaches through `Q4` and `D1`.
 *
 * Deliberately strict. Exactly one steering device with one resolvable control terminal, and
 * that terminal may not sit on ground or on the timing network itself. Anything else refuses by
 * name and leaves the delay static, because a guess here is a sweep of the wrong thing.
 */
export function resolveClockModulationSource(
	bbdDevice: Device,
	netlist: Netlist,
	registry: PartRegistry,
): ClockModulationSource {
	const dedicated = findClockDriverDevice(netlist);
	let timing: ReadonlySet<NodeId>;
	let steering: readonly string[];
	let sourceId: string;

	if (dedicated !== null) {
		timing = clockTimingNodes(dedicated, registry);
		steering = activeTimingDrivers(dedicated, netlist, registry);
		sourceId = dedicated.id;
	} else {
		const gate = findGateClockSource(bbdDevice, netlist);
		if (gate === null) {
			return { outcome: "none" };
		}
		const chain = gateOscillatorChain(gate, netlist);
		timing = gateOscillatorSignalNodes(gate, netlist);
		steering = activeDevicesOn(
			timing,
			netlist,
			new Set([...chain.map((d) => d.id), bbdDevice.id]),
			true,
			gateOscillatorSupplyNodes(gate, netlist),
		);
		sourceId = gate.id;
	}

	if (steering.length === 0) {
		return { outcome: "none" };
	}
	if (steering.length > 1) {
		return {
			outcome: "refused",
			reason:
				`${sourceId}'s timing network is steered by ${steering.length} devices ` +
				`(${steering.join(", ")}); a modulation port needs exactly one control terminal ` +
				`and choosing between them would be a guess`,
		};
	}

	const steerer = netlist.devices.find((d) => d.id === steering[0]);
	if (steerer === undefined) {
		return { outcome: "none" };
	}

	const controls: NodeId[] = [];
	(steerer.identity.terminalRoles ?? []).forEach((role, index) => {
		if (role === null || !CONTROL_ROLE_TOKENS.has(foldToken(role))) {
			return;
		}
		const node = steerer.nodes[index];
		if (node !== undefined) {
			controls.push(node);
		}
	});

	if (controls.length !== 1) {
		return {
			outcome: "refused",
			reason:
				`${steerer.id} steers ${sourceId}'s timing network but exposes ` +
				`${controls.length} control terminals, so the node its modulation arrives on is ` +
				`not determined`,
		};
	}
	const node = controls[0] as NodeId;
	if (node === GROUND) {
		return {
			outcome: "refused",
			reason: `${steerer.id}'s control terminal is grounded, so it carries no modulation`,
		};
	}
	if (timing.has(node)) {
		return {
			outcome: "refused",
			reason:
				`${steerer.id}'s control terminal sits on the timing network itself (node ` +
				`${node}), so it carries the oscillator's own waveform rather than a modulation`,
		};
	}
	return { outcome: "resolved", steeredBy: steerer.id, node };
}

/** The refusal an actively-steered timing network earns, or `null` when the network is passive. */
function modulatedClockRefusal(
	clockDevice: Device,
	netlist: Netlist,
	registry: PartRegistry,
): string | null {
	const drivers = activeTimingDrivers(clockDevice, netlist, registry);
	if (drivers.length === 0) {
		return null;
	}
	return (
		`timing network is steered by ${drivers.join(", ")}, so this clock is modulated and its ` +
		`delay is not a single number: R and C do not time this oscillator, and reducing it to ` +
		`stages / (2 * f(R,C)) would report one arbitrary point of a sweep as though it were the ` +
		`delay. Needs the signal-rate modulation port (see ` +
		`thoughts/shared/plans/2026-08-29-bbd-modulated-delay-architecture.md, M3)`
	);
}

/**
 * The nodes a clock driver's own timing network hangs on, by family.
 *
 * Exported because `scripts/report-bbd-architecture.ts` asks the same question and answered it
 * with a private copy of the role vocabulary, which **under-reported immediately**: an MN3102
 * spelling its pins `oscillatorinput`/`oscillatoroutput`/`clockcontrol` (`boss-bf-2`) matched
 * none of the canonical `ox1`/`ox2`/`ox3` tokens, so a driver the compiler finds read as absent
 * in the report. One enumerator, shared, is the same conclusion `stampNodes` reached.
 *
 * Role tokens are compared as whole values after folding, never by substring, and the MN310x
 * branch admits the registry's own alias spellings through `oscillatorRoleTokens`.
 */
export function clockTimingNodes(
	device: Device,
	registry: PartRegistry,
): ReadonlySet<NodeId> {
	const family = identifyClockFamily(device);
	const roles = device.identity.terminalRoles ?? [];
	const wanted: ReadonlySet<string> =
		family === "CD4047"
			? new Set([...CD4047_C_ROLES, ...CD4047_R_ROLES, ...CD4047_RC_ROLES])
			: oscillatorRoleTokens(device, registry);

	const nodes = new Set<NodeId>();
	roles.forEach((role, index) => {
		if (role === null) {
			return;
		}
		const token = foldToken(role);
		// A positional token (`pin3`, `3`) is only meaningful for the CD4047, whose timing pins
		// are fixed by the datasheet. Admitting them for an MN310x would pull in whichever pin
		// happened to sit at that index.
		if (family !== "CD4047" && isPositionalToken(token)) {
			return;
		}
		if (!wanted.has(token)) {
			return;
		}
		const node = device.nodes[index];
		if (node !== undefined && node !== GROUND) {
			nodes.add(node);
		}
	});
	return nodes;
}

export function identifyClockFamily(device: Device): ClockDriverFamily {
	const part = foldToken(device.identity.partNumber ?? "");
	if (CD4047_PART_IDS.has(part)) return "CD4047";
	if (MN3101_PART_IDS.has(part)) return "MN3101";
	if (MN3102_PART_IDS.has(part)) return "MN3102";
	return "unknown";
}

export function findClockDriverDevice(netlist: Netlist): Device | null {
	for (const d of netlist.devices) {
		const family = identifyClockFamily(d);
		if (family !== "unknown") return d;
		const declared = foldToken(d.identity.declaredType ?? "");
		if (declared === "circuit.bbdclockdriver" || declared === "circuit.clockdriver") {
			return d;
		}
	}
	return null;
}

function resolveCd4047Pins(device: Device): {
	pin1_C: NodeId | null;
	pin2_R: NodeId | null;
	pin3_RC: NodeId | null;
} {
	let pin1_C: NodeId | null = null;
	let pin2_R: NodeId | null = null;
	let pin3_RC: NodeId | null = null;

	for (let i = 0; i < device.identity.terminalRoles.length; i++) {
		const role = foldToken(device.identity.terminalRoles[i] ?? "");
		const node = device.nodes[i];
		if (node === undefined) continue;
		if (CD4047_C_ROLES.has(role)) pin1_C = node;
		if (CD4047_R_ROLES.has(role)) pin2_R = node;
		if (CD4047_RC_ROLES.has(role)) pin3_RC = node;
	}

	const isBarePinOrEmpty = (role: string | null | undefined, pinNum: number) => {
		const f = foldToken(role ?? "");
		return f === "" || f === String(pinNum) || f === `pin${pinNum}`;
	};
	const roles = device.identity.terminalRoles;

	if (device.nodes.length >= 14) {
		if (pin1_C === null && isBarePinOrEmpty(roles[0], 1)) {
			pin1_C = device.nodes[0] ?? null;
		}
		if (pin2_R === null && isBarePinOrEmpty(roles[1], 2)) {
			pin2_R = device.nodes[1] ?? null;
		}
		if (pin3_RC === null && isBarePinOrEmpty(roles[2], 3)) {
			pin3_RC = device.nodes[2] ?? null;
		}
	}

	return { pin1_C, pin2_R, pin3_RC };
}

/**
 * Which canonical OX role each of a part's role aliases stands for.
 *
 * The set returned by `oscillatorRoleTokens` answers "is this terminal an oscillator pin", which
 * is all the old two-pin bridge test needed. The datasheet oscillator is a star and its three
 * legs are not interchangeable -- C1 hangs on OX3, the timing R2 on OX2, and R1 on OX1 is not a
 * timing element at all -- so the legs have to be told apart by name, not just counted.
 */
function oscillatorRoleByAlias(
	device: Device,
	registry: PartRegistry,
): ReadonlyMap<string, string> {
	const byAlias = new Map<string, string>();
	for (const canonical of OX_CANONICAL_ROLES) byAlias.set(canonical, canonical);
	const partNumber = device.identity.partNumber;
	if (partNumber === null) return byAlias;
	const entry = registryEntryFor(
		registry,
		{ partId: partNumber, evidence: "exact-part" },
		device.nodes.length,
	);
	if (entry === null) return byAlias;
	for (const group of entry.terminalRoleGroups) {
		const folded = group.map(foldToken);
		const canonical = folded.find((token) => OX_CANONICAL_ROLES.has(token));
		if (canonical === undefined) continue;
		for (const token of folded) {
			if (!isPositionalToken(token)) byAlias.set(token, canonical);
		}
	}
	return byAlias;
}

function resolveMn310xPins(
	device: Device,
	registry: PartRegistry,
): {
	oxNodes: readonly NodeId[];
	ox1: NodeId | null;
	ox2: NodeId | null;
	ox3: NodeId | null;
} {
	const oxRoles = oscillatorRoleTokens(device, registry);
	const byAlias = oscillatorRoleByAlias(device, registry);
	const oxNodes: NodeId[] = [];
	const byCanonical = new Map<string, NodeId>();
	for (let i = 0; i < device.identity.terminalRoles.length; i++) {
		const role = foldToken(device.identity.terminalRoles[i] ?? "");
		const node = device.nodes[i];
		if (node !== undefined && node !== GROUND && oxRoles.has(role)) {
			if (!oxNodes.includes(node)) oxNodes.push(node);
			const canonical = byAlias.get(role);
			if (canonical !== undefined && !byCanonical.has(canonical)) {
				byCanonical.set(canonical, node);
			}
		}
	}

	const isBarePinOrEmpty = (role: string | null | undefined, pinNum: number) => {
		const f = foldToken(role ?? "");
		return f === "" || f === String(pinNum) || f === `pin${pinNum}`;
	};

	if (oxNodes.length === 0 && device.nodes.length >= 8) {
		// Bare or empty roles on pins 5/6/7. The datasheet's pin order is OX3, OX2, OX1, so the
		// positional fallback can still name the legs.
		const positional = ["ox3", "ox2", "ox1"];
		for (let index = 4; index <= 6; index += 1) {
			if (!isBarePinOrEmpty(device.identity.terminalRoles[index], index + 1)) {
				continue;
			}
			const node = device.nodes[index];
			if (node !== undefined && node !== GROUND && !oxNodes.includes(node)) {
				oxNodes.push(node);
				const canonical = positional[index - 4]!;
				if (!byCanonical.has(canonical)) byCanonical.set(canonical, node);
			}
		}
	}

	return {
		oxNodes,
		ox1: byCanonical.get("ox1") ?? null,
		ox2: byCanonical.get("ox2") ?? null,
		ox3: byCanonical.get("ox3") ?? null,
	};
}

/**
 * The resistance a meter would read between two nodes of the resistive sub-network.
 *
 * Written because the MN3101's timing resistance is not one component and not one series or
 * parallel run of them: on `boss-dm-2` it is `(VR3 + R47) || (R48 + VR6)`, two series branches in
 * parallel, and the old candidate-list reduction could only do one of those two shapes at a time.
 * Solving the conductance matrix costs a few dozen flops on a network this size and is right for
 * any shape, including ones no corpus packet has yet.
 *
 * `ohmsFor` supplies each device's resistance at whatever control position the caller is
 * evaluating, so a sweep is three calls rather than three special cases. A three-terminal
 * potentiometer is entered as its two track halves, which makes a rheostat wiring -- wiper shorted
 * to an end lug -- reduce on its own: the shorted half becomes a self-loop and drops out.
 *
 * Returns null when the two nodes are not resistively connected, which is a refusal, not a zero.
 */
function resistanceBetween(
	devices: readonly Device[],
	from: NodeId,
	to: NodeId,
	blocked: ReadonlySet<NodeId>,
	ohmsFor: (device: Device) => { upper: number; lower: number },
): number | null {
	if (from === to) return 0;
	type Edge = { readonly a: NodeId; readonly b: NodeId; readonly ohms: number };
	const edges: Edge[] = [];
	for (const d of devices) {
		const usable = d.nodes.every((n) => n !== GROUND && !blocked.has(n));
		if (!usable) continue;
		const { upper, lower } = ohmsFor(d);
		if (d.nodes.length === 3) {
			const [end1, wiper, end2] = d.nodes as [NodeId, NodeId, NodeId];
			if (end1 !== wiper) edges.push({ a: end1, b: wiper, ohms: upper });
			if (wiper !== end2) edges.push({ a: wiper, b: end2, ohms: lower });
		} else if (d.nodes.length === 2) {
			const [a, b] = d.nodes as [NodeId, NodeId];
			if (a !== b) edges.push({ a, b, ohms: upper });
		} else {
			// Any other terminal count that still lands on exactly two nodes. `boss-dm-3`'s VR3 is
			// declared with four terminals -- `lug1, lug2, lug3, wiper` -- on a three-lug part, with
			// three of them shorted, and dropping it silently left the oscillator with no resistor.
			// The conducting portion is one track half, so it sweeps 0..R; which end of the knob is
			// which cannot be recovered from a declaration that duplicates a terminal, and the
			// caller reports the sweep's extremes, so only the direction is lost, not the range.
			const distinct = Array.from(new Set(d.nodes));
			if (distinct.length === 2) {
				edges.push({ a: distinct[0]!, b: distinct[1]!, ohms: lower });
			}
		}
	}
	if (edges.length === 0) return null;

	// **Only the component `from` and `to` sit in.** `devices` is the whole pedal's resistive
	// network, most of which has no path to this oscillator; indexing all of it would put dozens of
	// rows in the matrix with no route to the reference node, and every one of those is a zero pivot.
	// Measured: the first version of this solver indexed every edge and refused `boss-dm-2` for
	// "no resistive path" while the path was plainly there.
	const adjacency = new Map<NodeId, NodeId[]>();
	for (const e of edges) {
		if (!adjacency.has(e.a)) adjacency.set(e.a, []);
		if (!adjacency.has(e.b)) adjacency.set(e.b, []);
		adjacency.get(e.a)!.push(e.b);
		adjacency.get(e.b)!.push(e.a);
	}
	if (!adjacency.has(from) || !adjacency.has(to)) return null;
	const component = new Set<NodeId>([from]);
	const queue: NodeId[] = [from];
	while (queue.length > 0) {
		const node = queue.pop()!;
		for (const next of adjacency.get(node) ?? []) {
			if (!component.has(next)) {
				component.add(next);
				queue.push(next);
			}
		}
	}
	if (!component.has(to)) return null;

	const index = new Map<NodeId, number>();
	for (const node of component) index.set(node, index.size);

	// Inject 1 A at `from`, hold `to` at 0 V, read V(from). Gaussian elimination with partial
	// pivoting on a matrix whose largest corpus instance is 4x4.
	const n = index.size;
	const ref = index.get(to)!;
	const g: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
	const rhs = new Array<number>(n).fill(0);
	for (const e of edges) {
		const a = index.get(e.a);
		const b = index.get(e.b);
		if (a === undefined || b === undefined) continue;
		const conductance = 1 / Math.max(e.ohms, 1e-9);
		g[a]![a]! += conductance;
		g[b]![b]! += conductance;
		g[a]![b]! -= conductance;
		g[b]![a]! -= conductance;
	}
	rhs[index.get(from)!] = 1;
	// Ground the reference node by replacing its row with V(ref) = 0.
	g[ref] = new Array<number>(n).fill(0);
	g[ref]![ref] = 1;
	rhs[ref] = 0;

	for (let col = 0; col < n; col += 1) {
		let pivot = col;
		for (let row = col + 1; row < n; row += 1) {
			if (Math.abs(g[row]![col]!) > Math.abs(g[pivot]![col]!)) pivot = row;
		}
		if (Math.abs(g[pivot]![col]!) < 1e-18) return null;
		if (pivot !== col) {
			[g[col], g[pivot]] = [g[pivot]!, g[col]!];
			[rhs[col], rhs[pivot]] = [rhs[pivot]!, rhs[col]!];
		}
		const diagonal = g[col]![col]!;
		for (let row = col + 1; row < n; row += 1) {
			const factor = g[row]![col]! / diagonal;
			if (factor === 0) continue;
			for (let k = col; k < n; k += 1) g[row]![k]! -= factor * g[col]![k]!;
			rhs[row]! -= factor * rhs[col]!;
		}
	}
	const v = new Array<number>(n).fill(0);
	for (let row = n - 1; row >= 0; row -= 1) {
		let sum = rhs[row]!;
		for (let k = row + 1; k < n; k += 1) sum -= g[row]![k]! * v[k]!;
		v[row] = sum / g[row]![row]!;
	}
	const resistance = v[index.get(from)!]!;
	return Number.isFinite(resistance) && resistance >= 0 ? resistance : null;
}

/**
 * Which of the timing network's controls a player is actually turning.
 *
 * **The declared role first, and resistance span only as a fallback.** Span is not evidence about
 * which control a player turns: `mxr-carbon-copy` puts `VR3`, the DELAY knob, and `TR3`, a 500k
 * internal trimmer, across the *identical* three nodes, so the larger span is the trimmer and
 * picking it bound the delay to a part nobody can reach. Measured: the derived delay did not move
 * when VR3's value changed from 230k to 100k, because VR3 was not driving it.
 *
 * `role` is a typed panel declaration compared as a whole value -- not a substring of the control's
 * id, which is what the previous `startsWith("VR")` did and what this repository's own rules
 * forbid. 13 corpus documents declare `delay-time`.
 */
function primaryTimingControl(
	candidates: readonly Device[],
	netlist: Netlist,
): { device: Device | null; controlId: ControlId | null; taper: TaperKind } {
	const taperByControl = new Map<ControlId, TaperKind>();
	if (netlist.controls) {
		for (const ctrl of netlist.controls) {
			taperByControl.set(ctrl.id, ctrl.taper);
		}
	}

	const controlled = candidates.filter((d) => d.control !== null);
	let primaryDev: Device | null = null;
	if (controlled.length === 1) {
		primaryDev = controlled[0]!;
	} else if (controlled.length > 1) {
		const byRole = controlled.filter(
			(d) =>
				d.control !== null &&
				netlist.controls.find((c) => c.id === d.control)?.role === "delay-time",
		);
		const pool = byRole.length > 0 ? byRole : controlled;
		let maxSpan = -1;
		for (const d of pool) {
			const r0 = d.parameters.ohmsAt0 ?? 0;
			const r1 = d.parameters.ohmsAt1 ?? (d.parameters.ohms ?? 0);
			const span = Math.abs(r1 - r0);
			if (span > maxSpan) {
				maxSpan = span;
				primaryDev = d;
			}
		}
		primaryDev = primaryDev ?? controlled[0]!;
	}

	const controlId: ControlId | null = primaryDev?.control ?? null;
	return {
		device: primaryDev,
		controlId,
		taper:
			controlId !== null ? (taperByControl.get(controlId) ?? "linear") : "linear",
	};
}

function resolveTimingResistanceNetwork(
	candidates: readonly Device[],
	netlist: Netlist,
	isSeries: boolean = false,
): {
	rOhms: number;
	ohmsAtControlMin: number;
	ohmsAtControlMax: number;
	controlId: ControlId | null;
	taper: TaperKind;
} {
	const taperByControl = new Map<ControlId, TaperKind>();
	if (netlist.controls) {
		for (const ctrl of netlist.controls) {
			taperByControl.set(ctrl.id, ctrl.taper);
		}
	}

	const primaryDev = primaryTimingControl(candidates, netlist).device;

	let boundControlId: ControlId | null = primaryDev?.control ?? null;
	let boundTaper: TaperKind =
		boundControlId !== null
			? (taperByControl.get(boundControlId) ?? "linear")
			: "linear";

	if (isSeries) {
		let totalRMin = 0;
		let totalRMax = 0;
		let totalRNom = 0;

		for (const d of candidates) {
			const { rMin, rMax, rNom } = resistanceSpanForTimingDevice(d, primaryDev);

			totalRMin += rMin;
			totalRMax += rMax;
			totalRNom += rNom;
		}

		return {
			rOhms: totalRNom,
			ohmsAtControlMin: boundControlId !== null ? totalRMin : totalRNom,
			ohmsAtControlMax: boundControlId !== null ? totalRMax : totalRNom,
			controlId: boundControlId,
			taper: boundTaper,
		};
	}

	let totalConductanceMin = 0;
	let totalConductanceMax = 0;
	let totalConductanceNom = 0;

	for (const d of candidates) {
		const { rMin, rMax, rNom } = resistanceSpanForTimingDevice(d, primaryDev);

		if (rMin > 0) totalConductanceMin += 1 / rMin;
		else if (rMin === 0) totalConductanceMin = Infinity;

		if (rMax > 0) totalConductanceMax += 1 / rMax;
		else if (rMax === 0) totalConductanceMax = Infinity;

		if (rNom > 0) totalConductanceNom += 1 / rNom;
		else if (rNom === 0) totalConductanceNom = Infinity;
	}

	const ohmsAtControlMin =
		totalConductanceMin === Infinity
			? 0
			: totalConductanceMin > 0
				? 1 / totalConductanceMin
				: 0;
	const ohmsAtControlMax =
		totalConductanceMax === Infinity
			? 0
			: totalConductanceMax > 0
				? 1 / totalConductanceMax
				: 0;
	const rOhms =
		totalConductanceNom === Infinity
			? 0
			: totalConductanceNom > 0
				? 1 / totalConductanceNom
				: 0;

	return {
		rOhms,
		ohmsAtControlMin: boundControlId !== null ? ohmsAtControlMin : rOhms,
		ohmsAtControlMax: boundControlId !== null ? ohmsAtControlMax : rOhms,
		controlId: boundControlId,
		taper: boundTaper,
	};
}

function resistanceSpanForTimingDevice(
	device: Device,
	primaryDev: Device | null | undefined,
): { rMin: number; rMax: number; rNom: number } {
	if (device.kind === "resistor") {
		const ohms = device.parameters.ohms ?? 0;
		return { rMin: ohms, rMax: ohms, rNom: ohms };
	}
	if (device.kind === "potentiometer") {
		const ohms = device.parameters.ohms ?? 0;
		if (device === primaryDev && device.control !== null) {
			return { rMin: 0, rMax: ohms, rNom: ohms * 0.5 };
		}
		const held = ohms * 0.5;
		return { rMin: held, rMax: held, rNom: held };
	}
	if (device.kind === "rheostat") {
		const minOhms = device.parameters.minOhms ?? 0;
		const maxOhms = device.parameters.maxOhms ?? 0;
		if (device === primaryDev && device.control !== null) {
			return {
				rMin: minOhms,
				rMax: maxOhms,
				rNom: (minOhms + maxOhms) * 0.5,
			};
		}
		const held = (minOhms + maxOhms) * 0.5;
		return { rMin: held, rMax: held, rNom: held };
	}
	return { rMin: 0, rMax: 0, rNom: 0 };
}

function nodePairKey(device: Device): string {
	const nonGround = device.nodes.filter((n) => n !== GROUND).sort((a, b) => a - b);
	return nonGround.join(":");
}

/**
 * Derive the BBD delay in seconds from the netlist's clock network.
 */
/**
 * The lowest clock a bucket brigade can be running and still carry audio.
 *
 * A BBD is a sampled system clocked at `f_clock`, so its own Nyquist limit is `f_clock / 2`.
 * A guitar's highest fundamental is about 1.3 kHz (high E, 24th fret), so a brigade clocked
 * below 2 kHz cannot reproduce even the fundamentals of what is fed to it -- whatever such a
 * derivation produced, it is not this circuit's clock. Real BBD delays run from about 5 kHz at
 * their longest setting to 100 kHz at their shortest, so this floor is far below any working
 * pedal and rejects only derivations that are physically impossible.
 *
 * Measured across the corpus when this was added: `electro-harmonix-deluxe-memory-man` derives
 * 17.0 kHz and `mxr-carbon-copy` 6.1 kHz, both comfortably clear, while
 * `electro-harmonix-deluxe-memory-man-eh7550` derived **97 Hz** -- a 48 Hz Nyquist -- from a
 * `C_DELAY` placeholder in a packet whose own `schematics/` and `sources/` are empty. That
 * derivation then silently overrode the 125 ms the packet itself declares.
 *
 * Refusing here rather than clamping: a clamped delay would still be a fabricated number, and
 * the caller's fallback to the declared `DelayMs` is now reported as declared rather than
 * passed off as derived.
 */
const MIN_PLAUSIBLE_CLOCK_HZ = 2000;

/** A derivation whose implied clock cannot carry audio is not a clock reading. */
function implausibleClock(fClockHz: number, stages: number): string | null {
	if (!Number.isFinite(fClockHz) || fClockHz <= 0) {
		return `derived clock frequency is ${fClockHz}, which is not a frequency`;
	}
	if (fClockHz >= MIN_PLAUSIBLE_CLOCK_HZ) {
		return null;
	}
	return (
		`derived clock is ${fClockHz.toFixed(1)} Hz, so this ${stages}-stage brigade would sample ` +
		`audio at a ${(fClockHz / 2).toFixed(1)} Hz Nyquist limit and cannot carry any of it; ` +
		`a working BBD delay clocks between about 5 kHz and 100 kHz`
	);
}

export function deriveBbdDelayFromNetlist(
	bbdDevice: Device,
	netlist: Netlist,
	stages: number,
	registry: PartRegistry,
): BbdClockDerivationOutcome {
	const clockDev = findClockDriverDevice(netlist);
	if (!clockDev) {
		// No dedicated CD4047/MN310x. Before reporting that nothing clocks this brigade -- which
		// on two corpus packets is simply false -- look for a logic part on its clock pins.
		const gate = findGateClockSource(bbdDevice, netlist);
		if (gate === null) {
			return { outcome: "no-clock-driver" };
		}
		const chain = gateOscillatorChain(gate, netlist);
		const timing = gateOscillatorSignalNodes(gate, netlist);
		const steering = activeDevicesOn(
			timing,
			netlist,
			new Set([...chain.map((d) => d.id), bbdDevice.id]),
			true,
			gateOscillatorSupplyNodes(gate, netlist),
		);
		if (steering.length > 0) {
			return {
				outcome: "refused",
				reason:
					`clock is generated by ${gate.id} (${gate.identity.partNumber ?? "logic part"}) ` +
					`and its network is steered by ${steering.join(", ")}, so this clock is ` +
					`modulated and its delay is not a single number. Needs the signal-rate ` +
					`modulation port (see ` +
					`thoughts/shared/plans/2026-08-29-bbd-modulated-delay-architecture.md, M3)`,
			};
		}
		// Passive gate oscillator. **Deliberately not derived**: a ring oscillator, a Schmitt
		// relaxation oscillator and a divided master clock have three different formulas, and
		// this repository has no corpus case to check any of them against -- every gate-clocked
		// brigade it holds is swept, and refused above. Inventing one here would be the guess
		// M1 exists to avoid.
		return {
			outcome: "refused",
			reason:
				`clock is generated by ${gate.id} (${gate.identity.partNumber ?? "logic part"}), ` +
				`a logic oscillator with no registered frequency formula; only CD4047 and ` +
				`MN3101/MN3102 timing networks are reducible today`,
		};
	}

	const clockFamily = identifyClockFamily(clockDev);

	// **Before any R·C arithmetic: is this oscillator even timed by R and C?**
	//
	// Placed here, ahead of both family branches, because the alternative is worse in two
	// different ways and the corpus shows both. Downstream of the missing-component refusals,
	// `boss-ce-2` and `boss-ch-1` report "No timing resistor/pot found strictly across
	// oscillator pins", which reads as a capture defect and sends a reader to add a resistor to
	// a correct `.vdsp` -- their timing resistance is a transistor, by design. And downstream of
	// the success path, `boss-ce-5` **derives 19.97 ms at 25.6 kHz from `R31`/`C21`+`C22` while
	// `Q8`'s emitter sits directly on oscillator node 42**, which is a plausible number for a
	// circuit whose frequency that arithmetic does not describe. A wrong number carrying a
	// `derived` provenance is more dangerous than a refusal, because every consumer downstream
	// is entitled to trust it.
	const modulated = modulatedClockRefusal(clockDev, netlist, registry);
	if (modulated !== null) {
		return { outcome: "refused", reason: modulated };
	}

	// 1. CD4047 Family
	if (clockFamily === "CD4047") {
		const { pin1_C, pin2_R, pin3_RC } = resolveCd4047Pins(clockDev);
		if (pin1_C === null || pin2_R === null || pin3_RC === null) {
			return {
				outcome: "refused",
				reason: "CD4047 timing terminals (pins 1, 2, 3) could not be resolved",
			};
		}

		if (pin1_C === pin2_R && pin2_R === pin3_RC) {
			return {
				outcome: "refused",
				reason: `CD4047 pins 1, 2, 3 shorted together to node ${pin1_C}`,
			};
		}

		if (pin1_C === GROUND && pin3_RC === GROUND) {
			return {
				outcome: "refused",
				reason: "CD4047 pin 1 (C) and pin 3 (RC common) both grounded; no timing capacitor",
			};
		}

		// Find timing resistors strictly across pin 2 (R) and pin 3 (RC common)
		let rCandidates: Device[] = [];
		let isSeries = false;
		for (const d of netlist.devices) {
			if (d.kind !== "resistor" && d.kind !== "potentiometer" && d.kind !== "rheostat") continue;
			const touches2 = d.nodes.includes(pin2_R);
			const touches3 = d.nodes.includes(pin3_RC);
			if (touches2 && touches3) {
				rCandidates.push(d);
			}
		}

		if (rCandidates.length === 0) {
			// Check for two-device series chain: pin2_R <-> mid <-> pin3_RC
			const pin2Devices = netlist.devices.filter((d) => {
				if (d.kind !== "resistor" && d.kind !== "potentiometer" && d.kind !== "rheostat") return false;
				return d.nodes.includes(pin2_R) && !d.nodes.includes(pin3_RC);
			});
			for (const d1 of pin2Devices) {
				const midNodes = d1.nodes.filter((n) => n !== pin2_R && n !== GROUND);
				for (const mid of midNodes) {
					const midDevices = netlist.devices.filter((d) => {
						if (d === d1) return false;
						if (d.kind !== "resistor" && d.kind !== "potentiometer" && d.kind !== "rheostat") return false;
						return d.nodes.includes(mid) && d.nodes.includes(pin3_RC);
					});
					if (midDevices.length === 1) {
						rCandidates = [d1, midDevices[0]!];
						isSeries = true;
						break;
					}
				}
				if (isSeries) break;
			}
		}

		// Find timing capacitors strictly across pin 1 (C) and pin 3 (RC common)
		const cCandidates: Device[] = [];
		for (const d of netlist.devices) {
			if (d.kind !== "capacitor") continue;
			const touches1 = d.nodes.includes(pin1_C);
			const touches3 = d.nodes.includes(pin3_RC);
			if (touches1 && touches3) {
				cCandidates.push(d);
			}
		}

		if (rCandidates.length === 0) {
			return {
				outcome: "refused",
				reason: `No timing resistor/pot found strictly across CD4047 pins 2 (node ${pin2_R}) and 3 (node ${pin3_RC})`,
			};
		}
		if (cCandidates.length === 0) {
			return {
				outcome: "refused",
				reason: `No timing capacitor found strictly across CD4047 pins 1 (node ${pin1_C}) and 3 (node ${pin3_RC})`,
			};
		}

		const { rOhms, ohmsAtControlMin, ohmsAtControlMax, controlId, taper } =
			resolveTimingResistanceNetwork(rCandidates, netlist, isSeries);
		const cFarads = cCandidates.reduce((acc, c) => acc + (c.parameters.farads ?? 0), 0);

		if (rOhms <= 0) {
			return {
				outcome: "refused",
				reason: "Resolved timing resistance is <= 0 ohms",
			};
		}
		if (cFarads <= 0) {
			return {
				outcome: "refused",
				reason: "Resolved timing capacitance is <= 0 farads",
			};
		}

		// CD4047: f_clock = 1 / (4.40 * R * C) (TI CD4047B SCHS044C)
		const formulaConstant = 2.2;
		const fClockHz = 1 / (4.4 * rOhms * cFarads);
		const delaySeconds = stages * formulaConstant * rOhms * cFarads;

		const implausible = implausibleClock(fClockHz, stages);
		if (implausible !== null) {
			return { outcome: "refused", reason: implausible };
		}

		return {
			outcome: "derived",
			delaySeconds,
			rOhms,
			cFarads,
			fClockHz,
			family: "CD4047",
			stages,
			formulaConstant,
			controlId,
			taper,
			ohmsAtControlMin,
			ohmsAtControlMax,
		};
	}

	// 2. MN3101 / MN3102 Family
	if (clockFamily === "MN3101" || clockFamily === "MN3102") {
		const { oxNodes, ox1, ox2, ox3 } = resolveMn310xPins(clockDev, registry);
		if (oxNodes.length === 0) {
			// Name the roles it actually declared. "Found 0 ox pins" reads as "the pins are
			// unconnected", and on `boss-bf-2` that is the wrong diagnosis: its MN3102 spells the
			// oscillator pins `oscillatorinput`/`oscillatoroutput`/`clockcontrol`, which the
			// registry entry does not carry as aliases for `ox1`/`ox2`/`ox3` -- so they were never
			// looked at, connected or not. Whether the fix is a registry alias or a re-capture is
			// the reader's call, and they cannot make it without seeing the spellings.
			const declared = (clockDev.identity.terminalRoles ?? [])
				.filter((r): r is string => r !== null)
				.join(", ");
			return {
				outcome: "refused",
				reason:
					`${clockFamily} oscillator pins not resolved: no terminal of ${clockDev.id} ` +
					`matched ox1/ox2/ox3 or a registered alias. It declares [${declared}]`,
			};
		}

		// **The oscillator is a star, not a bridge.** MN3101 datasheet p.3, "Example of Oscillation
		// Generation Circuit": R1 hangs off OX1, R2 off OX2 and C1 off OX3, and all three return to
		// one common node. The text under it is explicit about which two set the rate -- "oscillation
		// frequency is defined by the time constant of C1 and R2" -- so R1 is not a timing element.
		//
		// The previous model looked for an R and a C each bridging two OX pins directly. Nothing in
		// the datasheet circuit does that, so a correctly captured MN3101 refused and only a
		// mis-captured one derived: `boss-dm-2` produced 0..341 ms against its printed 20..300 ms
		// spec from a capture that had C39 strung between the two oscillator pins.
		if (ox2 === null || ox3 === null) {
			const declared = (clockDev.identity.terminalRoles ?? [])
				.filter((r): r is string => r !== null)
				.join(", ");
			return {
				outcome: "refused",
				reason:
					`${clockFamily} oscillator legs not named: the star needs OX2 (timing R) and OX3 ` +
					`(timing C) told apart, and ${clockDev.id} resolved ` +
					`ox2=${ox2 ?? "none"} ox3=${ox3 ?? "none"} from [${declared}]`,
			};
		}

		// C1: the capacitor from OX3 to the common node. Its far end *is* the common node -- that is
		// how the common node is found, rather than by assuming a name for it.
		const cCandidates = netlist.devices.filter(
			(d) =>
				d.kind === "capacitor" &&
				(d.parameters.farads ?? 0) > 0 &&
				(d.parameters.farads ?? 0) < 1e-6 &&
				d.nodes.length === 2 &&
				d.nodes.includes(ox3) &&
				!d.nodes.every((n) => n === ox3),
		);
		if (cCandidates.length === 0) {
			return {
				outcome: "refused",
				reason: `No timing capacitor (<1µF) found on the ${clockFamily} OX3 pin (node ${ox3})`,
			};
		}
		const commonNodes = new Set(
			cCandidates.map((c) => c.nodes.find((n) => n !== ox3) as NodeId),
		);
		if (commonNodes.size > 1) {
			return {
				outcome: "refused",
				reason:
					`Ambiguous ${clockFamily} oscillator common node: the capacitors on OX3 return to ` +
					`nodes [${Array.from(commonNodes).join(", ")}], so there is no single RC junction`,
			};
		}
		const commonNode = Array.from(commonNodes)[0]!;
		const cFarads = cCandidates.reduce((acc, c) => acc + (c.parameters.farads ?? 0), 0);

		// R2: whatever a meter would read from OX2 to that common node. OX3 is blocked so the
		// capacitor's own pin cannot be walked through, and OX1 is blocked so the MN3101's R1 is
		// not counted as timing resistance.
		//
		// **Except when OX1 *is* the common node.** The two parts differ here and the MN3102 data
		// sheet (p.3, "Example of Oscillation Circuit") draws it plainly: the MN3101 has three legs
		// and R1 sits on OX1, while the MN3102 has two and OX1 wires straight to the common rail
		// with no R1 at all. Blocking OX1 unconditionally therefore blocked the common node itself
		// on every MN3102, and `boss-dm-3` refused for "no resistive path" when its capture already
		// had the data sheet's own circuit.
		const resistive = netlist.devices.filter(
			(d) => TIMING_RESISTANCE_KINDS.has(d.kind),
		);
		const blocked = new Set<NodeId>([ox3]);
		if (ox1 !== null && ox1 !== commonNode) blocked.add(ox1);

		const primary = primaryTimingControl(
			resistive.filter((d) => d.control !== null && !d.nodes.some((n) => blocked.has(n))),
			netlist,
		);
		// Where a control that is *not* being swept sits. A factory trimmer on the timing network
		// moves the answer as much as the panel knob does, and holding it at mid-scale when the
		// document says where it is set is a silent guess. `boss-dm-2`'s VR3 is the case in point:
		// it is a 1M clock trim in series with R47 and the whole branch is in parallel with the
		// Repeat Rate branch, so mid-scale versus its real setting is the difference between a
		// 387 ms and a 301 ms maximum.
		const defaultPositionByControl = new Map<ControlId, number>();
		for (const ctrl of netlist.controls ?? []) {
			defaultPositionByControl.set(ctrl.id, ctrl.defaultPosition);
		}
		const heldPosition = (d: Device): number =>
			(d.control !== null ? defaultPositionByControl.get(d.control) : undefined) ?? 0.5;

		const ohmsAtPosition =
			(position: number) =>
			(d: Device): { upper: number; lower: number } => {
				const held = d === primary.device ? position : heldPosition(d);
				if (d.kind === "resistor") {
					const ohms = d.parameters.ohms ?? 0;
					return { upper: ohms, lower: ohms };
				}
				if (d.kind === "rheostat") {
					const minOhms = d.parameters.minOhms ?? 0;
					const maxOhms = d.parameters.maxOhms ?? 0;
					const ohms = minOhms + (maxOhms - minOhms) * held;
					return { upper: ohms, lower: ohms };
				}
				const total = d.parameters.ohms ?? 0;
				// Same split as the pot stamp in `lower.ts`: `upper` is end1..wiper and carries
				// `1 - fraction`, `lower` is wiper..end2 and carries `fraction`.
				return { upper: total * (1 - held), lower: total * held };
			};

		const rAt = (position: number): number | null =>
			resistanceBetween(
				resistive,
				ox2,
				commonNode,
				blocked,
				ohmsAtPosition(position),
			);

		const rOhms = rAt(0.5);
		if (rOhms === null) {
			return {
				outcome: "refused",
				reason:
					`No resistive path from the ${clockFamily} OX2 pin (node ${ox2}) to the ` +
					`oscillator's common RC node (node ${commonNode}), so the timing resistance ` +
					`cannot be read off the circuit`,
			};
		}

		const rEnd0 = rAt(0);
		const rEnd1 = rAt(1);
		const controlId = primary.controlId;
		const taper = primary.taper;
		const ohmsAtControlMin =
			controlId !== null && rEnd0 !== null && rEnd1 !== null
				? Math.min(rEnd0, rEnd1)
				: rOhms;
		const ohmsAtControlMax =
			controlId !== null && rEnd0 !== null && rEnd1 !== null
				? Math.max(rEnd0, rEnd1)
				: rOhms;

		if (rOhms <= 0) {
			return {
				outcome: "refused",
				reason: "Resolved timing resistance is <= 0 ohms",
			};
		}
		if (cFarads <= 0) {
			return {
				outcome: "refused",
				reason: "Resolved timing capacitance is <= 0 farads",
			};
		}

		// MN3101 / MN3102: f_clock = 1 / (5.0 * R * C)
		const formulaConstant = 2.5;
		const fClockHz = 1 / (5.0 * rOhms * cFarads);
		const delaySeconds = stages * formulaConstant * rOhms * cFarads;

		const implausible = implausibleClock(fClockHz, stages);
		if (implausible !== null) {
			return { outcome: "refused", reason: implausible };
		}

		return {
			outcome: "derived",
			delaySeconds,
			rOhms,
			cFarads,
			fClockHz,
			family: clockFamily,
			stages,
			formulaConstant,
			controlId,
			taper,
			ohmsAtControlMin,
			ohmsAtControlMax,
		};
	}

	return {
		outcome: "refused",
		reason: `Clock driver device ${clockDev.id} (${clockDev.identity.partNumber ?? "unknown"}) has unsupported clock family`,
	};
}

/**
 * Princeton Technology PT2399 delay time formula from external VCO resistance R (in Ohms).
 * Sourced from PT2399 Datasheet (Table 1 & Figure 4: VCO Frequency vs Resistance).
 */
export function pt2399DelayFromOhms(rOhms: number): number {
	if (rOhms <= 500) return 0.0313;
	if (rOhms <= 1000) return 0.0313 + ((rOhms - 500) * (0.0344 - 0.0313)) / 500;
	if (rOhms <= 2000) return 0.0344 + ((rOhms - 1000) * (0.04 - 0.0344)) / 1000;
	if (rOhms <= 5000) return 0.04 + ((rOhms - 2000) * (0.05 - 0.04)) / 3000;
	if (rOhms <= 10000) return 0.05 + ((rOhms - 5000) * (0.08 - 0.05)) / 5000;
	return 0.08 + (0.006355 * (rOhms - 10000)) / 1000;
}

/**
 * Derives delaySeconds and dynamic control mapping for PT2399 digital delay chips
 * by tracing the series resistor/potentiometer network connected to VCO Pin 6.
 */
export function derivePt2399DelayFromNetlist(
	device: Device,
	netlist: Netlist,
): BbdClockDerivationOutcome {
	// Find VCO node (pin 6 / role in PT2399_VCO_ROLES)
	let vcoNode: NodeId | null = null;
	for (let i = 0; i < device.identity.terminalRoles.length; i++) {
		const role = foldToken(device.identity.terminalRoles[i] ?? "");
		if (PT2399_VCO_ROLES.has(role)) {
			vcoNode = device.nodes[i] ?? null;
			break;
		}
	}
	if (vcoNode === null && device.nodes.length >= 6) {
		vcoNode = device.nodes[5] ?? null;
	}

	if (vcoNode === null || vcoNode === GROUND) {
		return {
			outcome: "refused",
			reason: "PT2399 VCO pin 6 is unconnected or grounded",
		};
	}

	// Trace series path of resistors/pots from vcoNode to GROUND
	const visitedNodes = new Set<NodeId>([vcoNode]);
	const pathDevices: Device[] = [];

	let currentNode: NodeId = vcoNode;
	while (currentNode !== GROUND) {
		const connecting = netlist.devices.filter(
			(d) =>
				d.id !== device.id &&
				!pathDevices.includes(d) &&
				TIMING_RESISTANCE_KINDS.has(d.kind) &&
				d.nodes.includes(currentNode),
		);

		if (connecting.length !== 1) {
			break;
		}

		const nextDev = connecting[0]!;
		pathDevices.push(nextDev);

		const otherNodes = nextDev.nodes.filter(
			(n) => n !== currentNode && !visitedNodes.has(n),
		);
		if (otherNodes.length === 0) {
			if (nextDev.nodes.includes(GROUND)) {
				currentNode = GROUND;
			}
			break;
		}
		currentNode = otherNodes[0]!;
		visitedNodes.add(currentNode);
	}

	if (currentNode !== GROUND || pathDevices.length === 0) {
		return {
			outcome: "refused",
			reason: "PT2399 VCO pin 6 timing network does not form a closed path to ground",
		};
	}

	const timingR = resolveTimingResistanceNetwork(pathDevices, netlist, true);
	if (timingR.rOhms <= 0) {
		return {
			outcome: "refused",
			reason: "Resolved PT2399 VCO timing resistance is <= 0 ohms",
		};
	}

	const delaySeconds = pt2399DelayFromOhms(timingR.rOhms);
	const fClockHz = 1 / (delaySeconds / 2048);

	return {
		outcome: "derived",
		delaySeconds,
		rOhms: timingR.rOhms,
		cFarads: 1,
		fClockHz,
		family: "unknown",
		stages: 1,
		formulaConstant: delaySeconds / timingR.rOhms,
		controlId: timingR.controlId,
		taper: timingR.taper,
		ohmsAtControlMin: timingR.ohmsAtControlMin,
		ohmsAtControlMax: timingR.ohmsAtControlMax,
	};
}

/**
 * Derives delaySeconds and dynamic control mapping for Mitsubishi M50195P digital echo LSI
 * by tracing the inverter oscillator timing network connected to CLK1.
 */
export function deriveM50195DelayFromNetlist(
	device: Device,
	netlist: Netlist,
): BbdClockDerivationOutcome {
	let clkNode: NodeId | null = null;
	for (let i = 0; i < device.identity.terminalRoles.length; i++) {
		const role = foldToken(device.identity.terminalRoles[i] ?? "");
		if (role === "clk1" || role === "clk" || role === "clock") {
			clkNode = device.nodes[i] ?? null;
			break;
		}
	}

	if (clkNode === null || clkNode === GROUND) {
		return {
			outcome: "refused",
			reason: "M50195P CLK1 pin is unconnected or grounded",
		};
	}

	const invNodes = new Set<NodeId>([clkNode]);
	for (const d of netlist.devices) {
		if (d.kind === "ic" && d.nodes.includes(clkNode)) {
			const part = foldToken(d.identity.partNumber ?? "");
			if (INVERTER_OSCILLATOR_PART_IDS.has(part)) {
				for (const n of d.nodes) {
					if (n !== GROUND) invNodes.add(n);
				}
			}
		}
	}

	const rCandidates = netlist.devices.filter(
		(d) =>
			TIMING_RESISTANCE_KINDS.has(d.kind) &&
			d.nodes.some((n) => invNodes.has(n)),
	);

	const timingDevices = rCandidates.filter(
		(d) =>
			d.nodes.filter((n) => invNodes.has(n)).length >= 2 ||
			d.nodes.includes(clkNode) ||
			(d.kind === "potentiometer" && d.nodes.some((n) => invNodes.has(n))),
	);

	const timingR = resolveTimingResistanceNetwork(timingDevices, netlist, true);
	if (timingR.rOhms <= 0) {
		return {
			outcome: "refused",
			reason: "Resolved M50195P timing resistance is <= 0 ohms",
		};
	}

	const rMax = timingR.ohmsAtControlMax > 0 ? timingR.ohmsAtControlMax : 780000;
	const delaySeconds = Math.max(0.03, Math.min(0.4, (timingR.rOhms / rMax) * 0.4));
	const fClockHz = 1 / (delaySeconds / 2048);

	return {
		outcome: "derived",
		delaySeconds,
		rOhms: timingR.rOhms,
		cFarads: 5e-12,
		fClockHz,
		family: "unknown",
		stages: 2048,
		// **Scaled into the runtime's units, not left as delay-per-ohm.** `clockControl` is
		// consumed as `delay = stages * formulaConstant * R * farads`, so a constant that
		// already folds in `stages` and `C` gets them applied a second time. This path
		// declared physical `stages: 2048` and `cFarads: 5e-12` beside a `delaySeconds / R`
		// constant, which multiplied every delay by 2048 * 5e-12 = 1.024e-8: `ibanez-dl5`
		// declared 350 ms and rendered about 3 ns, a delay pedal with no delay. The PT2399
		// path above is correct only because its neutral `stages: 1` / `cFarads: 1` make the
		// two conventions coincide.
		formulaConstant:
			delaySeconds / (2048 * timingR.rOhms * 5e-12),
		controlId: timingR.controlId,
		taper: timingR.taper,
		ohmsAtControlMin: timingR.ohmsAtControlMin,
		ohmsAtControlMax: timingR.ohmsAtControlMax,
	};
}
