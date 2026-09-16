// Stage 5: turn each region into a block of stamps.
//
// A stamp is a *symbolic* contribution to the MNA system, not a number. Two things
// are deliberately left unevaluated here, and both are decisions rather than
// convenience:
//
//   - **Sample rate.** A capacitor's companion conductance is 2C/dt, which needs a
//     rate. The rate is a runtime input (decision 3), so the stamp carries C and the
//     runtime computes the conductance. There is no sample rate anywhere in this
//     file, no default, and no fallback.
//   - **Control position.** A pot's conductance depends on its 0..1 position through
//     its taper (decision 2), so the stamp carries the track resistance and the taper
//     and the runtime evaluates them. Moving a knob re-evaluates coefficients; it
//     never re-lowers.
//
// The result is that one lowered program is valid at every sample rate and every knob
// position, which is what makes rate independence testable: compile once, run at two
// rates, and the outputs must match.

import { SWITCH_ON_OHMS } from "./device-laws";

import { findLatchSeeds } from "./latch-seed";
import { computeSparseSchedule } from "./sparse-schedule";
import {
	computeStampPartition,
	remapStampNodes,
	shouldEliminate,
	stampControl,
	stampNeedsNewton,
} from "./stamp-partition";

export { stampNeedsNewton } from "./stamp-partition";
import type {
	Block,
	Device,
	LawedNetlist,
	NodeId,
	OperatingPointSeed,
	Partitioning,
	Region,
	Stamp,
} from "./types";
import { GROUND } from "./types";
import { foldToken } from "./registry";
import { LoweringError } from "./errors";
import {
	nodeOccurrenceCounts,
	selectorTapNodes,
	transformerWindings,
} from "./transformer";
import {
	opampInputDistances,
	potTerminals,
	quietDistances,
} from "./pot-orientation";

export {
	opampInputDistances,
	potTerminals,
	quietDistances,
} from "./pot-orientation";

export { LoweringError } from "./errors";



export { stampControl } from "./stamp-partition";

