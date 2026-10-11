# Op-amp GBP: what the vendored manufacturer datasheets print

Read-only research, 2026-10-10. Datasheet root: `~/projects/VesselDSP/artifacts/parts/op-amps/<dir>/datasheets/`.
Method: `pdftotext -layout` for text, then every GBP row was confirmed by rendering the page and viewing the PNG (column placement MIN / TYP / MAX checked visually). Scans (M5218, M5223AL, NJM5534) were read from images only.
"TYP = x" means x is printed in the TYP column and MIN and MAX cells are blank (or "-" / "—" where the datasheet prints a dash). Nothing here is converted or inferred, except where a number is explicitly labelled "read from graph by eye / pixel".
"Curated" = `artifacts/parts/op-amps/<PART>.md`. "Registry" = `workbench/web/assets/registry/component-opamp-chips.json` field `gainBandwidthHz`.

## 0. Summary of disagreements (datasheet wins)

| Part | Datasheet prints | Curated record | Registry | Verdict |
|---|---|---|---|---|
| uPC4558 | no tabulated figure; graph reads ~1.5 MHz by eye | no GBP line | typ 3,000,000 | Registry 3 MHz has no support in this datasheet; the graph reads lower |
| NJM4558 | TYP 3 MHz | 3 M | typ 3 M | agree |
| RC4558 (both PDFs) | TYP 4 MHz at f = 10 kHz (Rev H, Oct 2024; Rev G printed 3 MHz) | RC4558.md 4 MHz typ (agree); **RC4558P.md "GBW: 4.5MHz" (disagrees with its own cited rc4558p-ti.pdf)** | typ 4 M | RC4558P.md is wrong vs datasheet |
| TL061/TL062 (C, I, M) | B1 TYP 1 MHz (all grades), no MIN/MAX | none | typ 1 M, **min 0.7 M, max 1.2 M** | typ agrees; min/max not printed in datasheet |
| TL071/TL072/TL082 | NS/PS packages and TL07xM/TL08xM: TYP 3 MHz. All other devices (P, D, ... C/AC/BC/I): TYP 5.25 MHz. TL07xH/TL08xH: TYP 5.25 MHz | TL072 3 M, TL082 3 M, **TL071 4 M**, each "(2.5-4)" | one entry (aliases TL071, TL082, LF351): typ 3 M, min 2.5 M, max 4 M | Curated and registry agree only with the NS/PS/M value; 4 M (TL071) and 2.5-4 range printed nowhere in datasheet; DIP/SOIC-D parts are 5.25 |
| NE5532 | §5.5 table and p1 Features: TYP 12 MHz. But §6.3.1 and §7.1.2.1 prose still say 10 MHz (same document) | 10 M | typ 10 M | Datasheet is internally inconsistent: table 12, prose 10. Curated/registry follow the prose and the pre-Rev-K value |
| LM358 / LM358N / LM358P | §5.7 (LM358, LM358A): TYP 0.7 MHz. B/BA versions (§5.5): TYP 1.2 MHz | "1.0-1.2 M" | typ 1.0 M, min 0.7 M, max 1.2 M | Plain LM358/N/P = 0.7 MHz. "1.0" is printed nowhere; 1.2 applies to B/BA only (no PDIP B orderables listed) |
| M5218 | TYP 7 MHz | 7 MHz typ | typ 7 M | agree |
| M5223 | no tabulated figure; graph ~1 MHz (VCC=15 V curve), ~2 MHz (VCC=30 V curve), by eye/pixel | "1 M approx, from gain/frequency graph" | typ 1 M | consistent with the 15 V curve; 30 V curve reads ~2x |
| TL022 | B1 TYP 0.5 MHz (TL022C and TL022M) | no GBP line | **typ 1,000,000** | **Registry is 2x the datasheet** |
| OP07 | MIN 0.4, TYP 0.6 MHz | 0.6 M typ | typ 0.6 M | agree (MIN 0.4 not recorded anywhere) |
| NE5534 / NJM5534 | TYP 10 MHz, CC = 22 pF, CL = 100 pF | 10 MHz typ | typ 10 M | agree |
| LM833 | GBW MIN 10, **TYP 16** MHz (f = 100 kHz); B1 unity-gain frequency TYP 9 MHz | "15 M (10 min)" | typ 15 M, min 10 M | typ 15 not printed in vendored TI datasheet (16 is); curated cites an onsemi PDF, not the vendored one |
| NJM4580 | TYP 15 MHz | 15 MHz typical | typ 15 M | agree |
| OPA2134 | TYP 8 MHz | 8 M typ | typ 8 M | agree |
| NJM2100 | TYP 12 MHz at f = 10 kHz, V+ = 5 V | no GBP line | **typ 10,000,000**, source: "follows the existing audio dual-op-amp class (NJM4565-style)" | **Registry differs from datasheet (10 vs 12)** |
| LM1458 | no tabulated figure, no graph | no LM1458.md (MC1458.md: 1 M) | alias of LM741 entry: typ 1 M | nothing in the datasheet to support 1 MHz |
| LM301 | no tabulated figure; Fig. 20 graph, C1 = 30 pF curve ~1 MHz by eye | no GBP line | typ 1 M | consistent with graph (C1 = 30 pF) |

