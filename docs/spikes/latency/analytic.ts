// Analytic controls: passive netlists vs exact complex-AC answer.
// Circuits (from the element-prewarp report §3, reproduced in the oversampling
// report): RC 10k/10n, RL 1k/10mH, two-pole RC ladder, two-capacitor tone
// network. Renders: x1, shipped/A/B/C os4 (external cascade), native 192k.
// Frequencies 100/1k/4k/8k/12k, 100 mV, stiff source, LS fundamental.
import { compile, emptyRegistry } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import { buildCandidate, type CandidateId, type Stage } from "./candidates";

const FS = 48_000;
const vdspWith = (parts: string): string => `schema: circuit-interchange/v3
metadata:
  name: "Oversample Control"
  description: "Passive control filter."
  partNumber: ""
source:
  format: vdsp
  filename: oversample_control.vdsp
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
${parts}`;
const seriesResistor = (id: string, n1: number, n2: number, ohms: string): string => `  - id: ${id}
    kind: resistor
    name: ${id}
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: ${n1}
        position:
          x: 0
          y: 0
      - name: b
        node: ${n2}
        position:
          x: 0
          y: 0
    properties:
      Resistance: "${ohms}"
`;
const shuntPart = (id: string, kind: string, sourceType: string, node: number, prop: string, value: string): string => `  - id: ${id}
    kind: ${kind}
    name: ${id}
    sourceTypeName: ${sourceType}
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: ${node}
        position:
          x: 0
          y: 0
      - name: b
        node: 0
        position:
          x: 0
          y: 0
    properties:
      ${prop}: "${value}"
`;
const seriesCap = (id: string, n1: number, n2: number, value: string): string => `  - id: ${id}
    kind: capacitor
    name: ${id}
    sourceTypeName: Circuit.Capacitor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: ${n1}
        position:
          x: 0
          y: 0
      - name: b
        node: ${n2}
        position:
          x: 0
          y: 0
    properties:
      Capacitance: "${value}"
`;
const RC = vdspWith(seriesResistor("R1", 1, 2, "10k") + shuntPart("X1", "capacitor", "Circuit.Capacitor", 2, "Capacitance", "10n"));
const RL = vdspWith(seriesResistor("R1", 1, 2, "1k") + shuntPart("X1", "inductor", "Circuit.Inductor", 2, "Inductance", "10mH"));
// Two-pole RC ladder: series-shunt-series-shunt, mid node 3.
const LAD = vdspWith(
  seriesResistor("R1", 1, 3, "10k") + shuntPart("C1", "capacitor", "Circuit.Capacitor", 3, "Capacitance", "10n") +
  seriesResistor("R2", 3, 2, "10k") + shuntPart("C2", "capacitor", "Circuit.Capacitor", 2, "Capacitance", "10n"),
);
// Two-capacitor tone network: series 10n in->mid(3), 10k mid->ground, series 10k mid->out, 10n out->ground.
const TONE = vdspWith(
  seriesCap("C1", 1, 3, "10n") + shuntPart("R1", "resistor", "Circuit.Resistor", 3, "Resistance", "10k") +
  seriesResistor("R2", 3, 2, "10k") + shuntPart("C2", "capacitor", "Circuit.Capacitor", 2, "Capacitance", "10n"),
);

