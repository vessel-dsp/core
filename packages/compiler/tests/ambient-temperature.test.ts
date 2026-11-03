// Ambient temperature as a compile option: junction laws fold to T at compile time.
//
// Registered-first expectations (numbers below are hand-computed closed forms, not
// implementation outputs):
// - With the option absent, every shipped fixture compiles byte-identically to an
//   explicit 26.85 C (300.00 K): the fold is skipped outright inside a 1e-9 K band.
// - At 19 C (292.15 K) a silicon diode (IS 2.52e-9, n 1.752) stamps Vt 0.02517554 V
//   and IS 1.24652e-09 A; a germanium AC128 (IS 17e-6, n 1) stamps Vt 0.02517554 V
//   and IS 7.82474e-06 A. Beta, RS and breakdown do not move.
// - Junctions no registry entry types run the silicon bandgap and are named once by
//   `material-default-silicon`, only off-reference; at the default it never fires.

import { describe, expect, it } from "bun:test";
import {
	attachDeviceLaws,
	kelvinFromAmbientCelsius,
	REFERENCE_TEMPERATURE_KELVIN,
} from "../src/device-laws";
import { compile } from "../src/compile";
import { emit } from "../src/emit";
import { readNetlist } from "../src/netlist";
import { emptyRegistry } from "../src/registry";
import { findPartRegistryData, pedalPartCatalog } from "../src/index";
import * as circuits from "../src/fixtures/circuits";

const KELVIN_19C = 19 + 273.15;

function relativeError(actual: number, expected: number): number {
	return Math.abs(actual - expected) / Math.abs(expected);
}

function lawOf(source: string, device: string, kelvin?: number) {
	const lawed = attachDeviceLaws(
		readNetlist(source),
		pedalPartCatalog,
		kelvin === undefined ? undefined : { ambientKelvin: kelvin },
	);
	const resolution = lawed.resolutions.find(
		(entry) => entry.device === device,
	);
	if (resolution?.outcome !== "law") {
		throw new Error(
			`expected a law for ${device}, got ${JSON.stringify(resolution)}`,
		);
	}
	return resolution.law;
}

const bat41Clipper = circuits.diodeClipper.replace(
	'      Description: "Clipping diode."',
	'      Description: "Clipping diode."\n      PartNumber: "BAT41"',
);

const ac128CommonEmitter = circuits.commonEmitterAmplifier.replace(
	'      Type: "NPN"',
	'      Type: "PNP"\n      PartNumber: "AC128"',
);

const otaDoc = `schema: circuit-interchange/v3
metadata:
  name: "OTA Temp"
components:
  - id: JIN
    kind: jack
    name: INPUT
    sourceTypeName: Circuit.Input
    origin:
      x: -200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: -200
          y: 0
  - id: JOUT
    kind: jack
    name: OUTPUT
    sourceTypeName: Circuit.Output
    origin:
      x: 200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 200
          y: 0
  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: gnd
        node: 0
        position:
          x: 0
          y: -100
  - id: A1
    kind: ota
    name: A1
    sourceTypeName: Circuit.OTA
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: vin+
        role: vin+
        node: 1
        position:
          x: -20
          y: 0
      - name: vin-
        role: vin-
        node: 0
        position:
          x: -20
          y: 10
      - name: vout
        role: vout
        node: 2
        position:
          x: 20
          y: 0
      - name: i_bias
        role: i_bias
        node: 2
        position:
          x: 0
          y: 20
      - name: v-
        role: v-
        node: 0
        position:
          x: 0
          y: -20
    properties:
      PartNumber: "CA3080"
wires: []
`;

