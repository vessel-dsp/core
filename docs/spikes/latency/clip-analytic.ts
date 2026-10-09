// Known-aliasing case, v2 (leakage-free): band-limited harmonic synthesis.
// Truth = closed-form odd-harmonic amplitudes of the symmetrically
// hard-clipped sine (clip 0.6, f0 2311 Hz). Stimulus synthesized from analytic
// harmonics (no sampling folds in the input by construction):
//  (a) k=1..9 only -> round-trip must preserve each to <=0.02 dB;
//  (b) k=1..19 -> stopband harmonics 11..19 must be suppressed vs naive;
//  naive = take-every-4th of the 4x stream (unfiltered decimation).
import { buildCandidate, type CandidateId, type Stage } from "./candidates";

const F0 = 2311, A_CLIP = 0.6, HOST = 48000;
const analytic = (k: number): number => {
  if (k % 2 === 0) return 0;
  const th0 = Math.asin(A_CLIP);
  // b_k = (4/π)·Ik + (4a/πk)·cos(k·th0), Ik = ∫₀^th0 sinθ·sin kθ dθ
  // (k=1: th0/2 − sin2th0/4; k>1: sin((k−1)th0)/2(k−1) − sin((k+1)th0)/2(k+1)).
  const ik = k === 1
    ? th0 / 2 - Math.sin(2 * th0) / 4
    : Math.sin((k - 1) * th0) / (2 * (k - 1)) - Math.sin((k + 1) * th0) / (2 * (k + 1));
  return (4 / Math.PI) * (ik + (A_CLIP * Math.cos(k * th0)) / k);
};
// Validate the formula by Parseval: RMS of analytic sum k=1..201 vs direct clipped RMS.
{
  let rmsA = 0;
  for (let k = 1; k <= 201; k += 2) rmsA += (Math.abs(analytic(k)) ** 2) / 2;
  // direct: E[clip(sin)²] = (1/π)(∫₀^th0 ... ) closed form:
  const th0 = Math.asin(A_CLIP);
  // E = (2/π)[∫₀^th0 sin² + A²(π/2−th0)] = (2/π)[th0/2 − sin2th0/4 + A²(π/2−th0)]
  const exact = (2 / Math.PI) * (th0 / 2 - Math.sin(2 * th0) / 4 + A_CLIP * A_CLIP * (Math.PI / 2 - th0));
  console.log(`Parseval: analytic-sum RMS² ${rmsA.toFixed(6)} direct exact ${exact.toFixed(6)} (tail k>201: ${(exact - rmsA).toExponential(1)})`);
}
const synth = (ks: number[], n: number): Float64Array => {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let s = 0;
    for (const k of ks) s += analytic(k) * Math.sin((2 * Math.PI * k * F0 * i) / HOST);
    y[i] = s;
  }
  return y;
};
const fitAt = (y: Float64Array, skip: number, f: number): number => {
  let tc = 0, ts = 0, n = 0;
  for (let i = skip; i < y.length; i += 1) {
    const p = (2 * Math.PI * f * i) / HOST;
    tc += y[i]! * Math.cos(p); ts += y[i]! * Math.sin(p); n += 1;
  }
  return (2 * Math.hypot(tc, ts)) / n;
};
const roundTrip = (input: Float64Array, up: Stage[], down: Stage[]): Float64Array => {
  const bufs: Float64Array[] = [new Float64Array(8), new Float64Array(8)];
  const output = new Float64Array(input.length);
  for (let n = 0; n < input.length; n += 1) {
    let cur = bufs[0]!, next = bufs[1]!;
    up[0]!.interpolate(input[n]!, cur, 0);
    let width = 2;
    for (let s = 1; s < up.length; s += 1) {
      for (let i = 0; i < width; i += 1) up[s]!.interpolate(cur[i]!, next, 2 * i);
      [cur, next] = [next, cur]; width *= 2;
    }
    const hi = cur;
    for (let s = up.length - 1; s >= 0; s -= 1) {
      const half = width / 2;
      for (let i = 0; i < half; i += 1) hi[i] = down[s]!.decimate(hi[2 * i]!, hi[2 * i + 1]!);
      width = half;
    }
    output[n] = hi[0]!;
  }
  return output;
};
const SKIP = 6000, N = SKIP + 48000;
const ks9 = [1, 3, 5, 7, 9];
const ksHi = [11, 13, 15, 17, 19];
// Stopband injection AT the high rate (as solver harmonics would appear):
// upsample in-band k<=9, add analytic k=11..19 tones at 192 kHz, decimate.
const upDownInject = (id: CandidateId): { preserve: string; suppress: string; naive: string } => {
  const { up, down } = buildCandidate(id, 2);
  const inA = synth(ks9, N);
  const b0 = new Float64Array(4), b1 = new Float64Array(4);
  const hi = new Float64Array(N * 4);
  let cur = b0, next = b1;
  for (let n = 0; n < N; n += 1) {
    up[0]!.interpolate(inA[n]!, cur, 0);
    for (let i = 0; i < 2; i += 1) up[1]!.interpolate(cur[i]!, next, 2 * i);
    hi.set(next.subarray(0, 4), n * 4);
    const t = cur; cur = next; next = t;
  }
  const deci = (src: Float64Array): Float64Array => {
    const h = Float64Array.from(src);
    let width = N * 4;
    for (let s = 1; s >= 0; s -= 1) {
      const half = width / 2;
      for (let i = 0; i < half; i += 1) h[i] = down[s]!.decimate(h[2 * i]!, h[2 * i + 1]!);
      width = half;
    }
    return h.subarray(0, N);
  };
  const outA = deci(hi);
  const pa = ks9.map((k) => `${k}:${(20 * Math.log10(fitAt(outA, SKIP, k * F0) / Math.abs(analytic(k)))).toFixed(3)}`).join(" ");
  const noisy = Float64Array.from(hi);
  for (let i = 0; i < noisy.length; i += 1) {
    let s = 0;
    for (const k of ksHi) s += analytic(k) * Math.sin((2 * Math.PI * k * F0 * i) / 192000);
    noisy[i] += s;
  }
  const naive = new Float64Array(N);
  for (let i = 0; i < N; i += 1) naive[i] = noisy[i * 4]!;
  const outB = deci(noisy);
  const atFold = (k: number): number => {
    const f = k * F0, q = Math.round(f / HOST), ff = Math.abs(f - q * HOST);
    return ff > HOST / 2 ? HOST - ff : ff;
  };
  const sb = ksHi.map((k) => `${k}->${(atFold(k) / 1000).toFixed(1)}k:${fitAt(outB, SKIP, atFold(k)).toExponential(1)}`).join(" ");
  const nv = ksHi.map((k) => `${k}:${fitAt(naive, SKIP, atFold(k)).toExponential(1)}`).join(" ");
  up.forEach((s) => s.reset()); down.forEach((s) => s.reset());
  return { preserve: pa, suppress: sb, naive: nv };
};
for (const id of ["shipped", "A", "B", "C", "D5", "F1", "F2", "F3"] as CandidateId[]) {
  const r = upDownInject(id);
  console.log(`${id} preserve[${r.preserve}] suppress[${r.suppress}] naive[${r.naive}]`);
}
