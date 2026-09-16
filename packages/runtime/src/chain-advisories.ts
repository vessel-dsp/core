// What a chain can say about itself that no single program can.
//
// `ChainRuntime` scales between slots by the ratio of one slot's output full scale to the next
// slot's input full scale (`Program.portFullScaleVolts`, derived in
// `../compiler/port-full-scale.ts`). When either side is `null` the program did not state a
// supply to derive the bound from, so there is no ratio to apply and the signal crosses at 1.0 --
// which is the old behaviour, and is a guess about level rather than a statement about it.
//
// It then applies the **impedance divider** at the same seam (`seamDivider`), which is a different
// question from the same connection: full scale says what units a number is in, loading says how
// much of the signal survives the connection at all. Both default to 1 when unstated, and neither
// invents a figure.
//
// Advisory rather than fail-closed, the same shape as `./supply-ground.ts`: the chain still runs,
// and what is missing is a source fact, not a runtime capability.

import type { SlotContract, StageCoverage } from "./chain-slot";

/**
 * How far along the amplification path each coverage sits, so a rule can say "at or beyond" instead
 * of naming one value and silently missing the others.
 *
 * Introduced because `speaker-signal-into-input` tested `produces === "speaker-electrical"` and
 * therefore let **`miked` into an instrument input pass in silence** -- a full-rig capture feeding a
 * pedal, which is the same kind error one rung further along. Ordering the vocabulary is what makes
 * that class of miss impossible rather than a thing to remember.
 */
const COVERAGE_RANK: Readonly<Record<StageCoverage, number>> = {
	instrument: 0,
	preamp: 1,
	"speaker-electrical": 2,
	miked: 3,
};

/** One thing wrong with a chain, with the slots a host needs to point at. */
export type ChainAdvisory = {
	/**
	 * A closed code so a host can group or filter without reading the sentence.
	 *
	 * `unscalable-seam` — one side states no full scale, so the signal crosses unscaled.
	 * `speaker-signal-into-input` — a speaker terminal feeds a slot expecting instrument level.
	 * `cab-after-miked` — an already-miked signal is sent through a cabinet stage again.
	 * `undividable-seam` — one electrical side declares a port impedance and the other does not.
	 * `instrument-into-speaker-stage` — a stage wanting a speaker terminal is fed instrument level.
	 */
	readonly code:
		| "unscalable-seam"
		| "speaker-signal-into-input"
		| "cab-after-miked"
		| "undividable-seam"
		| "instrument-into-speaker-stage";
	/** The slot whose output crosses the seam, and the slot receiving it. */
	readonly slots: readonly [number, number];
	readonly message: string;
};

/**
 * Seams where one side states no full scale. Pure, so a host can ask before playing.
 *
 * A one-slot chain has no seam and never reports.
 */
