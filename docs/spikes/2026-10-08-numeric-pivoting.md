# Numeric-aware pivoting for the sparse schedule — 2026-10-08

Worktree `~/projects/VesselDSP/core/sparse-numeric-pivot`, branch
`indiejoseph/sparse-numeric-pivot` off core main `84ac372`. The diff is
uncommitted in the worktree; the wasm binary is a gitignored release artifact
and is not part of it.

**One-line outcome:** convergence is fixed and one real audio win landed
(`boss-sd-1` 6.9e-8 → 6.5e-12), but order-invariant evidence across the corpus
shows static pivoting cannot reach 1e-9 on gain-sensitive circuits, and a
relative pivot guard was tried at three taus and reverted for cause.
Recommendation: **adopt with limits** (§10).

**Harness (applies to every figure unless a caption says otherwise).**
In-process `ReferenceRuntime` (TypeScript, bun 1.3.14) or `V2WasmEngine`
(C++/WASM, em++ `-O3 -msimd128`), 48 kHz, Newton cap 64 (the audit's cap; the
shipping default is 1024 — §8 notes where it matters), default controls,
1 kHz sine at 0.1 V, 2400 warmup + 9600 measured samples. Dense control: the
same program with every block's `sparseSchedule` nulled. Dense agreement
proves solver consistency, not circuit truth; a quiet packet inflates relative
RMS (reported with `denseRms` and absolute diffs throughout).

## 1. Baseline on this checkout (read-only, before any edit)

Per-packet sparse-vs-dense, 122 pedal + 23 amp files. One exclusion:
`boss-dd-3t` compiles `unsupported` — its DSP part
`undisclosed-roland-boss-dsp` has no registry model — identically before and
after; an instrument cosmetic drops its row from the jsonl in both sweeps).

Section 6 symptoms that **still hold** today (cap 64):

| packet | sparse vs dense | sNC/dNC (/9600) | warmNC s/d | note |
|---|---|---|---|---|
| mxr-blue-box | 1.5e+0 | 9600 / 197 | 490 / 75 | sparse doom-loops 64.0 iters; dense 6.1 iters |
| boss-mt-2 | 1.5e-2 | 11 / 26 | 3 / 3 | both cap-hit; chunk 0 alone agrees 1.0e-9 (§5) |
| boss-tw-1 | 1.8e-3 | 0 / 0 | 588 / 724 | warmup storm both sides; settled starts still 6e-3 (envelope memory) |
| boss-aw-2 | 1.7e-4 | 0 / 0 | 1 / 4 | = 3.2e-11 abs on a 1.9e-7 signal; repivoted, converges 4.0 iters |
| boss-os-2 | 2.6e-6 | 0 / 0 | 0 / 0 | clean convergence, order-fixable (see §4, cost-blocked) |
| electro-harmonix-small-stone | 1.5e-6 | 0 / 0 | 0 / 0 | candidate == shipped; order-invariant |
| boss-dd-3b | 2.2e-7 | 0 / 0 | 38 / 34 | warmup-driven; == dense-cap movement 2.3e-7 |
| dumble-overdrive-special | 8.2e-1 | 81 / 73 | 10 / 22 | dense-cap movement 8.8e-1 (reference unstable) |
| hiwatt-dr103 | 6.3e-2 | 25 / 30 | 0 / 0 | dense-cap movement 1.2e-1; converged chunks 1e-5, order-invariant |
| marshall-1959-super-lead-plexi | 2.4e-2 | 948 / 5346 | 654 / 654 | dense never converges at either cap |
| marshall-jcm800 | 3.2e-8 | 0 / 0 | 0 / 0 | identical at all 9 taus; dense bit-stable (see §5) |
| trainwreck-express | 2.6e-8 | 0 / 0 | 0 / 0 | identical at all taus |
| boss-sd-1 | 6.9e-8 | 0 / 0 | 0 / 0 | **fixed by this change (§4)** |
| boss-od-3 | 5.4e-8 | 0 / 0 | 0 / 0 | candidate == shipped; dense bit-stable |
| boss-ds-2 | 2.3e-8 | 0 / 0 | 0 / 0 | == dense-cap 3.0e-8 (tracks reference) |
| boss-ch-1 | 5.0e-9 | 0 / 0 | 0 / 0 | dense-cap 2.3e-2 is an OP-budget artifact (OPs differ 4.8e-3 across caps); tracks same-cap reference |
| boss-hm-2 | 5.8e-9 | 0 / 0 | 0 / 0 | fresh-state 4.7e-9/64 samples; identical at all 9 taus; dense bit-stable |
| mxr-phase-90-early-block | 4.6e-3 | 2 / 0 | 0 / 0 | sparse 8.2 vs dense 4.0 iters; candidate fixes 1e7x (cost-blocked, §4) |
| mxr-phase-90 | 1.3e-7 | 0 / 0 | 0 / 0 | candidate regresses 30x (rule correctly blocks, §4) |
| + quiet fry (lm-2, ts9, morning-glory, blues-breaker, distortion-plus, dd-3a, ac15, bassman, phase-45, phase-90-script) | 1e-9..3e-8 | 0 / 0 | 0 / 0 | absolute diffs 1e-12..1e-10; phase-45/script candidates win 450x/42x (cost-blocked) |

