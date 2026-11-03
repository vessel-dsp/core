# Release prep: core 0.19.0 / compiler 0.21.0 / runtime 0.16.1 / chain 0.1.24 / player 0.2.22 (2026-11-03, ambient temperature + NTC thermistor)

**Status: PUBLISHED (all five tags live on npm; record commit follows on main).**
Prepared 2026-11-03 on branch `indiejoseph/core-temperature` at `f9681f1` (plus this
note): main `5afbc1d` plus two commits, verified in a fresh throwaway clone (deleted
after). Runtime, chain and player versions were then bumped by the coordinator (a
published version cannot be re-published with a new exact pin); re-verified before
the push, see the release record appended below.

## What ships

| package | from | to | why |
|---|---|---|---|
| core (`@vessel-dsp/core`) | 0.18.0 | 0.19.0 | new component kind `thermistor` + typed `Resistance`/`Beta`/`ReferenceTemperatureC` validation (no schema bump per the fuse precedent) |
| compiler | 0.19.0 | 0.21.0 (via 0.20.0) | `ambientTemperatureC` compile option with the junction fold at compile time (0.20.0); thermistor device kind lowering to R(T) (0.21.0); exact core pin 0.19.0 |
| runtime | 0.16.0 | 0.16.1 | sources untouched: no `Program`/`Stamp`/`ProgramJson.cpp`/`Program.h` change; patch because the exact compiler pin moves to 0.21.0 (a published version cannot carry a new pin) |
| chain | 0.1.23 | 0.1.24 | never calls the compiler (takes a built `Program`); exact re-pin (compiler 0.21.0, core 0.19.0, runtime 0.16.1) |
| player | 0.2.21 | 0.2.22 | `ambientTemperatureC` passthrough; exact re-pin (chain 0.1.24, compiler 0.21.0, core 0.19.0, runtime 0.16.1) |
| stompbox | 0.6.17 (unchanged) | -- | exact `@vessel-dsp/core` pin moves to 0.19.0 |

## What changed

Two commits, each with its tests:

- `a97c841` compiler: ambient temperature as a compile option (0.20.0). T = 273.15 + C;
  every diode, BJT and OTA-bias law folds at compile time (`thermalVoltage` with T
  against the 300 K reference, saturation currents with the SPICE law relative to
  300 K: XTI 3, EG by a new typed registry `material` -- silicon 1.11, germanium 0.67,
  Schottky 0.69). Filled from the records' existing citations (Schottky ST/Diodes Inc
  cards printing EG .69, Nexperia BAT85 card; DEC 1N60 sheet, Bordodynov 1N34A card,
  measured 1S188FM, Mullard/Newmarket/Siemens germanium BJT rows); never inferred from
  names -- PN2222A and ZTX109C sit beside germanium rows in the same files and stay
  unset. Untyped parts run silicon, named once by the new `material-default-silicon`
  notice, which fires only off-reference.
- `f9681f1` core+compiler: NTC thermistor as a component kind (core 0.19.0, compiler
  0.21.0). `R(T) = R_ref * exp(Beta * (1/T - 1/T_ref))` folded at the ambient; Beta 0
  is exactly the same-valued resistor; `Type: ptc` / missing Beta / negative Beta /
  unphysical T_ref / wrong terminal count are typed refusals naming the component.

## Evidence

Closed forms (hand-computed, asserted with relative tolerance, not implementation
outputs): silicon diode at 19 C Vt 0.02517554 V / IS 1.24652e-09 A; germanium AC128
IS 7.82474e-06 A; OTA scaled defaults IS 2.91346e-13 A; divider 13127.010775676536
ohms at 19 C (gain 0.43239483) and 10000.00 at 25 C; FF collector return
43319.13555973257 ohms at 19 C, 33000.00 at 25 C.

- Bit-identical default: every shipped fixture string compiles byte-identically
  (program text, or refusal reasons) with the option absent vs explicit 26.85 C
  (`packages/compiler/tests/ambient-temperature.test.ts`, 8 tests). ngspice parity
  needs `tnom=26.85` to match the 300 K reference -- the deck contract is pinned as
  text in `tests/temperature-parity.test.ts`.
