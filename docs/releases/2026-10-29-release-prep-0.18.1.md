# Release prep: compiler 0.18.1 / runtime 0.15.1 / chain 0.1.22 / player 0.2.20 (2026-10-29, latch-side fix)

**Status: PREPARED, NOT PUSHED, NOT TAGGED.** Prepared 2026-10-29 on branch
`indiejoseph/core-release-0181` at the prep commit (see report): the latch-side
derivation commit `74ce1b4` plus this prep. Built and verified in this worktree.
Do not tag from any other state. Publication order is compiler, runtime,
chain, player (same as 0.18.0). No push, no tags, no publish; local core
main untouched (another session has uncommitted work there).

## What ships (prepared; the owner may change the versions before any tag)

| package | from | to | why |
|---|---|---|---|
| core (`@vessel-dsp/core`) | 0.17.0 | -- (not bumped, not tagged) | `git log v0.17.0..HEAD -- packages/core/src` is empty: nothing changed since 0.17.0 |
| compiler | 0.18.0 | 0.18.1 | latch engaged-side derivation: effect-status-LED vote walks pure series R/diode chains, flood rails expand one diode hop (both general connectivity rules, no names/part numbers); 11 new tests in `latch-seed.test.ts` |
| runtime | 0.15.0 | 0.15.1 | exact compiler pin; kernel table regenerated from scratch with this compiler (byte-identical: no block churn) |
| chain | 0.1.21 | 0.1.22 | exact re-pin (compiler 0.18.1, runtime 0.15.1) |
| player | 0.2.19 | 0.2.20 | exact re-pin (chain 0.1.22, compiler 0.18.1, runtime 0.15.1) |

## What changed

One fix commit since the published 0.18.0 (`74ce1b4`, write-up
`docs/releases/2026-10-29-latch-side-derivation.md`): `findBistableLatches`
fell back to the lower base node id on 16 of 23 corpus latch packets.
(a) The LED vote now walks pure series R/diode chains between an LED terminal
and a latch collector (degree-2 interiors, LED device itself never a link,
anode-side single-resistor walks still excluded as shared-supply shape);
cathode-side chain votes that member ON, anode-side votes the other member.
(b) The flood expands rails by one diode hop with indicators excluded, while
candidacy keeps the structural rails. Precedence unchanged (connectivity, then
LED, then fallback); `latch-engaged-disagrees` untouched (fires nowhere).

Census 4/3/16 before to 7 derived after: BD-2 x2 and OC-2 flip to the LED
side, MT-2 and DS-1 derive by connectivity (MT-2 flips side), DS-2 confirms by
LED on the same side. The 7 previously derived latches keep their sides.

Two corrections to the fix write-up, measured for this prep (see §Evidence):
BD-2 bypassed CHECK current is 21.2 uA against 4.86 mA engaged (~0.4 %), not
"1e-8"; LM-2 bypassed is 29.6 uA against 5.84 mA engaged (~0.5 %), not "1e-8".
Both still dark. The "no solution downhill" circuit argument is dropped; the
settled diode-law figures stand in its place.

## Evidence

Kernel table: regenerated from scratch with the release compiler over the
committed HEAD corpus (`git archive` of artifacts `da97fc07b`, 124 pedals +
23 amps, `examples/` excluded): 139 kernels from 563 scheduled blocks
(421 below the 64-op floor) -- byte-identical to the committed 0.18.0 table
(`git diff HEAD -- packages/runtime/src/cpp/GeneratedKernels.cpp` empty, so
the runtime bump is a patch on the exact pin only). Procedure: throwaway
detached workbench worktree at `c9c20be7`, `bun install`, its
`node_modules/@vessel-dsp/compiler` replaced by a symlink to this worktree's
built `packages/compiler` (restored afterwards), `generate-all-catalogs.ts`
from cwd `tmp/wb` against a `tmp/artifacts` symlink to the throwaway detached
artifacts worktree at `da97fc07b` (canonical checkout dirty, never read for
the kernel table), `export-programs.ts --out=tmp/programs-B` (145 programs),
`generate-kernels.ts --programs=tmp/programs-B`. Fresh wasm `2bbea146...c737ce`
(identical to the 0.18.0 build -- engine sources unchanged).

### LED re-measurements (this prep, settled, ReferenceRuntime 48 kHz, inputSourceOhms 134, 3 s silence)

