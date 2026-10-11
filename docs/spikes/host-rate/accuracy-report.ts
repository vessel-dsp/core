// Check 2 (tables): joins accuracy rows (accuracy.ts) with native references (natives.ts) and checks them against the predictions.
//
//   bun docs/spikes/host-rate/accuracy-report.ts --data=<dir holding accuracy-{wasm,ts}.jsonl and natives-<pedal>.json>
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { ARMS, arg, db, readJsonl } from "./lib";

const dir = arg("data", process.cwd());
type Row = { key: string; pedal: string; arm: string; host: number; factor: number; internal: number; hz: number; console: string; fundV: number; scale: number };
const rows: Row[] = readdirSync(dir).filter((f) => /^accuracy-.*\.jsonl$/.test(f)).sort().flatMap((f) => readJsonl<Row>(`${dir}/${f}`));
const natives: Record<string, Record<string, number>> = {};
for (const p of ["muff", "sd1", "ts9"]) natives[p] = existsSync(`${dir}/natives-${p}.json`) ? JSON.parse(readFileSync(`${dir}/natives-${p}.json`, "utf8")) : {};
const nat = (p: string, hz: number, rate: number): number | null => natives[p]?.[`${p}|${hz}|10|${rate}`] ?? null;
const HZS = [1000, 4000, 8000, 12500, 16000, 20000, 30000];
const PEDALS = ["muff", "sd1", "ts9"];
const get = (p: string, arm: string, hz: number, c: string): number | null => rows.find((r) => r.pedal === p && r.arm === arm && r.hz === hz && r.console === c)?.fundV ?? null;
const fmt = (v: number | null, w = 8): string => (v === null || !Number.isFinite(v) ? "n/a".padStart(w) : `${v >= 0 ? "+" : ""}${v.toFixed(4)}`.padStart(w));
const lines: string[] = [];
const P = (s = ""): void => {
	lines.push(s);
	console.log(s);
};
const consoles = ["wasm", "ts"].filter((c) => rows.some((r) => r.console === c));

P(`# accuracy report (rows: ${rows.length}; consoles ${consoles.join(", ")}; natives: ${PEDALS.map((p) => `${p} ${Object.keys(natives[p] ?? {}).length}`).join(", ")})`);

// --- tables (a) own internal native, (b) 192k, (c) 384k, (d) 768k ---------------------------------------------------------
const refs: { label: string; rate: (arm: (typeof ARMS)[number]) => number }[] = [
	{ label: "(a) vs the native render at the arm's OWN internal rate", rate: (a) => a.internal },
	{ label: "(b) vs native 192 kHz", rate: () => 192000 },
	{ label: "(c) vs native 384 kHz", rate: () => 384000 },
	{ label: "(d) vs native 768 kHz (closest to the continuous solution measured here)", rate: () => 768000 },
];
for (const ref of refs) {
	P(`\n## ${ref.label}, dB (worklet over native; 0 = match)`);
	for (const c of consoles) {
		P(`\n### console ${c}`);
		P(`| pedal | arm | internal | ${HZS.map((h) => `${h / 1000}k`).join(" | ")} |`);
		P(`|---|---|---|${HZS.map(() => "---").join("|")}|`);
		for (const p of PEDALS) {
			for (const arm of ARMS) {
				const cells = HZS.map((hz) => {
					const w = get(p, arm.name, hz, c);
					const n = nat(p, hz, ref.rate(arm));
					return w === null || n === null ? "" : db(w / n).toFixed(4);
				});
				P(`| ${p} | ${arm.name} | ${arm.internal / 1000}k | ${cells.map((x) => (x === "" ? "-" : x)).join(" | ")} |`);
			}
		}
	}
}

// --- phase-1 cross-check: this harness at 48k reproduces the phase-1 figures -------------------------------------------------
P("\n## cross-check against phase 1 (worklet vs native 192k at 48 kHz host, dB): this harness vs the phase-1 note");
const PH1: Record<string, Record<string, Record<number, number>>> = {
	"48k x1": { muff: { 1000: -0.0046, 4000: -0.4136, 8000: -2.2201, 16000: -12.3368 }, sd1: { 1000: -0.0133, 4000: -0.3095, 8000: -1.21, 16000: -4.9476 }, ts9: { 1000: -0.0068, 4000: -0.3059, 8000: -1.2545, 16000: -5.6577 } },
	"48k os2": { muff: { 1000: 0.0039, 4000: -0.077, 8000: -0.4135, 16000: -1.8927 }, sd1: { 1000: 0.0007, 4000: -0.073, 8000: -0.2691, 16000: -0.9499 }, ts9: { 1000: 0.0034, 4000: -0.0741, 8000: -0.3019, 16000: -1.0684 } },
	"48k os4": { muff: { 1000: 0.0057, 4000: 0.0041, 8000: 0.0066, 16000: 0.0099 }, sd1: { 1000: 0.006, 4000: 0.0041, 8000: 0.0059, 16000: 0.0087 }, ts9: { 1000: 0.0065, 4000: 0.0041, 8000: 0.0063, 16000: 0.0097 } },
};
let worstPh1 = 0;
for (const [arm, byPedal] of Object.entries(PH1)) {
	for (const [p, byHz] of Object.entries(byPedal)) {
		for (const [hz, v] of Object.entries(byHz)) {
			for (const c of consoles) {
				const w = get(p, arm, Number(hz), c);
				const n = nat(p, Number(hz), 192000);
				if (w === null || n === null) continue;
				worstPh1 = Math.max(worstPh1, Math.abs(db(w / n) - v));
			}
		}
	}
}
P(`worst |this harness - phase-1 note| over 48k x1/os2/os4 x 3 pedals x 1/4/8/16 kHz x consoles = ${worstPh1.toFixed(4)} dB (the note prints 4 decimals)`);

