// Stage 3: attach each device's constitutive relation.
//
// Three outcomes, and the third is a product decision rather than a technical one:
//
//   Law          lumped, stamped into the matrix and solved
//   MacroModel   not solvable as lumped elements; a DSP algorithm with ports
//   Unsupported  no model available -> the whole pedal/amp does not compile
//
// Decision (Joseph, 2026-08-10): an unknown chip makes the pedal unsupported. Not an
// open circuit, not a pass-through. So there is no partially-modelled circuit and no
// fabricated port assignment anywhere in the design -- and consequently a reason
// string is a required output here, not a nicety.
//
// A pot's law is R_total split by f(x), where x is the 0..1 control position. This file
// decides *which* taper f is; it deliberately cannot evaluate one. Per decision 2, f is
// carried into the program and applied by whoever runs it, so the curve itself lives in
// `src/runtime/taper.ts` and no stage here can fold it into a coefficient by accident.

import {
	identify,
	mayCarryRegistrySections,
	opampPartRegisteredAsOtherLaw,
	requiresIdentification,
} from "./identify";
import { isMultiDeviceTransistorShell } from "./unreadable-terminal-role";
import {
	deriveBbdDelayFromNetlist,
	resolveClockModulationSource,
	derivePt2399DelayFromNetlist,
	deriveM50195DelayFromNetlist,
} from "./bbd-clock";
import {
	foldPartId,
	foldToken,
	type MacroBarePinPositions,
	type MacroPartModel,
	type PartRegistry,
	type PartSection,
	pinoutMatches,
	registryEntryFor,
	registryLawFor,
	registryModelFor,
	terminalWithRole,
	withRecordedReads,
} from "./registry";
import type {
	ControlId,
	Device,
	DeviceLaw,
	DeviceResolution,
	ElectricallyIsolatedIcWarning,
	IcNotExecutedWarning,
	LawedNetlist,
	OpenIcReason,
	UnimplementedDeviceLawWarning,
	MacroClockControl,
	Netlist,
	NodeId,
	TaperKind,
} from "./types";

/** Room-temperature thermal voltage; the diode law needs a reference somewhere. */
export const THERMAL_VOLTAGE = 0.025_852;

/**
 * Closed and open switch resistances. Not arbitrary: the ratio sets the matrix
 * condition number, so 1e-2 to 1e9 is chosen to be electrically indistinguishable
 * from ideal at audio levels while staying far from the solver's precision limit.
 */
export const SWITCH_ON_OHMS = 1e-2;

/**
 * The terminal a jack's switch contact makes against, and the terminal a supply calls
 * its return. Closed sets, compared whole.
 *
 * There is deliberately **no set of contact role names**. The corpus names switch
 * contacts eleven ways (`batterySwitch`, `switch`, `switched`, `contact_top`,
 * `normalSwitch`, `switch_black`, ...) and they do not share a sense: a battery contact
 * makes against the sleeve, a `switched_tip` makes against the tip, and a `normalSwitch`
 * on a stereo output *breaks* when a plug goes in. A name table gets the sense wrong on
 * two of those three, and closing a signal contact to the sleeve shorts it to ground.
 * See `portEngage` for what is derived instead.
 */
/**
 * Series impedance of a pedal supply, in ohms: the **default position of what belongs to a
 * user-selectable power profile**, not a physical claim about one cell.
 *
 * Decided by Joseph, 2026-08-13: source impedance is an *input profile on the UI*, alongside the
 * other things a player chooses about how a pedal is fed. A fresh alkaline, a sagging one and a
 * regulated adapter are three profiles a user picks between, so this stage does not have to guess
 * which the packet meant — a question that has no answer, since a schematic draws a 9 V battery
 * symbol and internal resistance is a property of the cell rather than of the drawing.
 *
 * Until that control exists, this is the default, and it is the low end of the plausible range so
 * the default errs toward the ideal behaviour it replaces: a fresh 9 V alkaline measures 1-2 ohms,
 * a depleted one tens, an adapter well under one. Measured, one ohm moves a working pedal's rail by
 * about 10 mV — `boss-bd-2-blues-driver` by `9.9 mV`, `boss-ge-7` by `19 mV` — and the corpus's
 * ngspice agreement is unchanged at 31.
 *
 * **What zero cost.** Zero is the one value known to be wrong, since no real supply has it, and it
 * let a supply deliver unbounded current: `ibanez-ts808` drew **193 A** through the short
 * `diode-forward-across-supply` warns about and still rendered a plausible gain of 0.506. One ohm
 * collapses that rail instead, which is also what let the diode's `limitJunction` land after two
 * reverts.
 *
 * **Not a battery model.** It does not deplete and it does not tell an adapter from a cell. Both
 * are the profile's job once it exists; this is the mechanism and one defensible default.
 */
export const SUPPLY_SOURCE_OHMS = 1;

/**
 * What a bipolar transistor is when the packet does not say, and why the default is silicon.
 *
 * Only 10% of the corpus's 385 transistors declare `IS`, so most still land here, and a
 * small-signal silicon junction is the right assumption for an undated schematic. It is
 * emphatically **not** right for the ones that do declare it: germanium sits five orders of
 * magnitude away at around `1e-9`, which is 0.29 V of base-emitter bias, and those packets
 * now get what they declare.
 *
 * Nothing infers germanium from a part number. `PartNumber` is present on 97% of them and
 * reading `OC41` as germanium would be prose matching; `Type` and `IS` are the evidence.
 */
/**
 * Open-loop gain for an op-amp that does not state one, dimensionless.
 *
 * A generic small-signal figure. 21 of the corpus's op-amps declare exactly this and 31 declare
 * otherwise, so it is a fallback rather than a description of anything.
 */
const DEFAULT_OPEN_LOOP_GAIN = 1e5;

/**
 * The factor an `ac-source` law multiplies a declared magnitude by, converting the project's
 * RMS convention to the peak amplitude the sine evaluation needs. See the `ac-source` branch
 * of `voltage-source`'s law below for the full reasoning and the escape hatch.
 */
const AC_SOURCE_RMS_TO_PEAK = Math.SQRT2;

// Exported so `report-part-store-drift.ts` can check this one shared fallback against a
// representative registry part instead of quoting a second copy of the numbers that could drift
// from this one silently -- the exact failure mode that script exists to catch.
export const SILICON_SATURATION_CURRENT = 1e-14;
export const SILICON_FORWARD_BETA = 100;
/**
 * A winding's DC resistance, in the three states the source can be in.
 *
 * **Absent is not zero.** Every real winding has copper resistance, so zero is physically
 * impossible rather than merely unusual -- and a lossless inductor in a feedback loop has unbounded
 * Q, which is how a marginally stable real amplifier becomes an unstable simulated one. Defaulting
 * absence to zero would preserve every current number and leave all 67 corpus windings quietly
 * wrong, which is exactly how this arrived: until 2026-09-09 the law had no parameter at all, so
 * `.vdsp` had nowhere to put a value and 29 packets were lossless by construction rather than by
 * omission.
 *
 * So there is **no default**. A packet states a number, or states `unknown` when the drawing does
 * not print it -- Fender sheets give turns ratios and impedances, never copper resistance -- and
 * `unknown` is a first-class machine-readable claim rather than an omission indistinguishable from
 * an oversight. Silence produces neither, and a caller can tell the three apart.
 */
function windingResistance(device: {
	readonly parameters: Readonly<Record<string, unknown>>;
}): { readonly seriesResistanceOhms?: number | "unknown" } {
	const declared = device.parameters.windingResistanceOhms;
	if (typeof declared === "number" && Number.isFinite(declared) && declared > 0) {
		return { seriesResistanceOhms: declared };
	}
	if (device.parameters.windingResistanceUnknown === 1) {
		return { seriesResistanceOhms: "unknown" };
	}
	return {};
}

const FERRITE_BEAD_DEFAULT_HENRIES = 10e-6;

/**
 * The roles a jack uses for the terminal current returns through.
 *
 * **This replaced a name vocabulary that carried `cathode`**, because the `.schx` conversion
 * named every two-terminal component after a diode: 265 corpus jacks called their sleeve
 * `cathode` and their tip `anode`. 249 now declare `sleeve`/`tip`, decided by which terminal
 * sits on ground rather than by what it is called; the 16 that were ambiguous -- both live,
 * both grounded, or the pair reversed -- declare nothing and reach no port-engage law.
 *
 * The name path is gone rather than kept as a fallback, and that is measured: emptying it
 * leaves all 21 port-engage laws standing and every one of the 142 corpus programs
 * byte-identical.
 */
const portReturnRoles: ReadonlySet<string> = new Set([
	"sleeve",
	"ground",
	"negative",
]);

/** The index of a jack's declared return terminal, or -1 when it declares none. */
function portReturnIndex(device: Device): number {
	return device.identity.declaredTerminalRoles.findIndex(
		(role) => role !== null && portReturnRoles.has(role),
	);
}
/** How a supply names the terminal current comes back to. */
export const SWITCH_OFF_OHMS = 1e9;

function buildNodeToVoltageMap(
	netlist: Netlist,
	regulated: ReadonlyArray<{ readonly node: NodeId; readonly volts: number }>,
): Map<NodeId, number> {
	const map = new Map<NodeId, number>();
	map.set(0, 0); // Ground is always 0V
	// A registered regulator's output node states a voltage the document never writes down.
	// Set first so a document that *does* declare the node keeps the last word. See
	// `registrySuppliedVoltages`.
	for (const supply of regulated) {
		map.set(supply.node, supply.volts);
	}

	for (const device of netlist.devices) {
		const volts = device.parameters.volts;
		if (volts === undefined || !Number.isFinite(volts)) {
			continue;
		}

		if (device.kind === "rail") {
			if (device.parameters.frequency !== undefined) {
				continue;
			}
			const node = device.nodes[0];
			if (node !== undefined) {
				map.set(node, volts);
			}
		} else if (device.kind === "voltage-source") {
			if (device.parameters.frequency !== undefined) {
				continue;
			}
			// The driven end by declared role, the same field and the same value `lower.ts`'s
			// `supplyTerminals` reads -- stage 3 and stage 5 must agree about which end of a
			// supply is positive or they assert the rail at different nodes.
			device.identity.declaredTerminalRoles.forEach((role, index) => {
				if (role === "positive") {
					const node = device.nodes[index];
					if (node !== undefined) {
						map.set(node, volts);
					}
				}
			});
		} else if (device.kind === "ic") {
			const outNode = findNodeWithRole(device, "out");
			if (outNode !== undefined) {
				map.set(outNode, volts);
			}
		}
	}
	return map;
}

function findNodeWithRole(device: Device, role: string): NodeId | undefined {
	const index = device.identity.terminalRoles.indexOf(role);
	return index !== -1 ? device.nodes[index] : undefined;
}

/**
 * Role tokens that can only ever name a supply pin, folded as `terminalRoleToken` leaves them.
 *
 * No op-amp calls a signal input `vcc` or `negativesupply`, so these are read unconditionally.
 * `vccpin8`/`veepin4` are the numbered spellings: pins 8 and 4 of a single op-amp in an 8-pin
 * package are its rails, and `terminalRoleToken` strips a leading `pinN` but not a trailing one.
 */
const unambiguousSupplyRoles: ReadonlyMap<string, "high" | "low"> = new Map([
	["vcc", "high"],
	["vccpin8", "high"],
	["positivesupply", "high"],
	["vdd", "high"],
	["vee", "low"],
	["veepin4", "low"],
	["negativesupply", "low"],
	["vss", "low"],
]);

/**
 * Role tokens that name a supply pin **on a part that separately names its inputs**, and could
 * otherwise be an input.
 *
 * This distinction is the whole reason this is two maps rather than one. A census of all 294
 * op-amp-shaped components in the corpus found `vplus`/`vminus` used as **rails** in every one
 * of the 60 devices that declare them -- always beside a named input pair (`inverting` /
 * `noninverting`, or `positive` / `negative`), never instead of one. So they are supplies here.
 *
 * But `vplus`/`vminus` is also the natural spelling for a bare differential pair, and
 * `lower.ts`'s `opampTerminals` falls back to *declaration order* when it cannot resolve a named
 * input pair -- so on a three-terminal `vplus, vminus, output` op-amp it wires those two as the
 * inputs. Reading them as rails as well would clamp that op-amp to its own input voltages. The
 * guard below is therefore not a corpus statistic, it is the invariant: **a terminal cannot be
 * both a signal input and a rail**, so these spellings are read as rails only when the part
 * states its inputs some other way.
 */
const supplyRolesNeedingNamedInputs: ReadonlyMap<string, "high" | "low"> = new Map([
	["vplus", "high"],
	["vpluspin8", "high"],
	["v+", "high"],
	["vminus", "low"],
	["vminuspin4", "low"],
	// Folded from `v-` by `terminalRoleToken`'s separator strip. `boss-ce-2` names its
	// supply pair `V+`/`V-`, which `netlist.ts`'s own supply census also records.
	["v", "low"],
]);

/** Input-naming roles that are never a supply, so finding one proves the inputs are stated. */
const namedInputRoles: ReadonlySet<string> = new Set([
	"positive",
	"negative",
	"noninverting",
	"inverting",
	"noninvertinginput",
	"invertinginput",
	"inputplus",
	"inputminus",
	"vin+",
	"vin",
	"in+",
	"in",
	"noninvertinga",
	"invertinga",
	"noninvertingb",
	"invertingb",
]);

/**
 * The rails this op-amp is powered by: its own supply terminals when it declares any, else the
 * circuit's supply set.
 *
 * Before this, only the exact spellings `vcc` and `vee` were read; every other spelling fell
 * through to the circuit-wide supply extremes -- the *widest* pair in the document -- so an
 * op-amp on a regulated rail inside a pedal with a higher raw inlet was given a clipping ceiling
 * it does not have. A fallback is the right behaviour for an op-amp that states no supply at
 * all; it is a wrong answer that still renders for one that states it under another name.
 *
 * **One measured basis, to keep the numbers here comparable.** Censusing every lowered
 * `ideal-opamp` stamp before and after this change: of **251** stamps, **4** get different
 * rails -- both op-amps in `boss-bd-2-blues-driver` and its Keeley variant, `railHigh` 9 -> 8,
 * which is correct because that pedal declares three supply ports (9 V, 8 V, 4 V) and both
 * op-amps' `vPlus` is on the 8 V one. Many more op-amps *declare* a non-`vcc` spelling, but
 * on a node whose voltage already equals a circuit extreme, so the old lookup returned the
 * right answer for the wrong reason. Counting declarations rather than changed rails
 * overstates this fix by an order of magnitude; the 4 is the number that means anything.
 */
