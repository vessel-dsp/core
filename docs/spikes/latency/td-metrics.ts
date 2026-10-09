// Time-domain phase metrics, v2 (fixed correlation + alignment direction).
import { readFileSync } from "node:fs";
const [pedal, candTag] = process.argv.slice(2) as [string, string];
const HOST = 48_000, NAT = 192000;

const load = (p: string): Float64Array => {
  const buf = readFileSync(p);
  return new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
};
const toHost = (x: Float64Array): Float64Array => {
  const n = Math.round((x.length * HOST) / NAT);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const pos = (i * NAT) / HOST;
    const i0 = Math.floor(pos), f = pos - i0;
    y[i] = (x[i0] ?? 0) * (1 - f) + (x[Math.min(x.length - 1, i0 + 1)] ?? 0) * f;
  }
  return y;
};
// Normalized cross-correlation; candidate is delayed by D => peak at lag=+D.
const ncorr = (a: Float64Array, b: Float64Array, lag: number): number => {
  const i0 = Math.max(0, -lag), i1 = Math.min(a.length, b.length - lag);
  let sab = 0, saa = 0, sbb = 0;
  for (let i = i0; i < i1; i += 1) {
    const x = a[i]!, y = b[i + lag]!;
    sab += x * y; saa += x * x; sbb += y * y;
  }
  return sab / Math.sqrt(saa * sbb || 1e-30);
};
const linShift = (x: Float64Array, shift: number): Float64Array => {
  // Advance x by `shift` samples (shift>0 undoes a delay): y[i] = x[i+shift].
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
const fftShiftAdvance = (x: Float64Array, adv: number): Float64Array => {
  const n = x.length;
  let N = 1; while (N < n) N <<= 1;
  const re = new Float64Array(N), im = new Float64Array(N);
  re.set(x);
  const fft = (re: Float64Array, im: Float64Array, inv: boolean): void => {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i += 1) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { const t = re[i]!; re[i] = re[j]!; re[j] = t; const u = im[i]!; im[i] = im[j]!; im[j] = u; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = ((inv ? 2 : -2) * Math.PI) / len;
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
    if (inv) for (let i = 0; i < n; i += 1) { re[i]! /= n; im[i]! /= n; }
  };
  fft(re, im, false);
  for (let k = 0; k < N; k += 1) {
    const f = k <= N / 2 ? k : k - N;
    const p = (2 * Math.PI * f * adv) / N; // advance: y[i]=x[i+adv]
    const c = Math.cos(p), s = Math.sin(p);
    const nr = re[k]! * c - im[k]! * s, ni = re[k]! * s + im[k]! * c;
    re[k] = nr; im[k] = ni;
  }
  fft(re, im, true);
  return re.subarray(0, n);
};
const relRmsOf = (a: Float64Array, b: Float64Array, trim: number, tailTrim = 0): { rel: number; mx: number; pk: number } => {
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
const lsFundHarm = (x: Float64Array, fs: number, f0: number, nh: number): number[] => {
  const n = x.length, m = 1 + 2 * nh;
  const cols: Float64Array[] = [new Float64Array(n).fill(1)];
  for (let h = 1; h <= nh; h++) {
    const c = new Float64Array(n), s = new Float64Array(n);
    for (let i = 0; i < n; i++) { const p = (2 * Math.PI * f0 * h * i) / fs; c[i] = Math.cos(p); s[i] = Math.sin(p); }
    cols.push(c, s);
  }
  const A = Array.from({ length: m }, () => new Float64Array(m + 1));
  for (let a = 0; a < m; a++) {
    for (let b = a; b < m; b++) { let t = 0; for (let i = 0; i < n; i++) t += cols[a]![i]! * cols[b]![i]!; A[a]![b] = t; A[b]![a] = t; }
    let t = 0; for (let i = 0; i < n; i++) t += cols[a]![i]! * x[i]!; A[a]![m] = t;
  }
  for (let i = 0; i < m; i++) {
    let p = i; for (let r = i + 1; r < m; r++) if (Math.abs(A[r]![i]!) > Math.abs(A[p]![i]!)) p = r;
    [A[i], A[p]] = [A[p]!, A[i]!];
    for (let r = i + 1; r < m; r++) { const f = A[r]![i]! / A[i]![i]!; for (let c = i; c <= m; c++) A[r]![c]! -= f * A[i]![c]!; }
  }
  const coef = new Float64Array(m);
  for (let i = m - 1; i >= 0; i--) { let t = A[i]![m]!; for (let c = i + 1; c < m; c++) t -= A[i]![c]! * coef[c]!; coef[i] = t / A[i]![i]!; }
  return Array.from({ length: nh }, (_, h) => Math.hypot(coef[1 + 2 * h]!, coef[2 + 2 * h]!));
};

const PERIOD: Record<string, number> = { "two-tone": HOST / 440, pluck: HOST / 110, burst: HOST / 110, sine1k: HOST / 1000 };

const measure = (stim: string): { lag: number; bc: number } | null => {
  try {
    const nat = toHost(load(`/tmp/lat/wav/${pedal}-${stim}-n192.bin`));
    const cand = load(`/tmp/lat/wav/${pedal}-${stim}-${candTag}.bin`);
    return { lag: 0, bc: 0 };
  } catch { return null; }
};
void measure;

const loadPair = (stim: string): { aa: Float64Array; bb: Float64Array } => {
  const nat = toHost(load(`/tmp/lat/wav/${pedal}-${stim}-n192.bin`));
  const cand = load(`/tmp/lat/wav/${pedal}-${stim}-${candTag}.bin`);
  const n = Math.min(nat.length, cand.length);
  const a = nat.subarray(0, n), b = cand.subarray(0, n);
  const skip = stim === "pluck" || stim === "burst" ? 0 : Math.floor(0.4 * HOST);
  return { aa: a.subarray(skip), bb: b.subarray(skip) };
};

// Anchor: pluck onset (broadband, non-periodic) gives the unambiguous delay.
const { aa: pa, bb: pb } = loadPair("pluck");
let anchor = 0, bcA = -Infinity;
for (let lag = -120; lag <= 120; lag += 1) {
  const c = ncorr(pa, pb, lag);
  if (c > bcA) { bcA = c; anchor = lag; }
}

for (const stim of ["two-tone", "pluck", "burst", "sine1k"]) {
  const { aa, bb } = loadPair(stim);
  // Candidates: anchor and its period-aliases (±3 periods); pick by min relRMS.
  // Windowed to [-5, 70] host samples: the candidate path is causal (it can
  // only delay native, never lead it) and every candidate's latency is < 70
  // host samples by construction; the pluck anchor must fall inside, else the
  // run is flagged. This removes period-alias picks on periodic stimuli.
  const P = PERIOD[stim]!;
  let lag = anchor, br = Infinity, bc = -Infinity;
  for (let k = -3; k <= 3; k += 1) {
    const base = anchor + k * P;
    if (base < -5 || base > 70) continue;
    for (let d = -1; d <= 1.001; d += 0.2) {
      // Tail-trim the FFT-wrap margin during search too (linear shift has no
      // wrap, but keep the comparison window identical to the final one).
      const r = relRmsOf(aa, linShift(bb, base + d), 600, 300).rel;
      if (r < br) { br = r; lag = base + d; bc = ncorr(aa, bb, Math.round(lag)); }
    }
  }
  // Final alignment: exact FFT advance, then trim head (settle) AND tail
  // (circular-wrap margin |lag|+100) so edge artifacts enter no metric.
  const shifted = fftShiftAdvance(bb, lag);
  const edge = 600, tailAbs = Math.ceil(Math.abs(lag)) + 100;
  const { rel, mx, pk } = relRmsOf(aa, shifted, edge, tailAbs);
  // tail metric: t > 0.35 s past window start (past the attack for pluck/burst)
  const t350 = Math.floor(0.35 * HOST);
  const tail = t350 + 4096 < aa.length - tailAbs ? relRmsOf(aa.subarray(t350), shifted.subarray(t350), 600, tailAbs) : null;
  const f0 = stim === "sine1k" ? 1000 : stim === "two-tone" ? 440 : 110;
  const nh = stim === "sine1k" ? 8 : stim === "two-tone" ? 3 : 8;
  const win = 8192;
  const segA = aa.subarray(edge, edge + win), segB = shifted.subarray(edge, edge + win);
  const ha = lsFundHarm(segA, HOST, f0, nh), hb = lsFundHarm(segB, HOST, f0, nh);
  const diffs = ha.map((v, i) => 20 * Math.log10((hb[i]! || 1e-18) / (v || 1e-18)));
  console.log(`${pedal} ${stim} ${candTag}: lag ${lag.toFixed(2)} (ncorr ${bc.toFixed(6)}) relRMS ${(100 * rel).toFixed(3)}%${tail ? ` tail ${(100 * tail.rel).toFixed(3)}%` : ""} maxAbs ${mx.toExponential(2)} (${(20 * Math.log10(mx / pk)).toFixed(1)} dBpk) dHarm[${diffs.map((d) => d.toFixed(3)).join(" ")}]`);
}
console.log(`anchor(pluck): ${anchor.toFixed(2)} ncorr ${bcA.toFixed(6)}`);
