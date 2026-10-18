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
	emptyRegistry,
	type PartEntry,
	type PartRegistry,
} from "../src/registry";
import type { DeviceLaw } from "../src/types";

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