## 1. uPC4558: `UPC4558/datasheets/renesas-upc258-upc4558.pdf`
- Document: "UPC258, UPC4558 Low Noise Dual Operational Amplifiers", Datasheet R03DS0145EJ0200 Rev.2.00, Feb.27.25 (9 PDF pages; footers read "Page n of 8").
- GBP row: **none**. Electrical Characteristics, PDF p3, has two tables ("UPC258, UPC4558 (TA = 25 °C, V± = ±15 V)" and "UPC258(5), UPC4558(5)"). Rows printed: VIO, IIO, IB, AV, Pd, CMR, SVR, Vom (x2), VICM, SR (1.0 V/us typ), Vn, Channel Separation. No GBW / GB / fT / B1 / unity-gain row. Features (p1) list SR and noise only.
- Graph: PDF p4 "AV vs. f" under "ELECTRICAL CHARACTERISTICS CURVE (TA = 25 °C, TYP.) (REFERENCE VALUE)", V± = ±15 V, RL = 2 kΩ. Read by eye on a 400 dpi render: LF plateau ~113 dB, corner ~7-8 Hz, curve meets 0 dB at ~1.5 MHz (between the 1M and 2M gridlines). By eye, not a printed number.
- Grade: datasheet orderables are UPC4558G2-AP (Standard) and UPC4558G2(5)-AP (DC item sorted); no "uPC4558C" or DIP suffix is printed.
- Curated `UPC4558.md`: no GBP line (lists "open-loop gain vs frequency" curve only). Registry `UPC4558` (aliases uPC4558, UPC4558C, uPC4558C, NEC4558, NEC4558C): typ 3,000,000, no source field. The registry value is not supported by this datasheet; the graph reads about half of it.

## 2. NJM4558: `NJM4558/datasheets/nisshinbo-njm4558.pdf`
- Document: "NJM4558 DUAL OPERATIONAL AMPLIFIER", date code 20250303 (footer), 4 pages. p1 header: "NJM4558L/NJM4558D is the NRND product."
- Row (PDF p2, "ELECTRICAL CHARACTERISTICS (V+/V-=±15V, Ta=25˚C)", no table number): `Gain Bandwidth Product | GB | (no test condition) | MIN - | TYP 3 | MAX - | MHz`.
- Grade: one column for NJM4558D / M / V / L / E. The only suffix split is the "-D" noise rank (printed as NJM4558D-D, M-D, L-D, E-D; catalog "NJM4558DD" corresponds), which changes the VNI row only (note 2). GB is the same for all.
- Curated `NJM4558.md`: "GBP (Hz) | 3 M" (agrees). Registry `NJM4558` (aliases NJM4558D, DD, E, L, M, V): typ 3,000,000 (agrees).

