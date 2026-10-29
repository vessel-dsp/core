# Core compiler: derive the bypass latch's engaged side where it fell back (2026-10-29)

Branch `indiejoseph/core-latch-side`, from origin/main `6844c3b` (published
compiler 0.18.0). `packages/compiler/src/latch-seed.ts` + 11 new tests in
`packages/compiler/tests/latch-seed.test.ts`. No push, no tags, no publish, no
version bump. Corpus: `../artifacts/schematics/vessel-dsp` at
`da97fc07bf343753fca842a719f37ee6af6f0a39`, **dirty** (28 modified/untracked
paths, all in `pedals/boss-oc-2/`; the canonical `boss-oc-2.vdsp` is the
uncommitted round 1–7 packet). Workbench harnesses read from
`workbench-pin-0180` (npm compiler 0.18.0 / runtime 0.15.0) and the
`boss-oc-2-packet-study` worktree; both left pristine (restored + verified, §7).

## 1. Defect

`findBistableLatches` picks which cross-coupled transistor is ON when the pedal
is engaged. Precedence: connectivity (`effectGatingBase`), then the
effect-status LED (`ledIndicatedOnMember`), then a fallback (lower base node
id). Census over the 23 latch packets on 0.18.0 (`readNetlist`, then
`findBistableLatches`): connectivity 4 (`boss-ce-2`, `boss-cs-3`, `boss-dm-2`,
`boss-sd-1`), effect-status-led 3 (`boss-dm-3`, `boss-lm-2`, `boss-ph-1r`),
fallback 16 (`boss-aw-2`, `bd-2`, `bd-2-keeley`, `cs-2`, `ds-1`, `ds-2`,
`hm-2`, `mt-2`, `nf-1`, `oc-2`, `od-1`, `os-2`, `sp-1`, `tr-2`, `tw-1`,
`ibanez-ts9-reissue`).

Worked case `boss-oc-2` fell back to the wrong side: with
`EFFECT_FOOTSWITCH=1` (engaged) a 600 Hz tone gave 300 Hz at −113 dBFS (no
octave); with `EFFECT_FOOTSWITCH=0` the octaves played. The latch is Q5
(collector 120, base 20) and Q6 (collector 121, base 29); the fallback chose Q5
as ON. It should be Q6.

Why each rule refused on OC-2:

1. **LED rule.** CHECK LED anode 7, cathode 122; D2 (RD5.1 zener, cathode 122,
   anode 123); R25 3.9 k from 123 to Q6 collector 121. The LED lights when Q6
   conducts. `cathodeRelation` accepted only a direct node or exactly one
   resistor, so it cast no vote. Nodes 122 and 123 each touch exactly two
   device terminals.
2. **Connectivity rule.** `effectGatingBase` floods over resistors and diodes
   from each collector, stopping only at detector rails (ground plus
   voltage-source/rail nodes). Node 7 is the 9 V supply but sits behind the
   series polarity diode D1 (S5500G), so it is not a rail. Both collectors
   flood through their load resistors (R22, R23 to node 7) into the whole
   circuit, including the 4.5 V bias node 2, and reach every JFET gate; the rule
   refuses as "both sides gate the same switches". The real gate paths are Q5
   collector → R28 → node 124 → D4 → node 102 (Q3 gate) and Q6 collector →
   R30 → node 138 → D5 → node 106 (Q4 gate).

## 2. Change (general connectivity rules only; no names, descriptions or part numbers)

**(a) LED vote: pure series chains.** Between an LED terminal and a latch
collector, over two-terminal resistors and diodes only, every interior node
joining exactly two device terminals (no branch). Interior degree counts every
device terminal on the node, any kind. The subject LED device itself is never a
link (a walk through it would join the anode side to the cathode side and
manufacture a vote for every packet). The anode-side walk of exactly one
resistor stays excluded: that is the shared-supply-plus-loads shape measured
on both `boss-bd-2` builds, `boss-ds-2`, `boss-cs-2` and `boss-oc-2` (their LED
anodes sit one resistor from *both* collectors), and dropping the carve-out
would silence OC-2 itself (its R22/R23 load chains would outvote the real
branch 2-to-1). A one-resistor cathode chain still votes (existing behavior);
longer chains vote `cathode-chain` / `anode-chain`. Polarity unchanged:
cathode-side chain → that member is ON; anode-side chain → the other member.

