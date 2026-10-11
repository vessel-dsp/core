"""Control 2(e): engine (os4, TS) vs the scratch ngspice deck, per pedal x state, dB = 20 log10(engine / deck), 100 Hz-16 kHz.
Four combinations per pedal: engine OLD/NEW (unchanged main / this tree) x deck OLD (1e6 for every op-amp) / NEW (stamp GBP).
  both sides old  = the current residual (the known-null size); both sides new = must stay at that size;
  one side changed = must MOVE, by about the analytic change.   python3 -I ng-compare.py <data dir>"""
import glob, json, math, sys, collections
S = sys.argv[1]
fr = [100, 250, 500, 1000, 2000, 3150, 4000, 6300, 8000, 12500, 16000]
db = lambda x: 20 * math.log10(x)
deck = collections.defaultdict(dict)
for f in glob.glob(S + "/ng/deck-*.json"):
    for r in json.load(open(f)): deck[(r["deck"], r["pedal"], r["state"])][r["hz"]] = r["fund_mV"]
CONSOLE = sys.argv[2] if len(sys.argv) > 2 else "ts"
def eng(tree, p, c=None):
    c = c or CONSOLE
    d = {}
    for r in json.load(open(f"{S}/{tree}-{p}-{c}-os4.json")): d[(r["state"], r["hz"])] = r["fund_mV"]
    return d
print("freqs (Hz):      " + " ".join(f"{f:>6}" for f in fr))
worst = {}
for p in ("sd1", "ts9"):
    eo, en = eng("base", p), eng("new", p)
    for st in ("drive-min", "centre", "drive-max"):
        do = deck.get(("default", p, st)) or deck[("stamp", p, st)]   # SD-1's stamp is null, so its stamp deck IS the default deck
        dn = deck[("stamp", p, st)]
        for lab, e, d in (("engine OLD / deck OLD", eo, do), ("engine NEW / deck NEW", en, dn), ("engine NEW / deck OLD", en, do), ("engine OLD / deck NEW", eo, dn)):
            row = [db(e[(st, f)] / d[f]) for f in fr]
            print(f"{p} {st:9} {lab:22} " + " ".join(f"{v:+6.2f}" for v in row))
            worst[(p, st, lab)] = row
        print()
# summary: max |residual| up to 8 kHz and at 16 kHz, per combination
print("max |engine - deck| (dB): up to 8 kHz / at 16 kHz")
for lab in ("engine OLD / deck OLD", "engine NEW / deck NEW", "engine NEW / deck OLD", "engine OLD / deck NEW"):
    for p in ("sd1", "ts9"):
        a = max(abs(v) for st in ("drive-min", "centre", "drive-max") for v in worst[(p, st, lab)][:9])
        b = max(abs(worst[(p, st, lab)][10]) for st in ("drive-min", "centre", "drive-max"))
        print(f"  {lab:22} {p}: {a:5.2f} / {b:5.2f}")
