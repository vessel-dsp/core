"""Compare movement.ts output (baseline vs new): per moved document and factor, the WASM level change at 1/8/16 kHz (100 mV in, dB), and the TS 1 kHz
convergence telemetry before/after (non-converged samples, Newton iterations per host sample, peak iterations; cap 1024).
Flags: any non-converged sample or non-finite output in NEW that was not in BASE, iterations per host sample up 1.5x or more, peak at the cap.
  python3 -I movement-compare.py <base.json> <new.json>"""
import json, math, sys
b = {(r["slug"], r["os"]): r for r in json.load(open(sys.argv[1]))}
n = {(r["slug"], r["os"]): r for r in json.load(open(sys.argv[2]))}
db = lambda x, y: 20 * math.log10(x / y) if x > 0 and y > 0 else float("nan")
print("document                                os | WASM level change dB (1k / 8k / 16k) | TS 1 kHz: NC base->new | it/host base->new | peak base->new | flags")
flags = []
for key in sorted(n):
    if key not in b: continue
    r0, r1 = b[key], n[key]
    stalls0 = [k for k in r0 if k.endswith("_stall")]; stalls1 = [k for k in r1 if k.endswith("_stall")]
    if stalls0 or stalls1:
        print(f"{key[0]:40} x{key[1]} | STALL base {stalls0 or '-'} {[r0[k][:60] for k in stalls0]} / new {stalls1 or '-'} | new TS NC {r1.get('ts_1000_nc')} it {r1.get('ts_1000_it')} peak {r1.get('ts_1000_peak')}")
        flags.append((key, [f"BASE STALL {stalls0}" if stalls0 else "", f"NEW STALL {stalls1}" if stalls1 else ""]))
        continue
    lv = [db(r1[f"wasm_{f}_mV"], r0[f"wasm_{f}_mV"]) for f in (1000, 8000, 16000)]
    nc0, nc1 = r0.get("ts_1000_nc"), r1.get("ts_1000_nc")
    it0, it1 = r0.get("ts_1000_it"), r1.get("ts_1000_it")
    pk0, pk1 = r0.get("ts_1000_peak"), r1.get("ts_1000_peak")
    f = []
    if nc1 and nc1 > (nc0 or 0): f.append(f"NEW NON-CONVERGED {nc0}->{nc1}")
    if r1.get("ts_1000_finite") is False: f.append("NON-FINITE")
    if it0 and it1 and it1 / it0 >= 1.5: f.append(f"iterations x{it1/it0:.2f}")
    if pk1 is not None and pk1 >= 1024: f.append("peak at cap")
    if any(abs(x) >= 3 for x in lv if not math.isnan(x)): f.append("level move >= 3 dB")
    print(f"{key[0]:40} x{key[1]} | {lv[0]:+7.3f} {lv[1]:+7.3f} {lv[2]:+7.3f} | {nc0}->{nc1} | {it0:.3f}->{it1:.3f} | {pk0}->{pk1} | {'; '.join(f)}")
    if f: flags.append((key, f))
print(f"\n{len(n)} (document, factor) rows; flagged: {len(flags)}")
for key, f in flags: print("  FLAG", key, f)
