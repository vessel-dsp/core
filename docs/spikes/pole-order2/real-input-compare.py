"""Join two real-input.ts outputs (main, change): iterations per host sample and peak per (take, level, packet, os), the change in percent, and a per-packet summary at x1 and os4.
  python3 -I real-input-compare.py <main.json> <change.json>"""
import json, sys, statistics, collections
a = {(r["take"], r["level"], r["slug"], r["os"]): r for r in json.load(open(sys.argv[1]))}
b = {(r["take"], r["level"], r["slug"], r["os"]): r for r in json.load(open(sys.argv[2]))}
print("take            level  packet    os | main it/host  peak | change it/host  peak | change %")
by = collections.defaultdict(list)
for k in sorted(a):
    if k not in b: continue
    ra, rb = a[k], b[k]
    if "stall" in ra or "stall" in rb:
        print(f"{k[0]:15} {k[1]:<5}  {k[2]:9} {k[3]} | {'STALL' if 'stall' in ra else ra['it']:>12} | {'STALL' if 'stall' in rb else rb['it']:>14} |")
        continue
    pct = 100 * (rb["it"] / ra["it"] - 1)
    by[(k[2], k[3])].append(pct)
    print(f"{k[0]:15} {k[1]:<5}  {k[2]:9} {k[3]} | {ra['it']:12.3f} {ra['peak']:5} | {rb['it']:14.3f} {rb['peak']:5} | {pct:+7.1f}")
print("\nper packet and factor: median / min / max change % over takes x levels")
for k in sorted(by):
    v = by[k]
    print(f"  {k[0]:9} x{k[1]}: median {statistics.median(v):+6.1f}  min {min(v):+6.1f}  max {max(v):+6.1f}  (n={len(v)})")
