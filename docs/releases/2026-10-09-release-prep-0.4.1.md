# Release prep: runtime 0.4.1 / chain 0.1.7 / player 0.2.5 (2026-10-09)

Hotfix on core main `2558e5b`, which is exactly what npm serves as compiler 0.4.0 / runtime 0.4.0 / chain 0.1.6 /
player 0.2.4. Worktree `~/projects/VesselDSP/core/release-0.4.1`, branch `indiejoseph/release-0.4.1`. The diff is
left UNCOMMITTED; nothing was tagged, pushed, published or committed. The workbench (read only: its note
`thoughts/shared/2026-10-09-release-pins-gates.md` on `release-pins-0.4.0`, `df603284`), the artifacts repo
(`b9508b71c`, clean before and after) and `~/projects/emsdk` were not modified. Compiler stays 0.4.0:
`git diff -- packages/compiler` is empty. Every log named below is under `docs/spikes/hotfix-0.4.1/logs/` (scratch paths scrubbed to
`<scratch>/`); the instruments are the `.ts` files beside it (README there); the renders (large float dumps) are not kept, the scripts regenerate them.

## 0. Outcome, read this first

- **The change is one condition.** The Newton start predictor now runs only when `oversample > 1`, on both
  consoles (`this.oversample > 1` in `ReferenceRuntime`, `oversample_ > 1` in the C++ `Engine`, at each of the two
  predicate sites per console). At factor 1 nothing seeds and nothing records. Nothing else in the engine changed;
  the diff to the engine is 4 predicate lines plus comments (section 1).
- **F1 (the `boss-mt-2` WASM stall) is gone.** Reproduced first on a build of `2558e5b`: the first block over 50 ms
  starts at sample 132 096, as the workbench found. With the gate both consoles render the same 8 s with no block
  over 50 ms on WASM and none over 2 s on TS (section 5b). Removing the gate again in a scratch build brings the
  stall back at the same sample with the same telemetry.
- **F2 (the factor-1 movement) is gone: factor-1 output is bit-identical to published runtime 0.3.1** on 144 of
  145 corpus packets on the reference console and 145 of 145 on the C++ console, on two windows (2048 and 16 384
  samples), and on all nine packets the task named over three windows. The one exception, `boss-sd-1` on the
  reference console (4.5e-8 absolute over 2048 samples, 5.8e-8 over 16 384), is the numeric re-pivot adopting
  there; a scratch build with the adoption disabled makes it bit-identical too (section 5a).
- **Factor 2 and above is unchanged from 0.4.0**, bit for bit: the whole 145-packet corpus at 2x and at 4x on both
  consoles, and five profile packets at 2/3/4/5/6/8 (every output sample), plus decision parity TS vs WASM at os4
  reproducing the 0.4.0 report's recorded log digit for digit (section 5c).
- **Check 4 (evidence integrity): the Newton-budget spike's `boss-dm-2` row (4.3e-10) was wrong; the shipped rule
  moves dm-2 by 5.6e-3.** Cause established at the level of the harness (the sweep runs the method with the
  fixed-point twin on, which pins dm-2 to the previous-solution trajectory); why the twin does that is unresolved.
  It is the only row of 145 that disagrees with a twin-free run of the real runtime. The report and its tables
  carry a dated correction (section 6).
- **Not established: the stall's mechanism.** Predictor-caused (present with it, absent without, deterministic),
  but not seed-triggered at onset (the last seed is about 2 250 samples before the first expensive sample).
  Consistent with trajectory dependence; not shown beyond that (section 5b).
- **Fresh-clone gate green:** typecheck 0, build:wasm 0, build 0, `bun test` **2000 pass / 0 fail** (WASM tests
  ran, none skipped), build:pages 0, every pack dry-run 0. Both browser proofs PASS. The emsdk 3.1.74 binary (CI's
  toolchain) passes the CI step (915/0) and the full suite (2000/0) and is bit-identical to the 6.0.4 binary on all
  24 profile-packet rows at x1/2/4/8 (section 9).
- **Judgement calls for you:** (1) every factor above 1 keeps the predictor, including 3, 5 and 6 (section 2: the
  numbers do not support a power-of-two-only rule); (2) findings outside this change, reported and not fixed
  (section 10), the main one being that the predictor costs more iterations than the previous-solution start at
  os2 and os4 on a synthetic hard-clipping square.

## 1. The diff

Uncommitted, 20 tracked files changed plus the new harness directory and this note.

| file | change |
|---|---|
| `packages/runtime/src/reference-runtime.ts` | `this.oversample > 1 &&` added to both `predictorPass` predicates (`iterate`, `iterateEliminated`); the `newtonStartHistory` doc and the two site comments say it runs only above factor 1 and why (measured figures, section 2) |
| `packages/runtime/src/cpp/Engine.cpp` | `oversample_ > 1 &&` added to both `predictorPass` predicates (`Engine::iterate`, `Engine::iterateEliminated`) and one comment |
| `packages/runtime/src/cpp/include/v2/Engine.h`, `packages/runtime/src/v2-wasm-engine.ts` | comments only: the ring and both counters stay 0 at factor 1 |
| `packages/runtime/tests/newton-start-predictor.test.ts` | one test moved to os4 with a forced-off control; four tests added (section 5f) |
| `packages/runtime/tests/v2-wasm-newton-predictor.test.ts` | one test rewritten for x1, two added, one adjusted (section 5f) |
| `packages/runtime/package.json` | 0.4.0 -> 0.4.1 |
| `packages/chain/package.json` | 0.1.6 -> 0.1.7; pins runtime 0.4.1 (compiler 0.4.0, core 0.16.0 unchanged) |
| `packages/player/package.json` | 0.2.4 -> 0.2.5; pins chain 0.1.7, runtime 0.4.1 (compiler 0.4.0, core 0.16.0 unchanged) |
| `tests/package.test.ts` | changelog head expectation -> `## runtime 0.4.1 / chain 0.1.7 / player 0.2.5`; the 0.4.0 entry added to the `toContain` list (as `2558e5b` did for 0.3.0) |
| `CHANGELOG.md` | new 0.4.1 entry; in the 0.4.0 entry the wrong sentence struck (visible, with a pointer) and the "What did not change" paragraph made true of 0.4.0 |
| `packages/runtime/README.md` | install version; the predictor paragraph now says it runs at `oversample` 2 and above only; the WASM paragraph says the counters read 0 at factor 1 |
| `packages/chain/README.md`, `packages/player/README.md`, `docs/src/content/docs/index.mdx`, `.../guides/runtime.mdx`, `.../guides/signal-chain.mdx` | version strings; the runtime guide's `oversample` bullet gains one sentence on the predictor |
| `docs/spikes/2026-10-09-newton-iteration-budget.md`, `docs/spikes/newton-budget/out/corpus-m1adapt3-pedals-table.md`, `.../corpus-m1adapt-pedals-table.md` | dated correction of the `boss-dm-2` row (section 6) |
| `docs/spikes/hotfix-0.4.1/` (new, 17 files) | the scratch harness for this task (16 scripts) and a README |
| `docs/releases/2026-10-09-release-prep-0.4.1.md` | this note |

The whole engine change:

```
reference-runtime.ts (twice):   const predictorPass =
                                    this.oversample > 1 &&
                                    !dc && sourceScale === 1 && gmin === GMIN_SIEMENS && !block.linear;
Engine.cpp (twice):             const bool predictorPass = oversample_ > 1 && !dc && (sourceScale == 1.0)
                                    && (gmin == GMIN_SIEMENS) && !block.linear;
```