Current-carrying: a diode conducts forward, or in reverse when it is a zener
with a declared breakdown (`parameters.breakdownVolts`, the typed diode law —
never the part number). Where the typed data cannot decide, the diode is
accepted either way, and the code says so: orientation absent/repeated, or no
declared breakdown so the typed data cannot tell an undeclared zener from an
ordinary diode. `boss-oc-2`'s D2 is exactly this — an RD5.1 zener in reverse in
the CHECK branch, known as a zener only by its part number, with empty
`parameters` and the plain diode source type — and refusing it on absence of
evidence would refuse the real branch. The no-branch, unanimity and precedence
rules carry the specificity instead (proven by the census: no new conflict
anywhere, §4).

**(b) Connectivity: the flood must not cross the supply.** Typed rule: a node a
single diode joins to a rail *is* a rail for flood-blocking. Reverse-polarity
protection puts the whole board supply one diode from the inlet rail; without
this the load resistors plus bias dividers carry the flood board-wide. picked
over the shared-load-top candidate (stop at any node both collectors reach
through one resistor each): on this corpus every shared top is already a rail
or diode-joined to one (OC-2 node 7, DS-1 node 5, HM-2 node 71, MT-2 node 1,
the rest already rails), so the diode rule is strictly more general here, and
gate-steering branches never route inward through an inlet/clamp diode.
Limits: one hop only (longer diode strings are signal paths); effect-status
indicators excluded (loads, not distribution). On OC-2 each collector then
reaches only its own switch (Q5→Q3@102 via R28+D4; Q6→Q4@106 via R30+D5; the
shared leak through node 7 and the bias node 2 dies).

Two rail sets, deliberately: candidacy keeps the structural rails, because the
expansion can mark small-signal clamp nodes — `boss-ds-1`'s Q4 base (node 37)
sits behind its base-ground clamp D7 — and a clamped state node is still a
state node. Promoting it un-found the DS-1 latch outright in the first cut;
blocking it in the flood only shrinks reachability (refusal is the safe
direction) while the latch survives.

**Precedence unchanged** (connectivity, then LED, then fallback) and the
`latch-engaged-disagrees` diagnostic is untouched: where both speak and
disagree it still reports. No such packet exists in the corpus before or
after (reported, not hidden: the census prints every disagreement; there are
none).

## 3. Census after the change (provenance before → after, ON member before → after)

| packet | provenance | ON member |
|---|---|---|
| boss-aw-2 | fallback → fallback | Q10 → Q10 |
| boss-bd-2-blues-driver | fallback → **effect-status-led** | Q15 → **Q16** |
| boss-bd-2-blues-driver-keeley-mod | fallback → **effect-status-led** | Q15 → **Q16** |
| boss-ce-2 | connectivity → connectivity | Q6 → Q6 |
| boss-cs-2 | fallback → fallback | Q10 → Q10 |
| boss-cs-3 | connectivity → connectivity | Q2 → Q2 |
| boss-dm-2 | connectivity → connectivity | Q7 → Q7 |
| boss-dm-3 | effect-status-led → effect-status-led | Q10 → Q10 |
| boss-ds-1 | fallback → **connectivity** | Q4 → Q4 (side unchanged) |
| boss-ds-2 | fallback → **effect-status-led** | Q1_CHECK → Q1_CHECK (side unchanged) |
| boss-hm-2 | fallback → fallback | Q8 → Q8 |
| boss-lm-2 | effect-status-led → effect-status-led | Q5 → Q5 |
| boss-mt-2 | fallback → **connectivity** | Q005 → **Q006** |
| boss-nf-1-noise-gate | fallback → fallback | Q8 → Q8 |
| boss-oc-2 | fallback → **effect-status-led** | Q5 → **Q6** |
| boss-od-1 | fallback → fallback | Q3_LATCH → Q3_LATCH |
| boss-os-2 | fallback → fallback | Q8 → Q8 |
| boss-ph-1r | effect-status-led → effect-status-led | Q7 → Q7 |
| boss-sd-1 | connectivity → connectivity | Q3_2SC945_P → Q3_2SC945_P |
| boss-sp-1-spectrum | fallback → fallback | Q3 → Q3 |
| boss-tr-2 | fallback → fallback | Q5 → Q5 |
| boss-tw-1 | fallback → fallback | Q6 → Q6 |
| ibanez-ts9-reissue | fallback → fallback | Q6_KTC3198 → Q6_KTC3198 |

