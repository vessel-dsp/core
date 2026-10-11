// Check for finding 3: what clock does code inside an AudioWorkletGlobalScope have? The runtime worklet uses `performance.now()` when `typeof performance`
// is defined and `Date.now()` otherwise (v2-audio-worklet.ts:488-491, 511-514). A one-line processor reports `typeof performance`, and the step sizes of
// `Date.now()` over 200 000 reads, from inside a live-less OfflineAudioContext worklet.
//   NODE_PATH=<workbench>/node_modules bun docs/spikes/host-rate/clock-probe.ts --bundle=<js> --wasm=<wasm>
import { arg, defaultBundle, defaultWasm, openHarness } from "./lib";

const harness = await openHarness({ bundle: arg("bundle", defaultBundle()), wasm: arg("wasm", defaultWasm()), port: Number(arg("port", "8771")) });
try {
	const r = await harness.page(async () => {
		const src = `class P extends AudioWorkletProcessor { constructor(){ super(); this.done = false; }
			process(){ if (!this.done) { this.done = true;
				let steps = new Set(); let last = Date.now(); let n = 0;
				const t0 = Date.now();
				while (n < 2e6 && steps.size < 3) { const d = Date.now(); if (d !== last) { steps.add(d - last); last = d; } n++; }
				this.port.postMessage({ typeofPerformance: typeof performance, typeofDate: typeof Date, dateNowSteps: [...steps], reads: n, sampleRate, hasCurrentTime: typeof currentTime }); }
				return true; } }
			registerProcessor('probe', P);`;
		const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
		const ctx = new OfflineAudioContext(1, 4096, 48000);
		await ctx.audioWorklet.addModule(url);
		const node = new AudioWorkletNode(ctx, "probe");
		const msg = new Promise<any>((res) => (node.port.onmessage = (e) => res(e.data)));
		node.connect(ctx.destination);
		const rendering = ctx.startRendering();
		const m = await msg;
		await rendering;
		return m;
	});
	console.log(JSON.stringify(r));
} finally {
	await harness.close();
}
