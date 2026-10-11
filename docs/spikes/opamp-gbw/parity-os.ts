// Check (b): console parity WASM vs TS, the workbench method copied (never modified):
// 440 Hz @0.25 + 1320 Hz @0.1, cap 1024, settle 100 / window 2048 host samples, bars
// r >= 0.9999 AND maxDelta < 1e-4 (silent: delta only). Study controls for muff/sd1/ts9.
//   bun docs/spikes/newton-predictor-wasm/parity-os.ts --label=pre-port [--os=1,2,4,8] [--packet=a,b] [--window=2048 --settle=100]
import { ReferenceRuntime, V2WasmEngine } from "@vessel-dsp/runtime";
import { PACKETS, arg, compileFile, computeMetrics, twoTone } from "./lib";

const label = arg("label", "now");
const factors = arg("os", "1,2,4,8").split(",").map(Number);
const packets = arg("packet", Object.keys(PACKETS).join(",")).split(",");
const WINDOW = Number(arg("window", "2048")), SETTLE = Number(arg("settle", "100"));
const CAP = 1024, RATE = 48000;
console.log(`[${label}] parity: two-tone 440@0.25+1320@0.1, cap ${CAP}, settle ${SETTLE} / window ${WINDOW}; bars r>=0.9999 & maxDelta<1e-4`);
console.log(`packet    os | maxDelta   r          relRms    | TS it/host  WASM peak  TS peak | verdict`);
for (const slug of packets) {
	const spec = PACKETS[slug]!;
	const program = compileFile(spec.file);
	for (const os of factors) {
		const input = twoTone(WINDOW);
		const rt = new ReferenceRuntime(program);
		rt.prepare(RATE, { maxNewtonIterations: CAP, ...(os > 1 ? { oversample: os } : {}) });
		for (const [k, v] of Object.entries(spec.controls)) rt.setControl(k, v);
		const ts = rt.process(input);
		const t = rt.telemetry();
		const eng = await V2WasmEngine.create(program);
		eng.prepare({ sampleRate: RATE, maxNewtonIterations: CAP, ...(os > 1 ? { oversample: os } : {}) });
		for (const [k, v] of Object.entries(spec.controls)) eng.setControl(k, v);
		const wo = new Float32Array(WINDOW);
		eng.processBlock(Float32Array.from(input), wo);
		const a = Array.from(ts.subarray(SETTLE)), b = Array.from(wo.subarray(SETTLE));
		const m = computeMetrics(a, b);
		let d2 = 0, r2 = 0;
		for (let i = 0; i < a.length; i += 1) { d2 += ((a[i] as number) - (b[i] as number)) ** 2; r2 += (a[i] as number) ** 2; }
		const relRms = r2 > 0 ? Math.sqrt(d2 / r2) : Math.sqrt(d2 / a.length);
		const pass = m.isSilent ? m.maxDelta < 1e-4 : m.correlation >= 0.9999 && m.maxDelta < 1e-4;
		console.log(`${slug.padEnd(9)} ${String(os).padStart(2)} | ${m.maxDelta.toExponential(3)}  ${m.correlation.toFixed(6)}  ${relRms.toExponential(2)} | ${(t.totalIterations / WINDOW).toFixed(3).padStart(10)}  ${String(eng.getMaxIterations()).padStart(9)}  ${String(t.peakIterations).padStart(7)} | ${pass ? "PASS" : "FAIL"}`);
		eng.destroy();
	}
}
