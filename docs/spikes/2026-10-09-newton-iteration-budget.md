# Newton iteration budget — 2026-10-09

Worktree `~/projects/VesselDSP/core/newton-iteration-budget`, branch
`indiejoseph/newton-iteration-budget` off core main `1d9b6f2`. Scratch harness under
`docs/spikes/newton-budget/` (raw logs and jsonl in `docs/spikes/newton-budget/out/`). **The
shipped runtime in this worktree is unchanged.** The runtime change this report recommends
is supplied as a ready patch with tests (`docs/spikes/newton-budget/runtime-start-predictor.patch`,
applies cleanly to this branch, verified in a fresh clone — §9) but is **not applied**, because
it does not meet the owner's acceptance criteria as written: the "output within 1e-9 of dense"
bar is structurally unmeetable by any iteration-saving method (§7), and three other bars are
missed by small margins. Whether those bars stand is the owner's call; the evidence for both
answers is here.

**One-line outcome.** Of the known methods, only the *predictor initial guess* (M1) buys
anything, and only one form of it is safe: a **self-selecting (order 0/1/2) extrapolation of
the last three converged solutions, used only after a solve that took ≤ 2 iterations**. At
os4 it converges in one iteration on 69–88 % of sub-samples and cuts iterations (= assemblies
= factorisations = convergence checks) per host sample **39–47 % on muff/sd1/ts9/ts808 and
44 % on gro100**, which is **−28 % to −44 % wall time** TS in-process (blue-box −1 %, +7 %
wall); at os2 −26..−35 %; at x1 0..−11 % on the six and −2.9 % / −10.1 % across the 122-pedal
/ 23-amp corpus with no packet more than +2.2 %. Every converged pedal solution sits within
0.012 tolerance units of the full-Newton solution from the same state; output agreement with
dense is 2e-10..4.5e-6 (shipped 1e-12..7e-8), and gro100's stays inside 1e-9. It adds a
handful of non-converged samples on three cap-storm packets (mt-2 +4, phase-90-early-block
+1, hiwatt +1, blue-box os4 +2) and ~3–7 % bookkeeping where it buys nothing (blue-box,
muff x1). Chord/Shamanskii (M2) and Broyden (M3) factorisation reuse are **inadmissible**:
linear convergence makes the shipped delta test accept iterates up to 10 tolerance units
from the root (proven on a scalar problem, §5c), they cost *more* iterations on every packet,
and across sub-samples they can latch a trajectory into a wrong self-consistent state that
every per-sub-sample check passes (sd1 at x1, output 100 % wrong). M4 inherits M2's
defects. The storm census (§6) classifies gro100's cap-hitting samples as **genuine
non-convergence of the EL34 push-pull output stage + global NFB loop (class b, 99.7 % of the
storm work; full dense Newton from the same state fails on 99.7 % of them too)**, not
limiting events a predictor or sub-step would catch — the next task there is
globalisation, not event sub-stepping; blue-box's cap-64 storm is the cap's own artifact
(none at cap 1024).

## 0. Harness (applies to every figure unless a caption says otherwise)

In-process `ReferenceRuntime` (TypeScript, bun 1.3.14), 48 kHz host, 1 kHz sine at 0.1 V,
Newton cap 64 (the profiles' cap; the shipping default is 1024), **2400 warmup + 9600
measured host samples** (the pivot report's window), default controls except the three
study pedals (muff SUSTAIN/TONE/VOLUME = 0.5/0.5/0.3; sd1 and ts9 Drive/Tone/Level =
0.5/0.5/0.3, as the oversampling report §7). `osN` = `prepare(48000, { oversample: N })`
(band-limited path). Counters cover every standard-audio-pass solve of every nonlinear
block in the measured window; "per host sample" divides by 9600. Dense reference: the
shipped loop with every block's `sparseSchedule` nulled (the pivot report's method; for the
two eliminated packets, muff and gro100, that is the same Schur-complement loop, so their
shipped-vs-dense reads 0.0). **Fixed-point twin**: inside the scratch loop, on every
standard sub-sample, a dense full-Newton solve of the *unreduced* system (`iterate`'s path,
no schedule, no elimination) is run from the same state (limiter histories, probation,
schedule state, scratch flags snapshotted and restored) and its solution compared with the
method's per unknown in **tolerance units** `|dx| / (1e-3·max|x| + 1e-6)` — ≤ 1 is "within
the convergence tolerances". Both checks are needed: the twin cannot see a trajectory that
derailed earlier (§4, sd1 M2-across), the output comparison cannot localise a sub-sample.

Six profile packets: muff (`big-muff-ec3003-rev-f`, n=36, **eliminated** block), sd1
(`boss-sd-1.at-9v17`, n=51+4), ts9 (`ibanez-ts9-reissue`, n=51), ts808 (n=46), gro100 (n=88,
**eliminated**, plus a linear n=4 block), blue-box (n=34). Timing is a dev-box ratio (12
cores, other jobs running during the counting sweeps; the dedicated timing run in §8 was
taken alone).

Scratch loop: `docs/spikes/newton-budget/scratch-newton.ts` replaces
`ReferenceRuntime.prototype.iterate` / `.iterateEliminated` with statement-for-statement
copies of the shipped bodies (1d9b6f2, `iterate` ~4742, `iterateEliminated` ~5328) carrying
the three methods behind flags and the counters; control (e) hashes it against the shipped
loop. Tolerances, device laws, limiting, relaxation constants, integrator and resampler are
the shipped values, copied verbatim and unchanged.

## 1. Baseline FIRST (read-only, this checkout, copied instruments)

`baseline-histogram.ts` = `workbench/scripts/report-newton-deadline.ts`'s method (960
warmup + 960 steady, one-sample `process`, per-host iteration deltas):

| packet | cap | os | steady mean it/host (per sub) | peak | cap-hit samples | histogram (steady) | known (workbench 2026-09-17, WASM) |
|---|---|---|---|---|---|---|---|
| gro100 | 64 | 1 | 2.20 | 26 | 0 | 2:852, 3:82, 4:11, 5:6, 6:2, 7:2, 8:2, 9:1, 11:1, 26:1 | 2.20 / 26 / **identical histogram** |
| blue-box | 64 | 1 | 6.94 | 64 | 35 (3.6 %, 33.6 % of iterations) | 2:4, 3:389, 4:469, … 64:35 | 64.00 (64:960) on WASM; TS at this settle converges most samples — see the 2400+9600 row below, which dooms |
| ts808 | 64 | 1 | 2.92 | 7 | 0 | 2:280, 3:560, 4:80, 6:40 | 2.92 / 5 (2:240, 3:600, 4:80, 5:40) — mean exact, histogram within one bin |
| gro100 | 1024 | 1 | 2.20 | 26 | 0 | same as cap 64 | — |
| blue-box | 1024 | 1 | 8.56 | 1024 | 1 | 3:440, 4:468, … 1024:1 | oversampling report §7: peak 1024, NC 1 |
| gro100 / blue-box / ts808 / muff / sd1 / ts9 | 64 | 4 | 2.06 / 3.84 / 2.20 / 2.28 / 2.23 / 2.09 per sub | 11 / 64 / 3 / 5 / 5 / 3 | 0 / 10 / 0 / 0 / 0 / 0 | — | oversampling §7 (1 s, cap 1024, 10 mV): 3.26 / 3.19 / 2.03 / 2.35 / 2.16 / 2.00 — same ordering, different window/level |

`sparse-vs-dense.ts` = `docs/spikes/sparse-pivot/sparse-vs-dense.ts` with `--os` and the
study controls (2400+9600, cap 64):

| packet | os | sparse vs dense relRMS | sNC / dNC | warm NC s/d | peak s/d | mean it/host s/d | known (pivot report §1 / oversampling §5) |
|---|---|---|---|---|---|---|---|
| muff | 1 | 0.0 | 0/0 | 0/0 | 10/10 | 3.56/3.56 | eliminated: dense == sparse by construction |
| sd1 | 1 | 7.1e-8 | 0/0 | 0/0 | 13/13 | 3.04/3.04 | 6.8e-8 (os-report §5, "TS kept") |
| ts9 | 1 | 4.6e-9 | 0/0 | 0/0 | 7/7 | 2.63/2.63 | "quiet fry 1e-9..3e-8" |
| ts808 | 1 | 7.1e-10 | 0/0 | 0/0 | 7/7 | 2.92/2.92 | — |
| gro100 | 1 | 0.0 | 0/0 | 0/0 | 35/35 | 2.20/2.20 | eliminated |
| blue-box | 1 | **1.5e+0** | **9600/185** | 490/75 | 64/64 | **64.00/6.09** | pivot §1: 1.5e+0, 9600/197, 490/75, 64.0 vs 6.1 — **reproduced** |
| muff | 4 | 0.0 | 0/0 | 0/0 | 5/5 | 9.06 (2.27/sub) | — |
| sd1 | 4 | 1.7e-8 | 0/0 | 0/0 | 5/5 | 8.94 (2.23/sub) | os-report §5 os4: 5.1e-12 after re-pivot on default controls; study controls here |
| ts9 | 4 | 1.0e-8 | 0/0 | 0/0 | 3/3 | 8.38 (2.09/sub) | — |
| ts808 | 4 | 1.9e-9 | 0/0 | 0/0 | 3/3 | 8.79 (2.20/sub) | — |
| gro100 | 4 | 0.0 | 0/0 | 0/0 | 16/16 | 8.22 (2.05/sub) | — |
| blue-box | 4 | 2.2e-4 | 0/0 | 4/8 | 64/64 | 14.83 (3.71/sub) | oversampling stabilises blue-box (os-report §7) — reproduced |

The known numbers reproduce: gro100's histogram to the bin, blue-box's bistability (sparse
rides the cap at 64.0, dense converges in 6.1), ts808 2.92, mean iterations per sub-sample
falling with rate (muff 3.56 → 2.27, ts808 2.92 → 2.20), and the 3 s-settled gro100 regime
(§6: 12.6 % of the settle window non-converged, mean 11.46, against the known 14.3 % / 12.2).

## 2. Methods as implemented (scratch loop)

- **M1 predictor.** `start` for a standard pass of a nonlinear block becomes an
  extrapolation of the block's last converged solutions: linear `2x₁−x₂`, quadratic
  `3x₁−3x₂+x₃`, or **adaptive**: after every converged solve the three candidates the
  history could have produced (order 0 = the previous solution, 1, 2) are scored against the
  solution just reached in tolerance units and the best order is used next time; a tie keeps
  the lower order; a non-converged solve breaks the chain. No constant, no knob. Only the
  start moves — the fold reseed still reads the previous solution, histories/limiting/
  relaxation/convergence test untouched. `wrong-sign` (control b) extrapolates backwards.