Driver: `tmp/led-measure.ts` (compile with `pedalPartCatalog`, set the
footswitch control, settle, read Vak from `nodeVoltageSnapshot`, current from
the stamped diode law `Is*(exp(Vak/(n*Vt))-1)`): `bun tmp/led-measure.ts
tmp/ab/schematics/vessel-dsp/<packet>.vdsp <control> <engaged>,<bypassed>`,
over the clean artifacts worktree. The harness was scratch (removed at the
end); the figures are transcribed here.

| packet | engaged | bypassed | ratio |
|---|---|---|---|
| boss-bd-2-blues-driver (SW1) | Vak 1.954 V, 4.86 mA | Vak 1.478 V, 21.2 uA | ~0.4 % -- dark |
| boss-bd-2-blues-driver-keeley-mod (SW1) | Vak 1.954 V, 4.86 mA | Vak 1.478 V, 21.2 uA | ~0.4 % -- dark |
| boss-lm-2 (EFFECT_FOOTSWITCH) | Vak 1.970 V, 5.84 mA | Vak 1.507 V, 29.6 uA | ~0.5 % -- dark |

Both builds of BD-2 identical to the microamp. Coordinator's spot check
(22 uA vs 4.4 mA, ~0.5 %) agrees within rounding.

### Program movers A/B (A = `6844c3b` published 0.18.0, B = this prep head, same clean artifacts `da97fc07b`)

Driver: `tmp/export-digest.ts` (compile every corpus `.vdsp` with
`pedalPartCatalog`, `emit` program JSON, sha256; A arm imports the compiler
from `git archive 6844c3b packages/compiler/src`, core resolves to this tree
and is byte-identical there since v0.17.0). 122/124 pedals + 23/23 amps
compile on both arms; refused both arms: `boss-dd-3t`,
`sola-sound-mki-tone-bender`. Exactly 4 movers, zero warning-code changes,
zero status movers -- the fix census exactly, no STOP:

| packet | A `6844c3b` | B prep head | attribution |
|---|---|---|---|
| boss-bd-2-blues-driver | seed node 32 | seed node 51; 2 steering stamps swap rows | LED side flip (Q15 -> Q16); schedule identical, lengths equal |
| boss-bd-2-blues-driver-keeley-mod | seed node 32 | seed node 51; same swap | same |
| boss-ds-1 | `controls[0].defaultPosition` 0 | 1 only; seeds/stamps identical | connectivity-derived latch steers: rests engaged |
| boss-mt-2 | seed node 69, default 0 | seed node 71; 2 steering stamps swap rows; default 1 | connectivity derivation flips side (Q005 -> Q006) and rests engaged |

`boss-oc-2` compiles on both arms and is byte-identical (`d7f5a0c98ef834bb`);
`boss-ds-2` byte-identical (`4112caaa90c5f048`, same side same seed, as the fix
note states). The OC-2 side flip of the census shows on the uncommitted live
re-trace the fix note measured, not on the filed packet at this artifacts
state -- anticipated in the task brief, not a mover. Footswitch/latch default
changes: DS-1 `SW1` 0->1 and MT-2 `SW_EFFECT` 0->1, no others.

### Workbench regression (fresh builds, B arm only -- A arm is the published 0.18.0 by digest)

Full root `bun test` after all scratch is removed: **2428 pass / 0 fail**
(160 files), including the release-pin guard test. An earlier mid-prep run
showed 2519/5 -- all five were the prep's own scratch (`tmp/wb` workbench
suites filed from the throwaway plus the repo-wide scan timing out over
70k scratch files), gone with the scratch. Compiler suite: 706/0.
`bun run typecheck` clean at root and in compiler/runtime/chain/player.

### TS-vs-WASM parity (workbench throwaway, wasm swapped to this build and restored byte-identically)

Public `src/web/public/v2_dsp.wasm` hash `addfc38c...0fa0f` before and after
(byte-identical restore, `git status` shows only the regenerated tracked
catalogs inside the throwaway, which dies with it). Arm links replaced by
symlinks to this worktree's built compiler+runtime for the runs only, npm
directories restored afterwards (verified by listing). Corpus for all runs:
the clean artifacts worktree (same files as the kernel table).