## 3. RC4558: `RC4558/datasheets/rc4558-ti.pdf` and `RC4558P/datasheets/rc4558p-ti.pdf`
- Both: "RC4558 Dual General-Purpose Operational Amplifier", SLOS073H, MARCH 1976 REVISED OCTOBER 2024, 37 pages. Text of pp1-35 is identical; the files differ only in the Package Option Addendum (dated 8-Nov-2025 vs 28-Aug-2024). So the two documents agree on GBW.
- Row (PDF p6, §5.5 Electrical Characteristics, header "For VCC+ = 15 V, VCC- = -15 V at TA ≅ 25°C, RL = 2 kΩ unless otherwise noted"): `GBW | Gain-bandwidth product | f = 10kHz | MIN (blank) | TYP 4 | MAX (blank) | MHz`. Next row: `SSBW | Small-signal bandwidth | VO = 200mVPP, <1dB peaking | TYP 3 | MHz`.
- Other printed statements: p1 Features "Gain bandwidth product: 4MHz typical"; p12 §6.3.1 "The RC4558 device has a 4MHz gain-bandwidth product." p18 revision history (Rev G Nov 2014 -> Rev H Oct 2024): "Changed unity gain-bandwidth parameter to gain-bandwidth product and changed the typical value from: 3MHz to 4MHz".
- Grade: one column for RC4558 (0-70 °C) and RC4558I (-40-85 °C); footnote (2) only affects "Full range" rows, and the GBW row has no TA split. Orderables printed: RC4558D, RC4558P, RC4558I*, RC4558PS*, RC4558PW*, etc. "RC4558C" is not printed.
- Curated: `RC4558.md` "GBP (Hz) | 4 MHz typ" (agrees). **`RC4558P.md` says "GBW: 4.5MHz" (and "Slew rate: 2V/us") and cites `datasheets/rc4558p-ti.pdf`; the PDF prints 4 MHz typ: disagrees.** Registry `RC4558` (aliases RC4558D, RC4558I, RC4558IP, RC4558P, RC4558PS, ...): typ 4,000,000 (agrees).

## 4. TL061 / TL062: `TL062/datasheets/tl062.pdf`
- Document: "TL06xx Low-Power JFET-Input Operational Amplifiers" (TL061, TL062, TL064, and A/B versions), SLOS078N, NOVEMBER 1978 REVISED AUGUST 2023, 58 pages.
- Row printed in three tables, all identical: `B1 | Unity-gain bandwidth | RL = 10 kΩ, TA = 25°C | MIN (blank) | TYP 1 | MAX (blank) | MHz`, under "VCC± = ±15 V, RL = 10 kΩ to (VCC+ + VCC-)/2 (unless otherwise noted)".
  - Table 6.7 (PDF p8), "Electrical Characteristics for TL06xC and TL06xxC": columns TL061C/TL062C/TL064C: TYP 1; TL061AC/TL062AC/TL064AC: TYP 1.
  - Table 6.8 (p9), "TL06xxC and TL06xI": TL061BC/TL062BC/TL064BC: TYP 1; TL061I/TL062I/TL064I: TYP 1.
  - Table 6.9 (p10), "TL06xM": TL061M/TL062M: TYP 1; TL064M: TYP 1. Revision history (p2): Rev N (Aug 2023) "Added typical specification for Unity-Gain Bandwidth in Electrical Characteristics for TL06xM".
- Grade for catalog ids: TL061CP / TL061CN / TL062C / TL062CP / TL062CN are C grade, Table 6.7, first column group; bare TL061 / TL062 carry no grade suffix. Every column prints 1 MHz typ, so the choice does not matter. Orderables printed include TL061CP, TL062CP, TL061CD, TL062CD.
- Curated: no `TL061.md` / `TL062.md`. Registry `TL061` (aliases TL062, TL062C, TL062CP; TL061CP, TL061CN, TL062CN are not in the alias list): typ 1,000,000 (agrees), **min 700,000, max 1,200,000 (datasheet prints no MIN or MAX)**.

## 5. TL071 / TL072: `TL072/datasheets/tl072.pdf` (byte-identical to `TL071/datasheets/tl071.pdf`, same MD5 9a1fa4b2...)
- Document: "TL07xx Low-Noise, FET-Input Operational Amplifiers" (TL071/A/B/H, TL072/A/B/H/M, TL074/A/B/H/M), SLOS080W, SEPTEMBER 1978 REVISED JULY 2025, 89 pages.
- Two different GBW rows:
  1. §5.7 "Electrical Characteristics for TL07xH" (PDF p13), header "at VS = (VCC+) - (VCC-) = 4.5 V to 40 V (±2.25 V to ±20 V), TA = 25°C, RL = 10 kΩ connected to VS / 2, VCM = VS / 2, and VOUT = VS / 2": `GBW | Gain-bandwidth product | (no test condition) | TYP 5.25 | MHz` (MIN, MAX blank). This is the new-die (H suffix) table.
  2. §5.8 "Electrical Characteristics (DC) for TL07xC, TL07xAC, TL07xBC, TL07xI, TL07xM" (PDF p15), header "at VS = (VCC+) - (VCC-) = ±15 V and TA = 25°C": `GBW | Gain-bandwidth product | All NS and PS packages; All TL07xM devices | TYP 3 | MHz`, and `... | All other devices | TYP 5.25 | MHz` (MIN, MAX blank in both).
