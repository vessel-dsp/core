// Compare fresh baseline renders vs saved probe JSONs (dB diffs).
import { readFileSync } from "node:fs";
type Row = { pedal: string; mv: number; controls: string; hz: number; mode: string; fund_mV: number; resid_dBc: number };
const cmp = (savedPath: string, freshPath: string): void => {
  const saved = JSON.parse(readFileSync(savedPath, "utf8")) as Row[];
  const fresh = JSON.parse(readFileSync(freshPath, "utf8")) as Row[];
  let worst = 0, worstKey = "";
  for (const s of saved) {
    const f = fresh.find((r) => r.hz === s.hz && r.mode === s.mode);
    if (!f) { console.log(`MISSING ${s.hz} ${s.mode}`); continue; }
    const d = 20 * Math.log10(f.fund_mV / s.fund_mV);
    if (Math.abs(d) > Math.abs(worst)) { worst = d; worstKey = `${s.hz}Hz ${s.mode}`; }
  }
  console.log(`${freshPath}: ${saved.length} rows, worst fund diff ${worst.toFixed(5)} dB (${worstKey})`);
};
const P = "/home/joseph/projects/VesselDSP/workbench/packet-study/oversample-probe";
cmp(`${P}/muff-fr.json`, "/tmp/lat/muff-fr.json");
cmp(`${P}/sd1-fr.json`, "/tmp/lat/sd1-fr.json");
cmp(`${P}/ts9-fr.json`, "/tmp/lat/ts9-fr.json");