export function lowerRegion(
	region: Region,
	lawed: LawedNetlist,
	inputNode: number,
	outputNode: number,
	/**
	 * Computed once by `lower` rather than per region: the rule is a pairwise scan over
	 * transistors, and `boss-ds-1` lowers 82 regions from one netlist.
	 */
	latchSeeds: readonly OperatingPointSeed[] = [],
	/**
	 * Computed once by `lower`, for the same reason `latchSeeds` is: the graph a pot's
	 * orientation reads (`quietDistances`) does not change between `boss-ds-1`'s 82 regions
	 * either. Empty by default so a direct call site not passing one gets today's
	 * declaration-order behaviour for every pot -- never a wrong answer, only an unresolved one.
	 */
	quietDistance: ReadonlyMap<NodeId, number> = new Map(),
	/**
	 * The narrower, scoped fallback `potTerminals` only consults when `quietDistance` leaves a
	 * pot fully unreachable -- see `opampInputDistances`. Empty by default for the same reason
	 * `quietDistance` is: an unresolved pot, never a wrong one.
	 */
	opampInputDistance: ReadonlyMap<NodeId, number> = new Map(),
): Block {
	if (region.kind === "macro") {
		const macro = region.macro;
		if (macro === null) {
			throw new Error(`region ${region.id} is macro but carries no model`);
		}
		// Placeholders: `couple.ts` runs after every region has been lowered and needs to see
		// every block to wire a macro's audio/parameter ports across them, so it cannot happen
		// here where only this one region is in view.
		return {
			kind: "macro",
			id: region.id,
			modelId: macro.modelId,
			parameters: macro.parameters,
			audioIn: null,
			audioOut: false,
			parameter: null,
			modulation: null,
			clockControl: macro.clockControl ?? null,
			delayProvenance: macro.delayProvenance ?? null,
			delayDeclaredReason: macro.delayDeclaredReason ?? null,
		};
	}

	const deviceById = new Map(
		lawed.netlist.devices.map((device) => [device.id, device] as const),
	);
	const resolutionByDevice = new Map(
		lawed.resolutions.map(
			(resolution) => [resolution.device, resolution] as const,
		),
	);
	// Only consulted by a transformer whose own terminal grouping turns up a lone,
	// unpaired end -- see `transformerWindings`. Computed once per region against the
	// whole netlist, not just this region, because the question is "does anything else in
	// the document touch this node", not "does anything in this region".
	const terminalOccurrences = nodeOccurrenceCounts(lawed.netlist.devices);
	const selectorTaps = selectorTapNodes(lawed.netlist.devices);

	const stamps: Stamp[] = [];
	const extraNodes: NodeId[] = [];
	/**
	 * A private node no pin of the source document reaches -- a device-internal midpoint.
	 *
	 * Counted off `extraNodes.length` rather than off `stamps.length`: two devices that each
	 * need an internal node are only guaranteed distinct numbers if the counter advances once
	 * per node handed out. Keying off the stamp count instead means a device that emits
	 * several stamps per internal node and one that emits one can be handed the same number,
	 * which silently shorts two device internals together.
	 */
	const allocateInternalNode = (): NodeId => {
		const highest = Math.max(...lawed.netlist.nodes);
		const node = (highest + 1 + extraNodes.length) as NodeId;
		extraNodes.push(node);
		return node;
	};
	/** Node spans already held at a potential, so one supply is not stamped twice. */
	const drivenNodes = new Map<string, number>();
	let stateCount = 0;
	let auxCount = 0;

	for (const deviceId of region.devices) {
		const device = deviceById.get(deviceId);
		const resolution = resolutionByDevice.get(deviceId);
		if (
			device === undefined ||
			resolution === undefined ||
			resolution.outcome !== "law"
		) {
			continue;
		}
		const law = resolution.law;
		// A supply is stated two ways: a battery names both ends, a rail names one node
		// and means "against ground". Everything else genuinely needs two terminals.
		const [a, b] =
			law.kind === "voltage-source" && device.nodes.length === 1
				? ([device.nodes[0] as number, GROUND] as const)
				: terminalPair(device);

		switch (law.kind) {
			case "conductance":
				stamps.push({ kind: "conductance", a, b, siemens: law.siemens });
				break;
			case "controlled-conductance": {
				// A pot has three terminals: one end, wiper, other end. Each half of the
				// track becomes its own controlled element so the wiper node is real.
				const [end1, wiper, end2] = potTerminals(
					device,
					quietDistance,
					opampInputDistance,
					// The declared role of the control this pot answers to. `potTerminals`
					// reads it for one narrow case -- a rheostat whose control names a time
					// constant -- and ignores it otherwise.
					lawed.netlist.controls.find(
						(control) => control.id === law.control,
					)?.role ?? null,
				);
				// Both halves carry the same residual: it is a property of the wiper's
				// travel, so each end of the track keeps one.
				stamps.push({
					kind: "controlled-conductance",
					a: end1,
					b: wiper,
					control: law.control,
					taper: law.taper,
					totalOhms: law.totalOhms,
					side: "upper",
					residualOhms: law.residualOhms,
				});
				stamps.push({
					kind: "controlled-conductance",
					a: wiper,
					b: end2,
					control: law.control,
					taper: law.taper,
					totalOhms: law.totalOhms,
					side: "lower",
					residualOhms: law.residualOhms,
				});
				break;
			}
			case "controlled-resistance": {
				// Two terminals, one element. Unlike a pot there is no wiper node to
				// create, so this is the plain two-terminal pair.
				const [end1, end2] = terminalPair(device);
				stamps.push({
					kind: "controlled-resistance",
					a: end1,
					b: end2,
					control: law.control,
					taper: law.taper,
					minOhms: law.minOhms,
					maxOhms: law.maxOhms,
				});
				break;
			}
			case "switch":
				stamps.push({
					kind: "switch",
					a,
					b,
					control: law.control,
					onOhms: law.onOhms,
					offOhms: law.offOhms,
				});
				break;
			case "selector": {
				// Every throw of every pole is stamped, and the control decides which
				// conducts. One document still yields one program: a selector adds
				// elements, never a second netlist per position.
				const poles = switchPoles(device);
				const throwCount = Math.max(...poles.map((pole) => pole.throws.length));
				for (const pole of poles) {
					pole.throws.forEach((throwNode, throwIndex) => {
						stamps.push({
							kind: "selector",
							common: pole.common,
							throwNode,
							control: law.control,
							throwIndex,
							throwCount,
							onOhms: law.onOhms,
							offOhms: law.offOhms,
						});
					});
				}
				break;
			}
			// `stateIndex` is a slot offset, and a reactive element occupies two slots.
			// Counting one per element while the executor addressed `stateIndex * 2` made
			// the program understate its own state by half: harmless against a JS array,
			// which grows on write, and silent data loss against the
			// `Float64Array(stateCount)` any C++/WASM/ESP32 implementer would allocate.
			case "capacitance":
				stamps.push({
					kind: "capacitor",
					a,
					b,
					farads: law.farads,
					stateIndex: stateCount,
				});
				stateCount += STATE_SLOTS_PER_REACTIVE_ELEMENT;
				// Declared DC leakage lowers as a second stamp, a plain conductance in
				// parallel, rather than a new field on the capacitor stamp: both consoles
				// already implement `conductance`, so a leaky capacitor is audible on the
				// TS and C++/WASM engines without either runtime changing.
				if (law.leakageSiemens > 0) {
					stamps.push({
						kind: "conductance",
						a,
						b,
						siemens: law.leakageSiemens,
					});
				}
				break;
			case "inductance":
				stamps.push({
					kind: "inductor",
					a,
					b,
					henries: law.henries,
					stateIndex: stateCount,
					// `"unknown"` is a statement, not a value: it carries no resistance into the
					// stamp but is a different claim from silence, and the law records which.
					...(typeof law.seriesResistanceOhms === "number"
						? { seriesResistanceOhms: law.seriesResistanceOhms }
						: {}),
				});
				stateCount += STATE_SLOTS_PER_REACTIVE_ELEMENT;
				break;
			case "diode": {
				// By role, not by order: 11 corpus diodes are declared cathode-first, and
				// a reversed diode still conducts, so a clipper looks fine while a
				// rectifier or a protection diode is backwards.
				//
				// **And one component can be several junctions.** A bridge rectifier is four,
				// a dual rectifier two; taking one pair silently dropped the rest. See
				// `diodeJunctions`.
				for (const junction of diodeJunctions(device)) {
					stamps.push({
						kind: "diode",
						anode: junction.anode,
						cathode: junction.cathode,
						saturationCurrent: law.saturationCurrent,
						emissionCoefficient: law.emissionCoefficient,
						thermalVoltage: law.thermalVoltage,
						breakdownVolts: law.breakdownVolts,
						seriesResistance: law.seriesResistance,
						device: device.id,
						isLed: law.isLed,
					});
				}
				break;
			}
			case "bjt": {
				const [base, collector, emitter] = bjtTerminals(device);
				stamps.push({
					kind: "bjt",
					base,
					collector,
					emitter,
					polarity: law.polarity,
					leakageAmps: law.leakageAmps,
					saturationCurrent: law.saturationCurrent,
					forwardBeta: law.forwardBeta,
					reverseBeta: law.reverseBeta,
					thermalVoltage: law.thermalVoltage,
				});
				break;
			}
			case "triode": {
				// A tube's terminal names are its own vocabulary -- grid, cathode, plate,
				// and `anode` for the plate -- so it cannot borrow `bjtTerminals`, whose
				// closed sets are base/collector/emitter and gate/drain/source. Getting the
				// plate and cathode the wrong way round would invert the stage and still
				// render, which is the class of error this stage exists to prevent.
				const [grid, cathode, plate] = triodeTerminals(device);
				stamps.push({
					kind: "triode",
					grid,
					cathode,
					plate,
					mu: law.mu,
					kg1: law.kg1,
					kp: law.kp,
					kvb: law.kvb,
					ex: law.ex,
					gridSaturationCurrent: law.gridSaturationCurrent,
					gridOnsetVolts: law.gridOnsetVolts,
					gridScaleVolts: law.gridScaleVolts,
					contactPotentialVolts: law.contactPotentialVolts,
				});
				break;
			}
			case "pentode": {
				const [grid, cathode, plate, screen] = pentodeTerminals(device);
				stamps.push({
					kind: "pentode",
					grid,
					cathode,
					plate,
					screen,
					mu: law.mu,
					kg1: law.kg1,
					kp: law.kp,
					kvb: law.kvb,
					ex: law.ex,
					gridSaturationCurrent: law.gridSaturationCurrent,
					gridOnsetVolts: law.gridOnsetVolts,
					gridScaleVolts: law.gridScaleVolts,
					contactPotentialVolts: law.contactPotentialVolts,
					screenShare: law.screenShare ?? 0,
				});
				break;
			}
			case "tube-diode": {
				// One stamp per plate, all sharing the cathode.
				//
				// Every tube diode in the amp corpus is a **dual**: `plate_a`, `plate_b` and one
				// `cathode_filament`. Two plates in one envelope over a common cathode are two
				// independent conduction paths -- there is no interaction to model, because a
				// directly heated cathode emits toward whichever plate is positive -- so this needs
				// no operator of its own, exactly as an N-winding transformer needed none.
				//
				// Taking the first plate and dropping the second would be the pentode's ganged
				// case: half a device that still renders. In a centre-tapped supply, which is what
				// all three instances are wired into, that is a **full-wave rectifier reduced to
				// half-wave** -- the same defect the transformer's positional reading produced on
				// `tycobrahe-octavia`, here doubling the ripple and halving the available current.
				for (const plate of tubeDiodePlates(device)) {
					stamps.push({
						kind: "tube-diode",
						plate: plate.plate,
						cathode: plate.cathode,
						perveance: law.perveance,
						exponent: law.exponent,
					});
				}
				break;
			}
			case "fet": {
				const [gate, drain, source] = bjtTerminals(device);
				stamps.push({
					kind: "fet",
					gate,
					drain,
					source,
					channel: law.channel,
					thresholdVolts: law.thresholdVolts,
					transconductance: law.transconductance,
					channelLengthModulation: law.channelLengthModulation,
					gateSaturationCurrent: law.gateSaturationCurrent,
					gateOnsetVolts: law.gateOnsetVolts,
					gateScaleVolts: law.gateScaleVolts,
				});
				break;
			}
			case "transformer": {
				// One stamp per secondary winding.
				//
				// A **coupled** winding is one stamp against the shared primary. An N-winding
				// ideal transformer *is* (N-1) two-winding ones on a shared primary, so this
				// needs no new operator. Each winding sees the same flux, so `V_k / n_k` is
				// equal across all of them, and ampere-turns balance `sum(N_k * I_k) = 0` falls
				// out: a secondary reflecting `-n_k * i_k` into the primary pair means the
				// primary carries `sum(i_k)`, and substituting gives
				// `N_1 * sum(i_k) - sum(N_1 * i_k) = 0`. Exactly the N-winding constraint.
				//
				// A **driven** winding is one `ac-source` at the winding's own stated RMS, with
				// no primary modelled at all -- see `transformerWindings` for when and why.
				for (const winding of transformerWindings(
					device,
					law,
					terminalOccurrences,
					selectorTaps,
				)) {
					stamps.push(
						winding.kind === "coupled"
							? {
									kind: "transformer",
									primaryPlus: winding.primaryPlus,
									primaryMinus: winding.primaryMinus,
									secondaryPlus: winding.plus,
									secondaryMinus: winding.minus,
									turnsRatio: winding.turnsRatio,
									sourceIndex: auxCount,
									// **The declared value IS the primary-referred loop resistance**,
									// used as stated. An earlier version read it as each winding's
									// own resistance and formed `R * (1 + n^2)`, which for the
									// 2k:4 output transformer turned a declared 50 Ω into 25 kΩ --
									// **12.5x the primary impedance**, a near-open circuit rather
									// than damping. That is wrong because a real transformer's
									// secondary is about `R_p / n^2`, not equal to `R_p`, so the
									// referred total is of order `2 * R_p` and never `n^2 * R_p`.
									// One number, referred to the primary, is also the only thing
									// a single property can honestly mean.
									//
									// `unknown` carries no value, which is a different claim from
									// silence but the same stamp.
									...(typeof law.seriesResistanceOhms === "number"
										? { seriesResistanceOhms: law.seriesResistanceOhms }
										: {}),
								}
							: {
									kind: "ac-source",
									positive: winding.plus,
									negative: winding.minus,
									amplitudeVolts: winding.amplitudeVolts,
									frequencyHz: winding.frequencyHz,
									sourceIndex: auxCount,
									sourceOhms: winding.sourceOhms,
								},
					);
					auxCount += 1;
				}
				break;
			}
			case "spring-reverb": {
				// A tank's two coils come from its **declared** windings, never from terminal
				// order: swapping a pair's ends inverts that port, and swapping the pairs sends
				// the recovery amp's signal into the drive coil instead of taking it from the
				// pickup. Order would decide both silently, so a missing declaration is a refusal.
				//
				// `drive`/`pickup` rather than `primary`/`secondary` because neither coil
				// transforms the other's voltage -- the springs are between them. This replaced a
				// four-spelling name set (`inputhot`/`inputreturn`/`outputhot`/`outputreturn`),
				// which was the last terminal-name vocabulary in this file.
				const coils = new Map<string, readonly NodeId[]>();
				for (const winding of device.identity.declaredWindings ?? []) {
					const nodes = winding.terminalIndices.flatMap((index) => {
						const node = device.nodes[index];
						return node === undefined ? [] : [node];
					});
					if (nodes.length === 2 && !coils.has(winding.role)) {
						coils.set(winding.role, nodes);
					}
				}
				const drive = coils.get("drive");
				const pickup = coils.get("pickup");
				if (drive === undefined || pickup === undefined) {
					throw new LoweringError(
						`spring reverb tank ${device.id}: needs a two-terminal "drive" winding and a ` +
							'two-terminal "pickup" winding declared, and which coil is which decides ' +
							"whether the signal goes into the springs or comes out of them; saw " +
							`[${(device.identity.declaredWindings ?? []).map((winding) => winding.role).join(", ")}]`,
						device.id,
					);
				}
				const [inputPlus, inputMinus] = drive as [NodeId, NodeId];
				const [outputPlus, outputMinus] = pickup as [NodeId, NodeId];
				stamps.push({
					kind: "spring-reverb",
					inputPlus,
					inputMinus,
					outputPlus,
					outputMinus,
					inputOhms: law.inputOhms,
					outputOhms: law.outputOhms,
					delaySeconds: law.delaySeconds,
					decaySeconds: law.decaySeconds,
					dispersionStages: law.dispersionStages,
					sourceIndex: auxCount,
				});
				auxCount += 1;
				break;
			}
			case "voltage-source": {
				// One node, one assertion. A packet may state the same supply twice --
				// `boss-sd-1` declares a 9 V rail and a 9 V battery on the same node --
				// and two ideal sources in parallel are two matrix rows asserting one
				// constraint, which is rank-deficient and solves to nothing. Stamping it
				// once is exactly equivalent.
				const [positive, negative] = supplyTerminals(device);
				// The span is order-normalised and the voltage is oriented onto it, so a
				// twin declared the other way round is recognised as the *contradiction*
				// it is rather than stamped beside the first as a second row. Keying on
				// `positive:negative` made a reversed duplicate look like a different
				// supply, which is two rows asserting opposite signs across one pair.
				const low = Math.min(positive, negative);
				const high = Math.max(positive, negative);
				const span = `${low}:${high}`;
				const oriented = positive === low ? law.volts : -law.volts;
				const existing = drivenNodes.get(span);
				if (existing !== undefined) {
					if (existing !== oriented) {
						throw new LoweringError(
							`nodes ${low} and ${high} are driven to both ${existing} V and ${oriented} V`,
							device.id,
						);
					}
					break;
				}
				drivenNodes.set(span, oriented);
				stamps.push({
					kind: "dc-source",
					positive,
					negative,
					volts: law.volts,
					sourceIndex: auxCount,
					sourceOhms: law.sourceOhms,
				});
				auxCount += 1;
				break;
			}
			case "ac-source": {
				// The same two ends a DC supply has, read by the same roles -- `hot`/`neutral` and
				// `line`/`neutral` are the mains pairs the amp packets declare, and a reversed
				// sine is a sine, so orientation matters far less here than for a rail. It is read
				// anyway rather than positionally, because the phase relationship between two
				// windings of one transformer is not a free choice.
				//
				// **No twin collapsing.** A DC supply gets one, because packets state the same rail
				// twice and two ideal sources across one span are two rows asserting one
				// constraint. Nothing in either corpus declares a duplicate AC source, so
				// deduplicating one here would be a rule against unexercised data; the
				// `node-driven-by-two-sources` warning covers the case if it ever arrives.
				const [positive, negative] = supplyTerminals(device);
				stamps.push({
					kind: "ac-source",
					positive,
					negative,
					amplitudeVolts: law.amplitudeVolts,
					frequencyHz: law.frequencyHz,
					sourceIndex: auxCount,
					sourceOhms: law.sourceOhms,
				});
				auxCount += 1;
				break;
			}
			case "ideal-opamp": {
				const [plus, minus, output] = opampTerminals(device);
				stamps.push({
					kind: "ideal-opamp",
					plus,
					minus,
					output,
					sourceIndex: auxCount,
					railHigh: law.railHigh,
					railLow: law.railLow,
					openLoopGain: law.openLoopGain,
				});
				auxCount += 1;
				break;
			}
			case "ota": {
				// Absent `terminalIndices` means the terminals arrived already in law order,
				// which is what a registry `sections` entry produces. Present means they were
				// bound by the names the device declared; see `otaTerminalBinding`.
				const indices = law.terminalIndices;
				const positive = device.nodes[indices?.plus ?? 0];
				const negative = device.nodes[indices?.minus ?? 1];
				const output = device.nodes[indices?.output ?? 2];
				// `bias: null` says the device declares no amplifier-bias terminal, so this is
				// a linear OTA. Only the positional reading may fall through to position 3.
				const bias =
					indices === undefined
						? device.nodes[3]
						: indices.bias === null
							? undefined
							: device.nodes[indices.bias];
				if (
					positive === undefined ||
					negative === undefined ||
					output === undefined
				) {
					throw new LoweringError(
						`ota ${device.id} requires positive, negative, and output terminals`,
						device.id,
					);
				}
				if (bias !== undefined) {
					// 4-terminal active non-linear OTA
					const vee =
						law.veeIndex !== undefined &&
						device.nodes[law.veeIndex] !== undefined
							? (device.nodes[law.veeIndex] ?? 0)
							: 0;
					stamps.push({
						kind: "ota",
						plus: positive,
						minus: negative,
						bias,
						output,
						vee,
						saturationCurrent: law.saturationCurrent ?? 1e-12, // Physical Silicon diode default
						thermalVoltage: law.thermalVoltage ?? 0.025852, // Standard thermal voltage
					});
				} else {
					// 3-terminal static linear OTA fallback.
					//
					// **The inputs are crossed on purpose, and that is a bug fix.** The `vccs`
					// stamp's convention is that current *leaves* `outP` at
					// `gm * (v(inP) - v(inN))`, so binding `inP: positive` made this fallback
					// **inverting** while the four-terminal `ota` stamp above injects its current
					// and is **non-inverting**. The same catalog part therefore inverted or did
					// not depending only on how many terminals its entry mapped -- three of the
					// shipped OTA entries map three, five map five -- which split nine corpus
					// packets across two opposite polarities.
					//
					// Non-inverting is the correct one. `component-part-lowering.json`'s own
					// cited reading of the CA3080/CA3094 datasheet records that with the output
					// taken at terminal 6 the datasheet's output-mode table makes pin 3 the
					// non-inverting input, and the entry's role groups are that reading. An OTA
					// sourcing current into a load resistor raises its output as `v(+)` rises.
					//
					// Crossed here rather than negating `transconductance`, so the law's value
					// stays positive and matches the catalog wherever it is printed.
					stamps.push({
						kind: "vccs",
						outP: output,
						outN: 0,
						inP: negative,
						inN: positive,
						transconductance: law.transconductance,
					});
				}
				break;
			}
			case "inverter": {
				const { input, output, vdd, gnd } = inverterTerminals(device);
				if (input === undefined || output === undefined) {
					throw new Error(
						`inverter ${device.id} requires input and output terminals`,
					);
				}
				if (vdd !== undefined && gnd !== undefined) {
					// 1. PMOS: gate=input, drain=output, source=vdd
					stamps.push({
						kind: "fet",
						gate: input,
						drain: output,
						source: vdd,
						channel: "p",
						thresholdVolts: law.thresholdVolts ?? 2.0,
						transconductance: law.transconductance,
						channelLengthModulation: 0,
						gateSaturationCurrent: 0,
						gateOnsetVolts: 0,
						gateScaleVolts: 1,
					});
					// 2. NMOS: gate=input, drain=output, source=gnd
					stamps.push({
						kind: "fet",
						gate: input,
						drain: output,
						source: gnd,
						channel: "n",
						thresholdVolts: law.thresholdVolts ?? 2.0,
						transconductance: law.transconductance,
						channelLengthModulation: 0,
						gateSaturationCurrent: 0,
						gateOnsetVolts: 0,
						gateScaleVolts: 1,
					});
				} else {
					stamps.push({
						kind: "vccs",
						outP: output,
						outN: 0, // Ground return
						inP: 0, // Single-ended 0V ground reference
						inN: input,
						transconductance: law.transconductance,
						biasVolts: law.biasVolts ?? 4.5,
					});
				}
				break;
			}
			case "nand-gate": {
				const inA = device.nodes[0];
				const inB = device.nodes[1];
				const output = device.nodes[2];
				const vdd = device.nodes[3];
				const gnd = device.nodes[4];
				if (
					inA === undefined ||
					inB === undefined ||
					output === undefined ||
					vdd === undefined ||
					gnd === undefined
				) {
					throw new Error(
						`nand-gate ${device.id} requires 5 terminals (inA, inB, output, vdd, gnd)`,
					);
				}

				// A unique private internal node for the NMOS series midpoint.
				const nodeX = allocateInternalNode();

				// 1. PMOS A: gate=inA, drain=output, source=vdd
				stamps.push({
					kind: "fet",
					gate: inA,
					drain: output,
					source: vdd,
					channel: "p",
					thresholdVolts: law.thresholdVolts,
					transconductance: law.transconductance,
					channelLengthModulation: 0,
					gateSaturationCurrent: 0,
					gateOnsetVolts: 0,
					gateScaleVolts: 1,
				});

				// 2. PMOS B: gate=inB, drain=output, source=vdd
				stamps.push({
					kind: "fet",
					gate: inB,
					drain: output,
					source: vdd,
					channel: "p",
					thresholdVolts: law.thresholdVolts,
					transconductance: law.transconductance,
					channelLengthModulation: 0,
					gateSaturationCurrent: 0,
					gateOnsetVolts: 0,
					gateScaleVolts: 1,
				});

				// 3. NMOS A: gate=inA, drain=output, source=nodeX
				stamps.push({
					kind: "fet",
					gate: inA,
					drain: output,
					source: nodeX,
					channel: "n",
					thresholdVolts: law.thresholdVolts,
					transconductance: law.transconductance,
					channelLengthModulation: 0,
					gateSaturationCurrent: 0,
					gateOnsetVolts: 0,
					gateScaleVolts: 1,
				});

				// 4. NMOS B: gate=inB, drain=nodeX, source=gnd
				stamps.push({
					kind: "fet",
					gate: inB,
					drain: nodeX,
					source: gnd,
					channel: "n",
					thresholdVolts: law.thresholdVolts,
					transconductance: law.transconductance,
					channelLengthModulation: 0,
					gateSaturationCurrent: 0,
					gateOnsetVolts: 0,
					gateScaleVolts: 1,
				});
				break;
			}
			case "clock-driver": {
				const cp1 = device.nodes[0];
				const cp2 = device.nodes[1];
				const vgg = device.nodes[2];
				const vdd = device.nodes[3];
				const ox1 = device.nodes[4];
				const gnd = device.nodes[5];
				if (cp1 === undefined || cp2 === undefined || ox1 === undefined) {
					throw new LoweringError(
						`clock-driver ${device.id} requires cp1, cp2, and ox1 terminals`,
						device.id,
					);
				}
				stamps.push({
					kind: "clock-driver",
					cp1,
					cp2,
					vgg: vgg !== undefined ? vgg : 0,
					vdd: vdd !== undefined ? vdd : 0,
					ox1,
					// Absent means circuit ground, which is what the stamp assumed before this
					// terminal existed -- so an unbound GND pin reproduces the old behaviour
					// rather than refusing.
					gnd: gnd !== undefined ? gnd : 0,
					defaultFrequency: law.defaultFrequency ?? 10000, // 10 kHz default oscillator frequency
					stateIndex: stateCount++,
					sourceIndex: auxCount,
				});
				auxCount += 3; // CP1, CP2, and VGG voltage source outputs
				break;
			}
			case "optocoupler": {
				const { ledAnode, ledCathode, ldrA, ldrB } =
					optocouplerTerminals(device);
				if (
					ledAnode === undefined ||
					ledCathode === undefined ||
					ldrA === undefined ||
					ldrB === undefined
				) {
					throw new Error(
						`optocoupler ${device.id} requires 4 terminals: anode, cathode, ldrA, ldrB`,
					);
				}
				stamps.push({
					kind: "optocoupler",
					ledAnode,
					ledCathode,
					ldrA,
					ldrB,
					ledThresholdVolts: law.ledThresholdVolts,
					ledTransconductance: law.ledTransconductance,
					ldrMinOhms: law.ldrMinOhms,
					ldrMaxOhms: law.ldrMaxOhms,
					ldrPowerLawCoefficientOhms: law.ldrPowerLawCoefficientOhms,
					ldrPowerLawExponent: law.ldrPowerLawExponent,
				});
				break;
			}
			case "logic-divider": {
				const clockNode = device.nodes[0];
				const qNode = device.nodes[1];
				const gndNode = device.nodes[2];
				if (
					clockNode === undefined ||
					qNode === undefined ||
					gndNode === undefined
				) {
					throw new Error(
						`logic-divider ${device.id} requires clock, q, and gnd terminals`,
					);
				}
				stamps.push({
					kind: "logic-divider",
					clockNode,
					qNode,
					gndNode,
					thresholdVolts: law.thresholdVolts,
					highVolts: law.highVolts,
					sourceIndex: auxCount++,
					stateIndex: stateCount,
				});
				stateCount += 2;
				break;
			}
			case "analog-switch": {
				const a = device.nodes[0];
				const b = device.nodes[1];
				const control = device.nodes[2];
				if (a === undefined || b === undefined || control === undefined) {
					throw new LoweringError(
						`analog-switch ${device.id} requires three terminals: sig_a, sig_b, and control`,
						device.id,
					);
				}
				stamps.push({
					kind: "analog-switch",
					a,
					b,
					control,
					onOhms: law.onOhms,
					offOhms: law.offOhms,
					thresholdVolts: law.thresholdVolts,
				});
				break;
			}
			case "compandor": {
				// The datasheet's Figure 5 block diagram, built out of primitives. Only the
				// rectifier and the gain cell are bespoke; the five internal resistors, the
				// band-gap reference and the output op-amp are stamps the runtime already
				// had, which is why fixing this part needed no new runtime machinery beyond
				// the one `compandor` stamp below.
				const rectIn = device.nodes[0];
				const rectCap = device.nodes[1];
				const cellIn = device.nodes[2];
				const sumNode = device.nodes[3];
				const r3Pin = device.nodes[4];
				const output = device.nodes[5];
				if (
					rectIn === undefined ||
					rectCap === undefined ||
					cellIn === undefined ||
					sumNode === undefined ||
					r3Pin === undefined ||
					output === undefined
				) {
					throw new LoweringError(
						`compandor ${device.id} requires six terminals: rect_in, rect_cap, cell_in, inv_in, r3, and output`,
						device.id,
					);
				}

				// The internal 1.8 V band-gap reference. It has no pin, so it is a private
				// node: the rectifier and gain-cell summing nodes and the op-amp's
				// non-inverting input all sit here, which is what makes the chip work off a
				// single supply.
				const vref = allocateInternalNode();
				stamps.push({
					kind: "dc-source",
					positive: vref,
					negative: GROUND,
					volts: law.vrefVolts,
					sourceIndex: auxCount++,
					sourceOhms: 0,
				});

				// R1 and R2: the rectifier's and the gain cell's input resistors. Both
				// terminate on VREF (Figure 5: "the summing nodes of the rectifier and G
				// cell ... have the same potential"), so they are also the input impedance
				// each pin presents -- 10 k on RECT_IN and 20 k on G_CELL_IN. Without these
				// the chip would load its driver with nothing at all.
				stamps.push({
					kind: "conductance",
					a: rectIn,
					b: vref,
					siemens: 1 / law.r1,
				});
				stamps.push({
					kind: "conductance",
					a: cellIn,
					b: vref,
					siemens: 1 / law.r2,
				});

				// R5, the rectifier's averaging resistor, to ground. The packet's external
				// CRECT on this same node is an ordinary capacitor the solve integrates, so
				// `tau = R5 * CRECT` comes out of the circuit rather than out of a constant.
				stamps.push({
					kind: "conductance",
					a: rectCap,
					b: GROUND,
					siemens: 1 / law.r5,
				});

				// R3 from the summing node out to pin 6, and R4 from the summing node to
				// ground. Tying pin 6 to the output pin externally is what makes R3 the
				// feedback resistor and sets the stage gain; R4 to ground is what lifts the
				// quiescent output to `(1 + R3/R4) * VREF`.
				stamps.push({
					kind: "conductance",
					a: sumNode,
					b: r3Pin,
					siemens: 1 / law.r3,
				});
				stamps.push({
					kind: "conductance",
					a: sumNode,
					b: GROUND,
					siemens: 1 / law.r4,
				});

				// The chip's own supply pins bound this output, exactly as they bound a
				// discrete op-amp's. Stage 3 substitutes them; a null here means the document
				// declared no supply for the package, not that the part swings without limit.
				stamps.push({
					kind: "ideal-opamp",
					plus: vref,
					minus: sumNode,
					output,
					sourceIndex: auxCount++,
					railHigh: law.railHigh,
					railLow: law.railLow,
					openLoopGain: law.openLoopGain,
				});

				stamps.push({
					kind: "compandor",
					rectIn,
					rectCap,
					cellIn,
					sumNode,
					vref,
					r1: law.r1,
					r2: law.r2,
					r5: law.r5,
					iBias: law.iBias,
					stateIndex: stateCount,
				});
				// Two slots: the rectified current and the cell's transconductance. Both are
				// sampled once per committed sample and held across the Newton loop.
				stateCount += 2;
				break;
			}
			case "comparator": {
				const plus = device.nodes[0];
				const minus = device.nodes[1];
				const output = device.nodes[2];
				const vee = device.nodes[3];
				if (plus === undefined || minus === undefined || output === undefined) {
					throw new LoweringError(
						`comparator ${device.id} requires plus, minus, and output terminals`,
						device.id,
					);
				}
				stamps.push({
					kind: "comparator",
					plus,
					minus,
					output,
					vee: vee !== undefined ? vee : 0, // Defaults to ground node if VEE pin is unwired
					pullDownOhms: law.pullDownOhms,
					floatOhms: law.floatOhms,
					sensitivity: law.sensitivity,
				});
				break;
			}
			case "port-engage": {
				// The contact against the return, closed. Both were resolved when the law
				// was attached, from where the supply return landed; re-deriving them here
				// from role names is what shorted a signal terminal to ground.
				const contact = device.nodes[law.contactIndex];
				const back = device.nodes[law.againstIndex];
				if (contact === undefined || back === undefined) {
					throw new LoweringError(
						`jack ${device.id} has a port-engage law naming terminals it does not have`,
						device.id,
					);
				}
				stamps.push({
					kind: "conductance",
					a: contact,
					b: back,
					siemens: 1 / SWITCH_ON_OHMS,
				});
				break;
			}
			case "open":
				// Interface and reference symbols carry no element.
				break;
			default: {
				// A law with no stamp would be silently dropped from the circuit and the
				// result would still render -- plausible audio for a circuit that is
				// missing a component. Refusing is the only safe fallthrough.
				const unhandled: never = law;
				throw new Error(
					`no stamp for device law ${JSON.stringify(unhandled)} on ${deviceId}`,
				);
			}
		}
	}

	// Only the region that actually contains the input jack is driven by the signal.
	// Regions are independent subcircuits, not a chain: a dangling supply must not be
	// handed the input, and must not be read for the output.
	const ownsInput = region.nodes.includes(inputNode);
	const ownsOutput = region.nodes.includes(outputNode);
	if (ownsInput) {
		stamps.push({
			kind: "input-source",
			node: inputNode,
			sourceIndex: auxCount,
		});
		auxCount += 1;
	}

	// A seed belongs to the region that holds the node, and regions are disjoint.
	const regionNodes = new Set(region.nodes);
	const operatingPointSeeds = latchSeeds.filter((seed) =>
		regionNodes.has(seed.node),
	);

	// The row numbering. Ground is row 0 whether or not a device in this region returns
	// there, because the runtime pins row 0 and starts its gmin loop at 1 -- a region with
	// no grounded device would otherwise have its first real node silently pinned to zero.
	// Everything else follows in source-id order, so the numbering is a function of the
	// region and not of the order devices happened to be lowered in.
	const nodeIds: NodeId[] = [
		GROUND,
		...[...regionNodes, ...extraNodes]
			.filter((node) => node !== GROUND)
			.sort((a, b) => a - b),
	];
	const indexByNode = new Map(nodeIds.map((node, index) => [node, index]));
	const row = (node: NodeId): NodeId => {
		const index = indexByNode.get(node);
		if (index === undefined) {
			// Unreachable via `partition`, which builds `region.nodes` from exactly the devices
			// this loop stamped. Throwing rather than defaulting because the alternative -- a
			// silent 0 -- grounds an element and still renders.
			throw new LoweringError(
				`region ${region.id} stamped node ${node}, which is not one of its own`,
			);
		}
		return index;
	};

	const remappedStamps = stamps.map((stamp) => remapStampNodes(stamp, row));
	const stampPartition = computeStampPartition(remappedStamps, nodeIds.length);
	const sparseSchedule = computeSparseSchedule({
		nodeCount: nodeIds.length,
		auxCount,
		stamps: remappedStamps,
	});

	return {
		kind: "mna",
		id: region.id,
		nodeCount: nodeIds.length,
		nodeIds,
		auxCount,
		stamps: remappedStamps,
		stampPartition,
		sparseSchedule,
		stateCount,
		// From the stamps, not from `region.kind`. Measured across the corpus's 191 blocks the
		// two agree everywhere today, so this is not a correction -- it is the derivation being
		// taken from the thing the runtime evaluates, so that a law which lowers to something
		// milder (or to nothing) cannot leave a block claiming a solver cost it does not have.
		linear: !stamps.some(stampNeedsNewton),
		controlFree: stamps.every((stamp) => stampControl(stamp) === null),
		eliminate: shouldEliminate(
			nodeIds.length + auxCount,
			stampPartition.portRows.length,
			!stamps.some(stampNeedsNewton),
		),
		inputNode: ownsInput ? row(inputNode) : null,
		outputNode: ownsOutput ? row(outputNode) : null,
		operatingPointSeeds: operatingPointSeeds.map((seed) => ({
			...seed,
			node: row(seed.node),
		})),
	};
}

