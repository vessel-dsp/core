// Refusals that a stage raises as an exception, and the line between those and bugs.
//
// A stage refuses when the *document* does not support a program: a terminal with no
// node, a control straddling two regions, a device with the wrong terminal count. That
// is an answer about the source, and `compile` turns it into a `CompileResult` rather
// than letting it escape -- one malformed packet must not take down a batch.
//
// A stage *throws* when the compiler itself is wrong: a law with no stamp, a macro
// region with no model. Those are not refusals and are deliberately not represented
// here, so they keep crashing loudly instead of being reported as an unsupported
// pedal. Catching everything would turn every programming error into a plausible
// answer about someone's circuit.

import type { DeviceId } from "./types";

export type CompilerStage = "netlist" | "partition" | "lower" | "link";

export class StageRefusal extends Error {
	readonly stage: CompilerStage;
	/** The component the refusal is about, when the stage knows it. */
	readonly device: DeviceId | null;

	constructor(
		stage: CompilerStage,
		device: DeviceId | null,
		message: string,
		cause?: unknown,
	) {
		super(message, cause === undefined ? undefined : { cause });
		this.stage = stage;
		this.device = device;
		this.name = `${stage}-refusal`;
	}
}

/**
 * A device the document declares with a terminal count the lowering stage cannot stamp.
 *
 * A refusal about the source, not a bug. The plain `Error`s left in `lower.ts` are the
 * opposite -- a law with no stamp and a macro region with no model are compiler defects,
 * and they stay uncatchable so they cannot be reported as an unsupported pedal.
 *
 * Lives here rather than in `lower.ts` so that the modules split out of lowering
 * (`transformer.ts`, `pot-orientation.ts`) can refuse without importing back from it.
 */
export class LoweringError extends StageRefusal {
	constructor(message: string, device: DeviceId | null = null) {
		super("lower", device, message);
	}
}
