# 2026-10-20 UJT clock route: derive the Slapback BBD delay in the compiler (route A)

Status: **verdict A (compiler-side derivation), with numbers.** Route B (in-engine
hysteretic-switch stamp) is measured below at 2--3 engine samples per UJT cycle at
production rates, where a once-per-sample switch quantizes the period by -22%/+16%
(open) and -44%/+12% (closed) before any analog error. Route A needs no change to
`Program`, the `Stamp` union, `ProgramJson.cpp`, `Program.h`, or the runtime: the
`clockControl` shape (`controlId` + `ohmsAtControlMin/Max` + `taper` + `farads` +
`stages` + `formulaConstant` + `offsetSeconds`) already expresses a discrete
2-position control, and the runtime already evaluates it per sample through
`taperFraction` (`packages/runtime/src/reference-runtime.ts:2577-2584,3054-3059`).

Part 1 (registry seed) is done on this branch: `2N4871` in
`packages/compiler/src/registry-data/ujt.ts`, eta 0.775 `derived` (printed
0.70--0.85 midpoint, form 2), RBB 6000 `datasheet` (printed TYP), both citing
Digitron Semiconductors 2N4870/2N4871 Rev. 20120705 p1 rows.

## 1. Samples per UJT cycle at the rates the host really runs

The host does not oversample in production. `SignalChain`/`prepare(sampleRate)`
default to 48000 (`packages/chain/src/chain.ts:18`, `nodes/*: prepare`), the player
uses the Web Audio device rate, and the v2 engine's `oversample` option defaults to
1 (`packages/runtime/src/v2-wasm-engine.ts:89-106`). Nothing in `web/` or the player
passes `oversample > 1` (grep: only the engine and the worklet define the option).
So production is the device rate -- 48 kHz typically, 44.1 kHz possible -- at factor 1.
(The coordinator's "8-12 at 4x" describes an engine option no caller uses; the numbers
below use the real factor 1, with 4x shown only to close that door.)

UJT targets from the declared delays (1024 stages, divide-by-two, delay = stages/f_UJT):
65 ms -> 15.754 kHz (T = 63.48 us), 45 ms -> 22.756 kHz (T = 43.95 us).
Registry-midpoint (eta 0.775) derivation: 18.622/26.798 kHz (T = 53.70/37.32 us).

| case | T (us) | samples @48k | samples @44.1k | samples @192k (hyp. 4x) |
|---|---|---|---|---|
| open target (65 ms) | 63.48 | 3.05 | 2.80 | 12.2 |
| closed target (45 ms) | 43.95 | 2.11 | 1.94 | 8.4 |
| open derived (eta .775) | 53.70 | 2.58 | 2.37 | 10.3 |
| closed derived (eta .775) | 37.32 | 1.79 | 1.65 | 7.2 |

A node-driven switch evaluated once per sample quantizes the period to whole samples.
Nearest-integer rounding of the derived-midpoint periods at 48 kHz:

- Open (2.58 samples): 2 samples = 41.67 us (-22.4%) or 3 samples = 62.50 us (+16.4%).
- Closed (1.79 samples): 2 samples = 41.67 us (+11.6%) or 1 sample = 20.83 us (-44.2%).

Delay tracks the period 1:1 (delay = stages/f), so route B's delay error is -22%/+16%
open and -44%/+12% closed at 48 kHz -- and at 44.1 kHz the closed cycle is 1.65
samples, below 2. At hypothetical 4x the quantization is still +/-5-7%, and the
15-27 kHz switching edges alias against a 48 kHz control evaluation regardless.
No sub-sample switch timing exists in any stamp, and adding it is a runtime change.
Route A has no quantization at all: the derived delay is a float (55.0/38.2 ms at the
midpoint) evaluated by the existing `clockControl` path.

## 2. What the compiler recognises today, and the exact gaps

`deriveBbdDelayFromNetlist` (`packages/compiler/src/bbd-clock.ts:1165`) recognises:
CD4047 (f = 1/(4.40*R*C)), MN3101/MN3102 star networks (f ~= 1/(5.0*R*C)), PT2399 and
M50195 VCO paths. `deriveOpenOx2ClockLaw` recognises one 8-part MN3101 open-OX2 form.
Gate-clocked brigades (MC14069 inverters, CD4013/CD4011/CD4043 families) are
*diagnosed, never derived*: steered -> modulated refusal, passive -> "no registered
frequency formula" refusal. `clockControl` binds only pot/rheostat sweeps
(`resolveTimingResistanceNetwork` + `primaryTimingControl`, `delay-time` role first);
no discrete switch position has ever fed it -- but the runtime shape needs no switch
special case (section 4).

For the Slapback (`IC2_SAD1024A`, BBD clock roles phi1a/phi2a/phi1b/phi2b on nodes
24/25, both recognised today) the UJT network lacks exactly four things:

