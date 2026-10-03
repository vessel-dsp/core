// Whether the compiled console is on disk for this checkout.
//
// The wasm is a release artifact, gitignored, written by `scripts/build-wasm.sh` into
// `src/wasm/`. A test that needs it must say so and skip by name when it is absent,
// because a skipped check is a skip and not a pass -- and a red suite on a fresh clone that
// merely has not built yet reads as an engine defect, which it is not.
import { existsSync } from "node:fs";

export const WASM_GLUE_URL = new URL("../src/wasm/v2_dsp.cjs", import.meta.url);
export const wasmBinaryPresent = existsSync(WASM_GLUE_URL);
export const WASM_SKIP_REASON = wasmBinaryPresent
	? ""
	: "src/wasm/v2_dsp.cjs is absent: run `bun run build:wasm`. WASM-console tests SKIPPED, not passed.";

if (!wasmBinaryPresent) {
	console.warn(WASM_SKIP_REASON);
}
