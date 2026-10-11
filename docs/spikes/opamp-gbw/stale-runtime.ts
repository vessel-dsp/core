// What a 0.4.x runtime does with a program that carries the new field: run in the BASELINE tree against a program JSON exported by the
// NEW compiler (corpus-programs.ts). Renders 1 kHz 10 mV 1 s with the study controls at x1 and os4 on both consoles and hashes the output;
// the TS-9 hashes must equal the unchanged-main hashes (logs/01-baseline-render.log) if the field is silently ignored.
//   (in the baseline clone)  bun docs/spikes/opamp-gbw/stale-runtime.ts <programs-new dir>
import { readFileSync } from "node:fs";
import type { Program } from "@vessel-dsp/compiler";
import { PACKETS, renderTs, renderWasm, sha256, sine } from "./lib";

const dir = process.argv[2] as string;
const program = JSON.parse(readFileSync(`${dir}/ibanez-ts9-reissue.json`, "utf8")) as Program;
const stamps = program.blocks.flatMap((b) => (b.kind === "mna" ? b.stamps : [])).filter((s) => s.kind === "ideal-opamp") as any[];
console.log(`program from the NEW compiler: formatVersion ${program.formatVersion}, requiredOperators ${JSON.stringify(program.requiredOperators)}, op-amp stamps carry gainBandwidthHz = ${stamps.map((s) => s.gainBandwidthHz).join(", ")}`);
const input = sine(48000, 1000, 0.01);
for (const os of [1, 4]) {
	const t = renderTs(program, PACKETS.ts9!.controls, input, { os });
	const w = await renderWasm(program, PACKETS.ts9!.controls, input, { os });
	console.log(`ts9 os${os} on the baseline runtime: TS ${sha256(t.out)}  WASM ${sha256(w.out)}  (no refusal, no warning)`);
}