1. **The divider spelling.** `GATE_CLOCK_PART_IDS` holds `cd4013`/`cd4013ae`/...
   but not `scl4013a` (the packet's exact `PartNumber`; core main bcd6ef1 carries
   the SCL4013A alias on the CD4013AE *entry*, which `bbd-clock.ts` never consults --
   it matches folded part ids, whole values). So `findGateClockSource` returns null
   and the Slapback reports `no-clock-driver`. Note the trap: merely adding the
   spelling routes IC3 into the gate branch, where `Q2_CLOCK_DRIVER`'s collector on
   the divider clock node reads as *steering* and the outcome becomes a modulated
   refusal. Q2 is drive, not modulation -- the existing steered/passive vocabulary
   cannot tell them apart, so the UJT form needs its own derivation, not the gate
   branch.
2. **The divide-by-two check.** Nothing verifies toggle wiring (D tied to not-Q,
   Q/not-Q onto the BBD clocks). Here: IC3 `data1`+`notq1` share node 24, `q1`->25
   and `notq1`->24 land exactly on IC2's phi1a/phi1b and phi2a/phi2b (nodes 25/24),
   all as typed terminal roles compared whole-value. Second half (q2/notq2, nodes
   22/39) is unwired spare -- recognition must scope to the half that hits the BBD.
3. **The relaxation network.** Nothing walks emitter-R/C + eta. Here: Q1_UJT (`kind:
   bjt`, `declaredType: Circuit.UnijunctionTransistor`, roles emitter/base1/base2,
   `PartNumber: 2N4871` resolving in the seeded registry), charging resistors
   R_DELAY_36K (rail node 8 <-> emitter node 17, always) and R_DELAY_82K (DELAY
   common node 15 <-> 17, selected), timing capacitor C_CLOCK_0_001U_A (17 <-> 18,
   far end 68R to ground = AC ground at << R_charge), base1 to ground, base2 fed
   from the rail through 220R. The rail (node 8) is identified by connectivity: the
   BATTERIES `kind: battery` positive terminal sits on it (18 V declared) -- kinds
   and roles, never names.
