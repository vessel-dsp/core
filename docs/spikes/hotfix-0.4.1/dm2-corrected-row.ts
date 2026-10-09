// Check 4: the corrected boss-dm-2 row of the Newton-budget corpus table, from the REAL runtime (no scratch
// loop, no fixed-point twin): in the spike's protocol (x1, cap 64, 0 ohm, 2400 + 9600 samples of 1 kHz @0.1 V)
// it/host, non-converged, peak iterations, and relRMS of this runtime against a reference dump.
//   bun docs/spikes/hotfix-0.4.1/dm2-corrected-row.ts --out=<dump.json> [--dense] [--ref=<dump.json>]
// Run it in the unpatched checkout (the spike's "shipped": --out=a.json, and with --dense for the forced-dense
// reference) and in the patched checkout (--ref=a.json prints the row).
import { readFileSync, writeFileSync } from "node:fs";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import { arg, compileFile, fileForSlug, has, tone } from "./lib";

const program = compileFile(fileForSlug("boss-dm-2"));
if (has("dense")) for (const b of (program as unknown as { blocks: Array<{ kind: string; sparseSchedule: unknown }> }).blocks) if (b.kind === "mna") b.sparseSchedule = null;
const rt = new ReferenceRuntime(program);
rt.prepare(48000, { maxNewtonIterations: 64, inputSourceOhms: 0 });
rt.process(tone(2400, 1000, 0.1, 0));
const t0 = rt.telemetry();
const out = Array.from(rt.process(tone(9600, 1000, 0.1, 2400)));
const t1 = rt.telemetry();
const row = { itPerHost: (t1.totalIterations - t0.totalIterations) / (t1.samples - t0.samples), nc: t1.nonConvergedSamples - t0.nonConvergedSamples, peak: t1.peakIterations, out };
console.log(`it/host ${row.itPerHost.toFixed(3)}  non-converged ${row.nc}  peak iterations ${row.peak}${has("dense") ? "  (forced dense)" : ""}`);
const o = arg("out", "");
if (o !== "") writeFileSync(o, JSON.stringify(row));
const ref = arg("ref", "");
if (ref !== "") {
	const r = JSON.parse(readFileSync(ref, "utf8")) as typeof row;
	let d2 = 0, r2 = 0;
	for (let i = 0; i < out.length; i += 1) { d2 += ((out[i] as number) - (r.out[i] as number)) ** 2; r2 += (r.out[i] as number) ** 2; }
	console.log(`relRMS vs ${ref.split("/").pop()}: ${Math.sqrt(d2 / r2).toExponential(3)}`);
}
