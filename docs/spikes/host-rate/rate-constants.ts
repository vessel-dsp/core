// Check 5b (measured part): constants counted in SAMPLES do not scale with the solver rate.
//
//   bun docs/spikes/host-rate/rate-constants.ts
//
// `reference-runtime.ts:355-358` / `Engine.cpp:384-387`: the pitch tracker's window (2048), hop (256) and lag range (20..1024) are in SOLVER samples; the comment
// there says "lags 20..1024 span 46.9 Hz..2.4 kHz" -- true only at 48 kHz. `trackPitchFundamental` is a pure function exported from the module, so this
// feeds it a clean sine at each solver rate (the rate a program runs its ops at: host x factor) and prints the estimate. Nothing here renders a program.
import { trackPitchFundamental } from "../../../packages/runtime/src/reference-runtime";

const rates = [48000, 96000, 192000, 384000];
const freqs = [82.4, 110, 220, 440, 1000, 2000];
console.log("pitch tracker estimate (Hz) for a sine of the stated frequency, 2048-sample window, by SOLVER rate (reads 0 when it finds nothing)");
console.log(`| solver rate | lag range -> Hz | hop (ms) | ${freqs.map((f) => `${f} Hz`).join(" | ")} |`);
console.log(`|---|---|---|${freqs.map(() => "---").join("|")}|`);
for (const fs of rates) {
	const cells = freqs.map((f) => {
		const w = Float64Array.from({ length: 2048 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * f * i) / fs));
		const e = trackPitchFundamental(w, fs);
		return e.toFixed(1);
	});
	console.log(`| ${fs / 1000}k | ${(fs / 1024).toFixed(1)} .. ${(fs / 20 / 1000).toFixed(2)} kHz | ${((256 / fs) * 1000).toFixed(3)} | ${cells.join(" | ")} |`);
}
