// Verify external cascade == internal osN for the shipped design.
import { readFileSync } from "node:fs";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import { buildCandidate } from "./candidates";
const src = readFileSync("/home/joseph/projects/VesselDSP/workbench/packet-study/boss-sd-1-et521-5108/variants/boss-sd-1.at-9v17.vdsp", "utf8");
const r = compile(src, { registry: pedalPartCatalog } as never) as { status: string; program: never };
const HOST = 48000, N = 480;
const input = new Float64Array(N);
for (let i = 0; i < N; i++) input[i] = 0.01 * Math.sin((2 * Math.PI * 1000 * i) / HOST);
const ctrls = "Drive=0.5,Tone=0.5,Level=0.3";
const mk = () => {
  const rt = new ReferenceRuntime(r.program);
  return rt;
};
// internal os4
const a = mk(); a.prepare(HOST, { inputSourceOhms: 94, oversample: 4 });
for (const kv of ctrls.split(",")) { const [k, v] = kv.split("="); a.setControl(k!, Number(v)); }
const outA = a.process(input);
// external
const { up, down } = buildCandidate("shipped", 2);
const hi = new Float64Array(N * 4);
{
  const bufs = [new Float64Array(4), new Float64Array(4)];
  for (let n = 0; n < N; n += 1) {
    let cur = bufs[0]!, next = bufs[1]!;
    up[0]!.interpolate(input[n]!, cur, 0);
    for (let i = 0; i < 2; i += 1) up[1]!.interpolate(cur[i]!, next, 2 * i);
    hi.set(next.subarray(0, 4), n * 4);
  }
}
const b = mk(); b.prepare(HOST * 4, { inputSourceOhms: 94 });
for (const kv of ctrls.split(",")) { const [k, v] = kv.split("="); b.setControl(k!, Number(v)); }
const hiOut = b.process(hi);
const outB = new Float64Array(N);
{
  const h = Float64Array.from(hiOut);
  for (let s = 1; s >= 0; s -= 1) {
    const half = h.length / 2 ** (2 - s) / 2 * 2; // widths: 1920 -> 960 -> 480
    void half;
  }
  let width = N * 4;
  for (let s = down.length - 1; s >= 0; s -= 1) {
    const half = width / 2;
    for (let i = 0; i < half; i += 1) h[i] = down[s]!.decimate(h[2 * i]!, h[2 * i + 1]!);
    width = half;
  }
  outB.set(h.subarray(0, N));
}
let maxd = 0;
for (let i = 0; i < N; i += 1) maxd = Math.max(maxd, Math.abs(outA[i]! - outB[i]!));
console.log(`max abs diff internal-vs-external os4: ${maxd}`);
