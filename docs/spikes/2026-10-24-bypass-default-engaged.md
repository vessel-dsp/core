# Latch-steered bypass defaults to engaged (landed)

Date: 2026-10-24. Worktree: `core` repo, branch
`indiejoseph/bypass-default-engaged`, from `main` at `48cf257`.
READ-ONLY dirs (`workbench`, `artifacts`) untouched — no git command run there,
no file written there; `path-probe.ts` used read-only from the workbench cwd with
`COMPILER_SRC` pointing at this worktree. Scratch scripts in `/tmp/opencode/`
(`digest.ts`, `census.ts`, `progdiff.ts`, `path-probe-default.ts`,
`probe*.ts`); main-baseline digest at `/tmp/opencode/digest-main.txt`
(via `git stash`), new digest at `/tmp/opencode/digest-new.txt`;
per-packet program texts at `/tmp/opencode/prog/*.main.json` / `*.new.json`.

Commits: change + test + CHANGELOG first, this report second (no push/tag/merge).

## TL;DR

- A typed `role: bypass` control steered by a **connectivity-derived** bistable
  latch now defaults to its engaged position, 1. Digest over all 124 corpus
  `.vdsp`: exactly the three connectivity-derived latch packets move
  (`boss-sd-1`, `boss-ce-2`, `boss-dm-2`), each by exactly its bypass control's
  `defaultPosition` 0 → 1, with no warning-code changes anywhere.
- The LED-derived (`boss-dm-3`, `boss-lm-2`, `boss-ph-1r`) and all 16 fallback
  latch packets are byte-identical: their bypass controls are latch-steered but
  keep their existing defaults, as designed. No other mover; no new or stopped
  diagnostic.
- Render check (workbench cwd, `COMPILER_SRC` = this worktree): `boss-sd-1`
  renders overdrive at its default (+5.29 dB, THD 11.75 %, identical to bypass 1);
  `boss-ce-2` renders the chorus mix at its default (−4.80 dB, identical to
  bypass 1, against −0.31 dB dry at 0); `ibanez-ts9-reissue` and `boss-aw-2`
  render byte-identically at 0, 1 and default (programs unchanged).

## Why (owner: before 0.9.0)

Commit `491007b` made a bistable-latch bypass mean what it says: position ≥ 0.5
is engaged. The three corpus packets with a connectivity-derived latch compile
their footswitch control with `defaultPosition` 0 — `boss-sd-1`
`EFFECT_SWITCH_SOURCE` (base 0, a derived real rest position) and `boss-ce-2`
`SW_NORMAL_EFFECT` / `boss-dm-2` `S_EFFECT_NORMAL` (base 0.5 half-travel from an
unresolvable stated position, overridden to the declared 0). Under the corrected
stamps 0 renders dry, so after the release these pedals would load bypassed
while the product shows them engaged.

## What changed

`packages/compiler/src/netlist.ts` only (plus tests + CHANGELOG):

- The control map is untouched (base default, engaged override, and
  `bypass-engaged-disagrees` exactly as before). After the existing
  `findBistableLatches` detection — the same single pass that already feeds the
  `device.control = null` fix, so no second pass and no new dependency
  (`netlist.ts` already imports `latch-seed`) — every control with typed role
  `bypass`, not momentary, steered by a **connectivity-provenance** latch gets
  `defaultPosition` 1 by record replacement.
- Precedence, highest first: the existing engaged override is unchanged, and a
  declared engaged 1 honored by it already rests at 1, so the rule coincides
  with it; then this rule; then the base default. A declared 0 does **not**
  block the rule — a footswitch's declared rest position is not an
  engaged-state fact, the same way a derived real position already keeps
  winning over a declared 0 elsewhere. Momentary/latch-toggle contacts keep
  their rest behavior (first press must be a rising edge).
