# Transistor records wave 1: 15 parts, data only (2026-10-23)

Census-driven fill: 15 part groups covering 173 of the 268 devices that run on
BJT/JFET class defaults. Verdict per part: ADD where every written parameter has
its own citation under the registry's sourcing rules, SKIP where no rule-compliant
source exists. A skip is a reported outcome, not a failure.

Lane key: every claim below is either a datasheet row (manufacturer sheet, page
and row quoted in the record), manufacturer-model (onsemi/Diodes/Central only),
or arithmetic recomputed in `python3 -I` (Vt = 0.025852 V throughout). Nothing
is fitted, tuned, or carried across manufacturers.

## Verdict table (all 15)

| # | Part | Verdict | Parameters written | Source (document, page, row) | Skip rule / note |
|---|---|---|---|---|---|
| 1 | 2SC2458 | ALREADY ON MAIN, no change | BF 221.3594362 (unbinned), BF 282.8427125 (GR) | Toshiba 2SC2458(L) 1996-09-02 scan p1: hFE 70-700 @6V/2mA; GR 200-400 | No VBE row of any kind: IS has no input (stands) |
| 2 | 2SC3378 | PARTIAL (unbinned stands; GR skipped) | BF 374.1657387 (unbinned, on main) | Toshiba MINI PACKAGE SERIES selection table T-27-01: hFE 200-700 @6V/2mA | GR rank: no citable bin row anywhere reachable; rank footnotes unmappable. 2SC3378GR/-GR spellings stay on defaults, reported |
| 3 | 2SC1815 | ALREADY ON MAIN, no change | BF 221.3594362 + Y 169.7056275 + BL 494.9747468 | Toshiba 2SC1815 2007-11-01 p1: hFE(1) 70-700; ranks O/Y/GR/BL | VBE(sat) MAX-only: IS has no input (stands) |
| 4 | 2SK30A | ADD (O rank + bare-TM alias) | Vt0 -2.7 / Beta 1.3717421e-4 (2SK30A-O); alias 2SK30ATM on gate-only unbinned | Toshiba 2SK30ATM sheet 1997-04-10 scan p1 (read visually): IDSS 0.3-6.5, VGS(OFF) -0.4..-5.0 @10V/0.1uA; Note R 0.30-0.75, O 0.60-1.40, Y 1.20-3.0, GR 2.60-6.5 | TM title prints the same table as the 2SK30A sheet: bare TM is the same unbinned die (package-only difference), hence an alias, not an entry |
| 5 | 2SC3324 | ADD (unbinned + GR) | BF 374.1657387 (unbinned), BF 282.8427125 (GR) | Toshiba 2SC3324 2007-11-01 p1: hFE 200-700 @6V/2mA; Note GR (G) 200-400, BL (L) 350-700 | VCE(sat) MAX-only 0.3 V: no IS. BL rank unused by corpus, stays out |
| 6 | 2SA1048 | ADD (unbinned + GR) | BF 167.3320053 (unbinned), BF 282.8427125 (GR) | Toshiba 2SA1048(L) 2003-03-27 p1: hFE 70-400 @-6V/-2mA; Note O 70-140, Y 120-240, GR 200-400 | No VBE row at all: no IS. O/Y ranks unused by corpus, stay out. PNP polarity structural |
| 7 | MPQ3906 | SKIP | none | Central MPQ3906 R1 4-Dec-2012 p1 (DIP-14 quad PNP) | MIN-only hFE (40/60/75 @0.1/1/10mA, VCE=1V) is never used alone; VBE(SAT) MAX-only 0.85 V is a limit, not a range. onsemi MMPQ3906 TYP figures belong to a different part number and are not borrowed |
| 8 | 2SK879 | ADD (unbinned + Y) | Vt0 -2.7 / Beta 4.6639232e-4 (unbinned); Vt0 -2.7 / Beta 2.8806584e-4 (Y) | Toshiba 2SK879 2007-11-01 p1: IDSS 0.3-6.5, VGS(OFF) -0.4..-5.0 @10V/0.1uA; Note R/O/Y/GR (Y 1.2-3.0) | R/O/GR ranks unused by corpus, stay out |
| 9 | MMBT5089 | ADD (one entry, both orderings) | BF 692.820323 | onsemi MMBT5088LT1/D Oct 2026 Rev. 8 p2: hFE 400-1200 @100uA/5V (L); onsemi MMBT5089/D Oct-2017 Rev. 1 p2: 5089 400-1200 @100uA/5V (non-L) | DC 100 uA bin is the law's quantity (2N6428 precedent); 1mA/10mA rows MIN-only; VBE MAX-only 0.8 V: no IS |
| 10 | 2SC2459 | ADD (unbinned + GR) | BF 374.1657387 (unbinned), BF 282.8427125 (GR) | Toshiba 2SC2459 2003-03-27 p1: hFE 200-700 @6V/2mA; Note GR 200-400, BL 350-700 (matches complementary 2SA1049 sheet) | VCE(sat) MAX-only 0.3 V: no IS. BL rank unused by corpus, stays out |
| 11 | 2SK880 | ADD (unbinned + GR) | Vt0 -0.85 / Beta 1.0519031e-2 (unbinned); Vt0 -0.85 / Beta 6.2975779e-3 (GR) | Toshiba 2SK880 2014-03-01 p1: IDSS 1.2-14.0, VGS(OFF) -0.2..-1.5 @10V/0.1uA; Note Y/GR/BL (GR 2.6-6.5) | Y/BL ranks unused by corpus, stay out |
| 12 | 2N5133 | ALREADY ON MAIN, no change | BF 220 TYP (on main) | NJ Semi 2N5133 (Fairchild-process TO-106) p1: hFE MIN 60 TYP 220 MAX 1000 @1mA/5V | VBE(on) MAX-only: IS has no input (stands). No original-manufacturer sheet with more located |
| 13 | 2SC4116 | ADD (unbinned + GR) | BF 221.3594362 (unbinned), BF 282.8427125 (GR) | Toshiba 2SC4116 2007-11-01 p1 (read from rendered page; distributor watermark pollutes the text layer): hFE 70-700 @6V/2mA; Note O/Y/GR/BL (GR 200-400) | VCE(sat) TYP/MAX-only at 100 mA: no IS. O/Y/BL ranks unused by corpus, stay out |
| 14 | J113 | ADD (Vt0-only) | Vt0 -1.75; Beta stays class default (disclosed in record note) | onsemi MMBFJ113/D Mar 2023 Rev. 5 p2: VGS(off) -0.5..-3.0 @5V/1.0mA; IDSS row on the same table MIN-only 2.0 mA. Vishay Siliconix J111/112/113 sheet prints the same MIN-only IDSS row (corroborating, no better source) | MIN-only IDSS yields no Beta (form 3 needs TYP or a range) |
| 15 | KTC3198 | ADD (BL rank only) | BF 458.2575695 (KTC3198-BL) | KEC KTC3198 Rev. 3 2013-07-08: hFE(1) 70-700 @6V/2mA; Note O/Y/GR/BL (BL 300-700) | VBE(sat) MAX-only 1.0 V: no IS. Corpus names no bare part, so no unbinned entry (2SC732TM-GR precedent) |

