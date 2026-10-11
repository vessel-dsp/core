// TS-only level and telemetry of a 1 s sine render (the movement harness's cell), for attributing a change by toggling.
//   bun docs/spikes/opamp-gbw-stall/level.ts --packet=boss-aw-2 --os=1 [--hz=1000] [--amp=0.1] [--force-gbp=null]
import { RATE, arg, controlsFor, forceGbp, fundamentalOf, programFor, renderTs, sine } from "./lib";
const slug = arg("packet", "boss-aw-2"), os = Number(arg("os", "1")), hz = Number(arg("hz", "1000")), amp = Number(arg("amp", "0.1"));
const program = forceGbp(programFor(slug), arg("force-gbp", ""));
const t = renderTs(program, controlsFor(slug), sine(RATE, hz, amp), { os });
console.log(`${slug} os${os} ${hz} Hz ${amp} V: TS fundamental ${(fundamentalOf(t.out.subarray(RATE >> 1), RATE, hz) * 1000).toFixed(3)} mV, it/host ${(t.iterations / RATE).toFixed(2)}, nc ${t.nonConverged}, peak ${t.peak}, stalled ${t.telemetry.stalledSamples}, flagged ${t.telemetry.solvedButFlaggedSamples}`);
