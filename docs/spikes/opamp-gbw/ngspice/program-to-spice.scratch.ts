// A compiled program -> an ngspice deck.
//
// This exists so the pipeline stops grading its own homework. Rendering through
// `reference-runtime.ts` proves that our executor and our program agree with each
// other, which is worth something and is *not* evidence that either is right: a stamp
// with the wrong nodes renders happily, and a solver that limit-cycles reports a
// number. ngspice is neither of ours, so agreement with it is the first independent
// statement that a compiled pedal is the circuit the packet describes.
//
// The deck is emitted from the **program**, never from the `.vdsp`. Emitting from the
// source would test the packet and let every compiler defect through untouched; going
// through the stamps means a wrong node, a dropped throw or a missing supply shows up
// as disagreement.
//
// Controls are resolved to their default positions here, because a deck is one
// operating point. That is the same reduction the runtime performs per sample, applied
// once.

import type { Block, Program, Stamp } from "@vessel-dsp/compiler";
import { taperFraction } from "@vessel-dsp/runtime";
import { pwlVoltageSource } from "./wav";

// SCRATCH COPY of workbench/scripts/lib/program-to-spice.ts (read-only original, 2026-10-10). One change: the pole capacitor reads the
// stamp's gainBandwidthHz, with the 1e6 default for a null stamp, exactly as both consoles do. DECK_GBP=default restores the old
// behaviour (1e6 for every op-amp) so the "only one side changes" control can be run from the same file.
const DECK_GBP_MODE = process.env.DECK_GBP ?? "stamp";

/**
 * The runtime's `ZENER_TEST_CURRENT_AMPS`, re-stated rather than imported: both consoles read a
 * declared breakdown voltage as holding at 5 mA, and a bare `BV=` has ngspice hold it at its
 * 1 mA `IBV` default instead.
 */
const ZENER_TEST_CURRENT_AMPS = 5e-3;
/**
 * Retained for nothing but symmetry with the runtime's fallback; every emitted op-amp now takes its
 * gain from the stamp, so the deck cannot model a different amplifier from the program.
 */
const OPAMP_OPEN_LOOP_GAIN = 1e5;
/**
 * The op-amp's gain-bandwidth product, in hertz, for the dominant pole. A class default rather
 * than a part fact: the source's per-packet GBP is not read (see `netlist.ts`), so every op-amp
 * gets the same pole. The pole node's `Rpole` and `Cpole` are set from it so the open-loop pole
 * sits at `GBP / gain`, 10 Hz at the class defaults -- matching the runtime's `opAmpPoleAlpha`.
 */
const OPAMP_GAIN_BANDWIDTH_HZ = 1e6;
/**
 * The pole node's resistance to ground. A scale, not a fact: `gm = gain / Rpole` and
 * `Cpole = gain / (2*pi*GBP*Rpole)`, so the node's DC gain is `gm*Rpole = gain` and its pole is
 * `1/(2*pi*Rpole*Cpole) = GBP / gain` -- `Rpole` cancels out of both, so any value works and
 * `1e6` keeps `gm` and `Cpole` in comfortable ranges.
 */
const OPAMP_POLE_OHMS = 1e6;
/**
 * How finely the op-amp's saturation is sampled into ngspice's `TABLE`, as a half-count of points
 * and a span in half-swing units of the pole node's voltage. The TABLE maps the node's voltage to
 * the output as `centre + halfSwing*tanh(v/halfSwing)`, whose steepest slope is 1 -- not the
 * open-loop gain -- so ngspice steps through it without collapsing its timestep. `tanh` is within
 * 1e-7 of its asymptote by four half-swings, so the span only has to cover the knee; the point
 * count is what keeps the piecewise-linear error small enough to read as the runtime's exact
 * `tanh`.
 */
const OPAMP_TABLE_HALF_POINTS = 12;
const OPAMP_TABLE_SPAN = 4;
/**
 * Anti-windup for the pole node, matching the runtime's `boundOpAmpRaw`. A real op-amp's
 * compensation node cannot exceed its supply; without this clamp a sustained saturated
 * differential winds the raw open-loop output to thousands of volts over the deck, where the
 * runtime's `tanh` flatlined at the rail but the deck's TABLE reads inside its asymptote and
 * reports a live-looking level (the 18 signal-independent dead rows, 2026-08-21).
 *
 * Must match the runtime's bound or parity degrades: runtime-only measured 36/10 and
 * deck-only 36/11 against the matched 40/6 (2026-08-21), and the runtime's comment
 * now (2026-09-14) reads the matched pair as the shipped state. The band is intentionally
 * inside the TABLE span so the clamp only ever coerces the windup region, never the knee.
 */
const OPAMP_POLE_BAND = 8;
const OPAMP_POLE_CLAMP_SIEMENS = 1e3;

export type SpiceDeck = {
	readonly text: string;
	/** The node whose voltage the deck prints, in ngspice's naming. */
	readonly outputNode: string;
	/** Stamp kinds the emitter cannot express, so a caller can refuse rather than guess. */
	readonly unsupported: readonly string[];
};