- Printed die note, p10 §5 "Specifications": §5.7 and §5.10 describe the new die; §5.8, §5.9, §5.11 describe the old/original die. Table 9-1 (p34): y = H new die; y not H and not M: "manufactured on the legacy flow (CSO: SFAB) or the latest flow (CSO: RFB)" and §5.8 applies; y = M extended temperature, legacy flow.
- Which applies: TL071CP / TL072CP (PDIP-P), TL072CD (SOIC-D) = "All other devices" = 5.25 MHz. NS or PS packages (e.g. TL071CPS/TL072CPS, T071/T072 markings) and TL07xM = 3 MHz. TL07xH = 5.25 MHz.
- This datasheet's revision history (pp34-35) lists only Rev W and Rev V changes and does not mention a GBW change. (The TL08xx datasheet does, see §6.)
- Curated: `TL072.md` "3 M (2.5-4)", `TL071.md` "4 M (2.5-4)". Registry `TL072` (aliases LF351, TL071, TL072CP, TLO72, TL07X, TL082): typ 3,000,000, min 2,500,000, max 4,000,000. Neither the 4 M (TL071) nor the 2.5-4 range is printed in this datasheet. 3 MHz matches the NS/PS/M row only; the DIP and SOIC-D parts are printed at 5.25 MHz.

## 6. TL081 / TL082: `TL082/datasheets/tl082.pdf`
- Document: "TL08xx FET-Input Operational Amplifiers" (TL081/A/B/H, TL082/A/B/H, TL084/A/B/H), SLOS081O, FEBRUARY 1977 REVISED SEPTEMBER 2025, 78 pages.
- Row 1: §5.7 "Electrical Characteristics: TL08xH" (PDF p12), "For VS = (VCC+) - (VCC-) = 4.5 V to 40 V (±2.25 V to ±20 V) at TA = 25°C, RL = 10 kΩ connected to VS / 2, VCM = VS / 2, and Vout = VS / 2": `GBW | Gain-bandwidth product | TYP 5.25 | MHz`.
- Row 2: §5.8 "Electrical Characteristics (DC): TL08xC, TL08xAC, TL08xBC, TL08xI, TL08xM" (PDF p14), "For VS = (VCC+) - (VCC-) = ±15 V at TA = 25°C": `GBW | Gain-bandwidth product | All NS and PS packages; All TL08xM devices | TYP 3 | MHz` and `All other devices | TYP 5.25 | MHz`. MIN, MAX blank.
- Revision history (p29), Rev M (Dec 2021) -> Rev N (June 2024): "Increased gain bandwidth of all non-NS/non-PS packages and non-TL08xM devices from 3 MHz to 5.25 MHz".
- TL082CP orderable (PDIP-P) printed -> "All other devices" = 5.25 MHz. Same die-note structure as TL07x (Table 9-1, p28).
- Curated `TL082.md` "3 M (2.5-4)"; registry has no separate TL082 entry (alias of `TL072`: typ 3 M, min 2.5 M, max 4 M). Same disagreement as §5.

## 7. NE5532: `NE5532/datasheets/ne5532.pdf`
- Document: "NE5532x, SA5532x Dual Low-Noise Operational Amplifiers", SLOS075K, NOVEMBER 1979 REVISED DECEMBER 2025, 23 pages.
- Row (PDF p4, §5.5 Electrical Characteristics, "VCC± = ±15V, TA = 25°C (unless otherwise noted)"): `B1 | Unity-gain bandwidth | (no test condition) | MIN (blank) | TYP 12 | MAX (blank) | MHz`. p1 Features: "Unity-Gain Bandwidth: 12MHz Typ".
- **Same document, older text:** p6 §6.3.1 "The NE5532, NE5532A, SA5532, and SA5532A devices have a 10MHz unity-gain bandwidth." and p8 §7.1.2.1 "Since the NE5532 has a bandwidth of 10MHz ...". Revision history p11, Rev J (Jan 2015) -> Rev K (Dec 2025): "Changed Unity-gain bandwidth from 10MHz to 12MHz typ" (p1) and "Changed Unity gain bandwidth from 10MHz to 12MHz" (p4). The prose in §6.3.1 / §7.1.2.1 was not updated.
- Grade: one value for NE5532, NE5532A, SA5532, SA5532A (§5.6 has NE5532/NE5532A column pairs but no GBW row). NE5532P, NE5532D, NE5532AP are printed orderables.
- Curated `NE5532.md` "GBP (Hz) | 10 M" (disagrees with the table; says the TI datasheet was revised in 2024, whereas the vendored copy is Rev K, Dec 2025). Registry `NE5532`: typ 10,000,000 (same).

