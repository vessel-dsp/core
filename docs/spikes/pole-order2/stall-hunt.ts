// Which render of a document stalls? One render per (console, oversample) with a per-block stall guard, 1 kHz 100 mV (the corpus-hash stimulus), reporting per case the
// wall time, iterations per host sample, non-converged samples and peak (TS), or a STALL line. From whichever tree this is run in.
//   bun docs/spikes/pole-order2/stall-hunt.ts --slug=boss-ch-1 [--os=1,2,4] [--seconds=0.25] [--stall-ms=15000] [--consoles=ts,wasm]
import { StallError, arg, compileFile, fileForSlug, renderTs, renderWasm, sine } from "./lib";
const slug = arg("slug", "boss-ch-1"), factors = arg("os", "1,2,4").split(",").map(Number), seconds = Number(arg("seconds", "0.25")), stallMs = Number(arg("stall-ms", "15000"));
const consoles = arg("consoles", "ts,wasm").split(",");
const program = compileFile(fileForSlug(slug)), N = Math.round(48000 * seconds), input = sine(N, 1000, 0.1);
for (const os of factors) for (const cn of consoles) {
	const t0 = Date.now();
	try {
		if (cn === "ts") { const t = renderTs(program, {}, input, { os, stallMs, block: 512 }); console.log(`${slug} ts   x${os}: ${Date.now() - t0} ms it/host ${(t.iterations / N).toFixed(2)} NC ${t.nonConverged} peak ${t.peak}`); }
		else { const w = await renderWasm(program, {}, input, { os, stallMs, block: 512 }); console.log(`${slug} wasm x${os}: ${Date.now() - t0} ms it/host ${(w.totalIterations / N).toFixed(2)} peak ${w.peak}`); }
	} catch (e) { if (!(e instanceof StallError)) throw e; console.log(`${slug} ${cn} x${os}: STALL after ${Date.now() - t0} ms: ${e.message}`); }
}