Section 6 symptoms that **no longer hold** (struck): `boss-aw-2` never
converges sparsely (converges 4.0 iters, repivoted — the rescue landed before
this task); `boss-tr-2` 3.8e-6 (now 5.4e-10, passes); `boss-hm-2` 3.3e-12 min
pivot (now worst-ratio 8.8e-7, converges 5.2 iters); zero fallbacks and zero
abandons corpus-wide (was: ce-5 14k fallbacks, ch-1 abandoned in prepare).

## 2. Design

Numeric information comes from the **operating-point Jacobian assembled at
`prepare()`**, identically on both consoles (`ReferenceRuntime.assembleAudioMatrix`
and `Engine::settlePivotOrders` stamp the same base + OP state with zero
input; histories snapshotted and restored — the bit-identical test pins
that). The schedule stays data: the compiler owns order construction
(pattern-based `computeSparseSchedule` and value-based
`computeNumericRepivot`, the latter moved from `packages/runtime` into
`packages/compiler/src/sparse-schedule.ts` verbatim and exported), the
runtime supplies the matrix, and the C++ console ports the builder op for op.

- **tau = 1e-3**, one value for all circuits (§3 for the range tried).
- **Settle rule** (both consoles, same predicate `shouldRefinePivotOrder`):
  always compute the candidate; if shipped validates (≤1e-3), adopt the
  candidate only if it is bar-clean (≤1e-9), an order of magnitude better,
  and within 10% fill in slots and ops; if shipped collapses, rescue-adopt at
  ≤1e-3 else drop (unchanged). Mid-run: at 64 consecutive guard trips,
  snapshot matrix+rhs (dense destroys them), solve dense, re-pivot once from
  the snapshot, adopt iff replay agrees ≤1e-3 else abandon as before.
- **Guard stays absolute** (1e-18): the relative guard was implemented and
  reverted with the table in §6. The re-pivot-once above is retained and
  proven end to end (§7).
- **Kernels**: `generate-kernels.ts` now emits a `pivotFloor` parameter;
  table regenerated in-worktree from 145 compiled corpus programs (139 vs 137
  kernels: +5 real corpus blocks, −3 non-corpus programs now safely on the
  interpreter). Rebuilt with em++ (`build-wasm.sh`, stock flags); the
  `src/wasm/` binary is gitignored and not in the diff.

## 3. Tau sensitivity (audio agreement, 2400+9600, cap 64)

