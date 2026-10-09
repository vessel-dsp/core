// Scratch candidate resampler backends for the latency spike.
// NOT shipped: a copy of the cascade used by the runtime, behind a selector.
// General (coefficients a function of the stage only), no new .vdsp field.
import {
  designHalfBand2x,
  HalfBandStage2x,
} from "../../../packages/runtime/src/resample";

export type CandidateId =
  | "shipped" // 57-tap beta 8.3 every stage (reference)
  | "A" // stage-specific linear-phase FIRs
  | "B" // relaxed linear-phase (60 dB class)
  | "C" // minimum-phase, same magnitude as shipped
  | "D3" // IIR half-band, 3rd-order maximally flat (a=1/3 derived)
  | "D5" // IIR half-band, 5th-order maximally flat (a0,a1 solved)
  | "E" // hybrid: FIR first stage + IIR later stages
  | "F1" // FAILING CONTROL: shipped prototype with halved stopband (β3.5)
  | "F2" // FAILING CONTROL: D5 with one allpass coefficient dropped (A1 empty)
  | "F3" // FAILING CONTROL: shipped FIR with crossed decimation (reversed pair)
  | "B37" // KNEE POINT: 37 taps β5.5 (ripple 0.0099, stop −59) vs B41
  | "AB"; // COMBINED: relaxed first stage (B41) + lean later stages (A s2/s3)

// ---- small radix-2 FFT (for the min-phase cepstral design only) ----
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!; re[i] = re[j]!; re[j] = tr;
      const ti = im[i]!; im[i] = im[j]!; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const ur = re[i + k]!, ui = im[i + k]!;
        const vr = re[i + k + len / 2]! * cr - im[i + k + len / 2]! * ci;
        const vi = re[i + k + len / 2]! * ci + im[i + k + len / 2]! * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i += 1) { re[i]! /= n; im[i]! /= n; }
}

/**
 * Minimum-phase FIR with (approximately) the magnitude response of `linear`.
 * Homomorphic/cepstral method (Oppenheim & Schafer, Discrete-Time Signal
 * Processing, § minimum-phase from magnitude): log-magnitude -> real cepstrum
 * -> causal window (double positive quefrencies) -> exp -> impulse.
 * Same length as the input; DC gain renormalized to exactly 1.
 */
export function minPhaseFromLinear(linear: Float64Array): Float64Array {
  let nfft = 64;
  while (nfft < 16 * linear.length) nfft <<= 1;
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  re.set(linear);
  fft(re, im, false);
  // Real cepstrum of the log magnitude.
  const logRe = new Float64Array(nfft), logIm = new Float64Array(nfft);
  for (let i = 0; i < nfft; i += 1) {
    const mag = Math.max(1e-12, Math.hypot(re[i]!, im[i]!));
    logRe[i] = Math.log(mag);
  }
  fft(logRe, logIm, true);
  // Causal window: cmin[0]=c[0], cmin[k]=2c[k], cmin[N/2]=c[N/2], rest 0.
  const cw = new Float64Array(nfft), cwIm = new Float64Array(nfft);
  cw[0] = logRe[0]!;
  for (let k = 1; k < nfft / 2; k += 1) cw[k] = 2 * logRe[k]!;
  cw[nfft / 2] = logRe[nfft / 2]!;
  fft(cw, cwIm, false);
  // Exponentiate the complex spectrum.
  const hr = new Float64Array(nfft), hi = new Float64Array(nfft);
  for (let i = 0; i < nfft; i += 1) {
    const e = Math.exp(cw[i]!);
    hr[i] = e * Math.cos(cwIm[i]!); hi[i] = e * Math.sin(cwIm[i]!);
  }
  fft(hr, hi, true);
  const out = new Float64Array(linear.length);
  for (let i = 0; i < linear.length; i += 1) out[i] = hr[i]!;
  // Renormalize DC to exactly 1 (cepstral truncation moves it slightly).
  let sum = 0;
  for (let i = 0; i < out.length; i += 1) sum += out[i]!;
  const s = 1 / sum;
  for (let i = 0; i < out.length; i += 1) out[i]! *= s;
  return out;
}