function opampRails(
	device: Device,
	rails: { readonly high: number | null; readonly low: number | null },
	nodeToVoltage: ReadonlyMap<NodeId, number>,
): { readonly high: number | null; readonly low: number | null } {
	const roles = device.identity.terminalRoles;
	const statesItsInputs = roles.some(
		(role) => role !== null && namedInputRoles.has(role),
	);
	let high = rails.high;
	let low = rails.low;
	roles.forEach((role, index) => {
		if (role === null) {
			return;
		}
		const side =
			unambiguousSupplyRoles.get(role) ??
			(statesItsInputs ? supplyRolesNeedingNamedInputs.get(role) : undefined);
		if (side === undefined) {
			return;
		}
		const node = device.nodes[index];
		const volts = node === undefined ? undefined : nodeToVoltage.get(node);
		if (volts === undefined) {
			return;
		}
		if (side === "high") {
			high = volts;
		} else {
			low = volts;
		}
	});
	// **A rail pair must be ordered, or it is not a pair.** `railHigh <= railLow` is not a
	// narrow clamp, it is a contradiction: the op-amp's linear region has negative width and
	// its output is pinned wherever the limiter happens to land. Reading a device's own supply
	// pins can produce that from a document the old `vcc`/`vee`-only lookup never asked, so the
	// guard belongs here rather than in the caller.
	//
	// Measured on `mxr-m117r-flanger`, which is why this is not defensive programming: its `U4`
	// declares `pin8_vplus` and `pin4_vminus`, and **both resolve to the same node** -- ground,
	// carrying a declared +15 V, because the packet puts its `V15` rail component on the ground
	// node. That yielded `high = low = 15` on eight op-amp stamps. The document's own supply
	// pins are not usable evidence there, so the circuit-wide set is the better answer, and
	// falling back to it leaves those eight exactly where they were before this change.
	if (high !== null && low !== null && high <= low) {
		return rails;
	}
	return { high, low };
}

/**
 * Nodes that reach a declared voltage through one two-terminal passive
 * (diode, capacitor, resistor, inductor). Covers the LT1054 → D17 → VA-rail
 * path where the charge pump's output is a diode away from the declared rail.
 */
function buildOneHopVoltageMap(
	netlist: Netlist,
	nodeToVoltage: ReadonlyMap<NodeId, number>,
): Map<NodeId, number> {
	const map = new Map<NodeId, number>();
	for (const device of netlist.devices) {
		if (
			device.nodes.length !== 2 ||
			(device.kind !== "diode" &&
				device.kind !== "capacitor" &&
				device.kind !== "resistor" &&
				device.kind !== "inductor")
		) {
			continue;
		}
		const a = device.nodes[0];
		const b = device.nodes[1];
		if (a === undefined || b === undefined) continue;
		const va = nodeToVoltage.get(a);
		const vb = nodeToVoltage.get(b);
		if (va !== undefined && b !== 0 && vb === undefined) {
			map.set(b, va);
		} else if (vb !== undefined && a !== 0 && va === undefined) {
			map.set(a, vb);
		}
	}
	return map;
}

export function attachDeviceLaws(
	netlist: Netlist,
	registry: PartRegistry,
): LawedNetlist {
	const regulated = registrySuppliedVoltages(netlist, registry);
	const rails = supplyRails(netlist, regulated);
	const supply = supplyNodes(netlist);
	const nodeToVoltage = buildNodeToVoltageMap(netlist, regulated);
	const oneHopVoltage = buildOneHopVoltageMap(netlist, nodeToVoltage);
	const mainsFrequencyHz = mainsFrequency(netlist);
	// Stage 1 (`netlist.ts`) already resolved each control's real taper -- from the panel
	// control's own declaration, or failing that, from the first device bound to it -- onto
	// `Netlist.controls`. This stage's job is to carry that already-decided value onto the
	// law by the same control id, never to decide it again or default it.
	const taperByControl = new Map<ControlId, TaperKind>(
		netlist.controls.map((control) => [control.id, control.taper]),
	);
	// A multi-section part becomes one device per section, here and nowhere else.
	//
	// This is the only stage that knows the registry, so it is the only stage that can know a part
	// is multi-section. Expanding into ordinary devices means partitioning, lowering and the runtime
	// see nothing new -- the alternative, a fourth `DeviceResolution` outcome, would have to be
	// understood by every consumer of one.
	const devicesTouchingNode = deviceCountByNode(netlist);
	const devices: Device[] = [];
	const resolutions: DeviceResolution[] = [];
	for (const device of netlist.devices) {
		const expanded = sectionDevices(device, registry, rails, supply, nodeToVoltage);
		if (expanded === null) {
			devices.push(device);
			resolutions.push(
				resolveDevice(
					device,
					registry,
					rails,
					supply,
					taperByControl,
					mainsFrequencyHz,
					devicesTouchingNode,
					nodeToVoltage,
					oneHopVoltage,
					netlist,
				),
			);
			continue;
		}
		for (const [section, resolution] of expanded) {
			devices.push(section);
			resolutions.push(resolution);
		}
	}
	return { netlist: { ...netlist, devices }, resolutions };
}

/**
 * A multi-section part as one device per section, or `null` when the part is not multi-section.
 *
 * Each section device carries only the terminals that section uses, in the order the registry gave
 * them, and its `identity.terminalRoles` are the canonical role names for its law's arity. That is
 * what lets lowering treat it as an ordinary device: a section of a dual op-amp is indistinguishable
 * from a packet that declared that half as its own `opamp` component, which is how the packets that
 * already compile transcribe the same chip.
 *
 * A section naming a terminal the device does not have is a registry error and refuses the pedal,
 * rather than silently dropping a section and rendering half a circuit.
 */
/**
 * A single-section `voltage-source` model on a regulator or converter that declares which terminal
 * is its output and which is its reference, resolved from those declarations.
 *
 * `null` whenever the document does not settle it: a different law, more than one section, a kind
 * whose format vocabulary has no supply electrodes, or an output/reference role declared zero or
 * several times. Every one of those falls through to the entry's pin naming exactly as before.
 */
export function declaredRegulatorTerminals(
	device: Device,
	model: { readonly kind: "sections"; readonly sections: readonly PartSection[] },
): ReadonlyArray<readonly [Device, DeviceResolution]> | null {
	// **Gated on the declaration, not on `device.kind`.** A document's `kind: regulator` folds to
	// device kind `ic` by the time laws are attached -- `boss-rv-3` and `electro-harmonix-q-tron`
	// both declare `regulator` and both arrive here as `ic` -- so a kind test would never fire.
	// The declaration is its own gate: core admits `positive`/`negative`/`ground` only on the
	// kinds whose vocabulary carries them (`regulator`, `power-converter`, `voltage-source`,
	// `rail`, `battery`), and an `ic` may declare nothing but `pin`. A device that reaches here
	// carrying a supply electrode was therefore declared as a kind entitled to state one.
	if (model.sections.length !== 1) {
		return null;
	}
	const section = model.sections[0] as PartSection;
	if (section.law.kind !== "voltage-source" || section.terminals.length !== 2) {
		return null;
	}
	const declared = device.identity.declaredTerminalRoles;
	const only = (role: string): number | null => {
		const found = declared.flatMap((value, index) =>
			value === role ? [index] : [],
		);
		return found.length === 1 ? (found[0] as number) : null;
	};
	const ground = only("ground");
	const output = only("positive") ?? only("negative");
	if (ground === null || output === null) {
		return null;
	}
	const outputNode = device.nodes[output];
	const groundNode = device.nodes[ground];
	if (outputNode === undefined || groundNode === undefined) {
		return null;
	}
	// A converter declaring its output `negative` states a rail below its reference, so the
	// source's sense is reversed rather than its magnitude negated -- the law carries a
	// magnitude.
	const inverting = only("positive") === null;
	const order = inverting
		? ([ground, output] as const)
		: ([output, ground] as const);
	// **Built exactly like any other section**, because it is one: a `#0` id and canonical roles
	// for the law, not the package's own role array. The parent's array does not describe a
	// section and is a different length, and leaving it in place misaligned every index-based
	// reader -- `supplyTerminals` resolves an unnamed end as `1 - driveIndex`, which is only the
	// other terminal when there are two.
	const sectionId = `${device.id}#0`;
	const nodes = order.map((index) => device.nodes[index] as NodeId);
	return [
		[
			{
				...device,
				id: sectionId,
				nodes,
				identity: {
					...device.identity,
					terminalRoles: canonicalRoles(section.law.kind, nodes.length),
					declaredTerminalRoles: canonicalRoles(
						section.law.kind,
						nodes.length,
					),
				},
			},
			{ outcome: "law", device: sectionId, law: section.law },
		] as const,
	];
}

function sectionDevices(
	device: Device,
	registry: PartRegistry,
	rails: { readonly high: number | null; readonly low: number | null },
	supply: SupplyNodes,
	nodeToVoltage: ReadonlyMap<NodeId, number>,
): readonly (readonly [Device, DeviceResolution])[] | null {
	// **`mayCarryRegistrySections`, not `requiresIdentification`.** An OTA reaches here so a
	// registered multi-section part (the BA662A's OTA plus its Darlington buffer) can be expanded;
	// when the registry has no matching entry this returns null and the caller falls through to
	// the device-class law, which is what every unregistered OTA keeps. An op-amp whose registered
	// *part* is not an op-amp (`opampPartRegisteredAsOtherLaw` -- the LM339 drawn as an op-amp)
	// reaches here the same way, and the class override is decided entirely in `identify`.
	if (!mayCarryRegistrySections(device) && !opampPartRegisteredAsOtherLaw(device, registry)) {
		return null;
	}
	if (isNonExecutableIcSupportShell(device)) {
		return null;
	}
	const identity = identify(device, registry);
	if (identity === null) {
		return null;
	}
	const entry = registryEntryFor(registry, identity, device.nodes.length);
	if (entry === null) {
		return null;
	}
	const model = entry.model;
	if (model.kind !== "sections") {
		return null;
	}
	// A `sections` entry's `terminals` index into the entry's canonical pin order, not the
	// declaration order the document happened to use. When the entry names its pins by role and
	// that naming is a clean bijection onto the device's declared terminals, resolve each
	// canonical position to the device's node by role, so a part declared in a different order
	// still lands on the right nodes: q-tron's 78L18 declares `in, out, ground`, the entry's
	// groups are `in, gnd, out`, and an all-null pinout used to skip this check entirely,
	// silently swapping the regulated rail onto ground.
	//
	// The bijection is the guard. A part whose declared roles do not map one-to-one onto the
	// entry's groups -- the MN3101 carries extra clock terminals the entry does not model, and a
	// 7809 may spell its pins `inputpin1` -- falls back to the declaration order its `pinout`
	// was written against, exactly as before: that order is enforced by `pinoutMatches`, and a
	// role-named entry with an all-null pinout cannot be wired by role OR by position, so it is
	// refused rather than mis-wired. See `PartPinout`.
	// **A regulator's own declared electrodes outrank the entry's pin numbering.**
	//
	// The 78Lxx entry's role groups list `pin1`/`pin2`/`pin3` among their aliases, which asserts
	// a package numbering the corpus does not agree on: three packets name a 78Lxx
	// `in, gnd, out` and `electro-harmonix-q-tron` names it `in, out, ground`. For
	// `moogerfooger-mf-102`'s `U13` -- three terminals literally named `pin1`, `pin2`, `pin3` --
	// the entry's `pin2 -> gnd`, `pin3 -> out` is backwards against the packet's own source
	// trace, which records pin2 on `plus5` and pin3 on `gnd`. The result was the regulator's
	// reference stamped onto the pedal's rail: node 3 carried 24 devices at **-4.9989 V** and 18
	// of 26 active devices sat dark, reverse-biased by a whole supply, with no diagnostic.
	//
	// Only the two terminals the law actually spans need to be found, and for this kind both
	// carry an unambiguous role: the regulated output is `positive` (or `negative` on an
	// inverting converter) and the reference is `ground`. A regulator's *input* has no distinct
	// role in the format, which is why a full bijection cannot be built from declarations here
	// and this binds the law's own two slots rather than every pin.
	const declaredSupplyBinding = declaredRegulatorTerminals(device, model);
	if (declaredSupplyBinding !== null) {
		return declaredSupplyBinding;
	}

	const roles = device.identity.terminalRoles;
	const groups = entry.terminalRoleGroups;
	const positions = groups.map((group) => terminalWithRole(roles, group));
	const cleanRoleResolution =
		groups.length > 0 &&
		groups.length === roles.length &&
		positions.every((position) => position !== null) &&
		new Set(positions).size === positions.length;
	// **For an OTA the registry only wins when it can bind by role.** Everything else here may
	// fall back to declaration order, which is right for a part whose entry was written against
	// that order -- but an OTA already has a correct role-bound device-class law, so a positional
	// guess from a registry entry written for different role spellings is strictly worse than
	// keeping it. Measured: `keeley-compressor-plus` names its terminals `iabc` and `out` while
	// the LM13600 entry names its groups `i_biasa` and `vouta`, so the bijection fails, and the
	// positional fallback swapped that device's `bias` and `output`.
	if (device.kind === "ota" && !cleanRoleResolution) {
		return null;
	}
	let canonicalNodeAt: (index: number) => number | null | undefined;
	if (cleanRoleResolution) {
		canonicalNodeAt = (index) => {
			const position = positions[index];
			return position === null || position === undefined ? null : (device.nodes[position] ?? null);
		};
	} else if (!pinoutMatches(model.pinout, roles)) {
		// **Opened and named, not refused.** The part *is* registered -- this is an arity
		// disagreement between a real entry and a real document, not an unknown chip -- so the
		// two facts a reader needs are which entry and which counts, and both are in the warning.
		// Refusing here failed the whole document for one component that could not be placed,
		// which is the trade this repository settled the other way earlier today: losing a pedal
		// entirely is a worse answer than losing the one stage nothing can bind.
		//
		// `boss-dd-3b`'s `IC2` is the case that forced it. Its `SA571D` is declared as a
		// six-terminal source-visible shell (`rect_cap1`, `rect_cap2`, `audio_in`, `audio_out`,
		// `vcc`, `gnd`) against the SA571's real sixteen, and four of the six pins a `compandor`
		// section binds -- `rect_in`, `cell_in`, `inv_in` and the R3 return -- are not declared at
		// all, with both rect-cap nodes touched by nothing but the shell itself. The packet's own
		// record calls it a shell and claims no terminal trace for it, so there is nothing here to
		// correct upstream and nothing this stage may invent: the summing node and the R3 return
		// are where the external network sets the gain, and choosing them would be choosing the
		// law. The same chip is modelled in full wherever a document declares its sixteen pins.
		return [
			[
				device,
				{
					outcome: "law",
					device: device.id,
					law: { kind: "open" },
					openReason: "registry-arity-mismatch",
					insteadOfRefusal: `part ${identity.partId} is registered against a ${model.pinout.length}-terminal pinout this component's ${roles.length} declared terminals do not match, and its role naming does not resolve cleanly to its sections`,
				},
			] as const,
		];
	} else {
		canonicalNodeAt = (index) => device.nodes[index];
	}
	return model.sections.map((section, index) => {
		const nodes = section.terminals.map((terminal) => canonicalNodeAt(terminal));
		if (nodes.some((node) => node === undefined || node === null)) {
			return [
				device,
				{
					outcome: "unsupported",
					device: device.id,
					reason: `part ${identity.partId} section ${index} names a terminal this component does not declare`,
				},
			] as const;
		}
		// Read from the section's *parent* device, which is where the package's supply pins
		// are declared -- a section's own terminal list is only its three signal pins.
		const sectionRails = opampRails(device, rails, nodeToVoltage);
		const railHigh = sectionRails.high;
		const railLow = sectionRails.low;

		// An op-amp's rails come from the op-amp's own supply terminals or the circuit's supply set,
		// not from the registry -- the same substitution a declared `opamp` gets. A registry cannot know them:
		// it describes a part, and the rails are a property of the pedal the part is fitted to.
		// A compandor carries an op-amp too, and it needs the same substitution: its rails were
		// computed just above and then dropped on the floor, because this only matched the
		// `ideal-opamp` kind. An unrailed internal op-amp is not a small error in the Figure 7
		// compressor, where the gain cell is the only AC feedback and the gain is unbounded
		// until the detector charges -- `mxr-carbon-copy` answered a 2 ms burst with 195 V.
		const law: DeviceLaw =
			section.law.kind === "ideal-opamp"
				? {
						kind: "ideal-opamp",
						railHigh,
						railLow,
						// The registry states the part's gain; only the rails are the pedal's.
						openLoopGain: section.law.openLoopGain,
					}
				: section.law.kind === "compandor"
					? { ...section.law, railHigh, railLow }
					: section.law;
		const sectionDevice: Device = {
			...device,
			id: `${device.id}#${index}`,
			nodes: nodes as readonly NodeId[],
			identity: {
				...device.identity,
				terminalRoles: canonicalRoles(law.kind, nodes.length),
				// A section's terminal list is its own, so the package's declared roles do not
				// describe it -- and `canonicalRoles` above already states each section pin's
				// role exactly. Carrying the parent's array would misalign it by length.
				declaredTerminalRoles: canonicalRoles(law.kind, nodes.length),
			},
		};
		return [
			sectionDevice,
			{
				outcome: "law",
				device: sectionDevice.id,
				law,
			},
		] as const;
	});
}

