// Stage-1 data registry: the loader's controls and the migration inventory.
// 
// No corpus packet and no shipping part number is asserted for membership -- the parts here
// are fictional (`FIX-*`), so the contract is tested against data the test owns. The
// shipping data is only checked structurally (counts, shapes, provenance completeness),
// for whatever rows it carries.

import { describe, expect, it } from "bun:test";
import {
	CLASS_PARAM_SCHEMAS,
	assemblePartData,
	bjtRegistryRecords,
	chargePumpRegistryRecords,
	classParamNames,
	defineOpampRecords,
	definePartData,
	diodeRegistryRecords,
	findPartData,
	findPartRegistryData,
	jfetRegistryRecords,
	LED_COLOUR_RECORD_ID,
	ledRegistryRecords,
	mosfetRegistryRecords,
	opampGainBandwidthAbsent,
	opampOutputSwingAbsent,
	opampRegistryRecords,
	partRegistryData,
	regulatorRegistryRecords,
	requiredClassParams,
	ujtRegistryRecords,
	validateCitedParam,
	zenerRegistryRecords,
} from "../src/registry-data";
import type {
	CitedParam,
	OpampRegistryRecord,
	PartDataEntry,
} from "../src/registry-data";
import {
	gateOnlyFetPartIds,
	pedalPartCatalog,
	ujtLawEntry,
	withDatasheetOutputSwing,
	zenerCatalogPartIds,
} from "../src/part-catalog";
import {
	emptyRegistry,
	registryEntryFor,
	registryLawFor,
	registryOpampSwing,
	type PartRegistry,
} from "../src/registry";

const cited = (
	value: number,
	basis: CitedParam["basis"] = "datasheet",
	source = "test source",
	derivation?: string,
): CitedParam => ({ value, basis, source, ...(derivation === undefined ? {} : { derivation }) });

const entry = (
	partIds: readonly string[],
	params: Record<string, CitedParam>,
	extra: Partial<PartDataEntry> = {},
): PartDataEntry => ({ partIds, class: "zener", params, ...extra });