## 8. LM358: `LM358/datasheets/lm358-ti.pdf`
- Document: "Industry-Standard Dual Operational Amplifiers" (LM158/A, LM258/A, LM2904/B/BA/V, LM358/A/B/BA), SLOS068AB, JUNE 1976 REVISED OCTOBER 2024, 68 pages.
- Rows (all "GBW | Gain bandwidth product | (no test condition) | TYP ... | MHz", MIN and MAX blank):
  - §5.5 LM358B and LM358BA (PDF p6), "VS = 5 V - 36 V (±2.5 V - ±18 V), TA = 25°C, VCM = VOUT = VS/2, RL = 10k connected to VS/2": **TYP 1.2**.
  - §5.6 LM2904B and LM2904BA (p8): TYP 1.2.
  - §5.7 **LM358, LM358A** (p10), "For VS = (V+) - (V-) = 5 V, TA = 25°C": **TYP 0.7**.
  - §5.8 LM2904, LM2904V (p11): 0.7. §5.9 LM158, LM158A (p12): 0.7. §5.10 LM258, LM258A (p14): 0.7.
  - p1 "Family Comparison": "Gain bandwidth product" 1.2 (LM358B/BA, LM2904B/BA) and 0.7 (LM358/A, LM2904/V, LM258/A, LM158/A) MHz. p1 Features: "Unity-gain bandwidth of 1.2MHz (B, BA versions)". p26 §7.3.1: "These devices have a 1.2-MHz unity-gain bandwidth (B Version)". p31 revision history: "Changed unity-gain bandwidth from 0.7 MHz for all devices to 1.2 MHz for B-version devices".
- Which applies to catalog ids: orderables LM358P and LM358AP (PDIP, 0 to 70 °C) are printed; the LM358B / BA orderables printed are only D, DDF, DGK, PW packages (no PDIP). So LM358, LM358N, LM358P -> §5.7, TYP 0.7 MHz. B / BA versions are 1.2 MHz.
- Curated `LM358.md` "GBP (Hz) | 1.0-1.2 M" (1.0 appears nowhere in the datasheet; 1.2 is B-version only; plain LM358 is 0.7: disagrees). Registry `LM358` (alias LMV358): typ 1,000,000, min 700,000, max 1,200,000 (0.7 and 1.2 are each printed as TYP for different grades; 1.0 typ and the MIN/MAX framing are not printed).

## 9. M5218: `5218/datasheets/mitsubishi-m5218.pdf` and `mitsubishi-m5218p-retroamplis.pdf`
- Both are the same 5-page Mitsubishi sheet: "MITSUBISHI (AV COMMON) M5218AL/P/FP, DUAL LOW-NOISE OPERATIONAL AMPLIFIERS (DUAL POWER SUPPLY TYPE)", folios 2-467 ... 2-471. No document number or revision date printed. `mitsubishi-m5218.pdf` (DatasheetArchive copy, 6 pp) is image-only; its p6 is the 8P2S-A package outline ("Mar.'98"). The retroamplis copy has an OCR text layer; its page images show the same content. All reading below was done from the rendered images.
- Row: ELECTRICAL CHARACTERISTICS (Ta=25°C, Vcc=±15V), PDF p2 (folio 2-468): `fT | Gain bandwidth product | (no test condition) | MIN (blank) | TYP 7 | MAX (blank) | MHz`. p1 Features: "High slew rate, high fT ... SR=3.0V/µs, fT=7MHz(typ.)".
- Grade: one column for M5218AL (SIP), M5218AP (DIP), M5218AFP (flat). The catalog spelling "M5218L" (no "A") is not printed. The p2 graph "VOLTAGE GAIN VS. FREQUENCY RESPONSE" (Vcc=15V, RL=2kΩ) is also printed.
- **M5216 / M5281: do not appear in either M5218 PDF** (only "M5218", "M5R4558P", "4557, 4558, 4559 and 741" are named) nor in any curated record. Registry has `M5216` and `M5281` (typ 1,000,000, source field: "Aligned with the existing M5223AL slow op-amp runtime envelope."), so those two have no datasheet evidence at all.
- Curated `5218.md` and `M5218AL.md`: "7 MHz typ" (agree). Registry `M5218`: typ 7,000,000 (agrees).

