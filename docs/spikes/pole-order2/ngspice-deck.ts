// The independent reference for the pole change. This emits an ngspice deck from the compiled PROGRAM with the workbench's own deck emitter
// (ngspice/program-to-spice.ts, a VERBATIM copy of workbench/scripts/lib/program-to-spice.ts, read-only upstream), whose op-amp pole is the
// CONTINUOUS one at GBP / A0 (an RC node, GBP = 1e6, with the +-8 halfSwing clamp the runtime mirrors), runs it, and extracts the fundamental of a
// settled window. Controls are set by writing the state's positions into the program's control defaults (a deck is one operating point).
// The deck does not depend on the engine, so one deck run serves the engine before and after.
//   bun docs/spikes/pole-order2/ngspice-deck.ts --pedals=ts9 --states=centre --freqs=1000,16000 --out=<json>
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Program } from "@vessel-dsp/compiler";
import { programToSpiceDeck } from "./ngspice/program-to-spice";
import { FREQS, PACKETS, STATES, arg, compileFile, fundamentalOf } from "./lib";

const pedals = arg("pedals", "sd1,ts9").split(",");
const states = arg("states", "drive-min,centre,drive-max").split(",");
const freqs = arg("freqs", FREQS.join(",")).split(",").map(Number);
const out = arg("out", "");
const mode = "continuous";
const SPICE_RATE = 768000, SECONDS = 0.4, AMP = 0.01, WIN: [number, number] = [0.2, 0.4];
// The TS-9's footswitch latch is bistable and the program seeds one node only (n33 = 0.65 V), so ngspice landed BYPASSED (9.6 mV out
// for 10 mV in at 1 kHz, against the engine's 40.3 mV engaged). The study's three-way run seeds the engine's own engaged operating
// point (workbench ibanez-ts9/tools/three-way-ts9.py NODESET, from `render:v2 --bias`); the same four nodes are used here, replacing
// the program's single seed. Not fitted to anything: it is the state the engine itself settles into.
const NODESET: Record<string, string> = { ts9: ".nodeset V(n33)=1.164 V(n35)=0.216 V(n32)=0.603 V(n34)=6.15" };
const work = mkdtempSync(join(tmpdir(), "pole-order2-spice-"));
const rows: Array<Record<string, unknown>> = [];
console.log(`[deck ${mode} pole] ngspice step 1/${SPICE_RATE}, ${SECONDS} s, window ${WIN.join("-")} s, ${AMP * 1000} mV`);
for (const pedal of pedals) {
	const base = compileFile(PACKETS[pedal]!.file);
	for (const state of states) {
		const positions = STATES[state]!;
		const program = { ...base, controls: base.controls.map((c) => (c.id in positions ? { ...c, defaultPosition: positions[c.id] } : c)) } as Program;
		const cells: string[] = [];
		for (const hz of freqs) {
			const dataPath = join(work, `${pedal}-${state}-${hz}.data`);
			const deck = programToSpiceDeck(program, { hz, amplitude: AMP, seconds: SECONDS, stepSeconds: 1 / SPICE_RATE, dataPath });
			if (deck === null || deck.unsupported.length > 0) throw new Error(`deck not expressible: ${deck?.unsupported.join(",")}`);
			const cir = join(work, `${pedal}-${state}-${hz}.cir`);
			const text = NODESET[pedal] === undefined ? deck.text : deck.text.split("\n").map((l) => (/^\.nodeset/i.test(l) ? NODESET[pedal] : l)).join("\n");
			writeFileSync(cir, text);
			execFileSync("ngspice", ["-b", cir], { encoding: "utf8", timeout: 1_800_000, maxBuffer: 256 * 1024 * 1024 });
			const lines = readFileSync(dataPath, "utf8").trim().split("\n");
			const t: number[] = [], v: number[] = [];
			for (const line of lines) { const c = line.trim().split(/\s+/).map(Number); if (c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) { t.push(c[0] as number); v.push(c[1] as number); } }
			const n = Math.round(SECONDS * SPICE_RATE), y = new Float64Array(n);
			for (let i = 0, j = 0; i < n; i += 1) { const tt = i / SPICE_RATE; while (j < t.length - 2 && (t[j + 1] as number) < tt) j += 1; const t0 = t[j] as number, t1 = t[j + 1] as number; y[i] = (v[j] as number) + (((v[j + 1] as number) - (v[j] as number)) * (tt - t0)) / (t1 - t0 || 1); }
			const w = y.subarray(Math.round(WIN[0] * SPICE_RATE), Math.round(WIN[1] * SPICE_RATE));
			const fund = fundamentalOf(w, SPICE_RATE, hz);
			rows.push({ pedal, state, hz, deck: mode, fund_mV: fund * 1000 });
			cells.push(`${hz}:${(fund * 1000).toFixed(3)}`);
			rmSync(dataPath, { force: true }); rmSync(cir, { force: true });
		}
		console.log(`${pedal} ${state.padEnd(9)} ${cells.join("  ")}`);
	}
}
if (out !== "") writeFileSync(out, JSON.stringify(rows));
rmSync(work, { recursive: true, force: true });