/**
 * A block's row index for a source `NodeId`, or `null` when the node is not one of this
 * block's own.
 *
 * The forward direction of `Block.nodeIds`. `null` rather than a throw because the two
 * callers that need it are asking a question whose honest answer can be "not this block":
 * `couple.ts` locating a macro's port node, and a report matching a declared source net
 * against whichever region owns it.
 */
export function blockNodeIndex(
	block: Extract<Block, { readonly kind: "mna" }>,
	node: NodeId,
): number | null {
	const index = block.nodeIds.indexOf(node);
	return index < 0 ? null : index;
}

/**
 * A stamp read back in the document's node ids rather than its block's rows.
 *
 * The inverse of what `lowerRegion` did on the way out, for consumers that have to state a
 * stamp's topology in the terms the source authored -- a report naming the net a device
 * sits on, or an assertion written against a fixture's declared node numbers.
 */
export function stampInSourceNodes(
	block: Extract<Block, { readonly kind: "mna" }>,
	stamp: Stamp,
): Stamp {
	return remapStampNodes(stamp, (row) => block.nodeIds[row] as NodeId);
}


export function lower(
	partitioning: Partitioning,
	lawed: LawedNetlist,
): readonly Block[] {
	const { input, output } = lawed.netlist.ports;
	const latchSeeds = findLatchSeeds(lawed.netlist);
	const quietDistance = quietDistances(lawed.netlist);
	const opampInputDistance = opampInputDistances(lawed.netlist);
	return partitioning.regions.map((region) =>
		lowerRegion(
			region,
			lawed,
			input,
			output,
			latchSeeds,
			quietDistance,
			opampInputDistance,
		),
	);
}

