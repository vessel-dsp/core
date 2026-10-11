// Check 5a: TIME-BASED BEHAVIOUR AT ANOTHER HOST RATE. A rate-dependent constant would read a different TIME at some host rate.
//
//   bun docs/spikes/host-rate/time-based.ts --kind=delay|lfo|env|all [--consoles=wasm,ts] [--arms=...] [--out=<jsonl>] [--ts-max-internal=192000]
//
//  delay  `electro-harmonix-slapback-echo`, `pt2399-delay` (`--docs=` adds more; `--filter=` restricts modes): an impulse into the program and the first repeat's position, measured as
//         `workbench/scripts/report-delay-time.ts` does (read-only copy: modes from the program, driven render minus silent render, first
//         burst not the loudest, 3 s settle first), generalised from RATE = 48000 to the arm's host rate. The reading in SECONDS is compared
//         with the declared time and across arms.
//  lfo    `mxr-phase-90` (Speed = 0.5) and `schaller-tremolo` (default controls): a five-tone stimulus (440..2200 Hz), the output's 1 ms
//         peak envelope, and the frequency of the envelope's strongest component below 12 Hz (FFT of the settled window, parabolic peak),
//         in Hz, compared with the 48 kHz x1 reading.
//  env    `mxr-dyna-comp`: 1 kHz at 10 mV for 1.5 s, 300 mV for 2.5 s (attack), 10 mV for 6 s (release); the gain (1 ms peak envelope out/in)
//         time to cover 63.2 % of its step after each edge, in seconds, compared across arms.
// Consoles: the TS `ReferenceRuntime` and the WASM `V2WasmEngine` (the shipping one), each prepared at (host, factor) directly -- no chain, no DC blocker.
import { readFileSync } from "node:fs";
import type { Block, Program } from "@vessel-dsp/compiler";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import { ReferenceRuntime, V2WasmEngine } from "@vessel-dsp/runtime";
import { ART, arg, jsonl, selectArms, ts, type Arm } from "./lib";

const kinds = arg("kind", "all") === "all" ? ["delay", "lfo", "env"] : arg("kind", "all").split(",");
const consoles = arg("consoles", "wasm,ts").split(",");
const arms = selectArms(arg("arms", "48k x1,96k x1,192k x1,96k os2,48k os4"));
const out = arg("out", "");
const tsMaxInternal = Number(arg("ts-max-internal", "192000"));
const settleSeconds = Number(arg("settle", "3"));
const seconds = Number(arg("seconds", "4"));

type Renderer = { process(x: Float64Array): Float64Array; setControl(id: string, v: number): void; destroy(): void };
async function make(program: Program, arm: Arm, consoleName: string): Promise<Renderer> {
	if (consoleName === "wasm") {
		const eng = await V2WasmEngine.create(program);
		eng.prepare({ sampleRate: arm.host, ...(arm.factor > 1 ? { oversample: arm.factor } : {}) });
		return {
			setControl: (id, v) => eng.setControl(id, v),
			process(x) {
				const o = new Float64Array(x.length);
				const CH = 512;
				const inF = new Float32Array(CH);
				const outF = new Float32Array(CH);
				for (let i = 0; i < x.length; i += CH) {
					const n = Math.min(CH, x.length - i);
					const a = n === CH ? inF : new Float32Array(n);
					const b = n === CH ? outF : new Float32Array(n);
					for (let k = 0; k < n; k += 1) a[k] = x[i + k] as number;
					eng.processBlock(a, b);
					for (let k = 0; k < n; k += 1) o[i + k] = b[k] as number;
				}
				return o;
			},
			destroy: () => eng.destroy(),
		};
	}
	const rt = new ReferenceRuntime(program);
	rt.prepare(arm.host, arm.factor > 1 ? { oversample: arm.factor } : {});
	return { setControl: (id, v) => rt.setControl(id, v), process: (x) => rt.process(x), destroy: () => undefined };
}
function load(name: string): Program {
	const r = compile(readFileSync(`${ART}/schematics/vessel-dsp/${name}.vdsp`, "utf8"), { registry: pedalPartCatalog } as never) as { status: string; program: Program };
	if (r.status !== "ok") throw new Error(`${name} did not compile`);
	return r.program;
}