- **M2 chord/Shamanskii.** On a fresh factorisation the step is the shipped `x = J⁻¹·rhs`
  (dense `factorLU`+`solveLU` kept, or the sparse schedule's `values`/`factors` left in
  place by `runSparseSchedule`; the schedule's rhs/back-substitution ops are split out for
  reuse). A reuse step is `x ← x + J₀⁻¹(rhs(x) − J(x)·x)` over the stamp pattern. Refactor when
  the step stops contracting, `δ_k > ratio·δ_{k−1}` with ratio 0.5 (and 0.25), after
  `chordMaxSteps = 8` consecutive reuses, after a fold reseed, and **whenever the assembly
  at the current iterate was limiter-damped** (the companion then is not a linearisation at
  x, so the stored LU is not an approximation of this Jacobian — without this rule M4 ran
  every ts808 sample to the cap). `within` = per sub-sample; `across` = the next sub-sample
  starts on the previous one's LU. `chordAccept = bound` additionally requires
  `δ_k·ρ/(1−ρ) ≤ allowance` with the observed ratio ρ (the linear-convergence error bound).
- **M3 Broyden.** Good Broyden `J₊ = J + (y − J s)sᵀ/(sᵀs)` between reuse steps; because the
  reuse step solved `J s = −F(x_k)`, `y − J s = F(x_{k+1})`, i.e. the next assembled residual
  itself, so no Jacobian copy is needed. Applied through Sherman–Morrison on the solve (one
  `w = J⁻¹u` per update, O(n) per stored update per solve), skipped on relaxed or limited
  iterates, discarded on refactor.
- **M4** = M1 + M2 (+M3); `m4adapt` = adaptive predictor + chord-within with the bound rule.

## 3. M1 — predictor initial guess (six packets, x1 / os2 / os4)

`measure.ts --method=shipped,m1lin,m1quad,m1adapt,m1wrong --fixed-point`, full window; the
full per-method table (factorisations, assembles, limiter counts, twin statistics, hashes)
is `out/main-m1.jsonl` rendered by `render-tables.ts`; compact view:

| packet | os | shipped it/host | **adaptive** it/host (Δ) | quadratic | linear | one-step % (adaptive) | NC shipped → adaptive | peak | output vs dense: shipped → adaptive | fixed-point dev, tol units (adaptive) | sub-samples >1 | adaptive costs more than the shipped start on |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| muff | 1 | 3.563 | **3.459** (−3 %) | 4.542 | 3.792 | 0.0 | 0 → 0 | 10 → 10 | 0.0 → 3.6e-7 | 0.0018 | 0 | 2800 / 34 200 |
| sd1 | 1 | 3.042 | **3.021** (−1 %) | 3.604 | 2.729 | 10.4 | 0 → 0 | 13 → 26 | 7.1e-8 → 6.5e-7 | 0.0093 | 0 | 800 |
| ts9 | 1 | 2.625 | **2.500** (−5 %) | 2.583 | 2.417 | 0.0 | 0 → 0 | 7 → 8 | 4.6e-9 → 4.4e-6 | 0.012 | 0 | 800 |
| ts808 | 1 | 2.917 | **2.521** (−14 %) | 2.604 | 2.458 | 0.0 | 0 → 0 | 7 → 8 | 7.1e-10 → 4.6e-6 | 0.012 | 0 | 800 |
| gro100 | 1 | 2.197 | **1.958** (−11 %) | 2.068 | 2.137 | 20.9 | 0 → 0 | 35 → 31 | 0.0 → 9.6e-10 | **51.3** | **364** | 297 |
| blue-box | 1 | 64.000 | **6.316** (−90 %) | 16.324 | 6.153 | 0.0 | **9600 → 273** | 64 → 64 | 1.5 → 7.3e-2 | 3.25 | 55 | 687 |
| muff | 2 | 5.188 | **4.979** (−4 %) | 5.347 | 4.958 | 4.2 | 0 → 0 | 8 → 9 | 0.0 → 1.6e-7 | 0.0009 | 0 | 3000 |
| sd1 | 2 | 5.001 | **3.562** (−29 %) | 3.646 | 4.562 | 54.2 | 0 → 0 | 8 → 10 | 6.2e-12 → 6.5e-7 | 0.0075 | 0 | 600 |
| ts9 | 2 | 4.500 | **3.000** (−33 %) | 3.000 | 4.208 | 60.4 | 0 → 0 | 4 → 5 | 6.0e-9 → 2.2e-6 | 0.012 | 0 | 800 |
| ts808 | 2 | 5.104 | **3.062** (−40 %) | 3.062 | 4.208 | 57.3 | 0 → 0 | 4 → 5 | 1.1e-9 → 8.6e-7 | 0.0065 | 0 | 800 |
| gro100 | 2 | 4.206 | **2.674** (−36 %) | 2.801 | 4.122 | 73.7 | 0 → 0 | 17 → 19 | 0.0 → 2.4e-10 | **313** | **647** | 309 |
| blue-box | 2 | 7.972 | **7.754** (−3 %) | 8.838 | 7.788 | 0.0 | 0 → 0 | 64 → 64 | 2.6e-6 → 2.6e-6 | 0.0006 | 0 | 429 |
| muff | 4 | 9.063 | **5.646** (−38 %) | 5.604 | 8.583 | 68.8 | 0 → 0 | 5 → 5 | 0.0 → 5.6e-7 | 0.0038 | 0 | 800 |
| sd1 | 4 | 8.938 | **5.210** (−42 %) | 5.189 | 8.250 | 77.6 | 0 → 0 | 5 → 5 | 1.7e-8 → 1.4e-7 | 0.011 | 0 | 400 |
| ts9 | 4 | 8.375 | **4.625** (−45 %) | 4.625 | 7.875 | 84.4 | 0 → 0 | 3 → 3 | 1.0e-8 → 3.0e-7 | 0.0033 | 0 | 0 |
| ts808 | 4 | 8.792 | **4.646** (−47 %) | 4.646 | 7.875 | 83.9 | 0 → 0 | 3 → 3 | 1.9e-9 → 3.0e-7 | 0.0034 | 0 | 0 |
| gro100 | 4 | 8.218 | **4.651** (−43 %) | 4.701 | 7.340 | 88.4 | 0 → 0 | 16 → 20 | 0.0 → **1.5e-10** | **671** | **919** | 654 |
| blue-box | 4 | 14.832 | **14.622** (−1 %) | 15.552 | 14.713 | 0.0 | 0 → 0 | 64 → 64 | 2.2e-4 → 2.2e-4 | 3.70 | 46 | 400 |

Factorisations and assembles equal iterations for M1 (one of each per iteration, as
shipped); convergence checks likewise. The iteration saving *is* the factorisation and
assembly saving.

What the table says:

- **At os4 the adaptive predictor converges in one iteration on 69–88 % of sub-samples and
  cuts iterations/factorisations/assembles per host sample by 38–47 % on every packet except
  blue-box (−1 %)**; at os2 by 29–40 % on sd1/ts9/ts808/gro100; at x1 by 1–14 % on the
  pedals and 11 % on gro100. The fixed quadratic order is as good at os4 and os2 but
  **costs iterations at x1** (muff +27 %, sd1 +18 %); the fixed linear order never reaches
  one-step convergence at os4 (5 %). The self-selecting order takes the quadratic gain
  where it exists and is never worse than the shipped start on any row of the six — but §3b
  shows it is worse on 13 corpus pedals, which is why the recommended rule adds a gate.
- **Zero new non-converged host samples on any row.** blue-box at x1, where the shipped
  sparse loop rides the cap on every sample (9600 non-converged), converges on 9327 of 9600
  with the predictor (6.3 it/host): a different start breaks its doom-loop. Not a claim of
  correctness — blue-box is dense-unstable (pivot report) and its output vs dense is 7e-2 —
  but it is the opposite of a regression.
- **Output vs the independent dense run: 1e-7..5e-6 relative RMS on the pedals, where the
  shipped loop reads 1e-12..7e-8.** This is the predictor accepting a different iterate
  inside the tolerance band (§7 discusses why no method can keep 1e-9). gro100 is the
  exception that proves it: 9.6e-10 / 2.4e-10 / 1.5e-10 — *better* than 1e-9 at every factor,
  because its audio path converges tightly and the deviation lives elsewhere (next point).
- **Fixed-point deviation ≤ 0.012 tolerance units on every converged sub-sample of the four
  pedals** (0 sub-samples over 1 in 38 400 at os4); the shipped loop's own deviation from
  the dense twin is 1e-6..0.011. **gro100 and blue-box fail the per-sub-sample bar**:
  gro100 at 51 / 313 / 671 tolerance units on 364 / 647 / 919 sub-samples, blue-box at 3.3–3.7
  on 46–55. `probe-deviation.ts` names the unknowns: on gro100 every deviating row is the
  **mains rectifier bridge** (nodes 120–126: `D_RECT_P1A/B`, `D_RECT_P2A/B`, `D_RECT_N1A/B`,
  `PT_POWER_TRANSFORMER`, at 150–158 V), differing by up to 0.86 V between the predictor's
  solve (converged in 2) and the dense twin from the shipped start (converged in 3), while
  the audio-path nodes agree to 1e-8 V; the next-worst rows are 0.06 units. These are
  reverse-biased rectifier nodes held by diode leakage and gmin, where the delta test's
  0.15 V allowance on a 150 V node accepts iterates that still differ by several
  allowances — the shipped loop from the shipped start shows 0 such sub-samples only
  because the twin then walks the identical steps. blue-box's are rare bistable samples
  (0 in a 4800-sample re-run). This is reported as a **FAIL of the stated criterion** on
  those two packets with the mechanism; it is not an audio-path deviation, and the output
  agreement on gro100 is the best in the table.
- `m1wrong` (control b) raises iterations on all 18 rows (e.g. ts808 os4 8.79 → 10.06) and
  on blue-box adds non-converged samples (os2 0 → 77, os4 0 → 1).

## 4. M2 chord / M3 Broyden / M4 combinations (six packets, x1 and os4)

`measure.ts --method=m2within,m2within25,m2across,m2nostall,m3within,m3across,m4,m4adapt
--fixed-point`, full window; full table in `out/main-m234.jsonl`. Reuse/host counts the
steps taken against a stored LU; "refactors" are stall (δ_k > ratio·δ_{k−1}) / cap (8
reuses) / limited-assembly. Shipped values in parentheses.