describe("definePartData throws for the stated reason", () => {
	it("refuses a parameter missing its source", () => {
		expect(() =>
			definePartData([
				entry(["FIX-A"], {
					breakdownVolts: { value: 5.1, basis: "derived", source: "" },
				}),
			]),
		).toThrow(/source/);
	});

	it("refuses a parameter missing its basis", () => {
		const param = { value: 5.1, source: "test source" } as unknown as CitedParam;
		expect(() =>
			definePartData([entry(["FIX-A"], { breakdownVolts: param })]),
		).toThrow(/basis/);
	});

	it("refuses a derived basis with no derivation text", () => {
		expect(() =>
			definePartData([
				entry(["FIX-A"], {
					breakdownVolts: { value: 5.1, basis: "derived", source: "test source" },
				}),
			]),
		).toThrow(/derivation/);
		expect(() =>
			definePartData([
				entry(["FIX-A"], {
					breakdownVolts: cited(5.1, "derived", "test source", ""),
				}),
			]),
		).toThrow(/derivation/);
	});

	it("refuses an unknown parameter name for the class", () => {
		expect(() =>
			definePartData([
				entry(["FIX-A"], { thresholdVolts: cited(-2) }),
			]),
		).toThrow(/unknown parameter "thresholdVolts" for class "zener"/);
	});

	it("refuses a duplicate part id", () => {
		expect(() =>
			definePartData([
				entry(["FIX-A"], { breakdownVolts: cited(5.1, "derived", "s", "d") }),
				entry(["FIX-A"], { breakdownVolts: cited(12, "derived", "s", "d") }),
			]),
		).toThrow(/duplicate/);
	});

	it("refuses an alias that collides with another entry", () => {
		const a: PartDataEntry = {
			partIds: ["FIX-A"],
			class: "zener",
			params: { breakdownVolts: cited(5.1, "derived", "s", "d") },
		};
		const b: PartDataEntry = {
			partIds: ["FIX-B"],
			aliases: ["fix-a"],
			class: "zener",
			params: { breakdownVolts: cited(12, "derived", "s", "d") },
		};
		expect(() => assemblePartData([[a], [b]])).toThrow(/collides/);
	});

	it("refuses an unknown class and an entry with no ids", () => {
		const badClass = {
			partIds: ["FIX-A"],
			class: "triode-heater",
			params: {},
		} as unknown as PartDataEntry;
		expect(() => definePartData([badClass])).toThrow(/unknown part class/);
		expect(() => definePartData([entry([], {})])).toThrow(/names no part ids/);
	});

	it("refuses a non-finite value", () => {
		expect(() =>
			definePartData([entry(["FIX-A"], { breakdownVolts: cited(Number.NaN) })]),
		).toThrow(/finite/);
	});

	it("refuses a wrong basis string", () => {
		const param = {
			value: 5.1,
			basis: "spice-model",
			source: "test source",
		} as unknown as CitedParam;
		expect(() =>
			definePartData([entry(["FIX-A"], { breakdownVolts: param })]),
		).toThrow(/basis/);
	});

	it("refuses a manufacturer-model basis with no model file", () => {
		const url = "https://www.onsemi.com/download/models/txt/fix-a.lib.txt";
		const line = ".MODEL FIX-A NPN\n+IS=1e-14 BF=100";
		const noFile = {
			value: 1e-14,
			basis: "manufacturer-model",
			source: `${url} ${line}`,
			modelLine: line,
		} as unknown as CitedParam;
		expect(() =>
			definePartData([entry(["FIX-A"], { breakdownVolts: noFile })]),
		).toThrow(/model file/);
	});

	it("refuses a manufacturer-model basis with no model line", () => {
		const url = "https://www.onsemi.com/download/models/txt/fix-a.lib.txt";
		const noLine: CitedParam = {
			value: 1e-14,
			basis: "manufacturer-model",
			source: url,
			modelFileUrl: url,
		};
		expect(() =>
			definePartData([entry(["FIX-A"], { breakdownVolts: noLine })]),
		).toThrow(/model line/);
	});

	it("refuses a manufacturer-model file outside the manufacturer's own hosts", () => {
		const url = "https://example-mirror.example/models/fix-a.lib.txt";
		const line = ".MODEL FIX-A NPN\n+IS=1e-14 BF=100";
		const mirrored: CitedParam = {
			value: 1e-14,
			basis: "manufacturer-model",
			source: `${url} ${line}`,
			modelFileUrl: url,
			modelLine: line,
		};
		expect(() =>
			definePartData([entry(["FIX-A"], { breakdownVolts: mirrored })]),
		).toThrow(/outside the manufacturer's own hosts/);
	});

	it("refuses a manufacturer-model basis whose source does not quote the file and line", () => {
		const url = "https://www.onsemi.com/download/models/txt/fix-a.lib.txt";
		const line = ".MODEL FIX-A NPN\n+IS=1e-14 BF=100";
		const unquoted: CitedParam = {
			value: 1e-14,
			basis: "manufacturer-model",
			source: "manufacturer model, see the vendor site",
			modelFileUrl: url,
			modelLine: line,
		};
		expect(() =>
			definePartData([entry(["FIX-A"], { breakdownVolts: unquoted })]),
		).toThrow(/quote/);
	});

	it("refuses model file/line fields on any other basis", () => {
		const url = "https://www.onsemi.com/download/models/txt/fix-a.lib.txt";
		const line = ".MODEL FIX-A NPN\n+IS=1e-14 BF=100";
		const param: CitedParam = {
			value: 5.1,
			basis: "datasheet",
			source: `test source ${url} ${line}`,
			modelFileUrl: url,
			modelLine: line,
		};
		expect(() =>
			definePartData([entry(["FIX-A"], { breakdownVolts: param })]),
		).toThrow(/manufacturer-model only/);
	});

	it("refuses a measured basis with no instrument", () => {
		const param = {
			value: 1e-14,
			basis: "measured",
			source: "evidence measurements/2026-10-20-led-default.json abc123",
			measurementConditions: "9V supply, 8.2k/820R, 22C",
			measurementSampleCount: 4,
			measurementDate: "2026-10-20",
			measurementEvidencePath: "measurements/2026-10-20-led-default.json",
			measurementEvidenceSha256: "a".repeat(64),
		} as unknown as CitedParam;
		expect(() =>
			definePartData([entry(["FIX-A"], { breakdownVolts: param })]),
		).toThrow(/instrument/);
	});

	it("refuses a measured basis with no conditions", () => {
		const param: CitedParam = {
			value: 1e-14,
			basis: "measured",
			source: "evidence measurements/2026-10-20-led-default.json " + "a".repeat(64),
			measurementInstrument: "Test Meter",
			measurementSampleCount: 4,
			measurementDate: "2026-10-20",
			measurementEvidencePath: "measurements/2026-10-20-led-default.json",
			measurementEvidenceSha256: "a".repeat(64),
		};
		expect(() =>
			definePartData([entry(["FIX-A"], { breakdownVolts: param })]),
		).toThrow(/conditions/);
	});

	it("refuses a measured basis with a bad sample count", () => {
		const param: CitedParam = {
			value: 1e-14,
			basis: "measured",
			source: "evidence measurements/2026-10-20-led-default.json " + "a".repeat(64),
			measurementInstrument: "Test Meter",
			measurementConditions: "9V supply, 8.2k/820R, 22C",
			measurementSampleCount: 0,
			measurementDate: "2026-10-20",
			measurementEvidencePath: "measurements/2026-10-20-led-default.json",
			measurementEvidenceSha256: "a".repeat(64),
		};
		expect(() =>
			definePartData([entry(["FIX-A"], { breakdownVolts: param })]),
		).toThrow(/sample count/);
	});

	it("refuses a measured basis with a bad date", () => {
		const param: CitedParam = {
			value: 1e-14,
			basis: "measured",
			source: "evidence measurements/2026-10-20-led-default.json " + "a".repeat(64),
			measurementInstrument: "Test Meter",
			measurementConditions: "9V supply, 8.2k/820R, 22C",
			measurementSampleCount: 4,
			measurementDate: "20-10-2026",
			measurementEvidencePath: "measurements/2026-10-20-led-default.json",
			measurementEvidenceSha256: "a".repeat(64),
		};
		expect(() =>
			definePartData([entry(["FIX-A"], { breakdownVolts: param })]),
		).toThrow(/date/);
	});

	it("refuses a measured basis with a bad evidence path", () => {
		const param: CitedParam = {
			value: 1e-14,
			basis: "measured",
			source: "test source",
			measurementInstrument: "Test Meter",
			measurementConditions: "9V supply, 8.2k/820R, 22C",
			measurementSampleCount: 4,
			measurementDate: "2026-10-20",
			measurementEvidencePath: "/abs/path.json",
			measurementEvidenceSha256: "a".repeat(64),
		};
		expect(() =>
			definePartData([entry(["FIX-A"], { breakdownVolts: param })]),
		).toThrow(/evidence path/);
	});

	it("refuses a measured basis with a bad evidence sha256", () => {
		const param: CitedParam = {
			value: 1e-14,
			basis: "measured",
			source: "evidence measurements/2026-10-20-led-default.json nothex",
			measurementInstrument: "Test Meter",
			measurementConditions: "9V supply, 8.2k/820R, 22C",
			measurementSampleCount: 4,
			measurementDate: "2026-10-20",
			measurementEvidencePath: "measurements/2026-10-20-led-default.json",
			measurementEvidenceSha256: "nothex",
		};
		expect(() =>
			definePartData([entry(["FIX-A"], { breakdownVolts: param })]),
		).toThrow(/sha256/);
	});

	it("refuses a measured basis whose source does not quote the evidence", () => {
		const param: CitedParam = {
			value: 1e-14,
			basis: "measured",
			source: "owner bench, no evidence quoted",
			measurementInstrument: "Test Meter",
			measurementConditions: "9V supply, 8.2k/820R, 22C",
			measurementSampleCount: 4,
			measurementDate: "2026-10-20",
			measurementEvidencePath: "measurements/2026-10-20-led-default.json",
			measurementEvidenceSha256: "a".repeat(64),
		};
		expect(() =>
			definePartData([entry(["FIX-A"], { breakdownVolts: param })]),
		).toThrow(/quote the evidence/);
	});

	it("refuses measured fields on any other basis", () => {
		const param: CitedParam = {
			value: 5.1,
			basis: "datasheet",
			source: "test source measurements/2026-10-20-led-default.json " + "a".repeat(64),
			measurementInstrument: "Test Meter",
		};
		expect(() =>
			definePartData([entry(["FIX-A"], { breakdownVolts: param })]),
		).toThrow(/measured only/);
	});
});

describe("definePartData accepts honest provenance", () => {
	it("loads a derived value with its derivation and a datasheet value without one", () => {
		const out = definePartData([
			entry(["FIX-A"], { breakdownVolts: cited(5.1, "derived", "s", "d") }),
			entry(["FIX-B"], { breakdownVolts: cited(12) }),
		]);
		expect(out).toHaveLength(2);
		expect(Object.isFrozen(out)).toBe(true);
	});

	it("loads a manufacturer-model value with its file and line quoted", () => {
		const url = "https://www.onsemi.com/download/models/txt/fix-a.lib.txt";
		const line = ".MODEL FIX-A NPN\n+IS=1e-14 BF=100";
		const param: CitedParam = {
			value: 1e-14,
			basis: "manufacturer-model",
			source: `Manufacturer model file ${url}, card lines: ${line}`,
			modelFileUrl: url,
			modelLine: line,
		};
		const out = definePartData([entry(["FIX-A"], { breakdownVolts: param })]);
		expect(out).toHaveLength(1);
		expect(validateCitedParam("FIX-A", "breakdownVolts", param)).toEqual(param);
	});

	it("loads a datasheet-embedded Microsim-style model line", () => {
		const url = "https://www.onsemi.com/pdf/datasheet/fix-a-d.pdf";
		const line =
			"NPN (Is=5.911f Xti=3 Eg=1.11 Vaf=62.37 Bf=1.122K Ne=1.394 Ise=5.911f Ikf=14.92m Xtb=1.5 Br=1.271 Nc=2\n" +
			"Isc=0 Ikr=0 Rc=1.61 Cjc=4.017p Mjc=.3174 Vjc=.75 Fc=.5 Cje=4.973p Mje=.4146 Vje=.75 Tr=4.673n Tf=821.7p\n" +
			"Itf=.35 Vtf=4 Xtf=7 Rb=10)";
		const param: CitedParam = {
			value: 5.911e-15,
			basis: "manufacturer-model",
			source:
				`Manufacturer datasheet FIX-A/D p3 Spice Model block, ${url}, verbatim lines: ${line}`,
			modelFileUrl: url,
			modelLine: line,
		};
		const out = definePartData([entry(["FIX-A"], { breakdownVolts: param })]);
		expect(out).toHaveLength(1);
	});

	it("loads a measured value with its bench record quoted", () => {
		const evidencePath = "measurements/2026-10-20-led-default.json";
		const sha = "a".repeat(64);
		const param: CitedParam = {
			value: 1e-14,
			basis: "measured",
			source: `Owner bench 2026-10-20, Test Meter, 9V supply 8.2k/820R 22C, 4 samples, evidence ${evidencePath} sha256 ${sha}, schema vesseldsp.junction-default-measurement.v1 perDevice isEngine/nEngine pooled over every sample at VT 0.025852 V`,
			measurementInstrument: "Test Meter",
			measurementConditions: "9V supply, 8.2k/820R, 22C",
			measurementSampleCount: 4,
			measurementDate: "2026-10-20",
			measurementEvidencePath: evidencePath,
			measurementEvidenceSha256: sha,
		};
		const out = definePartData([entry(["FIX-A"], { breakdownVolts: param })]);
		expect(out).toHaveLength(1);
		expect(validateCitedParam("FIX-A", "breakdownVolts", param)).toEqual(param);
	});

	it("loads a Central Semiconductor manufacturer-model URL (wave-3 1N914 host)", () => {
		const param: CitedParam = {
			value: 6.2229e-9,
			basis: "manufacturer-model",
			source:
				"Central Semiconductor 1N914 https://www.centralsemi.com/ fragments IS=6.2229E-9 N=1.9224",
			modelFileUrl: "https://www.centralsemi.com/",
			modelLine: "IS=6.2229E-9 N=1.9224",
		};
		const out = definePartData([entry(["FIX-A"], { breakdownVolts: param })]);
		expect(out).toHaveLength(1);
	});
	it("treats two spellings folding to one id in one entry as redundant, not conflicting", () => {
		const out = definePartData([
			entry(["RD5.6JB2", "RD5.6J B2", "RD5.6J-B2"], {
				breakdownVolts: cited(5.58, "derived", "s", "d"),
			}),
		]);
		expect(out).toHaveLength(1);
	});

	it("validates a cited value standalone with the same rules", () => {
		expect(() => validateCitedParam("FIX-A", "p", cited(1, "derived", "s"))).toThrow(
			/derivation/,
		);
		expect(validateCitedParam("FIX-A", "p", cited(1))).toEqual(cited(1));
	});
});

describe("definePartData refuses a dishonest community record", () => {
	const community = (
		value: number,
		extra: Partial<CitedParam> = {},
	): CitedParam => ({
		value,
		basis: "community",
		source:
			"Published SPICE model https://example.test/models/fix-a.lib.txt by Jane Doe, " +
			"retrieved 2026-10-19, quote: `.MODEL FIX-A D (IS=1e-14 N=1.6)`; no datasheet, " +
			"no manufacturer model, owner has no bench stock",
		sourceKind: "published-spice-model",
		url: "https://example.test/models/fix-a.lib.txt",
		quote: ".MODEL FIX-A D (IS=1e-14 N=1.6)",
		author: "Jane Doe",
		retrievedDate: "2026-10-19",
		whyNoBetterSource:
			"no datasheet, no manufacturer model, owner has no bench stock",
		...extra,
	});

	it("refuses a community basis with no or bad sourceKind", () => {
		const { sourceKind: _dropped, ...noKind } = community(5.1);
		expect(() =>
			definePartData([entry(["FIX-A"], { breakdownVolts: noKind })]),
		).toThrow(/sourceKind/);
		expect(() =>
			definePartData([
				entry(["FIX-A"], {
					breakdownVolts: community(5.1, {
						sourceKind: "forum-post" as unknown as CitedParam["sourceKind"],
					}),
				}),
			]),
		).toThrow(/sourceKind/);
	});

	it("refuses a community basis with no or non-http URL", () => {
		expect(() =>
			definePartData([
				entry(["FIX-A"], {
					breakdownVolts: community(5.1, { url: undefined }),
				}),
			]),
		).toThrow(/URL/);
		expect(() =>
			definePartData([
				entry(["FIX-A"], {
					breakdownVolts: community(5.1, {
						url: "ftp://example.test/models/fix-a.lib.txt",
						source: "ftp://example.test/models/fix-a.lib.txt quote: `.MODEL FIX-A D (IS=1e-14 N=1.6)`",
					}),
				}),
			]),
		).toThrow(/URL/);
	});

	it("refuses a community basis with no verbatim quote", () => {
		expect(() =>
			definePartData([
				entry(["FIX-A"], { breakdownVolts: community(5.1, { quote: "  " }) }),
			]),
		).toThrow(/quote/);
	});

	it("refuses a community basis with an anonymous author", () => {
		expect(() =>
			definePartData([
				entry(["FIX-A"], { breakdownVolts: community(5.1, { author: "" }) }),
			]),
		).toThrow(/author/);
		expect(() =>
			definePartData([
				entry(["FIX-A"], { breakdownVolts: community(5.1, { author: "forum" }) }),
			]),
		).toThrow(/author/);
	});

	it("refuses a community basis with a bad retrieval date", () => {
		expect(() =>
			definePartData([
				entry(["FIX-A"], {
					breakdownVolts: community(5.1, { retrievedDate: "19-10-2026" }),
				}),
			]),
		).toThrow(/date/);
	});

	it("refuses a community basis with no whyNoBetterSource", () => {
		expect(() =>
			definePartData([
				entry(["FIX-A"], {
					breakdownVolts: community(5.1, { whyNoBetterSource: "" }),
				}),
			]),
		).toThrow(/whyNoBetterSource/);
	});

	it("refuses a community basis whose source quotes neither the URL nor the text", () => {
		expect(() =>
			definePartData([
				entry(["FIX-A"], {
					breakdownVolts: community(5.1, { source: "someone measured it once" }),
				}),
			]),
		).toThrow(/quote/);
	});

	it("refuses community fields on any other basis", () => {
		const param: CitedParam = {
			value: 5.1,
			basis: "datasheet",
			source: "test source https://example.test/models/fix-a.lib.txt",
			url: "https://example.test/models/fix-a.lib.txt",
		};
		expect(() =>
			definePartData([entry(["FIX-A"], { breakdownVolts: param })]),
		).toThrow(/community only/);
	});

	it("refuses a community record beside a non-community record for the SAME parameter", () => {
		expect(() =>
			definePartData([
				entry(["FIX-A"], { breakdownVolts: community(5.1) }),
				entry(["FIX-A"], { breakdownVolts: cited(5.1, "derived", "s", "d") }),
			]),
		).toThrow(/community/);
		const a = definePartData([
			entry(["FIX-A"], { breakdownVolts: community(5.1) }),
		]);
		const b = definePartData([
			entry(["FIX-A"], { breakdownVolts: cited(5.1, "derived", "s", "d") }),
		]);
		expect(() => assemblePartData([a, b])).toThrow(/community/);
	});

	it("loads an honest community record with its full provenance", () => {
		const param = community(5.1, { sourceKind: "published-measurement" });
		const out = definePartData([entry(["FIX-A"], { breakdownVolts: param })]);
		expect(out).toHaveLength(1);
		expect(validateCitedParam("FIX-A", "breakdownVolts", param)).toEqual(param);
	});
});

describe("a registry parameter reaches the stamp through the loader in a synthetic fixture", () => {
	const swingRecord = (partIds: readonly string[]): OpampRegistryRecord => ({
		partIds,
		outputSwingDropHighVolts: cited(1.5),
		outputSwingDropLowVolts: cited(2),
		outputSwingPrinted: {
			supplyVolts: 30,
			loadOhms: 10_000,
			translation: "constant",
			column: "test column",
		},
	});

	it("a loader-validated record stamps through withDatasheetOutputSwing", () => {
		const records = defineOpampRecords([swingRecord(["FIX-LOADER"])]);
		const holder = (partIds: readonly string[]) => ({
			partIds,
			declaredTypes: [],
			terminalRoleGroups: [],
			model: {
				kind: "sections" as const,
				pinout: [null, null, null] as const,
				sections: [
					{
						law: { kind: "ideal-opamp" as const, railHigh: null, railLow: null, openLoopGain: 100000 },
						terminals: [0, 1, 2],
					},
				],
			},
		});
		const registry: PartRegistry = {
			entries: withDatasheetOutputSwing([holder(["FIX-LOADER"])], records, []),
		};
		expect(registryOpampSwing(registry, "fix-loader")).toEqual({
			highVolts: 1.5,
			lowVolts: 2,
			printed: { supplyVolts: 30, loadOhms: 10_000, translation: "constant" },
		});
	});

	it("the shipped charge-pump data lands on its catalog entry", () => {
		const record = findPartRegistryData("LT1054");
		expect(record?.class).toBe("charge-pump");
		expect(record?.params["chargePumpLossVolts"]).toEqual(
			expect.objectContaining({ value: 0.35, basis: "datasheet" }),
		);
		const found = registryEntryFor(pedalPartCatalog, { partId: "LT1054", evidence: "exact-part" });
		expect(found?.chargePumpLossVolts).toBe(0.35);
		const section = found?.model.kind === "sections" ? found.model.sections[0] : null;
		expect(section?.law.kind).toBe("voltage-source");
		if (section?.law.kind === "voltage-source") {
			expect(section.law.sourceOhms).toBe(10);
		}
	});

	it("the shipped BAT85 data lands on its catalog entry, and BAT85S runs provisionally on the same card", () => {
		const bat85 = findPartRegistryData("BAT85");
		expect(bat85?.class).toBe("diode");
		expect(bat85?.params["saturationCurrent"]).toEqual(
			expect.objectContaining({ value: 2.076e-7, basis: "manufacturer-model" }),
		);
		expect(bat85?.params["emissionCoefficient"]).toEqual(
			expect.objectContaining({ value: 1.023, basis: "manufacturer-model" }),
		);
		expect(bat85?.params["seriesResistance"]).toEqual(
			expect.objectContaining({ value: 2.326, basis: "manufacturer-model" }),
		);
		const bat85s = findPartRegistryData("BAT85S");
		for (const name of ["saturationCurrent", "emissionCoefficient", "seriesResistance"]) {
			expect(bat85s?.params[name]).toEqual(
				expect.objectContaining({ value: bat85?.params[name]?.value, basis: "community" }),
			);
		}
		// The two are separate entries: BAT85S is not an alias of BAT85.
		expect(bat85?.partIds).not.toContain("BAT85S");
		for (const partId of ["BAT85", "BAT85S"]) {
			const found = registryEntryFor(pedalPartCatalog, { partId, evidence: "exact-part" });
			expect(found?.model.kind).toBe("law");
		}
		// BAT85 is the manufacturer's own card; BAT85S runs on community values and says so.
		const provisionalNames = (partId: string) =>
			(registryEntryFor(pedalPartCatalog, { partId, evidence: "exact-part" })?.provisionalParams ?? [])
				.map((p) => p.name)
				.sort();
		expect(provisionalNames("BAT85")).toEqual([]);
		expect(provisionalNames("BAT85S")).toEqual([
			"emissionCoefficient",
			"saturationCurrent",
			"seriesResistance",
		]);
	});

	it("the shipped 2N4871 data lands on its catalog entry", () => {
		const record = findPartRegistryData("2N4871");
		expect(record?.class).toBe("ujt");
		expect(record?.params["intrinsicStandoffRatio"]).toEqual(
			expect.objectContaining({ value: 0.775, basis: "derived" }),
		);
		expect(record?.params["interbaseResistanceOhms"]).toEqual(
			expect.objectContaining({ value: 6000, basis: "datasheet" }),
		);
		if (record === null) throw new Error("unreachable");
		const entry = ujtLawEntry(record);
		if (entry.model.kind !== "law" || entry.model.law.kind !== "ujt") {
			throw new Error("unreachable");
		}
		expect(entry.model.law.intrinsicStandoffRatio).toBe(0.775);
		expect(entry.model.law.interbaseResistanceOhms).toBe(6000);
	});

	it("the shipped 1N4148 data is the owner's measured pair, with no community parameter", () => {
		const record = findPartRegistryData("1N4148");
		expect(record?.class).toBe("diode");
		expect(record?.params["saturationCurrent"]).toEqual(
			expect.objectContaining({ value: 2.124272112914455e-8, basis: "measured" }),
		);
		expect(record?.params["emissionCoefficient"]).toEqual(
			expect.objectContaining({ value: 2.17468223817758, basis: "measured" }),
		);
		// The fit assumed the engine's 1.0 ohm diode default and VT 0.025852 V, so both
		// are omitted and the stamp must gap-fill them exactly.
		expect(record?.params["seriesResistance"]).toBeUndefined();
		expect(record?.params["thermalVoltage"]).toBeUndefined();
		expect((record?.note ?? "").length).toBeGreaterThan(0);
		// Every measured parameter quotes the evidence path and sha256 in its source.
		for (const param of Object.values(record?.params ?? {})) {
			expect(param.source).toContain(
				"packet-study/led-default/measurements/2026-10-20-led-default.json",
			);
			expect(param.source).toContain(
				"72abc43aa3d562351212dd6045e4bbf1914cf4e660dfe0e4288644c7f1f7b37a",
			);
		}
		if (record === null) throw new Error("unreachable");
		const found = registryEntryFor(pedalPartCatalog, {
			partId: "1N4148",
			evidence: "exact-part",
		});
		if (found?.model.kind !== "law" || found.model.law.kind !== "diode") {
			throw new Error("unreachable");
		}
		expect(found.model.law.saturationCurrent).toBe(2.124272112914455e-8);
		expect(found.model.law.emissionCoefficient).toBe(2.17468223817758);
		expect(found.model.law.seriesResistance).toBe(1);
		expect(found.model.law.thermalVoltage).toBe(0.025852);
		// The measured record names no provisional value.
		expect(found.provisionalParams).toBeUndefined();
	});

	it("the shipped LED colour defaults key whole packet spellings, measured, led-lit", () => {
		// Only IS and n are bench measurements. thermalVoltage is the VT the fit was
		// referred to (derived engine constant); red and yellow Rs are the 2.0 ohm
		// class default fixed for the two-point fit (derived assumption). Blue, green
		// and white Rs are fitted (measured).
		const colours: ReadonlyArray<{
			ids: readonly string[];
			is: number;
			n: number;
			rs: number;
			rsBasis: "measured" | "derived";
		}> = [
			{ ids: ["RED LED", "5mm red LED", "LED-RED"], is: 1.1110898624e-14, n: 2.7587062, rs: 2, rsBasis: "derived" },
			{ ids: ["LED-GREEN"], is: 5.275788e-17, n: 3.02001, rs: 29.7599, rsBasis: "measured" },
			{ ids: ["blue"], is: 8.668086e-34, n: 1.42282, rs: 22.229, rsBasis: "measured" },
			{ ids: ["white"], is: 4.056687e-26, n: 1.98811, rs: 22.5033, rsBasis: "measured" },
			{ ids: ["yellow"], is: 2.1187081810e-25, n: 1.4664285, rs: 2, rsBasis: "derived" },
		];
		for (const { ids, is, n, rs, rsBasis } of colours) {
			for (const id of ids) {
				const record = findPartRegistryData(id);
				expect(record?.class).toBe("led");
				expect(record?.params["saturationCurrent"]).toEqual(
					expect.objectContaining({ value: is, basis: "measured" }),
				);
				expect(record?.params["emissionCoefficient"]).toEqual(
					expect.objectContaining({ value: n, basis: "measured" }),
				);
				const vt = record?.params["thermalVoltage"];
				expect(vt).toEqual(
					expect.objectContaining({ value: 0.025852, basis: "derived" }),
				);
				expect(typeof vt?.derivation === "string" && vt.derivation.length).toBeGreaterThan(0);
				const series = record?.params["seriesResistance"];
				expect(series).toEqual(
					expect.objectContaining({ value: rs, basis: rsBasis }),
				);
				if (rsBasis === "derived") {
					expect(typeof series?.derivation === "string" && series.derivation.length).toBeGreaterThan(0);
				}
			}
			// Every spelling of the colour resolves to one law entry stamping isLed.
			for (const id of ids) {
				const found = registryEntryFor(pedalPartCatalog, {
					partId: id,
					evidence: "exact-part",
				});
				if (found?.model.kind !== "law" || found.model.law.kind !== "diode") {
					throw new Error(`${id}: no diode law entry`);
				}
				expect(found.model.law.saturationCurrent).toBe(is);
				expect(found.model.law.isLed).toBe(true);
				expect(found.provisionalParams).toBeUndefined();
			}
		}
		// The colour map keys each vocabulary colour to its record's canonical id.
		expect(LED_COLOUR_RECORD_ID).toEqual({
			red: "RED LED",
			yellow: "yellow",
			green: "LED-GREEN",
			blue: "blue",
			white: "white",
		});
		for (const [colour, id] of Object.entries(LED_COLOUR_RECORD_ID)) {
			expect(findPartRegistryData(id)?.class).toBe("led");
			expect(
				registryLawFor(pedalPartCatalog, id, "diode")?.kind,
				`${colour} colour id resolves no diode law`,
			).toBe("diode");
		}
		// No assumed value keeps a measured label.
		for (const record of ledRegistryRecords) {
			for (const [name, param] of Object.entries(record.params)) {
				if (param.basis === "measured") {
					expect(["saturationCurrent", "emissionCoefficient", "seriesResistance"]).toContain(name);
				}
				if (name === "thermalVoltage") {
					expect(param.basis).toBe("derived");
				}
			}
		}
	});

	it("leaves bare LED and manufacturer LED part numbers on the class defaults", () => {
		// Neither the data registry nor the diode lookup may claim a colour they cannot
		// name: bare "LED" is colourless, SLP-135B is a real part the bench kit cannot
		// speak for, and no packet spells white or yellow in a part id (those records
		// carry the colour word as their id and are reached only via typed Color).
		expect(findPartRegistryData("LED")).toBeNull();
		expect(findPartRegistryData("SLP-135B")).toBeNull();
		expect(findPartRegistryData("3mm white")).toBeNull();
		for (const id of ["blue", "white", "yellow"]) {
			expect(findPartRegistryData(id)?.class).toBe("led");
		}
	});
});

describe("wave-4 fill inventory", () => {
	it("holds exactly the stage-1 migration plus the wave-1 to wave-4 fills, no more", () => {
		// Stage 1: op-amp gain-bandwidth + swing rows, zener rows, one JFET row, regulator
		// rails, charge-pump loss/slope. IC macros and `sections` entries stayed in code.
		// Wave 1: one more op-amp GBW row (LM833, GBW-only per the D4 swing freeze), ten BJT
		// rows, two more JFET rows, two MOSFET threshold rows; diode rows stay empty by
		// verdict (all eight wave-1 diodes excluded -- MAX-only forward limits).
		// Wave 2: four more op-amp GBW rows (LF347, LF351, L272M, TL074; AD712 is GBW-absent
		// by verdict) and manufacturer-model IS on two existing BJT rows (2N2222A, 2N5088);
		// diode rows stay empty (manufacturer model files unretrievable, no two-TYP sheet).
		// Wave 3: two more op-amp GBW rows (NJM4580, OPA2134; LM1458 AOL-only), 12
		// manufacturer-model diode rows, 9 BJT rows, 1 JFET row (2N5952).
		// Wave 4: four more op-amp GBW rows (LM324, TLC2262, MC33174, LM833N; LM308 and
		// UA741CP are AOL-only by the same AD712/LM1458 verdict), 18 BJT rows (unbinned
		// plus corpus-used ranks; 2SC2458/2SC828/2SC3378 IS-less, 2N5133/2N4125/2N4126/
		// BC109C BF-only, BC239C/BC107B IS+BF) and 13 JFET rows (2N5485, 2SK30A-Y/GR plus
		// TM aliases, 2SK118 + Y, 2SK184 + GR, 2SK209, 2N5458, MPF4393, J309, J202, PF5102).
		// Part B: two community germanium BJT rows (AC128 IS+BF, OC44 BF alongside a
		// derived IS) and four diode rows (community 1N34A, DEC-sheet 1N60/1N60P, and the
		// 1N4148 community record since replaced by the owner's measured pair).
		// Wave 5: three more op-amp GBW rows (OPA1678, OPA134PA, OPA604AP; TL072C and LM741CN
		// are AOL-only by the same AD712/LM1458 verdict), 13 BJT rows (ZTX109C IS+BF,
		// P2N2222A/A1015GR/MPS4124/BC546A/BC548A/BC548B/BC184C BF with or without IS,
		// 2N6428/2N6429 IS+BF, 2SC732 unbinned IS+BF, ZTX618 IS-only via manufacturer
		// model) and 4 JFET rows (2SK209-GR, 2SK208-R/Y, 2SK3557).
		// Transistor-records wave 1 (2026-10-23): 10 more BJT rows, all BF-only for
		// want of a citable Vbe (2SC3324, 2SA1048, 2SC2459 and 2SC4116 unbinned plus
		// their corpus-used GR ranks, the SOT-23 MMBT5089 pair entry, KTC3198-BL) and
		// 6 more JFET rows (2SK30A-O channel, 2SK879 + Y, 2SK880 + GR, Vt0-only J113;
		// the bare 2SK30ATM spelling rides as an alias on the gate-only entry).
		// Wave 7 (germanium fill, corpus-driven): 4 BJT rows -- OC75 BF 90 and OC81D
		// Wave 7 top-up (corpus-driven PDFs): PN2222A BF-only 173.2 (sole bin at 150 mA, disclosed off-operating-point) and BF244A full channel (IDSS/VGSoff range midpoints, square law) in jfet.ts. MPSA06 stays out (MIN/MAX-only throughout). 1N5711/1N5818/1N4005/6 stay out (MAX-only tables; TYP I-V curves need a graph-read ruling).
		// BF 60 (Mullard Pocket Data Book TYPs), AC176 BF 111.8 (Siemens B-bin geomean),
		// 2N1308 IS-only 6.31e-7 (Central VBE(sat) range midpoint; BF MIN-only, no row).
		// All four carry the silicon-bias caveat (IS omitted except 2N1308, BF omitted
		// on 2N1308); NKT275 stays out (MIN-only everywhere located).
		// LED work: the 1N4148 community record replaced by the owner's measured pair;
		// five measured LED colour rows (red and green by packet spelling, blue, white and
		// yellow by typed Color), Item 2's custom-LED full quad, and Item 1's derived VT/Rs.
		// 1S188FM (2026-10-28): one measured germanium diode row (owner bench D10/D11 of
		// Boss OC-2 JP 07556, IS+n+Rs pooled at the engine VT), alias 1S-188FM per the
		// OC-2 service-note legend; 1SS-188FM deliberately unregistered (silicon-prefix
		// spelling in the DS-2 source, no Ge mark).
		expect(opampRegistryRecords).toHaveLength(24);
		expect(zenerRegistryRecords).toHaveLength(35);
		expect(jfetRegistryRecords).toHaveLength(28);
		expect(regulatorRegistryRecords).toHaveLength(7);
		expect(chargePumpRegistryRecords).toHaveLength(8);
		expect(bjtRegistryRecords).toHaveLength(67);
		expect(diodeRegistryRecords).toHaveLength(19);
		expect(ledRegistryRecords).toHaveLength(5);
		expect(mosfetRegistryRecords).toHaveLength(2);
		expect(ujtRegistryRecords).toHaveLength(1);
		expect(partRegistryData).toHaveLength(24 + 67 + 19 + 2 + 35 + 28 + 7 + 8 + 1 + 5);
	});

	it("every parameter in the set is cited, and every derived one shows its working", () => {
		for (const record of partRegistryData) {
			const label = record.partIds.join(",");
			expect(Object.keys(record.params).length).toBeGreaterThan(0);
			for (const [name, param] of Object.entries(record.params)) {
				expect(param.source.length).toBeGreaterThan(0);
				if (param.basis === "derived") {
					expect(
						(param.derivation ?? "").length,
						`${label}.${name} derived without derivation`,
					).toBeGreaterThan(0);
				}
			}
		}
	});

	it("op-amp swing records state both sides or neither, with the printed condition exactly when the pair is", () => {
		for (const record of opampRegistryRecords) {
			const label = record.partIds.join(",");
			const high = record.outputSwingDropHighVolts;
			const low = record.outputSwingDropLowVolts;
			const printed = record.outputSwingPrinted;
			if (high === undefined || low === undefined || printed === undefined) {
				expect(high, `${label} half swing`).toBeUndefined();
				expect(low, `${label} half swing`).toBeUndefined();
				expect(printed, `${label} half swing`).toBeUndefined();
			} else {
				expect(high.value).toBeGreaterThan(0);
				expect(low.value).toBeGreaterThan(0);
				expect(printed.supplyVolts).toBeGreaterThan(0);
				expect(printed.loadOhms).toBeGreaterThan(0);
			}
		}
	});

	it("regulator rails are the seven fixed rails, and only the LT1054 pump prints a loss", () => {
		const volts = regulatorRegistryRecords.map(
			(record) => record.params["volts"]?.value,
		);
		expect([...volts].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([-15, 3.3, 5, 9, 12, 15, 18]);
		const losses = chargePumpRegistryRecords.map(
			(record) => record.params["chargePumpLossVolts"]?.value,
		);
		expect(losses.filter((loss) => loss !== 0)).toEqual([0.35]);
	});

	it("the derived membership sets match the data", () => {
		// One list, not two: the sets below are computed from the same records that ship.
		const zenerFolded = new Set(
			zenerRegistryRecords.flatMap((record) => [
				...record.partIds,
				...(record.aliases ?? []),
			]).map((id) => id.toLowerCase().replace(/[^a-z0-9]/gu, "")),
		);
		expect(zenerFolded.size).toBeGreaterThan(30);
		expect(new Set([...zenerCatalogPartIds])).toEqual(zenerFolded);
		expect(new Set([...gateOnlyFetPartIds])).toEqual(new Set(["2sk30a", "2sk30atm"]));
	});
});

describe("class schemas hold the backlog's parts", () => {
	// The ranked fill backlog (registry-backlog.json, read-only, not a work list) names JFETs,
	// Schottkys, LED colours and zener-by-voltage parts the schemas must already accept: a
	// schema that cannot name a part's parameters cannot hold that part at stage 3.
	it("names the parameters each backlog class needs", () => {
		// JFET (J201, 2N5457): threshold, transconductance, gate junction.
		expect(classParamNames("jfet")).toEqual(
			expect.arrayContaining(["thresholdVolts", "transconductance", "gateSaturationCurrent"]),
		);
		// MOSFET (BS170, 2N7000): same shared law, insulated gate stated as zero gate current.
		expect(classParamNames("mosfet")).toEqual(
			expect.arrayContaining(["thresholdVolts", "transconductance", "gateSaturationCurrent"]),
		);
		// Schottky diode (BAT41, 1N5817): forward knee parameters, no breakdown required.
		expect(classParamNames("diode")).toEqual(
			expect.arrayContaining(["saturationCurrent", "emissionCoefficient", "thermalVoltage"]),
		);
		// LED colour (RED, BLUE, SLP-135B): a diode law with a hotter thermal voltage.
		expect(classParamNames("led")).toEqual(
			expect.arrayContaining(["saturationCurrent", "emissionCoefficient", "thermalVoltage"]),
		);
		// Zener by voltage (9V1, 5V1): the reverse knee.
		expect(classParamNames("zener")).toEqual(expect.arrayContaining(["breakdownVolts"]));
		// BJT (2N5088, 2N3904): forward beta and leakage alongside the saturation current.
		expect(classParamNames("bjt")).toEqual(
			expect.arrayContaining(["saturationCurrent", "forwardBeta", "leakageAmps"]),
		);
		// Op-amp (JRC4558): open-loop gain plus the datasheet product.
		expect(classParamNames("opamp")).toEqual(
			expect.arrayContaining(["openLoopGain", "gainBandwidthHz"]),
		);
	});

	it("accepts exactly the engine's parameter names, no more", () => {
		expect(Object.keys(CLASS_PARAM_SCHEMAS).sort()).toEqual(
			["bjt", "charge-pump", "diode", "jfet", "led", "mosfet", "opamp", "regulator", "ujt", "zener"].sort(),
		);
		expect(classParamNames("bjt")).toHaveLength(5);
		expect(classParamNames("regulator")).toHaveLength(2);
		expect(classParamNames("charge-pump")).toHaveLength(2);
		expect(classParamNames("ujt")).toEqual(["intrinsicStandoffRatio", "interbaseResistanceOhms"]);
		expect(requiredClassParams("ujt")).toEqual(["intrinsicStandoffRatio", "interbaseResistanceOhms"]);
		// An (IS, n) measured at the engine VT mis-stamps when VT falls back to the 0.05
		// class default, and an Rs left at 2.0 ohm repeats the inflated-n failure: a
		// custom LED override must state the full quad.
		expect(requiredClassParams("led")).toEqual([
			"saturationCurrent",
			"emissionCoefficient",
			"thermalVoltage",
			"seriesResistance",
		]);
	});
});

describe("the absent lists still qualify the shipped op-amp entries", () => {
	const opampEntryHolds = (id: string): boolean => {
		const folded = id.toLowerCase().replace(/[^a-z0-9]/gu, "");
		return pedalPartCatalog.entries.some((entry) => {
			if (entry.model.kind !== "sections") return false;
			if (entry.model.sections.length === 0) return false;
			if (!entry.model.sections.every((section) => section.law.kind === "ideal-opamp")) {
				return false;
			}
			return entry.partIds.some(
				(held) => held.toLowerCase().replace(/[^a-z0-9]/gu, "") === folded,
			);
		});
	};

	it("every absent id names a catalog op-amp entry, with a stated reason", () => {
		// Mirrors the stamping passes' loud check: an absent id no op-amp entry holds throws
		// at load, so reaching this test means the check passed -- this pins the data side.
		for (const { partIds, reason } of [...opampGainBandwidthAbsent, ...opampOutputSwingAbsent]) {
			expect(reason.length).toBeGreaterThan(0);
			for (const id of partIds) {
				expect(opampEntryHolds(id), `${id} names no catalog op-amp entry`).toBe(true);
			}
		}
		expect(emptyRegistry.entries).toHaveLength(0);
	});

	it("findPartData matches whole folded ids and aliases, never a substring", () => {
		const data = definePartData([
			{
				partIds: ["FIX-A"],
				aliases: ["FIX-A-BIN"],
				class: "zener",
				params: { breakdownVolts: cited(5.1, "derived", "s", "d") },
			},
		]);
		expect(findPartData(data, "fix-a")?.partIds).toEqual(["FIX-A"]);
		expect(findPartData(data, "FIX-A-BIN")?.partIds).toEqual(["FIX-A"]);
		expect(findPartData(data, "FIX-AX")).toBeNull();
		expect(findPartData(data, "FIX")).toBeNull();
	});
});
