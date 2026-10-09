# Spike: the gated Newton start predictor ported to the C++/WASM console (2026-10-09)

Worktree `~/projects/VesselDSP/core/newton-iteration-budget`, branch
`indiejoseph/newton-iteration-budget` at `ee650f2` (core main `1aa0c56` + the applied TS
predictor). The diff is uncommitted; the wasm binary is gitignored and stays out. Harness
and raw logs: `docs/spikes/newton-predictor-wasm/` (`NN-*.log`; fresh-clone logs `clone-*.log`).

Exact commands (worktree root, bun 1.3.14, emsdk em++ via `~/projects/emsdk/emsdk_env.sh`):

```
bun run --cwd packages/runtime build:wasm                       # §1 baseline, §2 port (sha256 in 03-build-port.log)
bun docs/spikes/newton-predictor-wasm/baseline-render.ts --label=…   # §1/§3d/§3e renders and hashes
bun docs/spikes/newton-predictor-wasm/parity-os.ts --label=…         # §1/§3b workbench-method parity
bun docs/spikes/newton-predictor-wasm/decision-parity.ts --os=1,4    # §3a
docs/spikes/newton-predictor-wasm/break-control.sh                   # §3c (removes the gate, rebuilds, measures, restores, rebuilds)
bun docs/spikes/newton-predictor-wasm/cost-ab.ts --base=<dir holding the baseline v2_dsp.cjs> --repeats=5   # §5
bun test packages/runtime/tests/v2-wasm-newton-predictor.test.ts     # 4 tests, skip by name without src/wasm
```

## Outcome

`Engine::iterate` and `Engine::iterateEliminated` now seed a standard-pass solve of a
nonlinear block from the same self-selecting extrapolation the reference uses
(`ReferenceRuntime.newtonStartHistory`): a per-block ring of the last three converged
solutions, an order 0/1/2 chosen after every converged solve by scoring the three candidate
starts against the solution in tolerance units (strict `<`, ties keep the lower order,
`used > 2` forces 0), the chain broken on non-convergence, the ring cleared in `prepare()`
and `reset()`, the fold reseed still reading `start`. **The decision is bit-parity with the
reference**: on the six packets at x1 and os4, 4 800 host samples each, the chosen order per
block and the number of seeded solves agree on **every sample of every row** (§3a).
Output parity moves from the pre-port divergence (muff 9.6e-8, ts808 2.4e-6, blue-box x1
7.0e-7) back to **muff 5.0e-9 / ts808 1.8e-8 / gro100 7.4e-9**, inside the 1e-12..1e-6
class of the earlier port reports, with sd1/ts9 unchanged at their pre-existing libm
offsets (7.7e-6 / 2.7e-5) and blue-box unchanged (its x1 figure and its os2 marginal FAIL
are the chaotic-trajectory lottery the latency port report already adjudicated).
Iteration totals per host sample agree to the sample on 8 of 12 rows; on sd1 os4 and
gro100 os4 one solve in ~1000 lands on the convergence knife edge and the two consoles'
libm-level stamps decide it differently (4–5 samples per 4 800, ±1 iteration, order and
seeds unaffected) — the pre-predictor consoles already disagree the same way on 6 of 4 800
gro100 samples at x1 (§3a, control). Three counters are exported
(`predictor seeds`, `one-iteration solves`, `total iterations`) with
`V2WasmEngine.getPredictorTelemetry()` / `getPredictorOrder(blockIdx)`. Recommendation:
**ADOPT**.

## 1. Baseline FIRST (branch unchanged, before any C++ edit)

Build, from the runtime package (the root has no `build:wasm` script):

```
source ~/projects/emsdk/emsdk_env.sh
bun run --cwd packages/runtime build:wasm     # bash scripts/build-wasm.sh: em++ -O3 -msimd128 -std=c++17 -fwasm-exceptions
```

