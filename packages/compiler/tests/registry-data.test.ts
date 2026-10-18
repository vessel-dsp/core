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
	chargePumpRegistryRecords,
	classParamNames,
	defineOpampRecords,
	definePartData,
	findPartData,
	findPartRegistryData,
	jfetRegistryRecords,
	opampGainBandwidthAbsent,
	opampOutputSwingAbsent,
	opampRegistryRecords,
	partRegistryData,
	regulatorRegistryRecords,
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
	withDatasheetOutputSwing,
	zenerCatalogPartIds,
} from "../src/part-catalog";
import {
	emptyRegistry,
	registryEntryFor,
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
});

describe("stage-1 migration inventory", () => {
	it("moved exactly the listed parametric data, no more", () => {
		// Op-amp gain-bandwidth + swing rows, zener rows, one JFET row, regulator rails,
		// charge-pump loss/slope. IC macros and `sections` entries stayed in code.
		expect(opampRegistryRecords).toHaveLength(10);
		expect(zenerRegistryRecords).toHaveLength(29);
		expect(jfetRegistryRecords).toHaveLength(1);
		expect(regulatorRegistryRecords).toHaveLength(5);
		expect(chargePumpRegistryRecords).toHaveLength(8);
		expect(partRegistryData).toHaveLength(10 + 29 + 1 + 5 + 8);
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

	it("regulator rails are the five fixed rails, and only the LT1054 pump prints a loss", () => {
		const volts = regulatorRegistryRecords.map(
			(record) => record.params["volts"]?.value,
		);
		expect([...volts].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([-15, 5, 9, 15, 18]);
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
		expect(new Set([...gateOnlyFetPartIds])).toEqual(new Set(["2sk30a"]));
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
			["bjt", "charge-pump", "diode", "jfet", "led", "mosfet", "opamp", "regulator", "zener"].sort(),
		);
		expect(classParamNames("bjt")).toHaveLength(5);
		expect(classParamNames("regulator")).toHaveLength(2);
		expect(classParamNames("charge-pump")).toHaveLength(2);
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