## Spelling coverage (how checked)

`partIds` choice verified against corpus spellings observed in
`workbench/web/assets/*.js` (PartNumber/SourceValue fields) through the same
folding the compiler uses (`canonicalPartId` then `foldPartId`, per
`identify.ts`): a 46-case lookup control (`tmp/wave1/lookup-control.ts`, removed
before finishing) shows every corpus spelling below resolving to its record,
and the skipped spellings resolving to nothing. All 46 pass.

- 2SC3324, 2SC3324GR; 2SA1048, 2SA1048GR, 2SA1048-GR, 2SA-1048GR;
  2SC2459, 2SC2459GR; 2SC4116, 2SC4116GR, 2SC4116-GR, 2SC4116_GR;
  MMBT5089L, MMBT5089; KTC3198-BL; 2SK30A-O, 2SK30ATM (alias),
  2SK30ATM_Y (folds to the 2SK30ATM-Y alias), 2SK30ATM GR (folds to 2SK30ATM-GR);
  2SK879, 2SK879Y, 2SK879-Y; 2SK880, 2SK880GR, 2SK880-GR; J113;
  plus the already-shipped 2SC2458(G R/-GR/-2458GR), 2SC3378 (bare),
  2SC1815(-Y/-BL/BL/" BL"), 2SK30A(-Y/-GR, TM-Y/TM-GR incl. underscore/space
  folds), 2N5133.
