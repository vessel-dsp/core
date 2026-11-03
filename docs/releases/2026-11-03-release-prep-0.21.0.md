# Release prep: core 0.19.0 / compiler 0.21.0 / runtime 0.16.0 / chain 0.1.23 / player 0.2.21 (2026-11-03, ambient temperature + NTC thermistor)

**Status: PREP ONLY. No push, no tags, no publish; the owner publishes once at the end.**
Prepared 2026-11-03 on branch `indiejoseph/core-temperature` at `f9681f1` (plus this
note): main `5afbc1d` plus two commits, verified in a fresh throwaway clone (deleted
after). Local core `main` untouched (another session has uncommitted work there).

## What ships

| package | from | to | why |
|---|---|---|---|
| core (`@vessel-dsp/core`) | 0.18.0 | 0.19.0 | new component kind `thermistor` + typed `Resistance`/`Beta`/`ReferenceTemperatureC` validation (no schema bump per the fuse precedent) |
| compiler | 0.19.0 | 0.21.0 (via 0.20.0) | `ambientTemperatureC` compile option with the junction fold at compile time (0.20.0); thermistor device kind lowering to R(T) (0.21.0); exact core pin 0.19.0 |
| runtime | 0.16.0 | 0.16.0 (unchanged) | untouched: no `Program`/`Stamp`/`ProgramJson.cpp`/`Program.h` change; exact compiler pin moves to 0.21.0 |
| chain | 0.1.23 | 0.1.23 (unchanged) | never calls the compiler (takes a built `Program`); exact pins move (compiler 0.21.0, core 0.19.0) |
| player | 0.2.21 | 0.2.21 (unchanged) | `ambientTemperatureC` passthrough only; exact pins move (chain 0.1.23, compiler 0.21.0, core 0.19.0, runtime 0.16.0) |
| stompbox | 0.6.17 (unchanged) | -- | exact `@vessel-dsp/core` pin moves to 0.19.0 |

## What changed

Two commits, each with its tests:

- `a97c841` compiler: ambient temperature as a compile option (0.20.0). T = 273.15 + C;
  every diode, BJT and OTA-bias law folds at compile time (`thermalVoltage` with T
  against the 300 K reference, saturation currents with the SPICE law relative to
  300 K: XTI 3, EG by a new typed registry `material` -- silicon 1.11, germanium 0.67,
  Schottky 0.69). Filled from the records' existing citations (Schottky ST/Diodes Inc
  cards printing EG .69, Nexperia BAT85 card; DEC 1N60 sheet, Bordodynov 1N34A card,
  measured 1S188FM, Mullard/Newmarket/Siemens germanium BJT rows); never inferred from
  names -- PN2222A and ZTX109C sit beside germanium rows in the same files and stay
  unset. Untyped parts run silicon, named once by the new `material-default-silicon`
  notice, which fires only off-reference.
- `f9681f1` core+compiler: NTC thermistor as a component kind (core 0.19.0, compiler
  0.21.0). `R(T) = R_ref * exp(Beta * (1/T - 1/T_ref))` folded at the ambient; Beta 0
  is exactly the same-valued resistor; `Type: ptc` / missing Beta / negative Beta /
  unphysical T_ref / wrong terminal count are typed refusals naming the component.

## Evidence

Closed forms (hand-computed, asserted with relative tolerance, not implementation
outputs): silicon diode at 19 C Vt 0.02517554 V / IS 1.24652e-09 A; germanium AC128
IS 7.82474e-06 A; OTA scaled defaults IS 2.91346e-13 A; divider 13127.010775676536
ohms at 19 C (gain 0.43239483) and 10000.00 at 25 C; FF collector return
43319.13555973257 ohms at 19 C, 33000.00 at 25 C.

- Bit-identical default: every shipped fixture string compiles byte-identically
  (program text, or refusal reasons) with the option absent vs explicit 26.85 C
  (`packages/compiler/tests/ambient-temperature.test.ts`, 8 tests). ngspice parity
  needs `tnom=26.85` to match the 300 K reference -- the deck contract is pinned as
  text in `tests/temperature-parity.test.ts`.
- ngspice parity of the Fuzz-Face-like fixture (two AC128 germanium PNPs, RT1 33k
  NTC Beta 3950 in Q1's collector return) with hand-written decks at 19 C and 25 C,
  5 mV / 1 kHz, runtime at 48 kHz oversample 1, settled last cycle: corr
  0.9999999981 / maxDelta 5.2e-5 / dcDelta 4.2e-5 at 19 C; corr 0.9999999978 /
  maxDelta 5.5e-5 / dcDelta 4.5e-5 at 25 C. Bars are the existing ones (corr >=
  0.9999, maxDelta < 1e-4). The ngspice legs skip where no binary exists; the
  runtime closed-form legs always run.
- Worktree gates: `bun run typecheck` exit 0 (root + all packages); `bun run build`
  exit 0 (`dist entrypoints ok`); root `bun test` 2734 pass / 0 fail (175 files).
- Fresh-clone gates (clone of this worktree at `f9681f1` to `/tmp/core-temp-verify`,
  wasm supplied from the main checkout after checking its date 2026-11-01, clone
  deleted after): `bun install --frozen-lockfile` exit 0 (411 packages);
  `bun run typecheck` exit 0; `bun run build` exit 0 (`dist entrypoints ok`);
  `bun test` 2734 pass / 0 fail (175 files). Note: expect() totals differ by one
  between the two full runs (632475 vs 632476) with identical pass/fail counts --
  run-to-run variance in an existing test, not attributable to these commits.

## The two stated limits (and the rest of the out-of-fold list)

- No self-heating: the thermistor resistance is a function of the ambient alone;
  current through the disc does not warm it (stated in the law's doc comment).
- Material defaults to silicon where untyped -- including LEDs, whose junction is a
  III-V the three-material law does not cover (they run the silicon bandgap of
  1.11 eV, SPICE's own default; named by the notice like any defaulted junction).
- Outside the fold by construction, reported not changed: the FET body-diode scale
  and the optocoupler LED emitter stay at 300 K in both consoles
  (`Engine.cpp:939-940` and `:3935-3937`, mirrors at `reference-runtime.ts:799`
  and `:9079-9080`). Folding them needs new stamp fields -- a `Program`-shape
  change this option deliberately avoids. JFET gate terms, BJT betas, zener
  breakdown and series resistances carry no temperature model and are kept as stated.
- No SPICE deck emitter lives in this repo (verified by search: only citations and
  history comments mention ngspice under `packages/`). The workbench
  source-to-spice deck must emit `.options temp=<C> tnom=26.85` and the material's
  EG/XTI on every `.model` for parity off-reference; the parity test pins those
  lines as text.

## Checklist

1. Versions and exact pins bumped per the table; core `VERSION`, dist, and the
   release-metadata test move together; CHANGELOG heading added. No tags, no publish.
2. No `Program`/`Stamp`/`ProgramJson.cpp`/`Program.h`/kernel-table change (runtime
   sources untouched -- verified by empty diff).
3. Local core `main` -- NOT TOUCHED (another session's uncommitted edits).
4. `/core-temperature/` already in the core checkout's `.git/info/exclude`; nothing
   loose in `~`; the `/tmp` scratch clones removed.
5. **No push.**