export function chainAdvisories(
	chain: readonly SlotContract[],
): readonly ChainAdvisory[] {
	const advisories: ChainAdvisory[] = [];
	for (let slot = 1; slot < chain.length; slot += 1) {
		const upstream = chain[slot - 1]?.portFullScaleVolts.output ?? null;
		const downstream = chain[slot]?.portFullScaleVolts.input ?? null;
		if (upstream !== null && downstream !== null) {
			continue;
		}
		const missing =
			upstream === null && downstream === null
				? "neither side"
				: upstream === null
					? `slot ${slot - 1}'s output`
					: `slot ${slot}'s input`;
		advisories.push({
			code: "unscalable-seam",
			slots: [slot - 1, slot],
			message:
				`between slot ${slot - 1} and slot ${slot}, ${missing} states a full-scale ` +
				"voltage, so the signal crosses unscaled: a level mismatch here is not corrected " +
				"and the receiving slot may be driven far above or below what it expects. The " +
				"bound is derived from the program's own supplies, so a program declaring none " +
				"cannot supply one",
		});
	}
	// **A speaker terminal is not an instrument signal.** `speaker-electrical` means the output node
	// *is* the transformer secondary -- tens of volts across an 8 or 16 ohm load, not the fraction of
	// a volt a jack expects. Feeding that to a slot that wants instrument level is wrong in kind as
	// well as level, and it is the shape of mistake that put an amp's preamp tap and another amp's
	// speaker terminal in the same "plausible" column for a day.
	//
	// **Narrowed to what the receiver expects.** This used to fire whenever a `speaker-electrical`
	// output fed *anything*, which would report the single most ordinary amp chain there is: an amp
	// into a cabinet. A cab stage is exactly what a speaker terminal is for.
	//
	// **"At or beyond a speaker terminal", not "is a speaker terminal".** The first version of this
	// tested one value and let `miked` through: a full-rig capture into a pedal reported nothing,
	// though it is the same error one rung further along. `COVERAGE_RANK` is what closes that.
	for (let slot = 1; slot < chain.length; slot += 1) {
		const produces = chain[slot - 1]?.produces;
		if (
			produces === undefined ||
			COVERAGE_RANK[produces] < COVERAGE_RANK["speaker-electrical"]
		) {
			continue;
		}
		if (chain[slot]?.expects !== "instrument") {
			continue;
		}
		advisories.push({
			code: "speaker-signal-into-input",
			slots: [slot - 1, slot],
			message:
				`slot ${slot - 1} produces a ${produces} signal -- at or past the speaker terminal -- ` +
				`and it feeds slot ${slot}, whose input expects an instrument-level signal: this is a ` +
				"difference of kind, not only of level, and no scaling makes it a valid connection",
		});
	}
	// **The other direction is milder, and deliberately narrower.** A cabinet stage fed a signal that
	// never passed a power amp is thin rather than wrong -- nothing is over-driven and nothing is
	// damaged -- so it is reported, not treated as a kind error.
	//
	// **`preamp` is excluded on purpose, and that exclusion is load-bearing.** A preamp into an
	// impulse response is an established, ordinary rig, and `mesa-boogie-mark-v` renders `preamp`
	// coverage precisely because the signal-chain plan's decision 2 says to honour its declared
	// handoff. Firing here on rank 1 would report that decision as a mistake on every chain.
	//
	// So only rank 0 into a speaker-terminal stage reports: an instrument-level signal with no
	// amplification of any kind between it and a cabinet.
	for (let slot = 1; slot < chain.length; slot += 1) {
		const produces = chain[slot - 1]?.produces;
		const expects = chain[slot]?.expects;
		if (produces === undefined || expects === undefined) {
			continue;
		}
		if (
			COVERAGE_RANK[produces] !== COVERAGE_RANK.instrument ||
			COVERAGE_RANK[expects] < COVERAGE_RANK["speaker-electrical"]
		) {
			continue;
		}
		advisories.push({
			code: "instrument-into-speaker-stage",
			slots: [slot - 1, slot],
			message:
				`slot ${slot} expects a ${expects} signal -- one that has passed a power amp -- and ` +
				`slot ${slot - 1} produces instrument level with no amplification stage between ` +
				"them: the chain runs, but the cabinet colours a signal that never saw a power " +
				"stage, which is audibly thin rather than incorrect",
		});
	}
	// **A miked signal must not be miked again.** Now expressible, because the cabinet is a slot:
	// two consecutive slots both *producing* `miked` means a cab stage was applied to a signal that
	// already carries one.
	//
	// This is the only warnable cab arrangement, and deliberately so. A NAM amp capture produces
	// `speaker-electrical`, so NAM into an IR is silent -- it is what most people do. A whitebox
	// amp into an IR is silent for the same reason. **No cab stage at all is silent too**: a full-rig
	// NAM, or a player who wants none, is a complete chain and nothing here should nag for one.
	for (let slot = 1; slot < chain.length; slot += 1) {
		if (
			chain[slot - 1]?.produces !== "miked" ||
			chain[slot]?.produces !== "miked"
		) {
			continue;
		}
		advisories.push({
			code: "cab-after-miked",
			slots: [slot - 1, slot],
			message:
				`slot ${slot - 1} already produces a miked signal -- a full-rig capture, or a ` +
				`cabinet stage -- and slot ${slot} applies another one: the cabinet and microphone ` +
				"colour the signal twice, which is audible as a hollow, over-filtered tone rather " +
				"than a level error",
		});
	}
	// **Only the asymmetric case is worth a word.** A divider needs an impedance on both sides, and
	// the two ways it can be missing are not equally interesting:
	//
	//   - *Neither side declares* — the ordinary state of every corpus document today, and reporting
	//     it would be a line of noise on every seam of every chain. Silence.
	//   - *Either side is a processor* — a NAM or an IR has no impedance to declare, so there is
	//     nothing missing. Silence, and this is why `portImpedanceOhms` is nullable as a whole
	//     object rather than only per port.
	//   - *One electrical side declares and the other does not* — someone measured half of a real
	//     interaction and the other half silently defaulted to no loading at all. That is worth
	//     naming, because the declared number looks like it is doing something and is not.
	for (let slot = 1; slot < chain.length; slot += 1) {
		const source = chain[slot - 1]?.portImpedanceOhms;
		const load = chain[slot]?.portImpedanceOhms;
		if (
			source === null ||
			source === undefined ||
			load === null ||
			load === undefined
		) {
			continue;
		}
		const out = source.output;
		const inn = load.input;
		if ((out === null) === (inn === null)) {
			continue;
		}
		advisories.push({
			code: "undividable-seam",
			slots: [slot - 1, slot],
			message:
				out === null
					? `slot ${slot} declares a ${inn} Ω input impedance but slot ${slot - 1} declares ` +
						"no output impedance, so no loading is applied and the declared figure has no " +
						"effect: a low input impedance is meant to load what drives it"
					: `slot ${slot - 1} declares a ${out} Ω output impedance but slot ${slot} declares ` +
						"no input impedance, so the signal crosses without loading and the declared " +
						"figure has no effect",
		});
	}
	return advisories;
}

