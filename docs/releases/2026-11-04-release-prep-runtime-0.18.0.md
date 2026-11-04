# Release prep: core 0.19.0 / compiler 0.22.0 / runtime 0.18.0 / chain 0.1.27 / player 0.2.25 (2026-11-04, stamp-overhead runtime cut)

**Status: PREPARED (versions final). Publish by tag from main, one tag at a time, in the order below.**
Prepared 2026-11-04 on branch `indiejoseph/release-0180` at `531fde4` (plus this
note): origin main `128797a` (the 0.22.0 release record) plus two commits, verified in the same clone (control run before any
edit, gates below). Core 0.19.0 and compiler 0.22.0 unchanged, not tagged; stompbox unchanged.

## What ships

| package | from | to | why |
|---|---|---|---|
| core (`@vessel-dsp/core`) | 0.19.0 | 0.19.0 (unchanged) | no change; not tagged |
| compiler | 0.22.0 | 0.22.0 (unchanged) | untouched; not tagged |
| runtime | 0.17.0 | 0.18.0 | stamp-overhead cut (commits A + B below); adds `Stamp::macroBlockIndex` (runtime cache, never serialized); exact compiler pin stays 0.22.0 |
| chain | 0.1.26 | 0.1.27 | exact re-pin (compiler 0.22.0, core 0.19.0, runtime 0.18.0) |
| player | 0.2.24 | 0.2.25 | no source change; exact re-pin (chain 0.1.27, compiler 0.22.0, core 0.19.0, runtime 0.18.0) |
| stompbox | 0.6.17 (unchanged) | -- | exact `@vessel-dsp/core` pin stays 0.19.0 |

## What changed

Two commits on top of origin main `128797a` (workbench board-p2 row 15), plus the versions/changelog/prep-note commit:

- Commit A (`b8b82c4` upstream): every per-call string/`unordered_map` lookup in `applyStamp` and the per-sample advance path becomes a prepare-indexed `BlockScratch` slot -- diode/bjt/fet/triode(+pentode)/opamp histories, the op-amp raw pole state, the divider/DFF/dbx/compandor/clock once-per-sample guards, the spring tank state, the macro publish and the tap state, the composed side tables (line maps, filter/pitch/tracker pointers, router/audioIn/mod/param/clockLaw block indices, `composedTemps`/`pitchWindow` reuse buffers); the map fallback path is deleted, not kept beside the slots. The redundant second op-amp `tanh(clamp(...))` is dropped (`boundOpAmpRaw` clamps raw to +/-8 halfSwings so the second clamp is the identity), with a test pinning the identity. Adds `Stamp::macroBlockIndex` to `packages/runtime/src/cpp/include/v2/Program.h` (a runtime cache resolved at prepare, never serialized). No per-packet or per-kind special-casing; no approximation.
- Commit B (`0a425a5` upstream): the per-call libm `tanh` sites on the op-amp/OTA audio path become `tanhOneExp`, `tanh(x) = 1 - 2/(1 + exp(2x))`, one shared helper per console with a large-|x| guard returning exactly +/-1 past x = 354; the OTA slope uses `sech^2 = 1 - tanh^2` of the same value instead of a separate `cosh` call. Triode/pentode `atan` laws and the seeding `atanh` untouched. Same function, one rounding apart at most.
- Measured first, then dropped: a Lambert-W warm start from the previous Newton iteration's w (OC-2, TS reference, 2 s at 0.2 V after 0.5 s warm-up): 740,491 forward calls, cold avg 2.008 iters/call, warm avg 2.076 with 25 cold restarts, breakdown branch 0 calls. The seed is not within rounding once Newton is converging; it saves nothing. Not committed.

## Evidence

- Control run (clone at origin main `128797a`, before any edit): `bun install
  --frozen-lockfile` exit 0 (411 packages); wasm built in CI order (emcc on PATH,
  local 6.0.4, control `src/wasm/v2_dsp.wasm` sha256
  `566003ad958b5412271bb8329c604c8db2f8993c1fb6c09f277bd18f5ff85737`);
  `bun run typecheck` exit 0; `bun run build` exit 0 (`dist entrypoints ok`); root
  `bun test` 2748 pass / 2 fail (both pre-existing
  `tests/appearance/corpus-integration.test.ts` failures -- pedal-block count + CE-2 colour).
- Post-change gates: wasm rebuilt in CI order (post-B `src/wasm/v2_dsp.wasm` sha256
  `e486c911727c589b3129efcc5c3aefd8a48a0671ffebeedee578d6bcf9c33edf`);
  `bun run typecheck` exit 0; `bun run build` exit 0; root `bun test`
  **2749 pass / same 2 pre-existing fail** (+1 new op-amp slope-identity assertion, passes).