function terminalPair(device: Device): readonly [number, number] {
	const a = device.nodes[0];
	const b = device.nodes[1];
	if (a === undefined || b === undefined) {
		throw new LoweringError(
			`device ${device.id} needs two terminals`,
			device.id,
		);
	}
	return [a, b];
}

/**
 * Split a switch's terminals into poles: each common, then the throws that follow it.
 *
 * A multi-pole switch is one mechanism moving several independent contacts together,
 * so the poles share a control and are stamped side by side. Splitting at each common
 * handles every shape the corpus has, from `common,throwA,throwB` to a three-pole
 * `input_common,…,output_common,…,led_common,…`.
 */
function switchPoles(
	device: Device,
): Array<{ readonly common: number; readonly throws: number[] }> {
	// **Declared roles where the document states them, folded names otherwise.**
	//
	// 80 of the corpus's 198 switches declare `common`/`throw`/`coil`/`pin` on every terminal
	// (`vessel-dsp/artifacts`, 2026-09-03); the other 118 name what each contact *connects to* --
	// `effect`, `bypass`, `rectifier_output`, `bplus_reservoir` -- which says nothing about which
	// contact is the pole. Those keep the name path and then the positional one, and
	// `switchPoleUnreadable` names it rather than leaving it silent.
	//
	// A declared `pin` is not a contact of the mechanism, which is what fixed eight amps' mains
	// switches: a switch-and-fuse shell declares `line, switched_fused_line, neutral`, and with
	// `line` as the pole by position `neutral` became a *second throw of it* -- connecting live
	// to neutral at the other control position.
	const declared = device.identity.declaredTerminalRoles;
	const usesDeclared = declared.some((role) => role !== null);
	const roles = device.identity.terminalRoles;
	// **A `coil` is excluded by its declaration or not at all.** A seven-name table of coil
	// spellings used to sit on the second branch; emptying it moved no corpus program and
	// changed no diagnostic, and a relay whose coil matters declares `coil` -- which core has in
	// the switch vocabulary and the first branch already reads.
	const isContact = (index: number): boolean =>
		usesDeclared
			? declared[index] === "common" || declared[index] === "throw"
			: true;
	const contactIndices = device.nodes
		.map((_, index) => index)
		.filter((index) => isContact(index));

	const contactNodes = contactIndices.map((i) => device.nodes[i] as number);
	const contactRoles = contactIndices.map((i) => roles[i]);
	const contactDeclared = contactIndices.map((i) => declared[i]);

	const commonIndices = contactNodes
		.map((_, index) => index)
		// **A pole is named by its declaration or by nothing.** `switchCommonRoles` -- twelve
		// spellings of "this is the pole" -- is gone: all 126 corpus switches whose terminal
		// names stated a pole now declare `common`, and no undeclared switch carries a name that
		// would have matched. A switch declaring nothing falls to its first contact exactly as
		// before, and `switchPoleUnreadable` reports that whenever there are three or more.
		.filter((index) => contactDeclared[index] === "common");

	// No terminal names itself common, so the first is it -- which is what the shapes
	// spelling it `input` or `lug14` mean, and all a document of bare lugs can support.
	if (commonIndices.length === 0) {
		const [common, ...throws] = contactNodes;
		return common === undefined || throws.length === 0
			? []
			: [{ common, throws }];
	}

	// One common: every other terminal is a throw of it, **wherever it sits in the
	// list**. `throw0,throw1,common` is a real corpus shape, and attaching throws to a
	// preceding common instead would drop the only real one -- which silently left the
	// input jack's node connected to nothing at all.
	if (commonIndices.length === 1) {
		const at = commonIndices[0] as number;
		const common = contactNodes[at] as number;
		const throws = contactNodes.filter((_, index) => index !== at);
		return throws.length === 0 ? [] : [{ common, throws }];
	}

	// Several poles of one mechanism. Each common takes the terminals that follow it;
	// anything declared before the first common belongs to that first pole.
	const poles = commonIndices.map((at) => ({
		common: contactNodes[at] as number,
		throws: [] as number[],
	}));
	contactNodes.forEach((node, index) => {
		if (commonIndices.includes(index)) {
			return;
		}
		const owner = commonIndices.filter((at) => at < index).length;
		poles[Math.max(0, owner - 1)]?.throws.push(node);
	});
	return poles.filter((pole) => pole.throws.length > 0);
}

