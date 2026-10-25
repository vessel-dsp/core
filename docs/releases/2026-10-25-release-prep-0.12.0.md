# Release prep amendment: compiler 0.12.0 / runtime 0.10.0 / chain 0.1.15 / player 0.2.13 (2026-10-25)

**STATUS: PREPARED, HOLD PUBLISH** (owner publishes once at the end). Follows
`docs/releases/2026-10-25-release-prep-0.11.0.md` (the v2 law); this amends only the
`dbx-vca` law revision (v3).

## Why v3 (coordinator render + worker instrumentation)

With 0.11.0/0.9.0 linked into workbench the re-traced CS-3 EXPANDED: gain
0.582/0.623/1.109 at sine-220Hz 0.05/0.3/0.9 while the v2 fixture compressed. Two
measured causes, both in the law: (1) the v2 envelope rectified the cell's node
voltage, but the cell input is a virtual ground (100 ohms against the 10k feed), so
the envelope came out ~100x too small (8 mV at 0.9 V in) -- the cell fell 20% while
its input current grew 18x; (2) node 70 carries tens of millivolts of audio in the
pedal (53 mV rms at 0.9 V in, engine-measured), and reading control raw pumps the
gain at audio rate. SUSTAIN 0->1 still moved output -6.8 dB (external path works);
the IC3 stamp was present and correct, so this is law scale/smoothing, not binding.

## What v3 changes (law revision, both consoles)

- The rectified INPUT CURRENT (not node voltage) drives the follower, scaled by
  `detectorOhms` 1k: feed current 3.5-63 uA rms maps to 0.004-0.06 V of control
  (~1-11 dB of level-driven reduction; a full R9-mirror 10k would pin the -30 dB
  floor above ~0.2 V in, 1k lands the 0.9 V protocol point near -20 dB).
- The SUM of external control and scaled input is smoothed (attack 0.0005 s,
  release 0.05 s) and held across the Newton loop; no live control derivative.
- New `dbx-vca` law/stamp field `detectorOhms` (vrefVolts stays 4.66, clamp +-30 dB).

## Measured in-repo (this worktree)

- Fixture DC control sweep (fixed 0.5 V in): renders 2.673/0.829/0.257 at
  4.60/4.66/4.72 V vs hand-computed ditto; DC input sweep at static 4.66 V:
  1.978/1.480/0.829 at 0.05/0.2/0.5 V vs hand-computed ditto; rest-offset cell
  (control 4.70) monotonic DC fall; sine sweeps fall monotonically at center
  (1.50/0.86/0.34 across 0.2/0.5/1.0 V) and at rest offset, TS-vs-WASM >= 0.9999.
- Retraced CS-3 (read-only): IC3 lowers to the v3 stamp; engine-measured pedal
  sweep now compresses monotonically (AC gains 0.71/0.33/0.05 at 0.05/0.3/0.9 V)
  with SUSTAIN 0->1 still -6.8 dB. LM-2 compiles, binds by role, no new warnings.
- Bare-pin IC3 keeps `unverified-pinout-binding` (positional, per the ship-as-is
  decision and separately-dispatched packet-roles follow-up).

## For the workbench render check (coordinator lane, not run here)

Render the v1.2 vdsp with sine 220 Hz at 0.05/0.3/0.9 (3 s settle + 6 s, no IR,
defaults): expect gain to FALL across the sweep instead of 0.582/0.623/1.109, with
SUSTAIN 0->1 still moving output about -7 dB.
