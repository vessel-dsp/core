"""Corpus movement, summarised with a floor: levels below FLOOR_MV (1e-3 mV = 1 uV at the output) are numerical silence on one side or the other and are not compared (a ratio of two floors is not a level change).
Per arm and oversample: how many (document, frequency) cells move more than 1 dB, 3 dB, the largest movers with both levels, the floor cases, the filter documents, and the median change per frequency.
  python3 -I movement-summary.py <main.json> <tr prefix> <bdf2 prefix>"""
import glob, json, math, statistics as st, sys
FLOOR_MV = 1e-3
def load(p):
    files = [p] if p.endswith(".json") else sorted(glob.glob(p + "*.json"))
    rows = []
    for f in files: rows += json.load(open(f))
    return {(r["slug"], r["os"]): r for r in rows}
base, tr, bd = load(sys.argv[1]), load(sys.argv[2]), load(sys.argv[3])
FR = [1000, 8000, 10000, 12500, 16000]
db = lambda x, y: 20 * math.log10(x / y)
for name, arm in (("TRAPEZOID", tr), ("BDF2 (scratch)", bd)):
    for os in (1, 4):
        cells, floor, stall = [], [], []
        for (slug, o), b in base.items():
            if o != os or (slug, o) not in arm: continue
            a = arm[(slug, o)]
            for hz in FR:
                if f"wasm_{hz}_stall" in a: stall.append((slug, hz)); continue
                x, y = b.get(f"wasm_{hz}_mV"), a.get(f"wasm_{hz}_mV")
                if x is None or y is None: continue
                if x < FLOOR_MV or y < FLOOR_MV: floor.append((slug, hz, x, y)); continue
                cells.append((slug, hz, db(y, x)))
        print(f"\n=== {name}, x{os}: {len(cells)} (document, frequency) cells compared; {len(floor)} at the floor (not compared); {len(stall)} STALL")
        for thr in (1, 3, 10): print(f"   |change| > {thr:>2} dB: {sum(1 for c in cells if abs(c[2]) > thr)} cells")
        for hz in FR:
            v = [c[2] for c in cells if c[1] == hz]
            print(f"   {hz/1000:>5g} kHz: median {st.median(v):+.2f}  p10 {sorted(v)[len(v)//10]:+.2f}  p90 {sorted(v)[(9*len(v))//10]:+.2f}  min {min(v):+.2f}  max {max(v):+.2f}  (n={len(v)})")
        top = sorted(cells, key=lambda c: -abs(c[2]))[:14]
        print("   largest movers: " + "; ".join(f"{s} {hz/1000:g}k {d:+.1f}" for s, hz, d in top))
        print("   floor cases: " + (", ".join(sorted({f"{s} {hz/1000:g}k" for s, hz, _, _ in floor})[:12]) or "none"))
        print("   STALL: " + (", ".join(sorted({f"{s} {hz/1000:g}k" for s, hz in stall})) or "none"))
        for f in ("boss-aw-2", "dod-envelope-filter-440-vintage-green"):
            r = [f"{hz/1000:g}k {d:+.2f}" for s, hz, d in cells if s == f for hz in [hz]]
            print(f"   filter document {f}: " + (", ".join(r) or "no comparable cell"))