| run | result |
|---|---|
| default 10 | 10/10 PASS, r = 1.000000 throughout |
| boss-bd-2-blues-driver | PASS r = 1.000000, maxDelta 1.411e-12 |
| boss-bd-2-blues-driver-keeley-mod | PASS r = 1.000000, maxDelta 1.499e-12 |
| boss-mt-2 | PASS r = 1.000000, maxDelta 3.254e-9 |
| boss-oc-2 | PASS r = 1.000000, maxDelta 0.000e+0 |

`report:fixture-parity --self-check`: PASS, exit 0 (same throwaway, linked compiler).

### Player browser proofs (NODE_PATH = the workbench throwaway's node_modules for playwright-core)

`packages/player/scripts/player-proof.ts`: PASS (four legs incl. pedal+IR and
pedal+NAM; 0 new overruns throughout; pre-click zero wasm/worklet requests).
`next-bundle-proof.ts`: NOT RUN to a pass (coordinator direction
proceed-documented, 2026-10-29): the script hard-requires website
`apps/blog/src/components/figures/LivePlayer.tsx`, which does not exist in
the website checkout (the blog uses `EmbedPlayer.tsx`; `LivePlayer.tsx` never
existed in website history; script untouched since 2026-10-04). The 0.17.0
and 0.18.0 preps did not run it either. `npm pack` of all five bumped
tarballs succeeded (the proof's step 2, run before the step-3 failure), and
the player change in this release is the version pin only -- no player
source moves (`git diff 6844c3b..HEAD -- packages/player/src` empty). The
proof script was not edited.

### Fresh-clone verification (of the prep commit `52a06ce`)

Fresh clone to `tmp/fresh` (outside any worktree nesting), checkout the prep
commit: `bun install --frozen-lockfile` PASS (411 packages -- the check that
failed for `compiler-v0.17.1`); `build:wasm` (system emcc 6.0.4) then root
`bun run build` PASS, `dist entrypoints ok`; `bun run typecheck` PASS;
`bun test` **2428 pass / 0 fail** (160 files); `bun run build:pages` PASS
(935 pages). Bun 1.3.14 throughout (CI pins 1.2.2, unverified locally -- same
as the 0.18.0 prep). The scratch clone was removed after verification.

## Checklist

1. npm holds core 0.17.0 and the last published set (compiler 0.18.0,
   runtime 0.15.0, chain 0.1.21, player 0.2.19). `git log v0.17.0..HEAD --
   packages/core/src` is empty: core stays 0.17.0 and is NOT bumped or tagged.
   `publish.yml` tag patterns and dependencies-published gates unchanged (empty
   diff `6844c3b..HEAD` over `.github/workflows`). PASS by inspection
   (empty diff -- verified during prep).
2. This worktree: `bun install` (lockfile unchanged), `build:wasm` (system
   emcc 6.0.4) then root `bun run build` passes, `dist entrypoints` ok. PASS.
3. `git diff 6844c3b..HEAD --stat -- packages/runtime/src` is `package.json`
   only: exact compiler pin, no `Program`/`Stamp` change, kernel table
   regenerated byte-identical. Hence a runtime patch. Compiler patch justified
   by the latch derivation behaviour change with 11 new tests; chain/player
   patches are exact re-pins. PASS.
4. Exported 145 programs with the release compiler over HEAD artifacts
   (committed files only via git archive, 124 pedals + 23 amps, `examples/`
   excluded): 145 compile, 2 refused (`boss-dd-3t`,
   `sola-sound-mki-tone-bender` -- both refuse identically on the A arm).
   Regenerated: 139 kernels from 563 scheduled blocks; A-arm vs B-arm digest
   compare gives exactly the 4 fix-census movers. PASS.
5. Corpus A/B, A `6844c3b` vs B prep head: exactly the 4 movers above, zero
   warning changes, zero status movers. No unattributed mover. PASS.
   Workbench regression: see the table above.
6. Versions and exact pins bumped (compiler 0.18.1, runtime 0.15.1, chain
   0.1.22, player 0.2.20), `tests/package.test.ts` release metadata and
   `CHANGELOG.md` heading moved. Core's version, `VERSION` constant and the
   stompbox core pin untouched (already 0.17.0). Fresh-clone checks: PASS
   (see below).
7. Commit the prep on `indiejoseph/core-release-0181`. **No push, no tags:
   the owner authorises the publish separately.**
8. Local core `main` -- NOT TOUCHED (another session's uncommitted edits).
   **No push.**