/**
 * A diode's anode and cathode, by role where the document names them.
 *
 * Falls back to declaration order for `a,b` and bare lugs, which carry no orientation
 * evidence and are all such a document supports.
 */
function diodeTerminals(device: Device): readonly [number, number] {
	// The declared role, not the terminal name. A document whose ends are `end`/`end` -- core's
	// role for two interchangeable ends -- states no orientation, so it falls through to
	// declaration order exactly as an unnamed pair does.
	const roles = device.identity.declaredTerminalRoles;
	const anodeIndex = roles.indexOf("anode");
	const cathodeIndex = roles.indexOf("cathode");
	if (anodeIndex !== -1 && cathodeIndex !== -1) {
		const anode = device.nodes[anodeIndex];
		const cathode = device.nodes[cathodeIndex];
		if (anode !== undefined && cathode !== undefined) {
			return [anode, cathode];
		}
	}
	return terminalPair(device);
}

/**
 * The junctions a diode component contains: one for a plain diode, four for a bridge, one per
 * anode for a shared-cathode pack.
 *
 * **The old reading took the first two terminals and dropped the rest, without a word.** A bridge
 * rectifier declared `[ac_a, ac_b, positive, negative]` has no `anode` role, so it fell through to
 * declaration order and lowered to a single junction **between its two AC inputs** — a diode across
 * the source, with both DC terminals left touching nothing. That is not an approximation of a
 * bridge, it is a different circuit: the rail it was supposed to produce does not exist. Same shape
 * as the transformer's positional reading, which was silently wrong on 45 of 55.
 *
 * Two topologies are recognised, and both are decided by whole role tokens against
 * `diodeTerminalRoles`, never by position:
 *
 * - **A bridge**: two AC legs, one DC positive and one DC negative. Each AC leg gets a junction up
 *   to `positive` and one from `negative`, which is the four-diode bridge exactly — on either half
 *   cycle the more positive AC leg conducts into `positive` and `negative` conducts into the other.
 * - **A shared-cathode pack**: one or more anodes and exactly one cathode. One junction per anode.
 *   A dual rectifier and a bi-colour LED are both this, which is why the rule is the shape rather
 *   than the part.
 *
 * **What this fixes is topology, not device law.** Eight of the amp corpus's multi-junction
 * `diode` components are *tube* rectifiers — a 5U4GB, four GZ34s, two 5Y3s and a dual 5U4 — spelled
 * `plate_a`/`cathode`/`heater_a` under `kind: diode`. They now lower to the right number of
 * junctions in the right direction, and each junction keeps the **silicon** law the declared kind
 * asks for: a 0.7 V drop where a 5Y3 drops 40-60 V under load. Reading a vacuum law out of a
 * terminal name would be deciding a device's physics from a token, which is precisely what this
 * pipeline forbids — the kind is the evidence for the law, and the roles are evidence only for the
 * wiring. That mismatch is a **source** question (the format has a `tube-diode` kind and three
 * instances use it) and it stays unfiled: no document compiles far enough for a diagnostic to name
 * it, and the evidence gate requires one.
 */