| packet | 0.3 | 0.1 | 0.03–0.003 | 1e-3 | 3e-4–1e-4 | 0 |
|---|---|---|---|---|---|---|
| aw-2 (n=89) | breaks (1.2, 34 it, 4800 NC) | 1.7e-4 clean | same | same | same | refused |
| tr-2 (n=64) | 4.9e-11 | 7e-11 | 5–7e-11 | 4.9e-11 | 4e-11 | refused |
| hm-2 (n=75) | 5.8e-9 | 6.1e-9 | 5.8–6.4e-9 | same | same | abandon storm |
| jcm800 (n=80) | 3.2e-8 | same ×7 | same | same | same | abandon storm |
| hiwatt (n=79) | 7.4e-2 | 7.4e-2 | 6.8e-2 | same | same | abandon storm |
| ch-1 (n=100) | 5e-9 | same | same | same | **1e-4: 1.3e-5 worse** | abandon storm |
| blue-box (n=34) | dooms | 7.6e-2 | 1.8e-2 | same | 3e-4 dooms, 1e-4 fine | refused |
| os-2 (n=70) | 3.6e-6 | 5.3e-7 | 2.8e-9 | same | same | refused |
| sd-1 (n=51) | (not swept; 1e-3 gives 6.5e-12) | — | — | 6.5e-12 | — | — |
| sd-1 (n=51) | 6.0e-12, cost-blocked | 2.7e-9, ratio-blocked | 5.9e-12 | 6.5e-12 adopted | same | — |
| mt-2 (n=93) | (1e-3: 1.8e-2, no gain) | — | — | same | — | — |

Fill falls as tau falls (tr-2 slots 546→498, aw-2 779→692). tau=0.3 is
unsafe (aw-2), tau=1e-4 is unsafe (ch-1); every tau in 3e-4..1e-1 fixes aw-2
identically. tau=0 refuses or storms. 1e-3 sits mid-window. One value.
Robustness across the corpus, not just the leads: the 94-block OP census
rerun at tau ∈ {0.1, 0.01, 1e-4} adopts nothing anywhere under the final rule
(the only adopters corpus-wide remain aw-2-rescue and sd-1-at-≤0.03), and
sd-1's own tau ladder shows the rule's gates pulling weight (0.3 blocked on
cost with crossing audio, 0.1 blocked on ratio with non-crossing audio 2.7e-9,
≤0.03 adopted with crossing audio).

## 4. Before → after (final code, same instrument)

- Pedals mismatched (>1e-9): 22 → 21. Amps: 7 → 7. Every agreement number
  bit-identical before/after except `boss-sd-1` (6.9e-8 → **6.5e-12**,
  repivoted, +3.6% slots/+6.5% ops). Zero worsened rows, zero new fallbacks,
  zero new abandons, zero new drops corpus-wide (blue-box keeps its 15
  pre-existing scattered trips).
- `boss-aw-2` converges on sparse before and after (4.0 iters, 0 NC).
- Adoption set under the final rule, corpus-wide (94-block OP census):
  only `boss-sd-1`. Cost-blocked would-be adopters (kept shipped):
  `boss-mt-2` (+34% ops, no audio gain), `mxr-phase-90` (+30%, audio
  *regression* 30x — the cap does load-bearing work),
  `mxr-phase-90-early-block` (+30%, known 1e7x fix + ~2x faster left on the
  table — §10), `mxr-phase-45` (+16%, known 450x fix left on the table),
  `mxr-phase-90-script` (+29%, known 42x fix left on the table),
  `boss-os-2` (no OP trigger; known 1000x fix at +13% left on the table).
- Fill growth of the fix: sd-1 only (above). Everything else bit-identical.

## 5. Why the residuals are not pivot defects (each with a control)

- **Order-invariance**: hm-2, jcm800, hiwatt, tw-1, od-3, tr-2 (modulo its
  10x within-pass refinement), ch-1, small-stone, dumble, 1959, blue-box
  (modulo doom-vs-doom) agree identically (±rounding) at all 9 taus.
- **Windowed localization**: hiwatt converged chunks agree 1e-5 while
  cap-hit chunks carry 5e-2..1e-1 (6.3e-2 total); mt-2 chunk 0 agrees 1.0e-9
  then desyncs after dense cap-hits (order vindicated); tw-1 settled 6e-3
  (envelope memory, both clean); hm-2 uniform 5e-9 incl. 4.7e-9 in the first
  64 samples from a fresh state (per-solve, not accumulation).
