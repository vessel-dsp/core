#!/usr/bin/env python3
"""Compare two profile-levels.ts / movement.ts JSON outputs: dB change per level key, iteration ratio, non-converged.
   python3 levels-compare.py before.json after.json [--bar 0.1]"""
import json, math, sys
a = json.load(open(sys.argv[1])); b = json.load(open(sys.argv[2]))
bar = float(sys.argv[sys.argv.index("--bar") + 1]) if "--bar" in sys.argv else 0.1
key = lambda r: (r.get("packet", r.get("slug")), r["os"], r.get("amp"))
bm = {key(r): r for r in b}
worst = 0.0; over = []
for r in a:
    s = bm.get(key(r))
    if s is None: print(f"{key(r)}: missing after"); continue
    parts = []
    for k in sorted(r):
        if k.endswith("_mV") and k in s:
            va, vb = r[k], s[k]
            if va is None or vb is None: parts.append(f"{k} n/a"); continue
            d = 20 * math.log10(max(vb, 1e-9) / max(va, 1e-9)) if va > 1e-6 or vb > 1e-6 else 0.0
            worst = max(worst, abs(d)); parts.append(f"{k[:-3]} {d:+.3f} dB")
            if abs(d) > bar: over.append((key(r), k, d))
        elif k in ("ts_it", "ts_1000_it") and k in s and r[k]:
            parts.append(f"it {r[k]:.2f}->{s[k]:.2f} (x{s[k]/r[k]:.2f})")
        elif k in ("ts_nc", "ts_1000_nc") and k in s:
            parts.append(f"nc {r[k]}->{s[k]}")
        elif k.endswith("_stall") or (k in s and k.endswith("_stall")):
            parts.append(f"{k}: before {r.get(k, '-')} after {s.get(k, '-')}")
    for k in s:
        if k.endswith("_stall") and k not in r: parts.append(f"NEW STALL after: {k}")
    print(f"{str(key(r)):50s} " + " | ".join(parts))
print(f"\nworst |dB change| {worst:.3f}; rows over {bar} dB: {len(over)}")
for o in over: print("  ", o)