## 10. M5223: `M5223AL/datasheets/m5223al-page-1..5.png` (108-ppi scans)
- Document: "MITSUBISHI ICs (AV COMMON) M5223L/P/FP, DUAL SINGLE POWER SUPPLY OPERATIONAL AMPLIFIERS", folios 2-475 ... 2-479. No document number or date printed. (Directory is named M5223AL; the sheet is titled M5223L/P/FP. Package labels: SIP outline 8P5 (L), DIP 8P4 (P), 8P2S-A (FP).)
- GBP row: **none**. ELECTRICAL CHARACTERISTICS (Ta=25°C, Vcc=+5V), page 2 (folio 2-476), rows: Icc, Vio, Iio, Iib, CSR, Gvo (RL≥2kΩ, VCM=7.5V; MIN 90, TYP 100 dB), Vom (VOH/VOL), VCM, CMRR, SVRR, Pd, SR (Gv=0dB, RL=2kΩ), Isource, Isink. No fT / GB / unity-gain row. Features (p1) list none.
- Graph, page 2 "VOLTAGE GAIN VS. FREQUENCY RESPONSE" (inset: 10 MΩ feedback, bias VCC/2; two curves labelled VCC=15V and VCC=30V; both with ~100 dB LF plateau). Pixel measurement on the scan (-20 dB/decade lines extrapolated to the 0 dB axis): VCC=15 V curve reaches 0 dB at ~1 MHz (on the 1M gridline); VCC=30 V curve at ~2 MHz (~0.3 decade right of 1M). Accuracy about ±0.1 decade. By eye, not a printed number.
- Curated `M5223AL.md`: "1 M approx, from gain/frequency graph" (matches the 15 V curve; does not mention the 30 V curve). Registry `M5223AL` (alias M5223L): typ 1,000,000. (Side note, not GBW: the curated record says SR 0.5 typ; the scanned SR digit is ambiguous (0.5 or 0.6).)

## 11. TL022: `TL022/datasheets/ti-tl022.pdf`
- Document: "TL022C, TL022M DUAL LOW-POWER OPERATIONAL AMPLIFIERS", SLOS076, SEPTEMBER 1973 REVISED SEPTEMBER 1990, 16 pages. "TL022M IS NOT RECOMMENDED FOR NEW DESIGNS".
- Row (PDF p3, "electrical characteristics at specified free-air temperature, VCC± = ±15 V (unless otherwise noted)"; no table number): `B1 | Unity-gain bandwidth | (no test condition) | TA = 25°C | TL022C: MIN (blank) TYP 0.5 MAX (blank) | TL022M: MIN (blank) TYP 0.5 MAX (blank) | MHz`.
- Grade: catalog TL022C / CP / CD / CN -> TL022C column (full range 0-70 °C), TYP 0.5 MHz at 25 °C. TL022M column is also 0.5.
- Curated `TL022.md`: no GBP line (gives SR 0.5 V/us etc.). Registry `TL022` (aliases IR9022, TL022CP): **typ 1,000,000 vs datasheet 0.5 MHz typ.** (IR9022 is not covered by this datasheet.)

## 12. OP07: `OP07/datasheets/op07-ti.pdf`
- Document: "OP07, OP07C, OP07D / OP07x Precision Operational Amplifiers", SLOS099H, SEPTEMBER 1983 REVISED MARCH 2023, 22 pages.
- Row (PDF p6, §6.5 "Electrical Characteristics (continued)", header on p5/p6: "at TA = 25°C, VS = ±15 V, RL = 2 kΩ connected to mid-supply, and VCM = VOUT = mid-supply (unless otherwise noted)(1)"), section "FREQUENCY RESPONSE": `(no symbol printed) | Unity gain bandwidth | (no test condition) | MIN 0.4 | TYP 0.6 | MAX (blank) | MHz`.
- Grade: footnote (1): "The specifications listed in the Electrical Characteristics apply to OP07C and OP07D." One set of values, no per-grade column. OP07CP, OP07DP orderables are printed (OP07DN not seen in the orderable list; bare "OP07" is not given an electrical column; front matter refers readers to the addendum "for all available packages and the OP07").
- Curated `OP07.md` "0.6 M typ" (agrees; MIN 0.4 not recorded). Registry `OP07` typ 600,000 (agrees).