- `src/wasm/v2_dsp.wasm`: `1b98ea796085ebad24d4fce0683b09f2d8be7c4a958190a8bcde05490b1ac6c8`
- `src/wasm/v2_dsp.cjs`:  `63fd0d0d0edef9b2c315dd9cdb8811598a91b227f868b636cd9839244594fe53`

(`01-baseline-render.log`) 1 kHz 10 mV, 1 s at 48 kHz, cap 1024, study controls after
prepare, 512-frame `processBlock`, sha256 over the raw float32 output; TS beside it:

| pedal | os | baseline WASM sha256 | TS (predictor on) sha256 | TS it/host |
|---|---|---|---|---|
| muff | 1 | `3ad1d88d16cb8b33…c231d1ad` | `89aaa8d7788fa249…6cfc16b4` | 2.833 |
| muff | 4 | `c29814a27c46465a…8cd22ed525` | `b3fd0070a3180dd2…aeebeed8625` | 5.625 |
| sd1 | 1 | `59f86113c62a704f…1c49c072d` | `2810d7d4a5269817…4edd227059a7a` | 2.354 |
| sd1 | 4 | `0f3da34092c9462a…fabdd1e939aa` | `456a1fd370cf13a7…2bc857982db2` | 4.585 |
| ts9 | 1 | `c1a4c043ae0f9ae6…e96dc04fd24a92` | `35a1ed9575311d37…7adff284d9b3` | 1.708 |
| ts9 | 4 | `a9547177836e01e5…56b82bba71ea7` | `5b758de8c514cc85…9606c4f64caf4` | 4.043 |
| resistor divider (linear only) | 1 | `2532e45838c2ca6f…78e994209f56` | — | — |
| rc low-pass (linear only) | 1 | `5aeec084333528ae…275fa2f223cf6323` | — | — |

Full hashes in the log. Pre-port parity, TS (predictor on) vs baseline WASM (predictor
absent), the workbench method (`02-parity-pre-port.log`; 440 Hz @0.25 + 1320 Hz @0.1, cap
1024, settle 100 / window 2048, bars r ≥ 0.9999 and maxDelta < 1e-4):

| packet | x1 | os2 | os4 | os8 | pre-predictor class (latency port report §3) |
|---|---|---|---|---|---|
| muff | **9.6e-8** | 1.6e-8 | 2.4e-8 | 2.4e-8 | 3.6e-12..7.5e-12 |
| sd1 | 7.7e-6 | 7.8e-6 | 7.8e-6 | 7.8e-6 | 7.7e-6 (libm offset, unchanged) |
| ts9 | 2.7e-5 | 2.7e-5 | 2.7e-5 | 2.7e-5 | 2.7e-5 (libm offset, unchanged) |
| ts808 | **2.4e-6** | 8.2e-7 | 2.4e-7 | 1.5e-7 | 5.6e-10..5.0e-9 |
| gro100 | 7.4e-9 | 7.4e-9 | 7.4e-9 | 7.4e-9 | 1.9e-11..3.8e-11 |
| blue-box | **7.0e-7** | 1.043e-4 FAIL | 9.3e-10 | 9.3e-10 | 4.1e-15 / 1.012e-4 FAIL / 2.9e-15 / 1.0e-15 |

All rows r = 1.000000; every row PASS except blue-box os2 (the pre-existing marginal
FAIL). This is the divergence the port closes: the TS loop takes a predicted first iterate,
the C++ console the previous solution, and the two accepted iterates differ inside the
tolerance band.

## 2. The port (diff: `Engine.h`, `Engine.cpp`, `V2Exports.cpp`, `scripts/build-wasm.sh`, `v2-wasm-engine.ts`, new `tests/v2-wasm-newton-predictor.test.ts`)

- `BlockScratch` gains `predictorX1/X2/X3` (the ring, newest first), `predictorCandidate`
  (reused scratch), `predictorChain`, `predictorOrder`.