// ---- delay: report-delay-time.ts's analyzer and mode finder, host rate as a parameter ------------------------------------------------
const ABSOLUTE_TOLERANCE_S = 0.00025;
const TAP_SECONDS = 0.5;
const ECHO_FLOOR = 1e-4;
const DIRECT_WINDOW_S = 0.002;
const BURST_SHARE = 0.25;
type Reading = { dry: number; echo: number; echoSeconds: number };
function analyze(difference: Float64Array, declaredSeconds: number, H: number): Reading & { verdict: string } {
	const envSamples = Math.max(1, Math.round(0.001 * H)); // 1 ms blocks (the original is 48 samples at 48 kHz)
	const windowSeconds = Number.isFinite(declaredSeconds) && declaredSeconds > 0 ? Math.min(DIRECT_WINDOW_S, declaredSeconds / 2) : DIRECT_WINDOW_S;
	const directEnd = Math.max(1, Math.round(windowSeconds * H));
	let dry = 0;
	for (let i = 0; i < Math.min(directEnd, difference.length); i += 1) dry = Math.max(dry, Math.abs(difference[i] ?? 0));
	const blocks: number[] = [];
	for (let i = directEnd; i < difference.length; i += envSamples) {
		let peak = 0;
		for (let j = i; j < Math.min(i + envSamples, difference.length); j += 1) peak = Math.max(peak, Math.abs(difference[j] ?? 0));
		blocks.push(peak);
	}
	const loudest = blocks.reduce((m, v) => Math.max(m, v), 0);
	const threshold = Math.max(ECHO_FLOOR, BURST_SHARE * loudest);
	const first = blocks.findIndex((v) => v >= threshold);
	let last = first;
	if (first >= 0) while (last + 1 < blocks.length && ((blocks[last + 1] ?? 0) >= threshold || (blocks[last + 2] ?? 0) >= threshold)) last += 1;
	let echo = 0;
	let index = -1;
	if (first >= 0) {
		const from = directEnd + first * envSamples;
		const to = Math.min(difference.length, directEnd + (last + 1) * envSamples);
		for (let i = from; i < to; i += 1) {
			const v = Math.abs(difference[i] ?? 0);
			if (v > echo) {
				echo = v;
				index = i;
			}
		}
	}
	const echoSeconds = index < 0 ? 0 : index / H;
	if (echo <= ECHO_FLOOR) return { verdict: dry > ECHO_FLOOR ? "DRY-ONLY" : "NO-ECHO", dry, echo, echoSeconds: 0 };
	const off = Math.abs(echoSeconds - declaredSeconds);
	return { verdict: declaredSeconds > 0 && (off <= 0.05 * declaredSeconds || off <= ABSOLUTE_TOLERANCE_S) ? "DELAYS" : "WRONG-TIME", dry, echo, echoSeconds };
}
type Mode = {
	positionId: string;
	declaredSeconds: number;
	sweep: { controlId: string; at: 0 | 1 } | { controlId: string; tapSeconds: number } | null;
	controlId: string | null;
	detent: number | null;
	blockId: string;
};
function modesOf(program: Program): Mode[] {
	const out: Mode[] = [];
	for (const block of program.blocks) {
		if (block.kind !== "composed") continue;
		const composed = block as Extract<Block, { kind: "composed" }>;
		composed.positions.forEach((position, index) => {
			const lines = Object.values(position.lines);
			if (lines.length === 0) return;
			const tapped = position.ops.some((op) => op.op === "delay-tap" || op.op === "delay-tap-fractional" || op.op === "delay-tap-reverse");
			if (!tapped) return;
			const declaredSeconds = Math.max(...lines.map((l) => l.delaySeconds));
			if (!(declaredSeconds > 0)) return;
			const router = composed.router ?? null;
			const detent = router === null ? null : router.routes.findIndex((t) => t === index);
			const base = { blockId: composed.id, positionId: position.id, detent: detent === null || detent < 0 ? null : detent, controlId: router?.controlId ?? null, declaredSeconds, sweep: null };
			const longest = lines.find((l) => l.delaySeconds === declaredSeconds);
			const lineSweep = longest?.sweep;
			if (lineSweep === undefined) {
				out.push(base);
				return;
			}
			if (lineSweep.read === "tapped") {
				const expected = Math.min(declaredSeconds, Math.max(longest?.minSeconds ?? 0, TAP_SECONDS * lineSweep.ratio));
				out.push({ ...base, positionId: `${position.id} tap ${TAP_SECONDS}s`, declaredSeconds: expected, sweep: { controlId: lineSweep.controlId, tapSeconds: TAP_SECONDS } });
				return;
			}
			const swept = lineSweep.controlId;
			out.push(
				{ ...base, positionId: `${position.id} ${swept}=0`, declaredSeconds: longest?.minSeconds ?? 0, sweep: { controlId: swept, at: 0 } },
				{ ...base, positionId: `${position.id} ${swept}=1`, sweep: { controlId: swept, at: 1 } },
			);
		});
	}
	return out;
}
async function renderDiff(program: Program, mode: Mode, arm: Arm, consoleName: string, driven: boolean): Promise<Float64Array> {
	const H = arm.host;
	const r = await make(program, arm, consoleName);
	if (mode.controlId !== null && mode.detent !== null) {
		const block = program.blocks.find((b) => b.id === mode.blockId);
		const positions = block !== undefined && block.kind === "composed" && block.router !== null ? block.router.positions : 2;
		r.setControl(mode.controlId, positions > 1 ? mode.detent / (positions - 1) : 0);
	}
	if (mode.sweep !== null && "at" in mode.sweep) r.setControl(mode.sweep.controlId, mode.sweep.at);
	r.process(new Float64Array(Math.round(settleSeconds * H)));
	if (mode.sweep !== null && "tapSeconds" in mode.sweep) {
		const quiet = (s: number) => r.process(new Float64Array(Math.round(s * H)));
		const tap = mode.sweep.controlId;
		const presses = Math.max(2, program.controls.find((c) => c.id === tap)?.tap?.presses ?? 2);
		for (let press = 0; press < presses; press += 1) {
			r.setControl(tap, 1);
			quiet(0.02);
			r.setControl(tap, 0);
			quiet(press === presses - 1 ? 0.2 : mode.sweep.tapSeconds - 0.02);
		}
	}
	const input = new Float64Array(Math.round(seconds * H));
	if (driven) input[0] = 1;
	const o = r.process(input);
	r.destroy();
	return o;
}

