// BJT registry data: wave-1 discrete fill.
//
// One value per parameter; a parameter with no datasheet citation is not loadable, so it
// is omitted here and the stamp falls back to the class default (never a guess):
//
// - `saturationCurrent`: derived ONLY by form (1), IS = Ic * exp(-Vbe / Vt) with n = 1 from
//   a printed Vbe at a stated Ic, OR read directly from a manufacturer-published SPICE
//   model (`manufacturer-model`, preferred over a derived value where one exists -- owner
//   ruling 2026-10-19). A printed MIN-MAX VBE(sat) range becomes one Vbe by its
//   arithmetic midpoint under form (2) ("a printed bin or range becomes one value by its
//   midpoint"), quoted with page and conditions so anyone can recompute it. A MAX-only Vbe
//   with no MIN is a limit, not a range, and yields no IS (2N5089/2SC1815; 2N5088's IS is
//   from its model, not from the MAX-only VBE(on) row).
// - `forwardBeta`: derived by form (2) from a printed hFE bin at a stated Vce/Ic, geometric
//   mean for gains. Bare MIN-only hFE rows are never used alone; the small-signal full-range
//   row is preferred. Rank suffixes (2SC1815-Y/BL) are separate entries with their rank's
//   midpoint, never aliases of the unbinned part -- a rank is a different gain, not another
//   spelling. `MPS-A18` needs no alias: it folds to the same id as `MPSA18`.
// - `reverseBeta`, `leakageAmps`: omitted for every part below. No BJT sheet in this wave
//   prints reverse beta at all, and every leakage row is MAX-only (a limit, not a value).
//   The stamp keeps reverseBeta 1 and leakageAmps 0.
// - `thermalVoltage`: omitted for every part below. It is kT/q at room temperature, not a
//   per-part datasheet figure; no datasheet basis exists, so the class default stands.

import { definePartData, type PartDataEntry } from "./loader";

