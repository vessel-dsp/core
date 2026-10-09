// No-reactive control (4b): resistive divider os4 == x1 within the resampler's
// own passband behaviour; factor-1 bit-identical (hash).
import { createHash } from "node:crypto";
import { compile, emptyRegistry } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import { buildCandidate, type CandidateId } from "./candidates";

const vdsp = `schema: circuit-interchange/v3
metadata:
  name: "Div"
  description: "Resistive divider."
  partNumber: ""
source:
  format: vdsp
  filename: div.vdsp
components:
  - id: JIN
    kind: jack
    name: INPUT
    sourceTypeName: Circuit.Input
    origin:
      x: -200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: -200
          y: 0
  - id: JOUT
    kind: jack
    name: OUTPUT
    sourceTypeName: Circuit.Output
    origin:
      x: 200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 200
          y: 0
  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: gnd
        node: 0
        position:
          x: 0
          y: -100
  - id: R1
    kind: resistor
    name: R1
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: 0
          y: 0
      - name: b
        node: 2
        position:
          x: 0
          y: 0
    properties:
      Resistance: "10k"
  - id: R2
    kind: resistor
    name: R2
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 0
          y: 0
      - name: b
        node: 0
        position:
          x: 0
          y: 0
    properties:
      Resistance: "10k"
`;
const compiled = compile(vdsp, { registry: emptyRegistry });
if (compiled.status !== "ok") throw new Error("no compile");
const fund = (y: Float64Array, fs: number, f: number): number => {
  let cc = 0, cs = 0, ss = 0, tc = 0, ts = 0;
  for (let i = 0; i < y.length; i += 1) {
    const p = (2 * Math.PI * f * i) / fs;
    const c = Math.cos(p), s = Math.sin(p);
    cc += c * c; cs += c * s; ss += s * s; tc += y[i]! * c; ts += y[i]! * s;
  }
  const det = cc * ss - cs * cs;
  return Math.hypot((tc * ss - ts * cs) / det, (cc * ts - cs * tc) / det);
};
// factor-1 bit-identical hash
{
  const input = new Float64Array(4800);
  for (let i = 0; i < input.length; i += 1) input[i] = 0.3 * Math.sin((2 * Math.PI * 1000 * i) / 48000);
  const a = new ReferenceRuntime(compiled.program); a.prepare(48000, {});
  const b = new ReferenceRuntime(compiled.program); b.prepare(48000, { oversample: 1 });
  const ha = createHash("sha256").update(Buffer.from(a.process(input).buffer)).digest("hex");
  const hb = createHash("sha256").update(Buffer.from(b.process(input).buffer)).digest("hex");
  console.log(`factor1 absent-vs-explicit hash ${ha.slice(0, 16)}... ${ha === hb ? "IDENTICAL" : "DIFFERS"}`);
}
// divider os4 gain vs x1 per candidate
for (const id of ["shipped", "A", "B", "B37", "AB", "C", "D5", "E"] as CandidateId[]) {
  const parts: string[] = [];
  for (const f of [100, 1000, 8000, 19000]) {
    const n = 9600;
    const input = new Float64Array(n);
    for (let i = 0; i < n; i += 1) input[i] = 0.3 * Math.sin((2 * Math.PI * f * i) / 48000);
    const r1 = new ReferenceRuntime(compiled.program); r1.prepare(48000, {});
    const g1 = fund(r1.process(input).subarray(4800), 48000, f);
    const { up, down } = buildCandidate(id, 2);
    const b0 = new Float64Array(4), b1 = new Float64Array(4);
    const hi = new Float64Array(n * 4);
    let cur = b0, next = b1;
    for (let k = 0; k < n; k += 1) {
      up[0]!.interpolate(input[k]!, cur, 0);
      for (let i = 0; i < 2; i += 1) up[1]!.interpolate(cur[i]!, next, 2 * i);
      hi.set(next.subarray(0, 4), k * 4);
      const t = cur; cur = next; next = t;
    }
    const r4 = new ReferenceRuntime(compiled.program); r4.prepare(192000, {});
    const hiOut = r4.process(hi);
    const h = Float64Array.from(hiOut);
    let width = n * 4;
    for (let s = 1; s >= 0; s -= 1) {
      const half = width / 2;
      for (let i = 0; i < half; i += 1) h[i] = down[s]!.decimate(h[2 * i]!, h[2 * i + 1]!);
      width = half;
    }
    const g4 = fund(h.subarray(4800, n), 48000, f);
    parts.push(`${f}:${(20 * Math.log10(g4 / g1)).toFixed(4)}`);
  }
  console.log(`${id} divider os4-vs-x1 gain dB: ${parts.join(" ")}`);
}