23 latch packets of 124 corpus documents, before and after. Side changes: 4
members across 3 packet shapes (bd-2 ×2, mt-2, oc-2). Same-side provenance
moves: ds-1 (fallback→connectivity), ds-2 (fallback→effect-status-led). The 7
previously derived latches keep their sides. `boss-hm-2` still refuses (both
sides' gates stay control-bound after the split: Q10/Q4 vs Q5); `boss-cs-2`
stays silent (anode-1R chains to both collectors, excluded by design, no
cathode chain); `boss-aw-2`/`os-2`/`sp-1`/`nf-1`/`od-1`/`tr-2`/`tw-1`/`ts9`
unchanged (no LED chain fires, or the audio side refuses on both-true/both-false).

Why connectivity still refuses OC-2 after (b): the DC split is exact
(Q5→Q3 only, Q6→Q4 only, §2), but both gated FETs' drains reach control nodes,
so the audio side cannot name the effect path — the LED chain decides, in
agreement with the split. The two rules compose: (b) fixes the "same switches"
refusal mode (ds-1 derives, mt-2 derives-and-flips), (a) fixes the LED refusal
mode (oc-2, bd-2 ×2 flip; ds-2 confirms same side).

## 4. Independent engaged checks

Driver: `ReferenceRuntime` from this worktree, `pedalPartCatalog`, 48 kHz,
source 134 Ω, settle 3 s silence, then bias snapshot (`nodeVoltageSnapshot`)
and, where stated, a sine render with lock-in analysis. dBm re 0.775 Vrms.

**OC-2 (changed, LED check).** Engaged (`EFFECT_FOOTSWITCH=1`, all knobs max,
600 Hz at amplitude 0.0316): 600 Hz −29.28 dBm, **300 Hz −32.12 dBm, 150 Hz
−36.70 dBm — the octaves play**; LED Vak = 8.375−6.644 = **1.73 V (lit)**;
Q6 ON (Vb 0.612, Vc 0.042), Q5 OFF (Vb 0.016, Vc 5.586). Bypassed:
300/150 Hz at −116.6/−128.9 dBFS — gone; LED Vak 0.88 V (dark); latch mirrored.
Study levels at −20 dBm input (amplitude 0.10955), per-knob-max renders:
DIRECT-only 600 Hz **−18.5 dBm** (study −18.52), OCT1-only 300 Hz **−19.8 dBm**
(study −19.77), OCT2-only 150 Hz **−21.9 dBm** (study −21.91) — all within
0.1 dB. Before the change, engaged gave 300 Hz at −116.6 dBFS with LED Vak
0.88 V (check fails), and bypassed played the octaves — the exact defect,
mirrored by the steering.

**BD-2 ×2 (changed, LED check).** Engaged (`SW1=1`): LED Vak 1.95 V (lit;
settled diode-law current 4.86 mA through the CHECK branch); Q16 ON
(Vb 0.675, Vc 0.128), Q15 OFF (Vc 5.379). Bypassed: Vak 1.48 V, settled
diode-law current 21.2 µA against 4.86 mA engaged (≈ 0.4 %) — dark.
Before: engaged Vak 1.48 V, Q15 ON — check fails. Keeley build identical
down to the millivolt (engaged 4.86 mA, bypassed 21.2 µA).

**MT-2 (changed, no LED: bias-level check).** Engaged (`SW_EFFECT=1`): Q006 ON
(Vb 0.579, Vc 0.016), Q005 OFF (Vc 5.973); gated JFET gates Q002@69 5.22 V,
Q009@13 4.34 V with channels ON (Vgs ≈ −0.04). Bypassed: mirrored (Q005 ON,
gates ≈ 0.016 V). Renders do **not** differ: 1 kHz sines at 0.1/0.3/1.0 V,
Dist 0–1, 100 Hz–1 kHz all render clean (≈ unity, THD ≈ 0.001) at both controls
in **both** arms — the distortion is inert to these stimuli in this packet
(pre-existing packet characteristic, not a regression: before-arm renders are
identical). The Q002 drain reaches the Middle/Mid-Freq/High/Low/Level knobs,
which is the typed evidence behind the derivation; the new side is bias-
supported but cannot be audio-confirmed on this packet.

**Controls in both directions (all pass; all programs byte-identical before/after):**

| packet | engaged (1) | bypassed (0) |
|---|---|---|
| ce-2 (conn, LED) | Vak 1.75 V lit; Q6 ON | Vak 1.35 V dark; mirrored |
| cs-3 (conn, no LED) | Q2 ON (Vb 0.513, Vc 0.016); mirrored at 0 | renders ~identical (0.04 dB, pre-existing); bias check used |
| dm-2 (conn, LED dark in model) | render −25.46 dBm THD 0.012 vs bypassed −21.28 dBm THD 0.0001 (4.2 dB + coloration: effect shows) | LED dark both (27 mV; footswitch-contact-driven branch, pre-existing, program-identical) |
| sd-1 (conn, LED agrees) | Vak 1.75 V lit (cathode on Q3c); Q3 ON | Vak 0.88 V dark; mirrored |
| dm-3 (LED) | Vak 1.71 V lit; Q10 ON | Vak 0.69 V dark; mirrored |
| lm-2 (LED) | Vak 1.97 V lit (5.84 mA); Q5 ON | Vak 1.51 V, 29.6 µA (≈ 0.5 % of engaged) — dark |
| ph-1r (LED) | Vak 1.72 V lit; Q7 ON | Vak 0.88 V dark; mirrored |

No packet's new side looks wrong. The two audio-inert controls (cs-3 sine
renders, dm-2 LED branch) are pre-existing packet characteristics with
byte-identical programs in both arms.