function diodeJunctions(
	device: Device,
): readonly { readonly anode: number; readonly cathode: number }[] {
	// Two terminals keep the original reading exactly, including its positional fallback for a
	// document of bare lugs. Every diode in every compiled packet takes this path, which is what
	// makes the change corpus-neutral by construction rather than by hope.
	if (device.nodes.length === 2) {
		const [anode, cathode] = diodeTerminals(device);
		return [{ anode, cathode }];
	}

	const anodes: number[] = [];
	const acLegs: number[] = [];
	let cathode: number | null = null;
	let dcPositive: number | null = null;
	let dcNegative: number | null = null;
	const single = (
		held: number | null,
		node: number,
		electrode: string,
	): number => {
		if (held !== null) {
			throw new LoweringError(
				`diode ${device.id} names two ${electrode} terminals, so it is more than one device in one component`,
				device.id,
			);
		}
		return node;
	};
	// Reads each terminal's declared `role`, which replaced a ~30-entry spelling table. `ac` is
	// the role a bridge's alternating leg declares (`@vessel-dsp/core@0.6.33`): it is neither an
	// anode nor a cathode, because on one half cycle it conducts into the positive rail and on
	// the other the negative rail conducts into it.
	device.identity.declaredTerminalRoles.forEach((role, index) => {
		const node = device.nodes[index];
		if (node === undefined) {
			return;
		}
		if (role === null) {
			throw new LoweringError(
				`diode ${device.id} has a terminal that declares no role, and a junction's direction cannot be read from terminal order once there are more than two`,
				device.id,
			);
		}
		switch (role) {
			// A plate is an anode: eight corpus tube rectifiers declare `kind: diode`, and this
			// stage places their junctions while the declared kind still chooses the law.
			case "anode":
			case "plate":
				anodes.push(node);
				return;
			case "ac":
				acLegs.push(node);
				return;
			case "cathode":
				cathode = single(cathode, node, "cathode");
				return;
			case "positive":
				dcPositive = single(dcPositive, node, "DC positive");
				return;
			case "negative":
				dcNegative = single(dcNegative, node, "DC negative");
				return;
			// A heater carries no signal current, and an `end` states no orientation to place.
			case "heater":
			case "end":
				return;
			default:
				throw new LoweringError(
					`diode ${device.id}: terminal declares role "${role}", which is not an electrode a multi-junction diode has`,
					device.id,
				);
		}
	});

	const positive = dcPositive as number | null;
	const negative = dcNegative as number | null;
	const shared = cathode as number | null;
	if (acLegs.length === 2 && positive !== null && negative !== null) {
		if (anodes.length > 0 || shared !== null) {
			throw new LoweringError(
				`diode ${device.id} names both a bridge's AC and DC legs and a separate anode or cathode, which is two topologies at once`,
				device.id,
			);
		}
		return acLegs.flatMap((leg) => [
			{ anode: leg, cathode: positive },
			{ anode: negative, cathode: leg },
		]);
	}
	if (acLegs.length === 0 && shared !== null && anodes.length > 0) {
		return anodes.map((anode) => ({ anode, cathode: shared }));
	}
	throw new LoweringError(
		`diode ${device.id} declares ${device.nodes.length} terminals in no topology this stage can place: ` +
			"a bridge needs two AC legs with a DC positive and negative, and a diode pack needs one cathode with at least one anode",
		device.id,
	);
}

/**
 * The two ends of a supply, as the corpus names them. Counted, not guessed: `positive`
 * 47, `negative` 46, `neutral` 17, `hot` 16, `anode`/`cathode` 4 each, `+` 3, `line` 2,
 * `return` 1. `hot`/`neutral` and `line`/`neutral` are mains pairs in the amp packets.
 * `plus`/`minus` are absent from the corpus but are unambiguous polarity names a
 * hand-authored document may use, and they are what the fixtures here declare.
 */

/**
 * A supply's driven end and its return, by role where the document names them.
 *
 * This was the last asymmetric device still read by declaration order, and it fails the
 * same way the diode and the op-amp did: reversing `positive` and `minus` inverts a rail
 * and the packet still compiles `ok`. A rail is not a subtle wrong answer -- every bias
 * point in the circuit hangs off its sign.
 *
 * **Read from the declared role since 2026-09-03**, and the fallback is now taken only when the
 * source *says* the two ends are symmetric rather than when it says nothing. `ac_a`/`ac_b` and
 * `heater_a`/`heater_b` are the two ends of a winding modelled as a source: they declare
 * `end`/`end`, which states that there is no polarity to read, and declaration order is then all
 * such a document supports. That is a different fact from a supply whose terminals declare
 * nothing, and matching folded *names* could not tell the two apart -- `'-'` folded away to no
 * role at all and landed in the same bucket as a bare lug.
 *
 * Measured across the corpus after the backfill: 72 supplies declare exactly one `positive` and
 * one `negative`, 2 declare `end`/`end`, 1 has a single terminal, and none declares nothing.
 */
function supplyTerminals(device: Device): readonly [number, number] {
	// A rail names one node and means "against ground", which is not a polarity question:
	// there is only one end to place. Reading roles here would refuse 34 packets for
	// wanting a terminal a rail never has.
	const single = device.nodes[0];
	if (device.nodes.length === 1 && single !== undefined) {
		return [single, GROUND];
	}
	const roles = device.identity.declaredTerminalRoles;
	const driveIndex = roles.findIndex((role) => role === "positive");
	const returnIndex = roles.findIndex((role) => role === "negative");
	// One end named is enough: the other is the remaining terminal. Requiring both would
	// discard the evidence in a supply declaring `positive` beside an unlabelled lug.
	const resolved =
		driveIndex !== -1 && driveIndex !== returnIndex
			? ([
					driveIndex,
					returnIndex === -1 ? 1 - driveIndex : returnIndex,
				] as const)
			: returnIndex !== -1
				? ([1 - returnIndex, returnIndex] as const)
				: null;
	if (resolved !== null) {
		const positive = device.nodes[resolved[0]];
		const negative = device.nodes[resolved[1]];
		if (positive !== undefined && negative !== undefined) {
			return [positive, negative];
		}
	}
	return terminalPair(device);
}

/**
 * Slots a reactive element's companion model needs: the voltage across it and the current
 * through it, which is what a trapezoidal companion carries between samples.
 *
 * The program declares state in slots and each stamp declares the offset its own state
 * begins at, so both are the same unit and no executor has to know a hidden convention.
 */