// ---- IIR half-band stage (Regalia/Mitra two-branch allpass structure) ----
// H(z) = (A0(z^2) + z^-1 A1(z^2)) / 2, each branch a cascade of first-order
// real allpass sections S(z) = (a + z^-1) / (1 + a z^-1), |a| < 1 (stable).
// References: Regalia & Mitra, "Tunable digital frequency response
// equalization filters" (IEEE TASSP 1987) for the tunable two-branch form;
// Vaidyanathan, Multirate Systems and Filter Banks (1993) §5 for the
// half-band power-symmetric decomposition; Oppenheim & Schafer for the
// first-order allpass group-delay formula used in the derivation comments.
export class IIRHalfBandStage2x {
  private readonly a0: readonly number[];
  private readonly a1: readonly number[];
  private x0: Float64Array; private y0: Float64Array;
  private x1: Float64Array; private y1: Float64Array;
  readonly delayHighRate = 0; // no constant delay; latency is measured, not analytic

  constructor(a0: readonly number[], a1: readonly number[]) {
    for (const a of [...a0, ...a1]) {
      if (!(Math.abs(a) < 1)) throw new Error(`IIR half-band needs |a|<1 (got ${a})`);
    }
    this.a0 = a0; this.a1 = a1;
    this.x0 = new Float64Array(a0.length); this.y0 = new Float64Array(a0.length);
    this.x1 = new Float64Array(a1.length); this.y1 = new Float64Array(a1.length);
  }
  reset(): void { this.x0.fill(0); this.y0.fill(0); this.x1.fill(0); this.y1.fill(0); }

  private branch(x: number, a: readonly number[], xs: Float64Array, ys: Float64Array): number {
    let v = x;
    for (let s = 0; s < a.length; s += 1) {
      const c = a[s]!;
      // y = c*x + xPrev - c*yPrev, fixed order for block-split identity.
      const y = c * v + xs[s]! - c * ys[s]!;
      xs[s] = v; ys[s] = y; v = y;
    }
    return v;
  }

  /** Interpolate one input sample into two (gain 2, like the FIR stage). */
  interpolate(x: number, out: Float64Array, at: number): void {
    // Zero-stuffed H(z)X(z²) = [A0(z²)X(z²) + z⁻¹A1(z²)X(z²)]/2 at gain 2:
    // even outputs carry branch 0, odd outputs branch 1, both at low rate.
    out[at] = this.branch(x, this.a0, this.x0, this.y0);
    out[at + 1] = this.branch(x, this.a1, this.x1, this.y1);
  }
  /** Decimate a consecutive pair (even=first/older, odd=second/newer) at gain 1. */
  decimate(first: number, second: number): number {
    return 0.5 * (this.branch(first, this.a0, this.x0, this.y0) + this.branch(second, this.a1, this.x1, this.y1));
  }
}

// D3: 3rd-order maximally-flat (Butterworth) half-band. A0 = bypass,
// A1 = single section with a = 1/3. Derivation: |H(e^jw)|^2 = (1+cos θ)/2
// with θ = w + φ(2w), φ the allpass phase; d|H|²/dw vanishes at w=0 by
// symmetry for any a, and the second derivative vanishes iff θ'(0) = 0,
// i.e. 1 - 2(1-a)/(1+a) = 0, i.e. a = 1/3. Structural -3 dB at π/2 and
// exact zeros at DC-1/Nyquist-0 hold for any a (shown in the report).
export const IIR_D3_A0: readonly number[] = [];
export const IIR_D3_A1: readonly number[] = [1 / 3];

