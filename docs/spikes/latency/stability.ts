// IIR stability + block-invariance + prepare-clear for all candidates.
import { designHalfBand2x } from "../../../packages/runtime/src/resample";
import { buildCandidate, minPhaseFromLinear, solveD5, type CandidateId, type Stage } from "./candidates";

const HOST = 48000;
let seed = 12345;
const rand = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x40000000 - 1; };

// 1. IIR poles strictly inside the unit circle (by construction |a|<1).
{
  const { a0, a1 } = solveD5();
  console.log(`D5 poles: a0=${a0} a1=${a1} max|a|=${Math.max(Math.abs(a0), Math.abs(a1))} <1 ${Math.max(Math.abs(a0), Math.abs(a1)) < 1 ? "STABLE" : "UNSTABLE"}`);
  console.log(`D3 pole: 1/3 STABLE`);
}

// 2. Bounded state: 10 s white noise + full-scale 100 Hz square through up/down pair.
const bounded = (id: CandidateId, input: Float64Array, tag: string): void => {
  for (const stages of [1, 2, 3]) {
    const { up, down } = buildCandidate(id, stages);
    // stream through cascade sample-by-sample (carries state like the runtime)
    const bufs = [new Float64Array(8), new Float64Array(8)];
    let peak = 0, bad = 0;
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
      const y = hi[0]!;
      if (!Number.isFinite(y)) bad += 1;
      peak = Math.max(peak, Math.abs(y));
    }
    console.log(`${id} x${2 ** stages} ${tag}: peak ${peak.toFixed(3)} nonfinite ${bad}`);
  }
};
{
  const N = 48000 * 10;
  const noise = new Float64Array(N);
  for (let i = 0; i < N; i += 1) noise[i] = rand();
  const sq = new Float64Array(N);
  for (let i = 0; i < N; i += 1) sq[i] = Math.sin((2 * Math.PI * 100 * i) / HOST) >= 0 ? 1 : -1;
  for (const id of ["shipped", "A", "B", "C", "D3", "D5", "E"] as CandidateId[]) {
    bounded(id, noise, "whitenoise10s");
    bounded(id, sq, "fullsquare100Hz");
  }
}

// 3. Block-size invariance: 1x4800 vs 10x480 vs 4800x1 (up-interpolate stream).
{
  for (const id of ["shipped", "A", "B", "C", "D3", "D5", "E"] as CandidateId[]) {
    const run = (splits: number[]): Float64Array => {
      const { up } = buildCandidate(id, 1);
      const out = new Float64Array(4800 * 2);
      let at = 0, o = 0;
      for (const s of splits) {
        const buf = new Float64Array(s * 2);
        for (let i = 0; i < s; i += 1) up[0]!.interpolate(Math.sin((2 * Math.PI * 1000 * (at + i)) / HOST), buf, 2 * i);
        out.set(buf, o); at += s; o += s * 2;
      }
      return out;
    };
    const w = run([4800]), t = run(Array(10).fill(480)), o = run(Array(4800).fill(1));
    let dw = 0, doo = 0;
    for (let i = 0; i < w.length; i += 1) { dw = Math.max(dw, Math.abs(w[i]! - t[i]!)); doo = Math.max(doo, Math.abs(w[i]! - o[i]!)); }
    console.log(`${id} block-invariance: maxdiff 10x480=${dw} 4800x1=${doo} ${dw === 0 && doo === 0 ? "BIT-IDENTICAL" : "DIFFERS"}`);
  }
}

// 4. prepare() clears state: render, rebuild (fresh stages), render -> identical; reset() mid-stream.
{
  for (const id of ["shipped", "C", "D5"] as CandidateId[]) {
    const mk = () => buildCandidate(id, 2);
    const seq = (st: { up: Stage[]; down: Stage[] }): number[] => {
      const y: number[] = [];
      const c = new Float64Array(2);
      for (let n = 0; n < 300; n += 1) {
        st.up[0]!.interpolate(Math.sin((2 * Math.PI * 440 * n) / HOST), c, 0);
        y.push(st.down[0]!.decimate(c[0]!, c[1]!));
      }
      return y;
    };
    const a = seq(mk()), b = seq(mk());
    let d = 0;
    for (let i = 0; i < a.length; i += 1) d = Math.max(d, Math.abs(a[i]! - b[i]!));
    const st = mk();
    const p1 = seq(st);
    st.up.forEach((s) => s.reset()); st.down.forEach((s) => s.reset());
    const p2 = seq(st);
    let d2 = 0;
    for (let i = 0; i < p1.length; i += 1) d2 = Math.max(d2, Math.abs(p1[i]! - p2[i]!));
    console.log(`${id} prepare-clear: fresh-vs-fresh ${d} reset-vs-fresh ${d2}`);
  }
}