- `git diff 128797a..HEAD -- packages/runtime/src packages/runtime/scripts`
  touches only the Engine/Program.h/reference-runtime sources and the one new
  test: the compiler is untouched, so the AOT kernel table and every program are
  expected unchanged (phase-1 kernel-table and program controls confirm).

## Expected movers (Phase-1 catalog A/B and program control)

Programs from the unchanged compiler: expected **145/145 byte-identical**
(control compiler vs clone compiler). TS and WASM bit-identical 145/145 after A;
after B every packet within the Newton tolerance band except the four named
rounding-sensitive ones (`boss-tw-1`, `moogerfooger-mf-102`, `mxr-blue-box`,
`boss-dd-3b`), **0 silent/plays verdict moves**. Full tables in the sibling
worker's gate record (this repo's sibling worktree
`stamp-overhead/thoughts/shared/2026-11-04-stamp-overhead/README.md`, gates 2-7):

- Native medians (own `-O3` probe, OC-2 median of 5): OC-2 18668 to 16891 (-9.5%)
  to 16343 (-3.2%, -12.5% total); GE-7 8350 to 8219 to 7889 (-5.5% total);
  CE-2 10271 to 9723 to 9481 (-7.7% total); TS808 10471 to 9990 to 9949 (-5.0% total).
- Worklet scoreboard (wasm console, budget 20833 ns/sample): OC-2 OVER to
  REALTIME at matched low load (control 22931 1.10x OVER, new 20317 0.98x
  REALTIME); GE-7/CE-2 REALTIME both arms.
- Convergence: OC-2 peak 13 / steady 3.4, AW-2 peak 14 / steady 2.9, 0 cap hits
  both arms. Hardware ratchet: three lane deltas 0.0 both arms.

## Checklist

1. Versions and exact pins bumped per the table; compiler/core pins and the
   release-metadata test move together; CHANGELOG heading added. No tags, no publish.
2. `Program.h` gains `Stamp::macroBlockIndex` only (runtime minor); compiler and
   core sources untouched.
3. Local core `main` -- NOT TOUCHED (another session's uncommitted edits).
4. Nothing loose in `~`; scratch only under `/tmp/release-0180-worker/` and the
   `tmp/release-0180/` tree.
5. **No push.**

## Release record (published 2026-11-04, workbench release-0180 worker)

**Status: PUBLISHED.** Main pushed fast-forward `128797a` -> `25b3391`
(no force); three tags pushed one at a time in order, each watched to success
before the next, each confirmed on npm before proceeding. No reruns, no tag
moves, no compiler tag (compiler unchanged), no core tag (core unchanged).

| package | version | tag | publish run | npm time (UTC) |
|---|---|---|---|---|
| runtime | 0.18.0 | `runtime-v0.18.0` | 41893617644 success | 2026-11-04T19:14:14 |
| chain | 0.1.27 | `chain-v0.1.27` | 41895023991 success | 2026-11-04T19:18:04 |
| player | 0.2.25 | `player-v0.2.25` | 41895698566 success | 2026-11-04T19:23:42 |

Acceptance in an empty dir (`npm i` all five at the new versions): `npm ls
--all` clean, one copy of each, deduped, no nested older core or compiler.

Published wasm proof: published 0.18.0 `dist/wasm/v2_dsp.wasm` sha256
`aae2fcd17d3bf1d8c6c67ba9bca399d83b82647e3088900aa6c2fd3d878232fc`
(1,594,643 bytes) -- differs from the clone's local emcc 6.0.4 build
`e486c911…` (1,609,968 bytes; CI builds with emcc 3.1.74), as expected for a
toolchain difference with no source difference on that path.

Phase-1 controls (workbench, logged in the release-0180 report): kernel-table
regen from the clean-extract programs gives 137 kernels / 556 blocks with an
empty diff against the committed table (compiler untouched); program control
145/145 byte-identical (control compiler vs clone compiler over the clean
extract); solver-plan pivot fallbacks 0, abandoned 0, dropped 0 on pedals
(108 sparse of 496 blocks) and amps (30 sparse of 61 blocks); catalog A/B
(published 0.17.0 engine vs clone A+B, both consoles, hashed wasm) outside the
Newton tolerance band on exactly the four named rounding-sensitive packets
(`boss-tw-1`, `moogerfooger-mf-102`, `mxr-blue-box` ts+wasm, `boss-dd-3b` wasm
only), 0 silent/plays verdict moves; wasm parity 4/4 r=1.000000 + mutate
caught against the hashed clone build; newton-deadline OC-2 peak 13 / steady
3.4, AW-2 peak 14 / steady 2.9, 0 cap hits both arms.
