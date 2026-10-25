# Release prep: compiler 0.10.0 / runtime 0.8.0 / chain 0.1.13 / player 0.2.11 (2026-10-25)

**Status: PREPARED (version-bumped green tree), NOT PUBLISHED.** Prepared 2026-10-25 on branch
`indiejoseph/cs-3-vca-ba718` by the CS-3 engine worker (task `task_066c2d324528`). Publication needs
credentials this worker does not hold -- the owner publishes in the usual order (compiler, runtime,
chain, player). Workbench pin bump + compression verification belong workbench-side after publish.

## What ships

| package | from | to | why |
|---|---|---|---|
| core (`@vessel-dsp/core`) | 0.17.0 | -- (not bumped) | untouched |
| compiler | 0.9.0 | 0.10.0 | BA718 9-pin dual admission (second entry, arity-told-apart); new `dbx-vca` DeviceLaw + stamp + lowering; uPC1252H2 entry rewritten to it with the packet island's numbers |
| runtime | 0.7.0 | 0.8.0 | exact compiler pin; `dbx-vca` on both consoles (`Stamp`/`Program.h`/`ProgramJson.cpp`/`Engine.cpp`), rebuilt wasm |
| chain | 0.1.12 | 0.1.13 | exact re-pin (compiler 0.10.0, runtime 0.8.0) |
| player | 0.2.10 | 0.2.11 | exact re-pin (chain 0.1.13, compiler 0.10.0, runtime 0.8.0) |

## Measured in-repo (this worktree)

- `bun test packages/compiler`: 688 pass, 0 fail (incl. 4 new `dbx-vca.test.ts`: bare-pin stamp
  mapping, LM-2-style named-role binding with no positional warning, BA718 dual expansion,
  5-pin shape kept).
- `bun test packages/runtime`: 568 pass, 0 fail (incl. 10 new `dbx-vca.test.ts`: pure gain unit
  tests, transfer renders 1.878 / 1.285 / 0.692 at control 3.5 / 4.5 / 5.5 V vs hand-computed
  1.878 / 1.285 / 0.692, TS-vs-WASM agreement correlation >= 0.9999 with max |delta| < 1e-4).
- Full `bun test`: 2368 pass, 1 fail -- the single fail is `tests/package.test.ts` "release
  metadata" on a pristine tree too (missing `packages/core/dist`, i.e. `bun run build` never ran
  in the worktree); after `bun run build` it passes 24/24 with the new changelog heading.
- `bun run typecheck`, `bun run build`: clean. `bun run build:pages`: runs with this release.
- Retraced CS-3 (`boss-cs-3.vdsp` v1.2, read-only): compiles ok; IC3 lowers to one `dbx-vca`
  stamp with the island numbers; IC4 expands to two `ideal-opamp` sections (no more
  `ic-not-executed` for it). `boss-lm-2.vdsp` (read-only): compiles ok; its role-named IC1
  binds the same entry by role with no positional warning.
- C++ consoles verified two ways: `em++ -fsyntax-only` clean under the repo's emsdk, and the
  cross-console render test above runs against a locally built `src/wasm` (gitignored artifact).

## Known follow-up (named, not blocking this release)

- CS-3 `IC3` still reports `unverified-pinout-binding`: its shell names its pins bare `pin1`..`pin8`,
  so the entry binds positionally with the documented cross-check (NE570 precedent). A packet-side
  follow-up naming the pins with role suffixes (the `boss-lm-2` vocabulary: `pin1_input`,
  `pin2_gc2`, `pin3_gc1`, `pin4_symmetry`, `pin5_iset`, `pin6_ground_reference`, `pin7_vcc`,
  `pin8_output`) would move IC3 to the clean role bijection this release already proves for LM-2.
  No packet changes were made here (out of scope for this task).
