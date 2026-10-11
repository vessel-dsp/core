"""Compare parity-moved.ts output of two trees: per (document, factor) the TS-vs-WASM verdict, correlation, max abs, non-converged samples, iterations per host sample and cap hits.
Lists every row whose verdict or convergence changed.   python3 -I parity-moved-compare.py <base.json> <new.json>"""
import json, sys
b = {(r["slug"], r["os"]): r for r in json.load(open(sys.argv[1]))}
n = {(r["slug"], r["os"]): r for r in json.load(open(sys.argv[2]))}
chg = []; cap = 0; stalls = 0
tot = 0
for k in sorted(n):
    r1, r0 = n[k], b.get(k)
    if r0 is None: continue
    tot += 1
    if "stall" in r1: stalls += 1; chg.append((k, f"NEW STALL {r1['stall']}")); continue
    if "stall" in r0: chg.append((k, f"BASE STALL ({r0['stall']}); new r {r1['r']:.6f} maxAbs {r1['maxAbs']:.2e} NC {r1['nc']} it {r1['it']:.1f} PASS={r1['pass']}")); continue
    f = []
    if r0["pass"] != r1["pass"]: f.append(f"verdict {'PASS' if r0['pass'] else 'FAIL'} -> {'PASS' if r1['pass'] else 'FAIL'} (r {r0['r']:.6f}->{r1['r']:.6f}, maxAbs {r0['maxAbs']:.2e}->{r1['maxAbs']:.2e})")
    if not r1["pass"] and not r0["pass"] and r1["maxAbs"] >= 10 * r0["maxAbs"] and r1["maxAbs"] >= 1e-4: f.append(f"still FAIL but worse: maxAbs {r0['maxAbs']:.2e} -> {r1['maxAbs']:.2e}, r {r0['r']:.6f} -> {r1['r']:.6f}")
    if r1["nc"] > r0["nc"]: f.append(f"non-converged {r0['nc']} -> {r1['nc']}")
    if r1["it"] >= 1.5 * r0["it"] and r1["it"] - r0["it"] > 1: f.append(f"iterations/host {r0['it']:.1f} -> {r1['it']:.1f}")
    if max(r1["tsPeak"], r1["wasmPeak"]) >= 1024 > max(r0["tsPeak"], r0["wasmPeak"]): f.append(f"cap hit (peaks {r0['tsPeak']}/{r0['wasmPeak']} -> {r1['tsPeak']}/{r1['wasmPeak']})")
    if f: chg.append((k, "; ".join(f)))
nfail0 = sum(1 for k in n if k in b and "pass" in b[k] and not b[k]["pass"]); nfail1 = sum(1 for k in n if "pass" in n[k] and not n[k]["pass"])
print(f"{tot} (document, factor) rows compared; FAIL rows base {nfail0} -> new {nfail1}; rows with a change flagged: {len(chg)}")
for k, f in chg: print(f"  {k[0]:38} os{k[1]}  {f}")
print("\nFAIL rows (TS vs WASM, bars r >= 0.9999 and max abs < 1e-4):")
for k in sorted(n):
    if k in b and "pass" in n[k] and "pass" in b[k] and (not n[k]["pass"] or not b[k]["pass"]):
        print(f"  {k[0]:38} os{k[1]}  base {'PASS' if b[k]['pass'] else 'FAIL'} (r {b[k]['r']:.6f}, maxAbs {b[k]['maxAbs']:.2e}) -> new {'PASS' if n[k]['pass'] else 'FAIL'} (r {n[k]['r']:.6f}, maxAbs {n[k]['maxAbs']:.2e})")
