# Changelog

## compiler 0.14.0 / runtime 0.12.0 / chain 0.1.17 / player 0.2.15

**`dbx-vca` law v5: victim-dependent shutdown fitted to session 8 (on top of the untouched v4).** The v4 depth-only release clears slowly everywhere-post-hot, but session 8 shows the post-gap pip crushed to 0.007x the mild-history pip while the probe tone sits at full baseline flat from +1 s (cleared in <1 s, no creep over 30 s). A fourth follower holds the shutdown: pumped only by hot peaks while primed (silence builds prime over ~10 s, signal disarms in fractions of a second), with an absolute gulp threshold plus quadratic size (D6 conducting hard into the depleted C8 on the first post-gap peak; the square is the D6 diode exponential over the range; the absolute threshold is the diode forward drop plus topped-C8 headroom, which is why sine ripple and mild peaks never pump). Render onsets and continuous tones never pump (priming starts at zero and signal holds it there): the v4 12-point threshold fit (worst residual 0.7 dB) and the v4 state-dependent release tests are structurally untouched -- the shutdown is identically zero wherever signal has been present since prepare. The shutdown rides OUTSIDE the linear +-30 dB clamp (a post-gap transient crushes toward mute, session 8 at -67 dB absolute, past any linear Av range; -100 dB mute floor for safety) and bleeds victim-dependently (fast under sustained signal through the signal-driven Q6/Q8 collector plus Q7 transconductance discharge, frozen R-only in silence: holds across the pip, clears under the probe). Pedal-program session-8 tests (new `dbxVcaPedalChain` fixture: SUSTAIN-coupled control plus LEVEL output): post-gap pip tail 0.007x mild (order bar [0.002, 0.05]), probe +1..+30 s at baseline +-1 dB flat, mild-history and continuous-hot pips pass, on both consoles (TS-vs-WASM agreement >= 0.9999 on transfer; DC cross-console bars are maxDelta-only since correlation is ill-conditioned on flat lines). No LEVEL-path changes (Q4/Q5/latch untouched -- the LEVEL span gates stay open pending the artifacts re-cut; the release state is identically zero under the LEVEL sweep's continuous tones, so no pull in either direction). No BA718 change; island numbers untouched; chain 0.1.17 and player 0.2.15 are exact re-pins; core stays 0.17.0. HOLD PUBLISH -- the owner publishes once at the end.


## compiler 0.13.0 / runtime 0.11.0 / chain 0.1.16 / player 0.2.14

**`dbx-vca` law v4: session-calibrated threshold/rest gain plus state-dependent release.** The v3 law agreed with hardware hot but sat ~8-19 dB low at the quiet end (centre 10/30 mV rendered -2.17/-3.25 dB against HW +5.68/+4.89 dB; sus-max gaps +19/+11/+4/+6). v4 fits the 12-point session threshold sweep directly (worst residual 0.7 dB): SUSTAIN-coupled rest (`sustainGain` -4.23 against `sustainRef` 4.6504 V maps the engine-measured V70 rest span 4.6325->4.6728 onto the session rest gains, INVERTING the old -6.8 dB SUSTAIN response with the session curves quoted as cause) plus a log-domain envelope (`envelopeSlope` 0.049 V/neper) with a SUSTAIN-tracked knee (`kneeBase` -0.069 V at V70 4.65 rising 4.36 V/V -- a fixed knee cannot satisfy 30 mV-off at centre and 30 mV-on at sus-max at once). Below the knee the pedal holds rest gain; above it each input decade adds the same dB of reduction. Hot agreement kept (100/300 mV within ~1 dB of HW). Release TC now varies with suppression depth (`releaseSlowdown` 2400: 50 ms near the top, 120 s from deep suppression) -- the session refutes fixed 50 ms everywhere (pips annihilated after HOT history yet passing after MILD history across the same 3 s gap); `releaseSlowdown` is the explicit fit hook for the hot-start + 60 s trailing-tone take, which does not exist yet. Fixture proof: unity-divider cell renders the law's own gain; DC rest trio/level points render exact hand-computed values, the 12-point sine sweep lands within 1.5 dB per point (sus-min flat within 1 dB, centre drops ~20 dB, sus-max ~28 dB), deep-suppression recovery is <10% home at 3 s while mild-suppression recovery is >=90% home by 0.5 s, all on both consoles (TS-vs-WASM agreement >= 0.9999). No BA718 change; island numbers untouched; chain 0.1.16 and player 0.2.14 are exact re-pins; core stays 0.17.0. HOLD PUBLISH -- the owner publishes once at the end.


## compiler 0.12.0 / runtime 0.10.0 / chain 0.1.15 / player 0.2.13

**`dbx-vca` law v3: smoothed control terms plus detector scaling fix the pedal's expansion.** v2's envelope rectified the cell's node voltage, but the cell input is a virtual ground (100 ohms against the 10k feed): the envelope came out ~100x too small (8 mV at 0.9 V in), the cell fell 20% while its input current grew 18x, and the engine-measured CS-3 sweep expanded (0.83/0.89/1.60). v3 scales the RECTIFIED INPUT CURRENT through `detectorOhms` 1k (feed current 3.5-63 uA rms across the sweep maps to 0.004-0.06 V of control, ~1-11 dB of level-driven reduction) and smooths the SUM with the external control (attack 0.0005 s, release 0.05 s) instead of reading the GC node raw -- node 70 carries tens of millivolts of audio in the pedal, which pumped the gain at audio rate. The smoothed terms are held across the Newton loop (no live control derivative). The re-traced CS-3 now compresses monotonically (engine-measured AC gains 0.71/0.33/0.05 at 0.05/0.3/0.9 V in) with SUSTAIN 0->1 still moving output -6.8 dB; center stays 4.66 V, clamp +-30 dB. Fixture proof: DC control sweep and DC input sweep render exact hand-computed values on both consoles, sine sweeps fall monotonically at center and at the pedal's +40 mV GC rest offset, TS-vs-WASM agreement >= 0.9999. No BA718 change; chain 0.1.15 and player 0.2.13 are exact re-pins; core stays 0.17.0. HOLD PUBLISH -- the owner publishes once at the end.


## compiler 0.11.0 / runtime 0.9.0 / chain 0.1.14 / player 0.2.12

**`dbx-vca` law v2: internal envelope follower plus exponential dB control.** The v1 island sigmoid needed volts of control swing while the topology delivers millivolts at GC1 (R10 1k pins node 70 to 4.5 V; the tap feeds it only through R11 15k), so the re-traced CS-3 rendered linear (measured flat 0.303 gain across 18x input at 0.10.0/0.8.0). The law now reads `gain_dB = -((Vcontrol - 4.66) + envelope) / 0.0059` clamped to the datasheet's +-30 dB: the NEC -5.9 mV/dB feature line (same as `boss-lm-2`'s `gain_db = -v(ctrl)/0.0059` deck), so millivolts move dB. The external center moves 4.5 to 4.66 V (both quoted on the entry): 4.5 is the island's off-chip ctrl_bus number while the law reads the on-chip GC node, whose engine-measured rest is 4.658 V at declared defaults -- centering at 4.5 would park rest gain 27 dB down a clamp rail. The envelope rectifies and smooths the law's own input (attack 0.0005 s, release 0.05 s: C8 4.7 uF by R13 10k ~ 47 ms, D6 charge path ~ 0.5 ms), held across the Newton loop like the compandor's, on one new state slot; nothing in the external netlist converts input level to control, so without it no external-only law can compress. The shipped `dbxVcaCell` fixture proves both paths with static control: DC control sweep 4.60/4.66/4.72 V at fixed input renders 6.377/1.978/0.613 against hand-computed 6.377/1.978/0.613, and the DC input sweep 0.5/2/5 V at static control renders 1.978/1.480/0.829 against hand-computed ditto, on both consoles (correlation >= 0.9999, max |delta| < 1e-4); a sine sweep at static control falls 1.98/1.50/0.86 across 0.5/2/5 V amplitude. No BA718 change (dual tests re-run green); chain 0.1.14 and player 0.2.12 are exact re-pins; core stays 0.17.0. HOLD PUBLISH -- the owner publishes once at the end.


## compiler 0.10.0 / runtime 0.8.0 / chain 0.1.13 / player 0.2.11

**BA718 9-pin dual admitted; the uPC1252H2 VCA executes as a bounded-sigmoid gain cell on both consoles.** The BA718 catalog entry gains a second shape told apart by arity: the full 9-pin dual declaration (one `ideal-opamp` section per channel, cross-checked against the re-traced CS-3 `IC4` nodes) beside the kept 5-pin single-section capture. The uPC1252H2 entry's conductance-plus-linear-OTA fallback -- linear in its inputs, so the engine rendered the CS-3 perfectly linear (measured flat 0.650 / 0.564 gain across 18x input, SUSTAIN/ATTACK inert) -- is replaced by the new `dbx-vca` law with the packet island's own numbers (`boss-cs-3-service-vca-control-island.cir`: gain `0.18 + 0.82 / (1 + exp((ctrl - 4.5) * 1.6))`, quoted as minGain 0.18, maxGain 1.0, vrefVolts 4.5, slopePerVolt 1.6), so gain falls as control rises. `boss-lm-2`'s role-suffixed shell binds the same entry by clean role bijection with no positional warning; bare-pin shells (CS-3 `IC3`) bind positionally in datasheet pin order with the documented cross-check. The law lowers to a voltage-sense `dbx-vca` stamp beside an input conductance, and the TS reference runtime and the C++ engine implement the same sigmoid with analytic derivatives (rebuilt wasm). The shipped `dbxVcaCell` fixture proves the transfer: renders measure 1.878 / 1.285 / 0.692 at control 3.5 / 4.5 / 5.5 V against hand-computed 1.878 / 1.285 / 0.692, and both consoles agree (correlation >= 0.9999, max |delta| < 1e-4). No in-repo program moves: the new stamp kind reaches only programs naming uPC1252H2, and every existing suite stays green. chain 0.1.13 and player 0.2.11 are exact re-pins; core stays 0.17.0.


**Pedals with a connectivity-derived bypass latch now load engaged.** Since the latch-polarity fix, control ≥ 0.5
holds the effect on — but the three pedals whose bypass footswitch steers a connectivity-derived bistable latch
(`boss-sd-1`, `boss-ce-2`, `boss-dm-2`) still rested that control at 0, so every default render played dry. A typed
`role: bypass` control steered by a connectivity-derived latch now defaults to 1: the pedal is presented engaged, and
only the connectivity derivation reads which latch member gates the effect path, so it is the only evidence this rest
position claims. A footswitch's declared rest position is not an engaged-state fact and does not hold the default at 0;
a declared engaged 1 still rests here by the existing override, and momentary/latch-toggle contacts still rest released.
The three movers change by exactly their bypass control's `defaultPosition` (0 → 1) with no warning-code changes; no other
corpus program moves, including the LED-derived (`boss-dm-3`, `boss-lm-2`, `boss-ph-1r`) and the 16 fallback latches,
whose bypass controls keep their existing defaults. Compiler only: no runtime, program, stamp, or wasm change.

**Optocoupler cells can now carry a measured resistance table instead of a single power-law fit.** New optional
law/stamp fields `ldrTableCurrentAmps`/`ldrTableOhms` (strictly increasing positive currents, positive resistances, at
least 2 points, both present or both absent) flow from the catalog entry through lowering into the program and both
consoles. Evaluation interpolates linearly in (ln I, ln R) between the bracketing points, continues the end segment's
log-log slope outside, clamps to `[ldrMinOhms, ldrMaxOhms]` exactly as the power law is clamped, and takes `ldrMaxOhms`
for a current at or below zero; a stamp carrying both the table and the power-law pair runs the table. The TS reference
runtime and the C++ engine implement the same evaluation (rebuilt wasm). A malformed table refuses the pedal at lowering
rather than stamping a guess. Every program without a table is byte-identical: the generic exponential and the power-law
paths are untouched. This is a compiler minor and a runtime minor (new `Stamp`/`Program` fields, `Program.h` /
`ProgramJson.cpp`).

**`VTL5C2`'s cell is now the three cited datasheet anchors as a table, not a power-law fit.** The entry carried a
least-squares fit (`ohms = 11.9861 * amps^-0.892233`, residuals +3.5% at 1 mA, -8.8% at 10 mA, +5.9% at 40 mA) to the
packet-cited anchors (R@1mA=5.5k, R@10mA=800, R@40mA=200, dark >= 1M); it now stores those anchors directly
(`ldrTableCurrentAmps` 1, 10, 40 mA, `ldrTableOhms` 5.5k, 800, 200 ohm) with no fit, so the anchors render exactly.
`ldrMinOhms` 100 and `ldrMaxOhms` 1e6 are unchanged. `runoffgroove-tremulus-lune` is the only document naming this
part, so it is the only mover.

**Bypass control sense was inverted on the three pedals with a connectivity-derived bypass latch: they now engage at
control 1.** The latch detector named the transistor whose collector gates the effect FET as the engaged side, but that
transistor must be OFF (collector high, FET gate high) for the effect to conduct — a collector pulled LOW drags the FET
gate low through the steering diode and turns the effect OFF. Both the operating-point seed and the complementary
collector-steering stamps backed the wrong side, so `boss-sd-1` at bypass control 1 rendered dry (−0.73 dB, THD 0.02 %,
effect FET off) and at 0 rendered the effect (+5.3 dB, THD 11.8 %). The pair is renamed to the transistor that is ON when
engaged (`onWhenEngaged` / `offWhenEngaged`, collectors and ids to match): the seed and the engaged stamp now back the
other member. Measured post-fix (TS runtime 0.6.3, 1 kHz 0.1 V, knobs 0.5): `boss-sd-1` at 1 renders overdrive (+5.29 dB,
THD 11.75 %, effect FET on) and at 0 renders dry (−0.73 dB, THD 0.02 %); `boss-ce-2` renders the −4.80 dB chorus mix at 1
and dry (−0.31 dB) at 0. The 19 fallback latches keep byte-identical programs (the fallback still seeds the lower base
id); `ibanez-ts9-reissue` still renders overdrive at its default. No stamp, program, runtime or wasm change — the swap
is stamp content only, evaluated by the existing `position >= 0.5 ? onOhms : offOhms` rule.

**A fallback latch whose CHECK LED sits on a latch collector now takes its engaged side from that LED.** 72 corpus
documents declare a panel element with role `effect-status`; where the derivation above refuses and the LED's cathode
sits on a latch collector directly or through one resistor (lit when that collector is LOW), the transistor is ON when
engaged, and where its anode sits directly on one (lit when HIGH), the other member is. One program moves:
`boss-dm-3` (LED `D11` cathode directly on `Q10`'s collector) now seeds `Q10`'s base and steers from that side; its two
settled states exchange exactly against the previous build. `boss-lm-2` and `boss-ph-1r` LEDs agree with the fallback
side they already seeded, so their programs are byte-identical. Where connectivity and the LED disagree, connectivity
stands and a new `latch-engaged-disagrees` diagnostic names both — it fires on no corpus packet. `boss-aw-2` (no typed
bypass, no `effect-status` record) stays on the fallback seed exactly as before. Covered by `latch-seed.test.ts`
(synthetic polarity, LED polarity/conflict/precedence cases, and two `.vdsp` fixtures proving the document-to-program
path) with a stamp-swap mutation check that fails without the fix.

**An op-amp whose supply terminal sits on a zener-clamped node now swings between that zener's voltage and ground, and an
op-amp whose supply terminal sits on a node nothing states a voltage for is named instead of silent.** `opampRails()` read a
supply pin's voltage only from declared rails, voltage sources, registry regulators and charge-pump outputs; a pin on any
other node fell back to the circuit-wide supply (9 V on a 9 V pedal) with no diagnostic, so `boss-aw-2`'s IC5 (a 5.1 V zener
node, R38 + D9 `RD5.1EB3` + the pin) swung 0 to 9 V. The compile now derives one voltage for such a node from typed evidence
only: exactly one diode with a breakdown voltage (the document's `BreakdownVoltage`, else the registry's law for the exact
part), declared `anode` and `cathode` roles, anode on a 0 V node, cathode on the supply node, at least two devices on it, and
some declared voltage above the breakdown. A voltage the document states on the node keeps the last word; two zeners, a
reversed zener, a diode with no breakdown, or no headroom derive nothing. A node whose supply terminal still states nothing
raises `opamp-supply-undeclared` (devices, node and side per item). No stamp field, wasm or runtime source changes.

