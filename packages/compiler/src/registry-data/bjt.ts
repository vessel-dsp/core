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
					"Fetched manufacturer sheet (no vendored copy): onsemi BC550/D, Feb 2026 Rev. 6 (family " +
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
					"Fetched manufacturer sheet (no vendored copy): onsemi BC550/D, Feb 2026 Rev. 6, p2, hFE " +
					"CLASSIFICATION table: 'C: 420 ~ 800' (the family hFE row is MIN 110 MAX 800 at VCE = 5 V, " +
					"IC = 2 mA; the C bin is the bin this part is)",
				derivation:
					"Printed C-bin hFE 420-800; geometric midpoint (form 2, gains): " +
					"sqrt(420 * 800) = 579.6550698.",
			},
		},
	},
]);
