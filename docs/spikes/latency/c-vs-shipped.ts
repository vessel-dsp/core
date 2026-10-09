// Direct candidate-vs-shipped waveform comparison (isolates the candidate's
// own cost from the shared native-residual floor). Same alignment machinery
// as td-metrics; reports C-vs-shipped and B-vs-shipped per stimulus.
// Usage: bun c-vs-shipped.ts <pedal> <candTag>   (e.g. C-os4)
import { readFileSync } from "node:fs";
const [pedal, candTag] = process.argv.slice(2) as [string, string];
const HOST = 48_000;
const load = (p: string): Float64Array => {
  const buf = readFileSync(p);
  return new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
};
const ncorr = (a: Float64Array, b: Float64Array, lag: number): number => {
  const i0 = Math.max(0, -lag), i1 = Math.min(a.length, b.length - lag);
  let sab = 0, saa = 0, sbb = 0;
  for (let i = i0; i < i1; i += 1) {
    const x = a[i]!, y = b[i + lag]!;
    sab += x * y; saa += x * x; sbb += y * y;
  }
  return sab / Math.sqrt(saa * sbb || 1e-30);
};
// fractional advance via linear interp (search) — final numbers use correlative lag only
const linShift = (x: Float64Array, shift: number): Float64Array => {
  const y = new Float64Array(x.length);
  for (let i = 0; i < x.length; i += 1) {
    const pos = i + shift;
    const i0 = Math.floor(pos), f = pos - i0;
    const v0 = (i0 >= 0 && i0 < x.length ? x[i0]! : 0);
    const v1 = (i0 + 1 >= 0 && i0 + 1 < x.length ? x[i0 + 1]! : 0);
    y[i] = v0 * (1 - f) + v1 * f;
  }
  return y;
};
const relRmsOf = (a: Float64Array, b: Float64Array, trim: number, tailTrim = 0) => {
  const L = Math.min(a.length, b.length) - trim - tailTrim;
  let num = 0, den = 0, mx = 0, pk = 0;
  for (let i = trim; i < trim + L; i += 1) {
    const e = a[i]! - b[i]!;
    num += e * e; den += a[i]! * a[i]!;
    if (Math.abs(e) > mx) mx = Math.abs(e);
    if (Math.abs(a[i]!) > pk) pk = Math.abs(a[i]!);
  }
  return { rel: Math.sqrt(num / den), mx, pk };
};
for (const stim of ["two-tone", "pluck", "burst", "sine1k"]) {
  const ref = load(`/tmp/lat/wav/${pedal}-${stim}-shipped-os4.bin`);
  const cand = load(`/tmp/lat/wav/${pedal}-${stim}-${candTag}.bin`);
  const n = Math.min(ref.length, cand.length);
  const a = ref.subarray(0, n), b = cand.subarray(0, n);
  const skip = stim === "pluck" || stim === "burst" ? 0 : Math.floor(0.4 * HOST);
  const aa = a.subarray(skip), bb = b.subarray(skip);
  // expected relative advance: cand leads shipped by (41.25 − candLat);
  // advance cand by −(that) to align. Search ±15 around it.
  const guessMap: Record<string, number> = { "A-os4": -7, "B-os4": -12, "C-os4": -37.5, "AB-os4": -15 };
  const guess = guessMap[candTag] ?? 0;
  let lag = guess, br = Infinity;
  for (let d = -15; d <= 15.001; d += 0.25) {
    const r = relRmsOf(aa, linShift(bb, guess + d), 600, 300).rel;
    if (r < br) { br = r; lag = guess + d; }
  }
  const { rel, mx, pk } = relRmsOf(aa, linShift(bb, lag), 600, 300);
  console.log(`${pedal} ${stim} ${candTag}-vs-shipped: dlag ${lag.toFixed(2)} relRMS ${(100 * rel).toFixed(3)}% maxAbs ${(20 * Math.log10(mx / pk)).toFixed(1)} dBpk`);
}