| packet | os | method | it/host (shipped) | fac/host | reuse/host | refactors stall/cap/limited | NC (shipped) | vs dense relRMS (shipped) | fixed-point dev, tol units | sub-samples >1 |
|---|---|---|---|---|---|---|---|---|---|---|
| ts808 | 1 | m2within | 4.562 (2.917) | 1.708 | 2.854 | 6400/0/400 | 0 | 4.2e-4 (7.1e-10) | 0.645 | 0 |
| ts808 | 1 | m2within25 | 4.167 | 1.792 | 2.375 | 7000/0/600 | 0 | 1.3e-4 | 0.22 | 0 |
| ts808 | 1 | m2across | 5.375 | 0.875 | 4.500 | 8000/0/400 | 0 | 3.7e-4 | 0.603 | 0 |
| ts808 | 1 | m3within | 4.188 | 1.625 | 2.562 | 5200/0/800 (9400 Broyden updates) | 0 | 8.8e-5 | 0.202 | 0 |
| ts808 | 1 | m3across | 5.083 | 0.708 | 4.375 | 6000/0/800 (25 600) | 0 | 6.7e-5 | 0.22 | 0 |
| ts808 | 1 | m4 (linear + across) | 5.229 | 1.042 | 4.188 | 8400/0/1600 | 0 | 6.7e-4 | 1.75 | 400 |
| ts808 | 1 | m4adapt (adaptive + within + bound) | 2.729 | 1.167 | 1.562 | 1600/0/0 | 0 | 3.1e-4 | 0.967 | 0 |
| ts808 | 4 | m2within | 8.792 (8.792) | **4.000** | 4.792 | 0/0/0 | 0 | 6.7e-5 (1.9e-9) | 0.158 | 0 |
| ts808 | 4 | m2across | 13.083 | 0.250 | 12.833 | 2400/0/0 | 0 | 8.5e-4 | 1.97 | 1000 |
| ts808 | 4 | m3within | 8.792 | 4.000 | 4.792 | 0/0/0 (7600) | 0 | 7.0e-5 | 0.146 | 0 |
| ts808 | 4 | m3across | 13.458 | 0.229 | 13.229 | 2200/0/0 (87 400) | 0 | 1.8e-4 | 0.982 | 0 |
| ts808 | 4 | m4 | 8.375 | 0.188 | 8.188 | 1800/0/0 | 0 | 1.3e-3 | 4.44 | 1400 |
| ts808 | 4 | m4adapt | **4.646** | 4.000 | 0.646 | 0/0/0 | 0 | 2.1e-6 | 0.0645 | 0 |
| ts9 | 4 | m2within / m3within | 8.375 (8.375) | 4.000 | 4.375 | 0/0/0 | 0 | 6.6e-5 / 6.8e-5 (1.0e-8) | 0.148 / 0.145 | 0 |
| ts9 | 4 | m2across / m3across | 9.958 / 10.646 | 0.250 / 0.167 | 9.708 / 10.479 | 2400 / 1600 stall | 0 | 6.5e-4 / 2.8e-4 | 1.46 / 0.508 | 400 / 0 |
| ts9 | 4 | m4adapt | **4.625** | 4.000 | 0.625 | 0/0/0 | 0 | 2.0e-6 | 0.0646 | 0 |
| sd1 | 1 | m2within | 5.732 (3.042) | 2.188 | 3.544 | 10007/0/1400 | 0 | 5.6e-5 (7.1e-8) | 0.539 | 0 |
| sd1 | 1 | **m2across / m2nostall / m3across** | **1.000** | 0.000 | 1.000 | 0/0/0 | 0 | **1.0e+0** | 8.5e-9 | 0 |
| sd1 | 1 | m4 | 22.000 | 21.333 | 0.667 | 0/0/204 800 limited | 0 | 1.0e+0 | 8.5e-9 | 0 |
| sd1 | 1 | m4adapt | 4.688 | 2.042 | 2.646 | 9200/0/1000 | **200** | 3.2e-2 | 0.496 | 0 |
| sd1 | 4 | m2within | 9.792 (8.938) | 4.208 | 5.583 | 1800/0/200 | 0 | 1.4e-5 (1.7e-8) | 0.509 | 0 |
| sd1 | 4 | m2across | 12.521 | 0.542 | 11.979 | 5200/0/0 | 0 | 6.6e-5 | 1.18 | 200 |
| sd1 | 4 | m4adapt | 6.085 | 4.396 | 1.689 | 3800/0/0 | 0 | 3.0e-5 | 1.04 | 200 |
| muff | 1 | m2within / m2across | 5.749 / 6.281 (3.563) | 1.739 / 0.896 | 4.010 / 5.385 | 5682 / 6353 stall, 1422 / 2223 limited | **20 / 43** (0) | 1.4e-1 / 3.9e-1 (0.0) | 2.95 / 1.29 | 10 / 18 |
| muff | 1 | **m2nostall** (control b) | **49.679** | 0.000 | 49.679 | 0 | **6292** | **4.5e+0** | 2e3 | 3308 |
| muff | 1 | m3within / m3across | 5.412 / 5.851 | 1.739 / 1.027 | 3.673 / 4.824 | (19 783 / 29 112 updates) | 22 / 42 | 2.0e-1 / 1.4e+0 | 3.91 / 1.7e3 | 37 / 26 |
| muff | 1 | m4 / m4adapt | 7.215 / 6.564 | 1.089 / 2.001 | 6.126 / 4.564 | 9109 / 7644 stall | 0 / 44 | 7.0e-4 / 4.0e-1 | 0.837 / 2.93 | 0 / 6 |
| muff | 4 | m2within / m3within | 10.062 / 10.104 (9.063) | 4.312 / 4.354 | 5.750 | 2400 / 2800 stall, 600 limited | 0 | 2.3e-5 / 4.6e-5 (0.0) | 0.13 / 0.46 | 0 |
| muff | 4 | m2across / m3across | 14.104 / 14.872 | 0.333 / 0.167 | 13.771 / 14.704 | 1602 stall + 1198 cap / 1600 | 0 | 9.0e-4 / 3.0e-5 | 0.854 / 0.462 | 0 |
| muff | 4 | **m2nostall** | **41.105** | 0.000 | 41.105 | 0 | **400** | 2.8e-2 | 11.8 | 20 603 |
| muff | 4 | m4 / m4adapt | 11.037 / 6.979 | 0.208 / 4.667 | 10.829 / 2.312 | 2000 / 6000 | 0 | 4.7e-4 / 3.5e-5 | 0.545 / 0.303 | 0 |
| gro100 | 1 | m2within / m2within25 / m2across | 3.018 / 2.628 / 3.492 (2.197) | 1.418 / 1.255 / 0.379 | 1.600 / 1.373 / 3.113 | 3568 / 2144 / 3150 stall | **105 / 24 / 83** (0) | 5.4e-3 / 6.9e-3 / 6.5e-3 (0.0) | ~1e3 | 90 / 72 / 1645 |
| gro100 | 1 | m3within / m3across / m4 / m4adapt | 2.672 / 3.299 / 3.569 / 2.622 | 1.253 / 0.216 / 0.360 / 1.363 | | | **62 / 38 / 76 / 72** | 4.4e-3 / 1.0e-3 / 2.7e-3 / 1.4e-2 | ~1e3 | 66 / 2339 / 2531 / 610 |
| gro100 | 4 | m2within / m2across / m3within / m3across | 8.973 / 11.976 / 8.824 / 12.359 (8.218) | 4.360 / 0.397 / 4.295 / 0.218 | | | **55 / 56 / 34 / 21** (0) | 1.3e-3 / 1.7e-3 / 1.3e-3 / 1.3e-5 | ~1e3 | 83 / 10 357 / 46 / 14 264 |
| gro100 | 4 | m4 / m4adapt | 13.761 / 4.802 | 0.592 / 4.182 | 13.170 / 0.620 | | **103 / 11** | 4.2e-3 / 2.6e-4 | 1.6e3 / 985 | 16 623 / 807 |
| blue-box | 1 | m2within / m2within25 / m3across | 64.000 (64.000) | 60–62 | 2–4 | 537 600 limited | 9600 (9600) | 1.5 (1.5) | – | – |
| blue-box | 1 | m2across / m3within / m4 / m4adapt | 9.365 / 9.358 / 9.665 / 8.016 | 5.5–5.8 | 2.3–4.1 | ~26 000 stall | 710 / 741 / 733 / 455 | 3.2e-2 … 1.1e-1 | 7.35 / 6.72 / 1e3 / 2.83 | 37 / 33 / 43 / 1 |
| blue-box | 4 | m2within / m2across / m3within / m3across / m4 / m4adapt | 15.25–16.15 (14.832) | 10.2–10.6 | 4.9–5.5 | ~21 000 stall, 40 000–79 000 limited | 0–62 (0) | 2.2e-4 … 3.0e-3 (2.2e-4) | 3.3–1e3 | 22–51 |
| blue-box | 4 | **m2nostall** | **199.838** | 14.131 | 185.708 | 0 | **7439** | 1.2 | 20.3 | 50 |

What the table says:

- **Chord within a sub-sample halves factorisations at os4 (8.8 → 4.0 per host sample on
  ts808/ts9, 9.1 → 4.3 on muff) at equal or higher iteration counts** — the second iteration
  of every sub-sample reuses the first's LU and passes the delta test — **but the accepted
  iterate is a different point**: output vs dense 2e-5..7e-5 (vs 2e-9..1e-8 shipped),
  fixed-point deviation 0.13–0.5 tolerance units (vs 1e-6..1e-3). That is §5c's
  linear-convergence acceptance gap in the real loop. At x1 it is worse everywhere:
  +40–90 % iterations (the Jacobian of a clipper changes by e^(13 mV/26 mV) per sample, the
  stall rule fires on 60–100 % of sub-samples), output 1e-4..1e-1, and new non-converged
  samples on muff (20–43), gro100 (24–105) and sd1 with ratio 0.25 (3).
- **Chord across sub-samples is a trajectory hazard.** sd1 at x1 under `m2across`,
  `m3across` and `m2nostall` runs **1.000 iteration per host sample with 0 factorisations and
  output 1.0 relative RMS from dense** — the circuit latched into a self-consistent state
  during warmup and every subsequent solve "converges" in one chord step. **Every
  per-sub-sample check passes** (deviation 8.5e-9 units, 0 non-converged, twin agrees from
  that state): the trajectory derailed and only the independent output comparison sees it.
  On the pedals at os4 it costs +12–60 % iterations and, with the predictor (`m4`), 0.19–0.6
  factorisations per host sample at 1.5–4.4 tolerance units deviation on 400–1400
  sub-samples.
- **Broyden updates buy accuracy back, not work.** m3within vs m2within at x1: ts808 4.2e-4
  → 8.8e-5, ts9 4.2e-4 → 8.2e-5, deviation 0.65 → 0.20, at 1–2 % fewer iterations and 9 400
  O(n) updates per 9600 samples; across sub-samples (m3across) with 25 600–101 000 updates
  it reaches 1e-5..1e-4 on the clean pedals but non-converges gro100 (21–38) and leaves
  blue-box at 64.0 at x1.
