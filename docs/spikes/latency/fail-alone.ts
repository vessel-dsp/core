// Failing controls (alone-level): F1 halved stopband, F2 dropped allpass
// coefficient, F3 crossed decimation. Each must fail LOUDLY at unit level.
import { designHalfBand2x } from "../../../packages/runtime/src/resample";
import { buildCandidate, type Stage } from "./candidates";

const HOST = 48000;
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

// F1: 30 kHz tone into 96->48 decimation, 18 kHz fold level (shipped: -92 dB).
{
  const dtft = (h: Float64Array, f: number): number => {
    let re = 0, im = 0;
    for (let i = 0; i < h.length; i += 1) {
      const p = (2 * Math.PI * f * i) / 96000;
      re += h[i]! * Math.cos(p); im -= h[i]! * Math.sin(p);
    }
    return 20 * Math.log10(Math.hypot(re, im));
  };
  console.log(`F1 prototype stopband at 30 kHz: ${dtft(designHalfBand2x(57, 3.5), 30000).toFixed(1)} dB (shipped ${dtft(designHalfBand2x(), 30000).toFixed(1)} dB)`);
  for (const id of ["shipped", "F1"] as const) {
    const { up, down } = buildCandidate(id, 1);
    void up;
    // decimate-only fold test through the DOWN stage at the 96 kHz rate
    const N = 9600;
    const out = new Float64Array(N / 2);
    const st = down[0]!;
    for (let i = 0; i < N / 2; i += 1) {
      out[i] = st.decimate(Math.sin((2 * Math.PI * 30000 * (2 * i)) / 96000), Math.sin((2 * Math.PI * 30000 * (2 * i + 1)) / 96000));
    }
    const folded = fitFund(out.subarray(200), 18000);
    console.log(`${id} 30k->18k fold: ${(20 * Math.log10(folded)).toFixed(1)} dB`);
  }
}
// F2/F3: round-trip swept-sine gain (must deviate from 0 dB).
for (const id of ["shipped", "F2", "F3"] as const) {
  const { up, down } = buildCandidate(id, 2);
  const gains: string[] = [];
  for (const f of [1000, 4000, 8000, 16000]) {
    const skip = 6000, n = Math.round((40 * HOST) / f);
    const input = new Float64Array(skip + n);
    for (let i = 0; i < input.length; i += 1) input[i] = Math.sin((2 * Math.PI * f * i) / HOST);
    const w = roundTrip(input, up, down).subarray(skip);
    gains.push(`${f}:${(20 * Math.log10(fitFund(w, f))).toFixed(2)}`);
    up.forEach((s) => s.reset()); down.forEach((s) => s.reset());
  }
  console.log(`${id} x4 round-trip: ${gains.join(" ")}`);
}
