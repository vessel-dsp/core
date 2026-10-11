"""Join two nyquist-ring.ts outputs (main, change): top-bin and top-band level (dB relative to the reference component) per case, and the change in dB.
  python3 -I nyquist-compare.py <main.json> <change.json>"""
import json, sys
a = {(r["case"], r["console"], r["rate"], r["os"]): r for r in json.load(open(sys.argv[1]))}
b = {(r["case"], r["console"], r["rate"], r["os"]): r for r in json.load(open(sys.argv[2]))}
print(f"{'case':34} {'console':7} {'rate':>6} os | top bin dBc main -> change (delta) | top band dBc main -> change (delta)")
for k in a:
    if k not in b: continue
    ra, rb = a[k], b[k]
    print(f"{k[0]:34} {k[1]:7} {k[2]:6} x{k[3]} | {ra['topDb']:8.1f} -> {rb['topDb']:8.1f} ({rb['topDb']-ra['topDb']:+6.1f}) | {ra['bandDb']:8.1f} -> {rb['bandDb']:8.1f} ({rb['bandDb']-ra['bandDb']:+6.1f})")