- **The combination that ships (`m4adapt`: adaptive predictor + chord-within + contraction
  bound) is the predictor's saving with chord's inaccuracy and risk**: ts808/ts9 os4 4.65 /
  4.63 it/host (same as the predictor alone) with 4.0 factorisations (the predictor's
  one-step sub-samples leave nothing to reuse: 0.6 reuses/host) and 2e-6 output — no better
  than M1 — while sd1 x1 adds 200 non-converged, gro100 adds 11–72, muff x1 adds 44.
- **Control (b)**: the stall rule disabled (`m2nostall`) non-converges muff (6292 at x1, 400
  at os4), ts9 (443), ts808 (191), sd1 os4 (800), gro100 (96–399), blue-box os4 (7439 at
  199.8 it/host): the refactor rule is load-bearing, and the counters register its absence.

**Verdict on M2/M3/M4: inadmissible.** More iterations on every packet at every factor
except the two os4 rows where iterations tie (ts9/ts808 within) and the four where the
predictor carries the gain; accepted iterates 1e-4..1e-1 from dense on the pedals at x1;
new non-converged samples on three of the six packets; and a failure mode (latched
trajectory) invisible to every per-sub-sample check. The factorisation saving is real at
os4 (half) but the TS factorisation is 28–64 % of a 2-iteration solve while the iteration
saving of M1 removes whole iterations (assembly, factorisation and check).

### gro100, cap 1024 (`out/census-gro100-cap1024.log`)

Settle: 3 221 of 144 000 non-converged (2.2 %), mean 33.14 it/host (the cap buys
convergence on most storms at 15× the work). Measured second: **50.10 it/host; 1 779
sub-samples (3.7 %) hit the 1024 cap and carry 75.8 % of all iterations** — the same work
share as at cap 64 with a quarter of the samples; 2 539 sub-samples (5.3 %) need ≥ 64. The
twin fails on 1 792.

| class | samples | iterations (share) | twin converges | boundary crossing | relaxation | worst device at the last iteration | phase bins |
|---|---|---|---|---|---|---|---|
| (b) genuine non-convergence | 1 628 | 1 667 072 (69.3 %) | 331 / 1 628 (twin mean 912) | 1 090 | 1 628 | node 61 (bottom EL34 grid network) ×534; `V5_EL34` ×488; `V6_EL34` ×437; NFB node 80 ×75; OT secondary node 76 ×53 | 45:853 90:704 135:66 — the input peak |
| (c) slow contraction | 151 | 154 624 (6.4 %) | 151 / 151 (twin mean 478) | 151 | 151 | node 61 ×65; `V5_EL34` ×35; `V6_EL34` ×27 | 45:83 90:61 |
| (a) / (d) | 0 | | | | | | |

Same devices, same place in the cycle. Exemplar (b) 144153 (68°): deltas `3.5 0.52 2.5 1.7
0.58 1.2 … 0.16 0.14 0.13` V over 1024 iterations with relaxation — circling, not
contracting; (c) 145067 (83°): the deltas *grow* under relaxation (17 → 23 V at the end)
while the twin converges in 745. 16× the budget converts 3/4 of the cap-64 storms into
expensive successes and leaves the output-stage hunt itself.

### blue-box (`out/census-blue-box-cap64.log`, `-cap1024.log`)

At cap 64 the settled sparse loop is **the doom-loop of the pivot report**: 142 090 of
144 000 settle samples and **48 000 of 48 000** measured non-converged, every sample at 64,
the twin failing on every one; the limiter fires on `IC1_2`[opamp] at iterations 0 and 1 of
every sample and the worst unknown is `IC1_2`'s output for the whole run; deltas run
`5.0 2.6e-5 4.5e-3 1.5 2.6e+3 2.7e+3 … 1.2e+3` V — the op-amp iterate diverging to
kilovolts and being folded back: class **(b), 100 % of samples, 100 % of work**, no
boundary crossing. At cap 1024 the same packet settles with **one** non-converged sample in
144 000, 6.21 it/host, no cap hit at all (histogram 3:22000, 4:23500, 8:500, 54:1000,
80:1000): blue-box's storm at cap 64 is the cap's own artifact — one transient that needs
~100–1000 iterations once, and truncating it re-seeds the next sample into the limit cycle
(exactly `DEFAULT_NEWTON_MAX_ITERATIONS`'s comment). Nothing for a predictor (though §3
shows the predictor's different start happens to break the cycle at cap 64) or sub-step.

## 5. Controls, both directions

**(e) Bit-identity** (`control-bit-identity.ts`, 2400+9600, cap 64, x1 and os4, all six
packets): with every method off the scratch loop's output sha256 **equals the shipped loop's
on all 12 rows** (e.g. muff x1 `da9a14da93f72058`, gro100 os4 `80b79a967e9541cb` →
`out/control-e-bit-identity.log`), with identical iteration counts and non-converged
counts, and the copied dense `solve` reproduces the shipped dense path's hash on a
schedule-nulled ts808 (`4331928222b382a7`, 1169 iterations). Every method-on difference
below is therefore the method's.

**(a) Known positive.** Every table carries the unmodified loop vs dense on the same window:
ts808 7.1e-10 (x1) / 1.9e-9 (os4), ts9 4.6e-9 / 1.0e-8, sd1 7.1e-8 / 1.7e-8, muff and gro100
0.0 (eliminated), blue-box 1.5 (x1, dense-unstable) / 2.2e-4 (os4) — the pivot report's
numbers. The twin's deviation for the unmodified loop reads 1.7e-6..8e-5 tolerance units
on the converging packets (the sparse-vs-dense rounding floor, resolved per sub-sample).

**(c) Synthetic rates** (`control-synthetic-rates.ts`, `out/control-c-synthetic-rates.log`):
one catalog silicon diode (Is 2.52 nA, N 1.752, Rs 1 Ω) through 10 kΩ from an ideal source;
root of `F(v) = (v−vin)/R + Id(v)` by bisection on the shipped Lambert-W law; the source
steps 20 V → 2 V so the solve starts at the 2 mA root (0.615796 V) and must reach the
0.17 mA root (0.498160 V), both below the limiter's critical voltage 0.7409 V (no iteration
limited — printed). Through the real loop and counters:

| loop | iterations | factorisations | reuse | last deltas | rate |
|---|---|---|---|---|---|
| full Newton (methods off) | 6 | 6 | 0 | 1.0e-2, 1.2e-3, 1.7e-5 | δ_{k+1}/δ_k² = 15.6 / 12.3 / 10.8 (bounded, ratio δ_{k+1}/δ_k falling 0.40 → 0.12 → 0.013): **quadratic** |
| chord on J(start), stall rule off, cap 1024 | 24 | 1 | 23 | 4.8e-4 (delta test passes) | δ_{k+1}/δ_k = 0.906 at k=23, rising toward the theory ρ = 1 − F′(root)/F′(start) = 0.9172 (0.9162 by k=49 in the bound run): **linear** |

Full Newton lands 2.7e-9 V from the root (0.000 tolerance units). **Chord accepted by the
shipped delta test lands 5.0e-3 V = 10.0 tolerance units from the root** — exactly
ρ/(1−ρ) = 9.7 × its last delta, the linear-convergence error bound. With the contraction
bound as the acceptance rule it takes 50 iterations and lands at 1.007 tolerance units.
The counters count what they claim (Newton: factorisations == iterations; chord: 1
factorisation, 23 reuses), and the central accuracy fact of this report is on the table:
*under linear convergence the delta test is not the same tolerance*.

**(d) Predictor known to help / known to hurt** (`control-predictor-cases.ts`,
`out/control-d-predictor-cases.log`, 480+960 host samples, cap 64):

| case | loop | it/sub | one-step | first-iteration limited |
|---|---|---|---|---|
| HELP: 1 kHz 10 mV sine, 10k+100n RC carrying a never-conducting diode, **os4** | shipped | 2.000 | 0 % | 0 |
| | linear / quadratic predictor | **1.000** | **100 %** | 0 |
| same at x1 | all three | 2.000 | 0 % | 0 (predictor error 1.7e-4 V vs allowance 1.1e-5 V: as computed, no help at x1) |
| HURT: ±1 V square at 1 kHz, anti-parallel diode clipper, **x1** | shipped | 1.333/host (edge 9.00, edge+1 1.00, plateau 1.00) | — | 0 |
| | linear predictor | 1.542/host (edge 9.00, **edge+1 6.00**) | — | **40 of 40 edge+1 samples** |
| | quadratic predictor | 1.917/host (edge+1 7.00, edge+2 9.00) | — | 80 |

Both as predicted: the extrapolation of a jump overshoots the knee, the first assembly is
junction-limited, and the sample after each edge costs 6–7 iterations instead of 1. The
adaptive order sees this (the edge sample scores all orders equal, the tie keeps order 0)
and costs **exactly the shipped count on the square** — pinned by the test in the patch.

**(b) The check can fail — chord stall rule off, predictor wrong.** `m2nostall` (chord
across sub-samples, refactor-on-stall disabled, limited-assembly refactor kept) on muff,
which converges on every sample as shipped (0 non-converged at x1 and os4): **x1: 6292 of
9600 host samples non-converged, 49.7 iterations/host, output 4.5e+0 vs dense; os4: 400
non-converged, 41.1 it/host, 2.8e-2.** `m1wrong` (predictor extrapolating with the wrong
sign) raises iterations on every packet and factor where it ran: muff 3.563 → 3.708 (x1),
5.188 → 5.833 (os2), 9.063 → 9.908 (os4); sd1 3.042 → 3.731, 5.001 → 5.856; the full set is in
§3's tables. The counters move for the claimed reasons.

## 6. Storm census (gro100; blue-box as the other packet over 1 % cap-hits)

`storm-census.ts`: x1, default controls, 1 kHz @ 0.1 V, **3 s settle (144 000 host samples)
on the shipped loop at the stated cap, then 1 s (48 000) traced** through the scratch loop
with every method off and the full-dense twin on. Devices are named by the netlist device
id and the stamp kind, matched on exact terminal node sets (`readNetlist` ↔
`block.nodeIds`), never by description; rows no nonlinear stamp writes are resolved to
their source node and the devices on it (`resolve-rows.ts`). Class rules (priority order):
**(b)** the twin — full dense Newton of the unreduced 88-unknown system from the same
state, same cap — also fails, or the last 8 deltas do not contract against the previous 8;
**(c)** relaxation engaged and the deltas contract but miss tolerance inside the cap;
**(a)** a conduction-boundary crossing (diode current sign, BJT junction, FET gate, triode/
pentode grid onset) between the previous solution and the answer, or a limiter in the
first 3 iterations, and neither (b) nor (c); **(d)** none.

### gro100, cap 64 (`out/census-gro100-cap64.log`, `.json`)