export const STATE_SLOTS_PER_REACTIVE_ELEMENT = 2;

/**
 * The one terminal index whose **declared** role is `role`, or null when none or several are.
 *
 * This replaced seven name-vocabulary sets: `triodeGridRoles`, `triodeCathodeRoles`,
 * `triodePlateRoles`, `pentodeScreenRoles`, and the transistor control/upper/lower channel
 * triple. All seven existed to recover an electrode from a terminal's *name*, which is a
 * spelling problem the format no longer has -- `@vessel-dsp/core@0.6.28` gives every terminal a
 * typed `role`, so the electrode is read rather than inferred. There is nothing to fold, alias,
 * or guess, and `c` no longer has to mean a collector on one kind and a cathode on another.
 *
 * **Ambiguity is still null rather than the first match**, for the reason `uniqueRoleIndex`
 * records: two terminals declaring `plate` is correct on a dual rectifier and wrong on a triode,
 * and which it is belongs to the caller. A resolver asking for one plate gets null;
 * `tubeDiodePlates` asks for all of them.
 */
function declaredIndex(device: Device, role: string): number | null {
	const found = device.identity.declaredTerminalRoles.flatMap((declared, index) =>
		declared === role ? [index] : [],
	);
	return found.length === 1 ? (found[0] ?? null) : null;
}

/**
 * Indices for `roles` in order, or null when any one is unresolved.
 *
 * All-or-nothing for the reason `roleIndices` gives: every caller treats a partial read as no
 * read, because a tube with a plate but no identifiable cathode cannot be stamped from the half
 * that resolved.
 */
function declaredIndices(
	device: Device,
	roles: readonly string[],
): readonly number[] | null {
	const indices = roles.map((role) => declaredIndex(device, role));
	return indices.every((index) => index !== null)
		? (indices as readonly number[])
		: null;
}

/**
 * The one terminal index whose declared role is in `accepted`, or `null` when none is or
 * more than one is.
 *
 * **Ambiguity is `null` rather than the first match.** Two terminals both claiming `plate`
 * is a source defect, and choosing between them would wire the device from a coin toss —
 * so the callers that can refuse do, and the callers that fall back to declaration order
 * fall back wholesale rather than half-resolved.
 *
 * `fold` exists because the optocoupler's copy of this read carried `foldToken` where the
 * other four compared the role as given. That divergence is the reason this is one function:
 * the five copies were not identical, and nothing would have reported it.
 */
function uniqueRoleIndex(
	roles: readonly (string | null)[],
	accepted: ReadonlySet<string>,
	fold: (role: string) => string = (role) => role,
): number | null {
	const found = roles.flatMap((role, index) =>
		role !== null && accepted.has(fold(role)) ? [index] : [],
	);
	return found.length === 1 ? (found[0] ?? null) : null;
}

/**
 * Terminal indices for `slots` in order, or `null` when any one of them is unresolved.
 *
 * All-or-nothing because every caller treats a partial read as no read: a tube with a plate
 * but no identifiable cathode cannot be stamped from the half that resolved.
 *
 * Returns **indices, not nodes**, so each caller keeps its own missing-node refusal. Those
 * are not interchangeable — a pentode that named an electrode it has no terminal for and a
 * BJT missing a third node are different source defects and say so.
 */
function roleIndices(
	roles: readonly (string | null)[],
	slots: readonly ReadonlySet<string>[],
	fold?: (role: string) => string,
): readonly number[] | null {
	const indices = slots.map((slot) => uniqueRoleIndex(roles, slot, fold));
	return indices.every((index) => index !== null)
		? (indices as readonly number[])
		: null;
}

/**
 * A pentode's `(grid, cathode, plate, screen)`, by role, refusing rather than guessing.
 *
 * A `suppressor` and a `heater` terminal are read and ignored on purpose: a suppressor is tied
 * to the cathode in practice, and a heater carries no signal current. Their nodes end up
 * carrying only `gmin`, which is the same situation a FET gate is already in.
 *
 * The two ganged documents in the corpus (`grid_a,grid_b,...` and `plates_a,plates_b,...`) name
 * **two** pentodes in one component, so `only` finds two grids and refuses. That is the right
 * answer: this law is one tube, and silently taking the first of each would model half the
 * device and render.
 */
function pentodeTerminals(
	device: Device,
): readonly [number, number, number, number] {
	const indices = declaredIndices(device, ["grid", "cathode", "plate", "screen"]);
	if (indices === null) {
		throw new LoweringError(
			`pentode ${device.id} does not name a single grid, cathode, plate and screen among its terminals`,
			device.id,
		);
	}
	const nodes = indices.map((index) => device.nodes[index]);
	if (nodes.some((node) => node === undefined)) {
		throw new LoweringError(
			`pentode ${device.id} names an electrode it has no terminal for`,
			device.id,
		);
	}
	return nodes as [number, number, number, number];
}

/**
 * A triode's `(grid, cathode, plate)`, by role.
 *
 * Deliberately **not** falling back to declaration order the way the BJT does. A BJT's
 * positional fallback is defensible because its three terminals appear in a conventional
 * order across the corpus; a tube's do not, and swapping plate for cathode turns a gain
 * stage into a cathode follower that still renders. A triode whose roles cannot be read is
 * a missing source fact, so this refuses rather than guessing.
 */
function triodeTerminals(device: Device): readonly [number, number, number] {
	const indices = declaredIndices(device, ["grid", "cathode", "plate"]);
	if (indices === null) {
		throw new LoweringError(
			`triode ${device.id} does not name a single grid, cathode and plate among its terminals`,
			device.id,
		);
	}
	const nodes = indices.map((index) => device.nodes[index]);
	if (nodes.some((node) => node === undefined)) {
		throw new LoweringError(
			`triode ${device.id} needs three terminals`,
			device.id,
		);
	}
	return nodes as [number, number, number];
}

/**
 * A tube diode's plates, each paired with the shared cathode.
 *
 * Refuses rather than falling back to declaration order, for the triode's reason: a rectifier
 * wired backwards conducts on the wrong half-cycle and still renders, and the corpus does not
 * declare these terminals in a settled order.
 */
function tubeDiodePlates(
	device: Device,
): readonly { readonly plate: number; readonly cathode: number }[] {
	const plates: number[] = [];
	let cathode: number | null = null;
	// Reads the declared role, so `plate_a` and `plate_b` are two terminals carrying one role
	// rather than two spellings to look up. This is the case the `devices` construct exists for:
	// a dual rectifier is two diodes on one cathode, and until a document declares that split,
	// pairing every plate with the shared cathode is the same answer.
	device.identity.declaredTerminalRoles.forEach((role, index) => {
		const node = device.nodes[index];
		if (node === undefined) {
			return;
		}
		if (role === null) {
			throw new LoweringError(
				`tube diode ${device.id} has a terminal that declares no role, and a rectifier's plate cannot be told from its cathode by position`,
				device.id,
			);
		}
		if (role === "plate") {
			plates.push(node);
			return;
		}
		if (role === "cathode") {
			if (cathode !== null) {
				throw new LoweringError(
					`tube diode ${device.id} names two cathodes, so it is two devices in one component`,
					device.id,
				);
			}
			cathode = node;
			return;
		}
		// A heater carries no signal current, so it is read and ignored, as it always was. Any
		// other role is a device this law is not: refuse by name rather than place it.
		if (role !== "heater") {
			throw new LoweringError(
				`tube diode ${device.id}: terminal declares role "${role}", which is not an electrode a tube rectifier has`,
				device.id,
			);
		}
	});
	if (cathode === null || plates.length === 0) {
		throw new LoweringError(
			`tube diode ${device.id} does not name a cathode and at least one plate among its terminals`,
			device.id,
		);
	}
	const shared = cathode as number;
	return plates.map((plate) => ({ plate, cathode: shared }));
}

function bjtTerminals(device: Device): readonly [number, number, number] {
	// Read the roles, because **449 of the corpus's 490 transistors do not put the
	// control terminal first**. `collector,base,emitter` alone is 282 of them, and
	// taking position 1 as the base exchanges base and collector on nearly every
	// transistor there is: the stage never turns on and the pedal renders silence.
	const indices = declaredIndices(device, ["base", "collector", "emitter"]) ??
		declaredIndices(device, ["gate", "drain", "source"]);

	// Unlabelled or ambiguous roles keep declaration order, which is all a document of
	// bare positional pins supports.
	const [control, upper, lower] =
		indices === null
			? device.nodes
			: indices.map((index) => device.nodes[index]);
	if (control === undefined || upper === undefined || lower === undefined) {
		throw new LoweringError(
			`bjt ${device.id} needs base, collector and emitter`,
			device.id,
		);
	}
	return [control, upper, lower];
}