// ---- lfo / env helpers ----------------------------------------------------------------------------------------------------------------
function peakEnvelope(x: Float64Array, H: number, ms = 1): Float64Array {
	const b = Math.max(1, Math.round((ms / 1000) * H));
	const out = new Float64Array(Math.floor(x.length / b));
	for (let i = 0; i < out.length; i += 1) {
		let p = 0;
		for (let k = 0; k < b; k += 1) p = Math.max(p, Math.abs(x[i * b + k] as number));
		out[i] = p;
	}
	return out;
}
/** Frequency (Hz) of the strongest component of `env` (sampled at envRate) between 0.1 and 12 Hz: DFT scan at 0.01 Hz steps then a parabolic refinement. */
function dominantHz(env: Float64Array, envRate: number): { hz: number; strength: number } {
	let mean = 0;
	for (const v of env) mean += v;
	mean /= env.length;
	const x = Float64Array.from(env, (v, i) => (v - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (env.length - 1))));
	const power = (f: number) => {
		let re = 0;
		let im = 0;
		const w = (2 * Math.PI * f) / envRate;
		for (let i = 0; i < x.length; i += 1) {
			re += (x[i] as number) * Math.cos(w * i);
			im -= (x[i] as number) * Math.sin(w * i);
		}
		return re * re + im * im;
	};
	let best = { f: 0.1, p: -1 };
	for (let f = 0.1; f <= 12; f += 0.02) {
		const p = power(f);
		if (p > best.p) best = { f, p };
	}
	const a = power(best.f - 0.02);
	const c = power(best.f + 0.02);
	const denom = a - 2 * best.p + c;
	const hz = denom === 0 ? best.f : best.f + (0.02 * 0.5 * (a - c)) / denom;
	return { hz, strength: Math.sqrt(best.p) / x.length };
}

const rows: Record<string, unknown>[] = [];
const emit = (row: Record<string, unknown>): void => {
	rows.push(row);
	if (out !== "") jsonl(out, row);
};
console.log(`time-based: ${ts()} kinds=${kinds.join(",")} consoles=${consoles.join(",")} arms=${arms.map((a) => a.name).join(", ")}`);