## 5. Programs (corpus digest, this change vs 6844c3b, default `compile` options)

Exactly 4 movers out of 124; zero status changes; zero warning-code changes
(full warning objects diffed, not just codes):

| packet | program delta |
|---|---|
| boss-bd-2-blues-driver | seed node 32→51; 2 steering stamps swap rows (44↔45) |
| boss-bd-2-blues-driver-keeley-mod | seed node 32→51; 2 steering stamps swap rows (44↔45) |
| boss-ds-1 | `controls[0].defaultPosition` 0→1 only (connectivity-derived latch steers: the control rests engaged; seeds/stamps identical — side unchanged) |
| boss-mt-2 | seed node 69→71; 2 steering stamps swap rows (68↔70); control default 0→1 |

`boss-oc-2` and `boss-ds-2` refuse under default (empty-registry) options in
both arms (pre-existing: IC6 MC14013BCP has no registry law without the 4013
registry); their movement is shown by the study render (§4, OC-2) and the
fixture end-to-end tests. `boss-ds-2`'s program is byte-identical (same side,
same seed).

## 6. Tests and checks

- `packages/compiler`: **706 pass / 0 fail** (35 files), including the 11 new
  `latch-seed.test.ts` tests (8 chain-rule + 3 flood-rule synthetics, no corpus
  pedal asserted). Mutation check: 5 of the 11 fail on the pre-fix file
  (cathode R+D chain, reverse undeclared, reverse declared-zener, anode
  2-element chain, diode-isolated-supply derivation); all pass after. The 6
  refusal-guard tests (branch, capacitor, LED self-traversal, conflict, clamp,
  indicator) pin the refusal directions on both arms.
- `.vdsp` fixture end-to-end (engaged-polarity, LED seed, LED disagree through
  the document path): pass, unchanged.
- Root `bun test`: **2427 pass / 1 fail** — the single failure is the pre-existing
  release-metadata pin (`tests/package.test.ts`: needs full-workspace dists +
  version/CHANGELOG sync; fails on base too, documented in
  `docs/spikes/2026-10-23-latch-polarity-effect-status.md`). The 5 wasm-console
  suites pass with a fresh `build:wasm` (toolchain drift `eff147a9`→`2bbea146`
  is numerically benign, verified by the passing suites).
- `bun run --cwd packages/compiler typecheck`: clean.
- Fixture parity self-check: the three `flipFlop*` document fixtures compile
  and assert seed/stamp/warning placement through `compile()` — green.
- TS-vs-WASM parity (`workbench-pin-0180/scripts/test-v2-wasm-parity.ts`,
  public wasm swapped in by hash, my compiler+runtime linked): **default 10
  pass 10/10** (incl. mover ds-1), plus `boss-bd-2-blues-driver`,
  `...-keeley-mod`, `boss-mt-2`, `boss-oc-2` each r = 1.000000. Pin-0180
  restored to npm 0.18.0/0.15.0 afterwards (verified by version; both wasm
  hashes back to `eff147a9`; git clean; smoke re-run passes).

## 7. Workbench-side hygiene

- `workbench-pin-0180`: `bun link` of this worktree's compiler+runtime for the
  parity run; node_modules restored with `bun install` after removing the two
  symlinks; versions 0.18.0/0.15.0, both wasm hashes `eff147a9…`, `git status`
  clean, post-restore smoke parity passes.
- `boss-oc-2-packet-study`: read-only use (render-procedure reference only;
  all renders ran from scratch drivers in `/tmp/opencode/latch-side/` against
  this worktree's sources). No files written there.
- Artifacts: read-only. Scratch instruments (census/probe/digest/engaged-driver
  harnesses) lived in `/tmp/opencode/latch-side/` and were wiped with that
  ephemeral mount before completion; every figure they produced is transcribed
  verbatim in §§3–6 above, and the harnesses are reproducible from the procedures
  stated there.
