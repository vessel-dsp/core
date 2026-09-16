// Stage 1: `.vdsp` source text -> Netlist.
//
// This is the only stage permitted to touch the format libraries, and the only stage
// that ever sees geometry, names or prose. Everything it does not put into the
// Netlist is unreachable from every later stage, which is the whole point: the
// evidence discipline is a property of the type, not a rule someone has to follow.
//
// Dropped here, permanently: origins, rotation, flip, terminal coordinates, wires,
// panel layout, appearance, component names, Description, Role, and every other
// free-text field. Kept: typed kinds, resolved nodes, parameters as numbers,
// controls, and the closed identity evidence stage 2 needs.
//
// Node precedence, stated once: the document-level `nodes:` ledger is authoritative when
// present for a terminal; the terminal's inline `node:` is fallback where the ledger is
// absent; geometry resolves only what neither encoding states. Geometry is used to
// *resolve* nodes and is then discarded -- no coordinate survives into the Netlist, so no
// later stage can accidentally derive connectivity from one.

import {
	type ParsedQuantity,
	type PropertyValue,
	componentDevices,
	deviceTerminalRoles,
	parseInterchangeYamlWithTopology,
} from "@vessel-dsp/core";
import { load as loadYaml } from "js-yaml";
import { StageRefusal } from "./errors";
import { foldToken } from "./registry";
import { speakerOnePort } from "./speaker-load";
import {
	type CompileWarning,
	type Control,
	type DeclaredWinding,
	type DeclaredWindingImpedance,
	type Device,
	type DeviceId,
	type DeviceKind,
	GROUND,
	type Netlist,
	type NodeId,
	type TaperKind,
} from "./types";

export class NetlistError extends StageRefusal {
	constructor(
		message: string,
		device: DeviceId | null = null,
		cause?: unknown,
	) {
		super("netlist", device, message, cause);
	}
}

/** Source component kinds that map to a device the compiler models. */
const deviceKindByComponentKind: Readonly<Record<string, DeviceKind>> = {
	resistor: "resistor",
	capacitor: "capacitor",
	inductor: "inductor",
	diode: "diode",
	led: "diode",
	potentiometer: "potentiometer",
	// A rheostat, not a pot. Every one of the corpus's variable-resistors has exactly
	// two terminals, so aliasing it to `potentiometer` refused all of them for want of
	// a wiper the device does not have.
	"variable-resistor": "rheostat",
	opamp: "opamp",
	// 126 of the 24 canonical amp documents' tube instances are triodes, and every one of
	// those documents refused at this table until now.
	triode: "triode",
	pentode: "pentode",
	// Three instances across the 24 amp documents, and all three are **dual** rectifiers:
	// `plate_a`, `plate_b` and one shared `cathode_filament`. See `tubeDiodeElements`.
	"tube-diode": "tube-diode",
	bjt: "bjt",
	jfet: "jfet",
	mosfet: "mosfet",
	transformer: "transformer",
	"voltage-source": "voltage-source",
	battery: "voltage-source",
	jack: "jack",
	ground: "ground",
	rail: "rail",
	switch: "switch",
	// **A fuse is a resistor, not a switch** (`kind: fuse`, core 0.6.38). It conducts until it
	// opens once and nothing operates it, so it has no control to bind and no throw to select.
	// Mapping it here is also what stops it being offered as one: the control fallback in
	// `controlIdFor` fires for `potentiometer`, `rheostat` and `switch`, and a resistor is none
	// of those -- so `vox-ac30-top-boost`'s four fuses stop arriving as knobs a player can sweep,
	// with no property read and no spelling table.
	fuse: "resistor",
	ic: "ic",
	bbd: "ic",
	"delay-ic": "ic",
	flipflop: "ic",
	"analog-switch": "analog-switch",
	regulator: "ic",
	"power-converter": "ic",
	ota: "ota",
	// **Its own kind, not `ic`.** An optocoupler carries a universal device-class law -- an LED
	// driving a photoresistor -- so an unregistered one must still work, exactly as an `ota` does.
	// Mapping it to `ic` made the registry the only source of its behaviour, which is right for a
	// VTL5C1 and wrong for the discrete neon/LDR pair in the Fender tremolo circuits: they name no
	// part to look up, so they resolved to `open` and the tremolo was silent unless something read
	// their terminal *names*. See `mayCarryRegistrySections`, which is what keeps the 13 packets
	// whose optocouplers *are* registry parts resolving through their sections.
	// A logic gate names itself as of `@vessel-dsp/core@0.6.39`, so a hex inverter can declare its
	// six gates as devices instead of depending on a registry entry keyed on the part number to
	// split it. The device kind, the law and the stamp all already existed; only the source had no
	// way to say the word.
	inverter: "inverter",
	optocoupler: "optocoupler",
	"power-amp": "power-amp",
};

/**
 * Kinds that carry no electrical behaviour and are dropped rather than modelled.
 *
 * `port` is here because a schematic port is usually an annotation — a sheet connector, a test
 * point, a name for a net. **But a port that declares a typed `Voltage` is a rail**, and dropping
 * those cost the corpus 76 of them across 39 packets, 24 of which compile: `boss-sd-1`'s
 * `VBIAS_IN` sits on node 4 with `{raw: "4.5 V", value: 4.5, unit: "V"}` and the description
 * "SD-1 virtual half-supply bias rail", and `klon-centaur` loses 4.5 V, 18 V and -9 V at once.
 *
 * The consequence was not a refusal but a *wrong answer that renders*: the bias resistor's far end
 * became a node nothing else touched, the stage sat unbiased, the pedal went silent, and
 * `active-device-terminal-unwired` reported the terminal as unwired. Several packets were filed as
 * source omissions on the strength of that.
 *
 * See `promotedKindFor` for how the decision is made, and note that it is the *presence of a typed
 * property*, never the component's name or description — both of which say "rail" here and must
 * stay unread.
 */
const ignoredComponentKinds = new Set([
	"label",
	"named-wire",
	"display",
	"port",
	"unsupported",
]);

/**
 * Terminal roles that name an op-amp's driven output.
 *
 * An op-amp output forces its node exactly as a supply does, so it counts as a potential the
 * circuit already generates. **Only the output**: an op-amp's inputs draw no current and assert
 * nothing, and treating all three terminals as driven would suppress the promotion `boss-sd-1`
 * needs, whose `VBIAS_OP` reaches an op-amp *input* through its bias resistor.
 *
 * Missing this cost `boss-bd-2-blues-driver` and its Keeley mod a `node-driven-by-two-sources`
 * warning apiece: their promoted rail landed on a node an op-amp output already drove.
 */
const opampOutputRoles: ReadonlySet<string> = new Set([
	"out",
	"output",
	"vout",
]);

/**
 * Role tokens naming an op-amp's **supply** pin, folded as `terminalRoleToken` leaves them.
 *
 * An op-amp is powered by its rails: a rail is an input to every op-amp that touches it, and no
 * op-amp *output* generates one. `generated()` below uses this to stop the op-amp-output branch
 * from certifying a supply node.
 *
 * Built from an exhaustive census of every op-amp terminal-role token the corpus declares.
 * Excludes `vplus`/`vminus` -- and the original justification for that ("`lower.ts`'s
 * `opampInputRoles` documents them as this corpus's input spelling") did not survive a sharper
 * census: checked against each op-amp's *full* role set (2026-08-25, `device-laws.ts`'s
 * `opampRails`), those spellings are supply rails in all 60 corpus devices that declare them.
 * The exclusion is kept anyway, on a different and honest ground: leaving them out only
 * *narrows* the no-generate guard below, which is the safe direction, and widening it changes
 * which rails `generated()` protects -- a behaviour change that needs its own corpus
 * measurement, not a comment edit. The numbered `vpluspin8`/`vminuspin4` ARE included, because
 * pins 8 and 4 of a dual op-amp are unambiguously its rails. `v+`/`v` (folded from `v-`) is
 * `boss-ce-2`'s supply pair under that document's own naming.
 */
const opampSupplyRoles: ReadonlySet<string> = new Set([
	"vcc",
	"vee",
	"vccpin8",
	"veepin4",
	"vpluspin8",
	"vminuspin4",
	"positivesupply",
	"negativesupply",
	"supply",
	"v+",
	"v",
]);

/**
 * DC-conducting device kinds, for asking whether a node's potential is already generated.
 *
 * Exported so `lower.ts` can reuse the identical evidence class for a pot's orientation --
 * which end sits electrically closer to a quiet DC reference -- rather than defining a second,
 * possibly-drifting closed set for the same question of "what conducts a steady current here".
 */
export const dcConductingKinds: ReadonlySet<string> = new Set([
	"resistor",
	"potentiometer",
	"rheostat",
	"inductor",
	"switch",
	"selector",
]);

/**
 * A rectifier's electrode roles, coarsened to just "supply-side" and "load-side", for the single
 * question `voltagePortRails` asks: does current reach this node from somewhere already asserted?
 *
 * **A fresh, deliberately coarser copy of `lower.ts`'s `diodeTerminalRoles` /
 * `tubeDiodeTerminalRoles`, not an import.** Those tables answer a harder question -- exactly how
 * many junctions a component is and which pairs they connect, needed to lower a bridge or a
 * shared-cathode pack to the right elements -- and live in `lower.ts`, which already imports
 * `dcConductingKinds` from this file; importing the other way would be a cycle. This table only
 * needs "which terminals are upstream (anode/plate/AC leg) and which are downstream (cathode/DC
 * leg)", which every one of those roles already answers unambiguously, so one closed table
 * covering both `diode` and `tube-diode` roles is enough here.
 */
const rectifierElectrodeRoles: Readonly<Record<string, "supply" | "load">> = {
	anode: "supply",
	anodea: "supply",
	anodeb: "supply",
	redanode: "supply",
	greenanode: "supply",
	plate: "supply",
	platea: "supply",
	plateb: "supply",
	aca: "supply",
	acb: "supply",
	acleft: "supply",
	acright: "supply",
	cathode: "load",
	cathodefilament: "load",
	positive: "load",
	positiveraw: "load",
	negative: "load",
	negativeraw: "load",
};

/**
 * Ports that assert a potential nothing else in the circuit can generate, as rail devices.
 *
 * **A voltage-carrying port is not always a rail, and getting that wrong regresses the corpus.**
 * `ibanez-ts808` declares `VBIAS_4V5` at 4.5 V on node 3, and that node already reaches the 9 V
 * supply through the divider the packet models — so the port *documents* a node the circuit makes
 * for itself, and forcing an ideal source there double-drives it. Measured: promoting every
 * voltage port took parity from 33 agrees to 31 and turned both Tube Screamers from `agrees` into
 * `both silent`, with 8 A of supply draw.
 *
 * `boss-sd-1` is the opposite and is why this exists at all. Its `VBIAS_IN` sits on node 4, which
 * **reaches no supply through any conductor**, so nothing in the modelled circuit can put a
 * potential there. Dropping it left the bias resistor's far end touched by one terminal, the stage
 * unbiased, the pedal silent, and `active-device-terminal-unwired` reporting a dangling terminal
 * that is not dangling in the source.
 *
 * So the test is whether the node's potential is *already generated*, which is a topological
 * question with no ratio in it — unlike bias adequacy, where two structural rules were measured
 * and rejected.
 *
 * **A rectifier output is generated too, decided 2026-08-14 and added the same way.** A B+
 * reservoir fed only through a `diode` or `tube-diode` used to read as ungenerated, because
 * neither kind conducts DC the way `dcConductingKinds`' set does -- so 94 typed-`Voltage` ports
 * across 21 of 24 amp documents were promoted to ideal rails, deleting the rectifier/reservoir
 * supply that actually feeds them (measured: rail 0.78 V high, ripple suppressed 3.7x, the
 * rectifier passing a thirteenth of the current, no warning). The fix is directional and
 * one-way on purpose -- a load-side (cathode) node may reach back to its supply-side (anode)
 * node, never the other way -- because a rectifier only conducts anode-to-cathode: treating it
 * as bidirectional would let an unrelated node on a diode's load side (a clipping diode's
 * return, a ground reference) retroactively call the *supply* side "generated", which is the
 * same over-broad promotion shape that took parity from 33 to 31 above. This is additive to
 * that history, not a repeat of it: it recognises one more thing that already generates a
 * node's potential, it does not stop checking whether one does.
 *
 * Deduplicated per node: `marshall-blues-breaker` declares `V2`, `V3`, `V4` and `V5` all at 4.5 V
 * on node 7, and four ideal sources on one node is the over-determined system
 * `node-driven-by-two-sources` exists to name.
 *
 * **An op-amp output is only an anchor if reaching it does not loop back through its own other
 * terminals, found 2026-08-14.** `jhs-morning-glory`'s `VBIAS` and `vemuram-jan-ray`'s `VREF` are
 * each declared exactly the `boss-sd-1` way -- a typed-`Voltage` port with no independently-wired
 * divider -- and each was silently not promoted, because the BFS below reached that op-amp's own
 * output through a resistor network that passes back through that *same* op-amp's own input
 * first. That is the BFS re-entering through the device it started from: an op-amp's output is a
 * *dependent* source (a function of its own inputs), so proving a candidate node can reach it by a
 * path that runs through the op-amp's own terminals proves nothing about independent generation --
 * `render:v2 --bias` shows both islands settle away from their declared value (one collapses to
 * millivolts, one to a flat ~3.8 V blob), and both still "agree" with ngspice, because the parity
 * deck is emitted from this same program and inherits the same missing rail. Full trace in
 * `docs/troubleshootings/vbias-vref-ports-not-promoted-through-a-self-referential-opamp-loop.md`.
 *
 * Asking the same question of `loadToSupply` and `windingCoupling` beside it: neither is exposed,
 * because neither adds one of *its own* device's nodes to `asserted` the way the op-amp rule does
 * -- both only add edges (extended reachability), so there is nothing for either rectifier or
 * transformer to circularly assert about itself. The op-amp rule is the only one of the three that
 * claims one of its own terminals is independently generated, so it is the only one that needs
 * this guard.
 */
function voltagePortRails(
	components: readonly ComponentLike[],
	devices: readonly Device[],
	nodeOf: (id: string, terminal: string, index: number) => NodeId | null,
): readonly Device[] {
	const asserted = new Set<NodeId>();
	/**
	 * An op-amp output node, mapped to every *other* node that same op-amp device touches.
	 *
	 * Ground (node 0) is excluded from the exclusion set for the same reason `loadToSupply` and
	 * `windingCoupling` exclude it from their own maps: node 0 is the one node every unrelated
	 * grounded device in the document shares, so barring it as a pass-through would block unrelated
	 * legitimate paths, not just this op-amp's self-reference. Real independent sources (a
	 * `voltage-source`/`rail` node, including this same op-amp's own `vcc`/`vee` pins, which are
	 * ordinarily wired to one) are never excluded either: they are checked by the unconstrained walk
	 * below before any op-amp-specific exclusion applies, so barring them here would only weaken
	 * this op-amp's own reachability check, never the independent-source one.
	 */
	const opampSelfTerminals = new Map<NodeId, ReadonlySet<NodeId>>();
	const opampSupplyNodes = new Set<NodeId>();
	/**
	 * Nodes an op-amp *input* terminal sits on.
	 *
	 * **No op-amp input generates the potential it is handed.** The docstring on
	 * `opampOutputRoles` already states the half of this that concerns one op-amp's own
	 * terminals -- "an op-amp's inputs draw no current and assert nothing" -- but the
	 * per-op-amp exclusion below only bars *that* op-amp's nodes, so a second op-amp's output,
	 * reached through the network, still certified the first one's reference and the port on it
	 * was dropped. Every dual op-amp sharing one half-supply bias rail is that shape.
	 *
	 * Measured 2026-09-10 by compiling every packet that declares a voltage port and asking
	 * which ports never reach a `dc-source` stamp: 10 of 15 across 6 packets were dropped, and
	 * **two** of them are this class -- `analog-man-prince-of-tone` (`VB` 4.5 V) and
	 * `klon-centaur` (`VBPLUS_RAIL` 4.5 V), each a half-supply port declared **on** an op-amp's
	 * non-inverting input. What that costs is not a refusal but a wrong answer that renders: the
	 * bias node floats, the stage biases itself against a rail through its own feedback network,
	 * audio still crosses the packet through the passives, and every control reads flat.
	 * `analog-man-prince-of-tone` measured 0.0 dB on all four knobs at an output within 2% of
	 * its input, and was carried in the ledger as one of two packets whose whole panel is dead
	 * with *no* structural explanation.
	 *
	 * The other eight dropped ports are **not** this and are deliberately left dropped: they are
	 * packet-side. `boss-sp-1-spectrum` declares `Voltage: 4.5V nominal`, which is not a
	 * quantity, so its port is skipped before this guard is ever consulted -- the same shape as
	 * `boss-ce-1`'s three MN3002 bias ports and `boss-dd-3a`'s two. Naming that here keeps the
	 * two causes apart: this guard recovers a port the document declared correctly, and it
	 * cannot recover one the document did not.
	 *
	 * Read from `declaredTerminalRoles` -- the same evidence `lower.ts`'s `opampTerminals` uses
	 * to place the stamp -- rather than a second folded-token set beside `opampSupplyRoles`,
	 * because two vocabularies for one question are how the pin maps drifted.
	 *
	 * Ordered after the unconstrained walk in `generated()`, exactly as `opampSupplyNodes` is: a
	 * bias node genuinely fed by a real independent source is still found by that walk and still
	 * left unforced, so this can only narrow the guard, never overrule a real supply.
	 */
	const opampInputNodes = new Set<NodeId>();
	for (const device of devices) {
		if (device.kind === "voltage-source" || device.kind === "rail") {
			for (const node of device.nodes) {
				if (node !== 0) {
					asserted.add(node);
				}
			}
			continue;
		}
		if (device.kind !== "opamp") {
			continue;
		}
		device.identity.terminalRoles.forEach((role, index) => {
			const node = device.nodes[index];
			if (
				role !== null &&
				opampSupplyRoles.has(role) &&
				node !== undefined &&
				node !== 0
			) {
				opampSupplyNodes.add(node);
			}
			if (
				role !== null &&
				opampOutputRoles.has(role) &&
				node !== undefined &&
				node !== 0
			) {
				const own = new Set<NodeId>();
				for (const other of device.nodes) {
					if (other !== node && other !== 0) {
						own.add(other);
					}
				}
				opampSelfTerminals.set(node, own);
			}
		});
		device.identity.declaredTerminalRoles.forEach((role, index) => {
			const node = device.nodes[index];
			if (
				(role === "nonInverting" || role === "inverting") &&
				node !== undefined &&
				node !== 0
			) {
				opampInputNodes.add(node);
			}
		});
	}
	const adjacency = new Map<NodeId, NodeId[]>();
	for (const device of devices) {
		if (!dcConductingKinds.has(device.kind)) {
			continue;
		}
		for (let i = 0; i < device.nodes.length; i += 1) {
			for (let j = i + 1; j < device.nodes.length; j += 1) {
				const a = device.nodes[i] as NodeId;
				const b = device.nodes[j] as NodeId;
				if (a === b) {
					continue;
				}
				adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
				adjacency.set(b, [...(adjacency.get(b) ?? []), a]);
			}
		}
	}
	// A rectifier's load-side (cathode) node may step back to its supply-side (anode) node --
	// never the reverse, see `rectifierElectrodeRoles` above. Kept as its own directed map rather
	// than folded into `adjacency`, which is symmetric by construction.
	//
	// Ground (node 0) excluded from both roles, for the same reason the transformer coupling
	// below excludes it: a bridge's DC-negative leg is routinely grounded, and node 0 is the one
	// node every unrelated device in the whole document can share, so keying or targeting an
	// edge on it would let an unrelated node that merely touches ground borrow a rectifier's
	// supply-side status through no real conduction path at all.
	const loadToSupply = new Map<NodeId, NodeId[]>();
	for (const device of devices) {
		if (device.kind !== "diode" && device.kind !== "tube-diode") {
			continue;
		}
		const supplyNodes: NodeId[] = [];
		const loadNodes: NodeId[] = [];
		device.identity.terminalRoles.forEach((role, index) => {
			const node = device.nodes[index];
			if (node === undefined || node === 0 || role === null) {
				return;
			}
			const electrode = rectifierElectrodeRoles[role];
			if (electrode === "supply") {
				supplyNodes.push(node);
			} else if (electrode === "load") {
				loadNodes.push(node);
			}
		});
		for (const load of loadNodes) {
			for (const supply of supplyNodes) {
				if (load === supply) {
					continue;
				}
				loadToSupply.set(load, [...(loadToSupply.get(load) ?? []), supply]);
			}
		}
	}
	// A transformer winding may borrow generated status from another winding of the *same*
	// transformer that is itself supply-reachable -- decided 2026-08-14, alongside the
	// rectifier fix above. "Conducts DC" and "generates this node's potential" are different
	// questions: a transformer is correctly excluded from `dcConductingKinds` because it does
	// not conduct DC (galvanic isolation is real), but generating a secondary's potential from a
	// primary's is the device's entire function, so it must count for *this* question.
	//
	// Deliberately **not** read from `primary`/`secondary` role names: those are terminal labels,
	// not evidence of which side drives the other (a power transformer's primary is mains-driven;
	// an output transformer's primary is plate-driven, and both call the driven side "primary").
	// So every terminal of one transformer device is treated as one mutually-coupled group --
	// finer-grained winding boundaries are a strict subset of this and would reach the same
	// answer, since two terminals of one physical winding are already connected once either
	// reaches an asserted node through this same coupling.
	//
	// Kept symmetric rather than directional like `loadToSupply`: unlike a rectifier, a
	// transformer's coupling is not one-way, and guessing a direction from role names is exactly
	// what this decision forbids. This still cannot run backwards into a source by construction
	// -- `asserted` is fixed before this map is built and this map is never written to it, only
	// read from during the BFS below, so a winding can be discovered generated but can never
	// become a generator itself.
	const windingCoupling = new Map<NodeId, NodeId[]>();
	for (const device of devices) {
		if (device.kind !== "transformer") {
			continue;
		}
		// Ground (node 0) excluded: it is the one node every unrelated device in the whole
		// document can share (a primary return, a centre tap), and unlike a real winding
		// terminal it asserts nothing on its own -- `asserted` never contains it either. Coupling
		// through it would bridge two unrelated transformers that merely both ground a leg, which
		// is a wider mistake than the one this fix exists to make safe.
		const nodes = [...new Set(device.nodes)].filter((node) => node !== 0);
		for (let i = 0; i < nodes.length; i += 1) {
			for (let j = i + 1; j < nodes.length; j += 1) {
				const a = nodes[i] as NodeId;
				const b = nodes[j] as NodeId;
				windingCoupling.set(a, [...(windingCoupling.get(a) ?? []), b]);
				windingCoupling.set(b, [...(windingCoupling.get(b) ?? []), a]);
			}
		}
	}
	/**
	 * Every node reachable from `from` over `adjacency`, `loadToSupply` and `windingCoupling`,
	 * without ever stepping onto a node in `excluded` or node 0 (ground). `from` itself is
	 * excluded too if it is in `excluded` or is 0 -- the walk cannot even start, which is exactly
	 * right when `from` *is* one of the op-amp's own other terminals or ground: ground is a 0 V
	 * reference sink that does not conduct DC power supply or op-amp output potentials between
	 * unrelated branches.
	 */
	const reachableWithout = (
		from: NodeId,
		excluded: ReadonlySet<NodeId>,
	): Set<NodeId> => {
		const seen = new Set<NodeId>();
		if (excluded.has(from) || from === 0) {
			return seen;
		}
		seen.add(from);
		const queue: NodeId[] = [from];
		while (queue.length > 0) {
			const at = queue.pop() as NodeId;
			for (const next of [
				...(adjacency.get(at) ?? []),
				...(loadToSupply.get(at) ?? []),
				...(windingCoupling.get(at) ?? []),
			]) {
				if (next === 0 || excluded.has(next) || seen.has(next)) {
					continue;
				}
				seen.add(next);
				queue.push(next);
			}
		}
		return seen;
	};
	const generated = (from: NodeId): boolean => {
		// Real independent sources first, with no exclusion: a `voltage-source`/`rail` node asserts
		// nothing about itself circularly, so plain reachability is the whole question.
		const unconstrained = reachableWithout(from, new Set());
		for (const node of unconstrained) {
			if (asserted.has(node)) {
				return true;
			}
		}
		// **No op-amp output generates a supply rail.** An op-amp is powered by its rails, so a
		// rail is an input to every op-amp that touches it. The per-op-amp exclusion below is not
		// enough on its own: it bars only *that* op-amp's terminals, so an op-amp on a *different*
		// rail certifies this one. Measured on `sunn-beta-lead`, whose Channel A +15 V rail was
		// declared "generated" by three Channel B op-amps (`IC108A`, `IC111A`, `IC111B`, all on
		// nodes 22/21) reached through a protection diode from an op-amp output to the rail --
		// `CR103`, whose cathode sits on +15 and which can only ever dump *into* that rail. Both
		// of that packet's +15 V rail ports were dropped, its supplies floated, and its solve ran
		// away to 1e283 V. The unconstrained walk above still runs first, so a rail genuinely fed
		// by a real source is still correctly left unforced.
		if (opampSupplyNodes.has(from)) {
			return false;
		}
		// **No op-amp input generates the reference it is handed** -- the same argument one line
		// up, on the other side of the part. See `opampInputNodes` for the two packets this was
		// measured on and for why it cannot overrule a real source.
		//
		// **Unless an op-amp output is on that same node**, which a unity-gain follower always
		// puts there: its output *is* its inverting input. Without this second clause the rule
		// reintroduced the exact regression `opampOutputRoles` records --
		// `boss-bd-2-blues-driver` and its Keeley mod each raising `node-driven-by-two-sources`
		// on node 5, where a promoted rail met an op-amp output that genuinely drives it. An
		// output forces its node whatever else sits on it, so it wins over this clause.
		if (opampInputNodes.has(from) && !opampSelfTerminals.has(from)) {
			return false;
		}
		// Each op-amp output is checked on its own, excluding only *that* op-amp's own other
		// terminals -- see the docstring above `voltagePortRails`. Skipped entirely when the
		// unconstrained walk never reaches the output at all, which is the common case.
		for (const [output, ownTerminals] of opampSelfTerminals) {
			if (!unconstrained.has(output)) {
				continue;
			}
			if (reachableWithout(from, ownTerminals).has(output)) {
				return true;
			}
		}
		return false;
	};

	const added: Device[] = [];
	const claimed = new Set<NodeId>();
	for (const component of components) {
		if (String(component.kind) !== "port" || component.terminals.length !== 1) {
			continue;
		}
		const volts = optionalQuantity(component, "Voltage");
		if (volts === null) {
			continue;
		}
		const terminal = component.terminals[0];
		if (terminal === undefined) {
			continue;
		}
		const node = nodeOf(String(component.id), String(terminal.name), 0);
		if (node === null || node === 0 || claimed.has(node) || generated(node)) {
			continue;
		}
		claimed.add(node);
		added.push({
			id: String(component.id),
			kind: "rail",
			nodes: [node],
			parameters: { volts },
			control: null,
			identity: {
				partNumber: propertyString(component, "PartNumber"),
				declaredType:
					typeof component.sourceTypeName === "string" &&
					component.sourceTypeName.length > 0
						? component.sourceTypeName
						: null,
				terminalRoles: [terminalRoleToken(String(terminal.name))],
				declaredTerminalRoles: [declaredRole(terminal)],
				declaredWindings: null,
			},
		});
	}
	return added;
}

