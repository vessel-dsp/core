# AW-2 latch/zener/P873: Rows A and B landed, Row C stopped under rule (2)

Date: 2026-10-23. Worktree: `core` repo, branch `indiejoseph/aw2-latch-zener-p873`,
from `main` at `327322e` (release prep compiler 0.8.1). READ-ONLY dirs
(`workbench`, `artifacts`) untouched — no git command run there, no file written
there; scratch scripts live in `/tmp/opencode/aw2work` (deleted at the end) and
read-only baseline worktrees at `/tmp/opencode/aw2main` (main) and
`/tmp/opencode/aw2rowA` (Row A commit) with `node_modules` symlinked from this
worktree (also deleted at the end).

## TL;DR

- **Row A landed** (commit `d876e94`): zener-clamped op-amp supply rail + the
  `opamp-supply-undeclared` diagnostic, applied from
  `/home/joseph/patches-open/core-opamp-supply-zener/core-opamp-supply-zener.patch`
  (source + test hunks verbatim, CHANGELOG hand-written).
- **Row B landed** (commit `009dda5`): `P873G35`/`-380`/`35380`/`-38` split out of
  the generic optocoupler row into their own entry with the measured power-law
  cell, marked `provisionalParams` (the `registry-provisional-value` mechanism
  covers optocoupler laws — verified, see below).
- **Row C STOPPED under rule (2): no `latch-seed.ts` change.** No typed bypass
  fact exists, and neither connectivity candidate separates AW-2's sides; the only
  structural asymmetry (CHECK-LED branch on Q10's collector) selects the wrong
  side in its principled polarity and is an unjustifiable heuristic in the
  reverse. The seed — Q10's base, the dry side — remains the one measured defect.
- **Two spec statements are factually wrong** (both flagged with measurements):
  (1) acceptance item 3's "(Q10's base, the effect side)" — the effect side is
  Q8's base (4-to-1 evidence below); (2) "the corpus has three others" latch
  packets — the census finds 22 latch instances (19 fallback + 3 derived).

## Row A — op-amp supply on a zener-clamped node (landed)

