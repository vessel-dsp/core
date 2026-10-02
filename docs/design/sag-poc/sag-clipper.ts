// Script 3: rail-referenced diode clipper. Positive clip level = Vrail + Vf,
// so rail sag moves the clipping threshold. Quiet signal must be bit-identical.
// Run: bun /tmp/sag-poc/sag-clipper.ts
import { battery, cloneWithSupply, compileOrThrow, fmt, ground, head, jack, resistor, runProgram, sine } from "./common.ts";

function diode(id: string, anode: number, cathode: number): string {
  return `  - id: ${id}
    kind: diode
    name: ${id}
    sourceTypeName: Circuit.Diode
    origin:
      x: 10
      y: 10
    rotation: 0
    flipped: false
    terminals:
      - name: anode
        node: ${anode}
        position:
          x: 0
          y: 0
      - name: cathode
        node: ${cathode}
        position:
          x: 20
          y: 20
    properties: {}
`;
}

// JIN(1) -> 1k -> node 4 (= OUTPUT); D1 anode 4 cathode rail 3; D2 anode 0 cathode 4.
const doc =
  head("Sag probe: rail-referenced clipper", "sag_clipper.vdsp") +
  jack("JIN", "INPUT", 1, -200, "Circuit.Input") +
  jack("JOUT", "OUTPUT", 4, 200, "Circuit.Output") +
  ground() +
  battery(3) +
  resistor("RS", 1, 4, "1k") +
  diode("D1", 4, 3) +
  diode("D2", 0, 4);

const program = compileOrThrow(doc);
for (const block of program.blocks) {
  if (block.kind !== "mna") continue;
  console.log("block", block.id, "nodeIds", JSON.stringify(block.nodeIds));
  for (const stamp of block.stamps) console.log("  ", JSON.stringify(stamp));
}

const N = 4800;
const loud = sine(N, 12.0);
const quiet = sine(N, 0.1);

console.log("--- loud (12 V peak): Rint | railDC | IsupplyDC(mA) | IpeakRender(mA) | outPk+ | outPk- | outRMS");
for (const rint of [0, 1, 30, 100]) {
  const r = runProgram(cloneWithSupply(program, 9, rint), loud, 9, rint);
  console.log(`${rint} | ${fmt(r.railVolts)} | ${fmt(r.supplyAmps * 1000, 4)} | ${r.ipeakRenderAmps === null ? "null" : fmt(r.ipeakRenderAmps * 1000, 4)} | ${fmt(r.outPeakPos, 4)} | ${fmt(r.outPeakNeg, 4)} | ${fmt(r.outRms, 5)}`);
}

console.log("--- quiet (0.1 V peak): Rint | outRMS | maxDeltaVsRint0");
{
  const ref = runProgram(cloneWithSupply(program, 9, 0), quiet, 9, 0).output;
  const rmsRef = Math.sqrt(ref.reduce((a, v) => a + v * v, 0) / ref.length);
  console.log(`0 | ${fmt(rmsRef, 7)} | 0`);
  for (const rint of [1, 30, 100]) {
    const out = runProgram(cloneWithSupply(program, 9, rint), quiet, 9, rint).output;
    let maxDelta = 0;
    for (let i = 0; i < out.length; i += 1) maxDelta = Math.max(maxDelta, Math.abs(out[i]! - ref[i]!));
    const rms = Math.sqrt(out.reduce((a, v) => a + v * v, 0) / out.length);
    console.log(`${rint} | ${fmt(rms, 7)} | ${maxDelta}`);
  }
}

// Negative control: unmodified clone, loud signal, bit-for-bit.
{
  const a = runProgram(program, loud, 9, 1).output;
  const b = runProgram(structuredClone(program), loud, 9, 1).output;
  let maxDelta = 0;
  for (let i = 0; i < a.length; i += 1) maxDelta = Math.max(maxDelta, Math.abs(a[i]! - b[i]!));
  console.log(`negative control (unmodified clone, loud sine): max abs delta = ${maxDelta}`);
}