// D5: 5th-order maximally-flat. A0 = [a0], A1 = [a1]; (a0,a1) solve the two
// maximal-flatness equations ψ'(0) = 0 and ψ''(π-ish symmetry) stated in the
// report, found by a deterministic Newton solve in `solveD5()` below
// (no magic table). Solved once here for scratch; the recommended design
// (if IIR) would carry the solver in prepare().
function allpassPhase(a: number, w: number): number {
  // arg((a + e^-jw)/(1 + a e^-jw))
  return Math.atan2((1 - a * a) * -Math.sin(w), (1 + a * a) * Math.cos(w) + 2 * a);
}
export function solveD5(): { a0: number; a1: number } {
  // ψ(w) = φ0(2w) − φ1(2w) − w; |H|² = (1+cosψ)/2.
  // Flatness at 0: ψ'(0) = 0 gives 2(g0−g1) − 1 = 0, g(a) = (1−a)/(1+a).
  // Flatness at π: ψ(π) = −π (H=0); second-order flatness there gives
  // 2(g0'−g1')... second constraint from vanishing 2nd derivative at π:
  // with φ''(0)=0 for first-order sections, next non-trivial condition is
  // ψ'''(0) = 0. Solve the pair by Newton from (0.2, 0.6).
  const g = (a: number) => (1 - a) / (1 + a);
  // d/dw φ(a,2w)|0 = −2g; d³/dw³ φ(a,2w)|0 = −2·(g − g³)·2? derive: φ'''(0) for
  // first-order allpass = −2g(1−g²)·? — computed numerically instead.
  const psi1 = (a0: number, a1: number) => 2 * (g(a0) - g(a1)) - 1;
  const third = (a: number) => {
    const h = 1e-3;
    return (allpassPhase(a, 6 * h) - 3 * allpassPhase(a, 4 * h) + 3 * allpassPhase(a, 2 * h) - allpassPhase(a, 0)) / (8 * h * h * h);
  };
  const psi3 = (a0: number, a1: number) => 8 * (third(a0) - third(a1));
  let a0 = 0.2, a1 = 0.6;
  for (let it = 0; it < 50; it += 1) {
    const e = 1e-5;
    const f1 = psi1(a0, a1), f3 = psi3(a0, a1);
    if (Math.hypot(f1, f3) < 1e-12) break;
    const j11 = (psi1(a0 + e, a1) - f1) / e, j12 = (psi1(a0, a1 + e) - f1) / e;
    const j21 = (psi3(a0 + e, a1) - f3) / e, j22 = (psi3(a0, a1 + e) - f3) / e;
    const det = j11 * j22 - j12 * j21;
    if (Math.abs(det) < 1e-14) break;
    a0 -= (f1 * j22 - f3 * j12) / det;
    a1 -= (j11 * f3 - j21 * f1) / det;
    a0 = Math.min(0.95, Math.max(-0.95, a0));
    a1 = Math.min(0.95, Math.max(-0.95, a1));
  }
  return { a0, a1 };
}

// ---- candidate cascade factory ----
export type Stage = {
  interpolate(x: number, out: Float64Array, at: number): void;
  decimate(first: number, second: number): number;
  reset(): void;
};