/**
 * A registry macro against one device: terminal roles resolved to indices, pedal-specific
 * parameters merged in.
 *
 * Two things the registry cannot state and this stage supplies, both for the same reason the
 * `ideal-opamp` branch above takes its rails from the circuit — a registry describes a part, and
 * these belong to the pedal it was fitted to:
 *
 *   - **where the ports landed**, from `MacroPortRoles`. Order-independent, so one entry serves
 *     every declaration order that names its terminals.
 *   - **how long the delay is**, from the source's own `DelayMs`. A bucket brigade's delay is
 *     `stages / (2 * f_clock)` and only the stage count is part-intrinsic, so the registry cannot
 *     know it. See `parametersFor`'s `ic` branch.
 *
 * **A macro with no locatable audio port is refused, not defaulted.** Measured: leaving
 * `audioPortImpedanceOhms` null keeps both ports absent, and a macro with no tap and no write-back
 * is not in the signal path at all -- `electro-harmonix-electric-mistress` renders exact zero that
 * way, because its whole signal path is the macro. A pedal that compiles to silence is worse than
 * one that refuses by name. See `thoughts/shared/experiments/macro-audio-port-impedance/`.
 */
/**
 * The physical position a bare-pin document's terminal sits at, when this entry names one. Returns
 * `null` unless the entry supplies positions for `port`, the device is fully bare (every terminal a
 * `pinN` with no role token), and the position is within the device's declared terminal count. A
 * document that names even one terminal resolves by role and never reaches here.
 */
function barePinPosition(
	macro: MacroPartModel,
	roles: readonly (string | null)[],
	port: keyof MacroBarePinPositions,
): number | null {
	const position = macro.barePinPositions?.[port];
	if (position === undefined) {
		return null;
	}
	if (!roles.every((role) => role === null)) {
		return null;
	}
	if (position >= roles.length) {
		return null;
	}
	return position;
}

/**
 * Thin wrapper that brackets the real resolution so every registry entry consulted while computing
 * this macro's parameters is recorded against the macro's device id. **No behaviour change** -- the
 * wrapper only opens and closes the recording.
 */
function resolveMacro(
	device: Device,
	partId: string,
	macro: MacroPartModel,
	registry: PartRegistry,
	netlist?: Netlist,
): DeviceResolution {
	return withRecordedReads(`macro:${device.id}`, () =>
		resolveMacroInner(device, partId, macro, registry, netlist),
	);
}

function resolveMacroInner(
	device: Device,
	partId: string,
	macro: MacroPartModel,
	// Required, and ahead of the optional `netlist` so it cannot be omitted. It was
	// `registry?` while `bbd-clock.ts` defaulted its own parameter to the part catalog, so an
	// omission here resolved to the full catalog instead of failing — the leak that kept the
	// compiler from being part-free. Its one caller always had a registry to give.
	registry: PartRegistry,
	netlist?: Netlist,
): DeviceResolution {
	const roles = device.identity.terminalRoles;
	const audioIn =
		terminalWithRole(roles, macro.ports.audioIn) ??
		barePinPosition(macro, roles, "audioIn");
	const audioOut =
		terminalWithRole(roles, macro.ports.audioOut) ??
		barePinPosition(macro, roles, "audioOut");
	// A second output, only for a part that declares one and a device that names it. Absent is
	// the ordinary case and stays a one-output macro: unlike the ports above, failing to find
	// this is not a refusal, because most parts genuinely have one output.
	const audioOut2 =
		(macro.ports.audioOut2 ?? []).length === 0
			? null
			: terminalWithRole(roles, macro.ports.audioOut2 ?? []);
	if (audioIn === null || audioOut === null) {
		const missing = [
			audioIn === null ? "audio in" : null,
			audioOut === null ? "audio out" : null,
		].filter((label): label is string => label !== null);
		return {
			outcome: "unsupported",
			device: device.id,
			reason: `part ${partId} declares no terminal this registry can read as ${missing.join(" or ")}: its ${roles.length} terminals are named ${describeRoles(roles)}`,
		};
	}
	const parameterPort = macro.ports.parameter ?? [];
	const parameterTerminal =
		parameterPort.length === 0
			? null
			: terminalWithRole(roles, parameterPort) ??
				barePinPosition(macro, roles, "parameter");

	// Delay time resolution precedence:
	// 1. If a clock driver exists and its timing network resolves, derive delaySeconds.
	// 2. Otherwise fall back to declared device.parameters.delaySeconds (DelayMs).
	// 3. If neither derived delay nor declared DelayMs exists, refuse naming missing DelayMs.
	let delaySeconds = device.parameters.delaySeconds;
	let clockControl: MacroClockControl | null = null;
	// Provenance, so a consumer can tell a delay the circuit produced from one the source
	// asserted. Starts as `declared` and is only promoted by an actual derivation below.
	let delayProvenance: "derived" | "declared" = "declared";
	let delayDeclaredReason: string | null = "this part's model carries no clock derivation";

	if (macro.modelId === "bucket-brigade-delay-line") {
		const stages = macro.parameters.stages;
		if (stages === undefined || !(stages > 0) || !Number.isInteger(stages)) {
			return {
				outcome: "unsupported",
				device: device.id,
				reason: `part ${partId} is a bucket-brigade delay line with no stage count declared in its registry entry`,
			};
		}

		if (netlist !== undefined) {
			const clockDerivation = deriveBbdDelayFromNetlist(device, netlist, stages, registry);
			delayDeclaredReason =
				clockDerivation.outcome === "no-clock-driver"
					? "no clock driver device is wired to this delay line"
					: clockDerivation.outcome === "refused"
						? clockDerivation.reason
						: null;
			if (clockDerivation.outcome === "derived") {
				delayProvenance = "derived";
				delaySeconds = clockDerivation.delaySeconds;
				if (clockDerivation.controlId !== null) {
					clockControl = {
						controlId: clockDerivation.controlId,
						taper: clockDerivation.taper,
						ohmsAtControlMin: clockDerivation.ohmsAtControlMin,
						ohmsAtControlMax: clockDerivation.ohmsAtControlMax,
						farads: clockDerivation.cFarads,
						stages: clockDerivation.stages,
						formulaConstant: clockDerivation.formulaConstant,
					};
				}
			}
		}
	} else if (macro.modelId === "digital-delay-line") {
		const part = foldPartId(device.identity.partNumber ?? "");
		if (part === "pt2399" || part === "pt2399s") {
			if (netlist !== undefined) {
				const ptDerivation = derivePt2399DelayFromNetlist(device, netlist);
				delayDeclaredReason =
					ptDerivation.outcome === "refused" ? ptDerivation.reason : null;
				if (ptDerivation.outcome === "derived") {
					delayProvenance = "derived";
					delaySeconds = ptDerivation.delaySeconds;
					if (ptDerivation.controlId !== null) {
						clockControl = {
							controlId: ptDerivation.controlId,
							taper: ptDerivation.taper,
							ohmsAtControlMin: ptDerivation.ohmsAtControlMin,
							ohmsAtControlMax: ptDerivation.ohmsAtControlMax,
							farads: ptDerivation.cFarads,
							stages: ptDerivation.stages,
							formulaConstant: ptDerivation.formulaConstant,
						};
					}
				}
			}
		} else if (part === "m50195" || part === "m50195p") {
			if (netlist !== undefined) {
				const mDerivation = deriveM50195DelayFromNetlist(device, netlist);
				delayDeclaredReason =
					mDerivation.outcome === "refused" ? mDerivation.reason : null;
				if (mDerivation.outcome === "derived") {
					delayProvenance = "derived";
					delaySeconds = mDerivation.delaySeconds;
					if (mDerivation.controlId !== null) {
						clockControl = {
							controlId: mDerivation.controlId,
							taper: mDerivation.taper,
							ohmsAtControlMin: mDerivation.ohmsAtControlMin,
							ohmsAtControlMax: mDerivation.ohmsAtControlMax,
							farads: mDerivation.cFarads,
							stages: mDerivation.stages,
							formulaConstant: mDerivation.formulaConstant,
						};
					}
				}
			}
		}
	}

	// **Only a delay model needs a delay time.** A reverb's decay is part-intrinsic -- the
	// BTDR-2 datasheet's T60 -- so it arrives in the registry entry's `parameters` and the pedal's
	// wiring says nothing about it. Applying the delay refusal to every macro made a reverb
	// module refuse with "declares no positive DelayMs", which misattributes the gap to the packet
	// and would invite a bogus `DelayMs` into a correct `.vdsp`.
	// **The modulation port, resolved only for a bucket brigade and only from the netlist.**
	// A delay whose clock is steered by an LFO cannot state its length as one number, which is
	// what `deriveBbdDelayFromNetlist` now refuses to pretend. This is the other half of that
	// refusal: the length still moves, and this names the node it moves with.
	let modulationFields: {
		modulationNode?: number | null;
		modulationSteeredBy?: string | null;
	} = {};
	if (macro.modelId === "bucket-brigade-delay-line" && netlist !== undefined) {
		const source = resolveClockModulationSource(device, netlist, registry);
		if (source.outcome === "resolved") {
			modulationFields = {
				modulationNode: source.node,
				modulationSteeredBy: source.steeredBy,
			};
		}
	}

	const needsDelayTime =
		macro.modelId === "bucket-brigade-delay-line" ||
		macro.modelId === "digital-delay-line";
	if (needsDelayTime && (delaySeconds === undefined || !(delaySeconds > 0))) {
		return {
			outcome: "unsupported",
			device: device.id,
			reason: `part ${partId} is a delay macro and this component declares no positive DelayMs, which is the one parameter its model cannot be given by the registry`,
		};
	}

	return {
		outcome: "macro",
		device: device.id,
		macro: {
			modelId: macro.modelId,
			parameters:
				delaySeconds === undefined
					? { ...macro.parameters }
					: { ...macro.parameters, delaySeconds },
			portTerminals:
				audioOut2 === null
					? [audioIn, audioOut]
					: [audioIn, audioOut, audioOut2],
			audioPortImpedanceOhms: macro.audioPortImpedanceOhms,
			// Both or neither, which `MacroModel` requires: a terminal with no reference voltage
			// cannot be scaled against anything.
			...(parameterTerminal !== null && macro.parameterReferenceVolts !== null
				? {
						parameterTerminal,
						parameterReferenceVolts: macro.parameterReferenceVolts,
					}
				: { parameterTerminal: null, parameterReferenceVolts: null }),
			...modulationFields,
			clockControl,
			delayProvenance,
			delayDeclaredReason: delayProvenance === "derived" ? null : delayDeclaredReason,
		},
	};
}

/** A device's terminal roles as a diagnostic reads them, with unnamed pins called what they are. */
function describeRoles(roles: readonly (string | null)[]): string {
	const named = roles.filter((role): role is string => role !== null);
	return named.length === 0
		? "by pin number alone, carrying no role tokens"
		: named.join(", ");
}

/**
 * Role tokens a section device presents, so lowering's per-kind terminal lookup finds them.
 *
 * Only the kinds a registry can currently supply as a section. Anything else gets no roles, which
 * leaves lowering on its positional fallback -- correct for a two-terminal law and the reason an
 * unlisted three-terminal kind must be added here rather than assumed to work.
 */
function canonicalRoles(
	kind: DeviceLaw["kind"],
	count: number,
): readonly (string | null)[] {
	// **Core role values, not folded name tokens.** `declaredTerminalRoles` holds "the role each
	// terminal declares, as core parsed it", and this wrote `noninverting` -- the folded *name*
	// token the old `opampPlusRoles` set matched. Harmless while lowering compared against that
	// set, and a wrong answer the moment it compared against the core vocabulary: nine packets'
	// op-amp sections reported `nonInverting=0` and refused.
	if (kind === "ideal-opamp" && count === 3) {
		return ["nonInverting", "inverting", "output"];
	}
	if (kind === "transformer" && count === 4) {
		return ["primarya", "primaryb", "secondarya", "secondaryb"];
	}
	if (kind === "clock-driver" && count === 6) {
		// `gnd` is the part's own GND pin and is last because it was added after the other five.
		// It is not circuit ground: the MN3101/MN3102 run on a single negative supply, so a +9 V
		// pedal ties this pin to the positive rail and ties `vdd` to circuit ground.
		return ["cp1", "cp2", "vgg", "vdd", "ox1", "gnd"];
	}
	// A registry section's nodes are already in the law's canonical order -- `section.terminals`
	// indexed them -- so naming them here states what is true rather than inferring it. Added
	// 2026-09-03 because `lower.ts` now reads declared roles: without these a three-terminal
	// `bjt`/`fet` section arrived with no roles, took the positional path (correctly, since the
	// order is canonical) and was reported as an unreadable-role fallback. A false positive on a
	// binding the registry had already got right.
	if (kind === "bjt" && count === 3) {
		return ["base", "collector", "emitter"];
	}
	if (kind === "fet" && count === 3) {
		return ["gate", "drain", "source"];
	}
	// A regulator or converter lowered to a supply: `section.terminals` already put the output
	// first and the reference second, so naming them states that order rather than guessing it.
	// Without this the section arrived unlabelled, `supplyTerminals` fell through to
	// `terminalPair`, and which end got the voltage was whichever the entry happened to list
	// first -- how `moogerfooger-mf-102` came to hold its +5 rail at -4.9989 V.
	if (kind === "voltage-source" && count === 2) {
		return ["positive", "negative"];
	}
	// Same shape as the supply above: `section.terminals` has already put the LED first and its
	// return second, followed by the cell's two ends, which is the order `optocouplerTerminals`
	// falls through to. Naming them states that order instead of leaving the section to depend on
	// it -- and an unlabelled section is indistinguishable from a document that declared nothing,
	// so without this the two get the same warning and only one of them deserves it.
	//
	// `end` twice is deliberate and is the physics: a photoresistor conducts the same either way,
	// so the cell states no polarity and either declaration order is the same circuit.
	if (kind === "optocoupler" && count === 4) {
		return ["anode", "cathode", "end", "end"];
	}
	return Array.from({ length: count }, () => null);
}