## 13. NE5534 / NJM5534: `NJM5534D/datasheets/NE5534_TI.pdf` and `njrc-njm5534d-page-1..6.png`
- TI: "NE5534x, SA5534x Low-Noise Operational Amplifiers" (NE5534, NE5534A, SA5534, SA5534A), SLOS070D, JULY 1979 REVISED NOVEMBER 2014, 27 pages. Row (PDF p5, §7.5 Electrical Characteristics, "VCC± = ±15 V, TA = 25°C (unless otherwise noted)"): `B1 | Unity-gain bandwidth | CC = 22 pF, CL = 100 pF | MIN (blank) | TYP 10 | MAX (blank) | MHz`. Same single column for all four grades. p1 Features "Unity-Gain Bandwidth 10 MHz Typ"; p10 §8.3.4 "10-MHz unity-gain bandwidth"; §8.3.5 "Frequency compensation with a capacitor may be used to increase the gain-bandwidth product (GBW)". p1: "compensated internally for a gain equal to or greater than three". NE5534P and NE5534D are printed orderables.
- NJRC scan: "NJM5534 HIGH PERFORMANCE LOW-NOISE OPERATIONAL AMPLIFIER", New Japan Radio Co., Ltd., folios 4-235 ... 4-239; no document number or date printed. Electrical Characteristics (Ta=25°C, V+/V-=±15V), page 2 (folio 4-236): `Gain Bandwidth Product | GB | CC=22pF, CL=100pF | MIN — | TYP 10 | MAX — | MHz`. Digits read from a 108-ppi scan; "10" is legible but degraded (same row text and the same conditions as TI). Note under table: "JRC's general selected products D rank are also prepared for the noise standard (RS=2.2kΩ, RIAA, VNI=1.4µV Max.)", so the D rank affects noise only. Package labels on p1: NJM5534D (DIP8), NJM5534M (DMP8). p1 Features list "Power Bandwidth (200kHz typ.)" but no GBW.
- Curated `NJM5534.md` "10 MHz typ" (agrees). Registry `NJM5534` (aliases NE5534, NJM5534D): typ 10,000,000 (agrees).

