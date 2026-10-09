// Cost: resampler ns per host sample per candidate (5 interleaved repeats)
// + total ns per host sample for Muff and SD-1 at os4 (external cascade).
import { readFileSync } from "node:fs";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import { buildCandidate, type CandidateId } from "./candidates";

const HOST = 48000;
// resampler-alone: round-trip 4800 host samples through x2 stages, timed
const timeResampler = (id: CandidateId, stages: number): number => {
  const { up, down } = buildCandidate(id, stages);
  const input = new Float64Array(4800);
  for (let i = 0; i < input.length; i += 1) input[i] = 0.3 * Math.sin((2 * Math.PI * 1000 * i) / HOST);
  const bufs: Float64Array[] = [new Float64Array(8), new Float64Array(8)];
  const t0 = performance.now();
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
  }
  return ((performance.now() - t0) * 1e6) / input.length; // ns per host sample
};
const IDS: CandidateId[] = ["shipped", "A", "B", "AB", "C", "D5", "E"];
for (let rep = 0; rep < 5; rep += 1) {
  for (const id of IDS) {
    for (const stages of [1, 2, 3]) {
      console.log(`resampler id=${id} stages=${stages} rep=${rep} ns=${timeResampler(id, stages).toFixed(1)}`);
    }
  }
}
// totals: muff + sd1 at os4, 1 s 1 kHz 10 mV, process()-only external cascade
const PATHS: Record<string, string> = {
  muff: "/home/joseph/projects/VesselDSP/workbench/packet-study/big-muff-ec3003-rev-f/big-muff-ec3003-rev-f.vdsp",
  sd1: "/home/joseph/projects/VesselDSP/workbench/packet-study/boss-sd-1-et521-5108/variants/boss-sd-1.at-9v17.vdsp",
};
const CTRLS: Record<string, string> = { muff: "SUSTAIN=0.5,TONE=0.5,VOLUME=0.3", sd1: "Drive=0.5,Tone=0.5,Level=0.3" };
const PROGS: Record<string, never> = {};
for (const pedal of ["muff", "sd1"]) {
  const src = readFileSync(PATHS[pedal]!, "utf8");
  const r = compile(src, { registry: pedalPartCatalog } as never) as { status: string; program: never };
  if (r.status !== "ok") throw new Error("no compile");
  PROGS[pedal] = r.program;
}
for (let rep = 0; rep < 3; rep += 1) {
  for (const pedal of ["muff", "sd1"]) {
    for (const id of IDS) {
      const { up, down } = buildCandidate(id, 2);
      const nHost = HOST;
      const input = new Float64Array(nHost);
      for (let i = 0; i < nHost; i += 1) input[i] = 0.01 * Math.sin((2 * Math.PI * 1000 * i) / HOST);
      const t0 = performance.now();
      // upsample
      const b0 = new Float64Array(4), b1 = new Float64Array(4);
      const hi = new Float64Array(nHost * 4);
      let cur = b0, next = b1;
      for (let n = 0; n < nHost; n += 1) {
        up[0]!.interpolate(input[n]!, cur, 0);
        for (let i = 0; i < 2; i += 1) up[1]!.interpolate(cur[i]!, next, 2 * i);
        hi.set(next.subarray(0, 4), n * 4);
        const t = cur; cur = next; next = t;
      }
      const rt = new ReferenceRuntime(PROGS[pedal]!);
      rt.prepare(HOST * 4, { inputSourceOhms: 94 });
      for (const kv of CTRLS[pedal]!.split(",")) { const [k, v] = kv.split("="); rt.setControl(k!, Number(v)); }
      const hiOut = new Float64Array(nHost * 4);
      for (let i = 0; i < hi.length; i += 2048) hiOut.set(rt.process(hi.subarray(i, Math.min(hi.length, i + 2048))), i);
      const h = Float64Array.from(hiOut);
      let width = nHost * 4;
      for (let s = 1; s >= 0; s -= 1) {
        const half = width / 2;
        for (let i = 0; i < half; i += 1) h[i] = down[s]!.decimate(h[2 * i]!, h[2 * i + 1]!);
        width = half;
      }
      const ns = ((performance.now() - t0) * 1e6) / nHost;
      console.log(`total pedal=${pedal} id=${id} rep=${rep} ns=${ns.toFixed(0)}`);
    }
  }
}