describe("ambient temperature", () => {
	it("leaves every shipped fixture byte-identical with the option absent vs 26.85 C", () => {
		// Absent means exactly 300 K; 26.85 C is 300.00 K, inside the 1e-9 K snap
		// band, so the fold is skipped on both arms and no number can move.
		const sources = Object.entries(circuits).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		);
		expect(sources.length).toBeGreaterThan(10);
		for (const [name, source] of sources) {
			const plain = compile(source, { registry: pedalPartCatalog });
			const warm = compile(source, {
				registry: pedalPartCatalog,
				ambientTemperatureC: 26.85,
			});
			expect([name, warm.status]).toEqual([name, plain.status]);
			if (plain.status === "ok" && warm.status === "ok") {
				expect([name, emit(warm.program).text]).toEqual([
					name,
					emit(plain.program).text,
				]);
			} else if (plain.status !== "ok" && warm.status !== "ok") {
				expect([name, warm.reasons]).toEqual([name, plain.reasons]);
			}
		}
	});

	it("keeps today's diode numbers exactly with the option absent", () => {
		const law = lawOf(circuits.diodeClipper, "D1");
		expect(law.kind).toBe("diode");
		if (law.kind !== "diode") return;
		expect(law.thermalVoltage).toBe(0.025852);
		expect(law.saturationCurrent).toBe(2.52e-9);
		expect(law.emissionCoefficient).toBe(1.752);
	});

	it("folds a silicon diode Vt with T and IS with the SPICE law at 19 C", () => {
		const law = lawOf(circuits.diodeClipper, "D1", KELVIN_19C);
		expect(law.kind).toBe("diode");
		if (law.kind !== "diode") return;
		// Vt = 0.025852 * 292.15/300; IS = 2.52e-9 * (T/300)^(3/1.752) *
		// exp((1.11*q/(1.752*k)) * (1/300 - 1/T)).
		expect(relativeError(law.thermalVoltage, 0.02517553933333333)).toBeLessThan(1e-12);
		expect(relativeError(law.saturationCurrent, 1.246515674841394e-9)).toBeLessThan(1e-9);
		expect(law.emissionCoefficient).toBe(1.752);
		expect(law.seriesResistance).toBe(1);
		expect(law.breakdownVolts).toBe(0);
	});

	it("folds a germanium BJT IS with EG 0.67 at 19 C and keeps beta", () => {
		const law = lawOf(ac128CommonEmitter, "Q1", KELVIN_19C);
		expect(law.kind).toBe("bjt");
		if (law.kind !== "bjt") return;
		expect(law.polarity).toBe("pnp");
		expect(relativeError(law.thermalVoltage, 0.02517553933333333)).toBeLessThan(1e-12);
		// IS = 17e-6 * (T/300)^3 * exp((0.67*q/k) * (1/300 - 1/T)).
		expect(relativeError(law.saturationCurrent, 7.82474397369216e-6)).toBeLessThan(1e-9);
		expect(law.forwardBeta).toBe(90);
		expect(law.leakageAmps).toBe(0);
	});

	it("folds an OTA bias diode with silicon ideality at 19 C", () => {
		const law = lawOf(otaDoc, "A1#0", KELVIN_19C);
		expect(law.kind).toBe("ota");
		if (law.kind !== "ota") return;
		// The CA3080 sections entry carries transconductance only, so the fold
		// fills the scaled class defaults: IS = 1e-12 * silicon ratio at n 1,
		// Vt = 0.025852 * T/300.
		expect(relativeError(law.thermalVoltage ?? 0, 0.02517553933333333)).toBeLessThan(1e-12);
		expect(relativeError(law.saturationCurrent ?? 0, 2.9134575871700513e-13)).toBeLessThan(1e-9);
	});

	it("types germanium and Schottky materials from the cited records, silicon by default", () => {
		expect(findPartRegistryData("BAT41")?.material).toBe("schottky");
		expect(findPartRegistryData("BAT85")?.material).toBe("schottky");
		expect(findPartRegistryData("1N5817")?.material).toBe("schottky");
		expect(findPartRegistryData("1N34A")?.material).toBe("germanium");
		expect(findPartRegistryData("1N60")?.material).toBe("germanium");
		expect(findPartRegistryData("1S188FM")?.material).toBe("germanium");
		expect(findPartRegistryData("AC128")?.material).toBe("germanium");
		expect(findPartRegistryData("OC44")?.material).toBe("germanium");
		expect(findPartRegistryData("NKT275")?.material).toBe("germanium");
		expect(findPartRegistryData("2N3904")?.material).toBeUndefined();
		expect(findPartRegistryData("1N4148")?.material).toBeUndefined();
	});

	it("names defaulted junctions once, only off-reference", () => {
		const warm = compile(circuits.diodeClipper, {
			registry: emptyRegistry,
			ambientTemperatureC: 19,
		});
		expect(warm.status).toBe("ok");
		if (warm.status !== "ok") return;
		const notices = warm.warnings.filter(
			(warning) => warning.code === "material-default-silicon",
		);
		expect(notices).toHaveLength(1);
		expect(notices[0]?.devices).toEqual(["D1", "D2"]);

		// A catalogued Schottky is typed evidence, so it is not named: only the
		// unregistered D2 defaults.
		const schottky = compile(bat41Clipper, {
			registry: pedalPartCatalog,
			ambientTemperatureC: 19,
		});
		expect(schottky.status).toBe("ok");
		if (schottky.status !== "ok") return;
		const typed = schottky.warnings.filter(
			(warning) => warning.code === "material-default-silicon",
		);
		expect(typed).toHaveLength(1);
		expect(typed[0]?.devices).toEqual(["D2"]);

		// At the default nothing is recorded: no new warning on any compile.
		const plain = compile(circuits.diodeClipper, { registry: emptyRegistry });
		expect(plain.status).toBe("ok");
		if (plain.status !== "ok") return;
		expect(
			plain.warnings.some(
				(warning) => warning.code === "material-default-silicon",
			),
		).toBe(false);
	});

	it("refuses an unphysical ambient option", () => {
		expect(() =>
			compile(circuits.diodeClipper, { ambientTemperatureC: Number.NaN }),
		).toThrow(RangeError);
		expect(() =>
			compile(circuits.diodeClipper, { ambientTemperatureC: -300 }),
		).toThrow(/absolute zero/);
		expect(kelvinFromAmbientCelsius(26.85)).toBeCloseTo(
			REFERENCE_TEMPERATURE_KELVIN,
			12,
		);
	});
});
