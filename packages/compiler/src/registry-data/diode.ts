// Diode registry data: wave-3 manufacturer-model fill.
//
// One value per parameter; a parameter with no allowed-source citation is not loadable,
// so it is omitted here and the stamp gap-fills the class default (never a guess):
//
// - `saturationCurrent` + `emissionCoefficient`: transcribed from the manufacturer's own
//   SPICE/PSpice model card (`basis: "manufacturer-model"`), IS and N as printed.
// - `seriesResistance`: the card's ohmic RS, which is the quantity the engine's diode
//   law stamps (unlike the dynamic impedance at breakdown, which is never mapped).
// - `thermalVoltage`: omitted throughout (kT/q at room temperature, not a per-part
//   figure); the stamp keeps 0.025852 V.
// - `breakdownVolts`: omitted throughout (the stamp keeps the no-knee 0; a knee belongs
//   to class `zener` and the existing `zenerLaw` path, not here). CJO/M/VJ/TT/BV/IBV
//   have no schema field and are never mapped.
//
// Wave-1/2 verdict (empty by verdict, not by omission) is superseded for the eleven
// parts below plus 1N914: every entry was read from a manufacturer-published model file
// in this run. No entry is derived from a datasheet here (form 4 needs two printed
// typical (If, Vf) points and never met). Typed aliases: none -- a `DI_` model-name
// prefix is not an equivalence claim, and no file below states one.
//
// MEASURED FUTURE (no entries yet): the `measured` basis in `loader.ts` is for the
// residue -- generic LED colour defaults and the diodes with no manufacturer model
// (1N4148, 1N34A, 1N60P, D9E, D9K, BAT85S). Each measured IS+n will cite the
// committed measurement JSON (schema `vesseldsp.junction-default-measurement.v1`,
// `perDevice` `isEngine`/`nEngine` pooled over every sample at the engine VT 0.025852 V)
// with instrument, conditions, sample count, date, repo-relative path and sha256; see
// `led-measurement.html` and its README. The owner has not measured yet.
//
// Plausibility disclosures (transcribed as printed, not fitted): 1N5817 IS 870 uA lands
// the 1 mA Vf at ~7 mV (a high-current fit, weak at low current); BAT43 N 4.995 lands
// the 1 mA Vf at ~95 mV; B340A N 0.775 is below unity. The loader checks shape and
// provenance, never plausibility; the Vf table in the wave-3 report shows each model.

// Wave-4 community fill (provisional `community` basis, decided 2026-10-19 option B)
// plus the DEC-sheet 1N60/1N60P datasheet pair found during the wave-4 search.
//
// A `community` value is one published sample, not a measurement of the part: the
// compiler names every device that runs on one (`registry-provisional-value`), and
// adding a datasheet, manufacturer-model or measured record for the same parameter of
// the same part throws until the community record is removed. An original-manufacturer
// datasheet hosted on a third-party site is still `datasheet` (the DEC sheet below).

import { definePartData, type PartDataEntry } from "./loader";

const ST_BAT46_PAGE = "https://www.st.com/en/diodes-and-rectifiers/bat46.html";
const ST_ZIP_CAUTION =
	"Owner download /home/joseph/projects/VesselDSP/tmp/st_signal_schottky_diodes_pspice_models_v4.zip " +
	"sha256 5b256603d6d12fa9957aa6d149d3762e2fd623eff37a50aa67a4fb4499e6f197, inner file " +
	"ST_SIGNAL_SCHOTTKY_V8.LIB header 'Revision 8.0, DEC 2021' (CRLF; `.MODEL` lines continue on `+` lines). " +
	"The same zip is listed on the BAT41 product page (https://www.st.com/en/diodes-and-rectifiers/bat41.html).";
const DIODES_SPICE_INDEX = "https://www.diodes.com/design/tools/spice-models";
const DIODES_BUNDLE_CAUTION =
	"Owner download /home/joseph/projects/VesselDSP/tmp/Schottky (.5A and Above).spice.txt " +
	"sha256 648628e3ed53cfcda631fee8cdc3a49de0d85be99962a3e6e6fc0c3aff57d493.";

const NEXPERIA_BAT85_PAGE =
	"https://www.nexperia.com/products/diodes/schottky-diodes-and-rectifiers/schottky-diodes-and-rectifiers-if-lt-1-a/BAT85.html";
const NEXPERIA_BAT85_FILE = "https://assets.nexperia.com/documents/spice-model/BAT85.txt";
// The card as the owner pasted it (the Nexperia server refuses scripted downloads), with the
// trailing blanks after each `+ ` line removed.
const NEXPERIA_BAT85_LINE =
	".MODEL BAT85 D\n+ IS = 2.076E-7\n+ N = 1.023\n+ BV = 33\n+ IBV = 10E-6\n+ RS = 2.326\n" +
	"+ CJO = 1.21E-11\n+ VJ = 0.1319\n+ M = 0.2904\n+ EG = 0.69\n+ XTI = 2";
const NEXPERIA_BAT85_CAUTION =
	"Owner-pasted copy of the Nexperia model file saved at " +
	"/home/joseph/projects/VesselDSP/tmp/nexperia-BAT85-spice-model-owner-paste-2026-10-20.txt " +
	"sha256 77d17ba226543aacb38c338d9f59b675030ebb3a3447969a43edccbdc783b887 (file header " +
	"'BAT85 / Nexperia / Schottky barrier diode, IFmax 200mA, VRmax 30V, VFmax 400mV @ IF 10mA, " +
	"IRmax 2uA @ VR 25V', package SOD68, simulator SPICE2). The `.SUBCKT BAT85 1 2` wraps the diode " +
	"with `R1 1 2 5.416E+7`, which the card says 'does not reflect physical devices' and is a " +
	"reverse-mode aid; it is not mapped, nor are BV/IBV/CJO/VJ/M/EG/XTI.";

const BAT85S_WHY_NO_BETTER_SOURCE =
	"Vishay publishes no SPICE model for the BAT85S (its datasheet, document 85513 Rev. 2.2 " +
	"07-Nov-2024, sha256 0152851a68f60cce52ba39846c00860c71ebfdf878b89a893255abc6d55ce050, lists " +
	"3D models, marking, parametric search and order samples only) and prints MAX-only forward " +
	"voltages (240 mV at 0.1 mA, 320 at 1, 400 at 10, 500 at 30, 800 at 100), so no two-typical " +
	"form-4 pair exists. No document found states that the BAT85S is the Nexperia BAT85; what is " +
	"shared is the printed limits (VR 30 V, IF 200 mA, VF max 400 mV at 10 mA, IR max 2 uA at " +
	"25 V). Provisional on that basis, and checked only against the Vishay maxima.";

