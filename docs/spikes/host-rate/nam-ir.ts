// Check 5c: NAM AND IR THROUGH THE HEADLESS CHAIN AT A NON-48 kHz HOST. Refuse, resample, or silently wrong?
//
//   bun docs/spikes/host-rate/nam-ir.ts [--out=<json>]
//
// Real vendored NAM engine (`packages/chain/nam-engine/nam-engine.wasm`), a synthetic `Linear` model (the weights ARE the impulse response; the repo has no
// `.nam` or IR binary assets, its own tests build this model), `NamNode` and `CabinetIrNode` from `@vessel-dsp/chain`, and `SignalChain` constructed at the host rate.
//   NAM  : a model that states its rate (48000) at 48 / 96 / 192 kHz; the same model with NO `sample_rate` at the same rates
//   IR   : the built-in placeholder IR (declared 48 kHz), a spike at 1 ms with `irSampleRate: 48000`, the same spike with NO `irSampleRate`
// plus what SignalChain does with a refused node. The packaged core worklet's refusal is read from source (`v2-audio-worklet.ts:279-285`), not run here.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CabinetIrNode, instantiateNamEngine, NamNode, SignalChain, type NamEngineModule } from "@vessel-dsp/chain";
import { ChainRuntime, type ExternalProcessor } from "@vessel-dsp/runtime";
import { arg, ts } from "./lib";

const root = process.cwd();
const GLUE = join(root, "packages/chain/nam-engine/nam-engine.js");
const WASM = join(root, "packages/chain/nam-engine/nam-engine.wasm");
const { readFileSync } = await import("node:fs");
const factory = (await import(GLUE)).default as (o: { wasmBinary: ArrayBufferLike }) => Promise<NamEngineModule>;
const engine = await instantiateNamEngine(readFileSync(WASM), factory);
const WEIGHTS = [0.5, -0.25, 0.125, 0.0625];
const model = (withRate: boolean) =>
	JSON.stringify({
		version: "0.5.0", architecture: "Linear",
		config: { receptive_field: WEIGHTS.length, bias: false, in_channels: 1, out_channels: 1, implementation: "direct" },
		weights: WEIGHTS, metadata: { loudness: -14.0 }, ...(withRate ? { sample_rate: 48000 } : {}),
	});
const rows: Record<string, unknown>[] = [];
const say = (row: Record<string, unknown>, text: string): void => {
	rows.push(row);
	console.log(text);
};
console.log(`nam-ir: ${ts()}`);

console.log("\n## NAM");
for (const declared of [true, false]) {
	for (const H of [48000, 96000, 192000]) {
		const node = new NamNode("nam", "NAM", { engine, model: model(declared) });
		let outcome = "";
		let expected: number | null = null;
		let impulse: number[] = [];
		try {
			node.prepare(H);
			expected = node.getInfo().expectedSampleRate;
			const x = new Float64Array(16);
			x[0] = 0.1;
			impulse = Array.from(node.process(x)).slice(0, 5);
			outcome = "RAN";
		} catch (e) {
			outcome = `REFUSED: ${(e as Error).message}`;
		}
		node.dispose();
		say({ kind: "nam", declared, host: H, outcome, expected, impulse }, `  model ${declared ? "states 48000 Hz " : "states no rate  "} host ${String(H).padStart(6)}: ${outcome}${outcome === "RAN" ? ` (expectedSampleRate ${expected}; first output samples ${impulse.map((v) => v.toFixed(5)).join(" ")})` : ""}`);
	}
}
// what a host sees if it catches the refusal: the node SignalChain.addNode already pushed
{
	const chain = new SignalChain({ sampleRate: 96000 });
	const node = new NamNode("nam", "NAM", { engine, model: model(true) });
	let threw = "";
	try {
		chain.addNode(node);
	} catch (e) {
		threw = (e as Error).message;
	}
	const stillThere = chain.getNodes().some((n) => n.id === "nam");
	const x = new Float64Array(256);
	for (let i = 0; i < x.length; i += 1) x[i] = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / 96000);
	const y = chain.process(x);
	// the same chain with no NAM node at all: if the outputs are identical the refused node is a silent passthrough
	const bare = new SignalChain({ sampleRate: 96000 });
	const z = bare.process(x);
	let maxDiff = 0;
	for (let i = 0; i < x.length; i += 1) maxDiff = Math.max(maxDiff, Math.abs((y[i] as number) - (z[i] as number)));
	say({ kind: "nam-chain", threw, stillThere, maxDiffVsNoNamChain: maxDiff }, `  SignalChain at 96 kHz addNode(declared-48k NAM): threw ${threw === "" ? "nothing" : `"${threw.slice(0, 110)}..."`}; node still in the chain: ${stillThere}; chain.process afterwards vs the same chain with no NAM node: max |difference| = ${maxDiff.toExponential(2)} (${maxDiff < 1e-12 ? "the refused node is a dry passthrough" : "the node processed"})`);
}