- `Engine::predictedNewtonStart(scratch, size)` returns the candidate (order > 0, chain long
  enough) or `nullptr`; `extrapolateNewtonStart` writes `x1`, `2.0*x1 - x2`, or
  `3.0*x1 - 3.0*x2 + x3` in the reference's operand order (wasm has no FMA: `-msimd128`
  only, so the doubles agree bit for bit).
- `Engine::recordNewtonSolution(scratch, solution, size, converged, used)`: on
  non-convergence `chain = 0, order = 0`; else one fused pass computing `error0/1/2` (the
  tolerance-unit max over unknowns, `HUGE_VAL` for orders the chain cannot form), `best`
  by strict `<` with ties to the lower order, `used > 2 → 0`, the ring rotated by two
  `std::swap`s (the reference's "oldest buffer receives the newest"), chain += 1.
- Both loops: `predictorPass = !dc && sourceScale == 1.0 && gmin == GMIN_SIEMENS &&
  !block.linear` (the reference's predicate); the seed replaces `start` only in the
  `solutionA` / `yCurrent` fill; the fold reseed keeps reading `start`; `recordNewtonSolution`
  runs after the loop on the returned iterate (`current`).
- `prepare()` clears ring and counters per block (`resize` keeps old scratch objects, so an
  explicit clear); `reset()` clears the ring and counters.
- Counters: `predictorSeeds_`, `oneIterationSolves_` (standard-pass solves with
  `used == 1`), `totalIterations_` (every block solve, the reference's
  `telemetry().totalIterations`). Exports `v2_engine_get_predictor_seeds`,
  `v2_engine_get_one_iteration_solves`, `v2_engine_get_total_iterations` (doubles, like
  the schedule counters), `v2_engine_get_predictor_order(handle, blockIdx)` (int32, −1 for
  a bad index); wrapper `getPredictorTelemetry()` and `getPredictorOrder()`.

Rebuilt with the identical command (`03-build-port.log`):

- `src/wasm/v2_dsp.wasm`: `aef38274384e36db5433963f6893a1f32045daf8685f7d10df9aeba0c01adf02`
- `src/wasm/v2_dsp.cjs`:  `af9897c81b08fb6f7546ca7f72acf8b83c21449a3cf2f68428148b815159a567`

## 3. Controls, both directions

### (a) Decision parity (`decision-parity.ts`, `06-decision-parity.log`)

The reference is instrumented in-process by wrapping its private `predictedNewtonStart`
(non-null = a seed) and `recordNewtonSolution` (`used === 1` = a one-iteration solve) and
reading `newtonStartHistory.order` per block after every one-sample `process`; the WASM
side reads its counters and `getPredictorOrder`. 1 kHz @ 0.1 V, 4 800 host samples, cap
1024; per sample the order per block and the per-sample delta of each counter are compared:

| packet | os | seeds TS / WASM | one-iteration TS / WASM | iterations TS / WASM | samples whose order / seeds / one-it / iterations differ | verdict |
|---|---|---|---|---|---|---|
| muff | 1 | 21 / 21 | 6 / 6 | 17 149 / 17 149 | 0 / 0 / 0 / 0 | EXACT |
| muff | 4 | 18 195 / 18 195 | 12 906 / 12 906 | 26 869 / 26 869 | 0 / 0 / 0 / 0 | EXACT |
| sd1 | 1 | 3 167 / 3 167 | 500 / 500 | 13 041 / 13 041 | 0 / 0 / 0 / 0 | EXACT |
| sd1 | 4 | 17 884 / 17 884 | 14 526 / 14 527 | 25 683 / 25 682 | 0 / 0 / **5** / **5** (first: sample 614, one-iteration solves 4 vs 3) | decision EXACT, 5 knife-edge solves |
| ts9 | 1 | 3 194 / 3 194 | 7 / 7 | 12 003 / 12 003 | 0 / 0 / 0 / 0 | EXACT |
| ts9 | 4 | 19 185 / 19 185 | 16 050 / 16 050 | 22 352 / 22 352 | 0 / 0 / 0 / 0 | EXACT |
| ts808 | 1 | 1 799 / 1 799 | 0 / 0 | 13 405 / 13 405 | 0 / 0 / 0 / 0 | EXACT |
| ts808 | 4 | 19 185 / 19 185 | 15 975 / 15 975 | 22 427 / 22 427 | 0 / 0 / 0 / 0 | EXACT |
| gro100 | 1 | 4 338 / 4 338 | 894 / 894 | 9 656 / 9 656 | 0 / 0 / 0 / 0 | EXACT |
| gro100 | 4 | 18 613 / 18 613 | 16 655 / 16 655 | 22 675 / 22 675 | 0 / 0 / **4** / **4** (first: sample 2, 1 vs 0) | decision EXACT, 4 knife-edge solves |
| blue-box | 1 | 2 / 2 | 0 / 0 | 40 236 / 40 702 | 0 / 0 / 0 / **24** (first: sample 1, 391 vs 695) | decision EXACT; chaotic iteration counts |
| blue-box | 4 | 290 / 290 | 1 / 1 | 70 913 / 70 900 | 0 / 0 / 0 / **4** (first: sample 1154, 54 vs 55) | decision EXACT; chaotic |

The predictor's own decision — order and seed — is identical on 12 of 12 rows and 57 600
host samples. The eight pedal/x1 rows also agree on every iteration count. The residual
is the solve, not the predictor: the pre-port consoles (TS at `1aa0c56`, baseline wasm;
`06b-iter-parity-pre-predictor.log`, same stimulus, x1) **already** spend a different
number of iterations on 6 of 4 800 gro100 samples (first at 1108: TS 2, WASM 3) and 134
of 4 800 blue-box samples (sample 1: 391 vs 695), with 0 on muff/sd1/ts9/ts808 — the
libm-level stamp differences (sd1's 7.7e-6 and ts9's 2.7e-5 offsets) deciding a
convergence test that sits on its tolerance edge. The predicted first iterate makes such
edges slightly more common at os4 (a one-iteration solve is by construction a step whose
delta is just under the allowance). The iteration totals over 4 800 samples differ by 1
on both affected rows.

### (b) Output parity after the port (`05-parity-post-port.log`, same harness as §1)

| packet | x1 | os2 | os4 | os8 | pre-port (§1) | pre-predictor class |
|---|---|---|---|---|---|---|
| muff | **5.0e-9** | 4.4e-9 | 4.2e-9 | 3.4e-9 | 9.6e-8 / 1.6e-8 / 2.4e-8 / 2.4e-8 | 3.6e-12..7.5e-12 |
| sd1 | 7.7e-6 | 7.7e-6 | 7.7e-6 | 7.8e-6 | 7.7e-6 | 7.7e-6 |
| ts9 | 2.7e-5 | 2.7e-5 | 2.7e-5 | 2.7e-5 | 2.7e-5 | 2.7e-5 |
| ts808 | **1.8e-8** | 1.4e-8 | 1.9e-8 | 1.5e-8 | 2.4e-6 / 8.2e-7 / 2.4e-7 / 1.5e-7 | 5.6e-10..5.0e-9 |
| gro100 | 7.4e-9 | 7.4e-9 | 7.4e-9 | 7.4e-9 | 7.4e-9 | 1.9e-11..3.8e-11 |
| blue-box | 7.0e-7 | 1.043e-4 FAIL | 9.3e-10 | 9.3e-10 | same | 4.1e-15 / 1.012e-4 FAIL / … |

r = 1.000000 on every row; 23 of 24 PASS; blue-box os2 the pre-existing marginal FAIL
(1.043e-4 vs 1.012e-4 in the latency port report, same mechanism, deterministic). muff
improves 19× at x1 and ts808 130×; both are now inside the 1e-12..1e-6 class but not back
to their pre-predictor digits: the accepted iterate of a one-iteration solve sits at the
tolerance edge, so the consoles' libm-level stamp differences (which were below the
earlier 2-iteration solves' quadratic floor) now show at the 1e-9..1e-8 level. gro100 and
blue-box x1 are unchanged by the port (7.4e-9 / 7.0e-7 before and after): gro100's
decision parity is exact and its residual is the §3a knife-edge class; blue-box is chaotic
from sample 1 on both consoles.

### (c) The check can fail (`break-control.sh`, `08-*.log`)

The `used > 2` gate was removed from `Engine::recordNewtonSolution` (`if (false)`), the
console rebuilt (`4623b928bddc1f51…`), and the same checks run:

| packet | os | decision parity, broken (order / seed / one-it / iteration samples differing of 2 400) | output maxDelta broken vs ported | WASM peak broken vs TS |
|---|---|---|---|---|
| muff | 1 | **1965 / 1964** / 0 / 1233 (first: sample 3, TS order 0, WASM 2) | 8.2e-8 vs 5.0e-9 | 12 / 12 |
| muff | 4 | 94 / 222 / 3 / 167 | 1.7e-8 vs 4.2e-9 | 7 / 6 |
| sd1 | 1 | 780 / 779 / 0 / 578 | 7.7e-6 (libm floor) | 27 / 26 |
| sd1 | 4 | 200 / 201 / 3 / 203 | 7.7e-6 | 7 / 6 |
| ts808 | 1 | 1499 / 1498 / 0 / 1249 | 1.3e-6 vs 1.8e-8 | 10 / 8 |
| ts808 | 4 | 0 / 1 / 0 / 0 | 2.2e-7 vs 1.9e-8 | 4 / 4 |
| gro100 | 1 | 212 / 212 / 24 / 227 | 7.4e-9 | 30 / 26 |
| gro100 | 4 | 166 / 190 / 207 / 284 | 7.4e-9 | 18 / 11 |

The decision diverges on the first samples where the gate decides (muff x1 on 82 % of
samples), the output delta grows 10–70× where the audio path is sensitive, and the WASM
peaks leave the TS peaks. The gate restored (source sha `8bd0e300…` before and after),
the rebuild returns **exactly** the recorded port hashes (`aef38274…` / `af9897c8…`): the
demonstration left nothing in the tree.

### (d) The port adds nothing where the predictor never fires

Linear-only fixtures at x1 (`04-port-render.log` vs `01-baseline-render.log`): the resistor
divider renders `2532e45838c2ca6f…` and the RC low-pass `5aeec084333528ae…` on **both**
binaries — byte-identical. On a linear block `predictorPass` is false by construction (no
seed, no record; the new test pins `seedsUsed === 0` on the divider). The DC pass is the
`dc` branch of the same predicate. The pre-predictor consoles (TS at `1aa0c56` vs the
baseline wasm) are the reference for "nothing changed": per-sample iteration counts equal
on muff/sd1/ts9/ts808 x1 and the pre-existing gro100/blue-box knife edges (§3a).

### (e) `reset()` / `prepare()` clear the ring

`04-port-render.log`: muff x1 and os4 render → reset → render hash-equal
(`e9ba0cc10cd16403` / `3c4385ed7726c344` both times); the in-repo test pins the same for the
RC-plus-diode fixture at 1 and 4 after `reset()` and after a second `prepare()`, with
`seedsUsed` back to 0 and `getPredictorOrder(0)` back to 0. ts9 renders differently after
`reset()` + re-applied study controls **on the baseline binary too** (`01-baseline-render.log`:
`c1a4c043…` vs `290b0bac…`), so that is a pre-existing ts9 reset property, not the ring
(muff, same procedure, is equal on both binaries). Not investigated further here; flagged.

## 4. Acceptance, per check

| check | result | number |
|---|---|---|
| (a) decision parity exact on the counters and iteration totals | **PASS on the decision, partial on iteration totals** | order and seeds: 0 differing samples on 12 of 12 rows (57 600 host samples); one-iteration / total-iteration counts: exact on 8 rows, 4–5 knife-edge samples (±1 iteration) on sd1 os4 and gro100 os4, 24 / 4 chaotic samples on blue-box — the same class the pre-predictor consoles already show (gro100 x1 6 / 4 800, blue-box 134 / 4 800) |
| (b) output parity within bars at x1/os2/os4/os8, pedal max abs delta back to the pre-predictor class | **PASS** (23 of 24 rows; blue-box os2 the pre-existing marginal FAIL) | muff 9.6e-8 → **5.0e-9**, ts808 2.4e-6 → **1.8e-8**, gro100 7.4e-9 → 7.4e-9, sd1 7.7e-6 / ts9 2.7e-5 (libm offsets, unchanged), blue-box x1 7.0e-7 → 7.0e-7; all inside 1e-12..1e-6; not back to muff's 3.6e-12 digits (§3b explains: one-iteration solves accept at the tolerance edge) |
| (c) the check can fail | **PASS (demonstrated and reverted)** | gate removed: order decisions differ on up to 82 % of samples, output delta ×16 (muff x1) / ×70 (ts808 x1), WASM peaks off the TS peaks; restored build hash == recorded port hash |
| (d) adds nothing where the predictor never fires | **PASS** | linear-only fixtures byte-identical on both binaries (`2532e458…`, `5aeec084…`); linear blocks and the DC pass excluded by the predicate; in-repo test pins 0 seeds on the divider |
| (e) reset()/prepare() clear the ring | **PASS** | muff x1/os4 render→reset→render equal on the port; in-repo test: reset and re-prepare renders `toEqual` the first at 1 and 4, `seedsUsed` 0 and order 0 after each. (ts9's reset difference is pre-existing on the baseline binary.) |
| in-repo tests | PASS | `v2-wasm-newton-predictor.test.ts` 4/4; `public-surface`, `v2-wasm-oversample`, `sparse-pivot-cross-console` unchanged and green (`07-tests-port.log`: 34 pass / 0 fail across the four files) |

## 5. Cost (reported, not a gate; `cost-ab.ts`, `09b-cost-idle.log`; replicate `09-cost.log`)

Both Emscripten modules loaded in one process from their own paths (`V2WasmEngine.create(program, mod)`),
**A = baseline binary `1b98ea79…`, B = port `aef38274…`, interleaved A/B/A/B per repeat, median of 5**;
1 kHz 10 mV, 1 s at 48 kHz, cap 1024, 512-frame `processBlock`, study controls; ns per host
sample in-process (not the worklet); budget 20 833 ns = 1.0 xRT. Load: **1.39** (1-min) at the
start of this run, 2.37 at its end (the run itself plus root-owned Chrome/ffmpeg processes
that are not mine; the earlier replicate started at 2.23 and agrees within 2 % on every
row). Iterations per host sample are B's own counter (A has none; the pre-predictor TS
count at the same settings is the A column's figure where the §3a probe showed the
consoles equal — the pedals).

| packet | os | A ns (xRT) | B ns (xRT) | B/A | B it/host | B one-iteration solves/host | B seeds/host | peak A/B | under 20.8 µs |
|---|---|---|---|---|---|---|---|---|---|
| muff | 1 | 8 314 (0.40) | 8 246 (0.40) | 0.99 | 2.833 | 0.000 | 0.459 | 6/6 | A, B |
| sd1 | 1 | 15 495 (0.74) | 13 766 (0.66) | 0.89 | 2.354 | 0.062 | 0.646 | 4/4 | A, B |
| ts9 | 1 | 5 223 (0.25) | 4 742 (0.23) | 0.91 | 1.708 | 0.292 | 1.000 | 3/2 | A, B |
| ts808 | 1 | 5 573 (0.27) | 4 641 (0.22) | 0.83 | 1.834 | 0.166 | 1.000 | 3/2 | A, B |
| gro100 | 1 | 88 970 (4.27) | 81 233 (3.90) | 0.91 | 6.894 | 0.131 | 0.678 | 1024/1024 | — |
| blue-box | 1 | 5 056 (0.24) | 5 053 (0.24) | 1.00 | 3.903 | 0.000 | 0.062 | 1024/1024 | A, B |
| muff | 2 | 14 448 (0.69) | 12 006 (0.58) | 0.83 | 3.708 | 0.459 | 1.875 | 4/4 | A, B |
| sd1 | 2 | 27 597 (1.32) | 21 823 (1.05) | 0.79 | 3.625 | 0.375 | 2.000 | 3/3 | — |
| ts9 | 2 | 10 158 (0.49) | 9 814 (0.47) | 0.97 | 3.458 | 0.541 | 2.000 | 2/2 | A, B |
| ts808 | 2 | 10 090 (0.48) | 9 166 (0.44) | 0.91 | 3.459 | 0.541 | 2.000 | 3/2 | A, B |
| gro100 | 2 | 131 006 (6.29) | 115 948 (5.57) | 0.89 | 8.816 | 0.329 | 1.638 | 1024/1024 | — |
| blue-box | 2 | 9 190 (0.44) | 9 432 (0.45) | 1.03 | 7.583 | 0.021 | 0.250 | 44/42 | A, B |
| muff | 4 | 27 202 (1.31) | **20 234 (0.97)** | 0.74 | 5.625 | 2.375 | 4.000 | 3/2 | **B only** |
| sd1 | 4 | 49 638 (2.38) | 29 243 (1.40) | 0.59 | 4.585 | 3.415 | 4.000 | 3/2 | — |
| ts9 | 4 | 20 817 (1.00) | 13 245 (0.64) | 0.64 | 4.043 | 3.957 | 4.000 | 2/2 | A (at the line), B |
| ts808 | 4 | 19 267 (0.92) | 12 180 (0.58) | 0.63 | 4.044 | 3.956 | 4.000 | 3/2 | A, B |
| gro100 | 4 | 185 712 (8.91) | 144 403 (6.93) | 0.78 | 9.880 | 2.495 | 3.626 | 1024/1024 | — |
| blue-box | 4 | 15 646 (0.75) | 16 203 (0.78) | 1.04 | 12.190 | 0.480 | 1.084 | 50/140 | A, B |
| muff | 8 | 50 584 (2.43) | 36 862 (1.77) | 0.73 | 9.579 | 6.421 | 8.000 | 3/2 | — |
| sd1 | 8 | 92 868 (4.46) | 52 120 (2.50) | 0.56 | 8.001 | 7.999 | 8.000 | 3/2 | — |
| ts9 | 8 | 41 333 (1.98) | 26 378 (1.27) | 0.64 | 8.001 | 7.999 | 8.000 | 2/2 | — |
| ts808 | 8 | 37 973 (1.82) | 24 548 (1.18) | 0.65 | 8.002 | 7.998 | 7.999 | 2/2 | — |
| gro100 | 8 | 303 995 (14.59) | 207 061 (9.94) | 0.68 | 12.741 | 6.562 | 7.587 | 1024/1024 | — |
| blue-box | 8 | 24 944 (1.20) | 23 589 (1.13) | 0.95 | 16.119 | 2.771 | 5.666 | 103/53 | — |

Under the 20.8 µs in-process budget after the port: x1 — muff, sd1, ts9, ts808, blue-box;
os2 — muff, ts9, ts808, blue-box (sd1 1.05, just over); os4 — **muff (newly, 0.97)**, ts9,
ts808, blue-box; os8 — none (ts808 1.18, ts9 1.27 the nearest). gro100 is over at every
factor (3.9 → 9.9 xRT). The saving tracks the one-iteration share: at os4 the pedals solve
3.4–4.0 of 4 sub-samples in one iteration and run at 0.59–0.74 of the baseline time; at os8
0.56–0.65; at x1 0.83–0.99; blue-box, which never predicts (0.06 seeds/host at x1), pays
0–4 % for the scoring. These are in-process TS-driven ratios on a shared box, the basis
the tier table asked for only to the extent the load readings allow.

## 6. Fresh clone (`git clone --branch indiejoseph/newton-iteration-budget … /tmp/npw-verify` at `ee650f2`, `git apply` of this diff; logs `docs/spikes/newton-predictor-wasm/clone-*.log`)

| step | result |
|---|---|
| `git apply` | exit 0; 5 modified files + the new test, nothing else |
| `bun install --frozen-lockfile` | 411 packages, exit 0 |
| `bun run typecheck` | 0 errors |
| `bun test` (no wasm) | 1953 pass / 6 fail: the 5 missing-wasm-console failures (`delay-tap-reverse`, declared-program pin, `hold-loop`, tap law, controller latch — all "agrees between the two consoles") plus `release metadata > pins the current package release and changelog entry` in `tests/package.test.ts`, which **fails identically on the pre-predictor base `1aa0c56`** (run there: 23 pass / 1 fail) — pre-existing, not this diff |
| `bun run --cwd packages/runtime build:wasm` | exit 0; `v2_dsp.wasm aef38274…adf02`, `v2_dsp.cjs af9897c8…9a567` — **the worktree's port hashes, byte for byte** |
| `bun run build` | exit 0 |
| `bun test` (wasm present) | **1994 pass / 0 fail**, 142 files, WASM tests RUN (the 5 console-parity tests above pass, the 4 new predictor tests pass); `release metadata` passes once `dist/` exists. An earlier run with the test's first form read 1993 / 1: that form fed the reference float64 input while the console got float32, and 36 near-tie order scores on the symmetric clipper flipped — a harness property (both consoles now see the float32-rounded value, §3a), fixed in the test before this final run. |
| `bun run build:pages` | exit 0 (sitemap written) |

A first clone run accidentally carried the control-(c) build (patch exported while the
gate was removed): its wasm hashed `4623b928…`, the broken-gate hash of §3c, and its two
predictor tests failed — the control firing where it was not meant to, kept here as one
more demonstration that the tests see the gate. Re-exported from the restored source
(Engine.cpp `8bd0e300…`), the clone reproduces the port hash.

## 7. What this cannot prove

- Decision parity is proven on identical inputs: six packets × two factors × 4 800 host
  samples at one stimulus, plus the synthetic fixtures; a packet whose two consoles already
  differ in a solve's iteration count (gro100 and blue-box do, before the predictor) can
  differ in the predictor's gate on that sample, and a near-tied order score can flip on a
  float32-vs-float64 input — the port cannot make two consoles agree on a decision whose
  inputs they do not share.
- Output parity is the workbench short window (settle 100 / 2048) at the usual two-tone
  and the six packets; long-window gro100 (the known cap-storm lottery) was not re-run.
  Agreement proves the console reproduces the reference, not circuit truth.
- Cost is TS-driven in-process WASM on a dev box with other users' processes (load
  readings printed with every table); it is a ratio table, not a worklet budget.
- `prepare()`/`reset()` clearing is pinned on the RC-plus-diode fixture and muff; ts9's
  reset difference is pre-existing on the baseline binary and was not investigated.
- Nothing here touches the TS predictor, tolerances, laws, limiting, relaxation, the
  resampler or the pivot code; the worklet bundle (`build-worklet`) picks the new exports up
  from `EXPORTED_FUNCTIONS` and was built by `bun run build` but not exercised in a browser.
