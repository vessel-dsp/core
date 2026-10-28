# Release prep: compiler 0.18.0 / runtime 0.15.0 / chain 0.1.21 / player 0.2.19 (2026-10-28, rebased)

**Status: PREPARED, NOT PUSHED, NOT TAGGED.** Prepared 2026-10-28 on branch
`indiejoseph/core-4013-port` at the prep commit (see report): the 4013 port
commit was rebased onto origin/local main `db09bc7` (linear descendant;
`git log` shows `db09bc7` then the port), and the 0.18.0 prep redone fresh on
top -- the earlier `d853097` prep (based on `b51af06`) was NOT carried across:
its kernel table was regenerated from scratch and every figure below
re-measured. Built and verified in this worktree; evidence under
`/tmp/opencode/4013-rebase/` (A arm) and the prior task's
`/home/joseph/projects/VesselDSP/tmp/4013-port/` (B-reference scripts only).
Do not tag from any other state. Publication order is compiler, runtime,
chain, player (same as 0.17.0). No push, no tags, no publish; local core
main untouched (it has diverged with another session's work).

**Supersedes `compiler-v0.17.1`.** The tag `compiler-v0.17.1` was pushed at
`db09bc7` (registry waves 8-10 data, compiler `package.json` only) but its
npm publish FAILED (`bun install --frozen-lockfile`: "lockfile had
changes" -- chain, player and runtime still pinned `@vessel-dsp/compiler`
0.17.0 exactly, so the workspace no longer satisfied them). 0.17.1 was never
published. Its contents (waves 8-10, unchanged) ship here as compiler 0.18.0
with every exact `@vessel-dsp/*` pin consistent (chain 0.1.21, player 0.2.19,
runtime 0.15.0, core stays 0.17.0), and `bun install --frozen-lockfile`
passes in a fresh clone of the new head (see checklist).

## What ships (prepared; the owner may change the versions before any tag)

| package | from | to | why |
|---|---|---|---|
| core (`@vessel-dsp/core`) | 0.17.0 | -- (not bumped, not tagged) | `git log v0.17.0..HEAD -- packages/core/src` is empty: nothing changed since 0.17.0 |
| compiler | 0.17.1 | 0.18.0 | general `d-flip-flop` law (replaces toggle-only `logic-divider` on all 4013 registry entries), `MC14013BCP`/`MC14013B` aliases, 4013 pin 9/10 swap fix; new `DeviceKind`, `DeviceLaw` and `Stamp` members (public-API addition: minor). Includes the unpublished 0.17.1 contents (waves 8-10, unchanged from main) |
| runtime | 0.14.1 | 0.15.0 | exact compiler pin and the regenerated `GeneratedKernels.cpp`; `Program`/`Stamp` change on both consoles plus `ProgramJson.cpp`/`Program.h` (minor, kernels only beyond that) |
| chain | 0.1.20 | 0.1.21 | exact re-pin (compiler 0.18.0, runtime 0.15.0) |
| player | 0.2.18 | 0.2.19 | exact re-pin (chain 0.1.21, compiler 0.18.0, runtime 0.15.0) |

## What changed

Rebase of the 4013 port (`558dfcd`, cherry-picked from `0e453a1`) onto main
`db09bc7`. The rebase applied cleanly (no conflicts); part-catalog position
verified afterwards: the port's three converted entries (base
CD4013 set + MC14013BCP/B aliases with the 9/10 swap fix, CD4013AE/SCL4013A,
MC14013/CD4013) carry `d-flip-flop`, while the wave-9 CD4024BE entry and the
untouched uPD4013C6/uPD4013C1/4024 entries stay on `logic-divider`.
Behaviour identical to the `d853097` port; adapted to main's waves (no engine
or law changes needed -- waves are registry data).

- **General D flip-flop law** (same as the `d853097` port): async SET/RESET
  per the TI CD4013B / ON MC14013B datasheet truth table, parameterless with
  VDD/VSS riding the stamp, two aux rows + three state slots committed once
  per sample on both consoles.
