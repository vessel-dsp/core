# Transistor records wave 2: community IS for 2SC2458 and 2SC2459 (2026-10-23)

Provisional fill: saturation current for two Toshiba NPNs from the only
published SPICE card for either part, taken under the owner's 2026-10-23
decision ("we have no other option"). **These are provisional `community`
values, not manufacturer values**: a third-party collection hosting
Intusoft-authored cards, where no datasheet Vbe, manufacturer model, or
owner measurement exists. No other parameter is taken from the cards, and
no other part is touched.

Lane key: every claim below is either a community card (third-party host,
verbatim fragment quoted in the record), a datasheet row (already cited in
the wave-1 note), or arithmetic recomputed in `python3 -I` (Vt = 0.025852 V,
n = 1 throughout). Nothing is fitted, tuned, or carried across parts.

## Verdict table (both parts)

| # | Part | Verdict | Parameter written | Source (document, lines, fragment) | Why no better source |
|---|---|---|---|---|---|
| 1 | 2SC2458 (unbinned + GR) | ADD IS | IS = 15.2e-15, `community` | KiCad-Spice-Library BJTN.LIB at commit `bb50ca6f` (see hash note below), QSC2458 card line 1161, comment line 1164: `IS=15.2F` / `* Toshiba 50 Volt  .15 Amp  400 MHz  SiNPN  Transistor  11-17-1993` | Toshiba 2SC2458(L) 1996-09-02 prints no VBE row (wave-1 note row 1: VCE(sat) MAX-only). Toshiba's own LTspice bundle carries neither part and is encrypted with a no-reverse-engineering term (brief-sourced, UNVERIFIED firsthand: the archive was never extracted or read here). Owner decision 2026-10-23 accepts provisional `community` IS |
| 2 | 2SC2459 (unbinned + GR) | ADD IS | IS = 10.1e-15, `community` | Same file and commit, QSC2459 card line 1168, comment line 1171: `IS=10.1F` / `* Toshiba 120 Volt  .1 Amp  100 MHz  SiNPN  Transistor  11-17-1993` | Toshiba 2SC2459 2003-03-27 prints no VBE row (wave-1 note row 10: VCE(sat) MAX-only 0.3 V). Same bundle situation and same owner decision as above |

BF is untouched everywhere: 221.3594362 (2SC2458), 282.8427125 (2SC2458GR,
2SC2459GR), 374.1657387 (2SC2459), all still `derived` from the Toshiba
sheets. The cards' BF (260 / 390) and every other card field are not taken.

## Source provenance and the commit-hash correction

The brief's raw URL pinned commit `a8688952bcaab19f567bc4db237b60bde03eef310`.
That hash resolves to nothing: it 404s as a `raw.githubusercontent.com`
URL, 404s as a `github.com/.../commit/...` page, and matches no commit in
the repo. The GitHub API (`commits?path=Models/Transistor/BJT/BJTN.LIB`)
lists exactly one commit ever touching the file:
`bb50ca6f03308666ac1decdc10449534cb60d45a` ("first commit", 2019-04-20).
The file fetched at that commit is byte-identical to master (92287 bytes,
`cmp` clean), and its content matches the brief's description exactly
(about 92 KB, both cards verbatim, comments verbatim). The records cite the
working `bb50ca6f` raw URL, not the dead hash. Card neighbourhood (1-based):

- line 1160 `*SRC=2SC2458;QSC2458;BJTs NPN;Amplifier;50 V .15A`, line 1161
  `.MODEL QSC2458 NPN (IS=15.2F NF=1 BF=260 ...`, line 1164
  `* Toshiba 50 Volt  .15 Amp  400 MHz  SiNPN  Transistor  11-17-1993`;
- line 1167 `*SRC=2SC2459;QSC2459;BJTs NPN;Amplifier;120 V .1A`, line 1168
  `.MODEL QSC2459 NPN (IS=10.1F NF=1 BF=390 ...`, line 1171
  `* Toshiba 120 Volt  .1 Amp  100 MHz  SiNPN  Transistor  11-17-1993`.

File header wording (lines 1-4): `* Copyright Intusoft 1988-1997` /
`* All Rights Reserved`. Only the value fragment and the card's own
descriptive comment are quoted in the records, never the model body. Author
is Intusoft, host is a third-party collection: both facts are stated in
every `whyNoBetterSource`.

## Why the community rule is met honestly, for both parts

The loader (`registry-data/loader.ts`) requires, for `community`: `sourceKind`
(`published-spice-model`), an http(s) `url`, a verbatim `quote`, a named
`author` (never "forum"), an ISO `retrievedDate` (`2026-10-23`), and
`whyNoBetterSource` -- and the `source` must quote both the URL and the
verbatim text (lines 352-411). All four records carry all six fields, and
module load validates them (loader throws otherwise; both part commits were
load-checked before committing).