// Exact nodal AC solver (R/sC/1/sL stamps, partial-pivot elimination). Nodes 1..N (0 ground).
type C = [number, number];
const add = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
const mul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const div = (a: C, b: C): C => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const exactGainDb = (vdsp: string, f: number): number => {
  // Parse parts minimally: collect (kind, n1, n2, value) from the YAML above.
  const specs: { kind: string; n1: number; n2: number; v: number }[] = [];
  const val = (s: string): number => {
    const m = s.match(/^([\d.]+)(k|n|mH|u|m)?$/);
    if (!m) throw new Error(`bad value ${s}`);
    const x = Number(m[1]);
    const u = m[2] ?? "";
    return u === "k" ? x * 1e3 : u === "n" ? x * 1e-9 : u === "u" ? x * 1e-6 : u === "mH" ? x * 1e-3 : u === "m" ? x * 1e-3 : x;
  };
  const blocks = vdsp.split("- id: ").slice(1);
  for (const b of blocks) {
    const kind = b.match(/kind: (\S+)/)?.[1];
    if (kind === "jack" || kind === "ground") continue;
    const nodes = [...b.matchAll(/node: (\d+)/g)].map((x) => Number(x[1]));
    const prop = b.match(/(Resistance|Capacitance|Inductance): "([^"]+)"/);
    if (!kind || nodes.length < 2 || !prop) continue;
    const v = val(prop[2]!);
    const pr = prop[1] === "Resistance" ? v : prop[1] === "Capacitance" ? 1 / (2 * Math.PI * f * v) : 2 * Math.PI * f * v;
    void pr;
    specs.push({ kind, n1: nodes[0]!, n2: nodes[1]!, v });
  }
  const N = Math.max(2, ...specs.flatMap((s) => [s.n1, s.n2]));
  const w = 2 * Math.PI * f;
  // Y matrix (complex), I vector: 1 V drive: inject at node 1 via 0-ohm? Use stiff source: node 1 fixed at 1 V.
  const Y: C[][] = Array.from({ length: N + 1 }, () => Array.from({ length: N + 1 }, () => [0, 0] as C));
  for (const s of specs) {
    let y: C;
    if (s.kind === "resistor") y = [1 / s.v, 0];
    else if (s.kind === "capacitor") y = [0, w * s.v];
    else y = [0, -1 / (w * s.v)];
    Y[s.n1]![s.n1] = add(Y[s.n1]![s.n1]!, y);
    Y[s.n2]![s.n2] = add(Y[s.n2]![s.n2]!, y);
    Y[s.n1]![s.n2] = add(Y[s.n1]![s.n2]!, [-y[0], -y[1]]);
    Y[s.n2]![s.n1] = add(Y[s.n2]![s.n1]!, [-y[0], -y[1]]);
  }
  // Fix node 1 = 1 V: solve for nodes 2..N.
  const idx = (i: number): number => i - 2;
  const M = N - 1;
  const A: C[][] = Array.from({ length: M }, (_, r) => Array.from({ length: M + 1 }, (_, c) => c < M ? Y[r + 2]![c + 2]! : [0, 0] as C));
  for (let r = 0; r < M; r += 1) {
    // rhs -= Y[r+2][1] * 1V
    A[r]![M] = [-Y[r + 2]![1]![0], -Y[r + 2]![1]![1]];
  }
  for (let i = 0; i < M; i += 1) {
    let p = i;
    for (let r = i + 1; r < M; r += 1) {
      const a = A[r]![i]!, b = A[p]![i]!;
      if (a[0] * a[0] + a[1] * a[1] > b[0] * b[0] + b[1] * b[1]) p = r;
    }
    [A[i], A[p]] = [A[p]!, A[i]!];
    for (let r = i + 1; r < M; r += 1) {
      const f = div(A[r]![i]!, A[i]![i]!);
      for (let c = i; c <= M; c += 1) A[r]![c] = add(A[r]![c]!, [-mul(f, A[i]![c]!)[0], -mul(f, A[i]![c]!)[1]]);
    }
  }
  const sol: C[] = Array.from({ length: M }, () => [0, 0] as C);
  for (let i = M - 1; i >= 0; i -= 1) {
    let t = A[i]![M]!;
    for (let c = i + 1; c < M; c += 1) t = add(t, [-mul(A[i]![c]!, sol[c]!)[0], -mul(A[i]![c]!, sol[c]!)[1]]);
    sol[i] = div(t, A[i]![i]!);
  }
  const v2 = sol[idx(2)]!;
  return 20 * Math.log10(Math.hypot(v2[0], v2[1]));
};