- ngspice parity of the Fuzz-Face-like fixture (two AC128 germanium PNPs, RT1 33k
  NTC Beta 3950 in Q1's collector return) with hand-written decks at 19 C and 25 C,
  5 mV / 1 kHz, runtime at 48 kHz oversample 1, settled last cycle: corr
  0.9999999981 / maxDelta 5.2e-5 / dcDelta 4.2e-5 at 19 C; corr 0.9999999978 /
  maxDelta 5.5e-5 / dcDelta 4.5e-5 at 25 C. Bars are the existing ones (corr >=
  0.9999, maxDelta < 1e-4). The ngspice legs skip where no binary exists; the
  runtime closed-form legs always run.
- Worktree gates: `bun run typecheck` exit 0 (root + all packages); `bun run build`
  exit 0 (`dist entrypoints ok`); root `bun test` 2734 pass / 0 fail (175 files).
- Fresh-clone gates (clone of this worktree at `f9681f1` to `/tmp/core-temp-verify`,
  wasm supplied from the main checkout after checking its date 2026-11-01, clone
  deleted after): `bun install --frozen-lockfile` exit 0 (411 packages);
  `bun run typecheck` exit 0; `bun run build` exit 0 (`dist entrypoints ok`);
  `bun test` 2734 pass / 0 fail (175 files). Note: expect() totals differ by one
  between the two full runs (632475 vs 632476) with identical pass/fail counts --
  run-to-run variance in an existing test, not attributable to these commits.

## The two stated limits (and the rest of the out-of-fold list)

- No self-heating: the thermistor resistance is a function of the ambient alone;
  current through the disc does not warm it (stated in the law's doc comment).
- Material defaults to silicon where untyped -- including LEDs, whose junction is a
  III-V the three-material law does not cover (they run the silicon bandgap of
  1.11 eV, SPICE's own default; named by the notice like any defaulted junction).
- Outside the fold by construction, reported not changed: the FET body-diode scale
  and the optocoupler LED emitter stay at 300 K in both consoles
  (`Engine.cpp:939-940` and `:3935-3937`, mirrors at `reference-runtime.ts:799`
  and `:9079-9080`). Folding them needs new stamp fields -- a `Program`-shape
  change this option deliberately avoids. JFET gate terms, BJT betas, zener
  breakdown and series resistances carry no temperature model and are kept as stated.
- No SPICE deck emitter lives in this repo (verified by search: only citations and
  history comments mention ngspice under `packages/`). The workbench
  source-to-spice deck must emit `.options temp=<C> tnom=26.85` and the material's
  EG/XTI on every `.model` for parity off-reference; the parity test pins those
  lines as text.

## Checklist

1. Versions and exact pins bumped per the table; core `VERSION`, dist, and the
   release-metadata test move together; CHANGELOG heading added. No tags, no publish.
2. No `Program`/`Stamp`/`ProgramJson.cpp`/`Program.h`/kernel-table change (runtime
   sources untouched -- verified by empty diff).
3. Local core `main` -- NOT TOUCHED (another session's uncommitted edits).
4. `/core-temperature/` already in the core checkout's `.git/info/exclude`; nothing
   loose in `~`; the `/tmp` scratch clones removed.
5. **No push.**

## Release record (published 2026-11-03, workbench release-0210 worker)

**Status: PUBLISHED.** Main pushed fast-forward `5afbc1d` -> `616f2fd`
(no force); five tags pushed one at a time in order, each watched to success
before the next, each confirmed on npm before proceeding. No reruns, no tag
moves.

| package | version | tag | publish run | npm time (UTC) |
|---|---|---|---|---|
| core | 0.19.0 | `v0.19.0` | 41659717499 success | 2026-11-03T15:05:12 |
| compiler | 0.21.0 | `compiler-v0.21.0` | 41660300119 success | 2026-11-03T15:08:32 |
| runtime | 0.16.1 | `runtime-v0.16.1` | 41660879718 success | 2026-11-03T15:14:37 |
| chain | 0.1.24 | `chain-v0.1.24` | 41661925260 success | 2026-11-03T15:20:04 |
| player | 0.2.22 | `player-v0.2.22` | 41662898572 success | 2026-11-03T15:24:16 |

Acceptance in an empty dir (`npm i` all five at the new versions): `npm ls
--all` clean, one copy of each, no nested older core or compiler.

Verification of the release commit (fresh clone at `616f2fd`, branch
`indiejoseph/core-release-0210`): `bun install --frozen-lockfile` PASS
unchanged; wasm built with CI-order emcc, sha256
`d8ed56447768b0eb36aac1c2cd770e28aa319723474fbb1e9adf55017b57e7c8`
(= the 0190 local build hash: the runtime did not move); `bun run typecheck`
exit 0; `bun run build` exit 0 (`dist entrypoints ok`); root `bun test`
**2741 pass / 2 fail** across 175 files (632488 expect() calls) -- the 2 are
the pre-existing `tests/appearance/corpus-integration.test.ts` failures (CE-2
colour `#59B1E6` vs `#5ca8d4`, block count; the canonical artifacts checkout
has drifted, as documented in the 0190 record); `bun test
tests/package.test.ts` 25 pass / 0 fail unedited (exact-pin guard holds).

Program bit-identity control (the release claim): 145 programs (122 pedals +
23 amps) exported from a clean `git archive` extract of artifacts
`da97fc07bf343753fca842a719f37ee6af6f0a39`, compiled once with the release
compiler (clone symlinked into the workbench) and once with the published npm
compiler 0.19.0 / core 0.18.0 / runtime 0.16.0: `diff -r programs-old
programs-new` **empty**. With the option absent every program is byte-identical
to the published 0.19.0 compiler's. The kernel generator is deterministic
(two runs on the same programs, byte-identical output).

Kernel table control (finding, coordinator-approved PROCEED): regenerating
`GeneratedKernels.cpp` from the clean-extract programs gives **139 kernels
from 563 scheduled blocks** vs the committed **138 from 557** (-1 kernel
`k_3c71d0ec`, +2 `k_63ec0fb5`/`k_80e7ceac`). This is tree state, not compiler
churn: the same generator run over programs built from the dirty canonical
checkout reproduces the committed table **exactly** (empty diff, 138/557).
The canonical checkout carries an uncommitted `boss-oc-2` re-trace (`.vdsp`
mtime 2026-10-28, 4550-line diff; the sole program mover clean-vs-dirty, 1 of
145 files) that predates the 0190 table commit `07377ac` (2026-11-01) -- so
the 0190 table, and the HEAD workbench catalogs (whose `boss-oc-2` program
equals the dirty-tree build, verified), were built from that dirty tree, not
from clean `da97fc07b` as the 0190 record states. The regenerated table was
**not** committed (per procedure); the release ships the committed table,
which is program-identical to what 0190 shipped. CI wasm proof: published
0.16.1 `dist/wasm/v2_dsp.wasm` sha256
`5f9754f1f0c35792bcab58b94bf0fe670f394a236fa35016a047e421411df813`
(2,283,801 bytes) is **byte-identical to published 0.16.0** -- the runtime did
not move. Owed to the owner: decide whether to commit the OC-2 re-trace in
artifacts, then regenerate the kernel table and the workbench catalogs in one
later row; the SPICE deck emitters owed are on the workbench side (X15).