export function buildCandidate(id: CandidateId, stages: number): { up: Stage[]; down: Stage[]; label: string; latencyHost: number | null } {
  const fir = (taps: number, beta: number): HalfBandStage2x => new HalfBandStage2x(designHalfBand2x(taps, beta));
  switch (id) {
    case "shipped": {
      const p = designHalfBand2x();
      const mk = () => new HalfBandStage2x(p);
      return { up: Array.from({ length: stages }, mk), down: Array.from({ length: stages }, mk), label: "shipped 57/57/57 β8.3", latencyHost: [27.5, 41.25, 48.125][stages - 1] ?? null };
    }
    case "A": {
      // Stage-specific taps, sized from the alone-scan (§A): the first stage
      // keeps the sharp 19.2–28.8 kHz transition (57 β8.3); later stages work
      // at 2x/4x the rate where the absolute transition is wider, so 29 β7
      // (ripple 0.002 to 30 kHz, stop −38 beyond 60 kHz @192k) and 21 β6
      // (ripple 0.010 to 60 kHz, stop −26 beyond 120 kHz @384k) suffice.
      // What folds where: 192→96 folds [48k,96k] into [0,48k]; content that
      // would land in the 48 kHz host baseband [0,24k] comes from [72k,96k],
      // where the 29-tap stage gives ≥38 dB; 384→192 folds [96k,192k] into
      // [0,96k], and content landing below 60 kHz comes from above 132 kHz,
      // where the 21-tap stage gives ≥26 dB on top of solver harmonic decay.
      // Verified at pedal level (aliasing metric), not just argued.
      const spec: [number, number][] = [[57, 8.3], [29, 7.0], [21, 6.0]];
      const mk = (s: number) => fir(spec[s]![0], spec[s]![1]);
      const up = Array.from({ length: stages }, (_, s) => mk(s));
      const down = Array.from({ length: stages }, (_, s) => mk(s));
      // Mixed-tap latency: Σ (2C_s−1)/2^s.
      let lat = 0;
      for (let s = 0; s < stages; s += 1) { const c = (spec[s]![0] - 1) / 2; lat += (2 * c - 1) / 2 ** (s + 1); }
      return { up, down, label: `A stage-FIR ${spec.slice(0, stages).map(([t, b]) => `${t}β${b}`).join("/")}`, latencyHost: lat };
    }
    case "B": {
      // Relaxed first stage from the knee scan: 41 taps β6.0 gives ripple
      // 0.0076 dB to 19.2 kHz and stopband −61 dB beyond 28.8 kHz @96k —
      // the knee point with margin (37 β5.5 also measured: 0.0099/−59).
      const taps = 41, beta = 6.0;
      const mk = () => fir(taps, beta);
      const c = (taps - 1) / 2;
      return { up: Array.from({ length: stages }, mk), down: Array.from({ length: stages }, mk), label: `B relaxed ${taps} β${beta}`, latencyHost: (2 * c - 1) * (1 - 2 ** -stages) };
    }
    case "C": {
      const minp = minPhaseFromLinear(designHalfBand2x());
      const mk = () => new HalfBandStage2x(minp);
      // NOTE: HalfBandStage2x assumes the half-band zero structure for its
      // fast paths (even passthrough + odd taps). A minimum-phase prototype
      // has NO zero taps, so stuffing it into that class is WRONG. Use the
      // general FIR stage below instead.
      void mk;
      const mkg = () => new GeneralFIRStage(minp);
      return { up: Array.from({ length: stages }, mkg), down: Array.from({ length: stages }, mkg), label: "C min-phase 57 (cepstral)", latencyHost: null };
    }
    case "D3":
      return { up: Array.from({ length: stages }, () => new IIRHalfBandStage2x(IIR_D3_A0, IIR_D3_A1)), down: Array.from({ length: stages }, () => new IIRHalfBandStage2x(IIR_D3_A0, IIR_D3_A1)), label: "D3 IIR a=1/3", latencyHost: null };
    case "D5": {
      const { a0, a1 } = solveD5();
      return { up: Array.from({ length: stages }, () => new IIRHalfBandStage2x([a0], [a1])), down: Array.from({ length: stages }, () => new IIRHalfBandStage2x([a0], [a1])), label: `D5 IIR a0=${a0.toFixed(4)} a1=${a1.toFixed(4)}`, latencyHost: null };
    }
    case "E": {
      const { a0, a1 } = solveD5();
      const up: Stage[] = [fir(57, 8.3)];
      const down: Stage[] = [fir(57, 8.3)];
      for (let s = 1; s < stages; s += 1) { up.push(new IIRHalfBandStage2x([a0], [a1])); down.push(new IIRHalfBandStage2x([a0], [a1])); }
      return { up, down, label: "E hybrid FIR57 + IIR-D5", latencyHost: null };
    }
    case "B37": {
      const taps = 37, beta = 5.5;
      const mk = () => fir(taps, beta);
      const c = (taps - 1) / 2;
      return { up: Array.from({ length: stages }, mk), down: Array.from({ length: stages }, mk), label: `B37 relaxed ${taps} β${beta}`, latencyHost: (2 * c - 1) * (1 - 2 ** -stages) };
    }
    case "AB": {
      // Relaxed sharp-transition first stage + lean later stages.
      const spec: [number, number][] = [[41, 6.0], [29, 7.0], [21, 6.0]];
      const mk = (s: number) => fir(spec[s]![0], spec[s]![1]);
      const up = Array.from({ length: stages }, (_, s) => mk(s));
      const down = Array.from({ length: stages }, (_, s) => mk(s));
      let lat = 0;
      for (let s = 0; s < stages; s += 1) { const c = (spec[s]![0] - 1) / 2; lat += (2 * c - 1) / 2 ** (s + 1); }
      return { up, down, label: `AB ${spec.slice(0, stages).map(([t, b]) => `${t}β${b}`).join("/")}`, latencyHost: lat };
    }
    case "F1": {
      // Deliberately worse prototype (β8.3→3.5): stopband −82→−45 dB.
      const mk = () => fir(57, 3.5);
      return { up: Array.from({ length: stages }, mk), down: Array.from({ length: stages }, mk), label: "F1 worse-β3.5", latencyHost: (2 * 28 - 1) * (1 - 2 ** -stages) };
    }
    case "F2": {
      // D5 with the A1 coefficient dropped (A1 = bypass): magnitude broken.
      const { a0 } = solveD5();
      return { up: Array.from({ length: stages }, () => new IIRHalfBandStage2x([a0], [])), down: Array.from({ length: stages }, () => new IIRHalfBandStage2x([a0], [])), label: "F2 D5-minus-A1", latencyHost: null };
    }
    case "F3": {
      // Polyphase branch order reversed on the way down only (crossed pair):
      // breaks the (2C−1) phase convention -> ripple + delay shift.
      const p = designHalfBand2x();
      return { up: Array.from({ length: stages }, () => new HalfBandStage2x(p)), down: Array.from({ length: stages }, () => new CrossDecimateStage(p)), label: "F3 crossed-decimate", latencyHost: null };
    }
  }
}