**What moves, as measured 2026-10-24 against the published 0.8.1 / 0.6.3** (artifacts
`8fd6c8a6e02dc9650b48dddc30558ed65a1ea433`, committed files only, 124 pedals and 23 amps; program text
plus 2048-sample two-tone 440 Hz at 0.25 plus 1320 Hz at 0.1 at default controls on both consoles, published
packages against this tree's compiler and its rebuilt wasm): 146 documents compile on both arms and `boss-dd-3t`
is refused on both, so no compile-status mover. 7 programs move: `boss-aw-2` (IC5A/IC5B `railHigh` 9 to 5.235
plus the P873 6-point table), `boss-tw-1` (P873 table, gains `registry-provisional-value`),
`runoffgroove-tremulus-lune` (least-squares fit to the three cited anchors), `boss-sd-1`, `boss-ce-2` and
`boss-dm-2` (latch stamp swap plus bypass `defaultPosition` 0 to 1), `boss-dm-3` (LED stamp swap, default
unchanged). 139 programs are byte-identical, and every unchanged program renders bit-identical on both
consoles: no same-program mover. Audio, largest first: `boss-dm-3` 4.01 on both consoles (1.3e-3 over the
settled second half — the LED swap; its true effect side is still unverified against hardware), `boss-tw-1`
3.90 on both (0.59 TS / 1.06 WASM settled — the table moves its settled filter response, not
hardware-verified), `boss-aw-2` 1.07 on both (0.68 settled — rail plus table), `runoffgroove-tremulus-lune`
7.35e-3 on both; `boss-sd-1` (TS 1.1e-12, WASM bit-identical) and `boss-ce-2` (TS 9.1e-13, WASM bit-identical)
move program-only in effect, and `boss-dm-2` moves 2.0e-9 TS / 1.2e-7 WASM. A bypass control at position 0.5
or above is engaged (1 = engaged): the three engaged-default pedals' new default renders are the effect at the
old default's level — `boss-sd-1` 0.4529 peak, `boss-ce-2` 2.381, `boss-dm-2` 1.135, identical peaks on both
arms on both consoles — and forcing the control to 0 renders dry (`boss-sd-1` 0.2468 on both consoles). The 15
documents gaining `opamp-supply-undeclared` (49 device-and-side items), not on `boss-aw-2`, change warning codes,
not programs: `boss-bf-2`, `boss-ds-1`, `boss-ph-3`, `boss-sp-1-spectrum`, `electro-harmonix-bad-stone`,
`electro-harmonix-holy-grail`, `fulltone-ocd-v1.4`, `keeley-compressor-plus`, `marshall-blues-breaker`,
`moogerfooger-mf-102`, `mxr-distortion-plus`, `pro-co-rat-2-v4b-op07cp`, `pro-co-rat`, `runoffgroove-tremulus-lune`,
`tape-echo`. The warning names where the fallback is in force; whether the fallback is close to the real rail at each of those
nodes was not examined, so it is not a count of defects. Covered by
`packages/compiler/tests/zener-supply-rail.test.ts` (nine tests, three positive and six negative controls).
`latch-engaged-disagrees` fires on no corpus packet. A-vs-repeat identical
146/146 on both consoles; B-vs-perturb moves 123 TS / 119 WASM (8 silent in both). The TS-vs-WASM console gaps
on `moogerfooger-mf-102`, 1959, rockerverb, `boss-tw-1` (plus `jtm45`, `vox`) are unchanged in kind on both
arms: pre-existing packet state, not a regression.

**The runtime takes a minor for the table law: exact compiler pin 0.9.0 and the regenerated kernel table.**
`GeneratedKernels.cpp` regenerated with this compiler over the 146 corpus programs: 140 kernels from 562
scheduled blocks (committed table 139 from 559). Two fingerprints go (`0x711f403d` on `boss-aw-2`,
`0x83ca2d95` on `electro-harmonix-slapback-echo`) and three come (`0xb672b06f` on the re-traced `boss-aw-2`,
`0x092663a0` on the re-traced slapback, `0x2b074d31` on the new `maestro-discoverer-delay` packet): every
change is a re-traced or new packet, none of it compiler-attributable — exporting the old corpus with this
compiler reproduces the committed 139 fingerprints exactly. Outputs are bit-identical with and without the
regenerated table over the whole corpus on the WASM console (146 of 146). The `Program`/`Stamp`/`Program.h`/
`ProgramJson.cpp` change (new `ldrTableCurrentAmps`/`ldrTableOhms` fields, evaluated on both consoles) is why
this is a minor and not a patch.

**Not measured:** non-default controls and switch states (beyond the `boss-sd-1` bypass-0 dry spot check
above), oversample above 1, real-time cost (the browser proofs ran, the worklet scoreboard did not), a guitar
take, ngspice for any new record, whether any change is closer to hardware (the P873 table is a provisional
2005 hobbyist measurement of one `-380` lot, not a manufacturer curve and not a reference for the AW-2's
actual `-38`; `boss-tw-1`'s settled shift and `boss-dm-3`'s effect side are unverified the same way), the
`examples/` documents (excluded from the corpus as in 0.8.1), and a 3 s window (2048-sample only, plus the
with/without-table comparison at 2048 WASM-only).

The chain changes only its exact pins (compiler 0.9.0, core 0.17.0, runtime 0.7.0) and the player only its
exact pins (chain 0.1.12, compiler 0.9.0, core 0.17.0, runtime 0.7.0).

**`P873G35` and its `-380`/`-38` spellings leave the generic optocoupler row for their own entry, with a measured table cell.** `boss-aw-2` files the part as `P873G35-38`, which exact folded equality matched to nothing, so the device fell to the optocoupler class default (generic `exp(-1000·I)` law, 100 ohm-10 Mohm) and sat at megohms through the lamp's whole 0.02-0.5 mA sweep. The new entry keeps the generic row's LED figures and clamps exactly (`ledThresholdVolts` 1.6, `ledTransconductance` 0.001, `ldrMinOhms` 100, `ldrMaxOhms` 1e7) and carries the cell as a measured `ldrTableCurrentAmps`/`ldrTableOhms` table: the geometric mean of 18 measured P873-G35-380 units in a 2005 hobbyist table (electro-music.org topic 27276, 22 C; recomputed means 60.1, 11.5, 4.03, 1.88, 0.74, 0.64 kohm at 0.03, 0.1, 0.3, 1, 10, 20 mA), evaluated by log-log interpolation. NOT a manufacturer curve; the Hamamatsu sheets available list neither `-380` nor `-38` with a resistance-vs-current curve. A single power-law fit cannot cover this cell: fitted over 0.3-20 mA (`ohms = 105.6 * amps^-0.4360`, max residual x1.14) it gives ~11 kohm at 0.03 mA against the measured 60.1 kohm, which is why the entry stores the points instead of a fit range. `P873G35-38` joins the entry's `partIds` by the 2026-10-23 owner decision (the service note's `-38` reads as the `-380` grade). Both table parameters are third-party evidence, so they ride `provisionalParams` and compile raises `registry-provisional-value` for devices that run on them, the same mechanism the `2SC2458`/`2SC2459` community saturation currents use. The other parts in the shared row stay on the generic law, untouched. `boss-tw-1` names the same `P873G35-380` part, so it moves to the measured table as well and gains `registry-provisional-value`; no other document names a P873 spelling.