// the same refusal through the headless ChainRuntime: a NamNode as a `kind: "processor"` slot (the way a host would inject one)
for (const declared of [true, false]) {
	for (const H of [48000, 96000, 192000]) {
		const node = new NamNode("nam", "NAM", { engine, model: model(declared) });
		const processor: ExternalProcessor = {
			id: "nam", produces: "speaker-electrical", expects: "instrument",
			portFullScaleVolts: { input: null, output: null }, portImpedanceOhms: null,
			prepare: (rate) => node.prepare(rate), process: (buffer) => node.process(buffer),
		};
		let outcome = "";
		try {
			const chain = new ChainRuntime([{ kind: "processor", processor }]);
			chain.prepare(H);
			const x = new Float64Array(256);
			for (let i = 0; i < x.length; i += 1) x[i] = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / H);
			chain.process(x);
			outcome = "RAN";
		} catch (e) {
			outcome = `${(e as Error).constructor.name}: ${(e as Error).message.slice(-96)}`;
		}
		node.dispose();
		say({ kind: "nam-chainruntime", declared, host: H, outcome }, `  ChainRuntime slot, model ${declared ? "states 48000 Hz" : "states no rate "} host ${String(H).padStart(6)}: ${outcome}`);
	}
}

console.log("\n## IR");
const spike = (idx: number, len = 256) => Float64Array.from({ length: len }, (_, i) => (i === idx ? 1 : 0));
const peak = (ir: Float64Array): number => {
	let b = 0;
	for (let i = 0; i < ir.length; i += 1) if (Math.abs(ir[i] as number) > Math.abs(ir[b] as number)) b = i;
	return b;
};
for (const [label, make] of [
	["built-in placeholder (declared 48 kHz)", () => new CabinetIrNode("cab", "Cab")],
	["spike at 1 ms, irSampleRate 48000", () => new CabinetIrNode("cab", "Cab", { ir: spike(48), irSampleRate: 48000, mix: 1 })],
	["spike at 1 ms, NO irSampleRate", () => new CabinetIrNode("cab", "Cab", { ir: spike(48), mix: 1 })],
] as [string, () => CabinetIrNode][]) {
	for (const H of [48000, 96000, 192000]) {
		const node = make();
		node.prepare(H);
		const ir = node.getIr();
		const p = peak(ir);
		say({ kind: "ir", label, host: H, length: ir.length, peakIndex: p, peakMs: (p / H) * 1000, lengthMs: (ir.length / H) * 1000 }, `  ${label.padEnd(40)} host ${String(H).padStart(6)}: ${ir.length} taps (${((ir.length / H) * 1000).toFixed(3)} ms), main tap at index ${p} = ${((p / H) * 1000).toFixed(4)} ms`);
	}
}
const out = arg("out", "");
if (out !== "") writeFileSync(out, JSON.stringify(rows, null, 1));
