import { compile, emptyRegistry } from "/home/joseph/projects/VesselDSP/core/supply-sag-design/packages/compiler/src/index.ts";
import type { Program } from "/home/joseph/projects/VesselDSP/core/supply-sag-design/packages/compiler/src/index.ts";
import { ReferenceRuntime } from "/home/joseph/projects/VesselDSP/core/supply-sag-design/packages/runtime/src/index.ts";

export const COMPILER = "/home/joseph/projects/VesselDSP/core/supply-sag-design/packages/compiler/src/index.ts";
export const RUNTIME = "/home/joseph/projects/VesselDSP/core/supply-sag-design/packages/runtime/src/index.ts";

export function head(name: string, filename: string): string {
  return `schema: circuit-interchange/v3
metadata:
  name: "${name}"
  description: "supply sag proof of concept probe."
  partNumber: ""
source:
  format: vdsp
  filename: ${filename}
components:
`;
}

export function jack(id: string, name: string, node: number, x: number, stn: string): string {
  return `  - id: ${id}
    kind: jack
    name: ${name}
    sourceTypeName: ${stn}
    origin:
      x: ${x}
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: ${node}
        position:
          x: ${x}
          y: 0
`;
}

export function ground(): string {
  return `  - id: GND1
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
`;
}

export function battery(node: number): string {
  return `  - id: BATT1
    kind: battery
    name: BATT1
    sourceTypeName: Circuit.Battery
    origin:
      x: 0
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: positive
        node: ${node}
        position:
          x: 0
          y: 90
      - name: negative
        node: 0
        position:
          x: 0
          y: 110
    properties:
      Voltage: "9V"
`;
}

export function resistor(id: string, a: number, b: number, value: string): string {
  return `  - id: ${id}
    kind: resistor
    name: ${id}
    sourceTypeName: Circuit.Resistor
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
      Resistance: "${value}"
`;
}

export function compileOrThrow(doc: string): Program {
  const result = compile(doc, { registry: emptyRegistry });
  if (result.status !== "ok") {
    throw new Error("compile failed: " + JSON.stringify(result.reasons, null, 2));
  }
  return result.program;
}

/** Plain-data clone of a Program with every dc-source stamp's volts/sourceOhms replaced. */
export function cloneWithSupply(program: Program, volts: number, sourceOhms: number): Program {
  const clone = structuredClone(program);
  for (const block of clone.blocks) {
    if (block.kind !== "mna") continue;
    for (const stamp of block.stamps) {
      if (stamp.kind === "dc-source") {
        (stamp as { volts: number }).volts = volts;
        (stamp as { sourceOhms: number }).sourceOhms = sourceOhms;
      }
    }
  }
  return clone;
}

export type SupplyReading = {
  readonly volts: number;
  readonly sourceOhms: number;
  readonly railLabel: number;
  readonly railVolts: number;
  readonly supplyAmps: number;
  readonly ipeakRenderAmps: number | null;
  readonly outMean: number;
  readonly outRms: number;
  readonly outPeakPos: number;
  readonly outPeakNeg: number;
  readonly output: Float64Array;
};

export function runProgram(program: Program, input: Float64Array, volts: number, sourceOhms: number): SupplyReading {
  const runtime = new ReferenceRuntime(program);
  runtime.prepare(48000);
  const output = runtime.process(input);
  let railLabel = NaN;
  let railVolts = NaN;
  outer: for (const block of program.blocks) {
    if (block.kind !== "mna") continue;
    for (const stamp of block.stamps) {
      if (stamp.kind === "dc-source") {
        const snap = runtime.nodeVoltageSnapshot().find((s) => s.blockId === block.id);
        if (snap) {
          // Lowering remaps stamp terminals to row indices, so `positive` is
          // already the row; nodeIds[row] is the authored label for reporting.
          railLabel = (snap.nodeIds as readonly number[])[stamp.positive] ?? NaN;
          railVolts = snap.voltages[stamp.positive] ?? NaN;
        }
        break outer;
      }
    }
  }
  const branch = runtime.branchCurrentSnapshot().find((b) => b.kind === "dc-source");
  let mean = 0;
  let ms = 0;
  let peakPos = -Infinity;
  let peakNeg = Infinity;
  for (const v of output) {
    mean += v;
    ms += v * v;
    if (v > peakPos) peakPos = v;
    if (v < peakNeg) peakNeg = v;
  }
  mean /= output.length;
  ms /= output.length;
  return {
    volts, sourceOhms, railLabel, railVolts,
    supplyAmps: branch?.amps ?? NaN,
    ipeakRenderAmps: runtime.telemetry().renderedSupplyPeakAmps,
    outMean: mean, outRms: Math.sqrt(ms), outPeakPos: peakPos, outPeakNeg: peakNeg,
    output,
  };
}

export function sine(n: number, peak: number, freqHz = 1000, rate = 48000): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) out[i] = peak * Math.sin((2 * Math.PI * freqHz * i) / rate);
  return out;
}

export function fmt(x: number, digits = 6): string {
  if (!Number.isFinite(x)) return String(x);
  return x.toFixed(digits);
}
