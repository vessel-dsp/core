"""Run the study's own fundamental analyser (tolerance-envelope.py `analyse`, read-only import, as the three-way scripts do) over the WAV files
three-way-engine.ts wrote:  python3 -I three-way-analyse.py <wav-dir> <out.json>   ->  {"<pedal>|<state>|<hz>|<rate>": fund_mV}"""
import glob, importlib.util, json, os, re, sys
TE = "/home/joseph/projects/VesselDSP/workbench/packet-study/big-muff-ec3003-rev-f/tools/tolerance-envelope.py"
spec = importlib.util.spec_from_file_location("te", TE); te = importlib.util.module_from_spec(spec); spec.loader.exec_module(te)
d, out = sys.argv[1], sys.argv[2]
res = {}
for p in sorted(glob.glob(os.path.join(d, "*.wav"))):
    m = re.match(r"(\w+)-([\w-]+)-(\d+)-(\d+)\.wav$", os.path.basename(p))
    pedal, state, hz, rate = m[1], m[2], int(m[3]), int(m[4])
    res[f"{pedal}|{state}|{hz}|{rate}"] = te.analyse(p, hz)["fund_mV"]
json.dump(res, open(out, "w"), sort_keys=True, indent=0)
print(len(res), "points ->", out)
