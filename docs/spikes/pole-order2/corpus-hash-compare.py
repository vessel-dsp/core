"""Compare corpus-hash.ts output of two trees (main, change), per document class: NO op-amp stamp at all, only UNRAILED op-amps (virtual shorts, no pole), and RAILED op-amp
documents. Documents with no railed op-amp must hash IDENTICALLY (TS Float64 and WASM Float32, x1 / os2 / os4); railed documents are expected to differ and are listed.
  python3 -I corpus-hash-compare.py <main.json> <change.json>"""
import json, sys
b = {r["slug"]: r for r in json.load(open(sys.argv[1]))}
n = {r["slug"]: r for r in json.load(open(sys.argv[2]))}
K = ["ts_x1", "ts_x2", "ts_x4", "wasm_x1", "wasm_x2", "wasm_x4"]
cls = {"no op-amp": [], "unrailed op-amps only": [], "railed op-amps": []}
bad = []
for slug, r in n.items():
    if r.get("status") != "ok" or slug not in b: continue
    c = "no op-amp" if r["opamps"] == 0 else ("unrailed op-amps only" if r["railed"] == 0 else "railed op-amps")
    if c == "railed op-amps": cls[c].append((slug, None, r.get("stall"))); continue
    same = all(r.get(k) == b[slug].get(k) for k in K)
    cls[c].append((slug, same, r.get("stall") or r.get("error")))
    if not same: bad.append(slug)
for c, rows in cls.items():
    if c == "railed op-amps": print(f"{c:24} documents {len(rows):3} (not compared here)"); continue
    ident = sum(1 for _, s, _ in rows if s)
    print(f"{c:24} documents {len(rows):3}  hash-identical on TS x1/os2/os4 and WASM x1/os2/os4: {ident:3}  differing: {len(rows)-ident}")
print("documents with no railed op-amp whose render changed:", bad or "none")
print("stalls / errors in the change among them:", [(s, e) for rows in cls.values() for s, _, e in rows if e] or "none")
for slug in ("big-muff-pi-ec3003-rev-f", "big-muff-pi-v3"):
    if slug in n and slug in b: print(f"  {slug}: " + ("IDENTICAL" if all(n[slug].get(k) == b[slug].get(k) for k in K) else "DIFFERS"))