const parameterKeyByDeviceKind: Readonly<Record<string, string>> = {
	resistor: "Resistance",
	capacitor: "Capacitance",
	inductor: "Inductance",
	potentiometer: "Resistance",
	rheostat: "Resistance",
	"voltage-source": "Voltage",
	transformer: "Ratio",
};

/**
 * Second spellings of a value property, per kind, tried only after the primary is absent.
 *
 * **Per kind and not globally, because `R` is not a resistance.** The corpus uses it as a generic
 * printed-value field: 196 resistors state their resistance there (`"470 ohm"`, `"10k"`), and so do
 * 126 potentiometers, but 51 capacitors put a *capacitance* in it (`"100/16"`), 13 ICs a part
 * designation (`"1/2NE570"`), and 7 transistors a part number (`"2SC2458GR"`). Reading `R` wherever
 * it appears would be wrong for 86 of the 408 components carrying it — a part number parsed as ohms,
 * which is the wrong-answer-that-still-renders this file exists to avoid.
 *
 * Surfaced by `report-source-coverage.ts`, whose synonym check exists for exactly this: a quantity
 * the source states plainly under a spelling nothing reads, which refuses the component or silently
 * takes a class default.
 */
const fallbackParameterKeys: Readonly<Record<string, readonly string[]>> = {
	resistor: ["R"],
	potentiometer: ["R"],
	capacitor: ["C"],
	inductor: ["L"],
};

const parameterNameByDeviceKind: Readonly<Record<string, string>> = {
	resistor: "ohms",
	capacitor: "farads",
	inductor: "henries",
	potentiometer: "ohms",
	rheostat: "maxOhms",
	"voltage-source": "volts",
	transformer: "ratio",
};

export type ReadNetlistOptions = {
	readonly inputJack?: string;
	readonly outputJack?: string;
};

export function readNetlist(
	source: string,
	options?: ReadNetlistOptions,
): Netlist {
	// One parse. core 0.6.26 contract v1 merges the inline terminal `node:` keys and the
	// `nodes:` ledger into a single connectivity, and refuses a document where the two
	// disagree -- so the three recovery passes this stage ran, and the divergence warning that
	// reported the disagreement, have nothing left to do.
	const parsed = parseDocumentWithConnectivity(source);
	// Properties only. The parser still flattens some structured quantities to strings, so this
	// recovery stays until core preserves them everywhere; its node-token half is gone, replaced
	// by the connectivity below.
	const document = repairStructuredProperties(parsed.document, readRawComponents(source));
	const declaredControlIds = declaredControlNames(document);
	// Core's connectivity is authoritative only where the document *declares* it. When core
	// falls back to geometry this stage keeps its own union-find instead: the two geometric
	// resolutions are not the same, and swapping one for the other is a separate change from
	// adopting the declared-connectivity contract.
	const declaredNodes =
		parsed.connectivitySource === "declared"
			? declaredNodesFromConnectivity(document, parsed.connectivity)
			: new Map<string, NodeId>();
	const nodeOf = resolveNodes(document, declaredNodes);

	const warnings: CompileWarning[] = [];

	/**
	 * **A switch throw or winding tap alone on its node cannot route anything.**
	 *
	 * `marshall-jcm800`'s output-transformer taps were stranded exactly this way: `secondary_4`
	 * and `throw_4` named node ids the document never declared, so each became its own isolated
	 * net and the impedance selector had two positions that went nowhere. Three sessions
	 * diagnosed the resulting output stage behaviourally.
	 *
	 * The **general** dangling-terminal rule was measured and rejected first — 2020 findings, no
	 * signal-to-noise (`dangling-active-terminal.ts` records it). This is that narrowing applied
	 * to routing, and measured the same way: of 1904 single-pin terminals in the corpus, 1858 are
	 * spare pins and test points, **25 are throws and 10 are winding taps** — 35 findings across
	 * 18 packets, a 54x cut. It also names, for free, bypass footswitches whose throws are
	 * unwired (`boss-bf-2`, `boss-ce-2`, `boss-ce-5`, `boss-ds-2`), which is a structural account
	 * of packets whose bypass never engages.
	 *
	 * Selected on the **typed `role` field**, never on the terminal's name: `role: throw` and
	 * `role: winding` are what the format states, and a name is prose.
	 */
	if (parsed.connectivitySource === "declared") {
		const memberCount = new Map<NodeId, number>();
		for (const [node, pins] of parsed.connectivity.nodeMembers) {
			memberCount.set(node, pins.length);
		}
		for (const component of document.components) {
			// A potentiometer terminal alone on its node is broken whichever terminal it is: a
			// divider needs all three joined to something and a rheostat shares two on one
			// node, so neither shape leaves one stranded. Measured over the corpus's 559 pots:
			// 323 dividers, 128 rheostats, and **31 with a terminal alone** -- and those 31 land
			// on packets already flagged behaviourally, `boss-ch-1` (all four, silent),
			// `boss-ce-5` (four, whole panel flat), `boss-mt-2`, `boss-sp-1-spectrum`,
			// `mxr-m117r-flanger` and `earthquaker-devices-plumes`'s Gain.
			const isPot = String(component.kind) === "potentiometer";
			for (const terminal of component.terminals) {
				const role = declaredRole(terminal);
				if (!isPot && role !== "throw" && role !== "winding") {
					continue;
				}
				const node = declaredNodes.get(
					declaredKey(String(component.id), String(terminal.name)),
				);
				if (node === undefined || node === GROUND) {
					continue;
				}
				if ((memberCount.get(node) ?? 0) > 1) {
					continue;
				}
				warnings.push({
					code: "throw-or-winding-unwired",
					device: String(component.id),
					detail:
						`${component.id}.${terminal.name} (role ${role ?? "none"}) is alone on node ${node}: ` +
						`a ${role === "throw" ? "switch position that routes nowhere" : isPot ? "potentiometer terminal joined to nothing, so the track cannot divide" : "winding tap nothing can select"}.`,
				});
			}
		}
	}
	const devices: Device[] = [];
	const controlIds = new Set<string>();
	const ownerByControl = new Map<string, ComponentLike>();
	// Controls whose every device is a two-terminal switch with no authored position,
	// and so are candidates for the port-connectivity default below. A control that
	// also drives anything else -- a pot, a selector, a switch that states a position
	// -- is disqualified, because the source has spoken for it.
	const unpositionedSwitchControls = new Set<string>();
	const positionedControls = new Set<string>();

	for (const component of document.components) {
		const componentKind = String(component.kind);
		if (ignoredComponentKinds.has(componentKind)) {
			continue;
		}
		// The source marks this component interface or source context, not modeled graph. v1 gives
		// it an interface-only / source-only disposition that keeps it out of the electrical
		// analysis; v2 reads the same typed flag and drops it, so an open placeholder the source
		// says not to model (schaller-tremolo's R_LED, InterfaceOnly and Value: open) stops
		// refusing the pedal for a value the source deliberately omits.
		if (isInterfaceOrSourceOnly(component)) {
			warnings.push({
				code: "interface-or-source-only",
				device: String(component.id),
				detail: `Component ${component.id} (${componentKind}) is declared interface-only or source-only and is excluded from the solve.`,
			});
			continue;
		}
		// An unpopulated position is an open circuit, so it is dropped for the same reason and
		// by the same mechanism -- but under its own code, because "nothing is fitted here" and
		// "this is interface context" are different facts about a document.
		if (isNotPopulated(component)) {
			// **Say whether this DNP is load-bearing**, i.e. whether dropping the component is
			// the only reason the document compiles. See `NotPopulatedWithoutValueWarning`: a
			// part that declares its value and is also marked DNP conceals nothing, while one
			// that declares no value would have refused by name without the mark. Both are
			// dropped -- an unpopulated position is an open circuit either way -- but only one
			// of them is carrying the compile, and a reader should be told which.
			//
			// Read from the value property alone. Provenance fields (`SourceStatus`,
			// `SourceConfidence`) would say more, and `report-source-integrity.ts` does read
			// them to catch a `DNP` asserted over a deferred decision -- but they are source-lane
			// metadata and lowering must not start branching on them.
			const valueKey = parameterKeyByDeviceKind[componentKind];
			const declaresValue =
				valueKey === undefined ||
				propertyQuantityText(component, valueKey) !== null ||
				(fallbackParameterKeys[componentKind] ?? []).some(
					(fallback) => propertyQuantityText(component, fallback) !== null,
				);
			warnings.push(
				declaresValue
					? {
							code: "not-populated",
							device: String(component.id),
							detail: `Component ${component.id} (${componentKind}) is declared DNP and is excluded from the solve as an unpopulated, open position. It declares its value, so what would sit there is still on the record.`,
						}
					: {
							code: "not-populated-without-value",
							device: String(component.id),
							detail: `Component ${component.id} (${componentKind}) is declared DNP and declares no ${valueKey}, so dropping it is what allows this document to compile: without the DNP it would refuse by name. That is what a real unpopulated position looks like, and also what a guess looks like -- check it against the board.`,
						},
			);
			continue;
		}
		// A component declaring no terminals is connected to nothing, so it has no
		// nodes and cannot contribute a row or a column to any matrix. Dropping it
		// removes nothing electrical, *by construction* -- which is the whole reason
		// this is safe where silently dropping a connected inductor was not.
		//
		// The corpus is full of these: panel LEDs, footswitches from a photo, bias
		// markers, pots from a build document. Refusing a pedal over an unconnected
		// panel LED would be strictness with no purpose. Note that the decision is the
		// empty terminal list and never the component's name or description, both of
		// which say "photo" and "marker" here and must stay unread.
		if (component.terminals.length === 0) {
			if (Object.hasOwn(deviceKindByComponentKind, componentKind)) {
				warnings.push({
					code: "unconnected-behavior-component",
					device: String(component.id),
					detail: `Component ${component.id} (${component.kind}) is a behavior-owning part but declares 0 connected terminals and is skipped from MNA modeling.`,
				});
			}
			continue;
		}
		const kind = deviceKindByComponentKind[componentKind];
		if (kind === undefined) {
			throw new NetlistError(
				`component ${component.id}: unsupported component kind "${componentKind}"`,
				String(component.id),
			);
		}
		const rawNodes = component.terminals.map((terminal, index) =>
			nodeOf(component.id, terminal.name, index),
		);
		const connectedIndices: number[] = [];
		for (let i = 0; i < rawNodes.length; i++) {
			if (rawNodes[i] !== null) {
				connectedIndices.push(i);
			}
		}
		if (connectedIndices.length === 0) {
			if (Object.hasOwn(deviceKindByComponentKind, componentKind)) {
				warnings.push({
					code: "unconnected-behavior-component",
					device: String(component.id),
					detail: `Component ${component.id} (${component.kind}) is a behavior-owning part but declares 0 connected terminals and is skipped from MNA modeling.`,
				});
			}
			continue;
		}
		if (
			component.terminals.length >= 2 &&
			connectedIndices.length === 1 &&
			kind !== "ic"
		) {
			if (Object.hasOwn(deviceKindByComponentKind, componentKind)) {
				warnings.push({
					code: "unconnected-behavior-component",
					device: String(component.id),
					detail: `Component ${component.id} (${component.kind}) has only 1 connected terminal and is skipped from MNA modeling.`,
				});
			}
			continue;
		}
		let effectiveTerminals = component.terminals;
		let nodes: NodeId[];
		if (connectedIndices.length < component.terminals.length) {
			if (kind === "ic" && connectedIndices.length >= 2) {
				effectiveTerminals = connectedIndices.map((i) => component.terminals[i]!);
				nodes = connectedIndices.map((i) => rawNodes[i] as NodeId);
			} else {
				const missingIndex = rawNodes.findIndex((n) => n === null);
				const missingTerminal = component.terminals[missingIndex];
				throw new NetlistError(
					`component ${component.id}: terminal "${missingTerminal?.name}" has no declared node and no wire`,
					String(component.id),
				);
			}
		} else {
			nodes = rawNodes as NodeId[];
		}
		const control = controlBindingFor(component, declaredControlIds, kind);
		if (control !== null) {
			controlIds.add(control);
			if (
				kind === "switch" &&
				nodes.length === 2 &&
				!statesPosition(component)
			) {
				unpositionedSwitchControls.add(control);
			} else {
				positionedControls.add(control);
			}
			// The first device bound to a control supplies the taper and wiper position
			// the control itself may not state. On a ganged control both devices carry
			// the same values, so first is enough.
			if (!ownerByControl.has(control)) {
				ownerByControl.set(control, component);
			}
		}
		const identityOf = (
			terminals: readonly (typeof effectiveTerminals)[number][],
			roles: readonly (string | null)[],
		) => ({
			partNumber: propertyString(component, "PartNumber"),
			declaredType:
				typeof component.sourceTypeName === "string" &&
				component.sourceTypeName.length > 0
					? component.sourceTypeName
					: null,
			terminalRoles: terminals.map((terminal) =>
				terminalRoleToken(String(terminal.name)),
			),
			declaredTerminalRoles: roles,
			declaredWindings: declaredWindings(component, terminals),
		});

		// **A package that states its own devices is split here, from the source.** A dual op-amp
		// is two amplifiers on one supply pair, and until now the only thing that knew so was a
		// registry `sections` entry keyed on the part id -- which means a chip nobody registered
		// could not be split at all, and a registered one was split by a *name signature*
		// (`pinoutMatches` compares folded terminal names positionally). `componentDevices`
		// reads the split the document declares, so it needs neither.
		//
		// Roles are read per device and that is the whole point: a dual op-amp declares two
		// `output`s across its package and neither is ambiguous once scoped to one amplifier.
		// `deviceTerminalRoles` is what scopes it; core validates the claim against the
		// *device's* kind, so an `ic` package may legitimately carry `opamp` devices.
		//
		// **Known limitation, measured rather than assumed: a source-declared split takes the
		// device-class law, not the part's numbers.** `boss-ch-1`'s M5218 split this way produces
		// a byte-identical topology -- same 151 stamps, same plus/minus/output nodes, same rails
		// -- with one difference: `openLoopGain` falls from the registry's 316227.766 (the part's
		// 110 dB) to `DEFAULT_OPEN_LOOP_GAIN`. The two mechanisms should compose, with the source
		// deciding the terminals and the registry deciding the numbers, and until they do a
		// packet that declares `devices` for a *registered* part trades a real gain figure for a
		// class default. No corpus packet declares `devices` yet, so nothing is affected today.
		// **Declared, not merely resolved.** `componentDevices` returns one device for a component
		// that declares none, which is the overwhelming majority, so counting its result cannot
		// tell a package that states a single device from one that states nothing. A single-device
		// declaration is a real statement -- a TA7504S is one amplifier in an eight-pin package,
		// and saying which three pins it uses is exactly the fact the binding was missing.
		const declaredDevices =
			component.devices !== undefined && component.devices.length > 0
				? componentDevices(component)
				: [];
		if (declaredDevices.length > 0) {
			const terminalByName = new Map(
				effectiveTerminals.map((terminal) => [String(terminal.name), terminal]),
			);
			const nodeByName = new Map(
				effectiveTerminals.map((terminal, index) => [
					String(terminal.name),
					nodes[index] as NodeId,
				]),
			);
			for (const declared of declaredDevices) {
				const roleByName = deviceTerminalRoles(component, declared);
				const owned = declared.terminals.flatMap((name) => {
					const terminal = terminalByName.get(name);
					const node = nodeByName.get(name);
					// A terminal the device names but this component does not connect is
					// dropped rather than guessed at. `validateComponentDevices` is what
					// reports a declaration naming a terminal that does not exist at all.
					return terminal !== undefined && node !== undefined
						? [{ terminal, node, name }]
						: [];
				});
				if (owned.length === 0) {
					continue;
				}
				const deviceKind = deviceKindByComponentKind[declared.kind];
				if (deviceKind === undefined) {
					throw new NetlistError(
						`component ${component.id} device ${declared.id}: unsupported kind "${declared.kind}"`,
						String(component.id),
					);
				}
				devices.push({
					// Core's address for a device inside a package, and deliberately not the
					// `#N` a registry section uses: these two splits must stay tellable apart.
					id: `${component.id}.${declared.id}`,
					packageDeviceId: declared.id,
					kind: deviceKind,
					nodes: owned.map((entry) => entry.node),
					parameters: parametersFor(component, deviceKind),
					// The control belongs to the package, so only the first device carries it.
					// A ganged part states the same control on both and the owner map already
					// keeps the first.
					control: declared.id === declaredDevices[0]?.id ? control : null,
					identity: identityOf(
						owned.map((entry) => entry.terminal),
						owned.map((entry) => roleByName.get(entry.name) ?? null),
					),
					isLed: declared.kind === "led" ? true : undefined,
				});
			}
			continue;
		}
		devices.push({
			id: String(component.id),
			kind,
			nodes,
			parameters: parametersFor(component, kind),
			control,
			identity: identityOf(
				effectiveTerminals,
				effectiveTerminals.map((terminal) => declaredRole(terminal)),
			),
			isLed: componentKind === "led" ? true : undefined,
		});
	}

	devices.push(...voltagePortRails(document.components, devices, nodeOf));

	// A panel control states its taper only sometimes; the pot it drives states one far
	// more often. Taking the panel's silence as "linear" discards a taper the document
	// gives -- an audio knob rendered linear feels like a different pedal -- so the
	// declaration wins and the component fills the gap.
	//
	// A device bound to no panel control is an internal trimmer or a fixed switch:
	// still adjustable, just not on the enclosure. It gets a control of its own rather
	// than refusing the pedal.
	const declaredTapers = new Map(
		(document.deviceInterface?.controls ?? []).map(
			(control) => [String(control.id), taperFor(control)] as const,
		),
	);
	// The panel's own role for each control, carried verbatim. Same shape as the tapers above:
	// the declaration is the only source, and absence is `null` rather than a guess.
	const declaredRoles = new Map(
		(document.deviceInterface?.controls ?? []).map(
			(control) => [String(control.id), roleFor(control)] as const,
		),
	);
	const declaredLabels = new Map(
		(document.deviceInterface?.controls ?? []).map(
			(control) =>
				[
					String(control.id),
					typeof (control as { label?: unknown }).label === "string" &&
					String((control as { label?: unknown }).label).trim().length > 0
						? String((control as { label?: unknown }).label).trim()
						: null,
				] as const,
		),
	);
	// Where the panel says its knobs ship set, which is a different claim from where a
	// component says its wiper physically sits.
	//
	// **This block was read for `taper` and `role` and not for `defaultPosition`, and one
	// packet paid for it in full.** `mxr-carbon-copy` declares MIX 0.75, REGEN 0.6 and DELAY
	// 1.0 here; every render of it took 0.5 for all three, because the only position source
	// below was `declaredPosition(owner)`, which reads the *component's* `Wipe`/`Position`.
	// MIX is a source-declared logarithmic pot, so 0.5 is 10% of its track against 32.5% at
	// the declared 0.75 -- 10 dB thrown away on the wet leg of a delay whose echo was then
	// investigated as missing. It is the only packet in the corpus that declares these, and
	// `report-source-coverage.ts` cannot see the omission because it scans component
	// properties and this is not one.
	//
	// Read from the raw YAML rather than the parsed document because the format library keeps
	// `id`/`label`/`kind`/`role`/`taper` off a control entry and drops exactly this field --
	// see `readRawControlPositions`.
	const declaredPositions = readRawControlPositions(source);
	// Panel controls keep the order the document declares them in, which is the order
	// they sit on the enclosure; the invented ones follow. Order is not electrical, but
	// it is what a panel reads off, so it should not depend on which device happened to
	// bind first.
	const orderedIds = [
		...declaredTapers.keys(),
		...[...controlIds].filter((id) => !declaredTapers.has(id)),
	].filter((id) => controlIds.has(id));
	// Ports are resolved before controls because the unpositioned-switch default is a
	// question about the path between them.
	const ports = resolvePorts(document, devices, options);
	// A document that declares a transformer but resolves its output to a node no winding
	// touches is being measured **before its power stage**, which is how an amp's render reads
	// as a plausible level that is really a preamp or phase-inverter tap. Measured 2026-08-21:
	// five of six amps were in exactly that state, and `resolvePorts` now prefers the
	// transformer-coupled jack, so what reaches here is a document that declares no such jack
	// at all -- `mesa-boogie-mark-v` declares three monitor taps and no speaker load. Naming
	// it keeps that a stated boundary instead of a flattering number.
	// Keyed on an **output** transformer -- one declaring a `ratio` -- for the same reason
	// `resolvePorts` prefers one: a mains transformer's windings say nothing about where the
	// audio output is. Both conditions here are typed parameters compared whole.
	const outputTransformers = devices.filter(
		(device) =>
			device.kind === "transformer" &&
			typeof device.parameters.ratio === "number",
	);
	if (outputTransformers.length > 0) {
		// **The same reachability `outputJackLoads` uses, not a stricter copy.** This test used to
		// require the output port to sit *directly* on a winding, while the port preference beside it
		// already followed series passives -- so a jack behind a secondary winding resistance, which
		// is exactly what Stage C models, warned about its own speaker output. `hiwatt-dr103` is the
		// selector case: its port is the switch common, one hop past three taps that are all on the
		// winding. Two tests of one question that disagree is how a packet gets told its speaker is a
		// preamp tap.
		const windingNodes = transformerCoupledNodes(devices);
		if (!windingNodes.has(ports.output)) {
			const owner = devices.find(
				(device) =>
					device.kind === "jack" && device.nodes.includes(ports.output),
			);
			warnings.push({
				code: "output-port-not-transformer-coupled",
				device: owner === undefined ? null : String(owner.id),
				detail:
					`the output port is node ${ports.output}` +
					(owner === undefined ? "" : ` (${owner.id})`) +
					", which no transformer winding touches, while this document declares a " +
					"transformer: the render is measured upstream of the output transformer, so " +
					"its level is a tap rather than a speaker output",
			});
		}
	}
	for (const id of positionedControls) {
		unpositionedSwitchControls.delete(id);
	}
	const closedForPortPath = switchesClosedForPortPath(
		devices,
		ports,
		unpositionedSwitchControls,
	);
	const closedForSupplyPath = switchesClosedForSupplyPath(
		devices,
		ports,
		unpositionedSwitchControls,
	);
	const controls: Control[] = orderedIds.map((id) => {
		const owner = ownerByControl.get(id);
		// The panel's declaration wins over both the connectivity fallback (a guess about an
		// unpositioned switch) and the component's own `Wipe` -- but a disagreement between the
		// two authored values is a contradiction in the source, not a precedence question, so it
		// is named rather than silently resolved. An internal trimmer the panel never declares is
		// unaffected: it has no entry here and keeps `declaredPosition(owner)`.
		const panelPosition = declaredPositions.get(id);
		if (
			panelPosition !== undefined &&
			owner !== undefined &&
			statesPosition(owner) &&
			declaredPosition(owner) !== panelPosition
		) {
			warnings.push({
				code: "control-position-disagrees",
				device: String(owner.id),
				detail: `Control ${id}: deviceInterface declares defaultPosition ${panelPosition} but component ${owner.id} states position ${declaredPosition(owner)}; the panel declaration is used.`,
			});
		}
		// The panel's own `taper` wins where it declares one; otherwise the owning component's,
		// and a component whose declaration this stage cannot execute is named rather than
		// quietly rendered linear.
		const componentTaper =
			owner === undefined ? null : declaredTaper(owner);
		if (owner !== undefined && componentTaper?.unreadable != null) {
			warnings.push({
				code: "taper-not-executable",
				device: owner.id,
				declared: componentTaper.unreadable,
				detail:
					`Control ${id}: ${owner.id} declares taper "${componentTaper.unreadable}", which ` +
					"this stage cannot turn into one of its four laws, so the control renders " +
					"linear. An audio pot rendered linear is audible across the whole sweep.",
			});
		}
		return {
			id,
			taper:
				declaredTapers.get(id) ?? componentTaper?.taper ?? "linear",
			defaultPosition:
				panelPosition ??
				(closedForPortPath.has(id) || closedForSupplyPath.has(id)
					? 1
					: owner === undefined
						? 0.5
						: declaredPosition(owner)),
			role: declaredRoles.get(id) ?? null,
			label: declaredLabels.get(id) ?? null,
		};
	});

	// **A power stage the graph does not contain.** `mesa-boogie-mark-v` declares a power
	// transformer with a typed `voltsHv` winding -- a B+ supply, which only an amp has -- and no
	// output transformer at all, because its packet models the preamp and hands the OT and
	// speaker to a companion fixture: its README claims a "2k:8 ohm OT descriptor" and an
	// "8 ohm WDF speaker-load handoff", so this is a documented boundary rather than a defect.
	// It is also why that packet's render is a **preamp level** -- 11.7 V at a monitor tap,
	// which spent a day being read alongside `fender-5e3-deluxe-tweed`'s 26.2 V into a real
	// 8 ohm load. Naming it is what stops the comparison being made again.
	//
	// No pedal can trip this: `voltsHv` is a high-voltage supply winding nothing in the pedal
	// corpus declares.
	if (
		outputTransformers.length === 0 &&
		devices.some(
			(device) =>
				device.kind === "transformer" &&
				typeof device.parameters.voltsHv === "number",
		)
	) {
		warnings.push({
			code: "no-output-transformer",
			device: null,
			detail:
				"this document declares a high-voltage power transformer but no output " +
				"transformer, so the graph contains no output stage: the rendered level is a " +
				"preamp level and is not comparable with an amp measured at its speaker",
		});
	}

	// A jack's own declared load impedance, lowered into a resistor across its own two
	// terminals -- appended last and read from `document.components` rather than folded into
	// the main device loop above, so it cannot perturb port resolution, the switch-closing
	// path search or control defaults, all of which already ran against `devices` by this
	// point. See `outputJackLoads` for the measurement and the exclusions.
	const speakerLoads = outputJackLoads(document, devices);
	devices.push(...speakerLoads.devices);
	warnings.push(...speakerLoads.warnings);

	const nodes = [
		...new Set([GROUND, ...devices.flatMap((device) => device.nodes)]),
	].sort((a, b) => a - b);

	return {
		nodes,
		devices,
		controls,
		ports,
		portImpedanceOhms: portImpedanceOhms(document, devices, ports),
		portDeclaredFullScaleVolts: portDeclaredFullScaleVolts(
			document,
			devices,
			ports,
		),
		warnings,
	};
}