The predicate exists once per solve path (the dense/sparse `iterate` and the Schur-eliminated `iterateEliminated`) in
each console, so "the one place" is four lines, one rule. `predictedNewtonStart` (seed) and `recordNewtonSolution`
(ring advance and counters) are both reached only through `predictorPass`, so a false predicate means no seed, no
record, no chain/order movement and no counter movement. `prepare()` and `reset()` already clear the ring.

## 2. Decisions the change contains

**Non-power-of-two factors keep the predictor ("oversample > 1 means on").** Oversample 3 runs the held path at the
solver rate x3, and the predictor was designed for the band-limited sub-sample cadence, so I measured instead of
assuming. Reference console, five profile packets (muff, sd1, ts9, ts808, gro100; 1 kHz 0.1 V, cap 64, 2400 warm-up
+ 9600 measured host samples), the 0.4.1 tree (predictor on above 1) against the same tree with the predicate
forced false (`os-factor-probe.ts`, `os-factor-join.ts`):

| factor | iterations per host sample, predictor on vs off | output movement on vs off (relative RMS) |
|---|---|---|
| 2 | muff -6.0 %, sd1 -14.2 %, ts9 -14.8 %, ts808 -10.2 %, gro100 -10.9 % | 2.6e-10 .. 2.0e-6 |
| **3 (held)** | **muff 0.0 %, sd1 -0.9 %, ts9 -0.6 %, ts808 -0.9 %, gro100 -1.3 %** | 2.2e-10 .. 1.7e-6 |
| 4 | -38.9 %, -40.4 %, -44.5 %, -47.2 %, -43.3 % | 1.4e-10 .. 3.9e-7 |
| **5 (held)** | **-15.0 %, -11.1 %, -8.0 %, -7.8 %, -19.4 %** | 1.6e-10 .. 2.1e-6 |
| **6 (held)** | **-23.3 %, -16.3 %, -10.1 %, -10.6 %, -24.1 %** | 1.5e-10 .. 6.0e-6 |
| 8 | -44.5 %, -46.9 %, -49.2 %, -49.7 %, -45.8 % | 1.2e-10 .. 5.0e-7 |

Non-converged samples 0 on every row (both sides). So on the held path the predictor never cost iterations and moved
the output by the same few 1e-7..1e-6 it moves at 2/4/8; it buys nothing at 3 and 8-24 % at 5 and 6. A
power-of-two-only rule would forfeit the 5x/6x saving to add a second condition for a factor (3) where the predictor
is merely idle, so I did not deviate from the default. Limits: five packets, TS in-process, factors 7 and 9 upward
not measured, blue-box not measured here (cap 64 at os8 is hours), and the numbers are for this stimulus.

**The factor is fixed per `prepare()`, so there is no mid-run switching case.** `oversample` is read only by
`prepare()`; `reset()` keeps it; a new `prepare()` clears the ring. The unit test "clears the ring on prepare():
re-preparing at factor 1 after a 4x run" pins that.

**Doc-comment claims are the measured ones.** The `newtonStartHistory` comment now carries the factor-1 cost/benefit
(2.9 % pedals / 10.1 % amps fewer iterations against dm-2 moving 6.2 % of its cold-start peak and the mt-2 stall) and
the per-factor savings above. It says the stall happens with the predictor and not without it, not why.

## 3. Baseline first (before any edit)

Everything in this section ran on a scratch clone of `2558e5b` (`git clone --branch indiejoseph/release-0.4.1`,
`bun install --frozen-lockfile`), not in the nested worktree, which resolves into the main checkout's stale `dist`.
Instruments run from the clone root (the root tsconfig maps `@vessel-dsp/*` to `src`), wasm built with the local
emsdk 6.0.4 (`source ~/projects/emsdk/emsdk_env.sh && bun run --cwd packages/runtime build:wasm`).

**(a) F1 reproduced.** `docs/spikes/hotfix-0.4.1/mt2-timeline.ts --console=wasm --seconds=8` (scoreboard stimulus:
440 Hz @0.25 + 1320 Hz @0.1 from t=0, 128-sample blocks, cap 1024). Wasm `aef38274...` (built from this tree):

```
second 0: 23.0 us/sample (1.10x real time)
second 1: 21.4 us/sample (1.03x real time)
SLOW block starting at sample 132096 (2.7520 s): 2993.9 ms = 23390 us/sample; telemetry {"seedsUsed":242,"oneIterationSolves":0,"totalIterations":640804}
SLOW block starting at sample 132224 (2.7547 s): 11554.0 ms = 90266 us/sample; ...
SLOW block starting at sample 132352 (2.7573 s): 11558.0 ms = 90297 us/sample; ...
```

The first block over 50 ms starts at sample **132 096**, as the workbench note says; every later block costs about
90 ms per sample. It reproduces on my build, so the diagnosis stands. The TS reference does not stall on the same
tree (4 s: 154.8..168.6 us/sample, 7.4-8.1x real time, `11-base-mt2-ts.log`; the final 8 s runs are in section 5b).

**(b) F2 reproduced, and the predictor-off control.** `x1-dump.ts` renders every corpus document at x1 on both
consoles (two-tone, 2048 samples, cap 1024), `x1-compare.ts` compares two runs sample for sample.

Published 0.4.0 (predictor on) against published 0.3.1, TS then WASM, max|a-b| / peak(0.3.1), first 100 samples
dropped as in the workbench's method; this reproduces the workbench's F3 table to the digit
(`31b-base-vs-031-settle100.log`):

```
TS:   bit-identical 39 | <=1e-9 14 | <=1e-7 25 | <=1e-6 23 | <=1e-5 24 | <=1e-4 13 | <=1e-3 5 | >1e-2 2
        boss-dm-2  max abs 5.419e-3  rel 6.206e-2 (peak 8.733e-2)     boss-mt-2  rel 2.143e-2
WASM: bit-identical 47 | <=1e-9  4 | <=1e-7 26 | <=1e-6 25 | <=1e-5 24 | <=1e-4 13 | <=1e-3 5 | >1e-2 1 (boss-dm-2)
programs: emitted text and JSON identical under compiler 0.3.0 and 0.4.0 for all 145
```

The same 0.4.0 tree with `predictorPass` forced to `false` at all four predicate sites in a scratch copy (never in
the tree; wasm rebuilt there, `a08a7e69...`) against published 0.3.1:

```
TS:   bit-identical 144 of 145; differs: boss-sd-1 max abs 4.526e-8 (rel 9.5e-8), new runtime repivoted ["analog:0"], 0.3.1 repivoted []
WASM: bit-identical 145 of 145
```

So the workbench's isolation claim holds: the predictor is the whole x1 effect, and the only other x1 difference is
the documented numeric re-pivot on `boss-sd-1`. (The workbench's 6.8e-8 for sd-1 is a different statistic and
window from my 4.5e-8 absolute / 5.9e-8 relative RMS here; same packet, same mechanism.)

## 4. Build and hashes

Exact command, both builds (`packages/runtime/scripts/build-wasm.sh`, `em++ -O3 -msimd128 -std=c++17 ... -fwasm-exceptions`):

```
source ~/projects/emsdk/emsdk_env.sh        # emcc 6.0.4 (fe5be6afdff43ad58860d821fcc8572a23f92d19)
bun run --cwd packages/runtime build:wasm   # "Build successful: src/wasm/v2_dsp.cjs and v2_dsp.wasm updated (atomic rename)."
```