`git apply --check` evidence: the full patch checks clean **except** the
`CHANGELOG.md` hunk (`patch failed: CHANGELOG.md:1` — the patch was written on
`682c864`, whose top entry is `core 0.17.0 / compiler 0.8.0`, while this
worktree's `main` top entry is the `327322e` release prep). Applied with
`git apply --exclude=CHANGELOG.md` (exit 0; `compile.ts`, `device-laws.ts`,
`types.ts`, new `tests/zener-supply-rail.test.ts` all check), and the CHANGELOG
section hand-written at the top under the patch's own
`## Unreleased: compiler (minor; …)` header. No redesign.

Verification: compiler typecheck exit 0; `bun test packages/compiler` 661 pass /
0 fail, including `zener-supply-rail.test.ts` 9 pass and `latch-seed.test.ts`
11 pass.

Digest (124 corpus `.vdsp`, program-sha + warning codes, main vs Row A): exactly
one program mover, `boss-aw-2` (`c5c5ef35…` → `a9cc7fd0…`); `IC5A`/`IC5B`
`railHigh` 9 → 5.235 (two `ideal-opamp` stamps, `railLow` 0, no other stamp
field moves; D9/D10 `breakdownVolts` 5.235 in the same program).
`opamp-supply-undeclared` fires on exactly the 15 documents the patch lists
(`boss-bf-2`, `boss-ds-1`, `boss-ph-3`, `boss-sp-1-spectrum`,
`electro-harmonix-bad-stone`, `electro-harmonix-holy-grail`,
`fulltone-ocd-v1.4`, `keeley-compressor-plus`, `marshall-blues-breaker`,
`moogerfooger-mf-102`, `mxr-distortion-plus`, `pro-co-rat-2-v4b-op07cp`,
`pro-co-rat`, `runoffgroove-tremulus-lune`, `tape-echo`), not on `boss-aw-2`.
Whether the fallback is close to the real rail at each of those nodes was not
examined (same caveat as the patch).

`node_modules/@vessel-dsp/core` resolves to
`/home/joseph/projects/VesselDSP/core/aw2-latch-zener-p873/packages/core`
(inside this worktree, not the main checkout).

## Row B — P873G35 optocoupler entry (landed)

`P873G35`, `P873G35-380`, `P873G35380` removed from the generic PC817/MOC3021
row into their own entry (same `terminalRoleGroups`, `pinout`, LED figures
1.6 V / 1e-3, clamps 100 Ω / 1e7 — exactly as specified), with
`ldrPowerLawCoefficientOhms: 105.6`, `ldrPowerLawExponent: -0.436`
(2.14 kΩ at 1 mA), plus `P873G35-38` in `partIds` per the 2026-10-23 owner
decision. Entry comment and CHANGELOG carry the provenance sentence as
specified (18 measured `-380` units, electro-music.org topic 27276, 22 °C, max
residual ×1.14, NOT a manufacturer curve; Hamamatsu sheets list neither `-380`
nor `-38` with a resistance-vs-current curve). The transcribed table was
re-read from the read-only source dir; the fit numbers match the task spec.

**The provisional mechanism covers optocoupler laws, so the value is marked
with it (not a new field).** `PartEntry.provisionalParams` is entry-kind
agnostic (`registry.ts`); `findRegistryProvisionalValues` (`compile.ts`)
matches any entry by folded part id and falls back to `?? {}` override keys
for device kinds absent from `PROVISIONAL_OVERRIDE_KEYS` (optocoupler is
absent), and the optocoupler law fields are document-typable parameter names,
so a document that types them correctly suppresses the warning. Measured:
AW-2's `PC1 (P873G35-38)` stamps `ldrPowerLawCoefficientOhms: 105.6` and
raises `registry-provisional-value` for exactly
`["ldrPowerLawCoefficientOhms", "ldrPowerLawExponent"]` (it already raised the
same code for Q8/Q10's `2SC2458GR` saturation currents, so its warning *code
set* is unchanged).

Digest (Row A vs Row B): **two** program movers, not one. `boss-aw-2` moves
again (`a9cc7fd0…` → `5d93c3f7…`, the opto law), and **`boss-tw-1` moves too**
(`5928d627…` → `5e1c7b3a…`) and gains `registry-provisional-value`. The spec's
"moves boss-aw-2 only" assumed no other document names a P873 part, but
`boss-tw-1` files `PartNumber: P873G35-380` (Touch Wah, same red
photocoupler, LDR shunting the IC1B filter feedback). This is the specified
split working as designed — same part id, same law — not a second packet
being tuned: the remaining shared-row parts (PC817, MOC3021, VTL5C1, VTL3C3,
VTL5C3, VTL5C4) are untouched, and no other document names any P873 spelling
(verified by repo-wide grep). The Touch Wah getting the measured `-380` law in
place of the megohm-default generic is the correct direction, but its audio
was not A/B-rendered here — flagged as unverified, not as a defect.

## Row C — bypass latch side (STOPPED under rule (2), no change)

`engagedBase()` returns `null` on the filed AW-2 (reproduced: seed
`{node: 15, volts: 0.65}`, i.e. Q10's base = the dry side; the relabelled file
seeds node 15 = Q8's base = the effect side — different transistors, so
relable invariance FAILS today and the un-relabelled render stays dry).

- **Route (0) — no typed fact.** The document declares `bypass: none`, carries
  no `role: "bypass"` control (controls are VR1–VR4, RT1, IN, OUT), and no
  typed engaged state. Node-ledger names (`N_BYPASS_AUDIO_PRE_Q4`,
  `N_FLASHER_Q10_COLLECTOR`) exist but names are off-limits, and in any case
  name no side as engaged.
- **Candidate (1a) — input/output reachability: FAILS (measured).** Q4's drain
  (116) and Q5's drain (111) sit in the *same* passive island (identical
  22-node flood sets): both reach the input jack only through the +4.5 VA bias
  node 96, and neither reaches the output passively (the shared source 112
  feeds the output buffer through Q11, an active stage). With node 96 cut, both
  reach the identical 15-node filter island and neither reaches input, output,
  or any control node. The filter's own R/C network fuses the sides beyond the
  bias network, so no passive-reachability property separates the FETs.
