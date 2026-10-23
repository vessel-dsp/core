# Latch polarity + effect-status LED (Rows 1–2, landed)

Date: 2026-10-23. Worktree: `core` repo, branch
`indiejoseph/latch-polarity-effect-status`, from `main` at `bd96ec6`.
READ-ONLY dirs (`workbench`, `artifacts`) untouched — no git command run there,
no file written there; `path-probe.ts` used read-only from the workbench cwd with
`COMPILER_SRC` pointing at main or this worktree. Scratch scripts in
`/tmp/opencode/` (`latch-census.ts`, `led-adjacency.ts`, `digest.ts`,
`led-vak.ts`); main-baseline digest at `/tmp/opencode/digest-main.json`.

Commits: `491007b` (Row 1) + `6f87715` (Row 2). This report is the third commit.

## TL;DR

- **Row 1 landed** (`491007b`): the bistable latch's engaged/bypassed polarity was
  inverted twice (seed + steering stamps backed the transistor that must be OFF
  when engaged). Renamed to the transistor ON when engaged
  (`onWhenEngaged`/`offWhenEngaged`), seeded/steered the other member. Digest:
  exactly `boss-sd-1`, `boss-ce-2`, `boss-dm-2` move; 19 fallback programs
  byte-identical.
- **Row 2 landed** (`6f87715`): fallback latches take the engaged side from the
  typed `effect-status` LED where connectivity refuses. Digest: exactly one mover,
  `boss-dm-3` (`D11` cathode directly on `Q10`). `latch-engaged-disagrees` fires
  nowhere in the corpus (mechanism + synthetic coverage only).
- **One task sentence is backwards** (flagged, decided by acceptance numbers):
  the spec's "pull `offWhenEngaged`'s collector low at control ≥ 0.5" would keep
  the bug; physics + acceptance item 3 require pulling `onWhenEngaged`'s collector
  low at ≥ 0.5. Implemented the physics-correct version; all acceptance gates hold.

## Row 1 — polarity (`491007b`)

Physics: the member `effectGatingBase` finds (collector reaches the effect FET's
gate through DC edges) must be OFF (collector high) when engaged — a collector
pulled LOW (ON) drags that FET's gate low through the steering diode and turns
the effect OFF. Pre-fix code seeded that member's base at 0.65 V and pulled its
collector to the emitter at control ≥ 0.5: `boss-sd-1` at bypass control 1
rendered dry (−0.73 dB, THD 0.02 %, effect FET off, CHECK dark) and at 0 the
effect (+5.3 dB, THD 11.8 %).

What changed (`packages/compiler/src/` + tests + `CHANGELOG.md` ¶1):

- `latch-seed.ts`: `BistableLatch` renamed to `onWhenEngaged*`/`offWhenEngaged*`
  (bases, collectors, ids) + `sideProvenance`; `engagedBase()` renamed to
  `effectGatingBase()` with corrected docs (it finds the member OFF when
  engaged); `findLatchSeeds` seeds the other member; fallback keeps the exact
  pre-fix node (lower base id) so the 19 fallback programs stay byte-identical;
  header + stamp comments rewritten with the measured basis (old comments were
  wrong, not stale).
- `lower.ts`: steering stamps pull `onWhenEngagedCollector` to the emitter at
  ≥ 0.5 (`onOhms` 100) and `offWhenEngagedCollector` at < 0.5. Stamp-content
  only — runtime's `position >= 0.5 ? onOhms : offOhms` rule is unchanged, so no
  `Program`/`Stamp`/runtime/wasm change.
- `partition.ts`: field renames only (symmetric use, no behavior change).
- Tests: `latch-seed.test.ts` (12 tests) updated to the new names; the old
  "seeds the side whose switch path reaches a control" fixture now asserts the
  seed is the *other* member's base (21 pre-fix → 11 post-fix on the identical
  fixture); new `flipFlopEngagedPolarity` `.vdsp` fixture (derived latch) proves
  end-to-end that the engaged stamp pulls the on-when-engaged collector.
  Mutation check: reverting the stamp swap fails the new end-to-end test (11
  pass / 1 fail); restored → 12 pass.

Gates (quoted): compiler typecheck exit 0; compiler suite 662 pass / 0 fail;
corpus digest (124 artifacts `.vdsp`, canonical program hash + warning codes,
main `bd96ec6` vs Row 1): exactly 3 movers — `boss-sd-1`, `boss-ce-2`,
`boss-dm-2` — hash only, zero warning-code changes, zero status changes (123 ok
+ `boss-dd-3t` refused on both arms); `findBistableLatches` census 22 instances.
`path-probe.ts` from the workbench cwd (TS runtime 0.6.3, 1 kHz 0.1 V, knobs
0.5): `boss-sd-1` at `BYPASS=1` → +5.29 dB, THD 11.75 % (H2 2.98, H3 10.83 %),
Q1 ON; at `BYPASS=0` → −0.73 dB, THD 0.02 %, Q1 off, Q2 ON. `boss-ce-2` at 1 →
−4.80 dB chorus mix (Q9 ON); at 0 → −0.31 dB dry (Q9 off).
`ibanez-ts9-reissue` at default → +4.08 dB, THD 8.83 % overdrive, program
byte-identical. (The probe's "latch seeded undefined" line is its own stale
field read — it prints pre-rename names from a read-only script; the Vgs lines
carry the evidence.)

## Row 2 — typed effect-status LED (`6f87715`)