Settle: 18 110 of 144 000 non-converged (12.6 %), mean 11.46 it/host, peak 64 — the
3 s-settled regime of the workbench note (14.3 % / 12.2). Measured second: **14.27 it/host;
8 119 of 48 000 sub-samples hit the cap (16.9 %) and carry 75.8 % of all iterations**
(known: 14.3 % / 74.9 %); histogram 2:5160, 3:20189, 4:6709, 5:3467, 6:1556, …, 64:8119.
The twin fails on 8 104 — **the full dense Newton path non-converges on the same samples
(99.8 %)**; where both converge the two solutions disagree by up to 7.3 tolerance units
(bistable operating points, not rounding).

| class | samples | iterations (share of all work) | twin converges | boundary crossing prev→answer | limiter in first 3 it | relaxation engaged | worst device at the last iteration | input phase bins (deg) |
|---|---|---|---|---|---|---|---|---|
| **(b) genuine non-convergence** | **8 094** | **518 016 (75.6 %)** | 23 / 8 094 (twin mean 64.0) | 4 289 | 407 | 8 090 | node 61 = the bottom EL34 pair's grid network (`C_PI_TO_POWER_BOTTOM_47N`, `R_POWER_GRIDLEAK_BOTTOM_220K`, `R_EL34_3/4_GRID_STOP_2K2`) ×3245; `V5_EL34`[pentode] ×1583; `V6_EL34`[pentode] ×1460; node 80 = NFB return (`R_NFB_RETURN_24K`, `C_NFB_BRIGHT_1N`) ×630; node 76 = OT secondary / speaker (`OT_OUTPUT_TRANSFORMER`, `R_SPEAKER_LOAD_15R`) ×472 | 0:1672 45:2416 90:2158 135:1704 180:144 — the positive half-cycle, peak-biased |
| (c) slow contraction, relaxation | 25 | 1 600 (0.2 %) | 25 / 25 (twin mean 62.2) | 25 | 0 | 25 | OT branch current (aux 1) ×7; node 61 ×5; `V6_EL34` ×3; `V2B`[triode] ×2 | 0:3 45:9 90:7 135:6 |
| (a) switching / limiting event | 0 | — | — | — | — | — | — | — |
| (d) unclassified | 0 | — | — | — | — | — | — | — |

Exemplar (b), sample 144004 (phase 30°, input +0.050 V): twin fails after 64; crossings
prev→answer `V5_EL34 grid G→g, V6_EL34 grid G→g` (both output-pair grids leaving
conduction); worst device by iteration `V5, V5, V5, V6, node 80 (NFB), node 80, …, V5, V5`;
deltas `1.1e+1 4.0e+0 1.1e+1 1.1e+1 1.5e+1 1.4e+1 … 5.1e-1 6.9e-1 2.1e+0 4.8e-1` V — an iterate
circling by ±10 V with relaxation engaged, never contracting. Node voltages across the
event (prev → final | twin): V2A plate (row 30) 297.12 → 296.73 | 296.74; PI tail (31)
4.56 → 5.40 | 5.40; EL34 grids (38/39) 0.310 → 0.528 | 0.529; the phase inverter and the
grids agree between the two failing paths to 1 mV while neither satisfies the equations.
Exemplar (c), sample 144597 (158°): relaxation at iteration 8, deltas 18.5 → 0.85 but
tolerance missed; the twin **converges to a different state** — EL34 grids at −29.1 V
(cut off) against the eliminated path's final iterate at +0.91 V, V2B plate 358 V vs 388 V:
two self-consistent operating points of the output stage + global NFB loop.