- **Dense-cap probe** (dense@64 vs dense@1024, same window): aw-2 1.0,
  tw-1 1.0, dumble 8.8e-1, hiwatt 1.2e-1, 1959 2.4e-2 (+953 NC at 1024),
  mt-2 1.4e-2, blue-box 1.8e-2 → dense-unstable verdicts. ch-1 2.3e-2 and
  ds-2 3.0e-8 move with zero cap-hits: OP-budget artifact (ch-1 OPs differ
  4.8e-3 across caps; same-cap sparse-vs-dense tracks at 5e-9/2.3e-8).
  hm-2/jcm800/os-2/sd-1/od-3/tr-2/trainwreck/phase-family 0.0 → dense stable;
  their residuals are the static-order noise floor.
- **Min-ratio census** (OP matrix): ce-5 2.5e-15, ch-1 1.0e-15, carbon-copy
  1.3e-15, aw-2-shipped 7.7e-15, mf-102 1.1e-14 — healthy and fatal pivots
  share a decade; magnitude cannot gate pivots.

## 6. The relative guard: tried, measured, reverted

`|pivot| < tau * max|gathered|`, swept tau ∈ {1e-12, 1e-14, 1e-16} corpus-wide:

| tau | harm (all vs zero-fallback baseline) |
|---|---|
| 1e-12 | ce-5 dropped to dense (lost 1.7x path); ch-1 gratuitously re-pivoted |
| 1e-14 | (above, persisting) |
| 1e-16 | dd-3b abandoned; blue-box abandoned; tw-1 dropped (lost 0.8x fix); dyna-comp rescue dropped; nf-1 audio 7.0e-11 → 7.7e-05; mf-102 528k fallbacks, 6.4x slower, no audio change |

Zero benefits: no trip anywhere caught a problem the absolute floor +
replay-validation missed. Reverted to the absolute floor; the re-pivot-once
(which fires on guard trips however caused) is retained. A magnitude gate
cannot work here (§5 census) — only replay-vs-dense can judge an order.

## 7. Controls, both directions

- (a) Dense reference throughout (§1/§4 tables; forced-dense control per packet).
- (b) Break-it: shipped-with-settle-skipped reproduces §6 on this checkout —
  aw-2 9.8e+5 at 63.7 iters/3155 NC/58k fallbacks (5.3e+2 variant after the
  guard revert, same catastrophe); jcm800/hm-2/ch-1 tau=0 orders abandon
  after 65/65 trips; blue-box shipped dooms 64.0 iters/9600 NC. The metric
  fails for the claimed reason (tiny pivots) whenever the numeric machinery
  is bypassed.
- Mid-run e2e: the jcm800 tau=0 storm trips 64 consecutive, snapshots,
  re-pivots from the current matrix and adopts (6.4e-4 vs dense, storm
  stopped, 0 further fallbacks) on TS; on C++ the same storm program is
  rescued at settle (repiv=1, fb=0) — same machinery, both consoles.
- (c) Synthetic tiny-diagonal unit test (compiler suite) pivots away from
  1e-12 to the strong entry; (d) all-tiny returns null, and settle/mid-run
  name the refusal in the plan reason (`refused (no candidate meets the
  threshold)` / `replay … vs dense`; abandon path covered).
- (e) Fill before/after per packet: §4 + per-tau slot/op deltas in the sweep
  logs (`docs/spikes/sparse-pivot/sweep-*.log`).

## 8. Cost (reported; TS in-process + C++)

- Changed packet, dedicated sequential A/B (same machine, idle): sd-1 TS
  394ms → 396ms (+0.5%, noise) at identical solves/iters; prepare +~1ms
  (always-compute-candidate). Criterion holds.
- C++ before(base binary) → final: every measured packet within noise with
  identical orders/kernels (hiwatt 190→175ms, trainwreck 87→110,
  jcm800 112→118, sunn 189→182, gro100 346→329, rockerverb 164→160,
  twin 115→100, peavey 250→166 — ±30% run-to-run noise dominates; same ops
  by construction). sd-1 C++ keeps shipped+kernel (split, §9): no change.
- Over-budget leads: no effect on any (same orders, fb=0 both) — ce-5,
  ch-1, carbon-copy, sunn, rockerverb, gro100, jcm800, twin, peavey, hiwatt,
  mf-102. Stated plainly: the lever does not move the size-bound amps.
