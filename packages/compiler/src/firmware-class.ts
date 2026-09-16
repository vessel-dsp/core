/**
 * **Does this chip's behaviour come from a PROGRAM?** — typed, with positive evidence required.
 *
 * **Today nothing answers this.** `grep -rn "fixedFunction|reprogrammable|firmwareClass"` across
 * `src/` and `scripts/` returns one hit, and it is a *comment*. The discriminator the opaque-device
 * protocol calls the whole decision exists only as prose, and the compiler's operative test is in
 * `open-category.ts`:
 *
 * > `opaque` | the behaviour IS firmware we do not have | **the packet must carry a firmware
 * > blocker naming it**
 *
 * **That is a test of the RECORD, not of the chip.** The chain runs: a dump search fails → a
 * blocker is written → the compiler reads the blocker → the device is `opaque` → we report it as
 * firmware-blocked. **Nothing anywhere demonstrates the chip contains a program.** Absence of
 * documentation becomes presence of firmware, which is an unfalsifiable cap.
 *
 * **So the default is `undetermined`, never `reprogrammable`.** "We could not determine this" and
 * "this is a program" are different claims and **only one of them is a scope boundary**. Collapsing
 * them is why the blocked bucket has been inflated.
 */
export type FirmwareClass =
	/** Documented architecture; the mask holds coefficients, not an instruction stream. */
	| "fixed-function"
	/** The behaviour IS a program: a CPU/DSP core, or an externally-borne image. */
	| "reprogrammable"
	/** Neither established. **NOT a scope boundary** — it is an open question. */
	| "undetermined";

/**
 * **Positive evidence, because a blocker is not evidence.** Any one of these establishes
 * `reprogrammable`:
 *
 * - the part belongs to a documented CPU/DSP family with a **named instruction set** — `M37470M2`
 *   is Mitsubishi 740-family, `uPD780034` is NEC 78K/0, and both announce themselves by part number;
 * - an **external program store** on the board — a serial EEPROM wired to the chip, FV-1 class;
 * - documented **field-programmability** or a program-load sequence;
 * - one part producing behaviours that differ **in kind** across modes (reverb against pitch-shift)
 *   with no analog path switching to explain it.
 *
 * And for `fixed-function`:
 *
 * - the **datasheet states the audio transfer as a function of external components**;
 * - **no CPU core named anywhere** in the family documentation;
 * - the mask holds **coefficients rather than an instruction stream**.
 */
export type FirmwareEvidence = {
	readonly firmwareClass: FirmwareClass;
	/** The specific evidence. Required for anything but `undetermined`: a class with no basis is a guess. */
	readonly basis: readonly string[];
	/**
	 * **`undetermined` only, and REQUIRED there: what evidence would decide it.**
	 *
	 * Without this line `undetermined` is a shrug. With it, it is a **procurement list** someone can
	 * act on or decline — a service note with an internal block diagram, a die photograph, a
	 * documented mode-pin map, a sibling product using the same mask with published behaviour.
	 * **That is the difference between a third state that is honest and a third state that is a
	 * place to put things**, which is the failure removed twice on 2026-09-11.
	 */
	readonly wouldBeDecidedBy?: string;
};

export function validateFirmwareEvidence(e: FirmwareEvidence): readonly string[] {
	if (e.firmwareClass === "undetermined")
		return (e.wouldBeDecidedBy ?? "").trim() === ""
			? ["`undetermined` with no `wouldBeDecidedBy` is a shrug, not a state -- name the evidence that would decide it"]
			: [];
	return e.basis.length === 0
		? [`\`${e.firmwareClass}\` asserted with no basis -- a class with no positive evidence is a guess, and the default is \`undetermined\``]
		: [];
}

/**
 * **A firmware blocker is only a scope boundary when the part is `reprogrammable` AND on the audio
 * path.** Measured 2026-09-12: of 28 firmware-blocked parts in the corpus, **6 are off the audio
 * path entirely** — `boss-dd-5`'s `M37470M2-333SP` (device id `IC_DD5_CPU`), `boss-oc-3`'s
 * `uPD780034` (`SRC_CPU`), and four more. **A control MCU that never touches audio caps nothing**,
 * however undumpable it is.
 */
export function capsAudioScope(e: FirmwareEvidence, onAudioPath: boolean): boolean {
	return e.firmwareClass === "reprogrammable" && onAudioPath;
}
