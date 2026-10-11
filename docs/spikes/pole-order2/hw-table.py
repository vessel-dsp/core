"""Per pedal / per state hardware-minus-engine SHAPE residual (dB, relative to 1 kHz; pool.py's own `shapes`) at 4 / 8 / 12.5 / 16 kHz, before and after,
and the per-pedal median (pool.py's `pedal_stats`).   python3 -I hw-table.py <hw dir (before/ after/ under it)>"""
import importlib.util, sys
def load(path):
    spec = importlib.util.spec_from_file_location("pool_" + path.split("/")[-2], path); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
root = sys.argv[1]
import os
ARMS = [a for a in ("after-tr", "after-bdf2") if os.path.isdir(f"{root}/{a}")]
P = {s: load(f"{root}/{s}/hardware-consistency/pool.py") for s in ["before"] + ARMS}
fr = (4000, 8000, 12500, 16000)
for arm in ARMS:
    print(f"\n=== hardware minus engine (e192 column) SHAPE residual, dB relative to 1 kHz: before (main) -> {arm}; change = after - before")
    print(f"{'pedal':5} {'state':10} | " + " | ".join(f"{f/1000:>5g} kHz before  after  change" for f in fr))
    for pedal in ("sd1", "ts9", "muff"):
        sb, sa = P["before"].shapes(pedal, "hw-e192"), P[arm].shapes(pedal, "hw-e192")
        states = sorted({st for f in sb for st in sb[f]})
        for st in states:
            cells = []
            for f in fr:
                if f in sb and st in sb[f]:
                    b, a = sb[f][st], sa[f][st]
                    cells.append(f"{b:+8.2f} {a:+6.2f} {a-b:+6.2f}")
                else: cells.append(f"{'-':>8} {'-':>6} {'-':>6}")
            print(f"{pedal:5} {st:10} | " + " | ".join(f"{c:>26}" for c in cells))
        mb, ma = P["before"].pedal_stats(sb), P[arm].pedal_stats(sa)
        cells = [f"{mb[f]['med']:+8.2f} {ma[f]['med']:+6.2f} {ma[f]['med']-mb[f]['med']:+6.2f}" if f in mb else f"{'-':>8} {'-':>6} {'-':>6}" for f in fr]
        print(f"{pedal:5} {'MEDIAN':10} | " + " | ".join(f"{c:>26}" for c in cells) + "\n")