The non-competition check, quoted: `communityClash` (loader.ts lines
440-455) throws only when the SAME parameter of one folded id is community
in one entry and non-community in another. Different parameters coexist --
the precedent is AC128 (IS and BF both community) and OC44 (derived IS
beside community BF). Here IS is the only community parameter in each of
the four records, beside derived BF; no second entry shares any of these
folded ids, so no clash is possible. The compiler side is per-parameter too:
`PROVISIONAL_OVERRIDE_KEYS` (compile.ts lines 477-486) maps each registry
parameter to its document-typed spelling, and the `taken` filter (lines
691-696) keeps a provisional parameter only when the document does not type
it. `findBjtLawDefaults` (lines 417-430) used to name these devices for IS
alone ("A record that states only BF ... leaves IS on the class default,
and is named for IS alone"); after this change they leave that set and are
named by `findRegistryProvisionalValues` (lines 673-715) under
`registry-provisional-value` (types.ts lines 3205-3231) for
`saturationCurrent` only -- proved by the smoke compile below.

## Arithmetic (recomputed `python3 -I`, Vt = 0.025852 V, n = 1)

Vbe = Vt * ln(Ic / IS):

- 2SC2458 (IS = 15.2e-15): 0.643966 V at 1 mA, 0.661885 V at 2 mA.
- 2SC2459 (IS = 10.1e-15): 0.654533 V at 1 mA, 0.672453 V at 2 mA.
- Class default the packets ran on before: `SILICON_SATURATION_CURRENT =
  1e-14` (device-laws.ts line 164; the fallback in part-catalog.ts line 244
  is `citedValueOf(record, "saturationCurrent") ?? 1e-14`), which implies
  0.654791 V at 1 mA and 0.672710 V at 2 mA.

So the 2SC2458 card sits about 11 mV below the default knee, while the
2SC2459 card is essentially the default (within 0.3 mV) -- recorded, not
tuned. For scale, the BjtLawDefaultWarning docs (types.ts lines 3180-3186)
note the default is ~119 mV off a real 2N3904; these two cards move parts
far less than that, which is expected for same-process Toshiba NPNs and is
not evidence for or against the cards.

## Spelling coverage (how checked)

`partIds` choice verified through the same fold the compiler uses
(`foldPartId(canonicalPartId(...))`, per identify.ts lines 99-123): a
7-case lookup control (`tmp/wave2/lookup-control.ts`, deleted before
finishing), all pass:

- 2SC2458, 2SC2458-GR, 2SC2458GR, 2SC-2458GR resolve to records now
  carrying community IS (the hyphenated/unhyphenated/odd-dash GR spellings
  all fold to `2sc2458gr`);
- 2SC2459, 2SC2459GR ditto (fold to `2sc2459` / `2sc2459gr`);
- 2SC1815 resolves to its record and still carries no IS (control: must NOT
  gain one).

GR ranks share the unbinned die's card (stated in each GR record: the cards
name no rank), matching the corpus, which uses the GR ranks (boss-tr-2 uses
2SC2458GR, boss-ge-7 uses 2SC2458-GR). No other part gains IS: 2SC1815,
2SC3324, 2SA1048, 2SA1015, 2SK879, 2SK880 and 2SC3378 are untouched (their
public-collection cards are copies of other parts' cards or contradict
their datasheets, per the brief; not re-verified here, no change made).

## Tests

- `bun test packages/compiler/tests/registry-data.test.ts`: 55 pass, 0 fail.
- Full `bun test packages/compiler/tests`: 652 pass, 0 fail (32 files).
- `bun test tests/simulation.test.ts`: 3 pass, 0 fail.
- Full root `bun test`: 2261 pass, 50 skip, 6 fail -- the failing set is
  exactly the known environmental 6: 5 console-agreement tests failing on
  the missing `wasm/v2_dsp.cjs` build artifact (delay-tap-reverse,
  declared-program, hold-loop, tap-law, controller-latch) plus the release
  metadata pin. The wave-1 note documents the same set reproducing on
  unchanged main; no new failure, none related to this change.
- Lookup control: 7/7 pass (deleted with scratch).
- Not trusted here: `bun run typecheck` / builds resolve into the main
  checkout's `dist` inside this nested worktree (per brief).
- Smoke compile (scratch `tmp/wave2/smoke-tr2.ts`, deleted): corpus packet
  `boss-tr-2.vdsp` (read-only from the artifacts checkout) compiled with
  this worktree's compiler -- status ok; Q2/Q5/Q7 (all 2SC2458GR) stamp
  IS = 1.52e-14 with BF = 282.8427125 unchanged, each carries
  `registry-provisional-value` for `saturationCurrent` alone, and the
  `bjt-law-default-parameters` warning now names only Q6 (a different part
  still on defaults). This proves the record resolves, not anything about
  audio.
- Record counts unchanged: BJT rows 62 before and after (parameters added
  to four existing records, no new records), so `index.ts` states no count
  and is untouched.

## Sources fetched (all into `tmp/wave2/`, deleted at the end)

BJTN.LIB at `bb50ca6f` (92287 bytes, byte-identical to master) plus the
GitHub API commit listing that locates the file's sole commit; the
preamble-hash 404 headers. Nothing extracted from the Toshiba LTspice
archive (never downloaded here). `python3 -I` used for all arithmetic;
nothing was run from inside `tmp/wave2/`.