export const bjtRegistryRecords: readonly PartDataEntry[] = definePartData([
	{
		partIds: ["2N3904"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 2.5150964e-15,
				basis: "derived",
				source:
					"2N3904/datasheets/2n3904.pdf (onsemi 2N3904/D, Oct 2024 Rev. 3) p2, ELECTRICAL " +
					"CHARACTERISTICS: 'Base-Emitter Saturation Voltage VBE(sat), IC = 10 mA, IB = 1.0 mA, " +
					"MIN 0.65 MAX 0.85 V' (no TYP printed; the 50 mA row is MAX-only 0.95 V)",
				derivation:
					"Printed VBE(sat) range 0.65-0.85 V at IC = 10 mA, IB = 1.0 mA; arithmetic midpoint " +
					"0.75 V (form 2, printed range, no TYP); IS = IC * exp(-Vbe / Vt) with n = 1 " +
					"(form 1): 0.01 * exp(-0.75 / 0.025852) = 2.5150964e-15.",
			},
			forwardBeta: {
				value: 173.2050808,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 229, card '.model 2N3904 NPN': " +
					"'Bf=300' = 300 against this record's 173.2 (independent published fit, registry/card " +
					"ratio 0.58); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L229",
				source:
					"2N3904/datasheets/2n3904.pdf (onsemi 2N3904/D, Oct 2024 Rev. 3) p2: 'DC Current Gain, " +
					"IC = 10 mA, VCE = 1.0 V, MIN 100 MAX 300' (the 0.1/1.0/50/100 mA rows are MIN-only; " +
					"Note 3: pulse test)",
				derivation:
					"Printed hFE bin 100-300 at IC = 10 mA, VCE = 1.0 V; geometric midpoint " +
					"(form 2, gains): sqrt(100 * 300) = 173.2050808.",
			},
		},
	},
	{
		partIds: ["2N3906"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 2.5150964e-15,
				basis: "derived",
				source:
					"2N3906/datasheets/2n3906.pdf (onsemi 2N3906/D, Feb 2010 Rev. 4) p2, ELECTRICAL " +
					"CHARACTERISTICS: 'Base-Emitter Saturation Voltage VBE(sat), IC = 10 mA, IB = 1.0 mA, " +
					"MIN 0.65 MAX 0.85 V' magnitudes (PNP; the 50 mA row is MAX-only 0.95 V)",
				derivation:
					"Printed VBE(sat) range 0.65-0.85 V at IC = 10 mA, IB = 1.0 mA; arithmetic midpoint " +
					"0.75 V (form 2, printed range, no TYP); IS = IC * exp(-Vbe / Vt) with n = 1 " +
					"(form 1): 0.01 * exp(-0.75 / 0.025852) = 2.5150964e-15. Polarity is structural " +
					"(device PNP flag), not a registry value.",
			},
			forwardBeta: {
				value: 173.2050808,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 231, card '.model 2N3906 PNP': " +
					"'BF=200' = 200 against this record's 173.2 (independent published fit, registry/card " +
					"ratio 0.87); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L231",
				source:
					"2N3906/datasheets/2n3906.pdf (onsemi 2N3906/D, Feb 2010 Rev. 4) p2: 'DC Current Gain, " +
					"IC = 10 mA, VCE = 1.0 V, MIN 100 MAX 300' (the 0.1/1.0/50/100 mA rows are MIN-only; " +
					"Note 2: pulse test)",
				derivation:
					"Printed hFE bin 100-300 at IC = 10 mA, VCE = 1.0 V; geometric midpoint " +
					"(form 2, gains): sqrt(100 * 300) = 173.2050808.",
			},
		},
	},
	{
		// Saturation current from the onsemi-published datasheet-embedded SPICE model
		// (Microsim-format NPN line, coordinator clarification 2026-10-19: a model the
		// manufacturer prints inside its own datasheet is manufacturer-published, basis
		// `manufacturer-model`). The sheet's only printed Vbe figure is MAX-only VBE(on)
		// 0.8 V (a limit, not a range or typical), so no form-1 IS exists; BF stays the
		// derived small-signal-hfe midpoint (mixing sources admitted).
		partIds: ["2N5088"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 5.911e-15,
				basis: "manufacturer-model",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 343, card '.MODEL 2N5088 NPN': " +
					"'IS=5.911f' = 5.911e-15 against this record's 5.911e-15 (identical figure -- a mirror of " +
					"the cited card or the same printed number, so a transcription check, not an independent " +
					"witness); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L343",
				source:
					"Manufacturer datasheet onsemi 2N5088 / MMBT5088 / 2N5089 / MMBT5089 NPN General " +
					"Purpose Amplifier (2N5088-D; Fairchild-integration printing, opens 'Is Now Part of' " +
					"ON Semiconductor), PDF p3 'Spice Model' block, " +
					"https://www.onsemi.com/pdf/datasheet/2n5088-d.pdf, verbatim lines:\n" +
					"NPN (Is=5.911f Xti=3 Eg=1.11 Vaf=62.37 Bf=1.122K Ne=1.394 Ise=5.911f Ikf=14.92m Xtb=1.5 Br=1.271 Nc=2\n" +
					"Isc=0 Ikr=0 Rc=1.61 Cjc=4.017p Mjc=.3174 Vjc=.75 Fc=.5 Cje=4.973p Mje=.4146 Vje=.75 Tr=4.673n Tf=821.7p\n" +
					"Itf=.35 Vtf=4 Xtf=7 Rb=10)",
				modelFileUrl: "https://www.onsemi.com/pdf/datasheet/2n5088-d.pdf",
				modelLine:
					"NPN (Is=5.911f Xti=3 Eg=1.11 Vaf=62.37 Bf=1.122K Ne=1.394 Ise=5.911f Ikf=14.92m Xtb=1.5 Br=1.271 Nc=2\n" +
					"Isc=0 Ikr=0 Rc=1.61 Cjc=4.017p Mjc=.3174 Vjc=.75 Fc=.5 Cje=4.973p Mje=.4146 Vje=.75 Tr=4.673n Tf=821.7p\n" +
					"Itf=.35 Vtf=4 Xtf=7 Rb=10)",
			},
			forwardBeta: {
				value: 700,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 343, card '.MODEL 2N5088 NPN': " +
					"'BF=1122' = 1122 against this record's 700 (independent published fit, registry/card " +
					"ratio 0.62); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L343",
				source:
					"2N5088/datasheets/2n5088.pdf (onsemi 2N5088/D, Mar 2007 Rev. 4) p3, ELECTRICAL " +
					"CHARACTERISTICS (VCE = 5.0 V): 'Small-Signal Current Gain hfe, IC = 1.0 mA, f = 1.0 kHz, " +
					"MIN 350 MAX 1400' (the 1.0/10 mA DC rows are MIN-only; the 100 mA 300-900 bin is " +
					"high-current; the sole VBE(on) row is MAX-only 0.8 V at IC = 10 mA, VCE = 5.0 V)",
				derivation:
					"Printed small-signal hfe bin 350-1400 at IC = 1.0 mA, VCE = 5.0 V, f = 1 kHz; " +
					"geometric midpoint (form 2, gains): sqrt(350 * 1400) = 700.",
			},
		},
	},
	{
		// No saturationCurrent. The shared onsemi family sheet (2N5088-D) prints exactly one
		// Spice Model block and it is the 2N5088's (Bf=1.122K); no 2N5088.lib-style file and
		// no 2N5089-specific model exist on onsemi's site (guessed model URLs fall back to
		// the docs landing page), and the 2N5089 Bf=1.434K line circulating in third-party
		// compilations has no verified onsemi-hosted source. Same MAX-only Vbe reason as 2N5088.
		partIds: ["2N5089"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 900,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 239, card '.model 2N5089 NPN': " +
					"'Bf=1.434K' = 1434 against this record's 900 (independent published fit, registry/card " +
					"ratio 0.63); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L239",
				source:
					"2N5088/datasheets/2n5088.pdf (onsemi 2N5088/D, Mar 2007 Rev. 4) p3, ELECTRICAL " +
					"CHARACTERISTICS (VCE = 5.0 V), 2N5089 row: 'Small-Signal Current Gain hfe, IC = 1.0 mA, " +
					"f = 1.0 kHz, MIN 450 MAX 1800' (DC rows MIN-only; VBE(on) shared MAX-only 0.8 V row)",
				derivation:
					"Printed small-signal hfe bin 450-1800 at IC = 1.0 mA, VCE = 5.0 V, f = 1 kHz; " +
					"geometric midpoint (form 2, gains): sqrt(450 * 1800) = 900.",
			},
		},
	},
	{
		// No saturationCurrent: the sheet's only Vbe figure (VBE(sat) MAX 1.0 V at IC = 100 mA,
		// IB = 10 mA) is MAX-only with no MIN -- a limit, not a range, so no IS derivation.
		partIds: ["2SC1815"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 221.3594362,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 747, card '.model 2SC1815 NPN': " +
					"'Bf=400' = 400 against this record's 221.4 (independent published fit, registry/card " +
					"ratio 0.55); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L747",
				source:
					"2SC1815/datasheets/toshiba-2sc1815.pdf (Toshiba 2SC1815, 2007-11-01) p1, ELECTRICAL " +
					"CHARACTERISTICS (Ta = 25C): 'DC current gain hFE (1), VCE = 6 V, IC = 2 mA, MIN 70 " +
					"MAX 700' (hFE (2) is TYP 100 at IC = 150 mA -- high-current, not the small-signal " +
					"region; rank table: O 70-140, Y 120-240, GR 200-400, BL 350-700)",
				derivation:
					"Printed hFE (1) bin 70-700 at VCE = 6 V, IC = 2 mA; geometric midpoint " +
					"(form 2, gains): sqrt(70 * 700) = 221.3594362.",
			},
		},
	},
	{
		// Y rank of the same Toshiba classification table: a different gain, so its own entry
		// with the rank's midpoint -- never an alias of the unbinned part.
		partIds: ["2SC1815-Y"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 169.7056275,
				basis: "derived",
				source:
					"2SC1815/datasheets/toshiba-2sc1815.pdf (Toshiba 2SC1815, 2007-11-01) p1, hFE rank note: " +
					"'hFE classification Y: 120-240' (VCE = 6 V, IC = 2 mA per the hFE (1) row)",
				derivation:
					"Printed Y-rank hFE bin 120-240; geometric midpoint (form 2, gains): " +
					"sqrt(120 * 240) = 169.7056275.",
			},
		},
	},
	{
		// BL rank. Both observed spellings fold to one id (2SC1815BL vs 2SC1815-BL); redundant
		// spellings in one entry are tolerated by the loader, and both name the same rank.
		partIds: ["2SC1815-BL", "2SC1815BL"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 494.9747468,
				basis: "derived",
				source:
					"2SC1815/datasheets/toshiba-2sc1815.pdf (Toshiba 2SC1815, 2007-11-01) p1, hFE rank note: " +
					"'hFE classification BL: 350-700' (VCE = 6 V, IC = 2 mA per the hFE (1) row)",
				derivation:
					"Printed BL-rank hFE bin 350-700; geometric midpoint (form 2, gains): " +
					"sqrt(350 * 700) = 494.9747468.",
			},
		},
	},
	{
		partIds: ["MPSA18"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 8.3261401e-14,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): Intusoft BJT " +
					"library (Copyright Intusoft 1988-1997), Models/Transistor/BJT/BJTN.LIB line 128, card " +
					"'.MODEL MPSA18 NPN': 'IS=86.4F' = 8.64e-14 against this record's 8.326e-14 (independent " +
					"published fit, registry/card ratio 0.96); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJTN.LIB#L128",
				source:
					"Fetched manufacturer sheet (no vendored copy): onsemi MPSA18/D, Apr 2007 Rev. 4, p3, ON " +
					"CHARACTERISTICS: 'Base-Emitter On Voltage VBE(on), IC = 1.0 mA, VCE = 5.0 V, TYP 0.6 " +
					"MAX 0.7 V' (Note 2: pulse test)",
				derivation:
					"Printed VBE(on) TYP 0.6 V at IC = 1.0 mA, VCE = 5.0 V; IS = IC * exp(-Vbe / Vt) " +
					"with n = 1 (form 1): 0.001 * exp(-0.6 / 0.025852) = 8.3261401e-14.",
			},
			forwardBeta: {
				value: 1100,
				basis: "datasheet",
				source:
					"Fetched manufacturer sheet (no vendored copy): onsemi MPSA18/D, Apr 2007 Rev. 4, p3: " +
					"'DC Current Gain hFE, IC = 1.0 mA, VCE = 5.0 V, MIN 500 TYP 1100' (the 10 mA 500-1500 " +
					"bin is higher-current; the 1 mA TYP is the small-signal figure)",
				derivation:
					"Printed hFE TYP 1100 at IC = 1.0 mA, VCE = 5.0 V, transcribed (no midpoint: a TYP " +
					"is already one value).",
			},
		},
	},
	{
		// Gain AND saturation current. The printed-Vbe derivation is deliberately NOT used:
		// the only printed Vbe point is a forced-beta saturation figure at IC = 150 mA
		// (VBE(sat) 0.6-1.2 V), where series resistance dominates (form 1 takes an
		// ACTIVE-REGION Vbe at IC <= 20 mA only, owner ruling 2026-10-19). IS below is the
		// onsemi-published PSpice model's IS, preferred over any derived value by the same
		// ruling. Mixing sources across parameters of one part is admitted (coordinator
		// 2026-10-19): BF stays the derived small-signal-hfe midpoint.
		partIds: ["2N2222A"],
		class: "bjt",
		note:
			"The model's BF 929.846 is a MODPEX fit, unusually high, and is NOT adopted (BF stays " +
			"the derived 122.47); its NF 1.10496 has no schema field (the engine's bjt law carries no " +
			"emission coefficient, n = 1 by construction), so IS is taken as printed with that caveat.",
		params: {
			saturationCurrent: {
				value: 3.88184e-14,
				basis: "manufacturer-model",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): uncategorized " +
					"collection file, Models/uncategorized/spice_complete/zmodels.lib line 24, card '.MODEL " +
					"2N2222A NPN': 'IS =3.0611E-14' = 3.061e-14 against this record's 3.882e-14 (independent " +
					"published fit, registry/card ratio 1.27); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/uncategorized/spice_complete/zmodels.lib#L24",
				source:
					"Manufacturer model file https://www.onsemi.com/download/models/txt/2n2222a.lib.txt " +
					"(onsemi 2N2222A PSpice, MODPEX-generated, model generated on Feb 28, 13), card lines:\n" +
					".MODEL Q2n2222a npn\n+IS=3.88184e-14 BF=929.846 NF=1.10496 VAF=16.5003",
				modelFileUrl: "https://www.onsemi.com/download/models/txt/2n2222a.lib.txt",
				modelLine: ".MODEL Q2n2222a npn\n+IS=3.88184e-14 BF=929.846 NF=1.10496 VAF=16.5003",
			},
			forwardBeta: {
				// The DC hFE rows at small-signal currents are MIN-only; the only full DC range is
				// at 150 mA (high-current falloff). The small-signal hfe bin at 1 mA, f = 1 kHz
				// (far below fT 300 MHz, so approx. the DC beta) is the region-correct figure.
				value: 122.4744871,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): uncategorized " +
					"collection file, Models/uncategorized/spice_complete/zmodels.lib line 24, card '.MODEL " +
					"2N2222A NPN': 'BF =220' = 220 against this record's 122.5 (independent published fit, " +
					"registry/card ratio 0.56); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/uncategorized/spice_complete/zmodels.lib#L24",
				source:
					"Fetched manufacturer sheet (no vendored copy): onsemi P2N2222A/D, Jan 2013 Rev. 7, p2, " +
					"SMALL-SIGNAL CHARACTERISTICS: 'Small-Signal Current Gain hfe, IC = 1.0 mA, " +
					"VCE = 10 V, f = 1.0 kHz, MIN 50 MAX 300' (DC hFE rows at 0.1/1.0/10 mA are MIN-only; " +
					"the 150 mA 100-300 range is high-current)",
				derivation:
					"Printed small-signal hfe bin 50-300 at IC = 1.0 mA, VCE = 10 V, f = 1 kHz; " +
					"geometric midpoint (form 2, gains): sqrt(50 * 300) = 122.4744871.",
			},
		},
	},
	{
		partIds: ["BC549C"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 1.6350012e-14,
				basis: "derived",
				source:
					"BC550/datasheets/onsemi-bc550-d.pdf (onsemi BC550/D, Feb 2026 Rev. 6, family " +
					"sheet BC546/547/548/549/550), p2, ELECTRICAL CHARACTERISTICS: 'Base-Emitter On Voltage " +
					"VBE(on), VCE = 5 V, IC = 2 mA, MIN 580 TYP 660 MAX 700 mV' (one row for the family, no " +
					"per-part split)",
				derivation:
					"Printed VBE(on) TYP 0.66 V at VCE = 5 V, IC = 2 mA; IS = IC * exp(-Vbe / Vt) with " +
					"n = 1 (form 1): 0.002 * exp(-0.66 / 0.025852) = 1.6350012e-14.",
			},
			forwardBeta: {
				value: 579.6550698,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 539, card '.model BC549C NPN': " +
					"'Bf=493.2' = 493.2 against this record's 579.7 (independent published fit, registry/card " +
					"ratio 1.18); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L539",
				source:
					"BC550/datasheets/onsemi-bc550-d.pdf (onsemi BC550/D, Feb 2026 Rev. 6, p2, hFE " +
					"CLASSIFICATION table: 'C: 420 ~ 800' (the family hFE row is MIN 110 MAX 800 at VCE = 5 V, " +
					"IC = 2 mA; the C bin is the bin this part is)",
				derivation:
					"Printed C-bin hFE 420-800; geometric midpoint (form 2, gains): " +
					"sqrt(420 * 800) = 579.6550698.",
			},
		},
	},
	{
		// Wave 3. Farnell/Multicomp BC107-108-109 family sheet (V1.0 30/05/05) p3: one
		// VBE(on) row for the family (no per-part split, no TYP), so IS is shared with
		// BC109 below. DC hFE bins are per part at the same bias, so BF differs.
		partIds: ["BC108"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 6.3312899e-14,
				basis: "derived",
				source:
					"BC109/datasheets/farnell-bc107-bc108-bc109.pdf (Multicomp BC107/BC108/BC109, V1.0 " +
					"30/05/05) p3, ELECTRICAL CHARACTERISTICS: 'Base Emitter on Voltage VBE(on), " +
					"IC = 2 mA, VCE = 5 V, MIN 0.55 MAX 0.70 V' (no TYP; one row for the family, " +
					"no per-part split; the VBE(sat) rows are MAX-only 0.83 V at 10 mA and 1.05 V " +
					"at 100 mA and yield nothing)",
				derivation:
					"Printed VBE(on) range 0.55-0.70 V at IC = 2 mA, VCE = 5 V; arithmetic " +
					"midpoint 0.625 V (form 2, printed range, no TYP); IS = IC * exp(-Vbe / Vt) " +
					"with n = 1 (form 1): 0.002 * exp(-0.625 / 0.025852) = 6.3312899e-14.",
			},
			forwardBeta: {
				value: 296.6479395,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): uncategorized " +
					"collection file, Models/uncategorized/spice_complete/zmodels.lib line 3279, card '.MODEL " +
					"BC108 NPN': 'BF =400' = 400 against this record's 296.6 (independent published fit, " +
					"registry/card ratio 0.74); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/uncategorized/spice_complete/zmodels.lib#L3279",
				source:
					"BC109/datasheets/farnell-bc107-bc108-bc109.pdf (Multicomp BC107/BC108/BC109, V1.0 " +
					"30/05/05) p3: 'DC Current Gain hFE, IC = 2 mA, VCE = 5 V: BC108 MIN 110 MAX 800' " +
					"(BC107 110-450 and BC109 200-800 are the sibling rows; the small-signal hfe " +
					"row at f = 1 kHz reads BC108 125-900 and is not used -- the DC bin at the " +
					"same bias is the quantity the law wants, per the 2N3904/2SC1815 precedent)",
				derivation:
					"Printed BC108 DC hFE bin 110-800 at IC = 2 mA, VCE = 5 V; geometric " +
					"midpoint (form 2, gains): sqrt(110 * 800) = 296.6479395.",
			},
		},
	},
	{
		// Wave 3. Same family VBE(on) row as BC108 (shared IS); own DC hFE bin.
		partIds: ["BC109"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 6.3312899e-14,
				basis: "derived",
				source:
					"BC109/datasheets/farnell-bc107-bc108-bc109.pdf (Multicomp BC107/BC108/BC109, V1.0 " +
					"30/05/05) p3, ELECTRICAL CHARACTERISTICS: 'Base Emitter on Voltage VBE(on), " +
					"IC = 2 mA, VCE = 5 V, MIN 0.55 MAX 0.70 V' (no TYP; one row for the family, " +
					"no per-part split; the VBE(sat) rows are MAX-only and yield nothing)",
				derivation:
					"Printed VBE(on) range 0.55-0.70 V at IC = 2 mA, VCE = 5 V; arithmetic " +
					"midpoint 0.625 V (form 2, printed range, no TYP); IS = IC * exp(-Vbe / Vt) " +
					"with n = 1 (form 1): 0.002 * exp(-0.625 / 0.025852) = 6.3312899e-14.",
			},
			forwardBeta: {
				value: 400,
				basis: "derived",
				source:
					"BC109/datasheets/farnell-bc107-bc108-bc109.pdf (Multicomp BC107/BC108/BC109, V1.0 " +
					"30/05/05) p3: 'DC Current Gain hFE, IC = 2 mA, VCE = 5 V: BC109 MIN 200 MAX 800' " +
					"(the small-signal hfe row at f = 1 kHz reads BC109 240-900 and is not used, " +
					"same reason as BC108)",
				derivation:
					"Printed BC109 DC hFE bin 200-800 at IC = 2 mA, VCE = 5 V; geometric " +
					"midpoint (form 2, gains): sqrt(200 * 800) = 400.",
			},
		},
	},
	{
		// Wave 3. Same onsemi BC550/D family sheet as BC549C (one VBE(on) row, C bin).
		partIds: ["BC550C"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 1.6350012e-14,
				basis: "derived",
				source:
					"BC550/datasheets/onsemi-bc550-d.pdf (onsemi BC550/D, Feb 2026 Rev. 6, family " +
					"sheet BC546/547/548/549/550), p2, ELECTRICAL CHARACTERISTICS: 'Base-Emitter On " +
					"Voltage VBE(on), VCE = 5 V, IC = 2 mA, MIN 580 TYP 660 MAX 700 mV' (one row " +
					"for the family, no per-part split)",
				derivation:
					"Printed VBE(on) TYP 0.66 V at VCE = 5 V, IC = 2 mA; IS = IC * exp(-Vbe / Vt) " +
					"with n = 1 (form 1): 0.002 * exp(-0.66 / 0.025852) = 1.6350012e-14.",
			},
			forwardBeta: {
				value: 579.6550698,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 540, card '.model BC550C NPN': " +
					"'Bf=493.2' = 493.2 against this record's 579.7 (independent published fit, registry/card " +
					"ratio 1.18); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L540",
				source:
					"BC550/datasheets/onsemi-bc550-d.pdf (onsemi BC550/D, Feb 2026 Rev. 6), p2, hFE " +
					"CLASSIFICATION table: 'C: 420 ~ 800' (the family hFE row is MIN 110 MAX 800 " +
					"at VCE = 5 V, IC = 2 mA; the C bin is the bin this part is)",
				derivation:
					"Printed C-bin hFE 420-800; geometric midpoint (form 2, gains): " +
					"sqrt(420 * 800) = 579.6550698.",
			},
		},
	},
	{
		// Wave 3. Same family VBE(on) row (shared IS); B bin.
		partIds: ["BC549B"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 1.6350012e-14,
				basis: "derived",
				source:
					"BC550/datasheets/onsemi-bc550-d.pdf (onsemi BC550/D, Feb 2026 Rev. 6, family " +
					"sheet BC546/547/548/549/550), p2: 'Base-Emitter On Voltage VBE(on), VCE = 5 V, " +
					"IC = 2 mA, MIN 580 TYP 660 MAX 700 mV' (one row for the family)",
				derivation:
					"Printed VBE(on) TYP 0.66 V at VCE = 5 V, IC = 2 mA; IS = IC * exp(-Vbe / Vt) " +
					"with n = 1 (form 1): 0.002 * exp(-0.66 / 0.025852) = 1.6350012e-14.",
			},
			forwardBeta: {
				value: 300,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 369, card '.MODEL BC549B NPN': " +
					"'BF=458.7' = 458.7 against this record's 300 (independent published fit, registry/card " +
					"ratio 0.65); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L369",
				source:
					"BC550/datasheets/onsemi-bc550-d.pdf (onsemi BC550/D, Feb 2026 Rev. 6), p2, hFE " +
					"CLASSIFICATION table: 'B: 200 ~ 450'",
				derivation:
					"Printed B-bin hFE 200-450; geometric midpoint (form 2, gains): " +
					"sqrt(200 * 450) = 300.",
			},
		},
	},
	{
		// Wave 3. Same family VBE(on) row (shared IS); B bin (same bin as BC549B: the
		// classification table is by letter, not by part number).
		partIds: ["BC547B"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 1.6350012e-14,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): Bordodynov's " +
					"Electronics lib copy of the LTspice standard library, Models/uncategorized/Bordodynovs " +
					"Electronics Lib/cmp/standard.bjt line 393, card '.MODEL BC547B__ NPN': 'IS=20F' = 2e-14 " +
					"against this record's 1.635e-14 (independent published fit, registry/card ratio 0.82); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/uncategorized/Bordodynovs%20Electronics%20Lib/cmp/standard.bjt#L393",
				source:
					"BC550/datasheets/onsemi-bc550-d.pdf (onsemi BC550/D, Feb 2026 Rev. 6, family " +
					"sheet BC546/547/548/549/550), p2: 'Base-Emitter On Voltage VBE(on), VCE = 5 V, " +
					"IC = 2 mA, MIN 580 TYP 660 MAX 700 mV' (one row for the family)",
				derivation:
					"Printed VBE(on) TYP 0.66 V at VCE = 5 V, IC = 2 mA; IS = IC * exp(-Vbe / Vt) " +
					"with n = 1 (form 1): 0.002 * exp(-0.66 / 0.025852) = 1.6350012e-14.",
			},
			forwardBeta: {
				value: 300,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): Bordodynov's " +
					"Electronics lib copy of the LTspice standard library, Models/uncategorized/Bordodynovs " +
					"Electronics Lib/cmp/standard.bjt line 392, card '.model BC547B_ NPN': 'Bf=300' = 300 " +
					"against this record's 300 (identical figure -- a mirror of the cited card or the same " +
					"printed number, so a transcription check, not an independent witness); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/uncategorized/Bordodynovs%20Electronics%20Lib/cmp/standard.bjt#L392",
				source:
					"BC550/datasheets/onsemi-bc550-d.pdf (onsemi BC550/D, Feb 2026 Rev. 6), p2, hFE " +
					"CLASSIFICATION table: 'B: 200 ~ 450' (by bin letter)",
				derivation:
					"Printed B-bin hFE 200-450; geometric midpoint (form 2, gains): " +
					"sqrt(200 * 450) = 300.",
			},
		},
	},
	{
		// Wave 3. Unsuffixed BC550: the family VBE(on) row (shared IS) but no bin of its
		// own, so BF is the family DC row's midpoint (the unbinned 2SC1815 precedent).
		partIds: ["BC550"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 1.6350012e-14,
				basis: "derived",
				source:
					"BC550/datasheets/onsemi-bc550-d.pdf (onsemi BC550/D, Feb 2026 Rev. 6, family " +
					"sheet BC546/547/548/549/550), p2: 'Base-Emitter On Voltage VBE(on), VCE = 5 V, " +
					"IC = 2 mA, MIN 580 TYP 660 MAX 700 mV' (one row for the family)",
				derivation:
					"Printed VBE(on) TYP 0.66 V at VCE = 5 V, IC = 2 mA; IS = IC * exp(-Vbe / Vt) " +
					"with n = 1 (form 1): 0.002 * exp(-0.66 / 0.025852) = 1.6350012e-14.",
			},
			forwardBeta: {
				value: 296.6479395,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): Intusoft BJT " +
					"library (Copyright Intusoft 1988-1997), Models/Transistor/BJT/BJTN.LIB line 177, card " +
					"'.MODEL BC550 NPN': 'BF=312' = 312 against this record's 296.6 (independent published " +
					"fit, registry/card ratio 0.95); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJTN.LIB#L177",
				source:
					"BC550/datasheets/onsemi-bc550-d.pdf (onsemi BC550/D, Feb 2026 Rev. 6), p2, " +
					"family hFE row: MIN 110 MAX 800 at VCE = 5 V, IC = 2 mA (no bin for the " +
					"unsuffixed label)",
				derivation:
					"Printed family hFE 110-800; geometric midpoint (form 2, gains): " +
					"sqrt(110 * 800) = 296.6479395.",
			},
		},
	},
	{
		// Wave 3. 2N3903: the family sheet's only Vbe basis is the VBE(sat) row shared
		// with 2N3904 (IC = 10 mA, within the IC <= 20 mA gate; identical row, conditions
		// and arithmetic to the shipped 2N3904 IS, which stands). BF is the 2N3903 DC
		// row at the same bias (sibling-consistent with 2N3904's DC bin, not the
		// small-signal hfe row).
		partIds: ["2N3903"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 2.5150964e-15,
				basis: "derived",
				source:
					"2N3903/datasheets/2n3903.pdf (onsemi 2N3903/D, Aug 2021 Rev. 9, family sheet " +
					"2N3903 + 2N3904) p2, ELECTRICAL CHARACTERISTICS: 'Base-Emitter Saturation " +
					"Voltage VBE(sat), IC = 10 mA, IB = 1.0 mA, MIN 0.65 MAX 0.85 V' (shared row, " +
					"no per-part split; the 50 mA row is MAX-only 0.95 V)",
				derivation:
					"Printed VBE(sat) range 0.65-0.85 V at IC = 10 mA, IB = 1.0 mA (IC within the " +
					"form-1 IC <= 20 mA gate); arithmetic midpoint 0.75 V (form 2); " +
					"IS = IC * exp(-Vbe / Vt) with n = 1 (form 1): " +
					"0.01 * exp(-0.75 / 0.025852) = 2.5150964e-15 -- same row and arithmetic " +
					"as the shipped 2N3904 IS.",
			},
			forwardBeta: {
				value: 86.6025404,
				basis: "derived",
				source:
					"2N3903/datasheets/2n3903.pdf (onsemi 2N3903/D, Aug 2021 Rev. 9) p2, ON " +
					"CHARACTERISTICS: 'DC Current Gain hFE, IC = 10 mA, VCE = 1.0 V: 2N3903 " +
					"MIN 50 MAX 150' (2N3904 100-300 is the sibling row; the small-signal hfe " +
					"row at 1 mA reads 2N3903 50-200 and is not used -- the DC bin at the same " +
					"bias as 2N3904 is the sibling-consistent quantity)",
				derivation:
					"Printed 2N3903 DC hFE bin 50-150 at IC = 10 mA, VCE = 1.0 V; geometric " +
					"midpoint (form 2, gains): sqrt(50 * 150) = 86.6025404.",
			},
		},
	},
	{
		// Wave 3. Toshiba 2SC732TM rank entry (the 2SC1815-Y/BL precedent: a rank is a
		// different gain, so its own entry, never an alias). VBE TYP transcribed (active
		// region, IC = 2 mA); BF is the GR rank's midpoint.
		partIds: ["2SC732TM-GR"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 2.4071917e-14,
				basis: "derived",
				source:
					"2SC732/datasheets/toshiba-2sc732.pdf (Toshiba 2SC732TM, 1996-09-02, scan p1, " +
					"read visually, no text layer) ELECTRICAL CHARACTERISTICS (Ta = 25C): " +
					"'Base-Emitter Voltage VBE, VCE = 6 V, IC = 2 mA: TYP 0.65 V' (no MIN/MAX; " +
					"the VCE(sat) row is MAX-only 0.3 V at IC = 10 mA and yields nothing)",
				derivation:
					"Printed VBE TYP 0.65 V at VCE = 6 V, IC = 2 mA (active region, within the " +
					"form-1 IC <= 20 mA gate); IS = IC * exp(-Vbe / Vt) with n = 1 (form 1): " +
					"0.002 * exp(-0.65 / 0.025852) = 2.4071917e-14.",
			},
			forwardBeta: {
				value: 282.8427125,
				basis: "derived",
				source:
					"2SC732/datasheets/toshiba-2sc732.pdf (Toshiba 2SC732TM, 1996-09-02, scan p1) " +
					"ELECTRICAL CHARACTERISTICS: 'DC Current Gain hFE (Note), VCE = 6 V, IC = 2 mA: " +
					"MIN 200 MAX 700' with Note 'hFE Classification GR: 200~400, BL: 350~600'",
				derivation:
					"Printed GR-rank hFE bin 200-400 at VCE = 6 V, IC = 2 mA; geometric midpoint " +
					"(form 2, gains): sqrt(200 * 400) = 282.8427125.",
			},
		},
	},
	{
		// Wave 3. NEC 2SC945 rank entry (same rank-entry precedent). VBE TYP transcribed
		// (active region, IC = 1 mA); BF is the P rank's midpoint.
		partIds: ["2SC945-P"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 3.8411256e-14,
				basis: "derived",
				source:
					"2SC945/datasheets/nec-2sc945.pdf (NEC 2SC945 databook p258, scan, read " +
					"visually, no text layer) ELECTRICAL CHARACTERISTICS (Ta = 25C): 'VBE Base to " +
					"Emitter Voltage, MIN 0.55 TYP 0.62 MAX 0.65 V at VCE = 6.0 V, IC = 1.0 mA' " +
					"(the VBE(sat) row is TYP 0.86 MAX 1.0 V at IC = 100 mA -- high-current, excluded)",
				derivation:
					"Printed VBE TYP 0.62 V at VCE = 6.0 V, IC = 1.0 mA (active region, within " +
					"the form-1 IC <= 20 mA gate); IS = IC * exp(-Vbe / Vt) with n = 1 (form 1): " +
					"0.001 * exp(-0.62 / 0.025852) = 3.8411256e-14.",
			},
			forwardBeta: {
				value: 282.8427125,
				basis: "derived",
				source:
					"2SC945/datasheets/nec-2sc945.pdf (NEC 2SC945 databook p258) ELECTRICAL " +
					"CHARACTERISTICS: 'hFE2 DC Current Gain, MIN 90 TYP 200 MAX 600 at VCE = 6.0 V, " +
					"IC = 1.0 mA' with 'Classification of hFE2: R 90-180, Q 135-270, P 200-400, " +
					"K 300-600; hFE2 Test Conditions: VCE = 6.0 V, IC = 1.0 mA'",
				derivation:
					"Printed P-rank hFE2 bin 200-400 at VCE = 6.0 V, IC = 1.0 mA; geometric " +
					"midpoint (form 2, gains): sqrt(200 * 400) = 282.8427125.",
			},
		},
	},
	{
		// Unbinned 2SC945: the family hFE2 row prints a TYP, so no midpoint is needed.
		partIds: ["2SC945"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 3.8411256e-14,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 767, card '.model 2sc945 npn': " +
					"'IS=3.577E-14' = 3.577e-14 against this record's 3.841e-14 (independent published fit, " +
					"registry/card ratio 1.07); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L767",
				source:
					"2SC945/datasheets/nec-2sc945.pdf (NEC 2SC945 databook p258, scan, read " +
					"visually, no text layer) ELECTRICAL CHARACTERISTICS (Ta = 25C): 'VBE Base to " +
					"Emitter Voltage, MIN 0.55 TYP 0.62 MAX 0.65 V at VCE = 6.0 V, IC = 1.0 mA'",
				derivation:
					"Printed VBE TYP 0.62 V at VCE = 6.0 V, IC = 1.0 mA (active region, within " +
					"the form-1 IC <= 20 mA gate); IS = IC * exp(-Vbe / Vt) with n = 1 (form 1): " +
					"0.001 * exp(-0.62 / 0.025852) = 3.8411256e-14.",
			},
			forwardBeta: {
				value: 200,
				basis: "datasheet",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 767, card '.model 2sc945 npn': " +
					"'BF=2.382E+02' = 238.2 against this record's 200 (independent published fit, " +
					"registry/card ratio 0.84); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L767",
				source:
					"2SC945/datasheets/nec-2sc945.pdf (NEC 2SC945 databook p258) ELECTRICAL " +
					"CHARACTERISTICS: 'hFE2 DC Current Gain, MIN 90 TYP 200 MAX 600 at VCE = 6.0 V, " +
					"IC = 1.0 mA' (the hFE1 row at 0.1 mA is not the law's bias; the rank table " +
					"splits R/Q/P/K, which stay separate entries)",
			},
		},
	},
	{
		// Wave 4. No VBE row of any kind: the table prints ICBO/IEBO, hFE (no TYP),
		// VCE(sat) MAX-only and no VBE(on)/VBE(sat) TYP or range, so IS has no
		// datasheet input. Wave 2 (transistor-records wave 2, 2026-10-23) adds IS
		// from the Intusoft QSC2458 card in the third-party KiCad-Spice-Library
		// collection (community basis, provisional per the owner decision); BF stays
		// datasheet-derived above and no other card field is used.
		partIds: ["2SC2458"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 15.2e-15,
				basis: "community",
				source:
					"KiCad-Spice-Library third-party collection, BJTN.LIB " +
					"(Intusoft-authored cards; file header 'Copyright Intusoft 1988-1997 / " +
					"All Rights Reserved') " +
					"https://raw.githubusercontent.com/kicad-spice-library/KiCad-Spice-Library/bb50ca6f03308666ac1decdc10449534cb60d45a/Models/Transistor/BJT/BJTN.LIB " +
					"(read 2026-10-23): the QSC2458 card (line 1161) value and its own " +
					"descriptive comment (line 1164), verbatim:\n" +
					"IS=15.2F\n* Toshiba 50 Volt  .15 Amp  400 MHz  SiNPN  Transistor  11-17-1993. " +
					"The card's BF = 260 is not taken (BF already comes from the Toshiba " +
					"datasheet in this record); no other card field is used.",
				sourceKind: "published-spice-model",
				url: "https://raw.githubusercontent.com/kicad-spice-library/KiCad-Spice-Library/bb50ca6f03308666ac1decdc10449534cb60d45a/Models/Transistor/BJT/BJTN.LIB",
				quote:
					"IS=15.2F\n* Toshiba 50 Volt  .15 Amp  400 MHz  SiNPN  Transistor  11-17-1993",
				author: "Intusoft",
				retrievedDate: "2026-10-23",
				whyNoBetterSource:
					"The Toshiba 2SC2458(L) 1996-09-02 datasheet prints no VBE row " +
					"(wave-1 note row 1: VCE(sat) is MAX-only, so IS has no input); " +
					"Toshiba's own LTspice bundle carries neither 2SC2458 nor 2SC2459 " +
					"and its models are encrypted with a no-reverse-engineering term, " +
					"so they cannot be read or quoted. This third-party collection " +
					"hosts the only published card for the part, taken here under " +
					"the 2026-10-23 owner decision as a provisional community value, " +
					"not a manufacturer value.",
			},
			forwardBeta: {
				value: 221.3594362,
				basis: "derived",
				source:
					"2SC2458/datasheets/toshiba-2sc2458.pdf (Toshiba 2SC2458(L), 1996-09-02, scan, " +
					"read visually, no text layer) p1, ELECTRICAL CHARACTERISTICS (Ta = 25C): 'DC " +
					"Current Gain hFE (Note), VCE = 6 V, IC = 2 mA, MIN 70 MAX 700' with 'Note: hFE " +
					"Classification O: 70~140, Y: 120~240, GR: 200~400, BL: 350~700'",
				derivation:
					"Printed hFE bin 70-700 at VCE = 6 V, IC = 2 mA; geometric midpoint " +
					"(form 2, gains): sqrt(70 * 700) = 221.3594362.",
			},
		},
	},
	{
		partIds: ["2SC2458GR", "2SC2458-GR"],
		class: "bjt",
		note:
			"The hyphenated and unhyphenated spellings fold to one id (2sc2458gr); both are " +
			"corpus-observed (boss-tr-2 uses 2SC2458GR, boss-ge-7 uses 2SC2458-GR).",
		params: {
			saturationCurrent: {
				value: 15.2e-15,
				basis: "community",
				source:
					"KiCad-Spice-Library third-party collection, BJTN.LIB " +
					"(Intusoft-authored cards; file header 'Copyright Intusoft 1988-1997 / " +
					"All Rights Reserved') " +
					"https://raw.githubusercontent.com/kicad-spice-library/KiCad-Spice-Library/bb50ca6f03308666ac1decdc10449534cb60d45a/Models/Transistor/BJT/BJTN.LIB " +
					"(read 2026-10-23): the QSC2458 card (line 1161) value and its own " +
					"descriptive comment (line 1164), verbatim:\n" +
					"IS=15.2F\n* Toshiba 50 Volt  .15 Amp  400 MHz  SiNPN  Transistor  11-17-1993. " +
					"The card's BF = 260 is not taken (BF already comes from the Toshiba " +
					"datasheet in this record); no other card field is used. The GR rank " +
					"shares the unbinned die's card: the card names no rank.",
				sourceKind: "published-spice-model",
				url: "https://raw.githubusercontent.com/kicad-spice-library/KiCad-Spice-Library/bb50ca6f03308666ac1decdc10449534cb60d45a/Models/Transistor/BJT/BJTN.LIB",
				quote:
					"IS=15.2F\n* Toshiba 50 Volt  .15 Amp  400 MHz  SiNPN  Transistor  11-17-1993",
				author: "Intusoft",
				retrievedDate: "2026-10-23",
				whyNoBetterSource:
					"The Toshiba 2SC2458(L) 1996-09-02 datasheet prints no VBE row " +
					"(wave-1 note row 1: VCE(sat) is MAX-only, so IS has no input); " +
					"Toshiba's own LTspice bundle carries neither 2SC2458 nor 2SC2459 " +
					"and its models are encrypted with a no-reverse-engineering term, " +
					"so they cannot be read or quoted. This third-party collection " +
					"hosts the only published card for the part, taken here under " +
					"the 2026-10-23 owner decision as a provisional community value, " +
					"not a manufacturer value.",
			},
			forwardBeta: {
				value: 282.8427125,
				basis: "derived",
				source:
					"2SC2458/datasheets/toshiba-2sc2458.pdf (Toshiba 2SC2458(L), 1996-09-02, scan) p1, " +
					"'Note: hFE Classification GR: 200~400' (VCE = 6 V, IC = 2 mA per the table row)",
				derivation:
					"Printed GR-rank hFE bin 200-400; geometric midpoint (form 2, gains): " +
					"sqrt(200 * 400) = 282.8427125.",
			},
		},
	},
	{
		// Wave 4. Toshiba mini-package selection table (single-page scan T-27-01 via a
		// third-party host; original Toshiba publication). The hFE cell for the 2SC3378
		// column reads 200~700 at VCE = 6 V, IC = 2 mA; the column map is anchored three
		// ways (the 2SC2458(L) column reads VCEO 50, hFE 70~700 at VCE = 6 V, IC = 2 mA,
		// all matching its verified datasheet). No VBE row exists anywhere in the table,
		// so IS has no input. The GR rank the corpus uses (2SC3378GR) has no citable row:
		// the rank footnotes cannot be mapped to this column, so those devices stay on
		// class defaults and are reported, not filled.
		partIds: ["2SC3378"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 374.1657387,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): vendor file " +
					"under Models/Manufacturer/TRT-Electronics, " +
					"Models/Manufacturer/TRT-Electronics/2sc3378.lib line 1, card '.model Q2SC3378 NPN': " +
					"'Bf=300' = 300 against this record's 374.2 (independent published fit, registry/card " +
					"ratio 1.25); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Manufacturer/TRT-Electronics/2sc3378.lib#L1",
				source:
					"Toshiba MINI PACKAGE SERIES selection table (67C 09139 D T-27-01, third-party " +
					"scan) 'MINI PACKAGE SERIES' table, 2SC3378 column, read visually at high " +
					"magnification: 'hFE, VCE = 6 V, IC = 2 mA, 200~700' (no MIN/MAX/TYP split, no " +
					"VBE row in the table)",
				derivation:
					"Printed hFE range 200-700 at VCE = 6 V, IC = 2 mA; geometric midpoint " +
					"(form 2, gains): sqrt(200 * 700) = 374.1657387.",
			},
		},
	},
	{
		partIds: ["2SC732TM-BL"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 2.4071917e-14,
				basis: "derived",
				source:
					"2SC732/datasheets/toshiba-2sc732.pdf (Toshiba 2SC732TM, 1996-09-02, scan, read " +
					"visually, no text layer) p1, ELECTRICAL CHARACTERISTICS (Ta = 25C): 'Base-Emitter " +
					"Voltage VBE, VCE = 6 V, IC = 2 mA, TYP 0.65 V' (shared row, GR precedent wave 3)",
				derivation:
					"Printed VBE TYP 0.65 V at VCE = 6 V, IC = 2 mA (active region, within the " +
					"form-1 IC <= 20 mA gate); IS = IC * exp(-Vbe / Vt) with n = 1 (form 1): " +
					"0.002 * exp(-0.65 / 0.025852) = 2.4071917e-14.",
			},
			forwardBeta: {
				value: 458.2575695,
				basis: "derived",
				source:
					"2SC732/datasheets/toshiba-2sc732.pdf (Toshiba 2SC732TM, 1996-09-02, scan) p1, " +
					"'Note: hFE Classification GR: 200~400, BL: 350~600' (VCE = 6 V, IC = 2 mA per " +
					"the table row; only these two ranks exist in this sheet)",
				derivation:
					"Printed BL-rank hFE bin 350-600; geometric midpoint (form 2, gains): " +
					"sqrt(350 * 600) = 458.2575695.",
			},
		},
	},
	{
		// Wave 4. VBE(on) is MAX-only (0.77 V at 10 mA), a limit, not a range: no IS.
		partIds: ["BC109C"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 520,
				basis: "datasheet",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 526, card '.model BC109C NPN': " +
					"'Bf=677' = 677 against this record's 520 (independent published fit, registry/card ratio " +
					"0.77); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L526",
				source:
					"BC109C/datasheets/farnell-bc109c.pdf (Farnell/Multicomp BC109 Series V1.0 " +
					"08/04/06) p2, Electrical Characteristics (Ta = 25C), C Group: 'DC Current hFE, " +
					"IC = 2 mA, VCE = 5 V, MIN 420 MAX 800'; and the original Philips BC107/108/109 " +
					"Product Specification 1997 Sep 03 (M3D125, order 9397 750 02817) p4, same row " +
					"and conditions with a TYP column: 'BC108C/BC109C MIN 420 TYP 520 MAX 800'",
			},
		},
	},
	{
		// Wave 4. The onsemi BC237/D family sheet names BC237, BC237B, BC237C and BC239C
		// only: bare BC239 has DC hFE rows nowhere in it (fT/NF/VCEO rows only), so bare
		// BC239 is excluded (see the wave-4 report); BC239C carries the C-bin row.
		partIds: ["BC239C"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 7.6822511e-14,
				basis: "derived",
				source:
					"BC239C/datasheets/onsemi-bc237-d.pdf (onsemi BC237/D, Rev. 4 Jan 2006) p2, ON " +
					"CHARACTERISTICS: 'Base-Emitter On Voltage VBE(on), IC = 2.0 mA, VCE = 5.0 V, " +
					"MIN 0.55 TYP 0.62 MAX 0.7 V' (ungraded family row; C-bin table below it)",
				derivation:
					"Printed VBE(on) TYP 0.62 V at IC = 2.0 mA, VCE = 5.0 V (active region, within " +
					"the form-1 IC <= 20 mA gate); IS = IC * exp(-Vbe / Vt) with n = 1 (form 1): " +
					"0.002 * exp(-0.62 / 0.025852) = 7.6822511e-14.",
			},
			forwardBeta: {
				value: 500,
				basis: "datasheet",
				source:
					"BC239C/datasheets/onsemi-bc237-d.pdf (onsemi BC237/D, Rev. 4 Jan 2006) p2: 'DC " +
					"Current Gain hFE, IC = 2.0 mA, VCE = 5.0 V, BC237C/239C MIN 380 TYP 500 MAX 800'",
			},
		},
	},
	{
		// Wave 4. Philips original (M3D125) prints TYP hFE for the B bin and a TYP VBE for
		// the family; the Farnell/Multicomp reprint of the same family prints MIN/MAX only.
		partIds: ["BC107B"],
		class: "bjt",
		note:
			"saturationCurrent disagrees with KiCad-Spice-Library (Models/Transistor/BJT/BJT.lib line " +
			"521, card '.model BC107B NPN': 'Is=7.049f' = 7.049e-15, ltwiki Standard.* mirror): this " +
			"record's 7.682e-14 is 11x above it; not corroborated, kept as cited because the two are " +
			"different fits with their own emission coefficients, flagged for a bench check.",
		params: {
			saturationCurrent: {
				value: 7.6822511e-14,
				basis: "derived",
				source:
					"Philips Semiconductors BC107/108/109 Product Specification 1997 Sep 03 (M3D125, " +
					"order 9397 750 02817; original-manufacturer sheet via third-party host) p4, " +
					"CHARACTERISTICS (Tj = 25C): 'VBE base-emitter voltage, IC = 2 mA, VCE = 5 V, " +
					"note 2, MIN 550 TYP 620 MAX 700 mV' (ungraded family row)",
				derivation:
					"Printed VBE TYP 0.62 V at IC = 2 mA, VCE = 5 V (active region, within the " +
					"form-1 IC <= 20 mA gate); IS = IC * exp(-Vbe / Vt) with n = 1 (form 1): " +
					"0.002 * exp(-0.62 / 0.025852) = 7.6822511e-14.",
			},
			forwardBeta: {
				value: 290,
				basis: "datasheet",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 521, card '.model BC107B NPN': " +
					"'Bf=381.7' = 381.7 against this record's 290 (independent published fit, registry/card " +
					"ratio 0.76); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L521",
				source:
					"Philips Semiconductors BC107/108/109 Product Specification 1997 Sep 03 (M3D125) " +
					"p4: 'hFE DC current gain, IC = 2 mA, VCE = 5 V: BC107B/BC108B/BC109B MIN 200 " +
					"TYP 290 MAX 450'",
			},
		},
	},
	{
		// Wave 4. NJ Semi-Conductors TO-106 sheet: VBE(on) is MAX-only (0.75 V at 100 uA),
		// a limit, not a range: no IS. The small-signal hfe 50-1100 row is the 1 kHz
		// figure, not the law's DC quantity.
		partIds: ["2N5133"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 220,
				basis: "datasheet",
				source:
					"2N5133/datasheets/njsemi-2n5133.pdf (NJ Semi-Conductors 2N5133, Fairchild-process " +
					"TO-106) p1, ELECTRICAL CHARACTERISTICS (25C free air): 'DC Current Gain hFE, " +
					"IC = 1.0 mA, VCE = 5.0 V, MIN 60 TYP 220 MAX 1000'",
			},
		},
	},
	{
		// Wave 4. Fairchild 1997 sheet: hFE bins 50-150 at 2 mA and 25 MIN at 50 mA, no TYP
		// column; VBE(sat) is MAX-only (0.95 V at 50 mA), high-current saturation: no IS.
		partIds: ["2N4125"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 86.6025404,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 324, card '.MODEL 2N4125 PNP': " +
					"'BF=85.04' = 85.04 against this record's 86.6 (independent published fit, registry/card " +
					"ratio 1.02); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L324",
				source:
					"2N4125/datasheets/2n4125.pdf (Fairchild Semiconductor 2N4125, 1997, PNP General " +
					"Purpose Amplifier) p2, Electrical Characteristics (TA = 25C): 'hFE DC Current " +
					"Gain, VCE = 1.0 V, IC = 2.0 mA, MIN 50 MAX 150' (the 50 mA row is MIN-only 25; " +
					"pulse test; the small-signal hfe 50-200 row at 1 kHz is not DC hFE)",
				derivation:
					"Printed hFE bin 50-150 at VCE = 1.0 V, IC = 2.0 mA; geometric midpoint " +
					"(form 2, gains): sqrt(50 * 150) = 86.6025404.",
			},
		},
	},
	{
		// Wave 4. Central 2N4123-2N4126 R1: the hFE row prints MIN/MAX only (no TYP);
		// VBE(SAT) is MAX-only (0.95 V at 50 mA): no IS. 2N4126 is the PNP column (the
		// header prints 2N4123/4124 NPN and 2N4125/4126 PNP); polarity is structural.
		partIds: ["2N4126"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 207.8460969,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 237, card '.model 2N4126 PNP': " +
					"'Bf=203.7' = 203.7 against this record's 207.8 (independent published fit, registry/card " +
					"ratio 1.02); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L237",
				source:
					"Central Semiconductor 2N4123-2N4126 R1 (12-Jan-2016, my.centralsemi.com) p1, " +
					"ELECTRICAL CHARACTERISTICS (TA = 25C): 'hFE, VCE = 1.0 V, IC = 2.0 mA, 2N4126 " +
					"MIN 120 MAX 360' (the 50 mA row is MIN-only 60; small-signal hfe at 1 kHz not used)",
				derivation:
					"Printed hFE bin 120-360 at VCE = 1.0 V, IC = 2.0 mA; geometric midpoint " +
					"(form 2, gains): sqrt(120 * 360) = 207.8460969.",
			},
		},
	},
	{
		// Wave 4. NEC 2SA733 D10868EJ7V0DS00 (7th ed, March 2004): the hFE row prints a TYP
		// for the family; the rank table splits R/Q/P/E. Unbinned plus the corpus-used P
		// rank (boss-vb-2 Q10 '2SA733-P'); R/Q/E stay out (no corpus use, same sheet).
		partIds: ["2SA733"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 3.8411256e-14,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 766, card '.model 2sa733 pnp': " +
					"'IS=55.9f' = 5.59e-14 against this record's 3.841e-14 (independent published fit, " +
					"registry/card ratio 0.69); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L766",
				source:
					"NEC 2SA733 DATA SHEET Doc. No. D10868EJ7V0DS00 (7th edition, March 2004, via " +
					"renesas.com) p1, ELECTRICAL CHARACTERISTICS (TA = 25C): 'Base to Emitter Voltage " +
					"VBE, VCE = -6.0 V, IC = -1.0 mA, MIN -0.58 TYP -0.62 MAX -0.68 V' magnitudes (PNP)",
				derivation:
					"Printed VBE TYP 0.62 V at IC = 1.0 mA (active region, within the form-1 IC <= " +
					"20 mA gate); IS = IC * exp(-Vbe / Vt) with n = 1 (form 1): " +
					"0.001 * exp(-0.62 / 0.025852) = 3.8411256e-14. Polarity is structural.",
			},
			forwardBeta: {
				value: 200,
				basis: "datasheet",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 766, card '.model 2sa733 pnp': " +
					"'BF=205' = 205 against this record's 200 (independent published fit, registry/card ratio " +
					"0.98); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L766",
				source:
					"NEC 2SA733 DATA SHEET D10868EJ7V0DS00 (7th ed, March 2004) p1: 'DC Current Gain " +
					"hFE, VCE = -6.0 V, IC = -1.0 mA, MIN 90 TYP 200 MAX 600' (the hFE(2) row at " +
					"-150 mA is high-current falloff; ranks R/Q/P/E split below)",
			},
		},
	},
	{
		partIds: ["2SA733-P", "2SA733P"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 3.8411256e-14,
				basis: "derived",
				source:
					"NEC 2SA733 DATA SHEET D10868EJ7V0DS00 (7th ed, March 2004) p1: shared VBE row " +
					"'MIN -0.58 TYP -0.62 MAX -0.68 V at VCE = -6.0 V, IC = -1.0 mA' magnitudes (PNP; " +
					"the two spellings fold to one id, 2SC945-P precedent)",
				derivation:
					"Printed VBE TYP 0.62 V at IC = 1.0 mA (form-1 gate met); IS = " +
					"0.001 * exp(-0.62 / 0.025852) = 3.8411256e-14.",
			},
			forwardBeta: {
				value: 282.8427125,
				basis: "derived",
				source:
					"NEC 2SA733 DATA SHEET D10868EJ7V0DS00 (7th ed, March 2004) p1, 'CLASSIFICATION " +
					"OF hFE, Rank P, Range 200 to 400 (hFE Test Conditions: VCE = -6.0 V, IC = -1.0 mA)'",
				derivation:
					"Printed P-rank hFE bin 200-400; geometric midpoint (form 2, gains): " +
					"sqrt(200 * 400) = 282.8427125.",
			},
		},
	},
	{
		// Wave 4. Panasonic 2SC828/2SC828A databook p293 (third-party scan of the original
		// page; doc identity disclosed: footer 'Panasonic', undated). The DC hFE row prints
		// MIN/MAX only (no TYP); VBE is MAX-only (0.8 V at 10 mA), a limit: no IS.
		// Ranks Q/R/S are printed but unused by the corpus, so only the unbinned row ships.
		partIds: ["2SC828"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 260,
				basis: "derived",
				source:
					"Panasonic 2SC828/2SC828A databook p293 (original-manufacturer page via " +
					"third-party host) ELECTRICAL CHARACTERISTICS (Ta = 25C): 'DC Current Gain hFE*, " +
					"VCE = 5 V, IC = 2 mA, min. 130, max. 520' with '*hFE Ranking Rank Q 130~260, " +
					"R 180~360, S 260~520'",
				derivation:
					"Printed hFE range 130-520 at VCE = 5 V, IC = 2 mA; geometric midpoint " +
					"(form 2, gains): sqrt(130 * 520) = 260.0.",
			},
		},
	},
	{
		// Wave 4. Toshiba 2SA1015(L) scan (1997-04-10 / 2003-03-27 reprint, same table;
		// third-party host of the Toshiba original). No active-VBE row (only VBE(sat) MAX
		// -1.1 V at -100 mA): IS excluded. Bare A1015 is a top-mark abbreviation no sheet
		// prints: excluded. Unbinned plus the corpus-used Y rank (2SA1015-Y); O/GR stay
		// out (same sheet, no corpus use).
		partIds: ["2SA1015"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 167.3320053,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 749, card '.model 2SA1015 PNP': " +
					"'Bf=110' = 110 against this record's 167.3 (independent published fit, registry/card " +
					"ratio 1.52); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L749",
				source:
					"Toshiba 2SA1015(L) Transistor Silicon PNP Epitaxial Type (PCT process), " +
					"2003-03-27 reprint of the 1997-04-10 original (third-party host) p1, ELECTRICAL " +
					"CHARACTERISTICS (Ta = 25C): 'DC current gain hFE (1) (Note), VCE = -6 V, " +
					"IC = -2 mA, 70 MIN, 400 MAX' with 'Note: hFE (1) classification O: 70~140, " +
					"Y: 120~240, GR: 200~400'",
				derivation:
					"Printed hFE(1) range 70-400 at VCE = -6 V, IC = -2 mA; geometric midpoint " +
					"(form 2, gains): sqrt(70 * 400) = 167.3320053.",
			},
		},
	},
	{
		partIds: ["2SA1015-Y", "2SA1015Y"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 169.7056275,
				basis: "derived",
				source:
					"Toshiba 2SA1015(L) 2003-03-27 p1, 'Note: hFE (1) classification Y: 120~240' " +
					"(VCE = -6 V, IC = -2 mA per the table row; the two spellings fold to one id)",
				derivation:
					"Printed Y-rank hFE(1) bin 120-240; geometric midpoint (form 2, gains): " +
					"sqrt(120 * 240) = 169.7056275.",
			},
		},
	},
	{
		// Wave 4. Toshiba 2SC2240 2007-11-01: the VBE row prints a TYP (active region), so
		// IS derives; ranks GR/BL split the gain. Unbinned plus the corpus-used GR rank
		// (six GR uses); BL stays out (same sheet, no corpus use).
		partIds: ["2SC2240"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 2.4071917e-14,
				basis: "derived",
				source:
					"2SC2240/datasheets/toshiba-2sc2240.pdf (Toshiba 2SC2240, 2007-11-01) p2, " +
					"ELECTRICAL CHARACTERISTICS (Ta = 25C): 'Base-emitter voltage VBE, VCE = 6 V, " +
					"IC = 2 mA, TYP 0.65 V'",
				derivation:
					"Printed VBE TYP 0.65 V at VCE = 6 V, IC = 2 mA (active region, within the " +
					"form-1 IC <= 20 mA gate); IS = IC * exp(-Vbe / Vt) with n = 1 (form 1): " +
					"0.002 * exp(-0.65 / 0.025852) = 2.4071917e-14.",
			},
			forwardBeta: {
				value: 374.1657387,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 758, card '.MODEL 2SC2240 NPN': " +
					"'BF=4.539950E+02' = 454 against this record's 374.2 (independent published fit, " +
					"registry/card ratio 0.82); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L758",
				source:
					"2SC2240/datasheets/toshiba-2sc2240.pdf (Toshiba 2SC2240, 2007-11-01) p2: 'DC " +
					"current gain hFE (Note), VCE = 6 V, IC = 2 mA, MIN 200 MAX 700' with 'Note: hFE " +
					"classification GR: 200~400, BL: 350~700'",
				derivation:
					"Printed hFE range 200-700 at VCE = 6 V, IC = 2 mA; geometric midpoint " +
					"(form 2, gains): sqrt(200 * 700) = 374.1657387.",
			},
		},
	},
	{
		partIds: ["2SC2240-GR", "2SC2240GR"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 2.4071917e-14,
				basis: "derived",
				source:
					"2SC2240/datasheets/toshiba-2sc2240.pdf (Toshiba 2SC2240, 2007-11-01) p2, shared " +
					"VBE row 'TYP 0.65 V at VCE = 6 V, IC = 2 mA' (the two spellings fold to one id)",
				derivation:
					"Printed VBE TYP 0.65 V at IC = 2 mA (form-1 gate met); IS = " +
					"0.002 * exp(-0.65 / 0.025852) = 2.4071917e-14.",
			},
			forwardBeta: {
				value: 282.8427125,
				basis: "derived",
				source:
					"2SC2240/datasheets/toshiba-2sc2240.pdf (Toshiba 2SC2240, 2007-11-01) p2, 'Note: " +
					"hFE classification GR: 200~400' (VCE = 6 V, IC = 2 mA per the table row)",
				derivation:
					"Printed GR-rank hFE bin 200-400; geometric midpoint (form 2, gains): " +
					"sqrt(200 * 400) = 282.8427125.",
			},
		},
	},
	{
		// IS: wave 4 community, Jim Hagerman's published AC128 SPICE model (paper + card).
		// BF: the original Valvo sheet's printed TYP (2026-11-02; the vendored 8.63 scan
		// prints B = 90 (55...175) at UCB = 0, IE = 50 mA, so the community card's BF = 90
		// record was removed as the loader rule requires -- same number, datasheet basis).
		// Provisional single sample for IS: germanium varies enormously specimen
		// to specimen, and the Holmes/Whitehead DAFx-2017 extraction of their own AC128
		// specimen reads IS = 20.66u, BF = 229.6 (same order of IS, hotter gain) --
		// disclosed as the corroborating one-sample. Polarity is structural (PNP).
		partIds: ["AC128"],
		class: "bjt",
		note:
			"Corroborating single-specimen extraction (Holmes/Holters/van Walstijn DAFx-2017 " +
			"Table 1 via https://grwhitehead.github.io/germaniumbjts, Greg Whitehead): " +
			".MODEL AC128 PNP(IS=20.66u BF=229.6 BR=14.66 ...) -- a hot specimen; germanium " +
			"varies enormously, so every community germanium value is one sample.",
		params: {
			saturationCurrent: {
				value: 17e-6,
				basis: "community",
				source:
					"Jim Hagerman, 'AC128 Ge PNP Transistor SPICE Model' paper, 01/16/20, " +
					"http://www.hagtech.com/pdf/ac128model.pdf (PDF, 4 pp, read 2026-10-19): " +
					"'For saturation current we take Vbe and Ic values at low current. From the " +
					"graph we get 150mV and 6mA' (6 mA * exp(-0.150/0.025852) = 18.1 uA ~= 17u); " +
					"verbatim model card:\n" +
					".MODEL AC128 PNP + ( + BF = 90 + IS = 17u + RE = 220m + BR = 100m + VAF = 30 + " +
					"ISE = 190n + TF = 106n + TR = 10u + CJC = 100p + )",
				sourceKind: "published-spice-model",
				url: "http://www.hagtech.com/pdf/ac128model.pdf",
				quote:
					".MODEL AC128 PNP + ( + BF = 90 + IS = 17u + RE = 220m + BR = 100m + VAF = 30 + " +
					"ISE = 190n + TF = 106n + TR = 10u + CJC = 100p + )",
				author: "Jim Hagerman",
				retrievedDate: "2026-10-19",
				whyNoBetterSource:
					"Searched Mullard Data Book 1965-66/1974-75 excerpts (short-form only: Ptot, " +
					"VCE, ICM and small-signal hfe, no Vbe/DC-hFE), the Valvo Datenbuch 1969-70 " +
					"reprint (URL now 404), alldatasheet/GPD/NJSEMI AC128 sheets (non-original " +
					"manufacturers and/or 1-4 pp short-form). No original-manufacturer AC128 sheet " +
					"with active-region Vbe + DC hFE bin is readable online. The vendored Valvo 8.63 " +
					"scan (AC128/datasheets/ac128-valvo-1963-scan.pdf, read 2026-11-02) prints only " +
					"MAX-only -UBE limits (<= 300 mV at IE = 50 mA, <= 450 mV at 300 mA), above the " +
					"form-1 20 mA gate and limits rather than values, so no datasheet IS. The " +
					"Holmes/Whitehead specimen corroborates the IS order.",
			},
			forwardBeta: {
				value: 90,
				basis: "datasheet",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 224, card '.MODEL AC128 PNP': " +
					"'BF=90' = 90 against this record's 90 (identical figure -- a mirror of the cited card or " +
					"the same printed number, so a transcription check, not an independent witness); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L224",
				source:
					"AC128/datasheets/ac128-valvo-1963-scan.pdf (Valvo 'AC 128 " +
					"Germanium-p-n-p-NF-Transistor', Valvo Halbleiterdioden und Transistoren, 'Vorläufige " +
					"Daten', page footer 8.63, p124; original-manufacturer scan, read visually 2026-11-02), " +
					"Kennwerte (Tj = 25 °C): 'Gleichstromverstärkung bei UCB = 0, IE = 50 mA: B = 90 " +
					"(55...175)' (the 300 mA row reads 90 (60...175) and the 1 A row 80 (45...165); the -UBE " +
					"rows are '≤ 300 mV' at IE = 50 mA and '≤ 450 mV' at 300 mA, MAX-only limits, so no " +
					"form-1 IS). The Newmarket 'Germanium Alloy Transistors' reference table's AC128 row " +
					"(newmarket/datasheets/newmarket-germanium-alloy-transistors-reference-table.pdf, '60 ... " +
					"175(0/300)') repeats the Valvo 300 mA spread and is not used: the original-manufacturer " +
					"TYP wins",
			},
		},
	},
	{
		// Wave 4 mixed: IS from the original Valvo sheet (datasheet basis, third-party
		// host per the owner rule), BF from a published single-specimen extraction
		// (community). The Valvo VBE row is a DC bias point (HF equivalent-circuit header
		// states the -U_CE = 6 V, I_C = 1 mA bias); the 1 kHz alpha_e = 100 (45-225) row
		// in the same table is small-signal and excluded by rule. The headline 150 mV is
		// transcribed with its printed spread (125-185 mV), not midpointed: 150 mV is the
		// sheet's stated value (spread-implied IS range 0.78-7.95 uA, disclosed). The
		// Holmes specimen IS = 1.423 uA sits inside that spread. Edition inferred from
		// the scan family (Dioden und Transistoren 1959, title page not in the available
		// images): disclosed. Polarity is structural (PNP).
		partIds: ["OC44"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 3.0207e-6,
				basis: "derived",
				source:
					"Valvo OC44/OC45 HF-Transistoren sheet p28 (original-manufacturer Valvo sheet, " +
					"third-party host wp.pedalia.org, scan read visually, no text layer): " +
					"'HF-Ersatzschaltbild fuer Emitterschaltung ... bei -U_CE = 6 V, I_C = 1 mA' " +
					"header with '-U_BE = 150 mV (125 bis 185 mV)' (DC bias point of the HF " +
					"equivalent circuit; OC45 sibling column reads 170 mV (145-195 mV))",
				derivation:
					"Printed VBE headline 150 mV at -U_CE = 6 V, I_C = 1 mA (active region, " +
					"within the form-1 IC <= 20 mA gate; the printed spread 125-185 mV is quoted " +
					"but the headline 150 mV is transcribed, not midpointed); IS = IC * exp(-Vbe / " +
					"Vt) with n = 1 (form 1): 0.001 * exp(-0.150 / 0.025852) = 3.0207e-6 A " +
					"(spread-implied IS range 0.78-7.95 uA).",
			},
			forwardBeta: {
				value: 307,
				basis: "community",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): Bordodynov's " +
					"Electronics lib copy of the LTspice standard library, Models/uncategorized/Bordodynovs " +
					"Electronics Lib/cmp/standard.bjt line 1434, card '.model OC44 pnp': 'BF=307' = 307 " +
					"against this record's 307 (identical figure -- a mirror of the cited card or the same " +
					"printed number, so a transcription check, not an independent witness); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/uncategorized/Bordodynovs%20Electronics%20Lib/cmp/standard.bjt#L1434",
				source:
					"Holmes/Holters/van Walstijn DAFx-2017 Table 1 ('Comparison of Germanium Bipolar " +
					"Junction Transistor Models for Real-Time Circuit Simulation', Proc. 20th Int. " +
					"Conf. on Digital Audio Effects, Edinburgh, Sept. 2017) via " +
					"https://grwhitehead.github.io/germaniumbjts (Greg Whitehead repo page, read " +
					"2026-10-19): verbatim model card:\n" +
					".MODEL OC44 PNP(IS=1.423u BF=307.0 BR=20.27 NF=1.022 NR=1.025 VT=25.5m VAF=8.167 " +
					"VAR=14.84 IKF=43.82m IKR=611.7m ISE=30.54n ISC=213.5n NE=1.316 NC=1.258 RB=32.83 " +
					"RE=968.7m RC=989.9u CEB=410p CCB=10p)",
				sourceKind: "published-spice-model",
				url: "https://grwhitehead.github.io/germaniumbjts",
				quote:
					".MODEL OC44 PNP(IS=1.423u BF=307.0 BR=20.27 NF=1.022 NR=1.025 VT=25.5m VAF=8.167 " +
					"VAR=14.84 IKF=43.82m IKR=611.7m ISE=30.54n ISC=213.5n NE=1.316 NC=1.258 RB=32.83 " +
					"RE=968.7m RC=989.9u CEB=410p CCB=10p)",
				author: "B. Holmes, M. Holters, M. van Walstijn (via Greg Whitehead)",
				retrievedDate: "2026-10-19",
				whyNoBetterSource:
					"The Valvo sheet's only gain number is the 1 kHz small-signal alpha_e = 100 " +
					"(45-225), excluded by rule; Mullard short-form/electronics-notes give " +
					"small-signal hfe only. No DC hFE bin exists in any located " +
					"original-manufacturer material. The card is one specimen's extraction (its " +
					"IS = 1.423 uA sits inside the Valvo VBE spread 0.78-7.95 uA).",
			},
		},
	},
	{
		// Wave 5. Ferranti ZTX107/108/109 series (ZTX107 Series, undated image-only scan
		// read visually, third-party host) p2, CHARACTERISTICS (at 25C ambient): the
		// ZTX109 column prints 'Emitter-base voltage VBE, IC = 2 mA, VCE = 5 V: MIN 0.6
		// MAX 0.7 V' (active-region Vbe, limits not TYP) and 'Static forward current
		// transfer ratio hFE, ZTX108C/109C row: ZTX109 MIN 450 MAX 900 at IC = 2 mA,
		// VCE = 5 V'. The VCE(sat) rows are starred TYPICAL figures and are excluded.
		partIds: ["ZTX109C"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 2.4071917e-14,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): Ferranti ZTX107/108/109 series " +
					"(ZTX107 Series, undated scan) p2: 'Emitter-base voltage VBE, IC = 2 mA, VCE = 5 V: " +
					"ZTX109 MIN 0.6 MAX 0.7 V' (no TYP printed)",
				derivation:
					"Printed ZTX109 VBE range 0.6-0.7 V at IC = 2 mA, VCE = 5 V (active region, " +
					"IC within the form-1 <= 20 mA gate); arithmetic midpoint 0.65 V (form 2); " +
					"IS = IC * exp(-Vbe / Vt) with n = 1 (form 1): 0.002 * exp(-0.65 / 0.025852) = " +
					"2.4071917e-14.",
			},
			forwardBeta: {
				value: 636.3961031,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): Ferranti ZTX107/108/109 series p2: " +
					"'Static forward current transfer ratio hFE, IC = 2 mA, VCE = 5 V, ZTX108C/109C row: " +
					"ZTX109 MIN 450 MAX 900' (the unbinned 109 row is 240-900; the 10 uA row is 100-300)",
				derivation:
					"Printed ZTX109C hFE bin 450-900 at IC = 2 mA, VCE = 5 V; geometric midpoint " +
					"(form 2, gains): sqrt(450 * 900) = 636.3961031.",
			},
		},
	},
	{
		// Wave 5. Own title sheet (not a 2N2222A alias): onsemi P2N2222A/D, Jan 2013
		// Rev. 7, p2. The DC rows are MIN-only and the VBE(sat) rows are high-current,
		// so only the small-signal bin qualifies (the shipped 2N2222A precedent, same
		// 50-300 arithmetic on the sibling die).
		partIds: ["P2N2222A"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 122.4744871,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): onsemi P2N2222A/D, Jan 2013 Rev. 7, " +
					"p2, SMALL-SIGNAL CHARACTERISTICS: 'Small-Signal Current Gain hfe, IC = 1.0 mAdc, " +
					"VCE = 10 Vdc, f = 1.0 kHz: MIN 50 MAX 300' (the DC hFE rows are MIN-only; VBE(sat) " +
					"0.6-1.2/2.0 V at 150/500 mA is high-current and excluded)",
				derivation:
					"Printed P2N2222A small-signal hfe bin 50-300 at IC = 1.0 mA, VCE = 10 V, f = 1 kHz; " +
					"geometric midpoint (form 2, gains): sqrt(50 * 300) = 122.4744871.",
			},
		},
	},
	{
		// Wave 5. Central Semiconductor 2N6428/2N6429 R1 (10-September-2019),
		// ELECTRICAL CHARACTERISTICS (TA = 25C) with explicit MIN/MAX columns: the
		// 1 mA/10 mA hFE rows are MIN-only (250/500), so the only pair is the 100 uA
		// DC bin (a legitimate low-current bin, not high-current falloff).
		partIds: ["2N6428"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 5.6552409e-14,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 349, card '.MODEL 2N6428 NPN': " +
					"'IS=45.000f' = 4.5e-14 against this record's 5.655e-14 (independent published fit, " +
					"registry/card ratio 1.26); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L349",
				source:
					"Fetched manufacturer sheet (no vendored copy): Central Semiconductor 2N6428/2N6429, " +
					"R1 (10-September-2019), ELECTRICAL CHARACTERISTICS (TA = 25C): 'VBE(ON), VCE = 5.0 V, " +
					"IC = 1.0 mA: 2N6428 MIN 0.56 MAX 0.66 V' (no TYP printed)",
				derivation:
					"Printed 2N6428 VBE(ON) range 0.56-0.66 V at IC = 1.0 mA, VCE = 5.0 V (active " +
					"region, IC within the form-1 <= 20 mA gate); arithmetic midpoint 0.61 V (form 2); " +
					"IS = IC * exp(-Vbe / Vt) with n = 1 (form 1): 0.001 * exp(-0.61 / 0.025852) = " +
					"5.6552409e-14.",
			},
			forwardBeta: {
				value: 403.1128874,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 349, card '.MODEL 2N6428 NPN': " +
					"'BF=516.544' = 516.5 against this record's 403.1 (independent published fit, " +
					"registry/card ratio 0.78); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L349",
				source:
					"Fetched manufacturer sheet (no vendored copy): Central Semiconductor 2N6428/2N6429, " +
					"R1 (10-September-2019), ELECTRICAL CHARACTERISTICS (TA = 25C): 'hFE, VCE = 5.0 V, " +
					"IC = 100 uA: 2N6428 MIN 250 MAX 650' (the 1 mA/10 mA rows are MIN-only 250/500)",
				derivation:
					"Printed 2N6428 hFE bin 250-650 at IC = 100 uA, VCE = 5.0 V; geometric midpoint " +
					"(form 2, gains): sqrt(250 * 650) = 403.1128874.",
			},
		},
	},
	{
		// Wave 5. Same Central sheet as 2N6428 (its higher-gain sibling column).
		partIds: ["2N6429"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 5.6552409e-14,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 350, card '.MODEL 2N6429 NPN': " +
					"'IS=45.000f' = 4.5e-14 against this record's 5.655e-14 (independent published fit, " +
					"registry/card ratio 1.26); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L350",
				source:
					"Fetched manufacturer sheet (no vendored copy): Central Semiconductor 2N6428/2N6429, " +
					"R1 (10-September-2019), ELECTRICAL CHARACTERISTICS (TA = 25C): 'VBE(ON), VCE = 5.0 V, " +
					"IC = 1.0 mA: 2N6429 MIN 0.56 MAX 0.66 V' (no TYP printed; shared row with 2N6428)",
				derivation:
					"Printed 2N6429 VBE(ON) range 0.56-0.66 V at IC = 1.0 mA, VCE = 5.0 V; arithmetic " +
					"midpoint 0.61 V (form 2); IS = IC * exp(-Vbe / Vt) with n = 1 (form 1): " +
					"0.001 * exp(-0.61 / 0.025852) = 5.6552409e-14.",
			},
			forwardBeta: {
				value: 790.569415,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 350, card '.MODEL 2N6429 NPN': " +
					"'BF=516.544' = 516.5 against this record's 790.6 (independent published fit, " +
					"registry/card ratio 1.53); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L350",
				source:
					"Fetched manufacturer sheet (no vendored copy): Central Semiconductor 2N6428/2N6429, " +
					"R1 (10-September-2019), ELECTRICAL CHARACTERISTICS (TA = 25C): 'hFE, VCE = 5.0 V, " +
					"IC = 100 uA: 2N6429 MIN 500 MAX 1250' (the 1 mA/10 mA rows are MIN-only 500)",
				derivation:
					"Printed 2N6429 hFE bin 500-1250 at IC = 100 uA, VCE = 5.0 V; geometric midpoint " +
					"(form 2, gains): sqrt(500 * 1250) = 790.569415.",
			},
		},
	},
	{
		// Wave 5. BF-only (VBE(sat) is MAX-only at -100 mA: no IS). The A1015GR marking
		// is named by the sheet's own marking diagram ('A1015 (GR, Y) = Device Code'),
		// so no alias is involved; the GR bin matches the registered Toshiba 2SA1015-Y
		// arithmetic (same 200-400 at -6 V/-2 mA).
		partIds: ["A1015GR"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 282.8427125,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): onsemi KSA1015/D, Nov 2025 Rev. 3, " +
					"p2, ELECTRICAL CHARACTERISTICS: 'hFE1 DC Current Gain, VCE = -6 V, IC = -2 mA: " +
					"MIN 70 MAX 400' with 'hFE CLASSIFICATION O 70~140, Y 120~240, GR 200~400' " +
					"(marking diagram p1: 'A1015 (GR, Y) = Device Code'; VBE(sat) MAX-only -1.1 V " +
					"at -100 mA, excluded)",
				derivation:
					"Printed GR hFE bin 200-400 at VCE = -6 V, IC = -2 mA; geometric midpoint " +
					"(form 2, gains): sqrt(200 * 400) = 282.8427125. PNP polarity is structural, " +
					"not a registry value.",
			},
		},
	},
	{
		// Wave 5. BF-only (VBE(sat) is MAX-only at 50 mA: no IS). The DC bin at 2 mA is
		// the law's quantity (the small-signal 120-480 row at the same bias is not used).
		partIds: ["MPS4124"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 207.8460969,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): onsemi MPS4124/D, Apr 2007 Rev. 4, " +
					"ON CHARACTERISTICS: 'DC Current Gain hFE, IC = 2.0 mA, VCE = 1.0 V: MIN 120 MAX 360' " +
					"(the 50 mA row is MIN-only 60; VBE(sat) MAX-only 0.95 V at 50 mA, excluded)",
				derivation:
					"Printed MPS4124 hFE bin 120-360 at IC = 2.0 mA, VCE = 1.0 V; geometric midpoint " +
					"(form 2, gains): sqrt(120 * 360) = 207.8460969.",
			},
		},
	},
	{
		// Wave 9 (trailing-unknowns sweep, corpus-driven). B-bin, same family
		// sheet and VBE row as BC546A above (B 200 ~ 450); IS identical (family row).
		// Corpus: Clay Jones OD (Q1, Q2).
		partIds: ["BC546B"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 1.6350012e-14,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 536, card '.model BC546B NPN': " +
					"'IS=2.39E-14' = 2.39e-14 against this record's 1.635e-14 (independent published fit, " +
					"registry/card ratio 0.68); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L536",
				source:
					"BC548B/datasheets/onsemi-bc550-d.pdf (onsemi BC550/D, Feb 2026 Rev. 6, family sheet " +
					"BC546/547/548/549/550) p2, ELECTRICAL CHARACTERISTICS: 'VBE(on) Base-Emitter On " +
					"Voltage, VCE = 5 V, IC = 2 mA: MIN 580 TYP 660 MAX 700 mV'",
				derivation:
					"Printed family VBE(on) TYP 0.66 V at VCE = 5 V, IC = 2 mA (active region, IC " +
					"within the form-1 <= 20 mA gate); IS = IC * exp(-Vbe / Vt) with n = 1 (form 1): " +
					"0.002 * exp(-0.66 / 0.025852) = 1.6350012e-14.",
			},
			forwardBeta: {
				value: 300,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 536, card '.model BC546B NPN': " +
					"'BF=294.3' = 294.3 against this record's 300 (independent published fit, registry/card " +
					"ratio 1.02); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L536",
				source:
					"BC548B/datasheets/onsemi-bc550-d.pdf (onsemi BC550/D, Feb 2026 Rev. 6) p2: " +
					"'hFE CLASSIFICATION A 110 ~ 220, B 200 ~ 450, C 420 ~ 800' (family DC row @ 2 mA/5 V: " +
					"MIN 110 MAX 800)",
				derivation:
					"Printed B-bin hFE 200-450; geometric midpoint (form 2, gains): " +
					"sqrt(200 * 450) = 300.",
			},
		},
	},
	{
		// Wave 9 (trailing-unknowns sweep, corpus-driven). IS from the Central card; the card's
		// BF 1.135k is a fit and is NOT adopted (2N2222A precedent); BF is the Fairchild hFE bin
		// below. Fairchild-authored sheet via NAC Semi authorized-datasheet archive
		// (distributor host, disclosed). Corpus: EHX Germanium OD.
		partIds: ["2N5087"],
		class: "bjt",
		note:
			"The model's BF 1.135k is a fit, unusually high, and is NOT adopted (BF stays " +
			"the derived 447.21); IS is taken as printed (2N2222A precedent).",
		params: {
			saturationCurrent: {
				value: 2.45e-15,
				basis: "manufacturer-model",
				source:
					"Central Semiconductor SPICE model, https://my.centralsemi.com/docs/ENGINEERING/CSM/2N5087.LIB " +
					"(fetched 2026-10-28 in this run). Quoted fragments (license limit, full card " +
					"not copied): IS=2.45f BF=1.135k",
				modelFileUrl: "https://my.centralsemi.com/docs/ENGINEERING/CSM/2N5087.LIB",
				modelLine: "IS=2.45f BF=1.135k",
			},
			forwardBeta: {
				value: 447.2135955,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 242, card '.model 2N5087 PNP': " +
					"'Bf=254.1' = 254.1 against this record's 447.2 (independent published fit, registry/card " +
					"ratio 1.76); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L242",
				source:
					"Fairchild 2N5086/2N5087/MMBT5087 Rev. B1 Sept 2003 (Fairchild-authored, via NAC Semi Authorized Datasheets FAIRS25010-1): 'hFE DC Current Gain, IC = -100 uA, VCE = -5.0 V, 5087 MIN 250 MAX 800'",
				derivation:
					"Printed hFE bin 250-800 at IC = -100 uA, VCE = -5.0 V; geometric midpoint (form 2, gains): sqrt(250 * 800) = 447.2135955.",
			},
		},
	},
	{
		// Wave 9 (trailing-unknowns sweep, corpus-driven). IS from the Central card (card BF 297.85
		// not adopted, 2N2222A precedent); BF is the Central hFE bin below, disclosed
		// off-operating-point (150 mA bin; small-signal stages run ~1 mA -- PN2222A precedent).
		// Corpus: Devi Ever Hyperion 2.
		partIds: ["2N2907A"],
		class: "bjt",
		note:
			"The model's BF 297.85 is a fit and is NOT adopted (BF stays the derived 173.21); " +
			"IS is taken as printed (2N2222A precedent). " +
			"saturationCurrent disagrees with KiCad-Spice-Library " +
			"(Models/Manufacturer/TRT-Electronics/2n2907a.lib line 1, card '.model Q2N2907A PNP': " +
			"'Is=650.6E-18' = 6.506e-16, vendor file under Models/Manufacturer/TRT-Electronics): this " +
			"record's 1.529e-14 is 24x above it; not corroborated, kept as cited because the two are " +
			"different fits with their own emission coefficients, flagged for a bench check.",
		params: {
			saturationCurrent: {
				value: 15.294e-15,
				basis: "manufacturer-model",
				source:
					"Central Semiconductor SPICE model, https://my.centralsemi.com/docs/ENGINEERING/CSM/2N2907A.LIB " +
					"(fetched 2026-10-28 in this run). Quoted fragments (license limit, full card " +
					"not copied): IS=15.294E-15 BF=297.85",
				modelFileUrl: "https://my.centralsemi.com/docs/ENGINEERING/CSM/2N2907A.LIB",
				modelLine: "IS=15.294E-15 BF=297.85",
			},
			forwardBeta: {
				value: 173.2050808,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): vendor file " +
					"under Models/Manufacturer/TRT-Electronics, " +
					"Models/Manufacturer/TRT-Electronics/2n2907a.lib line 1, card '.model Q2N2907A PNP': " +
					"'Bf=231.7' = 231.7 against this record's 173.2 (independent published fit, registry/card " +
					"ratio 0.75); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Manufacturer/TRT-Electronics/2n2907a.lib#L1",
				source:
					"Central Semiconductor 2N2906/2N2907/2N2906A/2N2907A sheet (my.centralsemi.com 2n2906.PDF): 'hFE, VCE = 10 V, IC = 150 mA, 2N2907A MIN 100 MAX 300'",
				derivation:
					"Printed hFE bin 100-300 at VCE = 10 V, IC = 150 mA; geometric midpoint (form 2, gains): sqrt(100 * 300) = 173.2050808.",
			},
		},
	},
	{
		// Wave 9 (trailing-unknowns sweep, corpus-driven). IS from the Central card (card BF 255.25
		// not adopted); BF is the Central hFE bin below, disclosed off-operating-point (150 mA).
		// The sheet's VBE(sat) 0.75-0.95 V at 150 mA is saturation at high current, excluded by
		// the 2N2222A precedent. Corpus: ROG Thunderbird.
		partIds: ["2N4403"],
		class: "bjt",
		note:
			"The model's BF 255.25 is a fit and is NOT adopted (BF stays the derived 173.21); " +
			"IS is taken as printed (2N2222A precedent). " +
			"saturationCurrent disagrees with KiCad-Spice-Library (Models/Transistor/BJT/BJT.lib line " +
			"246, card '.model 2N4403 PNP': 'Is=650.6E-18' = 6.506e-16, ltwiki Standard.* mirror): " +
			"this record's 1.683e-14 is 26x above it; not corroborated, kept as cited because the two " +
			"are different fits with their own emission coefficients, flagged for a bench check.",
		params: {
			saturationCurrent: {
				value: 16.832e-15,
				basis: "manufacturer-model",
				source:
					"Central Semiconductor SPICE model, https://my.centralsemi.com/docs/ENGINEERING/CSM/2N4403.LIB " +
					"(fetched 2026-10-28 in this run). Quoted fragments (license limit, full card " +
					"not copied): IS=16.832E-15 BF=255.25",
				modelFileUrl: "https://my.centralsemi.com/docs/ENGINEERING/CSM/2N4403.LIB",
				modelLine: "IS=16.832E-15 BF=255.25",
			},
			forwardBeta: {
				value: 173.2050808,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 246, card '.model 2N4403 PNP': " +
					"'Bf=216.2' = 216.2 against this record's 173.2 (independent published fit, registry/card " +
					"ratio 0.80); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L246",
				source:
					"Central Semiconductor 2N4402/2N4403 sheet (my.centralsemi.com 2N4402.PDF): 'hFE, VCE = 2.0 V, IC = 150 mA, 2N4403 MIN 100 MAX 300'",
				derivation:
					"Printed hFE bin 100-300 at VCE = 2.0 V, IC = 150 mA; geometric midpoint (form 2, gains): sqrt(100 * 300) = 173.2050808.",
			},
		},
	},
	{
		// Wave 9 (trailing-unknowns sweep, corpus-driven). Non-A part only: no 2N2222A figure is
		// used. IS from the Central non-A card (card BF 240 not adopted); BF is the Central non-A
		// hFE bin below, disclosed off-operating-point (150 mA). The sheet's VBE(sat) 0.6-1.3 V at
		// 150 mA is saturation, excluded. Corpus: Catalinbread Manx Loaghtan, ThroBak stRange Master.
		partIds: ["2N2222"],
		class: "bjt",
		note:
			"The model's BF 240 is a fit and is NOT adopted (BF stays the derived 173.21); " +
			"IS is taken as printed (2N2222A precedent).",
		params: {
			saturationCurrent: {
				value: 2.2e-15,
				basis: "manufacturer-model",
				source:
					"Central Semiconductor SPICE model, https://my.centralsemi.com/docs/ENGINEERING/CSM/2N2222.LIB " +
					"(fetched 2026-10-28 in this run). Quoted fragments (license limit, full card " +
					"not copied): IS=2.20f BF=240",
				modelFileUrl: "https://my.centralsemi.com/docs/ENGINEERING/CSM/2N2222.LIB",
				modelLine: "IS=2.20f BF=240",
			},
			forwardBeta: {
				value: 173.2050808,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 226, card '.model 2N2222 NPN': " +
					"'BF=200' = 200 against this record's 173.2 (independent published fit, registry/card " +
					"ratio 0.87); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L226",
				source:
					"Central Semiconductor 2N2221/2N2222 sheet (my.centralsemi.com 2N2221.PDF, non-A types only): 'hFE, VCE = 10 V, IC = 150 mA, 2N2222 MIN 100 MAX 300'",
				derivation:
					"Printed non-A hFE bin 100-300 at VCE = 10 V, IC = 150 mA; geometric midpoint (form 2, gains): sqrt(100 * 300) = 173.2050808.",
			},
		},
	},
	{
		// Wave 9 (trailing-unknowns sweep, corpus-driven). IS-only: the Central MPSA05-series
		// hFE figures are MIN-only (100 at 10/100 mA) and VBE(ON) single-sided, so no BF derivation;
		// the card's BF 163.91 is a fit and is NOT adopted (2N2222A precedent). BF falls back to
		// the class default (reads high -- same disclosure as the 2N1308 IS-only row).
		// Corpus: Revv Chat Breaker (x2).
		partIds: ["MPSA06"],
		class: "bjt",
		note:
			"saturationCurrent disagrees with KiCad-Spice-Library (Models/Transistor/BJT/BJTN.LIB " +
			"line 121, card '.MODEL MPSA06 NPN': 'IS=50.7F' = 5.07e-14, Intusoft BJT library " +
			"(Copyright Intusoft 1988-1997)): this record's 5.73e-13 is 11x above it; not " +
			"corroborated, kept as cited because the two are different fits with their own emission " +
			"coefficients, flagged for a bench check.",
		params: {
			saturationCurrent: {
				value: 573.03e-15,
				basis: "manufacturer-model",
				source:
					"Central Semiconductor SPICE model, https://my.centralsemi.com/docs/ENGINEERING/CSM/MPSA06.LIB " +
					"(fetched 2026-10-28 in this run). Quoted fragments (license limit, full card " +
					"not copied): IS=573.03E-15 BF=163.91",
				modelFileUrl: "https://my.centralsemi.com/docs/ENGINEERING/CSM/MPSA06.LIB",
				modelLine: "IS=573.03E-15 BF=163.91",
			},
		},
	},
	{
		// Wave 9 (trailing-unknowns sweep, corpus-driven). BF-only: no PN4124-specific sheet exists
		// (no PNP PN4124 anywhere; the number is taken as Fairchild plastic numbering for the NPN
		// 2N4124 die -- DOD 280 Q1/Q2 are NPN positions; reviewer ruling invited). BF is the Central
		// 2N4124 column below at small-signal current (no off-operating-point disclosure owed).
		// No IS: the sheet's VBE(sat) is MAX-only (2N4126 precedent). Corpus: DOD 280 (x2 projects, x4).
		partIds: ["PN4124"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 207.8460969,
				basis: "derived",
				source:
					"Central Semiconductor 2N4123-2N4126 R1 (12-Jan-2016, my.centralsemi.com) p1, ELECTRICAL CHARACTERISTICS (TA = 25C): 'hFE, VCE = 1.0 V, IC = 2.0 mA, 2N4124 MIN 120 MAX 360' (2N4126 PNP column reads the same 120-360; polarity is structural)",
				derivation:
					"Printed hFE bin 120-360 at VCE = 1.0 V, IC = 2.0 mA; geometric midpoint (form 2, gains): sqrt(120 * 360) = 207.8460969.",
			},
		},
	},
	{
		// Wave 5. A-bin of the BC546-550 family (vendored onsemi BC550/D sheet). Same
		// family VBE row as the registered BC549C/BC550C/BC549B/BC547B/BC550 entries.
		partIds: ["BC546A"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 1.6350012e-14,
				basis: "derived",
				source:
					"BC548B/datasheets/onsemi-bc550-d.pdf (onsemi BC550/D, Feb 2026 Rev. 6, family sheet " +
					"BC546/547/548/549/550) p2, ELECTRICAL CHARACTERISTICS: 'VBE(on) Base-Emitter On " +
					"Voltage, VCE = 5 V, IC = 2 mA: MIN 580 TYP 660 MAX 700 mV'",
				derivation:
					"Printed family VBE(on) TYP 0.66 V at VCE = 5 V, IC = 2 mA (active region, IC " +
					"within the form-1 <= 20 mA gate); IS = IC * exp(-Vbe / Vt) with n = 1 (form 1): " +
					"0.002 * exp(-0.66 / 0.025852) = 1.6350012e-14.",
			},
			forwardBeta: {
				value: 155.5634919,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 535, card '.model BC546A NPN': " +
					"'Bf=253' = 253 against this record's 155.6 (independent published fit, registry/card " +
					"ratio 0.61); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L535",
				source:
					"BC548B/datasheets/onsemi-bc550-d.pdf (onsemi BC550/D, Feb 2026 Rev. 6) p2: " +
					"'hFE CLASSIFICATION A 110 ~ 220, B 200 ~ 450, C 420 ~ 800' (family DC row @ 2 mA/5 V: " +
					"MIN 110 MAX 800)",
				derivation:
					"Printed A-bin hFE 110-220; geometric midpoint (form 2, gains): " +
					"sqrt(110 * 220) = 155.5634919.",
			},
		},
	},
	{
		// Wave 5. A-bin, same family sheet and VBE row as BC546A above.
		partIds: ["BC548A"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 1.6350012e-14,
				basis: "derived",
				source:
					"BC548B/datasheets/onsemi-bc550-d.pdf (onsemi BC550/D, Feb 2026 Rev. 6, family sheet " +
					"BC546/547/548/549/550) p2, ELECTRICAL CHARACTERISTICS: 'VBE(on) Base-Emitter On " +
					"Voltage, VCE = 5 V, IC = 2 mA: MIN 580 TYP 660 MAX 700 mV'",
				derivation:
					"Printed family VBE(on) TYP 0.66 V at VCE = 5 V, IC = 2 mA; IS = IC * exp(-Vbe / Vt) " +
					"with n = 1 (form 1): 0.002 * exp(-0.66 / 0.025852) = 1.6350012e-14.",
			},
			forwardBeta: {
				value: 155.5634919,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 537, card '.model BC548A NPN': " +
					"'Bf=253' = 253 against this record's 155.6 (independent published fit, registry/card " +
					"ratio 0.61); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L537",
				source:
					"BC548B/datasheets/onsemi-bc550-d.pdf (onsemi BC550/D, Feb 2026 Rev. 6) p2: " +
					"'hFE CLASSIFICATION A 110 ~ 220, B 200 ~ 450, C 420 ~ 800'",
				derivation:
					"Printed A-bin hFE 110-220; geometric midpoint (form 2, gains): " +
					"sqrt(110 * 220) = 155.5634919.",
			},
		},
	},
	{
		// Wave 5. B-bin, same family sheet and VBE row. BC548B.md's 'typ 290' is a
		// workbench-runtime figure, not used: the registry derivation is the geometric
		// 300 (BC547B/BC549B precedent, same B bin).
		partIds: ["BC548B"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 1.6350012e-14,
				basis: "derived",
				source:
					"BC548B/datasheets/onsemi-bc550-d.pdf (onsemi BC550/D, Feb 2026 Rev. 6, family sheet " +
					"BC546/547/548/549/550) p2, ELECTRICAL CHARACTERISTICS: 'VBE(on) Base-Emitter On " +
					"Voltage, VCE = 5 V, IC = 2 mA: MIN 580 TYP 660 MAX 700 mV'",
				derivation:
					"Printed family VBE(on) TYP 0.66 V at VCE = 5 V, IC = 2 mA; IS = IC * exp(-Vbe / Vt) " +
					"with n = 1 (form 1): 0.002 * exp(-0.66 / 0.025852) = 1.6350012e-14.",
			},
			forwardBeta: {
				value: 300,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): ltwiki " +
					"Standard.* mirror, Models/Transistor/BJT/BJT.lib line 538, card '.model BC548B NPN': " +
					"'Bf=374.6' = 374.6 against this record's 300 (independent published fit, registry/card " +
					"ratio 0.80); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Transistor/BJT/BJT.lib#L538",
				source:
					"BC548B/datasheets/onsemi-bc550-d.pdf (onsemi BC550/D, Feb 2026 Rev. 6) p2: " +
					"'hFE CLASSIFICATION A 110 ~ 220, B 200 ~ 450, C 420 ~ 800'",
				derivation:
					"Printed B-bin hFE 200-450; geometric midpoint (form 2, gains): " +
					"sqrt(200 * 450) = 300.",
			},
		},
	},
	{
		// Wave 5. Fairchild BC184C/D (2002-08-06, title names BC184C) via the sm0vpo
		// mirror of the Fairchild original. DC bin at 2 mA preferred over the
		// small-signal 240-900 row (2N3904/2SC1815 precedent).
		partIds: ["BC184C"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 6.3312899e-14,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): Fairchild BC184C/D (2002-08-06): " +
					"'VBE(on) Base-Emitter On Voltage, VCE = 5 V, IC = 2 mA: MIN 0.55 MAX 0.7 V' " +
					"(no TYP printed)",
				derivation:
					"Printed BC184C VBE(on) range 0.55-0.7 V at VCE = 5 V, IC = 2 mA (active region, " +
					"IC within the form-1 <= 20 mA gate); arithmetic midpoint 0.625 V (form 2); " +
					"IS = IC * exp(-Vbe / Vt) with n = 1 (form 1): 0.002 * exp(-0.625 / 0.025852) = " +
					"6.3312899e-14.",
			},
			forwardBeta: {
				value: 447.2135955,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): Fairchild BC184C/D (2002-08-06): " +
					"'hFE DC Current Gain, VCE = 5 V, IC = 2 mA: MIN 250 MAX 800' (the 10 uA row is " +
					"MIN-only 100, the 100 mA row MIN-only 130; small-signal hfe 240-900 not used)",
				derivation:
					"Printed BC184C hFE bin 250-800 at VCE = 5 V, IC = 2 mA; geometric midpoint " +
					"(form 2, gains): sqrt(250 * 800) = 447.2135955.",
			},
		},
	},
	{
		// Wave 5. BF-only (VBE(on) prints a single 0.85 V figure at 1 mA: a limit, not a
		// range or typical, so no IS). Judgement call, disclosed: the 1 mA/10 mA DC rows
		// print MIN-only 250, so the only pair is the 100 uA DC bin (a legitimate
		// low-current bin, not high-current falloff).
		partIds: ["2N5210"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 346.4101615,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): Fairchild 2N5210/MMBT5210 Rev. B " +
					"2002, ON CHARACTERISTICS: 'hFE DC Current Gain, IC = 100 uA, VCE = 5.0 V: MIN 200 " +
					"MAX 600' (the IC = 1.0/10 mA rows print MIN-only 250; VBE(on) 0.85 V at 1.0 mA is " +
					"a single-figure limit, excluded)",
				derivation:
					"Printed 2N5210 hFE bin 200-600 at IC = 100 uA, VCE = 5.0 V; geometric midpoint " +
					"(form 2, gains): sqrt(200 * 600) = 346.4101615.",
			},
		},
	},
	{
		// Wave 5. Unbinned 2SC732 (ranks GR/BL registered wave-3; only these two ranks
		// exist). Vendored Toshiba 2SC732TM 1996-09-02 scan p1 read visually (no text
		// layer): hFE MIN 200 MAX 700 at 6 V/2 mA with the GR:200~400/BL:350~600 note,
		// VBE TYP 0.65 at 6 V/2 mA. Unbinned full-range midpoint (2SC2240 precedent).
		partIds: ["2SC732"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 2.4071917e-14,
				basis: "derived",
				source:
					"2SC732/datasheets/toshiba-2sc732.pdf (Toshiba 2SC732TM, 1996-09-02, image-only scan " +
					"read visually) p1, ELECTRICAL CHARACTERISTICS (Ta = 25C): 'Base-Emitter Voltage VBE, " +
					"VCE = 6 V, IC = 2 mA: TYP 0.65 V'",
				derivation:
					"Printed VBE TYP 0.65 V at VCE = 6 V, IC = 2 mA (active region, IC within the " +
					"form-1 <= 20 mA gate); IS = IC * exp(-Vbe / Vt) with n = 1 (form 1): " +
					"0.002 * exp(-0.65 / 0.025852) = 2.4071917e-14 (shared row with the GR/BL ranks).",
			},
			forwardBeta: {
				value: 374.1657387,
				basis: "derived",
				source:
					"2SC732/datasheets/toshiba-2sc732.pdf (Toshiba 2SC732TM, 1996-09-02, scan read " +
					"visually) p1: 'DC Current Gain hFE (Note), VCE = 6 V, IC = 2 mA: MIN 200 MAX 700' " +
					"with 'Note: hFE Classification GR: 200~400, BL: 350~600'",
				derivation:
					"Printed unbinned hFE range 200-700 at VCE = 6 V, IC = 2 mA; geometric midpoint " +
					"(form 2, gains): sqrt(200 * 700) = 374.1657387.",
			},
		},
	},
	{
		// Wave 5. IS-only via the manufacturer-published model (2N2222A/2N5088 precedent;
		// model BF 480 is a MODPEX fit value and is NOT adopted). No datasheet hFE pair
		// exists (rows are MIN-only), so BF gap-fills the class default. ZTX618 is a 3.5 A
		// power device (EOL per PCN-2824) serving one DIY pedal; the row is data, not a
		// relevance claim.
		partIds: ["ZTX618"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 5.611e-13,
				basis: "manufacturer-model",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): vendor file " +
					"under Models/Manufacturer/Zetex Semiconductors, Models/Manufacturer/Zetex " +
					"Semiconductors/ZMODELS.LIB line 1845, card '.MODEL ZTX618 NPN': 'IS=5.611E-13' = " +
					"5.611e-13 against this record's 5.611e-13 (identical figure -- a mirror of the cited " +
					"card or the same printed number, so a transcription check, not an independent witness); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Manufacturer/Zetex%20Semiconductors/ZMODELS.LIB#L1845",
				source:
					"Diodes Inc ZTX618 model file, " +
					"https://www.diodes.com/spice/download/2436/ZTX618.spice.txt " +
					"(linked from the official ZTX618 part page; Zetex v1.0, last revised 8/7/93), " +
					"verbatim card:\n" +
					"    .MODEL ZTX618  NPN IS =5.611E-13 NF =1.0022 BF =480 IKF=4.6 VAF=51\n" +
					"+               ISE=1.73E-13 NE =1.4 NR =1.0002 BR =200 IKR=3 VAR=25\n" +
					"+               ISC=7.3152E-13 NC =1.47 RB =0.032 RE =0.027 RC =0.025\n" +
					"+               CJC=59E-12 MJC=0.2651 VJC=0.3051 CJE=216E-12\n" +
					"+               TF =0.95E-9 TR =2.25E-9",
				modelFileUrl: "https://www.diodes.com/spice/download/2436/ZTX618.spice.txt",
				modelLine:
					"    .MODEL ZTX618  NPN IS =5.611E-13 NF =1.0022 BF =480 IKF=4.6 VAF=51\n" +
					"+               ISE=1.73E-13 NE =1.4 NR =1.0002 BR =200 IKR=3 VAR=25\n" +
					"+               ISC=7.3152E-13 NC =1.47 RB =0.032 RE =0.027 RC =0.025\n" +
					"+               CJC=59E-12 MJC=0.2651 VJC=0.3051 CJE=216E-12\n" +
					"+               TF =0.95E-9 TR =2.25E-9",
			},
		},
	},
	{
		// Wave 6 (transistor-records wave 1). Toshiba 2SC3324 (2007-11-01): hFE
		// 200-700 at VCE = 6 V, IC = 2 mA with Note 'hFE classification GR (G):
		// 200~400, BL (L): 350~700, ( ) marking symbol'. No VBE row (only VCE(sat)
		// MAX 0.3 V at 10 mA), so IS has no input. Unbinned plus the corpus-used
		// GR rank; BL stays out (same sheet, no corpus use).
		partIds: ["2SC3324"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 374.1657387,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): Bordodynov's " +
					"Electronics lib copy of the LTspice standard library, Models/uncategorized/Bordodynovs " +
					"Electronics Lib/cmp/standard.bjt line 1440, card '.model 2SC3324 NPN': 'Bf=352.8' = " +
					"352.8 against this record's 374.2 (independent published fit, registry/card ratio 1.06); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/uncategorized/Bordodynovs%20Electronics%20Lib/cmp/standard.bjt#L1440",
				source:
					"Fetched manufacturer sheet (no vendored copy): Toshiba 2SC3324 (2007-11-01) p1, " +
					"ELECTRICAL CHARACTERISTICS (Ta = 25C): 'DC current gain hFE (Note), VCE = 6 V, " +
					"IC = 2 mA, MIN 200 MAX 700' (the VCE(sat) row is MAX-only 0.3 V at 10 mA and " +
					"yields nothing)",
				derivation:
					"Printed hFE range 200-700 at VCE = 6 V, IC = 2 mA; geometric midpoint " +
					"(form 2, gains): sqrt(200 * 700) = 374.1657387.",
			},
		},
	},
	{
		partIds: ["2SC3324GR", "2SC3324-GR"],
		class: "bjt",
		note:
			"The hyphenated spelling is not corpus-observed; it folds to the same id " +
			"(2sc3324gr) and names the same GR rank, so it rides along (2SC1815-BL precedent).",
		params: {
			forwardBeta: {
				value: 282.8427125,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): Toshiba 2SC3324 (2007-11-01) p1, " +
					"'Note: hFE classification GR (G): 200~400' (VCE = 6 V, IC = 2 mA per the table row)",
				derivation:
					"Printed GR-rank hFE bin 200-400; geometric midpoint (form 2, gains): " +
					"sqrt(200 * 400) = 282.8427125.",
			},
		},
	},
	{
		// Wave 6 (transistor-records wave 1). Toshiba 2SA1048(L) (2003-03-27):
		// hFE 70-400 at VCE = -6 V, IC = -2 mA with Note 'hFE classification
		// O: 70~140, Y: 120~240, GR: 200~400'. No VBE row of any kind (only
		// VCE(sat) TYP -0.1/MAX -0.3 V at -100 mA), so IS has no input.
		// Complementary to 2SC2458. Unbinned plus the corpus-used GR rank;
		// O/Y stay out (same sheet, no corpus use).
		partIds: ["2SA1048"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 167.3320053,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): vendor file " +
					"under Models/Manufacturer/TRT-Electronics, " +
					"Models/Manufacturer/TRT-Electronics/2sa1048.lib line 2, card '.model Q2SA1048 PNP': " +
					"'Bf=110' = 110 against this record's 167.3 (independent published fit, registry/card " +
					"ratio 1.52); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/Manufacturer/TRT-Electronics/2sa1048.lib#L2",
				source:
					"Fetched manufacturer sheet (no vendored copy): Toshiba 2SA1048(L) (2003-03-27) " +
					"p1, ELECTRICAL CHARACTERISTICS (Ta = 25C): 'DC current gain hFE (Note), " +
					"VCE = -6 V, IC = -2 mA, MIN 70 MAX 400' (PNP; the VCE(sat) row is TYP/MAX-only " +
					"at -100 mA and yields nothing)",
				derivation:
					"Printed hFE range 70-400 at VCE = -6 V, IC = -2 mA; geometric midpoint " +
					"(form 2, gains): sqrt(70 * 400) = 167.3320053. PNP polarity is structural, " +
					"not a registry value.",
			},
		},
	},
	{
		partIds: ["2SA1048GR", "2SA1048-GR"],
		class: "bjt",
		note:
			"The hyphenated and unhyphenated spellings fold to one id (2sa1048gr); both are " +
			"corpus-observed (the 2SC2458GR precedent).",
		params: {
			forwardBeta: {
				value: 282.8427125,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): Toshiba 2SA1048(L) (2003-03-27) " +
					"p1, 'Note: hFE classification GR: 200~400' (VCE = -6 V, IC = -2 mA per the table row)",
				derivation:
					"Printed GR-rank hFE bin 200-400; geometric midpoint (form 2, gains): " +
					"sqrt(200 * 400) = 282.8427125.",
			},
		},
	},
	{
		// Wave 6 (transistor-records wave 1). Toshiba 2SC2459 (2003-03-27): hFE
		// 200-700 at VCE = 6 V, IC = 2 mA with Note 'hFE classification GR: 200~400,
		// BL: 350~700'. Complementary to 2SA1049 (whose sheet prints the same bins).
		// No VBE row (only VCE(sat) MAX 0.3 V at 10 mA), so IS has no datasheet
		// input. Wave 2 (transistor-records wave 2, 2026-10-23) adds IS from the
		// Intusoft QSC2459 card in the third-party KiCad-Spice-Library collection
		// (community basis, provisional per the owner decision); BF stays
		// datasheet-derived above and no other card field is used.
		// Unbinned plus the corpus-used GR rank; BL stays out (same sheet, no corpus use).
		partIds: ["2SC2459"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 10.1e-15,
				basis: "community",
				source:
					"KiCad-Spice-Library third-party collection, BJTN.LIB " +
					"(Intusoft-authored cards; file header 'Copyright Intusoft 1988-1997 / " +
					"All Rights Reserved') " +
					"https://raw.githubusercontent.com/kicad-spice-library/KiCad-Spice-Library/bb50ca6f03308666ac1decdc10449534cb60d45a/Models/Transistor/BJT/BJTN.LIB " +
					"(read 2026-10-23): the QSC2459 card (line 1168) value and its own " +
					"descriptive comment (line 1171), verbatim:\n" +
					"IS=10.1F\n* Toshiba 120 Volt  .1 Amp  100 MHz  SiNPN  Transistor  11-17-1993. " +
					"The card's BF = 390 is not taken (BF already comes from the Toshiba " +
					"datasheet in this record); no other card field is used.",
				sourceKind: "published-spice-model",
				url: "https://raw.githubusercontent.com/kicad-spice-library/KiCad-Spice-Library/bb50ca6f03308666ac1decdc10449534cb60d45a/Models/Transistor/BJT/BJTN.LIB",
				quote:
					"IS=10.1F\n* Toshiba 120 Volt  .1 Amp  100 MHz  SiNPN  Transistor  11-17-1993",
				author: "Intusoft",
				retrievedDate: "2026-10-23",
				whyNoBetterSource:
					"The Toshiba 2SC2459 (2003-03-27) datasheet prints no VBE row " +
					"(wave-1 note row 10: VCE(sat) is MAX-only 0.3 V, so IS has no " +
					"input); Toshiba's own LTspice bundle carries neither 2SC2458 " +
					"nor 2SC2459 and its models are encrypted with a " +
					"no-reverse-engineering term, so they cannot be read or quoted. " +
					"This third-party collection hosts the only published card for " +
					"the part, taken here under the 2026-10-23 owner decision as a " +
					"provisional community value, not a manufacturer value.",
			},
			forwardBeta: {
				value: 374.1657387,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): Toshiba 2SC2459 (2003-03-27) p1, " +
					"ELECTRICAL CHARACTERISTICS (Ta = 25C): 'DC current gain hFE (Note), VCE = 6 V, " +
					"IC = 2 mA, MIN 200 MAX 700' (the VCE(sat) row is MAX-only 0.3 V at 10 mA and " +
					"yields nothing)",
				derivation:
					"Printed hFE range 200-700 at VCE = 6 V, IC = 2 mA; geometric midpoint " +
					"(form 2, gains): sqrt(200 * 700) = 374.1657387.",
			},
		},
	},
	{
		partIds: ["2SC2459GR", "2SC2459-GR"],
		class: "bjt",
		note:
			"The hyphenated spelling is not corpus-observed; it folds to the same id " +
			"(2sc2459gr) and names the same GR rank, so it rides along (2SC1815-BL precedent).",
		params: {
			saturationCurrent: {
				value: 10.1e-15,
				basis: "community",
				source:
					"KiCad-Spice-Library third-party collection, BJTN.LIB " +
					"(Intusoft-authored cards; file header 'Copyright Intusoft 1988-1997 / " +
					"All Rights Reserved') " +
					"https://raw.githubusercontent.com/kicad-spice-library/KiCad-Spice-Library/bb50ca6f03308666ac1decdc10449534cb60d45a/Models/Transistor/BJT/BJTN.LIB " +
					"(read 2026-10-23): the QSC2459 card (line 1168) value and its own " +
					"descriptive comment (line 1171), verbatim:\n" +
					"IS=10.1F\n* Toshiba 120 Volt  .1 Amp  100 MHz  SiNPN  Transistor  11-17-1993. " +
					"The card's BF = 390 is not taken (BF already comes from the Toshiba " +
					"datasheet in this record); no other card field is used. The GR rank " +
					"shares the unbinned die's card: the card names no rank.",
				sourceKind: "published-spice-model",
				url: "https://raw.githubusercontent.com/kicad-spice-library/KiCad-Spice-Library/bb50ca6f03308666ac1decdc10449534cb60d45a/Models/Transistor/BJT/BJTN.LIB",
				quote:
					"IS=10.1F\n* Toshiba 120 Volt  .1 Amp  100 MHz  SiNPN  Transistor  11-17-1993",
				author: "Intusoft",
				retrievedDate: "2026-10-23",
				whyNoBetterSource:
					"The Toshiba 2SC2459 (2003-03-27) datasheet prints no VBE row " +
					"(wave-1 note row 10: VCE(sat) is MAX-only 0.3 V, so IS has no " +
					"input); Toshiba's own LTspice bundle carries neither 2SC2458 " +
					"nor 2SC2459 and its models are encrypted with a " +
					"no-reverse-engineering term, so they cannot be read or quoted. " +
					"This third-party collection hosts the only published card for " +
					"the part, taken here under the 2026-10-23 owner decision as a " +
					"provisional community value, not a manufacturer value.",
			},
			forwardBeta: {
				value: 282.8427125,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): Toshiba 2SC2459 (2003-03-27) p1, " +
					"'Note: hFE classification GR: 200~400' (VCE = 6 V, IC = 2 mA per the table row)",
				derivation:
					"Printed GR-rank hFE bin 200-400; geometric midpoint (form 2, gains): " +
					"sqrt(200 * 400) = 282.8427125.",
			},
		},
	},
	{
		// Wave 6 (transistor-records wave 1). Toshiba 2SC4116 (2007-11-01): hFE
		// 70-700 at VCE = 6 V, IC = 2 mA with Note 'hFE classification O (O): 70~140,
		// Y (Y): 120~240, GR (G): 200~400, BL (L): 350~700, ( ) marking symbol'.
		// No VBE row (only VCE(sat) TYP 0.1/MAX 0.25 V at 100 mA), so IS has no input.
		// Complementary to 2SA1586. Unbinned plus the corpus-used GR rank; O/Y/BL
		// stay out (same sheet, no corpus use).
		partIds: ["2SC4116"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 221.3594362,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): Toshiba 2SC4116 (2007-11-01) p1, " +
					"ELECTRICAL CHARACTERISTICS (Ta = 25C): 'DC current gain hFE (Note), VCE = 6 V, " +
					"IC = 2 mA, MIN 70 MAX 700' (the VCE(sat) row is TYP/MAX-only at 100 mA and " +
					"yields nothing)",
				derivation:
					"Printed hFE range 70-700 at VCE = 6 V, IC = 2 mA; geometric midpoint " +
					"(form 2, gains): sqrt(70 * 700) = 221.3594362.",
			},
		},
	},
	{
		partIds: ["2SC4116GR", "2SC4116-GR"],
		class: "bjt",
		note:
			"The hyphenated and unhyphenated spellings fold to one id (2sc4116gr); both are " +
			"corpus-observed (the 2SC2458GR precedent; the corpus 2SC4116_GR folds the same).",
		params: {
			forwardBeta: {
				value: 282.8427125,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): Toshiba 2SC4116 (2007-11-01) p1, " +
					"'Note: hFE classification GR (G): 200~400' (VCE = 6 V, IC = 2 mA per the table row)",
				derivation:
					"Printed GR-rank hFE bin 200-400; geometric midpoint (form 2, gains): " +
					"sqrt(200 * 400) = 282.8427125.",
			},
		},
	},
	{
		// Wave 6 (transistor-records wave 1). The SOT-23 2N5089 in both its ordering
		// codes: onsemi's MMBT5088LT1/D sheet (Oct 2026 Rev. 8) titles MMBT5089L and
		// the older family sheet titles MMBT5089; both print the same DC hFE bin
		// (400-1200 at 100 uA, VCE = 5 V), so one entry covers both spellings (both
		// corpus-observed: MMBT5089L in mxr-carbon-copy, bare MMBT5089 elsewhere).
		// The 1 mA/10 mA DC rows are MIN-only; VBE(sat)/VBE(on) is MAX-only 0.8 V at
		// 10 mA, a limit: no IS. The small-signal 450-1800 row at 1 mA is not the
		// law's DC quantity (the 2N6428 100 uA-bin precedent).
		partIds: ["MMBT5089L", "MMBT5089"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 692.820323,
				basis: "derived",
				source:
					"Fetched manufacturer sheets (no vendored copy): onsemi MMBT5088LT1/D, Oct 2026 " +
					"Rev. 8, p2, ELECTRICAL CHARACTERISTICS: 'DC Current Gain hFE, IC = 100 uAdc, " +
					"VCE = 5.0 Vdc: MMBT5089L MIN 400 MAX 1200'; and onsemi MMBT5089/D, Oct-2017 Rev. 1 " +
					"(family sheet 2N5088/MMBT5088/2N5089/MMBT5089), p2: 'DC Current Gain hFE, " +
					"IC = 100 uA, VCE = 5.0 V: 5089 MIN 400 MAX 1200' (the 1.0/10 mA DC rows are " +
					"MIN-only; VBE(sat)/VBE(on) is MAX-only 0.8 V at 10 mA)",
				derivation:
					"Printed MMBT5089 DC hFE bin 400-1200 at IC = 100 uA, VCE = 5.0 V (a legitimate " +
					"low-current DC bin, not high-current falloff); geometric midpoint (form 2, " +
					"gains): sqrt(400 * 1200) = 692.820323.",
			},
		},
	},
	{
		// Wave 6 (transistor-records wave 1). KEC KTC3198 Revision No: 3 (2013-07-08):
		// hFE(1) 70-700 at VCE = 6 V, IC = 2 mA with Note 'hFE(1) Classification O: 70~140,
		// Y: 120~240, GR: 200~400, BL: 300~700'. VBE(sat) is MAX-only 1.0 V at 100 mA,
		// a limit: no IS. hFE(2) TYP 100 at 150 mA is high-current, not the law's bias.
		// Corpus uses the BL rank only, so the BL entry ships alone (the 2SC732TM-GR
		// precedent: rank without unbinned where the corpus names no bare part).
		partIds: ["KTC3198-BL", "KTC3198BL"],
		class: "bjt",
		note:
			"The unhyphenated spelling is not corpus-observed; it folds to the same id " +
			"(ktc3198bl) and names the same BL rank, so it rides along (2SC1815-BL precedent).",
		params: {
			forwardBeta: {
				value: 458.2575695,
				basis: "derived",
				source:
					"Fetched manufacturer sheet (no vendored copy): KEC KTC3198, Revision No: 3 " +
					"(2013-07-08), ELECTRICAL CHARACTERISTICS (Ta = 25C): 'DC Current Gain hFE(1) " +
					"(Note), VCE = 6 V, IC = 2 mA, MIN 70 TYP - MAX 700' with 'Note: hFE(1) " +
					"Classification O: 70~140, Y: 120~240, GR: 200~400, BL: 300~700' (the VBE(sat) " +
					"row is MAX-only 1.0 V at 100 mA and yields nothing)",
				derivation:
					"Printed BL-rank hFE(1) bin 300-700 at VCE = 6 V, IC = 2 mA; geometric midpoint " +
					"(form 2, gains): sqrt(300 * 700) = 458.2575695.",
			},
		},
	},
	{
		// Wave 7 (germanium fill, corpus-driven). No saturationCurrent: the Mullard
		// Pocket Data Book prints no Vbe figure for OC75 (hfe, ICBO, Ptot only), so no
		// IS derivation; the stamp falls back to the class default. Recorded bias
		// caveat: with silicon-default IS this PNP biases near 0.7 V Vbe instead of
		// germanium ~0.25 V. Correct operating points need an IS source (manufacturer
		// model, bench measurement, or a form ruling). Polarity is structural (PNP).
		// Corpus: Sola Sound Tone Bender MKI (OC75).
		partIds: ["OC75"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 90,
				basis: "derived",
				source:
					"Mullard Pocket Data Book 1965/66, OC75 entry (p.54): 'Measured at " +
					"Tamb = 25°C, VCE -2.0 V, IC 30 mA, hfe 90' (single printed TYP; " +
					"ICBO 4.5 uA and Ptot 75 mW carry no gain information)",
				derivation:
					"Printed hfe TYP 90 at IC = 30 mA, VCE = -2.0 V, transcribed " +
					"(no midpoint: a TYP is already one value).",
			},
		},
	},
	{
		// Wave 7 (germanium fill, corpus-driven). No saturationCurrent: same reason as
		// OC75 above -- the Pocket Data Book prints no Vbe for OC81D. Same bias caveat.
		// Corpus: Sola Sound Tone Bender MKII (two sheets) -- 12 instances.
		partIds: ["OC81D"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 60,
				basis: "derived",
				source:
					"Mullard Pocket Data Book 1965/66, OC81D entry (p.55): 'hfe typ " +
					"(IE = 10 mA, VCE = -6 V) 60' (Ptot 100 mW, VCE max -20 V, ICM 50 mA " +
					"carry no gain information)",
				derivation:
					"Printed hfe TYP 60 at IE = 10 mA, VCE = -6 V, transcribed.",
			},
		},
	},
	{
		// Wave 7 (germanium fill, corpus-driven). No saturationCurrent: Siemens prints
		// only single-sided UBE bounds (<0.3 / <0.65 / <1 V) -- limits, not ranges.
		// Same bias caveat as OC75. Corpus: EQD Tone Reaper (AC176).
		partIds: ["AC176"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 111.8033989,
				basis: "derived",
				source:
					"Siemens AC176/AC176K datasheet (Databook 1970/71; Rev. 1.3 02/19 " +
					"reprint), 'Statische Kenndaten (TU = 25°C)': B = 110 (50 bis 250) " +
					"at IC = 300 mA, UCB = 0 V (the 50 mA B = 35 and 1000 mA B = 30 rows " +
					"are off-operating-point; UBE figures are single-sided bounds)",
				derivation:
					"Printed B bin 50-250 at IC = 300 mA; geometric midpoint " +
					"(form 2, gains): sqrt(50 * 250) = 111.8033989. The printed TYP 110 " +
					"agrees to 2%; the midpoint is used per the bin rule.",
			},
		},
	},
	{
		// Wave 7 (germanium fill, corpus-driven). No forwardBeta: Central's 2N1308 hFE
		// is MIN-only 80 at VCE = 1.0 V, IC = 10 mA (no MAX/TYP; corroborated MIN-only
		// by the 2N1292-2N1382 numerical index), and the Newmarket germanium table
		// carries 2N1303/1305/1307/1309 but no 2N1308 row -- a bare MIN is a limit, not
		// a range. BF falls back to the class default (reads high). The saturationCurrent
		// below follows the 2N3906 precedent (printed VBE(sat) MIN-MAX range at
		// IC = 10 mA); admissibility judgment for review: the 2N2222A exclusion targeted
		// 150 mA series-R domination, this is 10 mA at forced beta 20. If form 1 is read
		// as active-region-only without exception, drop this param (IS falls back to
		// default) and keep the row BF-less. Corpus: BearFoot Emerald Green, EQD Hoof.
		partIds: ["2N1308"],
		class: "bjt",
		params: {
			saturationCurrent: {
				value: 6.31226e-07,
				basis: "derived",
				source:
					"Central Semiconductor 2N1302/2N1304/2N1306/2N1308 datasheet " +
					"(R1 2014-05-05), ELECTRICAL CHARACTERISTICS: 'VBE(SAT), IC = 10 mA, " +
					"IB = 0.5 mA (2N1304, 06, 08), MIN 0.15 MAX 0.35 V'",
				derivation:
					"Printed VBE(sat) range 0.15-0.35 V at IC = 10 mA; arithmetic midpoint " +
					"0.25 V (form 2, printed range, no TYP); IS = IC * exp(-Vbe / Vt) with " +
					"n = 1 (form 1): 0.01 * exp(-0.25 / 0.025852) = 6.31226e-07.",
			},
		},
	},
	{
		// Wave 7 (corpus-driven top-up). No saturationCurrent: the only VBE figures
		// are VBE(sat) rows (0.6-1.2 V at 150 mA, MAX 2.0 V at 500 mA) -- saturation
		// at high current, excluded by the 2N2222A precedent. IS falls back to default.
		// Operating-point caveat: the sole hFE bin is at IC = 150 mA while
		// small-signal stages run ~1 mA (same disclosure pattern as the KTC3198
		// high-current note). Corpus: EHX Germanium 4 Big Muff.
		partIds: ["PN2222A"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 173.2050808,
				basis: "derived",
				corroboration:
					"KiCad-Spice-Library (github.com/kicad-spice-library/KiCad-Spice-Library, user-collected " +
					"mirror of published SPICE cards; pinned commit a8688952, read 2026-11-03): uncategorized " +
					"collection file, Models/uncategorized/spice_complete/fairch.lib line 8276, card '.model " +
					"PN2222A NPN': 'Bf=255.9' = 255.9 against this record's 173.2 (independent published fit, " +
					"registry/card ratio 0.68); " +
					"https://github.com/kicad-spice-library/KiCad-Spice-Library/blob/a8688952bcaab19f567bc4db237b60bde03ef310/Models/uncategorized/spice_complete/fairch.lib#L8276",
				source:
					"Fairchild PN2222A datasheet (Rev. 1.1.0, July 2014), ELECTRICAL " +
					"CHARACTERISTICS: 'hFE DC Current Gain, IC = 150 mA, VCE = 10 V, " +
					"MIN 100 MAX 300' (all other hFE rows MIN-only: 35/50/75/35/50/40)",
				derivation:
					"Printed hFE bin 100-300 at IC = 150 mA, VCE = 10 V; geometric midpoint " +
					"(form 2, gains): sqrt(100 * 300) = 173.2050808.",
			},
		},
	},
	{
		// Newmarket germanium reference table (2026-11-02): BF-only rows from the one-page
		// 'Germanium Alloy Transistors' PNP table. The table prints no Vbe, so no IS on any row
		// (silicon-bias caveat as OC75). Two-sided hFE bins only: OC76/OC77 ('>45'), 2N1303
		// ('>20') and 2N1309 ('>80') are MIN-only and stay out. Asterisked rows are the table's
		// 1 kHz small-signal hfe and are admitted as the DC beta by the 2N2222A/2N5088
		// precedent. AC176 (NPN table), OC75 and AC128 keep their original-manufacturer rows
		// (Siemens, Mullard, Valvo); OC44N/OC45N are Newmarket's own N-suffix codes, registered as their own ids,
		// not aliases of OC44. NKT275 is not on this table (its own community row closes this
		// file). Polarity is structural (PNP).
		partIds: ["ACY17"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 86.6025404,
				basis: "derived",
				source:
					"Newmarket Semiconductors 'Germanium Alloy Transistors' PNP REFERENCE TABLE ('Maximum " +
					"ratings. Characteristics at TA = 25°C'; one-page catalogue scan, page 1065, section tab " +
					"7, DatasheetArchive-hosted PDF; local copy " +
					"workbench/tmp/newmarket-germanium-transistor-datasheet.pdf, read 2026-11-02; the table " +
					"prints no Vbe figure for any part, so no IS derivation exists), row 'ACY 17': 'hFE " +
					"(VCE/IC) (V/mA) 50 ... 150(0/300)' (BVCEO 32 V, BVCBO 70 V, BVEBO 12 V, ICM 1.0 A, " +
					"VCEsat 0.3 V at (IC/IB) 300/15 mA, max ICBO 10 uA at VCB 6 V, stock no. 27714R carry no " +
					"gain information)",
				derivation:
					"Printed hFE bin 50-150 at VCE/IC = 0/300 V/mA as printed (a printed VCE of 0 " +
					"V, transcribed as the table states it); IC = 300 mA is off the small-signal operating " +
					"point of a pedal stage (~1 mA), disclosed per the PN2222A precedent; geometric midpoint " +
					"(form 2, gains): sqrt(50 * 150) = 86.6025404.",
			},
		},
	},
	{
		partIds: ["ACY18"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 69.2820323,
				basis: "derived",
				source:
					"Newmarket Semiconductors 'Germanium Alloy Transistors' PNP REFERENCE TABLE ('Maximum " +
					"ratings. Characteristics at TA = 25°C'; one-page catalogue scan, page 1065, section tab " +
					"7, DatasheetArchive-hosted PDF; local copy " +
					"workbench/tmp/newmarket-germanium-transistor-datasheet.pdf, read 2026-11-02; the table " +
					"prints no Vbe figure for any part, so no IS derivation exists), row 'ACY 18': 'hFE " +
					"(VCE/IC) (V/mA) 40 ... 120(0/300)' (BVCEO 30 V, BVCBO 50 V, BVEBO 12 V, ICM 1.0 A, " +
					"VCEsat 0.3 V at 300/15 mA, max ICBO 10 uA at VCB 6 V, stock no. 27715G carry no gain " +
					"information)",
				derivation:
					"Printed hFE bin 40-120 at VCE/IC = 0/300 V/mA as printed (a printed VCE of 0 " +
					"V, transcribed as the table states it); IC = 300 mA is off the small-signal operating " +
					"point of a pedal stage (~1 mA), disclosed per the PN2222A precedent; geometric midpoint " +
					"(form 2, gains): sqrt(40 * 120) = 69.2820323.",
			},
		},
	},
	{
		partIds: ["ACY19"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 141.4213562,
				basis: "derived",
				source:
					"Newmarket Semiconductors 'Germanium Alloy Transistors' PNP REFERENCE TABLE ('Maximum " +
					"ratings. Characteristics at TA = 25°C'; one-page catalogue scan, page 1065, section tab " +
					"7, DatasheetArchive-hosted PDF; local copy " +
					"workbench/tmp/newmarket-germanium-transistor-datasheet.pdf, read 2026-11-02; the table " +
					"prints no Vbe figure for any part, so no IS derivation exists), row 'ACY 19': 'hFE " +
					"(VCE/IC) (V/mA) 80 ... 250(0/300)' (BVCEO 30 V, BVCBO 50 V, BVEBO 12 V, ICM 1.0 A, " +
					"VCEsat 0.3 V at 300/15 mA, max ICBO 10 uA at VCB 6 V, stock no. 27716E carry no gain " +
					"information)",
				derivation:
					"Printed hFE bin 80-250 at VCE/IC = 0/300 V/mA as printed (a printed VCE of 0 " +
					"V, transcribed as the table states it); IC = 300 mA is off the small-signal operating " +
					"point of a pedal stage (~1 mA), disclosed per the PN2222A precedent; geometric midpoint " +
					"(form 2, gains): sqrt(80 * 250) = 141.4213562.",
			},
		},
	},
	{
		partIds: ["ACY20"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 85.1469318,
				basis: "derived",
				source:
					"Newmarket Semiconductors 'Germanium Alloy Transistors' PNP REFERENCE TABLE ('Maximum " +
					"ratings. Characteristics at TA = 25°C'; one-page catalogue scan, page 1065, section tab " +
					"7, DatasheetArchive-hosted PDF; local copy " +
					"workbench/tmp/newmarket-germanium-transistor-datasheet.pdf, read 2026-11-02; the table " +
					"prints no Vbe figure for any part, so no IS derivation exists), row 'ACY 20': 'hFE " +
					"(VCE/IC) (V/mA) 50 ... 145(0/50)' (BVCEO 20 V, BVCBO 40 V, BVEBO 12 V, ICM 1.0 A, VCEsat " +
					"0.2 V at 50/1.3 mA, max ICBO 10 uA at VCB 6 V, stock no. 27717C carry no gain " +
					"information)",
				derivation:
					"Printed hFE bin 50-145 at VCE/IC = 0/50 V/mA as printed (a printed VCE of 0 " +
					"V, transcribed as the table states it); IC = 50 mA is off the small-signal operating " +
					"point of a pedal stage (~1 mA), disclosed per the PN2222A precedent; geometric midpoint " +
					"(form 2, gains): sqrt(50 * 145) = 85.1469318.",
			},
		},
	},
	{
		partIds: ["ACY21"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 150,
				basis: "derived",
				source:
					"Newmarket Semiconductors 'Germanium Alloy Transistors' PNP REFERENCE TABLE ('Maximum " +
					"ratings. Characteristics at TA = 25°C'; one-page catalogue scan, page 1065, section tab " +
					"7, DatasheetArchive-hosted PDF; local copy " +
					"workbench/tmp/newmarket-germanium-transistor-datasheet.pdf, read 2026-11-02; the table " +
					"prints no Vbe figure for any part, so no IS derivation exists), row 'ACY 21': 'hFE " +
					"(VCE/IC) (V/mA) 90 ... 250(0/50)' (BVCEO 20 V, BVCBO 40 V, BVEBO 12 V, ICM 1.0 A, VCEsat " +
					"0.2 V at 50/1.3 mA, max ICBO 10 uA at VCB 6 V, stock no. 27718A carry no gain " +
					"information)",
				derivation:
					"Printed hFE bin 90-250 at VCE/IC = 0/50 V/mA as printed (a printed VCE of 0 " +
					"V, transcribed as the table states it); IC = 50 mA is off the small-signal operating " +
					"point of a pedal stage (~1 mA), disclosed per the PN2222A precedent; geometric midpoint " +
					"(form 2, gains): sqrt(90 * 250) = 150.",
			},
		},
	},
	{
		partIds: ["ACY22"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 94.8683298,
				basis: "derived",
				source:
					"Newmarket Semiconductors 'Germanium Alloy Transistors' PNP REFERENCE TABLE ('Maximum " +
					"ratings. Characteristics at TA = 25°C'; one-page catalogue scan, page 1065, section tab " +
					"7, DatasheetArchive-hosted PDF; local copy " +
					"workbench/tmp/newmarket-germanium-transistor-datasheet.pdf, read 2026-11-02; the table " +
					"prints no Vbe figure for any part, so no IS derivation exists), row 'ACY 22': 'hFE " +
					"(VCE/IC) (V/mA) 30 ... 300(0/300)' (BVCEO 15 V, BVCBO 20 V, BVEBO 12 V, ICM 1.0 A, " +
					"VCEsat 0.3 V at 300/15 mA, max ICBO 10 uA at VCB 6 V, stock no. 27719X carry no gain " +
					"information)",
				derivation:
					"Printed hFE bin 30-300 at VCE/IC = 0/300 V/mA as printed (a printed VCE of 0 " +
					"V, transcribed as the table states it); IC = 300 mA is off the small-signal operating " +
					"point of a pedal stage (~1 mA), disclosed per the PN2222A precedent; geometric midpoint " +
					"(form 2, gains): sqrt(30 * 300) = 94.8683298.",
			},
		},
	},
	{
		partIds: ["ACY39"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 86.6025404,
				basis: "derived",
				source:
					"Newmarket Semiconductors 'Germanium Alloy Transistors' PNP REFERENCE TABLE ('Maximum " +
					"ratings. Characteristics at TA = 25°C'; one-page catalogue scan, page 1065, section tab " +
					"7, DatasheetArchive-hosted PDF; local copy " +
					"workbench/tmp/newmarket-germanium-transistor-datasheet.pdf, read 2026-11-02; the table " +
					"prints no Vbe figure for any part, so no IS derivation exists), row 'ACY 39': 'hFE " +
					"(VCE/IC) (V/mA) 50 ... 150(0/300)' (BVCEO 40 V, BVCBO 110 V, BVEBO 12 V, ICM 1.0 A, " +
					"VCEsat 0.3 V at 300/15 mA, max ICBO 10 uA at VCB 6 V, stock no. 27720B carry no gain " +
					"information)",
				derivation:
					"Printed hFE bin 50-150 at VCE/IC = 0/300 V/mA as printed (a printed VCE of 0 " +
					"V, transcribed as the table states it); IC = 300 mA is off the small-signal operating " +
					"point of a pedal stage (~1 mA), disclosed per the PN2222A precedent; geometric midpoint " +
					"(form 2, gains): sqrt(50 * 150) = 86.6025404.",
			},
		},
	},
	{
		partIds: ["ACY40"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 45.8257569,
				basis: "derived",
				source:
					"Newmarket Semiconductors 'Germanium Alloy Transistors' PNP REFERENCE TABLE ('Maximum " +
					"ratings. Characteristics at TA = 25°C'; one-page catalogue scan, page 1065, section tab " +
					"7, DatasheetArchive-hosted PDF; local copy " +
					"workbench/tmp/newmarket-germanium-transistor-datasheet.pdf, read 2026-11-02; the table " +
					"prints no Vbe figure for any part, so no IS derivation exists), row 'ACY 40': 'hFE " +
					"(VCE/IC) (V/mA) 30 ... 70(0/300)' (BVCEO 18 V, BVCBO 32 V, BVEBO 12 V, ICM 1.0 A, VCEsat " +
					"0.3 V at 300/15 mA, max ICBO 10 uA at VCB 6 V, stock no. 27721X carry no gain " +
					"information)",
				derivation:
					"Printed hFE bin 30-70 at VCE/IC = 0/300 V/mA as printed (a printed VCE of 0 " +
					"V, transcribed as the table states it); IC = 300 mA is off the small-signal operating " +
					"point of a pedal stage (~1 mA), disclosed per the PN2222A precedent; geometric midpoint " +
					"(form 2, gains): sqrt(30 * 70) = 45.8257569.",
			},
		},
	},
	{
		partIds: ["OC44N"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 94.8683298,
				basis: "derived",
				source:
					"Newmarket Semiconductors 'Germanium Alloy Transistors' PNP REFERENCE TABLE ('Maximum " +
					"ratings. Characteristics at TA = 25°C'; one-page catalogue scan, page 1065, section tab " +
					"7, DatasheetArchive-hosted PDF; local copy " +
					"workbench/tmp/newmarket-germanium-transistor-datasheet.pdf, read 2026-11-02; the table " +
					"prints no Vbe figure for any part, so no IS derivation exists), row 'OC 44N': 'hFE " +
					"(VCE/IC) (V/mA) 40 ... 225(6/1)' (BVCBO 15 V, BVEBO 12 V, ICM 0.01 A, max ICBO 10 uA at " +
					"VCB 15 V, stock no. 31452H carry no gain information)",
				derivation:
					"Printed hFE bin 40-225 at VCE/IC = 6/1 V/mA as printed; geometric midpoint " +
					"(form 2, gains): sqrt(40 * 225) = 94.8683298.",
			},
		},
	},
	{
		partIds: ["OC45N"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 55.9016994,
				basis: "derived",
				source:
					"Newmarket Semiconductors 'Germanium Alloy Transistors' PNP REFERENCE TABLE ('Maximum " +
					"ratings. Characteristics at TA = 25°C'; one-page catalogue scan, page 1065, section tab " +
					"7, DatasheetArchive-hosted PDF; local copy " +
					"workbench/tmp/newmarket-germanium-transistor-datasheet.pdf, read 2026-11-02; the table " +
					"prints no Vbe figure for any part, so no IS derivation exists), row 'OC 45N': 'hFE " +
					"(VCE/IC) (V/mA) 25 ... 125(6/1)' (BVCBO 15 V, BVEBO 12 V, ICM 0.01 A, max ICBO 10 uA at " +
					"VCB 15 V, stock no. 31453F carry no gain information)",
				derivation:
					"Printed hFE bin 25-125 at VCE/IC = 6/1 V/mA as printed; geometric midpoint " +
					"(form 2, gains): sqrt(25 * 125) = 55.9016994.",
			},
		},
	},
	{
		partIds: ["OC72"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 73.4846923,
				basis: "derived",
				source:
					"Newmarket Semiconductors 'Germanium Alloy Transistors' PNP REFERENCE TABLE ('Maximum " +
					"ratings. Characteristics at TA = 25°C'; one-page catalogue scan, page 1065, section tab " +
					"7, DatasheetArchive-hosted PDF; local copy " +
					"workbench/tmp/newmarket-germanium-transistor-datasheet.pdf, read 2026-11-02; the table " +
					"prints no Vbe figure for any part, so no IS derivation exists), row 'OC 72': 'hFE " +
					"(VCE/IC) (V/mA) 45 ... 120(5.4/10)' (BVCEO 16 V, BVCBO 32 V, BVEBO 10 V, ICM 0.125 A, " +
					"VCEsat <0.3 V at 125/12.5 mA, max ICBO 10 uA at VCB 10 V, stock no. 31454D carry no gain " +
					"information)",
				derivation:
					"Printed hFE bin 45-120 at VCE/IC = 5.4/10 V/mA as printed; geometric " +
					"midpoint (form 2, gains): sqrt(45 * 120) = 73.4846923.",
			},
		},
	},
	{
		partIds: ["NKT11"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 140.7124728,
				basis: "derived",
				source:
					"Newmarket Semiconductors 'Germanium Alloy Transistors' PNP REFERENCE TABLE ('Maximum " +
					"ratings. Characteristics at TA = 25°C'; one-page catalogue scan, page 1065, section tab " +
					"7, DatasheetArchive-hosted PDF; local copy " +
					"workbench/tmp/newmarket-germanium-transistor-datasheet.pdf, read 2026-11-02; the table " +
					"prints no Vbe figure for any part, so no IS derivation exists), row 'NKT 11': 'hFE " +
					"(VCE/IC) (V/mA) 90 ... 220(4.5/1)*' (BVCEO 10 V, BVCBO 18 V, BVEBO 12 V, ICM 0.075 A, " +
					"VCEsat <0.2 V at 8/0.5 mA, max ICBO 5 uA at VCB 6 V, stock no. 16635X carry no gain " +
					"information)",
				derivation:
					"Printed hFE bin 90-220; the asterisked row is the table's '*hfe (f = 1 kHz)' " +
					"small-signal bin at VCE = 4.5 V, IC = 1 mA; admitted as the DC beta by the " +
					"2N2222A/2N5088 precedent (1 kHz is far below fT, so hfe approximates hFE); geometric " +
					"midpoint (form 2, gains): sqrt(90 * 220) = 140.7124728.",
			},
		},
	},
	{
		partIds: ["NKT12"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 90,
				basis: "derived",
				source:
					"Newmarket Semiconductors 'Germanium Alloy Transistors' PNP REFERENCE TABLE ('Maximum " +
					"ratings. Characteristics at TA = 25°C'; one-page catalogue scan, page 1065, section tab " +
					"7, DatasheetArchive-hosted PDF; local copy " +
					"workbench/tmp/newmarket-germanium-transistor-datasheet.pdf, read 2026-11-02; the table " +
					"prints no Vbe figure for any part, so no IS derivation exists), row 'NKT 12': 'hFE " +
					"(VCE/IC) (V/mA) 45 ... 180(4.5/1)' (BVCEO 10 V, BVCBO 18 V, BVEBO 12 V, ICM 0.075 A, " +
					"VCEsat <0.2 V at 8/0.5 mA, max ICBO 5 uA at VCB 6 V, stock no. 16636R carry no gain " +
					"information)",
				derivation:
					"Printed hFE bin 45-180 at VCE/IC = 4.5/1 V/mA as printed; geometric midpoint " +
					"(form 2, gains): sqrt(45 * 180) = 90.",
			},
		},
	},
	{
		partIds: ["NKT213"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 80.6225775,
				basis: "derived",
				source:
					"Newmarket Semiconductors 'Germanium Alloy Transistors' PNP REFERENCE TABLE ('Maximum " +
					"ratings. Characteristics at TA = 25°C'; one-page catalogue scan, page 1065, section tab " +
					"7, DatasheetArchive-hosted PDF; local copy " +
					"workbench/tmp/newmarket-germanium-transistor-datasheet.pdf, read 2026-11-02; the table " +
					"prints no Vbe figure for any part, so no IS derivation exists), row 'NKT 213': 'hFE " +
					"(VCE/IC) (V/mA) 50 ... 130(4.5/1)*' (BVCBO 32 V, BVEBO 10 V, ICM 0.25 A, VCEsat <0.2 V " +
					"at 25/2.5 mA, max ICBO 10 uA at VCB 10 V, stock no. 27704B carry no gain information)",
				derivation:
					"Printed hFE bin 50-130; the asterisked row is the table's '*hfe (f = 1 kHz)' " +
					"small-signal bin at VCE = 4.5 V, IC = 1 mA; admitted as the DC beta by the " +
					"2N2222A/2N5088 precedent (1 kHz is far below fT, so hfe approximates hFE); geometric " +
					"midpoint (form 2, gains): sqrt(50 * 130) = 80.6225775.",
			},
		},
	},
	{
		partIds: ["NKT214"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 47.4341649,
				basis: "derived",
				source:
					"Newmarket Semiconductors 'Germanium Alloy Transistors' PNP REFERENCE TABLE ('Maximum " +
					"ratings. Characteristics at TA = 25°C'; one-page catalogue scan, page 1065, section tab " +
					"7, DatasheetArchive-hosted PDF; local copy " +
					"workbench/tmp/newmarket-germanium-transistor-datasheet.pdf, read 2026-11-02; the table " +
					"prints no Vbe figure for any part, so no IS derivation exists), row 'NKT 214': 'hFE " +
					"(VCE/IC) (V/mA) 30 ... 75(4.5/1)*' (BVCBO 32 V, BVEBO 10 V, ICM 0.25 A, VCEsat <0.2 V at " +
					"25/2.5 mA, max ICBO 10 uA at VCB 10 V, stock no. 27705X carry no gain information)",
				derivation:
					"Printed hFE bin 30-75; the asterisked row is the table's '*hfe (f = 1 kHz)' small-signal " +
					"bin at VCE = 4.5 V, IC = 1 mA; admitted as the DC beta by the 2N2222A/2N5088 precedent " +
					"(1 kHz is far below fT, so hfe approximates hFE); geometric midpoint (form 2, gains): " +
					"sqrt(30 * 75) = 47.4341649.",
			},
		},
	},
	{
		partIds: ["NKT216"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 25.9807621,
				basis: "derived",
				source:
					"Newmarket Semiconductors 'Germanium Alloy Transistors' PNP REFERENCE TABLE ('Maximum " +
					"ratings. Characteristics at TA = 25°C'; one-page catalogue scan, page 1065, section tab " +
					"7, DatasheetArchive-hosted PDF; local copy " +
					"workbench/tmp/newmarket-germanium-transistor-datasheet.pdf, read 2026-11-02; the table " +
					"prints no Vbe figure for any part, so no IS derivation exists), row 'NKT 216': 'hFE " +
					"(VCE/IC) (V/mA) 15 ... 45(4.5/1)*' (BVCBO 32 V, BVEBO 10 V, ICM 0.25 A, VCEsat <0.2 V at " +
					"25/2.5 mA, max ICBO 10 uA at VCB 10 V, stock no. 27707G carry no gain information)",
				derivation:
					"Printed hFE bin 15-45; the asterisked row is the table's '*hfe (f = 1 kHz)' small-signal " +
					"bin at VCE = 4.5 V, IC = 1 mA; admitted as the DC beta by the 2N2222A/2N5088 precedent " +
					"(1 kHz is far below fT, so hfe approximates hFE); geometric midpoint (form 2, gains): " +
					"sqrt(15 * 45) = 25.9807621.",
			},
		},
	},
	{
		partIds: ["NKT217"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 86.6025404,
				basis: "derived",
				source:
					"Newmarket Semiconductors 'Germanium Alloy Transistors' PNP REFERENCE TABLE ('Maximum " +
					"ratings. Characteristics at TA = 25°C'; one-page catalogue scan, page 1065, section tab " +
					"7, DatasheetArchive-hosted PDF; local copy " +
					"workbench/tmp/newmarket-germanium-transistor-datasheet.pdf, read 2026-11-02; the table " +
					"prints no Vbe figure for any part, so no IS derivation exists), row 'NKT 217': 'hFE " +
					"(VCE/IC) (V/mA) 50 ... 150(0/25)' (BVCEO 40 V, BVCBO 60 V, BVEBO 10 V, ICM 0.5 A, VCEsat " +
					"<0.5 V at 300/6 mA, max ICBO 10 uA at VCB 10 V, stock no. 27708E carry no gain " +
					"information)",
				derivation:
					"Printed hFE bin 50-150 at VCE/IC = 0/25 V/mA as printed (a printed VCE of 0 " +
					"V, transcribed as the table states it); IC = 25 mA is off the small-signal operating " +
					"point of a pedal stage (~1 mA), disclosed per the PN2222A precedent; geometric midpoint " +
					"(form 2, gains): sqrt(50 * 150) = 86.6025404.",
			},
		},
	},
	{
		partIds: ["NKT219"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 143.1782106,
				basis: "derived",
				source:
					"Newmarket Semiconductors 'Germanium Alloy Transistors' PNP REFERENCE TABLE ('Maximum " +
					"ratings. Characteristics at TA = 25°C'; one-page catalogue scan, page 1065, section tab " +
					"7, DatasheetArchive-hosted PDF; local copy " +
					"workbench/tmp/newmarket-germanium-transistor-datasheet.pdf, read 2026-11-02; the table " +
					"prints no Vbe figure for any part, so no IS derivation exists), row 'NKT 219': 'hFE " +
					"(VCE/IC) (V/mA) 82 ... 250(4.5/1)*' (BVCBO 32 V, BVEBO 10 V, ICM 0.25 A, VCEsat <0.2 V " +
					"at 25/2.5 mA, max ICBO 10 uA at VCB 10 V, stock no. 27709C carry no gain information)",
				derivation:
					"Printed hFE bin 82-250; the asterisked row is the table's '*hfe (f = 1 kHz)' " +
					"small-signal bin at VCE = 4.5 V, IC = 1 mA; admitted as the DC beta by the " +
					"2N2222A/2N5088 precedent (1 kHz is far below fT, so hfe approximates hFE); geometric " +
					"midpoint (form 2, gains): sqrt(82 * 250) = 143.1782106.",
			},
		},
	},
	{
		partIds: ["NKT223"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 100,
				basis: "derived",
				source:
					"Newmarket Semiconductors 'Germanium Alloy Transistors' PNP REFERENCE TABLE ('Maximum " +
					"ratings. Characteristics at TA = 25°C'; one-page catalogue scan, page 1065, section tab " +
					"7, DatasheetArchive-hosted PDF; local copy " +
					"workbench/tmp/newmarket-germanium-transistor-datasheet.pdf, read 2026-11-02; the table " +
					"prints no Vbe figure for any part, so no IS derivation exists), row 'NKT 223': 'hFE " +
					"(VCE/IC) (V/mA) 50 ... 200(4.5/1)' (BVCBO 30 V, BVEBO 10 V, ICM 0.5 A, VCEsat <0.2 V at " +
					"25/2.5 mA, max ICBO 10 uA at VCB 10 V, stock no. 27710F carry no gain information)",
				derivation:
					"Printed hFE bin 50-200 at VCE/IC = 4.5/1 V/mA as printed; geometric midpoint " +
					"(form 2, gains): sqrt(50 * 200) = 100.",
			},
		},
	},
	{
		partIds: ["NKT224"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 51.9615242,
				basis: "derived",
				source:
					"Newmarket Semiconductors 'Germanium Alloy Transistors' PNP REFERENCE TABLE ('Maximum " +
					"ratings. Characteristics at TA = 25°C'; one-page catalogue scan, page 1065, section tab " +
					"7, DatasheetArchive-hosted PDF; local copy " +
					"workbench/tmp/newmarket-germanium-transistor-datasheet.pdf, read 2026-11-02; the table " +
					"prints no Vbe figure for any part, so no IS derivation exists), row 'NKT 224': 'hFE " +
					"(VCE/IC) (V/mA) 30 ... 90(4.5/1)' (BVCBO 30 V, BVEBO 10 V, ICM 0.5 A, VCEsat <0.2 V at " +
					"25/2.5 mA, max ICBO 10 uA at VCB 10 V, stock no. 27711D carry no gain information)",
				derivation:
					"Printed hFE bin 30-90 at VCE/IC = 4.5/1 V/mA as printed; geometric midpoint " +
					"(form 2, gains): sqrt(30 * 90) = 51.9615242.",
			},
		},
	},
	{
		partIds: ["NKT271"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 111.8033989,
				basis: "derived",
				source:
					"Newmarket Semiconductors 'Germanium Alloy Transistors' PNP REFERENCE TABLE ('Maximum " +
					"ratings. Characteristics at TA = 25°C'; one-page catalogue scan, page 1065, section tab " +
					"7, DatasheetArchive-hosted PDF; local copy " +
					"workbench/tmp/newmarket-germanium-transistor-datasheet.pdf, read 2026-11-02; the table " +
					"prints no Vbe figure for any part, so no IS derivation exists), row 'NKT 271': 'hFE " +
					"(VCE/IC) (V/mA) 50 ... 250(1.5/50)' (BVCBO 15 V, BVEBO 5 V, ICM 0.5 A, max ICBO 10 uA at " +
					"VCB 10 V, stock no. 15627E carry no gain information)",
				derivation:
					"Printed hFE bin 50-250 at VCE/IC = 1.5/50 V/mA as printed; IC = 50 mA is off " +
					"the small-signal operating point of a pedal stage (~1 mA), disclosed per the PN2222A " +
					"precedent; geometric midpoint (form 2, gains): sqrt(50 * 250) = 111.8033989.",
			},
		},
	},
	{
		partIds: ["NKT272"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 56.1248608,
				basis: "derived",
				source:
					"Newmarket Semiconductors 'Germanium Alloy Transistors' PNP REFERENCE TABLE ('Maximum " +
					"ratings. Characteristics at TA = 25°C'; one-page catalogue scan, page 1065, section tab " +
					"7, DatasheetArchive-hosted PDF; local copy " +
					"workbench/tmp/newmarket-germanium-transistor-datasheet.pdf, read 2026-11-02; the table " +
					"prints no Vbe figure for any part, so no IS derivation exists), row 'NKT 272': 'hFE " +
					"(VCE/IC) (V/mA) 35 ... 90(4.5/1)*' (BVCBO 15 V, BVEBO 5 V, ICM 0.25 A, max ICBO 10 uA at " +
					"VCB 10 V, stock no. 15628C carry no gain information)",
				derivation:
					"Printed hFE bin 35-90; the asterisked row is the table's '*hfe (f = 1 kHz)' small-signal " +
					"bin at VCE = 4.5 V, IC = 1 mA; admitted as the DC beta by the 2N2222A/2N5088 precedent " +
					"(1 kHz is far below fT, so hfe approximates hFE); geometric midpoint (form 2, gains): " +
					"sqrt(35 * 90) = 56.1248608.",
			},
		},
	},
	{
		partIds: ["NKT274"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 143.1782106,
				basis: "derived",
				source:
					"Newmarket Semiconductors 'Germanium Alloy Transistors' PNP REFERENCE TABLE ('Maximum " +
					"ratings. Characteristics at TA = 25°C'; one-page catalogue scan, page 1065, section tab " +
					"7, DatasheetArchive-hosted PDF; local copy " +
					"workbench/tmp/newmarket-germanium-transistor-datasheet.pdf, read 2026-11-02; the table " +
					"prints no Vbe figure for any part, so no IS derivation exists), row 'NKT 274': 'hFE " +
					"(VCE/IC) (V/mA) 82 ... 250(4.5/1)*' (BVCBO 15 V, BVEBO 5 V, ICM 0.25 A, max ICBO 10 uA " +
					"at VCB 10 V, stock no. 15629A carry no gain information)",
				derivation:
					"Printed hFE bin 82-250; the asterisked row is the table's '*hfe (f = 1 kHz)' " +
					"small-signal bin at VCE = 4.5 V, IC = 1 mA; admitted as the DC beta by the " +
					"2N2222A/2N5088 precedent (1 kHz is far below fT, so hfe approximates hFE); geometric " +
					"midpoint (form 2, gains): sqrt(82 * 250) = 143.1782106.",
			},
		},
	},
	{
		partIds: ["NKT281"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 102.4695077,
				basis: "derived",
				source:
					"Newmarket Semiconductors 'Germanium Alloy Transistors' PNP REFERENCE TABLE ('Maximum " +
					"ratings. Characteristics at TA = 25°C'; one-page catalogue scan, page 1065, section tab " +
					"7, DatasheetArchive-hosted PDF; local copy " +
					"workbench/tmp/newmarket-germanium-transistor-datasheet.pdf, read 2026-11-02; the table " +
					"prints no Vbe figure for any part, so no IS derivation exists), row 'NKT 281': 'hFE " +
					"(VCE/IC) (V/mA) 60 ... 175(1/300)' (BVCEO 16 V, BVCBO 32 V, BVEBO 10 V, ICM 1.0 A, max " +
					"ICBO 10 uA at VCB 10 V, stock no. 15631B carry no gain information)",
				derivation:
					"Printed hFE bin 60-175 at VCE/IC = 1/300 V/mA as printed; IC = 300 mA is off " +
					"the small-signal operating point of a pedal stage (~1 mA), disclosed per the PN2222A " +
					"precedent; geometric midpoint (form 2, gains): sqrt(60 * 175) = 102.4695077.",
			},
		},
	},
	{
		partIds: ["2N1305"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 89.4427191,
				basis: "derived",
				source:
					"Newmarket Semiconductors 'Germanium Alloy Transistors' PNP REFERENCE TABLE ('Maximum " +
					"ratings. Characteristics at TA = 25°C'; one-page catalogue scan, page 1065, section tab " +
					"7, DatasheetArchive-hosted PDF; local copy " +
					"workbench/tmp/newmarket-germanium-transistor-datasheet.pdf, read 2026-11-02; the table " +
					"prints no Vbe figure for any part, so no IS derivation exists), row '2N1305': 'hFE " +
					"(VCE/IC) (V/mA) 40 ... 200(1/10)' (BVCEO 20 V, BVCBO 25 V, BVEBO 25 V, ICM 0.3 A, stock " +
					"no. 34599X carry no gain information)",
				derivation:
					"Printed hFE bin 40-200 at VCE/IC = 1/10 V/mA as printed; geometric midpoint " +
					"(form 2, gains): sqrt(40 * 200) = 89.4427191.",
			},
		},
	},
	{
		partIds: ["2N1307"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 134.1640786,
				basis: "derived",
				source:
					"Newmarket Semiconductors 'Germanium Alloy Transistors' PNP REFERENCE TABLE ('Maximum " +
					"ratings. Characteristics at TA = 25°C'; one-page catalogue scan, page 1065, section tab " +
					"7, DatasheetArchive-hosted PDF; local copy " +
					"workbench/tmp/newmarket-germanium-transistor-datasheet.pdf, read 2026-11-02; the table " +
					"prints no Vbe figure for any part, so no IS derivation exists), row '2N1307': 'hFE " +
					"(VCE/IC) (V/mA) 60 ... 300(1/10)' (BVCEO 15 V, BVCBO 25 V, BVEBO 25 V, ICM 0.3 A, stock " +
					"no. 34600A carry no gain information)",
				derivation:
					"Printed hFE bin 60-300 at VCE/IC = 1/10 V/mA as printed; geometric midpoint " +
					"(form 2, gains): sqrt(60 * 300) = 134.1640786.",
			},
		},
	},
	{
		// NKT275 (2026-11-02): community, published measurement. Not on the Newmarket reference
		// table above; Newmarket's own figure is MIN-only hFE 30 (wave 7 left it out for that
		// reason). Amplified Parts curve-traced two original white-dot specimens and published the
		// raw DCA75 data, so both parameters are read from the raw rows nearest IC = 1 mA on the
		// VCE = 5 V traces (a pedal stage's operating region), one row per specimen, pooled by
		// geometric mean. Two specimens only, 2.7x apart in gain: provisional, and the compiler
		// names every device that runs on it. The ZVex Fuzz Factory packet declares its own
		// NKT275 overrides (BF 85/125), which take precedence over this row. Polarity is
		// structural (PNP).
		partIds: ["NKT275"],
		class: "bjt",
		note:
			"Two-specimen pooled values. Q1 reads hFE 53.7 / IS 1.33e-6 and Q2 hFE 143.5 / IS 2.38e-6 " +
			"at IC ~ 1 mA, VCE = 5 V; Q2 carries 34 uA leakage (article), ~3% of the 1 mA row.",
		params: {
			saturationCurrent: {
				value: 1.778757e-6,
				basis: "community",
				source:
					"Amplified Parts, Tech Corner article 'Newmarket NKT275 White Dot Transistor " +
					"Measurements', " +
					"https://www.amplifiedparts.com/tech-articles/newmarket-nkt275-measurements (read " +
					"2026-11-02): two original Newmarket NKT275 (white dot) specimens from an early Cornell " +
					"First Fuzz, curve-traced on a Peak DCA75 ('All measurements were taken with the " +
					"transistors stabilized to room temperature. The room measured 77°F'; 'In the First Fuzz, " +
					"Q1 had zero leakage while Q2 had 34µA'), raw data published as " +
					"https://www.amplifiedparts.com/sites/all/modules/custom/tech_corner/data/nkt275-raw-data.zip " +
					"(local copy parts/bjts/NKT275/datasheets/nkt275-raw-data.zip); raw rows: " +
					"Q1_4_Ic_vbe.txt, trace 'Q1, Vce=5V', point 17: 'Vbe 0.173673629760742, Ic (mA) " +
					"1.10184299945831'; Q2_4_ic_vbe.txt, trace 'Vce=5V', point 20: 'Vbe 0.156471252441406, Ic " +
					"(mA) 1.00995790958405'. IS per specimen by form 1 (IS = IC * exp(-Vbe / Vt), n = 1, Vt = " +
					"0.025852): Q1 1.10184299945831e-3 * exp(-0.173673629760742 / 0.025852) = 1.332083e-6; Q2 " +
					"1.00995790958405e-3 * exp(-0.156471252441406 / 0.025852) = 2.375210e-6; pooled geometric " +
					"mean sqrt(1.332083e-6 * 2.375210e-6) = 1.778757e-6 (Vbe-equivalent 0.1637 V at 1 mA).",
				sourceKind: "published-measurement",
				url: "https://www.amplifiedparts.com/tech-articles/newmarket-nkt275-measurements",
				quote:
					"Q1_4_Ic_vbe.txt, trace 'Q1, Vce=5V', point 17: 'Vbe 0.173673629760742, Ic (mA) " +
					"1.10184299945831'; Q2_4_ic_vbe.txt, trace 'Vce=5V', point 20: 'Vbe 0.156471252441406, Ic " +
					"(mA) 1.00995790958405'",
				author: "Amplified Parts (Tech Corner)",
				retrievedDate: "2026-11-02",
				whyNoBetterSource:
					"Newmarket's own NKT275 data (every located copy: alltransistors, datasheetarchive index " +
					"entries, distributor listings) is MIN-only hFE 30 with no Vbe row, and the Newmarket " +
					"'Germanium Alloy Transistors' reference table carries no NKT275 row at all; no " +
					"manufacturer SPICE model exists (Newmarket is defunct); no owner bench measurement; the " +
					"Holmes/Holters/van Walstijn DAFx-2017 extractions cover OC44 and AC128 only. A published " +
					"two-specimen curve-tracer dataset with downloadable raw numbers is the best available " +
					"source; both specimens are quoted so the pooled value can be recomputed, and germanium " +
					"spread is disclosed (the two gains differ 2.7x).",
			},
			forwardBeta: {
				value: 87.7666273,
				basis: "community",
				source:
					"Amplified Parts, Tech Corner article 'Newmarket NKT275 White Dot Transistor " +
					"Measurements', " +
					"https://www.amplifiedparts.com/tech-articles/newmarket-nkt275-measurements (read " +
					"2026-11-02): two original Newmarket NKT275 (white dot) specimens from an early Cornell " +
					"First Fuzz, curve-traced on a Peak DCA75 ('All measurements were taken with the " +
					"transistors stabilized to room temperature. The room measured 77°F'; 'In the First Fuzz, " +
					"Q1 had zero leakage while Q2 had 34µA'), raw data published as " +
					"https://www.amplifiedparts.com/sites/all/modules/custom/tech_corner/data/nkt275-raw-data.zip " +
					"(local copy parts/bjts/NKT275/datasheets/nkt275-raw-data.zip); raw rows: " +
					"Q1_3_hfe_ic.txt, trace 'Q1, Vce=5V', point 18: 'Ic (mA) 1.01584208011627, hFE " +
					"53.6911282492335'; Q2_3_hfe_ic.txt, trace 'Vce=5V', point 3: 'Ic (mA) 0.977419555187225, " +
					"hFE 143.468411103812'. Pooled geometric mean (form 2, gains, over the two specimens): " +
					"sqrt(53.6911282492335 * 143.468411103812) = 87.7666273.",
				sourceKind: "published-measurement",
				url: "https://www.amplifiedparts.com/tech-articles/newmarket-nkt275-measurements",
				quote:
					"Q1_3_hfe_ic.txt, trace 'Q1, Vce=5V', point 18: 'Ic (mA) 1.01584208011627, hFE " +
					"53.6911282492335'; Q2_3_hfe_ic.txt, trace 'Vce=5V', point 3: 'Ic (mA) 0.977419555187225, " +
					"hFE 143.468411103812'",
				author: "Amplified Parts (Tech Corner)",
				retrievedDate: "2026-11-02",
				whyNoBetterSource:
					"Newmarket's own NKT275 data (every located copy: alltransistors, datasheetarchive index " +
					"entries, distributor listings) is MIN-only hFE 30 with no Vbe row, and the Newmarket " +
					"'Germanium Alloy Transistors' reference table carries no NKT275 row at all; no " +
					"manufacturer SPICE model exists (Newmarket is defunct); no owner bench measurement; the " +
					"Holmes/Holters/van Walstijn DAFx-2017 extractions cover OC44 and AC128 only. A published " +
					"two-specimen curve-tracer dataset with downloadable raw numbers is the best available " +
					"source; both specimens are quoted so the pooled value can be recomputed, and germanium " +
					"spread is disclosed (the two gains differ 2.7x).",
			},
		},
	},
	{
		// Towers' selector p239 (2026-11-03): the NKT122-NKT275J page of the compilation.
		// Only the rows whose HFE column prints a typical (TP) are taken, transcribed at the
		// stated HFE BIAS current (a TYP is one value, no midpoint); the MN (minimum-only)
		// rows -- NKT122-129, 133-142, 210-275J -- are limits and stay out, which is also why
		// the NKT213/214/216/217/219/223/224/271/272/274 rows above keep their Newmarket
		// reference-table bins and NKT275 its community row. The book is a compilation of
		// maker data, disclosed in every citation; no Vbe column, so no IS (OC75 bias caveat).
		// NKT202/207 (25 mA) and NKT208 (500 mA) are off the ~1 mA pedal operating point,
		// disclosed. Polarity is structural (PNP: the PM/OA/LT column reads PG).
		partIds: ["NKT131"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 50,
				basis: "datasheet",
				source:
					"Towers' International Transistor Selector (T. D. Towers, W. Foulsham & Co; a compilation " +
					"of maker data, not a Newmarket sheet -- edition not identifiable from the single scanned " +
					"page), p239 'NKT122 ... NKT275J' (DatasheetArchive scan DSA841000-47; local copy " +
					"newmarket/datasheets/towers-international-transistor-selector-p239-nkt122-nkt275j.pdf, " +
					"read 2026-11-03). Columns: PM/OA/LT, PACKAGE, LEAD INFO, VCB MAX, VCE MAX, VEB MAX, IC " +
					"MAX, TJ MAX, P TOT, FT MIN, COB MAX, HFE, HFE BIAS, USE, MFR, EUR EQUIV, USA EQUIV, ISS; " +
					"the HFE column prints MN (minimum) or TP (typical) at the HFE BIAS collector current; no " +
					"Vbe column, so no IS; row 'NKT131': 'PG T022 L39 15V 15V . 25MA 75C 125MWF 8M 30P 50TP " +
					"1MA RLG OBS OC44N 2N2614 0' -- HFE 50TP at HFE BIAS 1MA (the ratings, FT, COB, USE, MFR " +
					"and equivalents columns carry no gain information). Printed hFE TYP 50 at IC = 1 mA, " +
					"transcribed (no midpoint: a TYP is already one value).",
			},
		},
	},
	{
		partIds: ["NKT132"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 40,
				basis: "datasheet",
				source:
					"Towers' International Transistor Selector (T. D. Towers, W. Foulsham & Co; a compilation " +
					"of maker data, not a Newmarket sheet -- edition not identifiable from the single scanned " +
					"page), p239 'NKT122 ... NKT275J' (DatasheetArchive scan DSA841000-47; local copy " +
					"newmarket/datasheets/towers-international-transistor-selector-p239-nkt122-nkt275j.pdf, " +
					"read 2026-11-03). Columns: PM/OA/LT, PACKAGE, LEAD INFO, VCB MAX, VCE MAX, VEB MAX, IC " +
					"MAX, TJ MAX, P TOT, FT MIN, COB MAX, HFE, HFE BIAS, USE, MFR, EUR EQUIV, USA EQUIV, ISS; " +
					"the HFE column prints MN (minimum) or TP (typical) at the HFE BIAS collector current; no " +
					"Vbe column, so no IS; row 'NKT132': 'PG T022 L39 15V 15V . 25MA 75C 125MWF 4M 30P 40TP " +
					"1MA RLG OBS OC44N 2N2614 0' -- HFE 40TP at HFE BIAS 1MA (the ratings, FT, COB, USE, MFR " +
					"and equivalents columns carry no gain information). Printed hFE TYP 40 at IC = 1 mA, " +
					"transcribed (no midpoint: a TYP is already one value).",
			},
		},
	},
	{
		partIds: ["NKT143"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 100,
				basis: "datasheet",
				source:
					"Towers' International Transistor Selector (T. D. Towers, W. Foulsham & Co; a compilation " +
					"of maker data, not a Newmarket sheet -- edition not identifiable from the single scanned " +
					"page), p239 'NKT122 ... NKT275J' (DatasheetArchive scan DSA841000-47; local copy " +
					"newmarket/datasheets/towers-international-transistor-selector-p239-nkt122-nkt275j.pdf, " +
					"read 2026-11-03). Columns: PM/OA/LT, PACKAGE, LEAD INFO, VCB MAX, VCE MAX, VEB MAX, IC " +
					"MAX, TJ MAX, P TOT, FT MIN, COB MAX, HFE, HFE BIAS, USE, MFR, EUR EQUIV, USA EQUIV, ISS; " +
					"the HFE column prints MN (minimum) or TP (typical) at the HFE BIAS collector current; no " +
					"Vbe column, so no IS; row 'NKT143': 'PG T05 L04 15V 12V 12V 25MA 75C 125MWF 3M 35P 100TP " +
					"1MA RLA NEM ASY27 2N1305 0' -- HFE 100TP at HFE BIAS 1MA (the ratings, FT, COB, USE, MFR " +
					"and equivalents columns carry no gain information). Printed hFE TYP 100 at IC = 1 mA, " +
					"transcribed (no midpoint: a TYP is already one value).",
			},
		},
	},
	{
		partIds: ["NKT144"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 100,
				basis: "datasheet",
				source:
					"Towers' International Transistor Selector (T. D. Towers, W. Foulsham & Co; a compilation " +
					"of maker data, not a Newmarket sheet -- edition not identifiable from the single scanned " +
					"page), p239 'NKT122 ... NKT275J' (DatasheetArchive scan DSA841000-47; local copy " +
					"newmarket/datasheets/towers-international-transistor-selector-p239-nkt122-nkt275j.pdf, " +
					"read 2026-11-03). Columns: PM/OA/LT, PACKAGE, LEAD INFO, VCB MAX, VCE MAX, VEB MAX, IC " +
					"MAX, TJ MAX, P TOT, FT MIN, COB MAX, HFE, HFE BIAS, USE, MFR, EUR EQUIV, USA EQUIV, ISS; " +
					"the HFE column prints MN (minimum) or TP (typical) at the HFE BIAS collector current; no " +
					"Vbe column, so no IS; row 'NKT144': 'PG T05 L04 15V 12V 12V 25MA 75C 125MWF 3M 35P 100TP " +
					"1MA ALN NEM ASY27 2N1305 0' -- HFE 100TP at HFE BIAS 1MA (the ratings, FT, COB, USE, MFR " +
					"and equivalents columns carry no gain information). Printed hFE TYP 100 at IC = 1 mA, " +
					"transcribed (no midpoint: a TYP is already one value).",
			},
		},
	},
	{
		partIds: ["NKT151"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 150,
				basis: "datasheet",
				source:
					"Towers' International Transistor Selector (T. D. Towers, W. Foulsham & Co; a compilation " +
					"of maker data, not a Newmarket sheet -- edition not identifiable from the single scanned " +
					"page), p239 'NKT122 ... NKT275J' (DatasheetArchive scan DSA841000-47; local copy " +
					"newmarket/datasheets/towers-international-transistor-selector-p239-nkt122-nkt275j.pdf, " +
					"read 2026-11-03). Columns: PM/OA/LT, PACKAGE, LEAD INFO, VCB MAX, VCE MAX, VEB MAX, IC " +
					"MAX, TJ MAX, P TOT, FT MIN, COB MAX, HFE, HFE BIAS, USE, MFR, EUR EQUIV, USA EQUIV, ISS; " +
					"the HFE column prints MN (minimum) or TP (typical) at the HFE BIAS collector current; no " +
					"Vbe column, so no IS; row 'NKT151': 'PG T022 L39 6V 6V . 10MA 75C 75MWF 8M 30P 150TP 1MA " +
					"RLG OBS OC44N 2N2614 0' -- HFE 150TP at HFE BIAS 1MA (the ratings, FT, COB, USE, MFR and " +
					"equivalents columns carry no gain information). Printed hFE TYP 150 at IC = 1 mA, " +
					"transcribed (no midpoint: a TYP is already one value).",
			},
		},
	},
	{
		partIds: ["NKT152"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 100,
				basis: "datasheet",
				source:
					"Towers' International Transistor Selector (T. D. Towers, W. Foulsham & Co; a compilation " +
					"of maker data, not a Newmarket sheet -- edition not identifiable from the single scanned " +
					"page), p239 'NKT122 ... NKT275J' (DatasheetArchive scan DSA841000-47; local copy " +
					"newmarket/datasheets/towers-international-transistor-selector-p239-nkt122-nkt275j.pdf, " +
					"read 2026-11-03). Columns: PM/OA/LT, PACKAGE, LEAD INFO, VCB MAX, VCE MAX, VEB MAX, IC " +
					"MAX, TJ MAX, P TOT, FT MIN, COB MAX, HFE, HFE BIAS, USE, MFR, EUR EQUIV, USA EQUIV, ISS; " +
					"the HFE column prints MN (minimum) or TP (typical) at the HFE BIAS collector current; no " +
					"Vbe column, so no IS; row 'NKT152': 'PG T022 L39 6V 6V . 10MA 75C 75MWF 4M 30P 100TP 1MA " +
					"RLG OBS ASY27 2N1305 0' -- HFE 100TP at HFE BIAS 1MA (the ratings, FT, COB, USE, MFR and " +
					"equivalents columns carry no gain information). Printed hFE TYP 100 at IC = 1 mA, " +
					"transcribed (no midpoint: a TYP is already one value).",
			},
		},
	},
	{
		partIds: ["NKT154/25"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 50,
				basis: "datasheet",
				source:
					"Towers' International Transistor Selector (T. D. Towers, W. Foulsham & Co; a compilation " +
					"of maker data, not a Newmarket sheet -- edition not identifiable from the single scanned " +
					"page), p239 'NKT122 ... NKT275J' (DatasheetArchive scan DSA841000-47; local copy " +
					"newmarket/datasheets/towers-international-transistor-selector-p239-nkt122-nkt275j.pdf, " +
					"read 2026-11-03). Columns: PM/OA/LT, PACKAGE, LEAD INFO, VCB MAX, VCE MAX, VEB MAX, IC " +
					"MAX, TJ MAX, P TOT, FT MIN, COB MAX, HFE, HFE BIAS, USE, MFR, EUR EQUIV, USA EQUIV, ISS; " +
					"the HFE column prints MN (minimum) or TP (typical) at the HFE BIAS collector current; no " +
					"Vbe column, so no IS; row 'NKT154/25': 'PG T022 L39 6V 6V 6V 10MA 75C 75MWF 2M 30P 50TP " +
					"1MA RLG OBS ASY27 2N1305 0' -- HFE 50TP at HFE BIAS 1MA (the ratings, FT, COB, USE, MFR " +
					"and equivalents columns carry no gain information). Printed hFE TYP 50 at IC = 1 mA, " +
					"transcribed (no midpoint: a TYP is already one value).",
			},
		},
	},
	{
		partIds: ["NKT162"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 100,
				basis: "datasheet",
				source:
					"Towers' International Transistor Selector (T. D. Towers, W. Foulsham & Co; a compilation " +
					"of maker data, not a Newmarket sheet -- edition not identifiable from the single scanned " +
					"page), p239 'NKT122 ... NKT275J' (DatasheetArchive scan DSA841000-47; local copy " +
					"newmarket/datasheets/towers-international-transistor-selector-p239-nkt122-nkt275j.pdf, " +
					"read 2026-11-03). Columns: PM/OA/LT, PACKAGE, LEAD INFO, VCB MAX, VCE MAX, VEB MAX, IC " +
					"MAX, TJ MAX, P TOT, FT MIN, COB MAX, HFE, HFE BIAS, USE, MFR, EUR EQUIV, USA EQUIV, ISS; " +
					"the HFE column prints MN (minimum) or TP (typical) at the HFE BIAS collector current; no " +
					"Vbe column, so no IS; row 'NKT162': 'PG T05 L02 9V 9V 9V 25MA 75C 75MWF 8M 30P 100TP 1MA " +
					"RLA NEM ASY27 2N1305 0' -- HFE 100TP at HFE BIAS 1MA (the ratings, FT, COB, USE, MFR and " +
					"equivalents columns carry no gain information). Printed hFE TYP 100 at IC = 1 mA, " +
					"transcribed (no midpoint: a TYP is already one value).",
			},
		},
	},
	{
		partIds: ["NKT163"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 80,
				basis: "datasheet",
				source:
					"Towers' International Transistor Selector (T. D. Towers, W. Foulsham & Co; a compilation " +
					"of maker data, not a Newmarket sheet -- edition not identifiable from the single scanned " +
					"page), p239 'NKT122 ... NKT275J' (DatasheetArchive scan DSA841000-47; local copy " +
					"newmarket/datasheets/towers-international-transistor-selector-p239-nkt122-nkt275j.pdf, " +
					"read 2026-11-03). Columns: PM/OA/LT, PACKAGE, LEAD INFO, VCB MAX, VCE MAX, VEB MAX, IC " +
					"MAX, TJ MAX, P TOT, FT MIN, COB MAX, HFE, HFE BIAS, USE, MFR, EUR EQUIV, USA EQUIV, ISS; " +
					"the HFE column prints MN (minimum) or TP (typical) at the HFE BIAS collector current; no " +
					"Vbe column, so no IS; row 'NKT163': 'PG T05 L02 9V 9V 9V 25MA 75C 75MWF 5M 30P 80TP 1MA " +
					"RLA NEM ASY27 2N1305 0' -- HFE 80TP at HFE BIAS 1MA (the ratings, FT, COB, USE, MFR and " +
					"equivalents columns carry no gain information). Printed hFE TYP 80 at IC = 1 mA, " +
					"transcribed (no midpoint: a TYP is already one value).",
			},
		},
	},
	{
		partIds: ["NKT163/25"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 80,
				basis: "datasheet",
				source:
					"Towers' International Transistor Selector (T. D. Towers, W. Foulsham & Co; a compilation " +
					"of maker data, not a Newmarket sheet -- edition not identifiable from the single scanned " +
					"page), p239 'NKT122 ... NKT275J' (DatasheetArchive scan DSA841000-47; local copy " +
					"newmarket/datasheets/towers-international-transistor-selector-p239-nkt122-nkt275j.pdf, " +
					"read 2026-11-03). Columns: PM/OA/LT, PACKAGE, LEAD INFO, VCB MAX, VCE MAX, VEB MAX, IC " +
					"MAX, TJ MAX, P TOT, FT MIN, COB MAX, HFE, HFE BIAS, USE, MFR, EUR EQUIV, USA EQUIV, ISS; " +
					"the HFE column prints MN (minimum) or TP (typical) at the HFE BIAS collector current; no " +
					"Vbe column, so no IS; row 'NKT163/25': 'PG T05 L02 9V 9V 9V 25MA 75C 75MWF 5M 30P 80TP " +
					"1MA RLA NEM ASY27 2N1305 0' -- HFE 80TP at HFE BIAS 1MA (the ratings, FT, COB, USE, MFR " +
					"and equivalents columns carry no gain information). Printed hFE TYP 80 at IC = 1 mA, " +
					"transcribed (no midpoint: a TYP is already one value).",
			},
		},
	},
	{
		partIds: ["NKT164"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 50,
				basis: "datasheet",
				source:
					"Towers' International Transistor Selector (T. D. Towers, W. Foulsham & Co; a compilation " +
					"of maker data, not a Newmarket sheet -- edition not identifiable from the single scanned " +
					"page), p239 'NKT122 ... NKT275J' (DatasheetArchive scan DSA841000-47; local copy " +
					"newmarket/datasheets/towers-international-transistor-selector-p239-nkt122-nkt275j.pdf, " +
					"read 2026-11-03). Columns: PM/OA/LT, PACKAGE, LEAD INFO, VCB MAX, VCE MAX, VEB MAX, IC " +
					"MAX, TJ MAX, P TOT, FT MIN, COB MAX, HFE, HFE BIAS, USE, MFR, EUR EQUIV, USA EQUIV, ISS; " +
					"the HFE column prints MN (minimum) or TP (typical) at the HFE BIAS collector current; no " +
					"Vbe column, so no IS; row 'NKT164': 'PG T05 L02 9V 9V 9V 25MA 75C 75MWF 3M 30P 50TP 1MA " +
					"RLA NEM ASY27 2N1305 0' -- HFE 50TP at HFE BIAS 1MA (the ratings, FT, COB, USE, MFR and " +
					"equivalents columns carry no gain information). Printed hFE TYP 50 at IC = 1 mA, " +
					"transcribed (no midpoint: a TYP is already one value).",
			},
		},
	},
	{
		partIds: ["NKT164/25"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 50,
				basis: "datasheet",
				source:
					"Towers' International Transistor Selector (T. D. Towers, W. Foulsham & Co; a compilation " +
					"of maker data, not a Newmarket sheet -- edition not identifiable from the single scanned " +
					"page), p239 'NKT122 ... NKT275J' (DatasheetArchive scan DSA841000-47; local copy " +
					"newmarket/datasheets/towers-international-transistor-selector-p239-nkt122-nkt275j.pdf, " +
					"read 2026-11-03). Columns: PM/OA/LT, PACKAGE, LEAD INFO, VCB MAX, VCE MAX, VEB MAX, IC " +
					"MAX, TJ MAX, P TOT, FT MIN, COB MAX, HFE, HFE BIAS, USE, MFR, EUR EQUIV, USA EQUIV, ISS; " +
					"the HFE column prints MN (minimum) or TP (typical) at the HFE BIAS collector current; no " +
					"Vbe column, so no IS; row 'NKT164/25': 'PG T05 L02 9V 9V 9V 25MA 75C 75MWF 3M 30P 50TP " +
					"1MA RLA NEM ASY27 2N1305 0' -- HFE 50TP at HFE BIAS 1MA (the ratings, FT, COB, USE, MFR " +
					"and equivalents columns carry no gain information). Printed hFE TYP 50 at IC = 1 mA, " +
					"transcribed (no midpoint: a TYP is already one value).",
			},
		},
	},
	{
		partIds: ["NKT202"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 150,
				basis: "datasheet",
				source:
					"Towers' International Transistor Selector (T. D. Towers, W. Foulsham & Co; a compilation " +
					"of maker data, not a Newmarket sheet -- edition not identifiable from the single scanned " +
					"page), p239 'NKT122 ... NKT275J' (DatasheetArchive scan DSA841000-47; local copy " +
					"newmarket/datasheets/towers-international-transistor-selector-p239-nkt122-nkt275j.pdf, " +
					"read 2026-11-03). Columns: PM/OA/LT, PACKAGE, LEAD INFO, VCB MAX, VCE MAX, VEB MAX, IC " +
					"MAX, TJ MAX, P TOT, FT MIN, COB MAX, HFE, HFE BIAS, USE, MFR, EUR EQUIV, USA EQUIV, ISS; " +
					"the HFE column prints MN (minimum) or TP (typical) at the HFE BIAS collector current; no " +
					"Vbe column, so no IS; row 'NKT202': 'PG T022 L39 30V 18V 10V 125MA 75C 180MWF 500K 60P " +
					"150TP 25MA AMG OBS AC128 2N2706 0' -- HFE 150TP at HFE BIAS 25MA (the ratings, FT, COB, " +
					"USE, MFR and equivalents columns carry no gain information). Printed hFE TYP 150 at IC = " +
					"25 mA, transcribed (no midpoint: a TYP is already one value); IC = 25 mA is off the " +
					"small-signal operating point of a pedal stage (~1 mA), disclosed per the PN2222A " +
					"precedent.",
			},
		},
	},
	{
		partIds: ["NKT203"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 45,
				basis: "datasheet",
				source:
					"Towers' International Transistor Selector (T. D. Towers, W. Foulsham & Co; a compilation " +
					"of maker data, not a Newmarket sheet -- edition not identifiable from the single scanned " +
					"page), p239 'NKT122 ... NKT275J' (DatasheetArchive scan DSA841000-47; local copy " +
					"newmarket/datasheets/towers-international-transistor-selector-p239-nkt122-nkt275j.pdf, " +
					"read 2026-11-03). Columns: PM/OA/LT, PACKAGE, LEAD INFO, VCB MAX, VCE MAX, VEB MAX, IC " +
					"MAX, TJ MAX, P TOT, FT MIN, COB MAX, HFE, HFE BIAS, USE, MFR, EUR EQUIV, USA EQUIV, ISS; " +
					"the HFE column prints MN (minimum) or TP (typical) at the HFE BIAS collector current; no " +
					"Vbe column, so no IS; row 'NKT203': 'PG T022 L39 30V 18V 10V 125MA 75C 180MWF 500K 60P " +
					"45TP 1MA AMG OBS AC128 2N2706 0' -- HFE 45TP at HFE BIAS 1MA (the ratings, FT, COB, USE, " +
					"MFR and equivalents columns carry no gain information). Printed hFE TYP 45 at IC = 1 mA, " +
					"transcribed (no midpoint: a TYP is already one value).",
			},
		},
	},
	{
		partIds: ["NKT204"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 35,
				basis: "datasheet",
				source:
					"Towers' International Transistor Selector (T. D. Towers, W. Foulsham & Co; a compilation " +
					"of maker data, not a Newmarket sheet -- edition not identifiable from the single scanned " +
					"page), p239 'NKT122 ... NKT275J' (DatasheetArchive scan DSA841000-47; local copy " +
					"newmarket/datasheets/towers-international-transistor-selector-p239-nkt122-nkt275j.pdf, " +
					"read 2026-11-03). Columns: PM/OA/LT, PACKAGE, LEAD INFO, VCB MAX, VCE MAX, VEB MAX, IC " +
					"MAX, TJ MAX, P TOT, FT MIN, COB MAX, HFE, HFE BIAS, USE, MFR, EUR EQUIV, USA EQUIV, ISS; " +
					"the HFE column prints MN (minimum) or TP (typical) at the HFE BIAS collector current; no " +
					"Vbe column, so no IS; row 'NKT204': 'PG T022 L39 30V 18V 10V 125MA 75C 180MWF 500K 60P " +
					"35TP 1MA AMG OBS AC128 2N2706 0' -- HFE 35TP at HFE BIAS 1MA (the ratings, FT, COB, USE, " +
					"MFR and equivalents columns carry no gain information). Printed hFE TYP 35 at IC = 1 mA, " +
					"transcribed (no midpoint: a TYP is already one value).",
			},
		},
	},
	{
		partIds: ["NKT205"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 30,
				basis: "datasheet",
				source:
					"Towers' International Transistor Selector (T. D. Towers, W. Foulsham & Co; a compilation " +
					"of maker data, not a Newmarket sheet -- edition not identifiable from the single scanned " +
					"page), p239 'NKT122 ... NKT275J' (DatasheetArchive scan DSA841000-47; local copy " +
					"newmarket/datasheets/towers-international-transistor-selector-p239-nkt122-nkt275j.pdf, " +
					"read 2026-11-03). Columns: PM/OA/LT, PACKAGE, LEAD INFO, VCB MAX, VCE MAX, VEB MAX, IC " +
					"MAX, TJ MAX, P TOT, FT MIN, COB MAX, HFE, HFE BIAS, USE, MFR, EUR EQUIV, USA EQUIV, ISS; " +
					"the HFE column prints MN (minimum) or TP (typical) at the HFE BIAS collector current; no " +
					"Vbe column, so no IS; row 'NKT205': 'PG T022 L39 30V 18V 10V 125MA 75C 180MWF 500K 60P " +
					"30TP 1MA AMG OBS AC128 2N2706 0' -- HFE 30TP at HFE BIAS 1MA (the ratings, FT, COB, USE, " +
					"MFR and equivalents columns carry no gain information). Printed hFE TYP 30 at IC = 1 mA, " +
					"transcribed (no midpoint: a TYP is already one value).",
			},
		},
	},
	{
		partIds: ["NKT206"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 100,
				basis: "datasheet",
				source:
					"Towers' International Transistor Selector (T. D. Towers, W. Foulsham & Co; a compilation " +
					"of maker data, not a Newmarket sheet -- edition not identifiable from the single scanned " +
					"page), p239 'NKT122 ... NKT275J' (DatasheetArchive scan DSA841000-47; local copy " +
					"newmarket/datasheets/towers-international-transistor-selector-p239-nkt122-nkt275j.pdf, " +
					"read 2026-11-03). Columns: PM/OA/LT, PACKAGE, LEAD INFO, VCB MAX, VCE MAX, VEB MAX, IC " +
					"MAX, TJ MAX, P TOT, FT MIN, COB MAX, HFE, HFE BIAS, USE, MFR, EUR EQUIV, USA EQUIV, ISS; " +
					"the HFE column prints MN (minimum) or TP (typical) at the HFE BIAS collector current; no " +
					"Vbe column, so no IS; row 'NKT206': 'PG T022 L39 30V 18V 10V 125MA 75C 180MWF 500K 60P " +
					"100TP 1MA AMG OBS AC128 2N2706 0' -- HFE 100TP at HFE BIAS 1MA (the ratings, FT, COB, " +
					"USE, MFR and equivalents columns carry no gain information). Printed hFE TYP 100 at IC = " +
					"1 mA, transcribed (no midpoint: a TYP is already one value).",
			},
		},
	},
	{
		partIds: ["NKT207"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 150,
				basis: "datasheet",
				source:
					"Towers' International Transistor Selector (T. D. Towers, W. Foulsham & Co; a compilation " +
					"of maker data, not a Newmarket sheet -- edition not identifiable from the single scanned " +
					"page), p239 'NKT122 ... NKT275J' (DatasheetArchive scan DSA841000-47; local copy " +
					"newmarket/datasheets/towers-international-transistor-selector-p239-nkt122-nkt275j.pdf, " +
					"read 2026-11-03). Columns: PM/OA/LT, PACKAGE, LEAD INFO, VCB MAX, VCE MAX, VEB MAX, IC " +
					"MAX, TJ MAX, P TOT, FT MIN, COB MAX, HFE, HFE BIAS, USE, MFR, EUR EQUIV, USA EQUIV, ISS; " +
					"the HFE column prints MN (minimum) or TP (typical) at the HFE BIAS collector current; no " +
					"Vbe column, so no IS; row 'NKT207': 'PG T022 L39 60V 45V 10V 125MA 75C 180MWF 500K 60P " +
					"150TP 25MA AMG OBS AC128 2N2706 0' -- HFE 150TP at HFE BIAS 25MA (the ratings, FT, COB, " +
					"USE, MFR and equivalents columns carry no gain information). Printed hFE TYP 150 at IC = " +
					"25 mA, transcribed (no midpoint: a TYP is already one value); IC = 25 mA is off the " +
					"small-signal operating point of a pedal stage (~1 mA), disclosed per the PN2222A " +
					"precedent.",
			},
		},
	},
	{
		partIds: ["NKT208"],
		class: "bjt",
		params: {
			forwardBeta: {
				value: 70,
				basis: "datasheet",
				source:
					"Towers' International Transistor Selector (T. D. Towers, W. Foulsham & Co; a compilation " +
					"of maker data, not a Newmarket sheet -- edition not identifiable from the single scanned " +
					"page), p239 'NKT122 ... NKT275J' (DatasheetArchive scan DSA841000-47; local copy " +
					"newmarket/datasheets/towers-international-transistor-selector-p239-nkt122-nkt275j.pdf, " +
					"read 2026-11-03). Columns: PM/OA/LT, PACKAGE, LEAD INFO, VCB MAX, VCE MAX, VEB MAX, IC " +
					"MAX, TJ MAX, P TOT, FT MIN, COB MAX, HFE, HFE BIAS, USE, MFR, EUR EQUIV, USA EQUIV, ISS; " +
					"the HFE column prints MN (minimum) or TP (typical) at the HFE BIAS collector current; no " +
					"Vbe column, so no IS; row 'NKT208': 'PG T022 L39 30V 18V 10V 500MA 75C 300MWF 500K 60P " +
					"70TP 500MA AMG OBS AC128 2N2706 0' -- HFE 70TP at HFE BIAS 500MA (the ratings, FT, COB, " +
					"USE, MFR and equivalents columns carry no gain information). Printed hFE TYP 70 at IC = " +
					"500 mA, transcribed (no midpoint: a TYP is already one value); IC = 500 mA is off the " +
					"small-signal operating point of a pedal stage (~1 mA), disclosed per the PN2222A " +
					"precedent.",
			},
		},
	},
]);
