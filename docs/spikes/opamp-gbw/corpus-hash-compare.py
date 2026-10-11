"""Compare corpus-hash.ts output of two trees. For every compiled document: op-amp-free documents (no op-amp stamp at all) and documents whose op-amp
stamps are all null or exactly 1 MHz must hash IDENTICALLY (TS Float64 and WASM Float32, x1 and os4); documents with a stamp off 1 MHz are expected to differ.
  python3 -I corpus-hash-compare.py <base.json> <new.json>"""
import json, sys
b = {r["slug"]: r for r in json.load(open(sys.argv[1]))}
n = {r["slug"]: r for r in json.load(open(sys.argv[2]))}
K = ["ts_x1", "ts_x4", "wasm_x1", "wasm_x4"]
cls = {"no-opamp": [], "opamp-null-or-1MHz": [], "opamp-off-1MHz": []}
bad = []
for slug, r in n.items():
    if r.get("status") != "ok": continue
    g = [x for x in r["gbps"] if x is not None]
    moved = any(x != 1e6 for x in g)
    c = "no-opamp" if r["opamps"] == 0 else ("opamp-off-1MHz" if moved else "opamp-null-or-1MHz")
    same = all(r.get(k) == b[slug].get(k) for k in K)
    cls[c].append((slug, same, r.get("error"), b[slug].get("error")))
    if c != "opamp-off-1MHz" and not same: bad.append(slug)
for c, rows in cls.items():
    ident = sum(1 for _, s, _, _ in rows if s)
    print(f"{c:22} documents {len(rows):3}  hash-identical (ts x1, ts os4, wasm x1, wasm os4 all equal baseline) {ident:3}  differing {len(rows)-ident}")
print("op-amp documents unmoved that differ:" , bad or "none")
print("render errors (base/new):", [(s, e1, e2) for rows in cls.values() for s, _, e1, e2 in rows if e1 or e2] or "none")
moved = cls["opamp-off-1MHz"]
print(f"documents with a section off 1 MHz: {len(moved)}; of them hash-different {sum(1 for _,s,_,_ in moved if not s)}, hash-identical {sum(1 for _,s,_,_ in moved if s)}", [s for s, same, _, _ in moved if same])