/**
 * Emit a transient deck driving the program's input port with a sine.
 *
 * `null` when the program has no MNA block to drive, which a macro-only program is.
 */
export function programToSpiceDeck(
	program: Program,
	options: {
		readonly hz: number;
		readonly amplitude: number;
		readonly seconds: number;
		readonly stepSeconds: number;
		/** Where ngspice writes the trace; reading stdout mixes in its banner. */
		readonly dataPath: string;
		readonly inputSamples?: Readonly<Float64Array> | readonly number[];
		readonly inputSampleRate?: number;
	},
): SpiceDeck | null {
	const block = program.blocks.find(
		(candidate): candidate is Extract<Block, { kind: "mna" }> =>
			candidate.kind === "mna" && candidate.outputNode !== null,
	);
	if (block === undefined) {
		return null;
	}

	/**
	 * Deck nodes are named for the **source** net, not the block's row index.
	 *
	 * A block's rows are numbered 0..nodeCount-1 independently of the ids the document
	 * authored (see `Block.nodeIds`), and `source-to-spice.ts` -- the independent deck
	 * `report-compiler-parity-from-source.ts` grades against -- names its nodes for the
	 * source ids. Naming rows here would put the two decks in different namespaces, and the
	 * failure would not look like a failure: each deck is internally consistent, so both
	 * still run, still produce a trace, and still get compared -- just at two different
	 * nodes, reporting agreement or disagreement about a question nobody asked. Going
	 * through `nodeIds` keeps one namespace, and has the side benefit that this emitter's
	 * decks are byte-identical to the ones it produced before rows were compacted.
	 */
	const nodeName = (row: number): string => {
		const source = block.nodeIds[row];
		if (source === undefined) {
			throw new Error(
				`block ${block.id} has no source node for row ${row}; nodeIds has ${block.nodeIds.length}`,
			);
		}
		return source === 0 ? "0" : `n${source}`;
	};

	const positions = new Map(
		program.controls.map((control) => [control.id, control.defaultPosition]),
	);
	const taperOf = new Map(
		program.controls.map((control) => [control.id, control.taper]),
	);
	const fractionOf = (control: string): number =>
		taperFraction(
			taperOf.get(control) ?? "linear",
			positions.get(control) ?? 0.5,
		);

	const lines: string[] = [`* compiled program ${block.id}`];
	const unsupported = new Set<string>();
	// One model card per distinct FET parameter set, because the threshold, beta and lambda
	// live on the stamp rather than in a shared law.
	const fetModelByKey = new Map<string, string>();
	const fetModelCards: string[] = [];
	// The same treatment for bipolars, and for the same reason: `IS`, `BF` and `BR` live on
	// the stamp, not in a shared law. Two hardcoded cards (`NMOD`/`PMOD` at silicon values)
	// used to serve every transistor in the deck, which was invisible while the compiler
	// stamped every transistor identically -- and became a real oracle defect the moment it
	// read the packets' declared parameters, because the deck kept giving a germanium OC41
	// silicon's `IS = 1e-14`.
	const bjtModelByKey = new Map<string, string>();
	const bjtModelCards: string[] = [];
	// One model card per diode parameter set so the deck reads the same junction law as the
	// runtime: IS/N and RS are per-stamp there, not one shared global default.
	const diodeModelByKey = new Map<string, string>();
	const diodeModelCards: string[] = [];
	let counter = 0;
	const next = (prefix: string): string => {
		counter += 1;
		return `${prefix}${counter}`;
	};

	// Every transformer in this block, so one can tell whether it shares a winding pair with
	// another -- the centre-tap case the emitter refuses rather than decomposes.
	const transformerStamps = (block.stamps as readonly Stamp[]).filter(
		(candidate): candidate is Extract<Stamp, { kind: "transformer" }> =>
			candidate.kind === "transformer",
	);

	type XfmrStamp = Extract<Stamp, { kind: "transformer" }>;
	const pairKey = (a: number, b: number): string => `${a}:${b}`;

	/**
	 * The stamps that describe one physical multi-winding transformer, or `null` for a plain
	 * two-winding one.
	 *
	 * Grouped by a node pair every stamp in the group shares -- the winding they all reference.
	 * Anything that is not that shape (three stamps with three different shared pairs, say) is not
	 * a centre tap this can reason about, so it stays `null` and takes the exact two-port path.
	 */
	const transformerGroupOf = (stamp: XfmrStamp): readonly XfmrStamp[] | null => {
		for (const [pa, pb, other] of [
			[stamp.primaryPlus, stamp.primaryMinus, "secondary"] as const,
			[stamp.secondaryPlus, stamp.secondaryMinus, "primary"] as const,
		]) {
			const group = transformerStamps.filter((candidate) =>
				pairKey(candidate.primaryPlus, candidate.primaryMinus) === pairKey(pa, pb) ||
				pairKey(candidate.secondaryPlus, candidate.secondaryMinus) === pairKey(pa, pb),
			);
			if (group.length > 1 && group[0] === stamp) {
				return group;
			}
			if (group.length > 1) {
				// A member, but not the one that emits the group.
				return group;
			}
			void other;
		}
		return null;
	};

	/** Emit one shared-winding transformer group with exact ideal constraints. */
	const emitExactSharedGroup = (group: readonly XfmrStamp[]): void => {
		const first = group[0] as XfmrStamp;
		// The winding pair shared by all stamps in the group.
		const primaryShared = group.every(
			(s2) =>
				pairKey(s2.primaryPlus, s2.primaryMinus) ===
				pairKey(first.primaryPlus, first.primaryMinus),
		);
		const hub: readonly [number, number] = primaryShared
			? [first.primaryPlus, first.primaryMinus]
			: [first.secondaryPlus, first.secondaryMinus];
		for (const stamp of group) {
			// For each spoke, sense its current and reflect it into the shared pair.
			// This avoids parallel controlled voltage sources across the same pair.
			const spoke: readonly [number, number] = primaryShared
				? [stamp.secondaryPlus, stamp.secondaryMinus]
				: [stamp.primaryPlus, stamp.primaryMinus];
			const n = primaryShared ? stamp.turnsRatio : 1 / stamp.turnsRatio;
			const tag = next("xg");
			const sense = `vs_${tag}`;
			const mid = `${tag}_m`;
			lines.push(`V${sense} ${nodeName(spoke[0])} ${mid} 0`);
			lines.push(
				`E${tag} ${mid} ${nodeName(spoke[1])} ${nodeName(hub[0])} ${nodeName(hub[1])} ${1 / n}`,
			);
			lines.push(
				`F${tag} ${nodeName(hub[1])} ${nodeName(hub[0])} V${sense} ${1 / n}`,
			);
		}
	};

	const emittedGroups = new Set<XfmrStamp>();

	for (const stamp of block.stamps as readonly Stamp[]) {
		switch (stamp.kind) {
			case "conductance":
				lines.push(
					`R${next("c")} ${nodeName(stamp.a)} ${nodeName(stamp.b)} ${1 / stamp.siemens}`,
				);
				break;
			case "capacitor":
				lines.push(
					`C${next("c")} ${nodeName(stamp.a)} ${nodeName(stamp.b)} ${stamp.farads}`,
				);
				break;
			case "inductor": {
				const tag = next("l");
				const mid = next("nl");
				lines.push(
					`L${tag} ${nodeName(stamp.a)} ${mid} ${stamp.henries}`,
					`R${tag} ${mid} ${nodeName(stamp.b)} 0.001`,
				);
				break;
			}
			case "diode": {
				const seriesResistance = stamp.seriesResistance ?? 0.05;
				const key = [
					stamp.saturationCurrent,
					stamp.emissionCoefficient,
					seriesResistance,
					stamp.breakdownVolts,
				].join(":");
				let model = diodeModelByKey.get(key);
				if (model === undefined) {
					model = `DMOD${diodeModelByKey.size + 1}`;
					diodeModelByKey.set(key, model);
					diodeModelCards.push(
						`.model ${model} D(IS=${stamp.saturationCurrent} N=${stamp.emissionCoefficient} RS=${seriesResistance}` +
							(stamp.breakdownVolts > 0
								? ` BV=${stamp.breakdownVolts} IBV=${ZENER_TEST_CURRENT_AMPS}`
								: "") +
							")",
					);
				}
				lines.push(
					`D${next("d")} ${nodeName(stamp.anode)} ${nodeName(stamp.cathode)} ${model}`,
				);
				break;
			}
			case "dc-source": {
				// ngspice's `V` element carries no series resistance, so a non-ideal supply needs
				// an internal node between the EMF and the circuit. The runtime needs no such
				// node -- its auxiliary row already holds the branch current -- so this is a
				// translation of the same element, not a second model.
				const index = next("v");
				if (stamp.sourceOhms <= 0) {
					lines.push(
						`V${index} ${nodeName(stamp.positive)} ${nodeName(stamp.negative)} DC ${stamp.volts}`,
					);
					break;
				}
				const internal = `nsrc${index}`;
				lines.push(
					`V${index} ${internal} ${nodeName(stamp.negative)} DC ${stamp.volts}`,
					`Rsrc${index} ${internal} ${nodeName(stamp.positive)} ${stamp.sourceOhms}`,
				);
				break;
			}
			case "ac-source": {
				// ngspice's own `SIN(vo va freq)`, with `vo = 0` because the stamp carries no
				// offset. The series resistance needs an internal node for the same reason the
				// DC supply does: a `V` element has none.
				//
				// Phase and delay are omitted rather than defaulted, which matches the stamp:
				// `SIN` with neither is `va * sin(2*pi*freq*t)` from `t = 0`, the runtime's
				// expression exactly. And ngspice's operating point for this element is its
				// `t = 0` value, measured on a fixture -- so both sides start from the same
				// discharged state.
				const index = next("vac");
				const wave = `SIN(0 ${stamp.amplitudeVolts} ${stamp.frequencyHz})`;
				if (stamp.sourceOhms <= 0) {
					lines.push(
						`V${index} ${nodeName(stamp.positive)} ${nodeName(stamp.negative)} ${wave}`,
					);
					break;
				}
				const internal = `nsrc${index}`;
				lines.push(
					`V${index} ${internal} ${nodeName(stamp.negative)} ${wave}`,
					`Rsrc${index} ${internal} ${nodeName(stamp.positive)} ${stamp.sourceOhms}`,
				);
				break;
			}
			case "input-source":
				if (options.inputSamples !== undefined) {
					if (options.inputSampleRate === undefined) {
						throw new Error("inputSampleRate is required with inputSamples");
					}
					lines.push(
						...pwlVoltageSource(
							"VIN",
							nodeName(stamp.node),
							options.inputSamples,
							options.inputSampleRate,
						),
					);
				} else {
					lines.push(
						`VIN ${nodeName(stamp.node)} 0 SIN(0 ${options.amplitude} ${options.hz})`,
					);
				}
				break;
			case "controlled-conductance": {
				// The runtime's share, evaluated once at the default position.
				const fraction = fractionOf(stamp.control);
				const share = stamp.side === "lower" ? fraction : 1 - fraction;
				const ohms = Math.max(stamp.totalOhms * share, 1e-3);
				lines.push(
					`R${next("p")} ${nodeName(stamp.a)} ${nodeName(stamp.b)} ${ohms}`,
				);
				break;
			}
			case "controlled-resistance": {
				const fraction = fractionOf(stamp.control);
				const ohms = Math.max(
					stamp.minOhms + fraction * (stamp.maxOhms - stamp.minOhms),
					1e-3,
				);
				lines.push(
					`R${next("r")} ${nodeName(stamp.a)} ${nodeName(stamp.b)} ${ohms}`,
				);
				break;
			}
			case "switch": {
				const position = positions.get(stamp.control) ?? 0;
				// The stamp's own resistances, as the runtime reads them. A latch-steering pair carries
				// 100 ohm / 1e8 and its complement 1e8 / 100; class constants here left both open at
				// position 0 and put the deck on the other side of the latch from the runtime.
				const ohms = position >= 0.5 ? stamp.onOhms : stamp.offOhms;
				lines.push(
					`R${next("s")} ${nodeName(stamp.a)} ${nodeName(stamp.b)} ${ohms}`,
				);
				break;
			}
			case "selector": {
				const position = positions.get(stamp.control) ?? 0;
				const selected = Math.min(
					stamp.throwCount - 1,
					Math.max(0, Math.floor(position * stamp.throwCount)),
				);
				const ohms =
					selected === stamp.throwIndex ? stamp.onOhms : stamp.offOhms;
				lines.push(
					`R${next("t")} ${nodeName(stamp.common)} ${nodeName(stamp.throwNode)} ${ohms}`,
				);
				break;
			}
			case "bjt": {
				const key = [
					stamp.polarity,
					stamp.saturationCurrent,
					stamp.forwardBeta,
					stamp.reverseBeta,
					stamp.leakageAmps,
				].join(":");
				let model = bjtModelByKey.get(key);
				if (model === undefined) {
					model = `QMOD${bjtModelByKey.size + 1}`;
					bjtModelByKey.set(key, model);
					// `ISC` is ngspice's base-collector leakage saturation current and `NC` its
					// emission coefficient. `NC` must be stated: ngspice defaults it to 2,
					// while the runtime's leakage shares the ideal junction's exponential, so
					// the deck would otherwise carry a different law from the program.
					const leakage =
						stamp.leakageAmps > 0
							? ` ISC=${stamp.leakageAmps} NC=1`
							: "";
					bjtModelCards.push(
						`.model ${model} ${stamp.polarity === "pnp" ? "PNP" : "NPN"}(` +
							`IS=${stamp.saturationCurrent} ` +
							`BF=${stamp.forwardBeta} ` +
							`BR=${stamp.reverseBeta}${leakage})`,
					);
				}
				lines.push(
					`Q${next("q")} ${nodeName(stamp.collector)} ${nodeName(stamp.base)} ${nodeName(stamp.emitter)} ${model}`,
				);
				break;
			}
			case "ideal-opamp": {
				// Finite gain into the rails, as a voltage-controlled source with limits.
				// ngspice's TABLE form saturates smoothly enough to stand in for tanh,
				// and an unrailed op-amp is a plain high-gain VCVS.
				if (stamp.railHigh === null || stamp.railLow === null) {
					lines.push(
						`E${next("e")} ${nodeName(stamp.output)} 0 ${nodeName(stamp.plus)} ${nodeName(stamp.minus)} ${stamp.openLoopGain}`,
					);
					break;
				}
				// A dominant pole, not an instant gain: the differential drives a VCCS into an RC
				// node, and the node's voltage -- the raw open-loop output -- is what the TABLE
				// saturates. At DC the node sits at `gain*(v+ - v-)`, the full gain; the pole rolls
				// it off at `GBP / gain`. The node's steepest slope into the TABLE is 1, not the
				// open-loop gain, which is why this integrates where a gain-of-1e5 table collapsed
				// ngspice's timestep on `jhs-424-gain-stage`.
				const centre = (stamp.railHigh + stamp.railLow) / 2;
				const halfSwing = (stamp.railHigh - stamp.railLow) / 2;
				const rpole = OPAMP_POLE_OHMS;
				const gm = stamp.openLoopGain / rpole;
				const cpole =
					stamp.openLoopGain /
					(2 * Math.PI * (DECK_GBP_MODE === "default" ? OPAMP_GAIN_BANDWIDTH_HZ : (stamp.gainBandwidthHz ?? OPAMP_GAIN_BANDWIDTH_HZ)) * rpole);
				const poleNode = `opamp_pole_${stamp.sourceIndex}`;
				lines.push(
					`G${next("g")} 0 ${poleNode} ${nodeName(stamp.plus)} ${nodeName(stamp.minus)} ${gm}`,
					`R${next("r")} ${poleNode} 0 ${rpole}`,
					`C${next("c")} ${poleNode} 0 ${cpole}`,
					`B${next("b")} 0 ${poleNode} I = ${OPAMP_POLE_CLAMP_SIEMENS} * (max(-${OPAMP_POLE_BAND * halfSwing}, min(${OPAMP_POLE_BAND * halfSwing}, V(${poleNode}))) - V(${poleNode}))`,
				);
				// Sample `tanh` over the pole node's voltage rather than the differential. The
				// node's steepest slope into the output is 1 (at the operating point), not the
				// open-loop gain, so the table is a gentle S ngspice can step through.
				const points: string[] = [];
				for (let step = -OPAMP_TABLE_HALF_POINTS; step <= OPAMP_TABLE_HALF_POINTS; step += 1) {
					const raw =
						(step / OPAMP_TABLE_HALF_POINTS) *
						OPAMP_TABLE_SPAN *
						halfSwing;
					const shape = Math.tanh(raw / halfSwing);
					points.push(`(${raw} ${centre + halfSwing * shape})`);
				}
				// ngspice's TABLE controlling variable needs the `{…}` braces: bare `V(node)`
				// makes ngspice mis-parse the `(x y)` pairs and reject any all-positive span.
				lines.push(
					`E${next("e")} ${nodeName(stamp.output)} 0 TABLE {V(${poleNode})} = ${points.join(" ")}`,
				);
				break;
			}
			case "fet": {
				// The runtime's law is Shichman-Hodges, which **is** ngspice's MOS level 1,
				// so this is a translation and not a second model. Saturation:
				// runtime `beta*(Vgs-Vt)^2*(1+lambda*Vds)` against level 1's
				// `(KP/2)*(W/L)*(Vgs-Vt)^2*(1+lambda*Vds)`, so `KP = 2*beta` at `W/L = 1`.
				// Triode: runtime `beta*Vds*(2*(Vgs-Vt)-Vds)*(1+lambda*Vds)` is
				// `2*beta*(Vgs-Vt-Vds/2)*Vds*(1+lambda*Vds)`, and level 1 is
				// `KP*(W/L)*(Vgs-Vt-Vds/2)*Vds*(1+lambda*Vds)` — the same substitution,
				// term for term.
				//
				// One device type for JFET and MOSFET alike, because the runtime has one law
				// and only the threshold's sign distinguishes them; a negative `VTO` is a
				// depletion device. Emitting ngspice's JFET model for the JFETs would compare
				// two different laws and report the difference as our defect.
				//
				// Bulk is tied to source, so there is no body diode and no fourth terminal,
				// and every parasitic is zeroed: the runtime's law is DC plus channel-length
				// modulation and nothing else, so charge storage here would be the deck's
				// invention rather than the program's behaviour.
				const key = [
					stamp.channel,
					stamp.thresholdVolts,
					stamp.transconductance,
					stamp.channelLengthModulation,
				].join(":");
				let model = fetModelByKey.get(key);
				if (model === undefined) {
					model = `FMOD${fetModelByKey.size + 1}`;
					fetModelByKey.set(key, model);
					fetModelCards.push(
						`.model ${model} ${stamp.channel === "n" ? "NMOS" : "PMOS"}(LEVEL=1 ` +
							// ngspice takes VTO in the device's own polarity: negative for a
							// p-channel enhancement device, where the runtime carries the
							// threshold already negated into its `sign = -1` domain.
							`VTO=${stamp.channel === "n" ? stamp.thresholdVolts : -stamp.thresholdVolts} ` +
							`KP=${2 * stamp.transconductance} ` +
							`LAMBDA=${stamp.channelLengthModulation} ` +
							`IS=0 JS=0 CBD=0 CBS=0 CGSO=0 CGDO=0 CGBO=0 CJ=0 CJSW=0 RD=0 RS=0 RSH=0)`,
					);
				}
				lines.push(
					`M${next("m")} ${nodeName(stamp.drain)} ${nodeName(stamp.gate)} ${nodeName(stamp.source)} ${nodeName(stamp.source)} ${model} W=1 L=1`,
				);

				// The two gate junctions, for a JFET only.
				//
				// `IS=0 JS=0` above zeroes the MOS model's own junctions deliberately, and until
				// the first of these existed that was the whole story: the gmin note below still
				// says "a FET gate and an ideal op-amp input contribute nothing to their own
				// row", which was true of the runtime too. It stopped being true when the
				// runtime gained gate junctions, and the deck kept emitting a gate that draws
				// nothing — so the two sides modelled different circuits and the difference was
				// reported as our defect. `ibanez-ts808` fell from `agrees` at gain 0.998 to
				// `gain diverges` at 0.624 on exactly that asymmetry, with its own DC gate bias
				// barely moving (`Vgs` −4.458 → −4.617): the junction is inert at that
				// operating point and conducts on signal excursions, which is when a real JFET
				// gate conducts too.
				//
				// **Two junctions, not one.** A JFET gate meets both ends of the channel, and
				// the runtime evaluates the same junction law at `vgs` and at `vgs - vds`.
				// Measured at `boss-sd-1`'s operating point, most of the gate current flows
				// through the gate-drain junction, so emitting only gate-source compares two
				// different circuits.
				//
				// **A MOSFET emits nothing here**, matching the runtime's own
				// `gateSaturationCurrent > 0` guard — an insulated gate draws no current at any
				// bias, so the six CMOS-logic FETs the inverter and gate lowerings produce are
				// untouched.
				//
				// Softplus written as `max(x,0) + ln(1+exp(-|x|))`, the same stable form the
				// triode's `vpkEff` uses in this file rather than a branch: `exp(-|x|)` cannot
				// overflow, so no clamp is needed and the expression matches the runtime's
				// branched `log1p(exp(x))` to double precision. The runtime's `over > -40*scale`
				// cutoff needs no counterpart for the same reason — below it the analytic value
				// is already zero in double precision.
				//
				// `vgs` and `vds` are channel-signed exactly as the runtime signs them, so one
				// expression covers n and p. For an n-channel the current leaves the gate; for
				// a p-channel it enters the gate, which is what swapping the terminals
				// expresses.
				if (stamp.gateSaturationCurrent > 0) {
					const gate = nodeName(stamp.gate);
					const source = nodeName(stamp.source);
					const drain = nodeName(stamp.drain);
					const vgs =
						stamp.channel === "n"
							? `v(${gate},${source})`
							: `v(${source},${gate})`;
					const vds =
						stamp.channel === "n"
							? `v(${drain},${source})`
							: `v(${source},${drain})`;
					const emitGateJunction = (other: string, across: string): void => {
						const x = `((${across})-${stamp.gateOnsetVolts})/${stamp.gateScaleVolts}`;
						const softplus = `(((${x})+abs(${x}))/2+ln(1+exp(-abs(${x}))))`;
						const from = stamp.channel === "n" ? gate : other;
						const to = stamp.channel === "n" ? other : gate;
						lines.push(
							`B${next("bg")} ${from} ${to} I={${stamp.gateSaturationCurrent}*${softplus}}`,
						);
					};
					emitGateJunction(source, vgs);
					emitGateJunction(drain, `((${vgs})-(${vds}))`);
				}
				break;
			}
			case "triode":
			case "pentode": {
				// Koren, as a `B` current source carrying the runtime's own expression — the same
				// translation-not-a-second-model principle `tube-diode` below states. ngspice has
				// no vacuum-tube primitive and needs none: every term here is `ln`, `exp`, `sqrt`,
				// `pow` and `atan` over node voltages.
				//
				// Until this existed, `triode` and `pentode` fell through to `default` and every
				// tube amp reported `unsupported`, which is why the amp lane had no ngspice parity
				// at all while the pedal corpus had 40 agreeing rows.
				//
				// Three details decide whether this is the same law or merely a similar one:
				//
				//   - **`max(-60, min(60, ...))`** mirrors the runtime's clamp on the exponent.
				//     Without it ngspice overflows `exp` where the runtime saturates. It is written
				//     with `max`/`min` and **not** `limit`, which is not a three-argument clamp in a
				//     B-source: `limit(x, -60, 60)` evaluates to **0**, measured. That silently made
				//     the exponent 0 for every tube at every instant, so `ln(1 + exp(0)) = 0.693`
				//     regardless of grid voltage -- the grid was disconnected from the plate
				//     current. The power tubes drew 435 mA each at a -219 V bias and no signal
				//     reached the output. Both clamps below use `max`/`min` for that reason.
				//   - **A triode uses a softened plate voltage term** in `E1`, matching the runtime's
				//     `vpkEff` branch rather than a hard `max(vpk,0)`, so the deck and runtime agree at
				//     the sign boundary instead of each applying a different smoothness.
				//   - **A pentode is screen-referenced**: `E1` takes `Vsk` where a triode takes `Vpk`,
				//     and the plate only gates the current through `atan(Vpk/kvb)`. The screen itself
				//     draws no current in this law, so no source is emitted for it — matching the
				//     runtime, which is a documented simplification rather than an omission here.
				const plate = nodeName(stamp.plate);
				const cathode = nodeName(stamp.cathode);
				const grid = nodeName(stamp.grid);
				const vpk = `v(${plate},${cathode})`;
				const vsk =
					stamp.kind === "pentode"
						? `v(${nodeName(stamp.screen)},${cathode})`
						: vpk;
				const vgk = `v(${grid},${cathode})`;
				const vct = stamp.contactPotentialVolts;
				const triodeVpkEff = `(((${vpk})+abs(${vpk}))/2+ln(1+exp(-abs(${vpk}))))`;
				const pentodeVpkEff = `max(${vpk},0)`;
				const pentodeVskEff = `max(${vsk},0)`;
				const vrefForInner = stamp.kind === "pentode" ? pentodeVskEff : vpk;
				const inner = `max(-60,min(60,${stamp.kp}*(1/${stamp.mu}+((${vgk})+${vct})/sqrt(${stamp.kvb}+${vrefForInner}*${vrefForInner}))))`;
				const e1 =
					stamp.kind === "pentode"
						? `((${pentodeVskEff}/${stamp.kp})*ln(1+exp(${inner})))`
						: `((${triodeVpkEff}/${stamp.kp})*ln(1+exp(${inner})))`;
				// Koren's pentode plate gate. `atan`, not `tanh` -- see `PentodeLaw`; the old gate
				// cost 26-34% of plate current because the fits were made against `atan`.
				const gate =
					stamp.kind === "pentode"
						? `*atan(${pentodeVpkEff}/${stamp.kvb})`
						: "";
				lines.push(
					`B${next("bt")} ${plate} ${cathode} I={(2/${stamp.kg1})*pow(${e1},${stamp.ex})${gate}}`,
				);
				// Grid conduction, the mechanism behind blocking distortion on an overdriven
				// stage. `limit(...,-40,40)` is both of the runtime's clamps at once: its
				// `Math.min(40, ...)` above, and the `-40 * scale` cutoff below which it skips the
				// term entirely — at `-40` the softplus is `4e-18`, invisible in double precision.
				lines.push(
					`B${next("bt")} ${grid} ${cathode} ` +
						`I={${stamp.gridSaturationCurrent}*ln(1+exp(max(-40,min(40,(${vgk}-${stamp.gridOnsetVolts})/${stamp.gridScaleVolts}))))}`,
				);
				break;
			}
			case "tube-diode":
				// ngspice has no vacuum-tube primitive, and it does not need one: a `B` current
				// source carrying the same expression **is** the runtime's law, term for term, so
				// this is a translation rather than a second model. Emitting a semiconductor `D`
				// with a fitted forward drop instead would compare two different physics and
				// report the difference as our defect.
				//
				// `max(v(a,b),0)^1.5` is the form the repository's own tube-rectifier reference
				// deck uses, and ngspice-41 accepts it as written.
				lines.push(
					`B${next("bt")} ${nodeName(stamp.plate)} ${nodeName(stamp.cathode)} ` +
						`I={${stamp.perveance}*max(v(${nodeName(stamp.plate)},${nodeName(stamp.cathode)}),0)^${stamp.exponent}}`,
				);
				break;
			case "transformer": {
				// The ideal transformer the runtime stamps: `Vp = n * Vs`, with the primary current
				// injected as `-n * I` at the secondary. In SPICE that is a sensed VCVS/CCCS pair.
				//
				//   Vsense  p+ pa 0            sense the primary current
				//   E       pa p-  s+ s- n     Vp = n * Vs
				//   F       s- s+  Vsense n    Is = -n * Ip, expelled at s+
				//
				// The `F` node order is `s-` then `s+` because SPICE carries `F`'s current from the
				// first node through the source to the second, so it *draws* from the node named
				// first while a transformer *sources* into its load. Settled on a circuit whose
				// answer is known -- 10 V primary, `n=2`, 10 Ω secondary -- because both orders give
				// 5 V across the load and only the power direction separates them: this one draws
				// `+0.25 A` into the primary, the other shows `-0.25 A`, a transformer feeding its
				// own source.
				//
				// A shared winding pair (for example a centre-tapped output transformer) is emitted
				// as exact ideal constraints without finite-L approximation. Each spoke winding gets
				// its own sensed branch current and reflected-current source on the shared pair,
				// matching the runtime's stamp equations while avoiding parallel voltage sources on
				// the same branch.
				const group = transformerGroupOf(stamp);
				if (group !== null) {
					if (!emittedGroups.has(group[0] as XfmrStamp)) {
						emittedGroups.add(group[0] as XfmrStamp);
						emitExactSharedGroup(group);
					}
					break;
				}
				const tag = next("x");
				const sense = `vs_${tag}`;
				const mid = `${tag}_pa`;
				lines.push(`V${sense} ${nodeName(stamp.primaryPlus)} ${mid} 0`);
				lines.push(
					`E${tag} ${mid} ${nodeName(stamp.primaryMinus)} ` +
						`${nodeName(stamp.secondaryPlus)} ${nodeName(stamp.secondaryMinus)} ${stamp.turnsRatio}`,
				);
				lines.push(
					`F${tag} ${nodeName(stamp.secondaryMinus)} ${nodeName(stamp.secondaryPlus)} V${sense} ${stamp.turnsRatio}`,
				);
				break;
			}
			default:
				unsupported.add((stamp as { kind: string }).kind);
				break;
		}
	}

	// The runtime's gmin, translated. `reference-runtime.ts` adds `GMIN_SIEMENS` from every
	// node to ground before anything reads the matrix, because some device terminals draw no
	// current by construction -- a FET gate and an ideal op-amp input contribute nothing to
	// their own row -- and a node carrying only those has a **structurally zero row**.
	//
	// ngspice's own `gmin` is a junction conductance across nonlinear devices, not a path from
	// every node to ground, so it does not cover this. Without these resistors ngspice reports
	// `singular matrix: check node n38` on `boss-od-3` -- the very node the runtime's gmin
	// comment names as carrying `Q4.gate` and nothing else -- and four corpus decks were
	// refused for exactly this reason while the runtime solved them. A deck missing something
	// the runtime's solve contains is not a reference; it is a different circuit.
	//
	// Nodes `1..nodeCount-1`, matching the runtime's loop exactly: ground is the reference and
	// aux rows are not nodes.
	// The element *name* is keyed on the row and the *node* on the source id. Rows are unique
	// by construction, source ids only if `nodeIds` is injective -- and keying the name on the
	// id meant a map defect emitted two `Rgmin` cards with one name, which ngspice rejects as a
	// syntax error before it ever solves. An emitter handed bad data should produce the wrong
	// circuit and let the parity check catch it, not fall over: a refusal reads as "the emitter
	// is broken" and sends the reader to the wrong file.
	for (let row = 1; row < block.nodeCount; row += 1) {
		lines.push(`Rgmin${row} ${nodeName(row)} 0 1e12`);
	}

	// The program's operating-point seeds, which `.nodeset` is exactly. This has to be emitted
	// in the same change that the runtime starts honouring them, or the two solvers pick
	// different DC solutions for a multi-solution circuit and the report reads a deliberate
	// change as a regression. `boss-od-1` is the case that proves it: it sits on a
	// cross-coupled pair's unstable midpoint and **agrees with ngspice at `corr=1.0000`**,
	// because the deck carries the same stamps and ngspice converges to the same midpoint.
	// Seeding one side without the other would move it off that agreement.
	if (block.operatingPointSeeds.length > 0) {
		lines.push(
			`.nodeset ${block.operatingPointSeeds
				.map((seed) => `v(${nodeName(seed.node)})=${seed.volts}`)
				.join(" ")}`,
		);
	}

	const output = nodeName(block.outputNode as number);
	lines.push(...fetModelCards);
	lines.push(...bjtModelCards);
	lines.push(...diodeModelCards);
	// Integration and convergence options for tube amp transient stability:
	// - `method=gear`: Replaces default trapezoidal integration with Gear's backward differentiation
	//   formula (BDF), providing numerical damping that prevents trapezoidal ringing and timestep
	//   collapse (`doAnalyses: TRAN: Timestep too small`) on stiff, high-impedance triode grid circuits.
	// - `trtol=1`: Tightens truncation error timestep control (default 7) to compensate for Gear's damping.
	// - `reltol=0.01`: Relative tolerance relaxed from 0.001 to 0.01 (1%) for stiff nonlinear tube solvers.
	// - `cshunt=1e-15`: Adds 1 fF shunt capacitance to ground on all nodes to prevent floating node singularities.
	//
	// WHAT THIS INSTRUMENT PROVES AND CANNOT PROVE:
	// - Proves: Macro waveform shape (correlation >= 0.99) and overall gain level within ~2% on well-behaved topologies.
	// - Cannot prove: Subtle gain differences within ~1% (due to reltol=0.01 reference slop), or high-Q ringing
	//   that Gear integration numerically damps out while the trapezoidal v2 runtime would legitimately show.
	lines.push(".options savecurrents method=gear trtol=1 reltol=0.01 cshunt=1e-15");
	// **No `uic`.** It told ngspice to skip its operating-point solve and start from zero
	// state, which is what the runtime used to do -- so both sides began charging from a
	// short across every capacitor and their agreement was two power-on transients
	// agreeing, not two circuits agreeing. Once the runtime solved its operating point the
	// accidental match broke and the harness read it as a disagreement: on `big-muff-pi`
	// ngspice reported an RMS of `1.900e+0` against the runtime's `1.751e-5`. Without
	// `uic`, ngspice solves its own operating point and the two agree to 0.3%
	// (`1.757e-5` against `1.751e-5`). That is the comparison this harness is for.
	lines.push(`.tran ${options.stepSeconds} ${options.seconds}`);
	lines.push(".control");
	lines.push("run");
	lines.push(`wrdata ${options.dataPath} v(${output})`);
	lines.push(".endc");
	lines.push(".end");

	return {
		text: lines.join("\n"),
		outputNode: output,
		unsupported: [...unsupported],
	};
}