/**
 * Where a supply's two ends land, and how many terminals sit on each node.
 *
 * This is what makes a jack contact identifiable without naming it. A supply end on a
 * jack terminal means the supply is routed *through* that jack, and the degree count
 * says whether it gets anywhere else on its own: an end whose node carries only the
 * supply and the jack is stranded, and the jack has to complete the path.
 */
type SupplyNodes = {
	readonly returns: ReadonlySet<number>;
	readonly drives: ReadonlySet<number>;
	readonly degree: ReadonlyMap<number, number>;
};

function supplyNodes(netlist: Netlist): SupplyNodes {
	const returns = new Set<number>();
	const drives = new Set<number>();
	const degree = new Map<number, number>();
	for (const device of netlist.devices) {
		for (const node of device.nodes) {
			degree.set(node, (degree.get(node) ?? 0) + 1);
		}
		if (device.kind !== "voltage-source") {
			continue;
		}
		// Declared roles, as everywhere else that asks which end of a supply is which.
		device.identity.declaredTerminalRoles.forEach((role, index) => {
			const node = device.nodes[index];
			if (role === null || node === undefined) {
				return;
			}
			if (role === "negative") {
				returns.add(node);
			}
			if (role === "positive") {
				drives.add(node);
			}
		});
	}
	return { returns, drives, degree };
}

/**
 * The generic triode, following the generic BJT's precedent exactly: an unregistered
 * transistor gets a device-class law rather than a refusal, so an unregistered tube does
 * too. A registry entry refines it; nothing here reads a part number.
 *
 * These are the 12AX7 Koren coefficients `whole-amp-5f1` already validated, taken rather
 * than re-derived. That experiment solves a 2x12AX7 + 6V6 path to a physically sane bias
 * (V1A `Vk 1.251`, `Vp 166.6`, `Ip 0.83 mA` on a 250 V rail through 100k with a 1.5k
 * cathode), which makes it a real oracle this repository already owns.
 *
 * **There are two prior tube experiments and they validate different things** — worth knowing
 * before treating either as the reference:
 *
 * - `whole-amp-5f1` uses **Koren** with registry-fit coefficients and validates a **static
 *   operating point** against textbook 12AX7 values. That is what this law follows.
 * - `compact-mna-dynamic-triode-cell` uses a **different, simpler law** (`triodeK`, `mu`,
 *   `triodeSoftness`) and validates **dynamics** — grid/coupling recovery — plus DK-reduction
 *   equivalence to `1e-9` correlation with an analytic reduced Jacobian. Its own boundary note
 *   says it "is not calibrated to a real 12AX7 datasheet or ngspice tube model yet", so its
 *   coefficients are not a datasheet anchor and are deliberately not used here.
 *
 * When the re-orientation reaches state-space reduction, that second experiment is the proven
 * reference for a DK-reduced triode cell; it is not a reference for this law's coefficients.
 *
 * A 12AX7 as the *generic* triode is a choice worth stating: it is the overwhelmingly
 * common preamp triode, and a power triode is a different fit. An amp whose character
 * comes from a specific tube needs a registry entry, and this default should not be read
 * as a claim about that tube.
 */
const GENERIC_TRIODE = {
	mu: 100.29,
	kg1: 1375.3,
	kp: 2052.0,
	kvb: 9706.8,
	ex: 1.0,
	// Grid conduction, from `compact-mna-dynamic-triode-cell`'s validated cell rather than
	// invented: `gridIs 1e-5`, `gridVt 0.06`, `gridThreshold 0.05`. Those are the values it
	// reports 0 Newton failures with across a 40x velocity ladder, at 2.1 to 2.8 iterations
	// per sample.
	gridSaturationCurrent: 1.0e-5,
	gridOnsetVolts: 0.05,
	gridScaleVolts: 0.06,
	// Omitted by the fits these coefficients came from, so 0 keeps them self-consistent.
	contactPotentialVolts: 0,
} as const;

/**
 * The generic pentode: `whole-amp-5f1`'s 6V6GT fit, again taken rather than re-derived. That
 * experiment solves the 6V6 to `Vk 23.3`, `Vp 329.1`, `Ip 49.6 mA` — and records honestly that
 * this is "~10 mA hot vs a real 5F1", calling it "first-order pentode-model calibration TODO,
 * not a viability blocker". So this law is a working power pentode and **not** a calibrated one;
 * the plate current is known to run high.
 *
 * **`kg1` was rescaled from 1060.0 when the plate gate changed from `tanh` against a 40 V knee to
 * Koren's `atan(Vpk/kvb)`, so this fit is behaviour-neutral across that change.** Unlike the
 * catalogued tubes -- whose published coefficients were generated against `atan` and were therefore
 * 26-34% low under `tanh` -- these numbers were tuned locally *with* `tanh`, so its saturation at
 * 1.0 is already inside `kg1`. The factor is `atan(305.8/38) / tanh(305.8/40)` = 1.44717, taken
 * at the operating point this fit's own experiment records (`Vp 329.1`, `Vk 23.3`), which makes the
 * plate current identical there and within a percent nearby. **The known ~10 mA of excess above is
 * untouched and is a separate defect**; this rescale deliberately preserves it rather than silently
 * folding a second correction into a first.
 *
 * **The grid parameters are the weakest numbers here and are reused, not measured.** They come
 * from `compact-mna-dynamic-triode-cell`'s *preamp triode*; a power tube's grid conducts at a
 * different onset and much harder, and blocking distortion on an overdriven power stage is
 * exactly that behaviour. Omitting grid current would be worse — it is the mechanism that makes
 * an overdriven output stage sound like one — but a registry entry should refine these before
 * any claim about a specific power tube's overdrive.
 */
const GENERIC_PENTODE = {
	mu: 8.0,
	kg1: 1534.0,
	kp: 72.0,
	kvb: 38.0,
	ex: 1.34,
	gridSaturationCurrent: 1.0e-5,
	gridOnsetVolts: 0.05,
	gridScaleVolts: 0.06,
	// Omitted by the fits these coefficients came from, so 0 keeps them self-consistent.
	contactPotentialVolts: 0,
} as const;

/**
 * The generic tube rectifier, following the triode and pentode's discipline: coefficients taken
 * from a datasheet-anchored source this repository already holds, never re-derived and never
 * invented.
 *
 * The source is `thoughts/shared/experiments/power-domain-tube-rectifier/`, whose two cases fit
 * `K` from admitted datasheet operating points and reproduce them to better than 0.15%:
 *
 * ```
 *            K (A/V^1.5)   anchor          reproduces
 *   5Y3GT      3.54e-4     50 V, 125 mA    0.125158 A
 *   GZ34       3.21e-3     17 V, 225 mA    0.224998 A
 * ```
 *
 * **5Y3GT is the generic, and that choice is weaker than the triode's 12AX7.** The 12AX7 is the
 * overwhelmingly common preamp triode; there is no equivalently dominant rectifier, and the amp
 * corpus's three instances are one 5Y3GT, one 5U4 and one GZ34 — one each. The two anchored fits
 * are a **factor of nine apart in `K`**, which at 50 mA is 47 V of drop against 10 V, so this
 * default is a directly-heated 5Y3-class rectifier and a specific amp's sag needs a registry
 * entry. It is the conservative end of the range (the largest drop of the two) and it belongs to
 * `fender-5f1-champ`, the one amp whose preamp stage this repository already validates against an
 * ngspice oracle.
 *
 * Nothing here reads `PartNumber`. All three instances declare one — `5Y3GT`, `5U4`, `GZ34` — and
 * acting on it is stage 2's job through the registry, exactly as for an unregistered transistor.
 */
const GENERIC_TUBE_DIODE = {
	perveance: 3.54e-4,
	exponent: 1.5,
} as const;

/**
 * The supply extremes a circuit establishes. An op-amp cannot drive its output past
 * them, and that needs no part number: both facts are in the netlist. A circuit that
 * declares no supply has no rails, and its op-amps stay unbounded.
 */
/**
 * Terminal roles that name a regulator's regulated output, as `terminalRoleToken` folds them.
 *
 * Closed vocabulary, compared as whole tokens. `output` is here because
 * `electro-harmonix-deluxe-memory-man`'s `U12_LM7915` spells it that way, and the only
 * pre-existing reader of this shape looked for `out` exactly and so could never have found it.
 */
const REGULATOR_OUTPUT_ROLES = ["out", "output", "vout", "voutput"] as const;

/**
 * Supply voltages a **registered regulator** holds its output at, and the node each one drives.
 *
 * Why this exists: a three-terminal regulator declares no voltage of its own. `U12_LM7915` in
 * `electro-harmonix-deluxe-memory-man` carries `parameters: {}` — the −15 V is a property of the
 * *part*, stated once in the registry as a `voltage-source` law, not of the document. Both
 * readers below were built from the netlist alone, so the pedal's entire negative rail was
 * invisible to them while being perfectly visible to lowering, which stamps it as a `dc-source`.
 *
 * The cost of that gap was not subtle. All ten of that pedal's op-amps declare `vminus` on the
 * regulator's output node, `supplyRails` returned `low: 0` because it had only seen the +24 V
 * rail, and every op-amp was told it could not swing below ground. Outputs clipped at 0 V
 * instead of −15 V, and the DC error propagated until the NE570's summing node settled at
 * **−20.5 V**, five volts below a rail the compiler did not know existed.
 *
 * `supply-reference.ts` already had to learn this and says so in its header: it reads the lowered
 * `dc-source` stamps "rather than the declared `rail`/`battery` devices". This stage runs before
 * lowering, so it cannot read stamps — but it holds the registry, which is where the number is.
 */
function registrySuppliedVoltages(
	netlist: Netlist,
	registry: PartRegistry,
): ReadonlyArray<{ readonly node: NodeId; readonly volts: number }> {
	const supplies: { node: NodeId; volts: number }[] = [];
	for (const device of netlist.devices) {
		// A device that states its own voltage is already read by both callers; this is only
		// for the ones whose voltage exists solely as a registered part fact.
		if (device.parameters.volts !== undefined) {
			continue;
		}
		const identity = identify(device, registry);
		if (identity === null) {
			continue;
		}
		const entry = registryEntryFor(registry, identity, device.nodes.length);
		if (entry === null || entry.model.kind !== "sections") {
			continue;
		}
		for (const section of entry.model.sections) {
			if (section.law.kind !== "voltage-source") {
				continue;
			}
			const volts = section.law.volts;
			if (!Number.isFinite(volts)) {
				continue;
			}
			const index = terminalWithRole(
				device.identity.terminalRoles,
				REGULATOR_OUTPUT_ROLES,
			);
			if (index === null) {
				continue;
			}
			const node = device.nodes[index];
			if (node !== undefined && node !== 0) {
				supplies.push({ node, volts });
			}
		}
	}
	return supplies;
}

function supplyRails(
	netlist: Netlist,
	regulated: ReadonlyArray<{ readonly node: NodeId; readonly volts: number }>,
): {
	readonly high: number | null;
	readonly low: number | null;
} {
	// Rails count as supplies too, or an op-amp on a rail-only pedal has no ceiling to
	// clip against and renders a voltage the circuit could not make.
	//
	// **An AC source is not a rail**, and is excluded by the same evidence the law uses: a
	// declared frequency. A mains inlet is not something an op-amp output can clip against --
	// it swings both ways at 60 Hz, and the DC rails a solid-state amp's op-amps actually see
	// are downstream of its rectifier and reservoir. Counting a 120 V mains peak as `railHigh`
	// would give every op-amp in a mains-powered amp a ceiling 20x too high, which is a wrong
	// answer that renders. No packet exercises this today: the pedal corpus has no AC supply,
	// and no amp document reaches a program.
	const volts = netlist.devices
		.filter(
			(device) => device.kind === "voltage-source" || device.kind === "rail",
		)
		.filter((device) => device.parameters.frequency === undefined)
		.map((device) => device.parameters.volts)
		.filter(
			(value): value is number => value !== undefined && Number.isFinite(value),
		)
		// A regulator's rail counts the same as a declared one: it is a fixed supply the
		// circuit's op-amps clip against. See `registrySuppliedVoltages`.
		.concat(regulated.map((supply) => supply.volts));
	if (volts.length === 0) {
		return { high: null, low: null };
	}
	// Ground is a rail whenever any supply exists, so a single positive supply gives a
	// 0..V swing rather than a symmetric one.
	return { high: Math.max(0, ...volts), low: Math.min(0, ...volts) };
}

/**
 * The one AC frequency this document states, in Hz, or `null`.
 *
 * A transformer does not change frequency: every winding on one core runs at whatever the
 * primary is fed at. So a transformer lowered as independent secondary sources still needs the
 * mains frequency, and this is where it comes from -- the same place it already came from
 * before, since a coupled winding inherited it from the AC source stamped on the primary. The
 * change is that it is now read rather than propagated, not that a new fact is being assumed.
 *
 * **Zero or several distinct frequencies is `null`, and `null` is a refusal downstream.** One
 * value is unambiguous; a document with two different AC frequencies in it has no single
 * "mains" and this stage will not pick one. Measured across the 24 canonical amps: 20 declare
 * exactly one frequency, 4 declare none (`marshall-jcm800`, `orange-gro100`, `peavey-5150`,
 * and both `vox-ac15` packets, which declare no supply component at all), and none declares
 * two. So the several-frequencies branch is unexercised today and is written as a refusal for
 * the same reason every other unexercised branch here is.
 *
 * A frequency of 0 or less is not a waveform and is excluded, matching the `voltage-source`
 * law's own reading of a declared 0 Hz as DC.
 */
function mainsFrequency(netlist: Netlist): number | null {
	const frequencies = new Set(
		netlist.devices
			.map((device) => device.parameters.frequency)
			.filter(
				(value): value is number =>
					value !== undefined && Number.isFinite(value) && value > 0,
			),
	);
	return frequencies.size === 1 ? ([...frequencies][0] as number) : null;
}

/**
 * Is every one of this device's nodes private to itself — touched by no other device and
 * never ground?
 *
 * A component that shares no net with anything cannot affect the solve, however it would
 * have been modelled: physically, a disconnected chip does nothing. Refusing the whole
 * pedal for it is over-strict; several packets deliberately carry such blocks as declared
 * view-only power clusters (klon-centaur's `MAX1044_CLUSTER_VIEW_ONLY` draws the charge
 * pump on four nodes nothing else touches, and separately declares the rails it produces
 * as voltage-carrying ports — its own record says "not a solved terminal charge-pump
 * model"). The resolution is `open` plus a LOUD compile warning, so a cluster isolated by
 * a wiring mistake rather than by intent is still named, never silently swallowed.
 *
 * Deliberately narrow: ONE shared node — even ground — defeats it. pigtronix's LT1054
 * drives a diode-doubler from its switching pin, shares nets, and keeps refusing.
 */
export function isElectricallyIsolated(
	device: Device,
	devicesTouchingNode: ReadonlyMap<NodeId, number>,
): boolean {
	if (device.nodes.length === 0) {
		return false; // zero-terminal components are the unconnected-behavior scanner's beat
	}
	return device.nodes.every(
		(node) => node !== 0 && (devicesTouchingNode.get(node) ?? 0) <= 1,
	);
}