4. **The switch as a dual-R selector.** DELAY is `kind: switch` with control `DELAY`
   (`positions: 2`, `defaultPosition: 0`), common 15, throws 38 (dangling, OPEN) and
   8 (rail, CLOSED). Position p shorts common to throws[p] (`switchPoles` order,
   `selected = floor(position * throwCount)` in both `lower.ts` and the runtime):
   R(0) = 36K, R(1) = 82K||36K = 25.017K. `clockControl` covers this unchanged:
   `controlId: DELAY`, `taper: linear` (the control's own taper), `ohmsAtControlMin:
   36000`, `ohmsAtControlMax: 25016.9`, `farads: 1e-9`, `stages: 1024`,
   `formulaConstant: ln(1/(1-0.775)) = 1.4917`, `offsetSeconds: 0` -- delay =
   stages*K*R*C, buffer sized for the max, initial position from `defaultPosition`.

## 3. Derived versus declared, reported honestly

Ideal formula f = 1/(R*C*ln(1/(1-eta))), C = 1 nF:

| eta | f open (kHz) | f closed (kHz) | delay open (ms) | delay closed (ms) |
|---|---|---|---|---|
| 0.70 (printed min) | 23.07 | 33.20 | 44.38 | 30.84 |
| 0.775 (registry midpoint) | 18.62 | 26.80 | 54.99 | 38.21 |
| 0.828 (lands both declared) | 15.78 | 22.71 | 64.89 | 45.09 |
| 0.85 (printed max) | 14.64 | 21.07 | 69.94 | 48.60 |

All four coordinator figures verify (23.1/33.2, 18.6/26.8, 15.78/22.71, 14.6/21.1 kHz;
targets 15.75/22.76 kHz). The open/closed ratio is the resistance ratio
36/25.0169 = 1.4390 against declared 65/45 = 1.4444 -- 0.4% agreement, so the *ratio*
is right and only the absolute scale is in question.

The disagreement: midpoint derives 55.0/38.2 ms, ~15% below declared 65/45, while
the printed 0.70-0.85 eta spread alone spans 44-70 ms open. Declared implies eta
0.828 (ideal) or ~0.846 (VF/valley-corrected, section 5) -- the top edge of the
printed band. **Never tune eta to the declared delay;** the midpoint derivation
stands as the registry value and the declared times stay in the packet. Which wins
is the owner's policy decision: derived-from-registry-midpoint versus the
manufacturer-published times (carriable as an explicit measured/custom
`DeviceOverride` with provenance if the owner picks the packet). If the packet needs
that override, it is an `artifact-change-required` return, not an edit.

Q1_UJT keeps `device-law-not-implemented`, and that is the honest answer: the clock
derivation consumes the UJT's frequency-setting function (its only circuit function
-- emitter in the timing network, base1 grounded, base2 rail-fed) using its printed
eta, but no stamp models its bar loading (~2.9 mA DC through RBB+220R) or its B1
pulse drive to Q2. Both omissions are provably audio-irrelevant here (ideal supplies
in-sim, so DC loading moves no audio node; the pulse's only downstream function is
the clock, whose only function is the derived delay), but a frequency derivation is
not a device execution, and suppressing the warning would claim one. So: delay
`derived`, UJT warning kept, reasons stated.

## 4. Verdict: route A

Route B fails on sampling arithmetic alone (section 1: -44%/+12% closed at 48 kHz,
1.65 samples at 44.1 kHz), before the Newton-lottery argument in `docs/spikes/
2026-10-20-ujt-law.md` section 2 is even reached. Route A derives both DELAY
positions through the existing `clockControl` machinery with zero `Program`/stamp/
runtime change: `delaySeconds` at the default position (55.0 ms at position 0),
`delayProvenance: derived`, `clockControl` sweeping 36K <-> 25.017K on the DELAY
control. Recognition is connectivity + typed roles + exact part ids only (UJT
declaredType, 2N4871 registry seed, 4013-family ids incl. SCL4013A, 4013 q/notq/
clock/data role tokens, battery-positive rail, common/throw switch declaration) --
no names, no prose, no regex, no per-packet tuning. The corpus digest gate decides:
only `electro-harmonix-slapback-echo` may move.

## 5. What the ideal formula needs, and its stated error bound

The ideal formula ignores VF and the valley: it charges 0 -> Vp instead of Vv ->
Vp. The corrected form is T = R*C*ln((Vs-Vv)/(Vs-Vp)) with Vp = eta*VBB + VF.
Printed: VF ~0.49 V (Note 1, p1); valley-point *current* rows (2N4871 min 4.0/typ 7.0
mA); peak current typ 1.0/max 5.0 uA. NOT printed: valley *voltage* (typical-
characteristics graphs only, ~1.4-1.7 V at TJ = 25 C -- informs judgement, never a
typed value per repo precedent). At Vs = 18 V (BATTERIES positive on node 8),
VBB ~17.4 V, Vv = 1.5 V (graph-informed):

| eta | ideal k | corrected k | corrected vs ideal |
|---|---|---|---|
| 0.70 | 1.2040 | 1.1248 | -6.6% |
| 0.775 | 1.4917 | 1.4032 | -5.9% |
| 0.85 | 1.8971 | 1.7903 | -5.6% |

Bound: the ideal formula overstates the period by ~5-7% across the printed eta band
(plus ~1% from RBB operating at ~17 V against its 3 V print condition, graph p4).
That is second order against the eta spread itself (+27%/-19% on delay open) and
against the 15% declared-vs-midpoint gap -- and correction *widens* the gap
(51.7/35.9 ms, ~-20%), so no correction rescues the declared times; only an
eta at the top of the printed band does. Oscillation itself is guaranteed with huge
margins at both positions (valley current 458/660 uA vs Iv min 4000 uA; peak charge
current 113/162 uA vs Ip max 5 uA -- printed rows, used as checks, not values).

## 6. Datasheet provenance (read-only, never copied into a repo)

File `2N4870-2N4871.pdf`, Rev. 20120705, sha256
`81b46aa8ad8a271a3aca154f7129fe3e6abfc7066440d52d50a4d99ff9a17722`. Page 1 text
layer verified against the coordinator's transcription -- every number matches:
eta 2N4870 0.56-0.75 / 2N4871 0.70-0.85 (VB2B1 = 10 V); RBB 4.0/6.0/9.1 kohm (one row,
both parts, VB2B1 = 3 V, IE = 0); alpha-RBB 0.1-0.9 %/C; VEB1(sat) typ 2.5 V;
IB2(mod) typ 15 mA; IP typ 1.0/max 5.0 uA (VB2B1 = 25 V); IV 2N4871 min 4.0/typ 7.0
mA (VB2B1 = 20 V, RB2 = 100 ohm); IEB20 typ 0.005/max 1.0 uA (VB2E = 30 V, IB1 = 0);
VOB1 2N4871 min 5.0/typ 8.0 V; Note 1 (VP = eta*VB2B1 + VF, VF ~0.49 V at 25 C @
IF = 10 uA, -2.5 mV/C) and Note 2 (pulse techniques) as transcribed. Pages 2-5 have
no text layer (pin-out B1-E-B2 TO-92, test circuits, static emitter curves, typical-
characteristics graphs); rendered at 150 dpi to an empty scratch dir (since deleted)
and read at native resolution. **Manufacturer printed on every rendered page:
DIGITRON Semiconductors** ("High-reliability discrete products and engineering
services since 1977").