// --- P1: equal internal rate ---------------------------------------------------------------------------------------------------------
P("\n## P1 equal-internal-rate agreement (max |difference| inside each group, dB; prediction <= 0.01, falsifier > 0.02, STOP > 0.05)");
const groups: Record<number, string[]> = {};
for (const a of ARMS) (groups[a.internal] ??= []).push(a.name);
P(`groups: ${Object.entries(groups).map(([r, g]) => `${Number(r) / 1000}k = {${g.join(", ")}}`).join("; ")}`);
let worstGroup = 0;
let worstWhere = "";
for (const c of consoles) {
	P(`\n### console ${c}`);
	P(`| pedal | group | ${HZS.map((h) => `${h / 1000}k`).join(" | ")} |`);
	P(`|---|---|${HZS.map(() => "---").join("|")}|`);
	for (const p of PEDALS) {
		for (const [rate, names] of Object.entries(groups)) {
			if (names.length < 2) continue;
			const cells = HZS.map((hz) => {
				const v = names.map((n) => get(p, n, hz, c)).filter((x): x is number => x !== null);
				if (v.length < 2) return "-";
				const spread = db(Math.max(...v) / Math.min(...v));
				if ([1000, 4000, 8000, 12500, 16000].includes(hz) && spread > worstGroup) {
					worstGroup = spread;
					worstWhere = `${p} ${hz} Hz ${c} group ${Number(rate) / 1000}k`;
				}
				return spread.toFixed(4);
			});
			P(`| ${p} | ${Number(rate) / 1000}k | ${cells.join(" | ")} |`);
		}
	}
}
P(`\nworst group spread over 1/4/8/12.5/16 kHz: ${worstGroup.toFixed(4)} dB at ${worstWhere || "n/a"} -> ${worstGroup <= 0.01 ? "inside the 0.01 dB prediction" : worstGroup <= 0.02 ? "above the prediction, inside the 0.02 falsifier" : worstGroup <= 0.05 ? "FALSIFIER (> 0.02 dB)" : "STOP CONDITION (> 0.05 dB)"}`);

// --- TS vs WASM --------------------------------------------------------------------------------------------------------------------------
if (consoles.length === 2) {
	P("\n## TS vs WASM console (max |difference| dB over pedals and frequencies, per arm)");
	for (const arm of ARMS) {
		let worst = 0;
		let where = "";
		for (const p of PEDALS) {
			for (const hz of HZS) {
				const a = get(p, arm.name, hz, "wasm");
				const b = get(p, arm.name, hz, "ts");
				if (a === null || b === null) continue;
				const d = Math.abs(db(a / b));
				if (d > worst) {
					worst = d;
					where = `${p} ${hz} Hz`;
				}
			}
		}
		P(`  ${arm.name.padEnd(8)} ${worst.toFixed(4)} dB (${where || "no overlap"})`);
	}
}

// --- convergence ---------------------------------------------------------------------------------------------------------------------------
P("\n## convergence: native renders against each other, dB (the 'native' references are themselves warped)");
P(`| pedal | Hz | 192k vs 384k | 384k vs 768k | 192k vs 768k | 96k vs 768k | 48k vs 768k |`);
P(`|---|---|---|---|---|---|---|`);
for (const p of PEDALS) {
	for (const hz of HZS) {
		const r = (a: number, b: number) => {
			const x = nat(p, hz, a);
			const y = nat(p, hz, b);
			return x === null || y === null ? "-" : db(x / y).toFixed(4);
		};
		P(`| ${p} | ${hz} | ${r(192000, 384000)} | ${r(384000, 768000)} | ${r(192000, 768000)} | ${r(96000, 768000)} | ${r(48000, 768000)} |`);
	}
}

// --- P2 ----------------------------------------------------------------------------------------------------------------------------------
P("\n## P2 x1 warp at 96k and 192k host (dB), against predictions (Muff pure warp; SD-1 / TS-9 range)");
const pred: Record<string, Record<number, string>> = {
	muff: { 16000: "x1@96k vs 192k -1.92, vs 768k -2.48; 192k vs 768k -0.56", 8000: "x1@96k vs 192k -0.42, vs 768k -0.55" },
	sd1: { 16000: "x1@96k vs 192k -0.77..-1.02, vs 768k -0.99..-1.53", 8000: "x1@96k vs 192k -0.23..-0.40" },
	ts9: { 16000: "x1@96k vs 192k -0.88..-1.12, vs 768k -1.14..-1.66", 8000: "x1@96k vs 192k -0.24..-0.42" },
};
for (const p of PEDALS) {
	for (const hz of [8000, 16000]) {
		for (const c of consoles) {
			const w96 = get(p, "96k x1", hz, c);
			const w192 = get(p, "192k x1", hz, c);
			const f = (w: number | null, r: number) => (w === null || nat(p, hz, r) === null ? "n/a" : db(w / (nat(p, hz, r) as number)).toFixed(4));
			P(`  ${p} ${String(hz).padStart(5)} Hz ${c.padEnd(4)}: x1@96k vs 192k ${f(w96, 192000)}, vs 384k ${f(w96, 384000)}, vs 768k ${f(w96, 768000)}; x1@192k vs 192k ${f(w192, 192000)}, vs 768k ${f(w192, 768000)}; x1@48k vs 768k ${f(get(p, "48k x1", hz, c), 768000)}   [prediction: ${pred[p]?.[hz]}]`);
		}
	}
}
const dest = arg("out", "");
if (dest !== "") await Bun.write(dest, `${lines.join("\n")}\n`);