**Reading.** The storm is the EL34 push-pull output stage with the output transformer and
the global negative-feedback return in the loop: the worst unknown is always the grid
network, a pentode, the NFB node or the OT secondary; 53 % of the storms show a grid-onset
crossing on the way, but the crossing is the symptom of the iterate hunting between two
states (grids conducting / cut off), not a knee that a better start would step over — the
full dense Newton from the same state fails identically, and when it does converge it can
land on the other state. A predictor cannot help (class (a) is empty, and §3 shows the
adaptive predictor leaves gro100's non-converged count and cap-hit share unchanged);
event sub-stepping would not either (nothing switches — the device signatures that flip
flip inside the iteration, not between samples). **The next task is globalisation**
(damped/trust-region or homotopy Newton for the bistable output-stage + NFB loop), with
the output-stage bistability itself (two operating points at the same input) as the thing
to understand first.

## 7. Acceptance, per criterion (the gated predictor; "do not bend")

| criterion | result | numbers |
|---|---|---|
| Solution-vector deviation from full Newton within the convergence tolerances, per sub-sample, every packet | **FAIL** (pass on the four pedals and most of the corpus; fail on tube amps' mains/rectifier/heater nodes, one LFO node, and bistable samples) | six packets: ≤ 0.012 units on muff/sd1/ts9/ts808 at every factor (0 of 230 400 sub-samples over 1); gro100 93–760 units on 460–853 sub-samples (HT bridge nodes at 150 V, 0.86 V apart, audio path 1e-8 V); blue-box 1.3e-3 at os4. Corpus: 1 pedal (`mxr-phase-90-early-block`, LFO node) and 10 of 23 amps over 1 — jcm800 34 (`T1_MAINS_TX`/`FILAMENTS_6V3`, 0.4 mV on 10 mV), plexi 560, champ 58, trainwreck 4.4; the shipped loop itself reads 1e-6..0.02 on these packets only because the twin then walks identical steps. §3, §3c, §12 |
| Output relative RMS vs dense within 1e-9 wherever the unmodified loop was | **FAIL — structurally, for every method** | pedals 2e-10..4.5e-6 (shipped 1e-12..7e-8); gro100 2e-10..7.5e-10 (**passes**); corpus: 60 of 101 pedals and 6 of 16 amps keep the bar. The bar is met today only because sparse and dense execute the identical iterate sequence; any other first iterate is accepted at a different point inside the 1e-3/1e-6 band — §5c measures that band at 10 tolerance units for chord and §3c at ≤ 0.012 for the predictor. No start-changing method can meet 1e-9. |
| Zero new non-converged samples | **FAIL by 1–4 samples on three cap-storm packets** | six packets ×3 factors: 0 new except blue-box os4 0 → 2 (the twin fails on 14 from the same states); corpus x1: `boss-mt-2` 9 → 13 (dense 3), `mxr-phase-90-early-block` 0 → 1, `hiwatt-dr103` 24 → 25 (dense 22); `dumble` 77 → 71. All three are chaotic trajectories whose counts move on any 1-ulp change (the pivot report's cap-storm lottery; blue-box differs between twin-on and twin-off runs of the same rule). |
| Zero packets slower | **FAIL in wall time where the rule buys nothing** | iterations: no row of the six at any factor costs more; corpus 7 pedals +0.1..+2.2 %, 0 amps. Wall (§8, interleaved medians): blue-box +4 / +7 / +7 % at x1/os2/os4 at identical iterations, muff x1 +3 % at identical iterations — the per-solve scoring of three candidate starts (~1–2 µs per sub-sample) on packets where no sub-sample predicts. |
| A stated reduction in factorisations per host sample and wall time | **PASS** | os4: factorisations −39/−41/−45/−47/−44 % (muff/sd1/ts9/ts808/gro100), wall −30/−39/−29/−44/−28 %; os2: −6/−29/−35/−26/−35 % factorisations, −2/−24/−34/−19/−21 % wall; x1: 0/−11/−5/−4/−9 % factorisations, +3/−5/−6/0/−5 % wall. |
| Controls both directions, dense reference, synthetic rates, bit-identity | PASS | §5 |

Verdict as written: **no method is admissible under the stated bars.** The gated
predictor misses the 1e-9 bar structurally and the other three by margins of a few
samples / a few per cent on packets where it does nothing; it meets the reduction bar by a
wide margin at os4 and never costs an iteration on the profile packets. What the owner has
to decide is whether "same fixed point to the same tolerances" means the tolerance-unit
bar (met on every audio-path unknown measured; missed on floating supply nodes the delta
test itself does not pin) or the 1e-9 output bar (met by nothing that changes a start).

## 8. Cost (`timing.ts`, idle box, 5 interleaved repeats A/B/A/B…, median; 2400+9600 host samples, cap 64; ns = xRT × 20 833; `out/timing-before-idle.log`, `out/timing-after-patched-idle.log`)

A = this tree's shipped loop; B = scratch loop, gated predictor (same iteration counts as
the patch to three decimals). "patched" = the patched fresh clone's own loop, alone, in a
separate process (not interleaved: a consistency check, not the measurement).

| packet | os | A ns/host (xRT) | A it/host | B ns/host (xRT) | B it = fac = asm /host | B/A | patched clone ns/host (xRT) |
|---|---|---|---|---|---|---|---|
| muff | 1 | 45 600 (2.19) | 3.563 | 47 100 (2.26) | 3.563 | **1.031** | 46 900 (2.25) |
| muff | 2 | 69 000 (3.31) | 5.188 | 67 900 (3.26) | 4.875 | 0.984 | 67 500 (3.24) |
| muff | 4 | 125 600 (6.03) | 9.063 | 87 700 (4.21) | 5.500 | **0.698** | 89 400 (4.29) |
| sd1 | 1 | 39 400 (1.89) | 3.042 | 37 300 (1.79) | 2.708 | 0.949 | 41 900 (2.01) |
| sd1 | 2 | 63 500 (3.05) | 5.001 | 48 500 (2.33) | 3.542 | 0.763 | 51 500 (2.47) |
| sd1 | 4 | 114 000 (5.47) | 8.938 | 69 400 (3.33) | 5.273 | **0.608** | 73 500 (3.53) |
| ts9 | 1 | 37 500 (1.80) | 2.625 | 35 400 (1.70) | 2.500 | 0.942 | 36 200 (1.74) |
| ts9 | 2 | 59 800 (2.87) | 4.500 | 39 400 (1.89) | 2.917 | 0.659 | 41 900 (2.01) |
| ts9 | 4 | 108 500 (5.21) | 8.375 | 77 500 (3.72) | 4.625 | **0.714** | 65 200 (3.13) |
| ts808 | 1 | 41 200 (1.98) | 2.917 | 41 000 (1.97) | 2.792 | 0.995 | 38 500 (1.85) |
| ts808 | 2 | 64 000 (3.07) | 5.104 | 51 500 (2.47) | 3.792 | 0.807 | 48 500 (2.33) |
| ts808 | 4 | 108 700 (5.22) | 8.792 | 61 200 (2.94) | 4.646 | **0.564** | 59 800 (2.87) |
| gro100 | 1 | 216 700 (10.40) | 2.197 | 205 600 (9.87) | 1.990 | 0.949 | 162 900 (7.82) |
| gro100 | 2 | 448 100 (21.51) | 4.206 | 354 800 (17.03) | 2.744 | 0.791 | 268 700 (12.90) |
| gro100 | 4 | 895 200 (42.97) | 8.218 | 644 000 (30.91) | 4.635 | **0.719** | 458 500 (22.01) |
| blue-box | 1 | 648 100 (31.11) | 64.000 | 672 700 (32.29) | 64.000 | **1.038** | 647 100 (31.06) |
| blue-box | 2 | 72 700 (3.49) | 7.972 | 77 500 (3.72) | 7.972 | **1.066** | 72 100 (3.46) |
| blue-box | 4 | 131 500 (6.31) | 14.832 | 140 600 (6.75) | 14.791 | **1.071** | 133 700 (6.42) |

The saving tracks the iteration count: B/A ≈ (B iterations / A iterations) plus a few per
cent of bookkeeping (muff os4 0.698 vs 0.607 by iterations; ts808 os4 0.564 vs 0.528; gro100
os4 0.719 vs 0.564 — on the eliminated 88-unknown block the per-iteration cost is not the
whole cost, the once-per-sample background/`z0` work stays). Where the iterations do not
move the bookkeeping shows as +3–7 %. The patched clone's absolute figures agree with B on
the pedals within the box's ±10 % process-to-process spread and read lower on gro100 (a
different process and JIT; iteration counts identical) — reported, not used. All TS
in-process; the WASM console is unchanged and unmeasured.

## 9. Verification from fresh clones (`git clone --branch indiejoseph/newton-iteration-budget … /tmp/nb-verify` = base, `/tmp/nb-patched` = base + `runtime-start-predictor.patch`; logs in `/tmp/nb-verify-logs/`)

| step | base, no wasm | base + wasm | patched, no wasm | patched + wasm |
|---|---|---|---|---|
| `bun install --frozen-lockfile` | 411 packages, exit 0 | — | 411, exit 0 | — |
| `bun run typecheck` | 0 errors | — | 0 errors | — |
| `bun run --cwd packages/runtime build:wasm` (emsdk em++ via `~/projects/emsdk/emsdk_env.sh`) | — | `v2_dsp.wasm 74c25e2b…a8423`, `v2_dsp.cjs a7469e39…662e9` — **the oversampling report's exact hashes** | — | **identical hashes** (the patch touches no C++) |
| `bun run build` | fails at `cp -r src/wasm` (pre-existing, as 2026-10-09 base) | exit 0 | fails identically | exit 0 |
| `bun test` | 1947 pass / 8 fail (5 missing-wasm-console, `lazy until gesture`, Belton ×1, bbd S3 — the last three are 5–9 s tests that timed out under the 19 concurrent measurement jobs) | **1982 pass / 0 fail** (rerun on the idle box; the loaded run had 20 timeouts) | 1947 pass / 7 fail (5 missing-wasm + `lazy until gesture` + Belton, loaded box) | **1985 pass / 0 fail** (idle box, gated patch; the earlier ungated patch read 1984 / 1): the clipper parity test `V2WasmEngine agrees with the reference console > renders the same clipper to within 1e-9` read **1.117e-6 against its 1e-6 bar with the ungated predictor** (TS taking a different first iterate, C++ not); **with the gated rule it passes: 4.8e-8 (base 3.5e-8)** and the final idle-box run of the patched clone is **1985 pass / 0 fail** (`p07c-test-wasm-idle-final.log`). No test weakened; the 3 new predictor tests pass (`packages/runtime/tests/newton-start-predictor.test.ts`). |
| `bun run build:pages` | — | 872 pages, exit 0 | — | exit 0 |

The patched clone's runtime suite alone: 33 files, 499 tests (3 new), all pass except the 5
missing-wasm skips-that-fail without the artifact and the Belton timeout under load.

## 10. What the C++ port needs (not done here; `Engine.cpp` is unchanged)

The predictor is ~140 lines of TS with no new constant and no new knob, all in
`reference-runtime.ts` (the patch):

1. Per MNA block, a ring of three `std::vector<double>` converged solutions, a `chain`
   count, an `order` (0/1/2) and a `candidate` scratch — alongside the block's existing
   per-block scratch in `Engine`.
2. In `Engine::iterate` and `Engine::iterateEliminated`, on a standard audio pass of a
   nonlinear block (`!dc && sourceScale == 1 && gmin == GMIN && !linear`), seed the first
   iterate from `candidate` when `order > 0` and the chain is long enough, else from
   `start` as today; the fold reseed keeps reading `start`.
3. After the loop, on convergence, one fused pass scoring orders 0/1/2 against the solution
   in tolerance units (`|g − s| / (NEWTON_RELATIVE_TOLERANCE·max(|g|,|s|) +
   NEWTON_VOLTAGE_TOLERANCE)`, strict `<`, ties keep the lower order), then rotate the
   ring; on non-convergence reset `chain = 0, order = 0`.
4. Clear the histories in `prepare()`.
5. Parity: the predictor changes which iterate is accepted inside the tolerance band, so
   until the C++ console predicts identically (same ring, same scoring, same tie rule, same
   gate, same double arithmetic in the same order) the two consoles disagree at the
   1e-7..1e-6 level on the pedals — inside the existing 1e-4 / 0.9999 parity bars and the
   clipper test's 1e-6 (4.8e-8 measured with the gated rule, §9), but not bit-level; the
   ungated rule tripped the clipper bar at 1.117e-6, which is how close that margin is.
6. The gate: `recordNewtonSolution` receives `used`; `used > 2` forces order 0.

## 12. Corpus sweep at x1 (`corpus-sweep.ts`, 122 pedals + 23 amps, default controls, cap 64, 2400+9600 host samples; `out/corpus-m1adapt3-*.fixed.jsonl`, full tables `out/corpus-m1adapt3-pedals-table.md`, `out/corpus-m1adapt3-amps-table.md`; the ungated rule's sweep is `out/corpus-m1adapt-*.fixed.jsonl`)

The method column counts what the shipped telemetry counts: every scheduled MNA block's iterations, linear blocks at exactly one per sub-sample (`fix-corpus-linear.ts` adds the scheduled-linear-block count to the scratch counter, which covers nonlinear standard-pass solves only; 17 pedals are all-linear and read identical on both sides). Deviation, non-converged and agreement columns are as measured.

| set | packets (compile ok) | fewer iterations | more iterations (worst) | aggregate it/host | more non-converged | fewer non-converged | sub-samples >1 tol unit (packets) | within 1e-9 of dense as shipped → still with the method |
|---|---|---|---|---|---|---|---|---|
| pedals, gated (recommended) | 122 of 123 | 63 | 7 (earthquaker-devices-plumes +2.2 %) | 515.6 → 500.7 (-2.9 %) | boss-mt-2 9→13 (dense 3), mxr-phase-90-early-block 0→1 (dense 0) | none | 1: mxr-phase-90-early-block (5781, worst 34.4) | 101 → 60 |
| amps, gated (recommended) | 23 of 23 | 22 | 0 (—) | 76.8 → 69.0 (-10.1 %) | hiwatt-dr103 24→25 (dense 22) | dumble-overdrive-special 77→71 | 10: fender-bassman (3, worst 2.2), fender-twin-reverb (318, worst 4.4), marshall-jcm800 (9580, worst 34.0), hiwatt-dr103 (9551, worst 12.3), orange-gro100 (460, worst 311.9), trainwreck-express (296, worst 4.4), fender-5f1-champ (1728, worst 58.2), marshall-1959-super-lead-plexi (2071, worst 559.9), mesa-boogie-dual-rectifier (3, worst 1.1), orange-rockerverb (27, worst 9.0) | 16 → 6 |
| pedals, ungated | 122 of 123 | 65 | 13 (analog-man-prince-of-tone +49.6 %) | 515.6 → 440.6 (-14.5 %) | boss-mt-2 9→10 (dense 3) | jim-dunlop-fuzz-face 121→0, univox-super-fuzz 9→7, electro-harmonix-q-tron 4→0, mxr-blue-box 9600→273, jim-dunlop-fuzz-face-jh2 121→0 | 8: boss-hm-2 (202, worst 1.1), jim-dunlop-fuzz-face (46, worst 4.4), univox-super-fuzz (44, worst 4.7), mxr-blue-box (55, worst 3.2), boss-mt-2 (2, worst 999.0), boss-os-2 (59, worst 1.0), mxr-phase-90-early-block (5765, worst 62.7), jim-dunlop-fuzz-face-jh2 (46, worst 4.4) | 101 → 49 |
| amps, ungated | 23 of 23 | 21 | 1 (vox-ac30-top-boost +6.2 %) | 76.8 → 64.0 (-16.7 %) | none | dumble-overdrive-special 77→63, hiwatt-dr103 24→21 | 13: dumble-overdrive-special (10, worst 3.4), fender-bassman (34, worst 2.6), fender-twin-reverb (2571, worst 39.6), marshall-jcm800 (9580, worst 34.0), peavey-5150 (140, worst 1.8), hiwatt-dr103 (9550, worst 14.6), orange-gro100 (364, worst 51.3), trainwreck-express (2940, worst 57.5), vox-ac30-top-boost (16, worst 3.4), fender-5f1-champ (1728, worst 58.2), marshall-1959-super-lead-plexi (2093, worst 626.5), mesa-boogie-dual-rectifier (3, worst 1.1), orange-rockerverb (54, worst 9.0) | 16 → 6 |

Gated rule, pedals, the rows that cost more:

| packet | n | it/host shipped → gated | NC | peak | vs dense shipped → gated |
|---|---|---|---|---|---|
| earthquaker-devices-plumes | 38 | 2.875 → 2.938 (+2.2 %) | 0/0 | 10/10 | 3.6e-13 → 7.3e-07 |
| big-muff-pi | 30 | 3.082 → 3.144 (+2.0 %) | 0/0 | 11/11 | 6.4e-12 → 4.1e-07 |
| pro-co-rat-2-v4b-op07cp | 26 | 2.542 → 2.562 (+0.8 %) | 0/0 | 10/10 | 0.0e+00 → 1.2e-06 |
| boss-mt-2 | 93 | 4.017 → 4.040 (+0.6 %) | 9/13 | 64/64 | 6.0e-03 → 4.9e-03 |
| boss-hm-2 | 75 | 5.163 → 5.178 (+0.3 %) | 0/0 | 33/33 | 5.7e-09 → 3.4e-05 |
| boss-dd-3b | 50 | 1.000 → 1.001 (+0.1 %) | 0/0 | 64/64 | 2.2e-07 → 2.2e-07 |
| mxr-phase-90-early-block | 38 | 8.144 → 8.145 (+0.0 %) | 0/1 | 53/64 | 1.3e-07 → 3.6e-03 |

Largest pedal gains at x1: vemuram-jan-ray 2.38 → 1.69 (-29 %); boss-md-2 2.75 → 2.00 (-27 %); boss-cs-3 2.69 → 2.02 (-25 %); boss-sg-1-slow-gear 2.62 → 2.00 (-24 %); boss-ds-2 2.36 → 1.80 (-24 %); zvex-fuzz-factory 2.97 → 2.31 (-22 %); electro-harmonix-lpb-1 2.27 → 1.77 (-22 %); boss-bd-2-blues-driver-keeley-mod 2.79 → 2.21 (-21 %).
Largest amp gains: fender-bassman 2.84 → 2.00 (-30 %); marshall-jtm45 2.94 → 2.20 (-25 %); fender-super-reverb-aa1069 2.63 → 2.04 (-23 %); fender-super-reverb 2.59 → 2.04 (-21 %); fender-5e3-deluxe-tweed 2.92 → 2.32 (-21 %); fender-5f1-champ 2.97 → 2.42 (-19 %).

Reading. At x1 the gated rule is a small, almost one-sided win: -2.9 % iterations across
the pedals (63 of 122 fewer, 7 more by ≤ 2.2 %, 52 identical — 17 of them all-linear
packets the predictor never touches) and -10.1 % across the amps (22 of 23 fewer, none
more). Non-converged counts move on three storm packets — `boss-mt-2` 9 → 13 (dense
itself 3; a cap-storm packet whose count is a lottery, pivot report §1),
`mxr-phase-90-early-block` 0 → 1 (that sample lands 3.6e-3 from dense: one storm event in
9600 that the shipped start happened to avoid), `hiwatt-dr103` 24 → 25 (dense 22). The
unguarded rule's sweep (rows 3–4) is why the gate exists: 13 pedals and 1 amp slower, two
by ≥ 39 %, and more packets off the 1e-9 bar (it also happened to rescue two fuzz-faces and
blue-box from their doom-loops, and that was luck, not a property: the gate gives it up). Sub-sample
deviations > 1 tolerance unit concentrate in the tube amps' mains/rectifier/heater nodes
(`probe-deviation.ts`: jcm800's 34 units are `T1_MAINS_TX_T4145`/`FILAMENTS_6V3` at 10 mV
with 0.4 mV differences; gro100's are the HT bridge; §3) and in
`mxr-phase-90-early-block`'s LFO node (`R9,C5,SPEED,IC1B` at −14 µV vs −45 µV) — unknowns
the delta test does not pin and the audio path does not see (output agreement on those
packets 2e-6, 8e-10, 3.6e-3 with the one storm sample). Under the ungated rule
`jim-dunlop-fuzz-face` (dense itself holds 121 samples) converged everywhere and its output
moved 2.7e-1 from dense — the two starts choosing different sides of a bistable fuzz-face,
neither validated; with the gate that row is 3.715 → 3.652 it/host, 121 → 121
non-converged, 5.2e-6 vs dense. The 1e-9 output bar: 101 pedals and 16 amps meet it as
shipped; 60 and 6 still meet it with the gated rule (the rest sit at 1e-9..5e-6, §7).


## 11. Exact commands and what this cannot prove

Worktree root, bun 1.3.14, worktree `src` imports (tsconfig paths); corpus paths read-only:

```
bun docs/spikes/newton-budget/baseline-histogram.ts --packet=gro100,blue-box,ts808 --cap=64 --os=1   # §1 (also --cap=1024; --os=4 --study)
bun docs/spikes/newton-budget/sparse-vs-dense.ts --os=1|4                                              # §1
bun docs/spikes/newton-budget/control-bit-identity.ts                                                  # §5e
bun docs/spikes/newton-budget/control-synthetic-rates.ts                                               # §5c
bun docs/spikes/newton-budget/control-predictor-cases.ts                                               # §5d
bun docs/spikes/newton-budget/measure.ts --os=1,2,4 --method=shipped,m1lin,m1quad,m1adapt,m1wrong --fixed-point --out=out/main-m1.jsonl   # §3
bun docs/spikes/newton-budget/measure.ts --os=1,4 --method=m2within,m2within25,m2across,m2nostall,m3within,m3across,m4,m4adapt --fixed-point --out=out/main-m234.jsonl   # §4 (+§5b)
bun docs/spikes/newton-budget/render-tables.ts main|corpus <jsonl>
bun docs/spikes/newton-budget/corpus-sweep.ts --method=m1adapt [--amps] --shard=i/n --out=…          # §12
bun docs/spikes/newton-budget/storm-census.ts --packet=gro100|blue-box --cap=64|1024 --out=…          # §6
bun docs/spikes/newton-budget/resolve-rows.ts --packet=gro100 --rows=37,54,50,82,35                    # §6
bun docs/spikes/newton-budget/probe-deviation.ts --packet=gro100 --method=m1adapt --os=1               # §3
bun docs/spikes/newton-budget/timing.ts --method=m1adapt --os=1,2,4 --repeats=5 [--no-b]               # §8
git apply docs/spikes/newton-budget/runtime-start-predictor.patch && bun test packages/runtime/tests/newton-start-predictor.test.ts
```

Raw output: `docs/spikes/newton-budget/out/*.log|jsonl|json`.

What this cannot prove: agreement with dense Newton (and with the twin) is solver
consistency, not circuit truth — no hardware, no ngspice, no ear in this task. One
stimulus (1 kHz at 0.1 V), one control setting per packet, one window (2400+9600 host
samples; 3 s + 1 s for the census); chords, plucks, control sweeps and sustained
large-signal clipping are unmeasured, and a predictor is exactly the kind of method whose
value depends on the signal (§5d: none at x1 on a 1 kHz sine through an RC, all of it at
os4). The fixed-point twin measures one solve from one state; a trajectory that diverges
inside the tolerance band is seen only by the output comparison, and a trajectory that
latches (sd1 under chord-across) only by it. The tolerance-unit bar flags ill-conditioned
unknowns (gro100's rectifier) that the delta test itself does not pin — a property of the
shipped convergence test, surfaced here, not created here. Timing is a dev-box TS
in-process ratio (12 cores, bun 1.3.14), not the WASM console, not the worklet, and the
x1 rows sit inside the box's ±15–25 % run-to-run noise. The C++ console is unchanged and
unmeasured; the storm census is one amp and one pedal at one settle.

### 3b. The gate: why the recommended rule also requires a ≤2-iteration previous solve

The corpus sweep of the unguarded self-selecting predictor (§12, `corpus-m1adapt-*`) found 13 of 122 pedals and 1 of 23 amps taking *more* iterations at x1 — `analog-man-prince-of-tone` +50 %, `boss-hm-2` +39 % (peak 33 → 63), `boss-os-2` +18 % — and `fulltone-ocd-v1.4` +49 % at os4. On every one of them the extrapolation *scored better* than the previous solution in tolerance units (the rule was working as written): a start that is closer in max-norm but on the far side of a junction knee is limiter-damped and costs more iterations than the previous solution, so prediction error does not predict solve cost. A hysteresis variant (an order must have beaten order 0 on the last two scored solves) changed nothing (prince-of-tone 4.25 vs 4.33 it/host; `out/hysteresis.log`). **The smooth-regime gate** — extrapolate only after a solve that took ≤ 2 iterations, the floor of one step and one check — removes every regression and keeps every gain (`measure.ts --method=shipped,m1adapt,m1adapt3`, `out/variants.jsonl`, 2400+9600, cap 64, no twin):

| packet | os | shipped it/host | adaptive (ungated) | **adaptive + gate** | NC shipped / ungated / gated | peak shipped / ungated / gated | vs dense ungated / gated | one-step % gated |
|---|---|---|---|---|---|---|---|---|
| analog-man-prince-of-tone | 1 | 2.896 | 4.333 (+50 %) | **2.771** (-4 %) | 0 / 0 / 0 | 30 / 32 / 30 | 6.6e-06 / 6.5e-06 | 0 |
| boss-hm-2 | 1 | 5.163 | 7.180 (+39 %) | **5.178** (+0 %) | 0 / 0 / 0 | 33 / 63 / 33 | 2.5e-04 / 3.4e-05 | 0 |
| boss-os-2 | 1 | 3.598 | 4.251 (+18 %) | **3.441** (-4 %) | 0 / 0 / 0 | 30 / 32 / 30 | 1.8e-05 / 1.7e-05 | 0 |
| earthquaker-devices-plumes | 1 | 2.875 | 3.096 (+8 %) | **2.938** (+2 %) | 0 / 0 / 0 | 10 / 11 / 10 | 7.2e-07 / 7.3e-07 | 0 |
| boss-mt-2 | 1 | 4.017 | 4.314 (+7 %) | **4.040** (+1 %) | 9 / 10 / 13 | 64 / 64 / 64 | 1.3e-02 / 4.9e-03 | 0 |
| fulltone-ocd-v1.4 | 1 | 4.053 | 4.290 (+6 %) | **4.005** (-1 %) | 0 / 0 / 0 | 12 / 19 / 12 | 4.1e-07 / 3.6e-07 | 0 |
| univox-super-fuzz | 1 | 4.146 | 4.353 (+5 %) | **3.965** (-4 %) | 9 / 7 / 9 | 64 / 64 / 64 | 2.1e-02 / 3.2e-06 | 4 |
| pro-co-rat-2-v4b-op07cp | 1 | 2.542 | 2.658 (+5 %) | **2.562** (+1 %) | 0 / 0 / 0 | 10 / 10 / 10 | 2.1e-06 / 1.2e-06 | 0 |
| big-muff-pi | 1 | 3.082 | 3.125 (+1 %) | **3.144** (+2 %) | 0 / 0 / 0 | 11 / 10 / 11 | 9.9e-07 / 4.1e-07 | 0 |
| vox-ac30-top-boost | 1 | 4.044 | 4.296 (+6 %) | **4.027** (-0 %) | 0 / 0 / 0 | 34 / 36 / 34 | 1.8e-04 / 2.5e-05 | 0 |
| muff | 1 | 3.563 | 3.459 (-3 %) | **3.563** (+0 %) | 0 / 0 / 0 | 10 / 10 / 10 | 3.6e-07 / 2.3e-10 | 0 |
| sd1 | 1 | 3.042 | 3.021 (-1 %) | **2.708** (-11 %) | 0 / 0 / 0 | 13 / 26 / 13 | 6.5e-07 / 2.4e-07 | 10 |
| ts9 | 1 | 2.625 | 2.500 (-5 %) | **2.500** (-5 %) | 0 / 0 / 0 | 7 / 8 / 7 | 4.4e-06 / 4.2e-06 | 0 |
| ts808 | 1 | 2.917 | 2.521 (-14 %) | **2.792** (-4 %) | 0 / 0 / 0 | 7 / 8 / 7 | 4.6e-06 / 4.5e-06 | 0 |
| gro100 | 1 | 2.197 | 1.958 (-11 %) | **1.990** (-9 %) | 0 / 0 / 0 | 35 / 31 / 35 | 9.6e-10 / 7.5e-10 | 19 |
| blue-box | 1 | 64.000 | 6.308 (-90 %) | **64.000** (+0 %) | 9600 / 272 / 9600 | 64 / 64 / 64 | 1.4e+00 / 1.3e+00 | 0 |
| analog-man-prince-of-tone | 4 | 8.729 | 6.405 (-27 %) | **6.247** (-28 %) | 0 / 0 / 0 | 14 / 14 / 14 | 6.2e-06 / 5.4e-06 | 60 |
| boss-hm-2 | 4 | 10.165 | 10.048 (-1 %) | **10.165** (-0 %) | 0 / 0 / 0 | 32 / 32 / 32 | 4.2e-07 / 2.4e-07 | 0 |
| boss-os-2 | 4 | 9.236 | 7.425 (-20 %) | **7.130** (-23 %) | 0 / 0 / 0 | 11 / 10 / 11 | 3.8e-06 / 4.3e-06 | 46 |
| earthquaker-devices-plumes | 4 | 8.875 | 5.337 (-40 %) | **5.500** (-38 %) | 0 / 0 / 0 | 5 / 5 / 5 | 1.3e-07 / 1.2e-07 | 75 |
| boss-mt-2 | 4 | 13.586 | 13.622 (+0 %) | **13.596** (+0 %) | 5 / 8 / 7 | 64 / 64 / 64 | 2.8e-02 / 2.8e-02 | 0 |
| fulltone-ocd-v1.4 | 4 | 12.577 | 18.696 (+49 %) | **12.220** (-3 %) | 0 / 0 / 0 | 6 / 15 / 6 | 4.7e-08 / 2.7e-08 | 3 |
| univox-super-fuzz | 4 | 10.993 | 8.449 (-23 %) | **8.740** (-20 %) | 0 / 0 / 0 | 18 / 62 / 18 | 2.1e-05 / 1.1e-07 | 42 |
| pro-co-rat-2-v4b-op07cp | 4 | 8.896 | 8.583 (-4 %) | **8.729** (-2 %) | 0 / 0 / 0 | 14 / 9 / 14 | 4.9e-07 / 4.9e-07 | 0 |
| big-muff-pi | 4 | 8.727 | 5.376 (-38 %) | **5.333** (-39 %) | 0 / 0 / 0 | 5 / 5 / 5 | 2.2e-07 / 1.9e-07 | 73 |
| vox-ac30-top-boost | 4 | 11.147 | 7.249 (-35 %) | **8.890** (-20 %) | 0 / 0 / 0 | 8 / 34 / 8 | 7.1e-06 / 1.7e-07 | 40 |
| muff | 4 | 9.063 | 5.646 (-38 %) | **5.500** (-39 %) | 0 / 0 / 0 | 5 / 5 / 5 | 5.6e-07 / 3.9e-07 | 69 |
| sd1 | 4 | 8.938 | 5.210 (-42 %) | **5.273** (-41 %) | 0 / 0 / 0 | 5 / 5 / 5 | 1.4e-07 / 7.9e-08 | 78 |
| ts9 | 4 | 8.375 | 4.625 (-45 %) | **4.625** (-45 %) | 0 / 0 / 0 | 3 / 3 / 3 | 3.0e-07 / 3.0e-07 | 84 |
| ts808 | 4 | 8.792 | 4.646 (-47 %) | **4.646** (-47 %) | 0 / 0 / 0 | 3 / 3 / 3 | 3.0e-07 / 3.0e-07 | 84 |
| gro100 | 4 | 8.218 | 4.651 (-43 %) | **4.635** (-44 %) | 0 / 0 / 0 | 16 / 20 / 17 | 1.5e-10 / 1.5e-10 | 88 |
| blue-box | 4 | 14.832 | 14.622 (-1 %) | **14.791** (-0 %) | 0 / 0 / 2 | 64 / 64 / 64 | 1.4e+00 / 5.0e-04 | 0 |

With the gate the worst x1 row is +2 % (big-muff-pi, plumes), the peaks return to the shipped peaks on every packet, output agreement improves where the ungated rule had hunted (hm-2 2.5e-4 → 3.4e-5, super-fuzz 2.1e-2 → 3.2e-6, vox-ac30 1.8e-4 → 2.5e-5), and the os4 gains are unchanged (ts9/ts808 −45/−47 %, gro100 −44 %, muff −39 %, sd1 −41 %, big-muff-pi −39 %, plumes −38 %). Two rows move the wrong way by a few samples on the two cap-storm packets: `boss-mt-2` 9 → 13 non-converged at x1 (5 → 7 at os4) and blue-box 0 → 2 at os4 — both chaotic trajectories whose non-converged count is a lottery on any 1-ulp change (blue-box's figures also differ between twin-on and twin-off runs of the *same* method). The gate also gives up the ungated rule's accidental rescue of blue-box at x1 (64.0 it/host both ways now). The gated rule is what the patch implements and what §7, §8 and §12 judge.


### 3c. The recommended rule on the six packets, with the fixed-point twin (`measure.ts --method=m1adapt3 --fixed-point`, `out/main-m1adapt3.jsonl`)

| packet | os | shipped it/host | **gated predictor** it/host (Δ) | one-step % | NC shipped → gated (warm) | peak | output vs dense: shipped → gated | max abs V | fixed-point dev (tol units) | sub-samples >1 | costs more than the shipped start on | twin NC |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| muff | 1 | 3.563 | **3.563** (+0 %) | 0.0 | 0 → 0 (0) | 10 → 10 | 0.0e+00 → 2.3e-10 | 1.7e-11 | 1.7e-06 | 0 | 0 / 9600 | 0 |
| sd1 | 1 | 3.042 | **2.708** (-11 %) | 10.4 | 0 → 0 (0) | 13 → 13 | 7.1e-08 → 2.4e-07 | 6.1e-08 | 5.9e-03 | 0 | 0 / 9600 | 0 |
| ts9 | 1 | 2.625 | **2.500** (-5 %) | 0.0 | 0 → 0 (0) | 7 → 7 | 4.6e-09 → 4.2e-06 | 6.4e-07 | 1.2e-02 | 0 | 0 / 9600 | 0 |
| ts808 | 1 | 2.917 | **2.792** (-4 %) | 0.0 | 0 → 0 (0) | 7 → 7 | 7.1e-10 → 4.5e-06 | 8.5e-07 | 1.2e-02 | 0 | 0 / 9600 | 0 |
| gro100 | 1 | 2.197 | **1.990** (-9 %) | 19.5 | 0 → 0 (0) | 35 → 35 | 0.0e+00 → 7.5e-10 | 2.5e-10 | 3.1e+02 | 460 | 218 / 9600 | 0 |
| blue-box | 1 | 64.000 | **64.000** (+0 %) | 0.0 | 9600 → 9600 (1181) | 64 → 64 | 1.5e+00 → 1.3e+00 | 3.1e-02 | 0.0e+00 | 0 | 0 / 9600 | 9600 |
| muff | 2 | 5.188 | **4.875** (-6 %) | 4.2 | 0 → 0 (0) | 8 → 8 | 0.0e+00 → 5.9e-08 | 6.4e-09 | 6.7e-04 | 0 | 1200 / 19200 | 0 |
| sd1 | 2 | 5.001 | **3.542** (-29 %) | 54.2 | 0 → 0 (0) | 8 → 8 | 6.2e-12 → 3.3e-07 | 5.0e-08 | 3.5e-03 | 0 | 0 / 19200 | 0 |
| ts9 | 2 | 4.500 | **2.917** (-35 %) | 60.4 | 0 → 0 (0) | 4 → 5 | 6.0e-09 → 6.7e-07 | 1.8e-07 | 5.9e-03 | 0 | 0 / 19200 | 0 |
| ts808 | 2 | 5.104 | **3.792** (-26 %) | 46.9 | 0 → 0 (0) | 4 → 5 | 1.1e-09 → 1.1e-06 | 2.2e-07 | 6.5e-03 | 0 | 0 / 19200 | 0 |
| gro100 | 2 | 4.206 | **2.744** (-35 %) | 72.2 | 0 → 0 (0) | 17 → 20 | 0.0e+00 → 2.0e-10 | 9.5e-11 | 7.6e+02 | 569 | 293 / 19200 | 0 |
| blue-box | 2 | 7.972 | **7.972** (+0 %) | 0.0 | 0 → 0 (5) | 64 → 64 | 2.6e-06 → 2.6e-06 | 1.4e-07 | 7.9e-07 | 0 | 0 / 19200 | 0 |
| muff | 4 | 9.063 | **5.500** (-39 %) | 68.8 | 0 → 0 (0) | 5 → 5 | 0.0e+00 → 3.9e-07 | 5.4e-08 | 3.8e-03 | 0 | 0 / 38400 | 0 |
| sd1 | 4 | 8.938 | **5.273** (-41 %) | 77.6 | 0 → 0 (0) | 5 → 5 | 1.7e-08 → 7.9e-08 | 1.5e-08 | 1.0e-02 | 0 | 0 / 38400 | 0 |
| ts9 | 4 | 8.375 | **4.625** (-45 %) | 84.4 | 0 → 0 (0) | 3 → 3 | 1.0e-08 → 3.0e-07 | 5.9e-08 | 3.3e-03 | 0 | 0 / 38400 | 0 |
| ts808 | 4 | 8.792 | **4.646** (-47 %) | 83.9 | 0 → 0 (0) | 3 → 3 | 1.9e-09 → 3.0e-07 | 7.6e-08 | 3.4e-03 | 0 | 0 / 38400 | 0 |
| gro100 | 4 | 8.218 | **4.635** (-44 %) | 88.4 | 0 → 0 (0) | 16 → 17 | 0.0e+00 → 1.5e-10 | 7.3e-11 | 9.3e+01 | 853 | 404 / 38400 | 0 |
| blue-box | 4 | 14.832 | **14.791** (-0 %) | 0.0 | 0 → 2 (10) | 64 → 64 | 2.2e-04 → 5.0e-04 | 1.1e-04 | 1.3e-03 | 0 | 0 / 38400 | 14 |

Factorisations, assembles and convergence checks per host sample equal the iteration count
(one of each per iteration, as shipped). Against the ungated rule (§3): the x1 gains shrink
(ts808 −14 % → −4 %, muff −3 % → 0 %) and sd1 x1 improves (−1 % → −11 %, peak 26 → 13);
every os2/os4 row is within ±3 % of the ungated figure; **no row costs more iterations than
the shipped loop**, and the "costs more than the shipped start" column is 0 on every pedal
at every factor (gro100 2–3 % of sub-samples, muff os2 6 %, with net gains). Output
agreement with dense is 2e-10..4.5e-6 on the pedals (shipped 1e-12..7e-8) and 2e-10..7.5e-10
on gro100 (**inside 1e-9**). Fixed-point deviation ≤ 0.012 tolerance units on every pedal
sub-sample at every factor (0 over 1 in 230 400); gro100's rectifier nodes remain at
93–760 units on 460–853 sub-samples (the §3 mechanism, nodes decoupled from the output);
blue-box os4 goes 0 → 2 non-converged (the twin fails on 14 from the same states).