- The gate is the derivation, deliberately: only the connectivity derivation
  reads the effect path (which member's collector gates the effect FET), so it
  is the only evidence that control ≥ 0.5 renders the effect. An
  effect-status-LED read names the indicator side and the fallback names no
  side at all, so neither carries the effect-path evidence this rest position
  claims — those controls keep their existing defaults.
- The sibling `device.control = null` fix keeps the **unfiltered** latch set:
  an earlier draft of this change filtered that set too and refused
  `boss-os-2`/`boss-tw-1` at partition (the footswitch kept its control across
  two regions). Caught by the digest before commit; the two sets are separate
  with a comment-adjacent reason each.

## Acceptance evidence (every number quoted)

1. Typecheck exit 0 (`bun run --cwd packages/compiler typecheck`); compiler
   suite 684 pass / 0 fail across 34 files. Four new tests in
   `packages/compiler/tests/netlist.test.ts`: connectivity latch-steered
   bypass defaults to 1 with the declared engaged 0 present (the SD-1 shape)
   and with `bypass: none`; declared engaged 1 on a latch-steered control
   stays 1 silently; a bypass control with no latch in the netlist keeps 0.
   Mutation: with `netlist.ts` stashed, the two latch-steered tests fail
   (0 ≠ 1) and the other two pass; restored, all pass. No packet-identity
   assertions; `src/` adds no packet mention.
2. Corpus digest (program JSON sha256 + warning codes, `main` vs this commit,
   124 documents): exactly three movers — `boss-sd-1`, `boss-ce-2`,
   `boss-dm-2`. Program-text diff per mover is a single line, the bypass
   control's `defaultPosition` 0 → 1 (`EFFECT_SWITCH_SOURCE`, `SW_NORMAL_EFFECT`,
   `S_EFFECT_NORMAL` respectively). Warning codes are identical on all 124
   documents, so `bypass-engaged-disagrees` neither fires (the three movers
   declare 0 against the new default 1, silently — the warning is computed
   from the pre-rule default, and the declaration is a rest fact, not an
   engaged-state defect) nor stops firing (it is retained on `boss-cs-2`,
   `boss-ds-2`, `boss-lm-2`, `boss-nf-1-noise-gate`, `boss-ph-1r`,
   `boss-tw-1`). Census: 22 corpus latch packets — 3 connectivity, 3
   LED-derived (`boss-dm-3` Q10/Q9, `boss-lm-2`, `boss-ph-1r`), 16 fallback
   (the task's "16 fallback latches" is exact; it names only `boss-dm-3` of
   the three LED-derived, the other two are listed here). Every non-mover with
   a latch-steered bypass control keeps its main default (`boss-dm-3` SW 0,
   `boss-ds-2`/`boss-lm-2`/`boss-ph-1r`/`boss-tr-2` 1, `boss-cs-2`/
   `boss-nf-1-noise-gate`/`boss-tw-1` 0.75, the rest 0); `boss-aw-2` and
   `ibanez-ts9-reissue` have fallback latches with no steered bypass control
   (`controlId` null). Any-other-mover: none.
3. Renders, 0.1 V 1 kHz tone, knobs 0.5, bypass forced to 0 / 1 / left at the
   program default (probe copied to `/tmp/opencode/path-probe-default.ts`,
   `BYPASS_DEFAULT=1` skips the bypass `setControl`):
   - `boss-sd-1`: 0 → 0.0919 V (−0.73 dB), THD 0.02 %; 1 → 0.1838 V
     (+5.29 dB), THD 11.75 % (H2 2.98, H3 10.83 %); default → 0.1838 V
     (+5.29 dB), THD 11.75 % — bit-identical to 1, overdrive at default
     (THD 11.75 % > 5 %). Effect FET on at default, off at 0.
   - `boss-ce-2`: 0 → 0.0965 V (−0.31 dB), THD 0.00 % (dry); 1 → 0.0576 V
     (−4.80 dB), THD 0.02 % (chorus mix); default → 0.0576 V (−4.80 dB),
     bit-identical to 1.
   - `ibanez-ts9-reissue`: 0, 1 and default all 0.1600 V (+4.08 dB), THD
     8.83 % — overdrive throughout, program byte-identical, unchanged.
   - `boss-aw-2`: 0, 1 and default all 0.0162 V (−15.83 dB), THD 0.00 % —
     program byte-identical, unchanged.
4. CHANGELOG entry at the top of `## Unreleased: compiler`, release-note
   level, stating the user-visible consequence (pedals load engaged; three
   movers; compiler only).

## Full-tree verification (pre-existing failures, identical on both arms)

- Root `bun test`: 2300 pass / 50 skip / 6 fail; the 6 failures are
  byte-identical on `main` and this commit (compared fail-name sets): four
  TS-vs-C++ console agreements (`delay-tap-reverse`, `hold-loop`, `tap-law`,
  `controller-latch`), one declared-program C++ bit-exact check, and the
  `release metadata` changelog/dist pin. None is touched by this change.
- Root `bun run typecheck`: exit 0. `bun run --cwd packages/compiler build`:
  exit 0. Root `bun run build` fails at a player worklet step (`src/wasm`
  missing) on `main` too — pre-existing, unrelated.