/** How many devices touch each node, counting a device once however many terminals it lands. */
export function deviceCountByNode(netlist: Netlist): Map<NodeId, number> {
	const counts = new Map<NodeId, number>();
	for (const device of netlist.devices) {
		for (const node of new Set(device.nodes)) {
			counts.set(node, (counts.get(node) ?? 0) + 1);
		}
	}
	return counts;
}

const CHARGE_PUMP_PARTS: ReadonlySet<string> = new Set([
	"tc1044",
	"tc1044scpa",
	"max1044",
	"7662",
	"lt1054cp",
	"lt1054",
]);

/**
 * A charge-pump IC whose output node is already backed by a declared rail is a
 * view-only structural anchor: the rail supplies the voltage, the IC adds nothing.
 * The Klon's MAX1044 is handled by `isElectricallyIsolated` (all nodes private);
 * this covers the wider class where the pump shares nets with the declared rail.
 */
function isChargePumpWithDeclaredRail(
	device: Device,
	nodeToVoltage: ReadonlyMap<NodeId, number>,
	oneHopVoltage: ReadonlyMap<NodeId, number>,
): boolean {
	const partNumber = device.identity.partNumber;
	if (partNumber === null) {
		return false;
	}
	if (!CHARGE_PUMP_PARTS.has(partNumber.toLowerCase())) {
		return false;
	}
	return device.nodes.some(
		(node) => node !== 0 && (nodeToVoltage.has(node) || oneHopVoltage.has(node)),
	);
}

/**
 * An OTA's signal terminals, bound by the names the device declares for them.
 *
 * The five OTA parts in this corpus spell the same five pins five different ways, so
 * the closed vocabularies below are unions of what the sources actually declare, each
 * compared as a whole folded token by `terminalWithRole` -- never as a substring, and
 * never against a description. `terminalWithRole` also refuses an ambiguous match, so a
 * part declaring two terminals that both fold to `output` binds neither.
 *
 * Why this exists: this law is reached by `kind === "ota"` straight off the netlist,
 * which bypasses the registry's `sections` mapping entirely, so nothing had ever
 * reordered these terminals. Reading positions 0/1/2/3 of the *declared* order then
 * bound the CA3080's balance pin as its input, its non-inverting input as its output,
 * and its negative supply as its bias current -- and `bias === vee` makes
 * `iAbc = is * (exp(0) - 1) = 0`, so the stage had zero transconductance by
 * construction and `mxr-dyna-comp` was silent. Every OTA in the corpus mis-bound at
 * least one pin; the ones that worked did so by coincidence.
 */
/**
 * Signal-pin positions of an 8-pin OTA package, 0-indexed.
 *
 * **Verified against the CA3094 datasheet** (Intersil/RCA `CA3094, CA3094A, CA3094B`, "30MHz,
 * High Output Current Operational Transconductance Amplifier", Pinouts, PDIP/SOIC top view), not
 * just inherited from the CA3080 this comment used to cite: pin 2 and pin 3 are the differential
 * inputs, pin 4 is GND/V-, pin 5 is I_ABC, pin 6 is the drive output (emitter), pin 7 is V+, pin 8
 * is the sink output (collector), pin 1 is external frequency compensation or the inhibit input.
 * Those map to the indices below exactly.
 *
 * **The input polarity is conditional, which the pinout diagram does not show.** The datasheet's
 * output-mode table gives it: taking the output at terminal 6 ("source" mode) makes terminal 2
 * inverting and terminal 3 non-inverting; taking it at terminal 8 ("sink" mode) swaps them,
 * because the collector inverts what the emitter follows. The indices below are the terminal-6
 * reading, which is the output this law binds. A circuit that used pin 8 instead would need the
 * inputs exchanged, so an OTA whose output is not pin 6 must not be resolved by this constant.
 */
const OTA_DIP8_POSITIONS = {
	plus: 2,
	minus: 1,
	output: 5,
	bias: 4,
	vee: 3,
} as const;

/**
 * The OTA's device-class law: what an unregistered OTA gets, and what a registered one falls back
 * to when its entry supplies no model. Terminals bind by role -- see `otaTerminalBinding`.
 */
function otaDeviceClassLaw(device: Device): DeviceResolution {
	return {
		outcome: "law",
		device: device.id,
		law: {
			kind: "ota",
			transconductance: device.parameters.transconductance ?? 1e-3,
			saturationCurrent: device.parameters.saturationCurrent,
			thermalVoltage: device.parameters.thermalVoltage,
			...otaTerminalBinding(device),
		},
	};
}

/**
 * An OTA's four signal terminals from its **declared** electrodes, or null when it does not
 * declare the three that decide the binding.
 *
 * Shared by `otaTerminalBinding` and `otaPackageOrderAssumed` so the resolver and the warning
 * cannot disagree about whether a document stated its pins.
 */
function otaDeclaredBinding(device: Device): {
	readonly terminalIndices: {
		readonly plus: number;
		readonly minus: number;
		readonly output: number;
		readonly bias: number | null;
	};
	readonly veeIndex?: number;
} | null {
	const declared = device.identity.declaredTerminalRoles;
	const declaredIndex = (role: string): number | null => {
		const found = declared.findIndex((value) => value === role);
		return found === -1 ? null : found;
	};
	const plus = declaredIndex("nonInverting");
	const minus = declaredIndex("inverting");
	const output = declaredIndex("output");
	if (plus === null || minus === null || output === null) {
		return null;
	}
	return {
		terminalIndices: { plus, minus, output, bias: declaredIndex("bias") },
		veeIndex: declaredIndex("supplyNegative") ?? device.parameters.veeIndex,
	};
}

/**
 * An OTA whose four signal connections come from the **DIP-8 package order** rather than from
 * anything the document states about its electrodes.
 *
 * Exported so `findUnreadableTerminalRoles` can report exactly the devices this fallback catches,
 * instead of mirroring its condition. A warning kept on a different test from the resolver it
 * guards is how a silent mis-wiring was introduced once already in this compiler, on a switch,
 * and the same shape would be available here: the fallback needs eight all-null *names*, and a
 * predicate that asked about declared roles instead would report a different set of devices.
 *
 * The assumption itself is sound and deliberate -- reading a role-less eight-terminal shell as its
 * package beats reading positions 0..3, which puts the output on pin 3. It is still an assumption
 * the source does not make, which is the whole reason it should say so out loud.
 */
export function otaPackageOrderAssumed(device: Device): boolean {
	// The declared branch of `otaTerminalBinding` decides before the package fallback is
	// reached, so a device that declares its electrodes assumes nothing and must not warn.
	// Shared with the resolver rather than restated: the first version of this predicate read
	// only the names, which meant a packet could declare every electrode correctly and still be
	// told its pins had been guessed.
	if (otaDeclaredBinding(device) !== null) {
		return false;
	}
	const names = device.identity.terminalRoles;
	return names.length === 8 && names.every((role) => role === null);
}

function otaTerminalBinding(device: Device): {
	readonly terminalIndices?: {
		readonly plus: number;
		readonly minus: number;
		readonly output: number;
		readonly bias: number | null;
	};
	readonly veeIndex?: number;
} {
	// A declared electrode decides; a name only speaks where the document declares nothing.
	const fromDeclaration = otaDeclaredBinding(device);
	if (fromDeclaration !== null) {
		return fromDeclaration;
	}

	// **The name vocabularies that used to sit here are gone.** Five sets -- plus, minus,
	// output, bias and vee -- spelled 24 ways between them, and emptying all five left every
	// one of the 142 corpus programs byte-identical with all 15 terminal bindings standing.
	// The 10 OTAs that need a binding declare their electrodes; the other 6 OTA laws are
	// registry *sections*, whose terminals the registry already selected in law order.
	//
	// A device that names none of its terminals still states its package by declaring
	// eight of them: `terminalRoleToken` maps a bare `pin1` to null on purpose, so
	// `electro-harmonix-small-stone`'s CA3094 shells arrive role-less with their pins in
	// package order. Reading that order as the package pinout is an assumption, but a far
	// better founded one than reading positions 0..3, which put the output on pin 3.
	// The names are read only for their *absence* here: `pin1`..`pin8` folds to null, which is
	// what says "this shell states a package rather than a set of electrodes".
	const names = device.identity.terminalRoles;
	if (otaPackageOrderAssumed(device)) {
		return {
			terminalIndices: {
				plus: OTA_DIP8_POSITIONS.plus,
				minus: OTA_DIP8_POSITIONS.minus,
				output: OTA_DIP8_POSITIONS.output,
				bias: OTA_DIP8_POSITIONS.bias,
			},
			veeIndex: OTA_DIP8_POSITIONS.vee,
		};
	}
	// Neither named nor a recognised package: leave the positional reading in place so a
	// registry `sections` entry, which has already mapped its own terminals, is unaffected.
	return { veeIndex: device.parameters.veeIndex };
}

/**
 * Law parameters a **registered part** contributes to a device the **source** split out of its
 * package.
 *
 * The two splits know different things and neither is sufficient alone. A registry `sections`
 * entry knows the part's numbers -- an M5218's 110 dB open-loop gain -- but decides the terminal
 * mapping by a positional *name* signature. A `devices:` declaration knows the terminals, because
 * the document states them and core scopes each role to one device, but says nothing about the
 * part. So the source decides the terminals and the registry decides the numbers.
 *
 * Measured before this existed: `boss-ch-1`'s M5218 split by declaration produced a byte-identical
 * topology -- same 151 stamps, same plus/minus/output nodes, same rails -- with `openLoopGain`
 * fallen from 316227.766 to the class default. That is the whole gap this closes.
 *
 * **Gated on `packageDeviceId`, so it cannot touch a device that reached here any other way.**
 * Widening the registry's reach over op-amps generally was tried on 2026-09-02 and measured wrong;
 * this is the opposite move, narrowed to devices whose split the source itself declared.
 *
 * Rails are excluded because they are the pedal's rather than the part's, which is the same
 * reason `sectionDevices` substitutes them. The device's own parameters win over these, so a
 * document that states a value keeps it.
 */
const LAW_KIND_BY_DEVICE_KIND: Readonly<Record<string, string>> = {
	opamp: "ideal-opamp",
	ota: "ota",
	optocoupler: "optocoupler",
};

function packageDeviceParameters(
	device: Device,
	registry: PartRegistry,
): Readonly<Record<string, number>> {
	if (device.packageDeviceId === undefined) {
		return {};
	}
	const expected = LAW_KIND_BY_DEVICE_KIND[device.kind];
	if (expected === undefined) {
		return {};
	}
	// **Matched by part id alone, deliberately not through `identify`.** That function guards the
	// registry's *terminal-mapping* use: it refuses a device whose terminal count does not equal
	// the entry's pinout length, and it refuses an op-amp that does not need registry sections at
	// all. Both are right for what they protect and both are wrong here -- a device the source
	// split out of a package has a subset of the package's pins by construction (five of the
	// M5218's eight), and it is asking for the part's numbers rather than for its own wiring.
	const partNumber = device.identity.partNumber;
	if (partNumber === null) {
		return {};
	}
	const folded = foldPartId(partNumber);
	const entry = registry.entries.find((each) =>
		each.partIds.some((id) => foldPartId(id) === folded),
	);
	const model = entry?.model;
	if (model === undefined || model.kind !== "sections") {
		return {};
	}
	const section = model.sections.find((each) => each.law.kind === expected);
	if (section === undefined) {
		return {};
	}
	const parameters: Record<string, number> = {};
	for (const [key, value] of Object.entries(section.law)) {
		if (typeof value === "number" && key !== "railHigh" && key !== "railLow") {
			parameters[key] = value;
		}
	}
	return parameters;
}