/** Crossed-sample decimate (FAILING CONTROL F3): feeds the pair reversed,
 * i.e. the even/odd polyphase routing is swapped on the way down only. */
export class CrossDecimateStage extends HalfBandStage2x {
  override decimate(first: number, second: number): number {
    return super.decimate(second, first);
  }
}

/** General FIR stage (no half-band zero assumption): zero-stuff polyphase,
 * newest-first histories, fixed ascending-k arithmetic order so block splits
 * stay bit-identical. Gain conventions match HalfBandStage2x (up ×2, down ×1).
 * Group delay is C=(L-1)/2 high-rate samples per direction; the true cascade
 * latency is MEASURED (centroid + aligned phase slope), never assumed. */
export class GeneralFIRStage {
  private readonly h: Float64Array;
  private readonly half: number;
  private histU: Float64Array;
  private histD: Float64Array;
  constructor(h: Float64Array) {
    this.h = h;
    this.half = Math.ceil(h.length / 2);
    this.histU = new Float64Array(this.half);
    this.histD = new Float64Array(h.length);
  }
  reset(): void { this.histU.fill(0); this.histD.fill(0); }
  interpolate(x: number, out: Float64Array, at: number): void {
    this.histU.copyWithin(1, 0, this.histU.length - 1);
    this.histU[0] = x;
    // Zero-stuff: zu[2n]=x[n], zu[2n+1]=0; y[m] = 2·Σ_k h[k]·zu[m−k].
    // Even m=2n keeps even k; odd m=2n+1 keeps odd k. Both causal: the odd
    // output needs no future input because odd zu positions are zeros.
    let even = 0;
    for (let j = 0; 2 * j < this.h.length; j += 1) even += this.h[2 * j]! * this.histU[j]!;
    let odd = 0;
    for (let j = 0; 2 * j + 1 < this.h.length; j += 1) odd += this.h[2 * j + 1]! * this.histU[j]!;
    out[at] = 2 * even;
    out[at + 1] = 2 * odd;
  }
  decimate(first: number, second: number): number {
    this.histD.copyWithin(2, 0, this.histD.length - 2);
    this.histD[0] = second; this.histD[1] = first;
    // Direct form at the newest high-rate time: y = Σ_k h[k]·histD[k].
    let acc = 0;
    for (let k = 0; k < this.h.length; k += 1) acc += this.h[k]! * this.histD[k]!;
    return acc;
  }
}
