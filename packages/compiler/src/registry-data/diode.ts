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
// (1N4148, 1N34A, 1N60P, D9E, D9K, BAT85S, BAT85S). Each measured IS+n will cite the
// committed measurement JSON (schema `vesseldsp.junction-default-measurement.v1`,
// `perDevice` `isEngine`/`nEngine` pooled over every sample at the engine VT 0.025852 V)
// with instrument, conditions, sample count, date, repo-relative path and sha256; see
// `led-measurement.html` and its README. The owner has not measured yet.
//
// Plausibility disclosures (transcribed as printed, not fitted): 1N5817 IS 870 uA lands
// the 1 mA Vf at ~7 mV (a high-current fit, weak at low current); BAT43 N 4.995 lands
// the 1 mA Vf at ~95 mV; B340A N 0.775 is below unity. The loader checks shape and
// provenance, never plausibility; the Vf table in the wave-3 report shows each model.

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
]);