- Resolving to nothing (correct): MPQ3906; 2SC3378GR, 2SC3378-GR, 2SC-3378GR.
- Rank suffixes that name a different gain bin (GR/Y/BL/O) are separate entries
  with their own midpoint, never aliases of the unbinned part. Hyphen-only
  variants that fold identically ride along in the same entry.

## Arithmetic (recomputed `python3 -I`, Vt = 0.025852 V)

sqrt(70*400) = 167.3320053; sqrt(200*400) = 282.8427125;
sqrt(200*700) = 374.1657387; sqrt(300*700) = 458.2575695;
sqrt(400*1200) = 692.820323; 1.0e-3/2.7^2 = 1.3717421e-4;
7.6e-3/0.85^2 = 1.0519031e-2; 4.55e-3/0.85^2 = 6.2975779e-3;
3.4e-3/2.7^2 = 4.6639232e-4; 2.1e-3/2.7^2 = 2.8806584e-4;
Vt0(J113) = -(0.5+3.0)/2 = -1.75 V.
Values matching already-shipped records (2SC1815, 2SK118, 2SK184/2SK209,
2SA1015-Y, 2SC2240-GR) agree to the printed digit.

## Sources fetched (all into `tmp/wave1/`, deleted at the end)

Toshiba originals: 2SA1048(L) 2003-03-27 (tayda mirror), 2SC3324 2007-11-01,
2SC2459 2003-03-27, 2SC4116 2007-11-01 (100y watermarked mirror, read from
render), 2SK879 2007-11-01, 2SK880 2014-03-01, 2SK30ATM 1997-04-10 (octopart
mirror, image-only scan, read visually) — all via third-party hosts of the
original-manufacturer sheet (admitted as `datasheet`, not `community`).
onsemi: MMBFJ113/D Mar 2023 Rev. 5, MMBT5088LT1/D Oct 2026 Rev. 8,
MMBT5089/D Oct-2017 Rev. 1. Central: MPQ3906 R1 4-Dec-2012. KEC: KTC3198
Rev. 3 2013-07-08 (chipdip mirror). Vishay Siliconix J111/J112/J113
corroborating sheet. Kexin 2SC3324 sheet seen but NOT used (second-source
manufacturer, not the Toshiba original).

## Tests

- `bun test tests/simulation.test.ts`: 3 pass, 0 fail.
- Full `bun test`: 4520 pass, 100 skip, 14 fail (8 unique: 5 console-agreement +
  release-metadata + 2 inventory). All 6 non-inventory failures reproduce on
  unchanged main (throwaway clone at 682c864): missing `wasm/v2_dsp.cjs` build
  artifact and the release pin; unrelated to this change. The 2 inventory
  failures (`wave-4 fill inventory` count/membership assertions) are the
  intended consequence of adding rows: that test asserts exact pre-wave-6
  membership and its update belongs to whoever owns the test (not edited here,
  per constraints).
- `registry-data` loader validates every record at module load: all 10 new
  entries load (per-commit LOAD-OK checks); BJT rows 52 -> 62, JFET rows
  21 -> 27.
- Lookup control: 46/46 pass (deleted with scratch).
- Not trusted here: `bun run typecheck` / builds resolve into the main
  checkout's `dist` inside this nested worktree (per brief).
