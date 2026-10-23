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
		// VCE(sat) MAX-only and no VBE(on)/VBE(sat) TYP or range, so IS has no input.
		partIds: ["2SC2458"],
		class: "bjt",
		params: {
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
		// Wave 4 community. Germanium PNP: Jim Hagerman's published AC128 SPICE model
		// (paper + card). Provisional single sample: germanium varies enormously specimen
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
					"with active-region Vbe + DC hFE bin is readable online. The Holmes/Whitehead " +
					"specimen corroborates the IS order.",
			},
			forwardBeta: {
				value: 90,
				basis: "community",
				source:
					"Jim Hagerman, 'AC128 Ge PNP Transistor SPICE Model' paper, 01/16/20, " +
					"http://www.hagtech.com/pdf/ac128model.pdf (read 2026-10-19): 'Straight from " +
					"data sheet we can read typical forward gain: BF = 90'; verbatim model card:\n" +
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
					"Same search as the IS record: no DC hFE bin in any located " +
					"original-manufacturer material; the card's BF = 90 is the published value " +
					"(the Holmes/Whitehead specimen reads 229.6 -- hot specimen, disclosed).",
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
		// No VBE row (only VCE(sat) MAX 0.3 V at 10 mA), so IS has no input.
		// Unbinned plus the corpus-used GR rank; BL stays out (same sheet, no corpus use).
		partIds: ["2SC2459"],
		class: "bjt",
		params: {
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
]);
