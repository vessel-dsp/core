// Step-1 wiring: the bjt, mosfet, diode-forward and jfet-channel cases read the
// registry by exact part id, with document-typed > registry > class-default
// precedence. Synthetic fixtures and synthetic registries only: no pedal
// identity, no diagnostic wording, nothing corpus-specific.
//
// Imports by relative path from the worktree source so the test provably runs
// the edited code rather than a built dist.
import { describe, expect, test } from "bun:test";
import { attachDeviceLaws } from "../src/device-laws";
import {
	bjtTypedParameters,
	derive,
	diodeClipper,
	emitterFollower,
	jfetFollower,
	jfetSpiceCasedParameters,
	mosfetFollower,
} from "../src/fixtures/circuits";
import { readNetlist } from "../src/netlist";
import {
	bjtLawEntry,
	diodeLawEntry,
	fetLawEntry,
	ledLawEntry,
	pedalPartCatalog,
	ujtLawEntry,
} from "../src/part-catalog";
import {
	emptyRegistry,
	registryEntryFor,
	registryLawFor,
	registryOpampGainBandwidth,
	type PartEntry,
	type PartRegistry,
} from "../src/registry";
import { definePartData, findPartRegistryData } from "../src/registry-data";
import type { DeviceLaw } from "../src/types";
import type { PartDataEntry } from "../src/registry-data/loader";

function lawEntry(partId: string, law: DeviceLaw): PartEntry {
	return {
		partIds: [partId],
		declaredTypes: [],
		terminalRoleGroups: [],
		model: { kind: "law", law },
	};
}

function stampOf(source: string, deviceId: string, registry: PartRegistry): DeviceLaw {
	const netlist = readNetlist(source, {});
	const lawed = attachDeviceLaws(netlist, registry);
	const resolution = lawed.resolutions.find((r) => r.device === deviceId);
	if (!resolution || resolution.outcome !== "law") {
		throw new Error(`${deviceId}: no law (outcome ${resolution?.outcome})`);
	}
	return resolution.law;
}

const SYNTH_BJT = "SYNTH-NPN-1";
const bjtWithPart = derive(
	emitterFollower,
	'      Description: "Bucket brigade delay memory chip."',
	`      PartNumber: ${SYNTH_BJT}\n      Description: "Bucket brigade delay memory chip."`,
);
const bjtRegistry: PartRegistry = {
	entries: [
		lawEntry(SYNTH_BJT, {
			kind: "bjt",
			polarity: "npn",
			saturationCurrent: 3.3e-14,
			forwardBeta: 250,
			reverseBeta: 2,
			thermalVoltage: 0.025852,
			leakageAmps: 0,
		}),
	],
};

const SYNTH_MOSFET = "SYNTH-NMOS-1";
const mosfetWithPart = derive(
	mosfetFollower,
	'      Description: "Clock driver chip."',
	`      PartNumber: ${SYNTH_MOSFET}\n      Description: "Clock driver chip."`,
);
const mosfetRegistry: PartRegistry = {
	entries: [
		lawEntry(SYNTH_MOSFET, {
			kind: "fet",
			channel: "n",
			thresholdVolts: 1.2,
			transconductance: 4e-3,
			channelLengthModulation: 0.01,
			subthresholdVolts: 0,
			gateSaturationCurrent: 0,
			gateOnsetVolts: 0,
			gateScaleVolts: 1,
		}),
	],
};

const SYNTH_DIODE = "SYNTH-DIODE-1";
const diodeWithPart = derive(
	diodeClipper,
	`      Description: "Clipping diode."\n  - id: D2`,
	`      PartNumber: ${SYNTH_DIODE}\n      Description: "Clipping diode."\n  - id: D2`,
);
const diodeRegistry: PartRegistry = {
	entries: [
		lawEntry(SYNTH_DIODE, {
			kind: "diode",
			saturationCurrent: 4.5e-9,
			emissionCoefficient: 1.6,
			thermalVoltage: 0.025852,
			breakdownVolts: 0,
			seriesResistance: 0.5,
			isLed: false,
		}),
	],
};

