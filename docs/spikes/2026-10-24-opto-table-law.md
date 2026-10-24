# Spike: measured log-log photocell table law for the optocoupler (2026-10-24)

## What changed

An optocoupler's cell resistance vs LED current is a measured curve that bends on a log-log
plot, so no single power-law fit covers the AW-2 lamp's 0.02-0.5 mA sweep. New optional
law/stamp fields `ldrTableCurrentAmps`/`ldrTableOhms` (strictly increasing positive currents,
positive finite resistances, at least 2 points, both present or both absent) flow from the
catalog entry through `device-laws.ts`, `lower.ts`, the `Program` stamp, `Program.h` /
`ProgramJson.cpp`, and both consoles. Evaluation interpolates linearly in (ln I, ln R) between
the bracketing points, continues the end segment's log-log slope outside, clamps to
`[ldrMinOhms, ldrMaxOhms]` exactly as the power law is clamped, and takes `ldrMaxOhms` for a
current at or below zero. A stamp carrying both the table and the power-law pair runs the
table. Every program without a table is byte-identical: generic and power-law paths untouched.

Commits on `indiejoseph/opto-table-law` (from `1431bb1`): `d8546ef` mechanism + unit tests,
`3269534` P873G35-380 6-point table (geometric mean of the 18 measured units, provisional),
`4af84b4` VTL5C2 3-anchor table (no fit; droppable).

## Gate numbers (all quoted)

- Typecheck: compiler `tsc --noEmit` exit 0, runtime `tsc --noEmit` exit 0.
- Suites: compiler 680 pass / 0 fail (34 files, incl. 9 new `optocoupler-table` tests);
  runtime 558 pass / 0 fail / 0 skip-fail (38 files, incl. 7 new table tests). The 5
  wasm-parity failures seen before the rebuild were the missing `src/wasm` build, not the
  change; after `bun run build:wasm` (emsdk `/home/joseph/projects/emsdk`) all pass.
- Unit tests cover exact values at the 6 P873 points, a log-space midpoint (6807.72 ohm at
  1.7321e-4 A), both extrapolations (271770.90 ohm at 1e-5 A, 528.24 ohm at 5e-2 A), clamps
  in both directions, current <= 0 taking `ldrMaxOhms`, and a linear-interpolation mutant
  (7765.00 ohm at the midpoint, 14% off) that fails.
- Console parity, same program on TS runtime vs rebuilt wasm, 48000 samples (1.0 s) of 1 kHz
  0.1 V sine: AW-2 max sample difference 2.758520495360628e-11; synthetic VTL5C2 table
  fixture 0 (bit-identical). Kernels: `GeneratedKernels.cpp` holds only linear-algebra
  replay (no stamp evaluation), so `generate-kernels` was not re-run; that is stated, not
  skipped silently.
- Corpus digest gate (124 `vessel-dsp/*.vdsp` documents, program JSON hash + warning codes,
  `pedalPartCatalog`): mechanism alone moves nothing (main vs `d8546ef`: zero movers); P873
  moves exactly `boss-aw-2` (`ae77f1ef2f0054f4` -> `79b3c4f02f490764`) and `boss-tw-1`
  (`553507665ee87b12` -> `c23def251ad534a4`); VTL5C2 additionally moves exactly
  `runoffgroove-tremulus-lune` (`667a01522dda923c` -> `7e02eee9ad576e5a`). Warning-code sets
  are identical on every mover. `dod-envelope-filter-440-vintage-green` mentions VTL5C2 only
  in `CandidateModelPolicy` prose (candidate-only, never a `PartNumber`), so it correctly
  stays put; no other mover, nothing to report.
- AW-2 PC1 cell from the runtime code path (`ldrTableResistanceOhms` on the compiled
  stamp, clamps 100 / 1e7): 0.02 mA -> 104890.64, 0.03 -> 60100.00, 0.1 -> 11500.00,
  0.3 -> 4030.00, 0.5 -> 2916.12, 1 mA -> 1880.00 ohm. Points exact; 0.02 mA and 0.5 mA
  are the end-segment / interior interpolations.
- Page-4 acceptance (script copied to scratch, runtime import pointed at this tree):

  | row | main engine | main verdict | table engine | table verdict | page |
  | step4 | 1.490 Vp-p (+0.5 dB), RT1=0.00 | PASS | 1.110 Vp-p (-2.0 dB), RT1=0.60 | PASS | 1.40 +- 0.10 |
  | row2-MIN | 0.870 (+3.2 dB) | PASS | 0.642 (+0.6 dB) | PASS | 0.60 +- 0.10 |
  | row2-MAX | 0.360 (+1.6 dB) | PASS | 0.482 (+4.1 dB) | FAIL | 0.30 +- 0.05 |
  | row3-MAX | 0.316 (-11.6 dB), 112 ms vs 80 ms | FAIL | 0.794 (-3.6 dB), 10 ms vs 80 ms | FAIL | 1.20 +- 0.15 |
  | row3-MIN | 0.279 (-11.1 dB), 230 ms vs 2.5 s | FAIL | 0.786 (-2.1 dB), 40 ms vs 2.5 s | FAIL | 1.00 +- 0.15 |
  | row4 | 0.219 (-14.0 dB) | FAIL | 0.226 (-13.7 dB) | FAIL | 1.10 +- 0.10 |
  | step6 | 1.490 (+0.5 dB) | PASS | 1.110 (-2.0 dB) | PASS | 1.40 +- 0.10 |

  Step 4, step 6 and row2-MIN still pass; row2-MAX flips PASS -> FAIL (hotter by
  2.5 dB against a +3 dB gate). Row3-MAX/MIN and row4 fail on both arms (pre-existing).
  The RT1 procedure maximum moves 0.00 -> 0.60. Nothing was changed to make a row pass.

## Version bumps implied

Compiler minor (new optional `DeviceLaw`/`Stamp` fields: 0.8.1 -> 0.9.0), runtime minor
(new stamp evaluation on both consoles, `Program.h` / `ProgramJson.cpp`: 0.6.3 -> 0.7.0);
chain and player re-pin to the new compiler/runtime at release time. `package.json`
versions were left untouched (release-time bump per repo convention); the CHANGELOG
`Unreleased` section carries the three paragraphs.

## What could not be verified

- ngspice parity for the table restatement: the from-source deck restates the runtime
  formula, so it cannot catch a shared error (same limit the VTL5C2 fixture comment
  states). No independent third implementation of the table exists.
- Hardware: the table is a 2005 hobbyist measurement of one `-380` lot at 22 C
  (provisional, `registry-provisional-value`), not a manufacturer curve and not a
  hardware reference. Whether the AW-2's actual `-38` matches this lot is still open.
- `generate-kernels` was not run (kernels are schedule replay, unaffected); if a future
  kernel specialises stamp evaluation it must mirror the table branch.
