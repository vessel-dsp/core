# Release prep: compiler 0.17.0 / runtime 0.14.1 / chain 0.1.20 / player 0.2.18 (2026-10-28)

**Status: PREPARED, NOT PUSHED, NOT TAGGED.** Prepared 2026-10-28 on branch
`indiejoseph/core-1s188fm-release` at the prep commit (see report): the branch
was rebased onto local main `162a878` (registry wave 7), so it now holds
`e952b66` + `162a878` (wave 7, another session's work, taken as-is), `77e65d4`
(the `diode-1s188fm` branch's `74f101b`) and the prep commit below. Built and verified in a fresh clone at
`/home/joseph/projects/VesselDSP/tmp/1s188fm-release/clone`; evidence under
`/home/joseph/projects/VesselDSP/tmp/1s188fm-release/` (deleted at the end
per the scratch-dir rule, figures below kept in this note). Do not tag from
any other state. Publication order is compiler, runtime, chain, player
(`publish.yml` has a dependencies-published gate for chain, runtime and
player but none for the compiler, so the compiler must not go before its
dependencies are ready -- same order as 0.9.0, minus core which does not ship
here).

## What ships (prepared; the owner may change the versions before any tag)

| package | from | to | why |
|---|---|---|---|
| core (`@vessel-dsp/core`) | 0.17.0 | -- (not bumped, not tagged) | `git log v0.17.0..HEAD -- packages/core/src` is empty: nothing changed since 0.17.0 |
| compiler | 0.16.0 | 0.17.0 | measured 1S188FM record (IS/n/Rs) plus alias `1S-188FM`; new `diode-law-default-parameters` warning, a new member of the exported `CompileWarning` union (public-API addition: minor) |
| runtime | 0.14.0 | 0.14.1 | exact compiler pin and the regenerated `GeneratedKernels.cpp`; no `Program`, `Stamp`, `ProgramJson.cpp` or `Program.h` change (patch, kernels only) |
| chain | 0.1.19 | 0.1.20 | exact re-pin (compiler 0.17.0, runtime 0.14.1) |
| player | 0.2.17 | 0.2.18 | exact re-pin (chain 0.1.20, compiler 0.17.0, runtime 0.14.1) |

## What changed

- Registry: one `measured`-basis record, `1S188FM`, with alias `1S-188FM`
  (`packages/compiler/src/registry-data/diode.ts`). Owner bench 2026-10-28:
  D10 and D11 (1S188FM) of Boss OC-2 JP 07556 (Taiwan ~1999) in circuit with
  the board unpowered, UNI-T UT107 (V_D on the 2 V range, 1 mV; V_R on the
  20 V range, 10 mV); 9 V alkaline at 9.52 V start and end; series R metered
  (10.07k, 47.2k, 98.3k, 0.30 M); 18 C; 47k parallel path (R45 through the
  conducting Q8) corrected; fit 30 uA to 0.92 mA, max log residual 0.007
  (upper three points); 2 samples; pooled IS+n+Rs refit at the engine VT
  0.025852 V: IS 5.4e-6, n 1.079, Rs 45.9 (per-sample D10 5.89e-6/1.0813/44.6,
  D11 4.96e-6/1.0759/47.1; row is the arithmetic mean). Anchors 0.182/0.188 V
  at 0.92 mA, 0.052/0.056 V at 30 uA. Three parameters from four points per
  diode, so n and Rs are correlated and the 300k point is interval-carried:
  the row is anchored from ~87 uA up, extrapolation below ~30 uA unvalidated,
  and Rs carries ~40 mV of 182 mV at the top point (kept, not defaulted).
- Diagnostics: `diode-law-default-parameters` (`types.ts`, `compile.ts`)
  names every unregistered, undeclared, non-LED diode with the default it
  took (IS 2.52e-9 A, N 1.752, RS 1.0 ohm) -- the diode member of the
  bjt/opamp default-warning family. LEDs stay on their colour defaults;
  zeners and tube diodes never reach the finder.
- Deliberate omission: `1SS-188FM` (boss-ds-2 D14/D15) is NOT registered.
  The DS-2 source prints it in the silicon-prefix family beside 1SS-133 with
  no Ge mark, while the OC-2 legend distinguishes Ge 1S-188FM from silicon
  1SS133; giving the DS-2 clip pair a 182 mV Ge knee on a spelling guess
  would re-voice that pedal, so it keeps the silicon default loudly until a
  DS-2 unit is measured.
- Registry wave 7 (owner decision: ships in this release; another session's
  commits `e952b66` + `162a878`, taken as-is, no content changed here):
  germanium BJT fill (OC75 BF 90, OC81D BF 60 from Mullard Pocket Data Book
  TYPs; AC176 BF 111.8 Siemens B-bin geomean; 2N1308 IS-only 6.31e-7 from
  Central VBE(sat) range midpoint with the silicon-bias caveat; NKT275 stays
  out) plus top-up (PN2222A BF-only 173.2, sole bin at 150 mA disclosed
  off-operating-point; BF244A full JFET channel, IDSS/VGSoff range midpoints,
  Beta 2.35e-4 square law; MPSA06 and 1N5711/5818/4005/6 stay out).

## Evidence

- Owner bench file:
  `workbench packet-study/boss-oc-2/capture/d10-iv/2026-10-28-d10-d11-iv.json`
  (read from the `boss-oc-2-packet-study` worktree; workbench itself
  untouched), sha256
  `a28f4ad8df940a8df98490600956eeeb207693cd907444a4709117db0ea75b7a`
  (verified by re-hash before writing this note).
- Census: `diode-law-default-parameters` fires on 94 packets / 424 devices,
  measured with this compiler over the live artifacts checkout (which carries
  the in-progress OC-2 re-trace that refuses -- next row). On committed HEAD
  it fires on 95 / 426; the extra packet is the filed `boss-oc-2` itself (2
  devices: D8/D9 1SS133 silicon). Filed OC-2's D10/D11 (the `1S-188FM`
  spelling) take the new measured record and leave the warning.
- OC-2 does not compile on main in the study's sense. The in-progress OC-2
  re-trace in the live artifacts checkout refuses at `device-laws`: IC6
  `MC14013BCP` (and IC7) matched no registry entry -- the 4013 law from
  `oc2-4013-090` is not ported by this release, and per the brief nothing in
  this release ports it. The filed (committed) `boss-oc-2` still compiles,
  but both 4013 divider regions (analog:5, analog:6) are unexecuted
  (`unexecuted-active-region`) and render nothing.
- Programs using 1S188FM change by design; wave 7 refuses one packet; the
  default path is otherwise untouched. Measured against the published 0.16.0
  (`79e6dc8`) over the committed HEAD corpus (committed files only via git
  archive, 147 documents): 146 compile on the 0.16.0 arm (`boss-dd-3t`
  refused), 145 on the release arm (`boss-dd-3t` plus one more, below); 144
  programs byte-identical. Two text movers, both diode stamps from the
  1S188FM entry -- `boss-hm-2` (D6/D7) and `boss-lm-2` (D14): IS 2.52e-9 to
  5.4e-6, n 1.752 to 1.079, Rs 1 to 45.9. `boss-ps-2` names 1S188FM at ET_D2
  but that diode is unconnected source-evidence inventory (empty terminals,
  never stamped), so its program is byte-identical. No schedule moves from
  either addition on filed packets: per-packet kernel fingerprints are
  identical with and without each. One compile-status mover, from wave 7:
  `sola-sound-mki-tone-bender` now refuses at `device-laws` (Q1
  `DeviceOverride kind "custom"` on part OC75, "which the registry already
  has"). The packet needs an artifacts-side fix (override kind `measured`,
  or remove the block); until then it is out of the kernel table. No
  unattributed ("neither") mover.

## Kernel table (regenerated, runtime patch justified)

The committed table was last generated at the 0.9.0 prep (artifacts
8fd6c8a6, 140 kernels from 562 blocks). Regenerated with the release
compiler (wave 7 + diode entry) over the HEAD corpus: 139 kernels from 563
scheduled blocks (421 below the 64-op floor). Four fingerprints out --
`0x8829acc6` (oc-2 old trace), `0xa67ccb1f`, `0xcdf3c73a` (the 0.9.0-era
cs-3/lm-2 schedules), and `0xbebc9ffa` (the refused mki-tone-bender's only
kernel) -- and three in -- `0x2cc049fd` (lm-2 current), `0xcbc73add` (cs-3
v1.2/v1.3 re-trace), `0x63ec0fb5` (oc-2 re-trace). Attribution, all measured:
exporting the 8fd6c8a6 corpus with the 0.16.0 compiler already yields the two
new cs-3/lm-2 fingerprints (and per-packet fingerprints are identical with
and without each addition on both corpora), so that churn comes from the
dbx-vca v1-to-v6+H1 revisions that landed since 0.9.0, not from either
addition; the cs-3/oc-2 `.vdsp` files differ between 8fd6c8a6 and HEAD, so
that churn is the two re-traces; the mki drop is wave 7's OC75 record
meeting the packet's stale `custom` override (above). `git diff 79e6dc8..
HEAD -- packages/runtime/src` is empty apart from `GeneratedKernels.cpp`
itself (no `Program`/`Stamp`/`ProgramJson.cpp`/`Program.h` change), hence
the runtime patch; the exact compiler pin moves to 0.17.0. Outputs are
bit-identical with and without the regenerated table only where programs
are unchanged; hm-2/lm-2 render from the new diode values on both consoles
(not measured against hardware here).

## Checklist (the 0.9.0 sequence; every row measured 2026-10-28)

1. npm holds core 0.17.0, compiler 0.16.0, runtime 0.14.0, chain 0.1.19,
   player 0.2.17 (assumed from the 0.16.0 line; the owner publishes, so no
   tag or publish step runs here). `git log v0.17.0..HEAD --
   packages/core/src` is empty: core stays 0.17.0 and is NOT bumped or
   tagged. `publish.yml` tag patterns and dependencies-published gates
   unchanged (empty diff over `.github/workflows`). PASS by inspection.
2. Fresh clone of `indiejoseph/core-1s188fm-release` at the prep commit to a
   scratch dir outside core (the worktree nests inside the main checkout and
   would resolve its stale `node_modules`/`dist`). `bun install
   --frozen-lockfile` passes (the bumped versions leave `bun.lock`
   unchanged); `build:wasm` (emcc 6.0.4 from
   `/home/joseph/projects/emsdk/upstream/emscripten`) then root `bun run
   build` passes, `dist entrypoints` ok. PASS -- see report.
3. `git diff 79e6dc8..HEAD --stat -- packages/runtime/src` is
   `GeneratedKernels.cpp` only: no `Program`/`Stamp` change. Minor release
   for the compiler justified by the new `CompileWarning` union member
   (public-API addition; no docs state a warning-code addition is a patch).
   PASS.
4. Exported 145 programs with the release compiler over HEAD artifacts
   (committed files only via git archive; 124 pedals + 23 amps;
   `examples/` excluded as in 0.9.0; `boss-dd-3t` refused, plus
   `sola-sound-mki-tone-bender` refused by wave 7's OC75 record) and
   regenerated: 139 kernels from 563 scheduled blocks (committed 0.9.0
   table 140 from 562). Fingerprint moves and program movers as listed
   above (hm-2/lm-2 diode stamps; mki refusal). PASS.
5. Corpus A/B, published 0.16.0 (`79e6dc8`) vs release head over the HEAD
   corpus: 146 compile on the 0.16.0 arm, 145 on the release arm
   (dd-3t refused on both, mki refused on release only); 144 programs
   byte-identical, 2 differ (hm-2 D6/D7, lm-2 D14, diode stamps only).
   No unattributed mover. Workbench regression (control vs modified
   fresh builds): see the regression table below.
6. Versions and exact pins bumped (compiler 0.17.0, runtime 0.14.1, chain
   0.1.20, player 0.2.18), `tests/package.test.ts` release metadata and
   `CHANGELOG.md` heading moved to
   `## compiler 0.17.0 / runtime 0.14.1 / chain 0.1.20 / player 0.2.18`.
   Core's version, `VERSION` constant and the stompbox core pin are untouched
   (already 0.17.0; the contract test requires no change). Fresh-clone
   checks at the release head (new clone outside core, `bun install
   --frozen-lockfile`, `build:wasm` emcc 6.0.4, root `bun run build`,
   typecheck exit 0, `bun run typecheck`): full `bun test` 2420 pass, 2
   fail -- both the pre-existing appearance tests below, named and evidenced
   on pristine bases; `pack --dry-run` passes for all four bumped packages
   (compiler 0.17.0, runtime 0.14.1, chain 0.1.20, player 0.2.18). PASS with
   the two known pre-existing failures.
7. Commit the prep on `indiejoseph/core-1s188fm-release`. **No push, no
   tags: the owner authorises the publish separately.**
8. Fast-forward local core `main` to the release commit (recorded `status
   --short` first; any overlap refuses without touching the tree). **No
   push.**

## Appearance tests (pre-existing failures, evidenced)

Full-suite green except `tests/appearance/corpus-integration.test.ts`:
`stompbox appearance corpus integration > parses all 121 pedal appearance
blocks without errors` (4 content rows, all invalid colours in the live
artifacts: boss-ce-2b + boss-ch-1 `invalid defaults.label.color`,
mxr-phase-90-early-block + mxr-phase-90-script `invalid enclosure.color` and
`invalid defaults.label.color`) and `> Boss CE-2
appearance matches corrected blue (not grey)` (expects `#5ca8d4`, live
`boss-ce-2.vdsp` carries `#59B1E6`). Neither touches this release's files.
Fresh-clone runs, same 7 pass / 2 fail on all three: pristine `79e6dc8`,
local main `162a878`, and the release head -- i.e. failing on main with and
without this release.

## Workbench regression (control `79e6dc8` vs modified release head, fresh builds)

Both arms are fresh clones with `bun install --frozen-lockfile`,
`build:wasm` (emcc 6.0.4) and root `bun run build`, linked into the workbench
main checkout in place of its `cs-3-vca-ba718` links for the runs only
(recorded targets: `compiler` and `runtime` at
`../../../core/cs-3-vca-ba718/packages/...`, `core` a real dir, untouched).
Links restored afterwards and verified (`readlink` + `git status` clean apart
from the other session's pre-existing `bun.lock`/`package.json` mods).
Corpus for all runs: the live artifacts checkout (dirty: uncommitted OC-2
re-trace + fuzz-face edits), identical for both arms. Caps: 900 s per shard;
`moogerfooger-mf-102` skipped per the brief (shard 2, hangs both arms).

| run | control `79e6dc8` | modified release head | verdict / attribution |
|---|---|---|---|
| corpus ratchet | 145/147 compiling; EXIT 1 vs the stale 2026-09-18 baseline | 144/147; EXIT 1, same baseline | -1 compiling: mki-tone-bender refuses (wave 7, OC75 record vs packet `custom` override). The EXIT 1 on both arms is the stale baseline (corpus drift since September), not this release |
| ratchet codes | 38 codes, 1617 diagnostics | 39 codes, 1708 diagnostics | +`diode-law-default-parameters` 94 (the new warning); `registry-override-applied` 21 -> 18 (mki's Q1/Q2/Q3 override notices gone with its refusal -- wave 7); every other code identical |
| fixture-parity `--self-check` | PASS | PASS | -- |
| input-dependence 6/6 shards | 123 verdicts; shard 2 minus mf-102 (timeout, skipped) | 123 verdicts; same skip | exactly one verdict mover: mki-tone-bender `limiting` -> `did not compile` (wave 7). hm-2/lm-2 verdicts identical (`compressing` / `inaudible (escalated)`); no slope mover |
| wasm parity default 10 | 10/10 PASS (r=1.000000 throughout) | 10/10 PASS | TS-vs-WASM agreement holds on both arms' fresh wasm builds |

wasm-parity procedure (per coordinator direction): the harness's
`assertWasmBuildCurrent` refuses unless the linked runtime's `dist/wasm`
hash-matches the workbench's committed `src/web/public/v2_dsp.wasm`, which
cannot hold for fresh builds by design (control `9226241e...`,
modified `ff8c4fc0...`, public `addfc38c...`). For each arm's run the arm's
fresh `dist/wasm/v2_dsp.wasm` was copied over the public file, the run made,
and the original restored and proven byte-identical by hash (`addfc38c...`
before and after, both arms). The swap lived only for the two runs; no other
workbench file was touched.

## Not measured

Non-default controls and switch states, oversample above 1, real-time cost
(no worklet scoreboard), a guitar take, ngspice for the 1S188FM record
(two samples, one unit, one temperature; the record says what it covers),
whether hm-2/lm-2 are closer to hardware, the 12 `examples/` documents
(excluded from the corpus as in 0.9.0), and a 3 s window.