- **Registry waves 8-10, unchanged from main** (owner direction -- they ship
  in this release): wave 8 op-amp GBW batch (MC1458P, CA3240EZ GBW rows;
  sections; 5 absent verdicts), wave 9 diode + silicon BJT trailing fill
  (1N5818, 1N4005/4006, 2N5087/2N2907A/2N4403/2N2222, MPSA06 IS-only, PN4124,
  BC546B) plus CD4024BE chained toggle-divider sections, wave 10 LED
  spelling aliases (RED, R, Y, B onto color rows).
- Classification stays on typed facts (part ids, section roles,
  connectivity): no name/description text matching was added. Tests and
  fixtures are the ported set (divider + three SR-latch controls),
  contract-level, no pedal-identity assertions.
- Coordinator review follow-ups (separate commit `12408fe`, before the prep):
  the wave-9 CD4024BE entry is removed (fixed-5 V high, rising-edge toggle
  on a falling-edge part, comment mirrored a law that is now d-flip-flop;
  the sections format cannot express a falling-edge chain -- Bit Commander
  becomes an honest unknown IC; future work is a real ripple-counter law
  with VDD-referenced output and falling-edge chain); the wave-10
  single-letter LED aliases R/Y/B are removed (RED kept; positional
  evidence only, and they would silently capture non-LED diode fields and
  suppress the diode-law-default warning); a new guard test in
  `tests/package.test.ts` requires every exact-pinned `@vessel-dsp/*`
  dependency to equal that package's current version (core keeps its
  blessed 0.6.16 legacy pin) -- the check that would have stopped
  `compiler-v0.17.1` (proven: fails on db09bc7's set with the three
  compiler@0.17.0-vs-0.17.1 mismatches, passes here). Neither removal moves
  a corpus program (verified: no artifacts `.vdsp` uses CD4024 or a bare
  R/Y/B part number; B exports byte-identical before/after).

## Evidence

Three arms on the same artifacts state (HEAD `da97fc07b` plus the working
tree: uncommitted OC-2 re-trace + fuzz-face edits; A-arm records its own
state file; live-checkout runs on both arms use the same files):
- **A** = `db09bc7` worktree (waves, no 4013): fresh build + exports + runs.
- **B** = the new head (waves + 4013): this worktree.
- **reference** = the earlier `d853097` numbers (port without waves).

Kernel table (regenerated with the release compiler over the committed HEAD
corpus, `git archive` of artifacts `da97fc07b`, 124 pedals + 23 amps,
`examples/` excluded): 139 kernels from 563 scheduled blocks (421 below the
64-op floor) -- same totals as the 0.17.0 and `d853097` tables; three
fingerprints churn vs the committed table:

- out: `0x092663a0`, `0x5ee0cbd6`, `0x754e02ad`
- in: `0x3fd9f68b` (electro-harmonix-slapback-echo), `0xd9e03051`
  (mxr-blue-box), `0x9c88dfdf` (mxr-m117r-flanger)

Attribution: per-packet fingerprints on the B arm list the in-set on those
three packets and the A arm lists the out-set on the same three
(slapback `0x092663a0`, blue-box `0x754e02ad`, m117r `0x5ee0cbd6`);
no other filed program moves (A->B table below). `git diff
db09bc7..HEAD --stat -- packages/runtime/src` is `GeneratedKernels.cpp` +
`Engine.cpp` + `ProgramJson.cpp` + `Program.h` + `reference-runtime.ts`: the
`Program`/`Stamp` change is the minor justification; beyond it only the
kernel table moves. Fresh-wasm TS-vs-WASM agreement 10/10 (see regression
table); B wasm sha256 `2bbea146...e737ce` (identical to the `d853097` wasm --
the engine sources are unchanged by the rebase).

## Program movers A->B (filed corpus)

Export every corpus program on both arms over the committed HEAD corpus;
byte-compare. A: 145 ok, 2 refused (`boss-dd-3t`, `sola-sound-mki-tone-bender`);
B: 145 ok, same 2 refused.
(`boss-dd-3t`, `sola-sound-mki-tone-bender`).