- **Candidate (1b) — bias-cut control flood: FAILS (measured).** Cutting all
  node-96 edges (or only its resistor edges) leaves both drains reaching no
  control node (both empty, 15 nodes each) — the rule still returns `null`.
  (The spec's "both sides reach a control node through the bias network" is
  stale: on the filed packet *neither* side reaches one; the observable —
  `null` → fallback → dry — is what matters.)
- **The only structural asymmetry is the CHECK-LED branch** (LED1 anode via
  the D11 MTZ5.6B zener feed, cathode on Q10's collector 115; the latch halves
  are otherwise mirror-symmetric down to the R52/R58 ground pull-downs and
  C32/C33 gate caps). An LED-based rule is rejected both ways: the principled
  polarity ("indicator marks the engaged side", matching the packet's own
  "CHECK LED" prose) selects Q10's base — the dry seed the motion check
  rejects; the reverse polarity ("engage the non-indicator side") has no
  physical basis, contradicts the packet prose, and would mis-engage any normal
  pedal whose indicator marks the effect side. That is a heuristic, which rule
  (2) forbids. No `latch-seed.ts` change was made; `latch-seed.test.ts` passes
  unchanged (11 tests) and no packet-asserting test was added.

**Correct target, for the record:** the effect side is **Q8's base** (node 85
filed, node 15 relabelled), NOT Q10's base as acceptance item 3's
parenthetical states. Four converging facts: (i) the spec's own diagnosis —
fallback seeds Q10's base and every render is dry; (ii) the relabel proof —
seeding Q8's base (post-relabel node 15) makes the effect path appear;
(iii) gate-drive physics — Q8 on pulls Q4's gate low (Q4 off) and releases
Q5's gate high (Q5 on) through D3/D4; (iv) acceptance's own "Q5's gate DC must
be the on state" requires Q10 off, i.e. the Q8-side seed. The file's CHECK LED
lights in the bypass state as filed (LED on ⟺ Q10 on ⟺ dry) — flagged, not
fixed; wiring is taken as given.

**Corpus census (the "three others" claim is stale).** `findBistableLatches`
over all 124 corpus files: **22 latch instances — 3 derived** (`boss-ce-2`
Q7, `boss-dm-2` Q6, `boss-sd-1` Q4) **and 19 on the min-base fallback**,
including `boss-aw-2`, `boss-hm-2`, `boss-bd-2-blues-driver` (+keeley mod),
`boss-ds-1`, `boss-ds-2`, `boss-cs-2`, `boss-cs-3`, `boss-dm-3`, `boss-lm-2`,
`boss-mt-2`, `boss-nf-1-noise-gate`, `boss-od-1`, `boss-os-2`, `boss-ph-1r`,
`boss-sp-1-spectrum`, `boss-tr-2`, `boss-tw-1`, `ibanez-ts9-reissue`. Any
fallback-replacing heuristic would reshuffle seeds across ~19 packets — further
reason the stop is correct. Since Row C changed no code, all other latch
packets are trivially byte-identical (digest confirms: only `boss-aw-2` and
`boss-tw-1` move, both for Row A/B reasons).

## Acceptance results

1. **Row A `git apply --check`**: source + test hunks check clean; CHANGELOG
   hunk fails (patch predates the `327322e` release prep) and was hand-written
   under the patch's own `Unreleased` header. Compiler typecheck exit 0;
   `bun test packages/compiler` 661/0 including `zener-supply-rail` 9/9 and
   `latch-seed` 11/11. No Row C test added (stop — nothing reusable to cover).
