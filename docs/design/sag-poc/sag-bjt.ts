// Script 2: biased common-emitter stage. DC bias point + loud/quiet signal vs source ohms.
// Run: bun /tmp/sag-poc/sag-bjt.ts
import { battery, cloneWithSupply, compileOrThrow, fmt, ground, head, jack, resistor, runProgram, sine } from "./common.ts";
import { ReferenceRuntime } from "/home/joseph/projects/VesselDSP/core/supply-sag-design/packages/runtime/src/index.ts";

function capacitor(id: string, a: number, b: number, value: string): string {
  return `  - id: ${id}
    kind: capacitor
    name: ${id}
    sourceTypeName: Circuit.Capacitor
    origin:
      x: 10
      y: 10
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: ${a}
        position:
          x: 0
          y: 0
      - name: b
        node: ${b}
        position:
          x: 20
          y: 20
    properties:
      Capacitance: "${value}"
`;
}

function bjt(id: string, base: number, collector: number, emitter: number): string {
  return `  - id: ${id}
    kind: bjt
    name: ${id}
    sourceTypeName: Circuit.Bjt
    origin:
      x: 10
      y: 10
    rotation: 0
    flipped: false
    terminals:
      - name: base
        node: ${base}
        position:
          x: 0
          y: 0
      - name: collector
        node: ${collector}
        position:
          x: 10
          y: 10
      - name: emitter
        node: ${emitter}
        position:
          x: 20
          y: 20
    properties: {}
`;
}

const doc =
  head("Sag probe: biased BJT stage", "sag_bjt.vdsp") +
  jack("JIN", "INPUT", 1, -200, "Circuit.Input") +
  jack("JOUT", "OUTPUT", 2, 200, "Circuit.Output") +
  ground() +
  battery(3) +
  resistor("RB1", 3, 4, "470k") +
  resistor("RB2", 4, 0, "100k") +
  resistor("RC", 3, 5, "4.7k") +
  resistor("RE", 6, 0, "1k") +
  capacitor("CIN", 1, 4, "100n") +
  capacitor("COUT", 5, 2, "100n") +
  bjt("Q1", 4, 5, 6);

export const bjtDoc = doc;

const program = compileOrThrow(doc);

function nodeVolts(rt: ReferenceRuntime, label: number): number {
  for (const s of rt.nodeVoltageSnapshot()) {
    const row = (s.nodeIds as readonly number[]).indexOf(label);
    if (row !== -1) return s.voltages[row] ?? NaN;
  }
  return NaN;
}

const N = 4800;
const quiet = sine(N, 0.005);
const loud = sine(N, 0.3);

console.log("Rint | railDC | Vb | Vc | Ve | IsupplyDC(mA) | IpeakRender(mA) | loudMean | loudAcRMS | loudPk+ | loudPk- | quietMean | quietAcRMS");
for (const rint of [0, 1, 30, 100]) {
  const clone = cloneWithSupply(program, 9, rint);
  // DC bias from a silent run
  const rtDc = new ReferenceRuntime(clone);
  rtDc.prepare(48000);
  rtDc.process(new Float64Array(512));
  const rail = nodeVolts(rtDc, 3);
  const vb = nodeVolts(rtDc, 4);
  const vc = nodeVolts(rtDc, 5);
  const ve = nodeVolts(rtDc, 6);
  const idc = rtDc.branchCurrentSnapshot().find((b) => b.kind === "dc-source")?.amps ?? NaN;
  // Loud + quiet signal runs (fresh runtimes so state does not leak between levels)
  const rtLoud = new ReferenceRuntime(clone);
  rtLoud.prepare(48000);
  const outLoud = rtLoud.process(loud);
  const ipeak = rtLoud.telemetry().renderedSupplyPeakAmps;
  const rtQuiet = new ReferenceRuntime(clone);
  rtQuiet.prepare(48000);
  const outQuiet = rtQuiet.process(quiet);
  const rms = (o: Float64Array) => Math.sqrt(o.reduce((a, v) => a + v * v, 0) / o.length);
  const acRms = (o: Float64Array) => {
    const m = o.reduce((a, v) => a + v, 0) / o.length;
    return { mean: m, ac: Math.sqrt(o.reduce((a, v) => a + (v - m) * (v - m), 0) / o.length) };
  };
  const q = acRms(outQuiet);
  const l = acRms(outLoud);
  let pkP = -Infinity, pkN = Infinity;
  for (const v of outLoud) { if (v > pkP) pkP = v; if (v < pkN) pkN = v; }
  console.log(
    `${rint} | ${fmt(rail)} | ${fmt(vb)} | ${fmt(vc)} | ${fmt(ve)} | ${fmt(idc * 1000, 4)} | ` +
    `${ipeak === null ? "null" : fmt(ipeak * 1000, 4)} | ${fmt(l.mean, 6)} | ${fmt(l.ac, 6)} | ${fmt(pkP, 4)} | ${fmt(pkN, 4)} | ${fmt(q.mean, 6)} | ${fmt(q.ac, 6)}`,
  );
}

// Negative control: unmodified clone output bit-for-bit identical on the loud signal.
{
  const a = runProgram(program, loud, 9, 1).output;
  const b = runProgram(structuredClone(program), loud, 9, 1).output;
  let maxDelta = 0;
  for (let i = 0; i < a.length; i += 1) maxDelta = Math.max(maxDelta, Math.abs(a[i]! - b[i]!));
  console.log(`negative control (unmodified clone, loud sine): max abs delta = ${maxDelta}`);
}