## 14. Extra parts
- **LM833**, `LM833/datasheets/lm833-ti.pdf`: "LM833 Dual High-Speed Audio Operational Amplifier", SLOS481B, JULY 2010 REVISED OCTOBER 2014. §7.6 Operating Characteristics (PDF p5), "VCC- = -15 V, VCC+ = 15 V, TA = 25°C": `GBW | Gain bandwidth product | f = 100 kHz | MIN 10 | TYP 16 | MAX (blank) | MHz`; `B1 | Unity gain frequency | Open loop | TYP 9 | MHz`. p1 Features "High-Gain Bandwidth Product: 16 MHz"; p14 §8.3.2 "The LM833 has a high gain bandwidth of 16 MHz". Curated `LM833.md` "15 M (10 min)" (typ differs: 16 printed; MIN 10 agrees; curated source is an onsemi URL, not the vendored TI file). Registry `LM833`: typ 15,000,000, min 10,000,000 (same typ difference).
- **NJM4580** (`JRC4580/datasheets/njm4580d-njr.pdf`): "NJM4580 DUAL OPERATIONAL AMPLIFIER", Ver.2012-09-14. p1 Features "Wide GBW 15MHz typ."; p2 "ELECTRICAL CHARACTERISTICS (V+/V-=±15V, Ta=25˚C)": `Gain Bandwidth Product | GB | f=10kHz | MIN - | TYP 15 | MAX - | MHz`. D-rank table changes only VNI (1.4 µVrms max). Curated `JRC4580.md` "15 MHz typical" (agrees). Registry `JRC4580D` (many NJM4580x aliases): typ 15,000,000 (agrees).
- **OPA2134** (`OPA2134/datasheets/opa2134-ti.pdf`): "OPA134, OPA2134, OPA4134 OPAx134 High-Performance, SoundPlus Audio Operational Amplifiers", SBOS058B, DECEMBER 1997 REVISED NOVEMBER 2024. §5.7 Electrical Characteristics (PDF p7), "at TA = 25°C, VS = ±15V, RL = 2kΩ connected to midsupply, and VCM = VOUT = midsupply": `GBW | Gain bandwidth product | (no test condition) | TYP 8 | MHz` (MIN, MAX blank). p1 Features "Bandwidth: 8MHz". Curated `OPA2134.md` "8 M typ" (agrees). Registry `OPA2134`: typ 8,000,000 (agrees).
- **NJM2100** (`2100/datasheets/njm2100-nisshinbo.pdf`): "NJM2100 DUAL OPERATIONAL AMPLIFIER", Ver.20250303 ("NJM2100D/NJM2100L is the NRND products"). p2 "ELECTRICAL CHARACTERISTICS (Ta=25˚C, V+=5V)": `Gain Bandwidth Product | GB | f=10kHz | MIN - | TYP 12 | MAX - | MHz`. Printed notes: (Note1) "Applied circuit voltage gain is desired to operate within the range of 3dB to 30 dB."; (Note3) oscillation caution above 5 V. Curated `NJM2100M.md`: no GBP line. Registry `NJM2100` (alias NJM2100M): typ 10,000,000, source "Runtime envelope follows the existing supported audio dual-op-amp class used for NJM4565-style support stages." **Disagrees with the datasheet's 12 MHz typ.**
- **LM1458** (`LM1458/datasheets/lm1458.pdf`): "LM1458/LM1558 Dual Operational Amplifier", SNOSBU4D, APRIL 1998 REVISED MARCH 2013. **No tabulated GBW and no graph:** the document has only features, absolute maximum ratings, Electrical Characteristics (pp2-3), schematic, then package pages. Curated: no `LM1458.md` (`MC1458.md` says "GBP 1 M, same SR/GBP/A_OL as LM741"). Registry: LM1458 is an alias of the `LM741` entry (typ 1,000,000). Nothing in the vendored datasheet supports a number.
- **LM301** (`LM301/datasheets/lm301-lm101a-n.pdf`): "LM101A/LM201A/LM301A Operational Amplifiers", SNOSBS0D, SEPTEMBER 1999 REVISED MARCH 2013. **No tabulated GBW.** Electrical Characteristics (p3) footnote: "these specifications apply for C1 = 30 pF". Graphs: p8 Fig. 20 "Open Loop Frequency Response", Single Pole, TA = 25°C, VS = ±15 V: the C1 = 30 pF curve meets 0 dB at ~1 MHz by eye; the C1 = 3 pF curve is plotted only down to ~10 dB at ~2 MHz (no 0 dB crossing within the plot). Fig. 21 (two-pole, C1 = 30 pF, C2 = 300 pF) and Fig. 22 (feedforward) are also open-loop plots. Other printed numbers that are application figures, not device specs: p13 Fig. 40 "Fast Summing Amplifier: Power Bandwidth 250 kHz, Small Signal Bandwidth 3.5 MHz, Slew Rate 10V/µs"; p8 Fig. 19 "fo = 3 MHz" (design frequency for the C2 formula). Curated `LM301.md`: no GBP line (lists 30 pF compensation, 1 V/us). Registry `LM301` (aliases LM101A, LM201A, LM301A): typ 1,000,000 (consistent with the 30 pF curve read by eye).

## 15. Ids with no vendored datasheet
"no vendored datasheet": CA1458, BA718, LM741, UA741, LF353, TA7504S, MC33178, AD712, LF412 (confirmed: no matching directory or file under `parts/op-amps/*/datasheets/`).
Secondary values only (not datasheet evidence):
| id | curated record | registry |
|---|---|---|
| CA1458 | no record | `CA1458` typ 900,000, source "Intersil CA1458 datasheet description: 0.9MHz ..." |
| BA718 | no record | `BA718` typ 1,000,000 |
| LM741 | `LM741.md` "GBP (Hz) 1 M" | `LM741` typ 1,000,000 |
| UA741 | no record | alias of `LM741` entry: typ 1,000,000 |
| LF353 | no record | no entry (LF351 is an alias of `TL072`) |
| TA7504S | no record | no entry (`TA75558` exists separately: typ 3,000,000) |
| MC33178 | no record | `MC33178` typ 5,000,000, min 2,500,000, source "onsemi MC33178/9 datasheet ... 2.5 MHz minimum and 5.0 MHz typical" |
| AD712 | `AD712.md` "30 M" | `AD712` typ 30,000,000 |
| LF412 | `LF412.md` "19 M" | `LF412` typ 19,000,000 |