| build | `v2_dsp.wasm` sha256 | `v2_dsp.cjs` sha256 |
|---|---|---|
| 0.4.0 tree (`2558e5b`), emsdk 6.0.4 | `aef38274384e36db5433963f6893a1f32045daf8685f7d10df9aeba0c01adf02` | `af9897c81b08fb6f7546ca7f72acf8b83c21449a3cf2f68428148b815159a567` |
| **this diff, emsdk 6.0.4** (scratch clone, then again in the fresh clone: the same hash) | `cd27e58e63e8e9a92a52fe24cc4bcc1e6f97166ac795eef31e567f044f17c84a` | `af9897c8...` (unchanged) |
| this diff with the gate removed again (scratch), emsdk 6.0.4 | `aef38274...` = the 0.4.0 binary, byte for byte | |
| **this diff, emsdk 3.1.74 (CI's toolchain)** | `37509d2f5c50a4743867256382ff9c53e08dc758168ad084cc8b6a5e5b1fc15c` | `e2c12f7a4a8f61a506aad94ce40c6e575b778ee1b251dc6217c50e33b94e5e22` |

The 0.4.0 binary that users have is the 3.1.74 build (`24747d09...` per `2026-10-09-release-prep.md` section 6); the one
`publish.yml`'s `prepack` will produce for 0.4.1 is `37509d2f...`. The gate-removed hash equalling the 0.4.0 hash is the
strongest statement that the gate is the only compiled difference. The kernel table is unchanged (section 8).

## 5. Controls, both directions

### 5a. Factor 1 restored to 0.3.1 (`x1-dump.ts`, `x1-compare.ts`; published 0.3.1 from `npm i @vessel-dsp/runtime@0.3.1 @vessel-dsp/compiler@0.3.0` in a scratch dir, same scripts copied beside it)

**The nine packets the task named**, gated tree vs published 0.3.1, both consoles, three windows: two-tone 2048 (part
of the corpus run), two-tone 48 000 samples (1 s, cap 1024), and core's protocol (2400 warm-up + 9600 of 1 kHz 0.1 V,
cap 64, 0 ohm). **Every one is bit-identical on both consoles on all three windows (max abs 0.000e+0 in every
cell).** (`boss-sd-1`, the one packet that differs, is not among the nine.) What the published 0.4.0 did to the same
packets (relative RMS against 0.3.1, TS / WASM; `34-`, `36-` logs):

| packet | core protocol (9600 samples) | 1 s two-tone |
|---|---|---|
| boss-dm-2 | 5.6e-3 / 5.6e-3 | 1.19e-1 / 1.19e-1 |
| boss-hm-2 | 3.4e-5 / 3.4e-5 | 5.5e-6 / 7.1e-6 |
| ibanez-ts9-reissue | 4.2e-6 / 4.2e-6 | 2.7e-6 / 2.7e-6 |
| big-muff-pi-ec3003-rev-f | 2.3e-10 / 3.2e-9 | 1.5e-7 / 1.5e-7 |
| boss-mt-2 | 7.8e-3 / 1.2e-2 | 4.4e-3 / 3.3e-3 |
| boss-od-1 | 9.9e-6 / 9.9e-6 | 9.5e-6 / 9.5e-6 |
| ibanez-ts808 | 4.5e-6 / 4.5e-6 | 2.4e-6 / 2.4e-6 |
| orange-gro100 | 7.5e-10 / 6.3e-9 | **3.6e-1 / 3.8e-1** |
| mxr-blue-box | **2.0e-1 / 1.5** | 0 / 0 (that window never engaged it) |

(gro100 and blue-box are cap-storm packets whose trajectories are chaotic, so their 0.4.0 movement is large and not
meaningfully a "level"; mt-2 is the stalling packet. None of these runs is validated against hardware.)