const fundamental = (y: Float64Array, fs: number, f: number): number => {
  let s00 = 0, s01 = 0, s02 = 0, s11 = 0, s12 = 0, s22 = 0, t0 = 0, t1 = 0, t2 = 0;
  for (let i = 0; i < y.length; i += 1) {
    const phase = (2 * Math.PI * f * i) / fs;
    const cos = Math.cos(phase), sin = Math.sin(phase), v = y[i]!;
    s00 += 1; s01 += cos; s02 += sin; s11 += cos * cos; s12 += cos * sin; s22 += sin * sin;
    t0 += v; t1 += cos * v; t2 += sin * v;
  }
  const det = s00 * (s11 * s22 - s12 * s12) - s01 * (s01 * s22 - s12 * s02) + s02 * (s01 * s12 - s11 * s02);
  const b = (s00 * (t1 * s22 - s12 * t2) - t0 * (s01 * s22 - s12 * s02) + s02 * (s01 * t2 - t1 * s02)) / det;
  const c = (s00 * (s11 * t2 - t1 * s12) - s01 * (s01 * t2 - t1 * s02) + t0 * (s01 * s12 - s11 * s02)) / det;
  return Math.hypot(b, c);
};

const renderGainDb = (vdsp: string, freq: number, mode: string, rate = FS): number => {
  const compiled = compile(vdsp, { registry: emptyRegistry });
  if (compiled.status !== "ok") throw new Error("no compile");
  const amp = 0.1;
  const stim = (t: number): number => amp * Math.sin(2 * Math.PI * freq * t);
  let out: Float64Array;
  if (mode === "x1" || mode === "n192") {
    const rt = new ReferenceRuntime(compiled.program);
    rt.prepare(rate, { inputSourceOhms: 0 });
    rt.process(new Float64Array(Math.round(0.1 * rate)));
    const n = Math.round(0.4 * rate);
    const input = new Float64Array(n);
    for (let i = 0; i < n; i += 1) input[i] = stim(i / rate);
    out = rt.process(input).slice(Math.round(0.1 * rate), Math.round(0.4 * rate));
    if (rt.telemetry().nonConvergedSamples !== 0) throw new Error("nonconv");
  } else {
    const cid = mode.split("-")[0] as CandidateId;
    const { up, down } = buildCandidate(cid, 2);
    const rt = new ReferenceRuntime(compiled.program);
    rt.prepare(FS * 4, { inputSourceOhms: 0 });
    rt.process(new Float64Array(Math.round(0.1 * FS * 4)));
    const n = Math.round(0.4 * FS);
    const input = new Float64Array(n);
    for (let i = 0; i < n; i += 1) input[i] = stim(i / FS);
    // external cascade
    const bufs = [new Float64Array(4), new Float64Array(4)];
    const hi = new Float64Array(n * 4);
    for (let k = 0; k < n; k += 1) {
      let cur = bufs[0]!, next = bufs[1]!;
      up[0]!.interpolate(input[k]!, cur, 0);
      for (let i = 0; i < 2; i += 1) up[1]!.interpolate(cur[i]!, next, 2 * i);
      hi.set(next.subarray(0, 4), k * 4);
    }
    const hiOut = new Float64Array(n * 4);
    const blk = 2048;
    for (let i = 0; i < hi.length; i += blk) hiOut.set(rt.process(hi.subarray(i, Math.min(hi.length, i + blk))), i);
    const h = Float64Array.from(hiOut);
    let width = n * 4;
    for (let s = 1; s >= 0; s -= 1) {
      const half = width / 2;
      for (let i = 0; i < half; i += 1) h[i] = down[s]!.decimate(h[2 * i]!, h[2 * i + 1]!);
      width = half;
    }
    out = h.slice(Math.round(0.1 * FS), Math.round(0.4 * FS));
    if (rt.telemetry().nonConvergedSamples !== 0) throw new Error("nonconv");
  }
  const r = mode === "n192" ? 192000 : FS;
  void rate;
  return 20 * Math.log10(fundamental(out, r, freq) / amp);
};

for (const [name, vdsp] of [["RC", RC], ["RL", RL], ["LAD", LAD], ["TONE", TONE]] as const) {
  for (const f of [100, 1000, 4000, 8000, 12000]) {
    const exact = exactGainDb(vdsp, f);
    const errs: string[] = [];
    for (const m of ["x1", "shipped-os4", "A-os4", "B-os4", "C-os4", "AB-os4", "n192"] as const) {
      const g = m === "n192" ? renderGainDb(vdsp, f, "n192", 192000) : renderGainDb(vdsp, f, m);
      errs.push(`${m}:${(g - exact).toFixed(4)}`);
    }
    console.log(`${name} ${f}Hz exact ${exact.toFixed(4)}dB err {${errs.join(" ")}}`);
  }
}