/**
 * The multiplier applied to the signal crossing into `slot`.
 *
 * Two independent factors, multiplied:
 *
 *   - the **full-scale ratio**, converting between the two slots' own voltage normalisations, or 1
 *     where either side states no supply to derive a bound from;
 *   - the **impedance divider** `Zin / (Zout + Zin)`, the loading one slot's input puts on the
 *     previous slot's output, or 1 where either electrical side declares none.
 *
 * They are separate questions and neither substitutes for the other: full scale is about the units
 * a number is in, loading is about how much of the signal survives the connection. A seam can scale
 * and not divide, or divide and not scale.
 */
export function seamScale(
	chain: readonly SlotContract[],
	slot: number,
): number {
	const upstream = chain[slot - 1]?.portFullScaleVolts.output ?? null;
	const downstream = chain[slot]?.portFullScaleVolts.input ?? null;
	const ratio =
		upstream === null || downstream === null || downstream === 0
			? 1
			: upstream / downstream;
	return ratio * seamDivider(chain, slot);
}

/**
 * The resistive divider at a seam, or `1` when it cannot be computed.
 *
 * **Resistive and one-directional, which is a stated approximation rather than an oversight.** Real
 * interaction between two stages is bidirectional and frequency-dependent, and only co-solving the
 * adjacent blocks captures it -- the fidelity ceiling the unified plan §5.3 names and this
 * deliberately does not attempt. What this does capture is the audible first-order half: a fuzz with
 * a low input impedance loads the pickup or the pedal ahead of it, which is a large part of what that
 * pedal *is*.
 *
 * **No default is invented anywhere.** A missing impedance yields 1, never an assumed "standard
 * 1 MΩ input" -- a fabricated convention would be indistinguishable from a measurement in every
 * downstream number. Measured on the corpus as of 2026-08-21 that means this returns 1 for every
 * seam: **zero input jacks declare a typed impedance**, and the only four declarations anywhere are
 * output impedances (`marshall-blues-breaker` 1 MΩ, `mxr-m117r-flanger` 1 kΩ,
 * `mxr-noise-gate-line-driver` 10 kΩ, `pigtronix-philosophers-tone` 150 Ω). The mechanism is
 * therefore inert until sources carry the input side, and `undividable-seam` is what says so out
 * loud on a chain built from one of those four.
 */
export function seamDivider(
	chain: readonly SlotContract[],
	slot: number,
): number {
	const source = chain[slot - 1]?.portImpedanceOhms;
	const load = chain[slot]?.portImpedanceOhms;
	const out = source?.output ?? null;
	const inn = load?.input ?? null;
	if (out === null || inn === null) {
		return 1;
	}
	const total = out + inn;
	return total <= 0 ? 1 : inn / total;
}