const SYNTH_JFET = "SYNTH-JFET-1";
const jfetWithPart = derive(
	jfetFollower,
	'      Description: "Clock driver chip."',
	`      PartNumber: ${SYNTH_JFET}\n      Description: "Clock driver chip."`,
);
const jfetRegistry: PartRegistry = {
	entries: [
		lawEntry(SYNTH_JFET, {
			kind: "fet",
			channel: "n",
			thresholdVolts: -1.1,
			transconductance: 2.5e-3,
			channelLengthModulation: 0.02,
			subthresholdVolts: 0.05,
			gateSaturationCurrent: 2e-6,
			gateOnsetVolts: 0.4,
			gateScaleVolts: 0.05,
		}),
	],
};

describe("discrete registry wiring", () => {
	test("a registry BJT value reaches the stamp", () => {
		const law = stampOf(bjtWithPart, "Q1", bjtRegistry);
		expect(law.kind).toBe("bjt");
		if (law.kind !== "bjt") throw new Error("unreachable");
		expect(law.saturationCurrent).toBe(3.3e-14);
		expect(law.forwardBeta).toBe(250);
		expect(law.reverseBeta).toBe(2);
	});

	test("a document-typed BJT value still wins over the registry", () => {
		// bjtTypedParameters states the class defaults (IS 1e-14, BF 100) as
		// typed values; against an entry stating otherwise, the typed values
		// must survive.
		const typed = derive(
			bjtTypedParameters,
			'      Description: "Bucket brigade delay memory chip."',
			`      PartNumber: ${SYNTH_BJT}\n      Description: "Bucket brigade delay memory chip."`,
		);
		const law = stampOf(typed, "Q1", bjtRegistry);
		expect(law.kind).toBe("bjt");
		if (law.kind !== "bjt") throw new Error("unreachable");
		expect(law.saturationCurrent).toBe(1e-14);
		expect(law.forwardBeta).toBe(100);
	});

	test("an unfilled BJT part keeps the class default", () => {
		const law = stampOf(bjtWithPart, "Q1", emptyRegistry);
		expect(law.kind).toBe("bjt");
		if (law.kind !== "bjt") throw new Error("unreachable");
		expect(law.saturationCurrent).toBe(1e-14);
		expect(law.forwardBeta).toBe(100);
		expect(law.reverseBeta).toBe(1);
	});

	test("a suffixed BJT spelling does not match the registry entry", () => {
		const suffixed = derive(
			emitterFollower,
			'      Description: "Bucket brigade delay memory chip."',
			`      PartNumber: ${SYNTH_BJT}-GR\n      Description: "Bucket brigade delay memory chip."`,
		);
		const law = stampOf(suffixed, "Q1", bjtRegistry);
		expect(law.kind).toBe("bjt");
		if (law.kind !== "bjt") throw new Error("unreachable");
		expect(law.saturationCurrent).toBe(1e-14);
		expect(law.forwardBeta).toBe(100);
	});

	test("a registry MOSFET value reaches the stamp", () => {
		const law = stampOf(mosfetWithPart, "Q1", mosfetRegistry);
		expect(law.kind).toBe("fet");
		if (law.kind !== "fet") throw new Error("unreachable");
		expect(law.thresholdVolts).toBe(1.2);
		expect(law.transconductance).toBe(4e-3);
	});

	test("an unfilled MOSFET part keeps the class default", () => {
		const law = stampOf(mosfetWithPart, "Q1", emptyRegistry);
		expect(law.kind).toBe("fet");
		if (law.kind !== "fet") throw new Error("unreachable");
		expect(law.thresholdVolts).toBe(2);
		expect(law.transconductance).toBe(1e-3);
		expect(law.gateSaturationCurrent).toBe(0);
	});

	test("a registry diode forward value reaches the stamp", () => {
		const law = stampOf(diodeWithPart, "D1", diodeRegistry);
		expect(law.kind).toBe("diode");
		if (law.kind !== "diode") throw new Error("unreachable");
		expect(law.saturationCurrent).toBe(4.5e-9);
		expect(law.emissionCoefficient).toBe(1.6);
		expect(law.seriesResistance).toBe(0.5);
	});

	test("an unfilled diode part in the same document keeps the class default", () => {
		// D2 names no part: the negative control rides the same compile.
		const law = stampOf(diodeWithPart, "D2", diodeRegistry);
		expect(law.kind).toBe("diode");
		if (law.kind !== "diode") throw new Error("unreachable");
		expect(law.saturationCurrent).toBe(2.52e-9);
		expect(law.emissionCoefficient).toBe(1.752);
	});

	test("a registry JFET channel value reaches the stamp", () => {
		const law = stampOf(jfetWithPart, "Q1", jfetRegistry);
		expect(law.kind).toBe("fet");
		if (law.kind !== "fet") throw new Error("unreachable");
		expect(law.thresholdVolts).toBe(-1.1);
		expect(law.transconductance).toBe(2.5e-3);
	});

	test("a document-typed JFET value still wins over the registry", () => {
		// Q_SPICE types Vt0 -2.02 and Beta 1.314m; against an entry stating
		// otherwise, the typed values must survive.
		const typed = derive(
			jfetSpiceCasedParameters,
			'      Description: "Corpus spelling."',
			`      PartNumber: ${SYNTH_JFET}\n      Description: "Corpus spelling."`,
		);
		const law = stampOf(typed, "Q_SPICE", jfetRegistry);
		expect(law.kind).toBe("fet");
		if (law.kind !== "fet") throw new Error("unreachable");
		expect(law.thresholdVolts).toBe(-2.02);
		expect(law.transconductance).toBe(0.001314);
	});

	test("an unfilled JFET part keeps the class default", () => {
		const law = stampOf(jfetWithPart, "Q1", emptyRegistry);
		expect(law.kind).toBe("fet");
		if (law.kind !== "fet") throw new Error("unreachable");
		expect(law.thresholdVolts).toBe(-2);
		expect(law.transconductance).toBe(1e-3);
	});
});