**Whole corpus, 145 compiled packets** (122 pedals + 23 amps; `boss-dd-3t` unsupported, as in 0.4.0; programs compiled
by the 0.4.0 compiler are emitted-text and JSON identical to the 0.3.0 compiler's on all 145; artifacts `b9508b71c`):

| build vs published 0.3.1 | console | window | bit-identical | <=1e-9 | <=1e-7 | <=1e-6 | <=1e-5 | <=1e-4 | <=1e-3 | <=1e-2 | >1e-2 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| published 0.4.0 (= gate removed again, scratch) | TS | 2048 two-tone, first 100 dropped | 39 | 14 | 25 | 23 | 24 | 13 | 5 | 0 | 2 |
| published 0.4.0 | WASM | same | 47 | 4 | 26 | 25 | 24 | 13 | 5 | 0 | 1 |
| **this diff** | TS | same | **144** | 0 | 0 | 1 (boss-sd-1, 1.0e-7) | 0 | 0 | 0 | 0 | 0 |
| **this diff** | WASM | same | **145** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| this diff | TS | 16 384 two-tone | **144** | | | 1 (boss-sd-1, 1.2e-7) | | | | | |
| this diff | WASM | 16 384 two-tone | **145** | | | | | | | | |

**Differences, attributed.** One, `boss-sd-1`, reference console only. Mechanism: the 0.4.0 numeric re-pivot
(`docs/spikes/2026-10-08-numeric-pivoting.md` section 4: adoption set corpus-wide is `boss-sd-1`; `boss-aw-2` and
`mxr-dyna-comp` adopt by the rescue rule in 0.3.1 too). In the dumps the new runtime reports `solverPlan().repivoted =
["analog:0"]` on sd-1 and 0.3.1 reports `[]`; the other two report `["analog:0"]` in both. The number: 4.526e-8 max abs
over 2048 samples (9.5e-8 of peak; 5.9e-8 relative RMS), 5.778e-8 over 16 384 (1.2e-7 of peak). **Control that proves
the mechanism rather than correlating with it:** in a scratch copy of the gated tree with
`shouldRefinePivotOrder` forced to `return false` (adoption off), `boss-sd-1`, `boss-aw-2` and `mxr-dyna-comp` are all
bit-identical to 0.3.1 over 16 384 samples (`62-sd1-pivot-control.log`). The C++ console keeps the shipped order on
sd-1 by the documented TS/C++ adoption split (pivot report section 9), so its sd-1 is bit-identical too. The predictor-off scratch
build and the gated tree are bit-identical to each other on all 145 packets on both consoles.

### 5b. F1 after the gate (`mt2-timeline.ts --seconds=8`, one run after another on an otherwise idle box, load average beside each)

| runtime / console (load 1-min before) | us/sample (x real time) for seconds 0..7 | blocks > 50 ms | stall |
|---|---|---|---|
| published 0.3.1, WASM (0.80) | 68.4 (3.28), 68.4 (3.28), 67.9 (3.26), 68.3 (3.28), 67.3 (3.23), 70.2 (3.37), 73.7 (3.54), 69.9 (3.36) | 36, all 50-126 ms | none |
| published 0.4.0, WASM (0.93) | 21.9 (1.05), 21.3 (1.02), then **stall from sample 132 096**: 2981 ms, 11 723 ms, 11 659 ms for three consecutive blocks, run stopped | 3 | **yes**; telemetry at onset `{"seedsUsed":242,"oneIterationSolves":0,"totalIterations":640804}` |
| **this diff, WASM, emsdk 6.0.4** (0.96) | 24.6 (1.18), 26.4 (1.27), 25.9 (1.24), 26.2 (1.26), 26.0 (1.25), 27.3 (1.31), 27.5 (1.32), 26.5 (1.27) | **0** | **none**; `{"seedsUsed":0,"oneIterationSolves":0,"totalIterations":1731151}` |
| **this diff, WASM, emsdk 3.1.74** (0.97) | 24.7 (1.19), 26.1 (1.25), 26.4 (1.27), 26.0 (1.25), 25.7 (1.23), 27.2 (1.30), 27.9 (1.34), 26.9 (1.29) | **0** | **none**; same 1 731 151 total iterations as the 6.0.4 binary |
| published 0.4.0, TS (0.97) | 152.9 (7.3), 149.9 (7.2), 158.5 (7.6), 165.7 (7.9), 170.6 (8.2), 153.8 (7.4), 160.3 (7.7), 155.5 (7.5); 221 non-converged | none over 2 s | none |
| **this diff, TS** (1.59) | 159.0 (7.6), 146.6 (7.0), 169.3 (8.1), 156.4 (7.5), 149.7 (7.2), 146.6 (7.0), 148.5 (7.1), 162.1 (7.8); 210 non-converged | none over 2 s | none |

The gated WASM console runs about 2.7x faster than the published 0.3.1 binary on this packet (1.2-1.3x vs 3.2-3.5x real
time) while producing bit-identical output. I did not investigate why: between those two binaries the 0.4.0 tree changed the
kernel table (139 kernels, was 137), the pivoting and the resampler, none of which is this change, and the workbench saw the same
22-24 us/sample in 0.4.0's first two seconds. The 1.2-1.3x is still over the 1.0x budget; `boss-mt-2` was never real-time on
WASM (workbench: 2.1-2.3x in the worklet before the bump) and is documented as dynamically unstable as drawn, so this fix
removes the new failure mode and does not make the packet play. TS and WASM are in different trajectories on this packet at
0.3.1 and again now (4.84e-3 over the 2048-sample window, section 10); at 0.4.0 they happened to agree over that window and
then WASM stalled where TS did not.

**The stall's mechanism (not established).** What the before/after shows: with the predictor on, WASM stalls at sample
132 096 every time (deterministic; same sample and same telemetry on every run); with it off the same console never
stalls and is bit-identical to 0.3.1, which did not stall either. A discriminating probe on the 0.4.0 console
(`mt2-seed-timing.ts`): the predictor seeded 242 solves in 116 of the first 1031 blocks (first at sample 0, last at
block 129 920), then none through the stall onset; the first sample over 5 ms is 132 172, about 2 250 samples after the
last seed, and the stall starts at no seed event. So it is predictor-caused but not seed-triggered at the moment it
begins; that is consistent with the predictor selecting a different trajectory (a start inside the tolerance band
changes every later iterate) that eventually lands in the cap-storm regime the previous start never reached. I did not
show that, and cannot separate it from "an earlier seed seeded the bad state itself" without a state-level bisection I
did not run.

### 5c. Factor 2 and above unchanged from 0.4.0 (os4 saving intact)

- **Decision parity, TS vs WASM, six profile packets** (`docs/spikes/newton-predictor-wasm/decision-parity.ts --os=1,4`,
  1 kHz @0.1 V, 4800 host samples, cap 1024, one-sample `process` calls; `70-gate-decision-parity.log`). The os4 half
  of this log is **identical, row for row and column for column, to `docs/spikes/newton-predictor-wasm/06-decision-parity.log`**
  (the 0.4.0 report's own record) and to the same harness run on the 0.4.0 tree today (`diff` empty):

```
muff    4 | 4800 | seeds 18195/18195 | one-it 12906/12906 | iterations 26869/26869 | order 0, seeds 0, one-it 0, iterations 0 | EXACT
sd1     4 | 4800 | 17884/17884 | 14526/14527 | 25683/25682 | one-it 5, iterations 5 (first: sample 614, TS 4 vs WASM 3)       | decision exact, 5 knife-edge solves
ts9     4 | 4800 | 19185/19185 | 16050/16050 | 22352/22352 | 0 | EXACT
ts808   4 | 4800 | 19185/19185 | 15975/15975 | 22427/22427 | 0 | EXACT
gro100  4 | 4800 | 18613/18613 | 16655/16655 | 22675/22675 | one-it 4, iterations 4 (first: sample 2)                        | decision exact, 4 knife-edge solves
blue-box 4 | 4800 | 290/290 | 1/1 | 70913/70900 | iterations 4 (first: sample 1154, 54 vs 55)                              | decision exact; chaotic
```

  Order and seed decisions are identical on 12 of 12 rows and 57 600 host samples (x1 and os4), as in the report.
- **Whole corpus at os2 and os4, both consoles, 2048-sample two-tone** (`x1-dump.ts --os=2` / `--os=4`, gated tree vs the
  published 0.4.0 tree): **145 of 145 bit-identical on TS and 145 of 145 on WASM, at each factor** (`37-`, `38-` logs).
- **Five profile packets at 2/3/4/5/6/8, every output sample, iterations per host sample, seeds, one-iteration solves and
  non-converged counts**: 30 of 30 rows identical between the 0.4.0 tree and this diff (`os-factor-identical.ts`).
- **The os4 saving is intact**, measured against the predictor forced off (section 2 table, os4 row): muff -38.9 %,
  sd1 -40.4 %, ts9 -44.5 %, ts808 -47.2 %, gro100 -43.3 % (the report and CHANGELOG: -39..-47 % and 44 %). The report's own
  harness agrees (`measure.ts --os=4`: muff 9.063 -> 5.500 at its own base `1d9b6f2`, 9.063 -> 5.542 on the current tree with the predictor off,
  m1adapt3 being the spike's scratch implementation of the shipped rule). The os2 figure in the same report does not
  survive the stage-specific cascade; see section 10.

### 5d. The check can fail

A scratch copy of the gated tree with the gate removed again (four lines reverted; wasm rebuilt `aef38274...`, the 0.4.0 hash):

- (a) x1 corpus vs 0.3.1 goes red by the dm-2 figure: TS 39/14/25/23/24/13/5/0/2, WASM 47/4/26/25/24/13/5/0/1,
  `boss-dm-2` max abs 5.419e-3 = **6.206e-2** of peak (`55-ungate-vs-031.log`), the 0.4.0 distribution again, digit for digit.
- (b) the WASM mt-2 timeline stalls again at **sample 132 096**: blocks of 3072.1 ms, 11 860.0 ms and 12 363.3 ms, with
  `{"seedsUsed":242,"oneIterationSolves":0,"totalIterations":640804}` at the first (`53-ungate-mt2-wasm.log`), the same sample and
  the same telemetry as the published 0.4.0 run.
- (c) the new tests go red: 6 of the 13 predictor tests fail on the ungated tree (`61-ungate-tests.log`).

Restored: the gated tree rebuilt from scratch in the fresh clone gives `cd27e58e...`, the hash recorded in section 4.

### 5e. Decision parity and counters at x1

At x1, in the decision-parity log above: `seeds TS/WASM 0/0` and `one-it 0/0` on **all six packets**, order mismatches 0.
The per-sample iteration columns at x1 are now the pre-predictor consoles' own: muff 17 160/17 160, sd1 14 644/14 644,
ts9 12 611/12 611, ts808 14 008/14 008, gro100 10 517/10 515 (6 samples differ, first at 1108, TS 2 vs WASM 3),
blue-box 38 312/40 561 (134 samples differ, first at sample 1, 391 vs 695). Those gro100 and blue-box figures are exactly the
ones `2026-10-09-newton-predictor-wasm-port.md` section 3a records for the **pre-predictor** consoles ("6 of 4 800 gro100
samples (first at 1108: TS 2, WASM 3) and 134 of 4 800 blue-box samples (sample 1: 391 vs 695)"): factor 1 is back where
it was, including the knife-edge disagreements (`06b-iter-parity-pre-predictor.log` there: 0/4800 differing samples on muff, sd1, ts9 and ts808,
6/4800 on gro100, 134/4800 on blue-box, as here). At os4 the counters equal the TS counts (table in 5c).

### 5f. Tests (`packages/runtime/tests/`)

Before any test edit, the 7 existing predictor tests (3 TS, 4 WASM) against the gated tree gave 5 pass / 2 fail, for the right reason
(both failures asserted that the predictor engages at x1). What changed, and why:

| test | what changed and why |
|---|---|
| TS `reaches the same fixed point as the previous-solution start, within tolerance` | failed (`engaged` 0, bar > 100) because it ran at factor 1. Moved to oversample 4 where the predictor runs; **the bars are unchanged** (`engaged > 100`, worst <= 1 tolerance unit, 0 non-converged, output < 1e-3). The control is now the same runtime with `predictedNewtonStart`/`recordNewtonSolution` disabled on the instance (clearing the history per host sample is not a previous-solution control at 4x, where the ring rebuilds inside the sub-samples). |
| TS `falls back to the previous-solution start after a hard edge and costs nothing extra` | unchanged, still passes; at factor 1 it now pins "identical by construction". Comment added saying that the same square at 2x/4x is NOT free (section 10). I tried the same bars at os4 and they do not hold (+1 iteration on 120 of 960 host samples), so I did not add a false bar. |
| TS (new) `does not run at factor 1: no seeds, an empty ring, and a render bit-identical to one with the predictor forced off` | the requested bit-identity test: smooth RC, clipping sine and hard square, `toEqual` on every output sample, `seeds() === 0`, `newtonStartHistory.size === 0`, equal `totalIterations` |
| TS (new) `the factor-1 comparison can fail: at 4x the same two renders differ, and the predictor seeds` | the control for the above (os4: seeds > 1000, outputs differ, fewer iterations) |
| TS (new) `seeds at every oversample factor above 1 (powers of two and the held path alike), and at none of 1` | the requested os>1 seeding test, factors 2, 3, 4, 8 |
| TS (new) `clears the ring on prepare(): re-preparing at factor 1 after a 4x run leaves it empty and unseeded` | the no-mid-run-switch case |
| WASM `clears the ring on reset() and prepare()` | failed at x1 (`seeded > 0`); now `seeded > 0` above 1 and `=== 0` at 1; the bit-for-bit repeat checks are unchanged for both |
| WASM `decides the same order on a clipping signal at x1, where the gate and the tie rule do the work` | replaced by `never seeds at x1, on either console, whatever the signal`: seeds, one-iteration solves and orders exactly 0 on both consoles, the iteration-count and `maxDelta` bars kept; a vacuous version of the old test would have passed |
| WASM (new) `decides the same order on a clipping signal at 2x and 4x` | the old test's decision bars (orderWithoutCount 0, orderMismatches <= countMismatches, and so on) at the factors where the predictor now lives |
| WASM (new) `does not run at x1 on the smooth signal where it seeds nearly every sub-sample at 4x` | x1 counters 0 and `totalIterations` equal to the reference's (which the TS suite pins as bit-identical to forced-off); the 4x seeds > 90 % |

There is no way to force the predictor off in the C++ console (no knob, by the principle), so the WASM suite cannot
assert bit-identity to a forced-off WASM render; it asserts zero seeds, zero one-iteration solves, order 0 and equal total
iterations with the TS console, whose forced-off bit-identity is pinned, and section 5a's corpus run carries the WASM
bit-identity to the published 0.3.1 binary. Net: 13 predictor tests (7 TS + 6 WASM), 6 of which fail when the gate is removed.

## 6. Evidence integrity: why the Newton-budget table said 4.3e-10 for `boss-dm-2`

**The claim being checked.** `docs/spikes/2026-10-09-newton-iteration-budget.md` section 12 (full table
`newton-budget/out/corpus-m1adapt3-pedals-table.md`): `boss-dm-2 | 89 | 2.255 -> 2.254 | -0.1 | 0/0 | 4/4 | 7.9e-10 -> 1.0e-9 | 4.3e-10 | 4.5e-3`, i.e.
"gated rule vs shipped 4.3e-10", x1, cap 64, 2400 + 9600 samples of 1 kHz 0.1 V. The workbench worker and the
coordinator measured 5.6e-3 for the published build in that protocol.

**Reproduced both numbers.** (1) The spike's own harness on its own base: a clone at `1d9b6f2`, harness copied in,
`bun docs/spikes/newton-budget/corpus-sweep.ts --method=m1adapt3 --packet=boss-dm-2`:

```
boss-dm-2   n= 89 it/host 2.255 -> 2.254 (-0.1%) NC 0/0 (dense 0) peak 4/4 vsDense 7.9e-10 -> 1.0e-9 vsShipped 4.3e-10 devTol 0.004 ...
```

(2) The real shipped patch (`runtime-start-predictor.patch`, `git apply`ed onto that base) against the real unpatched
runtime in the same protocol (`dm2-corrected-row.ts`): **5.608e-3** relative RMS (it/host 2.255 -> 2.252, non-converged
0/0, peak 4/4; against the forced-dense reference also 5.608e-3, the unpatched sparse-vs-dense being the table's 7.9e-10).

**What the harness measures dm-2 against.** Not "its own scratch loop rather than the shipped runtime" for the
baseline: `corpus-sweep.ts` calls `runPacket(..., null)` for "shipped" and for "dense", which uninstalls the scratch loop
and runs the real `ReferenceRuntime` (unpatched at `1d9b6f2`). The method side is the scratch loop.

**Was it a different rule?** No. Per-solve trace of dm-2 in the spike protocol, `rule-trace.ts` (12 000 standard-pass
solves, 2400 of them warm-up): the shipped patch and the scratch `m1adapt3` make the identical decision on every solve
(2 500 seeded each, 0 solves where the seeding decision differs, 0 where the iteration count differs) and produce
**bit-identical solution vectors on all 12 000 solves** (`solution-compare.ts`). Against a scratch run with the predictor
off, that rule departs on 11 954 solves, 11 884 of them by more than one tolerance unit, worst 1 720 units
(`43-solution-compare.log`). So the spike's rule is the shipped rule, and the rule moves dm-2.

**Cause.** `corpus-sweep.ts` always runs the method with `fixedPointCheck: true` (the dense twin solve from the same state,
state snapshotted and restored). With the twin on, the method's solves on dm-2 stay within **2.4e-3 tolerance units** of
the predictor-off scratch run on all 12 000 solves (and seed 2 543 times instead of 2 500): the twin-instrumented method run
is on the previous-solution trajectory, not the rule's own. Without a predictor the twin changes nothing (0 of 12 000
solves differ), so it is the combination (twin plus seeding) that pins dm-2. **The mechanism inside the twin is
unresolved**; I time-boxed it. Ruled out: a different rule (bit-identical to the shipped patch), a protocol or stimulus
difference (the same protocol reproduces both numbers), the baseline being the scratch loop (it is the real runtime), the
packet or corpus having changed (dm-2 last edited 2026-09-18, before the spike), the build (the same 4.3e-10 on a fresh
clone of the base).

**Which other rows could share it.** I joined, for all 145 packets, the table's `methodVsShipped` (pedals and amps
jsonl) against the real runtime with the predictor on vs forced off in the same protocol (`x1-dump.ts --stim=k1`, the 0.4.0
tree vs the predictor-off scratch tree; `sweep-table-recheck.ts`, `46-sweep-table-recheck.log`). 44 packets have a figure
at or above 1e-7 on either side; **43 agree to within 2x (ratio 1.00 to three digits on the ten largest) and the other 101 are
below 1e-7 on both sides; `boss-dm-2` (table 4.3e-10, real 5.61e-3, ratio 1.3e7) is the only outlier.** The distributions
match bucket for bucket (<1e-9: 73 real vs 74 table; 1e-9..1e-7: 28 vs 28; 1e-7..1e-5: 34 vs 34; 1e-5..1e-3: 4 vs 4;
1e-3..1e-2: 3 vs 2; 1e-2..1: 3 vs 3), dm-2 being the one that moved from the 1e-3..1e-2 bucket to <1e-9. The workbench's
other two reproductions (`boss-hm-2` 3.4e-5, `big-muff-pi` 4.1e-7) agree with this. So the table is wrong in one row; its
aggregates are unaffected (dm-2's table method-vs-dense was 1.009e-9, already over the 1e-9 bar, so the "60 pedals still
meet it" count does not move). The statement "every converged pedal solution within 0.012 tolerance units of full Newton"
was measured with the twin on, so for dm-2 it is not established on the rule's own trajectory.

**What was edited.** In `corpus-m1adapt3-pedals-table.md` the dm-2 cells are struck in place (`~~...~~`) with the
corrected figures beside them (2.255 -> 2.252; vs dense 5.6e-3; vs shipped 5.6e-3; fixed-point deviation "not measurable
twin-free") and a dated note under the table; in `corpus-m1adapt-pedals-table.md` (the ungated rule, which never shipped) the
same row's agreement cells are struck as unreliable, not re-measured; the report gets a dated correction note under section 12.
Nothing is deleted.

## 7. CHANGELOG, docs, versions

- `CHANGELOG.md`: `## runtime 0.4.1 / chain 0.1.7 / player 0.2.5` above the 0.4.0 entry (the gate; F1 and F2 with their
  numbers; "factor-1 output is again bit-identical to runtime 0.3.1 except where the numeric re-pivot adopts" with the
  measured counts, 144/145 and 145/145 on two windows, the nine packets, the sd-1 number and its control; the corrected
  account of 0.4.0's factor-1 bucket distribution; the plain statement that runtime 0.4.0 users at factor 1 saw that
  movement). In the 0.4.0 entry the wrong sentence is struck and a pointer left (*"Struck 2026-10-09: superseded by the
  runtime 0.4.1 entry above..."*); the parenthetical in the same paragraph ("factor-1 renders were bit-identical to the
  previous console with the predictor disabled") was also not quite true (sd-1 on the reference console), so it is struck
  and restated with the 144/145 and 145/145 figures. Nothing else in the 0.4.0 entry was touched.
- `packages/runtime/README.md`: the predictor paragraph and the WASM paragraph; `docs/src/content/docs/guides/runtime.mdx`: one
  sentence in the `oversample` bullet. The other guides and READMEs carried no predictor text.
- Versions: runtime 0.4.1 (pins compiler 0.4.0), chain 0.1.7 (pins compiler 0.4.0, core 0.16.0, runtime 0.4.1), player 0.2.5
  (pins chain 0.1.7, compiler 0.4.0, core 0.16.0, runtime 0.4.1). `bun.lock` does not pin workspace versions (`bun install
  --frozen-lockfile` exits 0 in the fresh clone with no lockfile change, as at 0.4.0). `git diff -- packages/compiler` is empty.
  Stale-string grep over READMEs, guides and tests for `0.4.0`/`0.1.6`/`0.2.4` finds only history that is true (the 0.4.0 entry,
  the `v2_engine_prepare` signature change "in runtime 0.4.0", compiler 0.4.0 references).

## 8. Kernels: `GeneratedKernels.cpp` is current (zero diff)

As `2026-10-09-release-prep.md` section 3, with the harness's own copy of the 40-line exporter
(`docs/spikes/hotfix-0.4.1/export-programs-release-compiler.ts`; the workbench's `export-programs.ts` would export programs
its pinned older compiler compiled):

```
$ bun docs/spikes/hotfix-0.4.1/export-programs-release-compiler.ts --out=<scratch>/programs
  skip boss-dd-3t: unsupported
compiler package version 0.4.0; wrote 145 programs to <scratch>/programs
$ bun packages/runtime/scripts/generate-kernels.ts --programs=<scratch>/programs --out=<scratch>/GeneratedKernels.regen.cpp
generate-v2-kernels: wrote ... with 139 kernels (561 scheduled blocks, 419 below min ops 64)
$ diff <scratch>/GeneratedKernels.regen.cpp packages/runtime/src/cpp/GeneratedKernels.cpp && echo ZERO DIFF
ZERO DIFF
sha256 both: 6328392fe36be27964872f585ce7445549d41d6983489523eb723065c1228c41
```

The schedules did not change (no compiler change, no pivot change); same hash as 0.4.0's note. Artifacts `b9508b71c`, clean.

## 9. Fresh-clone gate (the real one)

Clone: `git clone --branch indiejoseph/release-0.4.1 /home/joseph/projects/VesselDSP/core <scratch>/verify` at `2558e5b`, then
`git apply` of this diff (32 files: the 20 tracked changes plus the 12 harness `.ts` files; the README, this note and the
later lint touch-ups are documentation or scratch and are not part of the gate). bun 1.3.14, node v24.14.0, emsdk 6.0.4 for the
wasm unless stated (CI uses bun 1.2.2 and emsdk 3.1.74; the latter is run below). Exit codes were captured without a pipe.

| command | result |
|---|---|
| `bun install --frozen-lockfile` | exit 0 |
| `bun run typecheck` | exit 0, root and all packages |
| `bun run --cwd packages/runtime build:wasm` (6.0.4) | exit 0, `v2_dsp.wasm` `cd27e58e...` |
| `bun run build` | exit 0, `dist entrypoints ok` |
| `bun test` (wasm present) | exit 0, **2000 pass / 0 fail**, 514 011 expect() calls, 142 files, 69.75 s; no WASM test skipped (`grep -c '(skip)'` = 0) |
| `bun run build:pages` | exit 0, 872 pages, Pagefind index, sitemap, `Complete!` |
| `bun run pack:dry-run` | exit 0: core 0.16.0, stompbox 0.6.17, control-ui 0.6.15, visual-effects 0.6.15, amp 0.6.15, cabinet 0.6.15, **compiler 0.4.0** (708.0 kB / 226 files), **runtime 0.4.1** (1.2 MB / 65 files), **chain 0.1.7** (210.9 kB / 58 files), **player 0.2.5** (1.1 MB / 110 files) |
| `bun run --cwd packages/{compiler,runtime,chain,player} pack:dry-run` | exit 0 each; the three with a wasm prepack rebuild it, and `v2_dsp.wasm` is `cd27e58e...` afterwards |

The 20 tracked files in the worktree are byte-identical to the ones this gate ran (`cmp` against the clone's tree, 0 differ); only scratch harness files
and this note were touched afterwards. 2000 vs 0.4.0's 1994: the six tests added in section 5f. (`bun run lint` fails on `2558e5b` already: pre-existing errors in
`docs/spikes/latency/*` and the vendored three.js; the four it found in my new scripts are fixed. `deploy.yml` fails at
`cp -r src/wasm` on every push for a pre-existing reason; not mine.)

**Browser proofs** (headless Chromium 149.0.7827.55, playwright-core 1.61.0 from the workbench's `node_modules`, in the clone):

- `packages/runtime/scripts/worklet-proof.ts --port=8491`: **PASS**; `worklet peak 0.128883 rms 0.095237`, `maxAbsVsChain 1.102e-8
  (PASS vs 0.0001)` with `structuredClone` present and deleted, overruns 0; the same figures as 0.4.0's note.
- `packages/player/scripts/player-proof.ts --port=8492`: **PASS**. Four playing legs, sound in all 30 chunks of 2048 on each (peaks 0.256,
  0.138, 5.169, 0.0713; rms 0.184, 0.105, 3.15, 0.0506), correlation leg `tightMax` 8.65e-5, 9.70e-4, 8.10e-4, 2.02e-5 against the 2e-3 bar, no
  wasm or worklet request and no AudioContext before the click. Honest detail: on that first run, with the box still busy after the pack steps
  (1-min load 2.3, 5-min 4.9), `buffer-plus-ir` reported 2 overruns in its first window (`newOverruns=0`; the leg is gated on new overruns) and the
  non-gated `phase90-pedal` harvest leg **played** (154 overruns, reported not gated) instead of being refused by admission. On a re-run on a quiet
  box (load 1.4; `--port=8493`): PASS, `buffer-plus-ir` 1 first-window overrun and `newOverruns=0`, `tightMax` 6.70e-5 / 1.00e-3 / 8.10e-4 / 4.36e-5, and the
  phase90 leg **admission-refused with measured 7812 ns** ("cannot be shown to fit inside 5208 ns/sample"), the same refusal and the same figure as
  0.4.0's note. The harvest leg's outcome is host-load dependent; neither outcome is a gate.
- `packages/player/scripts/next-bundle-proof.ts`: **NOT RUN, NOT APPLICABLE** (carried over from `2026-10-09-release-prep.md` section 5): the proof targets the
  blog's player embed, which does not exist yet (its host page `LivePlayer.tsx` exists in no repo). Player 0.2.5's bundling inside a Next app (no
  `v2_dsp.cjs` in client chunks) is UNVERIFIED for this release; player/chain source is unchanged since 0.4.0 (re-pin only).

**Toolchain gap (emsdk 3.1.74, CI's version).** Installed in a scratch directory (`git clone emsdk; ./emsdk install 3.1.74 && ./emsdk activate 3.1.74`;
`~/projects/emsdk` untouched), `em++ 3.1.74`, a copy of the clone built with it (`bun run --cwd packages/runtime build:wasm` exit 0; hashes in section 4):

```
CI step, as publish.yml:  bun test packages/compiler/tests packages/runtime/tests   -> 915 pass / 0 fail, 58 files, exit 0   (3.1.74 binary)
full suite:               bun test                                               -> 2000 pass / 0 fail, 142 files, exit 0   (3.1.74 binary)
```

`toolchain-parity.ts` loads both binaries in one process (`V2WasmEngine.create(program, mod)`) and runs the workbench parity method (440 Hz @0.25 +
1320 Hz @0.1, cap 1024, settle 100 / window 2048, bars r >= 0.9999 and max abs < 1e-4) on the six profile packets at x1/2/4/8
(`15-toolchain-parity.log`):

| packet | os 1 / 2 / 4 / 8: 6.0.4 vs 3.1.74 | TS vs WASM max abs (both binaries identical) | seeds at os 1 / 2 / 4 / 8 (both) |
|---|---|---|---|
| muff | bit-identical on all four | 1.86e-9 at every factor | 0 / 3530 / 7783 / 16253 |
| sd1 | bit-identical | 7.67e-6 .. 7.75e-6 (libm offset, known) | 0 / 3073 / 7342 / 16090 |
| ts9 | bit-identical | 2.69e-5 .. 2.71e-5 (libm offset, known) | 0 / 3719 / 8087 / 16376 |
| ts808 | bit-identical | 7.6e-9 .. 8.9e-9 | 0 / 3017 / 8085 / 16336 |
| gro100 | bit-identical | 7.4e-9 | 0 / 3841 / 7831 / 15953 |
| blue-box | bit-identical | **1.80e-4 (x1), 1.04e-4 (os2)**, 9.3e-10, 9.3e-10 | 0 / 11 / 66 / 267 |

The two toolchains' binaries are **bit-identical float32 on all 24 rows** (max abs delta exactly 0), seeds are 0 at x1 on both and equal on both at
2/4/8. Two rows are over the 1e-4 bar, identically on both binaries: blue-box os2 (1.04e-4, the pre-existing marginal in 0.4.0's note) and blue-box
x1 at 1.80e-4. The x1 row needs a sentence: blue-box is a chaotic cap-storm packet (its TS and WASM iteration counts differ by hundreds from
sample 1), and under this script it reads 1.798e-4 on **published 0.3.1, published 0.4.0 and this tree alike** (`bluebox-x1.ts`), so it is not caused
by this change (the report's own pre-predictor log has blue-box x1 at TS-vs-WASM 1.46e-4, `06b-iter-parity-pre-predictor.log`); the 7.0e-7 in 0.4.0's
note came from its own scratch script (different input handling), and the two scripts' blue-box x1 numbers are not comparable.

## 10. Findings outside this change (reported, not fixed)

1. **The predictor costs iterations at os2 and os4 on a hard-clipping square.** A +-1 V, 1 kHz square into the diode-clipper fixture
   (a synthetic, not a packet), cap 64, 960 host samples: total iterations predictor-on vs forced-off 4360 vs 4200 at os2 (+3.8 %, 160 host samples cost
   one more), 7520 vs 7480 at os4 (+0.5 %, 120 samples cost one more), 11 720 vs 13 320 at os8 (-12.0 %), 1280 vs 1280 at x1 now.
   0.4.0's TS test claimed "costs nothing extra" at x1 only; at 2x/4x it is not free on such an edge. The predictor's `used > 2` gate
   is meant to prevent this and does not completely. Unchanged here by instruction.
2. **The spike report's os2 saving is stale.** The Newton-budget header says "at os2 -26..-35 %". Its own harness on its own base (`1d9b6f2`, uniform
   57-tap cascade) reproduces sd1 -29.2 %, ts9 -35.2 %, ts808 -25.7 % (muff -6.0 %), but on the stage-specific cascade that shipped
   (current tree, predictor off as the baseline) the same harness gives sd1 -14.2 %, ts9 -14.8 %, ts808 -10.2 %, muff -6.0 %. os4 is unchanged
   (-39..-47 % on both). The 0.4.0 CHANGELOG quotes os4 and x1 only, so it is unaffected; the report's os2 sentence is not edited.
3. **TS vs WASM at x1 returns to 0.3.1's disagreement set.** Corpus, two-tone 2048, cap 1024, max abs >= 1e-4: 9 packets (boss-hm-2, boss-mt-2, boss-tw-1,
   dumble-overdrive-special, marshall-1959-super-lead-plexi, marshall-jcm800, marshall-jtm45, orange-rockerverb, vox-ac30-top-boost) on 0.3.1 and on this tree
   (identical sets); 0.4.0 had 8 (`boss-mt-2` happened to agree at 1.39e-8 with the predictor on, 4.84e-3 now and on 0.3.1). The workbench's parity gate
   will see this set again when it re-pins.
4. **`boss-sd-1` pivot adoption differs between the consoles** (TS adopts, C++ keeps the shipped order): the documented pivot report section 9 split, restated here
   because it is why one reference-console row differs from 0.3.1 and no WASM row does.
5. **Mechanism of the fixed-point twin's effect on `boss-dm-2`** (section 6) and **the stall mechanism** (section 5b) are unresolved.
6. `bun run lint` fails on `2558e5b` (pre-existing: `docs/spikes/latency/{alone,alone2,clip-analytic}.ts`, vendored `three` addons).

## 11. What this does not prove

- **Bit-identity to 0.3.1 is measured, not exhaustive.** It is the same code path as 0.3.1 at factor 1 by construction and verified over: 145 packets x 2048 and
  16 384 samples (two-tone, cap 1024), nine packets x 48 000 samples and x 2400 + 9600 samples (1 kHz, cap 64), both consoles, default controls. Not proved for other
  controls, other stimuli, other caps, or other sample rates. Not proved for `oversample > 1` against 0.3.1 (it is the 0.4.0 resampler plus predictor, unchanged from
  0.4.0, and bit-identical to 0.4.0 on the windows above).
- **It says nothing about the real pedals.** 0.3.1 is not the truth either; equality with it is a statement about which earlier release's output factor 1 reproduces.
  `boss-dm-2` has no hardware reference and sits outside the ngspice instruments; `boss-mt-2` and `orange-gro100` are chaotic cap-storm packets.
- **The stall's cause beyond "predictor-caused" and "not seed-triggered at onset"** (5b). One stimulus (the scoreboard's two-tone), one packet, 8 s, bun in-process
  (the AudioWorklet, where one 11 s block would drop the real-time thread, was not exercised; the scoreboard renders offline).
- **Timings are wall-clock on a dev box** with the load average beside them; the 2.7x against 0.3.1 is not portable. The player proof's overrun counts and the
  phase90 harvest outcome depend on host load (both runs reported).
- **The non-power-of-two decision** rests on five packets, TS in-process, factors 3, 5, 6 (and 7+ not at all); blue-box was not measured above os4 and its
  decision parity above is cap 1024 over 4800 samples only.
- **Check 4's cause is at the level of the harness.** Why the twin pins dm-2 is unresolved; that 143 other rows agree is shown at this protocol only.
- **No browser proof of Next bundling** (`next-bundle-proof` NOT RUN).
- **The nested worktree was not built or tested**: it resolves into the main checkout's stale `dist`; every gate ran in a clone.

## 12. Owner commands (paste-ready)

Review the worktree diff first. The release-prep commit must be on `main` and pushed BEFORE any tag is pushed: the previous attempt tagged an older commit
and the tag-matches-version gate in `publish.yml` refused it. `publish.yml` has one concurrency group (`npm-publish`, `cancel-in-progress: false`): GitHub keeps
one running and one pending run and cancels older pending ones, so pushing several tags at once cancels all but the last, and a dependent run that starts
before npm shows its dependency fails its gate. Hence one block per package, and each waits for its own npm version before the next starts. Order: runtime-v0.4.1,
then chain-v0.1.7, then player-v0.2.5. **No compiler tag** (compiler 0.4.0 is already on npm and unchanged).

Step 0, commit on the branch, merge, push `main`, and confirm the tag target:

```
cd ~/projects/VesselDSP/core/release-0.4.1
git add -A
git commit -m "release prep: runtime 0.4.1 (Newton start predictor only at oversample > 1), chain 0.1.7, player 0.2.5; gate, tests, versions, pins, changelog, docs, release note"
git -C ~/projects/VesselDSP/core merge --ff-only indiejoseph/release-0.4.1
cd ~/projects/VesselDSP/core && git push origin main
git fetch origin && test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" && git log -1 --format='%h %s' && node -p "require('./packages/runtime/package.json').version"   # expect 0.4.1
```

Step 1, runtime. Tag, push, then poll npm until the version prints (npm lags a couple of minutes after `publish.yml` goes green; Ctrl-C if the run goes red):

```
cd ~/projects/VesselDSP/core && git tag runtime-v0.4.1 && git push origin runtime-v0.4.1 && until npm view @vessel-dsp/runtime@0.4.1 version 2>/dev/null; do sleep 30; done; npm view @vessel-dsp/runtime@0.4.1 version
```

Wait for publish.yml green and for this to print the version (`0.4.1`) before running the next block.

Step 2, chain (its gate refuses to publish while runtime 0.4.1 is missing from npm):

```
cd ~/projects/VesselDSP/core && git tag chain-v0.1.7 && git push origin chain-v0.1.7 && until npm view @vessel-dsp/chain@0.1.7 version 2>/dev/null; do sleep 30; done; npm view @vessel-dsp/chain@0.1.7 version
```

Wait for publish.yml green and for this to print the version (`0.1.7`) before running the next block.

Step 3, player (its gate needs chain 0.1.7 and runtime 0.4.1 on npm):

```
cd ~/projects/VesselDSP/core && git tag player-v0.2.5 && git push origin player-v0.2.5 && until npm view @vessel-dsp/player@0.2.5 version 2>/dev/null; do sleep 30; done; npm view @vessel-dsp/player@0.2.5 version
```

Wait for publish.yml green and for this to print the version (`0.2.5`) before running the check below.

Step 4, verify in an EMPTY directory (never inside core: stale nested `node_modules` there make `npm ls` exit `ELSPROBLEMS`):

```
d=$(mktemp -d) && cd "$d" && npm init -y >/dev/null && npm i @vessel-dsp/player@0.2.5 && npm ls --all
```

Expect exactly: `@vessel-dsp/player@0.2.5` with `@vessel-dsp/chain@0.1.7`, `@vessel-dsp/compiler@0.4.0`, `@vessel-dsp/runtime@0.4.1` (and `@vessel-dsp/core@0.16.0` beneath);
chain's own `compiler@0.4.0` and `runtime@0.4.1` deduped; no `invalid`/`extraneous`/`ELSPROBLEMS`. The runtime tarball carries CI's emsdk 3.1.74 wasm
(`37509d2f...`, section 4), not the 6.0.4 one.

Then, separately: the workbench's `release-pins-0.4.0` branch holds the 0.4.0 pins and its note's F1/F2 are what this fixes; re-pin it to
runtime 0.4.1 / compiler 0.4.0 and re-run the routed gates (expect finding 3 in section 10 on the parity gate).

## Scratch inventory (session scratchpad, not in the repo)

`base/` (clone of `2558e5b`, 0.4.0 wasm), `off/` (predictor forced off), `gate/` (this diff, 6.0.4), `ungate/` (gate removed again), `nopivot/` (re-pivot adoption
disabled), `spike1d9/` and `spike1d9p/` (the Newton-budget base `1d9b6f2` without and with its patch), `npm031/` (published 0.3.1 + 0.3.0), `verify/` and
`verify-3174/` (the fresh clone with the 6.0.4 and 3.1.74 binaries), `emsdk-3.1.74/`, `wasm-6.0.4/`, `wasm-3.1.74/`, `programs/`, `GeneratedKernels.regen.cpp`,
`release-prep-0.4.1.patch`, `dumps/` (renders, traces), `logs/` (every run quoted above, `logs/fc/` for the fresh-clone gate, `logs/f1/` for the final timelines), `tools/`
(driver scripts). The reusable instruments are in `docs/spikes/hotfix-0.4.1/` (README there).