/**
 * An op-amp's `(+in, -in, out)` from its **declared** roles, refusing rather than guessing.
 *
 * Order settles nothing: the corpus writes `inverting,nonInverting,output`,
 * `positive,out,negative` and `negative,positive,out`, so taking position exchanges the two
 * inputs and inverts the stage -- a wrong answer that still renders and is audible only by
 * comparison.
 *
 * This read the folded terminal *name* against three closed sets and fell back to declaration
 * order when they did not resolve, which is the silent half of the role-vocabulary problem: a
 * document naming its pins anything outside those sets got positions 0, 1 and 2 and nothing said
 * so. Measured after the roles were backfilled: 314 of 315 corpus op-amps declare exactly one of
 * each, and none declares no role, so the positional path had no legitimate case left.
 *
 * **Several of each is a package, not an ambiguity.** `boss-dm-3`'s `IC1` declares eight terminals
 * and two of every signal role, because it is a dual op-amp whose sections
 * `@vessel-dsp/core@0.6.33`'s `devices` construct exists to separate. Until that is declared this
 * refuses too, naming the construct, rather than picking a section by position.
 */
function opampTerminals(device: Device): readonly [number, number, number] {
	const declared = device.identity.declaredTerminalRoles;
	const indices = (["nonInverting", "inverting", "output"] as const).map((role) => {
		const found = declared.flatMap((value, index) =>
			value === role ? [index] : [],
		);
		return found.length === 1 ? (found[0] as number) : null;
	});
	if (indices.some((index) => index === null)) {
		const counts = (["nonInverting", "inverting", "output"] as const)
			.map((role) => `${role}=${declared.filter((value) => value === role).length}`)
			.join(" ");
		throw new LoweringError(
			`op-amp ${device.id} does not identify one non-inverting input, one inverting input ` +
				`and one output (${counts}) -- several of each is a package whose sections a ` +
				"`devices` declaration has to separate, and taking terminals by position instead " +
				"exchanges the inputs and inverts the stage",
			device.id,
		);
	}
	const [plus, minus, output] = indices.map(
		(index) => device.nodes[index as number],
	);
	if (plus === undefined || minus === undefined || output === undefined) {
		throw new LoweringError(
			`op-amp ${device.id} needs three terminals`,
			device.id,
		);
	}
	return [plus, minus, output];
}

/**
 * Optocoupler terminals by role where present, with a strict 3-terminal fallback.
 *
 * Some source packets encode a tremolo cell as `kind: switch` with
 * `lampdrive`/`ldrsignal`/`ldrreturn` only. For that exact shape, the LED return is
 * implicit ground and the LDR side is explicit. Every other shape keeps the existing
 * four-terminal requirement.
 */
type OptocouplerNodes = {
	readonly ledAnode: number;
	readonly ledCathode: number;
	readonly ldrA: number;
	readonly ldrB: number;
};

/**
 * An optocoupler's four connections from the terminals' **declared roles**.
 *
 * Core's vocabulary for the kind is `anode`, `cathode`, `end`, `pin`: the LED states a direction
 * and the cell states none, which is the physics -- a photoresistor conducts the same either way,
 * so its two `end` terminals are taken in declaration order and that is a reading rather than a
 * guess. A three-terminal part is the common tremolo package, whose LED cathode is the chassis:
 * one `anode` and two `end`s, with the return implied.
 */
function declaredOptocouplerNodes(device: Device): OptocouplerNodes | null {
	const declared = device.identity.declaredTerminalRoles;
	const at = (role: string): number | null => {
		const found = declared.reduce<number[]>(
			(acc, value, index) => (value === role ? [...acc, index] : acc),
			[],
		);
		return found.length === 1 ? (found[0] ?? null) : null;
	};
	const ends = declared.flatMap((role, index) => (role === "end" ? [index] : []));
	const anodeIndex = at("anode");
	if (anodeIndex === null || ends.length !== 2) {
		return null;
	}
	const cathodeIndex = at("cathode");
	const ledAnode = device.nodes[anodeIndex];
	const ldrA = device.nodes[ends[0] ?? -1];
	const ldrB = device.nodes[ends[1] ?? -1];
	const ledCathode =
		cathodeIndex === null ? GROUND : device.nodes[cathodeIndex];
	if (
		ledAnode === undefined ||
		ledCathode === undefined ||
		ldrA === undefined ||
		ldrB === undefined
	) {
		return null;
	}
	return { ledAnode, ledCathode, ldrA, ldrB };
}

/**
 * The same four connections from the terminals' **names**, which is the older path and one of the
 * last two name vocabularies in this compiler. It stays until the four corpus optocouplers that
 * depend on it declare roles instead; `optocouplerBinding` is what reports them.
 */
function namedOptocouplerNodes(device: Device): OptocouplerNodes | null {
	const roles = device.identity.terminalRoles;
	// Folded, unlike the four resolvers above, which compare the role as given.
	const only = (accepted: ReadonlySet<string>): number | null =>
		uniqueRoleIndex(roles, accepted, foldToken);

	const lampDriveIndex = only(new Set(["lampdrive"]));
	const ldrSignalIndex = only(new Set(["ldrsignal", "ldra"]));
	const ldrReturnIndex = only(new Set(["ldrreturn", "ldrb"]));
	if (
		lampDriveIndex !== null &&
		ldrSignalIndex !== null &&
		ldrReturnIndex !== null &&
		device.nodes.length === 3
	) {
		const ledAnode = device.nodes[lampDriveIndex];
		const ldrA = device.nodes[ldrSignalIndex];
		const ldrB = device.nodes[ldrReturnIndex];
		if (ledAnode !== undefined && ldrA !== undefined && ldrB !== undefined) {
			return { ledAnode, ledCathode: GROUND, ldrA, ldrB };
		}
	}

	const anodeIndex = only(new Set(["anode", "ledanode", "lampdrive"]));
	const cathodeIndex = only(new Set(["cathode", "ledcathode", "lampreturn"]));
	const ldrAIndex = only(new Set(["ldra", "ldrsignal"]));
	const ldrBIndex = only(new Set(["ldrb", "ldrreturn"]));
	if (
		anodeIndex !== null &&
		cathodeIndex !== null &&
		ldrAIndex !== null &&
		ldrBIndex !== null
	) {
		const ledAnode = device.nodes[anodeIndex];
		const ledCathode = device.nodes[cathodeIndex];
		const ldrA = device.nodes[ldrAIndex];
		const ldrB = device.nodes[ldrBIndex];
		if (
			ledAnode !== undefined &&
			ledCathode !== undefined &&
			ldrA !== undefined &&
			ldrB !== undefined
		) {
			return { ledAnode, ledCathode, ldrA, ldrB };
		}
	}
	return null;
}

/**
 * Which rung decided an optocoupler's wiring, so a warning can name the devices that reached the
 * weaker ones without restating either test.
 *
 * The alternative -- a predicate in the warning module that mirrors this vocabulary -- is how a
 * silent switch mis-wiring was introduced in this compiler once already: the mirror drifted from
 * the resolver and the warning went quiet about the case it existed for.
 */
export function optocouplerBinding(
	device: Device,
): "declared" | "named" | "declaration-order" {
	if (declaredOptocouplerNodes(device) !== null) {
		return "declared";
	}
	return namedOptocouplerNodes(device) !== null ? "named" : "declaration-order";
}

/**
 * A logic gate's four connections, by declared role where the document states them.
 *
 * **The order used to be the whole binding.** `nodes[0..3]` was input, output, vdd, gnd, which is
 * right for a registry `sections` entry written against that order and is nothing at all for a
 * package that declares its own gates: a `devices:` list states which terminals a gate uses, not
 * which slot each fills, and its docstring says so -- "order carries no meaning; a law binds by
 * role". `@vessel-dsp/core@0.6.39` gives a gate `input` and `output` to bind by.
 *
 * The positional fallback stays for every document that predates the kind, and `vdd`/`gnd` stay
 * optional because the single-ended `vccs` branch below models a gate whose supplies the document
 * does not give.
 */
function inverterTerminals(device: Device): {
	readonly input: number | undefined;
	readonly output: number | undefined;
	readonly vdd: number | undefined;
	readonly gnd: number | undefined;
} {
	const declared = device.identity.declaredTerminalRoles;
	const only = (role: string): number | undefined => {
		const found = declared.flatMap((value, index) =>
			value === role ? [index] : [],
		);
		return found.length === 1 ? device.nodes[found[0] as number] : undefined;
	};
	const input = only("input");
	const output = only("output");
	if (input !== undefined && output !== undefined) {
		return {
			input,
			output,
			vdd: only("supplyPositive"),
			gnd: only("supplyNegative"),
		};
	}
	return {
		input: device.nodes[0],
		output: device.nodes[1],
		vdd: device.nodes.length >= 4 ? device.nodes[2] : undefined,
		gnd: device.nodes.length >= 4 ? device.nodes[3] : undefined,
	};
}

function optocouplerTerminals(device: Device): OptocouplerNodes {
	const resolved =
		declaredOptocouplerNodes(device) ?? namedOptocouplerNodes(device);
	if (resolved !== null) {
		return resolved;
	}

	const ledAnode = device.nodes[0];
	const ledCathode = device.nodes[1];
	const ldrA = device.nodes[2];
	const ldrB = device.nodes[3];
	if (
		ledAnode === undefined ||
		ledCathode === undefined ||
		ldrA === undefined ||
		ldrB === undefined
	) {
		throw new LoweringError(
			`optocoupler ${device.id} requires 4 terminals: anode, cathode, ldrA, ldrB`,
			device.id,
		);
	}
	return { ledAnode, ledCathode, ldrA, ldrB };
}