function resolveDevice(
	device: Device,
	registry: PartRegistry,
	rails: { readonly high: number | null; readonly low: number | null },
	supply: SupplyNodes,
	taperByControl: ReadonlyMap<ControlId, TaperKind>,
	mainsFrequencyHz: number | null,
	devicesTouchingNode: ReadonlyMap<NodeId, number>,
	nodeToVoltage: ReadonlyMap<NodeId, number>,
	oneHopVoltage: ReadonlyMap<NodeId, number>,
	netlist?: Netlist,
): DeviceResolution {
	// A component declared as one transistor that is really several devices in one shell. Opened
	// rather than stamped, for the reason `isNonExecutableIcSupportShell` opens an IC shell: there
	// is no single device here to describe, and a transistor law would invent one. Reported by
	// `findMultiDeviceShells`, which runs over the same predicate.
	if (isMultiDeviceTransistorShell(device)) {
		return { outcome: "law", device: device.id, law: { kind: "open" } };
	}
	// A source that states a device class we have no law for. Opened, not stamped with the
	// nearest kind the format could carry; reported by `findUnimplementedDeviceLaws`.
	if (declaresUnimplementedDeviceLaw(device)) {
		return { outcome: "law", device: device.id, law: { kind: "open" } };
	}
	if (requiresIdentification(device)) {
		if (isNonExecutableIcSupportShell(device)) {
			return openIc(device, "source-boundary-shell");
		}
		if (isElectricallyIsolated(device, devicesTouchingNode)) {
			// See `isElectricallyIsolated` -- and the warning is emitted by
			// `findElectricallyIsolatedIcs`, which compile() runs over the same predicate.
			return openIc(device, "electrically-isolated");
		}
		if (isChargePumpWithDeclaredRail(device, nodeToVoltage, oneHopVoltage)) {
			// The rail the pump generates is separately declared as a voltage-carrying
			// port; the IC itself is a view-only structural anchor, not a solved model.
			return openIc(device, "charge-pump-declared-rail");
		}
		const identity = identify(device, registry);
		if (identity === null) {
			// **The message has to say which rung failed, because two different failures land
			// here and they call for opposite fixes.** A device with no part number at all needs a
			// registry entry or a pinout. A device that NAMES a part number which matched nothing
			// has given its strongest evidence and had it rejected -- and its declared class is
			// then not allowed to supply a macro, because a macro asserts a specific chip identity
			// that the unmatched part number cannot support. Saying "declared type ... matched"
			// failed would be wrong in that second case: the class matched and was refused.
			const named = device.identity.partNumber?.trim();
			return openWhereClassPermits(
				device,
				named !== undefined && named !== ""
					? `integrated circuit has no model: its part number "${named}" matched no registry entry, and a declared class may not supply a macro for a part whose identity is unresolved`
					: "integrated circuit has no model: no registered part id, declared type or pinout signature matched",
			);
		}
		const model = registryModelFor(registry, identity, device.nodes.length);
		if (model === null) {
			return openWhereClassPermits(
				device,
				`part ${identity.partId} was identified but the registry supplies no model`,
			);
		}
		if (model.kind === "law") {
			// A registered `open` is the registry *stating* that this part has no executable
			// model, which is a different claim from every other law it can supply and the only
			// one whose consequence -- a component in the source and not in the program -- a
			// reader has to be told about.
			return model.law.kind === "open"
				? openIc(device, "registry-open")
				: { outcome: "law", device: device.id, law: model.law };
		}
		if (model.kind === "macro") {
			return resolveMacro(device, identity.partId, model.macro, registry, netlist);
		}
		// Expanded by `sectionDevices` before this runs, so reaching here is a compiler defect
		// rather than a source or registry one.
		return {
			outcome: "unsupported",
			device: device.id,
			reason: `part ${identity.partId} is multi-section and was not expanded`,
		};
	}

	// A registered part's numbers reach a source-declared device here; see
	// `packageDeviceParameters`. A no-op for every device that did not come from a `devices:`
	// declaration, which today is all of them.
	const fromRegistry = packageDeviceParameters(device, registry);
	if (Object.keys(fromRegistry).length > 0) {
		device = {
			...device,
			parameters: { ...fromRegistry, ...device.parameters },
		};
	}

	switch (device.kind) {
		case "resistor": {
			// `parametersFor` already refuses a resistor that declares no resistance at all
			// (`netlist.ts`'s `component ... resistor has no Resistance`), so reaching here with
			// `ohms === 0` means the source stated exactly zero, not that it stated nothing.
			//
			// `mxr-noise-gate-line-driver`'s `R_U1B_FB` is `Resistance: { raw: "0 Ohm", value: 0,
			// unit: "Ω" }`, described in the same document as "Direct feedback wire from U1B
			// output to negative input represented as a zero-ohm link" -- a schematic-capture
			// convention for an ideal wire, not a missing or invalid value. `1 / 0` is not
			// representable as a conductance, so this reuses `SWITCH_ON_OHMS`, the same
			// electrically-indistinguishable-from-ideal short this file already stamps for a
			// closed switch, rather than refusing a resistance the source did in fact state.
			const ohms = device.parameters.ohms ?? 0;
			if (ohms === 0) {
				return {
					outcome: "law",
					device: device.id,
					law: { kind: "conductance", siemens: 1 / SWITCH_ON_OHMS },
				};
			}
			if (!(ohms > 0)) {
				return unsupported(device, "resistor has a non-positive resistance");
			}
			return {
				outcome: "law",
				device: device.id,
				law: { kind: "conductance", siemens: 1 / ohms },
			};
		}
		case "potentiometer": {
			const ohms = device.parameters.ohms ?? 0;
			if (!(ohms > 0)) {
				return unsupported(
					device,
					"potentiometer has a non-positive resistance",
				);
			}
			if (device.control === null) {
				return unsupported(device, "potentiometer is bound to no control");
			}
			// Declared-only end resistance, and it has to fit inside the track twice: both
			// legs carry one, and a residual at or above half the track would leave the
			// wiper no travel at all (or invert it). Refused rather than clamped, because a
			// residual that large is a source error, not a value to quietly reinterpret.
			const declaredResidual = device.parameters.minOhms ?? 0;
			const residualOhms =
				declaredResidual > 0 && declaredResidual < ohms / 2
					? declaredResidual
					: 0;
			// The wiper element this device represents is decided at stamp time from
			// terminal order; the law carries the whole track plus its taper.
			return {
				outcome: "law",
				device: device.id,
				law: {
					kind: "controlled-conductance",
					control: device.control,
					// Falls back to "linear" only for a control id `netlist.controls` never
					// carried -- unreachable for a real compiled netlist, since every device
					// bound to a control puts that id there (`netlist.ts`'s `controlIds`).
					taper: taperByControl.get(device.control) ?? "linear",
					totalOhms: ohms,
					side: "upper",
					residualOhms,
				},
			};
		}
		case "rheostat": {
			const maxOhms = device.parameters.maxOhms ?? 0;
			if (!(maxOhms > 0)) {
				return unsupported(device, "rheostat has a non-positive resistance");
			}
			if (device.control === null) {
				return unsupported(device, "rheostat is bound to no control");
			}
			// A residual minimum is normal -- a pot used as a rheostat rarely reaches
			// zero -- but it must be below the track, or the sweep runs backwards.
			const declaredMin = device.parameters.minOhms ?? 0;
			const minOhms =
				declaredMin > 0 && declaredMin < maxOhms ? declaredMin : 0;
			return {
				outcome: "law",
				device: device.id,
				law: {
					kind: "controlled-resistance",
					control: device.control,
					// Same fallback note as the pot law above: unreachable in practice, since
					// `netlist.controls` always carries an entry for a bound control's id.
					taper: taperByControl.get(device.control) ?? "linear",
					minOhms,
					maxOhms,
				},
			};
		}
		case "capacitor": {
			const farads = device.parameters.farads ?? 0;
			if (!(farads > 0)) {
				return unsupported(device, "capacitor has a non-positive capacitance");
			}
			// Declared-only DC leakage; 0 means ideal, and ideal is the diagnostic default.
			// `InsulationResistance` is already a resistance. The electrolytic form is the
			// datasheet's leakage current at rated voltage read as V/I -- a linear stand-in
			// for a current that in the physical part grows sub-linearly below the rating,
			// so at a working voltage under the rating this slightly overstates the leak.
			const insulationOhms = device.parameters.insulationOhms ?? 0;
			const leakageAmps = device.parameters.leakageAmps ?? 0;
			const ratedVolts = device.parameters.ratedVolts ?? 0;
			const leakageSiemens =
				insulationOhms > 0
					? 1 / insulationOhms
					: leakageAmps > 0 && ratedVolts > 0
						? leakageAmps / ratedVolts
						: 0;
			return {
				outcome: "law",
				device: device.id,
				law: { kind: "capacitance", farads, leakageSiemens },
			};
		}
		case "inductor": {
			// A ferrite bead spec'd by impedance-vs-frequency (e.g. "100 Ω @ 100 MHz")
			// carries no inductance in the source. At audio frequencies it is a small
			// inductor well below self-resonance; 10 µH matches the corpus' only
			// decoded bead (Boss DD-3a DSS306 "103" = 10 µH).
			const henries = device.parameters.henries ?? FERRITE_BEAD_DEFAULT_HENRIES;
			return {
				outcome: "law",
				device: device.id,
				law: {
					kind: "inductance",
					henries,
					...windingResistance(device),
				},
			};
		}
		case "diode": {
			// **A catalogued tube rectifier is not a semiconductor.** Eight of the corpus's eleven
			// tube rectifiers are declared `kind: diode` while naming a tube part, and a vacuum
			// rectifier drops tens of volts where silicon drops less than one -- which sets the
			// amp's whole B+. Resolved by **exact whole part id** against the catalog, which is
			// admissible evidence; this is not the string inference the comment below rules out.
			// That one is about reading a *parameter* out of a part number's shape (`1N4733` versus
			// `1N4148`); this is a closed list of ids compared whole.
			const tubeRectifier = registryLawFor(
				registry,
				device.identity.partNumber,
				"tube-diode",
			);
			if (tubeRectifier !== null) {
				return { outcome: "law", device: device.id, law: tubeRectifier };
			}
			const catalogued = registryLawFor(
				registry,
				device.identity.partNumber,
				"diode",
			);
			if (catalogued !== null) {
				return { outcome: "law", device: device.id, law: catalogued };
			}
			const isLed = device.isLed === true;
			return {
				outcome: "law",
				device: device.id,
				law: {
					kind: "diode",
					// If it is an LED, use physical LED defaults (higher forward knee ~1.8V to 2.2V),
					// otherwise use class defaults (1N4148-ish silicon signal diode).
					saturationCurrent: device.parameters.saturationCurrent ?? (isLed ? 1e-12 : 2.52e-9),
					emissionCoefficient: 1.752,
					thermalVoltage: device.parameters.thermalVoltage ?? (isLed ? 0.05 : THERMAL_VOLTAGE),
					// 0 for an ordinary diode. Read from the source, never inferred from a part
					// number: `1N4733` is a 5.1 V zener and `1N4148` is not, and telling them apart
					// from the string is the prose matching the engineering principles forbid.
					breakdownVolts: device.parameters.breakdownVolts ?? 0,
					seriesResistance: device.parameters.seriesResistance ?? (isLed ? 2.0 : 1.0),
					isLed,
				},
			};
		}
		case "triode":
			if (device.nodes.length !== 3) {
				return unsupported(
					device,
					`triode has ${device.nodes.length} terminals, not three`,
				);
			}
			// The registry refines the class default, exactly as `GENERIC_TRIODE`'s own note
			// says it should. Exact part number only -- see `registryLawFor`.
			return {
				outcome: "law",
				device: device.id,
				law: registryLawFor(registry, device.identity.partNumber, "triode") ?? {
					kind: "triode",
					...GENERIC_TRIODE,
				},
			};
		case "pentode":
			// Four signal electrodes minimum. 8 of the corpus's 56 add a suppressor and 4 add
			// a heater as well; both are read and ignored by the lowering, because a
			// suppressor is tied to the cathode in practice and a heater carries no signal.
			if (device.nodes.length < 4) {
				return unsupported(
					device,
					`pentode has ${device.nodes.length} terminals, fewer than the four electrodes its law needs`,
				);
			}
			return {
				outcome: "law",
				device: device.id,
				law: registryLawFor(registry, device.identity.partNumber, "pentode") ?? {
					kind: "pentode",
					...GENERIC_PENTODE,
				},
			};
		case "tube-diode":
			// Two electrodes minimum. The corpus's three are all five-terminal duals -- two
			// plates, a shared cathode and two heaters -- and how many elements that becomes is
			// the lowering's question, not this one.
			if (device.nodes.length < 2) {
				return unsupported(
					device,
					`tube diode has ${device.nodes.length} terminals, fewer than a plate and a cathode`,
				);
			}
			return {
				outcome: "law",
				device: device.id,
				law: registryLawFor(registry, device.identity.partNumber, "tube-diode") ?? {
					kind: "tube-diode",
					...GENERIC_TUBE_DIODE,
				},
			};
		case "opamp": {
			const declaredRails = opampRails(device, rails, nodeToVoltage);
			const railHigh = declaredRails.high;
			const railLow = declaredRails.low;

			return {
				outcome: "law",
				device: device.id,
				law: {
					kind: "ideal-opamp",
					railHigh,
					railLow,
					openLoopGain:
						device.parameters.openLoopGain ?? DEFAULT_OPEN_LOOP_GAIN,
				},
			};
		}
		case "jack":
			return portEngage(device, supply);
		case "ground":
			// Interface and reference symbols carry no element of their own.
			return { outcome: "law", device: device.id, law: { kind: "open" } };
		case "rail": {
			// A rail is not an interface symbol. It **asserts a potential** at its node,
			// and 84 of the corpus's 90 declare that voltage. Treating it as `open`
			// deleted the supply: `ibanez-ts808` states its whole 9 V supply as one rail,
			// so every node sat at 0 V, no bias network biased anything, and the pedal
			// rendered leakage. A rail that declares no voltage is a named support shell
			// with nothing to assert, and stays open.
			const volts = device.parameters.volts;
			if (volts === undefined || !Number.isFinite(volts)) {
				return { outcome: "law", device: device.id, law: { kind: "open" } };
			}
			return {
				outcome: "law",
				device: device.id,
				law: { kind: "voltage-source", volts, sourceOhms: SUPPLY_SOURCE_OHMS },
			};
		}
		case "switch": {
			// A few amp packets encode the tremolo optocoupler shell as a three-terminal
			// `kind: switch` (`lampdrive`, `ldrsignal`, `ldrreturn`). Treat that exact
			// typed role set as the operator it is, not as a routed selector.
			if (hasExactRoleSet(device, ["lampdrive", "ldrsignal", "ldrreturn"])) {
				return {
					outcome: "law",
					device: device.id,
					law: {
						kind: "optocoupler",
						ledThresholdVolts: device.parameters.ledThresholdVolts ?? 1.6,
						ledTransconductance: device.parameters.ledTransconductance ?? 1e-3,
						ldrMinOhms: device.parameters.ldrMinOhms ?? 100,
						ldrMaxOhms: device.parameters.ldrMaxOhms ?? 1e7,
						ldrPowerLawCoefficientOhms: device.parameters.ldrPowerLawCoefficientOhms,
						ldrPowerLawExponent: device.parameters.ldrPowerLawExponent,
					},
				};
			}
			if (device.control === null) {
				return unsupported(device, "switch is bound to no control");
			}
			// Two terminals make or break; three or more route. 84 of the corpus's 118
			// wired switches have three or more, and stamping only the first two threw
			// every other throw away -- a selector silently reduced to a two-terminal
			// short, which is how a bypass switch ends up rendering the wrong path.
			return {
				outcome: "law",
				device: device.id,
				law: {
					kind: device.nodes.length > 2 ? "selector" : "switch",
					control: device.control,
					onOhms: SWITCH_ON_OHMS,
					offOhms: SWITCH_OFF_OHMS,
				},
			};
		}
		case "voltage-source": {
			const volts = device.parameters.volts ?? 0;
			// **A frequency is what makes this an AC source**, and the discriminator is the
			// presence of the parameter rather than anything in the packet's prose. Stage 1
			// writes `frequency` only when the component declares a typed `Frequency`, and a
			// battery cannot declare one, so a mains inlet and a 9 V cell are distinguishable by
			// schema shape alone. Before this, 21 of the two corpora's 122 supplies were AC by
			// their own text and every one of them compiled into a DC battery -- silently, which
			// is the failure class this pipeline refuses hardest.
			//
			// A declared **0 Hz is DC**, which is a physical reading rather than a guard: a
			// zero-frequency sine is a constant, and `amplitude * sin(0)` would hold the rail at
			// 0 V forever -- a wrong answer that renders. A negative or non-finite frequency is
			// not a waveform and falls through the same way.
			const frequency = device.parameters.frequency;
			if (
				frequency !== undefined &&
				Number.isFinite(frequency) &&
				frequency > 0
			) {
				// **Decided 2026-08-14: a typed AC-source magnitude means RMS.** This is a
				// convention this project declares, not a prose read -- the law never inspects
				// `raw`. A supply states `{raw: "120 VAC RMS assumed nominal", value: 120, unit:
				// "V"}`: the typed part is a bare magnitude, the word "RMS" lives only in `raw`,
				// and no stage may read it. Mains is quoted RMS by universal convention, and
				// every amp packet's prose agrees, so treating the typed magnitude as RMS is the
				// reading consistent with what these packets actually mean -- unlike the
				// previous reading (typed magnitude taken directly as peak), which put every
				// B+ figure from a mains inlet about 41% (`sqrt(2)`) high.
				//
				// So this law is where the declared RMS magnitude is converted to the peak
				// amplitude `AcSourceLaw.amplitudeVolts` states and the sine evaluation (here and
				// in the runtime) needs: `amplitudeVolts = volts * sqrt(2)`. Both consumers of
				// this field -- the runtime's `sin()` evaluation and the ngspice deck's `SIN`
				// amplitude parameter, which is itself peak -- read `amplitudeVolts` as peak, so
				// converting once here keeps them in agreement by construction rather than by
				// each independently reproducing the same `sqrt(2)`.
				//
				// **Escape hatch, unused today:** this conversion is unconditional because the
				// schema has no typed field distinguishing an RMS-declared supply from a
				// peak-declared one -- every AC `voltage-source` in both corpora is read as RMS.
				// If a packet is ever authored to mean peak, the source must say so through a new
				// typed field (there is none yet, so nothing exercises this branch); this law is
				// where that field would be read and the conversion skipped.
				return {
					outcome: "law",
					device: device.id,
					law: {
						kind: "ac-source",
						amplitudeVolts: volts * AC_SOURCE_RMS_TO_PEAK,
						frequencyHz: frequency,
						sourceOhms: SUPPLY_SOURCE_OHMS,
					},
				};
			}
			return {
				outcome: "law",
				device: device.id,
				law: { kind: "voltage-source", volts, sourceOhms: SUPPLY_SOURCE_OHMS },
			};
		}
		case "bjt":
			return {
				outcome: "law",
				device: device.id,
				law: {
					kind: "bjt",
					polarity: device.parameters.pnp === 1 ? "pnp" : "npn",
					saturationCurrent:
						device.parameters.saturationCurrent ?? SILICON_SATURATION_CURRENT,
					forwardBeta: device.parameters.beta ?? SILICON_FORWARD_BETA,
					reverseBeta: device.parameters.reverseBeta ?? 1,
					thermalVoltage: THERMAL_VOLTAGE,
					// Absent for every silicon part in the corpus, and for the one germanium
					// packet whose `LeakageCurrent` is a sentence rather than a value.
					leakageAmps: device.parameters.leakageAmps ?? 0,
				},
			};
		case "jfet":
			return {
				outcome: "law",
				device: device.id,
				law: {
					kind: "fet",
					channel: device.parameters.pChannel === 1 ? "p" : "n",
					// A JFET is depletion mode: it conducts at zero gate bias and pinches
					// off as the gate goes negative, so the threshold is negative.
					thresholdVolts: device.parameters.thresholdVolts ?? -2,
					transconductance: device.parameters.transconductance ?? 1e-3,
					channelLengthModulation: 0,
					// A JFET gate is a silicon PN junction, so it conducts once forward-biased.
					// Saturation current and scale are **reused from the triode grid**, which
					// `compact-mna-dynamic-triode-cell` reports 0 Newton failures with; the onset
					// is moved from a tube grid's 0.05 V to a silicon junction's 0.5 V. These are
					// not measured against any specific JFET and a registry entry should refine
					// them -- the same caveat the triode's grid defaults carry.
					gateSaturationCurrent: 1.0e-5,
					gateOnsetVolts: 0.5,
					gateScaleVolts: 0.06,
				},
			};
		case "mosfet":
			return {
				outcome: "law",
				device: device.id,
				law: {
					kind: "fet",
					channel: device.parameters.pChannel === 1 ? "p" : "n",
					// Enhancement mode: off at zero bias, so the threshold is positive.
					thresholdVolts: device.parameters.thresholdVolts ?? 2,
					transconductance: device.parameters.transconductance ?? 1e-3,
					channelLengthModulation: 0,
					// An insulated gate draws no current at any bias. Zero, deliberately: this
					// is what the law did for every FET before the JFET junction was added.
					gateSaturationCurrent: 0,
					gateOnsetVolts: 0,
					gateScaleVolts: 1,
				},
			};
		case "ota":
			return otaDeviceClassLaw(device);
		case "inverter":
			return {
				outcome: "law",
				device: device.id,
				law: {
					kind: "inverter",
					transconductance: device.parameters.transconductance ?? 5e-3,
					biasVolts: device.parameters.biasVolts ?? 4.5,
					thresholdVolts: device.parameters.thresholdVolts ?? 2.0,
				},
			};
		case "nand-gate":
			return {
				outcome: "law",
				device: device.id,
				law: {
					kind: "nand-gate",
					thresholdVolts: device.parameters.thresholdVolts ?? 2.0,
					transconductance: device.parameters.transconductance ?? 1e-3,
				},
			};
		case "clock-driver":
			return {
				outcome: "law",
				device: device.id,
				law: {
					kind: "clock-driver",
					defaultFrequency: device.parameters.defaultFrequency,
				},
			};
		case "optocoupler":
			return {
				outcome: "law",
				device: device.id,
				law: {
					kind: "optocoupler",
					ledThresholdVolts: device.parameters.ledThresholdVolts ?? 1.6,
					ledTransconductance: device.parameters.ledTransconductance ?? 1e-3,
					ldrMinOhms: device.parameters.ldrMinOhms ?? 100,
					ldrMaxOhms: device.parameters.ldrMaxOhms ?? 1e7,
					ldrPowerLawCoefficientOhms: device.parameters.ldrPowerLawCoefficientOhms,
					ldrPowerLawExponent: device.parameters.ldrPowerLawExponent,
				},
			};
		case "transformer": {
			// A spring reverb tank arrives here because that is what its shell declares -- a
			// two-terminal-pair `Circuit.Transformer` with `InputImpedance`/`OutputImpedance`.
			// The interface is right and the behaviour is not: an ideal transformer is
			// memoryless, so a tank admitted as one is a wire with a turns ratio. An exact part
			// number is the evidence that separates the two, and it is the only evidence used
			// here -- never the shell's authored `SourceBoundaryRole` prose.
			const tankPartNumber = device.identity.partNumber;
			const tank =
				tankPartNumber === null
					? undefined
					: springReverbTanks[foldPartId(tankPartNumber)];
			if (tank !== undefined) {
				return {
					outcome: "law",
					device: device.id,
					law: {
						kind: "spring-reverb",
						// Source first: the packet's own declared pair wins over the part
						// code's published figures, which are the fallback for a tank whose
						// shell states no impedances.
						inputOhms:
							device.parameters.primaryImpedanceOhms ?? tank.inputOhms,
						outputOhms:
							device.parameters.secondaryImpedanceOhms ?? tank.outputOhms,
						delaySeconds: tank.delaySeconds,
						decaySeconds: tank.decaySeconds,
						// Cost/character tradeoff, not a measured device fact: enough allpass
						// sections to disperse audibly, few enough to stay inside the sample
						// budget. Stated plainly so it is not read as a datasheet number.
						dispersionStages: 16,
					},
				};
			}
			// The source states a winding voltage in RMS, by the same project convention the
			// `ac-source` branch above records, and the conversion to peak happens here for the
			// same reason it happens there: one place, so the runtime's sine and the ngspice
			// deck's `SIN` amplitude agree by construction.
			// One entry per declared coil, in declaration order, so a transformer with two coils
			// of the same role keeps two voltages. A class-keyed record kept one.
			const windingAmplitudeVolts = (
				device.identity.declaredWindings ?? []
			).map((winding) =>
				winding.voltageRmsVolts === null
					? null
					: winding.voltageRmsVolts * AC_SOURCE_RMS_TO_PEAK,
			);
			return {
				outcome: "law",
				device: device.id,
				law: {
					kind: "transformer",
					turnsRatio: device.parameters.ratio ?? 1,
					windingAmplitudeVolts,
					mainsFrequencyHz,
					windingSourceOhms: SUPPLY_SOURCE_OHMS,
					...windingResistance(device),
				},
			};
		}
		case "logic-divider":
			return {
				outcome: "law",
				device: device.id,
				law: {
					kind: "logic-divider",
					thresholdVolts: device.parameters.thresholdVolts ?? 2.0,
					highVolts: device.parameters.highVolts ?? 5.0,
				},
			};
		case "analog-switch":
			return {
				outcome: "law",
				device: device.id,
				law: {
					kind: "analog-switch",
					onOhms: device.parameters.onOhms ?? 100.0,
					offOhms: device.parameters.offOhms ?? 1e9,
					thresholdVolts: device.parameters.thresholdVolts ?? 2.5,
				},
			};
		default:
			return unsupported(device, `device kind "${device.kind}" has no law`);
	}
}