2. **Digest gates**: Row A moves `boss-aw-2` only (IC5A/B `railHigh` 9 →
   5.235) + `opamp-supply-undeclared` on exactly the 15 patch-listed
   documents. Row B moves `boss-aw-2` + `boss-tw-1` (same part, expected —
   spec assumption corrected above) and adds `registry-provisional-value` on
   `boss-tw-1`. Relabel invariance: NOT achieved (Row C stopped) — seeds land
   on node 15 in both files but on Q10 (filed) vs Q8 (relabelled).
3. **(covered in Row C section above.)**
4. **Motion** (from `workbench` cwd, `COMPILER_ENTRY` → this worktree):
   filed file FLAT at both tones (0.01 / 0.00 dB p-p, LFO running at 1.233 Hz —
   Row A confirmed, Row C missing); negative control on installed 0.8.1 FLAT
   0.00 with a dead LFO; relabelled file MOTION 9.47 dB p-p (see motion
   section). The bar (MOTION on the filed file) cannot hold without Row C;
   the runs instead demonstrate the stop (details below).
5. **CHANGELOG**: Unreleased section carries all three rows (A, B, and the C
   stop) in release-note style; the Row B entry carries the provenance
   sentence verbatim in spirit, including "not a manufacturer curve".
6. **This report.**

`bun test tests`: 2255 pass / 50 skip / 6 fail — 5 pre-existing missing-wasm
(`v2_dsp.cjs` not built in this worktree) "agrees between the two consoles"
failures, plus `tests/package.test.ts` "pins the current package release and
changelog entry", which fails **by repo convention**: that test pins the top
CHANGELOG heading to the current release, and any feature branch carrying
entries breaks it until release prep re-pins (precedent: commit `02c2f23`
documents exactly this). Not touched — release prep owns the pin.

## Versioning

A compiler **minor** (new diagnostic code + new rail derivation + new
registry law: behaviour-adding, no `Program`/`Stamp`/wasm change), exactly as
the Row A patch headers it. The runtime needs a **republish with the new
compiler pin** (exact pin) and a regenerated kernel table: Row A swaps one
`boss-aw-2` fingerprint, Row B swaps `boss-aw-2` again plus one `boss-tw-1`
fingerprint. No `Program`, `Stamp`, `ProgramJson.cpp`, `Program.h`, or runtime
source change is needed.

## Motion runs (all self-check PASS; `held 0` throughout)

From `workbench` cwd, `COMPILER_ENTRY` → this worktree (`compiler PATCHED
runtime 0.6.3 (TS)`), `FIX`, VR1–VR4/RT1 0.5, `OPTO_LAW`/`RT1` unset:

- Filed file, tone 2000: **FLAT p-p 0.01 dB** (mean −0.66), mod 1.233 Hz
  (share 0.97). The LFO runs end to end (n83 4.281 V p-p at 1.233 Hz — Row A
  verified in situ) but the output does not sweep: the render stays on the dry
  path (Row C missing).
- Filed file, tone 3150: **FLAT p-p 0.00 dB** (mean −0.59), mod 1.233 Hz
  (share 0.97). Same signature.
- Negative control, filed file, no `COMPILER_ENTRY` (installed compiler 0.8.1):
  **FLAT p-p 0.00 dB** (mean −0.66); the LFO is dead (n83 p-p 0.000 V — IC5
  parked at the 0–9 V rails, pre-Row A). The instrument issues both verdicts.
- Stop evidence (extra): 15↔85-relabelled file + worktree compiler, tone 2000:
  **MOTION p-p 9.47 dB** (mean +11.99, min 6.24, max 15.71), mod 1.233 Hz
  (share 0.93). The ONLY difference from the filed run is which transistor the
  fallback seed lands on (Q8's base instead of Q10's) — the seed is the sole
  remaining defect, which is exactly what Row C's stop rule requires
  demonstrating. (Reference scratch: 7.89 dB at 2000 Hz, 8.77 dB at 3150 Hz;
  agreement within ~1.6 dB on the relabelled arm — same shape, hotter filter
  peak; the 3150 relabelled tone was not re-run since the 2000 arm already
  decides the stop.)