describe("wave-1 record builders", () => {
	const bjtRecord = (
		partIds: readonly string[],
		params: PartDataEntry["params"],
		extra: Partial<PartDataEntry> = {},
	): PartDataEntry => ({ partIds, class: "bjt", params, ...extra });

	test("a sparse BJT record gap-fills the live class defaults", () => {
		// 2N5089 states only forwardBeta: every omitted field must equal the
		// empty-registry stamp, so a drift between the builder literals and
		// device-laws.ts fails here rather than shipping silently.
		const doc = derive(
			emitterFollower,
			'      Description: "Bucket brigade delay memory chip."',
			'      PartNumber: 2N5089\n      Description: "Bucket brigade delay memory chip."',
		);
		const filled = stampOf(doc, "Q1", pedalPartCatalog);
		const bare = stampOf(doc, "Q1", emptyRegistry);
		expect(filled.kind).toBe("bjt");
		expect(bare.kind).toBe("bjt");
		if (filled.kind !== "bjt" || bare.kind !== "bjt") throw new Error("unreachable");
		expect(filled.forwardBeta).toBe(900);
		expect(filled.saturationCurrent).toBe(bare.saturationCurrent);
		expect(filled.reverseBeta).toBe(bare.reverseBeta);
		expect(filled.thermalVoltage).toBe(bare.thermalVoltage);
		expect(filled.leakageAmps).toBe(bare.leakageAmps);
	});

	test("a sparse MOSFET record gap-fills the live class defaults", () => {
		const doc = derive(
			mosfetFollower,
			'      Description: "Clock driver chip."',
			'      PartNumber: BS170\n      Description: "Clock driver chip."',
		);
		const filled = stampOf(doc, "Q1", pedalPartCatalog);
		const bare = stampOf(doc, "Q1", emptyRegistry);
		expect(filled.kind).toBe("fet");
		expect(bare.kind).toBe("fet");
		if (filled.kind !== "fet" || bare.kind !== "fet") throw new Error("unreachable");
		expect(filled.thresholdVolts).toBe(2.0);
		expect(filled.transconductance).toBe(bare.transconductance);
		expect(filled.channelLengthModulation).toBe(bare.channelLengthModulation);
		expect(filled.subthresholdVolts).toBe(bare.subthresholdVolts);
		expect(filled.gateSaturationCurrent).toBe(bare.gateSaturationCurrent);
	});

	test("shipped BJT data reaches the stamp", () => {
		const doc = derive(
			emitterFollower,
			'      Description: "Bucket brigade delay memory chip."',
			'      PartNumber: 2N3904\n      Description: "Bucket brigade delay memory chip."',
		);
		const law = stampOf(doc, "Q1", pedalPartCatalog);
		expect(law.kind).toBe("bjt");
		if (law.kind !== "bjt") throw new Error("unreachable");
		expect(law.saturationCurrent).toBe(2.5150964e-15);
		expect(law.forwardBeta).toBe(173.2050808);
	});

	test("shipped manufacturer-model saturation currents reach the stamp", () => {
		const doc2222 = derive(
			emitterFollower,
			'      Description: "Bucket brigade delay memory chip."',
			'      PartNumber: 2N2222A\n      Description: "Bucket brigade delay memory chip."',
		);
		const law2222 = stampOf(doc2222, "Q1", pedalPartCatalog);
		expect(law2222.kind).toBe("bjt");
		if (law2222.kind !== "bjt") throw new Error("unreachable");
		expect(law2222.saturationCurrent).toBe(3.88184e-14);
		expect(law2222.forwardBeta).toBe(122.4744871);
		const doc5088 = derive(
			emitterFollower,
			'      Description: "Bucket brigade delay memory chip."',
			'      PartNumber: 2N5088\n      Description: "Bucket brigade delay memory chip."',
		);
		const law5088 = stampOf(doc5088, "Q1", pedalPartCatalog);
		expect(law5088.kind).toBe("bjt");
		if (law5088.kind !== "bjt") throw new Error("unreachable");
		expect(law5088.saturationCurrent).toBe(5.911e-15);
		expect(law5088.forwardBeta).toBe(700);
	});

	test("shipped diode manufacturer-model pairs reach the stamp", () => {
		const doc4001 = derive(
			diodeClipper,
			`      Description: "Clipping diode."\n  - id: D2`,
			`      PartNumber: 1N4001\n      Description: "Clipping diode."\n  - id: D2`,
		);
		const law4001 = stampOf(doc4001, "D1", pedalPartCatalog);
		expect(law4001.kind).toBe("diode");
		if (law4001.kind !== "diode") throw new Error("unreachable");
		expect(law4001.saturationCurrent).toBe(76.9e-12);
		expect(law4001.emissionCoefficient).toBe(1.45);
		expect(law4001.seriesResistance).toBe(42e-3);
		const docBat41 = derive(
			diodeClipper,
			`      Description: "Clipping diode."\n  - id: D2`,
			`      PartNumber: BAT41\n      Description: "Clipping diode."\n  - id: D2`,
		);
		const lawBat41 = stampOf(docBat41, "D1", pedalPartCatalog);
		expect(lawBat41.kind).toBe("diode");
		if (lawBat41.kind !== "diode") throw new Error("unreachable");
		expect(lawBat41.saturationCurrent).toBe(10e-9);
		expect(lawBat41.emissionCoefficient).toBe(1.4402);
		expect(lawBat41.seriesResistance).toBe(0.12219);
		// 1N914 maps IS+N only (license limit: RS fragment not quoted); the stamp
		// keeps the class 1.0 ohm series resistance.
		const doc914 = derive(
			diodeClipper,
			`      Description: "Clipping diode."\n  - id: D2`,
			`      PartNumber: 1N914\n      Description: "Clipping diode."\n  - id: D2`,
		);
		const law914 = stampOf(doc914, "D1", pedalPartCatalog);
		expect(law914.kind).toBe("diode");
		if (law914.kind !== "diode") throw new Error("unreachable");
		expect(law914.saturationCurrent).toBe(6.2229e-9);
		expect(law914.emissionCoefficient).toBe(1.9224);
		expect(law914.seriesResistance).toBe(1.0);
	});

	test("a sparse LED record gap-fills the live LED class defaults", () => {
		// An LED record stating only the forward pair: every omitted field must equal
		// the empty-registry LED stamp (VT 0.05, Rs 2.0, no knee, isLed), so a drift
		// between the builder literals and device-laws.ts fails here rather than
		// shipping silently. The shipped LED records state every field explicitly.
		const entry = ledLawEntry({
			partIds: ["SYNTH-LED-1"],
			class: "led",
			params: {
				saturationCurrent: { value: 1e-14, basis: "datasheet", source: "s" },
				emissionCoefficient: { value: 2.0, basis: "datasheet", source: "s" },
			},
		});
		if (entry.model.kind !== "law" || entry.model.law.kind !== "diode") {
			throw new Error("unreachable");
		}
		expect(entry.model.law.saturationCurrent).toBe(1e-14);
		expect(entry.model.law.emissionCoefficient).toBe(2.0);
		expect(entry.model.law.thermalVoltage).toBe(0.05);
		expect(entry.model.law.seriesResistance).toBe(2.0);
		expect(entry.model.law.breakdownVolts).toBe(0);
		expect(entry.model.law.isLed).toBe(true);
	});

	test("ledLawEntry refuses the wrong class and half pairs", () => {
		expect(() =>
			ledLawEntry({
				partIds: ["X"],
				class: "diode",
				params: {
					saturationCurrent: { value: 1e-9, basis: "datasheet", source: "s" },
					emissionCoefficient: { value: 1.6, basis: "datasheet", source: "s" },
				},
			}),
		).toThrow(/class/);
		expect(() =>
			ledLawEntry({
				partIds: ["Y"],
				class: "led",
				params: {
					saturationCurrent: { value: 1e-9, basis: "datasheet", source: "s" },
				},
			}),
		).toThrow(/forward pair/);
	});

	test("a typed alias spelling resolves through the built entry", () => {
		const record = bjtRecord(
			["SYNTH-ALIAS-BASE"],
			{
				forwardBeta: { value: 321, basis: "datasheet", source: "test source" },
			},
			{ aliases: ["SYNTH-ALIAS-BIN"] },
		);
		const entry = bjtLawEntry(record);
		const registry: PartRegistry = { entries: [entry] };
		const doc = derive(
			emitterFollower,
			'      Description: "Bucket brigade delay memory chip."',
			'      PartNumber: SYNTH-ALIAS-BIN\n      Description: "Bucket brigade delay memory chip."',
		);
		const law = stampOf(doc, "Q1", registry);
		expect(law.kind).toBe("bjt");
		if (law.kind !== "bjt") throw new Error("unreachable");
		expect(law.forwardBeta).toBe(321);
	});

	test("builders refuse the wrong class, empty params, and half pairs", () => {
		expect(() =>
			bjtLawEntry(bjtRecord(["X"], {}, { class: "diode" }) as PartDataEntry),
		).toThrow(/class/);
		expect(() => bjtLawEntry(bjtRecord(["X"], {}))).toThrow(/no parameters/);
		expect(() =>
			diodeLawEntry({
				partIds: ["Y"],
				class: "diode",
				params: {
					saturationCurrent: { value: 1e-9, basis: "datasheet", source: "s" },
				},
			}),
		).toThrow(/forward pair/);
		expect(() =>
			fetLawEntry(
				{
					partIds: ["Z"],
					class: "diode",
					params: {
						thresholdVolts: { value: -1, basis: "datasheet", source: "s" },
					},
				},
				"jfet",
			),
		).toThrow(/class/);
	});

	test("the LM833 gain-bandwidth row reaches the catalog lookup", () => {
		expect(registryOpampGainBandwidth(pedalPartCatalog, "LM833")).toBe(16e6);
		expect(findPartRegistryData("LM833")?.class).toBe("opamp");
	});

	test("the wave-2 op-amp gain-bandwidth rows reach the catalog lookup", () => {
		expect(registryOpampGainBandwidth(pedalPartCatalog, "LF347N")).toBe(3e6);
		expect(registryOpampGainBandwidth(pedalPartCatalog, "LF347")).toBe(3e6);
		expect(registryOpampGainBandwidth(pedalPartCatalog, "LF351")).toBe(4e6);
		expect(registryOpampGainBandwidth(pedalPartCatalog, "LF351N")).toBe(4e6);
		expect(registryOpampGainBandwidth(pedalPartCatalog, "L272M")).toBe(350e3);
		expect(registryOpampGainBandwidth(pedalPartCatalog, "TL074CN")).toBe(5.25e6);
		expect(registryOpampGainBandwidth(pedalPartCatalog, "TL074")).toBe(5.25e6);
		expect(findPartRegistryData("LF347N")?.class).toBe("opamp");
		expect(findPartRegistryData("L272M")?.class).toBe("opamp");
		expect(findPartRegistryData("TL074CN")?.class).toBe("opamp");
	});

	test("the AD712 has an open-loop-gain entry and no gain-bandwidth figure", () => {
		expect(registryOpampGainBandwidth(pedalPartCatalog, "AD712")).toBeNull();
		const found = registryEntryFor(
			pedalPartCatalog,
			{ partId: "AD712", evidence: "exact-part" },
			8,
		);
		const section = found?.model.kind === "sections" ? found.model.sections[0] : null;
		expect(section?.law.kind).toBe("ideal-opamp");
		if (section?.law.kind === "ideal-opamp") {
			expect(section.law.openLoopGain).toBe(400000);
		}
	});

	test("the 4016B switch entry carries its own on-resistance, not the 4066's", () => {
		for (const id of ["4016B", "CD4016B"]) {
			const found = registryEntryFor(
				pedalPartCatalog,
				{ partId: id, evidence: "exact-part" },
				5,
			);
			const section = found?.model.kind === "sections" ? found.model.sections[0] : null;
			expect(section?.law.kind).toBe("analog-switch");
			if (section?.law.kind === "analog-switch") {
				expect(section.law.onOhms).toBe(280);
			}
		}
		const ref = registryEntryFor(
			pedalPartCatalog,
			{ partId: "CD4066", evidence: "exact-part" },
			5,
		);
		const refSection = ref?.model.kind === "sections" ? ref.model.sections[0] : null;
		if (refSection?.law.kind === "analog-switch") {
			expect(refSection.law.onOhms).toBe(80);
		} else {
			throw new Error("CD4066 reference entry lost its analog-switch law");
		}
	});

	test("the CT3101 clock-driver entry mirrors the MN3101 law", () => {
		const found = registryEntryFor(
			pedalPartCatalog,
			{ partId: "CT3101", evidence: "exact-part" },
			8,
		);
		const section = found?.model.kind === "sections" ? found.model.sections[0] : null;
		expect(section?.law.kind).toBe("clock-driver");
	});
});