/**
 * Which unpositioned two-terminal switches must close for the input port to reach the
 * output port, taken as the fewest of them that does it.
 *
 * A source that does not state a switch position states nothing about its sense
 * either, and the corpus uses both senses, so no constant is right. `pro-co-rat` wires
 * its effect switches *into* the signal path -- node 24 is the input port itself -- and
 * opening them disconnects the pedal; `ibanez-ts808`'s CR1/CR2 latch contacts are
 * internal and closing them shorts the path around the circuit. A constant `0.5` kills
 * the Screamer and a constant `0` kills the Rat. This is the same shape the jack-engage
 * work already paid for: *same terminal name, opposite electrical sense*, and a
 * per-packet answer would be product knowledge this stage may not hold.
 *
 * Connectivity decides instead, which is evidence this stage may read. Crossing an
 * unpositioned switch costs 1 and every other device costs 0; take a cheapest input ->
 * output path and close exactly the switches on it. A pedal whose path already exists
 * closes nothing, and a pedal whose only path runs through its switches closes them.
 * The default is fail-safe toward a pedal you can hear either way.
 *
 * Rails are not routes. Ground and every node a voltage source touches are excluded
 * from the traversal: they reach nearly every node in the circuit through returns and
 * decoupling, so leaving them in makes every path free and the answer always "close
 * nothing". That exclusion is connectivity too -- it reads device kinds and nodes, no
 * text.
 */
function switchesClosedForPortPath(
	devices: readonly Device[],
	ports: { readonly input: NodeId; readonly output: NodeId },
	candidates: ReadonlySet<string>,
): ReadonlySet<string> {
	const closed = new Set<string>();
	if (candidates.size === 0 || ports.input === ports.output) {
		return closed;
	}

	const rails = new Set<NodeId>([GROUND]);
	for (const device of devices) {
		if (device.kind === "voltage-source") {
			for (const node of device.nodes) {
				rails.add(node);
			}
		}
	}
	// A port sitting on a rail would be unreachable from the start. That is a different
	// defect and not this function's to diagnose, so it declines rather than guessing.
	if (rails.has(ports.input) || rails.has(ports.output)) {
		return closed;
	}

	type Edge = { readonly to: NodeId; readonly gate: string | null };
	const adjacency = new Map<NodeId, Edge[]>();
	const link = (a: NodeId, b: NodeId, gate: string | null): void => {
		if (a === b || rails.has(a) || rails.has(b)) {
			return;
		}
		for (const [from, to] of [
			[a, b],
			[b, a],
		] as const) {
			const edges = adjacency.get(from);
			if (edges === undefined) {
				adjacency.set(from, [{ to, gate }]);
			} else {
				edges.push({ to, gate });
			}
		}
	};
	for (const device of devices) {
		const gate =
			device.control !== null && candidates.has(device.control)
				? device.control
				: null;
		if (gate !== null) {
			link(device.nodes[0] ?? GROUND, device.nodes[1] ?? GROUND, gate);
			continue;
		}
		// Every other device conducts. This is a path question and not a frequency one:
		// a coupling capacitor carries the signal it is there to carry, and a transistor
		// passes signal between its terminals.
		for (let i = 0; i < device.nodes.length; i += 1) {
			for (let j = i + 1; j < device.nodes.length; j += 1) {
				link(device.nodes[i] ?? GROUND, device.nodes[j] ?? GROUND, null);
			}
		}
	}

	// 0-1 BFS: free edges go to the front of the queue, gated ones to the back, so the
	// first time the output settles it has crossed the fewest switches. Adjacency keeps
	// device declaration order, so a tie between two equal-cost paths always resolves
	// the same way for the same document.
	const cost = new Map<NodeId, number>([[ports.input, 0]]);
	const cameFrom = new Map<NodeId, { from: NodeId; gate: string | null }>();
	const queue: Array<{ node: NodeId; cost: number }> = [
		{ node: ports.input, cost: 0 },
	];
	while (queue.length > 0) {
		const entry = queue.shift();
		if (
			entry === undefined ||
			entry.cost > (cost.get(entry.node) ?? Infinity)
		) {
			continue;
		}
		if (entry.node === ports.output) {
			break;
		}
		for (const edge of adjacency.get(entry.node) ?? []) {
			const next = entry.cost + (edge.gate === null ? 0 : 1);
			if (next >= (cost.get(edge.to) ?? Infinity)) {
				continue;
			}
			cost.set(edge.to, next);
			cameFrom.set(edge.to, { from: entry.node, gate: edge.gate });
			const step = { node: edge.to, cost: next };
			if (edge.gate === null) {
				queue.unshift(step);
			} else {
				queue.push(step);
			}
		}
	}

	// No path even with every candidate closed. Closing them all would be a guess with
	// no evidence behind it, so every switch keeps the open default.
	if (!cost.has(ports.output)) {
		return closed;
	}
	for (let node = ports.output; node !== ports.input; ) {
		const step = cameFrom.get(node);
		if (step === undefined) {
			break;
		}
		if (step.gate !== null) {
			closed.add(step.gate);
		}
		node = step.from;
	}
	return closed;
}

/**
 * Switches that must be closed to connect power sources to active device power terminals.
 *
 * In tube amplifiers and analog circuits, mains/standby switches sit on the DC power rail
 * or transformer primary/secondary. If unpositioned in source, defaulting open isolates
 * active devices from power supplies, leaving plates, screens and op-amp rails at 0V.
 */
function switchesClosedForSupplyPath(
	devices: readonly Device[],
	ports: { readonly input: NodeId; readonly output: NodeId },
	candidates: ReadonlySet<string>,
): ReadonlySet<string> {
	const closed = new Set<string>();
	if (candidates.size === 0) {
		return closed;
	}

	const powerSourceNodes = new Set<NodeId>();
	for (const device of devices) {
		if (device.kind === "voltage-source") {
			for (const node of device.nodes) {
				if (node !== GROUND && node !== ports.input) {
					powerSourceNodes.add(node);
				}
			}
		}
	}
	if (powerSourceNodes.size === 0) {
		return closed;
	}

	const activeSupplyTargets = new Set<NodeId>();
	for (const device of devices) {
		if (device.kind === "triode") {
			device.identity.terminalRoles.forEach((role, idx) => {
				const n = device.nodes[idx];
				if (role === "plate" && n !== undefined && n !== GROUND) {
					activeSupplyTargets.add(n);
				}
			});
		} else if (device.kind === "pentode") {
			device.identity.terminalRoles.forEach((role, idx) => {
				const n = device.nodes[idx];
				if (
					(role === "plate" || role === "screen") &&
					n !== undefined &&
					n !== GROUND
				) {
					activeSupplyTargets.add(n);
				}
			});
		} else if (device.kind === "opamp" || device.kind === "ota") {
			device.identity.terminalRoles.forEach((role, idx) => {
				const n = device.nodes[idx];
				if (
					(role === "vcc" || role === "vee") &&
					n !== undefined &&
					n !== GROUND
				) {
					activeSupplyTargets.add(n);
				}
			});
		}
	}
	if (activeSupplyTargets.size === 0) {
		return closed;
	}

	type Edge = { readonly to: NodeId; readonly gate: string | null };
	const adjacency = new Map<NodeId, Edge[]>();
	const link = (a: NodeId, b: NodeId, gate: string | null): void => {
		if (a === b || a === GROUND || b === GROUND) {
			return;
		}
		for (const [from, to] of [
			[a, b],
			[b, a],
		] as const) {
			const edges = adjacency.get(from);
			if (edges === undefined) {
				adjacency.set(from, [{ to, gate }]);
			} else {
				edges.push({ to, gate });
			}
		}
	};

	for (const device of devices) {
		const gate =
			device.control !== null && candidates.has(device.control)
				? device.control
				: null;
		if (gate !== null) {
			for (let i = 0; i < device.nodes.length; i += 1) {
				for (let j = i + 1; j < device.nodes.length; j += 1) {
					link(device.nodes[i] ?? GROUND, device.nodes[j] ?? GROUND, gate);
				}
			}
			continue;
		}
		if (
			device.kind === "resistor" ||
			device.kind === "inductor" ||
			device.kind === "potentiometer"
		) {
			for (let i = 0; i < device.nodes.length; i += 1) {
				for (let j = i + 1; j < device.nodes.length; j += 1) {
					link(device.nodes[i] ?? GROUND, device.nodes[j] ?? GROUND, null);
				}
			}
		} else if (device.kind === "diode" || device.kind === "tube-diode") {
			for (let i = 0; i < device.nodes.length; i += 1) {
				for (let j = i + 1; j < device.nodes.length; j += 1) {
					link(device.nodes[i] ?? GROUND, device.nodes[j] ?? GROUND, null);
				}
			}
		} else if (device.kind === "transformer") {
			const nonZeroNodes = device.nodes.filter((node) => node !== GROUND);
			for (let i = 0; i < nonZeroNodes.length; i += 1) {
				for (let j = i + 1; j < nonZeroNodes.length; j += 1) {
					link(nonZeroNodes[i] ?? GROUND, nonZeroNodes[j] ?? GROUND, null);
				}
			}
		}
	}

	const cost = new Map<NodeId, number>();
	const cameFrom = new Map<NodeId, { from: NodeId; gate: string | null }>();
	const queue: Array<{ node: NodeId; cost: number }> = [];
	for (const src of powerSourceNodes) {
		cost.set(src, 0);
		queue.push({ node: src, cost: 0 });
	}

	while (queue.length > 0) {
		const entry = queue.shift();
		if (
			entry === undefined ||
			entry.cost > (cost.get(entry.node) ?? Infinity)
		) {
			continue;
		}
		for (const edge of adjacency.get(entry.node) ?? []) {
			const next = entry.cost + (edge.gate === null ? 0 : 1);
			if (next >= (cost.get(edge.to) ?? Infinity)) {
				continue;
			}
			cost.set(edge.to, next);
			cameFrom.set(edge.to, { from: entry.node, gate: edge.gate });
			const step = { node: edge.to, cost: next };
			if (edge.gate === null) {
				queue.unshift(step);
			} else {
				queue.push(step);
			}
		}
	}

	for (const target of activeSupplyTargets) {
		if (!cost.has(target)) {
			continue;
		}
		let curr = target;
		while (!powerSourceNodes.has(curr)) {
			const step = cameFrom.get(curr);
			if (step === undefined) {
				break;
			}
			if (step.gate !== null) {
				closed.add(step.gate);
			}
			curr = step.from;
		}
	}

	return closed;
}

// --- parsing -----------------------------------------------------------------

type ParsedDocument = ReturnType<typeof parseInterchangeYamlWithTopology>["document"];

function parseDocument(source: string): ParsedDocument {
	try {
		return parseInterchangeYamlWithTopology(source).document;
	} catch (error) {
		throw new NetlistError(
			`invalid .vdsp document: ${error instanceof Error ? error.message : String(error)}`,
			null,
			error,
		);
	}
}

type InterchangeConnectivity = ReturnType<typeof parseInterchangeYamlWithTopology>["connectivity"];

/** The document together with the one connectivity core resolves for it. */
function parseDocumentWithConnectivity(source: string): {
	readonly document: ParsedDocument;
	readonly connectivity: InterchangeConnectivity;
	readonly connectivitySource: "declared" | "geometric";
} {
	try {
		return parseInterchangeYamlWithTopology(source);
	} catch (error) {
		throw new NetlistError(
			`invalid .vdsp document: ${error instanceof Error ? error.message : String(error)}`,
			null,
			error,
		);
	}
}

/**
 * Core's pin -> node map, in this stage's key shape, renumbered so ground is `GROUND`.
 *
 * Two things this has to do that a straight copy of core's ids does not.
 *
 * **Every ground, not just the one core names.** Core reports a single `groundNodeId`; a
 * document can declare many ground symbols, each on its own node unless the source ties them.
 * Folding only core's id leaves the rest as ordinary floating nodes -- measured on
 * `electro-harmonix-holy-grail`, that dropped the devices touching ground from 45 to 2. Which
 * nodes are ground is still decided by what sits on them, never by what they are called: a
 * ground symbol's own terminal, and a jack's `sleeve`, are closed typed facts.
 *
 * **Renumber, do not fold.** Core's ids are arbitrary, so writing ground's pins to `GROUND`
 * while leaving the others alone collides whenever some *other* node is already numbered 0 --
 * `namedNodeDivider` is exactly that shape, and folding merged its input node into ground. Every
 * node therefore gets a fresh id: ground `GROUND`, the rest 1..N in ascending source order so
 * the numbering stays deterministic.
 */
