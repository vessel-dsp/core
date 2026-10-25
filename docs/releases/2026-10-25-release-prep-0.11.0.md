# Release prep amendment: compiler 0.11.0 / runtime 0.9.0 / chain 0.1.14 / player 0.2.12 (2026-10-25)

**STATUS: PREPARED, HOLD PUBLISH** (owner publishes once at the end). Follows
`docs/releases/2026-10-25-release-prep-0.10.0.md` (the v1 law + BA718 dual, committed
green as 4767c7f); this amends only the `dbx-vca` law revision (v2).

## Why v2 (measured by coordinator, confirmed here)

With 0.10.0/0.8.0 linked into workbench the re-traced CS-3 renders perfectly LINEAR
(gain 0.303/0.303/0.304 at sine-220Hz 0.05/0.3/0.9; SUSTAIN 0->1 moves output 2.4%).
Root cause is structural: node 70 (GC1) is DC-pinned by R10 1k to 4.5 V with only the
tap feeding it through R11 15k (measured here: SUSTAIN 0->1 moves node 70 just
4.6325->4.6728 V, i.e. 40 mV), while v1's island sigmoid needs volts of control swing.
The external netlist converts no input level to control (4a's audio input is an open
trace residual), so no external-only law can compress.

## What v2 changes (law revision, both consoles)

- Control law: `gain_dB = -((Vcontrol - 4.66) + envelope) / 0.0059`, clamped to the
  datasheet's +-30 dB. The divisor is the NEC -5.9 mV/dB feature line (same as the
  LM-2 deck); 5.9 mV moves a dB, so SUSTAIN's millivolts now move the threshold.
- Center 4.5 -> 4.66 V (both quoted on the catalog entry): 4.5 is the island's
  off-chip ctrl_bus number; the law reads the on-chip GC node, engine-measured rest
  4.658 V at declared defaults (SUSTAIN 0.5). Centering at 4.5 would park rest gain
  27 dB down a clamp rail (0.16 V x 1/0.0059), hiding every input sweep at the floor.
- Envelope: the law rectifies (|in|) and smooths its own input with attack 0.0005 s /
  release 0.05 s (C8 4.7 uF by R13 10k ~ 47 ms; D6 charge path ~100 ohms ~ 0.5 ms),
  held across the Newton loop on one new state slot (compandor precedent), updated
  once per committed sample on both consoles.
- New `dbx-vca` law/stamp fields: inputSiemens (kept 0.01), vrefVolts 4.66,
  attackSeconds, releaseSeconds, minGainDb -30, maxGainDb +30 (v1's sigmoid fields
  removed; 0.10.0/0.8.0 were never published, so no shipped program carries them).

## Measured in-repo (this worktree)

- `dbxVcaCell` DC control sweep (fixed 0.5 V in): renders 6.377/1.978/0.613 at
  4.60/4.66/4.72 V vs hand-computed 6.377/1.978/0.613 (both consoles).
- `dbxVcaCell` DC input sweep (static control 4.66 V): renders 1.978/1.480/0.829 at
  0.5/2/5 V vs hand-computed ditto (both consoles); sine sweep at static control
  falls 1.98/1.50/0.86 across 0.5/2/5 V amplitude.
- TS-vs-WASM agreement on DC + sine transfer: correlation >= 0.9999, max |delta| < 1e-4.
- BA718 dual tests re-run green (untouched path); LM-2 still compiles, binds by role.
- Retraced CS-3 (read-only): IC3 lowers to the v2 stamp; no ic-not-executed for IC4.
- Known carry-over: bare-pin IC3 keeps `unverified-pinout-binding` (positional, per the
  ship-as-is decision and separately-dispatched packet-roles follow-up).

## For the workbench render check (coordinator lane, not run here)

Render the re-traced file at sine 220 Hz @0.05/0.3/0.9 (3 s settle + 6 s, no IR,
defaults): expect gain to FALL across the sweep (v2 envelope) instead of flat 0.303,
and SUSTAIN 0->1 to move output by dB (v2 moves node 70's 40 mV through 1/0.0059 =
~7 dB), not 2.4%.