| packet | A `db09bc7` | B new head | attribution |
|---|---|---|---|
| `mxr-blue-box` | 2 `logic-divider` (fp `0x754e02ad`) | 2 `d-flip-flop` (fp `0xd9e03051`) | IC2: SET/RESET grounded, D=Qbar both halves, 1Q->2CLK cascade -- textbook divide-by-2/4 toggle |
| `mxr-m117r-flanger` | 2 `logic-divider` (fp `0x5ee0cbd6`) | 2 `d-flip-flop` (fp `0x9c88dfdf`) | U3: DATA1 tied to /Q1, RESET/SET/VSS at declared ground (node 1), CLOCK2 looped from Q1; VDD node 0 (+15 V rail) |
| `electro-harmonix-slapback-echo` | 2 `logic-divider` (fp `0x092663a0`) | 2 `d-flip-flop` (fp `0x3fd9f68b`) | IC3 first half DATA1 tied to /Q1, SET/RESET grounded; second half parked with SET2/DATA2/RESET2/CLOCK2 all on VDD |
| filed `boss-oc-2` | 2 `logic-divider`, byte-identical (fps `0x63ec0fb5 0x80e7ceac` both arms) | 2 `logic-divider` (IC7A/IC7B shells) | uPD4013C6 untouched; IC6 has empty terminals on both arms |
| `moogerfooger-mf-102` | 1 `logic-divider` (4024, fp `0x795e96ff` both arms) | 1 `logic-divider` (4024) | 4024 entry untouched; CD4024BE removed by the review follow-up (no corpus user) |

Expected: A->B movers are exactly the three 4013 packets above (reference
`d853097` measured 142 byte-identical + these 3). Each extra mover must be
explained.

## Program movers from the waves (b51af06 -> db09bc7, filed corpus)

Same export with the `b51af06` compiler (source-only worktree, no build
needed) vs the A arm, over the same HEAD archive. Exactly one mover:

| packet | b51af06 | A `db09bc7` | attribution |
|---|---|---|---|
| `electro-harmonix-small-stone` | 2 x bjt stamps IS 1e-14, BF 100 | same stamps IS 2.45e-15, BF 447.2135955 | wave-9 2N5087 row (BF 447.2 Fairchild bin, IS from Central card) on Q2_2N5087 (pnp preamp) |

144 of 145 byte-identical; the three 4013 filed packets are byte-identical
between b51af06 and db09bc7 (no law change from the waves). One registry-value
mover, no law change -- this is the unpublished 0.17.1 content.

## Workbench regression (A `db09bc7` vs B new head, fresh builds)

Both arms are fresh builds (`bun install --frozen-lockfile`, `build:wasm`
with system emcc, root `bun run build`), linked into the workbench main
checkout in place of its `cs-3-vca-ba718` links for the runs only (recorded
targets: `compiler` and `runtime` at
`../../../core/cs-3-vca-ba718/packages/...`, `core` a real dir, untouched).
Links restored afterwards and verified (`readlink` + `git status`). Corpus
for all runs: the live artifacts checkout (same files both arms). Caps: 900
s per shard; `moogerfooger-mf-102` skipped (hangs both arms, as before).

Both arms' runs complete (A first, then B after the links were restored);
logs under `/tmp/opencode/4013-rebase/` (`ratchet-A/B.log`,
`fixture-A/B.log`, `input-dep-{A,B}-shard-*.{log,json}`,
`wasm-parity-{A,B}.log`) and summaries `SUMMARY-A.md`/`SUMMARY-B.md`.