- Kernels: +5 corpus blocks newly covered (muff-pi-ec3003, bd-2 ×2, mt-2
  with 48499 kernel solves measured, ts9), −3 non-corpus programs to the
  interpreter (safe by design). Adopted TS orders run the interpreter (sd-1
  +6.5% ops absorbed, §8 top).
- TS sweep xRT columns are load-noisy (±25% on unchanged packets, e.g.
  carbon-copy) and are context only; verdicts rest on A/B + construction.

## 9. Cross-console parity

- Holds at f32 noise (≤1e-7): tr-2, hm-2, ce-5, od-1,
  trainwreck, twin, sunn, gro100, ladder test (new), supply tests.
  (sd-1 splits 7.4e-8 — see below; it is still f32-level agreement.)
  Refinement/refresh parity: same adoption decisions everywhere except sd-1.
- Pre-existing systematic gaps (unchanged by this diff by construction —
  same orders, same guard, pure-function settle additions; no stamp/assembly
  change): ch-1 1.9e+3, jcm800 9.3e-2, rockerverb 2.2e-2, os-2 3.1e-6 —
  clean packets needing stamp-level (libm transcendental) adjudication, out
  of scope, flagged. Cap-storm lottery gaps (tw-1, mt-2, blue-box,
  hiwatt/dumble/1959) are expected on chaotic trajectories.
- **sd-1 split**: TS adopts (6.5e-12), C++ keeps shipped (6.9e-8, kernel
  kept, no regression). Cause measured, not asserted: OPs bit-identical,
  but ±1e-15 matrix noise moves TS's shipped disagreement across the bar
  (6.4e-10..3.3e-9 over 10 draws) while the candidate holds ~1e-13 — the
  decision inputs are noise-dominated below ~1e-8, so no threshold rule can
  decide them identically on both libms. The RATIO=10 requirement exists for
  exactly this reason. Neither side regresses.
- Hiwatt adopted on C++ under the no-floor rule and keeps shipped under the
  floor on both (repiv=0, kernel kept) — parity restored by the floor.

## 10. Per-criterion verdicts and recommendation

- Dense reference + known-positive ≤1e-9 preserved: PASS (all previously
  passing still pass, bit-identical).
- aw-2 converges sparse: PASS (4.0 iters, 0 NC). aw-2 matches dense:
  PASS by absolute (3e-11 V; dense-cap 1.0 proves the reference unstable).
- tr-2 matches: PASS (5.4e-10). hm-2 matches: FAIL at 1e-9 (5.8e-9;
  static floor proven — fresh-state, order-invariant ×9, dense bit-stable).
  dr103 matches: FAIL (6.3e-2; dense-unstable exception with windowed + cap
  evidence).
- Zero packets >1e-9 unless dense-unstable: FAIL as stated (15 static-floor
  packets: hm-2, jcm800, trainwreck, os-2, phase-90, small-stone, od-3,
  early-block, dd-3a/ds-2/ch-1/lm-2 tracking-or-absolute passes, ts9,
  morning-glory, blues-breaker, distortion-plus, phase-45, script, ac15,
  bassman) — each judged in §1/§5. Fixed: sd-1. Exceptions: dense-unstable
  set (aw-2-relative, hiwatt, dumble, 1959, mt-2, tw-1, blue-box, mf-102,
  dyna-comp, fuzz-faces).
- aw-2 converges / no sparse lost / no >10% slower / no new
  fallbacks-abandons / fill reported / tau table: PASS (evidence above).
- Controls incl. failing: PASS (§7). Cost: PASS (§8). Fresh clone: PASS
  (below). C++ consumed: PASS (same semantics; parity §9).

