"""Corpus movement (check 7): for every document with a railed op-amp, the WASM level change (dB, 100 mV in, 1 s, last 0.5 s fundamental) at 1 / 8 / 10 / 12.5 / 16 kHz at x1 and os4,
unchanged main -> the change (trapezoid) and -> BDF2 (scratch). A render the stall guard abandoned is a STALL, never a level. Lists documents that move > 1 dB at 1 kHz (the filter documents
first), the per-frequency distribution, and every STALL.
  python3 -I movement-table.py <main.json> <tr glob prefix> <bdf2 glob prefix>   (e.g. data/base-movement.json data/tr-movement- data/bdf2-movement-)"""
import glob, json, math, statistics as st, sys
def load(prefix_or_file):
    files = [prefix_or_file] if prefix_or_file.endswith(".json") else sorted(glob.glob(prefix_or_file + "*.json"))
    rows = []
    for f in files: rows += json.load(open(f))
    return {(r["slug"], r["os"]): r for r in rows}
base, tr, bd = load(sys.argv[1]), load(sys.argv[2]), load(sys.argv[3])
FR = [1000, 8000, 10000, 12500, 16000]
db = lambda x, y: 20 * math.log10(x / y) if x and y and x > 0 and y > 0 else float("nan")
def cell(b, a, hz):
    if f"wasm_{hz}_stall" in a: return "STALL"
    if f"wasm_{hz}_stall" in b or f"wasm_{hz}_mV" not in a or f"wasm_{hz}_mV" not in b: return "n/a"
    return db(a[f"wasm_{hz}_mV"], b[f"wasm_{hz}_mV"])
def fmt(v): return f"{v:+6.2f}" if isinstance(v, float) and not math.isnan(v) else f"{v:>6}"
filters = ["boss-aw-2", "dod-envelope-filter-440-vintage-green"]
slugs = sorted({k[0] for k in base}, key=lambda s: (s not in filters, s))
for name, arm in (("TRAPEZOID (this diff)", tr), ("BDF2 (scratch, WASM build)", bd)):
    print(f"\n===== {name}: level change vs unchanged main, dB (100 mV in); columns 1 / 8 / 10 / 12.5 / 16 kHz at x1 then at os4 =====")
    print(f"{'document':42} | x1: " + " ".join(f"{f/1000:>6g}" for f in FR) + " | os4: " + " ".join(f"{f/1000:>6g}" for f in FR))
    big1k, stalls, dist = [], [], {(os, hz): [] for os in (1, 4) for hz in FR}
    for s in slugs:
        cells = {}
        for os in (1, 4):
            b, a = base.get((s, os)), arm.get((s, os))
            for hz in FR:
                c = cell(b, a, hz) if (a and b) else "n/a"
                cells[(os, hz)] = c
                if isinstance(c, float) and not math.isnan(c): dist[(os, hz)].append(c)
                if c == "STALL": stalls.append((s, os, hz))
        print(f"{s:42} | x1: " + " ".join(fmt(cells[(1, hz)]) for hz in FR) + " | os4: " + " ".join(fmt(cells[(4, hz)]) for hz in FR))
        for os in (1, 4):
            c = cells[(os, 1000)]
            if isinstance(c, float) and abs(c) > 1: big1k.append((s, os, c))
    print(f"\ndocuments moving > 1 dB at 1 kHz ({name}): " + (", ".join(f"{s} x{os} {c:+.2f}" for s, os, c in big1k) or "none"))
    print(f"STALLs (render abandoned, no level): " + (", ".join(f"{s} x{os} {hz/1000:g}k" for s, os, hz in stalls) or "none"))
    print("distribution of the level change over the documents that rendered (median / min / max, n):")
    for os in (1, 4):
        print(f"  x{os}: " + " | ".join(f"{hz/1000:g}k {st.median(v):+.2f} / {min(v):+.2f} / {max(v):+.2f} (n={len(v)})" for hz in FR if (v := dist[(os, hz)])))
