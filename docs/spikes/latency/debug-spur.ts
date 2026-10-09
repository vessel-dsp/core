// Debug: polyphase DC balance + spur levels for C (min-phase) and D5 (IIR).
import { designHalfBand2x } from "../../../packages/runtime/src/resample";
import { buildCandidate, minPhaseFromLinear, type Stage } from "./candidates";

const HOST = 48_000;
const roundTrip = (input: Float64Array, up: Stage[], down: Stage[]): Float64Array => {
  const stages = up.length;
  const bufs: Float64Array[] = [new Float64Array(8), new Float64Array(8)];
  const output = new Float64Array(input.length);
  for (let n = 0; n < input.length; n += 1) {
    let cur = bufs[0]!, next = bufs[1]!;
    up[0]!.interpolate(input[n]!, cur, 0);
    let width = 2;
    for (let s = 1; s < stages; s += 1) {
      for (let i = 0; i < width; i += 1) up[s]!.interpolate(cur[i]!, next, 2 * i);
      [cur, next] = [next, cur]; width *= 2;
    }
    const hi = cur;
    for (let s = stages - 1; s >= 0; s -= 1) {
      const half = width / 2;
      for (let i = 0; i < half; i += 1) hi[i] = down[s]!.decimate(hi[2 * i]!, hi[2 * i + 1]!);
      width = half;
    }
    output[n] = hi[0]!;
  }
  return output;
};

// DC balance of the min-phase prototype's even/odd polyphase
{
  const minp = minPhaseFromLinear(designHalfBand2x());
  let se = 0, so = 0;
  for (let j = 0; 2 * j < minp.length; j += 1) se += minp[2 * j]!;
  for (let j = 0; 2 * j + 1 < minp.length; j += 1) so += minp[2 * j + 1]!;
  console.log(`C polyphase DC: even ${se.toFixed(6)} odd ${so.toFixed(6)} (half-band would be 0.5/0.5; imbalance ${(se - 0.5).toFixed(6)})`);
}

// DC input -> DC output + 24k spur, single 2x stage
for (const id of ["shipped", "C", "D5"] as const) {
  const { up, down } = buildCandidate(id, 1);
  const N = 6000;
  const input = new Float64Array(N).fill(1);
  const out = roundTrip(input, up, down).subarray(2000);
  let mean = 0;
  for (const v of out) mean += v! / out.length;
  // 24k alternating component
  let alt = 0;
  for (let i = 0; i < out.length; i += 1) alt += (i % 2 === 0 ? 1 : -1) * out[i]! / out.length;
  console.log(`${id} DC: mean ${mean.toFixed(6)} 24k-spur ${alt.toFixed(6)} (${(20 * Math.log10(Math.abs(alt) || 1e-18)).toFixed(1)} dB)`);
}

// Sine in -> fundamental + worst spur (whole-period window, per-freq buffers)
const fitFund = (y: Float64Array, f: number): number => {
  let cc = 0, cs = 0, ss = 0, tc = 0, ts = 0;
  for (let i = 0; i < y.length; i += 1) {
    const p = (2 * Math.PI * f * i) / HOST;
    const c = Math.cos(p), s = Math.sin(p);
    cc += c * c; cs += c * s; ss += s * s; tc += y[i]! * c; ts += y[i]! * s;
  }
  const det = cc * ss - cs * cs;
  return Math.hypot((tc * ss - ts * cs) / det, (cc * ts - cs * tc) / det);
};
for (const id of ["shipped", "C", "D5"] as const) {
  for (const f of [1000, 8000]) {
    const { up, down } = buildCandidate(id, 1);
    const periods = 40, skip = 6000;
    const n = Math.round((periods * HOST) / f);
    const input = new Float64Array(skip + n);
    for (let i = 0; i < input.length; i += 1) input[i] = Math.sin((2 * Math.PI * f * i) / HOST);
    const out = roundTrip(input, up, down).subarray(skip);
    const fund = fitFund(out, f);
    // residual after removing best-fit fundamental (any spur/distortion)
    let cc = 0, cs = 0, ss = 0, tc = 0, ts = 0;
    for (let i = 0; i < out.length; i += 1) {
      const p = (2 * Math.PI * f * i) / HOST;
      const c = Math.cos(p), s = Math.sin(p);
      cc += c * c; cs += c * s; ss += s * s; tc += out[i]! * c; ts += out[i]! * s;
    }
    const det = cc * ss - cs * cs;
    const a = (tc * ss - ts * cs) / det, b = (cc * ts - cs * tc) / det;
    let resid = 0;
    for (let i = 0; i < out.length; i += 1) {
      const p = (2 * Math.PI * f * i) / HOST;
      const e = out[i]! - (a * Math.cos(p) + b * Math.sin(p));
      resid += (e * e) / out.length;
    }
    console.log(`${id} ${f}Hz x2: fundGain ${(20 * Math.log10(fund)).toFixed(3)} dB  residual ${(20 * Math.log10(Math.sqrt(resid) / fund)).toFixed(1)} dBc`);
  }
}
