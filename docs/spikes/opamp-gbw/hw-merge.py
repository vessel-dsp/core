"""Build the before/after three-way table sets for pool.py (a copy of the workbench's, run unchanged) from:
  - the three study tables (hardware columns are FIXED data; read-only originals),
  - engine columns re-rendered through a tree (three-way-engine.ts + three-way-analyse.py -> JSON),
  - for the TS-9 'after' set, the ngspice column re-run with the scratch deck carrying the stamp's product (ng/deck-stamp-ts9-*.json).
Layout written under <out>/{before,after}/ mirrors the workbench so pool.py (copied to <out>/<set>/hardware-consistency/) finds the files.
  python3 -I hw-merge.py <orig engine-json (base tree)> <new engine-json> <ng dir> <out dir>
Also prints the instrument check: base-tree columns vs the recorded three-way columns (dB, mean/max |diff|, per pedal and rate)."""
import json, math, os, shutil, sys, glob, statistics as st
WB = "/home/joseph/projects/VesselDSP/workbench/packet-study"
SETS = {"muff": "big-muff-ec3003-rev-f/run", "ts9": "ibanez-ts9/specimen-run", "sd1": "boss-sd-1-et521-5108/run"}
base_json, new_json, ng, out = sys.argv[1:5]
base, new = json.load(open(base_json)), json.load(open(new_json))
db = lambda v: 20 * math.log10(max(v, 1e-12))
deck = {}
for f in glob.glob(ng + "/deck-stamp-*.json"):
    for r in json.load(open(f)): deck[(r["pedal"], r["state"], r["hz"])] = r["fund_mV"]
orig = {p: json.load(open(f"{WB}/{d}/three-way.json")) for p, d in SETS.items() if p != "muff"}

# --- instrument check: base-tree reproduction of the recorded engine columns
print("INSTRUMENT CHECK: this tree's UNCHANGED-main engine vs the recorded three-way engine columns (dB)")
for p in ("sd1", "ts9"):
    for col, rate in (("e48", 48000), ("e192", 192000)):
        diffs = [db(base[f"{p}|{r['state']}|{r['hz']}|{rate}"] / r[col]) for r in orig[p] if f"{p}|{r['state']}|{r['hz']}|{rate}" in base]
        exact = sum(1 for r in orig[p] if f"{p}|{r['state']}|{r['hz']}|{rate}" in base and base[f"{p}|{r['state']}|{r['hz']}|{rate}"] == r[col])
        print(f"  {p} {col}: n={len(diffs)} mean |diff| {st.mean(abs(d) for d in diffs):.5f} max |diff| {max(abs(d) for d in diffs):.5f} dB; bit-identical values {exact}/{len(diffs)}")

def write(setname, engine, use_new_deck):
    for p, d in SETS.items():
        dest = f"{out}/{setname}/{d}"
        os.makedirs(dest, exist_ok=True)
        if p == "muff":
            shutil.copy(f"{WB}/{d}/three-way.txt", f"{dest}/three-way.txt")
            continue
        lines = open(f"{WB}/{d}/three-way.txt").read().split("\n")
        head = [l for l in lines[:5] if not l.startswith(("centre", "drive", "tone"))]
        body = []
        for r in orig[p]:
            k = lambda rate: f"{p}|{r['state']}|{r['hz']}|{rate}"
            e48, e192 = engine[k(48000)], engine[k(192000)]
            sp = deck[(p, r["state"], r["hz"])] if (use_new_deck and p == "ts9") else r["spice"]
            body.append(f"{r['state']:9} {r['hz']:>6} {r['hw']:8.2f} {sp:8.2f} {e48:8.2f} {e192:8.2f} | {db(e48/sp):+7.2f} {db(e192/sp):+8.2f} | {db(r['hw']/sp):+7.2f} {db(r['hw']/e192):+8.2f} | {r['drift']:+.3f}")
        open(f"{dest}/three-way.txt", "w").write("\n".join(head + body) + "\n")
    os.makedirs(f"{out}/{setname}/hardware-consistency", exist_ok=True)
    shutil.copy(f"{WB}/hardware-consistency/pool.py", f"{out}/{setname}/hardware-consistency/pool.py")
write("orig-check", {f"{p}|{r['state']}|{r['hz']}|{rate}": r[col] for p in ("sd1", "ts9") for r in orig[p] for col, rate in (("e48", 48000), ("e192", 192000))}, False)
write("before", base, False)
write("after", new, True)
print("wrote", out)
