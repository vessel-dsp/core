import { RuntimeError } from "@vessel-dsp/runtime";

/**
 * Validate a caller-supplied oversample factor with exactly the runtime's
 * rule (`ReferenceRuntime.prepare`, `V2WasmEngine.prepare`): floored,
 * minimum 1, non-finite refused. `undefined` (absent) is 1, today's
 * behaviour. Shared by `SignalChain` and `RuntimeNode` so the chain can
 * never hand the runtime a factor it would refuse.
 */
export function validateOversample(oversample: number | undefined): number {
	const factor = Math.max(1, Math.floor(oversample ?? 1));
	if (!Number.isFinite(factor)) {
		throw new RuntimeError(
			`oversample must be a finite integer of at least 1, got ${String(oversample)}`,
		);
	}
	return factor;
}
