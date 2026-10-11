"""Compare two stall-scan.ts outputs (main, change): documents that stall or whose peak reaches the cap in one and not the other, and iteration changes >= 1.5x.
  python3 -I stall-scan-compare.py <main.json> <change.json>"""
import json, sys
a = {(r["slug"], r["os"]): r for r in json.load(open(sys.argv[1]))}
b = {(r["slug"], r["os"]): r for r in json.load(open(sys.argv[2]))}
worse, better, big = [], [], []
for k in sorted(a):
    if k not in b: continue
    ra, rb = a[k], b[k]
    sa, sb = "stall" in ra, "stall" in rb
    if sb and not sa: worse.append((k, "STALL on change, converges on main", ra.get("it"), ra.get("peak")))
    elif sa and not sb: better.append((k, "STALL on main, converges on change", rb.get("it"), rb.get("peak")))
    elif not sa and not sb:
        if rb["peak"] >= 1024 and ra["peak"] < 1024: worse.append((k, "peak at cap on change only", ra["it"], rb["it"]))
        elif ra["peak"] >= 1024 and rb["peak"] < 1024: better.append((k, "peak at cap on main only", ra["it"], rb["it"]))
        if ra["it"] > 0 and rb["it"] / ra["it"] >= 1.5: big.append((k, f"iterations x{rb['it']/ra['it']:.2f}", ra["it"], rb["it"]))
print(f"{len(a)} cases (main), {len(b)} (change)")
print("\nWORSE on the change:"); [print("  ", x) for x in worse] or print("   none")
print("\nBETTER on the change:"); [print("  ", x) for x in better] or print("   none")
print("\niterations x1.5 or more on the change (not stalls):"); [print("  ", x) for x in big] or print("   none")
