// Closed-form frequency responses of the DISCRETE non-inverting loop for each candidate pole scheme, against the continuous single pole.
// Pure arithmetic: no engine code is loaded, so this is legitimate before any engine re-run. A0 = 1e5 (class default), GBP = 1e6 (the class constant).
//   bun docs/spikes/pole-order2/closed-forms.ts [--gbp=1e6] [--aol=1e5]
//
// Linear-region model of the stage: out = u (tanh ~ identity), d = vin - beta*u, beta = 1/G. The pole law under test integrates
//   tau du/dt = A0 d - u,  tau = A0 / (2 pi GBP),  a = dt / tau.
// Every scheme is  u[n] = g d[n] + h d[n-1] + c2 u[n-1] + c3 u[n-2]  (BE: h = c3 = 0; TR and FOH: c3 = 0; BDF2: h = 0).
export type Scheme = "be" | "tr" | "foh" | "bdf2";
export type Coef = { g: number; h: number; c2: number; c3: number };

export function coefficients(scheme: Scheme, a0: number, tau: number, dt: number): Coef {
	const a = dt / tau;
	switch (scheme) {
		case "be": { const al = dt / (dt + tau); return { g: al * a0, h: 0, c2: 1 - al, c3: 0 }; }
		case "tr": { const x = dt / (2 * tau); return { g: (x / (1 + x)) * a0, h: (x / (1 + x)) * a0, c2: (1 - x) / (1 + x), c3: 0 }; }
		case "foh": { const e = Math.exp(-a), r = -Math.expm1(-a) / a; return { g: a0 * (1 - r), h: a0 * (r - e), c2: e, c3: 0 }; }
		case "bdf2": { const gm = (2 * a) / 3; return { g: (gm * a0) / (1 + gm), h: 0, c2: 4 / 3 / (1 + gm), c3: -1 / 3 / (1 + gm) }; }
	}
}

/** |H(e^{j theta})| in dB of the discrete closed loop. */
export function discreteClosedLoopDb(scheme: Scheme, gain: number, gbpHz: number, hz: number, solverRate: number, a0 = 1e5): number {
	const dt = 1 / solverRate, tau = a0 / (2 * Math.PI * gbpHz), beta = 1 / gain;
	const { g, h, c2, c3 } = coefficients(scheme, a0, tau, dt);
	const th = (2 * Math.PI * hz) / solverRate;
	// u[n] (1 + g beta) = g vin[n] + h vin[n-1] + (c2 - h beta) u[n-1] + c3 u[n-2]
	// BDF2's g already folds the (1+gm) divide, but its implicit term is gm*A0*beta*u[n] on the left: handled by the same 1 + g beta.
	const re = (k: number) => Math.cos(k * th), im = (k: number) => -Math.sin(k * th);
	const nr = g + h * re(1), ni = h * im(1);
	const dr = 1 + g * beta - (c2 - h * beta) * re(1) - c3 * re(2), di = -(c2 - h * beta) * im(1) - c3 * im(2);
	return 20 * Math.log10(Math.hypot(nr, ni) / Math.hypot(dr, di));
}
export function continuousClosedLoopDb(gain: number, gbpHz: number, hz: number, a0 = 1e5): number {
	const dc = gain / (1 + gain / a0), corner = gbpHz * (1 / a0 + 1 / gain);
	return 20 * Math.log10(dc / Math.sqrt(1 + (hz / corner) ** 2));
}
/** Closed-loop pole of the discrete stage in the stiff limit and at this stage: the root(s) of the denominator. */
export function closedLoopPole(scheme: Scheme, gain: number, gbpHz: number, solverRate: number, a0 = 1e5): number[] {
	const dt = 1 / solverRate, tau = a0 / (2 * Math.PI * gbpHz), beta = 1 / gain;
	const { g, h, c2, c3 } = coefficients(scheme, a0, tau, dt);
	// (1 + g beta) z^2 - (c2 - h beta) z - c3 = 0
	const A = 1 + g * beta, B = -(c2 - h * beta), C = -c3;
	const disc = B * B - 4 * A * C;
	if (disc >= 0) return [(-B + Math.sqrt(disc)) / (2 * A), (-B - Math.sqrt(disc)) / (2 * A)].map((v) => +v.toFixed(6));
	return [Math.hypot(B, Math.sqrt(-disc)) / (2 * A)];
}

if (import.meta.main) {
	const arg = (n: string, d: number) => Number((process.argv.find((s) => s.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split("=")[1]);
	const gbp = arg("gbp", 1e6), a0 = arg("aol", 1e5);
	const freqs = [100, 1000, 2000, 4000, 6300, 8000, 10000, 12500, 16000];
	const rates: Array<[string, number]> = [["os1 48k", 48000], ["os2 96k", 96000], ["os4 192k", 192000], ["os8 384k", 384000]];
	console.log(`GBP ${gbp}, A0 ${a0}. cell = discrete closed loop minus continuous single pole (dB)`);
	for (const gain of [100, 10, 2, 1]) for (const scheme of ["be", "tr", "foh", "bdf2"] as Scheme[]) for (const [name, fs] of rates) {
		const row = freqs.filter((f) => f < fs / 2).map((f) => (discreteClosedLoopDb(scheme, gain, gbp, f, fs, a0) - continuousClosedLoopDb(gain, gbp, f, a0)).toFixed(3).padStart(8)).join("");
		console.log(`G=${String(gain).padEnd(3)} ${scheme.padEnd(4)} ${name.padEnd(9)}|${row}`);
	}
	console.log(`\nclosed-loop poles (z) at G=100/10/2/1`);
	for (const scheme of ["be", "tr", "foh", "bdf2"] as Scheme[]) for (const [name, fs] of rates) console.log(`${scheme.padEnd(4)} ${name.padEnd(9)} ${[100, 10, 2, 1].map((g) => `G${g}:${closedLoopPole(scheme, g, gbp, fs, a0).join("/")}`).join("  ")}`);
	console.log(`\nfreqs (Hz, only those below each rate's Nyquist): ${freqs.join(" ")}`);
}