| run | A `db09bc7` | B new head | verdict / attribution |
|---|---|---|---|
| corpus ratchet | 144/147 compiling; EXIT 1 vs the stale 2026-09-18 baseline | 145/147 compiling; EXIT 1, same baseline | +1 compiling: `boss-oc-2` (the fix). EXIT 1 on both arms is the stale baseline, same as the 0.17.0 prep |
| ratchet codes | 38 codes, 1707 diagnostics | 38 codes, 1710 diagnostics | +3 diagnostics, all from the newly-compiling OC-2: `diode-law-default-parameters` 94 -> 95, `bjt-law-default-parameters` 50 -> 51, `opamp-law-default-parameters` 87 -> 88. Same 4 REGRESSED rows on both arms (`modulation-not-modelled` 19, `non-executable-clock-driver` 11, `opamp-operating-point-unbounded` 5, `throw-or-winding-unwired` 91) -- pre-existing vs the stale baseline. (A is one below control's 1708: wave-9 2N5087 row covers small-stone Q2, `bjt-law-default` 51 -> 50.) |
| fixture-parity `--self-check` | PASS, exit 0 | PASS, exit 0 | -- |
| input-dependence 6/6 shards | 122 rows, exit 0 x5; shard 2 `timeout 900` on mf-102, skipped | 122 rows, exit 0 x5; shard 2 `timeout 900` on mf-102, skipped | exactly one verdict mover: `boss-oc-2` `did not compile` -> `linear` (it now compiles and passes audio; the voice table above shows f/2 + f/4 dominance). All other 121 rows identical |
| wasm parity default 10 | 10/10 PASS, exit 0 | 10/10 PASS, exit 0 | TS-vs-WASM agreement holds on both arms' fresh wasm builds |

B live export (this worktree, rebased compiler): 145 ok / 2 refused
(`boss-dd-3t`, `sola-sound-mki-tone-bender`); `boss-oc-2` compiles with 4
`d-flip-flop` stamps (reference `d853097`: identical).

wasm-parity procedure (per 0.17.0): public sha256 `addfc38c...0c57` before
and after each arm (byte-identical restore, `git status` clean); A fresh
wasm `ff8c4fc0...0d68ba`; B fresh wasm `2bbea146...e737ce` (identical to the
`d853097` build -- engine sources unchanged by the rebase). Links restored to
`compiler -> ../../../core/cs-3-vca-ba718/packages/compiler`,
`runtime -> ../../../core/cs-3-vca-ba718/packages/runtime` (verified).

## OC-2 check on main (measured 2026-10-28, rebased branch)

- Artifacts working tree as is: HEAD `da97fc07b` plus the working tree
  (modified: CHANGELOG.md, boss-oc-2 BLOCKERS.md/README.md/source-boundary.md/
  service-note trace/taiwan-1999 photos doc/selected-scope results + .cir/
  node ledger/photo evidence, boss-oc-2.vdsp, dallas-arbiter-fuzz-face-ac128.vdsp;
  untracked: 7 boss-oc-2 Taiwan-1999 photos).
- The OC-2 packet **compiles** on this branch: status ok, 4 `d-flip-flop`
  stamps (IC6 FF1 divider + FF2 SR latch, IC7 FF1 divider + FF2 parked).
- D10/D11 stamp the 1S188FM registry values **5.4e-6 / 1.079 / 45.9**
  (D4/D5 at silicon defaults, as designed).
- 600 Hz voice renders, each voice alone at its stop (`-20` / `-30` dBm in):

| voice | rebased branch out (dom) | `d853097` / 0.9.0 study | owner unit |
|---|---|---|---|
| DIRECT | -18.52 / -28.51 (f) | -18.52 / -28.51 | -17.80 / -27.80 |
| OCT1 | -19.77 / -31.21 (f/2) | -19.77 / -31.21 | -18.74 / -29.92 |
| OCT2 | -21.91 / -35.53 (f/4) | -21.91 / -35.53 | -20.45 / -33.49 |

  Bit-identical to the study on all six cells: the waves moved nothing in
  this path (in particular wave-8 op-amp GBW rows: no voice difference).
  Probe: `tmp/4013-port/oc2-regcheck-018.ts` (study's `oc2-regcheck.ts`,
  imports repointed at the rebased worktree's dist; study scripts not edited).

## Checklist

1. npm holds core 0.17.0 and the last published set (compiler 0.17.0,
   runtime 0.14.1, chain 0.1.20, player 0.2.17 -- 0.17.1 never published).
   `git log v0.17.0..HEAD -- packages/core/src` is empty: core stays 0.17.0
   and is NOT bumped or tagged. `publish.yml` tag patterns and
   dependencies-published gates unchanged (empty diff `db09bc7..HEAD` over
   `.github/workflows`). PASS by inspection (empty diff).
2. A arm: fresh worktree at `db09bc7`, `bun install --frozen-lockfile`,
   `build:wasm`, root `bun run build` -- done (frozen install FAILED at
db09bc7, reproducing the CI failure; scratch build used plain install).
B arm (this
   worktree): frozen install passes (lock unchanged), `build:wasm` (system
   emcc) then root `bun run build` passes, `dist entrypoints` ok. PASS.
3. `git diff db09bc7..HEAD --stat -- packages/runtime/src` is the
   `Program`/`Stamp` change + kernels (see above). Compiler minor justified
   by the new `DeviceKind`/`DeviceLaw`/`Stamp` members; runtime minor by the
   same `Program`/`Stamp` change. PASS.
4. Exported 145 programs with the release compiler over HEAD artifacts
   (committed files only via git archive, 124 pedals + 23 amps, `examples/`
   excluded): 145 compile, 2 refused (`boss-dd-3t`,
   `sola-sound-mki-tone-bender` -- both refuse identically on the A arm).
   Regenerated: 139 kernels from 563 scheduled blocks; A-arm per-packet
   fingerprints confirm the out-set on the same three packets. PASS.
5. Corpus A/B, A `db09bc7` vs B new head: 145 compile on both arms;
   A-head vs B-head byte-compare gives exactly the 3 filed 4013 movers
   (142 byte-identical); waves cross-check (b51af06 vs A) gives exactly the
   1 small-stone mover. No unattributed mover. PASS. Workbench regression:
   see the table above.
6. Versions and exact pins bumped (compiler 0.18.0, runtime 0.15.0, chain
   0.1.21, player 0.2.19), `tests/package.test.ts` release metadata and
   `CHANGELOG.md` heading moved. Core's version, `VERSION` constant and the
   stompbox core pin untouched (already 0.17.0). Fresh-clone checks: PASS
   (see below).
7. Commit the prep on `indiejoseph/core-4013-port`. **No push, no tags:
   the owner authorises the publish separately.**
8. Local core `main` -- NOT TOUCHED (another session's uncommitted edits).
   **No push.**

## Fresh-clone verification (the exact CI check that failed 0.17.1)

Fresh clone of the new head to `/tmp/opencode/4013-rebase/fresh-clone`
(re-verified on the amended head `bf3dc43` in `fresh-clone-2`: frozen install
PASS with the lockfile untouched, guard test PASS)
(outside any worktree nesting, so no stale-dist resolution):
- `bun install --frozen-lockfile`: PASS (411 packages) -- this is the check
  that failed for `compiler-v0.17.1`; the consistent 0.18.0 pins fix it.
  (A-arm note: frozen install FAILS at `db09bc7` itself, reproducing the CI
  failure; the scratch arm-a worktree used plain `bun install`.)
- `bun run typecheck`: PASS. `bun run build`: PASS (`dist entrypoints ok`)
  after the prerequisite `bun run --cwd packages/runtime build:wasm`
  (the wasm is a gitignored build output; root `build` copies
  `src/wasm` and fails without it -- same as the 0.17.0 prep, which ran
  `build:wasm` first; `deploy.yml` lists install/typecheck/build/test/pages
  with no explicit wasm step).
- `bun test`: 2414 pass / 3 fail of 2417 -- all three fail by the 5 s
  timeout only (Belton brick level/decay, 2 x dbx-vca session curves);
  each passes in isolation in the same clone (dbx-vca file 47/47, brick
  outputGain cell green), i.e. load flakes, not regressions. The extra test
  vs the worktree runs is the new workspace-pin guard.
- `bun run build:pages`: PASS (935 pages).
- Bun version note: CI pins bun 1.2.2 (`oven-sh/setup-bun@v2`,
  root `packageManager: bun@1.2.2`); only bun 1.3.14 is installed here, so
  all of the above ran under 1.3.14. The 1.2.2 leg is unverified locally.
