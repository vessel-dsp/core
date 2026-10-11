"""Scratch-only rate scan analysis: engine shape (level relative to 1 kHz) at 8 / 12.5 / 16 kHz for native host rates 192 / 384 / 768 kHz and GBP 1 / 3 MHz,
the change each mechanism makes, and the hardware-minus-engine shape residual (hardware columns = the study's fixed data) for each cell.
  python3 -I rate-scan-analyse.py <rs dir>"""
import glob, json, math, sys
WB = "/home/joseph/projects/VesselDSP/workbench/packet-study"
HW = {"ts9": f"{WB}/ibanez-ts9/specimen-run/three-way.json", "sd1": f"{WB}/boss-sd-1-et521-5108/run/three-way.json"}
db = lambda x: 20 * math.log10(x)
rows = []
for f in glob.glob(sys.argv[1] + "/rs-*.json"): rows += json.load(open(f))
L = {(r["pedal"], r["state"], r["rate"], r["gbp"], r["hz"]): r["fund_mV"] for r in rows}
hw = {p: {(r["state"], r["hz"]): r["hw"] for r in json.load(open(path))} for p, path in HW.items()}
shape = lambda p, st, rate, g, f: db(L[(p, st, rate, g, f)] / L[(p, st, rate, g, 1000)])
hws = lambda p, st, f: db(hw[p][(st, f)] / hw[p][(st, 1000)])
FR = (8000, 12500, 16000); RATES = (192000, 384000, 768000)
print("ENGINE shape (dB re 1 kHz) at 8 / 12.5 / 16 kHz, per native host rate and GBP; then the two mechanisms:")
for p in ("ts9", "sd1"):
    for st in ("drive-min", "centre", "drive-max"):
        print(f"\n{p} {st}   (SD-1 3 MHz is a SCAN VARIABLE: its shipped stamp is null)" if p == "sd1" and st == "drive-min" else f"\n{p} {st}")
        for g in (1e6, 3e6):
            print(f"  GBP {g/1e6:g} MHz  " + "  ".join(f"{r//1000:>3}k: " + " ".join(f"{shape(p, st, r, g, f):+6.2f}" for f in FR) for r in RATES))
        gb = {r: [shape(p, st, r, 3e6, f) - shape(p, st, r, 1e6, f) for f in FR] for r in RATES}
        rt = {g: [shape(p, st, 768000, g, f) - shape(p, st, 192000, g, f) for f in FR] for g in (1e6, 3e6)}
        print("  GBP effect (3M - 1M) at 192k  " + " ".join(f"{x:+6.2f}" for x in gb[192000]) + " | at 768k " + " ".join(f"{x:+6.2f}" for x in gb[768000]))
        print("  rate effect (768k - 192k) at 1 MHz " + " ".join(f"{x:+6.2f}" for x in rt[1e6]) + " | at 3 MHz " + " ".join(f"{x:+6.2f}" for x in rt[3e6]))
        print("  hw - engine residual (8 / 12.5 / 16 kHz): " + "  ".join(f"[{r//1000}k, {g/1e6:g}M] " + " ".join(f"{hws(p, st, f) - shape(p, st, r, g, f):+5.2f}" for f in FR) for g in (1e6, 3e6) for r in (192000, 768000)))