describe("ujt registry wiring", () => {
	// Synthetic records only: no pedal identity, no real part numbers.
	const synthUjt = definePartData([
		{
			partIds: ["SYNTH-UJT-1"],
			aliases: ["SYNTH-UJT-1A"],
			class: "ujt",
			params: {
				intrinsicStandoffRatio: {
					value: 0.63,
					basis: "datasheet",
					source: "Synthetic UJT sheet p1: eta 0.63",
				},
				interbaseResistanceOhms: {
					value: 4700,
					basis: "datasheet",
					source: "Synthetic UJT sheet p1: Rbb 4.7k",
				},
			},
		},
	])[0] as PartDataEntry;

	test("a two-parameter record becomes a ujt law entry over both spellings", () => {
		const entry = ujtLawEntry(synthUjt);
		expect(entry.model.kind).toBe("law");
		if (entry.model.kind !== "law") throw new Error("unreachable");
		expect(entry.model.law.kind).toBe("ujt");
		if (entry.model.law.kind !== "ujt") throw new Error("unreachable");
		expect(entry.model.law.intrinsicStandoffRatio).toBe(0.63);
		expect(entry.model.law.interbaseResistanceOhms).toBe(4700);
		expect(entry.provisionalParams).toBeUndefined();
		const registry: PartRegistry = { entries: [entry] };
		for (const id of ["SYNTH-UJT-1", "synth-ujt-1a"]) {
			const law = registryLawFor(registry, id, "ujt");
			expect(law?.kind).toBe("ujt");
		}
		// Another law kind never matches a ujt entry.
		expect(registryLawFor(registry, "SYNTH-UJT-1", "bjt")).toBeNull();
	});

	test("a half record throws rather than shipping half a device", () => {
		const etaOnly = definePartData([
			{
				partIds: ["SYNTH-UJT-HALF"],
				class: "ujt",
				params: {
					intrinsicStandoffRatio: {
						value: 0.6,
						basis: "datasheet",
						source: "Synthetic UJT sheet p1: eta 0.6",
					},
				},
			},
		])[0] as PartDataEntry;
		expect(() => ujtLawEntry(etaOnly)).toThrow();
		const empty = definePartData([
			{
				partIds: ["SYNTH-UJT-EMPTY"],
				class: "ujt",
				params: {},
			},
		])[0] as PartDataEntry;
		expect(() => ujtLawEntry(empty)).toThrow();
	});

	test("a wrong-class record throws", () => {
		const bjt = definePartData([
			{
				partIds: ["SYNTH-NPN-X"],
				class: "bjt",
				params: {
					saturationCurrent: {
						value: 1e-14,
						basis: "datasheet",
						source: "Synthetic BJT sheet p1: IS 1e-14",
					},
					forwardBeta: {
						value: 100,
						basis: "datasheet",
						source: "Synthetic BJT sheet p1: BF 100",
					},
				},
			},
		])[0] as PartDataEntry;
		expect(() => ujtLawEntry(bjt)).toThrow();
	});

	test("a community-basis ujt parameter rides the provisional arm", () => {
		const url = "https://example.invalid/ujt-model";
		const quote = "SYNTH-UJT-2 eta 0.61";
		const community = definePartData([
			{
				partIds: ["SYNTH-UJT-2"],
				class: "ujt",
				params: {
					intrinsicStandoffRatio: {
						value: 0.61,
						basis: "community",
						source: `A published model at ${url} quoting "${quote}"`,
						sourceKind: "published-spice-model",
						url,
						quote,
						author: "Synthetic Author",
						retrievedDate: "2026-10-20",
						whyNoBetterSource: "No datasheet, model or measurement exists for this synthetic part.",
					},
					interbaseResistanceOhms: {
						value: 5100,
						basis: "datasheet",
						source: "Synthetic UJT sheet p1: Rbb 5.1k",
					},
				},
			},
		])[0] as PartDataEntry;
		const entry = ujtLawEntry(community);
		expect(entry.provisionalParams).toEqual([
			{ name: "intrinsicStandoffRatio", url },
		]);
		if (entry.model.kind !== "law" || entry.model.law.kind !== "ujt") {
			throw new Error("unreachable");
		}
		expect(entry.model.law.intrinsicStandoffRatio).toBe(0.61);
	});
});