**`boss-aw-2`'s bypass latch investigated and left on the fallback seed: no connectivity rule separates the sides, so no rule was added.** `engagedBase()` returns `null` for this latch (neither gated FET's drain reaches a control-bound node; the two drains sit in one passive island fused through the +4.5 VA bias node), so the seed falls back to the lower base node id (Q10's base), which holds the dry path. Measured on the filed packet: (0) there is no typed bypass fact to read — the document declares `bypass: none` and carries no `role: "bypass"` control; (1a) input/output reachability does not separate the FETs — both drains reach the input only through the bias network and neither reaches the output passively (the shared source feeds the output buffer through an active stage); (1b) cutting the bias node out of the control flood leaves both sides reaching nothing. The only structural asymmetry between the latch halves is the CHECK-LED branch on Q10's collector, and engaging the non-indicator side would be a heuristic, not evidence: the packet's own prose lights that LED for the effect state, whose principled polarity selects the dry seed the motion check rejects. Per the stop rule the row lands no `latch-seed.ts` change; the 15↔85 relabel still flips the rendered path, and the seed remains the one measured defect. Covered by no new test: `latch-seed.test.ts` passes unchanged (11 tests).

## compiler 0.8.1 / runtime 0.6.3 / chain 0.1.11 / player 0.2.9

**Transistor-record fill: wave-1 datasheet-derived gain and channel records, plus two provisional
`community` saturation currents taken by owner decision.** Wave 1 adds geometric-midpoint forward
Beta for 2SC3324 (unbinned and GR, 374.1657387 / 282.8427125), 2SA1048 (unbinned and GR,
167.3320053 / 282.8427125), 2SC2459 (unbinned and GR, same pair), and 2SC4116 (unbinned and GR,
same pair), MMBT5089 (one entry covering both orderings, 692.820323) and KTC3198-BL (458.2575695),
each cited to its printed manufacturer hFE row; JFET channel records for 2SK30A-O (Vt0 -2.7,
Beta 1.3717421e-4), 2SK879 (unbinned and Y) and 2SK880 (unbinned and GR), a Vt0-only J113
(-1.75, Beta stays class default and says so), and the bare 2SK30ATM spelling as an alias on the
gate-only entry (gate IS 1e-14 instead of the 1e-5 class default). Wave 2 adds IS 15.2e-15 for
2SC2458 (unbinned and GR) and IS 10.1e-15 for 2SC2459 (unbinned and GR). Those two IS values are
provisional `community` values, not manufacturer values: they come from the Intusoft-authored
QSC2458/QSC2459 cards in a third-party SPICE card collection, taken under the owner's 2026-10-23
decision ("we have no other option"), because neither Toshiba datasheet prints a VBE row and
Toshiba's own model bundle is encrypted with a no-reverse-engineering term. The compiler reports
them as `registry-provisional-value` for `saturationCurrent` only, and only when the document
does not type its own value.

**What moves, as measured 2026-10-23 against the published 0.8.0 / 0.6.2** (artifacts `418c5c50`,
committed files only, 123 pedals and 23 amps; program text plus 2048-sample two-tone 440 Hz at
0.25 plus 1320 Hz at 0.1 at default controls on both consoles, published packages against this
tree's compiler and its rebuilt wasm): 145 documents compile on both arms and `boss-dd-3t` is
refused on both, so no compile-status mover. 21 programs move, every change in bjt/fet stamps
only: 2SC2458-family IS on `boss-aw-2`, both `boss-bd-2` builds, `boss-ce-5`, `boss-dd-3a`,
`boss-dd-5`, `boss-ds-2`, `boss-md-2`, `boss-mt-2`, `boss-od-3`, `boss-os-2` and `boss-tr-2`;
2SC2459GR IS plus BF on both `boss-bd-2` builds; 2SA1048-family BF on `boss-aw-2`, `boss-md-2`,
`boss-od-3`, `boss-tr-2` and `boss-ds-2`; 2SC3324GR BF on `boss-bf-3` and `boss-dd-3b`;
2SC4116GR BF on `boss-bf-3` and `boss-ph-3`; MMBT5089L BF on `mxr-carbon-copy`; KTC3198-BL BF on
`ibanez-ts9-reissue`; 2SK879Y channel on `boss-bf-3`, `boss-dd-3b` and `boss-rv-5`; 2SK880GR
channel on `boss-bf-3`, `boss-dd-3b`, `boss-dd-5` and `boss-ph-3`; unbinned 2SK880 channel on
`boss-hr-2`; J113 Vt0 on `dod-fx59-thrashmaster`; the bare-2SK30ATM gate fix on `boss-ds-1`.
Packets that name one of these parts only in prose or evidence roles (`ibanez-pql`'s 2SC2458GR
support context, `boss-oc-3` and `boss-st-2`'s service-note/DSP-mute mentions) do not move, and
neither do packets on already-shipped spellings (`boss-ch-1`, `boss-ge-7`, `boss-tw-1` and the
rest on 2SK30ATM-Y/TM-GR or bare 2SK30A). Audio level: every packet whose program is unchanged
renders bit-identical on both consoles (124 of 124), so there is no same-program mover. Of the
21, five move program-only with bit-identical audio on both consoles (silent or out-of-path
indicators and switches: `boss-bf-3`, `boss-hr-2`, `boss-dd-3a`, `boss-ph-3`,
`boss-rv-5`); the rest move from 1e-9 up to volts, largest `mxr-carbon-copy` (0.104 on both
against a 1.2 peak: MMBT5089L BF 100 to 692.8), `ibanez-ts9-reissue` (0.0156 on both:
KTC3198-BL BF 100 to 458.3), `boss-bd-2-blues-driver-keeley-mod` (9.33e-3),
`boss-bd-2-blues-driver` (7.55e-3), `boss-md-2` (5.79e-3) and `boss-dd-5` (4.96e-3). The
TS-against-WASM console gaps on `moogerfooger-mf-102`, `marshall-1959-super-lead-plexi`,
`orange-rockerverb` and `boss-tw-1` are identical in kind on both arms: pre-existing packet
state, not a regression.

**The runtime changes only its exact pin and the regenerated kernel table.** `GeneratedKernels.cpp`
regenerated with this compiler over the 145 corpus programs: 139 kernels from 559 scheduled
blocks, the same counts as the committed table. One fingerprint goes (`0x5f19ae34`) and one
comes (`0x711f403d`), both `boss-aw-2`: the packet was re-traced between the `892d3b9cd` and
`418c5c50` corpora, and exporting the old corpus with this compiler reproduces the old
fingerprint, so the churn is the re-trace and none of it is compiler-attributable. Outputs are
bit-identical with and without the regenerated table over the whole corpus on the WASM console
(145 of 145). No `Program`, `Stamp`, `ProgramJson.cpp` or `Program.h` change
(`git diff compiler-v0.8.0..HEAD -- packages/runtime/src` is empty), hence a patch bump; the
exact compiler pin moves to 0.8.1.

**Not measured:** non-default controls and switch states, oversample above 1, real-time cost (the
browser proofs ran, the worklet scoreboard did not), a guitar take, ngspice for any new record,
whether any change is closer to hardware, the 12 `examples/` documents (excluded from the corpus
as in 0.8.0), and a 3 s window (2048-sample only, plus the with/without-table comparison at
2048 WASM-only).

The chain changes only its exact pins (compiler 0.8.1, core 0.17.0, runtime 0.6.3) and the player
only its exact pins (chain 0.1.11, compiler 0.8.1, core 0.17.0, runtime 0.6.3).

## core 0.17.0 / compiler 0.8.0 / runtime 0.6.2 / chain 0.1.10 / player 0.2.8

**The registry's first bench-measured records, measured by Joseph Cheng (the project owner) on 2026-10-20.** The 1N4148's
community card (LTspice Standard.dio IS 2.52 nA, N 1.752, RS 0.568) is replaced by the owner's two-point pair
(IS 2.124272112914455e-8, n 2.17468223817758 at the engine's 1.0 ohm default and VT 0.025852 V; anchors 1.9705 mA at 0.645 V
and 15.611 mA at 0.775 V, means of two diodes, UNI-T UT107, 10 mV count). The pair holds only between those two currents and
cannot separate n from series resistance; the record says so. Five LED colour defaults (red, yellow, green, blue, white) carry
measured IS and n (blue, white and green from a four-point fit with a fitted series resistance of 22 to 30 ohm; red and
yellow from a two-point pair valid about 1.4 to 11 mA) with the thermal voltage they were referred to stated as `derived`; a
`kind: led` device reaches them by whole part id (`RED LED`, `5mm red LED`, `LED-RED`, `LED-GREEN`) or by the new typed `Color`
(closed vocabulary red, yellow, green, blue, white, compared as a whole value; `LED_INDICATOR_COLOURS` in `@vessel-dsp/core`;
an out-of-vocabulary colour keeps the class defaults and raises `led-colour-unmatched`). A `custom` LED override must now state
the full quad (IS, n, VT, Rs). Green misses the fit's 20 mV limit by 12 mV and the record discloses it. No manufacturer model
exists for an indicator green or yellow LED; the published white and blue models sit 60 to 700 mV from the kit.

**Core also takes a minor for `LED_INDICATOR_COLOURS`, the typed colour vocabulary the new compiler reads from a document.**
`bb5b6aa` executes the s-curve taper as Alpha W(4B) on both consoles and refuses an unknown taper instead of reading it as
linear. Over the release corpus neither changes a compile status nor a program byte: the only program-text movers are the
39 diode-stamp packets below.

**What moves, as measured 2026-10-22 against the published 0.7.0 / 0.6.1** (artifacts `892d3b9cd`, committed files only,
123 pedals and 23 amps; program text plus 2048-sample two-tone 440 Hz at 0.25 plus 1320 Hz at 0.1 at default controls on both
consoles, published packages against this tree's compiler and its rebuilt wasm): 145 documents compile on both arms and
`boss-dd-3t` is refused on both, so no compile-status mover. 39 programs move, every one in diode stamps only: 13 on the
1N4148 record (9 on the pair alone, 4 together with an LED record), 24 on the keyed or typed red record alone, 2 on a blue
Rs-fit record alone (keeley-compressor-plus, fulltone-ocd-v1.4); the four mixed packets are `bk-butler-tube-driver`
(pair plus red plus the green Rs-fit), `dod-preamp-250` (pair plus blue), `ibanez-ts9-reissue` and
`marshall-blues-breaker` (pair plus red).
21 further packets carry an LED that keeps the class defaults (out-of-vocabulary or unmatched colour, e.g. `boss-bf-3` and
`boss-ph-3` with `Color: red-green`) and do not move. Audio level: every packet whose program is unchanged renders
bit-identical on both consoles except `boss-aw-2` (below), so the default path is unchanged except where the records or the
solver say otherwise. Of the 39, four move program-only with bit-identical audio on both consoles (indicator LEDs outside the
audio path: `boss-bf-2`, `boss-hm-2`, `electro-harmonix-deluxe-memory-man`, `mxr-dyna-comp`); the rest move from 1e-14
iteration-path rounding up to volts, largest `boss-tw-1` (3.90 TS, 3.35 WASM against a 3.4 peak: the red record moves its
startup convergence, as in the workbench study, where settled audio agrees to 2.8e-5; the pre-existing TS-against-WASM gap on
`boss-tw-1` is unchanged in kind), `marshall-guvnor-drivemaster` (0.322 on both: plain diodes with part number `LED-RED` now
clip as red LEDs), `vemuram-jan-ray` (0.0662), `marshall-blues-breaker` (0.0594), `earthquaker-devices-plumes` (0.0363).
The TS-against-WASM console gaps on `moogerfooger-mf-102`, `marshall-1959-super-lead-plexi`, `orange-rockerverb` and `boss-tw-1`
are identical in kind on both arms: pre-existing packet state, not a regression. `boss-ph-1r` keeps console parity in this
harness.

**The runtime adopts a bar-clean candidate past the marginal line on both consoles (`1073c4f`).** A shipped sparse order that
replays the operating-point matrix within tolerance but worse than tolerance/10 (1e-4) now loses to a candidate an order of
magnitude cleaner without consulting the 1.1x fill-cost ceiling. Over this corpus exactly one block sits in that band,
`boss-aw-2` at 1x, and it converges 0 held at about 3 iterations where the published runtime held 157 of 1200 samples at up
to 1024 peak iterations: its audio moves with a byte-identical program (TS 2.74e-2, WASM 2.51e-2 against a 0.27 peak).
No other same-program packet moves on either console, which is the measured basis for the default-path claim above. The
regenerated kernel table has 139 kernels from 559 scheduled blocks; against the committed table one fingerprint goes
(`0x5a687ace`) and one comes (`0x5f19ae34`), both `boss-aw-2`: the packet was re-traced between the `67fb504c7` snapshot the
committed table was generated from and this corpus, so the old entry was dead and the new schedule ran on the interpreter.
Outputs are bit-identical with and without the regenerated table over the whole corpus on the WASM console. The runtime
changes nothing else: exact compiler pin only, no `Program`, `Stamp`, `ProgramJson.cpp` or `Program.h` change (`Engine.cpp`
plus `reference-runtime.ts` only).

The chain changes only its exact pins (compiler 0.8.0, core 0.17.0, runtime 0.6.2) and the player only its exact pins
(chain 0.1.10, compiler 0.8.0, core 0.17.0, runtime 0.6.2).

## compiler 0.7.0 / runtime 0.6.1 / chain 0.1.9 / player 0.2.7

**The Electro-Harmonix Slap-Back Echo compiles, and its delay comes from its own clock.** Until now the document was refused at
`IC3_SCL4013A` ("its part number \"SCL4013A\" matched no registry entry"). `SCL4013A` now rides the `CD4013AE` divider entry,
the same flip-flop with the strict `pin<N>_<role>` terminals that the `mxr-m117r-flanger` U3 uses. The echo time is derived
from the circuit and not declared: `deriveUjtRelaxationClock` (`bbd-clock.ts`) recognises the 2N4871 relaxation oscillator by
connectivity, typed roles and exact part ids, and gives delay = stages / f of the ideal relaxation law, 55.0 ms and 38.2 ms for
the two DELAY positions. The 2N4871 has a registry record (eta 0.775, the midpoint of the printed 0.70 to 0.85 range, a derived
value; RBB 6000, the printed typical), both citing the Digitron Rev. 20120705 table. A new `ujt` registry class carries the
contract (both parameters or none, a provisional arm, `DeviceOverride` target class `ujt` with eta bounds-checked) and
`DeviceLaw` gains a `ujt` kind that the lowering refuses loudly. **The UJT itself is still not executed**: `Q1_UJT` keeps its
`device-law-not-implemented` warning, because a frequency derivation is not a device execution, and the relaxation law proper
is blocked on a hysteretic-switch stamp (`docs/spikes/2026-10-20-ujt-law.md`).
`SAD1024A` now exits at section B when the document chains section A into it: `MacroPortRoles.cascade` names the section output,
the next input and the final output, and applies only when the first two share one non-ground node. A document that leaves
section B unused (the Deluxe Memory Man ties input B to ground) or gives it a node of its own resolves by `audioOut` exactly as
before. **The Slap-Back still makes no echo as shipped.** The packet's ideal `VBIAS` source sits on the BBD input node and
grounds the audio there (impulse echo 3.7e-5); on a scratch copy with that rail removed the echo is at 56.0 ms and 38.9 ms
against the derived 55.0 and 38.2, so the defect is the packet's and is not changed here. No claim is made that it is playable.
`BAT85` (Nexperia model: IS 2.076e-7, N 1.023, RS 2.326, basis manufacturer-model) and `BAT85S` (JED's part, its own entry on
the `community` basis with three provisional values, because no source states it is the BAT85) join the diode registry.

**The BJT and JFET default-parameter warnings now name only parameters that really run on a class default.**
`bjt-law-default-parameters` never read the registry, so it named every BJT whose document typed no IS or BF, including parts
whose record states both (the Slap-Back's 2N3904 and 2N3906). The JFET twin skipped any registered part wholesale, so `2SK30A`,
whose record states only its gate, ran Vt0 and Beta on the class default and said nothing. Entries built from a data record now
carry `citedParams`, and both warnings read it per parameter; a parameter the document types or the registry states for the exact
part is not a default. The `registry-override-applied` notice uses the same test, so an override over a gap-filled field no longer
claims it replaced a registry value. Warnings only: over the corpus no program digest or status moves. Pedal documents carrying
the BJT warning go 74 to 51 (devices 353 to 217) and the JFET warning 19 to 23 (devices 40 to 47; `boss-ge-7`, `boss-od-1`,
`boss-sg-1-slow-gear` and `ibanez-ts9` newly name a `2SK30A` stamp). Checked independently from the lawed netlist (stamped IS and
BF against the class default over 374 pedal BJT devices): IS is at default on 213 and named on 213, BF on 134 and named on 134,
none under- or over-warned; the same check on the previous code reads 351 over-warned.

**What moves, as measured 2026-10-20 against the published 0.6.0** (artifacts `67fb504c7`, committed files only, via `git archive`:
123 pedals and 23 amps). Compile level: 144 documents compile on both and all 144 emit byte-identical program text; the Slap-Back
compiles only on this version (145 against 144) and `boss-dd-3t` is refused on both. Audio level, default controls, one two-tone
(440 Hz at 0.25 and 1320 Hz at 0.1, 48 kHz, 2048 samples), published compiler and runtime against this tree's compiler and its
own wasm build: all 144 are bit-identical on both consoles, 136 of them non-silent (the other 8 are silent in both arms). A
repeat of the published arm reads 144 of 144 identical and a one-sample 1e-6 nudge of the input reads 122 (TS) and 119 (WASM) of
145 different, so the comparator was shown to answer both ways. The same two-tone for 3 s through the WASM console (the console
the kernel table touches) reads 144 of 144 bit-identical, 136 non-silent, with the same two controls (repeat 144 of 144, nudge 122
of 145 different). The kernel table changes only by fingerprint (below); outputs are
unchanged on every document that existed on 0.6.0.

**The runtime changes only its kernel table.** `GeneratedKernels.cpp` was regenerated with this compiler over the 145 corpus
programs that compile: 139 kernels from 563 scheduled blocks, against 139 from 561 in the committed table. Regenerating with the
published 0.6.0 compiler over the same artifacts gives 138 kernels, three fewer fingerprints and two more than the committed
table (`04ebbc7d`, `4417c5cf` and `b34a86d0` out, `795e96ff` and `cdab4ff6` in), which is artifacts having moved since the table
was last generated and not this compiler; this compiler adds exactly one more, `83ca2d95`, the Slap-Back's. No `Program`, `Stamp`, `ProgramJson.cpp` or `Program.h` change, hence a
patch bump; the exact compiler pin moves to 0.7.0.

**Not measured:** non-default controls and switch states, oversample above 1, real-time cost (the worklet scoreboard did not run),
a guitar take, ngspice for the UJT derivation, and whether the derived 55.0 and 38.2 ms are closer to hardware than the declared
times were. Four documents differ by volts between the two consoles in the 2048-sample window, identically in both arms
(`moogerfooger-mf-102`, `marshall-1959-super-lead-plexi`, `orange-rockerverb`, `boss-tw-1`); that is old behaviour, it is not
examined here, and it means "bit-identical across versions" says nothing about whether those four are right.

chain 0.1.9 and player 0.2.7 change only their exact pins, to compiler 0.7.0 and runtime 0.6.1 (and chain 0.1.9 for player).
Evidence and the checks run: `docs/releases/2026-10-20-release-prep-0.7.0.md`.

## compiler 0.6.0 / runtime 0.6.0 / chain 0.1.9 / player 0.2.7

**Correction, 2026-10-20: this entry describes less than 0.6.0 contains, and two of its four versions were never published.**
The entry below is the content of the release-prep commit `bbef01b`. The tags `compiler-v0.6.0` and `runtime-v0.6.0` sit at
`28dc820`, twenty commits later, so the published compiler and runtime 0.6.0 also carry the whole parameter-registry programme
that landed in between and that no entry describes: the stage-1 data registry with cited single-value parameters, the
`manufacturer-model`, `measured` and `community` bases (the last with a `registry-provisional-value` notice), waves 1 to 5 of
cited BJT, JFET, diode, zener and op-amp records, the regulator and 741 aliases with new 12 V and 3.3 V rails, the JRC4558,
JRC4558DD and JRC5534 aliases, charge-pump inverters modelled as derived negative rails, and the stage-2 `DeviceOverride` block
(read, validated, reported; no-effect and sections-trap overrides refused). Measured 2026-10-20 against the published 0.5.0 on
artifacts `67fb504c7`: 144 documents compile on both and 95 emit different program text (49 identical). Counting documents
whose stamps of a kind changed: `bjt` 62, `diode` 49, `fet` 37, `ideal-opamp` 13, and one each of `dc-source`, `input-source`
and `controlled-conductance`; the seven swing movers, `boss-sd-1` and `sunn-beta-lead` of the entry below are inside those
counts, so the registry programme alone is a subset. **The audio effect of that step was never measured.** Chain 0.1.9 and
player 0.2.7, named in this heading, were not tagged or published with it: npm holds chain 0.1.8 and player 0.2.6, which pin
compiler and runtime 0.5.0 exactly. Both ship with 0.7.0.

**Op-amp output swing is now a printed, conditioned, per-side pair, folded by the compiler into absolute rails.** The single
symmetric `outputSwingDropVolts` is gone, with no alias and no migration. A registry entry now carries
`outputSwingDropHighVolts` and `outputSwingDropLowVolts` together with the condition they were printed at
(`outputSwingPrinted`: total supply, load, and a `translation` of `constant` or `proportional`), or none of the three, and the
catalog loader refuses anything else. A new datasheet table, `opampOutputSwingDatasheet`, sits beside the gain-bandwidth
table (one transcribed TYP column per entry, printed rows only, never a graph reading): `OP07CP`, `OP07DP` and `OP07DN` are
2.2 V a side at 30 V total supply and a 2 kOhm load, `proportional` (TI SLOS099H, +-12.8 V typical), so a 9 V circuit gets
0.66 V a side; `TL061` and `TL062` are 1.5 V a side at 30 V and 10 kOhm, `constant` (TI SLOS078N Table 6.7, +-13.5 V typical),
which replaces a 1.2 V that had been read off a graph. The bare `OP07` id and `MC33178` move to a table of absences with a
stated reason each: the 1.1 V the registry carried for `MC33178` has no datasheet on file, so those sections now run the full
supply. `opamp-law-default-parameters` names, per device, whether the swing is `not-stated` or `stated-at-other-supply` (with
the printed and the circuit supply), so a figure carried across a supply is visible instead of silent. The swing never
leaves the compiler: the Stamp, `Program.h` and the kernels are unchanged, and only the `railHigh` and `railLow` of an ideal
op-amp stamp differ. This is a typed datasheet reading and not a fit to any specimen.

**A declared diode ideality is now read.** The diode law and stamp already carried `emissionCoefficient` and both consoles
already read it, but the netlist reader never read the property, and a diode with no catalog row got a hard-coded 1.752, so a
packet's stated ideality was discarded without a word. `EmissionCoefficient` is now read as a bare number, a number-only
string or a `{value, unit: ""}`, and refused by naming the component and the value when it is non-numeric, non-finite, below 1
or above 10 (no clamping). A declared value wins over an exact-part catalog entry, as the breakdown voltage, saturation
current and series resistance already do. A document that declares nothing compiles to a byte-identical program. One corpus
document declares it: `boss-sd-1`, 1.9 on D4 to D6, a 2026-07-14 packet declaration with no datasheet figure behind it.

**`s-curve` executes, and an unknown taper is refused instead of read as linear.** `TaperKind` gains `s-curve`, the one
S-shaped taper a vendor sheet on file prints (Alpha RV16AF W(4B): 5 to 15 percent at 90 degrees, 40 to 60 percent at 150,
85 to 95 at 210 of a 300 degree rotation): a monotone cubic through (0,0), (0.30,0.10), (0.50,0.50), (0.70,0.90), (1,1) with
zero slope at the stops and interior slopes 0.6, 2, 0.6, written as literals shared by `taper.ts` and the new
`include/v2/Taper.h`, using only + - * / so the two consoles return identical doubles. The shape between the printed points
is an engine convention and is not scored against anything. `parseTaperKind` used to map any unrecognised string to linear;
both consoles now refuse a taper outside the five and name it and where it was read (control, stamp, clockControl), and an
absent key still reads as linear. The C++ alias `anti-logarithmic`, never emitted by any compiler release, is gone. The
compiler resolves the folded spelling `scurve` (and `S-Curve`, `S Curve`, `s_curve`) to `s-curve`; the bare letters `W` and
`W20` stay unread. **The published runtime 0.5.0, given a program that carries `s-curve`, loads it with no message and plays it as linear**
(bit-identical to the same program written `linear`, measured on both consoles; earlier runtimes were not tested), so pin
compiler and runtime together (chain does). A compiler older than 0.6.0 can emit only the four older taper names, and the new
runtime plays the programs the 0.5.0 compiler emits for the 145 compiling corpus documents unchanged (0 refusals, every render
bit-identical on both consoles at the 43 ms cold start).
`@vessel-dsp/core`'s format comment now defines `s-curve` as Alpha W(4B) and every other S-shaped pot as `custom`. A
test-only wasm export, `v2_testonly_taper_fraction`, lets a test compare the two consoles' law bit for bit.

**What moves, as measured 2026-10-17 against the published 0.5.0** (artifacts `f84464799`, 0 dirty files: 123 pedals and 23 amps, 145
compile, `boss-dd-3t` is refused on both). Compile level: 137 documents compile to a byte-identical program and 8 differ, seven by
the swing pair or the declared diode ideality and `sunn-beta-lead` by the taper. Every sparse schedule is byte-identical, and the
generated-kernel table regenerated with this compiler over the corpus is byte-identical to the committed one, so nothing was
regenerated. The seven: `pro-co-rat-2-v4b-op07cp` (OP07 rails 6.8 and 2.2 V to 8.34 and 0.66 V), `mxr-phase-90`,
`mxr-phase-90-script`, `mxr-micro-flanger` and `mxr-micro-amp` (TL061 and TL062 rails 7.8 and 1.2 V to 7.5 and 1.5 V),
`mxr-carbon-copy` (the same for its TL062C sections, and its `MC33178` sections go from 7.9 and 1.1 V to 9 and 0 V, the full
supply) and `boss-sd-1` (D4 to D6 `emissionCoefficient` 1.752 to 1.9). `opamp-law-default-parameters` is now carried by 87
documents against 81, gaining exactly the six swing movers. `sunn-beta-lead` has four conductance stamps move from linear to
`s-curve` and loses its two `taper-not-executable` warnings. Audio level, default controls, both consoles, one two-tone
(440 Hz at 0.25 and 1320 Hz at 0.1, 48 kHz): 2048 samples over the 145 compiling documents, and 3 s over a 74-document set. In
both, every document outside the seven is bit-identical on both consoles (138 of 145, and 67 of 74), the seven differ, and
`sunn-beta-lead` is among the identical because its two controls sit at 0.5. Level change of the seven over the last second of the
3 s render, the two consoles agreeing to the printed digits: `pro-co-rat-2-v4b-op07cp` +0.41 dB, `boss-sd-1` +0.53 dB,
`mxr-phase-90-script` +0.50 dB, `mxr-phase-90` -0.11 dB, `mxr-carbon-copy` +0.002 dB, and `mxr-micro-amp` and `mxr-micro-flanger`
below 1e-6 dB. The new runtime given the programs the 0.5.0 compiler emits plays all 145 bit-identically on both consoles. A
comparator with four known-answer controls passed before any verdict was read. On the swing series by itself the phaser-sweep
instrument still reads both Phase 90 files SWEEPING (`mxr-phase-90` 144.4 to 131.7 degrees of depth, `mxr-phase-90-script`
383.0 to 379.8). Its reported sweep period for `mxr-phase-90` goes from 7.80 s to 16.04 s, and a direct probe of the oscillator's
own node does not show that: on the combined build the triangle swing narrows from 6.60 to 6.00 V peak to peak and its period
reads 7.90 s against 8.00 s (TS console, 72 s, default controls, 0.05 s grid), so the doubled figure is the instrument's
estimate and not the circuit's.

**Not measured:** non-default controls and switch states, oversample above 1, real-time cost (the browser proofs ran, the worklet
scoreboard did not), a guitar take in this release's gate, the 72 documents outside the 74-document set at 3 s, the packet
catalogs, ngspice for the taper law (it imports the law, so it could only agree with itself), and whether any change is closer to
hardware. No claim is made that the corpus is unchanged beyond the windows above, and `sunn-beta-lead` was not measured at
non-default controls on this combined build.

chain 0.1.9 and player 0.2.7 change only their exact pins, to compiler 0.6.0 and runtime 0.6.0 (and chain 0.1.9 for player).
Evidence and the checks run: `docs/releases/2026-10-17-release-prep-0.6.0.md`.

## compiler 0.5.0 / runtime 0.5.0 / chain 0.1.8 / player 0.2.6

**The op-amp gain-bandwidth product is now a typed, per-part fact that reaches the solver on both consoles.** The compiler
reads a packet's own typed `GBP`, else the datasheet typical figure for the exact part id from `part-catalog.ts`
(`opampGainBandwidthDatasheet`, one transcribed TYP column per entry, never a graph reading), and emits it as the optional
`gainBandwidthHz` on the ideal op-amp stamp (`Program.h` and `ProgramJson.cpp` carry the same field, which is why this is a
minor bump). A section no source states a figure for, among them every `uPC4558` id whose datasheets print no gain-bandwidth
row, stays on the 1 MHz class default and the compile names it with `opamp-gain-bandwidth-default`. **A runtime older than 0.5.0
given such a program ignores the field and runs 1 MHz without saying so, so pin compiler and runtime together.**
`JRC4558D` now resolves to the NJM4558 law entry and its 3 MHz row; that identification is the artifacts record
`parts/op-amps/JRC4558D.md`, not a printed id in the Nisshinbo sheet, and the entry and the row say so.

**Runtime: transient-solver fixes on both consoles** (the same logic in `reference-runtime.ts` and `Engine.cpp`):
consistent linearisation beyond the band, a seed-relative first step, a re-armed fold reseed triggered by a cap pinned at the
floor, and whole-update damping. They were needed because the bandwidth product changes the per-sample gain and so the
trajectory, which exposed old behaviour on positive-feedback op-amp sections (`boss-mt-2`, `mxr-blue-box`).

**What moves, as measured 2026-10-15 (836 renders, one 1 kHz sine at 0.5, 20 and 200 mV, default controls, 48 kHz, WASM and
reference consoles, published compiler 0.4.0 + runtime 0.4.1 against this release).** Of the 123 packets in
`schematics/vessel-dsp`, 48 change an op-amp bandwidth value; five of those are silent with a sine input and 43 are live. Of the
43, 35, 38 and 39 are within 0.1 dB at 0.5, 20 and 200 mV. The rest: `boss-aw-2` about +15 dB at every level,
`nobels-odr-1` +8.9 dB at small signal and +0.1 dB where it clips, `dod-envelope-filter-440-vintage-green` -6.1, -4.6 and
-1.0 dB, `pro-co-rat-2-v4b-op07cp` +0.82 dB at small signal only, and `boss-ce-5` -0.95 dB on an output floor that does not
depend on the input. **The default path is not bit-identical to 0.4.1.** The negative control found the runtime fixes move
packets whose bandwidth did not change: 8 identical-program packets differ by at most 3e-7 dB (19 of 24 renders
bit-identical) and 8 structurally-different-only packets by at most 0.13 dB (`electro-harmonix-deluxe-memory-man`
+0.105 to +0.130 dB, `boss-ch-1` -0.003 to -0.017 dB; both go from 2.0 to 1.0 Newton iterations per sample at 0.5 mV),
11 of 24 renders bit-identical. Only 16 of the 75 packets whose bandwidth did not change were sampled.

**Stability.** `boss-mt-2` completes 8 s at oversample 2 and 4, where the published stack did not finish in 900 s each; at
oversample 1 it is not fixed (148 to 76 non-converged samples in 8 s, 472 to 191 in 20 s, peak iterations 1024, the cap).
**One regression:** `mxr-blue-box` at oversample 2 goes from 0 to 1 non-converged sample with peak iterations 342 to 1024; it is
clean at oversample 1 and 4 and in a 20 s oversample-1 run. `boss-dd-3b` (silent) goes from 5 to 0 non-converged samples at
oversample 2 and 3 to 0 at 4. `boss-bf-3` reads every sample non-converged on both stacks (a DSP-chip packet; unchanged).
Newton iterations fall by 20 to 70 percent on about 15 packets and are otherwise within 25 percent. Reference and WASM consoles
agree within 0.01 dB on 126 of 128 renders (`boss-dd-3b` 0.12 dB old, 0.14 dB new). The owner accepted the regression and the
level movers on 2026-10-15.

**The generated kernels were regenerated** with this compiler over the 145 corpus programs: the table still has 139 kernels from
561 scheduled blocks, but 6 fingerprints changed, so without the regeneration those six blocks would have run on the interpreter
(same answer, slower). The published wasm is built by CI with emscripten 3.1.74; the local build used 6.0.4 and a previous release
found the two bit-identical on six packets, which is not shown for the whole corpus here.

**Not measured:** real-time cost, the browser, a guitar take, non-default controls or switch states, oversample 3 or 8, the 59
packets not in the sample, and whether any change is closer to hardware. No claim is made that the corpus is unchanged.
Evidence: `docs/releases/2026-10-15-release-prep-0.5.0.md`.

chain 0.1.8 and player 0.2.6 change only their exact pins to compiler 0.5.0 and runtime 0.5.0 (and chain 0.1.8 for player).

## runtime 0.4.1 / chain 0.1.7 / player 0.2.5

Fix: the Newton start predictor now runs only when `oversample > 1`. At the default factor 1 it neither seeds
nor records: the ring, chain and order never advance, `seedsUsed` and `oneIterationSolves` stay 0, and every
solve starts from the previous solution exactly as in runtime 0.3.1. The change is one condition on the
predicate each console already evaluated (`this.oversample > 1` in the reference runtime, `oversample_ > 1`
in the C++ console), the same in both; no knob, no `.vdsp` field, and nothing else in the solver moved
(tolerances, device laws, the predictor's order, scoring and `used > 2` gate, the resampler and the pivot code
are as in 0.4.0). The factor is fixed by `prepare()`, which also clears the ring, so there is no mid-run
switch. Every factor above 1 keeps the predictor, powers of two and the held path alike: on the five profile
packets measured (reference console, 1 kHz 0.1 V, cap 64) factor 3 saves 0.0-1.3% of iterations, 5 and 6 save
8-19% and 10-24%, 2/4/8 save 6-15%, 39-47% and 44-50%, and at none of them does the predictor move the output
by more than 6e-6 relative RMS. The whole corpus at 2x and at 4x is bit-identical to 0.4.0 on both consoles.

Why, found by the workbench's release-pin gates against the published 0.4.0 at factor 1, and not in the 0.4.0
note: `boss-mt-2` on the WASM console stalled permanently from sample 132 096 (2.752 s) of the scoreboard
two-tone drive, every later sample costing about 90 ms (roughly 4 300x real time) and never recovering, which
a 2048-sample parity run cannot see; and the predictor alone moved `boss-dm-2` by 6.2% of its cold-start peak
(0.5-0.8% of the settled peak), identically on both consoles, at the factor where it bought only 2.9% (pedals)
and 10.1% (amps) fewer iterations. With the gate `boss-mt-2` renders the same eight seconds on both consoles
without a stall, and removing the gate in a scratch build brings the stall back at the same sample with the
same predictor telemetry; whether the seed starts the stall or the trajectory it selects simply lands where the
previous start did not is not established.

Factor-1 output is again bit-identical to runtime 0.3.1 except where the numeric re-pivot adopts. On the 145
corpus packets that compile (122 pedals and 23 amps; programs text-identical under compiler 0.3.0 and 0.4.0),
144 of 145 reference-console renders and 145 of 145 WASM renders are bit-identical to 0.3.1, on the two-tone
cold-start window (2048 samples) and again over 16 384 samples; `boss-dm-2`, `boss-hm-2`, `ibanez-ts9-reissue`,
`big-muff-pi-ec3003-rev-f`, `boss-mt-2`, `boss-od-1`, `ibanez-ts808`, `orange-gro100` and `mxr-blue-box` are
bit-identical on both consoles over one second of two-tone drive and over the 1 kHz 2400 + 9600 sample
protocol. The one exception is `boss-sd-1` on the reference console (4.5e-8 absolute over 2048 samples, 5.8e-8
over 16 384, 1.2e-7 of peak): the 0.4.0 numeric re-pivot adopting there (disabling the adoption in a scratch
build makes it bit-identical). The C++ console keeps the shipped order on sd-1, so its sd-1 is bit-identical too.

Corrected account of 0.4.0 at factor 1: the 0.4.0 sentence "every factor-1 render of a nonlinear circuit moves
at the 1e-7..1e-6 level" was wrong for the corpus. Largest absolute difference against 0.3.1 relative to the
0.3.1 peak, two-tone cold-start window after the first 100 samples, 145 packets, reference console: 39
bit-identical, 14 up to 1e-9, 25 to 1e-7, 23 to 1e-6, 24 to 1e-5, 13 to 1e-4, 5 to 1e-3, 2 above 1e-2
(`boss-dm-2` 6.2e-2, `boss-mt-2` 2.1e-2); WASM console 47, 4, 26, 25, 24, 13, 5 and 1 (`boss-dm-2`). Over one
second of two-tone drive 0.4.0 moved `boss-dm-2` by 0.12 relative RMS and `orange-gro100`, a cap-storm tube
amp whose trajectory is chaotic, by 0.36 (neither run is validated against hardware). The 13 linear-only
packets were byte-identical, so that half of the sentence held. Runtime 0.4.0 users at factor 1 saw this
movement: a factor-1 render made with 0.4.0 differs from 0.3.1 and from 0.4.1 by that much, and 0.4.1 returns
to the 0.3.1 output. Callers at `oversample` 2 and above get the same output from 0.4.1 as from 0.4.0.
`chain` 0.1.7 and `player` 0.2.5 re-pin only (runtime 0.4.1; compiler stays 0.4.0).

## compiler 0.4.0 / runtime 0.4.0 / chain 0.1.6 / player 0.2.4

Oversampling is band limited. `prepare(rate, { oversample })` at a power of two now solves at `rate * N`
behind a linear-phase half-band FIR cascade (one 2x stage per factor of two; stage-specific prototypes of
41/29/21 taps at Kaiser beta 6.0/7.0/6.0; coefficients a function of the stage only) instead of holding
each input sample flat across the sub samples and keeping the last one. Why: trapezoidal integration warps
frequency, and a 48 kHz host droops against native 192 kHz by 2.2 dB at 8 kHz and 12.3 dB at 16 kHz on the
Big Muff (SD-1 1.2/5.0 dB, TS-9 1.3/5.7 dB; probe harness, 10 mV stepped sines at centre controls, LS
fundamental fit). What os4 buys at 48 kHz: within 0.001 dB of native 192 kHz on all three pedals at every
test frequency with the 57-tap prototype the work started from, within 0.006 dB with the stage-specific
cascade that ships; aliasing at 2311 Hz, 100 mV, maximum drive reads -48.9 dBc on the SD-1 against -46.7
native (TS-9 -48.5 vs -46.5; the old hold path left -34.6), on the clean side because the decimator also
removes genuine 24-29 kHz content. Latency is reported, not hidden: 19.5 / 26.25 / 28.625 host samples at
2x/4x/8x (0.55 ms at os4 and 48 kHz) through the new `oversampleLatency()` on both consoles, with
`hostSampleRate()` beside it. Lower was measured and rejected: a minimum-phase FIR of the same magnitude
reaches about 4 host samples but costs 1.7-2.1x the delay-removed waveform error on every pedal and stimulus
(worse than a deliberately strong allpass on the Muff), and an IIR polyphase half-band fails magnitude by
1.5 dB at 8 kHz; the shipped cascade's waveform error against native 192 kHz is within 1.01x of the 57-tap
design on every stimulus. Non-power-of-two factors keep the held path at latency 0. The in-repo RC
transparency bar moved 0.001 -> 0.01 dB: the residual (worst 0.0047 dB) is the 41-tap first stage's own
passband ripple, reproduced digit for digit on the reference console, not a port error.

Sparse schedule orders are now numeric-aware. The runtime builds a value-aware candidate order from the
operating-point Jacobian at `prepare()` (`computeNumericRepivot`, tau 1e-3, now built in the compiler and
exported with `NUMERIC_REPIVOT_TAU`: the compiler minor bump), adopts it over the shipped pattern-based
order only when its replay against dense is within 1e-9, an order of magnitude better than shipped and
within 10% fill; rescues a shipped order that collapses; and re-pivots once mid-run from a snapshot after 64
consecutive pivot-guard trips. Corpus effect (122 pedals + 23 amps, sparse-vs-dense relative RMS at 1 kHz
0.1 V, Newton cap 64): `boss-sd-1` 6.9e-8 -> 6.5e-12 (+3.6% slots), every other packet bit-identical, zero
new fallbacks or abandoned blocks, wall time within noise (sd-1 +0.5%). A relative pivot guard was tried at
three taus and reverted: it dropped `boss-ce-5` to dense and sent `mf-102` to 528k fallbacks with no audio
change; the guard stays absolute at 1e-18. What it cannot do: packets at the 1e-8..1e-9 static floor
(`boss-hm-2`, `marshall-jcm800` class) are order-invariant across nine taus, and the fill cap holds back
known wins on `mxr-phase-90-early-block`, `mxr-phase-45` and `boss-os-2` because the same cap blocks
`mxr-phase-90`'s 30x regression.

Newton solves start from a predictor. A standard audio-pass solve of a nonlinear block seeds from a
self-selecting order-0/1/2 extrapolation of the block's last three converged solutions, the order chosen by
scoring the three candidates against each converged solution in tolerance units, and used only after a
solve that took at most two iterations (`used > 2` forces order 0; non-convergence breaks the chain;
`prepare()` and `reset()` clear it). No constant, no knob. At os4 it cuts Newton iterations per host sample
39-47% on muff/sd1/ts9/ts808 and 44% on gro100 (TypeScript in-process; the WASM A/B runs the pedals at
0.59-0.74 of the baseline time, and the Muff at os4 is newly under the 20.8 us in-process budget at 0.97);
at x1, 0-11% on those six and -2.9% / -10.1% across the pedal / amp corpus with no packet more than +2.2%.
Every converged pedal solution sits within 0.012 tolerance units of full Newton from the same state. The
price, stated plainly: output agreement with dense moves from 1e-12..7e-8 to 2e-10..4.5e-6 on the pedals
(the 1e-9 bar is structurally unmeetable by any method that changes the start, since a different first
iterate is accepted at a different point inside the 1e-3 / 1e-6 tolerance band), and one to four
non-converged samples appear on three cap-storm packets (`boss-mt-2` 9 -> 13, `mxr-phase-90-early-block`
0 -> 1, `hiwatt-dr103` 24 -> 25: chaotic trajectories whose counts move on any 1-ulp change). The C++
console runs the same predictor and makes the same order decision on every one of 57 600 host samples
across six packets at x1 and os4; it exports `getPredictorTelemetry()` (`seedsUsed`, `oneIterationSolves`,
`totalIterations`) and `getPredictorOrder(blockIdx)`.

WASM: the native `v2_engine_prepare` export now takes `(handle, sampleRate, maxNewtonIterations,
inputSourceOhms, oversample)`. The existing export changed; there is no second one, and the wrapper passes
the argument. `GeneratedKernels.cpp` is regenerated from the 145 corpus programs (139 kernels, was 137).
Console parity (workbench method: 440 + 1320 Hz two-tone, r >= 0.9999, max abs < 1e-4) holds at
x1/os2/os4/os8 on the six profile packets except the pre-existing blue-box os2 marginal (1.04e-4); sd1 and
ts9 keep their libm offsets (7.7e-6 / 2.7e-5).

What did not change: the default factor is 1, so no existing caller's output changes through the resampler
(~~factor-1 renders were bit-identical to the previous console with the predictor disabled~~ with the
predictor disabled, factor-1 renders were bit-identical to the previous console on 144 of 145 corpus packets on
the reference console and 145 of 145 on the C++ console; the exception, `boss-sd-1` on the reference console,
is the numeric re-pivot above). ~~The predictor is not disabled: every factor-1 render of a nonlinear circuit
moves at the 1e-7..1e-6 level (max abs against the previous console on the two-tone window: muff 9.6e-8,
ts808 2.4e-6, blue-box 7.0e-7); linear-only circuits are byte-identical.~~ *Struck 2026-10-09: superseded by
the runtime 0.4.1 entry above. In 0.4.0 the predictor was not disabled at factor 1 and its movement there was
not 1e-7..1e-6 across the corpus (two packets moved by more than 1e-2 of peak, and `boss-mt-2` stalls the WASM
console); 0.4.1 gates it to `oversample > 1`.* `chain` 0.1.6 and `player` 0.2.4 re-pin only. Rejected on evidence, so nobody
re-proposes them: zero-order hold oversampling (-8.4 dB wrong on a shunt-inductor high-pass at every
frequency, error growing with the factor); minimum-phase and IIR polyphase resamplers (above); a relative
pivot guard (above); chord/Shamanskii and Broyden factorisation reuse (linear convergence lets the delta
test accept iterates 10 tolerance units from the root, more iterations on every packet, and sd1 at x1
latched into a wrong self-consistent state that every per-sample check passed); event sub-stepping for the
gro100 cap storm (99.7% of its storm samples are genuine non-convergence of the EL34 push-pull stage and
global feedback loop, where full dense Newton fails too).

## compiler 0.3.0 / runtime 0.3.1 / chain 0.1.5 / player 0.2.3

Fix: the exact part id `2SK30A` now carries its own silicon gate-junction data (`gateSaturationCurrent` 1e-14,
the device database's value for every JFET row; channel left at the class default). The JFET default's gate
junction (1e-5, reused from the triode grid and never measured against a JFET) sat 0.11 V under its onset in a
switching JFET biased on, drew microamps from the signal path and put an even harmonic and about 3.5 dB of
loss on the effect path: `ibanez-ts9` second harmonic -29.6 to -78.0 dB, fundamental +3.6 dB at 30 mV in
(Drive 0.5, Tone 0.5, Level 0.3, direct tap), engine and ngspice agreeing. Unregistered parts, and the aliased
ids `2SK30ATM` / `2SK30ATM-Y` / `2SK44SPC`, keep the class default byte-for-byte (`boss-cs-2`, `boss-ds-1`,
`boss-dm-2`, `boss-ds-2`, `boss-bd-2-blues-driver`, `ibanez-ts808` program and render hashes unchanged);
`boss-sg-1-slow-gear` declares `2SK30A` exactly and moves -0.018 dB (its gate is 0.5 V below onset). Adds the
public export `gateOnlyFetPartIds` (compiler minor bump); runtime, chain and player only re-pin the compiler.

## player 0.2.2

Fix: with the real engine, `@vessel-dsp/player` 0.2.0 and 0.2.1 played SILENCE through the circuit
unless the page called `selectInput` by hand. The controller's default input (the first blog input)
was state in the controller only; the engine was never told, never fetched the file, and fell back to a
silent buffer, while the UI showed the input as selected. The controller now hands its selected input
to the engine when it loads and when the source list changes (only when it changed, and never the
browser microphone as a default). The browser proofs had passed on a startup transient: a silent chain
still shows one loud first window, so the proof now requires sound in at least 80% of its windows.
Do not use player 0.2.0 or 0.2.1 for playback. No other package changes.

## player 0.2.1

Fix: `registerPlayerEngine` checked only for an `AudioContext`, so a browser that has one but no
`AudioWorkletNode` (one that predates worklets) was admitted, reached `ready`, and failed at the
first play instead of using the fallback mp3. The factory now refuses it with `no-audioworklet`.
No other package changes: runtime 0.3.0 and chain 0.1.4 stay current.

## runtime 0.3.0 / chain 0.1.4 / player 0.2.0

The player gets a real engine. `@vessel-dsp/runtime` 0.3.0 packages the AudioWorklet
(`dist/worklet/v2-audio-worklet.js`, exported as `./worklet.js`) and exports its protocol
(`postV2WorkletMessage`, `v2WorkletProcessorName` and the `V2Worklet*` message types); the packaged
worklet runs `program` slots only. `@vessel-dsp/player` 0.2.0 adds `@vessel-dsp/player/engine`
(`registerPlayerEngine`): a player-owned worklet bundle running pedal, NAM and IR in one chain on
the audio thread, a main-thread engine that loads nothing until the first user gesture, and an
admission gate that times the program inside the worklet and refuses, naming the numbers, any
chain that costs more than 25% of one audio period (`ADMISSION_CPU_FRACTION`): a pedal at about 40%
overran 10 to 166 times in 3 s in the browser, chains at 2-14% never did. The player also gains
`selectNam` validation with a typed `rate-mismatch` refusal and a `program` property for
precompiled circuits. No page bundle imports the Emscripten glue: a real `next build` of the blog
with the engine registered succeeds with no `v2_dsp.cjs` in client chunks
(`packages/player/scripts/next-bundle-proof.ts`). `chain` 0.1.4 only re-pins the runtime.
Do not use runtime 0.2.x with player 0.2.0: 0.2.x has no worklet exports.

## runtime 0.2.3 / chain 0.1.3 / player 0.1.4

`GeneratedKernels.cpp` regenerated for the programs that ship (137 kernels, was
135). Four packets had a qualifying block with no kernel and ran on the
interpreter at about 2.7x the per-op cost, with no diagnostic: `mxr-phase-90`,
`mxr-phase-90-script`, `mxr-phase-90-early-block` and `fulltone-ocd-v1.4`.
`mxr-phase-90` went from 22399 ns/sample (1.08x, over the real-time budget) to
6216 (0.30x) in the worklet. Output is bit-identical between the interpreter and
the kernel on all four (max abs delta 0). `boss-aw-2` and `mxr-dyna-comp` still
run on the interpreter by design (their order is re-pivoted). Also fixes
`scripts/generate-kernels.ts`, which did not parse (unescaped backticks in an
error message). `chain` and `player` pin the runtime exactly and move with it.

## runtime 0.2.2 / chain 0.1.2 / player 0.1.3

Audio-taper law: the logarithmic taper base moves from 81 to 1089/49, so a
logarithmic pot at half rotation reads 17.5% of the track instead of 10% (the
midpoint of the Alpha A-taper maker's 10-25% bracket at the 150-degree test
point, Alpha RV16AF SP16050157 section 2.4). Meter-confirmed on one RAT
specimen: Volume 19.3%, Distortion 20%, Filter 21% at the noon mark; base 81
under-read every audio-taper noon by about 4.4 dB. Both consoles change
together (`taperFraction` in TypeScript and C++), so a program's audio-taper
controls render differently at every position except the ends. `chain` and
`player` pin the runtime exactly and move with it (chain 0.1.2, player 0.1.3).

## player 0.1.2

`@vessel-dsp/player` 0.1.1 still pinned `@vessel-dsp/chain` 0.1.0, which pins
the broken `@vessel-dsp/runtime` 0.2.0 (no `structuredClone` in a worklet), so
installing it pulled both runtimes. 0.1.2 pins `chain` 0.1.1. Use player 0.1.2.

## runtime 0.2.1 / chain 0.1.1 / player 0.1.1

Fix: `V2WasmEngine.loadProgram` called `structuredClone`, which an
AudioWorkletGlobalScope does not expose, so the wasm console failed to load
any program inside a worklet (`structuredClone is not defined`) in
`@vessel-dsp/runtime` 0.2.0. It now copies the program by JSON round-trip (the
program is JSON by construction). `chain` and `player` pin the runtime exactly,
so they move to 0.1.1 / 0.1.1 on `@vessel-dsp/runtime` 0.2.1. Do not use
runtime 0.2.0 or chain/player 0.1.0 in a browser worklet. A test now loads a
program with `structuredClone` removed from the global scope.

## compiler 0.2.0 / runtime 0.2.0

`@vessel-dsp/compiler` and `@vessel-dsp/runtime` are now the engine's source of
truth: the TypeScript compiler, the TypeScript reference runtime and the C++
solver console moved here from the workbench, replacing the 2026-09-16 copies.
Both packages move to 0.2.0 and `chain`/`player` pin them exactly.

- The compiled wasm console (`v2_dsp.cjs`/`v2_dsp.wasm`) is a release artifact:
  `bun run --cwd packages/runtime build:wasm` (needs `em++`) writes it to the
  gitignored `src/wasm/`, `build` copies it to `dist/wasm/`, and `prepack` does
  both. `V2WasmEngine.create()` loads it from the package's own glue.
- `@vessel-dsp/compiler` exports `.`, `./diagnostics` (the report-only reach
  into stages) and `./fixtures` (the synthetic circuits the engine is graded
  on). `@vessel-dsp/runtime` exports `.` and `./wasm/*`.
- Runtime supply control (`getSupplies`/`setSupply` on both consoles) and the
  compiler's `resolveSupplyStamps` are the workbench's; the two consoles agree
  to <1e-4 on a sagged synthetic stage (`tests/supply-cross-console.test.ts`).
  Call `setSupply` before `prepare()` or mid-stream: the consoles solve the
  operating point at different moments, so a call between `prepare()` and the
  first sample is not guaranteed to agree.
- Compiled `Program`s carry `formatVersion` 6 (was 1 in the 0.1.0 copies).
  Named I/O ports and the `bufferProgram` bypass are deferred to a later
  `formatVersion`; from here any change to `Program`, the `Stamp` union,
  `ProgramJson.cpp` or `Program.h` is a package minor bump.
- Tests moved into the packages (`packages/{compiler,runtime}/tests`). The
  runtime pipeline test still imports compiler stage files through the
  repo-only `@vessel-dsp/compiler/<stage>` path mapping; those are not
  published exports.
- `publish.yml` gains `compiler-v*`, `runtime-v*` and `player-v*` tags (and
  dispatch choices), an emsdk step, and a gate that runs both packages' suites
  against the freshly built wasm before `runtime` publishes. Publish order:
  compiler, runtime, chain, player; each refuses if a pinned `@vessel-dsp`
  dependency is not on npm.

## chain 0.1.0

New package `@vessel-dsp/chain` 0.1.0: headless signal chain graph
(`SignalChain` with `InputProfileNode`, `RuntimeNode`, `AmpShaperNode`,
`CabinetIrNode`, `GainNode`, `MasterNode`). Cabinet IR is zero-latency
uniform-partitioned FFT convolution with wet-path Butterworth low/high cuts
and `irSampleRate` resampling. `AmpShaperNode` is a tanh waveshaper with
dry/wet mix; supply profiles (`SupplyProfile`, `SUPPLY_PROFILES`,
`profileFromMeasurement`, `customSupplyProfile`, `RuntimeNode.setSupplyProfile`
with `getSupplyResolution`/`getSupplyProfile` and the preset pair
`supplyOpenCircuitVolts`/`supplyInternalResistanceOhms`) move the external
rail inside the solver with no audio-domain processing.

`NamNode` (`kind: "nam"`) plays Neural Amp Modeler `.nam` captures through
NeuralAmpModelerCore v0.5.4 compiled to plain WebAssembly, vendored in the
package as `nam-engine/nam-engine.wasm` with its glue and MIT notices. The
engine is instantiated by the host from wasm bytes the caller supplies (a
worklet scope has no `fetch`); the node takes the model's JSON text and runs
whatever architectures the pinned engine supports (`Linear`, `WaveNet`,
`LSTM`, A2/slimmable). A model whose stated sample rate differs from the
chain rate by more than 0.5 Hz is refused by name -- both rates and the model
are in the error -- and a model stating no rate is accepted; nothing resamples
a model to fit the chain. Loudness normalisation (NAM's `Normalized` mode,
target -18 dB) is applied by `nam_process` itself, so the node applies no
loudness gain; `getInfo().loudness` reports what the engine did. There is no
A/B calibration mode. Model files are NOT bundled: `.nam` captures are
third-party artefacts and licensing them is the user's responsibility.
`SignalChain.fromJson`/`loadPreset` cannot recreate a `NamNode` -- a preset
carries neither an engine nor a model -- so the default node factory returns
`undefined` for `kind: "nam"`; a host that can supply both passes its own
`nodeFactory`. `ChainNode` gains an optional `dispose()`, which
`removeNode`, `clearNodes` and the replace-by-id path in `addNode` call on
the node they drop.

## 0.16.0

### A tapped parameter can carry the firmware's tap law

`ProgramParameter.tap` (`ProgramTapLaw`, on a `tapped` read only): `presses`, the run length before a
tempo is set (at least 2); `timeoutSeconds`, the gap that ends a run and keeps the tempo; and
optional `defaultSeconds`, the interval before any tempo is set, which the parameter scales by its
`ratio`. Omitted, a tapped read is the interval between the last two presses, as in 0.13.0. The
parser refuses a tap law off a tapped read, fewer than two presses, and a non-positive time.

It exists for the Boss DD-5, whose owner's manual states all three: "Pressing the Footswitch more
than four times will automatically set the basic tempo", "If the interval of pressing the
Footswitch is longer than 2 seconds, the basic tempo will remain", and the untapped quarter note is
300 ms.

## 0.15.0

### A controller pin can be high at a control's detents

`ControllerPin` takes exactly one rule: `follows` a latch, as in 0.14.0, or `highAt: { control,
positions }`, which holds the pin at the chip's supply at the listed zero-based detents and at its
ground everywhere else (`invert` reverses either). The parser refuses a pin with neither rule or
both, and an empty or repeated position list.

It exists for per-mode firmware outputs. A Boss DD-5's CPU raises P10 in MODE 7 (E/D), which through
the traced Q6 and Q4 mutes the dry path to OUTPUT, so that jack carries effect only, as the owner's
manual states. The per-mode table is firmware and is declared; the mute is the circuit's.

## 0.14.0

### A microcontroller declares its firmware rule: latches and the pins that follow them

`Component.controller` carries what a CPU's firmware does with the panel, for a chip whose
firmware cannot be read: `latches` (an `id`, the panel control whose press `toggledBy` flips it,
an `initial` state, a required `source`) and `pins` (one of the component's own terminals that
`follows` a latch, optionally `invert`ed, with a `source`). A latch's `id` is a control id, so a
program reads it the way it reads a knob. `ic` gains the opt-in `supplyPositive` and
`supplyNegative` roles, and a controller that drives pins must declare both: a pin's levels are
the chip's own supply, never a number typed into the document. The parser refuses no latches, an
initial other than 0 or 1, an empty citation, a duplicate latch, a pin on a terminal the chip
does not have, a pin following an undeclared latch, and pins on a chip with no declared supply.

It exists for CPU-switched pedals. A Boss DD-5's footswitch is a momentary contact its CPU reads;
"effect on" is a latch the firmware keeps, and the CHECK LED and the dry-mute transistor follow
CPU pins. Which pin the switch reaches and what a pin drives are the circuit's and are never
declared here; only the firmware's rule is.

## 0.13.0

### A program parameter can be tapped

`ProgramParameter.read` gains `tapped`: the chip named by `scannedBy` measures the time between
presses of the control and hands the program that interval, times an optional `ratio`, clamped to
`min..max`. `scannedBy` and `control` are required as for `scanned`; `ratio` is refused on any
other read and must be positive; a router cannot be tapped.

It exists for tap tempo. A Boss DD-5's four TEMPO positions set the delay to a subdivision of the
beat tapped on its TEMPO jack, and the panel legend names them: quarter, dotted eighth, eighth,
quarter triplet -- ratios 1, 0.75, 0.5 and 1/3 of the tapped interval. The circuit shows a contact
reaching the CPU; only the legend says the CPU is timing it, so this is the one fact about the jack
that has to be declared.

## 0.12.0

### A program position declares the parameters its ops refer to

`ProgramPosition` gains `parameters`: named, cited `ProgramParameter`s (range, sweeping control,
`read` / `scannedBy`, `source`) that ops refer to by `{ parameter: <name> }` wherever they would take
a number. Parsed by the same function as a line's parameters, and held to the same scanned-reader
check.

Lines could already carry a swept number; ops could not. A Boss DD-5's F.BACK and E.LEVEL are gains
on the program's mix -- feedback into the line, and the wet level out of it -- not properties of the
delay line, and the only way to state them was to misfile them as line parameters. Which op
arguments accept a reference stays the executing runtime's vocabulary, as op names already are.

Optional and written back only when declared, so every existing document round-trips
byte-identically.

## 0.11.0

### A program parameter says how it reaches its control

`ProgramParameter` gains the same `read` / `scannedBy` pair `ProgramRouter` gained in 0.10.0, with
the same meaning and the same refusals, read by one shared parser so the two cannot come to
disagree about what `scanned` means. A scanned parameter must also name the `control` it reads:
scanning nothing is not a reading.

It exists for the same pedal. A Boss DD-5's D.TIME pot sits on the VR board beside MODE, and its
wiper leaves through the same connector to the same CPU ADC bank that no available sheet resolves.
The router could already say MODE is scanned; a parameter could not say the same of D.TIME, so the
one knob whose range the source cites for every mode had no typed way to be read, and a consumer
could only leave it dead or guess a wire.

Both fields are optional and are written back only when declared, so every existing document
round-trips byte-identically.

## 0.10.0

### A router says how it reaches its control

`ProgramRouter` gains `read`, either `node` (the default, unchanged behaviour) or `scanned`, and
`scanned` requires `scannedBy` naming a component this document has.

`node` is the stronger claim: the control's wiper drives a node a consumer can solve, so the
selection is read from the circuit like any other voltage. It stays the default and nothing that
uses it changes.

`scanned` exists because that path is sometimes untraceable from any available source. A Boss
DD-5's MODE pot runs through a connector whose far side no obtainable sheet resolves, while the
panel fact -- eleven detents, and which one is which mode -- is fully documented on the drawing and
in the packet's own contract, which already names the CPU as the control's owner with the role of
mode scanning. Refusing a documented fact to protect a transport nobody can see is precision about
the wrong thing, and modelling the transport buys nothing anyway: firmware quantizes that voltage by
rules no dump exists for.

**It is not an escape hatch for an unwired knob**, and that is what `scannedBy` is for. The claim
has to name a chip that is on the board, so it is checkable and specific rather than a way to make
any dangling control appear alive. Refusals: `read` outside the two values, `scanned` with no
`scannedBy`, `scannedBy` naming a component the document does not have, and `scannedBy` on a `node`
router.

## 0.9.0

### A program declares a router, not a selector

**Breaking.** `ComponentProgram.selector` is removed and replaced by `ComponentProgram.router`,
which names the control, its discrete position count, and the routes that bind positions to
programs. A document using `selector` no longer parses.

`selector` said which control chooses, and nothing more. That was too little to execute. A Boss
DD-5's MODE knob is VR4, an 11-detent 50k pot whose wiper reaches the CPU's analog input; the CPU
quantizes that voltage and tells the DSP which program to run. With only a control name, a consumer
had to invent the mapping, and the obvious invention -- spread the declared programs evenly across
the knob -- is wrong the moment a packet declares four of eleven modes, because the four would smear
across the whole sweep and land where the undeclared ones live.

A router says it exactly. Three things a per-position index could not buy: two detents may run the
same program; a detent may run none, which is how an undocumented mode is declared absent rather
than merely missing; and a variant that moves the same programs onto a different control changes
only this block.

`positions` restates the control's detent count deliberately, as the router's expectation. A
consumer that also resolves the control can compare the two and refuse on disagreement, which is
better than one unchecked number.

Refusals: a router with no control, fewer than two positions, no routes, a route outside the
control's range, a duplicate route, or a route naming a program the component does not declare. A
detent with no route is legal and is the point.

## 0.8.1

### An opaque chip can name its audio boundary

`ic`, `bbd` and `delay-ic` terminals may now declare `role: input` and `role: output`. `pin` stays
legal and stays the default.

0.8.0 let a component declare the program it runs. That says what the chip computes; it does not say
which two pins the guitar signal enters and leaves by, and a consumer needs both facts to place the
chip in a signal chain. The only way to supply the second one was a table keyed on the part number,
which is the workaround the `input` role was defined to remove, and which cannot be right for
reprogrammable silicon: `TC25SC080AU-104` is a delay in `boss-dd-5`, a reverb in `boss-rv-3` and a
pitch shifter in `boss-hr-2`, so a part-keyed table holds one answer where the corpus has three.

The widening is those three kinds only. `flipflop` is the same shape of part and was left alone
because nothing needs it, and no other role was admitted: an `ic` still cannot declare `wiper`,
`gate` or `nonInverting`.

## 0.8.0

- A component may declare the **program it is running**: `component.program`, with `positions`
  carrying op lists and, where the component has a mode switch, a `selector` naming the control
  that chooses between them. Each program parameter carries its own `source` citing the document
  its range is read from.

**Why this belongs in the format rather than in a consumer's table.** A catalog entry holds one
model per part, which is right for fixed-function silicon and wrong for a reprogrammable chip.
Measured on the `vessel-dsp/artifacts` corpus: `TC25SC080AU-104` is a delay in `boss-dd-5`, a
reverb in `boss-rv-3` and a pitch shifter in `boss-hr-2`; `TC220CCA0AF-B01` is five effects
differing in kind, including a flanger and a bass synth, behind one mask revision. Both parts are
already recorded as `reprogrammable` with that behavioural evidence as their basis. No part-keyed
lookup can express it, and neither can a part-keyed proxy declaration — so the fact the source
could not state gets a typed field here rather than a guessing rule downstream.

**What this is not.** Not a firmware dump, and no consumer may read it as one. It is a bounded
behavioural declaration whose numbers cite a document.

**Why the citation sits on each parameter.** A parameter with no documented value cannot be set,
so the citation has to travel with the number. Per parameter rather than per program because that
is the only form that distinguishes an evidenced range from a bare one — a single pointer at the
top of a declaration cannot show that one mode is documented and the next is a guess. This follows
the convention the tube registries already use, where each coefficient carries its own `source`.
Omitting `source` is therefore a statement: the parameter is not set and the program makes no
claim on that axis.

**Op vocabulary is deliberately not closed here.** An op is carried by name with its arguments
verbatim, exactly as `modelId` already is: the vocabulary belongs to whichever runtime executes
the program, and an op that runtime does not implement is its to refuse **by name**, never to drop
silently. This format's job is to carry the declaration faithfully.

Parser refusals are structural only, and each names the path: a program with no positions, several
positions with no selector naming the control that chooses between them, a position with no ops,
and an op with no name.

## 0.7.2

- Fix `parseYamlSubset` (the `.vdsp` reader) to strip single-quote delimiters
  from scalar values and mapping keys. `id: '0'` previously parsed to the
  three-character string `'0'` — quotes included — instead of `0`.
- Added a fixture asserting that the same node declared as `node: '0'` in one
  terminal and `node: 0` in another resolves to one node, not two.

**Why this is a correctness fix, not a style nit.** A quoted and an unquoted
spelling of the same scalar silently became two different keys. For a
`terminal.node` id, that means two terminals meant to share a node instead
land on separate, isolated nodes — no error, no warning, no refusal. Found by
a cross-check in a consumer repo that compares node membership against a
second, independent read of the same `.vdsp` file; confirmed against
`boss-ce-2` in `vessel-dsp/artifacts`, where one component written with
unquoted `node: 0` diverged from every other component's quoted `node: '0'`.
Every consumer reads `.vdsp` through this same entry point, so the fix ships
in core rather than being worked around downstream.

## 0.7.1

- `audio.input` and `audio.output` now accept **either a single component id or
  a non-empty ordered array of them**. Array order is **channel order** — left
  then right — so the value is a list and never a set, and a duplicate id is
  refused: the same jack twice is a defect, not a stereo pair. A consumer that
  wants one port takes the first element and should say that it did.
- Parser errors on these fields now state what the field holds — component ids
  and nothing else, not a description and not a role.

**Why this is a correction and not a feature.** 0.7.0 said `audio.output` was
exactly one component id. A stereo pedal cannot declare itself under that rule:
the corpus carries `stereo-output-left`/`stereo-output-right`,
`output-a-mono`/`stereo-output-b` and `direct-output` alongside a main output.
Under a single-id field every stereo pedal refuses — and refusing every stereo
pedal is not a policy, it is the schema failing to describe a common device. A
stereo output is a fact to be declared, not an ambiguity to be resolved.

This is a permissive widening: every document valid under 0.7.0 remains valid.

## 0.7.0

- Add `circuit-interchange/v4`, which **requires** a top-level `audio` block
  declaring the circuit's audio ports: `audio.input` and `audio.output` (one
  component id each) and `audio.bypass`, which is either
  `{ switch, engagedPosition }` or the literal `"none"`.
- `circuit-interchange/v3` **accepts** the same block as optional and validates
  its shape when present. Requiring it in v3 would invalidate every existing
  document the moment it shipped; this way the field can be backfilled before
  it is enforced, and a file announces its own readiness by its schema string.
  `circuit-interchange/v2` refuses the block outright.
- `CircuitDocument` now carries `interchangeSchema`, the schema a document was
  parsed from, so a v4 file round-trips as v4 instead of having its version
  re-inferred from its contents on the way out. Constructed documents (no
  parsed schema) keep the existing inference unchanged.

**Why this is a first-class field rather than a jack property.** Consumers were
choosing a circuit's output by inspecting jacks and guessing. `soldano-slo-100`
declares four `Circuit.Speaker` jacks — three monitor taps and an effects send —
and no speaker after its output transformer, so every tool that read it silently
measured a preamp monitor point. Three independent instruments called that amp
broken and not one could report which output it had chosen. A declared port is
checkable; a guessed one is invisible when it is wrong.

This is the same argument v0.6.36 made for transformer windings — "a reference
tap is not an output tap", declared "because nothing a consumer can compute
separates them" — applied to jacks instead of coils. That release split its
corpus 40 reference taps against 15 output taps; this one addresses 29 packets
that declare more than one `Circuit.Speaker`.

**Why `bypass` may be `"none"` but may not be absent.** Some pedals have no
bypass switch on purpose. `"none"` is a claim someone made and can be verified
or argued with; a missing field is indistinguishable from an oversight. A
consumer must be able to tell "nothing here" from "nobody said".

## 0.6.39

- **`kind: inverter`.** A logic inverter is now a component kind, carrying `input`, `output` and
  the supply pair it runs from, plus `pin` for a package pin the gate does not use.
- **`input` is a new terminal role, and the partner `output` never had.** An amplifier's inputs
  are a differential pair, so `nonInverting`/`inverting` name them and neither is "the input". A
  gate has no pair: one pin drives it and one is driven, and until now the driven half could be
  named and the driving half could not. Deliberately not reusing `inverting` for a gate, which
  would say it has a pair it does not have.
- **Why this is a kind rather than a registry entry.** The six gates in a 4069 are the same device
  six times, which is what makes an inverter a device class. A compandor is not: its `rect_cap`
  and `gain_cell_in` are one chip's internals, and naming them here would put the NE570 into the
  interchange format. `bbd`, `flipflop` and `ic` carry only `pin` for that reason, and this
  deliberately does not change them.
- **What it unblocks.** A hex inverter is six devices in one package, and `devices` could not
  split it while no kind named a gate, so the split had to come from a registry entry keyed on the
  part number. Five components across four `vessel-dsp/artifacts` packets are in that position.
- Circuit JSON export skips an inverter, as it skips `flipflop`: there is no gate ftype, and
  `simple_chip` would claim the whole package a gate is one of.

## 0.6.38

- **`kind: fuse`.** A fuse, thermal cutout or other one-shot protective conductor is now a
  component kind. Two ends and no polarity (`end`/`positive`/`negative`), plus `pin` for a
  holder's mounting lug.
- **Why the format had to carry this.** A fuse conducts until it opens once and nothing operates
  it, but the nearest available declaration was `kind: switch` -- and 27 components in
  `vessel-dsp/artifacts` are declared that way. A consumer then offers each as a control a player
  can sweep, which puts a mains fuse on the panel as a knob.
- **A consumer could not fix that without reading authored text.** The only signal a `kind: switch`
  fuse carries is a property key, and that key is already spelled three ways in one corpus:
  `FuseRating` 36 times, `FuseRatings` twice, `ThermalFuse` once. Lowering off it would be a
  spelling table, which is what a typed kind replaces.
- **It also separates a case structure cannot.** Several packets declare one component that is a
  power switch *and* a fuse in series: two terminals, one closed contact, indistinguishable from a
  bare fuse by any structural test. A power switch that carries a fuse rating stays a `switch`; a
  fuse alone is a `fuse`. Only the document can draw that line, and now it can.
- The parser refuses an undefined kind as before -- `fuze` is still an error, which is what makes
  the union a vocabulary rather than a decoration -- and an electrode role belonging to another
  kind is reported rather than carried: `role: cathode` on a fuse raises `terminal-role-illegal`.
- Circuit JSON export maps a fuse to `simple_resistor` with a `fuse_horz` symbol, since that
  format has no fuse ftype; the rating stays in the source document.

## 0.6.37

- A winding carries its own **`voltage`** and its own **`impedances`**. Both optional; most
  windings state neither.
- `voltage` is one typed quantity per coil, measured **across the pair a stamp uses** -- per half
  where the coil declares a `windingCenterTap`, end to end otherwise, which is how a transformer
  is printed. The declared centre tap from 0.6.36 is what makes that a convention rather than a
  guess.
- It has to live on the coil because a component property keyed on a winding class holds one value
  per class. `orange-rockerverb`'s power transformer states 3.15 V for its power-tube heater coil
  and 6 V for its preamp heater coil, and had to invent `PowerTubeFilamentSecondary` and
  `PreampHeaterSecondary` to say so. A consumer keyed on the class collapsed both to one value and
  drove the 3.15-0-3.15 V winding at 6 V per half -- measured in the shipping program, not
  predicted. This is the quantity-side twin of the `secondaryalt3` problem `windings` deleted.
- `impedances` is a list, and **each entry names the terminal pair it is rated across**, because
  transformers are not rated by one convention: a primary is printed plate-to-plate, across its
  centre tap, while a speaker secondary is printed from its common to each tap. Every
  `PrimaryImpedance` in the corpus reads "... plate-to-plate"; every `SecondaryImpedance` is a tap
  value. A bare number per winding would need a convention and either one is wrong for one of the
  two.
- A list rather than a single value because one coil really carries several ratings.
  `orange-gro100`'s output transformer states four (100 V line, 15 Ω, 7.5 Ω, 3.75 Ω) and
  `orange-rockerverb`'s states two that are *simultaneously loaded*, a 16 Ω jack and an 8 Ω jack
  each with its own feedback resistor. A consumer that could see one rating had to drop a wired
  speaker branch, which is the defect this closes.
- No per-tap turns ratio is needed: between any two rated pairs on one core the turns ratio is the
  square root of the impedance ratio. `windingImpedanceAcross()` reads a rating in either terminal
  order. `TurnsRatio` stays a component property -- it is a relation between coils, not a property
  of one.
- Validation: a pair naming a terminal not on this winding (it reads as valid and silently rates
  the wrong coil), a pair naming one terminal twice, and a non-positive impedance or voltage are
  errors.
- These replace 10 component-property spellings, `InputImpedance`/`OutputImpedance` included --
  the reverb tanks' drive and pickup ratings under a second name.

## 0.6.36

- Add `windingCenterTap` to the transformer terminal vocabulary, splitting the tap role in two.
  A **centre tap** is the point a coil is referenced at -- grounded on a power transformer's HV
  winding, tied to B+ on an output transformer's plate winding -- and both halves are live at once.
  An **alternative output tap** is a speaker winding's 4/8/16 Ω point, of which a selector
  normally makes one live. They are different circuits and `windingTap` said both.
- Nothing a consumer can compute separates them, which is why this is a declaration. A grounded
  end identifies the reference on a speaker winding and says nothing about an output
  transformer's primary, whose ends can include ground. "Every node carries a load" reads
  `orange-rockerverb`'s tapped secondary as centre-tapped, because every node of it does. And
  both kinds declare the tap in the middle, so coil order says nothing either. Each of those
  three was tried in a consumer and each was wrong on one of the two shapes.
- The corpus splits cleanly: 40 reference taps (`primary_ct`, `hv_center_tap`, `low_ct`,
  `heater_center`, `power_tube_heater_center_0v` and their camelCase and colour-coded spellings)
  against 15 output taps (`secondary_4`/`_8`/`_16`, `secondary_hot`, `secondary_15ohm`,
  `secondary_7r5ohm`, `secondary_3r75ohm`).
- `windingEndsAndTaps()` counts both as taps, since both are.

## 0.6.35

- Drop `shield` from `WindingRole`, and stop warning that a `role: shield` terminal belongs to no
  winding. A shield is a grounded foil between windings, not a coil: the terminal role says all of
  it, and asking for a winding entry would ask for a false one. Found by backfilling the corpus —
  it was the only `winding-terminal-orphaned` warning in 55 transformers.
- Correct what justifies a repeating role. The corpus case is `orange-rockerverb`'s power
  transformer carrying **two filament windings** (3.15-0-3.15 V for the power tube heaters, 6.3 V
  for the preamp), not the two secondaries 0.6.34 described — every multi-tap secondary in the
  corpus turned out to be one coil, including `orange-gro100`'s 100 V line output, which its own
  `SecondaryTaps` lists alongside the 15/7.5/3.75 Ω taps.
- The backfill also corrected the count: 55 transformers and 363 terminals, not 53 and 296. Two
  documents quote their scalars (`kind: "transformer"`) and the first scan matched only unquoted
  ones.

## 0.6.34

- Add `windings`, the sibling to `devices`: a transformer declares which of its terminals form
  each coupled coil, in coil order, and `role`/`windingTap` on the terminals themselves says which
  are ends and which are taps. A winding entry is `role` plus ordered `terminals` — nothing more,
  because core already carries the per-terminal fact.
- Eleven roles: `primary`, `secondary`, `hv`, `filament`, `rectifier-heater`, `bias`,
  `low-voltage`, `auxiliary`, `shield`, `drive`, `pickup`. Roles may repeat, which is what makes a
  second secondary expressible; a consumer distinguishes windings by their terminals or by an
  optional `id`.
- `drive`/`pickup` exist for a spring reverb tank, where neither coil transforms the other's
  voltage. It is the one `transformer`-kind component in the corpus that is not a transformer, and
  calling its coils primary/secondary states something false about it.
- Validation: unknown role, unknown or repeated terminal, a terminal claimed by two windings, an
  empty list and a duplicate `id` are errors; a single-ended winding and a winding-role terminal
  no winding couples are warnings. `windingOfTerminal()` and `windingEndsAndTaps()` are the read
  side.
- Measured against the corpus first: 53 transformers, 296 terminals, and a consumer table of 110
  spelling entries reconstructing 12 winding classes — four of which (`secondaryalt`,
  `secondaryalt2`, `secondaryalt3`, `secondaryline`) exist only because a spelling-keyed record
  has nowhere to put two coils with the same role. Design and the connectivity boundary it must
  not cross: `docs/winding-construct-design.md`.

## 0.6.33

- Add `ac` to `TerminalRole`, legal on `diode`, for a bridge rectifier's alternating input legs.
  Such a leg is neither an anode nor a cathode: on one half cycle it conducts *into* the positive
  rail and on the other the negative rail conducts into it, so one terminal serves two junctions
  of opposite orientation. Naming it `anode` would state a direction it does not have, and the DC
  side already has `positive`/`negative`.
- Without it a diode's role vocabulary could not express what 12 corpus bridge terminals declare
  (`ac_a`/`ac_b`, `ac_left`/`ac_right`, `acA`/`acB`), which is the gap that blocked a consumer from
  replacing its own bridge-topology table with a read.

## 0.6.32

- Add a canonical carrier-polarity vocabulary and validation. Polarity flips a device's whole
  transfer curve - an NPN read as PNP does not conduct, a p-channel FET read as n-channel biases
  backwards - and the corpus stated it across **three keys**: `Type` (239 bjt + 103 jfet + 1
  mosfet), `Polarity` (28 bjt + 3 jfet) and `Channel` (3 jfet), with case drift (`npn`/`NPN`) and
  quoting artifacts (`'N'` sixteen times). `Polarity` is canonical; `Type` and `Channel` are
  reported where they carry this fact.
- `DevicePolarity` is `npn | pnp | n-channel | p-channel`, and `POLARITIES_BY_KIND` keeps the
  bipolar and field-effect pairs apart. An `npn` MOSFET is the **one error** rather than a
  warning: it is not a document predating a vocabulary, it is a claim that cannot be true.
- **`Type` and `Polarity` each carry more than this concept, and the others are reported rather
  than folded in**, because reading any of them as a carrier polarity would be worse than saying
  so: a diode's `Type` is a device *family* (`Zener`, `Schottky`, `Germanium`) and each selects a
  different law; a capacitor's `Polarity: electrolytic` is a dielectric that *implies*
  polarization; a `voltage-source`'s `center-negative` is a DC barrel jack's sleeve; and
  `Type: IC`/`LED`/`OTA` merely restates `kind`.
- Normalization folds case, separators, stray YAML quotes and CamelCase boundaries, with the
  acronym rule written so `NPN` survives whole rather than splitting into letters. An
  abbreviation or a kind restatement is **not** folded: `N`, `NJF` and `N-channel JFET` all mean
  n-channel and are all documents to correct, the same rule the taper vocabulary applies to `A`.
- A missing polarity on an active device is reported, because its transfer curve depends on it and
  silence forces a consumer to guess - measured downstream as 37 FETs whose channel does not
  resolve.
- **A suppression bug found by disbelieving a good-looking measurement.** The first version
  suppressed the missing-polarity report whenever *any* superseded key was a string, so a JFET
  declaring `Type: 'N'` - which states no polarity this vocabulary can read - was reported as
  clean. Corpus counts went from 1 unrecognized to the true 105, and missing from 167 to 271:
  **105 devices had been hidden by the presence of a key whose value did not resolve.** The
  suppression now requires that the other key actually carry a usable polarity.
- **A declared part suppresses the missing-polarity report.** A 2N3904 is NPN and a 2N3906 is PNP,
  so a `PartNumber`/`Model`/`Chip` identifies the polarity even where the document does not spell
  it out. Core holds no part catalog and cannot check which, but a consumer that does is not
  guessing, and warning here would make the check noise on every properly identified transistor.
  Found by a pre-existing fixture - a BJT carrying only `Model: 2N3904` - which is exactly the
  case the first draft got wrong.
- Corpus position after this release: 544 bjt/jfet/mosfet components, **288 clean (52.9%)**, 242
  carrying the polarity under `Type` (a key rename), **13** where neither a polarity nor a part
  identifies it, and 1 unrecognized value. The earlier draft of this entry reported 30 clean and
  271 missing; those figures were taken before the part-identification rule and before the
  suppression bug was fixed, and are wrong.

## 0.6.31

- Add a canonical potentiometer taper vocabulary and validation. Taper is **audible** - it is how
  a knob's travel maps to its effect - and the corpus stated it across **two keys with 46 distinct
  values between them**: `Taper` (264 declarations, 30 values) and `Sweep` (397, 16).
- **The two keys are one fact, proven by the 57 components that declare both**: `Taper: B` sits
  beside `Sweep: Linear` 26 times, `Taper: A` beside `Sweep: Logarithmic` 8 times, `Taper: C`
  beside `ReverseLogarithmic`/`ReverseAudio` 7 times. One is the manufacturer letter code, the
  other the law's English name. `Taper` is canonical; `Sweep` is superseded and reported.
- **Spellings are `KnobTaper`'s**, from `panel/types.ts`, which shipped first and is published API
  with consumers in `control-ui` and panel extraction. The first draft of this vocabulary used
  `logarithmic` and would have created a second spelling for the same law inside one package -
  precisely the drift this work removes. The corpus writes `Logarithmic`, so the corpus backfills;
  a published enum with consumers is the stronger constraint. Cost of that choice, measured: 139
  extra declarations to correct.
- **Letter codes are deliberately not accepted.** `A`, `B` and `C` are printed markings whose
  meaning is a convention rather than a definition - the mapping the 57 pairs reveal is the
  Japanese/Alps one this corpus happens to use, not a universal. The marking is source provenance;
  the law goes in `Taper`.
- **Three classes of existing value are not tapers**, and each gets its own verdict and message
  because the fix differs: `Unknown`/`source-unmarked`/`not-visible` state *absence* (fix: omit
  the property, since a value for absence is worse than absence), `trim`/`Trim` names a physical
  package rather than a resistance law, and `0..1` is a travel range.
- Normalization folds case, separators and CamelCase word boundaries, so `ReverseLog`,
  `Reverse Log` and `reverse-log` are one value. A **synonym** is not a spelling: `Audio` and
  `Logarithmic` name this law under other words and are reported, not accepted.
- `classifyTaper(value)` returns `canonical | absence | not-a-law | unrecognized`;
  `collectTaperIssues(component)` reports per component and runs inside document validation. All
  verdicts are warnings, for the reason the terminal-role work settled: a vocabulary that refused
  every document written before it existed would refuse the corpus, and the counts are the
  backfill's remaining work.
- Adds `docs/vdsp-property-format-review.md`, a measured review of all 58,021 property
  declarations across 567 keys: key naming is consistent (563 of 567 PascalCase), but 55 keys hold
  more than one value type, 8 carry number-as-string quoting drift (`0.5` / `'0.5'` / `0.50`, and
  `PartNumber` as a YAML **number**), 11 carry booleans as strings, and `Resistance`/`R`,
  `Capacitance`/`C`, `Voltage`/`V` are synonym pairs. `Type`/`Polarity`/`Channel` is named as the
  next vocabulary worth closing - three keys for device polarity, with `Polarity` conflating
  capacitor polarity and transistor polarity.

## 0.6.30

- Add `Component.devices`: the devices a package contains. A component models a schematic
  **symbol**, and a symbol may hold several devices - a dual rectifier is two diodes on one
  cathode, a dual op-amp two amplifiers on one supply pair, an optocoupler an LED beside a
  photoresistor. Consumers need the devices, and until now each one reconstructed the split by
  parsing terminal names. Design: `docs/device-construct-design.md`.
- **A device names its terminals by `name`.** Names are already unique within a component - the
  `nodes` ledger addresses pins as `<componentId>.<name>` and core refuses duplicates - so a name
  is a sufficient reference, and membership is the thing an index could not state. Order carries
  no meaning: a device binds by the `role` its terminals declare.
- **A terminal may belong to several devices.** A dual rectifier's shared cathode and a dual
  op-amp's shared supplies are the ordinary case, needing no special rule.
- **`kind` is declarable per device**, defaulting to the component's. An optocoupler is why: it
  holds an `led` and a `variable-resistor`, two laws in one package.
- **Omitting `devices` means exactly one device**, of the component's kind, using all its
  terminals. That is nearly every component - 8,462 resistors in the survey say nothing - and
  `componentDevices()` returns the same shape either way, so no caller branches on whether the
  list was written down.
- `deviceTerminalRoles(component, device)` is the binding a law reads, scoped to one device. That
  scope is the point: a dual op-amp declares two of every signal role across its package, and only
  inside a device is the read unambiguous. This is the defect that motivated the construct - a
  consumer guessing the pairing put both inputs of `boss-dm-3`'s `IC1` on one node and drove a
  bias rail.
- `validateComponentDevices()` reports a malformed declaration as an **error** (a terminal that
  does not exist, a duplicate device id, an empty device, a repeated terminal, or a role the
  device's kind cannot carry) and a terminal belonging to no device as a **warning**, since that
  is either decorative or an omission and the document cannot say which. Whether a device's roles
  are *sufficient* for its law stays with the consumer: encoding one law's expectations in the
  format would make the format wrong for the next law.
- Parser and serializer round-trip `devices`, emitting it only when declared. Terminal lists are
  written in **block form**; the interchange format parses a YAML subset whose only flow
  collections are the empty `[]` and `{}`.

## 0.6.29

- Remove the `index` field added to `Terminal` in 0.6.28. It was a half-measure: for the case it
  handled a unique `name` already sufficed, and for the case that is actually hard it was not
  enough. Nothing declared it -- zero terminals in the 26,016-terminal survey -- so removing it
  now costs nothing.
- **What it could not do.** `index` labelled a terminal without saying which *device inside the
  package* it belonged to. On a dual rectifier that is harmless, because both plates share one
  cathode and the pairing is forced; on a dual op-amp declared as one component it says nothing
  useful, because `index: a` on an output and an input does not state that they are one section.
  That is grouping, not indexing.
- **A role may repeat within a component, and the unique `name` distinguishes the pins.** A
  resistor's two ends are both `end`; a dual rectifier's two plates are both `plate`, named
  `plate_a` and `plate_b`. A construct that groups terminals into devices refers to them by name,
  which states the pairing directly -- the thing `index` only gestured at.
- This is what a netlist has always done: SPICE has no packages, only elements, and each element
  carries its own complete positional node list (`Q1 nc nb ne`). A dual rectifier is two `B`
  lines, not one component with two plates. The remaining complexity in this format is that a
  component models a schematic *symbol*, which may hold several devices; `role` says what an
  electrode is, and a device/section construct is what will say which device it serves.
- `INDEXABLE_DEVICE_TERMINAL_ROLES` is renamed `SUFFIXABLE_DEVICE_TERMINAL_ROLES`, and
  `classifyDeviceTerminalRole` still resolves a suffixed name (`plate_a`) to its plain role, since
  that is how the backfill reads existing documents. The suffix distinguishes the name and carries
  no meaning of its own.

## 0.6.28

- Add a **required** `role` field to `Terminal`, with an optional `index`. A terminal's name is
  the pin's identity in the `nodes` ledger and must be unique within its component, so it cannot
  also carry the electrode - a dual rectifier has two plates and can only name one of them
  `plate`. The role is now its own typed field, and the name goes back to being whatever the
  source printed.
- This supersedes 0.6.27's approach, which inferred the role from the name against a canonical
  vocabulary. That was the wrong layer: it made the name normative and left every consumer
  parsing text. 0.6.27's `classifyDeviceTerminalRole` remains, now as the **migration reader** -
  it is what writes a `role` into the 26,016 terminals written before the field existed.
- `TERMINAL_ROLES_BY_KIND` declares which roles each of the 32 component kinds may carry, and
  `isLegalTerminalRole(kind, role)` checks one. `screen` is legal on a pentode and not a triode;
  `wiper` on a potentiometer and not a diode.
- Two values exist so that a required field is satisfiable on every kind, and neither is a
  loophole. **`pin`** is an opaque part's numbered pin - pin 7 of an unknown IC has no electrode
  meaning, and 2,648 `ic` terminals across 1,566 spellings are exactly this. **`end`** is one of
  two interchangeable ends, so `end` twice on a resistor is correct rather than under-specified.
  A role may repeat within a component; a name may not.
- `collectTerminalRoleWarnings()` reports two distinct things: `terminal-role-missing` for a
  terminal that declares none, and `terminal-role-illegal` for a role its kind cannot carry. The
  missing case is a **warning, not a refusal**, because refusing would reject every document
  written before this release; the warning count is the backfill's remaining work. The illegal
  case is always the document's error.
- `transformer` and `switch` take deliberately coarse roles (`winding`/`windingTap`/`shield`,
  `common`/`throw`/`coil`). A transformer terminal's role is that it is a winding end; *which*
  winding it belongs to is membership, which a flat role cannot express and which those packets'
  107 spellings currently carry inside names. That needs a winding construct.
- Parser and serializer round-trip `role` and `index`, and emit them only when declared, so a
  document written before this release serializes back unchanged.

## 0.6.27

- Add a canonical terminal-role vocabulary for the active devices whose electrodes are
  asymmetric: `triode`, `pentode`, `tube-diode`, `bjt`, `jfet`, `mosfet`. Exchange a BJT's base
  and collector, or a triode's plate and cathode, and the circuit still solves - so the wrong
  answer is silent, and the role has to come from the document read against one declared
  vocabulary. `classifyDeviceTerminalRole(kind, terminalName)` returns `canonical`, `ambiguous`,
  `package-pin`, `unrecognized`, or `out-of-scope`.
- Keyed by `ComponentKind`, not one flat table, because the same token is different electrodes on
  different devices: `c` is a BJT collector and a tube cathode, `screen` exists on a pentode and
  not a triode, `input`/`output` name a FET's channel ends and nothing on a tube.
- **No alias table, deliberately.** A spelling outside the vocabulary is reported as
  `unrecognized` rather than translated, so it becomes a document to correct instead of an
  accommodation the vocabulary carries forever. Measured against a 142-document, 26,016-terminal
  corpus, the whole cost of that stance is 10 declarations across 3 spellings (`input`/`control`/
  `output` on two FETs, `body` on one MOSFET, `cathode_filament` on three rectifiers).
- Electrodes that legitimately repeat carry an index instead: `plate_a`/`plate_b` resolve to one
  `plate` role with `index`. This is forced by the format rather than a spelling preference - a
  terminal name is the pin's identity in the `nodes` ledger, so a dual rectifier cannot name both
  plates `plate`.
- Under-specified tokens resolve to no role, following the potentiometer vocabulary's rule: there
  is nothing to correct in `a`, it simply does not say which electrode it is. A bare `filament`
  is in the same class, being indistinguishable from a heater tap.
- A bare pin number (`pin7`, `terminal4`) reports as `package-pin` rather than `unrecognized`: it
  names where a wire lands, not what the electrode does, and a consumer holding the package pinout
  can still use it.
- Coverage over the same corpus: 2,204 of 2,251 terminals on covered kinds resolve canonically
  (97.9%), with `triode` and `pentode` at 100%. Of the 39 that do not, 29 are three components
  that are not the device they declare - two multi-device shells holding four transistors and
  five diodes between them, and a unijunction transistor declared `kind: bjt`.

## 0.6.26

- Merge inline terminal `node` keys and the `nodes` ledger into one declared
  connectivity interpretation during `.vdsp` parsing. Declaring any inline
  terminal node previously made the parser ignore every `members` list in the
  ledger, so a packet that split its declarations across both styles silently
  lost the ledger-only pins - including, in the reported case, leaving the
  ground node with no members at all and no warning.
- Agreement between the two styles is treated as redundant rather than
  ambiguous, which is what lets a serialized document (core writes both an
  inline `node` per terminal and a `nodes` ledger) round-trip unchanged.
  Disagreement about the same pin is refused with the existing
  `already belongs to node` error.
- The ledger is now validated on every document that has one, so a `members`
  entry naming an unknown component or terminal, or a duplicate node id, is
  reported instead of skipped whenever inline terminal nodes are also present.
- Accept declared `connectivity` and `nodeRoles` in
  `serializeInterchangeYaml()` and `serializeVdspCircuitDocument()`. Both wrote
  connectivity resolved from terminal geometry, so a parse/serialize round trip
  renumbered author-declared node ids and rewrote every node role to `ground`
  or `signal`, discarding tokens such as `supply`. Passing the values back from
  `parseInterchangeYamlWithTopology()` now preserves both; omitting them keeps
  the previous geometric behaviour.
- Add `INTERCHANGE_CONTRACT_VERSION` so consumers can gate adoption on parse
  behaviour instead of a package version range.
- Add a canonical potentiometer terminal-role vocabulary:
  `classifyPotentiometerTerminalRole()`, `resolvePotentiometerTerminalRoles()`
  and `resolveDocumentPotentiometerTerminalRoles()`. A pot's ends are only
  meaningful as a rotational pair, and rotation cannot be recovered from a
  schematic - terminal positions say which end is drawn where, not which way the
  shaft turns - so a consumer inferring it from topology produces controls that
  sweep backwards on some documents, silently.
- Lug numbers and spelling variants (`1`/`2`/`3`, `lug 2`, `Pin_3`,
  `counter-clockwise`, `slider`) normalize to `ccw`/`wiper`/`cw` with no
  diagnostic; the resolved role is keyed by the raw token, so nothing is
  rewritten. Tokens that name an end without its rotation (`a`, `b`, `left`)
  resolve to no role at all: `complete` stays false and a
  `potentiometer-terminal-role-ambiguous` diagnostic says the source does not
  carry the semantics, rather than a guess being supplied.
- `.vdsp` intake reports those diagnostics as parser warnings. No corpus
  document gains one: all 65 potentiometers surveyed either use lug numbers
  (the 2 in `.vdsp`) or arrive from `.schx` with core's own catalog names
  (the other 63), and warning an author about a token core invented would be
  noise.
- Parse `.schx` device-model parameters into structured quantities instead of
  leaving them as text: the tube set (`Kg`, `Rgk`, `Vg`, `Gamma`, `Ig0`, the
  interelectrode capacitances, and `Kg1`/`Kg2` on a pentode), op-amp `Rin`,
  `Rout`, `Aol` and `GBP`, the uppercase bipolar spellings `IS`/`BF`/`BR`/`n`
  that only the long `BipolarJunctionTransistor` shortType listed, and `Wipe`
  on a variable resistor. 137 values across the corpus that consumers had to
  re-parse. A discrete selector `Position` stays a string - it is state, not a
  device parameter.
- Extract the duplicated `normalizeToken()` into `model/tokens.ts`. It was
  byte-identical in `model/validation.ts` and `panel/extract.ts`, and a second
  copy is how two vocabularies drift apart.

## 0.6.25

- Validate `sourceTypeName` against an explicit vocabulary during `.vdsp`
  parsing. The field was typed `string | null` and parsed straight through, so
  any spelling was accepted silently; every consumer matches it exactly, which
  made each unrecognised spelling a component that quietly failed to resolve.
- Emit the first parser-generated warnings for it: `source-type-name-alias`
  names the canonical spelling for a known variant, and
  `source-type-name-not-a-device-class` covers values that record what a
  consumer does with a component rather than what the component is.
  `source-type-name-unsupported` covers everything else.
- Values are reported, never rewritten. Documents keep parsing, and the
  recorded spelling is preserved verbatim.

## 0.6.24

- Extend canonical `.vdsp` source/runtime boundary warnings to the legacy
  runtime marker cleanup set: `SourceOnly`, `InterfaceOnly`,
  `SourceBoundaryNote`, `FirmwareStatus`, `FirmwareExternalStop`, and
  `BehaviorRole`.
- Wire `validateVdspCircuitDocumentSchema()` to return those warnings during
  canonical `.vdsp` intake while keeping legacy parsing tolerant for inspection
  and migration.

## 0.6.23

- Add opt-in canonical `.vdsp` source/runtime boundary validation through
  `validateSourceRuntimeBoundary()` and `createSourceRuntimeBoundaryRule()`.
  The rule reports runtime, admission, and proxy metadata such as
  `RuntimeMatchKey`, `RuntimeDescriptor`, `DescriptorType`, stored compiler or
  admission metadata, and nested `BehaviorRole.firmwareRef.behaviorOwner` while
  keeping legacy parsing tolerant.
- Stop treating `RuntimeMatchKey` as required source firmware metadata.
  Firmware source evidence validation now checks `FirmwareRequired`,
  `FirmwareId`, and chip identity without encouraging runtime selector fields
  in canonical `.vdsp`.

## 0.6.22

- Warn when `InterfaceOnly` is used on a wired active-device kind (diode, LED,
  transistor, op-amp, tube, IC, and similar `model`-identity kinds) with two or
  more declared terminals. `InterfaceOnly` is for components with no real
  electrical branch (an unpopulated/DNP position or a panel/UI reference stub),
  not a waiver for a real device whose exact part is unconfirmed. New code:
  `interface-only-active-device`.
- Report legacy `Support: "view-only"` as a schema problem instead of treating
  it as a current interface-only marker. The property is legacy vocabulary from
  the pre-runtime-agnostic schema; playable/support status is derived downstream
  by the host runtime/compiler. New code:
  `schema-invalid-legacy-support-view-only`.

## 0.6.21

- Enforce single-owner supply rails in `@vessel-dsp/core`: a modeled voltage may
  have only one owner (a mains PSU/transformer, a battery/DC-adapter boundary, or
  a converter/regulator/divider output), so a `kind: rail` that asserts an ideal
  source on top of an already-owned voltage is a `power-rail-fixed-owner-conflict`
  validation error. The rule is power-model driven and connectivity-independent:
  it never reads wires, node identity, or component voltage properties, so the
  verdict is identical for `wires: []` and a fully connected drawing.
- Add the optional `CircuitPowerDomain.sourceKind` (`mains-ac` | `external-dc`)
  field and export the `CircuitPowerSourceKind` type. The interchange parser
  normalizes the provisional `powerSourceKind` alias into it and rejects
  conflicting values. New codes: `power-domain-source-kind-conflict`,
  `power-domain-source-kind-unresolved`, `power-domain-source-owner-unresolved`,
  and `power-rail-fixed-owner-conflict`.

## 0.6.20

- Add opt-in, topology-aware audio trace warnings for destructive capacitor
  shunts, extreme direct input loading, and declared op-amp buffers with open
  passive feedback paths. Ambiguous roles and incomplete boundary connectivity
  produce abstention warnings rather than circuit claims.
- Add `.vdsp` parsing that preserves source-declared node membership and roles
  for advisory validation, with geometric connectivity as an explicit fallback.

## 0.6.19

- Add advisory trace plausibility checks to `@vessel-dsp/core`, including
  coverage-gated structural checks plus opt-in preferred-value and RC-corner
  heuristics for source transcription review.
- Export trace plausibility APIs and validation issue codes for downstream
  conversion/audit tooling.

## 0.6.18

- Add phase-one display hardware metadata to `@vessel-dsp/core`: `display`
  component, panel, and device-interface kinds; typed `Panel.displays`
  descriptors; `.vdsp` parse/serialize round-trip support; validation for
  display kind, bus, grid dimensions, driver component links, and default text.
- Preserve display modules as visible panel metadata only. This release does
  not add display runtime values, framebuffer/matrix protocol, or runtime-driven
  display updates.
- Preserve source display panel metadata in `@vessel-dsp/stompbox` when panels
  are rebuilt from runtime descriptor controls.

## 0.6.17

- Extend `BehaviorRole.firmwareRef` in `@vessel-dsp/core` with richer firmware
  evidence metadata, including status, artifact/source visibility, behavior
  ownership, and optional component linkage fields while keeping the component
  role as the canonical firmware owner.
- Validate authored `firmwareRef` entries fail-closed for invalid shape,
  invalid status/enum values, unresolved component links, and
  recovered-ownership claims that are not backed by recovered or verified
  status.

## 0.6.16

- Release metadata only. This release did not include the intended
  `BehaviorRole.firmwareRef` schema and validation implementation; use 0.6.17
  or later for that support.

## 0.6.15

- Add typed source-visible cabinet, speaker-driver, microphone-transducer, and
  simulation profile schemas to `@vessel-dsp/core` without introducing runtime
  simulator admission rules.
- Add `simulationProfiles` to `.vdsp` v3 documents with parse/serialize
  round-trip preservation, namespaced extension preservation, and explicit
  conversion-loss diagnostics when exporting to non-VDSP formats.
- Validate profile catalog integrity, including duplicate IDs, dangling
  cabinet driver and simulation target references, malformed simulation units,
  and invalid non-positive physical quantities while allowing incomplete
  measured/profile seed records.

## 0.6.14

- Add a `power-converter` `ComponentKind` for source-visible converter ICs
  (charge pumps, regulators, etc.), with a required `ConverterKind` property
  (must-have value: `charge-pump`). Lets `CircuitDocument.power` rail
  derivations anchor charge-pump-derived rails (for example a Klon-style
  `+V2`/`V-` pair) to a real component instead of overclaiming topology from
  voltage labels alone.
- Add optional `nominalVoltage` on `CircuitPowerRailBinding` so a derived rail
  can carry its own voltage separate from the domain's `ratedVoltage`.
- Validate converter identity: `doubler`/`inverter` derivations require
  `converterComponentId`; `converterComponentId` must resolve to a
  `power-converter` component; `main-supply`/`regulated-output`/
  `charge-pump-output` roles reject electrically contradictory derivations;
  the same converter cannot claim the same rail role twice. Warn (don't fail)
  on a converter with no `PartNumber` or a charge-pump-derived rail with no
  `nominalVoltage`.
- Does not model MAX1044/ICL7660 switching transients, sag, ripple, or a sag
  knob — converter identity is structural metadata only.

## 0.6.13

- Reject duplicate YAML mapping keys instead of silently letting the later
  occurrence win. Enforced at every object nesting level (a duplicate
  top-level `power:` or `rawAttributes:` block, or a duplicate key inside
  `power.domains[0]`, and so on), since validation after parsing cannot tell
  that a key was overwritten during parse.
- `validateVdspCircuitDocumentSchema` reports duplicate keys with
  `code: "duplicate-key"` and `path` set to the offending key.

## 0.6.12

- Add a typed `circuit-power/v1` power-topology block (`CircuitPower`,
  `CircuitPowerDomain`, `CircuitPowerRailBinding`) to `circuit-interchange/v3`,
  describing supply domains, ground polarity, and rail role/derivation without
  introducing a new document schema version.
- Validate power topology: unresolved source, rail, parent-rail, and
  converter component references; duplicate domain ids; duplicate rail
  ownership across domains; `parentRailComponentId` cycles; and
  `coverage`/`domains` consistency.

## 0.6.11

- Add enum-backed semantic `ControlRole` validation for source component
  properties and `controlInterfaces[].controlRole`, with source-only warnings
  and playback-claimed errors.
- Export canonical control role constants and validation rule-pack hooks so
  hosts can layer lowering-specific diagnostics without embedding runtime
  policy in core.

## 0.6.10

- Preserve firmware-bound microcomputer runtime metadata such as `ChipClass`,
  `FirmwareId`, `FirmwareRequired`, and `RuntimeMatchKey` through `.vdsp`
  parse/serialize round trips so hosts can distinguish chip-only identities
  from chip-plus-firmware descriptors.
- Warn when firmware-required IC metadata is incomplete, including missing
  `FirmwareId`, missing `RuntimeMatchKey`, incomplete runtime match tokens, or
  missing chip identity.

## 0.6.9

- Bump all publishable packages and internal workspace dependency pins for the
  `.vdsp` appearance schema release.
- Keep release metadata, docs, and built package artifacts aligned with the
  `0.6.9` package version.

## 0.6.8

- Add `createStompboxHardwareProfileFromVdsp()` and
  `createStompboxHardwareProfileFromDocument()` to derive generated-stub
  stompbox hardware profiles from existing `.vdsp` mechanical metadata.
- Add `.vdsp` v3 `appearance.kind` metadata so stompbox and amp visual design
  can be self-contained while remaining mutually exclusive.
- Add `createAmpProfileFromVdsp()` and `createAmpProfileFromDocument()` to
  derive generated/defaulted amp preview profiles from `.vdsp` panel controls.
- Document `.vdsp` as the portable source-visible CircuitDocument for
  schematic inspection and host-owned simulation/runtime lowering, while
  keeping provenance-only evidence outside the portable file.
- Add physical mount metadata for concentric panel controls, including `mountId`/`surface` parsing, model types, validation, and `.vdsp` round-trip coverage.
- Add stompbox concentric control support that collapses stacked dial surfaces into one drill hole while preserving per-surface preview and layout metadata.
- Add Control UI rendering for concentric knobs and panel jacks, plus docs for control semantics, physical controls, and CAD-style preview linework.
- Add `@vessel-dsp/visual-effects` for reusable Three.js toon, grain, and glitch preview effects.
- Add `@vessel-dsp/amp` and `@vessel-dsp/cabinet` for generated profile-based Three.js object graphs and GLB preview metadata.

## 0.6.7

- Add `.vdsp` `deviceInterface.controls[].audioBinding` parsing, validation,
  serialization, and public typing so physical control labels can bind to
  differently named audio/runtime controls without host-side alias tables.

## 0.6.6

- Bump version; add `crt` and `glitch` fields to previewPresets type in docs test.

## 0.6.5

- Add core-owned amp and cabinet preview profile schemas, readonly public
  types, and migration-friendly validators that can check artifact JSON without
  importing Three.js preview packages.
- Reuse the core amp/cabinet profile validators from `@vessel-dsp/amp` and
  `@vessel-dsp/cabinet` so preview packages and artifact tooling share one
  published contract.

## 0.6.4

- Add `.vdsp` control group membership records so one physical device-interface control can appear in multiple channel/context layouts without cloned control identities.
- Validate control group member references, context predicates, and duplicate member order while treating ordered memberships as the layout distinction for same-role physical controls.
- Expose resolved `extractDeviceInterface().groupMemberships` alongside one-row-per-physical-control device interface extraction.

## 0.6.3

- Fix the exported `VERSION` constant in source and built package artifacts so it matches the published package manifest.
- Add `@vessel-dsp/control-ui` as the optional React control-surface package for core `Panel` data, including default CSS, class hooks, and a theme provider.
- Add optional WebGL CRT and digital-glitch screen effects to the GitHub Pages stompbox GLB preview viewer (vendored from `gingerbeardman/webgl-crt-shader` and three.js `DigitalGlitch`, both MIT), with tunable scanlines, curvature, vignette, bloom, RGB shift, screen-space grain composited inside the CRT pass, and a randomized, motion-safe glitch schedule.

## 0.6.2

- Preserve `SourceOnly`, runtime ownership, source boundary, rail, source reference, and can-cap section metadata through schema-valid Circuit JSON source-property sidecars.
- Represent multi-section can capacitors as ordinary capacitor source components grouped with VesselDSP `source_group` metadata, and restore those groups on Circuit JSON import without treating generic groups or non-capacitors as can caps.
- Include source-only R/C parts and deterministic metadata comments in SPICE source/reference exports.

## 0.6.1

- Fix npm packaging so published tarballs build and ship `dist/` artifacts, omit `src/`, and keep all runtime export conditions pointed at compiled files.

## 0.6.0

- Add `circuit-interchange/v3` parsing and serialization for physical build metadata, including build scope, mechanical envelopes, BOM rows, part profiles, footprint catalogs, off-board wiring, physical panel placement, and board realizations.
- Add typed board realization support for stripboard, perfboard, breadboard-pattern protoboard, and fabricated PCB data with selected-build validation.
- Add explicit lossy-conversion handling for v3-only data, including `convertCircuitDocumentFileWithReport()` and `drop-with-diagnostics`.
- Export v3 model types and update package/API documentation for the v3 build-data contract.

## 0.5.0

- Pivot the repository to the single publishable `@vessel-dsp/core` package for headless `.vdsp`, `.asc`, `.schx`, and Circuit JSON conversion.
- Remove the reusable React component package, workspace-private simulation package, and repo-owned playground; GitHub Pages now publishes static core conversion API docs only.
- Add Circuit JSON import, validation, file conversion helpers, and LTspice `.asc` serialization.
- Add top-level `.vdsp` `controlGroups`, `controlContexts`, and `deviceInterface` metadata for stable semantic device controls.
- Preserve semantic controls, group/context registries, applicability predicates, bindings, and panel `interfaceControlId` joins through strict `circuit-interchange/v2` parse/serialize flows.
- Add `extractDeviceInterface()` so hosts can merge declared `.vdsp` controls with inferred panel, runtime descriptor, and external interface controls without mutating authored metadata.
- Validate semantic interface ids, group/context references, source bindings, external interface bindings, duplicate unordered roles, and panel semantic joins.
- Waive required electrical properties for interface-only/view-only controls while still validating present values.

## 0.4.0

- Move `.vdsp` / interchange documents to strict `circuit-interchange/v2`; v1 documents are rejected without migration or fallback parsing.
- Add recursive structured component property values so Source YAML can preserve runtime descriptor objects, arrays, numbers, booleans, nulls, and parsed quantities.
- Extract explicit LiveSPICE microblock descriptor metadata for tone stack, active EQ, delay, reverb, compressor, and octave descriptors without depending on legacy `Profile` strings.

## 0.3.2

- Add `JackPort.audioRole` and `JackAudioRole` for source-visible audio jack subtypes such as `guitar-input`, `bass-input`, `output-a-mono`, and `stereo-output-b`.
- Preserve and document `.vdsp` jack metadata split across broad `Role`, port-family `Interface`, explicit lower-kebab `AudioRole`, and display `JackLabel` / `Label` properties.

## 0.3.1

- Document and test the open component property-map contract, including passive `Material` metadata round-tripping and resistor material remaining preview-neutral.
- Add top-level `.vdsp` `device` and `controlOutputs` metadata for standalone non-audio control accessories such as Boss FS-5U footswitches.
- Preserve control accessory metadata through strict `.vdsp` parse/serialize flows, with schema validation for device kind and output switch mode values.

## 0.3.0

- Replace flat `.vdsp` panel placement metadata with named `panel.faces[]` surfaces containing bound `elements[]`, while keeping legacy `panel.layout` + `controls[]` input accepted and normalized.
- Emit the new `faces` / `elements` / `bind` / `kind` panel shape from the interchange serializer by default.
- Add panel validation warnings for unresolved component bindings, unresolved runtime controls, kind mismatches, and overlapping grid cells.
- Add `direct-output` as a first-class jack role and expose runtime descriptor `DirectOutputJack` metadata as `U1:direct-out` panel jack ports.
- Document the updated `.vdsp` panel placement contract and mark the implementation plan complete.

## 0.2.9

- Add top-level `.vdsp` `controlInterfaces` metadata for external trigger/reset, tempo tap, expression, and similar control inputs.
- Preserve `controlInterfaces` through strict `.vdsp` parse/serialize flows, including connector, assignment hint, polarity, description, optional visible jack component links, and runtime binding metadata.
- Export the `ControlInterface*` model types from the core API so hosts can consume external control metadata without depending on panel extraction.
- Project `controlInterfaces` into extracted `JackPort` descriptors while keeping external footswitch/control targets out of `SwitchControl` and runtime switch state.
- Document the producer contract for external control interfaces separately from layout-only stompbox panel placement, including DD-3-style `TRIGGER`/`RESET` and DD-5-style tempo-tap semantics.

## 0.2.8

- Add non-throwing `.vdsp` schema validation and include API reference docs in the published package.
- Preserve optional stompbox panel placement metadata through `.vdsp` parse and serialize flows.
- Expose runtime descriptor panel controls such as time, feedback, mix, stepped mode selectors, and tempo-tap external control inputs.
- Add source-rated Fulltone OCD revision-3 fixture coverage for dual-opamp MOSFET clipping pedal parsing.
- Add source-rated TC Electronic Dark Matter Distortion fixture coverage for MC33178 stages, LL4148 clipping, and active tone controls.

## 0.2.7

- Treat imported runtime descriptor ICs as validation-safe opaque descriptors when `RuntimeDescriptor: "true"` is present.
- Rename SPDT/SP3T/SP4T catalog terminals from BJT-style names to switch-specific common/throw terminals.
- Parse common electronics shorthand quantities such as `1k5`, `4u7F`, and `2R2`.
- Export JFETs to Circuit JSON as schema-valid depletion-mode FET source metadata with an explicit lossy-mapping warning.

## 0.2.6

- Add a headless Circuit JSON source-domain exporter for `CircuitDocument`, with fixture coverage against the official `circuit-json` schema.
- Add playground keyboard shortcuts for undo, redo, and tidy layout while preserving normal shortcut behavior in editable inspector fields.

## 0.2.5

- Preserve `.vdsp` source provenance fields such as `source.version` and `source.url` through interchange parse/serialize round trips.

## 0.2.4

- Import LiveSPICE audio-engine runtime descriptors as stable opaque IC components with runtime metadata, diagnostics, and non-stage `input`/`output` terminal geometry.
- Preserve stereo runtime fields such as `StereoOutputMode` as component metadata instead of synthesizing extra schematic jacks.

## 0.2.3

- Treat the playground Source tab as a copyable conversion view with a format dropdown that defaults to `.vdsp`, supports `.schx` and `.cir`, and removes the separate Raw source tab.
- Add stepped knob panel metadata for detented controls, including `StepLabels`, numeric detent counts, snapping helpers, and message validation that rejects between-step knob positions.
- Add slider/fader panel controls for potentiometer metadata such as `ControlStyle: "Slider"` / `"Fader"`, with normalized slider runtime state and optional range metadata for graphic EQ style controls.
- Render stepped knob and slider control state overlays in `SchematicView`.
- Remove the playground Live Panel tab and demo surface while keeping the reusable panel/control-state library APIs available to host apps.

## 0.2.1

- Make the playground Source YAML and Raw `.schx` views editable with undoable document replacement.
- Keep Live Panel synchronized with the current edited schematic and preserve tab selection when changing fixtures.
- Add LiveSPICE opaque `MicroBlock...Stage` support for grey-box pedal descriptors.

## 0.2.0

- Add `controlState` and `controlOverlay` props to `SchematicView` for live LED, knob, and switch visualization driven by the `panel` protocol.
- Document virtual-component injection for hosts whose indicators live outside the parsed schematic.
- Add a playground Live Panel demo.