Rule: 72 corpus documents declare a panel element with role `effect-status`.
Stage 1 resolves entries with typed role `effect-status` + typed kind `led` to
device terminals by exact id only (never name/description), device must be a
diode with typed anode/cathode — new optional `Netlist.effectStatusLeds`.
Precedence: connectivity > LED > fallback. Cathode on a collector directly or
through one resistor → lit-when-low → that member ON when engaged; anode
*directly* on a collector → lit-when-high → the other member. An anode a
resistor away is deliberately not evidence (shared-supply-node-plus-loads shape,
measured both `boss-bd-2` builds + `boss-ds-2`). Conflicting/absent votes are no
evidence. Connectivity-vs-LED conflict keeps connectivity and raises the new
`latch-engaged-disagrees` diagnostic naming both.

What changed: `types.ts` (`EffectStatusLed`, `Netlist.effectStatusLeds?`,
`LatchEngagedDisagreesWarning` + union); `latch-seed.ts` (`assessLatchSides`,
`ledIndicatedOnMember`, `cathodeRelation`, `findLatchLedDisagreements`,
`ledTerminalNode`, pair-scan refactor with identical structural requirements);
`netlist.ts` (`effectStatusLedsOf`, `panelKindFor`, warning push);
`diagnostics.ts` (new exports); 9 new `latch-seed.test.ts` tests (21 total:
cathode-direct/1R, anode-direct, conflict, anode-1R exclusion, precedence +
disagreement items, two `.vdsp` fixtures proving the document-to-program path
and the warning detail); `CHANGELOG.md` ¶2.

Gates: typecheck exit 0; suite 671 pass / 0 fail; digest Row 1 → Row 2: exactly
1 mover, `boss-dm-3` (hash only, warnings unchanged); `latch-engaged-disagrees`
fires on zero corpus packets.

Full-suite note (pre-existing, not this work): root `bun test` gives 2280 pass /
6 fail, all environmental and present on base `bd96ec6` — five runtime
wasm-console tests import the unbuilt `src/wasm/v2_dsp.cjs`, and
`tests/package.test.ts` "pins the current package release" needs unbuilt `dist`
output and additionally asserts the CHANGELOG starts with
`## compiler 0.8.1 …` while the tree (since Rows A/B) opens with the
`## Unreleased:` section. No test outside `packages/compiler` regressed: the
four moved programs break no other expectation. Root `tsc --noEmit` exit 0;
biome lint clean on all touched files.

LED census (all 22 latch instances, post-Row-2 provenance):

- Connectivity (3): `boss-sd-1` (on `Q3_2SC945_P`, off `Q4_2SC945_P` — LED
  `CHECK_LED_SLP135B` cathode *directly* on Q3 agrees, no warning); `boss-ce-2`
  (on Q6, off Q7; LED no adjacency); `boss-dm-2` (on Q7, off Q6; LED no
  adjacency).
- Effect-status-led (3): `boss-dm-3` (LED `D11` cathode-direct on Q10 → on Q10,
  seed Q9-base→Q10-base + stamp swap → the one mover); `boss-lm-2` (cathode-direct
  on Q5, agrees with the fallback side already seeded → identical program);
  `boss-ph-1r` (cathode-direct on Q7, agrees with fallback → identical).
- Fallback (16): `boss-aw-2` (no `effect-status` record at all, `bypass: none`);
  `boss-bd-2` ×2 + `boss-ds-2` (anode-1R to *both* collectors — excluded by
  design); `boss-cs-2` (no LED record); `boss-tw-1` (cathode on ground);
  `boss-ce-2`/`boss-dm-2` N/A (derived); `boss-nf-1-noise-gate`, `boss-od-1`
  (diode, no adjacency), `boss-cs-3`, `boss-ds-1`, `boss-hm-2`, `boss-mt-2`,
  `boss-os-2`, `boss-sp-1-spectrum`, `boss-tr-2`, `ibanez-ts9-reissue` (LED
  control id matches no device id — no evidence per the exact-id rule).

`boss-dm-3` probe (Row 2 vs main, exact state exchange): main `BYPASS=1` →
−48.81 dB / Q11 ON vs `BYPASS=0` → −84.38 dB / Q11 off; Row 2 `BYPASS=1` →
−84.38 dB / Q11 off vs `BYPASS=0` → −48.81 dB / Q11 ON. `boss-aw-2` (Row 2
chose fallback — no typed LED): Q10 Vb 0.654 V / Vc 0.096 V ON, Q8 Vb 0.034 V /
Vc 6.000 V OFF, LED1 Vak 1.84 V (lit), renders dry flat −1.01 dB, program
byte-identical to main.

## What could not be verified

- `boss-dm-3`'s true effect side against hardware: the LED convention
  (CHECK-lit = engaged) is the evidence; the probe cannot name "effect" by
  loudness (both settled states near-silent through the 1 kHz tone — a delay
  pedal). Recorded, not forced.
- `boss-aw-2` Q8-vs-Q10 specimen question: unchanged from the brief — the engine
  renders the Q10-ON dry state with LED1 lit at 1.84 V; Row 2 has no typed LED
  to read and keeps the fallback. Recorded, not forced.
- `latch-engaged-disagrees` and the anode-direct polarity occur in no corpus
  packet: covered by synthetic tests + fixtures only.
- 8 fallback packets whose `effect-status` id matches no device (listed above):
  left on fallback per the exact-id rule; whether their LEDs exist under other
  component ids was not pursued (name/prose matching is forbidden).

## Version bump implied

Compiler minor (behavior fix + new diagnostic, additive API: one optional
`Netlist` field, new diagnostic code, new `diagnostics` exports). No version
bumped in-branch (release process owns that; `CHANGELOG.md` entries sit under
the existing `Unreleased: compiler (minor; …)` header). Runtime needs a
republish for its exact compiler pin — 4 programs' bytes changed — but no
runtime source change: the stamp swap rides the existing switch-stamp rule.
