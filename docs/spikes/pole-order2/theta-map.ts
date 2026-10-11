// PRE-REGISTERED MAP, NOT A CHOICE (coordinator, 2026-10-10): the theta-method family theta in {0.5, 0.6, 0.75, 1.0} (0.5 = trapezoid, 1.0 = backward Euler), scratch only, TS console.
// POLE_SCHEME=theta POLE_THETA=<theta> selects it in the scratch candidate clone (cand-patch.py). Metrics per theta: (1) the gain-100 closed-loop error against the continuous
// single pole at 10 kHz, at x1 (48 kHz solver) and os4 (192 kHz), 1 mV drive; (2) convergence on the documents that broke or are canaries: iterations per host sample,
// non-converged samples, peak, STALL (a block over --stall-ms). Theta != 0.5 is first order, so any theta other than 0.5 and 1.0 is a tuned constant: this reports where the
// points fall and selects none.
//   POLE_SCHEME=theta POLE_THETA=0.6 bun docs/spikes/pole-order2/theta-map.ts --label=0.6 --out=<json> [--stall-ms=30000] [--skip-docs]   (TS)
//   bun docs/spikes/pole-order2/theta-map.ts --label=0.6 --wasm-dir=<scratch>/wasm-theta/0.6 --out=<json> --stall-ms=8000                (WASM)
import { writeFileSync } from "node:fs";
import { compile, emptyRegistry } from "@vessel-dsp/compiler";
import { nonInvertingStage } from "../../../packages/runtime/tests/non-inverting-stage";
import { continuousClosedLoopDb } from "./closed-forms";
import { StallError, arg, compileFile, fileForSlug, fundamentalOf, has, renderTs, renderWasm, sine } from "./lib";
const label = arg("label", process.env.POLE_THETA ?? "?"), out = arg("out", ""), stallMs = Number(arg("stall-ms", "30000"));
const wasmDir = arg("wasm-dir", "") || undefined; // set: render on the scratch WASM build of this theta (theta-cpp-patch.py + build-theta-wasm.sh) instead of the TS console
const rows: Array<Record<string, unknown>> = [];
// (1) known answer: gain 100, 10 kHz (and 8 kHz), TS, 1 mV, x1 and os4
const stage = compile(nonInvertingStage({ rfOhms: 99000, rgOhms: 1000 }), { registry: emptyRegistry });
if (stage.status !== "ok") throw new Error("stage");
const errs: string[] = [];
for (const os of [1, 4]) for (const hz of [8000, 10000]) {
	const n = Math.round(48000 * 0.3);
	const y = wasmDir === undefined ? renderTs(stage.program, {}, sine(n, hz, 0.001), { rate: 48000, os, sourceOhms: 0, block: n }).out : Float64Array.from((await renderWasm(stage.program, {}, sine(n, hz, 0.001), { rate: 48000, os, sourceOhms: 0, block: n, wasmDir })).out);
	const e = 20 * Math.log10(fundamentalOf(y.subarray(Math.round(48000 * 0.05)), 48000, hz) / 0.001) - continuousClosedLoopDb(100, Number(process.env.GBW_HZ ?? 1e6), hz);
	rows.push({ kind: "known-answer", theta: label, os, hz, errDb: e });
	errs.push(`os${os} ${hz / 1000}k ${e.toFixed(3)} dB`);
}
console.log(`theta ${label}: gain-100 error vs continuous: ${errs.join(" | ")}`);
if (!has("skip-docs")) {
	const tone = (n: number): Float64Array => Float64Array.from({ length: n }, (_, i) => 0.25 * Math.sin((2 * Math.PI * 440 * i) / 48000) + 0.1 * Math.sin((2 * Math.PI * 1320 * i) / 48000));
	const cases: Array<[string, number, string, Float64Array]> = [
		["boss-ch-1", 1, "1kHz-100mV-0.25s", sine(12000, 1000, 0.1)], ["boss-ch-1", 4, "1kHz-100mV-0.25s", sine(12000, 1000, 0.1)],
		["boss-mt-2", 1, "1kHz-100mV-0.25s", sine(12000, 1000, 0.1)], ["boss-mt-2", 4, "1kHz-100mV-0.25s", sine(12000, 1000, 0.1)],
		["boss-mt-2", 1, "two-tone-1s", tone(48000)],
		["boss-bd-2-blues-driver", 1, "1kHz-100mV-0.25s", sine(12000, 1000, 0.1)], ["boss-bd-2-blues-driver", 4, "1kHz-100mV-0.25s", sine(12000, 1000, 0.1)],
		["ibanez-pql", 1, "1kHz-100mV-0.25s", sine(12000, 1000, 0.1)], ["ibanez-pql", 4, "1kHz-100mV-0.25s", sine(12000, 1000, 0.1)],
		["mxr-blue-box", 1, "1kHz-100mV-0.25s", sine(12000, 1000, 0.1)], ["mxr-blue-box", 4, "1kHz-100mV-0.25s", sine(12000, 1000, 0.1)],
		["mxr-blue-box", 1, "1kHz-10mV-1s", sine(48000, 1000, 0.01)],
	];
	for (const [slug, os, stim, input] of cases) {
		const program = compileFile(fileForSlug(slug)), t0 = Date.now();
		const row: Record<string, unknown> = { kind: "doc", theta: label, slug, os, stim };
		try {
			if (wasmDir === undefined) { const t = renderTs(program, {}, input, { os, stallMs, block: 512 }); Object.assign(row, { it: t.iterations / input.length, nc: t.nonConverged, peak: t.peak }); }
			else { const w = await renderWasm(program, {}, input, { os, stallMs, block: 512, wasmDir }); Object.assign(row, { it: w.totalIterations / input.length, peak: w.peak }); }
		}
		catch (e) { if (!(e instanceof StallError)) throw e; row.stall = e.message; }
		row.ms = Date.now() - t0; rows.push(row);
		console.log(`theta ${label} ${slug.padEnd(24)} x${os} ${stim.padEnd(17)} ${row.stall ? "STALL" : `it/host ${(row.it as number).toFixed(2)} NC ${row.nc ?? "n/a"} peak ${row.peak}`} (${row.ms} ms)`);
	}
}
if (out !== "") writeFileSync(out, JSON.stringify(rows));