function declaredNodesFromConnectivity(
	document: ParsedDocument,
	connectivity: InterchangeConnectivity,
): DeclaredNodeMap {
	const nodeOfPin = new Map<string, NodeId>();
	for (const [node, pins] of connectivity.nodeMembers) {
		for (const pin of pins) {
			nodeOfPin.set(declaredKey(pin.componentId, pin.terminalName), node);
		}
	}

	const grounded = new Set<NodeId>();
	if (connectivity.groundNodeId !== null) {
		grounded.add(connectivity.groundNodeId);
	}
	for (const component of document.components) {
		const kind = String(component.kind);
		if (kind !== "ground" && kind !== "jack") {
			continue;
		}
		for (const terminal of component.terminals) {
			if (
				kind !== "ground" &&
				terminalRoleToken(String(terminal.name)) !== "sleeve"
			) {
				continue;
			}
			const node = nodeOfPin.get(
				declaredKey(String(component.id), String(terminal.name)),
			);
			if (node !== undefined) {
				grounded.add(node);
			}
		}
	}

	// Ground becomes `GROUND`; everything else keeps core's id. The one exception is a
	// non-ground node that already carries id 0 -- core's ids are arbitrary, so that happens
	// (`namedNodeDivider` is exactly that shape) and folding onto it would merge the two. Such a
	// node is moved above the highest id in use instead, which leaves every other id untouched.
	const ids = [...connectivity.nodeMembers.keys()];
	// Nothing is ground: leave every id exactly as core assigned it. Moving a node off 0 with
	// no ground to take its place would leave the system with no reference node at all, which
	// the solver cannot fix -- the CMOS NAND fixture diverges to 1e141 that way.
	if (grounded.size === 0) {
		return nodeOfPin;
	}
	let spare = Math.max(GROUND, ...ids) + 1;
	const renumbered = new Map<NodeId, NodeId>();
	for (const node of ids) {
		renumbered.set(
			node,
			grounded.has(node) ? GROUND : node === GROUND ? spare++ : node,
		);
	}

	const declared: DeclaredNodeMap = new Map();
	for (const [key, node] of nodeOfPin) {
		declared.set(key, renumbered.get(node) ?? node);
	}
	return declared;
}

/**
 * Recover the `node:` each terminal declares. The format library drops it, so the
 * raw YAML is read once here for that single field. Confined to this stage.
 */
function readRawComponents(source: string): RawComponentMap {
	const map: RawComponentMap = new Map();
	let parsed: unknown;
	try {
		parsed = loadYaml(source);
	} catch {
		return map;
	}
	if (parsed === null || typeof parsed !== "object") {
		return map;
	}
	const netNodes = new Map<string, string>();
	const nodesList = (parsed as { nodes?: unknown }).nodes;
	if (Array.isArray(nodesList)) {
		for (const net of nodesList) {
			if (net === null || typeof net !== "object") {
				continue;
			}
			const netRecord = net as { id?: unknown; members?: unknown };
			// **A net id is a token, not a number** -- the identical lesson the terminal
			// `node:` filter below already carries, unlearned one function up. The corpus
			// writes `id: 4` and `id: "n_gnd"` interchangeably, and requiring a string here
			// silently discarded the ENTIRE ledger for 100 of 142 packets -- usually every
			// net they declare (`boss-bf-3`: 430 of 430) -- and then reported the terminals
			// that depended on it as unconnected, with no diagnostic naming the ledger.
			let netId: string | null = null;
			if (typeof netRecord.id === "number" && Number.isFinite(netRecord.id)) {
				netId = String(netRecord.id);
			} else if (
				typeof netRecord.id === "string" &&
				netRecord.id.trim() !== ""
			) {
				netId = netRecord.id.trim();
			}
			if (netId === null || !Array.isArray(netRecord.members)) {
				continue;
			}
			// A net with only 1 member connects a terminal to nothing. If the terminal has an
			// authored inline node connecting it to other components, a singleton ledger entry
			// must not disconnect it. Only multi-terminal nets (real connections) override inline refs.
			if (netRecord.members.length <= 1) {
				continue;
			}
			for (const member of netRecord.members) {
				if (member === null || typeof member !== "object") {
					continue;
				}
				const memberRecord = member as {
					componentId?: unknown;
					terminalName?: unknown;
				};
				if (
					typeof memberRecord.componentId === "string" &&
					typeof memberRecord.terminalName === "string"
				) {
					netNodes.set(
						`${memberRecord.componentId}/${memberRecord.terminalName}`,
						netId,
					);
				}
			}
		}
	}

	const components = (parsed as { components?: unknown }).components;
	if (!Array.isArray(components)) {
		return map;
	}
	for (const component of components) {
		if (component === null || typeof component !== "object") {
			continue;
		}
		const record = component as {
			id?: unknown;
			terminals?: unknown;
			properties?: unknown;
		};
		if (typeof record.id !== "string") {
			continue;
		}
		const nodes = new Map<string, string>();
		if (Array.isArray(record.terminals)) {
			for (const terminal of record.terminals) {
				if (terminal === null || typeof terminal !== "object") {
					continue;
				}
				const entry = terminal as { name?: unknown; node?: unknown };
				if (typeof entry.name !== "string") {
					continue;
				}
				// A node id is a token, not a number. The corpus writes bare numerics,
				// quoted numerics and names (`n_gnd`) interchangeably, and an earlier
				// version of this filter required `typeof === "number"` -- which dropped
				// every quoted and every named node without saying so, then reported the
				// terminal as unconnected. Keep the token as authored and intern later.
				let inlineNode: string | null = null;
				if (typeof entry.node === "number") {
					inlineNode = String(entry.node);
				} else if (
					typeof entry.node === "string" &&
					entry.node.trim() !== ""
				) {
					inlineNode = entry.node.trim();
				}
				// The declared node ledger is authoritative when both encodings are present.
				const netNode = netNodes.get(`${record.id}/${entry.name}`);
				const node = netNode ?? inlineNode;
				if (node !== null) {
					nodes.set(entry.name, node);
				}
			}
		}
		const properties =
			record.properties !== null && typeof record.properties === "object"
				? (record.properties as Record<string, unknown>)
				: {};
		map.set(record.id, { nodes, properties });
	}
	return map;
}

/**
 * Restore structured quantities the format library flattened to text.
 *
 * `Resistance: { raw: "1M", value: 1000000, unit: "" }` is a flow mapping, and the
 * library hands it back as the literal characters `{ raw: "1M", ... }` -- which then
 * fails to parse as a quantity. The value is fully present in the source, so this is
 * repairing a lossy read, not repairing the document.
 */
function repairStructuredProperties(
	document: ParsedDocument,
	raw: RawComponentMap,
): ParsedDocument {
	let changed = false;
	const components = document.components.map((component) => {
		const entry = raw.get(String(component.id));
		if (entry === undefined) {
			return component;
		}
		const properties = component.properties;
		let repaired: Record<string, PropertyValue> | null = null;
		for (const [key, value] of Object.entries(entry.properties)) {
			const quantity = asParsedQuantity(value);
			if (quantity === null || typeof properties[key] !== "string") {
				continue;
			}
			repaired ??= { ...properties };
			repaired[key] = quantity;
		}
		if (repaired === null) {
			return component;
		}
		changed = true;
		return { ...component, properties: repaired };
	});
	return changed ? { ...document, components } : document;
}

type ComponentLike = ParsedDocument["components"][number];

function propertyString(component: ComponentLike, key: string): string | null {
	const value = (component.properties as Record<string, unknown>)[key];
	if (typeof value === "string") {
		return value.trim().length === 0 ? null : value.trim();
	}
	if (value !== null && typeof value === "object" && "raw" in value) {
		const raw = (value as { raw?: unknown }).raw;
		return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
	}
	return null;
}

/**
 * A component the source files as interface or source context, not part of the modeled graph.
 *
 * v1 reads the same two typed booleans in `source-device-capabilities.ts` (`isInterfaceOnlyComponent`,
 * `isSourceOnlyComponent`) and gives the component an interface-only / source-only disposition that
 * keeps it out of the electrical analysis. v2 never read them, so an open placeholder the source says
 * not to model was lowered as an ordinary part and refused for a value the source deliberately omits
 * -- schaller-tremolo's `R_LED`, `InterfaceOnly: "true"` and `Value: open`, a panel-LED shell with no
 * driver the selected schematic specifies. The flag is a typed boolean compared whole, not prose.
 */
function isInterfaceOrSourceOnly(component: ComponentLike): boolean {
	return (
		unquoteBool(component, "InterfaceOnly") ||
		unquoteBool(component, "SourceOnly")
	);
}

/**
 * A board position the source says is unpopulated.
 *
 * `DNP` -- "do not populate" -- is a typed boolean stating that the footprint exists and nothing
 * is fitted in it. That is a *fact about the circuit*, not a missing value: an unpopulated
 * two-terminal position is an **open circuit**. So the component is dropped, exactly as if the
 * document had not listed it, rather than refusing the pedal for a value it is correct not to
 * state. Refusing was the previous behaviour, and it is the wrong reading of a complete source.
 *
 * `mxr-carbon-copy` is the corpus instance and the only one: `R45`, `R50`, `C32` and `C34`, each
 * `DNP: 'true'`, `SourceValue: Empty`, `SourceStatus: defer`. Two of them (`R45`, `C34`) bridge
 * the same node pair, which is what an unfitted either/or position looks like.
 *
 * **The typed flag only.** All four also say "unpopulated" in their `Description`, and that prose
 * is deliberately not read: a component whose description happens to mention an unpopulated
 * neighbour must not vanish from the solve. Same rule as `isInterfaceOrSourceOnly` above.
 */
function isNotPopulated(component: ComponentLike): boolean {
	if (unquoteBool(component, "DNP")) {
		return true;
	}
	const sourceStatus = propertyString(component, "SourceStatus");
	const sourceValue = propertyString(component, "SourceValue");
	if (
		sourceStatus === "defer" &&
		sourceValue !== null &&
		foldToken(sourceValue) === foldToken("visible-no-value-or-DNP")
	) {
		return true;
	}
	return false;
}

/** The interchange parser strips double quotes but keeps single; this reads both. */
function unquoteBool(component: ComponentLike, key: string): boolean {
	const value = propertyString(component, key);
	if (value === null) {
		return false;
	}
	const unquoted =
		(value.startsWith("'") && value.endsWith("'")) ||
		(value.startsWith('"') && value.endsWith('"'))
			? value.slice(1, -1).trim()
			: value;
	return unquoted === "true";
}

/**
 * `propertyString`, plus a bare unquoted YAML number.
 *
 * Scoped to the quantity fallback path below (`Resistance`/`R`, `Capacitance`/`C`,
 * `Inductance`/`L`, a rheostat's `MinResistance`, an unclaimed `voltage-source`'s
 * `Voltage`) and deliberately not folded into `propertyString` itself, whose other
 * callers read prose-ish closed-vocabulary fields (`Wipe`, `Position`, `Type`,
 * `PartNumber`, ...) where a bare number carries a different, unrelated meaning
 * (a control's stated 0..1 travel) that this change must not start reading.
 *
 * `boss-dd-3a` writes six resistors' fallback `R` as a plain unquoted number --
 * `R: 100`, not `R: "100"` or a typed `{raw, value, unit}` -- which is exactly as
 * unambiguous as its quoted twin: base units, no multiplier, nothing lost. But
 * `typeof value === "number"` matched neither branch above, so the value was
 * fully present and still read as absent, refusing `boss-dd-3a` over a value this
 * stage had in hand -- a wrong answer (refusal) that looked like a stricter read.
 */
function propertyQuantityText(
	component: ComponentLike,
	key: string,
): string | null {
	const value = (component.properties as Record<string, unknown>)[key];
	return typeof value === "number" && Number.isFinite(value)
		? String(value)
		: propertyString(component, key);
}

/**
 * Unit tokens that mean "already in base units" for each device kind. A prefixed unit
 * such as `kohm` is deliberately absent: this stage will not scale a unit it did not
 * read, because guessing wrong is a wrong answer that still renders.
 */
const baseUnitsByDeviceKind: Readonly<Record<string, readonly string[]>> = {
	resistor: ["", "ohm", "ohms", "Ω"],
	potentiometer: ["", "ohm", "ohms", "Ω"],
	rheostat: ["", "ohm", "ohms", "Ω"],
	capacitor: ["f", "farad", "farads"],
	inductor: ["h", "henry", "henries"],
	"voltage-source": ["v", "volt", "volts"],
	transformer: [""],
};

/**
 * Accepted unit tokens for a BJT's typed SPICE parameters, per property rather than per
 * device, because they do not share a dimension: `IS` is a current and the betas and the
 * emission coefficient are dimensionless.
 *
 * These are compared whole, like every other unit token here. Nothing reads `PartNumber`:
 * `OC41` is a germanium PNP and `2N3904` is a silicon NPN, and inferring that from the
 * string would be exactly the prose matching the engineering principles forbid. The device
 * type comes from `Type`, which the packets declare.
 */
const bjtParameterUnits: Readonly<Record<string, readonly string[]>> = {
	// `""` is accepted for `IS` because a SPICE saturation current has no plausible alternative
	// unit, and the corpus states it both ways: `electro-harmonix-lpb-1` declares
	// `IS: {raw: "1e-12", value: 1e-12, unit: ""}`. Rejecting the unlabelled form silently
	// substituted the silicon default and lost the declared value -- found by the value comparison
	// in `report-compiler-fidelity.ts` on its first run, which is the class of bug it exists for.
	IS: ["", "a", "amp", "amps", "ampere", "amperes"],
	BF: [""],
	BR: [""],
};

/**
 * The two device types a bipolar transistor can be, as a closed vocabulary compared whole.
 *
 * Case is normalised and nothing else is: an unrecognised value is refused by the caller
 * rather than resolved by prefix, so a `Type` of `N` does not silently become `NPN`. Five
 * devices in one corpus packet declare exactly that, and guessing would be indistinguishable
 * from reading it correctly right up to the point where it is wrong.
 */
const bjtPolarityByType: Readonly<Record<string, number>> = {
	NPN: 0,
	PNP: 1,
};

/**
 * A typed numeric property, taken from its structured `value` with the unit checked whole.
 *
 * Prefers `value` over `raw` because `raw` is authored prose: `IS` is declared as
 * `{raw: "1 nA", value: 1e-9, unit: A}`, and parsing "1 nA" means re-deriving a number the
 * packet already states exactly. Falls back to parsing a bare string, which is how a packet
 * that never adopted the structured form still reads.
 */
function typedNumber(
	component: ComponentLike,
	key: string,
	acceptedUnits: readonly string[],
): number | null {
	const property = (component.properties as Record<string, unknown>)[key];
	if (property !== null && typeof property === "object") {
		const { value, unit } = property as { value?: unknown; unit?: unknown };
		if (typeof value === "number" && Number.isFinite(value)) {
			const token =
				typeof unit === "string" ? unit.replaceAll("'", "").trim() : "";
			return acceptedUnits.includes(token.toLowerCase()) ? value : null;
		}
		return null;
	}
	const raw = propertyString(component, key);
	if (raw === null) {
		return null;
	}
	try {
		return parseQuantity(raw);
	} catch {
		return null;
	}
}

/** A structured quantity's value, but only when it is already in base units. */
function baseUnitQuantity(
	component: ComponentLike,
	key: string,
	// A plain string, not `DeviceKind`: callers pass the component's own `kind`, whose type
	// admits `"unsupported"`. The lookup is by string and an unknown key already returns null,
	// which is the same answer a narrower type would have forced at the call site.
	kind: string,
): number | null {
	const property = (component.properties as Record<string, unknown>)[key];
	if (property === null || typeof property !== "object") {
		return null;
	}
	const { value, unit } = property as { value?: unknown; unit?: unknown };
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	const accepted = baseUnitsByDeviceKind[kind];
	if (accepted === undefined) {
		return null;
	}
	// Some packets quote the empty unit, so `''` reaches here as two apostrophes.
	const token = typeof unit === "string" ? unit.replaceAll("'", "").trim() : "";
	return accepted.includes(token) || accepted.includes(token.toLowerCase())
		? value
		: null;
}

/**
 * Parse a quantity to SI base units. A value that cannot be parsed is an error, not a
 * default -- a silently defaulted component is a silently wrong circuit.
 */
