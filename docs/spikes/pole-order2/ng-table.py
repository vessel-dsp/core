"""Engine vs ngspice (the workbench deck emitter, continuous pole): residual = 20 log10(engine fundamental / deck fundamental) in dB, per pedal x state x frequency, for
the arms present in <data dir> (sw-<arm>-<console>-<mode>.json from sweep.ts; deck-<pedal>-<state>.json under <data dir>/ng). Modes: os4 (48 kHz host, oversample 4) and n192 (native 192 kHz).
Arms: base = unchanged main (BE), tr = the trapezoid, bdf2 = the BDF2 scratch arm (TS only). Prints the residual rows, the change against base per cell, the summary
max |residual| up to 8 kHz / at 12.5 kHz / at 16 kHz, and FLAGS every cell where an arm's |residual| exceeds base's by more than 0.05 dB (falsifier F4).
  python3 -I ng-table.py <data dir> [--console ts|wasm]"""
import glob, json, math, os, sys, collections
D = sys.argv[1]
CON = sys.argv[sys.argv.index("--console") + 1] if "--console" in sys.argv else "ts"
FR = [100, 250, 500, 1000, 2000, 3150, 4000, 6300, 8000, 12500, 16000]
STATES = ["drive-min", "centre", "drive-max"]
db = lambda x: 20 * math.log10(x)
deck = collections.defaultdict(dict)
for f in glob.glob(D + "/ng/deck-*.json"):
    for r in json.load(open(f)): deck[(r["pedal"], r["state"])][r["hz"]] = r["fund_mV"]
def eng(arm, con, mode):
    out = collections.defaultdict(dict)
    p = f"{D}/sw-{arm}-{con}-{mode}.json"
    if not os.path.exists(p): return None
    for r in json.load(open(p)): out[(r["pedal"], r["state"])][r["hz"]] = r["fund_mV"]
    return out
for mode in ("os4", "n192"):
    arms = {a: eng(a, CON, mode) for a in ("base", "tr", "bdf2")}
    arms = {a: v for a, v in arms.items() if v is not None}
    print(f"\n=== {mode} ({'48 kHz host, oversample 4' if mode == 'os4' else 'native 192 kHz'}), console {CON}; arms {list(arms)}; residual = engine/deck dB")
    print("pedal state       arm   " + " ".join(f"{f:>6}" for f in FR) + " | max<=8k  @12.5k  @16k")
    summ = collections.defaultdict(list); flags = []
    for ped in ("sd1", "ts9"):
        for st in STATES:
            d = deck.get((ped, st))
            if not d: continue
            rows = {}
            for a, e in arms.items():
                rows[a] = [db(e[(ped, st)][f] / d[f]) for f in FR]
                lo = max(abs(v) for v, f in zip(rows[a], FR) if f <= 8000)
                print(f"{ped} {st:9} {a:5} " + " ".join(f"{v:+6.2f}" for v in rows[a]) + f" | {lo:6.2f} {abs(rows[a][9]):6.2f} {abs(rows[a][10]):6.2f}")
                summ[(a, ped)].append((lo, abs(rows[a][9]), abs(rows[a][10])))
            for a in rows:
                if a == "base": continue
                for i, f in enumerate(FR):
                    if abs(rows[a][i]) > abs(rows["base"][i]) + 0.05: flags.append((ped, st, a, f, rows["base"][i], rows[a][i]))
            print()
    print("max |residual| over Drive min / centre / max: up to 8 kHz | at 12.5 kHz | at 16 kHz")
    for (a, ped), v in sorted(summ.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        print(f"  {ped} {a:5}: {max(x[0] for x in v):5.2f} | {max(x[1] for x in v):5.2f} | {max(x[2] for x in v):5.2f}")
    print(f"cells where an arm's |residual| exceeds base's by > 0.05 dB (F4): {len(flags)}")
    for fl in flags: print("   ", fl)