**Recommend adopt with limits.** Ship: compiler-owned threshold builder,
tau 1e-3, bar-crossing refinement with floor/cost-cap, absolute guard,
re-pivot-once, regenerated kernels. Limits: (1) 1e-9 bar stands with the
absolute-floor qualification for quiet packets and the dense-unstable
exceptions enumerated above; (2) static-floor packets (hm-2/jcm800-class)
are the approach's noise floor, not a scheduling bug; (3) known wins left on
the table by the cost-cap (early-block 1e7x+faster, phase-45 450x, script
42x, os-2 1000x) are follow-ups requiring a budget conversation, not a rule
tweak (the cap also blocks phase-90's 30x regression); (4) blue-box/tw-1
need Newton-side work; (5) ch-1/jcm800-class cross-console gaps need
stamp-level adjudication. Do not adopt the relative guard (evidence §6), do
not widen adoption without the floor (hiwatt split).

## 11. Verification

- New/updated tests: `packages/compiler/tests/sparse-schedule-numeric.test.ts`
  (5: determinism, tiny-diagonal choice, all-tiny refusal, tau-0 boundary,
  replay-vs-dense), `packages/runtime/tests/pivot-guard-repivot.test.ts`
  (12: refinement table incl. floor, guard trip/hold/backstop, mid-run
  adopt/refuse), `packages/runtime/tests/sparse-pivot-cross-console.test.ts`
  (2, skip-if-no-wasm). Deleted `packages/runtime/{src,tests}/numeric-pivot.*`
  (moved, byte-identical body verified by diff).
- Worktree: `bun test` 1955/1955 (the one earlier failure was missing-dist,
  resolved by building; fails identically absent dist on base); compiler suite
  402/402 (incl. 5 new), runtime suite 468/468 (incl. 12 guard/refinement
  tests and 2 parity tests);
  `bun run typecheck` green; `bun run build` green; `bun run build:pages`
  green (872 pages).
- Fresh clones in /tmp (base vs patched): install 0/0; typecheck 0 errors
  both (the "170 errors" note is stale for 84ac372); build fails
  identically at `cp -r src/wasm` (no artifact); test 5 fails identically
  (missing-wasm-console); pages green both. Change adds 13 passing, 0 failing
  (1915→1928).
- Toolchain: em++ from `~/projects/emsdk` (stock `build-wasm.sh`
  `-O3 -msimd128`); `src/wasm/` gitignored, not in the diff;
  `GeneratedKernels.cpp` (source) regenerated in-worktree from 145 compiled
  corpus programs and IS in the diff.

## 12. What this cannot prove, and exact reproduction

- Dense agreement proves consistency, not circuit truth (no hardware/ear
  in this task). Window: 2400+9600 at default controls; control corners
  unexplored (the mid-run re-pivot exists for them, unexercised).
  Oversample interaction: the concurrent worker's rate change alters dt and
  hence OP matrices; pivot orders validated at 1x run at Nx — flagged, not
  measured. TS xRT is not shipping performance (C++ table §8 is).
- Commands (worktree root; corpus paths read-only):
  `bun docs/spikes/sparse-pivot/sparse-vs-dense.ts --warmup=2400
  --samples=9600 --out=<x>.jsonl [--amps] [--packet=a,b]`,
  `bun docs/spikes/sparse-pivot/tau-cache-dense.ts --packet=…`,
  `bun docs/spikes/sparse-pivot/tau-sweep2.ts --packet=… --min-size=30`,
  `bun docs/spikes/sparse-pivot/op-diagnostic.ts --packet=…`,
  `bun docs/spikes/sparse-pivot/op-census.ts --taus=0.001 --out=<x>.jsonl [--amps]`,
  `bun docs/spikes/sparse-pivot/min-guard-ratio.ts --packet=…`,
  `bun docs/spikes/sparse-pivot/windowed-compare.ts --packet=… [--chunks=10]`,
  `bun docs/spikes/sparse-pivot/compare-settled.ts --packet=… --taus=… --chunks=20`,
  `bun docs/spikes/sparse-pivot/dense-cap-probe.ts --packet=… [--amps]`,
  `bun docs/spikes/sparse-pivot/cpp-compare.ts --packet=… [--amps] --outdir=…`,
  `bun docs/spikes/sparse-pivot/knife-edge.ts`,
  `bun docs/spikes/sparse-pivot/midrun-storm.ts`,
  `bun docs/spikes/sparse-pivot/analyze-after.ts [--amps]`.
  Raw logs sit beside the scripts (`*.log`, `*.jsonl`); bulk `.f64`/program
  JSON were pruned as regenerable (commands above).