export function parseQuantity(raw: string): number {
	// Case is load-bearing and must survive: `M` is mega and `m` is milli, a factor
	// of 1e9 apart. Lower-casing first, as an earlier version of this function did,
	// silently turned every 1M resistor in the corpus into 1 milliohm -- a wrong
	// answer that still renders, which is this domain's characteristic failure.
	//
	// Real schematic values carry more than a number: `10uF/16V` is a capacitance
	// with a voltage rating, `2.7nF 5%` a tolerance, `100kB` a taper code, `10 ko`
	// an ohm sign transliterated to a letter. Reading those is parsing the notation,
	// not repairing the document -- the value is unambiguous and fully present. What
	// is still refused is a leading token that is not a quantity at all.
	let text = raw
		.trim()
		.replace(/^['"]+|['"]+$/gu, "")
		.trim();
	// A rating after a slash describes the part, not its value.
	const slash = text.indexOf("/");
	if (slash > 0) {
		text = text.slice(0, slash).trim();
	}

	// R-notation, where the multiplier letter stands in for the decimal point, so
	// `4u7` is 4.7 microfarads and `1k5` is 1500 ohms. Checked before the general
	// form, which would otherwise read `1k5` as 1000 and silently drop the 5.
	const compact = text.replace(/\s+/gu, "");
	const rNotation = /^([+-]?\d+)(R|r|k|K|M|m|u|µ|μ|n|p|G|g)(\d+)$/u.exec(
		compact,
	);
	if (rNotation !== null) {
		const whole = rNotation[1] as string;
		const unit = rNotation[2] as string;
		const fraction = rNotation[3] as string;
		const isOhmMarker = unit === "R" || unit === "r";
		return parseQuantity(`${whole}.${fraction}${isOhmMarker ? "" : unit}`);
	}

	// Number, optional multiplier, optional unit. Anything after that is annotation.
	// The multiplier group is case-sensitive; the unit group is not, because a unit
	// carries no scale and no multiplier letter appears in it.
	const match =
		/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(meg|MEG|Meg|[pnuµμmkKMGg]|[PNU])?\s*(ohms?|Ω|ω|o|O|R|farads?|henr(?:y|ies)|volts?|amps?|hz|[fFhHvVaA])?/u.exec(
			text,
		);
	if (match === null) {
		throw new NetlistError(`cannot parse quantity "${raw}"`);
	}
	const value = Number(match[1]);
	if (!Number.isFinite(value)) {
		throw new NetlistError(`cannot parse quantity "${raw}"`);
	}

	const multipliers: Readonly<Record<string, number>> = {
		p: 1e-12,
		P: 1e-12,
		n: 1e-9,
		N: 1e-9,
		u: 1e-6,
		U: 1e-6,
		µ: 1e-6,
		μ: 1e-6,
		m: 1e-3,
		k: 1e3,
		K: 1e3,
		M: 1e6,
		meg: 1e6,
		MEG: 1e6,
		Meg: 1e6,
		G: 1e9,
		g: 1e9,
	};
	const symbol = match[2];
	if (symbol === undefined) {
		return value;
	}
	const multiplier = multipliers[symbol];
	if (multiplier === undefined) {
		throw new NetlistError(
			`cannot parse quantity "${raw}": unknown multiplier "${symbol}"`,
		);
	}
	return value * multiplier;
}

function parametersFor(
	component: ComponentLike,
	kind: DeviceKind,
): Record<string, number> {
	// A supply rail asserts a potential at its node. Most declare one -- 84 of the
	// corpus's 90 -- and the six that do not are named support shells with nothing to
	// assert, so an absent voltage is silence rather than an error.
	// **A fuse states a current rating, never a resistance.** `FuseRating: "2 A Slow Blow"` is
	// what it opens at, not what it drops while intact, so demanding a resistance would refuse
	// every fuse in the corpus for a value no fuse datasheet leads with.
	//
	// Zero is the honest answer and the law below already knows what to do with it: the resistor
	// case stamps a stated zero as `SWITCH_ON_OHMS`, "the same electrically-indistinguishable-
	// from-ideal short this file already stamps for a closed switch". A fuse is that short --
	// which is the whole content of "a fuse is just a hard wire" -- and it reaches it through
	// machinery that was already there rather than a constant invented for fuses.
	if (component.kind === "fuse") {
		// **A declared resistance wins, because a real fuse has one.** An intact fuse is a thin
		// wire, and a lower-rated one is thinner: `marshall-jcm800` states 0.05 Ω for its T2A and
		// 0.5 Ω for its T1A, which is the only pair in the corpus that scales with rating at all.
		// `marshall-jtm45` states the same 0.001 Ω for a 2 A and a 500 mA fuse and its own raw
		// calls that a "closed fuse link"; `orange-gro100` states 0.01 Ω, which is exactly
		// `SWITCH_ON_OHMS`. Those two are ideal-short placeholders, jcm800's are physical, and
		// forcing zero here would discard the physical ones on sight.
		//
		// Zero is the fallback rather than the rule, and the resistor law turns it into
		// `SWITCH_ON_OHMS` -- the short this file already stamps for a closed switch. So a fuse
		// that states nothing still conducts, and one that states a resistance keeps it.
		// **Read the typed value, not the raw.** `baseUnitQuantity` is the reader the resistor
		// path uses for exactly this reason -- its own note says to prefer a stated `unit: "ohm"`
		// "instead of re-parsing an ambiguous schematic label". A fuse is the sharpest case of
		// that ambiguity: `jcm800`'s `Resistance` is `{ raw: "2 A", value: 0.05, unit: "Ω" }`, and
		// parsing the raw yields 2 Ω, forty times the stated value. Its T1A raw parses to nothing
		// at all, which would have silently become the zero fallback.
		// The typed value first, then the string -- the same order the resistor path uses, and
		// both rungs are needed. `jcm800` states a typed `{ value: 0.05, unit: "Ω" }` whose raw
		// says "2 A", so only the typed rung is right there; `orange-rockerverb` states a plain
		// `R: "0.01 ohm"` with no typed value at all, so only the parsing rung reaches it. Taking
		// the typed rung alone silently zeroed six of rockerverb's fuses.
		const declared =
			baseUnitQuantity(component, "Resistance", "resistor") ??
			baseUnitQuantity(component, "R", "resistor") ??
			optionalQuantity(component, "Resistance") ??
			optionalQuantity(component, "R");
		return { ohms: declared ?? 0 };
	}
	if (kind === "rail") {
		const volts = optionalQuantity(component, "Voltage");
		return volts === null ? {} : { volts };
	}
	// A transformer's turns ratio, from the impedances the source states as typed quantities.
	//
	// **Not one of the 52 transformers in the amp corpus declares a `Ratio`**, so the property
	// this stage was demanding can never be satisfied by that corpus. What they do declare, and
	// often as structured `{value, unit}` rather than prose, is a primary and secondary
	// impedance — and `Zp/Zs = (Np/Ns)^2` is transformer theory, so `n = sqrt(Zp/Zs)` is
	// arithmetic on typed data rather than a reading of authored text. `fender-5e3-deluxe-tweed`
	// states `8000 Ω` and `8 Ω`, giving 31.6; `marshall-jtm45` states `6600` and `16`, giving
	// 20.3.
	//
	// Only typed quantities count. Many of the same properties appear elsewhere as prose
	// (`PrimaryImpedance: "2 kΩ plate-to-plate reference-class"`, `TurnsRatio: "44.72:1"`) and
	// those stay unread, because parsing a number out of a sentence is exactly what this
	// pipeline forbids — a typed `Ratio` or `TurnsRatio` remains the direct way to state it.
	if (kind === "transformer") {
		// `TurnsRatio` is the same quantity under the spelling two packets already use for it:
		// `fender-bassman` states `44.72:1` where its impedances give `sqrt(4000/2) = 44.72`, and
		// `marshall-1959-super-lead-plexi` states `10.31:1` against `sqrt(1700/16) = 10.31`. Both
		// are prose today and stay unread; typed, either spelling now resolves.
		const declared =
			optionalQuantity(component, "Ratio") ??
			typedRatio(component, "TurnsRatio");
		if (declared !== null) {
			return {
			...windingResistanceParameters(component), ratio: declared };
		}
		// The pair comes off the coils that carry it (`@vessel-dsp/core@0.6.37`), replacing
		// `PrimaryImpedance`/`SecondaryImpedance` and their `InputImpedance`/`OutputImpedance`
		// spellings -- which were the same two ratings on a reverb tank's drive and pickup coils.
		// The reference is the coil the signal enters; a tank's is `drive`.
		const primary = windingRatingOhms(component, ["primary", "drive"]);
		const secondary = windingRatingOhms(component, ["secondary", "pickup"]);
		if (
			primary !== null &&
			secondary !== null &&
			primary > 0 &&
			secondary > 0
		) {
			// The pair is carried alongside the ratio it derives, not only folded into it: a
			// spring reverb tank is specified by this same `InputImpedance`/`OutputImpedance`
			// pair, and its law needs the two port impedances themselves -- the drive coil's
			// load and the pickup's source impedance -- which `sqrt(Zp/Zs)` has already thrown
			// away. Every other transformer ignores these two and reads `ratio` as before.
			return {
			...windingResistanceParameters(component),
				ratio: Math.sqrt(primary / secondary),
				primaryImpedanceOhms: primary,
				secondaryImpedanceOhms: secondary,
			};
		}
		// Third and last: a transformer the source specifies by its **coil voltages**, which is
		// every mains power transformer. It declares no ratio because it does not have one -- a
		// 290 V HV winding, a 5 V rectifier heater and a 6.3 V filament bus off one primary are
		// three different ratios on one core -- and, decisively, it does not need one.
		//
		// Those voltages live on the coils now, so there is nothing to lift into `parameters`:
		// `device-laws.ts` reads each coil's own `voltageRmsVolts`. What remains here is the
		// refusal, which has moved to a sharper question. It used to be "is this `*Secondary`
		// spelling one of the eight I know", a spelling check that could not see a stated voltage
		// whose winding was never declared -- `mesa-boogie-dual-rectifier` states a filament
		// voltage for terminals its transformer does not draw, and that was silently discarded.
		// Now it is "does any coil state a voltage", and a leftover typed winding property is a
		// quantity no coil claims.
		requireWindingSpecification(component);
		return {
			...windingResistanceParameters(component),};
	}
	// A voltage source's **frequency is what tells AC from DC**, and it is declared as a typed
	// quantity rather than left to prose.
	//
	// 19 of the 25 supplies in the amp corpus carry a `Frequency` beside their `Voltage`, often
	// structured: `fender-5f1-champ` states
	// `Frequency: {raw: "60 Hz assumed nominal", value: 60, unit: "Hz"}`. A mains inlet has one and
	// a battery cannot, so the *presence* of the property is the discriminator — a closed key name
	// compared whole, not a reading of `raw`, and nothing here parses "VAC" out of a sentence.
	//
	// This was previously recorded as an amp-lane blocker needing a source change, on the grounds
	// that "the compiler has no AC concept and the typed voltage does not say VAC". The first half
	// was true and the second was not: the discriminator was already in the packets and this stage
	// simply discarded it, because `parameterKeyByDeviceKind` reads exactly one property per kind.
	//
	// **This stage still does not say RMS or peak** — `value: 120` with `unit: "V"` is passed
	// through as a bare magnitude; only the prose says RMS, and this stage does not read prose.
	// That reading is decided downstream, in `device-laws.ts`'s `ac-source` law: this project's
	// convention is that a typed AC-source magnitude means RMS, so the law converts it to the
	// peak amplitude the sine evaluation needs.
	if (kind === "voltage-source") {
		const volts = optionalQuantity(component, "Voltage");
		const frequency = optionalQuantity(component, "Frequency");
		if (volts !== null) {
			return frequency === null ? { volts } : { volts, frequency };
		}
	}
	// An op-amp's open-loop gain, which 31 of the corpus's 52 declare and none of them reached.
	//
	// `Aol` is stated two ways and both are already linear: a bare number, and the structured form
	// with the decibel conversion done -- `{raw: "92 dB", value: 39810, unit: ""}`. So the typed
	// `value` is taken as-is and nothing here converts from dB, which would double-apply it.
	//
	// `GBP` and `SR` are deliberately not read. The gain-bandwidth product has no consumer until a
	// dominant pole exists, and that was implemented and reverted; reading it into the stamp now
	// would be a field nothing uses. `SR` is stated as `"1.2 V/us"`, and `parseQuantity` strips
	// after the slash, so it would yield 1.2 for the wrong reason -- right number, lost units.
	if (kind === "opamp") {
		// `typedNumber`, not `optionalQuantity`, and the difference is a 433x error.
		// `optionalQuantity` reads `raw` first, so `{raw: "92 dB", value: 39810, unit: ""}` parsed as
		// **92** -- the decibel figure taken as a linear gain. The structured `value` already carries
		// the conversion, so it has to win. Caught by measuring the stamped gains after the change
		// rather than by reading the code.
		const gain = typedNumber(component, "Aol", [""]);
		return gain !== null && gain > 0 ? { openLoopGain: gain } : {};
	}
	// A delay-memory shell's own delay time, which is a **packet** fact rather than a part fact.
	//
	// A bucket brigade's delay is `stages / (2 * f_clock)`, so the same chip is a 0.5 ms flanger in
	// one pedal and a 300 ms echo in another -- Panasonic's own MN3007 record spans 5.12 ms to
	// 51.2 ms across its clock range alone. The stage count belongs to the part and lives in the
	// registry; the clock rate belongs to the circuit. Where the clock network is modelled the
	// `parameter` port derives it, but a real BBD's clock net is a chip-only net between the
	// memory and its clock driver, so for a packet whose clock driver has no model there is no
	// derivation to make and the source's own declaration is the only fact available.
	//
	// Six corpus packets declare it and five are delay-memory shells (`boss-ce-1`, `boss-vb-2`,
	// `mxr-m117r-flanger`, `mxr-micro-flanger`, `electro-harmonix-electric-mistress`), so this is
	// the corpus's own convention for the quantity and not one packet's special case. It was
	// declared and discarded until now, in the same way `Aol` and `ZenerVoltage` were.
	//
	// `MinDelayMs`/`MaxDelayMs` are deliberately not read. They bound a control's travel, and no
	// control is bound to this parameter yet, so reading them would be a field nothing uses.
	if (kind === "ic") {
		const params: Record<string, number> = {};
		const delayProp = (component.properties as Record<string, unknown>)?.DelayMs;
		if (delayProp !== undefined && delayProp !== null) {
			if (typeof delayProp === "object") {
				const { value, unit } = delayProp as {
					value?: unknown;
					unit?: unknown;
				};
				if (typeof value === "number" && Number.isFinite(value) && value > 0) {
					const u =
						typeof unit === "string"
							? unit.replaceAll("'", "").trim().toLowerCase()
							: "";
					if (u === "s" || u === "sec") {
						params.delaySeconds = value;
					} else if (u === "ms" || u === "") {
						params.delaySeconds = value / 1000;
					}
				}
			} else {
				const raw = propertyString(component, "DelayMs");
				if (raw !== null) {
					try {
						const num = parseQuantity(raw);
						if (num > 0) {
							params.delaySeconds =
								raw.toLowerCase().includes("s") &&
								!raw.toLowerCase().includes("ms")
									? num
									: num / 1000;
						}
					} catch {}
				}
			}
		}
		const outVolts = optionalQuantity(component, "OutputVoltage");
		if (outVolts !== null) {
			params.volts = outVolts;
		}
		return params;
	}
	// A capacitor's DC leakage, opt-in per declared part. At DC an ideal capacitor is an open
	// circuit, and that openness is load-bearing: a transcription error that leaves a bias
	// network reachable only through a capacitor shows up as a floating operating point
	// instead of rendering a plausible wrong answer. So leakage is read only where the source
	// declares it, never defaulted by class, and an undeclared capacitor stays ideal.
	//
	// Two printed datasheet forms, tried in this order:
	// - `InsulationResistance`, the film/ceramic spec, an ohm quantity used directly;
	// - `LeakageCurrent` at `VoltageRating`, the electrolytic spec, which only becomes a
	//   resistance when both are declared. A leakage current with no stated voltage is
	//   refused rather than guessed at, the same rule the BJT's `LeakageCurrent` follows
	//   for prose: an unusable declaration is absent, not approximated.
	// Falls through to the generic tail below rather than returning, because a capacitor's
	// capacitance still comes from `parameterKeyByDeviceKind` -- these are extras beside it,
	// not a replacement for it.
	const capacitorLeak: Record<string, number> = {};
	if (kind === "capacitor") {
		const insulation = optionalQuantity(component, "InsulationResistance");
		if (insulation !== null && insulation > 0) {
			capacitorLeak.insulationOhms = insulation;
		}
		const leakage = optionalQuantity(component, "LeakageCurrent");
		const rated = optionalQuantity(component, "VoltageRating");
		if (leakage !== null && leakage > 0 && rated !== null && rated > 0) {
			capacitorLeak.leakageAmps = leakage;
			capacitorLeak.ratedVolts = rated;
		}
	}
	// A zener's breakdown voltage, which is the only thing separating it from a plain diode.
	//
	// A ferrite bead spec'd by impedance-vs-frequency carries no inductance in the source.
	// The default is applied downstream in `device-laws.ts`; an absent value is not an error.
	if (kind === "inductor") {
		// **Winding DC resistance, in three states.** A number is stamped; the string `unknown` is
		// the packet stating that the source does not print it -- Fender sheets give turns ratios
		// and impedances, never copper resistance -- and is carried as a claim rather than a value;
		// absence is neither, and is never defaulted to zero. Zero is the one physically impossible
		// value for a winding, and defaulting to it is how 67 corpus windings came to be lossless.
		//
		// `parameters` is `Record<string, number>`, so the third state is carried as its own flag
		// rather than by widening that map: `windingResistanceOhms` present means declared,
		// `windingResistanceUnknown: 1` means the packet said so explicitly, and neither means
		// nobody has said anything. Three states, still machine-readable, no default.
		const winding = windingResistanceParameters(component);
		const henries = optionalQuantity(component, "Inductance");
		if (henries !== null && henries > 0) {
			return { henries, ...winding };
		}
		const fallback = optionalQuantity(component, "L");
		if (fallback !== null && fallback > 0) {
			return { henries: fallback, ...winding };
		}
		return { ...winding };
	}
	// 25 diodes across 18 packets declare it, 13 of those packets compiling, and every one was
	// discarded: the stamp had no field for it, so a zener never broke down, never clamped, and
	// every zener-regulated rail floated to the supply. `boss-ph-1r` is the clean case -- it
	// declares a `5.1 V zener reference for the PH-1r bias rail` *and* a port stating 5.1 V on
	// that same node, so the source agrees with itself and the rail still solved at 8.441 V.
	//
	// Read from `ReverseBreakdownVoltage`, a typed quantity. `Type: Zener` alone is not enough to
	// act on -- it says the part is a zener without saying at what voltage -- so it is deliberately
	// not treated as evidence for a magnitude, and nothing reads a part number to guess one.
	if (kind === "diode") {
		// Three spellings of one quantity, all volts, all unambiguous. `ReverseBreakdownVoltage`
		// appears on one packet's diodes; `BreakdownVoltage` on four and `ZenerVoltage` on five
		// carried the same datum and were discarded, so the zener law reached 15 stamps and missed
		// nine purely on vocabulary.
		//
		// `SaturationCurrent` is not a synonym but the same shape of gap: a diode's own saturation
		// current, stated in amps, against a hardcoded class default of 2.52e-9.
		const breakdown =
			optionalQuantity(component, "ReverseBreakdownVoltage") ??
			optionalQuantity(component, "BreakdownVoltage") ??
			optionalQuantity(component, "ZenerVoltage");
		const saturation = optionalQuantity(component, "SaturationCurrent");
		const seriesResistance =
			optionalQuantity(component, "SeriesResistance") ??
			optionalQuantity(component, "OhmicResistance") ??
			optionalQuantity(component, "RS") ??
			optionalQuantity(component, "Rs");
		return {
			...(breakdown !== null && breakdown > 0
				? { breakdownVolts: breakdown }
				: {}),
			...(saturation !== null && saturation > 0
				? { saturationCurrent: saturation }
				: {}),
			...(seriesResistance !== null && seriesResistance > 0
				? { seriesResistance }
				: {}),
		};
	}
	// A bipolar transistor's device type and SPICE parameters, which this stage used to
	// discard in full.
	//
	// `deviceLaw` reads `parameters.pnp` and `parameters.beta`, and **nothing wrote either**:
	// there was no `bjt` entry here, so every one of the corpus's 385 bipolar transistors was
	// stamped as the same silicon NPN with `beta = 100` and `IS = 1e-14`, whatever the packet
	// said. 43 of them declare `Type: PNP`.
	//
	// The parameters are declared, typed, and specific. `sola-sound-tone-bender-professional-mkii`
	// gives `Q1` a `Type` of PNP, `IS` of `{raw: "1 nA", value: 1e-9, unit: A}`, `BF` 70, `BR` 2
	// and a `PartNumber` of `OC41` -- a germanium PNP. `Vbe = Vt * ln(Ic / IS)` at 1 mA is 0.345 V
	// at the declared `IS` against 0.633 V at the silicon default, so a germanium bias network
	// modelled with silicon never reaches turn-on and the pedal renders near-silence.
	//
	// Each is omitted when absent rather than defaulted here, so `deviceLaw` keeps ownership of
	// what an undeclared parameter means. Only 10% of the corpus's transistors declare `IS`.
	if (kind === "bjt") {
		// `Polarity` is the same closed vocabulary under a second spelling, and 17 of the corpus's
		// transistors declare it with no `Type` at all -- including `boss-tw-1`'s `Q4` and `Q5`,
		// declared `PNP` with a `2SA1015-Y` part number and stamped NPN because only `Type` was
		// read. Found by `report-source-coverage.ts` on its first run.
		const declaredType =
			propertyString(component, "Type") ??
			propertyString(component, "Polarity");
		const parameters: Record<string, number> = {};
		if (declaredType !== null) {
			const polarity = bjtPolarityByType[declaredType.toUpperCase()];
			if (polarity === undefined) {
				throw new NetlistError(
					`component ${component.id}: bjt has Type "${declaredType}", which is not NPN or PNP`,
					String(component.id),
				);
			}
			parameters.pnp = polarity;
		}
		for (const [key, name] of [
			["IS", "saturationCurrent"],
			["BF", "beta"],
			["BR", "reverseBeta"],
		] as const) {
			const value = typedNumber(component, key, bjtParameterUnits[key] ?? []);
			if (value !== null && value > 0) {
				parameters[name] = value;
			}
		}
		// `LeakageCurrent` is the one BJT property the packets do **not** declare in the
		// structured form: all 14 that carry it carry a bare string, and they are not
		// homogeneous -- "0.15 uA", "0.1 \u03bcA" with the micro sign, "100 uA", and on
		// `dallas-arbiter-fuzz-face-ac128` the sentence "source-bounded germanium specimen
		// parameter; exact original unit unclaimed", which is a note and not a value.
		//
		// So this reads it as a quantity and treats an unparseable one as absent. That is the
		// same rule the other three follow, and it is honest here for a specific reason: the
		// one string that will not parse says in words that its value is unclaimed. Nothing
		// pattern-matches the prose -- `parseQuantity` refuses a leading token that is not a
		// quantity, and the refusal is the whole decision.
		const leakage = propertyString(component, "LeakageCurrent");
		if (leakage !== null) {
			try {
				const amps = parseQuantity(leakage);
				if (Number.isFinite(amps) && amps > 0) {
					parameters.leakageAmps = amps;
				}
			} catch {
				// Not a quantity, so not declared.
			}
		}
		return parameters;
	}
/**
 * A FET's channel polarity from its declared type, or `null` when the document does not say.
 *
 * **Whole tokens against a closed vocabulary, never `includes("P")`.** The first version tested
 * `upper.includes("P")` then `upper.includes("N")`, which was correct on all eight values the
 * corpus happens to carry today only because `'N-channel JFET'` contains no P. Values one word
 * away break it, and P was tested first so P always won:
 *
 *     'N-channel depletion'   -> p-channel   (the P is in "depletion")
 *     'N-ch (P-suffix pkg)'   -> p-channel
 *     'Depletion'             -> p-channel   (carries no channel information at all)
 *
 * A polarity read backwards inverts the device's whole transfer curve and stays silent, because
 * the circuit still solves. This is the same rule `wiperRoles` and `switchCommonRoles` already
 * follow, and the same failure the CD4047 pin map and the pot-wiper short were.
 */
function declaredChannel(declared: string): "n" | "p" | null {
	// Folded the way `foldToken` folds: lowercased, and every separator dropped, so
	// `P-Channel`, `p channel`, `P_CHANNEL` and `pchannel` are one token.
	const folded = declared.toLowerCase().replace(/[^a-z0-9]/gu, "");
	const P: ReadonlySet<string> = new Set([
		"p",
		"pchannel",
		"pchanneljfet",
		"pchannelmosfet",
		"pjfet",
		// SPICE's own device keywords, which is what `boss-pq-4` declares ("NJF").
		"pjf",
		"pmos",
		"pmosfet",
		"pfet",
		"pch",
	]);
	const N: ReadonlySet<string> = new Set([
		"n",
		"nchannel",
		"nchanneljfet",
		"nchannelmosfet",
		"njfet",
		"njf",
		"nmos",
		"nmosfet",
		"nfet",
		"nch",
	]);
	if (P.has(folded)) {
		return "p";
	}
	if (N.has(folded)) {
		return "n";
	}
	// A prefixed spelling the closed set does not enumerate -- `n-channel depletion`,
	// `p-channel enhancement`. Anchored at the start and required to be followed by the word
	// `channel`, so the polarity letter cannot be picked up from the middle of another word.
	const prefixed = /^([np])channel/u.exec(folded);
	if (prefixed !== null) {
		return prefixed[1] === "p" ? "p" : "n";
	}
	return null;
}

	if (kind === "jfet" || kind === "mosfet") {
		const parameters: Record<string, number> = {};
		const declaredType =
			propertyString(component, "Type") ??
			propertyString(component, "Polarity") ??
			propertyString(component, "Channel");
		if (declaredType !== null) {
			const channel = declaredChannel(declaredType);
			if (channel !== null) {
				parameters.pChannel = channel === "p" ? 1 : 0;
			}
		}
		const rawPChannel = (component.properties as Record<string, unknown> | undefined)?.pChannel;
		if (
			rawPChannel === 1 ||
			rawPChannel === "1" ||
			rawPChannel === true ||
			rawPChannel === "true"
		) {
			parameters.pChannel = 1;
		}
		const vto =
			optionalQuantity(component, "VTO") ??
			optionalQuantity(component, "ThresholdVoltage") ??
			optionalQuantity(component, "thresholdVolts");
		if (vto !== null) {
			parameters.thresholdVolts = vto;
		}
		const beta =
			optionalQuantity(component, "BETA") ??
			optionalQuantity(component, "Transconductance") ??
			optionalQuantity(component, "transconductance");
		if (beta !== null) {
			parameters.transconductance = beta;
		}
		return parameters;
	}
	const key = parameterKeyByDeviceKind[kind];
	if (key === undefined) {
		return {};
	}
	const name = parameterNameByDeviceKind[kind] ?? "value";
	const raw =
		propertyQuantityText(component, key) ??
		(fallbackParameterKeys[kind] ?? []).reduce<string | null>(
			(found, fallback) => found ?? propertyQuantityText(component, fallback),
			null,
		);
	if (raw === null) {
		throw new NetlistError(
			`component ${component.id}: ${kind} has no ${key}`,
			String(component.id),
		);
	}
	// A rheostat is the one device with two values: the track it sweeps and the residual
	// resistance at the bottom of the sweep. Absent, the bottom is a dead short, so the
	// stamp floors it rather than this stage inventing a minimum.
	// A pot reads it too, and used not to. This was gated on `rheostat` alone, so a
	// `MinResistance` declared on a `potentiometer` was parsed and then dropped on the
	// floor -- the same silent-drop shape as the five parameters `report-source-coverage.ts`
	// was written to catch, latent rather than live only because all 7 of the corpus's
	// declarations happen to sit on `variable-resistor` rows. The two kinds spend it
	// differently (`device-laws.ts`: a sweep floor for a rheostat, an end resistance taken
	// out of a fixed track for a pot), so reading it here is not the same as sharing a law.
	const extra: Record<string, number> =
		kind === "rheostat" || kind === "potentiometer"
			? { minOhms: optionalOhms(component, "MinResistance") }
			: {};

	// If the source states the quantity in base units (`unit: "F"`, `unit: "ohm"`, etc.),
	// use that directly instead of re-parsing an ambiguous schematic label like `.01 CER`
	// or `100/16` where parseQuantity would see `.01` or `100` as base units.
	const base =
		baseUnitQuantity(component, key, kind) ??
		(fallbackParameterKeys[kind] ?? []).reduce<number | null>(
			(found, fallback) =>
				found ?? baseUnitQuantity(component, fallback, kind),
			null,
		);
	if (base !== null) {
		return { [name]: base, ...extra, ...capacitorLeak };
	}

	return { [name]: parseQuantity(raw), ...extra, ...capacitorLeak };
}

/** An optional quantity, absent rather than defaulted when it is not declared. */
function optionalOhms(component: ComponentLike, key: string): number {
	const raw = propertyString(component, key);
	if (raw === null) {
		return 0;
	}
	try {
		return parseQuantity(raw);
	} catch {
		// Same defect as `optionalQuantity`: read the component's own kind first, keeping
		// `resistor` as a second attempt so this cannot change a value that already resolved.
		return (
			baseUnitQuantity(component, key, component.kind) ??
			baseUnitQuantity(component, key, "resistor") ??
			0
		);
	}
}

/** An optional quantity, null when the component does not declare it at all. */
/**
 * An impedance the source states as a **structured quantity** — `{raw, value, unit}` — in ohms.
 *
 * Deliberately strict. The same property names carry prose elsewhere in the corpus
 * (`"2 kΩ plate-to-plate reference-class"`), and a reader that fell back to scraping a number
 * out of that sentence would be deciding a device parameter from authored text. `null` here
 * means "the source did not state this as data", which is a source fact and refusable, not a
 * gap to paper over.
 */
/**
 * A turns ratio the source states as a **structured quantity**, or `null`.
 *
 * Typed only, and deliberately stricter than the `Ratio` beside it. `Ratio` keeps `optionalQuantity`,
 * which accepts the format's ordinary string value encoding -- `Ratio: "2"`, the same shape as a
 * resistor's `R: "10k"` -- and has fixture coverage for it.
 *
 * `TurnsRatio` does not inherit that, because its only two occurrences in the corpus are the colon
 * form: `fender-bassman` states `"44.72:1"` and `marshall-1959-super-lead-plexi` `"10.31:1"`.
 * `parseQuantity` reads those as `44.72` and `10.31`, which happens to be right -- and would read
 * `"1:44.72"` as `1`, silently inverting the transformer. A newly recognised spelling should not
 * inherit a coincidence, so this one requires the source to have committed to a number.
 *
 * No transformer declares either spelling typed today, so this reads nothing yet; it exists so that
 * typing one is not a trap. Both real occurrences match what the impedances give --
 * `sqrt(4000/2) = 44.72` and `sqrt(1700/16) = 10.31` -- confirming it is the same quantity.
 *
 * Dimensionless: an empty or absent unit, or the `:1` a ratio is conventionally written with. A
 * ratio carrying volts or ohms is a different quantity and is refused rather than guessed at.
 */
function typedRatio(component: ComponentLike, key: string): number | null {
	const property = (component.properties as Record<string, unknown>)[key];
	if (property === null || typeof property !== "object") {
		return null;
	}
	const { value, unit } = property as { value?: unknown; unit?: unknown };
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return null;
	}
	const token = typeof unit === "string" ? unit.trim().toLowerCase() : "";
	return token === "" || token === ":1" ? value : null;
}

function typedOhms(component: ComponentLike, key: string): number | null {
	const property = (component.properties as Record<string, unknown>)[key];
	if (property === null || typeof property !== "object") {
		return null;
	}
	const { value, unit } = property as { value?: unknown; unit?: unknown };
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	const token = typeof unit === "string" ? unit.trim().toLowerCase() : "";
	return token === "" || token === "ω" || token === "ohm" || token === "ohms"
		? value
		: null;
}

/**
 * A winding voltage the source states as a **structured quantity** in volts.
 *
 * Same discipline as `typedOhms`, and deliberately without the empty-unit fallback that
 * ohms accepts: an unlabelled number could be almost anything, and a voltage-shaped
 * property with no unit is not the same source fact as one that says `V`. Every winding
 * voltage in the corpus that reaches this reads `unit: V`.
 */
function typedVolts(component: ComponentLike, key: string): number | null {
	const property = (component.properties as Record<string, unknown>)[key];
	if (property === null || typeof property !== "object") {
		return null;
	}
	const { value, unit } = property as { value?: unknown; unit?: unknown };
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	const token = typeof unit === "string" ? unit.trim().toLowerCase() : "";
	return token === "v" || token === "volt" || token === "volts" ? value : null;
}

/**
 * The impedance one of this transformer's coils is rated at, in ohms, or null.
 *
 * `roles` is tried in order and the first coil carrying a rating wins, which is how one reader
 * serves both a transformer (`primary`/`secondary`) and a spring reverb tank (`drive`/`pickup`) --
 * the two shapes that used to need `PrimaryImpedance`/`SecondaryImpedance` and
 * `InputImpedance`/`OutputImpedance` as separate property spellings.
 *
 * A coil may carry several ratings, one per rated tap. This returns the **first**, which for every
 * corpus coil but one is the only one; the multi-tap case is decided in `transformer.ts`, where
 * connectivity says which taps are live and each stamped winding takes the rating of its own tap.
 * A single number could not answer it here: `orange-rockerverb`'s output secondary rates a 16 Ω
 * and an 8 Ω tap that are loaded at the same time.
 */
function windingRatingOhms(
	component: ComponentLike,
	roles: readonly string[],
): number | null {
	const windings = (component as { windings?: unknown }).windings;
	if (!Array.isArray(windings)) {
		return null;
	}
	for (const role of roles) {
		for (const winding of windings) {
			if (winding === null || typeof winding !== "object") {
				continue;
			}
			const entry = winding as { role?: unknown; impedances?: unknown };
			if (entry.role !== role || !Array.isArray(entry.impedances)) {
				continue;
			}
			for (const rating of entry.impedances) {
				const ohms = quantityValue(
					(rating as { impedance?: unknown } | null)?.impedance,
				);
				if (ohms !== null && ohms > 0) {
					return ohms;
				}
			}
		}
	}
	return null;
}

/**
 * A transformer must state *something* a stamp can be built from, and this is where that is
 * required.
 *
 * Either a ratio, or a rated impedance pair, or at least one coil's own voltage. A document
 * satisfying none of the three describes a transformer nobody can lower, and it refuses here
 * rather than producing a silent open circuit downstream.
 *
 * **A typed winding-voltage property that survives on the component is a quantity no coil
 * claims.** Ratings live on the coils now, so a leftover typed `*Secondary` is either a value
 * whose winding the document never declared, or a backfill that stopped early. The old check in
 * this position asked whether the *spelling* was one of eight it recognised, which could not see
 * either case: `mesa-boogie-dual-rectifier` states a filament voltage for terminals its
 * transformer does not draw, under a spelling that was in the list, and it was silently dropped.
 */
function requireWindingSpecification(component: ComponentLike): void {
	const windings = (component as { windings?: unknown }).windings;
	const coils = Array.isArray(windings) ? windings : [];
	for (const key of Object.keys(component.properties as Record<string, unknown>)) {
		if (!key.endsWith("Secondary") || typedVolts(component, key) === null) {
			continue;
		}
		throw new NetlistError(
			`component ${component.id}: transformer states a typed "${key}" winding voltage as a component property, but a coil's voltage belongs to the coil -- either no declared winding claims this value, or it has not been moved onto one`,
			String(component.id),
		);
	}
	if (
		coils.some(
			(winding) =>
				quantityValue((winding as { voltage?: unknown } | null)?.voltage) !==
				null,
		)
	) {
		return;
	}
	throw new NetlistError(
		`component ${component.id}: transformer states no Ratio, no rated impedance pair on its coils, and no coil voltage -- a transformer whose primary carries signal needs a ratio or an impedance pair, and one specified by its secondaries needs each coil's own voltage`,
		String(component.id),
	);
}

/**
 * A winding's declared DC resistance, in three states, shared by the inductor and transformer
 * branches. One definition rather than two, because a shared policy module carrying two spellings
 * of its own policy is the defect `settle.ts` had this morning.
 *
 * A number is a value; the literal `unknown` is the packet stating the source does not print it --
 * Fender sheets give turns ratios and impedances, never copper resistance -- and is carried as its
 * own flag because `parameters` is `Record<string, number>`; silence produces neither. **Never
 * defaulted to zero**: zero is the one physically impossible value for a winding.
 */
function windingResistanceParameters(component: ComponentLike): Record<string, number> {
	// **Every spelling the corpus actually uses, not the one that came to mind.** Surveyed rather
	// than guessed: `WindingResistance` 2 packets, `WindingResistanceOhms` 4, `SeriesResistance` 2.
	// The first version of this function read the first and `DCResistance` -- which no packet uses
	// at all -- so it caught 2 of 8 declared values and silently discarded 6. That is the
	// synonym-orphan class this repository already has a report for, reproduced in new code hours
	// after it was written down: a reader that knows one spelling reports the others as absent, and
	// absent reads as a finding.
	const KEYS = [
		"WindingResistance",
		"WindingResistanceOhms",
		"SeriesResistance",
		"DCResistance",
	] as const;
	let raw: string | null = null;
	let ohms: number | null = null;
	for (const key of KEYS) {
		raw ??= propertyString(component, key);
		ohms ??= optionalQuantity(component, key);
	}
	if (ohms !== null && ohms > 0) return { windingResistanceOhms: ohms };
	if (raw !== null && raw.trim().toLowerCase() === "unknown") return { windingResistanceUnknown: 1 };
	return {};
}

function optionalQuantity(
	component: ComponentLike,
	key: string,
): number | null {
	const raw = propertyString(component, key);
	if (raw === null) {
		return null;
	}
	try {
		return parseQuantity(raw);
	} catch {
		// The recovery read must use the COMPONENT'S OWN kind. Hardcoding one kind here
		// checks every typed quantity against that kind's units, so a well-formed
		// `value: 10, unit: H` on an inductor was tested against volts, rejected, and the
		// declared value thrown away -- `vox-ac30-top-boost`'s 292-767 supply choke states
		// 10 H and compiled to `FERRITE_BEAD_DEFAULT_HENRIES`, 10 uH: a factor of 1e6, and a
		// power-supply filter choke modelled as a wire. Its `raw` is prose-leading
		// ("source-visible choke 292-767, validation-derived 10 H"), which is why the string
		// parse threw and the typed value was the only thing left to read.
		//
		// The old kind is kept as a second attempt rather than replaced, so this is a pure
		// widening: every quantity that resolved before resolves to the same number.
		return (
			baseUnitQuantity(component, key, component.kind) ??
			baseUnitQuantity(component, key, "voltage-source")
		);
	}
}

/** Keys that may carry a reference to a declared control, checked in this order. */
const controlReferenceKeys = [
	"InterfaceControlId",
	"interfaceControlId",
	"controlId",
	"ControlId",
	"control_id",
	"Control_Id",
	"Control",
	"control",
	"ControlName",
	"controlName",
	"ControlRole",
	"controlRole",
	"PhysicalControl",
	"physicalControl",
	"PanelLabel",
	"panelLabel",
	"Name",
	"name",
	"Label",
	"label",
] as const;

/**
 * Which control varies this device.
 *
 * The test is **exact equality against the ids and labels this document itself declares** in
 * `deviceInterface.controls` -- a closed vocabulary, compared whole. It is emphatically
 * not "does this property mention a knob": a value only binds if it *is* a declared id or label.
 * That is why reading `Name` here is safe, and why it would not be safe to read it for
 * anything else.
 *
 * A device matching no declared id still gets a control, named for the component: a
 * trimmer or an internal switch is adjustable, just not on the enclosure. Refusing the
 * pedal over one unmapped trimmer would be strictness without a purpose.
 */
function controlBindingFor(
	component: ComponentLike,
	declaredControls: ReadonlyMap<string, string>,
	kind: DeviceKind,
): string | null {
	for (const key of controlReferenceKeys) {
		const value = propertyString(component, key);
		if (value !== null) {
			const bound =
				declaredControls.get(value) ??
				declaredControls.get(value.toLowerCase());
			if (bound !== undefined) {
				return bound;
			}
		}
	}
	const idStr = String(component.id);
	const idBound =
		declaredControls.get(idStr) ?? declaredControls.get(idStr.toLowerCase());
	if (idBound !== undefined) {
		return idBound;
	}
	if (kind === "potentiometer" || kind === "rheostat" || kind === "switch") {
		return idStr;
	}
	return null;
}

/**
 * Every name this document uses for each control it declares, mapped to the control's
 * id.
 *
 * A control usually names itself twice: once as `id`, and once as the component name
 * its `audioBinding` points at -- `id: MID_FREQ` with `controlName: "Mid Frequency"`.
 * Components then reference whichever of the two their author had to hand, so matching
 * only the id leaves a pot bound to nothing and it invents a control of its own. That
 * is how one dual-gang knob became two independent knobs.
 *
 * Still a closed vocabulary compared as whole values: every entry is a name this
 * document declares for a control it declares.
 */
function declaredControlNames(document: ParsedDocument): Map<string, string> {
	const names = new Map<string, string>();
	for (const control of document.deviceInterface?.controls ?? []) {
		const id = String(control.id);
		names.set(id, id);
		names.set(id.toLowerCase(), id);

		const label = (control as { label?: unknown }).label;
		if (typeof label === "string" && label.trim().length > 0) {
			const l = label.trim();
			if (!names.has(l)) {
				names.set(l, id);
			}
			if (!names.has(l.toLowerCase())) {
				names.set(l.toLowerCase(), id);
			}
		}

		const bound = (control as { audioBinding?: { controlName?: unknown } })
			.audioBinding?.controlName;
		if (typeof bound === "string" && bound.trim().length > 0) {
			const b = bound.trim();
			// The id wins if two controls claim the same alias.
			if (!names.has(b)) {
				names.set(b, id);
			}
			if (!names.has(b.toLowerCase())) {
				names.set(b.toLowerCase(), id);
			}
		}
	}
	return names;
}

/**
 * A switch's contact state, as a **closed vocabulary compared as whole values** — never a
 * substring or a regex over authored prose, which the engineering principles forbid.
 *
 * A switch is the one kind that states where it is set as a contact state rather than as a
 * travel position: `State: effect-on` on `pro-co-rat`'s bypass-control contact, `State:
 * closed` on three amp switches. Both mean the contacts are made, which is `1` against the
 * runtime's `position >= 0.5` threshold.
 *
 * Measured before it was written: across every `.vdsp` in the pedal *and* amp corpora,
 * `State` appears on `kind: switch` and on nothing else, and carries exactly these two
 * values on nine components. An unrecognised value is a refusal that names it (see
 * `declaredPosition`) rather than a guess, for the same reason the runtime refuses an
 * operator it does not implement: a switch silently defaulted to the wrong contact is a
 * plausible wrong circuit, not a visible failure.
 */
const switchContactStates: Readonly<Record<string, number>> = {
	"effect-on": 1,
	closed: 1,
	// The amp corpus's spellings for the same fact. `vox-ac15-top-boost`'s standby switch says
	// `closed/on`, and until this was here that statement was dropped and the switch fell to the
	// "nobody said" default of open -- which disconnected B+ from the whole amp.
	"closed/on": 1,
	on: 1,
	// `fender-bassman` spells the same fact this way on its AC and standby switches. Compared
	// whole, like every other entry: this stage does not read a substring out of it. The spelling
	// is worth normalising on the artifact side, and until then dropping it would cost that amp
	// its supply.
	"closed/on for operating validation": 1,
	// `hiwatt-dr103`'s power switch states `SelectedState: "ON for validation"`.
	"on for validation": 1,
	// `pigtronix-philosophers-tone`'s footswitch states `DefaultState: "effect"`.
	effect: 1,
	// `mesa-boogie-mark-v`'s power switch states `SelectedState: "FULL"`.
	full: 1,
};

function statedContactState(component: ComponentLike): string | null {
	if (String(component.kind) !== "switch") {
		return null;
	}
	return propertyString(component, "State");
}

/**
 * A contact state this stage recognises, from either spelling the corpus uses, or `null`.
 *
 * **`State` stays strict and `SelectedState` does not, and the difference is what the corpus
 * declares.** `State` has one meaning, so an unrecognised value there is an error the caller
 * raises. `SelectedState` carries a contact state on 5 of its 12 appearances (`closed/on`,
 * `closed`, `on`) and something else entirely on the rest -- `16 ohms`, `full`,
 * `90w full-power silicon path`, a whole sentence about input routing -- so it is compared as a
 * whole value against the closed vocabulary and ignored when it is not in it. Throwing on those
 * would refuse packets over a field that is not making this claim.
 *
 * Measured 2026-08-21: `vox-ac15-top-boost`, `vox-ac30-top-boost` and `fender-bassman` each state
 * `SelectedState: "closed/on"` on the standby switch that feeds their B+, nothing read it, and all
 * three rendered silence with every plate at 0.0 V while their rectifiers reached 424 V.
 */
function recognisedContactPosition(component: ComponentLike): number | null {
	if (String(component.kind) !== "switch") {
		return null;
	}
	// **A fuse conducts.** A two-terminal switch declaring a `FuseRating` is a fuse, and a fuse
	// is a closed conductor unless it has blown -- which is a fault a source would have to state,
	// not a default this stage should assume. Measured 2026-08-21: **26 switch components across
	// the amp corpus declare a `FuseRating` and every one of them states no contact position**, so
	// every fuse in every amp defaulted open. On `vox-ac15-top-boost` that is an HT fuse sitting
	// between the standby switch and the reservoir cap, which alone kept B+ off every plate.
	//
	// The evidence is the presence of a typed property name, compared whole. Nothing reads its
	// value, and nothing reads a name or a description.
	if (propertyString(component, "FuseRating") !== null) {
		return 1;
	}
	const closed = (component.properties as Record<string, unknown> | undefined)?.Closed;
	if (closed === true || closed === "true" || closed === 1 || closed === "1") {
		return 1;
	}
	if (closed === false || closed === "false" || closed === 0 || closed === "0") {
		return 0;
	}
	const selected =
		propertyString(component, "SelectedState") ??
		propertyString(component, "DefaultState") ??
		propertyString(component, "SelectedThrow");
	if (selected === null) {
		return null;
	}
	const simple = switchContactStates[selected.trim().toLowerCase()];
	if (simple !== undefined) {
		return simple;
	}
	return selectedThrowPosition(component, selected);
}

/**
 * Is this terminal one of a switch's throws, for the purpose of resolving *which* throw a control
 * selects?
 *
 * The declared role decides where the document states one, and a name is read only where it does
 * not. Both callers used to consult `switchCommonRoles` alone -- the last two program-affecting
 * readers of it once `switchPoles` moved to declarations, and the reason ten packets still changed
 * when it was emptied. `coil` and `pin` are excluded here too: a relay coil and a mounting lug are
 * not throws a control can select, which a name vocabulary of pole spellings could never say.
 */
function isSelectableThrow(terminal: {
	readonly name?: unknown;
	readonly role?: unknown;
}): boolean {
	// A terminal declaring nothing is treated as selectable, which is what the deleted
	// `switchCommonRoles` fallback did for every name that was not a pole spelling -- and no
	// corpus switch reaches here undeclared with a pole-shaped name.
	const declared = typeof terminal.role === "string" ? terminal.role : null;
	return declared === null || declared === "throw";
}

/**
 * Resolve a multi-throw selector position from authored throw text (e.g. `SelectedThrow: 16 ohm`).
 */
function selectedThrowPosition(
	component: ComponentLike,
	stated: string,
): number | null {
	const throwTerminals = component.terminals.filter(isSelectableThrow);
	if (throwTerminals.length <= 1) {
		return null;
	}
	const statedNorm = stated.toLowerCase().replace(/[^a-z0-9]/g, "");
	let index = throwTerminals.findIndex((t) => {
		const token = terminalRoleToken(String(t.name)) ?? "";
		return token.length > 0 && (statedNorm.includes(token) || token.includes(statedNorm));
	});
	if (index === -1) {
		const numbersInStated = stated.match(/\d+/g) ?? [];
		for (const num of numbersInStated) {
			const found = throwTerminals.findIndex((t) => {
				const numInTerm = String(t.name).match(/\d+/);
				return numInTerm !== null && numInTerm[0] === num;
			});
			if (found !== -1) {
				index = found;
				break;
			}
		}
	}
	if (index === -1) {
		return null;
	}
	return (index + 0.5) / throwTerminals.length;
}

/** Wiper position as authored, 0..1. */
/** Whether the source states where this component is set, at all. */
function statesPosition(component: ComponentLike): boolean {
	return (
		(propertyString(component, "Wipe") ??
			propertyString(component, "Position") ??
			statedContactState(component)) !== null ||
		recognisedContactPosition(component) !== null
	);
}

function declaredPosition(component: ComponentLike): number {
	const raw =
		propertyString(component, "Wipe") ?? propertyString(component, "Position");
	if (raw === null) {
		// The second spelling first, because it is the non-throwing one: a `SelectedState` this
		// stage recognises is a stated position, and one it does not recognise is a different
		// claim that must not become an error.
		const recognised = recognisedContactPosition(component);
		if (recognised !== null) {
			return recognised;
		}
		// A switch that states a contact state instead of a travel position. Read before
		// the `0` default below, because that default is "nobody said", and here somebody
		// did -- `pro-co-rat`'s bypass-control contact sits off the input-to-output path,
		// so the port-connectivity fallback left it open against a source that says it is
		// made.
		const contact = statedContactState(component);
		if (contact !== null) {
			const position = switchContactStates[contact.trim().toLowerCase()];
			if (position === undefined) {
				throw new NetlistError(
					`component ${component.id}: switch declares State "${contact}", which is not a recognised contact state (${Object.keys(switchContactStates).join(", ")})`,
					String(component.id),
				);
			}
			return position;
		}
		if (String(component.kind) === "switch") {
			return 0;
		}
		return 0.5;
	}
	// A switch states its position as one of the options it declares -- `Position:
	// Effect` against `Options: Normal,Effect` -- so it must be resolved against that
	// list before it is read as a number. `Number("Effect")` is NaN and would silently
	// become half travel, which on a two-throw switch is the *other* throw.
	const selected = selectedOption(component, raw);
	if (selected !== null) {
		return selected;
	}
	const value = Number(raw);
	return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}

/**
 * Where a stated position sits among the throws the component declares, as 0..1.
 *
 * Two lists have to be reconciled: the `Options` the component names, and the throw
 * terminals it wires. **They are not always in the same order** -- three corpus
 * selectors declare `Options: low,high` against throws `high,low`, and taking the
 * option's index would stick a range switch on the wrong range. So the throw whose
 * role token *is* the selected option name wins, and the option's index is only the
 * fallback for throws named `throwA`/`throw1`, which carry no such evidence.
 *
 * The result is the centre of the selected throw's band, so the runtime's even
 * division of control travel lands back on the same throw.
 */
function selectedOption(
	component: ComponentLike,
	stated: string,
): number | null {
	const declared = propertyString(component, "Options");
	if (declared === null) {
		return null;
	}
	const options = declared
		.split(",")
		.map((option) => option.trim())
		.filter((option) => option.length > 0);
	if (options.length < 2) {
		return null;
	}
	const wanted = stated.trim().toLowerCase();
	const optionIndex = options.findIndex(
		(option) => option.toLowerCase() === wanted,
	);
	if (optionIndex === -1) {
		return null;
	}

	const throwRoles = component.terminals
		.filter(isSelectableThrow)
		.map((terminal) => terminalRoleToken(String(terminal.name)));
	if (throwRoles.length === 0) {
		return null;
	}
	const named = throwRoles.findIndex(
		(role) =>
			role !== null && role === terminalRoleToken(options[optionIndex] ?? ""),
	);
	const index = named === -1 ? optionIndex : named;
	return index >= throwRoles.length ? null : (index + 0.5) / throwRoles.length;
}

/**
 * Every taper spelling the corpus declares, as whole values.
 *
 * Measured across the corpus rather than guessed, because prefix matching was wrong in
 * both directions: `startsWith("rev")` read `ReverseLinear` as reverse-*logarithmic*,
 * and `AntiLogarithmic` matched no rule at all and fell through to linear -- silently,
 * in both Tube Screamers among others. A taper is one of the most audible things about
 * a pedal, so an unrecognised spelling must stay unrecognised rather than land on a
 * plausible neighbour.
 *
 * Deliberately absent: `W`, `W20`, `G`, `D`, `L`, `BH`, `Stepped`, `Trim`,
 * `Boss-G-taper` and the other manufacturer-specific curves. We do not know their
 * shapes, and guessing one would be inventing a device law from a letter.
 */
const taperSpellings = new Map<string, TaperKind>([
	["linear", "linear"],
	["b", "linear"],
	["log", "logarithmic"],
	["logarithmic", "logarithmic"],
	["audio", "logarithmic"],
	["a", "logarithmic"],
	["a/log", "logarithmic"],
	["reverselog", "reverse-logarithmic"],
	["reverselogarithmic", "reverse-logarithmic"],
	["reverseaudio", "reverse-logarithmic"],
	["antilog", "reverse-logarithmic"],
	["antilogarithmic", "reverse-logarithmic"],
	["negativelog", "reverse-logarithmic"],
	["c", "reverse-logarithmic"],
	["reverselinear", "reverse-linear"],
]);

/**
 * Values whose meaning is "the source does not state a taper".
 *
 * These are not markings this stage failed to read -- they are the packet recording that its
 * source does not say, which is a complete statement. Linear is the stated fallback for them and
 * no warning is raised, because nothing was lost. 19 of the corpus's declarations are this shape.
 */
const taperUnknownSpellings: ReadonlySet<string> = new Set([
	"unknown",
	"sourceunmarked",
	"sourcemarked",
	"sourceunspecified",
]);

/**
 * Tapers `@vessel-dsp/core`'s format supports and this runtime has no curve for.
 *
 * `PotentiometerTaper` carries seven values; `TaperKind` -- the executable law -- carries four.
 * A document declaring one of these three has stated a real taper that the render cannot produce,
 * which is a different failure from an unreadable marking and is worth saying differently.
 */
const taperWithoutLaw: ReadonlySet<string> = new Set([
	"scurve",
	"stepped",
	"custom",
]);

/** Case and separators folded, so `reverse-log` and `Reverse Log` are one spelling. */
function foldTaper(value: string): string {
	return value.trim().toLowerCase().replace(/[\s_-]+/gu, "");
}

/**
 * The taper a declared value names, or null when this vocabulary does not contain it.
 * Whole-value lookup against a closed set; separators fold so `reverse-log`,
 * `Reverse Log` and `ReverseLog` are one spelling, but nothing is ever matched as a
 * substring of a longer phrase.
 */
function taperKind(value: string): TaperKind | null {
	return taperSpellings.get(foldTaper(value)) ?? null;
}

/**
 * The taper to execute, and whether anything was lost getting there.
 *
 * **The fallback to linear is unchanged; what changes is that it stops being silent.** Measured
 * 2026-09-03, 69 of the corpus's 608 declared tapers fell through to linear without a word, an
 * audible difference across the whole sweep of an audio knob. Three outcomes now:
 *
 * - the value names a law -> use it, say nothing;
 * - the value says the source does not know -> linear, say nothing, because there is nothing to
 *   have read;
 * - the value states anything else -> linear, and **name it**, whether it is a part marking whose
 *   curve is not derivable here (`W20`, `Boss-G-taper`) or a taper the format supports and this
 *   runtime has no law for (`s-curve`, `stepped`).
 */
function declaredTaper(component: ComponentLike): {
	readonly taper: TaperKind;
	readonly unreadable: string | null;
} {
	// `Sweep` is what a variable-resistor calls its taper. Both are closed vocabularies
	// compared as whole values, never substrings of a description.
	const declared =
		propertyString(component, "Taper") ?? propertyString(component, "Sweep");
	if (declared === null) {
		return { taper: "linear", unreadable: null };
	}
	const resolved = taperKind(declared);
	if (resolved !== null) {
		return { taper: resolved, unreadable: null };
	}
	return {
		taper: "linear",
		unreadable: taperUnknownSpellings.has(foldTaper(declared)) ? null : declared,
	};
}

/**
 * The `role` a terminal declares, or null.
 *
 * Read verbatim: this is a closed vocabulary core validates, so there is nothing here to fold,
 * alias or guess. The whole point of the field is that a consumer does not interpret it.
 */
function declaredRole(terminal: unknown): string | null {
	const value =
		terminal !== null && typeof terminal === "object"
			? (terminal as { role?: unknown }).role
			: undefined;
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * The coils a component declares, as terminal indices in coil order.
 *
 * Read verbatim like `declaredRole`, with one consumer-side step: a terminal *name* becomes the
 * index this stage addresses ports by. A winding naming a terminal the component does not have is
 * dropped here rather than refused, because core's own validation already errors on it and this
 * stage's job is to read, not to re-adjudicate the document.
 */
function declaredWindings(
	component: unknown,
	terminals: readonly { name?: unknown; role?: unknown }[],
): readonly DeclaredWinding[] | null {
	const value =
		component !== null && typeof component === "object"
			? (component as { windings?: unknown }).windings
			: undefined;
	if (!Array.isArray(value) || value.length === 0) {
		return null;
	}
	const indexOf = new Map<string, number>();
	const centerTaps = new Set<number>();
	terminals.forEach((terminal, index) => {
		if (typeof terminal.name === "string") {
			indexOf.set(terminal.name, index);
		}
		if (declaredRole(terminal) === "windingCenterTap") {
			centerTaps.add(index);
		}
	});
	const windings = value.flatMap((entry): DeclaredWinding[] => {
		if (entry === null || typeof entry !== "object") {
			return [];
		}
		const { role, id, terminals: names } = entry as {
			role?: unknown;
			id?: unknown;
			terminals?: unknown;
		};
		if (typeof role !== "string" || !Array.isArray(names)) {
			return [];
		}
		const terminalIndices = names.flatMap((name) => {
			const index = typeof name === "string" ? indexOf.get(name) : undefined;
			return index === undefined ? [] : [index];
		});
		const centerTapAt = terminalIndices.findIndex(
			(index) => centerTaps.has(index),
		);
		const { voltage, impedances: rated } = entry as {
			voltage?: unknown;
			impedances?: unknown;
		};
		const impedances = (Array.isArray(rated) ? rated : []).flatMap(
			(rating): DeclaredWindingImpedance[] => {
				if (rating === null || typeof rating !== "object") {
					return [];
				}
				const { across, impedance } = rating as {
					across?: unknown;
					impedance?: unknown;
				};
				const ohms = quantityValue(impedance);
				if (!Array.isArray(across) || across.length !== 2 || ohms === null) {
					return [];
				}
				const pair = across.map((name) =>
					typeof name === "string" ? indexOf.get(name) : undefined,
				);
				return pair[0] === undefined || pair[1] === undefined
					? []
					: [{ across: [pair[0], pair[1]] as const, ohms }];
			},
		);
		return terminalIndices.length === 0
			? []
			: [
					{
						role,
						id: typeof id === "string" && id.trim().length > 0 ? id.trim() : null,
						terminalIndices,
						centerTapAt: centerTapAt === -1 ? null : centerTapAt,
						voltageRmsVolts: quantityValue(voltage),
						impedances,
					},
				];
	});
	return windings.length === 0 ? null : windings;
}

/** A typed quantity's numeric value, or null. Core validates the shape; this only reads it. */
function quantityValue(value: unknown): number | null {
	if (value === null || typeof value !== "object") {
		return null;
	}
	const magnitude = (value as { value?: unknown }).value;
	return typeof magnitude === "number" && Number.isFinite(magnitude)
		? magnitude
		: null;
}

/** A bare positional pin carries no role. Anything else is a whole role token. */
function terminalRoleToken(name: string): string | null {
	const folded = name
		.trim()
		.toLowerCase()
		.replace(/[\s_-]+/gu, "");
	if (folded.length === 0 || /^(?:pin)?\d+$/u.test(folded)) {
		return null;
	}
	return folded.replace(/^pin\d+/u, "");
}

/**
 * The taper a control declares for itself, or null when it declares none.
 *
 * Same vocabulary as a component's, because a panel control and the pot it drives are
 * describing the same track. Keeping two lists let a control's `ReverseAudio` or
 * `AntiLogarithmic` read as "unstated" while the identical value on the pot resolved.
 */
/** A control's declared panel role, verbatim, or `null`. Never inferred from the id. */
function roleFor(control: unknown): string | null {
	const value =
		control !== null && typeof control === "object"
			? (control as { role?: unknown }).role
			: undefined;
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function taperFor(control: unknown): TaperKind | null {
	const value =
		control !== null && typeof control === "object"
			? (control as { taper?: unknown }).taper
			: undefined;
	return typeof value === "string" ? taperKind(value) : null;
}


// --- node resolution ----------------------------------------------------------

type DeclaredNodeMap = Map<string, NodeId>;

/** What the format library drops or mangles, recovered from the raw YAML. */
type RawComponent = {
	/** Terminal name -> the node token exactly as authored. */
	readonly nodes: ReadonlyMap<string, string>;
	readonly properties: Record<string, unknown>;
};

type RawComponentMap = Map<string, RawComponent>;

/**
 * Composite map key. The separator must be a character that cannot occur in either
 * part, or `R1`+`a` and `R`+`1a` collide and two terminals silently share a node.
 * A newline is safe here because neither an id nor a terminal name may contain one.
 */
function declaredKey(componentId: string, terminalName: string): string {
	return `${componentId}\n${terminalName}`;
}



/** The `{ raw, value, unit }` shape, or null for anything else. */
function asParsedQuantity(value: unknown): ParsedQuantity | null {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const candidate = value as { raw?: unknown; value?: unknown; unit?: unknown };
	if (
		typeof candidate.raw !== "string" ||
		typeof candidate.value !== "number" ||
		!Number.isFinite(candidate.value) ||
		typeof candidate.unit !== "string"
	) {
		return null;
	}
	return { raw: candidate.raw, value: candidate.value, unit: candidate.unit };
}

/**
 * Recover `deviceInterface.controls[].defaultPosition`. The format library drops it -- it keeps
 * `id`, `label`, `kind`, `role` and `taper` from the same entry and silently discards this one --
 * so the raw YAML is read here for that single field, exactly as `readRawComponents` below does
 * for terminal `node:`.
 *
 * **The durable fix belongs in `@vessel-dsp/core`**, which owns the format; this recovery is the
 * consumer-side half and should be deleted the day the parser preserves the field.
 */
function readRawControlPositions(source: string): Map<string, number> {
	const positions = new Map<string, number>();
	let parsed: unknown;
	try {
		parsed = loadYaml(source);
	} catch {
		return positions;
	}
	if (parsed === null || typeof parsed !== "object") {
		return positions;
	}
	const controls = (
		(parsed as { deviceInterface?: { controls?: unknown } }).deviceInterface ??
		{}
	).controls;
	if (!Array.isArray(controls)) {
		return positions;
	}
	for (const control of controls) {
		if (control === null || typeof control !== "object") {
			continue;
		}
		const record = control as { id?: unknown; defaultPosition?: unknown };
		// A control id is a token, not a number -- the same lesson the net-id filter below
		// carries, and the same cost if it is forgotten.
		const id =
			typeof record.id === "number" && Number.isFinite(record.id)
				? String(record.id)
				: typeof record.id === "string" && record.id.trim() !== ""
					? record.id.trim()
					: null;
		if (
			id === null ||
			typeof record.defaultPosition !== "number" ||
			!Number.isFinite(record.defaultPosition)
		) {
			continue;
		}
		positions.set(id, Math.min(1, Math.max(0, record.defaultPosition)));
	}
	return positions;
}


/** Union-find over wire geometry, used to resolve nodes and then discarded. */
class UnionFind {
	private readonly parents = new Map<string, string>();

	find(value: string): string {
		const parent = this.parents.get(value);
		if (parent === undefined) {
			this.parents.set(value, value);
			return value;
		}
		if (parent === value) {
			return value;
		}
		const root = this.find(parent);
		this.parents.set(value, root);
		return root;
	}

	union(a: string, b: string): void {
		const rootA = this.find(a);
		const rootB = this.find(b);
		if (rootA !== rootB) {
			this.parents.set(rootB, rootA);
		}
	}
}

function pointKey(point: { readonly x: number; readonly y: number }): string {
	return `${point.x},${point.y}`;
}

function pointOnSegment(
	point: { readonly x: number; readonly y: number },
	a: { readonly x: number; readonly y: number },
	b: { readonly x: number; readonly y: number },
): boolean {
	// Direct endpoint shortcuts
	const distAPoint = Math.abs(point.x - a.x) + Math.abs(point.y - a.y);
	const distBPoint = Math.abs(point.x - b.x) + Math.abs(point.y - b.y);
	if (distAPoint < 1e-6 || distBPoint < 1e-6) {
		return true;
	}

	const withinX =
		point.x >= Math.min(a.x, b.x) - 1e-6 &&
		point.x <= Math.max(a.x, b.x) + 1e-6;
	const withinY =
		point.y >= Math.min(a.y, b.y) - 1e-6 &&
		point.y <= Math.max(a.y, b.y) + 1e-6;
	if (!withinX || !withinY) {
		return false;
	}
	// Collinear with a safe geometry tolerance
	// One test covers horizontal, vertical and diagonal alike: before this, a wire at any other angle
	// returned false, so a terminal touching a diagonal wire was dropped as unconnected.
	const crossProduct =
		(b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
	return Math.abs(crossProduct) < 1e-3;
}

function resolveNodes(
	document: ParsedDocument,
	declared: DeclaredNodeMap,
): (componentId: string, terminalName: string, index: number) => NodeId | null {
	const unionFind = new UnionFind();
	const terminalPoints: Array<{
		readonly componentId: string;
		readonly terminalName: string;
		readonly point: { readonly x: number; readonly y: number };
	}> = [];

	for (const component of document.components) {
		for (const terminal of component.terminals) {
			terminalPoints.push({
				componentId: String(component.id),
				terminalName: String(terminal.name),
				point: terminal.position,
			});
		}
	}

	for (const wire of document.wires) {
		const [a, b] = wire.endpoints;
		const anchor = pointKey(a);
		unionFind.union(anchor, pointKey(b));
		for (const entry of terminalPoints) {
			if (pointOnSegment(entry.point, a, b)) {
				unionFind.union(anchor, pointKey(entry.point));
			}
		}
	}
	// A second pass joins wires that meet at a shared point.
	for (const wire of document.wires) {
		for (const other of document.wires) {
			if (wire.id === other.id) {
				continue;
			}
			for (const point of wire.endpoints) {
				if (pointOnSegment(point, other.endpoints[0], other.endpoints[1])) {
					unionFind.union(pointKey(wire.endpoints[0]), pointKey(point));
					unionFind.union(pointKey(point), pointKey(other.endpoints[0]));
				}
			}
		}
	}

	const groundComponentIds = new Set(
		document.components
			.filter((component) => String(component.kind) === "ground")
			.map((component) => String(component.id)),
	);

	// Geometric groups get ids after the declared ones, so the two never collide.
	const declaredMax = Math.max(0, ...[...declared.values()]);
	const geometricId = new Map<string, number>();
	let nextGeometric = declaredMax + 1;

	return (componentId, terminalName, index): NodeId | null => {
		const declaredNode = declared.get(declaredKey(componentId, terminalName));
		if (declaredNode !== undefined) {
			return declaredNode;
		}
		const entry = terminalPoints.find(
			(candidate) =>
				candidate.componentId === componentId &&
				candidate.terminalName === terminalName,
		);
		if (entry === undefined) {
			return null;
		}
		const root = unionFind.find(pointKey(entry.point));
		// Any group touching a ground symbol is node 0.
		const touchesGround = terminalPoints.some(
			(candidate) =>
				groundComponentIds.has(candidate.componentId) &&
				unionFind.find(pointKey(candidate.point)) === root,
		);
		if (touchesGround) {
			return GROUND;
		}
		const existing = geometricId.get(root);
		if (existing !== undefined) {
			return existing;
		}
		// A terminal on no wire at all is unconnected, which is an authoring error
		// rather than a node: refuse instead of inventing an isolated net.
		const onAnyWire = document.wires.some((wire) =>
			pointOnSegment(entry.point, wire.endpoints[0], wire.endpoints[1]),
		);
		if (!onAnyWire && index >= 0) {
			return null;
		}
		const assigned = nextGeometric;
		nextGeometric += 1;
		geometricId.set(root, assigned);
		return assigned;
	};
}

/**
 * The role a document declares for each jack component, by component id.
 *
 * `deviceInterface.controls` carries a required `role` on every entry, and a jack's
 * entry says `input`, `output`, `power`, `cv`, `direct-output` and so on. That is the
 * authoritative statement of what a jack is: a closed vocabulary, in a structured
 * field, that distinguishes things a type name cannot -- a direct out from the main
 * out, an expression socket from an audio port.
 *
 * Two links reach it, and 104 of the corpus's 114 jack-bearing documents have one:
 * the interface entry's id may be the component id, or `panel` binds the two with
 * `componentId` + `controlId`. Reading this rather than `sourceTypeName` is also what
 * keeps `Circuit.Speaker` meaning a speaker load in the 22 amp packets that use it
 * that way, instead of being collapsed into "output jack" to suit pedals.
 */
function declaredJackRoles(document: ParsedDocument): Map<string, string> {
	const roleByControlId = new Map<string, string>();
	for (const control of document.deviceInterface?.controls ?? []) {
		if (String(control.kind) !== "jack") {
			continue;
		}
		const role = String(control.role ?? "")
			.trim()
			.toLowerCase();
		if (role.length > 0) {
			roleByControlId.set(String(control.id), role);
		}
	}

	const roleByComponent = new Map<string, string>();
	// The interface entry named the component directly.
	for (const [id, role] of roleByControlId) {
		roleByComponent.set(id, role);
	}
	// Or the panel binds a component to it, which is how a document keeps
	// panel-facing ids (`INPUT_JACK`) separate from schematic designators (`V1`).
	for (const face of document.panel?.faces ?? []) {
		for (const element of face.elements) {
			const componentId = element.bind?.componentId;
			const controlId = element.bind?.controlId;
			if (componentId === undefined || controlId === undefined) {
				continue;
			}
			const role = roleByControlId.get(String(controlId));
			if (role !== undefined) {
				roleByComponent.set(String(componentId), role);
			}
		}
	}
	return roleByComponent;
}

/**
 * Declared roles that make a jack the signal input or output.
 *
 * Deliberately narrow. `direct-output` is a dry send and not the effect's output;
 * `cv`, `expression` and `tempo-tap` are control sockets that carry no program audio.
 * A type name cannot express any of those distinctions, which is the reason to prefer
 * the role.
 */
const inputJackRoles = new Set(["input"]);
// `output-a-mono` before `output-b`, so a stereo pedal read in mono takes the jack the
// pedal itself calls mono rather than whichever came first.
const outputJackRoles = new Set([
	"output",
	"output-a-mono",
	"mono-output",
	"panning-output",
	"output-b",
	"wet-output",
	"dry-output",
]);
const powerJackRoles = new Set(["power", "power-input"]);

/**
 * Declared jack types, the fallback for the 10 documents that state no role.
 *
 * Closed sets, compared whole and lower-cased. `Circuit.Output` is the minority
 * spelling -- the corpus writes an output jack as `Circuit.Speaker` 99 times and
 * `Circuit.OutputJack` 9 times against 8 for `Circuit.Output` -- so matching only the
 * last of those left 108 output jacks unrecognised. This table exists because those
 * ten documents declare no role; it is not the primary evidence.
 */
const inputJackTypeNames = new Set([
	"circuit.input",
	"circuit.inputjack",
	"circuit.inputjackswitch",
]);
const outputJackTypeNames = new Set([
	"circuit.output",
	"circuit.outputjack",
	"circuit.speaker",
]);
const powerJackTypeNames = new Set([
	"circuit.powerjack",
	"circuit.dcjack",
	"circuit.dcpowerjack",
]);

/**
 * The impedance each port declares **about itself as a port**, for the chain's seam divider (§3.3).
 *
 * A port impedance is what the *connection* sees: an output port's source impedance is what the next
 * slot loads, and an input port's is the load this slot presents to whatever drives it. Neither is
 * stamped -- stamping the input one would put a resistor across the input jack, which is a different
 * claim from "this is what the port presents".
 *
 * **A `Circuit.Speaker` jack is excluded, and finding that out is the whole result of this
 * function.** Measured over 142 documents, every typed `Impedance` in the corpus sits on a
 * `Circuit.Speaker` jack -- `vox-ac15-top-boost` 16 Ω, `fender-5e3-deluxe-tweed` 8 Ω,
 * `marshall-blues-breaker` 1 MΩ, `mxr-m117r-flanger` 1 kΩ, `mxr-noise-gate-line-driver` 10 kΩ. Those
 * are **loads**, not source impedances: 8 Ω is the driver the transformer secondary drives, and
 * `outputJackLoads` already consumes exactly that number to build the Stage B speaker network.
 * Reading it a second time as the port's *source* impedance would both double-count it and invert
 * its meaning -- a divider given `Zout = 8` claims the amp has an 8 Ω output impedance, when 8 Ω is
 * what it is driving into.
 *
 * The plan's §3.3 recorded this as "four output jacks declare a typed impedance, all of which are the
 * source impedance this section wants". The first half is close; the second half is wrong, and the
 * exclusion below is why the divider is not built on it.
 *
 * The discriminator is a **closed typed value compared whole** (`sourceTypeName`), never a name or a
 * description -- the same rule everything else in this file follows.
 *
 * So this returns `{ input: null, output: null }` for every corpus document today, and that is the
 * honest state rather than a gap to paper over: a fabricated "standard 1 MΩ input" would look like a
 * measurement in every number downstream of it. What §3.3 needs is a typed impedance on **input**
 * jacks and on non-speaker **output** jacks.
 *
 * Matched through the resolved devices, since a parsed component's terminals do not carry their node
 * (the format library drops it, which is why `readRawComponents` exists at all).
 */
/**
 * The full-scale voltage a port's own jack **declares**, in volts, or null.
 *
 * `V0dBFS` is the source stating directly what `port-full-scale.ts` otherwise has to infer, and it
 * is the only number available where nothing infers one: a preamp monitor tap has no output
 * transformer to step a rail down, so the derived bound is the bare rail and a render of it writes
 * hundreds of volts into a +/-1 file. `marshall-1959-super-lead-plexi`'s `Tone-Stack-Monitor-Out`
 * and `mesa-boogie-mark-v`'s `Preamp-Monitor-Out` each declare 100 V on the exact jack the output
 * port sits on, and both clipped 20,722 and 87,439 samples of 96,000 until this was read.
 *
 * **`Circuit.Speaker` jacks are read here, unlike in `portImpedanceOhms`.** That reader excludes
 * them because a speaker's declared `Impedance` describes the *load* hanging off the port rather
 * than the port's own level. `V0dBFS` is the opposite: it is only ever a level, and it is the
 * corpus's monitor taps that carry it -- which are typed `Circuit.Speaker`, since that is how a
 * tap-off point is drawn. Excluding them dropped every declaration there is.
 */
function portDeclaredFullScaleVolts(
	document: ParsedDocument,
	devices: readonly Device[],
	ports: { readonly input: NodeId; readonly output: NodeId },
): { readonly input: number | null; readonly output: number | null } {
	const byId = new Map(
		document.components
			.filter((component) => String(component.kind) === "jack")
			.map((component) => [String(component.id), component] as const),
	);
	const at = (node: NodeId): number | null => {
		for (const device of devices) {
			if (device.kind !== "jack" || !device.nodes.includes(node)) {
				continue;
			}
			const component = byId.get(device.id);
			if (component === undefined) {
				continue;
			}
			const volts = typedVolts(component, "V0dBFS");
			if (volts !== null && volts > 0 && Number.isFinite(volts)) {
				return volts;
			}
		}
		return null;
	};
	return { input: at(ports.input), output: at(ports.output) };
}

function portImpedanceOhms(
	document: ParsedDocument,
	devices: readonly Device[],
	ports: { readonly input: NodeId; readonly output: NodeId },
): { readonly input: number | null; readonly output: number | null } {
	const byId = new Map(
		document.components
			.filter(
				(component) =>
					String(component.kind) === "jack" &&
					// Folded, not exact. An exact match is a claim that every packet spells the
					// token identically, and the corpus already disproves it: `circuit.led` is
					// written `Circuit.LED` 111 times and `Circuit.Led` twice. The consumer is the
					// only place that can be made not to care.
					foldToken(String(component.sourceTypeName ?? "")) !==
						foldToken("Circuit.Speaker"),
			)
			.map((component) => [String(component.id), component] as const),
	);
	const at = (node: NodeId): number | null => {
		for (const device of devices) {
			if (device.kind !== "jack" || !device.nodes.includes(node)) {
				continue;
			}
			const component = byId.get(device.id);
			if (component === undefined) {
				continue;
			}
			const ohms = typedOhms(component, "Impedance");
			if (ohms !== null && ohms > 0 && Number.isFinite(ohms)) {
				return ohms;
			}
		}
		return null;
	};
	return { input: at(ports.input), output: at(ports.output) };
}

/**
 * A jack's own declared load impedance, lowered into a resistor across its own two declared
 * terminals -- the amp output-stage plan's Stage A.
 *
 * Measured 2026-08-21: no amp in the corpus drives a modelled load. `fender-5e3-deluxe-
 * tweed` (port node 44), `vox-ac15-top-boost` (63) and `vox-ac30-top-boost` (129) have no
 * resistive element on their output transformer's secondary at all: an unloaded secondary
 * reflects no load into the primary, so the power tubes work against the wrong plate load and
 * no power is delivered -- `fender-5e3`'s 26.2 V there is an open-circuit voltage, and 26 V
 * into 8 Ω would be 43 W from a 12 W amp.
 *
 * Exactly 8 jacks across 7 packets state a typed load, read with `typedOhms` -- the same
 * structured `{raw, value, unit}` discipline `PrimaryImpedance`/`SecondaryImpedance` above
 * use. The rest of the corpus's speaker-typed jacks are not readable as data this stage may
 * act on: 25 monitor taps declare `Impedance: "∞ Ω"`, a bare string `typedOhms` never opens
 * because it is not `{value, unit}`, and five -- `fender-bassman`'s `"2 Ohm selected load"`
 * among them -- are prose with a number sitting in a sentence, exactly what this pipeline may
 * not parse. `typedOhms`'s structured-only read already refuses both without any extra check
 * here.
 *
 * Output-side only, by the same `outputJackRoles`/`outputJackTypeNames` evidence
 * `resolvePorts` uses below for the port itself: an *input* jack's impedance is a claim about
 * the source driving this circuit, not a load this circuit itself terminates, and lowering it
 * here would load the wrong side.
 *
 * Not a speaker model. This is a nominal-impedance resistor, so it carries no Thiele-Small
 * impedance curve -- no bass-resonance rise, no voice-coil inductance -- only the plate load
 * line becoming real. The plan's Stage B (the Thiele-Small one-port) is what earns those.
 *
 * Lives in this stage, not `lower.ts`: the load is a source fact (the jack's own declared
 * `Impedance`) turned directly into a device, exactly like every other typed-quantity-to-
 * resistor reading in this file (`PrimaryImpedance`, `SecondaryImpedance`, …). It needs no
 * region, admission, or program-layout knowledge that only `lower.ts` has, and appending it to
 * `devices` here means it is visible to every later stage as an ordinary two-terminal resistor
 * -- no new device kind, no new lowering path -- which is the smaller, more honest option
 * between (a) and (b) in the plan's decision. Appended after port resolution and control
 * defaulting run, so it cannot perturb either.
 */
/**
 * Nodes electrically on an **output** transformer's windings, widened to where its load actually
 * sits.
 *
 * One function because three places asked this question and two of them answered it differently:
 * `outputJackLoads` followed series passives, while the `output-port-not-transformer-coupled`
 * warning required direct membership, so a jack one passive hop away was simultaneously loaded as a
 * speaker and warned about as a preamp tap.
 *
 * Keyed on a declared `ratio`, which is what distinguishes an output transformer from a mains one:
 * a power transformer states winding voltages instead, and its nodes are not a speaker's.
 *
 * Widened two ways, both by connectivity and device kind rather than by any name:
 *
 *   - through two-terminal **passives**, because a source that states the secondary's own winding
 *     resistance puts a resistor between the winding and the jack -- measured on
 *     `report-speaker-load.ts`'s fixture, requiring direct membership dropped the speaker network
 *     from three stamps to none, left the secondary open and doubled the output;
 *   - through an **impedance selector**, meaning a switch two or more of whose nodes are already on
 *     the winding. An ohms selector sits between a secondary's taps and the speaker, so the jack on
 *     its common is this winding's load. The two-or-more guard is what stops this leaking: a switch
 *     selecting among one winding's taps necessarily touches that winding twice, while a pedal's
 *     footswitch touches an output transformer zero times -- and the four pedals declaring a
 *     `Circuit.Speaker` output with a typed impedance are the case the passive-only rule excludes.
 */
function transformerCoupledNodes(
	devices: readonly Device[],
): Set<NodeId> {
	const reached = new Set<NodeId>();
	for (const device of devices) {
		if (
			device.kind !== "transformer" ||
			typeof device.parameters.ratio !== "number"
		) {
			continue;
		}
		for (const node of device.nodes) {
			if (node !== GROUND) {
				reached.add(node);
			}
		}
	}
	if (reached.size === 0) {
		return reached;
	}
	const seriesKinds = new Set(["resistor", "inductor", "capacitor"]);
	for (let widened = true; widened; ) {
		widened = false;
		for (const device of devices) {
			const ends = [...new Set(device.nodes)].filter(
				(node) => node !== GROUND,
			);
			if (device.kind === "switch") {
				const onWinding = ends.filter((node) => reached.has(node));
				if (onWinding.length >= 2 && onWinding.length < ends.length) {
					for (const node of ends) {
						reached.add(node);
					}
					widened = true;
				}
				continue;
			}
			if (!seriesKinds.has(device.kind) || ends.length !== 2) {
				continue;
			}
			const [a, b] = ends as [NodeId, NodeId];
			if (reached.has(a) !== reached.has(b)) {
				reached.add(a);
				reached.add(b);
				widened = true;
			}
		}
	}
	return reached;
}

function outputJackLoads(
	document: ParsedDocument,
	devices: readonly Device[],
): {
	readonly devices: readonly Device[];
	readonly warnings: readonly CompileWarning[];
} {
	const roles = declaredJackRoles(document);
	// Stage B needs two nodes per speaker that no component declares. Allocated above every node
	// already in use, so they cannot collide with a declared or geometric id.
	let nextNode =
		Math.max(GROUND, ...devices.flatMap((device) => [...device.nodes])) + 1;
	// Nodes on a winding of a transformer that declares a `ratio` -- an output transformer. A
	// mains transformer declares winding voltages instead and its nodes are not a speaker's.
	const secondaryNodes = transformerCoupledNodes(devices);
	// **Follow the winding through series passives.** A speaker does not always sit directly on the
	// winding: a source that states the transformer's own **secondary winding resistance** puts a
	// resistor between them, and Stage C names exactly that. Requiring direct membership silently
	// declined to load such a jack -- measured on `report-speaker-load.ts`'s fixture, adding a 0.5 Ω
	// secondary resistance dropped the speaker network from three stamps to none, left the secondary
	// open, and doubled the output. It did at least warn, via
	// `output-port-not-transformer-coupled`.
	//
	// Reachability is through two-terminal **passive** elements only -- a resistor, an inductor, a
	// capacitor. Not through a switch, a pot, an active device or another transformer: those are
	// where a jack stops being this winding's load and starts being something else's, and the
	// four pedals that declare a `Circuit.Speaker` output with a typed impedance are exactly the
	// case this gate exists to exclude.
	const added: Device[] = [];
	const warnings: CompileWarning[] = [];
	for (const component of document.components) {
		if (String(component.kind) !== "jack") {
			continue;
		}
		const ohms = typedOhms(component, "Impedance");
		if (ohms === null || !(ohms > 0)) {
			continue;
		}
		const device = devices.find(
			(candidate) =>
				candidate.kind === "jack" && candidate.id === String(component.id),
		);
		if (device === undefined) {
			continue;
		}
		const role = roles.get(String(component.id));
		const typeName = String(component.sourceTypeName ?? "").toLowerCase();
		const isOutputSide =
			role === undefined
				? outputJackTypeNames.has(typeName)
				: outputJackRoles.has(role);
		if (!isOutputSide) {
			continue;
		}
		// **On an output transformer's winding, or it is not a speaker load.** Output-side and
		// typed is not enough, and the corpus says so plainly: four *pedals* declare an output
		// jack as `Circuit.Speaker` with a typed impedance -- `marshall-blues-breaker`'s `S1` at
		// 1 MΩ, `mxr-m117r-flanger`'s `J3` at 1 kΩ, `mxr-noise-gate-line-driver`'s `OUT` at
		// 10 kΩ, `pigtronix-philosophers-tone`'s `OUTPUT` at 150 Ω. Those are interface facts,
		// an output impedance or a nominal load written on the port, not a driver hanging off a
		// secondary; stamping them as resistors to ground took `mxr-m117r-flanger` from
		// `agrees corr=1.0000` to `both silent` against ngspice on the first measured run.
		//
		// A speaker sits on the secondary of a transformer that declares a `ratio`, which is
		// the same evidence `resolvePorts` uses to prefer the speaker over a monitor tap, and
		// it separates the two cases without reading a name, a description, or guessing from
		// the magnitude of the impedance.
		if (!device.nodes.some((node) => secondaryNodes.has(node))) {
			continue;
		}
		// The jack's own resolved nodes, from the device this same component already
		// produced above. A third terminal -- an impedance-selector tap, as `fender-
		// bassman`'s speaker jack has -- makes "its own two declared terminals" ambiguous,
		// so this stage picks neither rather than guessing which pair the load bridges.
		const nodes = [...new Set(device.nodes)];
		if (nodes.length !== 2) {
			continue;
		}
		// Stage B: the driver as `Re -- Le -- (Rmot || Lmot || Cmot)`, not a resistor. `ohms` is
		// the jack's declared nominal, which scales the generic profile -- see `speaker-load.ts`
		// for why the driver is generic and what that costs the claim.
		const [hot, ret] = nodes as [NodeId, NodeId];
		const coil = nextNode;
		const motional = nextNode + 1;
		nextNode += 2;
		const port = speakerOnePort(ohms);
		const element = (
			suffix: string,
			kind: Device["kind"],
			pair: readonly [NodeId, NodeId],
			parameters: Device["parameters"],
		): Device => ({
			id: `${component.id}-speaker-${suffix}`,
			kind,
			nodes: [...pair],
			parameters,
			control: null,
			identity: {
				partNumber: null,
				declaredType: null,
				terminalRoles: [null, null],
				declaredTerminalRoles: [null, null],
				declaredWindings: null,
			},
		});
		added.push(
			element("re", "resistor", [hot, coil], { ohms: port.reOhms }),
			element("le", "inductor", [coil, motional], { henries: port.leHenries }),
			element("rmot", "resistor", [motional, ret], { ohms: port.motionalOhms }),
			element("lmot", "inductor", [motional, ret], {
				henries: port.motionalHenries,
			}),
			element("cmot", "capacitor", [motional, ret], {
				farads: port.motionalFarads,
			}),
		);
		warnings.push({
			code: "generic-speaker-profile",
			device: String(component.id),
			nominalOhms: ohms,
			detail: `${component.id} is modelled as a generic ${ohms} Ω driver, not the one this amp uses: no packet identifies a driver in a form that resolves, so the impedance curve is a seed profile scaled to the declared nominal. Its shape is a real driver's; its identity is not this amp's.`,
		});
	}
	return { devices: added, warnings };
}

function resolvePorts(
	document: ParsedDocument,
	devices: readonly Device[],
	options?: ReadNetlistOptions,
): {
	readonly input: NodeId;
	readonly output: NodeId;
} {
	const typeNameOf = (device: Device): string => {
		const component = document.components.find(
			(candidate) => String(candidate.id) === device.id,
		);
		return String(component?.sourceTypeName ?? "").toLowerCase();
	};
	// A power inlet is a jack and is never a signal port. Removing it first matters
	// more than which jack is chosen: the fallback used to take the last jack, and in a
	// document that lists the DC inlet last, **the output was read off the power jack**
	// and the pedal rendered silence.
	const roles = declaredJackRoles(document);
	const jacks = devices
		.filter((device) => device.kind === "jack")
		.filter((device) => {
			// A declared role decides; the type name only speaks when there is none.
			const role = roles.get(device.id);
			return role === undefined
				? !powerJackTypeNames.has(typeNameOf(device))
				: !powerJackRoles.has(role);
		});
	const byRole = (
		acceptedRoles: ReadonlySet<string>,
		acceptedTypes: ReadonlySet<string>,
	): Device | undefined =>
		jacks.find((device) => {
			const role = roles.get(device.id);
			return role === undefined
				? acceptedTypes.has(typeNameOf(device))
				: acceptedRoles.has(role);
		});

	let input: Device | undefined;
	if (options?.inputJack !== undefined) {
		const target = options.inputJack.toLowerCase();
		input = devices.find(
			(d) =>
				d.kind === "jack" &&
				(d.id === options.inputJack || d.id.toLowerCase() === target),
		);
		if (input === undefined) {
			const available = devices
				.filter((d) => d.kind === "jack")
				.map((d) => d.id);
			throw new NetlistError(
				`requested input jack "${options.inputJack}" was not found. Available jacks: ${available.join(", ")}`,
			);
		}
	} else {
		// A port comes from a jack that declares its role, or it does not come at all.
		input = byRole(inputJackRoles, inputJackTypeNames);
	}

	// An amp's output port is **after** its output transformer, and a monitor tap is not.
	//
	// **Reached through a switch or selector, not only directly.** A speaker jack usually sits
	// behind an impedance selector: `orange-gro100`'s `J_SPEAKER` is on node 79 and its
	// `S_SPEAKER_IMPEDANCE` joins that to the winding's 76/77/78 taps, so a direct node test
	// missed it and the output port fell through to `Output`, a jack whose own
	// `SourceBoundaryRole` reads "tone-stack output-amp handoff label". The amp then rendered its
	// tone stack, and the render clipped because a preamp node has no transformer bounding it.
	//
	// Which throw is closed is a control position this stage does not read, so every terminal of
	// a switch is treated as reachable from every other -- the same bound `port-full-scale.ts`
	// takes for the same reason, since any throw may be the live one.
	const transformerNodes = new Set<NodeId>();
	for (const device of devices) {
		if (device.kind !== "transformer") {
			continue;
		}
		if (typeof device.parameters.ratio !== "number") {
			continue;
		}
		for (const node of device.nodes) {
			if (node !== GROUND) {
				transformerNodes.add(node);
			}
		}
	}
	// Two hops covers a jack behind a selector behind a switch. Unbounded would let a chain of
	// contacts carry the label across the amp to a jack the winding does not feed.
	for (let hop = 0; hop < 2; hop += 1) {
		const reached: NodeId[] = [];
		for (const device of devices) {
			// Only `switch` at this stage: a selector is still one, and `lower.ts` is where it
			// becomes per-throw stamps.
			if (device.kind !== "switch") {
				continue;
			}
			const touches = device.nodes.some(
				(node) => node !== GROUND && transformerNodes.has(node),
			);
			if (!touches) {
				continue;
			}
			for (const node of device.nodes) {
				if (node !== GROUND) {
					reached.push(node);
				}
			}
		}
		for (const node of reached) {
			transformerNodes.add(node);
		}
	}

	let output: Device | undefined;
	if (options?.outputJack !== undefined) {
		const target = options.outputJack.toLowerCase();
		output = devices.find(
			(d) =>
				d.kind === "jack" &&
				(d.id === options.outputJack || d.id.toLowerCase() === target),
		);
		if (output === undefined) {
			const available = devices
				.filter((d) => d.kind === "jack")
				.map((d) => d.id);
			throw new NetlistError(
				`requested output jack "${options.outputJack}" was not found. Available jacks: ${available.join(", ")}`,
			);
		}
	} else {
		// **By role only, and the empty type set is the fix rather than an omission.** This
		// preference exists for a jack that *declares* `wet-output`; there is no type name that
		// means it. Passing `outputJackTypeNames` here made it match the first output-**typed**
		// jack in any document that declares no roles at all -- which is every amp -- so it
		// always won, and it silently preempted anything ranked below it. Behaviour-neutral while
		// it happened to pick what the positional fallback would have picked, and a wrong answer
		// the moment a better-evidenced preference was added underneath.
		const wetOutput = byRole(new Set(["wet-output"]), new Set<string>());
		const speakerSide = jacks.find((device) => {
			const role = roles.get(device.id);
			const accepted =
				role === undefined
					? outputJackTypeNames.has(typeNameOf(device))
					: outputJackRoles.has(role);
			return (
				accepted &&
				device.nodes.some((node) => node !== GROUND && transformerNodes.has(node))
			);
		});
		output =
			wetOutput ?? speakerSide ?? byRole(outputJackRoles, outputJackTypeNames);
	}
	if (input === undefined || output === undefined) {
		// Two different source facts, and conflating them sends the reader to the wrong
		// place: a document with no connected jack at all is missing its interface,
		// where one whose jacks are all untyped is missing only their roles.
		if (jacks.length === 0) {
			throw new NetlistError("document declares no connected jack");
		}
		const missing =
			input === undefined && output === undefined
				? "an input or an output role"
				: input === undefined
					? "an input role"
					: "an output role";
		throw new NetlistError(
			`no jack declares ${missing}, so the port cannot be resolved without inventing one`,
		);
	}
	const signalNode = (device: Device): NodeId =>
		device.nodes.find((node) => node !== GROUND) ?? GROUND;
	// A speaker jack can carry more than two terminals -- `fender-bassman`'s
	// `J_SPEAKER_OUTPUT` declares `[43, 0, 41]`, an impedance-selected load -- and only one of
	// them is the transformer secondary. Taking the first non-ground node probed node 43 while
	// the winding is node 41, so the render measured a terminal the power stage does not
	// drive: 6.07e-16 of swing, read as a silent amp. Picking the winding-touching node when
	// the jack has one is the same connectivity evidence that chose the jack.
	const outputNode =
		output.nodes.find(
			(node) => node !== GROUND && transformerNodes.has(node),
		) ?? signalNode(output);
	return { input: signalNode(input), output: outputNode };
}
