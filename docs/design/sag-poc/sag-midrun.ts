// Script 4: mutate a live Program's dc-source stamps between process() calls
// on the SAME ReferenceRuntime instance. Dense-path freshness check.
// Run: bun /tmp/sag-poc/sag-midrun.ts
import { battery, compileOrThrow, fmt, ground, head, jack, resistor } from "./common.ts";
import { ReferenceRuntime } from "/home/joseph/projects/VesselDSP/core/supply-sag-design/packages/runtime/src/index.ts";

const doc =
  head("Sag probe: resistive load", "sag_resistive.vdsp") +
  jack("JIN", "INPUT", 1, -200, "Circuit.Input") +
  jack("JOUT", "OUTPUT", 2, 200, "Circuit.Output") +
  ground() +
  battery(3) +
  resistor("RLOAD", 3, 0, "9k") +
  resistor("R1", 1, 2, "10k");

const program = compileOrThrow(doc);

function setAllSourceOhms(p: typeof program, ohms: number): void {
  for (const b of p.blocks) {
    if (b.kind !== "mna") continue;
    for (const s of b.stamps) {
      if (s.kind === "dc-source") (s as { sourceOhms: number }).sourceOhms = ohms;
    }
  }
}

function railOf(rt: ReferenceRuntime): number {
  for (const s of rt.nodeVoltageSnapshot()) {
    const row = (s.nodeIds as readonly number[]).indexOf(3);
    if (row !== -1) return s.voltages[row] ?? NaN;
  }
  return NaN;
}

const rt = new ReferenceRuntime(program);
rt.prepare(48000);
rt.process(new Float64Array(64));
console.log("as-compiled (1 ohm) rail:", fmt(railOf(rt)));
setAllSourceOhms(program, 100);
rt.process(new Float64Array(64));
console.log("after mid-run mutation to 100 ohm rail:", fmt(railOf(rt)), " expected:", fmt(9 * 9000 / 9100));
setAllSourceOhms(program, 0);
rt.process(new Float64Array(64));
console.log("after mid-run mutation to 0 ohm rail:", fmt(railOf(rt)), " expected: 9.000000");