/**
 * Source-boundary/support wrappers expressed as `ic` for topology continuity, not execution.
 *
 * These rows carry no executable device law and are deliberately represented as open circuits so
 * explicit package/boundary shells do not block execution for separately-declared active sections.
 */
/**
 * Spring reverb tanks, by exact part number.
 *
 * **Closed, and deliberately not extrapolated.** Accutronics/Belton codes are decodable --
 * `4AB3C1B` is input `A` (8 Ohm), output `B` (2250 Ohm), decay `3` (long, 2.75-4.0 s) -- but
 * decoding an arbitrary code would admit tanks nobody has checked, and a tank this table does
 * not know stays a `transformer` exactly as it is today rather than getting guessed parameters.
 * Add a row when a packet declares a tank, the same standing every `part-catalog.ts` entry has.
 *
 * The impedances here are the published figures for the code and are used only when the packet
 * declares none of its own; the four corpus packets all declare `8 Ohm`/`2250 Ohm` themselves,
 * which agrees with the code and is what actually gets used.
 */
const springReverbTanks: Readonly<
	Record<
		string,
		{
			readonly inputOhms: number;
			readonly outputOhms: number;
			readonly delaySeconds: number;
			readonly decaySeconds: number;
		}
	>
> = {
	// Accutronics type 4, the 16.75" long pan Fender used across the blackface reverb amps.
	// `delaySeconds` is the shortest of its three springs' published transit times (29/34/41 ms);
	// the runtime spreads the other two from it. `decaySeconds` is the midpoint of decay code
	// `3`'s stated 2.75-4.0 s band -- a band, so the midpoint is a choice, and it is named here
	// rather than hidden as a magic number.
	[foldPartId("4AB3C1B")]: {
		inputOhms: 8,
		outputOhms: 2250,
		delaySeconds: 0.029,
		decaySeconds: 3.375,
	},
};

/**
 * Device classes a source can *state* but this pipeline has no law for.
 *
 * **The problem this solves.** `.vdsp` carries a typed `kind` from a closed vocabulary, and that
 * vocabulary has no entry for every real device. A transcriber facing one picks the nearest kind
 * available and records the truth in the equally typed `sourceTypeName` --
 * `electro-harmonix-slapback-echo`'s `Q1_UJT` is `kind: bjt` with
 * `sourceTypeName: Circuit.UnijunctionTransistor` and `PartNumber: 2N4871`. Stamping it as a BJT
 * then models a device the source never claimed: a UJT is a negative-resistance relaxation
 * element, its `base1`/`base2` are the ends of one resistive bar rather than a collector and an
 * emitter, and no bias point makes a BJT behave like one. That packet's own `Role` for it is
 * `delay clock oscillator`, which is precisely the behaviour a BJT model cannot produce.
 *
 * **Typed evidence, compared whole.** `declaredType` is the source's own closed type vocabulary,
 * so this is a whole-value comparison against it -- not a reading of `Description`, `Role` or the
 * component name.
 *
 * **One entry, deliberately.** It is the only kind/type mismatch in the corpus that names a law
 * this pipeline lacks. Measured 2026-09-02 over all 142 packets: the other primitive-kind
 * mismatches are `circuit.led` on a `diode` (an LED *is* a diode and the law carries `isLed`) and
 * `circuit.tube` on a `diode` (the tube-rectifier-as-silicon case `diodeJunctions` already
 * documents and deliberately leaves unfiled). Every remaining mismatch sits on `kind: ic`, where
 * naming any class is exactly what that kind is for. Adding a class here on speculation would be
 * vocabulary against unexercised data.
 */
const unimplementedDeviceLaws: ReadonlySet<string> = new Set([
	"circuit.unijunctiontransistor",
]);

/** An `ic`/`power-amp` given no element, tagged with the branch that decided it. */
function openIc(device: Device, reason: OpenIcReason): DeviceResolution {
	return {
		outcome: "law",
		device: device.id,
		law: { kind: "open" },
		openReason: reason,
	};
}

/**
 * Declared component classes for which an unmodellable chip is **opened rather than refused**.
 *
 * **This is a degradation rule, not an identification rung, and the distinction is the whole
 * point.** It never says what a component *is*, produces no `PartIdentity`, and is consulted only
 * after the registry has already failed to bind a model -- so an exact part id and a fitting
 * pinout always win. `identify.ts`'s ladder is untouched.
 *
 * **What it replaced.** Until 2026-09-04 these class names sat in the `declaredTypes` of the
 * catalog's DRAM entry (`M12L64164A`), and `Circuit.IC` additionally in the uPC1252H2 VCA's, so a
 * chip the registry could not place was *identified as one of those parts* and took its law.
 * Measured: `boss-dd-3b`'s `SA571D` compandor and `electro-harmonix-holy-grail`'s `CS4811` DSP both
 * reported `partId: M12L64164A` with evidence `exact-part`, and four components reached the VCA
 * entry only by declaring the generic `Circuit.IC`. A wide `declaredTypes` net is a registry entry
 * claiming a class it does not model, which is the wrong answer `identify.ts` refuses to give:
 * "a wrong identity is worse than none". The degradation those entries were really providing is
 * this, stated as itself.
 *
 * **Sized from measurement, not from the old list.** The DRAM entry carried seventeen classes;
 * these are the seven the corpus exercises. The other ten (`Circuit.AudioCodec`, `Circuit.Codec`,
 * `Circuit.VoltageDetector`, `Circuit.SwitchingRegulator`, `Circuit.EEPROM`,
 * `Circuit.SupportChip`, `Circuit.DCDCConverter`, `Circuit.Compander`, `Circuit.PowerConverter`,
 * `Circuit.LogicIC`) are reached today only by exact part id, so listing them would be
 * speculative vocabulary against unexercised data -- and dropping them is what makes a future
 * compandor or logic IC whose pinout does not fit **refuse and name itself** rather than quietly
 * become a hole. Several of these classes have modelled members: a `Circuit.LogicIC` is often a
 * CD4049 inverter, a `Circuit.Compander` an NE570 that binds. Membership here is not a claim about
 * the class.
 *
 * **`circuit.ic` is deliberately absent**, and the tests are what settled it. It is the format's
 * generic "this is a chip", so admitting it would mean *no* unidentified chip ever refuses again --
 * it defeats the stated decision that an unknown chip makes the pedal unsupported, and it stops
 * `emptyRegistry` refusing at all, which is the measurement `--empty-registry` exists to take.
 * Four corpus components declaring it still need to compile; `namesNoPartToLookUp` is the narrower
 * reason they get instead.
 */
const classesOpenedWithoutModel: ReadonlySet<string> = new Set([
	"circuit.digitalsignalprocessor",
	"circuit.microcontroller",
	"circuit.memoryic",
	"circuit.resetsupervisor",
	"circuit.crystal",
	"circuit.sourcevisiblesubsystem",
]);

/** Whether the source states one of {@link classesOpenedWithoutModel}. */
function declaresClassOpenedWithoutModel(device: Device): boolean {
	const declaredType = device.identity.declaredType;
	return (
		declaredType !== null &&
		classesOpenedWithoutModel.has(foldToken(declaredType))
	);
}

/**
 * A component declaring the generic `Circuit.IC` and **no part number at all**.
 *
 * **This is the discriminator the failing tests produced, and it is sharper than the class.** The
 * `unknownChip` fixture declares `Circuit.IC` with `PartNumber: UNKNOWN-PART-XYZ`, and it must
 * refuse: someone fitted a real chip, the catalog does not model it, and the refusal is
 * actionable -- add the part. The four corpus components here declare `Circuit.IC` and name no
 * part, so every rung of `identify`'s ladder is empty *by construction*: there is no part id to
 * match, the class is the format's generic "this is a chip", and rung 3 sees only shell pin names
 * (`jackinput`, `codeclinrin`, `outputshellin`). A refusal nobody can act on -- there is no part
 * number to add to the catalog -- is a worse answer than an open the reader is told about.
 *
 * `jhs-clover`'s `ACTIVE_EQ_BOUNDARY` and `boss-st-2`'s three analog-support shells are the four,
 * and each is a boundary the packet drew rather than a chip it fitted. `jhs-clover`'s says so in
 * its own `SourceBoundaryStatus`, which nothing reads -- and reading it was not chosen here
 * because exactly one component in 142 documents carries that property, so it would be a rule
 * sized to one row.
 *
 * **Checked only after identification has already failed**, like the class rule beside it, so a
 * part-less component the registry *can* place by declared type -- a `Circuit.DelayMemoryChip`
 * reaching the bucket-brigade macro -- never comes near this.
 */
