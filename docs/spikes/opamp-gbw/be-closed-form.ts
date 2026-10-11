// What does the backward-Euler pole (opAmpPoleAlpha: alpha = dt/(dt+tau), raw state v[n] = alpha*A0*d[n] + (1-alpha)*v[n-1])
// give in a non-inverting loop of feedback fraction beta = 1/G? Closed form of that DISCRETE loop:
//   v[n] (1 + alpha A0 beta) = alpha A0 vin[n] + (1 - alpha) v[n-1]   =>   H(z) = K / (1 - a z^-1),
//   K = alpha A0 / (1 + alpha A0 beta),  a = (1 - alpha) / (1 + alpha A0 beta).
// Compared with the continuous single-pole closed form (closedLoopMagnitudeDb) and, optionally, a measured dB list.
//   bun docs/spikes/opamp-gbw/be-closed-form.ts
import { beClosedLoopMagnitudeDb, closedLoopMagnitudeDb } from "../../../packages/runtime/tests/non-inverting-stage";

export const beClosedLoopDb = (gain: number, gbpHz: number, hz: number, fs: number, aol = 1e5): number =>
	beClosedLoopMagnitudeDb(gain, gbpHz, hz, fs, aol);
if (import.meta.main) {
	const freqs = [100, 1000, 2000, 4000, 8000, 10000, 12500, 16000];
	for (const fs of [48000, 192000, 768000]) {
		console.log(`\nfs = ${fs}: BE discrete loop minus continuous single pole (dB)`);
		console.log(`G    GBP    |${freqs.map((f) => String(f).padStart(8)).join("")}`);
		for (const g of [10, 100]) for (const gbp of [1e6, 3e6, 1e7]) {
			console.log(`${String(g).padEnd(4)} ${(gbp / 1e6).toFixed(0).padStart(2)} MHz |${freqs.map((f) => (beClosedLoopDb(g, gbp, f, fs) - closedLoopMagnitudeDb(g, gbp, f)).toFixed(3).padStart(8)).join("")}`);
		}
	}
}
