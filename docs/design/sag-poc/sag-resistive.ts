// Script 1: resistive load Thevenin check + negative controls.
// Run: bun /tmp/sag-poc/sag-resistive.ts  (from anywhere; paths inside are absolute)
import { battery, cloneWithSupply, compileOrThrow, fmt, ground, head, jack, resistor, runProgram } from "./common.ts";

const doc =
  head("Sag probe: resistive load", "sag_resistive.vdsp") +
  jack("JIN", "INPUT", 1, -200, "Circuit.Input") +
  jack("JOUT", "OUTPUT", 2, 200, "Circuit.Output") +
  ground() +
  battery(3) +
  resistor("RLOAD", 3, 0, "9k") +
  resistor("R1", 1, 2, "10k");

const program = compileOrThrow(doc);
const compiledOhms = (() => {
  for (const b of program.blocks) {
    if (b.kind !== "mna") continue;
    for (const s of b.stamps) if (s.kind === "dc-source") return (s as unknown as { sourceOhms: number }).sourceOhms;
  }
  return NaN;
})();
console.log("as-compiled dc-source sourceOhms:", compiledOhms);

const N = 480;
const silence = new Float64Array(N);
const RLOAD = 9000;
const E = 9;

for (const rint of [compiledOhms, 0, 1, 30]) {
  const clone = cloneWithSupply(program, E, rint);
  const r = runProgram(clone, silence, E, rint);
  const expected = (E * RLOAD) / (RLOAD + rint);
  console.log(
    `Rint=${rint} ohm  rail=${fmt(r.railVolts)} V  expected=${fmt(expected)} V  ` +
    `err=${(Math.abs(r.railVolts - expected)).toExponential(2)} V  ` +
    `Isupply=${fmt(r.supplyAmps * 1000, 6)} mA  expected=${fmt((E / (RLOAD + rint)) * 1000, 6)} mA`,
  );
}

// Volts variant: dying battery 6.8 V through 30 ohm.
{
  const clone = cloneWithSupply(program, 6.8, 30);
  const r = runProgram(clone, silence, 6.8, 30);
  const expected = (6.8 * RLOAD) / (RLOAD + 30);
  console.log(`E=6.8 Rint=30  rail=${fmt(r.railVolts)} V  expected=${fmt(expected)} V  Isupply=${fmt(r.supplyAmps * 1000, 6)} mA`);
}

// Negative control 1: untouched clone reproduces the as-compiled program bit for bit.
{
  const a = runProgram(program, silence, E, compiledOhms).output;
  const b = runProgram(structuredClone(program), silence, E, compiledOhms).output;
  let maxDelta = 0;
  for (let i = 0; i < a.length; i += 1) maxDelta = Math.max(maxDelta, Math.abs(a[i]! - b[i]!));
  console.log(`negative control (unmodified clone vs original output): max abs delta = ${maxDelta}`);
}