if (kinds.includes("delay")) {
	const filter = new RegExp(arg("filter", ".*"));
	for (const name of arg("docs", "electro-harmonix-slapback-echo,pt2399-delay").split(",")) {
		const program = load(name);
		const modes = modesOf(program).filter((m) => filter.test(m.positionId));
		console.log(`\n## delay ${name}: ${modes.length} mode(s): ${modes.map((m) => `${m.positionId} declared ${(m.declaredSeconds * 1000).toFixed(3)} ms`).join("; ")}`);
		for (const mode of modes) {
			for (const consoleName of consoles) {
				for (const arm of arms) {
					if (consoleName === "ts" && arm.internal > tsMaxInternal) continue;
					const t0 = performance.now();
					const driven = await renderDiff(program, mode, arm, consoleName, true);
					const silent = await renderDiff(program, mode, arm, consoleName, false);
					const n = Math.min(driven.length, silent.length);
					const diff = new Float64Array(n);
					for (let i = 0; i < n; i += 1) diff[i] = (driven[i] as number) - (silent[i] as number);
					const r = analyze(diff, mode.declaredSeconds, arm.host);
					emit({ kind: "delay", doc: name, mode: mode.positionId, console: consoleName, arm: arm.name, host: arm.host, factor: arm.factor, declaredSeconds: mode.declaredSeconds, echoSeconds: r.echoSeconds, verdict: r.verdict, dry: r.dry, echo: r.echo });
					console.log(`  ${mode.positionId.padEnd(22)} ${consoleName.padEnd(4)} ${arm.name.padEnd(8)} echo at ${(r.echoSeconds * 1000).toFixed(4)} ms (declared ${(mode.declaredSeconds * 1000).toFixed(4)} ms; one host sample = ${(1000 / arm.host).toFixed(4)} ms) ${r.verdict} dry ${r.dry.toExponential(2)} (${Math.round((performance.now() - t0) / 1000)} s)`);
				}
			}
		}
	}
}
if (kinds.includes("lfo")) {
	const lfoSets: [string, Record<string, number>][] = arg("lfo", "default") === "speed1" ? [["mxr-phase-90", { Speed: 1 }]] : [["mxr-phase-90", { Speed: 0.5 }], ["schaller-tremolo", {}]];
	for (const [name, controls] of lfoSets) {
		const program = load(name);
		for (const consoleName of consoles) {
			for (const arm of arms) {
				if (consoleName === "ts" && arm.internal > tsMaxInternal) continue;
				const H = arm.host;
				const r = await make(program, arm, consoleName);
				for (const [id, v] of Object.entries(controls)) r.setControl(id, v);
				const total = 22;
				const x = new Float64Array(Math.round(total * H));
				for (const f of [440, 880, 1320, 1760, 2200]) for (let i = 0; i < x.length; i += 1) x[i] += 0.02 * Math.sin((2 * Math.PI * f * i) / H);
				const t0 = performance.now();
				const y = r.process(x);
				r.destroy();
				const env = peakEnvelope(y, H);
				const from = Math.round(6 * 1000); // 6 s settle, envelope rate 1 kHz
				const d = dominantHz(env.subarray(from), 1000);
				emit({ kind: "lfo", doc: name, controls: JSON.stringify(controls), console: consoleName, arm: arm.name, host: H, factor: arm.factor, hz: d.hz, strength: d.strength });
				console.log(`  lfo ${name.padEnd(17)} ${JSON.stringify(controls)} ${consoleName.padEnd(4)} ${arm.name.padEnd(8)} modulation ${d.hz.toFixed(3)} Hz (strength ${d.strength.toExponential(2)}; ${Math.round((performance.now() - t0) / 1000)} s)`);
			}
		}
	}
}
if (kinds.includes("env")) {
	const name = "mxr-dyna-comp";
	const program = load(name);
	for (const consoleName of consoles) {
		for (const arm of arms) {
			if (consoleName === "ts" && arm.internal > tsMaxInternal) continue;
			const H = arm.host;
			const r = await make(program, arm, consoleName);
			const segs = [{ s: 1.5, a: 0.01 }, { s: 2.5, a: 0.3 }, { s: 6, a: 0.01 }];
			const x = new Float64Array(Math.round(10 * H));
			let at = 0;
			const edges: number[] = [];
			for (const seg of segs) {
				const n = Math.round(seg.s * H);
				for (let i = 0; i < n; i += 1) x[at + i] = seg.a * Math.sin((2 * Math.PI * 1000 * (at + i)) / H);
				edges.push(at / H);
				at += n;
			}
			const t0 = performance.now();
			const y = r.process(x);
			r.destroy();
			const envIn = peakEnvelope(x, H);
			const envOut = peakEnvelope(y, H);
			const gain = Float64Array.from(envOut, (v, i) => v / Math.max(1e-12, envIn[i] as number));
			const tc = (edgeS: number, endS: number): number => {
				const i0 = Math.round(edgeS * 1000);
				const before = gain.subarray(i0 - 100, i0 - 5).reduce((m, v) => m + v, 0) / 95; // 5-100 ms before the edge
				const i1 = Math.round(endS * 1000);
				const after = gain.subarray(i1 - 100, i1 - 5).reduce((m, v) => m + v, 0) / 95;
				const target = before + (after - before) * (1 - Math.exp(-1));
				for (let i = i0 + 3; i < i1; i += 1) if ((after > before ? (gain[i] as number) >= target : (gain[i] as number) <= target)) return (i - i0) / 1000;
				return Number.NaN;
			};
			const attack = tc(edges[1] as number, (edges[2] as number) - 0.05);
			const release = tc(edges[2] as number, 10 - 0.05);
			emit({ kind: "env", doc: name, console: consoleName, arm: arm.name, host: H, factor: arm.factor, attackSeconds: attack, releaseSeconds: release });
			console.log(`  env ${name} ${consoleName.padEnd(4)} ${arm.name.padEnd(8)} attack (63.2 %) ${(attack * 1000).toFixed(1)} ms, release ${(release * 1000).toFixed(1)} ms (${Math.round((performance.now() - t0) / 1000)} s)`);
		}
	}
}
console.log(`time-based: done ${ts()}`);