function namesNoPartToLookUp(device: Device): boolean {
	return (
		device.identity.partNumber === null &&
		device.identity.declaredType !== null &&
		foldToken(device.identity.declaredType) === "circuit.ic"
	);
}

/**
 * An unmodellable IC opened because its source states one of the classes above, or the refusal it
 * would otherwise have been.
 *
 * **The refusal is still the default**, and `identify.ts` records why: an `ic` has no behaviour
 * except a part's, so the registry's silence is a refusal rather than a default. What this adds is
 * that a digital or support subsystem the source declares as such does not take the whole pedal
 * down with it -- the analog circuit around a DSP is still a circuit. The suppressed refusal is
 * carried onto the resolution so the warning can say which lookup failed and how, which is the
 * half a reader can act on.
 */
function openWhereClassPermits(
	device: Device,
	refusal: string,
): DeviceResolution {
	if (!declaresClassOpenedWithoutModel(device) && !namesNoPartToLookUp(device)) {
		return { outcome: "unsupported", device: device.id, reason: refusal };
	}
	return {
		outcome: "law",
		device: device.id,
		law: { kind: "open" },
		openReason: "declared-class-without-model",
		insteadOfRefusal: refusal,
	};
}

/**
 * Does this device's source state a class this pipeline cannot model? Primitive kinds only: an
 * `ic` declares its class in `declaredType` by design and is resolved through the registry.
 */
function declaresUnimplementedDeviceLaw(device: Device): boolean {
	if (requiresIdentification(device)) {
		return false;
	}
	const declaredType = device.identity.declaredType;
	return (
		declaredType !== null &&
		unimplementedDeviceLaws.has(foldToken(declaredType))
	);
}

/**
 * The devices opened by `declaresUnimplementedDeviceLaw`, so a packet is told which stated device
 * is absent from its program rather than silently receiving the nearest law.
 */
export function findUnimplementedDeviceLaws(
	lawed: LawedNetlist,
): readonly UnimplementedDeviceLawWarning[] {
	const opened = new Set(
		lawed.resolutions.flatMap((resolution) =>
			resolution.outcome === "law" && resolution.law.kind === "open"
				? [resolution.device]
				: [],
		),
	);
	return lawed.netlist.devices.flatMap((device) =>
		opened.has(device.id) && declaresUnimplementedDeviceLaw(device)
			? [
					{
						code: "device-law-not-implemented" as const,
						device: device.id,
						detail:
							`${device.id} is declared \`kind: ${device.kind}\` but its source states ` +
							`${device.identity.declaredType}, a device class this pipeline has no law for. ` +
							"It is not executed: modelling it as its declared kind would simulate a different " +
							"device, so whatever it does in the real circuit is absent from this program.",
					},
				]
			: [],
	);
}

function isNonExecutableIcSupportShell(device: Device): boolean {
	const declaredType =
		device.identity.declaredType === null
			? null
			: foldToken(device.identity.declaredType);

	if (
		declaredType === "circuit.opamp" &&
		hasExactRoleSet(device, ["sectiona", "sectionb", "vplus", "vminus"])
	) {
		return true;
	}

	if (
		declaredType === "circuit.audiocodec" &&
		(hasExactRoleSet(device, ["analoginputshell", "adcboundary"]) ||
			hasExactRoleSet(device, ["dacboundary", "analogoutputshell"]))
	) {
		return true;
	}

	if (
		declaredType === "circuit.logicic" &&
		hasExactRoleSet(device, ["vcc", "gnd"])
	) {
		return true;
	}

	if (
		declaredType === "circuit.poweramp" ||
		declaredType === "circuit.reverb" ||
		declaredType === "circuit.module"
	) {
		return true;
	}

	if (
		(declaredType === "circuit.ic" || declaredType === "circuit.ota") &&
		(foldToken(device.identity.partNumber ?? "") === "ir3109" ||
			foldToken(device.identity.partNumber ?? "") === "jhscloveractiveeqboundary")
	) {
		return true;
	}

	const partNumberFolded = foldToken(device.identity.partNumber ?? "");
	if (
		partNumberFolded.startsWith("preampsupportnetwork") ||
		partNumberFolded === "slp24b" ||
		partNumberFolded === "slp24bleds" ||
		partNumberFolded === "ce1powertransformer" ||
		partNumberFolded === "ta7504s"
	) {
		return true;
	}

	return false;
}

function hasExactRoleSet(
	device: Device,
	roles: readonly string[],
): boolean {
	if (device.identity.terminalRoles.length !== roles.length) {
		return false;
	}
	const observed = new Set<string>();
	for (const role of device.identity.terminalRoles) {
		if (role === null) {
			return false;
		}
		observed.add(foldToken(role));
	}
	for (const role of roles.map((entry) => foldToken(entry))) {
		if (!observed.has(role)) {
			return false;
		}
	}
	return true;
}

function unsupported(device: Device, reason: string): DeviceResolution {
	return { outcome: "unsupported", device: device.id, reason };
}

/**
 * A jack is a pure interface symbol until a **supply runs through it**. Then it is a
 * switch in the supply path, and `open` severs the supply.
 *
 * Which terminal the contact makes against is derived from *which end of the supply is
 * stranded*, never from the contact's name. The corpus names these contacts eleven ways
 * and they do not share a sense, so a name table gets two of three wrong -- it shorted 13
 * jacks, five of them supply rails. Two cases are derivable, and they are mirror images:
 *
 *   A. A supply **return** sits on a jack terminal. It has to reach the jack's own
 *      return or the supply has no path back. `boss-hm-2` and `boss-sp-1-spectrum` put
 *      the battery negative on the input jack's switch contact; without this the whole
 *      circuit floats and renders leakage. 15 jacks.
 *   B. A supply **drive** sits on a jack terminal whose node carries nothing but that
 *      supply and this jack, so the rail is stranded behind the contact and must reach
 *      the jack's remaining terminal. `boss-od-3` routes its 9 V to the pedal only
 *      through the DC jack's contact -- `BATTERY.positive` and `DC_JACK.tip` alone on
 *      node 45, the circuit rail on node 1 with 13 devices -- so without this the entire
 *      pedal compiles into a block with no voltage source and Newton burns its whole
 *      iteration cap every sample hunting an operating point that cannot exist. 3 jacks.
 *
 * The direction is not fixed and does not need to be: `boss-od-3` has the supply on the
 * tip and the circuit on the contact, `boss-ce-5` has it the other way round, and joining
 * the stranded end to the remaining terminal is right for both.
 *
 * Everything else stays open. A `switched_tip` or a `normalSwitch` carrying signal has a
 * sense that depends on a plug state the packet does not state, and no structural fact
 * distinguishes them -- so guessing would short a signal rather than leave it unmodelled.
 */
function portEngage(device: Device, supply: SupplyNodes): DeviceResolution {
	const open: DeviceResolution = {
		outcome: "law",
		device: device.id,
		law: { kind: "open" },
	};
	const returnIndex = portReturnIndex(device);
	if (returnIndex === -1) {
		return open;
	}
	const engage = (contactIndex: number, toIndex: number): DeviceResolution =>
		// Already the same node: the path exists and an element would be a dead short
		// across nothing.
		device.nodes[contactIndex] === device.nodes[toIndex]
			? open
			: {
					outcome: "law",
					device: device.id,
					law: { kind: "port-engage", contactIndex, againstIndex: toIndex },
				};

	const strandedReturn = device.nodes.findIndex(
		(node, index) => index !== returnIndex && supply.returns.has(node),
	);
	if (strandedReturn !== -1) {
		return engage(strandedReturn, returnIndex);
	}

	const strandedDrive = device.nodes.findIndex(
		(node, index) =>
			index !== returnIndex &&
			supply.drives.has(node) &&
			// Stranded means the node carries only the supply end and this jack terminal.
			// A drive that already reaches the circuit needs no help, and closing a contact
			// onto it would bridge two live nodes.
			(supply.degree.get(node) ?? 0) <= 2,
	);
	if (strandedDrive === -1) {
		return open;
	}
	const onward = device.nodes
		.map((node, index) => ({ node, index }))
		.filter(
			({ node, index }) =>
				index !== returnIndex &&
				index !== strandedDrive &&
				node !== device.nodes[returnIndex],
		);
	// More than one candidate is a genuine ambiguity, not a tie to break: `boss-ch-1`
	// declares `adapter_positive`, `battery_positive` and `switched_positive` on one jack,
	// and picking between them would be guessing which is wired to the pedal.
	const only = onward.length === 1 ? onward[0] : undefined;
	return only === undefined ? open : engage(strandedDrive, only.index);
}

// The taper *curve* deliberately does not live here. A pot's law carries which taper it
// is; evaluating it is `src/runtime/taper.ts`, so no compiler stage can fold a control
// curve into a coefficient even by accident. See decision 2 in the pipeline plan.

/**
 * Every integrated circuit the source declares and the program does not execute.
 *
 * **A residue reporter, deliberately.** It does not ask the five opening predicates their
 * questions again -- it reads the reason `resolveDevice` recorded when it chose the `open`. So a
 * sixth opening path added later is reported the day it is added, as `unrecorded`, instead of
 * joining the silent class this exists to close; and no copy of a resolver's question can drift
 * from the resolver, which is the defect that bit this file twice on 2026-09-03.
 *
 * `electrically-isolated` is excluded because `findElectricallyIsolatedIcs` already names those
 * devices and says more about them than this could. The exclusion is on the recorded decision, not
 * on a re-run of `isElectricallyIsolated`, for the reason above.
 *
 * Runs after section expansion, which is what makes it safe: a package the registry could expand
 * is no longer in `lawed.netlist.devices` at all, so a working dual op-amp cannot appear here.
 * Non-IC opens are out of scope and stay so -- a ground symbol and an unwired jack contact carry
 * no element because the symbol has none, which is not a hole in the model.
 */
export function findIcsNotExecuted(
	lawed: LawedNetlist,
	original: Netlist,
): readonly IcNotExecutedWarning[] {
	// **One device, one warning, and isolation is the half that speaks.** A chip sharing no net
	// with anything is not a modelling question -- no entry at any terminal count would connect
	// it -- so where `findElectricallyIsolatedIcs` already names a device, this stays quiet.
	// `boss-oc-3`'s `SRC_AK4552VT` carried both: every one of its twenty pins is a private node,
	// and it reached the pinout check only because section expansion runs before the isolation
	// branch in `resolveDevice`. Counted over `original` -- the same pre-expansion netlist the
	// isolation reporter reads -- so the two cannot disagree about the same device.
	const devicesTouchingNode = deviceCountByNode(original);
	const openById = new Map(
		lawed.resolutions.flatMap((resolution) =>
			resolution.outcome === "law" && resolution.law.kind === "open"
				? [[resolution.device, resolution] as const]
				: [],
		),
	);
	const warnings: IcNotExecutedWarning[] = [];
	for (const device of lawed.netlist.devices) {
		if (!requiresIdentification(device)) {
			continue;
		}
		const resolution = openById.get(device.id);
		if (resolution === undefined || resolution.outcome !== "law") {
			continue;
		}
		const reason = resolution.openReason;
		if (
			reason === "electrically-isolated" ||
			isElectricallyIsolated(device, devicesTouchingNode)
		) {
			continue;
		}
		// Names the chip by the hardest evidence the document carries, because that is what a
		// reader needs to look it up: a part number where there is one, the declared class where
		// there is not.
		const named =
			device.identity.partNumber ?? device.identity.declaredType ?? "unnamed";
		const head = `${device.kind} ${device.id} (${named}) is in the source and not in the program`;
		// **How much of it is wired at all**, appended to the arity reason because it decides which
		// half of that reason's advice applies. A pin on a node no other device touches cannot be
		// connected by any registry entry, so where most of a component's terminals are private the
		// gap is a source trace and adding a catalog entry at this count would produce stamps that
		// cannot affect the circuit. Measured on the AK4552VT codecs: every one of them, at every
		// arity the corpus declares, has all four of its analog pins on private nodes -- including
		// the two the catalog already models, whose buffers stamp into nothing.
		const privatePins = device.nodes.filter(
			// Literal 0 for ground, as `isElectricallyIsolated` writes it just above.
			(node) => node !== 0 && (devicesTouchingNode.get(node) ?? 0) <= 1,
		).length;
		const wiring =
			privatePins === 0
				? ""
				: ` ${privatePins} of its ${device.nodes.length} terminals sit on nodes no other component touches, which no registry entry can connect.`;
		warnings.push({
			code: "ic-not-executed",
			device: device.id,
			reason: reason ?? "unrecorded",
			detail:
				reason === "source-boundary-shell"
					? `${head}: it is registered as a source-boundary shell, drawn for topological continuity rather than execution, so it is compiled as open.`
					: reason === "charge-pump-declared-rail"
						? `${head}: it is a charge pump whose generated rail the document declares separately, so the rail is modelled and the pump itself is compiled as open.`
						: reason === "registry-arity-mismatch"
					? `${head}: ${resolution.insteadOfRefusal ?? "its registry entry could not bind the declared terminals"}. The part is registered, so this is an arity disagreement rather than an unknown chip: either the document declares a shell rather than the part's own pins, or the catalog needs an entry at this terminal count.${wiring} It is compiled as open rather than refusing the pedal.`
					: reason === "registry-open"
							? `${head}: the registry states no executable model for it and it is compiled as open. Whatever it does in the real circuit is absent.`
							: reason === "declared-class-without-model"
								? `${head}: no registered part model binds it -- ${resolution.insteadOfRefusal ?? "the registry supplied none"} -- and ${
										device.identity.partNumber === null
											? `its source names no part number and declares only the generic ${device.identity.declaredType}, so there is nothing to look up`
											: `its source declares ${device.identity.declaredType}, a class this pipeline opens rather than refusing the pedal for`
									}. Fixing it means a registry entry, a pinout that fits, or a packet correction.`
								: `${head}: it was compiled as open by a path that records no reason, so this cannot say which. A new opening branch in \`resolveDevice\` needs to tag itself.`,
		});
	}
	return warnings;
}

/**
 * The loud half of `isElectricallyIsolated`: every identification-requiring device whose
 * nodes are all private got an `open` law instead of a refusal, and each one is named here
 * so a cluster isolated by a wiring mistake rather than by intent is never silently
 * swallowed. Runs over the ORIGINAL netlist (pre-section-expansion), because isolation is a
 * property of the drawn component, not of a registry section.
 */
export function findElectricallyIsolatedIcs(
	netlist: Netlist,
): readonly ElectricallyIsolatedIcWarning[] {
	const devicesTouchingNode = deviceCountByNode(netlist);
	const warnings: ElectricallyIsolatedIcWarning[] = [];
	for (const device of netlist.devices) {
		if (!requiresIdentification(device)) {
			continue;
		}
		if (!isElectricallyIsolated(device, devicesTouchingNode)) {
			continue;
		}
		warnings.push({
			code: "electrically-isolated-ic",
			device: device.id,
			detail:
				`component ${device.id} shares no net with any other component, so it is treated ` +
				`as a view-only block and compiled as open. If that is a wiring mistake rather ` +
				`than a declared boundary, the source needs the missing nets, not a device model.`,
		});
	}
	return warnings;
}
