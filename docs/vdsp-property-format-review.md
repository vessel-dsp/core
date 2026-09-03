# `.vdsp` property format review

**Date:** 2026-09-03. Measured over 142 documents, 11,612 components, **58,021 property
declarations** across **567 distinct keys**.

## Verdict

Key *naming* is consistent. Value *typing* is not, and the inconsistency is concentrated in five
patterns below. One of them — taper — was fixed in 0.6.31; the rest are recorded with their
counts rather than fixed, because most are document corrections rather than format changes.

## 1. Key naming: consistent

| style | keys | examples |
| --- | ---: | --- |
| PascalCase | 563 | `Name`, `Resistance`, `SourceValue` |
| camelCase | 3 | `model`, `n`, `pChannel` |
| snake | 1 | `OnResistanceAt0_5mA` |

563 of 567 follow one convention. The four outliers are worth renaming and nothing more.

Distribution is heavy-tailed the same way terminal roles were: **49 keys cover 90%** of all
declarations, and **198 keys appear exactly once**.

## 2. Mixed-type keys — 55 of 567

The largest inconsistency. A key holds a typed `{value, unit}` quantity in some documents and a
bare string in others:

| key | quantity | string | other |
| --- | ---: | ---: | ---: |
| `Resistance` | 3,910 | 716 | 2 objects |
| `Capacitance` | 2,178 | 370 | |
| `Wipe` | 216 | 220 | 27 numbers |
| `Voltage` | 315 | 75 | |
| `R` | 42 | 386 | 6 numbers |
| `Impedance` | 12 | 120 | |

**Part of this is deliberate and must not be "fixed".** The artifacts source discipline holds that
typing a quantity asserts the value is *printed in a cited source*; a value that is derived, or
that the source states as prose, stays a string on purpose. A string `Resistance` reading
`"1M, derived from the divider ratio"` is a correct declaration.

What is *not* deliberate is the numeric-string subset — `Resistance: '100000'` is a number that
failed to be typed, not prose. Separating the two needs a per-value check, not a per-key rule.

## 3. Number-as-string, with quoting and precision drift — 8 keys

| key | values seen |
| --- | --- |
| `Wipe` | `0.5`(54) `'0.5'`(29) `0`(14) `0.50`(14) `'0.50'`(9) |
| `PartNumber` | `4558`(22 as **number**) `'4558'`(16) `4049`(6) `741`(2) |
| `DelayMs` | `'8'` `'50'` `'125'` `300` `50` |
| `Aol` | `'200000'`(12) `200000`(9) `100000`(8) `'100000'`(4) |
| `SR`, `PackagePins`, `SourceValue`, `Resistance` | same shape |

`0.5`, `'0.5'` and `0.50` are one value spelled three ways, so any consumer comparing strings sees
different knob defaults. **`PartNumber` as a YAML number is the sharpest case**: a part id coerced
to `4558` will not match a catalog keyed on `"4558"` unless every reader remembers to stringify.

## 4. Boolean-as-string — 11 keys

`Momentary`, `Closed`, `CenterClick`, `WetOnly`, `InterfaceOnly`, `RatingCap`,
`DiodeBypassMod`, `ExternalAccessory`, `NoGlobalNegativeFeedback`, and two
`FirmwareRequiredFor…` keys carry `true`/`false` as **strings**. A consumer testing `=== true`
and one testing `=== "true"` disagree.

## 5. Synonym keys

`Resistance`(4,628) / `R`(434) · `Capacitance`(2,548) / `C`(87) · `Voltage`(390) / `V`(4)

Same fact, two keys, and the short forms are the ones more likely to be untyped (`R` is 386
strings against 42 quantities).

## 6. Value vocabularies that are closed but untyped

| key | declarations | distinct | verdict |
| --- | ---: | ---: | --- |
| **`Taper` / `Sweep`** | 264 / 397 | 30 / 16 | **fixed in 0.6.31** |
| `Type` / `Polarity` / `Channel` | 414 / 75 / 3 | 19 / 10 / 1 | three keys for device polarity |
| `SourceConfidence` | 2,184 | 4 | closed already: high/medium/low/estimated |
| `SourceStatus` | 354 | 3 | closed already: keep/change/defer |
| `SourceKind` | 287 | 12 | a second, drifting copy of `ComponentKind` |

`Type`/`Polarity`/`Channel` is the next one worth doing. The three keys overlap (`NPN` appears
under both `Type` and `Polarity`), carry case drift (`npn`/`NPN`) and quoting artifacts (`'N'`),
and **`Polarity` conflates two concepts**: `electrolytic`(41) is capacitor polarity sitting under
the same key as `NPN`(15) transistor polarity. The measured consequence downstream is 37 FETs
whose channel does not resolve.

## Correctly prose — leave alone

`Role`(1,332 distinct), `SourceBoundaryRole`(1,273), `ControlRole`(177),
`SourceTraceStatus`/`SourceTerminalStatus`/`TerminalTraceStatus` (long provenance sentences).
These are authored descriptions. Reading them for a behavioural decision is already forbidden
downstream, and typing them would invite exactly that.
