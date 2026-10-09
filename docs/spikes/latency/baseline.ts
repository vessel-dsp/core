// Baseline reproduction: line-for-line copy of saved probe fit/drive.
// Copy, never modify, of ~/projects/VesselDSP/workbench/packet-study/oversample-probe/probe.ts
// Adapted only for import paths (worktree src) and absolute vdsp paths.
import { readFileSync, writeFileSync } from "node:fs";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";

const [pedal, mvArg, controlsArg, hzArg, outFile] = process.argv.slice(2) as [string, string, string, string, string];
const PATHS: Record<string, string> = {
  muff: "/home/joseph/projects/VesselDSP/workbench/packet-study/big-muff-ec3003-rev-f/big-muff-ec3003-rev-f.vdsp",
  sd1: "/home/joseph/projects/VesselDSP/workbench/packet-study/boss-sd-1-et521-5108/variants/boss-sd-1.at-9v17.vdsp",
  ts9: "/home/joseph/projects/VesselDSP/artifacts/schematics/vessel-dsp/ibanez-ts9-reissue.vdsp",
};
const result = compile(readFileSync(PATHS[pedal!]!, "utf8"), { registry: pedalPartCatalog } as never) as { status: string; program: never };
if (result.status !== "ok") throw new Error(`${pedal} did not compile`);
const amp = Number(mvArg) / 1000;
const SETTLE = 0.5, LEN = 1.5, WIN0 = 0.4 + SETTLE, WIN1 = 1.2 + SETTLE;
function lsFit(x: Float64Array, fs: number, f0: number, nh: number) {
  const n = x.length, m = 1 + 2 * nh;
  const cols: Float64Array[] = [new Float64Array(n).fill(1)];
  for (let h = 1; h <= nh; h++) {
    const c = new Float64Array(n), s = new Float64Array(n);
    for (let i = 0; i < n; i++) { const p = (2 * Math.PI * f0 * h * i) / fs; c[i] = Math.cos(p); s[i] = Math.sin(p); }
    cols.push(c, s);
  }
  const A = Array.from({ length: m }, () => new Float64Array(m + 1));
  for (let a = 0; a < m; a++) {
    for (let b = a; b < m; b++) { let t = 0; const ca = cols[a]!, cb = cols[b]!; for (let i = 0; i < n; i++) t += ca[i]! * cb[i]!; A[a]![b] = t; A[b]![a] = t; }
    let t = 0; const ca = cols[a]!; for (let i = 0; i < n; i++) t += ca[i]! * x[i]!; A[a]![m] = t;
  }
  for (let i = 0; i < m; i++) {
    let p = i; for (let r = i + 1; r < m; r++) if (Math.abs(A[r]![i]!) > Math.abs(A[p]![i]!)) p = r;
    [A[i], A[p]] = [A[p]!, A[i]!];
    for (let r = i + 1; r < m; r++) { const f = A[r]![i]! / A[i]![i]!; for (let c = i; c <= m; c++) A[r]![c]! -= f * A[i]![c]!; }
  }
  const coef = new Float64Array(m);
  for (let i = m - 1; i >= 0; i--) { let t = A[i]![m]!; for (let c = i + 1; c < m; c++) t -= A[i]![c]! * coef[c]!; coef[i] = t / A[i]![i]!; }
  let resid = 0; for (let i = 0; i < n; i++) { let y = 0; for (let k = 0; k < m; k++) y += coef[k]! * cols[k]![i]!; const e = x[i]! - y; resid += e * e; }
  return { fund: Math.hypot(coef[1]!, coef[2]!), resid: Math.sqrt(resid / n), harm: Array.from({ length: nh }, (_, h) => Math.hypot(coef[1 + 2 * h]!, coef[2 + 2 * h]!)) };
}
function run(hz: number, hostRate: number, oversample: number) {
  const rt = new ReferenceRuntime(result.program);
  rt.prepare(hostRate, { inputSourceOhms: 94, ...(oversample > 1 ? { oversample } : {}) });
  for (const kv of controlsArg.split(",")) { const [k, v] = kv.split("="); if (k && v) rt.setControl(k, Number(v)); }
  const n = Math.round(hostRate * (SETTLE + LEN));
  const input = new Float64Array(n);
  for (let i = 0; i < n; i++) input[i] = amp * Math.sin((2 * Math.PI * hz * i) / hostRate);
  const out = new Float64Array(n);
  const blk = 512;
  for (let i = 0; i < n; i += blk) out.set(rt.process(input.subarray(i, Math.min(n, i + blk))), i);
  const w = out.subarray(Math.floor(WIN0 * hostRate), Math.floor(WIN1 * hostRate));
  let best = { f: hz, r: Infinity };
  const nh = Math.max(1, Math.min(8, Math.floor(hostRate / 2 / hz) - 1));
  const dec = Math.max(1, Math.floor(hostRate / (8 * hz * nh)));
  const wd = Float64Array.from({ length: Math.floor(w.length / dec) }, (_, i) => w[i * dec]!);
  for (let k = -4; k <= 4; k++) { const f = hz + k * 0.25; const r = lsFit(wd, hostRate / dec, f, 1).resid; if (r < best.r) best = { f, r }; }
  const fit = lsFit(w, hostRate, best.f, nh);
  return { fund_mV: fit.fund * 1e3, resid_dBc: 20 * Math.log10(fit.resid / fit.fund), h3_dBc: nh >= 3 ? 20 * Math.log10(fit.harm[2]! / fit.fund) : null };
}
const modes: [string, number, number][] = [["x1", 48000, 1], ["os2", 48000, 2], ["os4", 48000, 4], ["n192", 192000, 1]];
const rows: Record<string, unknown>[] = [];
for (const hz of hzArg.split(",").map(Number)) for (const [name, rate, os] of modes) rows.push({ pedal, mv: Number(mvArg), controls: controlsArg, hz, mode: name, ...run(hz, rate, os) });
writeFileSync(outFile, JSON.stringify(rows));
console.log(`${pedal} ${mvArg}mV ${controlsArg}: ${rows.length} rows -> ${outFile}`);