export const diodeRegistryRecords: readonly PartDataEntry[] = definePartData([
	{
		// ST small-signal Schottky, DO-35 (exact part id; the Minimelf/SOD-323/SOD-523/
		// SOD-123 FILM lines in the same file are package variants, not registered).
		partIds: ["BAT41"],
		class: "diode",
		params: {
			saturationCurrent: {
				value: 10e-9,
				basis: "manufacturer-model",
				source:
					`ST product page ${ST_BAT46_PAGE}. ` +
					`${ST_ZIP_CAUTION} DO-35 card:\n` +
					".MODEL BAT41 D\n+ IS=10.000E-9 N=1.4402 RS=.12219 IKF=291.59E-6 EG=.69 CJO=3.5613E-12\n+ M=.49981 VJ=.36559 ISR=2.0076E-9 FC=0.5 NR=4.9950 TT=0  XTI=2",
				modelFileUrl: ST_BAT46_PAGE,
				modelLine:
					".MODEL BAT41 D\n+ IS=10.000E-9 N=1.4402 RS=.12219 IKF=291.59E-6 EG=.69 CJO=3.5613E-12\n+ M=.49981 VJ=.36559 ISR=2.0076E-9 FC=0.5 NR=4.9950 TT=0  XTI=2",
			},
			emissionCoefficient: {
				value: 1.4402,
				basis: "manufacturer-model",
				source:
					`ST product page ${ST_BAT46_PAGE}. ` +
					`${ST_ZIP_CAUTION} DO-35 card:\n` +
					".MODEL BAT41 D\n+ IS=10.000E-9 N=1.4402 RS=.12219 IKF=291.59E-6 EG=.69 CJO=3.5613E-12\n+ M=.49981 VJ=.36559 ISR=2.0076E-9 FC=0.5 NR=4.9950 TT=0  XTI=2",
				modelFileUrl: ST_BAT46_PAGE,
				modelLine:
					".MODEL BAT41 D\n+ IS=10.000E-9 N=1.4402 RS=.12219 IKF=291.59E-6 EG=.69 CJO=3.5613E-12\n+ M=.49981 VJ=.36559 ISR=2.0076E-9 FC=0.5 NR=4.9950 TT=0  XTI=2",
			},
			seriesResistance: {
				value: 0.12219,
				basis: "manufacturer-model",
				source:
					`ST product page ${ST_BAT46_PAGE}. ` +
					`${ST_ZIP_CAUTION} DO-35 card:\n` +
					".MODEL BAT41 D\n+ IS=10.000E-9 N=1.4402 RS=.12219 IKF=291.59E-6 EG=.69 CJO=3.5613E-12\n+ M=.49981 VJ=.36559 ISR=2.0076E-9 FC=0.5 NR=4.9950 TT=0  XTI=2",
				modelFileUrl: ST_BAT46_PAGE,
				modelLine:
					".MODEL BAT41 D\n+ IS=10.000E-9 N=1.4402 RS=.12219 IKF=291.59E-6 EG=.69 CJO=3.5613E-12\n+ M=.49981 VJ=.36559 ISR=2.0076E-9 FC=0.5 NR=4.9950 TT=0  XTI=2",
			},
		},
	},
	{
		// ST small-signal Schottky, DO-35.
		partIds: ["BAT46"],
		class: "diode",
		params: {
			saturationCurrent: {
				value: 15.896e-6,
				basis: "manufacturer-model",
				source:
					`ST product page ${ST_BAT46_PAGE}. ` +
					`${ST_ZIP_CAUTION} DO-35 card:\n` +
					".MODEL BAT46 D\n+ IS=15.896E-6 N=2.3964 RS=7.7928E-3 IKF=5.4695E-3 EG=.69 CJO=11.684E-12\n+ M=.5 VJ=.36094 ISR=10.010E-21 FC=0.5 NR=4.9950 TT=0 XTI=2",
				modelFileUrl: ST_BAT46_PAGE,
				modelLine:
					".MODEL BAT46 D\n+ IS=15.896E-6 N=2.3964 RS=7.7928E-3 IKF=5.4695E-3 EG=.69 CJO=11.684E-12\n+ M=.5 VJ=.36094 ISR=10.010E-21 FC=0.5 NR=4.9950 TT=0 XTI=2",
			},
			emissionCoefficient: {
				value: 2.3964,
				basis: "manufacturer-model",
				source:
					`ST product page ${ST_BAT46_PAGE}. ` +
					`${ST_ZIP_CAUTION} DO-35 card:\n` +
					".MODEL BAT46 D\n+ IS=15.896E-6 N=2.3964 RS=7.7928E-3 IKF=5.4695E-3 EG=.69 CJO=11.684E-12\n+ M=.5 VJ=.36094 ISR=10.010E-21 FC=0.5 NR=4.9950 TT=0 XTI=2",
				modelFileUrl: ST_BAT46_PAGE,
				modelLine:
					".MODEL BAT46 D\n+ IS=15.896E-6 N=2.3964 RS=7.7928E-3 IKF=5.4695E-3 EG=.69 CJO=11.684E-12\n+ M=.5 VJ=.36094 ISR=10.010E-21 FC=0.5 NR=4.9950 TT=0 XTI=2",
			},
			seriesResistance: {
				value: 7.7928e-3,
				basis: "manufacturer-model",
				source:
					`ST product page ${ST_BAT46_PAGE}. ` +
					`${ST_ZIP_CAUTION} DO-35 card:\n` +
					".MODEL BAT46 D\n+ IS=15.896E-6 N=2.3964 RS=7.7928E-3 IKF=5.4695E-3 EG=.69 CJO=11.684E-12\n+ M=.5 VJ=.36094 ISR=10.010E-21 FC=0.5 NR=4.9950 TT=0 XTI=2",
				modelFileUrl: ST_BAT46_PAGE,
				modelLine:
					".MODEL BAT46 D\n+ IS=15.896E-6 N=2.3964 RS=7.7928E-3 IKF=5.4695E-3 EG=.69 CJO=11.684E-12\n+ M=.5 VJ=.36094 ISR=10.010E-21 FC=0.5 NR=4.9950 TT=0 XTI=2",
			},
		},
	},
	{
		// ST small-signal Schottky, DO35. N 4.995 is the printed fit value (see module note).
		partIds: ["BAT43"],
		class: "diode",
		params: {
			saturationCurrent: {
				value: 480.77e-6,
				basis: "manufacturer-model",
				source:
					`ST product page ${ST_BAT46_PAGE}. ` +
					`${ST_ZIP_CAUTION} DO35 card:\n` +
					".MODEL BAT43 D IS=480.77E-6 N=4.9950 RS=40.150E-3 IKF=20.507\n+ EG=.69 XTI=2 CJO=13.698E-12 M=.50005 VJ=.38464 ISR=10.010E-21\n+ FC=0.5 NR=4.9950 TT=0",
				modelFileUrl: ST_BAT46_PAGE,
				modelLine:
					".MODEL BAT43 D IS=480.77E-6 N=4.9950 RS=40.150E-3 IKF=20.507\n+ EG=.69 XTI=2 CJO=13.698E-12 M=.50005 VJ=.38464 ISR=10.010E-21\n+ FC=0.5 NR=4.9950 TT=0",
			},
			emissionCoefficient: {
				value: 4.995,
				basis: "manufacturer-model",
				source:
					`ST product page ${ST_BAT46_PAGE}. ` +
					`${ST_ZIP_CAUTION} DO35 card:\n` +
					".MODEL BAT43 D IS=480.77E-6 N=4.9950 RS=40.150E-3 IKF=20.507\n+ EG=.69 XTI=2 CJO=13.698E-12 M=.50005 VJ=.38464 ISR=10.010E-21\n+ FC=0.5 NR=4.9950 TT=0",
				modelFileUrl: ST_BAT46_PAGE,
				modelLine:
					".MODEL BAT43 D IS=480.77E-6 N=4.9950 RS=40.150E-3 IKF=20.507\n+ EG=.69 XTI=2 CJO=13.698E-12 M=.50005 VJ=.38464 ISR=10.010E-21\n+ FC=0.5 NR=4.9950 TT=0",
			},
			seriesResistance: {
				value: 40.15e-3,
				basis: "manufacturer-model",
				source:
					`ST product page ${ST_BAT46_PAGE}. ` +
					`${ST_ZIP_CAUTION} DO35 card:\n` +
					".MODEL BAT43 D IS=480.77E-6 N=4.9950 RS=40.150E-3 IKF=20.507\n+ EG=.69 XTI=2 CJO=13.698E-12 M=.50005 VJ=.38464 ISR=10.010E-21\n+ FC=0.5 NR=4.9950 TT=0",
				modelFileUrl: ST_BAT46_PAGE,
				modelLine:
					".MODEL BAT43 D IS=480.77E-6 N=4.9950 RS=40.150E-3 IKF=20.507\n+ EG=.69 XTI=2 CJO=13.698E-12 M=.50005 VJ=.38464 ISR=10.010E-21\n+ FC=0.5 NR=4.9950 TT=0",
			},
		},
	},
	{
		// ST small-signal Schottky, DO35.
		partIds: ["BAT48"],
		class: "diode",
		params: {
			saturationCurrent: {
				value: 263.91e-9,
				basis: "manufacturer-model",
				source:
					`ST product page ${ST_BAT46_PAGE}. ` +
					`${ST_ZIP_CAUTION} DO35 card:\n` +
					".MODEL BAT48 D IS=263.91E-9 N=1.0966 RS=.4109 IKF=29.589E-3\n+ EG=.69 XTI=2 CJO=29.800E-12 M=.50094 VJ=.41054 ISR=90.294E-9\n+ FC=0.5 NR=4.9949 TT=0",
				modelFileUrl: ST_BAT46_PAGE,
				modelLine:
					".MODEL BAT48 D IS=263.91E-9 N=1.0966 RS=.4109 IKF=29.589E-3\n+ EG=.69 XTI=2 CJO=29.800E-12 M=.50094 VJ=.41054 ISR=90.294E-9\n+ FC=0.5 NR=4.9949 TT=0",
			},
			emissionCoefficient: {
				value: 1.0966,
				basis: "manufacturer-model",
				source:
					`ST product page ${ST_BAT46_PAGE}. ` +
					`${ST_ZIP_CAUTION} DO35 card:\n` +
					".MODEL BAT48 D IS=263.91E-9 N=1.0966 RS=.4109 IKF=29.589E-3\n+ EG=.69 XTI=2 CJO=29.800E-12 M=.50094 VJ=.41054 ISR=90.294E-9\n+ FC=0.5 NR=4.9949 TT=0",
				modelFileUrl: ST_BAT46_PAGE,
				modelLine:
					".MODEL BAT48 D IS=263.91E-9 N=1.0966 RS=.4109 IKF=29.589E-3\n+ EG=.69 XTI=2 CJO=29.800E-12 M=.50094 VJ=.41054 ISR=90.294E-9\n+ FC=0.5 NR=4.9949 TT=0",
			},
			seriesResistance: {
				value: 0.4109,
				basis: "manufacturer-model",
				source:
					`ST product page ${ST_BAT46_PAGE}. ` +
					`${ST_ZIP_CAUTION} DO35 card:\n` +
					".MODEL BAT48 D IS=263.91E-9 N=1.0966 RS=.4109 IKF=29.589E-3\n+ EG=.69 XTI=2 CJO=29.800E-12 M=.50094 VJ=.41054 ISR=90.294E-9\n+ FC=0.5 NR=4.9949 TT=0",
				modelFileUrl: ST_BAT46_PAGE,
				modelLine:
					".MODEL BAT48 D IS=263.91E-9 N=1.0966 RS=.4109 IKF=29.589E-3\n+ EG=.69 XTI=2 CJO=29.800E-12 M=.50094 VJ=.41054 ISR=90.294E-9\n+ FC=0.5 NR=4.9949 TT=0",
			},
		},
	},
	{
		// Diodes Inc Schottky barrier rectifier. The bundle copy is identical to the
		// single file; the exact-part single file is cited.
		partIds: ["1N5817"],
		class: "diode",
		params: {
			saturationCurrent: {
				value: 870e-6,
				basis: "manufacturer-model",
				source:
					"Manufacturer model file https://www.diodes.com/spice/download/270/1N5817.spice.txt " +
					"(Diodes Inc 1N5817.spice.txt, MANIFEST sha256 " +
					"98e1fc5c0bfe70520852736011a4066e903c037497363da1b2a60d6b0fb4ca33, " +
					"identical card in the owner bundle Schottky (.5A and Above).spice.txt). Card lines:\n" +
					".MODEL DI_1N5817 D  ( IS=870u RS=81.3m BV=20.0 IBV=1.00m\n+ CJO=203p  M=0.333 N=1.81 TT=4.32u )",
				modelFileUrl: "https://www.diodes.com/spice/download/270/1N5817.spice.txt",
				modelLine:
					".MODEL DI_1N5817 D  ( IS=870u RS=81.3m BV=20.0 IBV=1.00m\n+ CJO=203p  M=0.333 N=1.81 TT=4.32u )",
			},
			emissionCoefficient: {
				value: 1.81,
				basis: "manufacturer-model",
				source:
					"Manufacturer model file https://www.diodes.com/spice/download/270/1N5817.spice.txt " +
					"(Diodes Inc 1N5817.spice.txt, MANIFEST sha256 " +
					"98e1fc5c0bfe70520852736011a4066e903c037497363da1b2a60d6b0fb4ca33, " +
					"identical card in the owner bundle Schottky (.5A and Above).spice.txt). Card lines:\n" +
					".MODEL DI_1N5817 D  ( IS=870u RS=81.3m BV=20.0 IBV=1.00m\n+ CJO=203p  M=0.333 N=1.81 TT=4.32u )",
				modelFileUrl: "https://www.diodes.com/spice/download/270/1N5817.spice.txt",
				modelLine:
					".MODEL DI_1N5817 D  ( IS=870u RS=81.3m BV=20.0 IBV=1.00m\n+ CJO=203p  M=0.333 N=1.81 TT=4.32u )",
			},
			seriesResistance: {
				value: 81.3e-3,
				basis: "manufacturer-model",
				source:
					"Manufacturer model file https://www.diodes.com/spice/download/270/1N5817.spice.txt " +
					"(Diodes Inc 1N5817.spice.txt, MANIFEST sha256 " +
					"98e1fc5c0bfe70520852736011a4066e903c037497363da1b2a60d6b0fb4ca33, " +
					"identical card in the owner bundle Schottky (.5A and Above).spice.txt). Card lines:\n" +
					".MODEL DI_1N5817 D  ( IS=870u RS=81.3m BV=20.0 IBV=1.00m\n+ CJO=203p  M=0.333 N=1.81 TT=4.32u )",
				modelFileUrl: "https://www.diodes.com/spice/download/270/1N5817.spice.txt",
				modelLine:
					".MODEL DI_1N5817 D  ( IS=870u RS=81.3m BV=20.0 IBV=1.00m\n+ CJO=203p  M=0.333 N=1.81 TT=4.32u )",
			},
		},
	},
	{
		// Diodes Inc Schottky barrier rectifier; bundle-only in hand (no per-part URL
		// recorded), so the SPICE-models index page is the model file URL and the bundle
		// path, sha and card are quoted.
		partIds: ["1N5819"],
		class: "diode",
		params: {
			saturationCurrent: {
				value: 390e-9,
				basis: "manufacturer-model",
				source:
					`Manufacturer SPICE index ${DIODES_SPICE_INDEX}. ` +
					`${DIODES_BUNDLE_CAUTION} Card lines:\n` +
					".MODEL DI_1N5819 D  ( IS=390n RS=0.115 BV=40.0 IBV=1.00m\n+ CJO=203p  M=0.333 N=1.70 TT=4.32u )",
				modelFileUrl: DIODES_SPICE_INDEX,
				modelLine:
					".MODEL DI_1N5819 D  ( IS=390n RS=0.115 BV=40.0 IBV=1.00m\n+ CJO=203p  M=0.333 N=1.70 TT=4.32u )",
			},
			emissionCoefficient: {
				value: 1.7,
				basis: "manufacturer-model",
				source:
					`Manufacturer SPICE index ${DIODES_SPICE_INDEX}. ` +
					`${DIODES_BUNDLE_CAUTION} Card lines:\n` +
					".MODEL DI_1N5819 D  ( IS=390n RS=0.115 BV=40.0 IBV=1.00m\n+ CJO=203p  M=0.333 N=1.70 TT=4.32u )",
				modelFileUrl: DIODES_SPICE_INDEX,
				modelLine:
					".MODEL DI_1N5819 D  ( IS=390n RS=0.115 BV=40.0 IBV=1.00m\n+ CJO=203p  M=0.333 N=1.70 TT=4.32u )",
			},
			seriesResistance: {
				value: 0.115,
				basis: "manufacturer-model",
				source:
					`Manufacturer SPICE index ${DIODES_SPICE_INDEX}. ` +
					`${DIODES_BUNDLE_CAUTION} Card lines:\n` +
					".MODEL DI_1N5819 D  ( IS=390n RS=0.115 BV=40.0 IBV=1.00m\n+ CJO=203p  M=0.333 N=1.70 TT=4.32u )",
				modelFileUrl: DIODES_SPICE_INDEX,
				modelLine:
					".MODEL DI_1N5819 D  ( IS=390n RS=0.115 BV=40.0 IBV=1.00m\n+ CJO=203p  M=0.333 N=1.70 TT=4.32u )",
			},
		},
	},
	{
		// Diodes Inc Schottky; bundle-only in hand (same index-page citation as 1N5819).
		// N 0.775 is the printed fit value (see module note).
		partIds: ["B340A"],
		class: "diode",
		params: {
			saturationCurrent: {
				value: 9.9e-9,
				basis: "manufacturer-model",
				source:
					`Manufacturer SPICE index ${DIODES_SPICE_INDEX}. ` +
					`${DIODES_BUNDLE_CAUTION} Card lines:\n` +
					".MODEL DI_B340A D  ( IS=9.90n RS=14.0m BV=40.0 IBV=500u\n+ CJO=464p  M=0.333 N=0.775 TT=7.20n )",
				modelFileUrl: DIODES_SPICE_INDEX,
				modelLine:
					".MODEL DI_B340A D  ( IS=9.90n RS=14.0m BV=40.0 IBV=500u\n+ CJO=464p  M=0.333 N=0.775 TT=7.20n )",
			},
			emissionCoefficient: {
				value: 0.775,
				basis: "manufacturer-model",
				source:
					`Manufacturer SPICE index ${DIODES_SPICE_INDEX}. ` +
					`${DIODES_BUNDLE_CAUTION} Card lines:\n` +
					".MODEL DI_B340A D  ( IS=9.90n RS=14.0m BV=40.0 IBV=500u\n+ CJO=464p  M=0.333 N=0.775 TT=7.20n )",
				modelFileUrl: DIODES_SPICE_INDEX,
				modelLine:
					".MODEL DI_B340A D  ( IS=9.90n RS=14.0m BV=40.0 IBV=500u\n+ CJO=464p  M=0.333 N=0.775 TT=7.20n )",
			},
			seriesResistance: {
				value: 14e-3,
				basis: "manufacturer-model",
				source:
					`Manufacturer SPICE index ${DIODES_SPICE_INDEX}. ` +
					`${DIODES_BUNDLE_CAUTION} Card lines:\n` +
					".MODEL DI_B340A D  ( IS=9.90n RS=14.0m BV=40.0 IBV=500u\n+ CJO=464p  M=0.333 N=0.775 TT=7.20n )",
				modelFileUrl: DIODES_SPICE_INDEX,
				modelLine:
					".MODEL DI_B340A D  ( IS=9.90n RS=14.0m BV=40.0 IBV=500u\n+ CJO=464p  M=0.333 N=0.775 TT=7.20n )",
			},
		},
	},
	{
		// Diodes Inc rectifier diode; the exact-part single file is cited (the G file
		// covers only a part id that says G and is not registered here).
		partIds: ["1N4001"],
		class: "diode",
		params: {
			saturationCurrent: {
				value: 76.9e-12,
				basis: "manufacturer-model",
				source:
					"Manufacturer model file https://www.diodes.com/spice/download/80/1N4001.spice.txt " +
					"(Diodes Inc 1N4001.spice.txt, MANIFEST sha256 " +
					"577be751162947cd5e3c6e6c9bf91f7f0815cbcda92330a29df18da268ad2118). Card lines:\n" +
					".MODEL DI_1N4001 D  ( IS=76.9p RS=42.0m BV=50.0 IBV=5.00u\n+ CJO=39.8p  M=0.333 N=1.45 TT=4.32u )",
				modelFileUrl: "https://www.diodes.com/spice/download/80/1N4001.spice.txt",
				modelLine:
					".MODEL DI_1N4001 D  ( IS=76.9p RS=42.0m BV=50.0 IBV=5.00u\n+ CJO=39.8p  M=0.333 N=1.45 TT=4.32u )",
			},
			emissionCoefficient: {
				value: 1.45,
				basis: "manufacturer-model",
				source:
					"Manufacturer model file https://www.diodes.com/spice/download/80/1N4001.spice.txt " +
					"(Diodes Inc 1N4001.spice.txt, MANIFEST sha256 " +
					"577be751162947cd5e3c6e6c9bf91f7f0815cbcda92330a29df18da268ad2118). Card lines:\n" +
					".MODEL DI_1N4001 D  ( IS=76.9p RS=42.0m BV=50.0 IBV=5.00u\n+ CJO=39.8p  M=0.333 N=1.45 TT=4.32u )",
				modelFileUrl: "https://www.diodes.com/spice/download/80/1N4001.spice.txt",
				modelLine:
					".MODEL DI_1N4001 D  ( IS=76.9p RS=42.0m BV=50.0 IBV=5.00u\n+ CJO=39.8p  M=0.333 N=1.45 TT=4.32u )",
			},
			seriesResistance: {
				value: 42e-3,
				basis: "manufacturer-model",
				source:
					"Manufacturer model file https://www.diodes.com/spice/download/80/1N4001.spice.txt " +
					"(Diodes Inc 1N4001.spice.txt, MANIFEST sha256 " +
					"577be751162947cd5e3c6e6c9bf91f7f0815cbcda92330a29df18da268ad2118). Card lines:\n" +
					".MODEL DI_1N4001 D  ( IS=76.9p RS=42.0m BV=50.0 IBV=5.00u\n+ CJO=39.8p  M=0.333 N=1.45 TT=4.32u )",
				modelFileUrl: "https://www.diodes.com/spice/download/80/1N4001.spice.txt",
				modelLine:
					".MODEL DI_1N4001 D  ( IS=76.9p RS=42.0m BV=50.0 IBV=5.00u\n+ CJO=39.8p  M=0.333 N=1.45 TT=4.32u )",
			},
		},
	},
	{
		// Diodes Inc rectifier diode; fetched whole in this run (one request, no scanning).
		partIds: ["1N4002"],
		class: "diode",
		params: {
			saturationCurrent: {
				value: 76.9e-12,
				basis: "manufacturer-model",
				source:
					"Manufacturer model file https://www.diodes.com/spice/download/407/1N4002.spice.txt " +
					"(fetched 2026-10-19 in this run, sha256 " +
					"a487113aa51562c46cd0b3f2b824b8ee8be4bd505d111230bc9a154e13f7a2f1). Card lines:\n" +
					".MODEL DI_1N4002 D  ( IS=76.9p RS=42.0m BV=100 IBV=5.00u\n+ CJO=39.8p  M=0.333 N=1.45 TT=4.32u )",
				modelFileUrl: "https://www.diodes.com/spice/download/407/1N4002.spice.txt",
				modelLine:
					".MODEL DI_1N4002 D  ( IS=76.9p RS=42.0m BV=100 IBV=5.00u\n+ CJO=39.8p  M=0.333 N=1.45 TT=4.32u )",
			},
			emissionCoefficient: {
				value: 1.45,
				basis: "manufacturer-model",
				source:
					"Manufacturer model file https://www.diodes.com/spice/download/407/1N4002.spice.txt " +
					"(fetched 2026-10-19 in this run, sha256 " +
					"a487113aa51562c46cd0b3f2b824b8ee8be4bd505d111230bc9a154e13f7a2f1). Card lines:\n" +
					".MODEL DI_1N4002 D  ( IS=76.9p RS=42.0m BV=100 IBV=5.00u\n+ CJO=39.8p  M=0.333 N=1.45 TT=4.32u )",
				modelFileUrl: "https://www.diodes.com/spice/download/407/1N4002.spice.txt",
				modelLine:
					".MODEL DI_1N4002 D  ( IS=76.9p RS=42.0m BV=100 IBV=5.00u\n+ CJO=39.8p  M=0.333 N=1.45 TT=4.32u )",
			},
			seriesResistance: {
				value: 42e-3,
				basis: "manufacturer-model",
				source:
					"Manufacturer model file https://www.diodes.com/spice/download/407/1N4002.spice.txt " +
					"(fetched 2026-10-19 in this run, sha256 " +
					"a487113aa51562c46cd0b3f2b824b8ee8be4bd505d111230bc9a154e13f7a2f1). Card lines:\n" +
					".MODEL DI_1N4002 D  ( IS=76.9p RS=42.0m BV=100 IBV=5.00u\n+ CJO=39.8p  M=0.333 N=1.45 TT=4.32u )",
				modelFileUrl: "https://www.diodes.com/spice/download/407/1N4002.spice.txt",
				modelLine:
					".MODEL DI_1N4002 D  ( IS=76.9p RS=42.0m BV=100 IBV=5.00u\n+ CJO=39.8p  M=0.333 N=1.45 TT=4.32u )",
			},
		},
	},
	{
		// Diodes Inc rectifier diode; fetched whole in this run (one request, no scanning).
		partIds: ["1N4004"],
		class: "diode",
		params: {
			saturationCurrent: {
				value: 76.9e-12,
				basis: "manufacturer-model",
				source:
					"Manufacturer model file https://www.diodes.com/spice/download/339/1N4004.spice.txt " +
					"(fetched 2026-10-19 in this run, sha256 " +
					"abd809fc674fcc61430437c3476e97f4b54349d1780a5b281186c1e355eb232a). Card lines:\n" +
					".MODEL DI_1N4004 D  ( IS=76.9p RS=42.0m BV=400 IBV=5.00u\n+ CJO=39.8p  M=0.333 N=1.45 TT=4.32u )",
				modelFileUrl: "https://www.diodes.com/spice/download/339/1N4004.spice.txt",
				modelLine:
					".MODEL DI_1N4004 D  ( IS=76.9p RS=42.0m BV=400 IBV=5.00u\n+ CJO=39.8p  M=0.333 N=1.45 TT=4.32u )",
			},
			emissionCoefficient: {
				value: 1.45,
				basis: "manufacturer-model",
				source:
					"Manufacturer model file https://www.diodes.com/spice/download/339/1N4004.spice.txt " +
					"(fetched 2026-10-19 in this run, sha256 " +
					"abd809fc674fcc61430437c3476e97f4b54349d1780a5b281186c1e355eb232a). Card lines:\n" +
					".MODEL DI_1N4004 D  ( IS=76.9p RS=42.0m BV=400 IBV=5.00u\n+ CJO=39.8p  M=0.333 N=1.45 TT=4.32u )",
				modelFileUrl: "https://www.diodes.com/spice/download/339/1N4004.spice.txt",
				modelLine:
					".MODEL DI_1N4004 D  ( IS=76.9p RS=42.0m BV=400 IBV=5.00u\n+ CJO=39.8p  M=0.333 N=1.45 TT=4.32u )",
			},
			seriesResistance: {
				value: 42e-3,
				basis: "manufacturer-model",
				source:
					"Manufacturer model file https://www.diodes.com/spice/download/339/1N4004.spice.txt " +
					"(fetched 2026-10-19 in this run, sha256 " +
					"abd809fc674fcc61430437c3476e97f4b54349d1780a5b281186c1e355eb232a). Card lines:\n" +
					".MODEL DI_1N4004 D  ( IS=76.9p RS=42.0m BV=400 IBV=5.00u\n+ CJO=39.8p  M=0.333 N=1.45 TT=4.32u )",
				modelFileUrl: "https://www.diodes.com/spice/download/339/1N4004.spice.txt",
				modelLine:
					".MODEL DI_1N4004 D  ( IS=76.9p RS=42.0m BV=400 IBV=5.00u\n+ CJO=39.8p  M=0.333 N=1.45 TT=4.32u )",
			},
		},
	},
	{
		// Diodes Inc rectifier diode; the exact-part single file is cited.
		partIds: ["1N4007"],
		class: "diode",
		params: {
			saturationCurrent: {
				value: 76.9e-12,
				basis: "manufacturer-model",
				source:
					"Manufacturer model file https://www.diodes.com/spice/download/396/1N4007.spice.txt " +
					"(Diodes Inc 1N4007.spice.txt, MANIFEST sha256 " +
					"f69508c4e201d3d7cb11a4bb10719c116e064792da627510adb5020a1254d9). Card lines:\n" +
					".MODEL DI_1N4007 D  ( IS=76.9p RS=42.0m BV=1.00k IBV=5.00u\n+ CJO=26.5p  M=0.333 N=1.45 TT=4.32u )",
				modelFileUrl: "https://www.diodes.com/spice/download/396/1N4007.spice.txt",
				modelLine:
					".MODEL DI_1N4007 D  ( IS=76.9p RS=42.0m BV=1.00k IBV=5.00u\n+ CJO=26.5p  M=0.333 N=1.45 TT=4.32u )",
			},
			emissionCoefficient: {
				value: 1.45,
				basis: "manufacturer-model",
				source:
					"Manufacturer model file https://www.diodes.com/spice/download/396/1N4007.spice.txt " +
					"(Diodes Inc 1N4007.spice.txt, MANIFEST sha256 " +
					"f69508c4e201d3d7cb11a4bb10719c116e064792da627510adb5020a1254d9). Card lines:\n" +
					".MODEL DI_1N4007 D  ( IS=76.9p RS=42.0m BV=1.00k IBV=5.00u\n+ CJO=26.5p  M=0.333 N=1.45 TT=4.32u )",
				modelFileUrl: "https://www.diodes.com/spice/download/396/1N4007.spice.txt",
				modelLine:
					".MODEL DI_1N4007 D  ( IS=76.9p RS=42.0m BV=1.00k IBV=5.00u\n+ CJO=26.5p  M=0.333 N=1.45 TT=4.32u )",
			},
			seriesResistance: {
				value: 42e-3,
				basis: "manufacturer-model",
				source:
					"Manufacturer model file https://www.diodes.com/spice/download/396/1N4007.spice.txt " +
					"(Diodes Inc 1N4007.spice.txt, MANIFEST sha256 " +
					"f69508c4e201d3d7cb11a4bb10719c116e064792da627510adb5020a1254d9). Card lines:\n" +
					".MODEL DI_1N4007 D  ( IS=76.9p RS=42.0m BV=1.00k IBV=5.00u\n+ CJO=26.5p  M=0.333 N=1.45 TT=4.32u )",
				modelFileUrl: "https://www.diodes.com/spice/download/396/1N4007.spice.txt",
				modelLine:
					".MODEL DI_1N4007 D  ( IS=76.9p RS=42.0m BV=1.00k IBV=5.00u\n+ CJO=26.5p  M=0.333 N=1.45 TT=4.32u )",
			},
		},
	},
	{
		// Central Semiconductor 1N914: LICENSE LIMIT -- the file header forbids
		// re-selling/redistributing the model and modifying it, so the full card is NOT
		// copied into this repo and only the two fragments carrying the mapped values are
		// quoted as the model line. RS is therefore NOT mapped here (the stamp keeps the
		// class 1.0 ohm against the card's RS .33636); IS and N are.
		partIds: ["1N914"],
		class: "diode",
		note:
			"License limit: Central Semiconductor header forbids re-selling, re-distributing " +
			"or modifying the model, so only the IS/N fragments are quoted and the full card is " +
			"not vendored. RS .33636 is disclosed but not mapped (stamp keeps class 1.0 ohm). " +
			"Owner stance to confirm.",
		params: {
			saturationCurrent: {
				value: 6.2229e-9,
				basis: "manufacturer-model",
				source:
					"Central Semiconductor, LLC model, item 1N914, Rev A, date 12/07/11 " +
					"(header '*SRC=1N914;1N914;Diodes;Si;100V 150mA 4.0ns  Central Semi'). " +
					"Per-file page not recorded by the owner; owner file " +
					"/home/joseph/projects/VesselDSP/tmp/1N914.LIB sha256 " +
					"3b9a0db01f2d6ce870a43e07493aa9f4ffd2cb93a858223b5dcbc0d827087413 " +
					"(35 lines, CRLF). Central Semiconductor, LLC is the author (see header). " +
					"Manufacturer site https://www.centralsemi.com/ for host validity. " +
					"Quoted fragments (license limit, full card not copied): IS=6.2229E-9 N=1.9224",
				modelFileUrl: "https://www.centralsemi.com/",
				modelLine: "IS=6.2229E-9 N=1.9224",
			},
			emissionCoefficient: {
				value: 1.9224,
				basis: "manufacturer-model",
				source:
					"Central Semiconductor, LLC model, item 1N914, Rev A, date 12/07/11 " +
					"(header '*SRC=1N914;1N914;Diodes;Si;100V 150mA 4.0ns  Central Semi'). " +
					"Per-file page not recorded by the owner; owner file " +
					"/home/joseph/projects/VesselDSP/tmp/1N914.LIB sha256 " +
					"3b9a0db01f2d6ce870a43e07493aa9f4ffd2cb93a858223b5dcbc0d827087413 " +
					"(35 lines, CRLF). Central Semiconductor, LLC is the author (see header). " +
					"Manufacturer site https://www.centralsemi.com/ for host validity. " +
					"Quoted fragments (license limit, full card not copied): IS=6.2229E-9 N=1.9224",
				modelFileUrl: "https://www.centralsemi.com/",
				modelLine: "IS=6.2229E-9 N=1.9224",
			},
		},
	},
	{
		// Wave 4 community. The widely distributed LTspice 1N4148 line (mfg=OnSemi) as the
		// library publishes it. Provisional: a published library card, not a measurement of
		// the part; the owner's bench measurement will replace it. Vf implied (with the
		// mapped RS 0.568): 0.584 V at 1 mA, 0.694 V at 10 mA.
		partIds: ["1N4148"],
		class: "diode",
		note:
			"Cross-check deltas at 1 mA / 10 mA (stamped values, RS included): vs Central " +
			"1N914 (IS 6.2229n, N 1.9224, class RS 1.0) +12.3 / +26.3 mV; vs Diodes Inc " +
			"1N4148W (IS 10.4n, N 2.07, RS 51.5m, bundle reference, unregistered) +29.6 / " +
			"+43.9 mV; vs Diodes Inc MMBD914 (IS 126n, N 2.60, RS 0.14, bundle reference, " +
			"unregistered, SOT-23 die) +19.2 / +65.9 mV. The MMBD914 10 mA gap exceeds the " +
			"50 mV gate; coordinator ruling 2026-10-19: MMBD914 is a different die and " +
			"Diodes' own 1N4148W/MMBD914 disagree by 22 mV at 10 mA, so registration stands " +
			"with every delta disclosed here.",
		params: {
			saturationCurrent: {
				value: 2.52e-9,
				basis: "community",
				source:
					"LTspice standard diode library 'Standard.dio' (Linear Technology Corporation, " +
					"copyright header 2000-2012; library author Mike Engelhardt / Linear Technology, " +
					"now Analog Devices), HTML rendering https://ltwiki.org/index.php?title=Standard.dio " +
					"(revision 1083, read 2026-10-19). Verbatim card line:\n" +
					".model 1N4148 D(Is=2.52n Rs=.568 N=1.752 Cjo=4p M=.4 tt=20n Iave=200m Vpk=75 mfg=OnSemi type=silicon)\n" +
					"(the identical-parameter 1N914 line sits directly above it; mfg=OnSemi marks " +
					"the ON Semi/Fairchild data as distributed inside LTspice)",
				sourceKind: "published-spice-model",
				url: "https://ltwiki.org/index.php?title=Standard.dio",
				quote:
					".model 1N4148 D(Is=2.52n Rs=.568 N=1.752 Cjo=4p M=.4 tt=20n Iave=200m Vpk=75 mfg=OnSemi type=silicon)",
				author: "Linear Technology Corporation (LTspice standard diode library)",
				retrievedDate: "2026-10-19",
				whyNoBetterSource:
					"No manufacturer model file retrievable (onsemi MMSD4148 simulation-models ZIP " +
					"portal-gated; Diodes Inc per-part .spice.txt portal-gated); vendored datasheet " +
					"sheets print MAX-only VF (Vishay VF MAX 1.0 V at 10 mA, single point: no form-4 " +
					"pair). The distributed LTspice line marked mfg=OnSemi is the canonical published " +
					"card. Deltas vs 1N914/1N4148W/MMBD914 disclosed in the entry note.",
			},
			emissionCoefficient: {
				value: 1.752,
				basis: "community",
				source:
					"LTspice 'Standard.dio' (Linear Technology Corporation), " +
					"https://ltwiki.org/index.php?title=Standard.dio (read 2026-10-19). Verbatim card line:\n" +
					".model 1N4148 D(Is=2.52n Rs=.568 N=1.752 Cjo=4p M=.4 tt=20n Iave=200m Vpk=75 mfg=OnSemi type=silicon)",
				sourceKind: "published-spice-model",
				url: "https://ltwiki.org/index.php?title=Standard.dio",
				quote:
					".model 1N4148 D(Is=2.52n Rs=.568 N=1.752 Cjo=4p M=.4 tt=20n Iave=200m Vpk=75 mfg=OnSemi type=silicon)",
				author: "Linear Technology Corporation (LTspice standard diode library)",
				retrievedDate: "2026-10-19",
				whyNoBetterSource:
					"Same search as the IS record: no retrievable manufacturer model, no two-TYP " +
					"datasheet pair; the mfg=OnSemi library card is the published source.",
			},
			seriesResistance: {
				value: 0.568,
				basis: "community",
				source:
					"LTspice 'Standard.dio' (Linear Technology Corporation), " +
					"https://ltwiki.org/index.php?title=Standard.dio (read 2026-10-19). Verbatim card line:\n" +
					".model 1N4148 D(Is=2.52n Rs=.568 N=1.752 Cjo=4p M=.4 tt=20n Iave=200m Vpk=75 mfg=OnSemi type=silicon)",
				sourceKind: "published-spice-model",
				url: "https://ltwiki.org/index.php?title=Standard.dio",
				quote:
					".model 1N4148 D(Is=2.52n Rs=.568 N=1.752 Cjo=4p M=.4 tt=20n Iave=200m Vpk=75 mfg=OnSemi type=silicon)",
				author: "Linear Technology Corporation (LTspice standard diode library)",
				retrievedDate: "2026-10-19",
				whyNoBetterSource:
					"Same search as the IS record: the card's ohmic Rs is the engine's series " +
					"resistance quantity.",
			},
		},
	},
	{
		// Wave 4 community. Germanium point-contact card from Bordodynov's published LTspice
		// collection (the author's own lib.zip, verified in this run). Provisional single
		// sample. Vf implied (with the mapped RS 6.5): 0.253 V at 1 mA, 0.406 V at 10 mA.
		// The same file carries an alternate 1N34A_ card (IS 0.2u, N 1.3, RS 7: 0.293 V at
		// 1 mA, 0.434 V at 10 mA, deltas +40/+27 mV, inside the gate); the exact-id card is
		// registered. No datasheet prints two typical (If,Vf) points (Central Germanium
		// Diodes PDF: VF MAX 1.0 V at 5 mA, single point).
		partIds: ["1N34A"],
		class: "diode",
		params: {
			saturationCurrent: {
				value: 2.6e-6,
				basis: "community",
				source:
					"Bordodynov's Electronics public LTspice collection, lib.zip " +
					"http://bordodynov.ltwiki.org/lib.zip (sha256 " +
					"dfaae06ebeaf2a37b0a493f60067728f0f1bb80ac0f8b1f5f7a27d4250a6ea9b, " +
					"lib/cmp/standard.dio line 137, read 2026-10-19; site greeting: 'Hello this is " +
					"Bordodynov's Electronics web page. I made my collection of models and examples " +
					"for LTspice publicly available.'). Verbatim card:\n" +
					".MODEL 1N34A D(IS=2.6u RS=6.5 N=1.6 CJO=0.8p EG=0.67 BV=75 IBV=1m Type=GePunctualContact)",
				sourceKind: "published-spice-model",
				url: "http://bordodynov.ltwiki.org/lib.zip",
				quote:
					".MODEL 1N34A D(IS=2.6u RS=6.5 N=1.6 CJO=0.8p EG=0.67 BV=75 IBV=1m Type=GePunctualContact)",
				author: "Bordodynov (Bordodynov's Electronics)",
				retrievedDate: "2026-10-19",
				whyNoBetterSource:
					"Manufacturer sheets checked and insufficient (Central Semiconductor Germanium " +
					"Diodes PDF via DigiKey: VF MAX 1.0 V at 5 mA, single MAX point; generic " +
					"TME-hosted sheet the same). The TI E2E forum thread quoting Germanium.LIB and " +
					"the LTspice group 01.08.2017 post attribute the file to Bordodynov; the LTwiki " +
					"Standard.dio HTML rendering carries the same card text (BV/IBV variant). " +
					"Point-contact fit, BV=75 (not the TME sheet's 65 V).",
			},
			emissionCoefficient: {
				value: 1.6,
				basis: "community",
				source:
					"Bordodynov's Electronics lib.zip http://bordodynov.ltwiki.org/lib.zip " +
					"(lib/cmp/standard.dio line 137, read 2026-10-19). Verbatim card:\n" +
					".MODEL 1N34A D(IS=2.6u RS=6.5 N=1.6 CJO=0.8p EG=0.67 BV=75 IBV=1m Type=GePunctualContact)",
				sourceKind: "published-spice-model",
				url: "http://bordodynov.ltwiki.org/lib.zip",
				quote:
					".MODEL 1N34A D(IS=2.6u RS=6.5 N=1.6 CJO=0.8p EG=0.67 BV=75 IBV=1m Type=GePunctualContact)",
				author: "Bordodynov (Bordodynov's Electronics)",
				retrievedDate: "2026-10-19",
				whyNoBetterSource:
					"Same search as the IS record: the card's N is read directly, no datasheet pair.",
			},
			seriesResistance: {
				value: 6.5,
				basis: "community",
				source:
					"Bordodynov's Electronics lib.zip http://bordodynov.ltwiki.org/lib.zip " +
					"(lib/cmp/standard.dio line 137, read 2026-10-19). Verbatim card:\n" +
					".MODEL 1N34A D(IS=2.6u RS=6.5 N=1.6 CJO=0.8p EG=0.67 BV=75 IBV=1m Type=GePunctualContact)",
				sourceKind: "published-spice-model",
				url: "http://bordodynov.ltwiki.org/lib.zip",
				quote:
					".MODEL 1N34A D(IS=2.6u RS=6.5 N=1.6 CJO=0.8p EG=0.67 BV=75 IBV=1m Type=GePunctualContact)",
				author: "Bordodynov (Bordodynov's Electronics)",
				retrievedDate: "2026-10-19",
				whyNoBetterSource:
					"Same search as the IS record: the card's ohmic RS is the engine's series " +
					"resistance quantity.",
			},
		},
	},
	{
		// Wave 4 datasheet (form 4), found during the community search: the DEC factory
		// sheet prints two typical (If,Vf) points for 1N60. The Bordodynov community card
		// for 1N60 (RS=50.0559, EG=1.11 on a type=germanium card) is NOT registered: its
		// 50-ohm RS reads 0.96 V at 10 mA and its bandgap is silicon, so the card is
		// corrupt as a low-current model; the datasheet derivation below replaces it.
		partIds: ["1N60"],
		class: "diode",
		params: {
			saturationCurrent: {
				value: 3.6952e-5,
				basis: "derived",
				source:
					"DEC 1N60, 1N60P GERMANIUM DIODES factory sheet (manufacturer DEC, via " +
					"radiolocman third-party host, p1, read visually) ELECTRICAL CHARACTERISTICS, " +
					"'VF Forward Voltage: IF = 1 mA: 1N60 TYP 0.32 MAX 0.5 V; IF = 30 mA: 1N60 TYP " +
					"0.65 MAX 1.0 V' (the 1N60P columns read 0.24/0.5 at 1 mA and 0.65/1.0 at 200 mA)",
				derivation:
					"Two printed typical (If,Vf) points (form 4): (1 mA, 0.32 V) and (30 mA, 0.65 V). " +
					"n = (0.65 - 0.32) / (Vt * ln(30)) = 0.33 / (0.025852 * 3.4012) = 3.7531; " +
					"IS = 1e-3 / exp(0.32 / (3.7531 * 0.025852)) = 3.6952e-5 A. No RS row is " +
					"printed, so the stamp keeps the class 1.0 ohm (Vf implied: 0.321 V at 1 mA, " +
					"0.553 V at 10 mA).",
			},
			emissionCoefficient: {
				value: 3.7531,
				basis: "derived",
				source:
					"DEC 1N60, 1N60P GERMANIUM DIODES factory sheet (via radiolocman, p1): same two " +
					"typical points, 1N60 (0.32 V at 1 mA; 0.65 V at 30 mA)",
				derivation:
					"n = (0.65 - 0.32) / (Vt * ln(30/1)) = 3.7531 (form 4; a fit value, disclosed -- " +
					"the BAT43 N 4.995 precedent).",
			},
		},
	},
	{
		// Wave 4 datasheet (form 4): the DEC sheet's 1N60P columns (0.24 V at 1 mA, 0.65 V
		// at 200 mA, both TYP). No community card for 1N60P was found, so no provisional
		// record competes.
		partIds: ["1N60P"],
		class: "diode",
		params: {
			saturationCurrent: {
				value: 4.4984e-5,
				basis: "derived",
				source:
					"DEC 1N60, 1N60P GERMANIUM DIODES factory sheet (manufacturer DEC, via " +
					"radiolocman third-party host, p1, read visually) ELECTRICAL CHARACTERISTICS, " +
					"'VF Forward Voltage: IF = 1 mA: 1N60P TYP 0.24 MAX 0.5 V; IF = 200 mA: 1N60P " +
					"TYP 0.65 MAX 1.0 V'",
				derivation:
					"Two printed typical (If,Vf) points (form 4): (1 mA, 0.24 V) and (200 mA, 0.65 V). " +
					"n = (0.65 - 0.24) / (Vt * ln(200)) = 0.41 / (0.025852 * 5.2983) = 2.9933; " +
					"IS = 1e-3 / exp(0.24 / (2.9933 * 0.025852)) = 4.4984e-5 A. No RS row is " +
					"printed (stamp keeps class 1.0 ohm; Vf implied: 0.241 V at 1 mA, 0.428 V at 10 mA).",
			},
			emissionCoefficient: {
				value: 2.9933,
				basis: "derived",
				source:
					"DEC 1N60, 1N60P GERMANIUM DIODES factory sheet (via radiolocman, p1): same two " +
					"typical points, 1N60P (0.24 V at 1 mA; 0.65 V at 200 mA)",
				derivation:
					"n = (0.65 - 0.24) / (Vt * ln(200/1)) = 2.9933 (form 4; a fit value, disclosed).",
			},
		},
	},
	{
		// Nexperia BAT85 (ex-Philips), SOD68/DO-34, now discontinued. Vf implied by IS/N/RS:
		// 0.227 V at 1 mA, 0.308 V at 10 mA (the card's own header prints VF max 400 mV at 10 mA).
		partIds: ["BAT85"],
		class: "diode",
		params: {
			saturationCurrent: {
				value: 2.076e-7,
				basis: "manufacturer-model",
				source:
					`Nexperia BAT85 product page ${NEXPERIA_BAT85_PAGE}, model file ${NEXPERIA_BAT85_FILE}. ` +
					`${NEXPERIA_BAT85_CAUTION} Card:\n${NEXPERIA_BAT85_LINE}`,
				modelFileUrl: NEXPERIA_BAT85_FILE,
				modelLine: NEXPERIA_BAT85_LINE,
			},
			emissionCoefficient: {
				value: 1.023,
				basis: "manufacturer-model",
				source:
					`Nexperia BAT85 product page ${NEXPERIA_BAT85_PAGE}, model file ${NEXPERIA_BAT85_FILE}. ` +
					`${NEXPERIA_BAT85_CAUTION} Card:\n${NEXPERIA_BAT85_LINE}`,
				modelFileUrl: NEXPERIA_BAT85_FILE,
				modelLine: NEXPERIA_BAT85_LINE,
			},
			seriesResistance: {
				value: 2.326,
				basis: "manufacturer-model",
				source:
					`Nexperia BAT85 product page ${NEXPERIA_BAT85_PAGE}, model file ${NEXPERIA_BAT85_FILE}. ` +
					`${NEXPERIA_BAT85_CAUTION} Card:\n${NEXPERIA_BAT85_LINE}`,
				modelFileUrl: NEXPERIA_BAT85_FILE,
				modelLine: NEXPERIA_BAT85_LINE,
			},
		},
	},
	{
		// JED's BAT85S (Vishay, DO-35). PROVISIONAL: the Nexperia BAT85 card is used for it.
		// The two are not claimed equal. The card's implied values sit inside the Vishay BAT85S
		// printed maxima at all five printed forward points (0.164 V at 0.1 mA vs max 0.240;
		// 0.227 at 1 mA vs 0.320; 0.308 at 10 mA vs 0.400; 0.384 at 30 mA vs 0.500; 0.579 at
		// 100 mA vs 0.800), the card's reverse current at 25 V (IS plus 25 V / R1, 0.67 uA) sits
		// under the printed 2 uA, and its capacitance at 1 V (6.5 pF) under the printed 10 pF.
		// That shows the card is not contradicted, nothing more. Replace with a Vishay or
		// bench-measured record when one exists (a measured IS+n for this part would throw the
		// community records out, per the loader).
		partIds: ["BAT85S"],
		class: "diode",
		params: {
			saturationCurrent: {
				value: 2.076e-7,
				basis: "community",
				source:
					`Nexperia BAT85 SPICE model ${NEXPERIA_BAT85_FILE} (product page ${NEXPERIA_BAT85_PAGE}), ` +
					`applied to the Vishay BAT85S. ${NEXPERIA_BAT85_CAUTION} Verbatim line: + IS = 2.076E-7`,
				sourceKind: "published-spice-model",
				url: NEXPERIA_BAT85_FILE,
				quote: "+ IS = 2.076E-7",
				author: "Nexperia (model of its own BAT85, not of the Vishay BAT85S)",
				retrievedDate: "2026-10-20",
				whyNoBetterSource: BAT85S_WHY_NO_BETTER_SOURCE,
			},
			emissionCoefficient: {
				value: 1.023,
				basis: "community",
				source:
					`Nexperia BAT85 SPICE model ${NEXPERIA_BAT85_FILE} (product page ${NEXPERIA_BAT85_PAGE}), ` +
					`applied to the Vishay BAT85S. ${NEXPERIA_BAT85_CAUTION} Verbatim line: + N = 1.023`,
				sourceKind: "published-spice-model",
				url: NEXPERIA_BAT85_FILE,
				quote: "+ N = 1.023",
				author: "Nexperia (model of its own BAT85, not of the Vishay BAT85S)",
				retrievedDate: "2026-10-20",
				whyNoBetterSource: BAT85S_WHY_NO_BETTER_SOURCE,
			},
			seriesResistance: {
				value: 2.326,
				basis: "community",
				source:
					`Nexperia BAT85 SPICE model ${NEXPERIA_BAT85_FILE} (product page ${NEXPERIA_BAT85_PAGE}), ` +
					`applied to the Vishay BAT85S. ${NEXPERIA_BAT85_CAUTION} Verbatim line: + RS = 2.326`,
				sourceKind: "published-spice-model",
				url: NEXPERIA_BAT85_FILE,
				quote: "+ RS = 2.326",
				author: "Nexperia (model of its own BAT85, not of the Vishay BAT85S)",
				retrievedDate: "2026-10-20",
				whyNoBetterSource: BAT85S_WHY_NO_BETTER_SOURCE,
			},
		},
	},
]);
